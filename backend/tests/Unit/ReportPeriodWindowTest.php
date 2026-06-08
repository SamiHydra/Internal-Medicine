<?php

namespace Tests\Unit;

use App\Models\ReportingPeriod;
use App\Support\Reports\ReportPeriodWindow;
use Illuminate\Support\Carbon;
use Illuminate\Support\Collection;
use Tests\TestCase;

class ReportPeriodWindowTest extends TestCase
{
    /**
     * Builds in-memory (unsaved) reporting periods starting from $start, one per
     * week, with deterministic ids. No database is touched.
     */
    private function periods(int $count, string $start = '2026-03-16'): Collection
    {
        return collect(range(0, $count - 1))->map(function (int $offset) use ($start): ReportingPeriod {
            $weekStart = Carbon::parse($start)->addWeeks($offset);
            $period = new ReportingPeriod();
            $period->forceFill([
                'id' => sprintf('period-%03d', $offset),
                'week_start' => $weekStart,
                'week_end' => $weekStart->copy()->addDays(6),
            ]);

            return $period;
        });
    }

    public function test_empty_input_returns_no_ids(): void
    {
        $this->assertSame([], ReportPeriodWindow::ids(collect()));
    }

    public function test_default_window_returns_only_the_recent_period_count(): void
    {
        Carbon::setTestNow('2026-06-08 12:00:00');

        try {
            $ids = ReportPeriodWindow::ids($this->periods(12), ReportPeriodWindow::DEFAULT_WINDOW);

            // Default count is 9 (config/reports.php) — the most recent 9 of 12.
            $this->assertCount(9, $ids);
            $this->assertSame('period-011', $ids[array_key_last($ids)]);
            $this->assertNotContains('period-000', $ids);
        } finally {
            Carbon::setTestNow();
        }
    }

    public function test_all_window_is_capped_at_max_period_count(): void
    {
        Carbon::setTestNow('2028-06-08 12:00:00');

        try {
            // 110 weeks exceeds the 104 hard ceiling for the "all" window.
            $ids = ReportPeriodWindow::ids($this->periods(110), ReportPeriodWindow::ALL_WINDOW);

            $this->assertCount(104, $ids);
            // The cap keeps the most recent periods, dropping the oldest.
            $this->assertNotContains('period-000', $ids);
            $this->assertContains('period-109', $ids);
        } finally {
            Carbon::setTestNow();
        }
    }

    public function test_periods_before_the_live_start_are_excluded(): void
    {
        Carbon::setTestNow('2026-06-08 12:00:00');

        try {
            // First two weeks fall before LIVE_REPORTING_START (2026-03-02).
            $periods = $this->periods(6, '2026-02-16');
            $ids = ReportPeriodWindow::ids($periods, ReportPeriodWindow::ALL_WINDOW);

            $this->assertNotContains('period-000', $ids); // 2026-02-16
            $this->assertNotContains('period-001', $ids); // 2026-02-23
            $this->assertContains('period-002', $ids);     // 2026-03-02 (live start)
        } finally {
            Carbon::setTestNow();
        }
    }
}
