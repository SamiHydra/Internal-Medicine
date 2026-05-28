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
            ->subWeeks(26);

        for ($offset = 0; $offset <= 52; $offset++) {
            $weekStart = $firstWeek->addWeeks($offset);

            ReportingPeriod::query()->updateOrCreate(
                ['week_start' => $weekStart->toDateString()],
                [
                    'week_end' => $weekStart->addDays(6)->toDateString(),
                    'deadline_at' => $weekStart->addWeek()->setTime(10, 0),
                    'month_label' => $weekStart->format('M Y'),
                    'quarter_label' => sprintf('Q%d %d', $weekStart->quarter, $weekStart->year),
                    'year_num' => $weekStart->year,
                ],
            );
        }
    }
}
