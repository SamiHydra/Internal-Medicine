<?php

namespace App\Services\Academic;

use App\Models\ConsultantEvaluation;
use App\Models\ResidentEvaluation;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Collection;
use Illuminate\Support\Str;

class AcademicAnalyticsService
{
    private const CONSULTANT_INDICATOR_LABELS = [
        'all_patients_reviewed' => 'All patients reviewed',
        'mgmt_plan_documented' => 'Management plan documented',
        'vte_assessed' => 'VTE risk assessed',
        'discharge_discussed' => 'Discharge discussed',
        'med_review_done' => 'Medication review done',
        'critical_labs_reviewed' => 'Critical labs reviewed',
    ];

    private const RESIDENT_INDICATOR_LABELS = [
        'on_time' => 'Present & on time',
        'prepared' => 'Prepared',
        'presentation_clear' => 'Presentation clear',
        'clinical_reasoning' => 'Clinical reasoning',
        'management_plan' => 'Management plan',
        'documentation_timely' => 'Documentation timely',
        'communication' => 'Communication',
        'professional' => 'Professional conduct',
        'responsive_feedback' => 'Receptive to feedback',
        'follow_through' => 'Follow-through',
    ];

    private const SYSTEM_ISSUE_LABELS = [
        'lab_delay' => 'Lab delay',
        'imaging_delay' => 'Imaging delay',
        'staff_shortage' => 'Staff shortage',
        'bed_issue' => 'Bed issue',
        'emr_interruption' => 'EMR interruption',
        'communication_issue' => 'Communication issue',
    ];

    private const CONCERN_LABELS = [
        'punctuality' => 'Punctuality',
        'preparation' => 'Preparation',
        'medical_knowledge' => 'Medical knowledge',
        'clinical_reasoning' => 'Clinical reasoning',
        'documentation' => 'Documentation',
        'communication' => 'Communication',
        'professionalism' => 'Professionalism',
        'follow_through' => 'Follow-through',
        'time_management' => 'Time management',
    ];

    /**
     * Request-scoped memo: a single endpoint resolves one service instance and
     * reads the same filtered rows once. Keyed by the filter signature.
     *
     * @var array<string, Collection<int, Model>>
     */
    private array $rowsMemo = [];

    /**
     * @return array<string, mixed>
     */
    public function summary(AcademicAnalyticsFilters $filters): array
    {
        $rows = $this->rows($filters);
        $items = $this->scoreItems($filters->direction);
        $count = $rows->count();

        $indicatorCompliance = collect($items)->map(fn (string $item) => [
            'key' => Str::camel($item),
            'label' => $this->indicatorLabel($filters->direction, $item),
            'pct' => $count ? round($rows->avg(fn (Model $row) => $row->{$item} ? 100 : 0), 1) : 0.0,
        ])->values();

        $summary = [
            'direction' => $filters->direction,
            'evaluationCount' => $count,
            'averageScore' => $count ? round($rows->avg(fn (Model $row) => $this->rowScore($row, $items)), 1) : 0.0,
            'indicatorCompliance' => $indicatorCompliance,
        ];

        if ($filters->direction === 'resident') {
            $rated = $rows->filter(fn (Model $row) => $row->overall_rating !== null);
            $summary['avgOverallRating'] = $rated->count() ? round($rated->avg('overall_rating'), 2) : 0.0;
            $summary['issueFrequency'] = $this->issueFrequency($rows, 'concerns', $filters->direction);
        } else {
            $summary['seniorPresenceRate'] = $count ? round($rows->avg(fn (Model $row) => $row->senior_present ? 1 : 0), 2) : 0.0;
            $seen = $rows->filter(fn (Model $row) => $row->pct_patients_seen !== null);
            $summary['avgPctSeen'] = $seen->count() ? round($seen->avg('pct_patients_seen'), 1) : 0.0;
            $summary['issueFrequency'] = $this->issueFrequency($rows, 'system_issues', $filters->direction);
        }

        return $summary;
    }

    /**
     * @return array<string, mixed>
     */
    public function trend(AcademicAnalyticsFilters $filters): array
    {
        $rows = $this->rows($filters);
        $items = $this->scoreItems($filters->direction);
        $monthly = $filters->granularity === 'monthly';

        $buckets = [];
        foreach ($rows as $row) {
            $date = $row->evaluation_date;

            if ($monthly) {
                $key = $date->format('Y-m');
                $start = $date->copy()->startOfMonth()->toDateString();
            } else {
                $key = sprintf('%d-W%02d', $date->isoWeekYear, $date->isoWeek);
                $start = $date->copy()->startOfWeek()->toDateString();
            }

            $buckets[$key] ??= ['bucket' => $key, 'start' => $start, 'scores' => [], 'count' => 0];
            $buckets[$key]['scores'][] = $this->rowScore($row, $items);
            $buckets[$key]['count']++;
        }

        $points = collect($buckets)
            ->sortBy('start')
            ->map(fn (array $bucket) => [
                'bucket' => $bucket['bucket'],
                'start' => $bucket['start'],
                'averageScore' => $bucket['count'] ? round(array_sum($bucket['scores']) / $bucket['count'], 1) : 0.0,
                'count' => $bucket['count'],
            ])
            ->values()
            ->all();

        return [
            'direction' => $filters->direction,
            'granularity' => $filters->granularity,
            'points' => $points,
        ];
    }

    /**
     * @return array<string, mixed>
     */
    public function people(AcademicAnalyticsFilters $filters): array
    {
        $rows = $this->rows($filters);
        $items = $this->scoreItems($filters->direction);

        $people = $rows
            ->groupBy('subject_id')
            ->map(function (Collection $subjectRows, string $subjectId) use ($items) {
                $subject = $subjectRows->first()->subject;
                $count = $subjectRows->count();

                return [
                    'subjectId' => $subjectId,
                    'subjectName' => $subject?->full_name,
                    'homeWardName' => $subject?->homeWard?->name,
                    'evaluationCount' => $count,
                    'averageScore' => $count ? round($subjectRows->avg(fn (Model $row) => $this->rowScore($row, $items)), 1) : 0.0,
                ];
            })
            ->values()
            ->sortByDesc('averageScore')
            ->values()
            ->all();

        return [
            'direction' => $filters->direction,
            'people' => $people,
        ];
    }

    /**
     * @return Collection<int, Model>
     */
    private function rows(AcademicAnalyticsFilters $filters): Collection
    {
        $key = $filters->memoKey();

        if (isset($this->rowsMemo[$key])) {
            return $this->rowsMemo[$key];
        }

        $query = ($filters->direction === 'resident'
            ? ResidentEvaluation::query()
            : ConsultantEvaluation::query())
            ->with(['subject.homeWard']);

        if ($filters->wardId) {
            $query->where('ward_id', $filters->wardId);
        }
        if ($filters->subjectId) {
            $query->where('subject_id', $filters->subjectId);
        }
        if ($filters->dateFrom) {
            $query->whereDate('evaluation_date', '>=', $filters->dateFrom);
        }
        if ($filters->dateTo) {
            $query->whereDate('evaluation_date', '<=', $filters->dateTo);
        }

        return $this->rowsMemo[$key] = $query->orderBy('evaluation_date')->get();
    }

    /**
     * @return list<string>
     */
    private function scoreItems(string $direction): array
    {
        return $direction === 'resident'
            ? ResidentEvaluation::SCORE_ITEMS
            : ConsultantEvaluation::SCORE_ITEMS;
    }

    /**
     * @param  list<string>  $items
     */
    private function rowScore(Model $row, array $items): float
    {
        $total = count($items);

        if ($total === 0) {
            return 0.0;
        }

        $yes = 0;
        foreach ($items as $item) {
            if ((bool) $row->{$item}) {
                $yes++;
            }
        }

        return $yes / $total * 100;
    }

    /**
     * Expand a JSON multi-select column across all rows and count each value
     * (Pareto data, sorted by descending frequency).
     *
     * @param  Collection<int, Model>  $rows
     * @return list<array<string, mixed>>
     */
    private function issueFrequency(Collection $rows, string $field, string $direction): array
    {
        $counts = [];
        foreach ($rows as $row) {
            $values = $row->{$field} ?? [];
            if (! is_array($values)) {
                continue;
            }
            foreach ($values as $value) {
                $counts[$value] = ($counts[$value] ?? 0) + 1;
            }
        }

        arsort($counts);

        $result = [];
        foreach ($counts as $value => $count) {
            $result[] = [
                'value' => $value,
                'label' => $this->issueLabel($direction, (string) $value),
                'count' => $count,
            ];
        }

        return $result;
    }

    private function indicatorLabel(string $direction, string $key): string
    {
        $labels = $direction === 'resident' ? self::RESIDENT_INDICATOR_LABELS : self::CONSULTANT_INDICATOR_LABELS;

        return $labels[$key] ?? Str::headline($key);
    }

    private function issueLabel(string $direction, string $value): string
    {
        $labels = $direction === 'resident' ? self::CONCERN_LABELS : self::SYSTEM_ISSUE_LABELS;

        return $labels[$value] ?? Str::headline($value);
    }
}
