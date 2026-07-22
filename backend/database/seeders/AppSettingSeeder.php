<?php

namespace Database\Seeders;

use App\Models\AppSetting;
use Illuminate\Database\Seeder;

class AppSettingSeeder extends Seeder
{
    public function run(): void
    {
        $settings = [
            'workflow_controls' => ['deadline_enforced' => true],
            'weekly_deadline' => ['day' => 'monday', 'time' => '10:00'],
            'locking_rules' => ['auto_lock_hours_after_deadline' => 36],
            'report_reminders' => [
                'in_app_hours_before_deadline' => 24,
                'email_hours_before_deadline' => 4,
                'sms_hours_before_deadline' => 1,
                'overdue_hours_after_deadline' => 0,
            ],
            'insight_thresholds' => ['rise_percent' => 10, 'drop_percent' => 10],
            'critical_non_zero_fields' => [
                'new_deaths',
                'new_pressure_ulcer',
                'total_hai',
                'hai_clabsi',
                'hai_cauti',
                'hai_vap',
            ],
            'metric_targets' => [
                'deliveryRate' => ['enabled' => true, 'direction' => 'atLeast', 'amber' => 75, 'green' => 90],
                'inpatientSafetyEvents' => ['enabled' => true, 'direction' => 'atMost', 'amber' => 3, 'green' => 0],
                'outpatientSameDayRate' => ['enabled' => true, 'direction' => 'atLeast', 'amber' => 75, 'green' => 90],
                'procedureThroughput' => ['enabled' => true, 'direction' => 'atLeast', 'amber' => 50, 'green' => 100],
            ],
        ];

        foreach ($settings as $key => $value) {
            AppSetting::query()->updateOrCreate(
                ['setting_key' => $key],
                [
                    'value_json' => $value,
                    'updated_at' => now(),
                ],
            );
        }
    }
}
