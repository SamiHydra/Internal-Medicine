<?php

namespace App\Services\Admin;

use App\Models\AppSetting;
use App\Models\ReportingPeriod;
use App\Models\User;
use Illuminate\Support\Carbon;

class AppSettingsService
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

    /**
     * @return array<string, mixed>
     */
    public function structured(): array
    {
        $rows = AppSetting::query()->get()->keyBy('setting_key');

        return [
            'deadlineEnforced' => (bool) ($rows->get('workflow_controls')?->value_json['deadline_enforced'] ?? true),
            'weeklyDeadlineDay' => (string) ($rows->get('weekly_deadline')?->value_json['day'] ?? 'monday'),
            'weeklyDeadlineTime' => (string) ($rows->get('weekly_deadline')?->value_json['time'] ?? '10:00'),
            'autoLockHoursAfterDeadline' => (int) ($rows->get('locking_rules')?->value_json['auto_lock_hours_after_deadline'] ?? 36),
            'notableRiseThresholdPercent' => (int) ($rows->get('insight_thresholds')?->value_json['rise_percent'] ?? 10),
            'notableDropThresholdPercent' => (int) ($rows->get('insight_thresholds')?->value_json['drop_percent'] ?? 10),
            'criticalNonZeroFields' => array_values($rows->get('critical_non_zero_fields')?->value_json ?? []),
        ];
    }

    /**
     * @param  array<string, mixed>  $validated
     * @return array<string, mixed>
     */
    public function update(User $actor, array $validated): array
    {
        $current = $this->structured();

        $next = [
            'deadlineEnforced' => $this->value($validated, 'deadline_enforced', 'deadlineEnforced', $current['deadlineEnforced']),
            'weeklyDeadlineDay' => strtolower((string) $this->value($validated, 'weekly_deadline_day', 'weeklyDeadlineDay', $current['weeklyDeadlineDay'])),
            'weeklyDeadlineTime' => (string) $this->value($validated, 'weekly_deadline_time', 'weeklyDeadlineTime', $current['weeklyDeadlineTime']),
            'autoLockHoursAfterDeadline' => (int) $this->value($validated, 'auto_lock_hours_after_deadline', 'autoLockHoursAfterDeadline', $current['autoLockHoursAfterDeadline']),
            'notableRiseThresholdPercent' => (int) $this->value($validated, 'notable_rise_threshold_percent', 'notableRiseThresholdPercent', $current['notableRiseThresholdPercent']),
            'notableDropThresholdPercent' => (int) $this->value($validated, 'notable_drop_threshold_percent', 'notableDropThresholdPercent', $current['notableDropThresholdPercent']),
            'criticalNonZeroFields' => $this->value($validated, 'critical_non_zero_fields', 'criticalNonZeroFields', $current['criticalNonZeroFields']),
        ];

        $this->upsert('workflow_controls', ['deadline_enforced' => (bool) $next['deadlineEnforced']], $actor);
        $this->upsert('weekly_deadline', [
            'day' => $next['weeklyDeadlineDay'],
            'time' => $next['weeklyDeadlineTime'],
        ], $actor);
        $this->upsert('locking_rules', [
            'auto_lock_hours_after_deadline' => $next['autoLockHoursAfterDeadline'],
        ], $actor);
        $this->upsert('insight_thresholds', [
            'rise_percent' => $next['notableRiseThresholdPercent'],
            'drop_percent' => $next['notableDropThresholdPercent'],
        ], $actor);
        $this->upsert('critical_non_zero_fields', array_values($next['criticalNonZeroFields']), $actor);
        $this->recalculateDeadlines($next['weeklyDeadlineDay'], $next['weeklyDeadlineTime']);

        return $this->structured();
    }

    private function upsert(string $key, mixed $value, User $actor): void
    {
        AppSetting::query()->updateOrCreate(
            ['setting_key' => $key],
            [
                'value_json' => $value,
                'updated_by' => $actor->id,
                'updated_at' => now(),
            ],
        );
    }

    private function recalculateDeadlines(string $weekday, string $time): void
    {
        [$hours, $minutes] = array_map('intval', explode(':', $time));
        $offset = self::WEEKDAY_OFFSETS[$weekday] ?? 0;

        ReportingPeriod::query()
            ->orderBy('week_start')
            ->each(function (ReportingPeriod $period) use ($hours, $minutes, $offset): void {
                $deadline = Carbon::parse($period->week_start)
                    ->addDays($offset)
                    ->setTime($hours, $minutes);

                $period->forceFill(['deadline_at' => $deadline])->save();
            });
    }

    private function value(array $input, string $snakeKey, string $camelKey, mixed $default): mixed
    {
        if (array_key_exists($snakeKey, $input)) {
            return $input[$snakeKey];
        }

        if (array_key_exists($camelKey, $input)) {
            return $input[$camelKey];
        }

        return $default;
    }
}
