<?php

namespace Database\Seeders;

use App\Models\AppSetting;
use App\Models\DutyType;
use App\Models\Evaluation;
use App\Models\EvaluationForm;
use App\Models\MorningSession;
use App\Models\RepAssignment;
use App\Models\Section;
use App\Models\Student;
use App\Models\StudentBatch;
use App\Models\TeachingSession;
use App\Models\User;
use App\Services\Academic\EvaluationFormService;
use App\Services\Academic\RosterService;
use App\Services\Academic\TeachingService;
use Database\Seeders\Concerns\GeneratesAcademicFixtures;
use Illuminate\Database\Seeder;
use Illuminate\Support\Carbon;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * LOCAL-ONLY: carry the academic fixture forward to today.
 *
 * DevAcademicDataSeeder builds its year of history ONCE and then guards itself
 * with a baseline sentinel, so every later run only refreshes the "current"
 * rows (duty roster, placements, this week's teaching). The consequence is that
 * a fixture seeded in month N shows an empty morning register, no ward
 * evaluations and no recorded teaching for every month after N - the dashboards
 * look broken even though the data was right when it was built.
 *
 * This seeder closes that gap. For every section it fills the months between
 * the last seeded row and today, and it is gap-driven rather than window-driven:
 * it asks each table where its own history stops and writes only what is
 * missing, so running it twice is a no-op and running it after six idle months
 * fills six months.
 *
 * The answer payloads come from the shared trait, so backfilled scores sit on
 * the same standing curve as the original history and the trend lines carry no
 * step at the seam.
 *
 * Never runs in production or testing.
 */
class DevAcademicGapSeeder extends Seeder
{
    use GeneratesAcademicFixtures;

    private const RANDOM_SEED = 20260722;

    /**
     * The month span the original history was drawn over. Feeding the same
     * count to standingAt() keeps a person's trend on one continuous line
     * instead of restarting it at the backfill boundary.
     */
    private const TREND_MONTH_COUNT = 14;

    private const INSERT_BATCH_SIZE = 500;

    public function run(): void
    {
        if (app()->environment('production', 'testing')) {
            $this->command?->warn('DevAcademicGapSeeder skipped (non-dev environment).');

            return;
        }

        mt_srand(self::RANDOM_SEED);

        $today = Carbon::today();

        $evaluations = $this->backfillWardEvaluations($today);
        $morning = $this->backfillMorningSessions($today);
        $teaching = $this->backfillTeachingSessions($today);
        $students = $this->backfillStudentWeeklyEvaluations($today);

        if ($evaluations + $morning['sessions'] + $teaching['recorded'] + $students === 0) {
            $this->command?->info('Academic fixture already reaches '.$today->toDateString().'; nothing to backfill.');

            return;
        }

        $this->command?->info(sprintf(
            'Academic backfill to %s: %d ward evaluations, %d morning sessions (%d attendance rows), %d teaching sessions recorded (%d attendance rows), %d student weekly evaluations.',
            $today->toDateString(),
            $evaluations,
            $morning['sessions'],
            $morning['attendance'],
            $teaching['recorded'],
            $teaching['attendance'],
            $students,
        ));
    }

    /**
     * The monthly ward-service pair: the consultant grades each resident on the
     * ACGME form, the resident grades that consultant's MDT round. Both sides
     * are filed against the section's ward, which is what keeps the pair
     * eligibility-consistent with the Phase 3 rule.
     */
    private function backfillWardEvaluations(Carbon $today): int
    {
        $baseline = Evaluation::query()
            ->whereIn('form_key', ['consultant_mdt', 'resident_acgme'])
            ->min('evaluation_date');

        if ($baseline === null) {
            // A cold start is DevAcademicDataSeeder's job. There is no history
            // to continue from and inventing one here would fight it.
            return 0;
        }

        $forms = app(EvaluationFormService::class);
        $mdtForm = $forms->published('consultant_mdt');
        $acgmeForm = $forms->published('resident_acgme');

        $baselineMonth = Carbon::parse($baseline)->startOfMonth();
        $wardServiceBySection = DutyType::query()
            ->where('slug', 'like', '%_ward_service')
            ->get()
            ->keyBy(fn (DutyType $type) => $type->section_id);

        $sections = Section::query()->where('active', true)->orderBy('name')->get();
        $created = 0;

        foreach ($sections as $section) {
            $wardType = $wardServiceBySection->get($section->id);

            if ($wardType === null) {
                continue;
            }

            $month = $this->nextMonthToFill($wardType->id, $baselineMonth);

            while ($month->lessThanOrEqualTo($today)) {
                $monthIndex = (int) $baselineMonth->diffInMonths($month);
                $evalDate = $month->copy()->addDays(14);

                if ($evalDate->greaterThan($today)) {
                    $evalDate = $today->copy();
                }

                // Who was actually on this section's ward service that month.
                // Only residents carry a section on the user record, so the
                // roster - which is what the Phase 3 eligibility rule reads
                // too - is the honest source for section membership.
                $onService = $this->staffOnService($wardType->id, $month);
                $consultants = $onService->where('role_key', 'consultant')->values();
                $residents = $onService->where('role_key', 'resident')->values();

                if ($consultants->isEmpty() || $residents->isEmpty()) {
                    $month = $month->copy()->addMonth()->startOfMonth();

                    continue;
                }

                foreach ($residents as $residentIndex => $resident) {
                    // The same rotation rule as the original history, so no
                    // consultant suddenly acquires (or loses) an assessor role
                    // at the seam.
                    $consultant = $consultants[($monthIndex + $residentIndex) % $consultants->count()];

                    $created += $this->storeOnce($forms, $acgmeForm, $this->acgmePayload(
                        $this->standingAt($resident->id, $monthIndex, self::TREND_MONTH_COUNT)
                    ), [
                        'author_id' => $consultant->id,
                        'subject_user_id' => $resident->id,
                        'evaluation_date' => $evalDate->toDateString(),
                        'ward_id' => $wardType->ward_id,
                        'placement_type' => 'ward',
                    ]);

                    $created += $this->storeOnce($forms, $mdtForm, $this->mdtPayload(
                        $this->standingAt($consultant->id, $monthIndex, self::TREND_MONTH_COUNT)
                    ), [
                        'author_id' => $resident->id,
                        'subject_user_id' => $consultant->id,
                        'evaluation_date' => $evalDate->toDateString(),
                        'ward_id' => $wardType->ward_id,
                        'placement_type' => 'ward',
                    ]);
                }

                $month = $month->copy()->addMonth()->startOfMonth();
            }
        }

        return $created;
    }

    /**
     * The month after this section's last evaluated one, or the start of the
     * whole fixture when the section has nothing on record yet.
     *
     * Keyed on the section's duty type rather than its ward: eight sections
     * share six wards, so a ward-keyed lookup would report one section's
     * history as another's and skip a real gap.
     */
    private function nextMonthToFill(string $dutyTypeId, Carbon $baselineMonth): Carbon
    {
        $last = Evaluation::query()
            ->whereIn('form_key', ['consultant_mdt', 'resident_acgme'])
            ->whereIn('subject_user_id', $this->everOnService($dutyTypeId))
            ->max('evaluation_date');

        if ($last === null) {
            return $baselineMonth->copy();
        }

        return Carbon::parse($last)->startOfMonth()->addMonth();
    }

    /**
     * Everyone ever rostered onto a section's ward service.
     *
     * @return Collection<int, string>
     */
    private function everOnService(string $dutyTypeId)
    {
        return DB::table('duty_assignments')
            ->where('duty_type_id', $dutyTypeId)
            ->distinct()
            ->pluck('user_id');
    }

    /**
     * The consultants and residents rostered onto a section's ward service for
     * a given month.
     *
     * @return \Illuminate\Database\Eloquent\Collection<int, User>
     */
    private function staffOnService(string $dutyTypeId, Carbon $month)
    {
        $monthEnd = $month->copy()->endOfMonth();

        return User::query()
            ->where('active', true)
            ->whereIn('role_key', ['consultant', 'resident'])
            ->whereExists(fn ($query) => $query
                ->select(DB::raw(1))
                ->from('duty_assignments')
                ->whereColumn('duty_assignments.user_id', 'users.id')
                ->where('duty_assignments.duty_type_id', $dutyTypeId)
                ->whereDate('duty_assignments.starts_on', '<=', $monthEnd->toDateString())
                ->whereDate('duty_assignments.ends_on', '>=', $month->toDateString()))
            ->orderBy('full_name')
            ->get();
    }

    /**
     * The unique key on (author, subject, date, form) is what stops a repeat
     * submission from casting a second vote in every analytics mean, so the
     * backfill respects it rather than relying on catching the violation.
     *
     * @param  array<string, mixed>  $payload
     * @param  array<string, mixed>  $context
     */
    private function storeOnce(EvaluationFormService $forms, EvaluationForm $form, array $payload, array $context): int
    {
        $exists = Evaluation::query()
            ->where('author_id', $context['author_id'])
            ->where('form_key', $form->key)
            ->whereDate('evaluation_date', $context['evaluation_date'])
            ->when(
                isset($context['subject_user_id']),
                fn ($query) => $query->where('subject_user_id', $context['subject_user_id']),
                fn ($query) => $query->where('subject_student_id', $context['subject_student_id'] ?? null),
            )
            ->exists();

        if ($exists) {
            return 0;
        }

        $forms->store($form, $payload, $context);

        return 1;
    }

    /**
     * Every configured morning-session day between the last recorded session
     * and yesterday, each with the attendance roster that was on ward service
     * that day. Today is deliberately left alone: the designated recorder opens
     * and records it through the real workflow.
     *
     * @return array{sessions: int, attendance: int}
     */
    private function backfillMorningSessions(Carbon $today): array
    {
        $last = MorningSession::query()->max('session_date');

        if ($last === null) {
            return ['sessions' => 0, 'attendance' => 0];
        }

        $config = AppSetting::query()->where('setting_key', 'academic_morning')->first()?->value_json ?? [];
        $days = $config['session_days'] ?? [1, 3, 5];
        $recorderId = $config['recorder_ids'][0] ?? null;

        $recorder = $recorderId !== null ? User::query()->find($recorderId) : null;
        $recorder ??= User::query()->where('role_key', 'consultant')->where('active', true)->first();

        if ($recorder === null) {
            return ['sessions' => 0, 'attendance' => 0];
        }

        $roster = app(RosterService::class);
        $existing = MorningSession::query()
            ->whereDate('session_date', '>=', Carbon::parse($last)->toDateString())
            ->pluck('session_date')
            ->map(fn ($date) => Carbon::parse($date)->toDateString())
            ->flip();

        $cursor = Carbon::parse($last)->addDay();
        $sessions = 0;
        $attendance = 0;
        $attendanceRows = [];

        while ($cursor->lessThan($today)) {
            if (! in_array($cursor->isoWeekday(), $days, true) || $existing->has($cursor->toDateString())) {
                $cursor->addDay();

                continue;
            }

            $onTime = rand(0, 4) !== 0;
            $session = MorningSession::query()->create([
                'session_date' => $cursor->toDateString(),
                'scheduled_start_at' => $config['session_time'] ?? '08:00',
                'actual_start_at' => $onTime ? null : sprintf('08:%02d', rand(6, 25)),
                'started_on_time' => $onTime,
                'status' => 'recorded',
                'recorded_by' => $recorder->id,
                'recorded_at' => $cursor->copy()->setTime(8, 20),
            ]);
            $sessions++;

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

            if (count($attendanceRows) >= self::INSERT_BATCH_SIZE) {
                DB::table('morning_attendance')->insert($attendanceRows);
                $attendance += count($attendanceRows);
                $attendanceRows = [];
            }

            $cursor->addDay();
        }

        if ($attendanceRows !== []) {
            DB::table('morning_attendance')->insert($attendanceRows);
            $attendance += count($attendanceRows);
        }

        return ['sessions' => $sessions, 'attendance' => $attendance];
    }

    /**
     * Generate the teaching sessions the active batches should have had, then
     * record every past pending one. Past pending rows are the visible symptom
     * of a stale fixture: the schedule produced them and nobody ever said
     * whether the teaching happened.
     *
     * @return array{recorded: int, attendance: int}
     */
    private function backfillTeachingSessions(Carbon $today): array
    {
        $batches = $this->currentBatches($today);

        if ($batches->isEmpty()) {
            return ['recorded' => 0, 'attendance' => 0];
        }

        $teaching = app(TeachingService::class);
        $recorded = 0;
        $attendance = 0;

        foreach ($batches as $batch) {
            $generationEnd = $today->copy()->addDays(7);
            if ($generationEnd->greaterThan($batch->ends_on)) {
                $generationEnd = $batch->ends_on->copy();
            }

            // generateSessions is idempotent and never touches a recorded row,
            // so the cheapest correct range is the whole block to date.
            $teaching->generateRange($batch->starts_on->copy(), $generationEnd);

            $reps = RepAssignment::query()
                ->where('batch_id', $batch->id)
                ->with('user')
                ->get()
                ->keyBy('scope');

            $fallbackRecorder = $reps->first()?->user
                ?? User::query()->whereIn('role_key', ['admin', 'superadmin'])->first();

            if ($fallbackRecorder === null) {
                continue;
            }

            $students = Student::query()
                ->where('batch_id', $batch->id)
                ->where('active', true)
                ->get();

            $pending = TeachingSession::query()
                ->where('batch_id', $batch->id)
                ->where('status', 'pending')
                ->whereDate('scheduled_date', '<', $today->toDateString())
                ->orderBy('scheduled_date')
                ->get();

            $attendanceRows = [];

            foreach ($pending as $session) {
                $recorder = match ($session->subgroup) {
                    'A' => $reps->get('subgroup_a')?->user,
                    'B' => $reps->get('subgroup_b')?->user,
                    default => $reps->get('group')?->user,
                } ?? $fallbackRecorder;

                $outcome = $this->teachingOutcome($batch, $session);
                $session->forceFill([
                    'status' => $outcome['status'],
                    'reason' => $outcome['reason'],
                    'recorded_by' => $recorder->id,
                    'recorded_at' => $session->scheduled_date,
                ])->save();
                $recorded++;

                // Not-held and cancelled sessions are intentional anomalies:
                // they carry a reason and must never fabricate attendance.
                if ($outcome['status'] !== 'held') {
                    continue;
                }

                $cohort = $session->subgroup === null
                    ? $students
                    : $students->where('subgroup', $session->subgroup);

                foreach ($cohort as $student) {
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

                if (count($attendanceRows) >= self::INSERT_BATCH_SIZE) {
                    DB::table('student_attendance')->insert($attendanceRows);
                    $attendance += count($attendanceRows);
                    $attendanceRows = [];
                }
            }

            if ($attendanceRows !== []) {
                DB::table('student_attendance')->insert($attendanceRows);
                $attendance += count($attendanceRows);
            }
        }

        return ['recorded' => $recorded, 'attendance' => $attendance];
    }

    /** The weekly student series for the batches that are still on the ward. */
    private function backfillStudentWeeklyEvaluations(Carbon $today): int
    {
        $batches = $this->currentBatches($today);

        if ($batches->isEmpty()) {
            return 0;
        }

        $forms = app(EvaluationFormService::class);
        $weeklyForm = $forms->published('student_weekly');

        $consultants = User::query()
            ->where('role_key', 'consultant')
            ->where('active', true)
            ->orderBy('full_name')
            ->get()
            ->values();

        if ($consultants->isEmpty()) {
            return 0;
        }

        $created = 0;

        foreach ($batches as $batch) {
            $start = $batch->starts_on->copy()->startOfWeek();
            $end = $batch->ends_on->copy();
            $evalDate = $end->lessThan($today) ? $end->copy() : $today->copy();
            $blockWeeks = max(1, (int) $start->diffInWeeks($end));

            $students = Student::query()
                ->where('batch_id', $batch->id)
                ->where('active', true)
                ->orderBy('created_at')
                ->get()
                ->values();

            if ($students->isEmpty()) {
                continue;
            }

            // One query for the whole batch: the loop below is per student x
            // week and must not ask the database per cell.
            $filed = Evaluation::query()
                ->where('form_key', 'student_weekly')
                ->whereIn('subject_student_id', $students->pluck('id'))
                ->get(['subject_student_id', 'week_starts_on'])
                ->map(fn (Evaluation $evaluation) => $evaluation->subject_student_id.'|'
                    .Carbon::parse($evaluation->week_starts_on)->toDateString())
                ->flip();

            foreach ($students as $index => $student) {
                $consultant = $consultants[$index % $consultants->count()];
                $week = $start->copy();
                $weekIndex = 0;

                while ($week->lessThanOrEqualTo($evalDate)) {
                    if ($filed->has($student->id.'|'.$week->toDateString())) {
                        $week->addWeek();
                        $weekIndex++;

                        continue;
                    }

                    $weekEnd = $week->copy()->endOfWeek();

                    $forms->store($weeklyForm, $this->studentWeeklyPayload(
                        $this->standingAt($student->id, $weekIndex, $blockWeeks)
                    ), [
                        'author_id' => $consultant->id,
                        'subject_student_id' => $student->id,
                        'evaluation_date' => ($weekEnd->greaterThan($evalDate) ? $evalDate : $weekEnd)->toDateString(),
                        'ward_id' => $this->wardForStudent($batch->id, $student->subgroup, $week),
                        'placement_type' => 'ward',
                        'week_starts_on' => $week->toDateString(),
                    ]);
                    $created++;

                    $week->addWeek();
                    $weekIndex++;
                }
            }
        }

        return $created;
    }

    /** @return \Illuminate\Database\Eloquent\Collection<int, StudentBatch> */
    private function currentBatches(Carbon $today)
    {
        return StudentBatch::query()
            ->where('active', true)
            ->whereDate('starts_on', '<=', $today->toDateString())
            ->whereDate('ends_on', '>=', $today->toDateString())
            ->orderBy('starts_on')
            ->get();
    }

    /** The ward that subgroup was actually placed on that week, if any. */
    private function wardForStudent(string $batchId, ?string $subgroup, Carbon $week): ?string
    {
        return DB::table('subgroup_placements')
            ->where('batch_id', $batchId)
            ->where('subgroup', $subgroup)
            ->whereDate('week_starts_on', '<=', $week->toDateString())
            ->whereDate('week_ends_on', '>=', $week->toDateString())
            ->value('ward_id');
    }
}
