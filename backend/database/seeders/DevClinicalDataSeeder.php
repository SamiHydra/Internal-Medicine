<?php

namespace Database\Seeders;

use App\Models\Department;
use App\Models\Report;
use App\Models\ReportAssignment;
use App\Models\ReportFieldDefinition;
use App\Models\ReportFieldValue;
use App\Models\ReportingPeriod;
use App\Models\ReportTemplate;
use App\Models\User;
use App\Services\Analytics\DashboardAnalyticsService;
use Illuminate\Database\Seeder;
use Illuminate\Support\Carbon;
use Illuminate\Support\Str;

/**
 * Dev-only: populate every clinical ward, clinic and procedure unit with
 * realistic, internally-consistent submitted reports so the whole dashboard
 * (clinical, departmental and analytics) renders with believable shape.
 *
 * The numbers are not pure noise: each day's record is built so it satisfies
 * the template's own validation rules (HAI subtypes <= total HAI, new pressure
 * ulcers <= total, new + follow-up <= total seen, reports received <= done,
 * deaths/discharges <= census, ...) and is scaled to the ward's bed count and
 * service type. Text fields carry real staff names rather than placeholders.
 *
 * Idempotent (clean-slate delete then rebuild). Never runs in production or
 * testing.
 */
class DevClinicalDataSeeder extends Seeder
{
    private const HISTORY_PERIOD_COUNT = 26;

    private const INSERT_BATCH_SIZE = 1000;

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

    /** Nurse-in-charge / reporting staff pool (stable per ward across the window). */
    private const NURSES = [
        'Abel Gemechu', 'Hana Abera', 'Sara Tadesse', 'Yonas Kebede', 'Marta Hailu',
        'Bethlehem Tesfaye', 'Dawit Mekonnen', 'Selamawit Girma', 'Kalkidan Wolde',
        'Eyob Assefa', 'Liya Bekele', 'Naod Fikru', 'Tigist Alemu', 'Robel Desta',
        'Meron Tsegaye', 'Hewan Negash', 'Biruk Lemma', 'Saron Habte', 'Nahom Getachew',
        'Rahel Solomon', 'Fitsum Ayele', 'Genet Worku', 'Helen Tamiru', 'Amanuel Birhanu',
        'Lydia Demissie', 'Tewodros Kassa', 'Eden Mulugeta',
    ];

    private const RESIDENTS = [
        'Dr. Rediet Bekele', 'Dr. Samuel Alemu', 'Dr. Nardos Haile', 'Dr. Kirubel Tadesse',
        'Dr. Eden Solomon', 'Dr. Abenezer Girma', 'Dr. Mahlet Wolde', 'Dr. Daniel Tesfaye',
        'Dr. Feven Kassa', 'Dr. Bisrat Negash',
    ];

    private const PHYSICIANS = [
        'Dr. Mesfin Girma', 'Dr. Chaltu Tesfaye', 'Dr. Aster Kebede', 'Dr. Solomon Tadesse',
        'Dr. Bereket Alemu', 'Dr. Helina Desta', 'Dr. Yared Mengistu', 'Dr. Senait Berhanu',
        'Dr. Tesfaye Gebre', 'Dr. Meklit Assefa',
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

        // Cover EVERY active department/ward/section so no part of the dashboard
        // is empty. Realistic at hospital scale (this is the real department list).
        $departments = Department::query()
            ->where('active', true)
            ->orderBy('family')
            ->orderBy('name')
            ->get();

        $templateSlugs = ReportTemplate::query()->pluck('slug', 'id');
        $templateDays = ReportTemplate::query()->pluck('active_days', 'id');
        $fieldsByTemplate = ReportFieldDefinition::query()
            ->where('active', true)
            ->get()
            ->groupBy('template_id');

        // Six months gives weekly, monthly and quarterly charts realistic depth
        // while remaining safe under the 128 MB PHP limit used in local dev.
        $periods = ReportingPeriod::query()
            ->whereDate('week_start', '<=', now())
            ->orderByDesc('week_start')
            ->limit(self::HISTORY_PERIOD_COUNT)
            ->get()
            ->reverse()
            ->values();

        if ($periods->isEmpty()) {
            $this->command?->warn('No reporting periods found; run ReportingPeriodSeeder first.');

            return;
        }

        $valueRows = [];
        $valueCount = 0;
        $reportCount = 0;
        $now = now();

        foreach ($departments as $deptIndex => $department) {
            $nurse = $nurses[$deptIndex % $nurses->count()];
            $templateSlug = $templateSlugs[$department->template_id] ?? 'inpatient_weekly';
            $days = $this->daysFor($templateDays[$department->template_id] ?? null);
            $staff = $this->staffFor($deptIndex);

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

                // A gentle year-long trend so charts have shape without doubling
                // volumes simply because the configured history window is larger.
                $trend = 0.88 + (0.24 * $periodIndex / max($periods->count() - 1, 1));

                foreach ($days as $day) {
                    $map = $this->dailyValues($templateSlug, $department, $staff, $trend);

                    foreach ($defs as $def) {
                        $valueRows[] = $this->valueRow($report->id, $def, $day, $map, $staff, $now);
                        $valueCount++;

                        if (count($valueRows) >= self::INSERT_BATCH_SIZE) {
                            ReportFieldValue::query()->insert($valueRows);
                            $valueRows = [];
                        }
                    }
                }
            }
        }

        if ($valueRows !== []) {
            ReportFieldValue::query()->insert($valueRows);
        }

        app(DashboardAnalyticsService::class)->invalidate();

        $this->command?->info(sprintf(
            'Seeded %d reports and %d field values across %d departments x up to %d periods.',
            $reportCount,
            $valueCount,
            $departments->count(),
            $periods->count(),
        ));
    }

    /**
     * Active reporting days for a template (clinics/procedures = weekdays, inpatient
     * wards = full week). Falls back to the working week.
     *
     * @param  array<int, string>|null  $activeDays
     * @return array<int, string>
     */
    private function daysFor(?array $activeDays): array
    {
        $days = $activeDays ?: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'];

        return array_values($days);
    }

    /**
     * Stable named staff for a department, so the "latest" text aggregates read like
     * a real ward roster instead of changing every week.
     *
     * @return array{nurse: string, resident: string, physician: string}
     */
    private function staffFor(int $deptIndex): array
    {
        return [
            'nurse' => self::NURSES[$deptIndex % count(self::NURSES)],
            'resident' => self::RESIDENTS[$deptIndex % count(self::RESIDENTS)],
            'physician' => self::PHYSICIANS[$deptIndex % count(self::PHYSICIANS)],
        ];
    }

    /**
     * Build one coherent day of values for a template, keyed by field_key. Values
     * respect the template's validation invariants so the seed is never self-
     * contradictory.
     *
     * @param  array{nurse: string, resident: string, physician: string}  $staff
     * @return array<string, int|float|string>
     */
    private function dailyValues(string $templateSlug, Department $department, array $staff, float $trend): array
    {
        return match ($templateSlug) {
            'outpatient_weekly' => $this->outpatientDay($staff, $trend),
            'inpatient_weekly' => $this->inpatientDay($department, $staff, $trend),
            default => $this->procedureDay($templateSlug, $staff, $trend),
        };
    }

    /**
     * @param  array{nurse: string, resident: string, physician: string}  $staff
     * @return array<string, int|float|string>
     */
    private function inpatientDay(Department $department, array $staff, float $trend): array
    {
        $beds = $department->bed_count ?: 18;
        $census = max(4, (int) round($beds * mt_rand(70, 95) / 100 * $trend));
        $census = min($census, $beds);
        $admitted = max(4, (int) round($census * mt_rand(90, 110) / 100));

        $newPressureUlcer = $this->chance(10) ? 1 : 0;
        $totalHai = $this->chance(20) ? mt_rand(1, 2) : 0;

        // Spread the HAI total across subtypes so the parts never exceed the whole.
        $haiKeys = ['hai_clabsi', 'hai_cauti', 'hai_pneumonia', 'hai_vap', 'hai_cdi'];
        $hai = array_fill_keys($haiKeys, 0);
        for ($i = 0; $i < $totalHai; $i++) {
            $hai[$haiKeys[array_rand($haiKeys)]]++;
        }

        $dischargedHome = mt_rand(1, max(2, (int) round($admitted * 0.25)));

        return array_merge([
            'total_admitted_patients' => $admitted,
            'new_admitted_patients' => mt_rand(1, max(2, (int) round($admitted * 0.2))),
            'readmitted_30d' => $this->chance(30) ? 1 : 0,
            'new_deaths' => $this->chance(12) ? 1 : 0,
            'new_pressure_ulcer' => $newPressureUlcer,
            'total_pressure_ulcer' => $newPressureUlcer + mt_rand(0, 2),
            'total_hai' => $totalHai,
            'urinary_catheter' => mt_rand(0, 3),
            'transferred_icu' => $this->chance(15) ? 1 : 0,
            'transferred_hdu' => $this->chance(18) ? 1 : 0,
            'transferred_ward' => mt_rand(0, 2),
            'discharged_home' => $dischargedHome,
            'discharged_ama' => $this->chance(10) ? 1 : 0,
            'free_beds' => max(0, $beds - $census + mt_rand(0, 2)),
            'median_los_days' => round(mt_rand(30, 80) / 10, 1),
            'total_patient_days' => $census,
            'mdt_round_start_day' => $this->time(8, [0, 15, 30, 45]),
            'mdt_round_start_duty' => $this->time(mt_rand(20, 21), [0, 15, 30, 45]),
            'duty_resident' => $staff['resident'],
            'duty_senior_physician' => $staff['physician'],
            'nurse_in_charge' => $staff['nurse'],
        ], $hai);
    }

    /**
     * @param  array{nurse: string, resident: string, physician: string}  $staff
     * @return array<string, int|float|string>
     */
    private function outpatientDay(array $staff, float $trend): array
    {
        $total = max(8, (int) round(mt_rand(25, 55) * $trend * mt_rand(85, 115) / 100));
        $followUp = (int) round($total * mt_rand(55, 70) / 100);
        $newSeen = (int) round($total * mt_rand(20, 32) / 100);
        if ($followUp + $newSeen > $total) {
            $newSeen = max(0, $total - $followUp);
        }

        return [
            'total_patients_seen' => $total,
            'follow_up_patients' => $followUp,
            'new_patients_seen' => $newSeen,
            'not_seen_same_day' => mt_rand(0, (int) round($total * 0.08)),
            'wait_time_new_days' => round(mt_rand(70, 300) / 10, 1),
            'wait_time_followup_months' => round(mt_rand(10, 40) / 10, 1),
            'failed_to_come' => mt_rand(2, 8),
            'not_seen_appointment' => mt_rand(0, 4),
            'clinic_start_time' => $this->time(8, [0, 15, 30, 45]),
            'senior_physician_availability' => $this->availability(),
            'nurse_in_charge' => $staff['nurse'],
        ];
    }

    /**
     * @param  array{nurse: string, resident: string, physician: string}  $staff
     * @return array<string, int|float|string>
     */
    private function procedureDay(string $templateSlug, array $staff, float $trend): array
    {
        $staffName = $staff['nurse'];

        return match ($templateSlug) {
            'eeg_weekly' => $this->withReportReceived('eeg', (int) round(mt_rand(2, 8) * $trend), [
                'ncs_done' => mt_rand(0, 4),
                'emg_done' => mt_rand(0, 3),
                'ep_done' => mt_rand(0, 2),
                'eeg_wait_tests' => round(mt_rand(10, 70) / 10, 1),
                'eeg_wait_reports' => round(mt_rand(10, 90) / 10, 1),
                'reporting_staff' => $staffName,
            ]),
            'echocardiography_weekly' => $this->withReportReceived('echo', (int) round(mt_rand(3, 12) * $trend), [
                'echo_wait_tests' => round(mt_rand(10, 60) / 10, 1),
                'echo_wait_reports' => round(mt_rand(10, 80) / 10, 1),
                'stress_echo' => mt_rand(0, 3),
                'tee' => mt_rand(0, 2),
                'ecg_done' => mt_rand(5, 18),
                'stress_ecg' => mt_rand(0, 4),
                'ambulatory_ecg' => mt_rand(0, 3),
                'angiography_screening' => mt_rand(0, 2),
                'valvotomy_screening' => mt_rand(0, 1),
                'reporting_staff' => $staffName,
            ]),
            'endoscopy_weekly' => $this->endoscopyDay((int) round(mt_rand(2, 8) * $trend), $staffName),
            'hematology_procedures_weekly' => [
                'bone_marrow_biopsy' => mt_rand(0, 4),
                'bone_marrow_wait' => round(mt_rand(10, 120) / 10, 1),
                'reporting_staff' => $staffName,
            ],
            'bronchoscopy_weekly' => [
                'bronchoscopy_done' => mt_rand(0, 4),
                'bronchoscopy_wait' => round(mt_rand(10, 70) / 10, 1),
                'reporting_staff' => $staffName,
            ],
            'renal_procedures_weekly' => [
                'elective_renal_biopsy' => mt_rand(0, 3),
                'central_venous_catheter_insertion' => mt_rand(0, 4),
                'elective_renal_biopsy_wait' => round(mt_rand(10, 100) / 10, 1),
                'reporting_staff' => $staffName,
            ],
            'dialysis_weekly' => [
                'dialysis_acute' => (int) round(mt_rand(2, 8) * $trend),
                'dialysis_chronic' => (int) round(mt_rand(8, 20) * $trend),
                'reporting_staff' => $staffName,
            ],
            default => ['reporting_staff' => $staffName],
        };
    }

    /**
     * EEG/echo share the "done -> report received (<= done)" shape.
     *
     * @param  array<string, int|float|string>  $extra
     * @return array<string, int|float|string>
     */
    private function withReportReceived(string $prefix, int $done, array $extra): array
    {
        return array_merge([
            "{$prefix}_done" => $done,
            "{$prefix}_report_received" => max(0, $done - mt_rand(0, 2)),
        ], $extra);
    }

    /**
     * @return array<string, int|float|string>
     */
    private function endoscopyDay(int $elective, string $staffName): array
    {
        return [
            'upper_gi_elective' => $elective,
            'upper_gi_report_received' => max(0, $elective - mt_rand(0, 2)),
            'upper_gi_wait' => round(mt_rand(10, 80) / 10, 1),
            'upper_gi_report_wait' => round(mt_rand(10, 90) / 10, 1),
            'upper_gi_emergency' => mt_rand(0, 3),
            'ercp' => mt_rand(0, 2),
            'colonoscopy' => mt_rand(1, 5),
            'proctoscopy' => mt_rand(0, 3),
            'bronchoscopy' => mt_rand(0, 2),
            'therapeutic_upper_gi' => mt_rand(0, 3),
            'esophageal_dilation' => mt_rand(0, 2),
            'variceal_ligation' => mt_rand(0, 2),
            'stenting' => mt_rand(0, 1),
            'liver_biopsy' => mt_rand(0, 2),
            'reporting_staff' => $staffName,
        ];
    }

    /**
     * Resolve one field's typed value from the day map and place it in the right
     * column. Falls back to sensible defaults if a field is not in the map.
     *
     * @param  array<string, int|float|string>  $map
     * @param  array{nurse: string, resident: string, physician: string}  $staff
     * @return array<string, mixed>
     */
    private function valueRow(string $reportId, ReportFieldDefinition $def, string $day, array $map, array $staff, Carbon $now): array
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

        $raw = $map[$def->field_key] ?? null;

        switch ($def->field_kind) {
            case 'integer':
                $row['value_number'] = $raw !== null ? (int) $raw : mt_rand(1, 10);
                break;
            case 'decimal':
                $row['value_number'] = $raw !== null ? (float) $raw : round(mt_rand(20, 90) / 10, 1);
                break;
            case 'time':
                $row['value_time'] = is_string($raw) ? $raw : $this->time(8, [0, 15, 30, 45]);
                break;
            case 'choice':
                $row['value_text'] = is_string($raw) ? $raw : $this->availability();
                break;
            default:
                $row['value_text'] = is_string($raw) ? $raw : $staff['nurse'];
                break;
        }

        return $row;
    }

    private function chance(int $percent): bool
    {
        return mt_rand(1, 100) <= $percent;
    }

    /**
     * @param  array<int, int>  $minutes
     */
    private function time(int $hour, array $minutes): string
    {
        return sprintf('%02d:%02d', $hour, $minutes[array_rand($minutes)]);
    }

    private function availability(): string
    {
        $roll = mt_rand(1, 100);

        return match (true) {
            $roll <= 70 => 'Full day',
            $roll <= 92 => 'Partial day',
            default => 'Unavailable',
        };
    }
}
