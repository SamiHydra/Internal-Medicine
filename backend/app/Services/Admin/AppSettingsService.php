<?php

namespace App\Services\Admin;

use App\Models\AppSetting;
use App\Models\ReportingPeriod;
use App\Models\User;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Cache;

class AppSettingsService
{
    private const CACHE_KEY = 'app-settings:structured:v2';

    private const DEFAULT_METRIC_TARGETS = [
        'deliveryRate' => ['enabled' => true, 'direction' => 'atLeast', 'amber' => 75, 'green' => 90],
        'inpatientSafetyEvents' => ['enabled' => true, 'direction' => 'atMost', 'amber' => 3, 'green' => 0],
        'outpatientSameDayRate' => ['enabled' => true, 'direction' => 'atLeast', 'amber' => 75, 'green' => 90],
        'procedureThroughput' => ['enabled' => true, 'direction' => 'atLeast', 'amber' => 50, 'green' => 100],
    ];

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
        return Cache::remember(self::CACHE_KEY, 300, function (): array {
            $rows = AppSetting::query()->get()->keyBy('setting_key');

            return [
                'deadlineEnforced' => (bool) ($rows->get('workflow_controls')?->value_json['deadline_enforced'] ?? true),
                'weeklyDeadlineDay' => (string) ($rows->get('weekly_deadline')?->value_json['day'] ?? 'monday'),
                'weeklyDeadlineTime' => (string) ($rows->get('weekly_deadline')?->value_json['time'] ?? '10:00'),
                'autoLockHoursAfterDeadline' => (int) ($rows->get('locking_rules')?->value_json['auto_lock_hours_after_deadline'] ?? 36),
                'notableRiseThresholdPercent' => (int) ($rows->get('insight_thresholds')?->value_json['rise_percent'] ?? 10),
                'notableDropThresholdPercent' => (int) ($rows->get('insight_thresholds')?->value_json['drop_percent'] ?? 10),
                'criticalNonZeroFields' => array_values($rows->get('critical_non_zero_fields')?->value_json ?? []),
                'metricTargets' => $this->normalizeMetricTargets($rows->get('metric_targets')?->value_json ?? self::DEFAULT_METRIC_TARGETS),
                'reportReminderThresholds' => [
                    'inAppHoursBeforeDeadline' => (int) ($rows->get('report_reminders')?->value_json['in_app_hours_before_deadline'] ?? 24),
                    'emailHoursBeforeDeadline' => (int) ($rows->get('report_reminders')?->value_json['email_hours_before_deadline'] ?? 4),
                    'smsHoursBeforeDeadline' => (int) ($rows->get('report_reminders')?->value_json['sms_hours_before_deadline'] ?? 1),
                    'overdueHoursAfterDeadline' => (int) ($rows->get('report_reminders')?->value_json['overdue_hours_after_deadline'] ?? 0),
                ],
            ];
        });
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
            'metricTargets' => $this->normalizeMetricTargets($this->value($validated, 'metric_targets', 'metricTargets', $current['metricTargets'])),
            'reportReminderThresholds' => [
                'inAppHoursBeforeDeadline' => (int) $this->value($validated, 'reminder_in_app_hours_before_deadline', 'reminderInAppHoursBeforeDeadline', $current['reportReminderThresholds']['inAppHoursBeforeDeadline']),
                'emailHoursBeforeDeadline' => (int) $this->value($validated, 'reminder_email_hours_before_deadline', 'reminderEmailHoursBeforeDeadline', $current['reportReminderThresholds']['emailHoursBeforeDeadline']),
                'smsHoursBeforeDeadline' => (int) $this->value($validated, 'reminder_sms_hours_before_deadline', 'reminderSmsHoursBeforeDeadline', $current['reportReminderThresholds']['smsHoursBeforeDeadline']),
                'overdueHoursAfterDeadline' => (int) $this->value($validated, 'reminder_overdue_hours_after_deadline', 'reminderOverdueHoursAfterDeadline', $current['reportReminderThresholds']['overdueHoursAfterDeadline']),
            ],
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
        $this->upsert('metric_targets', $next['metricTargets'], $actor);
        $this->upsert('report_reminders', [
            'in_app_hours_before_deadline' => $next['reportReminderThresholds']['inAppHoursBeforeDeadline'],
            'email_hours_before_deadline' => $next['reportReminderThresholds']['emailHoursBeforeDeadline'],
            'sms_hours_before_deadline' => $next['reportReminderThresholds']['smsHoursBeforeDeadline'],
            'overdue_hours_after_deadline' => $next['reportReminderThresholds']['overdueHoursAfterDeadline'],
        ], $actor);
        $this->recalculateDeadlines($next['weeklyDeadlineDay'], $next['weeklyDeadlineTime']);
        Cache::forget(self::CACHE_KEY);

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

    /**
     * @return array<string, array{enabled: bool, direction: string, amber: float|int, green: float|int}>
     */
    private function normalizeMetricTargets(mixed $value): array
    {
        $input = is_array($value) ? $value : [];

        return collect(self::DEFAULT_METRIC_TARGETS)
            ->mapWithKeys(function (array $defaultTarget, string $key) use ($input): array {
                $target = isset($input[$key]) && is_array($input[$key])
                    ? $input[$key]
                    : [];
                $direction = $target['direction'] ?? $defaultTarget['direction'];

                if (! in_array($direction, ['atLeast', 'atMost'], true)) {
                    $direction = $defaultTarget['direction'];
                }

                return [
                    $key => [
                        'enabled' => (bool) ($target['enabled'] ?? $defaultTarget['enabled']),
                        'direction' => $direction,
                        'amber' => $this->numericTargetValue($target['amber'] ?? $defaultTarget['amber']),
                        'green' => $this->numericTargetValue($target['green'] ?? $defaultTarget['green']),
                    ],
                ];
            })
            ->all();
    }

    private function numericTargetValue(mixed $value): float|int
    {
        $number = is_numeric($value) ? (float) $value : 0;

        return floor($number) === $number ? (int) $number : $number;
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
