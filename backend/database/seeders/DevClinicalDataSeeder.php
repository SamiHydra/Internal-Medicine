<?php

namespace Database\Seeders;

use App\Models\ActionItem;
use App\Models\Department;
use App\Models\Notification;
use App\Models\Report;
use App\Models\ReportAssignment;
use App\Models\ReportFieldDefinition;
use App\Models\ReportFieldValue;
use App\Models\ReportingPeriod;
use App\Models\ReportTemplate;
use App\Models\User;
use App\Services\Analytics\DashboardAnalyticsService;
use App\Services\Reports\CriticalEventAlertService;
use Illuminate\Database\Seeder;
use Illuminate\Support\Carbon;
use Illuminate\Support\Collection;
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
    private const RANDOM_SEED = 20260722;

    private const INSERT_BATCH_SIZE = 1000;

    /** Trailing weeks whose critical values raise a real alert + action item. */
    private const ALERT_WINDOW_WEEKS = 4;

    /**
     * `notifications.related_entity` values that hang off a report, and so have
     * to be cleared whenever the reports are rebuilt.
     *
     * @var list<string>
     */
    private const REPORT_SCOPED_ENTITIES = [
        'critical_alert',
        'trend_alert',
        'report_submission',
        'report_lock',
    ];

    /**
     * How each unit behaves over the window, so the compliance and safety
     * screens separate good units from struggling ones instead of showing one
     * flat population. Assigned round-robin over the reporting slots.
     *
     * missRate      - weeks with no report at all (drives overdue / not-started)
     * draftRate     - weeks started but never submitted
     * lateRate      - weeks submitted after the deadline
     * safetyFactor  - multiplier on deaths / HAI / pressure-ulcer likelihood
     * surgeRate     - weeks whose headline volume spikes into outlier territory
     * lullRate      - weeks whose volume collapses (closure, holiday, staff gap)
     *
     * @var list<array{label: string, missRate: int, draftRate: int, lateRate: int, safetyFactor: float, surgeRate: int, lullRate: int}>
     */
    private const UNIT_PROFILES = [
        ['label' => 'exemplary', 'missRate' => 0, 'draftRate' => 1, 'lateRate' => 3, 'safetyFactor' => 0.4, 'surgeRate' => 1, 'lullRate' => 1],
        ['label' => 'reliable', 'missRate' => 2, 'draftRate' => 3, 'lateRate' => 8, 'safetyFactor' => 0.8, 'surgeRate' => 2, 'lullRate' => 2],
        ['label' => 'reliable', 'missRate' => 3, 'draftRate' => 4, 'lateRate' => 10, 'safetyFactor' => 1.0, 'surgeRate' => 2, 'lullRate' => 2],
        ['label' => 'inconsistent', 'missRate' => 9, 'draftRate' => 8, 'lateRate' => 22, 'safetyFactor' => 1.5, 'surgeRate' => 4, 'lullRate' => 3],
        ['label' => 'reliable', 'missRate' => 2, 'draftRate' => 3, 'lateRate' => 7, 'safetyFactor' => 0.7, 'surgeRate' => 2, 'lullRate' => 2],
        ['label' => 'struggling', 'missRate' => 18, 'draftRate' => 12, 'lateRate' => 30, 'safetyFactor' => 2.2, 'surgeRate' => 5, 'lullRate' => 5],
    ];

    /**
     * Headline volume field per template. A surge week multiplies these (and the
     * fields derived from them) far enough above the trailing average to trip
     * ReportQualityService's outlier check; a lull week collapses them.
     *
     * @var array<string, float>
     */
    private const SURGE_MULTIPLIER = ['surge' => 4.2, 'lull' => 0.18];

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

        mt_srand(self::RANDOM_SEED);

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
        //
        // Everything a report FANS OUT TO has to go with it. notifications and
        // action_items carry no cascading key back to reports (related_id is
        // polymorphic; action_items.report_id is ON DELETE SET NULL), so a
        // rebuild used to leave every previous run's alert behind pointing at a
        // report id that no longer exists - an inbox full of links that dead-end
        // on the not-found page, growing by one generation per reseed. Keyed on
        // the report route, the report id and the report-scoped entities rather
        // than on a list of notification types, so a new report notification
        // type is covered the day it is added - and so is a generation left
        // behind by an older seeder that wrote a different route shape.
        Notification::query()
            ->where(fn ($query) => $query
                ->where('related_route', 'like', '%/reports/%')
                ->orWhereIn('related_entity', self::REPORT_SCOPED_ENTITIES)
                ->orWhereIn('related_id', Report::query()->select('id')))
            ->delete();
        ActionItem::query()->where('source', 'critical_event')->delete();
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

        // A full trailing year by default, so weekly, monthly and quarterly
        // charts all have real depth. Raise SEED_HISTORY_WEEKS to load-test a
        // deeper archive (see config/reports.php).
        $periods = ReportingPeriod::query()
            ->whereDate('week_start', '<=', now())
            ->orderByDesc('week_start')
            ->limit((int) config('reports.dev_seed.history_weeks', 52))
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

        $missedCount = 0;
        $surgeCount = 0;
        $lullCount = 0;

        foreach ($this->pairNursesToDepartments($nurses, $departments) as $slot => [$nurse, $department, $deptIndex]) {
            $templateSlug = $templateSlugs[$department->template_id] ?? 'inpatient_weekly';
            $days = $this->daysFor($templateDays[$department->template_id] ?? null);
            $staff = $this->staffFor($deptIndex, $nurse);
            $profile = self::UNIT_PROFILES[$slot % count(self::UNIT_PROFILES)];

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

                // Missed weeks. The current week is open for everyone bar the
                // exemplary units (who file early), and history is missed at the
                // unit's own rate - so overdue lists name the same struggling
                // departments week after week, the way they would in real life.
                if ($isLatest ? $profile['missRate'] > 0 : $this->chance($profile['missRate'])) {
                    $missedCount++;

                    continue;
                }

                $status = $this->statusFor($profile, $slot, $periodIndex, $isLatest);
                $filed = in_array($status, ['submitted', 'locked', 'edited_after_submission'], true);
                $filedAt = $filed
                    ? $this->filedAt($period, $profile, $now)
                    : null;

                $report = Report::query()->updateOrCreate(
                    ['assignment_id' => $assignment->id, 'reporting_period_id' => $period->id],
                    [
                        'department_id' => $department->id,
                        'template_id' => $department->template_id,
                        'status' => $status,
                        'submitted_at' => $filedAt,
                        'locked_at' => $status === 'locked' ? $filedAt : null,
                        'created_by' => $nurse->id,
                        'updated_by' => $nurse->id,
                    ],
                );
                $reportCount++;

                ReportFieldValue::query()->where('report_id', $report->id)->delete();

                // A gentle year-long trend so charts have shape without doubling
                // volumes simply because the configured history window is larger.
                $trend = 0.88 + (0.24 * $periodIndex / max($periods->count() - 1, 1));

                // Never on the first weeks: the outlier check needs a settled
                // baseline behind it before a spike reads as a spike.
                $anomaly = null;
                if ($periodIndex >= 8) {
                    if ($this->chance($profile['surgeRate'])) {
                        $anomaly = 'surge';
                        $surgeCount++;
                    } elseif ($this->chance($profile['lullRate'])) {
                        $anomaly = 'lull';
                        $lullCount++;
                    }
                }

                if ($anomaly !== null) {
                    $trend *= self::SURGE_MULTIPLIER[$anomaly];
                }

                foreach ($days as $day) {
                    $map = $this->dailyValues($templateSlug, $department, $staff, $trend, $profile, $anomaly);

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

        $alerts = $this->raiseCriticalEventAlerts($periods, $now);

        app(DashboardAnalyticsService::class)->invalidate();

        $this->command?->info(sprintf(
            'Seeded %d reports and %d field values across %d departments / %d nurses x up to %d periods.',
            $reportCount,
            $valueCount,
            $departments->count(),
            $nurses->count(),
            $periods->count(),
        ));
        $this->command?->info(sprintf(
            'Realism: %d missed weeks, %d surge weeks, %d lull weeks, %d critical-event alerts raised.',
            $missedCount,
            $surgeCount,
            $lullCount,
            $alerts,
        ));
    }

    /**
     * Push the recent weeks' critical values (deaths, HAIs, pressure ulcers)
     * through the real alert service, so the notification bell and the action
     * item queue are populated by the same code path a live submission uses -
     * rather than by rows invented here that could drift from it.
     *
     * Bounded to the trailing few weeks on purpose: every admin gets a
     * notification per alert, and a full archive's worth would bury the inbox
     * and add tens of thousands of rows nobody would ever read.
     *
     * @param  Collection<int, ReportingPeriod>  $periods
     */
    private function raiseCriticalEventAlerts(Collection $periods, Carbon $now): int
    {
        $recentPeriodIds = $periods->slice(-self::ALERT_WINDOW_WEEKS)->pluck('id')->all();

        if ($recentPeriodIds === []) {
            return 0;
        }

        $alerts = app(CriticalEventAlertService::class);
        $raised = 0;

        Report::query()
            ->whereIn('reporting_period_id', $recentPeriodIds)
            ->whereNotNull('submitted_at')
            ->with(['department', 'template.fieldDefinitions', 'fieldValues'])
            ->chunkById(100, function (Collection $reports) use ($alerts, $now, &$raised): void {
                foreach ($reports as $report) {
                    // The service builds the notification route itself from the
                    // action item it raises (ActionItem::notificationRoute), so
                    // the seeded link is exactly the one a live submission gets.
                    // Pinned by DevSeederSmokeTest: a signature change here must
                    // fail the suite, not the next `db:seed` (QA-002).
                    $raised += $alerts->notify($report, $now) > 0 ? 1 : 0;
                }
            });

        return $raised;
    }

    /**
     * Decide who files what. Every department gets exactly one primary nurse so
     * ward totals stay single-sourced (a second reporter on the same ward would
     * double its census against a fixed bed count). Nurses left over once every
     * department is covered join a high-volume outpatient clinic as a second
     * reporter, which is both realistic (clinics run parallel sessions) and
     * safe, because clinics carry no bed-count invariant.
     *
     * @param  Collection<int, User>  $nurses
     * @param  Collection<int, Department>  $departments
     * @return list<array{0: User, 1: Department, 2: int}> [nurse, department, department index]
     */
    private function pairNursesToDepartments(Collection $nurses, Collection $departments): array
    {
        $pairs = [];
        $used = [];

        foreach ($departments as $deptIndex => $department) {
            $nurse = $nurses[$deptIndex % $nurses->count()];
            $used[$nurse->id] = true;
            $pairs[] = [$nurse, $department, $deptIndex];
        }

        $spare = $nurses->reject(fn (User $nurse) => isset($used[$nurse->id]))->values();

        if ($spare->isEmpty()) {
            return $pairs;
        }

        $clinics = $departments->values()->filter(fn (Department $d) => $d->family === 'outpatient')->values();

        if ($clinics->isEmpty()) {
            return $pairs;
        }

        foreach ($spare as $offset => $nurse) {
            $clinic = $clinics[$offset % $clinics->count()];
            $pairs[] = [$nurse, $clinic, (int) $departments->search(fn (Department $d) => $d->id === $clinic->id)];
        }

        return $pairs;
    }

    /**
     * Stored status for a filed week. Drafts come from the unit's own
     * draft rate rather than a fixed rotation, and the current week is never
     * locked because nobody has closed it yet.
     *
     * @param  array{draftRate: int, ...}  $profile
     */
    private function statusFor(array $profile, int $slot, int $periodIndex, bool $isLatest): string
    {
        if ($this->chance($profile['draftRate'])) {
            return 'draft';
        }

        if ($isLatest) {
            return 'submitted';
        }

        $status = self::STATUS_CYCLE[($slot + $periodIndex) % count(self::STATUS_CYCLE)];

        // The cycle's own draft slot is now owned by draftRate above.
        return $status === 'draft' ? 'submitted' : $status;
    }

    /**
     * When the week was filed. Most land on the closing day; a unit's late rate
     * pushes some past the deadline so the punctuality view has real spread.
     *
     * @param  array{lateRate: int, ...}  $profile
     */
    private function filedAt(ReportingPeriod $period, array $profile, Carbon $now): Carbon
    {
        $filedAt = Carbon::parse($period->week_end)->endOfDay();

        if ($this->chance($profile['lateRate'])) {
            $filedAt = $filedAt->addDays(mt_rand(1, 5));
        }

        return $filedAt->min($now);
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
     * a real ward roster instead of changing every week. The nurse-in-charge is the
     * account that actually files the report, so the text field and the audit trail
     * never disagree.
     *
     * @return array{nurse: string, resident: string, physician: string}
     */
    private function staffFor(int $deptIndex, User $nurse): array
    {
        return [
            'nurse' => $nurse->full_name,
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
     * @param  array{safetyFactor: float, ...}  $profile
     * @return array<string, int|float|string>
     */
    private function dailyValues(
        string $templateSlug,
        Department $department,
        array $staff,
        float $trend,
        array $profile,
        ?string $anomaly,
    ): array {
        return match ($templateSlug) {
            'outpatient_weekly' => $this->outpatientDay($staff, $trend, $anomaly),
            'inpatient_weekly' => $this->inpatientDay($department, $staff, $trend, $profile, $anomaly),
            default => $this->procedureDay($templateSlug, $staff, $trend),
        };
    }

    /**
     * @param  array{nurse: string, resident: string, physician: string}  $staff
     * @param  array{safetyFactor: float, ...}  $profile
     * @return array<string, int|float|string>
     */
    private function inpatientDay(Department $department, array $staff, float $trend, array $profile, ?string $anomaly): array
    {
        $beds = $department->bed_count ?: 18;
        // A surge overfills the ward (corridor beds, an outbreak); a lull empties
        // it. Both are why the bed count stops being the ceiling on those weeks.
        $census = max(1, (int) round($beds * mt_rand(70, 95) / 100 * $trend));
        $census = $anomaly === null ? min($census, $beds) : $census;
        $admitted = max(1, (int) round($census * mt_rand(90, 110) / 100));

        // Struggling units carry visibly worse safety numbers, and a surge week
        // drags them further - which is what makes the safety charts tell a story.
        $safety = $profile['safetyFactor'] * ($anomaly === 'surge' ? 2.0 : 1.0);
        $newPressureUlcer = $this->chance((int) round(10 * $safety)) ? mt_rand(1, 2) : 0;
        $totalHai = $this->chance((int) round(20 * $safety)) ? mt_rand(1, 2) : 0;

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
            'new_deaths' => $this->chance((int) round(12 * $safety)) ? 1 : 0,
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
    private function outpatientDay(array $staff, float $trend, ?string $anomaly): array
    {
        $total = max(1, (int) round(mt_rand(25, 55) * $trend * mt_rand(85, 115) / 100));
        $followUp = (int) round($total * mt_rand(55, 70) / 100);
        $newSeen = (int) round($total * mt_rand(20, 32) / 100);
        if ($followUp + $newSeen > $total) {
            $newSeen = max(0, $total - $followUp);
        }

        // A catch-up clinic clears a backlog fast; a lull leaves people waiting
        // months. Waiting times move opposite to throughput, as they do in life.
        $waitScale = match ($anomaly) {
            'surge' => 1.9,
            'lull' => 0.6,
            default => 1.0,
        };

        return [
            'total_patients_seen' => $total,
            'follow_up_patients' => $followUp,
            'new_patients_seen' => $newSeen,
            'not_seen_same_day' => mt_rand(0, (int) round($total * 0.08)),
            'wait_time_new_days' => round(mt_rand(70, 300) * $waitScale / 10, 1),
            'wait_time_followup_months' => round(mt_rand(10, 40) * $waitScale / 10, 1),
            'failed_to_come' => mt_rand(2, 8),
            'not_seen_appointment' => mt_rand(0, 4),
            'clinic_start_time' => $this->time(8, [0, 15, 30, 45]),
            'senior_physician_availability' => $this->availability($anomaly),
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

    private function availability(?string $anomaly = null): string
    {
        $roll = mt_rand(1, 100);

        // A lull week is usually a lull *because* nobody senior was covering.
        if ($anomaly === 'lull') {
            return match (true) {
                $roll <= 25 => 'Full day',
                $roll <= 55 => 'Partial day',
                default => 'Unavailable',
            };
        }

        return match (true) {
            $roll <= 70 => 'Full day',
            $roll <= 92 => 'Partial day',
            default => 'Unavailable',
        };
    }
}
