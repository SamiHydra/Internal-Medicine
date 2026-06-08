<?php

namespace App\Support\Reports;

use App\Models\ReportingPeriod;
use Illuminate\Support\Carbon;
use Illuminate\Support\Collection;

class ReportPeriodWindow
{
    public const DEFAULT_WINDOW = 'default';
    public const ALL_WINDOW = 'all';

    private const LIVE_REPORTING_START = '2026-03-02';
    private const DEFAULT_PERIOD_COUNT = 9;
    private const MAX_PERIOD_COUNT = 104;

    private static function defaultCount(): int
    {
        return max(1, (int) config('reports.window.default_count', self::DEFAULT_PERIOD_COUNT));
    }

    /**
     * Hard ceiling on how many periods any single payload may span — applied even
     * to the "all" window so the unpaginated workspace response stays bounded as
     * history accumulates.
     */
    private static function maxCount(): int
    {
        return max(self::defaultCount(), (int) config('reports.window.max_count', self::MAX_PERIOD_COUNT));
    }

    /**
     * @param  Collection<int, ReportingPeriod>  $periods
     * @return array<int, string>
     */
    public static function ids(Collection $periods, string $window = self::DEFAULT_WINDOW): array
    {
        if ($periods->isEmpty()) {
            return [];
        }

        $sortedPeriods = $periods
            ->sortBy(fn (ReportingPeriod $period) => $period->week_start?->timestamp ?? 0)
            ->values();
        $today = Carbon::today();
        $currentPeriod = $sortedPeriods
            ->filter(fn (ReportingPeriod $period): bool => $period->week_start?->lte($today) ?? false)
            ->last() ?? $sortedPeriods->first();
        $currentStart = $currentPeriod->week_start;
        $liveStart = Carbon::parse(self::LIVE_REPORTING_START);

        $visiblePeriods = $sortedPeriods
            ->filter(fn (ReportingPeriod $period): bool => ($period->week_start?->betweenIncluded($liveStart, $currentStart)) ?? false)
            ->values();

        // Even "all" is capped at maxCount() periods so the workspace payload can
        // never grow without bound; "default" loads only the most recent window.
        $count = $window === self::ALL_WINDOW ? self::maxCount() : self::defaultCount();

        return $visiblePeriods
            ->slice(max(0, $visiblePeriods->count() - $count))
            ->pluck('id')
            ->all();
    }
}
