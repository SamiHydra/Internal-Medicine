<?php

namespace App\Services\Academic;

use App\Models\Evaluation;
use App\Support\Academic\EvaluationScoring;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Str;

/**
 * Academic analytics over the unified evaluations tables (V2 Phase 4).
 * Aggregation still folds in PHP (bounded by evaluation volume), but every
 * endpoint result sits behind a short content-stamp-keyed cache: the stamp is
 * max(updated_at)+count for the filtered window, so a new submission
 * naturally invalidates by changing the key, and idle dashboards never
 * re-fold the same rows. This is the one scaling-relevant work item in the
 * V2 expansion (guide 7.3): the EAV move multiplies the PHP-side folding.
 */
class AcademicAnalyticsService
{
    private const CACHE_TTL_SECONDS = 300;

    /**
     * Request-scoped memo: a single endpoint resolves one service instance and
     * reads the same filtered rows once. Keyed by the filter signature.
     *
     * @var array<string, Collection<int, Evaluation>>
     */
    private array $rowsMemo = [];

    /** @var array<string, array<string, string>> Label maps per form key, from the published form. */
    private array $labelsMemo = [];

    public function __construct(
        private readonly EvaluationFormService $forms,
    ) {}

    /**
     * @return array<string, mixed>
     */
    public function summary(AcademicAnalyticsFilters $filters): array
    {
        return $this->cached('summary', $filters, function () use ($filters): array {
            $rows = $this->rows($filters);
            $items = EvaluationScoring::itemsForDirection($filters->direction);
            $count = $rows->count();

            $indicatorCompliance = collect($items)->map(fn (string $item) => [
                'key' => Str::camel($item),
                'label' => $this->fieldLabel($filters->direction, $item),
                'pct' => $count ? round($rows->avg(fn (Evaluation $row) => $row->answer($item) ? 100 : 0), 1) : 0.0,
            ])->values();

            $summary = [
                'direction' => $filters->direction,
                'evaluationCount' => $count,
                'averageScore' => $count ? round($rows->avg(fn (Evaluation $row) => EvaluationScoring::score($row, $filters->direction)), 1) : 0.0,
                'indicatorCompliance' => $indicatorCompliance,
            ];

            if ($filters->direction === 'resident') {
                $rated = $rows->filter(fn (Evaluation $row) => $row->answer('overall_rating') !== null);
                $summary['avgOverallRating'] = $rated->count() ? round($rated->avg(fn (Evaluation $row) => (int) $row->answer('overall_rating')), 2) : 0.0;
                $summary['issueFrequency'] = $this->issueFrequency($rows, 'concerns', $filters->direction);
            } else {
                $summary['seniorPresenceRate'] = $count ? round($rows->avg(fn (Evaluation $row) => $row->answer('senior_present') ? 1 : 0), 2) : 0.0;
                $seen = $rows->filter(fn (Evaluation $row) => $row->answer('pct_patients_seen') !== null);
                $summary['avgPctSeen'] = $seen->count() ? round($seen->avg(fn (Evaluation $row) => (int) $row->answer('pct_patients_seen')), 1) : 0.0;
                $summary['issueFrequency'] = $this->issueFrequency($rows, 'system_issues', $filters->direction);
            }

            return $summary;
        });
    }

    /**
     * @return array<string, mixed>
     */
    public function trend(AcademicAnalyticsFilters $filters): array
    {
        return $this->cached('trend:'.$filters->granularity, $filters, function () use ($filters): array {
            $rows = $this->rows($filters);
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
                $buckets[$key]['scores'][] = EvaluationScoring::score($row, $filters->direction);
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
        });
    }

    /**
     * @return array<string, mixed>
     */
    public function people(AcademicAnalyticsFilters $filters): array
    {
        return $this->cached('people', $filters, function () use ($filters): array {
            $rows = $this->rows($filters);

            $people = $rows
                ->filter(fn (Evaluation $row) => $row->subject_user_id !== null)
                ->groupBy('subject_user_id')
                ->map(function (Collection $subjectRows, string $subjectId) use ($filters) {
                    $subject = $subjectRows->first()->subject;
                    $count = $subjectRows->count();

                    return [
                        'subjectId' => $subjectId,
                        'subjectName' => $subject?->full_name,
                        'homeWardName' => $subject?->homeWard?->name,
                        'evaluationCount' => $count,
                        'averageScore' => $count ? round($subjectRows->avg(fn (Evaluation $row) => EvaluationScoring::score($row, $filters->direction)), 1) : 0.0,
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
        });
    }

    /**
     * Short content-keyed cache (guide 7.3): the key carries a stamp of the
     * filtered window (max updated_at + row count), so a write is visible on
     * the very next read while unchanged data never re-folds. The TTL is only
     * a backstop against unreachable stale keys.
     *
     * @param  callable(): array<string, mixed>  $build
     * @return array<string, mixed>
     */
    private function cached(string $operation, AcademicAnalyticsFilters $filters, callable $build): array
    {
        $stampQuery = Evaluation::query()
            ->forKey(EvaluationScoring::formKeyForDirection($filters->direction));

        if ($filters->dateFrom) {
            $stampQuery->whereDate('evaluation_date', '>=', $filters->dateFrom);
        }
        if ($filters->dateTo) {
            $stampQuery->whereDate('evaluation_date', '<=', $filters->dateTo);
        }

        $stamp = $stampQuery
            ->selectRaw('count(*) as row_count, max(updated_at) as latest')
            ->first();

        $key = sprintf(
            'academic:analytics:%s:%s',
            $operation,
            md5($filters->memoKey().'|'.($stamp->row_count ?? 0).'|'.($stamp->latest ?? '')),
        );

        return Cache::remember($key, self::CACHE_TTL_SECONDS, $build);
    }

    /**
     * @return Collection<int, Evaluation>
     */
    private function rows(AcademicAnalyticsFilters $filters): Collection
    {
        $key = $filters->memoKey();

        if (isset($this->rowsMemo[$key])) {
            return $this->rowsMemo[$key];
        }

        $query = Evaluation::query()
            ->forKey(EvaluationScoring::formKeyForDirection($filters->direction))
            ->with(['subject.homeWard', 'answers']);

        if ($filters->wardId) {
            $query->where('ward_id', $filters->wardId);
        }
        if ($filters->subjectId) {
            $query->where('subject_user_id', $filters->subjectId);
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
     * Expand a multi-select answer across all rows and count each value
     * (Pareto data, sorted by descending frequency).
     *
     * @param  Collection<int, Evaluation>  $rows
     * @return list<array<string, mixed>>
     */
    private function issueFrequency(Collection $rows, string $field, string $direction): array
    {
        $counts = [];
        foreach ($rows as $row) {
            $values = $row->answer($field) ?? [];
            if (! is_array($values)) {
                continue;
            }
            foreach ($values as $value) {
                $counts[$value] = ($counts[$value] ?? 0) + 1;
            }
        }

        arsort($counts);

        $choiceLabels = $this->choiceLabels($direction, $field);

        $result = [];
        foreach ($counts as $value => $count) {
            $result[] = [
                'value' => $value,
                'label' => $choiceLabels[$value] ?? Str::headline((string) $value),
                'count' => $count,
            ];
        }

        return $result;
    }

    /** Labels come from the published form definition, not from code (guide 7.4). */
    private function fieldLabel(string $direction, string $fieldKey): string
    {
        return $this->formLabels($direction)[$fieldKey] ?? Str::headline($fieldKey);
    }

    /**
     * @return array<string, string>
     */
    private function formLabels(string $direction): array
    {
        $formKey = EvaluationScoring::formKeyForDirection($direction);

        return $this->labelsMemo[$formKey] ??= $this->forms->published($formKey)
            ->fields
            ->pluck('label', 'key')
            ->all();
    }

    /**
     * @return array<string, string>
     */
    private function choiceLabels(string $direction, string $fieldKey): array
    {
        $formKey = EvaluationScoring::formKeyForDirection($direction);
        $field = $this->forms->published($formKey)->fields->firstWhere('key', $fieldKey);

        $labels = [];
        foreach ($field?->options['choices'] ?? [] as $choice) {
            $labels[(string) $choice['value']] = (string) ($choice['label'] ?? $choice['value']);
        }

        return $labels;
    }
}
