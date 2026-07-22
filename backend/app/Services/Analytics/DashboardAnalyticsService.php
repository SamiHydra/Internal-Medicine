<?php

namespace App\Services\Analytics;

use Illuminate\Contracts\Cache\LockTimeoutException;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Str;

class DashboardAnalyticsService
{
    private const CACHE_VERSION_KEY = 'analytics:dashboard:version';

    // Every application write that can affect analytics explicitly rotates the
    // version. The TTL is a backstop for old, unreachable payloads rather than a
    // reason to repeatedly scan source tables on every cache hit.
    private const CACHE_TTL_SECONDS = 1800;

    // Version-independent registry of the filter sets recently requested by the
    // dashboard. A write rotates the version (making every cached aggregate a
    // miss); the next viewer would otherwise pay the full cold build. After the
    // write's response is sent we replay these filter sets so the aggregates the
    // team is actually looking at are rebuilt off the request critical path.
    private const RECENT_FILTERS_KEY = 'analytics:dashboard:recent-filters';

    private const RECENT_FILTERS_TTL_SECONDS = 1800;

    // How many distinct filter sets to remember, and how many of the most-recent
    // of those to rebuild after a write. Warming is bounded so a single save can
    // never schedule unbounded post-response work on shared hosting.
    private const RECENT_FILTERS_MAX = 12;

    private const WARM_MAX = 3;

    // Dedupe terminating callbacks within one request: many mutations call
    // invalidate() more than once (e.g. save + status change), but one warm pass
    // after the response is enough.
    private bool $warmScheduled = false;

    public function __construct(
        private readonly AnalyticsService $analytics,
    ) {}

    /**
     * @return array<string, mixed>
     */
    public function summary(AnalyticsFilters $filters): array
    {
        $this->rememberFilters($filters);

        $cacheKey = $this->cacheKey($filters);
        $cached = Cache::get($cacheKey);

        if (is_array($cached)) {
            return $cached;
        }

        // Only one PHP worker should build a missing aggregate. Without this
        // lock, a cache expiry or invalidation makes every concurrent dashboard
        // request hydrate and aggregate the same field-value set, causing the
        // intermittent latency spikes users saw under normal multi-user load.
        try {
            return Cache::lock($cacheKey.':build', 30)->block(10, function () use ($cacheKey, $filters): array {
                $cached = Cache::get($cacheKey);

                if (is_array($cached)) {
                    return $cached;
                }

                $payload = $this->buildSummary($filters);
                Cache::put($cacheKey, $payload, self::CACHE_TTL_SECONDS);

                return $payload;
            });
        } catch (LockTimeoutException) {
            // A crashed/paused worker must not leave graphs unavailable. Recheck
            // after the wait, then build as a bounded fallback if necessary.
            $cached = Cache::get($cacheKey);

            if (is_array($cached)) {
                return $cached;
            }

            $payload = $this->buildSummary($filters);
            Cache::put($cacheKey, $payload, self::CACHE_TTL_SECONDS);

            return $payload;
        }
    }

    public function invalidate(): void
    {
        // Versioning makes every existing aggregate unreachable immediately.
        // Let old entries expire naturally instead of synchronously deleting up
        // to 100 large cache rows during a report save.
        Cache::forget(self::CACHE_VERSION_KEY);
        Cache::forever(self::CACHE_VERSION_KEY, (string) Str::uuid());

        $this->scheduleWarmAfterResponse();
    }

    /**
     * Rebuild the most-recently-requested dashboard aggregates so that the next
     * viewer gets a warm cache hit instead of a multi-second cold build. Safe to
     * call any time: it only ever rebuilds with current source data (so the
     * "fresh after a write" contract still holds) and is bounded by WARM_MAX. A
     * non-blocking lock collapses concurrent warms (e.g. several saves in a row)
     * to a single rebuild pass.
     */
    public function warm(): void
    {
        $lock = Cache::lock('analytics:dashboard:warm', 30);

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

                $filters = AnalyticsFilters::fromArray($entry);
                $cacheKey = $this->cacheKey($filters);

                // Only build slices that are actually cold; a still-warm slice
                // (e.g. warmed by an earlier pass) needs no work.
                if (is_array(Cache::get($cacheKey))) {
                    continue;
                }

                Cache::put($cacheKey, $this->buildSummary($filters), self::CACHE_TTL_SECONDS);
            }
        } finally {
            $lock->release();
        }
    }

    private function scheduleWarmAfterResponse(): void
    {
        // Warming is a latency optimisation, not a correctness mechanism: the
        // cold-build-on-miss path already returns fresh data. Skipping it under
        // the test runner keeps feature tests deterministic (they assert the
        // fresh-after-write contract directly); warm() is covered on its own.
        if ($this->warmScheduled || app()->runningUnitTests()) {
            return;
        }

        $this->warmScheduled = true;

        app()->terminating(function (): void {
            try {
                $this->warm();
            } catch (\Throwable $exception) {
                report($exception);
            }
        });
    }

    /**
     * Record this filter set in the version-independent recent registry (most
     * recent first, de-duplicated, capped). Stored as the same array the cache
     * key is derived from so warm() can faithfully reconstruct the request.
     */
    private function rememberFilters(AnalyticsFilters $filters): void
    {
        $payload = $this->filterPayload($filters);
        $fingerprint = md5(json_encode($payload));

        $recent = Cache::get(self::RECENT_FILTERS_KEY);
        $recent = is_array($recent) ? $recent : [];

        $recent = array_values(array_filter(
            $recent,
            fn ($entry): bool => is_array($entry) && md5(json_encode($entry)) !== $fingerprint,
        ));

        array_unshift($recent, $payload);
        $recent = array_slice($recent, 0, self::RECENT_FILTERS_MAX);

        Cache::put(self::RECENT_FILTERS_KEY, $recent, self::RECENT_FILTERS_TTL_SECONDS);
    }

    private function version(): string
    {
        $version = Cache::get(self::CACHE_VERSION_KEY);

        if (is_string($version) && $version !== '') {
            return $version;
        }

        $version = (string) Str::uuid();
        Cache::forever(self::CACHE_VERSION_KEY, $version);

        return $version;
    }

    private function cacheKey(AnalyticsFilters $filters): string
    {
        return 'analytics:dashboard:'.$this->version().':'.md5(json_encode($this->filterPayload($filters)));
    }

    /**
     * The canonical, snake_cased filter array. Used both to key the cache and to
     * persist the recent registry, and it round-trips through
     * AnalyticsFilters::fromArray() so warm() reconstructs the identical key.
     *
     * @return array<string, mixed>
     */
    private function filterPayload(AnalyticsFilters $filters): array
    {
        return [
            'period_id' => $filters->periodId,
            'week_start' => $filters->weekStart,
            'month' => $filters->month,
            'year' => $filters->year,
            'date_from' => $filters->dateFrom,
            'date_to' => $filters->dateTo,
            'department' => $filters->department,
            'ward' => $filters->ward,
            'family' => $filters->family,
            'report_type' => $filters->reportType,
            'procedure_category' => $filters->procedureCategory,
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private function buildSummary(AnalyticsFilters $filters): array
    {
        $this->analytics->flushMemo();

        // Hydrate reports and their field values once. The previous implementation
        // loaded outpatient and procedure reports separately, then loaded every
        // report again for overview(), and finally loaded inpatient reports. With
        // real report forms this duplicated thousands of Eloquent models per cold
        // request. Family summaries can safely share filtered views of the same
        // non-mutating collection.
        $reports = $this->analytics->reports($filters);
        $reportsByFamily = collect(['inpatient', 'outpatient', 'procedure'])
            ->mapWithKeys(fn (string $family): array => [
                $family => $reports
                    ->filter(fn ($report): bool => $report->department?->family === $family)
                    ->values(),
            ]);
        $inpatientReports = $reportsByFamily->get('inpatient', collect());
        $outpatientReports = $reportsByFamily->get('outpatient', collect());
        $procedureReports = $reportsByFamily->get('procedure', collect());

        return [
            'generatedAt' => now()->toJSON(),
            'scope' => $this->analytics->scope($filters),
            'overview' => $this->analytics->overview($filters, $reports),
            'families' => [
                'inpatient' => $this->analytics->familySummary('inpatient', $filters, $inpatientReports),
                'outpatient' => [
                    ...$this->analytics->familySummary('outpatient', $filters, $outpatientReports),
                    'outpatient' => $this->analytics->outpatientExtras($outpatientReports),
                ],
                'procedure' => [
                    ...$this->analytics->familySummary('procedure', $filters, $procedureReports),
                    'procedures' => $this->analytics->procedureExtras($procedureReports),
                ],
            ],
        ];
    }
}
