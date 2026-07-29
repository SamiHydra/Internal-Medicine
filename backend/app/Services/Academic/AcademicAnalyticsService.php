<?php

namespace App\Services\Academic;

use App\Jobs\WarmAcademicAnalytics;
use App\Models\Evaluation;
use App\Models\EvaluationForm;
use App\Models\EvaluationFormField;
use App\Services\Academic\Concerns\CachesByContentStamp;
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
    use CachesByContentStamp;

    private const RECENT_FILTERS_KEY = 'academic:analytics:recent-filters';

    private const RECENT_FILTERS_TTL_SECONDS = 1800;

    private const RECENT_FILTERS_MAX = 12;

    private const WARM_MAX = 3;

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

    /** @var array<string, array<string, mixed>> */
    private array $snapshotMemo = [];

    /** @var array<string, array<string, string>> Label maps per form key, from the published form. */
    private array $labelsMemo = [];

    private bool $warmScheduled = false;

    public function __construct(
        private readonly EvaluationFormService $forms,
    ) {}

    /**
     * @return array<string, mixed>
     */
    public function snapshot(AcademicAnalyticsFilters $filters): array
    {
        $memoKey = $filters->memoKey().'|'.$filters->granularity;

        if (isset($this->snapshotMemo[$memoKey])) {
            return $this->snapshotMemo[$memoKey];
        }

        $publishedForm = $this->forms->published(
            EvaluationScoring::formKeyForDirection($filters->direction),
        );

        return $this->snapshotMemo[$memoKey] = $this->cachedSnapshot(
            $filters,
            $publishedForm,
            function () use ($filters, $publishedForm): array {
                $this->rememberFilters($filters);

                // The leaderboard must remain unfiltered when the user drills into
                // one person. Hydrate the shared base graph once, then derive the
                // selected-person view in memory for summary and trend.
                $baseRows = $this->rows($filters);
                $selectedRows = $filters->subjectId
                    ? $baseRows->where('subject_user_id', $filters->subjectId)->values()
                    : $baseRows;
                $items = EvaluationScoring::activeItems($publishedForm, $filters->direction);
                $scores = $this->scores($baseRows, $items);

                return [
                    'summary' => $this->buildSummary($filters, $selectedRows, $items, $scores, $publishedForm),
                    'trend' => $this->buildTrend($filters, $selectedRows, $scores),
                    'people' => $this->buildPeople($filters, $baseRows, $scores),
                ];
            },
        );
    }

    /**
     * @return array<string, mixed>
     */
    public function summary(AcademicAnalyticsFilters $filters): array
    {
        return $this->snapshot($filters)['summary'];
    }

    /**
     * @return array<string, mixed>
     */
    public function trend(AcademicAnalyticsFilters $filters): array
    {
        return $this->snapshot($filters)['trend'];
    }

    /**
     * @return array<string, mixed>
     */
    public function people(AcademicAnalyticsFilters $filters): array
    {
        return $this->snapshot($filters)['people'];
    }

    /**
     * Queue a bounded warm of recently viewed snapshots after a successful
     * evaluation write. Never perform this optional work on a sync queue.
     */
    public function scheduleWarm(): void
    {
        if ($this->warmScheduled || config('queue.default') === 'sync') {
            return;
        }

        $this->warmScheduled = true;
        WarmAcademicAnalytics::dispatch()->afterCommit();
    }

    public function warm(): void
    {
        $lock = Cache::lock('academic:analytics:warm', 30);

        if (! $lock->get()) {
            return;
        }

        try {
            $recent = Cache::get(self::RECENT_FILTERS_KEY);

            if (! is_array($recent)) {
                return;
            }

            foreach (array_slice($recent, 0, self::WARM_MAX) as $entry) {
                if (! is_array($entry)) {
                    continue;
                }

                $this->snapshot(AcademicAnalyticsFilters::fromArray($entry));
            }
        } finally {
            $lock->release();
        }
    }

    /**
     * Short content-keyed cache: one payload contains every academic dashboard
     * view for a filter set. The content stamp keeps writes visible on the next
     * read; the lock collapses concurrent misses to one graph hydration.
     *
     * @param  callable(): array<string, mixed>  $build
     * @return array<string, mixed>
     */
    private function cachedSnapshot(
        AcademicAnalyticsFilters $filters,
        EvaluationForm $publishedForm,
        callable $build,
    ): array {
        $stampQuery = Evaluation::query()
            ->forKey(EvaluationScoring::formKeyForDirection($filters->direction));

        if ($filters->wardId) {
            $stampQuery->where('ward_id', $filters->wardId);
        }
        if ($filters->dateFrom) {
            $stampQuery->whereDate('evaluation_date', '>=', $filters->dateFrom);
        }
        if ($filters->dateTo) {
            $stampQuery->whereDate('evaluation_date', '<=', $filters->dateTo);
        }

        $formStamp = $this->contentStamp(EvaluationFormField::query()->where('form_id', $publishedForm->id));

        return $this->rememberByStampLocked(
            'academic:analytics',
            'snapshot:'.$filters->granularity,
            $filters->memoKey().'|'.$this->contentStamp($stampQuery).'|'.$publishedForm->id.'|'.$formStamp,
            $build,
        );
    }

    private function rememberFilters(AcademicAnalyticsFilters $filters): void
    {
        $payload = $filters->toArray();
        $fingerprint = md5(json_encode($payload));
        $recent = Cache::get(self::RECENT_FILTERS_KEY);
        $recent = is_array($recent) ? $recent : [];
        $recent = array_values(array_filter(
            $recent,
            fn ($entry): bool => is_array($entry) && md5(json_encode($entry)) !== $fingerprint,
        ));

        array_unshift($recent, $payload);

        Cache::put(
            self::RECENT_FILTERS_KEY,
            array_slice($recent, 0, self::RECENT_FILTERS_MAX),
            self::RECENT_FILTERS_TTL_SECONDS,
        );
    }

    /**
     * @return Collection<int, Evaluation>
     */
    private function rows(AcademicAnalyticsFilters $filters): Collection
    {
        $key = implode('|', [
            $filters->direction,
            $filters->wardId ?? '',
            $filters->dateFrom ?? '',
            $filters->dateTo ?? '',
        ]);

        if (isset($this->rowsMemo[$key])) {
            return $this->rowsMemo[$key];
        }

        $query = Evaluation::query()
            ->forKey(EvaluationScoring::formKeyForDirection($filters->direction))
            ->with(['subject.homeWard', 'answers', 'form.fields']);

        if ($filters->wardId) {
            $query->where('ward_id', $filters->wardId);
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
     * @param  Collection<int, Evaluation>  $rows
     * @param  list<string>  $items
     * @param  array<string, float>  $scores
     * @return array<string, mixed>
     */
    private function buildSummary(
        AcademicAnalyticsFilters $filters,
        Collection $rows,
        array $items,
        array $scores,
        EvaluationForm $publishedForm,
    ): array {
        $count = $rows->count();

        $indicatorCompliance = collect($items)->map(fn (string $item): array => [
            'key' => Str::camel($item),
            'label' => $this->fieldLabel($filters->direction, $item, $publishedForm),
            'pct' => $count ? round($rows->avg(fn (Evaluation $row) => $row->answer($item) ? 100 : 0), 1) : 0.0,
        ])->values()->all();

        $summary = [
            'direction' => $filters->direction,
            'evaluationCount' => $count,
            'averageScore' => $count ? round($rows->avg(fn (Evaluation $row) => $scores[$row->id]), 1) : 0.0,
            'indicatorCompliance' => $indicatorCompliance,
        ];

        if ($filters->direction === 'resident') {
            $rated = $rows->filter(fn (Evaluation $row) => $row->answer('overall_rating') !== null);
            $summary['avgOverallRating'] = $rated->count() ? round($rated->avg(fn (Evaluation $row) => (int) $row->answer('overall_rating')), 2) : 0.0;
            $summary['issueFrequency'] = $this->issueFrequency($rows, 'concerns', $publishedForm);
        } else {
            $summary['seniorPresenceRate'] = $count ? round($rows->avg(fn (Evaluation $row) => $row->answer('senior_present') ? 1 : 0), 2) : 0.0;
            $seen = $rows->filter(fn (Evaluation $row) => $row->answer('pct_patients_seen') !== null);
            $summary['avgPctSeen'] = $seen->count() ? round($seen->avg(fn (Evaluation $row) => (int) $row->answer('pct_patients_seen')), 1) : 0.0;
            $summary['issueFrequency'] = $this->issueFrequency($rows, 'system_issues', $publishedForm);
        }

        return $summary;
    }

    /**
     * @param  Collection<int, Evaluation>  $rows
     * @param  array<string, float>  $scores
     * @return array<string, mixed>
     */
    private function buildTrend(AcademicAnalyticsFilters $filters, Collection $rows, array $scores): array
    {
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
            $buckets[$key]['scores'][] = $scores[$row->id];
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
     * @param  Collection<int, Evaluation>  $rows
     * @param  array<string, float>  $scores
     * @return array<string, mixed>
     */
    private function buildPeople(AcademicAnalyticsFilters $filters, Collection $rows, array $scores): array
    {
        $people = $rows
            ->filter(fn (Evaluation $row) => $row->subject_user_id !== null)
            ->groupBy('subject_user_id')
            ->map(function (Collection $subjectRows, string $subjectId) use ($scores) {
                $subject = $subjectRows->first()->subject;
                $count = $subjectRows->count();
                $scorePct = $count
                    ? round($subjectRows->avg(fn (Evaluation $row) => $scores[$row->id]), 1)
                    : 0.0;
                $ratedRows = $subjectRows->filter(fn (Evaluation $row) => $row->answer('overall_rating') !== null);
                $ratedCount = $ratedRows->count();
                $ratingAverage = $ratedCount
                    ? round($ratedRows->avg(fn (Evaluation $row) => (int) $row->answer('overall_rating')), 2)
                    : null;
                $ratingPct = $ratingAverage !== null
                    ? round($ratingAverage / self::RATING_MAX * 100, 1)
                    : null;
                $combined = $ratingPct !== null
                    ? round(self::RATING_WEIGHT * $ratingPct + (1 - self::RATING_WEIGHT) * $scorePct, 1)
                    : $scorePct;

                return [
                    'subjectId' => $subjectId,
                    'subjectName' => $subject?->full_name,
                    'homeWardName' => $subject?->homeWard?->name,
                    'evaluationCount' => $count,
                    'averageScore' => $scorePct,
                    'ratingAverage' => $ratingAverage,
                    'ratingScore' => $ratingPct,
                    'ratedCount' => $ratedCount,
                    'combinedScore' => $combined,
                    'provisional' => $count < self::MIN_EVALUATIONS_FOR_RANK,
                ];
            })
            ->values()
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
    }

    /**
     * Compute each evaluation's score once for every snapshot consumer.
     *
     * @param  Collection<int, Evaluation>  $rows
     * @param  list<string>  $items
     * @return array<string, float>
     */
    private function scores(Collection $rows, array $items): array
    {
        $total = count($items);

        return $rows->mapWithKeys(function (Evaluation $row) use ($items, $total): array {
            if ($total === 0) {
                return [$row->id => 0.0];
            }

            $yes = 0;
            foreach ($items as $item) {
                if ((bool) $row->answer($item)) {
                    $yes++;
                }
            }

            return [$row->id => $yes / $total * 100];
        })->all();
    }

    /**
     * Expand a multi-select answer across all rows and count each value
     * (Pareto data, sorted by descending frequency).
     *
     * @param  Collection<int, Evaluation>  $rows
     * @return list<array<string, mixed>>
     */
    private function issueFrequency(
        Collection $rows,
        string $field,
        EvaluationForm $publishedForm,
    ): array {
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

        $choiceLabels = $this->choiceLabels($field, $publishedForm);

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
    private function fieldLabel(string $direction, string $fieldKey, EvaluationForm $publishedForm): string
    {
        return $this->formLabels($direction, $publishedForm)[$fieldKey] ?? Str::headline($fieldKey);
    }

    /**
     * @return array<string, string>
     */
    private function formLabels(string $direction, EvaluationForm $publishedForm): array
    {
        $formKey = EvaluationScoring::formKeyForDirection($direction);

        return $this->labelsMemo[$formKey] ??= $publishedForm->fields
            ->pluck('label', 'key')
            ->all();
    }

    /**
     * @return array<string, string>
     */
    private function choiceLabels(string $fieldKey, EvaluationForm $publishedForm): array
    {
        $field = $publishedForm->fields->firstWhere('key', $fieldKey);

        $labels = [];
        foreach ($field?->options['choices'] ?? [] as $choice) {
            $labels[(string) $choice['value']] = (string) ($choice['label'] ?? $choice['value']);
        }

        return $labels;
    }
}
