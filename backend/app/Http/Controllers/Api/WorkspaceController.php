<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Api\Concerns\SerializesAdminResources;
use App\Http\Controllers\Controller;
use App\Models\AccessRequest;
use App\Models\AuditLog;
use App\Models\Department;
use App\Models\Report;
use App\Models\ReportAssignment;
use App\Models\ReportingPeriod;
use App\Models\ReportStatusHistory;
use App\Models\RepAssignment;
use App\Models\ReportTemplate;
use App\Models\RotationCalendar;
use App\Models\Section;
use App\Models\TransferRequest;
use App\Models\User;
use App\Services\Academic\MorningSessionService;
use App\Services\Academic\RosterService;
use App\Services\Admin\AppSettingsService;
use App\Support\Authorization\Permissions;
use App\Support\Reports\ReportPeriodWindow;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class WorkspaceController extends Controller
{
    use SerializesAdminResources;

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
        $includeProfiles = $this->booleanOption($validated, 'include_profiles', 'includeProfiles');
        $includeAccessRequests = $this->booleanOption($validated, 'include_access_requests', 'includeAccessRequests');
        $includeHistory = $this->booleanOption($validated, 'include_history', 'includeHistory');
        $reportPeriodWindow = $this->stringOption($validated, 'report_period_window', 'reportPeriodWindow', ReportPeriodWindow::DEFAULT_WINDOW);

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
        $periods = ReportingPeriod::query()->orderBy('week_start')->get();
        $visiblePeriodIds = ReportPeriodWindow::ids($periods, $reportPeriodWindow);

        $profiles = $includeProfiles && $isAdmin
            ? User::query()->orderBy('full_name')->get()
            : collect([$user]);

        $assignments = ReportAssignment::query()
            ->with(['department', 'template'])
            ->when(! $isAdmin, fn (Builder $query) => $query
                ->where('nurse_id', $user->id)
                ->where('active', true))
            ->latest('approved_at')
            ->get();

        $reports = Report::query()
            ->with(['department', 'template', 'calculatedMetric'])
            ->when(! empty($visiblePeriodIds), fn (Builder $query) => $query->whereIn('reporting_period_id', $visiblePeriodIds))
            ->when(empty($visiblePeriodIds), fn (Builder $query) => $query->whereRaw('1 = 0'))
            ->when(! $isAdmin, fn (Builder $query) => $query->whereHas('assignment', fn (Builder $assignmentQuery) => $assignmentQuery
                ->where('nurse_id', $user->id)
                ->where('active', true)))
            ->latest('updated_at')
            // The period window already bounds this set; the limit is a memory
            // backstop so a pathological dataset can never overrun PHP's
            // memory_limit on shared hosting. Field values are loaded lazily
            // (values => {}) so each row here is lightweight.
            ->limit(10000)
            ->get();

        $reportIds = $reports->pluck('id')->all();

        $accessRequests = $includeAccessRequests
            ? AccessRequest::query()
                ->with(['user', 'reviewer', 'items.department', 'items.template'])
                ->when(! $isAdmin, fn (Builder $query) => $query->where('user_id', $user->id))
                ->latest('requested_at')
                ->get()
            : collect();

        $statusHistory = $includeHistory && ! empty($reportIds)
            ? ReportStatusHistory::query()
                ->with('changedBy')
                ->whereIn('report_id', $reportIds)
                ->latest('changed_at')
                ->get()
            : collect();

        $auditLogs = $includeHistory && $isAdmin && ! empty($reportIds)
            ? AuditLog::query()
                ->with(['fieldDefinition', 'changedBy', 'department', 'template'])
                ->whereIn('report_id', $reportIds)
                ->latest('changed_at')
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
            'reports' => $reports->map(fn (Report $report) => [
                'id' => $report->id,
                'assignmentId' => $report->assignment_id,
                'departmentId' => $report->department?->slug ?? $report->department_id,
                'templateId' => $report->template?->slug ?? $report->template_id,
                'reportingPeriodId' => $report->reporting_period_id,
                'createdById' => $report->created_by,
                'updatedById' => $report->updated_by,
                'createdAt' => $report->created_at?->toJSON(),
                'updatedAt' => $report->updated_at?->toJSON(),
                'submittedAt' => $report->submitted_at?->toJSON(),
                'lockedAt' => $report->locked_at?->toJSON(),
                'status' => $report->status,
                'values' => (object) [],
                'calculatedMetrics' => [
                    'borPercent' => $this->nullableFloat($report->calculatedMetric?->bor_percent),
                    'btr' => $this->nullableFloat($report->calculatedMetric?->btr),
                    'alos' => $this->nullableFloat($report->calculatedMetric?->alos),
                ],
            ])->values(),
            'statusHistory' => $statusHistory->map(fn (ReportStatusHistory $history) => [
                'id' => $history->id,
                'reportId' => $history->report_id,
                'status' => $history->status,
                'changedById' => $history->changed_by,
                'changedByName' => $history->changed_by_name ?? $history->changedBy?->full_name ?? 'Unknown user',
                'changedAt' => $history->changed_at?->toJSON(),
                'note' => $history->note,
            ])->values(),
            'auditLogs' => $auditLogs->map(fn (AuditLog $auditLog) => [
                'id' => $auditLog->id,
                'reportId' => $auditLog->report_id,
                'fieldId' => $auditLog->day_name ? "{$auditLog->field_key}.{$auditLog->day_name}" : $auditLog->field_key,
                'fieldLabel' => ($auditLog->fieldDefinition?->label ?? $auditLog->field_key).($auditLog->day_name ? " ({$auditLog->day_name})" : ''),
                'oldValue' => $auditLog->old_value,
                'newValue' => $auditLog->new_value,
                'changedById' => $auditLog->changed_by,
                'changedByName' => $auditLog->changed_by_name ?? $auditLog->changedBy?->full_name ?? 'Unknown user',
                'changedAt' => $auditLog->changed_at?->toJSON(),
                'departmentId' => $auditLog->department?->slug ?? $auditLog->department_id,
                'templateId' => $auditLog->template?->slug ?? $auditLog->template_id,
            ])->values(),
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
            'pendingDrafts' => $reports
                ->where('status', 'draft')
                ->map(fn (Report $report) => [
                    'reportId' => $report->id,
                    'assignmentId' => $report->assignment_id,
                    'reportingPeriodId' => $report->reporting_period_id,
                    'lastSavedAt' => $report->updated_at?->toJSON(),
                ])
                ->sortByDesc('lastSavedAt')
                ->values(),
        ];

        return response()->json([
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
            $today = now()->toDateString();

            $coveredYears = RotationCalendar::query()
                ->where('active', true)
                ->whereHas('blocks', fn ($query) => $query
                    ->whereDate('starts_on', '<=', $today)
                    ->whereDate('ends_on', '>=', $today))
                ->distinct()
                ->pluck('training_year');

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
                        ->whereDate('starts_on', '<=', $today)
                        ->whereDate('ends_on', '>=', $today))
                    ->count(),
            ];
        }

        $repScope = null;

        if ($user->role_key === 'student_rep') {
            $assignment = RepAssignment::query()
                ->with('batch')
                ->where('user_id', $user->id)
                ->where('active', true)
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

    private function stringOption(array $validated, string $snakeKey, string $camelKey, string $default): string
    {
        return (string) ($validated[$snakeKey] ?? $validated[$camelKey] ?? $default);
    }

    private function profile(User $user): array
    {
        return [
            'id' => $user->id,
            'fullName' => $user->full_name,
            'email' => $user->email,
            'username' => $user->username,
            'role' => $user->role_key,
            'title' => $user->title ?? $this->defaultTitle($user->role_key),
            'active' => (bool) $user->active,
            'phone' => $user->phone,
            'passwordChangeRequired' => (bool) $user->password_change_required,
        ];
    }

    private function defaultTitle(string $roleKey): string
    {
        return match ($roleKey) {
            'superadmin' => 'Maintenance',
            'admin' => 'Administrator',
            default => 'Nurse',
        };
    }

    private function periodLabel(ReportingPeriod $period): string
    {
        return sprintf(
            '%s - %s',
            $period->week_start?->format('M j'),
            $period->week_end?->format('M j, Y'),
        );
    }

    private function nullableFloat(mixed $value): ?float
    {
        return $value === null ? null : (float) $value;
    }
}
