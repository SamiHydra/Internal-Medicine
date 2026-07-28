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
     * The live start is configurable (a local fixture may seed history older
     * than the real go-live date). Pin it for every test here so these assert
     * the WINDOW's behaviour and never inherit whatever a developer has set in
     * their own environment.
     */
    protected function setUp(): void
    {
        parent::setUp();

        config(['reports.window.live_start' => '2026-03-02']);
    }

    /**
     * Builds in-memory (unsaved) reporting periods starting from $start, one per
     * week, with deterministic ids. No database is touched.
     */
    private function periods(int $count, string $start = '2026-03-16'): Collection
    {
        return collect(range(0, $count - 1))->map(function (int $offset) use ($start): ReportingPeriod {
            $weekStart = Carbon::parse($start)->addWeeks($offset);
            $period = new ReportingPeriod;
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

            // Default count is 9 (config/reports.php), the most recent 9 of 12.
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
            // First two weeks fall before the live start (2026-03-02).
            $periods = $this->periods(6, '2026-02-16');
            $ids = ReportPeriodWindow::ids($periods, ReportPeriodWindow::ALL_WINDOW);

            $this->assertNotContains('period-000', $ids); // 2026-02-16
            $this->assertNotContains('period-001', $ids); // 2026-02-23
            $this->assertContains('period-002', $ids);     // 2026-03-02 (live start)
        } finally {
            Carbon::setTestNow();
        }
    }

    public function test_configured_live_start_widens_the_visible_history(): void
    {
        Carbon::setTestNow('2026-06-08 12:00:00');

        try {
            $periods = $this->periods(6, '2026-02-16');

            // Moving the live start earlier exposes the weeks the default hid,
            // which is how a seeded multi-year archive becomes browsable.
            config(['reports.window.live_start' => '2026-02-16']);
            $ids = ReportPeriodWindow::ids($periods, ReportPeriodWindow::ALL_WINDOW);

            $this->assertContains('period-000', $ids);
            $this->assertContains('period-001', $ids);
        } finally {
            Carbon::setTestNow();
        }
    }

    public function test_the_week_starting_today_is_included_on_its_first_day(): void
    {
        // 2026-07-27 is a Monday: the reporting week starts today. The hospital
        // timezone puts its midnight BEFORE the period's UTC date, so comparing
        // instants used to drop the open week for the whole of its first day.
        Carbon::setTestNow('2026-07-27 09:00:00');

        try {
            $ids = ReportPeriodWindow::ids(
                $this->periods(4, '2026-07-06'),
                ReportPeriodWindow::DEFAULT_WINDOW,
            );

            $this->assertContains('period-003', $ids); // week beginning 2026-07-27
        } finally {
            Carbon::setTestNow();
        }
    }

    public function test_blank_live_start_config_falls_back_to_the_go_live_default(): void
    {
        Carbon::setTestNow('2026-06-08 12:00:00');

        try {
            // An unset or empty env var must not be read as "no floor at all".
            config(['reports.window.live_start' => null]);
            $ids = ReportPeriodWindow::ids($this->periods(6, '2026-02-16'), ReportPeriodWindow::ALL_WINDOW);

            $this->assertNotContains('period-000', $ids);
            $this->assertContains('period-002', $ids);
        } finally {
            Carbon::setTestNow();
        }
    }
}
