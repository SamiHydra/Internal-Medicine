<?php

namespace Database\Seeders;

use App\Models\ReportingPeriod;
use Carbon\CarbonImmutable;
use Carbon\CarbonInterface;
use Illuminate\Database\Seeder;

class ReportingPeriodSeeder extends Seeder
{
    public function run(): void
    {
        $firstWeek = CarbonImmutable::now('UTC')
            ->startOfWeek(CarbonInterface::MONDAY)
            ->subWeeks(52);

        // Keep one full year of history for realistic analytics/load testing and
        // six months ahead so upcoming reporting periods are already available.
        for ($offset = 0; $offset <= 78; $offset++) {
            $weekStart = $firstWeek->addWeeks($offset);
            $weekStartDate = $weekStart->toDateString();
            $period = ReportingPeriod::query()
                ->whereDate('week_start', $weekStartDate)
                ->first() ?? new ReportingPeriod(['week_start' => $weekStartDate]);

            $period->fill([
                'week_end' => $weekStart->addDays(6)->toDateString(),
                // Match the canonical deadline formula used live by
                // ReportingPeriodService::periodPayload and the weekly
                // reports:ensure-periods command (week_start + weekday offset,
                // default Monday 10:00) so seed data never disagrees with what
                // the running system computes.
                'deadline_at' => $weekStart->setTime(10, 0),
                'month_label' => $weekStart->format('M Y'),
                'quarter_label' => sprintf('Q%d %d', $weekStart->quarter, $weekStart->year),
                'year_num' => $weekStart->year,
            ])->save();
        }
    }
}
