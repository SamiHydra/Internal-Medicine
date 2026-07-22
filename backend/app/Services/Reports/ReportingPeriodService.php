<?php

namespace App\Services\Reports;

use App\Models\ReportingPeriod;
use App\Services\Admin\AppSettingsService;
use Carbon\CarbonImmutable;
use Carbon\CarbonInterface;

class ReportingPeriodService
{
    private const WEEKDAY_OFFSETS = [
        'monday' => 0,
        'tuesday' => 1,
        'wednesday' => 2,
        'thursday' => 3,
        'friday' => 4,
        'saturday' => 5,
        'sunday' => 6,
    ];

    public function __construct(
        private readonly AppSettingsService $settingsService,
    ) {}

    /**
     * @return array{created: int, updated: int, total: int, from: string, to: string}
     */
    public function ensureRollingWindow(int $pastWeeks = 26, int $futureWeeks = 52): array
    {
        $settings = $this->settingsService->structured();
        $deadlineDay = (string) $settings['weeklyDeadlineDay'];
        $deadlineTime = (string) $settings['weeklyDeadlineTime'];
        $currentWeek = CarbonImmutable::now('UTC')->startOfWeek(CarbonInterface::MONDAY);
        $firstWeek = $currentWeek->subWeeks($pastWeeks);
        $lastWeek = $currentWeek->addWeeks($futureWeeks);
        $created = 0;
        $updated = 0;

        for ($weekStart = $firstWeek; $weekStart->lessThanOrEqualTo($lastWeek); $weekStart = $weekStart->addWeek()) {
            $weekStartDate = $weekStart->toDateString();
            $period = ReportingPeriod::query()
                ->whereDate('week_start', $weekStartDate)
                ->first() ?? new ReportingPeriod(['week_start' => $weekStartDate]);
            $wasNew = ! $period->exists;

            $period->fill($this->periodPayload($weekStart, $deadlineDay, $deadlineTime));

            if ($wasNew) {
                $period->save();
                $created++;
            } elseif ($period->isDirty()) {
                $period->save();
                $updated++;
            }
        }

        return [
            'created' => $created,
            'updated' => $updated,
            'total' => ReportingPeriod::query()
                ->whereDate('week_start', '>=', $firstWeek->toDateString())
                ->whereDate('week_start', '<=', $lastWeek->toDateString())
                ->count(),
            'from' => $firstWeek->toDateString(),
            'to' => $lastWeek->toDateString(),
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private function periodPayload(CarbonImmutable $weekStart, string $deadlineDay, string $deadlineTime): array
    {
        [$hours, $minutes] = array_map('intval', explode(':', $deadlineTime));
        $deadline = $weekStart
            ->addDays(self::WEEKDAY_OFFSETS[$deadlineDay] ?? 0)
            ->setTime($hours, $minutes);

        return [
            'week_end' => $weekStart->addDays(6)->toDateString(),
            'deadline_at' => $deadline,
            'month_label' => $weekStart->format('M Y'),
            'quarter_label' => sprintf('Q%d %d', $weekStart->quarter, $weekStart->year),
            'year_num' => $weekStart->year,
        ];
    }
}
