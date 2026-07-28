<?php

namespace App\Services\Academic;

use App\Models\Evaluation;
use App\Models\EvaluationFormField;
use App\Services\Academic\Concerns\CachesByContentStamp;
use App\Support\Academic\EvaluationScoring;
use Illuminate\Support\Collection;
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
    use CachesByContentStamp;

    /**
     * Leaderboard rank = a normalised blend of two signals measured on
     * different scales. The 1-to-5 overall rating (holistic judgement) is
     * mapped onto 0-100 (rating / 5 * 100) so it shares the indicator score's
     * scale, then the two are averaged with these weights. Equal weight by
     * default: leadership can retune here without touching the blend logic.
     * Kept in code (not an admin setting) so a single edit is the whole change;
     * promote to AppSettings only if runtime tuning is actually needed.
     */
    private const RATING_WEIGHT = 0.5;

    private const RATING_MAX = 5;

    /**
     * A person with fewer than this many evaluations is still listed and still
     * ranked, but flagged `provisional` so the UI can mark that thin evidence -
     * one 100% evaluation must not read as a settled #1.
     */
    private const MIN_EVALUATIONS_FOR_RANK = 3;

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
            $items = EvaluationScoring::activeItems(
                $this->forms->published(EvaluationScoring::formKeyForDirection($filters->direction)),
                $filters->direction,
            );
            $count = $rows->count();

            $indicatorCompliance = collect($items)->map(fn (string $item) => [
                'key' => Str::camel($item),
                'label' => $this->fieldLabel($filters->direction, $item),
                'pct' => $count ? round($rows->avg(fn (Evaluation $row) => $row->answer($item) ? 100 : 0), 1) : 0.0,
            ])->values()->all();

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

                    // Indicator score: % of the direction's yes/no items true,
                    // averaged over every evaluation the person received.
                    $scorePct = $count
                        ? round($subjectRows->avg(fn (Evaluation $row) => EvaluationScoring::score($row, $filters->direction)), 1)
                        : 0.0;

                    // Rating: averaged over ONLY the evaluations that carry a
                    // 1-to-5 rating. New submissions always do (the field is
                    // mandatory now), but legacy consultant rows predate it, so
                    // a person can have fewer rated rows than total.
                    $ratedRows = $subjectRows->filter(fn (Evaluation $row) => $row->answer('overall_rating') !== null);
                    $ratedCount = $ratedRows->count();
                    $ratingAverage = $ratedCount
                        ? round($ratedRows->avg(fn (Evaluation $row) => (int) $row->answer('overall_rating')), 2)
                        : null;
                    $ratingPct = $ratingAverage !== null
                        ? round($ratingAverage / self::RATING_MAX * 100, 1)
                        : null;

                    // Combined rank value: equal-weight blend once both halves
                    // exist on the same 0-100 scale. With no ratings yet the
                    // blend degrades to score-only rather than dragging the
                    // person down with a phantom zero.
                    $combined = $ratingPct !== null
                        ? round(self::RATING_WEIGHT * $ratingPct + (1 - self::RATING_WEIGHT) * $scorePct, 1)
                        : $scorePct;

                    return [
                        'subjectId' => $subjectId,
                        'subjectName' => $subject?->full_name,
                        'homeWardName' => $subject?->homeWard?->name,
                        'evaluationCount' => $count,
                        // Kept for back-compat and the score column.
                        'averageScore' => $scorePct,
                        'ratingAverage' => $ratingAverage,
                        'ratingScore' => $ratingPct,
                        'ratedCount' => $ratedCount,
                        'combinedScore' => $combined,
                        'provisional' => $count < self::MIN_EVALUATIONS_FOR_RANK,
                    ];
                })
                ->values()
                // Rank by the blended value. Tie-break on evaluation count so a
                // better-evidenced person edges out a thin one at equal score,
                // giving a stable, deterministic order.
                ->sortBy([
                    ['combinedScore', 'desc'],
                    ['evaluationCount', 'desc'],
                    ['subjectName', 'asc'],
                ])
                ->values()
                ->all();

            return [
                'direction' => $filters->direction,
                'ratingWeight' => self::RATING_WEIGHT,
                'minEvaluationsForRank' => self::MIN_EVALUATIONS_FOR_RANK,
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

        $publishedForm = $this->forms->published(EvaluationScoring::formKeyForDirection($filters->direction));
        $formStamp = $this->contentStamp(EvaluationFormField::query()->where('form_id', $publishedForm->id));

        return $this->rememberByStamp(
            'academic:analytics',
            $operation,
            $filters->memoKey().'|'.$this->contentStamp($stampQuery).'|'.$formStamp,
            $build,
        );
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
            ->with(['subject.homeWard', 'answers', 'form.fields']);

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
