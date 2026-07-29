<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Api\Concerns\SerializesAdminResources;
use App\Http\Controllers\Controller;
use App\Models\AccessRequest;
use App\Models\Department;
use App\Models\DutyAssignment;
use App\Models\RepAssignment;
use App\Models\ReportAssignment;
use App\Models\ReportingPeriod;
use App\Models\ReportTemplate;
use App\Models\Role;
use App\Models\RotationBlock;
use App\Models\RotationCalendar;
use App\Models\Section;
use App\Models\TransferRequest;
use App\Models\User;
use App\Services\Academic\MorningSessionService;
use App\Services\Academic\RosterService;
use App\Services\Academic\RotationPlanStateService;
use App\Services\Admin\AppSettingsService;
use App\Services\Workspace\WorkspaceRevisionService;
use App\Services\Workspace\WorkspaceRevisionToken;
use App\Support\Authorization\Permissions;
use App\Support\HospitalClock;
use App\Support\Reports\ReportPeriodWindow;
use App\Support\RoleTitles;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class WorkspaceController extends Controller
{
    use SerializesAdminResources;

    private const INTERACTIVE_PERIOD_COUNT = 26;

    public function __construct(
        private readonly WorkspaceRevisionService $workspaceRevision,
        private readonly WorkspaceRevisionToken $workspaceRevisionToken,
    ) {}

    public function revision(Request $request): JsonResponse
    {
        $userId = (string) $request->attributes->get('workspaceRevisionUserId');

        return response()->json([
            'revision' => $this->workspaceRevision->current(),
            'revisionToken' => $this->workspaceRevisionToken->issue($userId),
        ]);
    }

    public function accessRequests(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'status' => ['sometimes', 'string', 'in:pending,approved,rejected'],
        ]);
        $user = $request->user();

        $requests = AccessRequest::query()
            ->with(['user', 'reviewer', 'items.department', 'items.template'])
            ->when(
                ! Permissions::isAdminRole($user->role_key),
                fn (Builder $query) => $query->where('user_id', $user->id),
            )
            ->when(
                isset($validated['status']),
                fn (Builder $query) => $query->where('status', $validated['status']),
            )
            ->latest('requested_at')
            ->limit(200)
            ->get();

        return response()->json([
            'data' => $requests
                ->map(fn (AccessRequest $accessRequest) => $this->serializeAccessRequest($accessRequest))
                ->values(),
        ]);
    }

    /**
     * The profile directory on its own, for callers that need the user list but
     * not the rest of the workspace bootstrap.
     *
     * Visibility matches `show()` exactly: admins see every user, everyone else
     * sees only themselves. The serializer is shared, so the rows are
     * byte-identical to `state.profiles` and the SPA can drop them straight in.
     */
    public function profiles(Request $request): JsonResponse
    {
        $user = $request->user();

        if (! Permissions::isAdminRole($user->role_key)) {
            return response()->json([
                'data' => [$this->profile($user)],
                'meta' => [
                    'currentPage' => 1,
                    'lastPage' => 1,
                    'perPage' => 100,
                    'total' => 1,
                ],
            ]);
        }

        $validated = $request->validate([
            'page' => ['sometimes', 'integer', 'min:1'],
            'per_page' => ['sometimes', 'integer', 'min:1', 'max:100'],
            'perPage' => ['sometimes', 'integer', 'min:1', 'max:100'],
        ]);
        $profiles = User::query()
            ->orderBy('full_name')
            ->paginate((int) ($validated['per_page'] ?? $validated['perPage'] ?? 100));

        return response()->json([
            'data' => $profiles->getCollection()
                ->map(fn (User $profile) => $this->profile($profile))
                ->values(),
            'meta' => [
                'currentPage' => $profiles->currentPage(),
                'lastPage' => $profiles->lastPage(),
                'perPage' => $profiles->perPage(),
                'total' => $profiles->total(),
            ],
        ]);
    }

    public function show(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'include_profiles' => ['sometimes', 'boolean'],
            'includeProfiles' => ['sometimes', 'boolean'],
            'include_access_requests' => ['sometimes', 'boolean'],
            'includeAccessRequests' => ['sometimes', 'boolean'],
            'include_history' => ['sometimes', 'boolean'],
            'includeHistory' => ['sometimes', 'boolean'],
            'report_period_window' => ['sometimes', 'string', 'in:default,all'],
            'reportPeriodWindow' => ['sometimes', 'string', 'in:default,all'],
        ]);

        $user = $request->user();
        $isAdmin = Permissions::isAdminRole($user->role_key);
        $includeAccessRequests = $this->booleanOption($validated, 'include_access_requests', 'includeAccessRequests');

        // Nurses only receive ACTIVE field definitions, so soft-disabled fields
        // drop out of their entry forms. Admins still receive every field so
        // historical values stay visible and the template editor can manage them.
        $templates = ReportTemplate::query()
            ->with(['fieldDefinitions' => fn ($query) => $query
                ->when(! $isAdmin, fn ($activeQuery) => $activeQuery->active())
                ->orderBy('display_order')])
            ->orderBy('name')
            ->get();
        $departments = Department::query()->orderBy('name')->get();
        $allPeriods = ReportingPeriod::query()->orderBy('week_start')->get();
        $visiblePeriodIds = ReportPeriodWindow::ids($allPeriods, ReportPeriodWindow::ALL_WINDOW);
        $periods = $allPeriods
            ->whereIn('id', array_slice($visiblePeriodIds, -self::INTERACTIVE_PERIOD_COUNT))
            ->values();

        // The bootstrap is an identity/reference document. Full profile,
        // assignment, report, and history collections live behind their
        // paginated route endpoints and are loaded only by pages that use them.
        $profiles = collect([$user]);

        $assignments = $isAdmin
            ? collect()
            : ReportAssignment::query()
                ->with(['department', 'template'])
                ->where('nurse_id', $user->id)
                ->where('active', true)
                ->latest('approved_at')
                ->get();

        $accessRequests = $includeAccessRequests
            ? AccessRequest::query()
                ->with(['user', 'reviewer', 'items.department', 'items.template'])
                ->when(! $isAdmin, fn (Builder $query) => $query->where('user_id', $user->id))
                ->latest('requested_at')
                ->get()
            : collect();

        $notifications = $user->notifications()
            ->latest('created_at')
            ->limit(100)
            ->get();

        $templateSlugById = $templates->pluck('slug', 'id')->all();
        $departmentSlugById = $departments->pluck('slug', 'id')->all();

        $state = [
            'currentUserId' => $user->id,
            // The role registry drives which accounts each workspace shows, so the
            // SPA no longer keeps its own copy of the clinical/academic split.
            'roles' => Role::query()->orderBy('label')->get()->map(fn (Role $role) => [
                'key' => $role->role_key,
                'label' => $role->label,
                'workspace' => $role->workspace,
            ])->values(),
            // Hydrated template definitions (incl. metadata.presentation + per-field
            // metadata/active) so the SPA can render and edit from the DB. The static
            // config remains the runtime floor; this overlays edits on top.
            'templates' => $templates->map(fn (ReportTemplate $template) => $this->serializeTemplate($template))->values(),
            'profiles' => $profiles->map(fn (User $profile) => $this->profile($profile))->values(),
            'assignments' => $assignments->map(fn (ReportAssignment $assignment) => [
                'id' => $assignment->id,
                'nurseId' => $assignment->nurse_id,
                'departmentId' => $assignment->department?->slug ?? $assignment->department_id,
                'templateId' => $assignment->template?->slug ?? $assignment->template_id,
                'approvedAt' => $assignment->approved_at?->toJSON(),
                'active' => (bool) $assignment->active,
            ])->values(),
            'accessRequests' => $accessRequests->map(fn (AccessRequest $accessRequest) => [
                'id' => $accessRequest->id,
                'userId' => $accessRequest->user_id,
                'userName' => $accessRequest->user?->full_name ?? $accessRequest->email,
                'email' => $accessRequest->email,
                'requestedAssignments' => $accessRequest->items->map(fn ($item) => [
                    'departmentId' => $item->department?->slug ?? $item->department_id,
                    'templateId' => $item->template?->slug ?? $item->template_id,
                ])->values(),
                'status' => $accessRequest->status,
                'requestedAt' => $accessRequest->requested_at?->toJSON(),
                'reviewedAt' => $accessRequest->reviewed_at?->toJSON(),
                'notes' => $accessRequest->notes,
            ])->values(),
            'reportingPeriods' => $periods->map(fn (ReportingPeriod $period) => [
                'id' => $period->id,
                'weekStart' => $period->week_start?->startOfDay()->toJSON(),
                'weekEnd' => $period->week_end?->startOfDay()->toJSON(),
                'deadlineAt' => $period->deadline_at?->toJSON(),
                'label' => $this->periodLabel($period),
            ])->values(),
            'reports' => [],
            'statusHistory' => [],
            'auditLogs' => [],
            'notifications' => $notifications->map(fn ($notification) => [
                'id' => $notification->id,
                'userId' => $notification->recipient_id,
                'type' => $notification->type,
                'title' => $notification->title,
                'message' => $notification->message,
                'createdAt' => $notification->created_at?->toJSON(),
                'readAt' => $notification->read_at?->toJSON(),
                'relatedRoute' => $notification->related_route ?? '/',
                'relatedReportId' => $notification->related_id,
            ])->values(),
            'settings' => app(AppSettingsService::class)->structured(),
            'pendingDrafts' => [],
        ];

        return response()->json([
            'revision' => $this->workspaceRevision->for($user),
            'revisionToken' => $this->workspaceRevisionToken->issue($user),
            'currentUser' => $this->profile($user),
            'academic' => $this->academicPayload($user, $isAdmin),
            'references' => [
                'departmentDbIdBySlug' => $departments->pluck('id', 'slug'),
                'templateDbIdBySlug' => $templates->pluck('id', 'slug'),
                'templateDbIdByDepartmentSlug' => $departments->mapWithKeys(fn (Department $department) => [
                    $department->slug => $department->template_id,
                ]),
                'departmentSlugById' => $departmentSlugById,
                'templateSlugById' => $templateSlugById,
            ],
            'state' => $state,
        ]);
    }

    /**
     * The academic slice of the bootstrap (V2 guide 3.7). Kept to a handful of
     * cheap indexed lookups: no per-row payload growth. Keys for later phases
     * (isMorningRecorder, repScope, pendingTransferCount) ship with their
     * defaults until those modules exist.
     */
    private function academicPayload(User $user, bool $isAdmin): array
    {
        $isAcademicRole = in_array($user->role_key, ['resident', 'consultant'], true);

        $currentPlacement = null;

        if ($isAcademicRole) {
            $assignment = app(RosterService::class)->assignmentFor($user, now());

            if ($assignment !== null) {
                $currentPlacement = [
                    'dutyTypeName' => $assignment->dutyType?->name,
                    'wardId' => $assignment->dutyType?->ward_id,
                    'wardName' => $assignment->dutyType?->ward?->name,
                    'endsOn' => $assignment->ends_on?->toDateString(),
                ];
            }
        }

        $headsSections = $user->role_key === 'consultant'
            ? Section::query()->where('head_user_id', $user->id)->pluck('id')->values()->all()
            : [];

        $pendingTransferCount = 0;

        if ($isAdmin) {
            $pendingTransferCount = TransferRequest::query()->where('status', 'pending')->count();
        } elseif ($headsSections !== []) {
            $pendingTransferCount = TransferRequest::query()
                ->where('status', 'pending')
                ->whereIn('to_section_id', $headsSections)
                ->count();
        }

        $academicSetup = null;

        if ($isAdmin) {
            $today = HospitalClock::today()->toDateString();
            $todayDate = HospitalClock::today();
            $tomorrow = $todayDate->addDay()->toDateString();

            $coveredYears = RotationCalendar::query()
                ->where('active', true)
                ->whereHas('blocks', fn ($query) => $query
                    ->where('starts_on', '<', $tomorrow)
                    ->where('ends_on', '>=', $today))
                ->distinct()
                ->pluck('training_year');

            $currentBlocks = RotationBlock::query()
                ->with('calendar')
                ->whereHas('calendar', fn ($query) => $query->where('active', true))
                ->where('starts_on', '<', $tomorrow)
                ->where('ends_on', '>=', $today)
                ->get();
            $currentResidents = User::query()
                ->where('role_key', 'resident')
                ->where('active', true)
                ->whereIn('training_year', $currentBlocks->pluck('calendar.training_year')->filter()->unique())
                ->get();
            $assignmentEndsBefore = CarbonImmutable::parse($currentBlocks->max('ends_on') ?? $today)
                ->addDay()
                ->toDateString();
            $assignmentStartsOnOrAfter = CarbonImmutable::parse($currentBlocks->min('starts_on') ?? $today)
                ->toDateString();
            $currentAssignments = DutyAssignment::query()
                ->with('dutyType')
                ->whereIn('user_id', $currentResidents->pluck('id'))
                ->where('starts_on', '<', $assignmentEndsBefore)
                ->where('ends_on', '>=', $assignmentStartsOnOrAfter)
                ->whereHas('dutyType', fn ($query) => $query->where('granularity', 'monthly'))
                ->get();
            $planStateService = app(RotationPlanStateService::class);
            $mixedRotationCells = 0;
            $rotationCellsNeedingReview = 0;
            $residentsByTrainingYear = $currentResidents->groupBy('training_year');
            $assignmentsByUser = $currentAssignments->groupBy('user_id');

            foreach ($currentBlocks as $block) {
                foreach ($residentsByTrainingYear->get($block->calendar?->training_year, collect()) as $resident) {
                    $state = $planStateService->cell(
                        $assignmentsByUser->get($resident->id, collect()),
                        $block,
                        $resident->id,
                    );
                    $mixedRotationCells += $state['status'] === 'mixed' ? 1 : 0;
                    $rotationCellsNeedingReview += $state['status'] !== 'empty'
                        && $state['requiresOverwriteConfirmation'] ? 1 : 0;
                }
            }

            $academicSetup = [
                'calendarsMissing' => $coveredYears->count() < 3,
                'consultantsWithoutSection' => User::query()
                    ->where('role_key', 'consultant')
                    ->where('active', true)
                    ->whereNull('section_id')
                    ->count(),
                'peopleWithoutAssignment' => User::query()
                    ->whereIn('role_key', ['resident', 'consultant'])
                    ->where('active', true)
                    ->whereDoesntHave('dutyAssignments', fn ($query) => $query
                        ->where('starts_on', '<', $tomorrow)
                        ->where('ends_on', '>=', $today)
                        ->whereHas('dutyType', fn ($typeQuery) => $typeQuery->where('granularity', 'monthly')))
                    ->count(),
                'mixedRotationCells' => $mixedRotationCells,
                'rotationCellsNeedingReview' => $rotationCellsNeedingReview,
                'activeRotationOverrides' => DutyAssignment::query()
                    ->covering($todayDate)
                    ->where('source', 'admin')
                    ->where('note', 'like', RosterService::ROTATION_OVERRIDE_NOTE_PREFIX.'%')
                    ->count(),
            ];
        }

        $repScope = null;

        if ($user->role_key === 'student_rep') {
            $assignment = RepAssignment::query()
                ->with('batch')
                ->where('user_id', $user->id)
                ->where('active', true)
                ->whereHas('batch', fn ($query) => $query->where('active', true))
                ->first();

            if ($assignment !== null) {
                $repScope = [
                    'batchId' => $assignment->batch_id,
                    'cohort' => $assignment->batch?->cohort,
                    'scope' => $assignment->scope,
                ];
            }
        }

        return [
            'currentPlacement' => $currentPlacement,
            'isMorningRecorder' => app(MorningSessionService::class)->isRecorder($user),
            'headsSections' => $headsSections,
            'repScope' => $repScope,
            'pendingTransferCount' => $pendingTransferCount,
            'academicSetup' => $academicSetup,
        ];
    }

    private function booleanOption(array $validated, string $snakeKey, string $camelKey): bool
    {
        return (bool) ($validated[$snakeKey] ?? $validated[$camelKey] ?? false);
    }

    private function profile(User $user): array
    {
        return [
            'id' => $user->id,
            'fullName' => $user->full_name,
            'email' => $user->email,
            'username' => $user->username,
            'role' => $user->role_key,
            'title' => $user->title ?? RoleTitles::default($user->role_key),
            'active' => (bool) $user->active,
            'sectionId' => $user->section_id,
            'phone' => $user->phone,
            'passwordChangeRequired' => (bool) $user->password_change_required,
        ];
    }

    private function periodLabel(ReportingPeriod $period): string
    {
        return sprintf(
            '%s - %s',
            $period->week_start?->format('M j'),
            $period->week_end?->format('M j, Y'),
        );
    }
}
