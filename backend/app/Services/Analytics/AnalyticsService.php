<?php

namespace App\Services\Analytics;

use App\Models\Department;
use App\Models\Report;
use App\Models\ReportAssignment;
use App\Models\ReportingPeriod;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Collection;

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

    private const WEEKDAY_ORDER = [
        'monday' => 0,
        'tuesday' => 1,
        'wednesday' => 2,
        'thursday' => 3,
        'friday' => 4,
        'saturday' => 5,
        'sunday' => 6,
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

    public function flushMemo(): void
    {
        $this->reportsMemo = [];
    }

    /**
     * @return array<string, mixed>
     */
    public function overview(AnalyticsFilters $filters): array
    {
        $reports = $this->reports($filters);
        $periods = $this->periodsForReports($reports, $filters);

        return [
            'scope' => $this->scope($filters),
            'summary' => $this->summary($reports, $periods, $filters),
            'weekly' => $this->weekly($filters),
            'monthly' => $this->monthly($filters),
        ];
    }

    /**
     * @return array<string, mixed>
     */
    public function familySummary(string $family, AnalyticsFilters $filters): array
    {
        $reports = $this->reports($filters, $family);
        $periods = $this->periodsForReports($reports, $filters);

        return [
            'scope' => $this->scope($filters, $family),
            'summary' => $this->summary($reports, $periods, $filters, $family),
            'departments' => $this->departmentSummaries($filters, $family),
            'weekly' => $this->weekly($filters, $family),
            'monthly' => $this->monthly($filters, $family),
        ];
    }

    /**
     * @return list<array<string, mixed>>
     */
    public function weekly(AnalyticsFilters $filters, ?string $family = null): array
    {
        $reports = $this->reports($filters, $family);

        return $reports
            ->groupBy('reporting_period_id')
            ->map(function (Collection $bucket) use ($filters, $family): array {
                $period = $bucket->first()->reportingPeriod;

                return [
                    'periodId' => $period->id,
                    'weekStart' => $period->week_start?->toDateString(),
                    'weekEnd' => $period->week_end?->toDateString(),
                    'label' => $period->week_start?->format('M j'),
                    'summary' => $this->summary($bucket, collect([$period]), $filters, $family),
                ];
            })
            ->sortBy('weekStart')
            ->values()
            ->all();
    }

    /**
     * @return list<array<string, mixed>>
     */
    public function monthly(AnalyticsFilters $filters, ?string $family = null): array
    {
        $reports = $this->reports($filters, $family);

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
    public function departmentSummaries(AnalyticsFilters $filters, ?string $family = null): array
    {
        $reports = $this->reports($filters, $family);

        return $reports
            ->groupBy('department_id')
            ->map(function (Collection $bucket) use ($filters): array {
                $department = $bucket->first()->department;
                $departmentFilters = $department
                    ? $filters->withDepartment($department->slug)
                    : $filters;

                return [
                    'departmentId' => $bucket->first()->department_id,
                    'departmentSlug' => $department?->slug,
                    'departmentName' => $department?->name,
                    'family' => $department?->family,
                    'summary' => $this->summary(
                        $bucket,
                        $bucket->pluck('reportingPeriod')->unique('id')->values(),
                        $departmentFilters,
                        $department?->family,
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

        $query = Report::query()
            ->with(['department', 'template', 'reportingPeriod', 'fieldValues.fieldDefinition', 'calculatedMetric', 'assignment'])
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

        return $this->reportsMemo[$memoKey] = $query
            ->get()
            ->sortBy(fn (Report $report) => [
                $report->reportingPeriod?->week_start?->toDateString(),
                $report->department?->name,
            ])
            ->values();
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
    public function summary(Collection $reports, Collection $periods, AnalyticsFilters $filters, ?string $family = null): array
    {
        $departments = $this->scopedDepartments($filters, $family);
        $expectedReports = $this->expectedReportCount($filters, $periods, $family);
        $totalPatientDays = $this->sumFields($reports, ['total_patient_days']);
        $totalDischarges = $this->sumFields($reports, ['discharged_home', 'discharged_ama']);
        $totalOutpatientVisits = $this->sumFields($reports, ['total_patients_seen']);
        $failedToCome = $this->sumFields($reports, ['failed_to_come']);

        return [
            'totalReports' => $reports->count(),
            'expectedReports' => $expectedReports,
            'missingReports' => max($expectedReports - $reports->count(), 0),
            'statusCounts' => [
                'draft' => $reports->where('status', 'draft')->count(),
                'submitted' => $reports->where('status', 'submitted')->count(),
                'edited_after_submission' => $reports->where('status', 'edited_after_submission')->count(),
                'locked' => $reports->where('status', 'locked')->count(),
                'overdue' => $reports->where('status', 'overdue')->count(),
            ],
            'totals' => [
                'totalAdmissions' => $this->sumFields($reports, ['total_admitted_patients', 'new_admitted_patients']),
                'totalDischarges' => $totalDischarges,
                'totalPatientDays' => $totalPatientDays,
                'totalOutpatientVisits' => $totalOutpatientVisits,
                'totalPatientsSeen' => $totalOutpatientVisits,
                'followUpPatients' => $this->sumFields($reports, ['follow_up_patients']),
                'newPatientsSeen' => $this->sumFields($reports, ['new_patients_seen']),
                'notSeenSameDay' => $this->sumFields($reports, ['not_seen_same_day']),
                'failedToCome' => $failedToCome,
                'noShowCount' => $failedToCome,
                'notSeenAppointment' => $this->sumFields($reports, ['not_seen_appointment']),
                'haiCount' => $this->sumFields($reports, ['total_hai']),
                'procedureThroughput' => $this->procedureThroughput($reports),
            ],
            'occupancy' => $this->occupancy($reports, $departments, max($periods->count() * 7, 30)),
        ];
    }

    /**
     * @param  Collection<int, Report>  $reports
     * @return array<string, mixed>
     */
    public function outpatientExtras(Collection $reports): array
    {
        return [
            'averages' => [
                'waitTimeNewDays' => $this->averageWeeklyField($reports, 'wait_time_new_days'),
                'waitTimeFollowupMonths' => $this->averageWeeklyField($reports, 'wait_time_followup_months'),
                'clinicStartMinutes' => $this->averageTimeWeeklyField($reports, 'clinic_start_time'),
            ],
            'seniorPhysicianAvailability' => $this->availabilityCounts($reports),
        ];
    }

    /**
     * @param  Collection<int, Report>  $reports
     * @return array<string, mixed>
     */
    public function procedureExtras(Collection $reports): array
    {
        return [
            'totalThroughput' => $this->procedureThroughput($reports),
            'services' => collect(self::PROCEDURE_SERVICES)
                ->map(fn (array $service) => [
                    'serviceId' => $service['id'],
                    'serviceName' => $service['label'],
                    'departmentSlug' => $service['departmentSlug'],
                    'metricLabel' => $service['metricLabel'],
                    'fieldKeys' => $service['fieldKeys'],
                    'total' => $this->sumFields(
                        $reports->filter(fn (Report $report) => $report->department?->slug === $service['departmentSlug']),
                        $service['fieldKeys'],
                    ),
                ])
                ->values()
                ->all(),
            'dialysisMix' => [
                'acuteHd' => $this->sumFields($reports, ['dialysis_acute']),
                'chronicHd' => $this->sumFields($reports, ['dialysis_chronic']),
            ],
            'endoscopyMix' => [
                'ugi' => $this->sumFields($reports, ['upper_gi_elective', 'upper_gi_emergency']),
                'ercp' => $this->sumFields($reports, ['ercp']),
                'colonoscopy' => $this->sumFields($reports, ['colonoscopy']),
                'bronchoscopy' => $this->sumFields($reports, ['bronchoscopy']),
                'ligation' => $this->sumFields($reports, ['variceal_ligation']),
            ],
        ];
    }

    /**
     * @param  Collection<int, Report>  $reports
     */
    public function sumFields(Collection $reports, array $fieldKeys): float
    {
        return (float) $reports->sum(fn (Report $report) => $report->fieldValues
            ->filter(fn ($value) => in_array($value->fieldDefinition?->field_key, $fieldKeys, true))
            ->sum(fn ($value) => (float) ($value->value_number ?? 0)));
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

    private function averageWeeklyField(Collection $reports, string $fieldKey): ?float
    {
        $values = $reports
            ->map(fn (Report $report) => $this->weeklyFieldValue($report, $fieldKey))
            ->filter(fn (mixed $value) => is_numeric($value))
            ->map(fn (mixed $value) => (float) $value)
            ->values();

        return $values->isEmpty() ? null : (float) $values->average();
    }

    private function averageTimeWeeklyField(Collection $reports, string $fieldKey): ?float
    {
        $values = $reports
            ->map(fn (Report $report) => $this->timeToMinutes($this->weeklyFieldValue($report, $fieldKey)))
            ->filter(fn (?int $value) => $value !== null)
            ->values();

        return $values->isEmpty() ? null : (float) $values->average();
    }

    private function weeklyFieldValue(Report $report, string $fieldKey): mixed
    {
        $values = $report->fieldValues
            ->filter(fn ($value) => $value->fieldDefinition?->field_key === $fieldKey)
            ->sortBy(fn ($value) => self::WEEKDAY_ORDER[$value->day_name] ?? 99)
            ->values();
        $definition = $values->first()?->fieldDefinition;

        if (! $definition) {
            return null;
        }

        if ($definition->aggregate_type === 'sum') {
            return (float) $values->sum(fn ($value) => (float) ($value->value_number ?? 0));
        }

        if ($definition->aggregate_type === 'average') {
            $numbers = $values
                ->filter(fn ($value) => $value->value_number !== null)
                ->map(fn ($value) => (float) $value->value_number);

            return $numbers->isEmpty() ? null : (float) $numbers->average();
        }

        $latest = $values
            ->reverse()
            ->first(fn ($value) => $value->value_number !== null || $value->value_text !== null || $value->value_time !== null || $value->value_json !== null);

        return $latest ? $this->valueToScalar($latest) : null;
    }

    private function valueToScalar(mixed $value): mixed
    {
        if ($value->value_number !== null) {
            $number = (float) $value->value_number;

            return floor($number) === $number ? (int) $number : $number;
        }

        if ($value->value_time !== null) {
            return substr((string) $value->value_time, 0, 5);
        }

        return $value->value_text ?? $value->value_json;
    }

    private function timeToMinutes(mixed $value): ?int
    {
        if (! is_string($value) || ! preg_match('/^(\d{1,2}):(\d{2})/', $value, $matches)) {
            return null;
        }

        return ((int) $matches[1] * 60) + (int) $matches[2];
    }

    /**
     * @param  Collection<int, Report>  $reports
     * @return array<string, int>
     */
    private function availabilityCounts(Collection $reports): array
    {
        $counts = [
            'fullDay' => 0,
            'partialDay' => 0,
            'unavailable' => 0,
            'total' => 0,
        ];

        foreach ($reports as $report) {
            $value = $this->weeklyFieldValue($report, 'senior_physician_availability');
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
     * @param  Collection<int, Report>  $reports
     */
    private function procedureThroughput(Collection $reports): float
    {
        return collect(self::PROCEDURE_SERVICES)
            ->sum(fn (array $service) => $this->sumFields(
                $reports->filter(fn (Report $report) => $report->department?->slug === $service['departmentSlug']),
                $service['fieldKeys'],
            ));
    }

    /**
     * @param  Collection<int, Report>  $reports
     * @param  Collection<int, Department>  $departments
     * @return array<string, float|null>
     */
    private function occupancy(Collection $reports, Collection $departments, int $coveredDays): array
    {
        $eligibleDepartments = $departments
            ->filter(fn (Department $department) => $department->family === 'inpatient' && (int) $department->bed_count > 0)
            ->unique('id');
        $eligibleDepartmentIds = $eligibleDepartments->pluck('id')->all();
        $eligibleReports = $reports->filter(fn (Report $report) => in_array($report->department_id, $eligibleDepartmentIds, true));
        $totalBeds = (int) $eligibleDepartments->sum('bed_count');
        $totalPatientDays = $this->sumFields($eligibleReports, ['total_patient_days']);
        $totalDischarges = $this->sumFields($eligibleReports, ['discharged_home', 'discharged_ama']);

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
        $query = Department::query()->where('active', true);
        $effectiveFamily = $this->effectiveFamily($filters, $family);

        if ($effectiveFamily) {
            $query->where('family', $effectiveFamily);
        }

        if ($department = $filters->departmentFilter()) {
            $query->where(fn (Builder $builder) => $builder->where('id', $department)->orWhere('slug', $department));
        }

        if ($filters->procedureCategory && ($slug = $this->procedureDepartmentSlug($filters->procedureCategory))) {
            $query->where('slug', $slug);
        }

        return $query->get();
    }

    /**
     * @param  Collection<int, ReportingPeriod>  $periods
     */
    private function expectedReportCount(AnalyticsFilters $filters, Collection $periods, ?string $family = null): int
    {
        if ($periods->isEmpty()) {
            return 0;
        }

        $departmentIds = $this->scopedDepartments($filters, $family)->pluck('id');

        if ($departmentIds->isEmpty()) {
            return 0;
        }

        return ReportAssignment::query()
            ->where('active', true)
            ->whereIn('department_id', $departmentIds)
            ->count() * $periods->count();
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
            $periodQuery->whereDate('week_start', $filters->weekStart);
        }

        if ($filters->dateFrom) {
            $periodQuery->whereDate('week_start', '>=', $filters->dateFrom);
        }

        if ($filters->dateTo) {
            $periodQuery->whereDate('week_start', '<=', $filters->dateTo);
        }

        if ($filters->month) {
            [$year, $month] = explode('-', $filters->month);
            $periodQuery->whereYear('week_start', (int) $year)->whereMonth('week_start', (int) $month);
        }

        if ($filters->year) {
            $periodQuery->whereYear('week_start', $filters->year);
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
