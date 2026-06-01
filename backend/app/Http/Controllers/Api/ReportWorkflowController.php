<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Report;
use App\Models\ReportAssignment;
use App\Models\ReportingPeriod;
use App\Services\Reports\ReportLockingService;
use App\Services\Reports\ReportSubmissionService;
use App\Support\Authorization\Permissions;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;

class ReportWorkflowController extends Controller
{
    public function __construct(
        private readonly ReportSubmissionService $submissionService,
        private readonly ReportLockingService $lockingService,
    ) {}

    public function index(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'assignment_id' => ['sometimes', 'uuid'],
            'reporting_period_id' => ['sometimes', 'uuid'],
        ]);
        $user = $request->user();

        $query = Report::query()
            ->with(['assignment.department', 'assignment.template', 'department', 'template', 'reportingPeriod', 'fieldValues.fieldDefinition', 'calculatedMetric'])
            ->latest('updated_at');

        if (! Permissions::isAdminRole($user->role_key)) {
            $query->whereHas('assignment', fn ($assignmentQuery) => $assignmentQuery
                ->where('nurse_id', $user->id)
                ->where('active', true));
        }

        if (isset($validated['assignment_id'])) {
            $query->where('assignment_id', $validated['assignment_id']);
        }

        if (isset($validated['reporting_period_id'])) {
            $query->where('reporting_period_id', $validated['reporting_period_id']);
        }

        return response()->json([
            'data' => $query->get()->map(fn (Report $report) => $this->serializeReport($report)),
        ]);
    }

    public function show(Request $request, Report $report): JsonResponse
    {
        Gate::authorize('view', $report);

        return response()->json($this->serializeReport($this->loadReport($report)));
    }

    public function store(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'assignment_id' => ['required_without:assignmentId', 'uuid'],
            'assignmentId' => ['required_without:assignment_id', 'uuid'],
            'reporting_period_id' => ['required_without:reportingPeriodId', 'uuid'],
            'reportingPeriodId' => ['required_without:reporting_period_id', 'uuid'],
            'values' => ['sometimes', 'array'],
            'submit' => ['sometimes', 'boolean'],
        ]);

        $assignment = ReportAssignment::query()->findOrFail($validated['assignment_id'] ?? $validated['assignmentId']);
        $period = ReportingPeriod::query()->findOrFail($validated['reporting_period_id'] ?? $validated['reportingPeriodId']);

        $report = $this->submissionService->save(
            $request->user(),
            $assignment,
            $period,
            $validated['values'] ?? [],
            (bool) ($validated['submit'] ?? false),
        );

        return response()->json($this->serializeReport($report), 201);
    }

    public function update(Request $request, Report $report): JsonResponse
    {
        Gate::authorize('update', $report);

        $validated = $request->validate([
            'values' => ['required', 'array'],
            'submit' => ['sometimes', 'boolean'],
        ]);
        $report->loadMissing(['assignment', 'reportingPeriod']);

        $savedReport = $this->submissionService->save(
            $request->user(),
            $report->assignment,
            $report->reportingPeriod,
            $validated['values'],
            (bool) ($validated['submit'] ?? false),
        );

        return response()->json($this->serializeReport($savedReport));
    }

    public function submit(Request $request, Report $report): JsonResponse
    {
        Gate::authorize('submit', $report);

        $validated = $request->validate([
            'values' => ['sometimes', 'array'],
        ]);
        $report->loadMissing(['assignment', 'reportingPeriod']);

        $savedReport = $this->submissionService->save(
            $request->user(),
            $report->assignment,
            $report->reportingPeriod,
            $validated['values'] ?? [],
            true,
        );

        return response()->json($this->serializeReport($savedReport));
    }

    public function lock(Request $request, Report $report): JsonResponse
    {
        Gate::authorize('lock', $report);

        $lockedReport = $this->lockingService->setLockState($request->user(), $report, true);

        return response()->json($this->serializeReport($this->loadReport($lockedReport)));
    }

    public function unlock(Request $request, Report $report): JsonResponse
    {
        Gate::authorize('unlock', $report);

        $unlockedReport = $this->lockingService->setLockState($request->user(), $report, false);

        return response()->json($this->serializeReport($this->loadReport($unlockedReport)));
    }

    private function loadReport(Report $report): Report
    {
        return $report->load(['assignment.department', 'assignment.template', 'department', 'template', 'reportingPeriod', 'fieldValues.fieldDefinition', 'calculatedMetric']);
    }

    /**
     * @return array<string, mixed>
     */
    private function serializeReport(Report $report): array
    {
        $report = $this->loadReport($report);

        return [
            'id' => $report->id,
            'assignmentId' => $report->assignment_id,
            'departmentId' => $report->department_id,
            'departmentSlug' => $report->department?->slug,
            'departmentName' => $report->department?->name,
            'templateId' => $report->template_id,
            'templateSlug' => $report->template?->slug,
            'templateName' => $report->template?->name,
            'reportingPeriodId' => $report->reporting_period_id,
            'status' => $report->status,
            'submittedAt' => $report->submitted_at?->toJSON(),
            'lockedAt' => $report->locked_at?->toJSON(),
            'createdById' => $report->created_by,
            'updatedById' => $report->updated_by,
            'createdAt' => $report->created_at?->toJSON(),
            'updatedAt' => $report->updated_at?->toJSON(),
            'values' => $this->serializeValues($report),
            'calculatedMetrics' => [
                'borPercent' => $this->nullableFloat($report->calculatedMetric?->bor_percent),
                'btr' => $this->nullableFloat($report->calculatedMetric?->btr),
                'alos' => $this->nullableFloat($report->calculatedMetric?->alos),
                'payload' => $report->calculatedMetric?->metric_payload ?? [],
            ],
        ];
    }

    /**
     * @return array<string, array{fieldId: string, dailyValues: array<string, mixed>}>
     */
    private function serializeValues(Report $report): array
    {
        $values = [];

        foreach ($report->fieldValues as $fieldValue) {
            $fieldKey = $fieldValue->fieldDefinition?->field_key;

            if (! $fieldKey) {
                continue;
            }

            $values[$fieldKey] ??= [
                'fieldId' => $fieldKey,
                'dailyValues' => [],
            ];
            $values[$fieldKey]['dailyValues'][$fieldValue->day_name] = match (true) {
                $fieldValue->value_number !== null => $this->numericValue($fieldValue->value_number),
                $fieldValue->value_time !== null => substr((string) $fieldValue->value_time, 0, 5),
                $fieldValue->value_text !== null => $fieldValue->value_text,
                default => $fieldValue->value_json,
            };
        }

        return $values;
    }

    private function numericValue(mixed $value): int|float
    {
        $number = (float) $value;

        return floor($number) === $number ? (int) $number : $number;
    }

    private function nullableFloat(mixed $value): ?float
    {
        return $value === null ? null : (float) $value;
    }
}
