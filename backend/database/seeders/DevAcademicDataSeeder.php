<?php

namespace Database\Seeders;

use App\Models\AppSetting;
use App\Models\DutyAssignment;
use App\Models\DutyType;
use App\Models\MorningSession;
use App\Models\RepAssignment;
use App\Models\RotationCalendar;
use App\Models\Section;
use App\Models\Student;
use App\Models\StudentBatch;
use App\Models\SubgroupPlacement;
use App\Models\TeachingSession;
use App\Models\User;
use App\Models\Ward;
use App\Services\Academic\EvaluationFormService;
use App\Services\Academic\MorningSessionService;
use App\Services\Academic\RosterService;
use App\Services\Academic\RotationCalendarService;
use App\Services\Academic\TeachingService;
use Illuminate\Database\Seeder;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;

/**
 * LOCAL-ONLY demo data for the V2 academic module: a full trailing year of
 * OPERATIONAL data for EVERY section, so the roster, rotations, morning
 * sessions, undergraduate module, evaluations, and every analytics dashboard
 * render with a believable year of history instead of empty screens.
 * Reference structure (wards, sections, duty types, forms) comes from the
 * migrations; this fills the operational rows a walkthrough needs.
 *
 * SAFETY: never runs in production or testing. Baseline history is created
 * once, while current calendars, duties, representatives, placements, and
 * sessions are refreshed safely on later local runs.
 */
class DevAcademicDataSeeder extends Seeder
{
    private const DEV_PASSWORD = 'StPaul2026!';

    private const RANDOM_SEED = 20260722;

    private const CONSULTANTS_PER_SECTION = 2;

    private const RESIDENTS_PER_SECTION = 3;

    private const MORNING_DAYS = [1, 3, 5]; // Mon / Wed / Fri

    /** @var list<string> */
    private const FIRST_NAMES = [
        'Selam', 'Yonas', 'Meron', 'Amanuel', 'Betelhem', 'Kaleb', 'Ruth', 'Dawit',
        'Hana', 'Nardos', 'Abel', 'Eden', 'Feven', 'Getachew', 'Helen', 'Israel',
        'Kirubel', 'Lidya', 'Mahlet', 'Nahom', 'Rediet', 'Samuel', 'Tsion', 'Yohannes',
        'Bruk', 'Genet', 'Henok', 'Kidist', 'Mekdes', 'Robel', 'Saba', 'Tewodros',
        'Bezawit', 'Dagmawi', 'Eyob', 'Fikir', 'Hiwot', 'Kena', 'Liya', 'Naol',
    ];

    /** @var list<string> */
    private const LAST_NAMES = [
        'Tesfaye', 'Bekele', 'Alemu', 'Girma', 'Solomon', 'Assefa', 'Haile', 'Fikru',
        'Getachew', 'Wolde', 'Kebede', 'Tesfa', 'Mengistu', 'Desta', 'Abera', 'Gemechu',
        'Tadesse', 'Nigussie', 'Yohannes', 'Belay', 'Regassa', 'Hailu', 'Mekonnen', 'Bulti',
    ];

    private int $nameCursor = 0;

    public function run(): void
    {
        if (app()->environment('production', 'testing')) {
            return;
        }

        mt_srand(self::RANDOM_SEED);

        $admin = User::query()->where('email', 'admin@stpaulos.local')->first();

        if ($admin === null) {
            return; // DevUserSeeder owns the admin account and must run first.
        }

        $today = Carbon::today();
        $historyStart = $today->copy()->subMonths(12)->startOfMonth();
        $calendarStart = $today->copy()->startOfYear();
        $hasBaseline = User::query()->where('email', 'like', 'demo.%@stpaulos.local')->exists()
            && DutyAssignment::query()->exists();

        $sections = Section::query()->where('active', true)->orderBy('name')->get();
        $wardServiceBySection = DutyType::query()
            ->where('slug', 'like', '%_ward_service')
            ->get()
            ->keyBy(fn (DutyType $type) => $type->section_id);

        $staff = $this->seedStaff($sections);
        $this->includeWalkthroughAcademicUsers($sections, $staff);

        $this->seedRotationCalendars($calendarStart);

        if (! $hasBaseline) {
            $this->seedDutyAndEvaluations($admin, $sections, $wardServiceBySection, $staff, $historyStart, $today);
            $this->seedMorningYear($staff, $historyStart, $today);
            $this->seedUndergraduateYear($admin, $today);
        } else {
            $this->ensureMorningConfigurationAndToday($staff, $today);
        }

        $this->ensureCurrentDutyAssignments($admin, $sections, $wardServiceBySection, $staff, $today);
        $this->retireLegacyRepresentativeAccounts();
        $this->refreshCurrentUndergraduateData($admin, $today);
    }

    /**
     * Keep every documented browser-test academic identity inside the same
     * coherent section roster as the generated staff. This prevents orphaned
     * walkthrough accounts from creating false setup-health warnings.
     *
     * @param  array<string, array{consultants: list<User>, residents: list<User>}>  $staff
     */
    private function includeWalkthroughAcademicUsers($sections, array &$staff): void
    {
        $firstSection = $sections->first();
        $secondSection = $sections->skip(1)->first() ?? $firstSection;
        if ($firstSection === null || $secondSection === null) {
            return;
        }

        foreach ([
            ['email' => 'chaltu.tesfaye@stpaulhospital.demo', 'section' => $firstSection],
            ['email' => 'mesfin.girma@stpaulhospital.demo', 'section' => $secondSection],
        ] as $entry) {
            $consultant = User::query()->where('email', $entry['email'])->first();
            $section = $entry['section'];

            if ($consultant !== null) {
                $consultant->forceFill(['section_id' => $section->id])->save();
                if (! collect($staff[$section->slug]['consultants'])->contains('id', $consultant->id)) {
                    $staff[$section->slug]['consultants'][] = $consultant;
                }
            }
        }

        foreach ([
            ['email' => 'rediet.bekele@stpaulhospital.demo', 'section' => $firstSection, 'year' => 1, 'group' => 'A'],
            ['email' => 'samuel.alemu@stpaulhospital.demo', 'section' => $secondSection, 'year' => 2, 'group' => 'B'],
        ] as $entry) {
            $resident = User::query()->where('email', $entry['email'])->first();
            $section = $entry['section'];

            if ($resident !== null) {
                $resident->forceFill([
                    'training_year' => $entry['year'],
                    'rotation_group' => $entry['group'],
                ])->save();
                if (! collect($staff[$section->slug]['residents'])->contains('id', $resident->id)) {
                    $staff[$section->slug]['residents'][] = $resident;
                }
            }
        }
    }

    /**
     * Two consultants and three residents per section.
     *
     * @return array<string, array{consultants: list<User>, residents: list<User>}>
     */
    private function seedStaff($sections): array
    {
        $staff = [];

        foreach ($sections as $section) {
            $consultants = [];
            for ($i = 0; $i < self::CONSULTANTS_PER_SECTION; $i++) {
                $consultants[] = $this->makeUser('consultant', $section->slug, $i, [
                    'title' => 'Consultant',
                    'section_id' => $section->id,
                ]);
            }

            $residents = [];
            for ($i = 0; $i < self::RESIDENTS_PER_SECTION; $i++) {
                $residents[] = $this->makeUser('resident', $section->slug, $i, [
                    'title' => 'Resident',
                    'training_year' => ($i % 3) + 1,
                    'rotation_group' => $i % 2 === 0 ? 'A' : 'B',
                ]);
            }

            $staff[$section->slug] = ['consultants' => $consultants, 'residents' => $residents];

            if ($section->head_user_id !== $consultants[0]->id) {
                $section->forceFill(['head_user_id' => $consultants[0]->id])->save();
            }
        }

        return $staff;
    }

    /** @param array<string, mixed> $extra */
    private function makeUser(string $role, string $sectionSlug, int $index, array $extra): User
    {
        $first = self::FIRST_NAMES[$this->nameCursor % count(self::FIRST_NAMES)];
        $last = self::LAST_NAMES[$this->nameCursor % count(self::LAST_NAMES)];
        $this->nameCursor++;

        $email = sprintf('demo.%s.%s%d@stpaulos.local', $sectionSlug, $role === 'consultant' ? 'c' : 'r', $index + 1);

        return User::query()->firstOrCreate(
            ['email' => $email],
            array_merge([
                'username' => str_replace('@stpaulos.local', '', $email),
                'full_name' => ($role === 'consultant' ? 'Dr. ' : '').$first.' '.$last,
                'role_key' => $role,
                'password' => Hash::make(self::DEV_PASSWORD),
                'active' => true,
                'password_change_required' => false,
                'email_verified_at' => now(),
            ], $extra),
        );
    }

    private function seedRotationCalendars(Carbon $yearStart): void
    {
        $calendars = app(RotationCalendarService::class);
        $label = $yearStart->year.'/'.($yearStart->year + 1);

        // Year 1 and 2 on month-aligned blocks; Year 3 on the fixed 8-week cycle.
        foreach ([
            [1, 'calendar_month', null, 12],
            [2, 'calendar_month', null, 12],
            [3, 'fixed_weeks', 8, 6],
        ] as [$trainingYear, $mode, $fixedWeeks, $blockCount]) {
            if (! RotationCalendar::query()
                ->where('training_year', $trainingYear)
                ->where('academic_year_label', $label)
                ->exists()) {
                $calendars->createCalendar($trainingYear, $label, $yearStart->copy(), $mode, $fixedWeeks, $blockCount);
            }
        }
    }

    /** Ensure reruns continue to cover the current month as time moves on. */
    private function ensureCurrentDutyAssignments(User $admin, $sections, $wardServiceBySection, array $staff, Carbon $today): void
    {
        $roster = app(RosterService::class);
        $monthStart = $today->copy()->startOfMonth();
        $monthEnd = $today->copy()->endOfMonth();

        foreach ($sections as $section) {
            $wardType = $wardServiceBySection->get($section->id);
            if ($wardType === null) {
                continue;
            }

            foreach (array_merge($staff[$section->slug]['consultants'], $staff[$section->slug]['residents']) as $person) {
                $covered = DutyAssignment::query()
                    ->where('user_id', $person->id)
                    ->whereDate('starts_on', '<=', $monthEnd->toDateString())
                    ->whereDate('ends_on', '>=', $monthStart->toDateString())
                    ->whereHas('dutyType', fn ($query) => $query->where('granularity', 'monthly'))
                    ->exists();

                if (! $covered) {
                    $roster->createAssignment($person, $wardType, $monthStart, $monthEnd, 'admin', $admin, 'Demo roster refresh');
                }
            }
        }
    }

    /**
     * The backbone: for every month of the trailing year, put each section's
     * consultants and residents on that section's ward service, then file the
     * month's evaluations (the consultant grades each resident; each resident
     * grades the consultant's MDT round). Ward-sharing makes every pair
     * eligibility-consistent with the Phase 3 rule.
     *
     * @param  array<string, array{consultants: list<User>, residents: list<User>}>  $staff
     */
    private function seedDutyAndEvaluations(User $admin, $sections, $wardServiceBySection, array $staff, Carbon $yearStart, Carbon $today): void
    {
        $roster = app(RosterService::class);
        $forms = app(EvaluationFormService::class);
        $mdtForm = $forms->published('consultant_mdt');
        $acgmeForm = $forms->published('resident_acgme');

        // Seed the trailing year plus enough future coverage to fully span any
        // active eight-week Year 3 block. Evaluations remain historical only.
        $coverageEnd = $today->copy()->addMonths(2)->endOfMonth();
        for ($m = 0; $m <= 14; $m++) {
            $monthStart = $yearStart->copy()->addMonths($m)->startOfMonth();

            if ($monthStart->greaterThan($coverageEnd)) {
                break;
            }

            $monthEnd = $monthStart->copy()->endOfMonth();
            $evalDate = $monthStart->copy()->addDays(14);
            if ($evalDate->greaterThan($today)) {
                $evalDate = $today->copy();
            }

            foreach ($sections as $section) {
                $wardType = $wardServiceBySection->get($section->id);
                if ($wardType === null) {
                    continue;
                }
                $wardId = $wardType->ward_id;
                $group = $staff[$section->slug];

                foreach (array_merge($group['consultants'], $group['residents']) as $person) {
                    $roster->createAssignment(
                        $person,
                        $wardType,
                        $monthStart,
                        $monthEnd,
                        'rotation_planner',
                        $admin,
                        'Quality demo rotation plan',
                    );
                }

                if ($monthStart->greaterThan($today)) {
                    continue;
                }

                $leadConsultant = $group['consultants'][0];

                foreach ($group['residents'] as $resident) {
                    // Consultant grades the resident.
                    $forms->store($acgmeForm, $this->acgmePayload(), [
                        'author_id' => $leadConsultant->id,
                        'subject_user_id' => $resident->id,
                        'evaluation_date' => $evalDate->toDateString(),
                        'ward_id' => $wardId,
                        'placement_type' => 'ward',
                    ]);

                    // Resident grades the consultant's MDT round.
                    $forms->store($mdtForm, $this->mdtPayload(), [
                        'author_id' => $resident->id,
                        'subject_user_id' => $leadConsultant->id,
                        'evaluation_date' => $evalDate->toDateString(),
                        'ward_id' => $wardId,
                        'placement_type' => 'ward',
                    ]);
                }
            }
        }
    }

    /**
     * A year of morning sessions on the configured days, each recorded with a
     * snapshotted attendance roster (bulk-inserted for speed).
     *
     * @param  array<string, array{consultants: list<User>, residents: list<User>}>  $staff
     */
    private function seedMorningYear(array $staff, Carbon $yearStart, Carbon $today): void
    {
        $roster = app(RosterService::class);
        $recorder = $this->walkthroughMorningRecorder($staff);

        AppSetting::query()->updateOrCreate(
            ['setting_key' => 'academic_morning'],
            ['value_json' => [
                'session_days' => self::MORNING_DAYS,
                'session_time' => '08:00',
                'recorder_ids' => [$recorder->id],
            ]],
        );
        Cache::forget('app-settings:structured:v2');

        $attendanceRows = [];
        $cursor = $yearStart->copy();

        // Keep historical sessions recorded, but leave today's session for the
        // designated recorder to record or cancel through the real workflow.
        while ($cursor->lessThan($today)) {
            if (in_array($cursor->isoWeekday(), self::MORNING_DAYS, true)) {
                $onTime = rand(0, 4) !== 0;
                $session = MorningSession::query()->create([
                    'session_date' => $cursor->toDateString(),
                    'scheduled_start_at' => '08:00',
                    'actual_start_at' => $onTime ? null : sprintf('08:%02d', rand(6, 25)),
                    'started_on_time' => $onTime,
                    'status' => 'recorded',
                    'recorded_by' => $recorder->id,
                    'recorded_at' => $cursor->copy()->setTime(8, 20),
                ]);

                foreach ($roster->morningRosterOn($cursor) as $person) {
                    $attendanceRows[] = [
                        'id' => (string) Str::uuid(),
                        'morning_session_id' => $session->id,
                        'user_id' => $person->id,
                        'present' => rand(0, 9) < 8 ? 1 : 0,
                        'created_at' => $cursor->toDateTimeString(),
                        'updated_at' => $cursor->toDateTimeString(),
                    ];
                }

                if (count($attendanceRows) >= 500) {
                    DB::table('morning_attendance')->insert($attendanceRows);
                    $attendanceRows = [];
                }
            }

            $cursor->addDay();
        }

        if ($attendanceRows !== []) {
            DB::table('morning_attendance')->insert($attendanceRows);
        }
    }

    private function ensureMorningConfigurationAndToday(array $staff, Carbon $today): void
    {
        $recorder = $this->walkthroughMorningRecorder($staff);

        AppSetting::query()->updateOrCreate(
            ['setting_key' => 'academic_morning'],
            ['value_json' => [
                'session_days' => self::MORNING_DAYS,
                'session_time' => '08:00',
                'recorder_ids' => [$recorder->id],
            ]],
        );
        Cache::forget('app-settings:structured:v2');

        app(MorningSessionService::class)->openFor($today);
    }

    /** @param array<string, array{consultants: list<User>, residents: list<User>}> $staff */
    private function walkthroughMorningRecorder(array $staff): User
    {
        return User::query()->where('email', 'rediet.bekele@stpaulhospital.demo')->first()
            ?? $staff[array_key_first($staff)]['consultants'][0];
    }

    /**
     * Two undergraduate attachments within the year: one finished C2 block and
     * one current C1 block. Each gets a full roster, three reps, weekly ward
     * placements, generated teaching sessions marked held with student
     * attendance, and student evaluations.
     */
    private function seedUndergraduateYear(User $admin, Carbon $today): void
    {
        $wards = Ward::query()->whereIn('slug', ['pulmonology_ward', 'nephrology_ward'])->get();
        $wardA = $wards->firstWhere('slug', 'pulmonology_ward');
        $wardB = $wards->firstWhere('slug', 'nephrology_ward');

        $blocks = [
            ['cohort' => 'C2', 'label' => 'C2 Block 1', 'start' => $today->copy()->subWeeks(36), 'weeks' => 9, 'final' => true],
            ['cohort' => 'C1', 'label' => 'C1 Block 1', 'start' => $today->copy()->subWeeks(26), 'weeks' => 9, 'final' => true],
            ['cohort' => 'C2', 'label' => 'C2 Block 2', 'start' => $today->copy()->subWeeks(16), 'weeks' => 9, 'final' => true],
            ['cohort' => 'C1', 'label' => 'C1 Block 2', 'start' => $today->copy()->subWeeks(4), 'weeks' => 12, 'final' => false],
        ];

        foreach ($blocks as $block) {
            $this->seedBatch($admin, $block, $wardA, $wardB, $today);
        }
    }

    /** Keep local walkthrough data current and preserve all three rep scopes. */
    private function refreshCurrentUndergraduateData(User $admin, Carbon $today): void
    {
        $wards = Ward::query()->whereIn('slug', ['pulmonology_ward', 'nephrology_ward'])->get();
        $wardA = $wards->firstWhere('slug', 'pulmonology_ward');
        $wardB = $wards->firstWhere('slug', 'nephrology_ward');

        $activeBatches = StudentBatch::query()
            ->where('active', true)
            ->whereDate('starts_on', '<=', $today->toDateString())
            ->whereDate('ends_on', '>=', $today->toDateString())
            ->orderByDesc('starts_on')
            ->orderByDesc('created_at')
            ->get();

        if ($activeBatches->isEmpty()) {
            $this->seedBatch($admin, [
                'cohort' => 'C1',
                'label' => 'C1 Demo '.$today->format('Y-m'),
                'start' => $today->copy()->startOfWeek(),
                'weeks' => 12,
                'final' => false,
            ], $wardA, $wardB, $today);

            $activeBatches = StudentBatch::query()
                ->where('active', true)
                ->whereDate('starts_on', '<=', $today->toDateString())
                ->whereDate('ends_on', '>=', $today->toDateString())
                ->orderByDesc('starts_on')
                ->orderByDesc('created_at')
                ->get();
        }

        $weekStart = $today->copy()->startOfWeek();
        $weekEnd = $weekStart->copy()->endOfWeek();
        $currentBatchId = $activeBatches->first()?->id;

        foreach ($activeBatches as $batch) {
            foreach (['group', 'subgroup_a', 'subgroup_b'] as $scope) {
                $this->ensureStableRepresentativeAssignment($batch, $scope, $batch->id === $currentBatchId);
            }

            foreach ([['A', $wardA], ['B', $wardB]] as [$subgroup, $ward]) {
                if ($ward === null) {
                    continue;
                }

                // This column is cast as a date but stored as midnight. A plain
                // updateOrCreate date string does an exact comparison before the
                // model cast runs, so SQLite can miss the existing midnight row.
                $placement = SubgroupPlacement::query()
                    ->where('batch_id', $batch->id)
                    ->where('subgroup', $subgroup)
                    ->whereDate('week_starts_on', $weekStart->toDateString())
                    ->first() ?? new SubgroupPlacement([
                        'batch_id' => $batch->id,
                        'subgroup' => $subgroup,
                        'week_starts_on' => $weekStart->toDateString(),
                    ]);

                $placement->fill([
                    'ward_id' => $ward->id,
                    'week_ends_on' => $weekEnd->toDateString(),
                    'created_by' => $admin->id,
                ])->save();
            }

            app(TeachingService::class)->generateRange($weekStart, $today->copy()->addDays(7));
        }
    }

    /**
     * @param  array{cohort: string, label: string, start: Carbon, weeks: int, final: bool}  $block
     */
    private function seedBatch(User $admin, array $block, ?Ward $wardA, ?Ward $wardB, Carbon $today): void
    {
        $teaching = app(TeachingService::class);
        $forms = app(EvaluationFormService::class);

        $start = $block['start']->copy()->startOfWeek();
        $end = $start->copy()->addWeeks($block['weeks'])->endOfWeek();
        $shouldRemainActive = $today->between($start, $end);

        $batch = StudentBatch::query()->create([
            'cohort' => $block['cohort'],
            'label' => $block['label'],
            'starts_on' => $start->toDateString(),
            'ends_on' => $end->toDateString(),
            // Keep completed fixtures active while their historical teaching
            // sessions are generated; retire them after all history is built.
            'active' => true,
        ]);

        $students = [];
        for ($i = 0; $i < 18; $i++) {
            $first = self::FIRST_NAMES[$this->nameCursor % count(self::FIRST_NAMES)];
            $last = self::LAST_NAMES[($this->nameCursor + 7) % count(self::LAST_NAMES)];
            $this->nameCursor++;

            $students[] = Student::query()->create([
                'batch_id' => $batch->id,
                'full_name' => $first.' '.$last,
                'external_id' => sprintf('ETS-%s-%02d', strtoupper($block['cohort']), $i + 1),
                'subgroup' => $i % 2 === 0 ? 'A' : 'B',
                'active' => true,
            ]);
        }

        $reps = [];
        foreach (['group', 'subgroup_a', 'subgroup_b'] as $scope) {
            $assignment = $this->ensureStableRepresentativeAssignment($batch, $scope, ! $block['final']);
            $reps[$scope] = $assignment->user;
        }

        // Weekly ward placements per subgroup across the block.
        $week = $start->copy();
        while ($week->lessThan($end)) {
            foreach ([['A', $wardA], ['B', $wardB]] as [$subgroup, $ward]) {
                if ($ward === null) {
                    continue;
                }
                SubgroupPlacement::query()->create([
                    'batch_id' => $batch->id,
                    'subgroup' => $subgroup,
                    'ward_id' => $ward->id,
                    'week_starts_on' => $week->toDateString(),
                    'week_ends_on' => $week->copy()->endOfWeek()->toDateString(),
                    'created_by' => $admin->id,
                ]);
            }
            $week->addWeek();
        }

        // Generate the block's teaching sessions, then mark the past ones held
        // with student attendance.
        $generationEnd = $end->lessThan($today) ? $end : $today->copy()->addDays(7)->min($end);
        $teaching->generateRange($start, $generationEnd);

        $attendanceRows = [];
        $sessions = TeachingSession::query()
            ->where('batch_id', $batch->id)
            ->whereDate('scheduled_date', '<', $today->toDateString())
            ->get();

        foreach ($sessions as $session) {
            $recorder = $session->subgroup === 'A'
                ? $reps['subgroup_a']
                : ($session->subgroup === 'B' ? $reps['subgroup_b'] : $reps['group']);
            $outcome = $this->teachingOutcome($batch, $session);
            $session->forceFill([
                'status' => $outcome['status'],
                'reason' => $outcome['reason'],
                'recorded_by' => $recorder->id,
                'recorded_at' => $session->scheduled_date,
            ])->save();

            // Not-held and cancelled sessions are intentional anomalies. They
            // carry a reason but must never fabricate student attendance.
            if ($outcome['status'] !== 'held') {
                continue;
            }

            $cohortStudents = $session->subgroup === null
                ? $students
                : array_values(array_filter($students, fn (Student $s) => $s->subgroup === $session->subgroup));

            foreach ($cohortStudents as $student) {
                $attendanceRows[] = [
                    'id' => (string) Str::uuid(),
                    'teaching_session_id' => $session->id,
                    'student_id' => $student->id,
                    'present' => rand(0, 9) < 8 ? 1 : 0,
                    'recorded_by' => $recorder->id,
                    'created_at' => $session->scheduled_date->toDateTimeString(),
                    'updated_at' => $session->scheduled_date->toDateTimeString(),
                ];
            }

            if (count($attendanceRows) >= 500) {
                DB::table('student_attendance')->insert($attendanceRows);
                $attendanceRows = [];
            }
        }

        if ($attendanceRows !== []) {
            DB::table('student_attendance')->insert($attendanceRows);
        }

        // A genuine weekly evaluation series for every student, plus a final
        // evaluation for completed blocks. This gives undergraduate analytics
        // more than six months of trend depth instead of one point per batch.
        $weeklyForm = $forms->published('student_weekly');
        $finalForm = $forms->published('student_final');
        $evalDate = ($end->lessThan($today) ? $end : $today)->copy();
        $consultant = User::query()->where('role_key', 'consultant')->where('email', 'like', 'demo.%')->first();

        if ($consultant !== null) {
            foreach ($students as $student) {
                $evaluationWeek = $start->copy();
                while ($evaluationWeek->lessThanOrEqualTo($evalDate)) {
                    $weeklyDate = $evaluationWeek->copy()->endOfWeek()->min($evalDate);
                    $forms->store($weeklyForm, $this->studentWeeklyPayload(), [
                        'author_id' => $consultant->id,
                        'subject_student_id' => $student->id,
                        'evaluation_date' => $weeklyDate->toDateString(),
                        'ward_id' => $student->subgroup === 'B' ? $wardB?->id : $wardA?->id,
                        'placement_type' => 'ward',
                        'week_starts_on' => $evaluationWeek->toDateString(),
                    ]);
                    $evaluationWeek->addWeek();
                }

                if ($block['final']) {
                    $forms->store($finalForm, $this->studentFinalPayload(), [
                        'author_id' => $consultant->id,
                        'subject_student_id' => $student->id,
                        'evaluation_date' => $evalDate->toDateString(),
                        'ward_id' => $wardA?->id,
                        'placement_type' => 'ward',
                    ]);
                }
            }
        }

        if (! $shouldRemainActive) {
            $batch->forceFill(['active' => false])->save();
        }
    }

    /**
     * Retire representative logins created by the older batch-ID naming scheme.
     *
     * Keep the users and assignments as inactive history because past teaching
     * sessions may still reference them as the recorder. The deliberately narrow
     * local-demo pattern prevents this maintenance step from touching a real
     * representative account.
     */
    private function retireLegacyRepresentativeAccounts(): void
    {
        $legacyIds = User::query()
            ->where('role_key', 'student_rep')
            ->where('email', 'like', 'demo.batch%@stpaulos.local')
            ->where('username', 'like', 'demo.batch%.r%')
            ->pluck('id');

        if ($legacyIds->isEmpty()) {
            return;
        }

        DB::transaction(function () use ($legacyIds): void {
            RepAssignment::query()
                ->whereIn('user_id', $legacyIds)
                ->update(['active' => false]);

            User::query()
                ->whereIn('id', $legacyIds)
                ->update(['active' => false]);
        });
    }

    private function stableRepresentative(string $scope): User
    {
        $suffix = match ($scope) {
            'group' => 'group',
            'subgroup_a' => 'a',
            'subgroup_b' => 'b',
        };
        $fullName = match ($scope) {
            'group' => 'Group Student Representative',
            'subgroup_a' => 'Subgroup A Student Representative',
            'subgroup_b' => 'Subgroup B Student Representative',
        };

        $representative = User::query()->firstOrCreate(
            ['email' => "student.rep.{$suffix}@stpaulos.local"],
            [
                'username' => "student.rep.{$suffix}",
                'full_name' => $fullName,
                'title' => 'Student representative',
                'role_key' => 'student_rep',
                'password' => Hash::make(self::DEV_PASSWORD),
                'active' => true,
                'password_change_required' => false,
            ],
        );

        // These are explicitly local demo identities. Keep their readable
        // profile and role canonical across idempotent reruns, while preserving
        // a password that a developer may have intentionally changed.
        $representative->forceFill([
            'username' => "student.rep.{$suffix}",
            'full_name' => $fullName,
            'title' => 'Student representative',
            'role_key' => 'student_rep',
            'active' => true,
            'password_change_required' => false,
            'email_verified_at' => $representative->email_verified_at ?? now(),
        ]);

        if ($representative->isDirty()) {
            $representative->save();
        }

        return $representative;
    }

    private function ensureStableRepresentativeAssignment(StudentBatch $batch, string $scope, bool $active = true): RepAssignment
    {
        $representative = $this->stableRepresentative($scope);

        return DB::transaction(function () use ($batch, $scope, $representative, $active): RepAssignment {
            // This batch row is the shared mutex used by the admin lifecycle.
            // Deactivate a competing fixture before activating the stable one,
            // otherwise the database's active-scope unique key correctly
            // rejects a rerun that starts from an alternate active rep.
            StudentBatch::query()->lockForUpdate()->findOrFail($batch->id);
            User::query()->lockForUpdate()->findOrFail($representative->id);

            $stable = RepAssignment::query()
                ->where('batch_id', $batch->id)
                ->where('scope', $scope)
                ->where('user_id', $representative->id)
                ->lockForUpdate()
                ->first();

            // Completed or non-current batches keep their assignment history
            // but expose no operational representative.
            RepAssignment::query()
                ->where('batch_id', $batch->id)
                ->where('scope', $scope)
                ->when($stable !== null, fn ($query) => $query->whereKeyNot($stable->id))
                ->update(['active' => false]);

            if ($active) {
                // repScope is singular: move the stable account away from any
                // older batch before activating this assignment.
                RepAssignment::query()
                    ->where('user_id', $representative->id)
                    ->when($stable !== null, fn ($query) => $query->whereKeyNot($stable->id))
                    ->update(['active' => false]);
            }

            if ($stable === null) {
                $stable = RepAssignment::query()->create([
                    'user_id' => $representative->id,
                    'batch_id' => $batch->id,
                    'scope' => $scope,
                    'active' => $active,
                ]);
            } elseif ($stable->active !== $active) {
                $stable->forceFill(['active' => $active])->save();
            }

            return $stable->refresh()->load('user');
        });
    }

    // ---- Plausible answer payloads ----

    private function bool(int $failOneIn = 6): bool
    {
        return rand(1, $failOneIn) !== 1;
    }

    /** @return array<string, mixed> */
    private function mdtPayload(): array
    {
        return [
            'senior_present' => true,
            'senior_joined_at' => sprintf('08:%02d', rand(0, 20)),
            'presence_minutes' => rand(30, 60),
            'pct_patients_seen' => rand(60, 100),
            'round_delayed' => rand(1, 5) === 1,
            'all_patients_reviewed' => $this->bool(),
            'mgmt_plan_documented' => $this->bool(),
            'vte_assessed' => $this->bool(5),
            'discharge_discussed' => $this->bool(5),
            'med_review_done' => $this->bool(),
            'critical_labs_reviewed' => $this->bool(),
            'mdt_participants' => ['consultant', 'residents', 'nurse'],
            'system_issues' => rand(1, 3) === 1 ? ['lab_delay'] : [],
        ];
    }

    /** @return array<string, mixed> */
    private function acgmePayload(): array
    {
        return [
            'on_time' => $this->bool(),
            'professional' => $this->bool(8),
            'prepared' => $this->bool(),
            'management_plan' => $this->bool(5),
            'clinical_reasoning' => $this->bool(5),
            'presentation_clear' => $this->bool(),
            'communication' => $this->bool(),
            'documentation_timely' => $this->bool(4),
            'follow_through' => $this->bool(),
            'responsive_feedback' => $this->bool(8),
            'overall_rating' => rand(3, 5),
            'concerns' => rand(1, 3) === 1 ? ['punctuality'] : [],
        ];
    }

    /** @return array<string, mixed> */
    private function studentWeeklyPayload(): array
    {
        return [
            'attendance_reliable' => $this->bool(),
            'participation_active' => $this->bool(5),
            'clinical_knowledge' => $this->bool(4),
            'skills_progress' => $this->bool(4),
            'professional_conduct' => $this->bool(8),
            'overall_rating' => rand(3, 5),
        ];
    }

    /** @return array<string, mixed> */
    private function studentFinalPayload(): array
    {
        return [
            'knowledge_competent' => $this->bool(4),
            'skills_competent' => $this->bool(4),
            'professional_conduct' => $this->bool(8),
            'overall_rating' => rand(3, 5),
            'strengths' => 'Consistent, engaged, and reliable on the ward.',
            'areas_to_improve' => 'Broaden differential reasoning under time pressure.',
        ];
    }

    /**
     * Stable operational variation: most teaching happens, while a meaningful
     * minority is not held or cancelled so exception dashboards are useful.
     *
     * @return array{status: 'held'|'not_held'|'cancelled', reason: string|null}
     */
    private function teachingOutcome(StudentBatch $batch, TeachingSession $session): array
    {
        $signature = implode('|', [
            $batch->label,
            $session->scheduled_date->toDateString(),
            $session->activity_type,
            $session->subgroup ?? 'cohort',
        ]);
        $roll = crc32($signature) % 100;

        if ($roll < 78) {
            return ['status' => 'held', 'reason' => null];
        }

        if ($roll < 92) {
            $reasons = [
                'Consultant diverted to emergency clinical coverage',
                'Competing ward round exceeded the scheduled session time',
                'Students were attending a scheduled assessment',
            ];

            return ['status' => 'not_held', 'reason' => $reasons[$roll % count($reasons)]];
        }

        $reasons = [
            'Hospital-wide clinical meeting',
            'Public holiday teaching schedule',
            'Teaching ward temporarily unavailable',
        ];

        return ['status' => 'cancelled', 'reason' => $reasons[$roll % count($reasons)]];
    }
}
