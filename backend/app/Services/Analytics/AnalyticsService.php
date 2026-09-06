<?php

namespace App\Services\Analytics;

use App\Models\Department;
use App\Models\Report;
use App\Models\ReportAssignment;
use App\Models\ReportingPeriod;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

class AnalyticsService
{
    public const PROCEDURE_SERVICES = [
        [
            'id' => 'eeg_lab',
            'label' => 'EEG Lab',
            'departmentSlug' => 'eeg_lab',
            'metricLabel' => 'EEG done',
            'fieldKeys' => ['eeg_done'],
        ],
        [
            'id' => 'echocardiography_lab',
            'label' => 'Echocardiography Lab',
            'departmentSlug' => 'echocardiography_lab',
            'metricLabel' => 'Echo + ECG',
            'fieldKeys' => ['echo_done', 'ecg_done'],
        ],
        [
            'id' => 'endoscopy_lab',
            'label' => 'Endoscopy Lab',
            'departmentSlug' => 'endoscopy_lab',
            'metricLabel' => 'Endoscopy total',
            'fieldKeys' => [
                'upper_gi_elective',
                'upper_gi_emergency',
                'ercp',
                'colonoscopy',
                'proctoscopy',
                'bronchoscopy',
                'therapeutic_upper_gi',
                'esophageal_dilation',
                'variceal_ligation',
                'stenting',
                'liver_biopsy',
            ],
        ],
        [
            'id' => 'hematology_procedures',
            'label' => 'Hematology Procedures',
            'departmentSlug' => 'hematology_procedures',
            'metricLabel' => 'Bone marrow biopsy',
            'fieldKeys' => ['bone_marrow_biopsy'],
        ],
        [
            'id' => 'bronchoscopy_lab',
            'label' => 'Bronchoscopy Lab',
            'departmentSlug' => 'bronchoscopy_lab',
            'metricLabel' => 'Bronchoscopy done',
            'fieldKeys' => ['bronchoscopy_done'],
        ],
        [
            'id' => 'renal_procedures',
            'label' => 'Renal Procedures',
            'departmentSlug' => 'renal_procedures',
            'metricLabel' => 'Renal procedure total',
            'fieldKeys' => ['elective_renal_biopsy', 'central_venous_catheter_insertion'],
        ],
        [
            'id' => 'dialysis_unit',
            'label' => 'Dialysis',
            'departmentSlug' => 'dialysis_unit',
            'metricLabel' => 'Acute + chronic HD',
            'fieldKeys' => ['dialysis_acute', 'dialysis_chronic'],
        ],
    ];

    /** Report ids per aggregate query, kept well inside SQLite's bound-parameter limit. */
    private const PRIME_CHUNK_SIZE = 400;

    private const WEEKDAY_ORDER = [
        'monday' => 0,
        'tuesday' => 1,
        'wednesday' => 2,
        'thursday' => 3,
        'friday' => 4,
        'saturday' => 5,
        'sunday' => 6,
    ];

    private const INPATIENT_CHART_METRICS = [
        'newAdmissions' => ['new_admitted_patients'],
        'discharges' => ['discharged_home', 'discharged_ama'],
        'deaths' => ['new_deaths'],
        'ulcers' => ['new_pressure_ulcer'],
        'hai' => ['total_hai'],
    ];

    private const OUTPATIENT_CHART_METRICS = [
        ['key' => 'seen', 'fieldKey' => 'total_patients_seen', 'valueType' => 'sum'],
        ['key' => 'notSeenSameDay', 'fieldKey' => 'not_seen_same_day', 'valueType' => 'sum'],
        ['key' => 'totalSeen', 'fieldKey' => 'total_patients_seen', 'valueType' => 'sum'],
        ['key' => 'newPatients', 'fieldKey' => 'new_patients_seen', 'valueType' => 'sum'],
        ['key' => 'followUp', 'fieldKey' => 'follow_up_patients', 'valueType' => 'sum'],
        ['key' => 'wait', 'fieldKey' => 'wait_time_followup_months', 'valueType' => 'average'],
        ['key' => 'startMinutes', 'fieldKey' => 'clinic_start_time', 'valueType' => 'timeAverage'],
    ];

    private const PROCEDURE_DIALYSIS_MIX = [
        ['key' => 'acuteHd', 'label' => 'Acute HD', 'fieldKeys' => ['dialysis_acute']],
        ['key' => 'chronicHd', 'label' => 'Chronic HD', 'fieldKeys' => ['dialysis_chronic']],
    ];

    private const PROCEDURE_ENDOSCOPY_MIX = [
        ['key' => 'ugi', 'label' => 'UGI', 'fieldKeys' => ['upper_gi_elective', 'upper_gi_emergency']],
        ['key' => 'ercp', 'label' => 'ERCP', 'fieldKeys' => ['ercp']],
        ['key' => 'colonoscopy', 'label' => 'Colonoscopy', 'fieldKeys' => ['colonoscopy']],
        ['key' => 'bronchoscopy', 'label' => 'Bronchoscopy', 'fieldKeys' => ['bronchoscopy']],
        ['key' => 'ligation', 'label' => 'Ligation', 'fieldKeys' => ['variceal_ligation']],
    ];

    /**
     * Request-scoped memo for reports(). A single analytics endpoint funnels
     * through one AnalyticsService instance and re-runs the identical report
     * query 3-6 times (overview/familySummary -> summary + weekly + monthly +
     * departments). Caching by (filters, family) collapses those to one query
     * and one hydration. The instance lives only for the request, so there is
     * no cross-request staleness, and every consumer uses non-mutating
     * collection operations, so sharing the instance is safe.
     *
     * @var array<string, Collection<int, Report>>
     */
    private array $reportsMemo = [];

    /**
     * Request-scoped memos for the two helper queries that summary() re-runs for
     * every weekly/monthly/department bucket across all families. Keyed by the
     * filter dimensions each one actually reads, so a full dashboard build issues
     * a handful of Department/ReportAssignment queries instead of hundreds.
     *
     * @var array<string, Collection<int, Department>>
     */
    private array $scopedDepartmentsMemo = [];

    /** @var array<string, int> */
    private array $assignmentCountMemo = [];

    /**
     * Numeric field totals indexed once per report. Dashboard generation asks
     * for the same fields across the overview, family, week, month, and
     * department summaries; rescanning every hydrated field value for each
     * metric made cold requests grow into tens of seconds.
     *
     * @var array<string, array<string, float>>
     */
    private array $reportFieldSumsMemo = [];

    /** @var array<string, array<string, mixed>> */
    private array $weeklyFieldValueMemo = [];

    /**
     * Report ids whose field aggregates have been fetched. Distinct from the two
     * memos above because an empty entry is a real answer ("this report has no
     * analytics values"), not a cache miss to be recomputed.
     *
     * @var array<string, true>
     */
    private array $primedReports = [];

    public function flushMemo(): void
    {
        $this->reportsMemo = [];
        $this->scopedDepartmentsMemo = [];
        $this->assignmentCountMemo = [];
        $this->reportFieldSumsMemo = [];
        $this->weeklyFieldValueMemo = [];
        $this->primedReports = [];
    }

    /**
     * @return array<string, mixed>
     */
    public function overview(AnalyticsFilters $filters, ?Collection $reports = null): array
    {
        $reports ??= $this->reports($filters);
        $periods = $this->periodsForReports($reports, $filters);

        return [
            'scope' => $this->scope($filters),
            'summary' => $this->summary($reports, $periods, $filters),
            'weekly' => $this->weekly($filters, reports: $reports),
            'monthly' => $this->monthly($filters, reports: $reports),
        ];
    }

    /**
     * Dashboard-specific overview shape. The SPA consumes the aggregate summary
     * here and the family weekly rows below; returning a second overview weekly
     * series plus monthly rollups duplicated CPU and payload on every cold load.
     *
     * @return array<string, mixed>
     */
    public function dashboardOverview(AnalyticsFilters $filters, Collection $reports): array
    {
        return [
            'scope' => $this->scope($filters),
            'summary' => $this->summary(
                $reports,
                $this->periodsForReports($reports, $filters),
                $filters,
            ),
            'weekly' => [],
            'monthly' => [],
        ];
    }

    /**
     * @return array<string, mixed>
     */
    public function familySummary(
        string $family,
        AnalyticsFilters $filters,
        ?Collection $reports = null,
    ): array {
        $reports ??= $this->reports($filters, $family);
        $periods = $this->periodsForReports($reports, $filters);

        return [
            'scope' => $this->scope($filters, $family),
            'summary' => $this->summary($reports, $periods, $filters, $family),
            'departments' => $this->departmentSummaries($filters, $family, $reports),
            'weekly' => $this->weekly($filters, $family, $reports),
            'monthly' => $this->monthly($filters, $family, $reports),
        ];
    }

    /**
     * Lean family shape for the combined dashboard endpoint. Detailed
     * department summaries and monthly rollups remain available from their
     * dedicated endpoints, while dashboard charts use the weekly rows (which
     * already include per-department chart metrics).
     *
     * @return array<string, mixed>
     */
    public function dashboardFamilySummary(
        string $family,
        AnalyticsFilters $filters,
        Collection $reports,
    ): array {
        return [
            'scope' => $this->scope($filters, $family),
            'summary' => $this->summary(
                $reports,
                $this->periodsForReports($reports, $filters),
                $filters,
                $family,
            ),
            'departments' => [],
            'weekly' => $this->weekly($filters, $family, $reports),
            'monthly' => [],
        ];
    }

    /**
     * @return list<array<string, mixed>>
     */
    public function weekly(
        AnalyticsFilters $filters,
        ?string $family = null,
        ?Collection $reports = null,
    ): array {
        $reports ??= $this->reports($filters, $family);

        return $reports
            ->groupBy('reporting_period_id')
            ->map(function (Collection $bucket) use ($filters, $family): array {
                $period = $bucket->first()->reportingPeriod;
                // One pass for the whole bucket; the summary, the chart metrics
                // and the per-department breakdown all read from it.
                $aggregate = $this->aggregate($bucket);

                return [
                    'periodId' => $period->id,
                    'weekStart' => $period->week_start?->toDateString(),
                    'weekEnd' => $period->week_end?->toDateString(),
                    'label' => $period->week_start?->format('M j'),
                    'summary' => $this->summary($bucket, collect([$period]), $filters, $family, aggregate: $aggregate),
                    'chartMetrics' => $this->chartMetrics($aggregate, $family),
                    'departments' => $this->chartDepartmentMetrics($aggregate, $family),
                ];
            })
            ->sortBy('weekStart')
            ->values()
            ->all();
    }

    /**
     * @return list<array<string, mixed>>
     */
    public function monthly(
        AnalyticsFilters $filters,
        ?string $family = null,
        ?Collection $reports = null,
    ): array {
        $reports ??= $this->reports($filters, $family);

        return $reports
            ->groupBy(fn (Report $report) => $report->reportingPeriod->week_start?->format('Y-m'))
            ->filter(fn (Collection $bucket, ?string $monthKey) => $monthKey !== null && $bucket->isNotEmpty())
            ->map(function (Collection $bucket, string $monthKey) use ($filters, $family): array {
                $periods = $bucket->pluck('reportingPeriod')->unique('id')->values();

                return [
                    'month' => $monthKey,
                    'label' => $periods->first()?->week_start?->format('M Y'),
                    'summary' => $this->summary($bucket, $periods, $filters, $family),
                ];
            })
            ->sortBy('month')
            ->values()
            ->all();
    }

    /**
     * @return list<array<string, mixed>>
     */
    public function quarterly(AnalyticsFilters $filters, ?string $family = null): array
    {
        $reports = $this->reports($filters, $family);

        return $this->rollupPeriods($reports, $filters)
            ->groupBy(fn (ReportingPeriod $period): string => sprintf(
                '%d-Q%d',
                $period->year_num ?? (int) $period->week_start?->year,
                $period->week_start?->quarter ?? 0,
            ))
            ->map(function (Collection $periods, string $key) use ($reports, $filters, $family): array {
                $periods = $periods->sortBy('week_start')->values();
                $periodIds = $periods->pluck('id')->all();
                $bucketReports = $reports
                    ->filter(fn (Report $report): bool => in_array($report->reporting_period_id, $periodIds, true))
                    ->values();
                $firstPeriod = $periods->first();
                $quarter = (int) ($firstPeriod?->week_start?->quarter ?? 0);
                $year = (int) ($firstPeriod?->year_num ?? $firstPeriod?->week_start?->year ?? 0);

                return [
                    'key' => $key,
                    'quarter' => $quarter > 0 ? sprintf('Q%d', $quarter) : null,
                    'quarterLabel' => $firstPeriod?->quarter_label ?? ($quarter > 0 && $year > 0 ? sprintf('Q%d %d', $quarter, $year) : $key),
                    'year' => $year,
                    'weekStart' => $periods->first()?->week_start?->toDateString(),
                    'weekEnd' => $periods->last()?->week_end?->toDateString(),
                    'periodIds' => $periodIds,
                    'periodCount' => $periods->count(),
                    'summary' => $this->summary($bucketReports, $periods, $filters, $family),
                ];
            })
            ->sortBy('key')
            ->values()
            ->all();
    }

    /**
     * @return list<array<string, mixed>>
     */
    public function yearly(AnalyticsFilters $filters, ?string $family = null): array
    {
        $reports = $this->reports($filters, $family);

        return $this->rollupPeriods($reports, $filters)
            ->groupBy(fn (ReportingPeriod $period): int => $period->year_num ?? (int) $period->week_start?->year)
            ->map(function (Collection $periods, int|string $year) use ($reports, $filters, $family): array {
                $periods = $periods->sortBy('week_start')->values();
                $periodIds = $periods->pluck('id')->all();
                $bucketReports = $reports
                    ->filter(fn (Report $report): bool => in_array($report->reporting_period_id, $periodIds, true))
                    ->values();

                return [
                    'year' => (int) $year,
                    'label' => (string) $year,
                    'weekStart' => $periods->first()?->week_start?->toDateString(),
                    'weekEnd' => $periods->last()?->week_end?->toDateString(),
                    'periodIds' => $periodIds,
                    'periodCount' => $periods->count(),
                    'summary' => $this->summary($bucketReports, $periods, $filters, $family),
                ];
            })
            ->sortBy('year')
            ->values()
            ->all();
    }

    /**
     * @return list<array<string, mixed>>
     */
    public function departmentSummaries(
        AnalyticsFilters $filters,
        ?string $family = null,
        ?Collection $reports = null,
    ): array {
        $reports ??= $this->reports($filters, $family);
        $departmentIds = $reports->pluck('department_id')->filter()->unique()->values();
        $activeAssignmentCounts = $departmentIds->isEmpty()
            ? collect()
            : ReportAssignment::query()
                ->where('active', true)
                ->whereIn('department_id', $departmentIds->all())
                ->selectRaw('department_id, COUNT(*) as aggregate')
                ->groupBy('department_id')
                ->pluck('aggregate', 'department_id');

        return $reports
            ->groupBy('department_id')
            ->map(function (Collection $bucket) use ($activeAssignmentCounts, $filters): array {
                $department = $bucket->first()->department;
                $departmentFilters = $department
                    ? $filters->withDepartment($department->slug)
                    : $filters;
                $periods = $bucket->pluck('reportingPeriod')->unique('id')->values();
                $expectedReports = (int) $activeAssignmentCounts->get(
                    $bucket->first()->department_id,
                    0,
                ) * $periods->count();

                return [
                    'departmentId' => $bucket->first()->department_id,
                    'departmentSlug' => $department?->slug,
                    'departmentName' => $department?->name,
                    'family' => $department?->family,
                    'summary' => $this->summary(
                        $bucket,
                        $periods,
                        $departmentFilters,
                        $department?->family,
                        $department ? collect([$department]) : collect(),
                        $expectedReports,
                    ),
                ];
            })
            ->sortBy('departmentName')
            ->values()
            ->all();
    }

    /**
     * @return Collection<int, Report>
     */
    public function reports(AnalyticsFilters $filters, ?string $family = null): Collection
    {
        $memoKey = $this->reportsMemoKey($filters, $family);

        if (isset($this->reportsMemo[$memoKey])) {
            return $this->reportsMemo[$memoKey];
        }

        // Field values are deliberately NOT eager loaded. Every graph reads them
        // through reportFieldSums()/weeklyFieldValue(), both of which are served
        // from aggregates computed in SQL by primeFieldAggregates() below.
        $query = Report::query()
            ->select([
                'id',
                'assignment_id',
                'department_id',
                'template_id',
                'reporting_period_id',
                'status',
            ])
            ->with([
                'department:id,slug,name,family,bed_count,active',
                'reportingPeriod:id,week_start,week_end,month_label,quarter_label,year_num',
            ])
            ->whereHas('department', function (Builder $departmentQuery) use ($filters, $family): void {
                $effectiveFamily = $this->effectiveFamily($filters, $family);

                if ($effectiveFamily) {
                    $departmentQuery->where('family', $effectiveFamily);
                }

                $departmentIdentifier = $filters->departmentFilter();

                if ($departmentIdentifier) {
                    $departmentQuery->where(function (Builder $query) use ($departmentIdentifier): void {
                        $query->where('id', $departmentIdentifier)
                            ->orWhere('slug', $departmentIdentifier);
                    });
                }

                if ($filters->procedureCategory) {
                    $slug = $this->procedureDepartmentSlug($filters->procedureCategory);

                    if ($slug) {
                        $departmentQuery->where('slug', $slug);
                    }
                }
            })
            ->whereHas('template', function (Builder $templateQuery) use ($filters): void {
                if ($filters->reportType && ! in_array($filters->reportType, ['inpatient', 'outpatient', 'procedure'], true)) {
                    $templateQuery->where('slug', $filters->reportType);
                }
            })
            ->whereHas('reportingPeriod', fn (Builder $periodQuery) => $this->applyPeriodFilters($periodQuery, $filters));

        if ($filters->reportType && in_array($filters->reportType, ['inpatient', 'outpatient', 'procedure'], true)) {
            $query->whereHas('department', fn (Builder $departmentQuery) => $departmentQuery->where('family', $filters->reportType));
        }

        $reports = $query
            ->get()
            ->sortBy(fn (Report $report) => [
                $report->reportingPeriod?->week_start?->toDateString(),
                $report->department?->name,
            ])
            ->values();

        $this->primeFieldAggregates($reports);

        return $this->reportsMemo[$memoKey] = $reports;
    }

    /**
     * Only hydrate values consumed by analytics. Report forms contain many
     * narrative/display-only fields; loading those for a year-long dashboard can
     * otherwise exhaust PHP memory even though no graph reads them.
     *
     * @return list<string>
     */
    private function analyticsFieldKeys(): array
    {
        $keys = [
            'total_patient_days',
            'discharged_home',
            'discharged_ama',
            'total_patients_seen',
            'failed_to_come',
            'total_admitted_patients',
            'new_admitted_patients',
            'follow_up_patients',
            'new_patients_seen',
            'not_seen_same_day',
            'not_seen_appointment',
            'total_hai',
            'new_deaths',
            'new_pressure_ulcer',
            'wait_time_new_days',
            'wait_time_followup_months',
            'clinic_start_time',
            'senior_physician_availability',
        ];

        foreach (self::INPATIENT_CHART_METRICS as $fieldKeys) {
            array_push($keys, ...$fieldKeys);
        }

        foreach (self::OUTPATIENT_CHART_METRICS as $metric) {
            $keys[] = $metric['fieldKey'];
        }

        foreach (self::PROCEDURE_SERVICES as $service) {
            array_push($keys, ...$service['fieldKeys']);
        }

        foreach ([self::PROCEDURE_DIALYSIS_MIX, self::PROCEDURE_ENDOSCOPY_MIX] as $mix) {
            foreach ($mix as $definition) {
                array_push($keys, ...$definition['fieldKeys']);
            }
        }

        return array_values(array_unique($keys));
    }

    /**
     * Stable cache key covering every filter dimension reports() reads.
     */
    private function reportsMemoKey(AnalyticsFilters $filters, ?string $family): string
    {
        return md5(serialize([
            $family,
            $filters->family,
            $filters->reportType,
            $filters->departmentFilter(),
            $filters->procedureCategory,
            $filters->periodId,
            $filters->weekStart,
            $filters->month,
            $filters->year,
            $filters->dateFrom,
            $filters->dateTo,
        ]));
    }

    /**
     * @param  Collection<int, Report>  $reports
     * @param  Collection<int, ReportingPeriod>  $periods
     * @return array<string, mixed>
     */
    public function summary(
        Collection $reports,
        Collection $periods,
        AnalyticsFilters $filters,
        ?string $family = null,
        ?Collection $departments = null,
        ?int $expectedReports = null,
        ?array $aggregate = null,
    ): array {
        $departments ??= $this->scopedDepartments($filters, $family);
        $expectedReports ??= $this->expectedReportCount($filters, $periods, $family);
        // Callers that also need chart metrics for the same set (weekly()) pass
        // their aggregate in, so one pass serves the whole bucket.
        $aggregate ??= $this->aggregate($reports);

        $totalPatientDays = $this->sumOf($aggregate, ['total_patient_days']);
        $totalDischarges = $this->sumOf($aggregate, ['discharged_home', 'discharged_ama']);
        $totalOutpatientVisits = $this->sumOf($aggregate, ['total_patients_seen']);
        $failedToCome = $this->sumOf($aggregate, ['failed_to_come']);

        return [
            'totalReports' => $aggregate['count'],
            'expectedReports' => $expectedReports,
            'missingReports' => max($expectedReports - $aggregate['count'], 0),
            'statusCounts' => $aggregate['status'],
            'totals' => [
                'totalAdmissions' => $this->sumOf($aggregate, ['total_admitted_patients', 'new_admitted_patients']),
                'newAdmissions' => $this->sumOf($aggregate, ['new_admitted_patients']),
                'totalDischarges' => $totalDischarges,
                'totalPatientDays' => $totalPatientDays,
                'totalOutpatientVisits' => $totalOutpatientVisits,
                'totalPatientsSeen' => $totalOutpatientVisits,
                'followUpPatients' => $this->sumOf($aggregate, ['follow_up_patients']),
                'newPatientsSeen' => $this->sumOf($aggregate, ['new_patients_seen']),
                'notSeenSameDay' => $this->sumOf($aggregate, ['not_seen_same_day']),
                'failedToCome' => $failedToCome,
                'noShowCount' => $failedToCome,
                'notSeenAppointment' => $this->sumOf($aggregate, ['not_seen_appointment']),
                'haiCount' => $this->sumOf($aggregate, ['total_hai']),
                'deaths' => $this->sumOf($aggregate, ['new_deaths']),
                'newPressureUlcers' => $this->sumOf($aggregate, ['new_pressure_ulcer']),
                'procedureThroughput' => $this->procedureThroughput($aggregate),
            ],
            'occupancy' => $this->occupancy($aggregate, $departments, max($periods->count() * 7, 30)),
        ];
    }

    /**
     * @param  array<string, mixed>  $aggregate
     * @return array<string, mixed>
     */
    private function chartMetrics(array $aggregate, ?string $family): array
    {
        return match ($family) {
            'inpatient' => $this->inpatientChartMetrics($aggregate),
            'outpatient' => [
                ...$this->outpatientChartMetrics($aggregate),
                'availability' => $this->availabilityCounts($aggregate),
            ],
            'procedure' => $this->procedureChartMetrics($aggregate),
            default => [],
        };
    }

    /**
     * @param  array<string, mixed>  $aggregate
     * @return list<array<string, mixed>>
     */
    private function chartDepartmentMetrics(array $aggregate, ?string $family): array
    {
        if (! in_array($family, ['inpatient', 'outpatient'], true)) {
            return [];
        }

        // aggregate()['departments'] is keyed in first-appearance order, the
        // same order groupBy('department_id') produced, so this sorts and
        // outputs identically.
        return collect($aggregate['departments'])
            ->map(function (array $departmentAggregate) use ($family): array {
                $department = $departmentAggregate['department'];

                return [
                    'departmentId' => $departmentAggregate['departmentId'],
                    'departmentSlug' => $department?->slug,
                    'departmentName' => $department?->name,
                    'family' => $department?->family,
                    'metrics' => $this->chartMetrics($departmentAggregate, $family),
                ];
            })
            ->sortBy('departmentName')
            ->values()
            ->all();
    }

    /**
     * @param  Collection<int, Report>  $reports
     * @return array<string, float>
     */
    private function inpatientChartMetrics(array $aggregate): array
    {
        return collect(self::INPATIENT_CHART_METRICS)
            ->mapWithKeys(fn (array $fieldKeys, string $key): array => [
                $key => $this->sumOf($aggregate, $fieldKeys),
            ])
            ->all();
    }

    /**
     * @param  array<string, mixed>  $aggregate
     * @return array<string, float|null>
     */
    private function outpatientChartMetrics(array $aggregate): array
    {
        return collect(self::OUTPATIENT_CHART_METRICS)
            ->mapWithKeys(fn (array $metric): array => [
                $metric['key'] => $this->outpatientChartMetricValue(
                    $aggregate,
                    $metric['fieldKey'],
                    $metric['valueType'],
                ),
            ])
            ->all();
    }

    /**
     * @param  array<string, mixed>  $aggregate
     */
    private function outpatientChartMetricValue(array $aggregate, string $fieldKey, string $valueType): ?float
    {
        return match ($valueType) {
            'sum' => $this->sumOf($aggregate, [$fieldKey]),
            'average' => $this->averageWeeklyField($aggregate, $fieldKey),
            'timeAverage' => $this->averageTimeWeeklyField($aggregate, $fieldKey),
            default => null,
        };
    }

    /**
     * @param  array<string, mixed>  $aggregate
     * @return array<string, mixed>
     */
    private function procedureChartMetrics(array $aggregate): array
    {
        return [
            'totalThroughput' => $this->procedureThroughput($aggregate),
            'services' => collect(self::PROCEDURE_SERVICES)
                ->map(fn (array $service): array => [
                    'serviceId' => $service['id'],
                    'serviceName' => $service['label'],
                    'departmentSlug' => $service['departmentSlug'],
                    'metricLabel' => $service['metricLabel'],
                    'fieldIds' => implode(', ', $service['fieldKeys']),
                    'total' => $this->sumOf(
                        $this->departmentAggregate($aggregate, $service['departmentSlug']),
                        $service['fieldKeys'],
                    ),
                ])
                ->values()
                ->all(),
            'dialysisMix' => $this->procedureMix($aggregate, 'dialysis_unit', self::PROCEDURE_DIALYSIS_MIX),
            'endoscopyMix' => $this->procedureMix($aggregate, 'endoscopy_lab', self::PROCEDURE_ENDOSCOPY_MIX),
        ];
    }

    /**
     * @param  array<string, mixed>  $aggregate
     * @param  list<array{key: string, label: string, fieldKeys: list<string>}>  $definitions
     * @return list<array<string, mixed>>
     */
    private function procedureMix(array $aggregate, string $departmentSlug, array $definitions): array
    {
        $departmentAggregate = $this->departmentAggregate($aggregate, $departmentSlug);

        return collect($definitions)
            ->map(fn (array $definition): array => [
                'key' => $definition['key'],
                'label' => $definition['label'],
                'value' => $this->sumOf($departmentAggregate, $definition['fieldKeys']),
                'fieldIds' => implode(', ', $definition['fieldKeys']),
            ])
            ->values()
            ->all();
    }

    /**
     * @param  Collection<int, Report>  $reports
     * @return array<string, mixed>
     */
    public function outpatientExtras(Collection $reports): array
    {
        $aggregate = $this->aggregate($reports);

        return [
            'averages' => [
                'waitTimeNewDays' => $this->averageWeeklyField($aggregate, 'wait_time_new_days'),
                'waitTimeFollowupMonths' => $this->averageWeeklyField($aggregate, 'wait_time_followup_months'),
                'clinicStartMinutes' => $this->averageTimeWeeklyField($aggregate, 'clinic_start_time'),
            ],
            'seniorPhysicianAvailability' => $this->availabilityCounts($aggregate),
        ];
    }

    /**
     * @param  Collection<int, Report>  $reports
     * @return array<string, mixed>
     */
    public function procedureExtras(Collection $reports): array
    {
        $aggregate = $this->aggregate($reports);

        return [
            'totalThroughput' => $this->procedureThroughput($aggregate),
            'services' => collect(self::PROCEDURE_SERVICES)
                ->map(fn (array $service) => [
                    'serviceId' => $service['id'],
                    'serviceName' => $service['label'],
                    'departmentSlug' => $service['departmentSlug'],
                    'metricLabel' => $service['metricLabel'],
                    'fieldKeys' => $service['fieldKeys'],
                    'total' => $this->sumOf(
                        $this->departmentAggregate($aggregate, $service['departmentSlug']),
                        $service['fieldKeys'],
                    ),
                ])
                ->values()
                ->all(),
            // Deliberately NOT department-scoped, unlike procedureChartMetrics'
            // mixes: these totals span the whole filtered set.
            'dialysisMix' => [
                'acuteHd' => $this->sumOf($aggregate, ['dialysis_acute']),
                'chronicHd' => $this->sumOf($aggregate, ['dialysis_chronic']),
            ],
            'endoscopyMix' => [
                'ugi' => $this->sumOf($aggregate, ['upper_gi_elective', 'upper_gi_emergency']),
                'ercp' => $this->sumOf($aggregate, ['ercp']),
                'colonoscopy' => $this->sumOf($aggregate, ['colonoscopy']),
                'bronchoscopy' => $this->sumOf($aggregate, ['bronchoscopy']),
                'ligation' => $this->sumOf($aggregate, ['variceal_ligation']),
            ],
        ];
    }

    /**
     * @param  Collection<int, Report>  $reports
     */
    public function sumFields(Collection $reports, array $fieldKeys): float
    {
        return $this->sumOf($this->aggregate($reports), $fieldKeys);
    }

    /**
     * Everything the summaries and charts read from a report set, computed in a
     * SINGLE pass: totals per field key, the per-report values that feed the
     * averages, status counts, and the same again broken down per department.
     *
     * Every metric helper below reads from this structure. They each used to
     * rescan the collection instead - roughly forty scans per weekly bucket per
     * family - which is why a long range cost far more than its row count.
     *
     * @param  Collection<int, Report>  $reports
     * @return array<string, mixed>
     */
    private function aggregate(Collection $reports): array
    {
        $weeklyKeys = $this->weeklyValueFieldKeys();
        $aggregate = $this->emptyAggregate();

        foreach ($reports as $report) {
            $departmentKey = (string) $report->department_id;

            if (! isset($aggregate['departments'][$departmentKey])) {
                $aggregate['departments'][$departmentKey] = $this->emptyAggregate(
                    $report->department,
                    $report->department_id,
                );

                if ($report->department?->slug !== null) {
                    $aggregate['bySlug'][$report->department->slug] = $departmentKey;
                }
            }

            $this->accumulate($aggregate, $report, $weeklyKeys);
            $this->accumulate($aggregate['departments'][$departmentKey], $report, $weeklyKeys);
        }

        return $aggregate;
    }

    /**
     * @param  array<string, mixed>  $target
     * @param  list<string>  $weeklyKeys
     */
    private function accumulate(array &$target, Report $report, array $weeklyKeys): void
    {
        $target['count']++;

        // Only the five reportable statuses are tallied; anything else is
        // counted in totalReports but in no status bucket, as before.
        if (array_key_exists($report->status, $target['status'])) {
            $target['status'][$report->status]++;
        }

        foreach ($this->reportFieldSums($report) as $fieldKey => $value) {
            $target['sums'][$fieldKey] = ($target['sums'][$fieldKey] ?? 0.0) + $value;
        }

        // Report order is preserved, so the averages below see the same value
        // sequence - and therefore the same floating-point result - as the old
        // per-report map did. Nulls (a template without the field, or a week of
        // blank days) are dropped by every consumer anyway, so not collecting
        // them keeps these lists to the reports that carry the metric at all.
        foreach ($weeklyKeys as $fieldKey) {
            $value = $this->weeklyFieldValue($report, $fieldKey);

            if ($value !== null) {
                $target['weeklyValues'][$fieldKey][] = $value;
            }
        }
    }

    /**
     * @return array<string, mixed>
     */
    private function emptyAggregate(?Department $department = null, mixed $departmentId = null): array
    {
        return [
            'department' => $department,
            'departmentId' => $departmentId,
            'count' => 0,
            'status' => [
                'draft' => 0,
                'submitted' => 0,
                'edited_after_submission' => 0,
                'locked' => 0,
                'overdue' => 0,
            ],
            'sums' => [],
            'weeklyValues' => [],
            'departments' => [],
            'bySlug' => [],
        ];
    }

    /**
     * @param  array<string, mixed>  $aggregate
     * @param  list<string>  $fieldKeys
     */
    private function sumOf(array $aggregate, array $fieldKeys): float
    {
        $total = 0.0;

        foreach ($fieldKeys as $fieldKey) {
            $total += $aggregate['sums'][$fieldKey] ?? 0.0;
        }

        return $total;
    }

    /**
     * One department's slice of an aggregate, or an empty one when the set holds
     * no reports for it - which reads as zero, exactly like filtering the
     * collection down to nothing did.
     *
     * @param  array<string, mixed>  $aggregate
     * @return array<string, mixed>
     */
    private function departmentAggregate(array $aggregate, string $departmentSlug): array
    {
        $departmentKey = $aggregate['bySlug'][$departmentSlug] ?? null;

        return $departmentKey === null
            ? $this->emptyAggregate()
            : $aggregate['departments'][$departmentKey];
    }

    /**
     * Field keys read as a per-report weekly VALUE (honouring the definition's
     * aggregate_type) rather than as a plain total, so aggregate() knows which
     * ones to collect. Derived from the metric definitions themselves so the two
     * cannot drift apart.
     *
     * @return list<string>
     */
    private function weeklyValueFieldKeys(): array
    {
        $keys = [
            // outpatientExtras averages.
            'wait_time_new_days',
            'wait_time_followup_months',
            'clinic_start_time',
            // availabilityCounts.
            'senior_physician_availability',
        ];

        foreach (self::OUTPATIENT_CHART_METRICS as $metric) {
            if ($metric['valueType'] !== 'sum') {
                $keys[] = $metric['fieldKey'];
            }
        }

        return array_values(array_unique($keys));
    }

    /**
     * @return array<string, float>
     */
    private function reportFieldSums(Report $report): array
    {
        $this->ensurePrimed($report);

        return $this->reportFieldSumsMemo[(string) $report->id] ?? [];
    }

    /**
     * Compute both per-report field aggregates in SQL rather than hydrating the
     * underlying rows. A year-long dashboard spans ~68k field values; as Eloquent
     * models those alone exceeded PHP's default 128 MB limit, while the numbers
     * the graphs actually read collapse to ~12k plain floats.
     *
     * Every id passed in is marked primed, so a report with no values answers
     * from the memo instead of lazy-loading the relation reports() no longer
     * eager loads.
     *
     * @param  Collection<int, Report>  $reports
     */
    private function primeFieldAggregates(Collection $reports): void
    {
        $ids = $reports
            ->pluck('id')
            ->filter()
            ->map(fn (mixed $id): string => (string) $id)
            ->reject(fn (string $id): bool => isset($this->primedReports[$id]))
            ->unique()
            ->values();

        if ($ids->isEmpty()) {
            return;
        }

        foreach ($ids as $id) {
            $this->primedReports[$id] = true;
            $this->reportFieldSumsMemo[$id] ??= [];
            $this->weeklyFieldValueMemo[$id] ??= [];
        }

        $fieldKeys = $this->analyticsFieldKeys();

        // Chunked so the bound-parameter count stays well inside SQLite's limit.
        foreach ($ids->chunk(self::PRIME_CHUNK_SIZE) as $chunk) {
            $this->primeNumericAggregates($chunk->values()->all(), $fieldKeys);
            $this->primeLatestValues($chunk->values()->all(), $fieldKeys);
        }
    }

    /**
     * @param  list<string>  $reportIds
     * @param  list<string>  $fieldKeys
     */
    private function primeNumericAggregates(array $reportIds, array $fieldKeys): void
    {
        $rows = DB::table('report_field_values as v')
            ->join('report_field_definitions as d', 'd.id', '=', 'v.field_definition_id')
            ->whereIn('v.report_id', $reportIds)
            ->whereIn('d.field_key', $fieldKeys)
            ->groupBy('v.report_id', 'd.field_key', 'd.aggregate_type')
            ->select([
                'v.report_id',
                'd.field_key',
                'd.aggregate_type',
                DB::raw('SUM(v.value_number) as sum_number'),
                DB::raw('AVG(v.value_number) as avg_number'),
            ])
            ->get();

        foreach ($rows as $row) {
            $reportId = (string) $row->report_id;
            $fieldKey = (string) $row->field_key;

            // A field whose every day is blank contributes no numeric total,
            // exactly as the old per-value loop recorded no entry for it.
            if ($row->sum_number !== null) {
                $this->reportFieldSumsMemo[$reportId][$fieldKey] = (float) $row->sum_number;
            }

            $this->weeklyFieldValueMemo[$reportId][$fieldKey] = match ($row->aggregate_type) {
                'sum' => (float) ($row->sum_number ?? 0),
                'average' => $row->avg_number !== null ? (float) $row->avg_number : null,
                // 'latest' is resolved from the day rows below. Seeding it null
                // keeps an all-blank field answerable without a lazy load.
                default => null,
            };
        }
    }

    /**
     * @param  list<string>  $reportIds
     * @param  list<string>  $fieldKeys
     */
    private function primeLatestValues(array $reportIds, array $fieldKeys): void
    {
        $rows = DB::table('report_field_values as v')
            ->join('report_field_definitions as d', 'd.id', '=', 'v.field_definition_id')
            ->whereIn('v.report_id', $reportIds)
            ->whereIn('d.field_key', $fieldKeys)
            ->where('d.aggregate_type', 'latest')
            ->where(fn ($query) => $query
                ->whereNotNull('v.value_number')
                ->orWhereNotNull('v.value_text')
                ->orWhereNotNull('v.value_time')
                ->orWhereNotNull('v.value_json'))
            ->select([
                'v.report_id',
                'd.field_key',
                'v.value_number',
                'v.value_text',
                'v.value_time',
                'v.value_json',
            ])
            ->orderBy('v.report_id')
            ->orderBy('d.field_key')
            ->orderByRaw($this->weekdayOrderExpression().' asc')
            ->get();

        // Each field's rows arrive grouped and in ascending weekday order, so
        // the last one written for a field is the latest day carrying a value -
        // the same pick the old sortBy()->reverse()->first() made.
        foreach ($rows as $row) {
            $this->weeklyFieldValueMemo[(string) $row->report_id][(string) $row->field_key] = $this->rowToScalar($row);
        }
    }

    /**
     * Weekday name to ordinal, as a portable CASE expression. Built from
     * WEEKDAY_ORDER so the SQL ordering and the PHP constant cannot drift, and
     * safe to inline because every value is a hard-coded constant.
     */
    private function weekdayOrderExpression(): string
    {
        $cases = '';

        foreach (self::WEEKDAY_ORDER as $day => $ordinal) {
            $cases .= sprintf(" when '%s' then %d", $day, $ordinal);
        }

        return 'case v.day_name'.$cases.' else 99 end';
    }

    /**
     * summary() and its callers are public and accept any report collection, so
     * a report that never came through reports() must still answer with its real
     * numbers rather than silently reading as all-zero.
     */
    private function ensurePrimed(Report $report): void
    {
        if (! isset($this->primedReports[(string) $report->id])) {
            $this->primeFieldAggregates(collect([$report]));
        }
    }

    /**
     * @return array<string, mixed>
     */
    public function scope(AnalyticsFilters $filters, ?string $family = null): array
    {
        return [
            'family' => $this->effectiveFamily($filters, $family),
            'reportType' => $filters->reportType,
            'department' => $filters->departmentFilter(),
            'procedureCategory' => $filters->procedureCategory,
            'periodId' => $filters->periodId,
            'weekStart' => $filters->weekStart,
            'month' => $filters->month,
            'year' => $filters->year,
            'dateFrom' => $filters->dateFrom,
            'dateTo' => $filters->dateTo,
        ];
    }

    /**
     * @param  array<string, mixed>  $aggregate
     */
    private function averageWeeklyField(array $aggregate, string $fieldKey): ?float
    {
        $values = collect($aggregate['weeklyValues'][$fieldKey] ?? [])
            ->filter(fn (mixed $value) => is_numeric($value))
            ->map(fn (mixed $value) => (float) $value)
            ->values();

        return $values->isEmpty() ? null : (float) $values->average();
    }

    /**
     * @param  array<string, mixed>  $aggregate
     */
    private function averageTimeWeeklyField(array $aggregate, string $fieldKey): ?float
    {
        $values = collect($aggregate['weeklyValues'][$fieldKey] ?? [])
            ->map(fn (mixed $value) => $this->timeToMinutes($value))
            ->filter(fn (?int $value) => $value !== null)
            ->values();

        return $values->isEmpty() ? null : (float) $values->average();
    }

    private function weeklyFieldValue(Report $report, string $fieldKey): mixed
    {
        $this->ensurePrimed($report);

        return $this->weeklyFieldValueMemo[(string) $report->id][$fieldKey] ?? null;
    }

    /**
     * Collapse one raw value row to the scalar the charts expect. Mirrors the
     * Eloquent attribute shapes the old model-based path returned, including the
     * array cast on value_json.
     */
    private function rowToScalar(object $row): mixed
    {
        if ($row->value_number !== null) {
            $number = (float) $row->value_number;

            return floor($number) === $number ? (int) $number : $number;
        }

        if ($row->value_time !== null) {
            return substr((string) $row->value_time, 0, 5);
        }

        if ($row->value_text !== null) {
            return $row->value_text;
        }

        return $row->value_json !== null ? json_decode((string) $row->value_json, true) : null;
    }

    private function timeToMinutes(mixed $value): ?int
    {
        if (! is_string($value) || ! preg_match('/^(\d{1,2}):(\d{2})/', $value, $matches)) {
            return null;
        }

        return ((int) $matches[1] * 60) + (int) $matches[2];
    }

    /**
     * @param  array<string, mixed>  $aggregate
     * @return array<string, int>
     */
    private function availabilityCounts(array $aggregate): array
    {
        $counts = [
            'fullDay' => 0,
            'partialDay' => 0,
            'unavailable' => 0,
            'total' => 0,
        ];

        foreach ($aggregate['weeklyValues']['senior_physician_availability'] ?? [] as $value) {
            $key = match ($value) {
                'Full day' => 'fullDay',
                'Partial day' => 'partialDay',
                'Unavailable' => 'unavailable',
                default => null,
            };

            if ($key) {
                $counts[$key]++;
                $counts['total']++;
            }
        }

        return $counts;
    }

    /**
     * @param  array<string, mixed>  $aggregate
     */
    private function procedureThroughput(array $aggregate): float
    {
        return collect(self::PROCEDURE_SERVICES)
            ->sum(fn (array $service) => $this->sumOf(
                $this->departmentAggregate($aggregate, $service['departmentSlug']),
                $service['fieldKeys'],
            ));
    }

    /**
     * @param  array<string, mixed>  $aggregate
     * @param  Collection<int, Department>  $departments
     * @return array<string, float|null>
     */
    private function occupancy(array $aggregate, Collection $departments, int $coveredDays): array
    {
        $eligibleDepartments = $departments
            ->filter(fn (Department $department) => $department->family === 'inpatient' && (int) $department->bed_count > 0)
            ->unique('id');
        $totalBeds = (int) $eligibleDepartments->sum('bed_count');
        $totalPatientDays = 0.0;
        $totalDischarges = 0.0;

        foreach ($eligibleDepartments as $department) {
            $departmentAggregate = $aggregate['departments'][(string) $department->id] ?? null;

            if ($departmentAggregate === null) {
                continue;
            }

            $totalPatientDays += $this->sumOf($departmentAggregate, ['total_patient_days']);
            $totalDischarges += $this->sumOf($departmentAggregate, ['discharged_home', 'discharged_ama']);
        }

        return [
            'borPercent' => $totalBeds ? ($totalPatientDays / ($totalBeds * $coveredDays)) * 100 : null,
            'btr' => $totalBeds ? $totalDischarges / $totalBeds : null,
            'alos' => $totalDischarges ? $totalPatientDays / $totalDischarges : null,
        ];
    }

    /**
     * @return Collection<int, Department>
     */
    private function scopedDepartments(AnalyticsFilters $filters, ?string $family = null): Collection
    {
        $effectiveFamily = $this->effectiveFamily($filters, $family);
        $memoKey = md5(serialize([
            $effectiveFamily,
            $filters->departmentFilter(),
            $filters->procedureCategory,
        ]));

        if (isset($this->scopedDepartmentsMemo[$memoKey])) {
            return $this->scopedDepartmentsMemo[$memoKey];
        }

        $query = Department::query()->where('active', true);

        if ($effectiveFamily) {
            $query->where('family', $effectiveFamily);
        }

        if ($department = $filters->departmentFilter()) {
            $query->where(fn (Builder $builder) => $builder->where('id', $department)->orWhere('slug', $department));
        }

        if ($filters->procedureCategory && ($slug = $this->procedureDepartmentSlug($filters->procedureCategory))) {
            $query->where('slug', $slug);
        }

        return $this->scopedDepartmentsMemo[$memoKey] = $query->get();
    }

    /**
     * @param  Collection<int, ReportingPeriod>  $periods
     */
    private function expectedReportCount(AnalyticsFilters $filters, Collection $periods, ?string $family = null): int
    {
        if ($periods->isEmpty()) {
            return 0;
        }

        // The active-assignment count depends only on the scoped departments, not
        // on the bucket's periods, so memoize it per (family, department, category)
        // and multiply by the period count. summary() runs this for every bucket.
        $memoKey = md5(serialize([
            $this->effectiveFamily($filters, $family),
            $filters->departmentFilter(),
            $filters->procedureCategory,
        ]));

        $perPeriod = $this->assignmentCountMemo[$memoKey] ??= $this->countActiveAssignments($filters, $family);

        return $perPeriod * $periods->count();
    }

    private function countActiveAssignments(AnalyticsFilters $filters, ?string $family = null): int
    {
        $departmentIds = $this->scopedDepartments($filters, $family)->pluck('id');

        if ($departmentIds->isEmpty()) {
            return 0;
        }

        return ReportAssignment::query()
            ->where('active', true)
            ->whereIn('department_id', $departmentIds)
            ->count();
    }

    /**
     * @param  Collection<int, Report>  $reports
     * @return Collection<int, ReportingPeriod>
     */
    private function periodsForReports(Collection $reports, AnalyticsFilters $filters): Collection
    {
        if ($reports->isNotEmpty()) {
            return $reports->pluck('reportingPeriod')->unique('id')->values();
        }

        if (! $filters->hasTemporalFilter()) {
            return collect();
        }

        return ReportingPeriod::query()
            ->where(fn (Builder $query) => $this->applyPeriodFilters($query, $filters))
            ->orderBy('week_start')
            ->get();
    }

    /**
     * @param  Collection<int, Report>  $reports
     * @return Collection<int, ReportingPeriod>
     */
    private function rollupPeriods(Collection $reports, AnalyticsFilters $filters): Collection
    {
        if (! $filters->hasTemporalFilter()) {
            return $reports
                ->pluck('reportingPeriod')
                ->filter()
                ->unique('id')
                ->sortBy('week_start')
                ->values();
        }

        return ReportingPeriod::query()
            ->where(fn (Builder $query) => $this->applyPeriodFilters($query, $filters))
            ->orderBy('week_start')
            ->get();
    }

    private function applyPeriodFilters(Builder $periodQuery, AnalyticsFilters $filters): void
    {
        if ($filters->periodId) {
            $periodQuery->where('id', $filters->periodId);
        }

        if ($filters->weekStart) {
            $weekStart = CarbonImmutable::parse($filters->weekStart)->startOfDay();
            $periodQuery
                ->where('week_start', '>=', $weekStart->toDateString())
                ->where('week_start', '<', $weekStart->addDay()->toDateString());
        }

        if ($filters->dateFrom) {
            $periodQuery->where('week_start', '>=', CarbonImmutable::parse($filters->dateFrom)->toDateString());
        }

        if ($filters->dateTo) {
            $periodQuery->where('week_start', '<', CarbonImmutable::parse($filters->dateTo)->addDay()->toDateString());
        }

        if ($filters->month) {
            [$year, $month] = explode('-', $filters->month);
            $monthStart = CarbonImmutable::create((int) $year, (int) $month, 1)->startOfDay();
            $periodQuery
                ->where('week_start', '>=', $monthStart->toDateString())
                ->where('week_start', '<', $monthStart->addMonth()->toDateString());
        }

        if ($filters->year) {
            $yearStart = CarbonImmutable::create($filters->year, 1, 1)->startOfDay();
            $periodQuery
                ->where('week_start', '>=', $yearStart->toDateString())
                ->where('week_start', '<', $yearStart->addYear()->toDateString());
        }
    }

    private function procedureDepartmentSlug(string $procedureCategory): ?string
    {
        $normalized = strtolower(trim($procedureCategory));
        $aliases = [
            'dialysis' => 'dialysis_unit',
            'endoscopy' => 'endoscopy_lab',
            'echo' => 'echocardiography_lab',
            'echocardiography' => 'echocardiography_lab',
            'eeg' => 'eeg_lab',
            'renal' => 'renal_procedures',
            'bronchoscopy' => 'bronchoscopy_lab',
            'hematology' => 'hematology_procedures',
        ];

        if (isset($aliases[$normalized])) {
            return $aliases[$normalized];
        }

        $service = collect(self::PROCEDURE_SERVICES)->first(fn (array $item) => $item['id'] === $procedureCategory || $item['departmentSlug'] === $procedureCategory);

        return $service['departmentSlug'] ?? null;
    }

    private function effectiveFamily(AnalyticsFilters $filters, ?string $family = null): ?string
    {
        if ($family !== null) {
            return $family;
        }

        if ($filters->family !== null) {
            return $filters->family;
        }

        if ($filters->reportType && in_array($filters->reportType, ['inpatient', 'outpatient', 'procedure'], true)) {
            return $filters->reportType;
        }

        return null;
    }
}
