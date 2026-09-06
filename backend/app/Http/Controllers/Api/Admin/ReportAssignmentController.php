<?php

namespace App\Http\Controllers\Api\Admin;

use App\Http\Controllers\Api\Concerns\SerializesAdminResources;
use App\Http\Controllers\Controller;
use App\Models\Department;
use App\Models\ReportAssignment;
use App\Models\ReportTemplate;
use App\Models\User;
use App\Services\Admin\AdminAuditService;
use App\Services\Analytics\DashboardAnalyticsService;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;
use Illuminate\Validation\ValidationException;

class ReportAssignmentController extends Controller
{
    use SerializesAdminResources;

    public function __construct(
        private readonly AdminAuditService $auditService,
        private readonly DashboardAnalyticsService $dashboardAnalytics,
    ) {}

    public function index(Request $request): JsonResponse
    {
        Gate::authorize('viewAny', ReportAssignment::class);

        $validated = $request->validate([
            'nurse_id' => ['sometimes', 'uuid'],
            'department_id' => ['sometimes', 'string', 'max:80'],
            'template_id' => ['sometimes', 'string', 'max:80'],
            'active' => ['sometimes', 'boolean'],
            'page' => ['sometimes', 'integer', 'min:1'],
            'per_page' => ['sometimes', 'integer', 'min:1', 'max:100'],
            'perPage' => ['sometimes', 'integer', 'min:1', 'max:100'],
        ]);
        $query = ReportAssignment::query()
            ->with(['nurse', 'department', 'template', 'approver'])
            ->latest('approved_at');

        if (isset($validated['nurse_id'])) {
            $query->where('nurse_id', $validated['nurse_id']);
        }

        if (isset($validated['department_id'])) {
            $department = $this->resolveDepartment($validated['department_id']);
            $query->where('department_id', $department->id);
        }

        if (isset($validated['template_id'])) {
            $template = $this->resolveTemplate($validated['template_id']);
            $query->where('template_id', $template->id);
        }

        if (array_key_exists('active', $validated)) {
            $query->where('active', (bool) $validated['active']);
        }

        $assignments = $query->paginate((int) ($validated['per_page'] ?? $validated['perPage'] ?? 100));

        return response()->json([
            'data' => $assignments->getCollection()
                ->map(fn (ReportAssignment $assignment) => $this->serializeAssignment($assignment))
                ->values(),
            'meta' => [
                'currentPage' => $assignments->currentPage(),
                'lastPage' => $assignments->lastPage(),
                'perPage' => $assignments->perPage(),
                'total' => $assignments->total(),
            ],
        ]);
    }

    public function store(Request $request): JsonResponse
    {
        Gate::authorize('create', ReportAssignment::class);

        $validated = $request->validate([
            'nurse_id' => ['required_without:nurseId', 'uuid', 'exists:users,id'],
            'nurseId' => ['required_without:nurse_id', 'uuid', 'exists:users,id'],
            'department_id' => ['required_without:departmentId', 'string', 'max:80'],
            'departmentId' => ['required_without:department_id', 'string', 'max:80'],
            'template_id' => ['required_without:templateId', 'string', 'max:80'],
            'templateId' => ['required_without:template_id', 'string', 'max:80'],
            'active' => ['sometimes', 'boolean'],
        ]);

        $nurse = User::query()->findOrFail($validated['nurse_id'] ?? $validated['nurseId']);
        $department = $this->resolveDepartment($validated['department_id'] ?? $validated['departmentId']);
        $template = $this->resolveTemplate($validated['template_id'] ?? $validated['templateId']);

        if ($nurse->role_key !== 'nurse') {
            throw ValidationException::withMessages([
                'nurse_id' => 'Assignments can only be created for nurse users.',
            ]);
        }

        if ($department->template_id !== $template->id) {
            throw ValidationException::withMessages([
                'template_id' => 'The selected template must match the department template.',
            ]);
        }

        $assignment = ReportAssignment::query()->updateOrCreate(
            [
                'nurse_id' => $nurse->id,
                'department_id' => $department->id,
                'template_id' => $template->id,
            ],
            [
                'active' => (bool) ($validated['active'] ?? true),
                'approved_at' => now(),
                'approved_by' => $request->user()->id,
            ],
        );

        $assignment->load(['nurse', 'department', 'template', 'approver']);
        $this->auditService->record($request->user(), 'upsert', 'report_assignment', $assignment->id, null, $this->assignmentAuditValues($assignment), $request);
        $this->dashboardAnalytics->invalidate();

        return response()->json($this->serializeAssignment($assignment), $assignment->wasRecentlyCreated ? 201 : 200);
    }

    public function update(Request $request, ReportAssignment $assignment): JsonResponse
    {
        Gate::authorize('update', $assignment);

        $validated = $request->validate([
            'active' => ['sometimes', 'boolean'],
        ]);
        $oldValues = $this->assignmentAuditValues($assignment);

        if (array_key_exists('active', $validated)) {
            $assignment->forceFill(['active' => (bool) $validated['active']])->save();
        }

        $assignment->refresh()->load(['nurse', 'department', 'template', 'approver']);
        $this->auditService->record($request->user(), 'update', 'report_assignment', $assignment->id, $oldValues, $this->assignmentAuditValues($assignment), $request);
        $this->dashboardAnalytics->invalidate();

        return response()->json($this->serializeAssignment($assignment));
    }

    public function destroy(Request $request, ReportAssignment $assignment): JsonResponse
    {
        Gate::authorize('delete', $assignment);

        $oldValues = $this->assignmentAuditValues($assignment);
        $assignment->forceFill(['active' => false])->save();
        $assignment->refresh()->load(['nurse', 'department', 'template', 'approver']);

        $this->auditService->record($request->user(), 'deactivate', 'report_assignment', $assignment->id, $oldValues, $this->assignmentAuditValues($assignment), $request);
        $this->dashboardAnalytics->invalidate();

        return response()->json($this->serializeAssignment($assignment));
    }

    private function resolveDepartment(string $identifier): Department
    {
        return Department::query()
            ->where(fn (Builder $query) => $query->where('id', $identifier)->orWhere('slug', $identifier))
            ->firstOrFail();
    }

    private function resolveTemplate(string $identifier): ReportTemplate
    {
        return ReportTemplate::query()
            ->where(fn (Builder $query) => $query->where('id', $identifier)->orWhere('slug', $identifier))
            ->firstOrFail();
    }

    /**
     * @return array<string, mixed>
     */
    private function assignmentAuditValues(ReportAssignment $assignment): array
    {
        return $assignment->only(['id', 'nurse_id', 'department_id', 'template_id', 'active', 'approved_at', 'approved_by']);
    }
}
