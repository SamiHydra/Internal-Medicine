<?php

namespace Database\Seeders;

use App\Models\Department;
use App\Models\Report;
use App\Models\ReportAssignment;
use App\Models\ReportFieldDefinition;
use App\Models\ReportFieldValue;
use App\Models\ReportingPeriod;
use App\Models\User;
use Illuminate\Database\Seeder;
use Illuminate\Support\Str;

/**
 * Dev-only: populate the clinical dashboard with realistic submitted reports so
 * every chart renders. Idempotent. Never runs in production or testing.
 */
class DevClinicalDataSeeder extends Seeder
{
    private const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'];

    /** Stored statuses only (not_started / overdue are derived from missing reports). */
    private const STATUS_CYCLE = [
        'submitted',
        'locked',
        'submitted',
        'edited_after_submission',
        'submitted',
        'draft',
        'locked',
    ];

    public function run(): void
    {
        if (app()->environment('production', 'testing')) {
            $this->command?->warn('DevClinicalDataSeeder skipped (non-dev environment).');

            return;
        }

        $nurses = User::query()->where('role_key', 'nurse')->where('active', true)->get()->values();
        if ($nurses->isEmpty()) {
            $this->command?->warn('No active nurses found; run DevUserSeeder first.');

            return;
        }

        $approver = User::query()->where('role_key', 'superadmin')->first()
            ?? User::query()->where('role_key', 'admin')->first()
            ?? $nurses->first();

        // Clean slate so re-runs do not leave stale reports/assignments that inflate
        // the "expected" denominator (overdue/not-started). Dev only.
        ReportFieldValue::query()->delete();
        Report::query()->delete();
        ReportAssignment::query()->delete();

        // A representative subset per service line keeps the dashboard fast (it loads
        // full details for every report in range) while every chart still populates.
        $departmentSlugs = [
            'gi_neuro_inpatient', 'cardiac_inpatient', 'nephrology_inpatient', 'chest_inpatient',
            'outpatient_main', 'gi_outpatient', 'cardiac_outpatient',
            'eeg_lab', 'dialysis_unit', 'endoscopy_lab',
        ];
        $departments = Department::query()
            ->where('active', true)
            ->whereIn('slug', $departmentSlugs)
            ->get();
        $fieldsByTemplate = ReportFieldDefinition::query()->get()->groupBy('template_id');
        // The 8 most recent periods that have already started (the visible "last 8 weeks").
        $periods = ReportingPeriod::query()
            ->whereDate('week_start', '<=', now())
            ->orderByDesc('week_start')
            ->limit(8)
            ->get()
            ->reverse()
            ->values();

        if ($periods->isEmpty()) {
            $this->command?->warn('No reporting periods found; run ReportingPeriodSeeder first.');

            return;
        }

        $valueRows = [];
        $reportCount = 0;
        $now = now();

        foreach ($departments as $deptIndex => $department) {
            $nurse = $nurses[$deptIndex % $nurses->count()];

            $assignment = ReportAssignment::query()->updateOrCreate(
                [
                    'nurse_id' => $nurse->id,
                    'department_id' => $department->id,
                    'template_id' => $department->template_id,
                ],
                ['active' => true, 'approved_at' => $now, 'approved_by' => $approver->id],
            );

            $defs = $fieldsByTemplate[$department->template_id] ?? collect();

            foreach ($periods as $periodIndex => $period) {
                $isLatest = $periodIndex === $periods->count() - 1;
                // Leave a few of the latest-week reports unfiled so the donut shows open/not-started.
                if ($isLatest && $deptIndex % 4 === 0) {
                    continue;
                }

                $status = self::STATUS_CYCLE[($deptIndex + $periodIndex) % count(self::STATUS_CYCLE)];
                $filed = in_array($status, ['submitted', 'locked', 'edited_after_submission'], true);

                $report = Report::query()->updateOrCreate(
                    ['assignment_id' => $assignment->id, 'reporting_period_id' => $period->id],
                    [
                        'department_id' => $department->id,
                        'template_id' => $department->template_id,
                        'status' => $status,
                        'submitted_at' => $filed ? $period->week_end : null,
                        'locked_at' => $status === 'locked' ? $period->week_end : null,
                        'created_by' => $nurse->id,
                        'updated_by' => $nurse->id,
                    ],
                );
                $reportCount++;

                ReportFieldValue::query()->where('report_id', $report->id)->delete();

                foreach ($defs as $def) {
                    foreach (self::DAYS as $day) {
                        $valueRows[] = $this->valueRow($report->id, $def, $day, $now);
                    }
                }
            }
        }

        foreach (array_chunk($valueRows, 1000) as $chunk) {
            ReportFieldValue::query()->insert($chunk);
        }

        $this->command?->info(sprintf(
            'Seeded %d reports and %d field values across %d departments x %d periods.',
            $reportCount,
            count($valueRows),
            $departments->count(),
            $periods->count(),
        ));
    }

    /**
     * @return array<string, mixed>
     */
    private function valueRow(string $reportId, ReportFieldDefinition $def, string $day, \Illuminate\Support\Carbon $now): array
    {
        $row = [
            'id' => (string) Str::uuid(),
            'report_id' => $reportId,
            'field_definition_id' => $def->id,
            'day_name' => $day,
            'value_number' => null,
            'value_text' => null,
            'value_time' => null,
            'value_json' => null,
            'created_at' => $now,
            'updated_at' => $now,
        ];

        switch ($def->field_kind) {
            case 'integer':
                $row['value_number'] = $this->intFor($def->field_key);
                break;
            case 'decimal':
                $row['value_number'] = round(mt_rand(20, 90) / 10, 1);
                break;
            case 'time':
                $row['value_time'] = sprintf('%02d:%02d', mt_rand(8, 10), [0, 15, 30, 45][mt_rand(0, 3)]);
                break;
            case 'choice':
                $options = $def->metadata['options'] ?? ['Full day', 'Partial day', 'Unavailable'];
                $row['value_text'] = $options[array_rand($options)];
                break;
            default:
                $row['value_text'] = 'Auto entry';
                break;
        }

        return $row;
    }

    private function intFor(string $key): int
    {
        return match (true) {
            str_contains($key, 'patient_days') => mt_rand(12, 26),
            str_contains($key, 'total_admitted') => mt_rand(8, 20),
            str_contains($key, 'total_patients_seen') => mt_rand(20, 60),
            str_contains($key, 'follow_up') || str_contains($key, 'new_patients') => mt_rand(8, 28),
            str_contains($key, 'free_beds') => mt_rand(0, 9),
            str_contains($key, 'death') || str_contains($key, 'ulcer') || str_contains($key, 'hai')
                || str_contains($key, 'cdi') || str_contains($key, 'vap') || str_contains($key, 'clabsi')
                || str_contains($key, 'cauti') || str_contains($key, 'pneumonia') => mt_rand(0, 3),
            str_contains($key, 'done') || str_contains($key, 'dialysis') || str_contains($key, 'biopsy')
                || str_contains($key, 'scopy') || str_contains($key, 'catheter') => mt_rand(2, 16),
            default => mt_rand(1, 12),
        };
    }
}
