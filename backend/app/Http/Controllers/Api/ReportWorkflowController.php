<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Report;
use App\Models\ReportAssignment;
use App\Models\ReportingPeriod;
use App\Models\ReportStatusHistory;
use App\Services\Reports\ReportLockingService;
use App\Services\Reports\ReportQualityService;
use App\Services\Reports\ReportSubmissionService;
use App\Support\Authorization\Permissions;
use App\Support\Reports\ReportPeriodWindow;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

class ReportWorkflowController extends Controller
{
    public function __construct(
        private readonly ReportSubmissionService $submissionService,
        private readonly ReportLockingService $lockingService,
        private readonly ReportQualityService $qualityService,
    ) {}

    public function index(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'assignment_id' => ['sometimes', 'uuid'],
            'assignmentId' => ['sometimes', 'uuid'],
            'reporting_period_id' => ['sometimes', 'uuid'],
            'reportingPeriodId' => ['sometimes', 'uuid'],
            'report_period_window' => ['sometimes', 'string', 'in:default,all'],
            'reportPeriodWindow' => ['sometimes', 'string', 'in:default,all'],
            'period_ids' => ['sometimes', 'string'],
            'periodIds' => ['sometimes', 'string'],
            'page' => ['sometimes', 'integer', 'min:1'],
            'per_page' => ['sometimes', 'integer', 'min:1', 'max:100'],
            'perPage' => ['sometimes', 'integer', 'min:1', 'max:100'],
        ]);
        $user = $request->user();
        $assignmentId = $validated['assignment_id'] ?? $validated['assignmentId'] ?? null;
        $reportingPeriodId = $validated['reporting_period_id'] ?? $validated['reportingPeriodId'] ?? null;
        $reportPeriodWindow = $validated['report_period_window'] ?? $validated['reportPeriodWindow'] ?? ReportPeriodWindow::DEFAULT_WINDOW;
        $periodIds = $this->validatedIds(
            $validated['period_ids'] ?? $validated['periodIds'] ?? null,
            maximum: 26,
            field: 'periodIds',
        );
        $perPage = (int) ($validated['per_page'] ?? $validated['perPage'] ?? 100);

        // The index is intentionally summary-only. Values, definitions, quality
        // analysis, and metrics are loaded through show()/details() for reports
        // the UI actually opens, avoiding a 100-report hydration spike.
        $query = Report::query()
            ->with(['department:id,slug,name', 'template:id,slug,name'])
            ->latest('updated_at');

        if (! Permissions::isAdminRole($user->role_key)) {
            $query->whereHas('assignment', fn ($assignmentQuery) => $assignmentQuery
                ->where('nurse_id', $user->id)
                ->where('active', true));
        }

        if ($assignmentId !== null) {
            $query->where('assignment_id', $assignmentId);
        }

        if ($reportingPeriodId !== null) {
            $query->where('reporting_period_id', $reportingPeriodId);
        } elseif ($periodIds !== []) {
            $query->whereIn('reporting_period_id', $periodIds);
        } else {
            $periodIds = ReportPeriodWindow::ids(
                ReportingPeriod::query()->orderBy('week_start')->get(),
                $reportPeriodWindow,
            );

            $query->when(! empty($periodIds), fn ($reportQuery) => $reportQuery->whereIn('reporting_period_id', $periodIds))
                ->when(empty($periodIds), fn ($reportQuery) => $reportQuery->whereRaw('1 = 0'));
        }

        $reports = $query->paginate($perPage);

        return response()->json([
            'data' => $reports->getCollection()->map(fn (Report $report) => $this->serializeReportSummary($report))->values(),
            'meta' => [
                'currentPage' => $reports->currentPage(),
                'lastPage' => $reports->lastPage(),
                'perPage' => $reports->perPage(),
                'total' => $reports->total(),
            ],
        ]);
    }

    public function periods(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'page' => ['sometimes', 'integer', 'min:1'],
            'per_page' => ['sometimes', 'integer', 'min:1', 'max:100'],
            'perPage' => ['sometimes', 'integer', 'min:1', 'max:100'],
        ]);
        $periods = ReportingPeriod::query()
            ->orderByDesc('week_start')
            ->paginate((int) ($validated['per_page'] ?? $validated['perPage'] ?? 26));

        return response()->json([
            'data' => $periods->getCollection()
                ->map(fn (ReportingPeriod $period) => [
                    'id' => $period->id,
                    'weekStart' => $period->week_start?->startOfDay()->toJSON(),
                    'weekEnd' => $period->week_end?->startOfDay()->toJSON(),
                    'deadlineAt' => $period->deadline_at?->toJSON(),
                    'label' => sprintf(
                        '%s - %s',
                        $period->week_start?->format('M j'),
                        $period->week_end?->format('M j, Y'),
                    ),
                ])
                ->values(),
            'meta' => [
                'currentPage' => $periods->currentPage(),
                'lastPage' => $periods->lastPage(),
                'perPage' => $periods->perPage(),
                'total' => $periods->total(),
            ],
        ]);
    }

    public function statusHistory(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'page' => ['sometimes', 'integer', 'min:1'],
            'per_page' => ['sometimes', 'integer', 'min:1', 'max:100'],
            'perPage' => ['sometimes', 'integer', 'min:1', 'max:100'],
        ]);
        $user = $request->user();
        $query = ReportStatusHistory::query()
            ->with(['changedBy', 'report.department', 'report.template'])
            ->when(! Permissions::isAdminRole($user->role_key), fn ($historyQuery) => $historyQuery
                ->whereHas('report.assignment', fn ($assignmentQuery) => $assignmentQuery
                    ->where('nurse_id', $user->id)
                    ->where('active', true)))
            ->latest('changed_at');
        $history = $query->paginate((int) ($validated['per_page'] ?? $validated['perPage'] ?? 100));
        $reports = $history->getCollection()
            ->pluck('report')
            ->filter()
            ->unique('id')
            ->values();

        return response()->json([
            'data' => $history->getCollection()
                ->map(fn (ReportStatusHistory $entry) => [
                    'id' => $entry->id,
                    'reportId' => $entry->report_id,
                    'status' => $entry->status,
                    'changedById' => $entry->changed_by,
                    'changedByName' => $entry->changed_by_name ?? $entry->changedBy?->full_name ?? 'Unknown user',
                    'changedAt' => $entry->changed_at?->toJSON(),
                    'note' => $entry->note,
                ])
                ->values(),
            'reports' => $reports
                ->map(fn (Report $report) => $this->serializeReportSummary($report))
                ->values(),
            'meta' => [
                'currentPage' => $history->currentPage(),
                'lastPage' => $history->lastPage(),
                'perPage' => $history->perPage(),
                'total' => $history->total(),
            ],
        ]);
    }

    public function show(Request $request, Report $report): JsonResponse
    {
        Gate::authorize('view', $report);

        return response()->json($this->serializeReport($this->loadReport($report), withTrends: true));
    }

    public function details(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'ids' => ['required', 'string'],
        ]);

        $ids = collect(explode(',', (string) $validated['ids']))
            ->map(fn (string $id): string => trim($id))
            ->filter()
            ->unique()
            ->values();

        if ($ids->isEmpty()) {
            throw ValidationException::withMessages([
                'ids' => 'At least one report id is required.',
            ]);
        }

        if ($ids->count() > 100) {
            throw ValidationException::withMessages([
                'ids' => 'A maximum of 100 report ids may be requested at once.',
            ]);
        }

        $invalidId = $ids->first(fn (string $id): bool => ! Str::isUuid($id));
        if ($invalidId !== null) {
            throw ValidationException::withMessages([
                'ids' => 'Every report id must be a valid UUID.',
            ]);
        }

        $reportsById = Report::query()
            ->with(['assignment.department', 'assignment.template', 'department', 'template.fieldDefinitions', 'reportingPeriod', 'fieldValues.fieldDefinition', 'calculatedMetric'])
            ->whereIn('id', $ids->all())
            ->get()
            ->keyBy('id');

        if ($reportsById->count() !== $ids->count()) {
            abort(404, 'One or more reports could not be found.');
        }

        $data = $ids
            ->map(function (string $id) use ($reportsById): array {
                $report = $reportsById->get($id);

                Gate::authorize('view', $report);

                return $this->serializeReport($report);
            })
            ->values();

        return response()->json(['data' => $data]);
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

        return response()->json($this->serializeReport($report, withTrends: true), 201);
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

        return response()->json($this->serializeReport($savedReport, withTrends: true));
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

        return response()->json($this->serializeReport($savedReport, withTrends: true));
    }

    public function lock(Request $request, Report $report): JsonResponse
    {
        Gate::authorize('lock', $report);

        $lockedReport = $this->lockingService->setLockState($request->user(), $report, true);

        return response()->json($this->serializeReport($this->loadReport($lockedReport), withTrends: true));
    }

    public function unlock(Request $request, Report $report): JsonResponse
    {
        Gate::authorize('unlock', $report);

        $unlockedReport = $this->lockingService->setLockState($request->user(), $report, false);

        return response()->json($this->serializeReport($this->loadReport($unlockedReport), withTrends: true));
    }

    private function loadReport(Report $report): Report
    {
        return $report->loadMissing(['assignment.department', 'assignment.template', 'department', 'template.fieldDefinitions', 'reportingPeriod', 'fieldValues.fieldDefinition', 'calculatedMetric']);
    }

    /**
     * @return array<string, mixed>
     */
    private function serializeReportSummary(Report $report): array
    {
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
        ];
    }

    /**
     * @return list<string>
     */
    private function validatedIds(?string $value, int $maximum, string $field): array
    {
        if ($value === null || trim($value) === '') {
            return [];
        }

        $ids = collect(explode(',', $value))
            ->map(fn (string $id): string => trim($id))
            ->filter()
            ->unique()
            ->values();

        if ($ids->count() > $maximum || $ids->contains(fn (string $id): bool => ! Str::isUuid($id))) {
            throw ValidationException::withMessages([
                $field => ["Provide at most {$maximum} valid ids."],
            ]);
        }

        return $ids->all();
    }

    /**
     * @return array<string, mixed>
     */
    private function serializeReport(Report $report, bool $withTrends = false): array
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
            'quality' => $this->qualityService->analyze($report, $withTrends),
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
