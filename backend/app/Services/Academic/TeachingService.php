<?php

namespace App\Services\Academic;

use App\Models\Student;
use App\Models\StudentAttendance;
use App\Models\StudentBatch;
use App\Models\SubgroupPlacement;
use App\Models\TeachingActivitySchedule;
use App\Models\TeachingSession;
use App\Models\User;
use Carbon\CarbonInterface;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * Undergraduate teaching sessions (V2 Phase 5): generated from the weekly
 * activity schedule for every active batch, recorded held / not held by the
 * batch's representatives (a reason is REQUIRED when not held or cancelled),
 * with per-student attendance recorded by the consultant who taught.
 */
final class TeachingService
{
    /**
     * Upsert pending sessions for every active batch whose schedule matches
     * $date's weekday. Cohort-scope activities produce one row (subgroup
     * null); subgroup-scope activities produce one row per subgroup,
     * snapshotting the ward from that week's placement. A missing placement
     * leaves the ward null and the session still appears (admins see it
     * flagged). Idempotent: safe to run repeatedly; already-recorded sessions
     * are never touched.
     */
    public function generateSessions(CarbonInterface $date): int
    {
        $weekday = $date->isoWeekday();

        $batches = StudentBatch::query()
            ->where('active', true)
            ->whereDate('starts_on', '<=', $date->toDateString())
            ->whereDate('ends_on', '>=', $date->toDateString())
            ->get();

        if ($batches->isEmpty()) {
            return 0;
        }

        $schedules = TeachingActivitySchedule::query()
            ->where('active', true)
            ->where('weekday', $weekday)
            ->get()
            ->groupBy('cohort');

        $generated = 0;

        foreach ($batches as $batch) {
            foreach ($schedules->get($batch->cohort, collect()) as $schedule) {
                $subgroups = $schedule->scope === 'cohort' ? [null] : ['A', 'B'];

                foreach ($subgroups as $subgroup) {
                    $wardId = $subgroup === null
                        ? null
                        : SubgroupPlacement::query()
                            ->where('batch_id', $batch->id)
                            ->where('subgroup', $subgroup)
                            ->whereDate('week_starts_on', '<=', $date->toDateString())
                            ->whereDate('week_ends_on', '>=', $date->toDateString())
                            ->value('ward_id');

                    $existing = TeachingSession::query()
                        ->where('batch_id', $batch->id)
                        ->where('subgroup', $subgroup)
                        ->where('activity_type', $schedule->activity_type)
                        ->whereDate('scheduled_date', $date->toDateString())
                        ->first();

                    if ($existing !== null) {
                        // Refresh the ward snapshot only while nothing has
                        // been recorded yet (a placement fix should land).
                        if ($existing->status === 'pending' && $existing->ward_id !== $wardId) {
                            $existing->forceFill(['ward_id' => $wardId])->save();
                        }

                        continue;
                    }

                    TeachingSession::query()->create([
                        'batch_id' => $batch->id,
                        'subgroup' => $subgroup,
                        'activity_type' => $schedule->activity_type,
                        'scheduled_date' => $date->toDateString(),
                        'ward_id' => $wardId,
                    ]);
                    $generated++;
                }
            }
        }

        return $generated;
    }

    /** Generate a whole date range (admin edits to placements or schedules). */
    public function generateRange(CarbonInterface $from, CarbonInterface $to): int
    {
        $generated = 0;
        $cursor = $from->copy();

        while ($cursor->lessThanOrEqualTo($to)) {
            $generated += $this->generateSessions($cursor);
            $cursor = $cursor->copy()->addDay();
        }

        return $generated;
    }

    /** A rep (or admin) records whether the activity happened. */
    public function record(TeachingSession $session, string $status, ?string $reason, User $by): TeachingSession
    {
        if (! in_array($status, ['held', 'not_held', 'cancelled'], true)) {
            throw ValidationException::withMessages([
                'status' => ['A session is recorded as held, not held, or cancelled.'],
            ]);
        }

        if (in_array($status, ['not_held', 'cancelled'], true) && ($reason === null || trim($reason) === '')) {
            throw ValidationException::withMessages([
                'reason' => ['A reason is required when the session was not held or was cancelled.'],
            ]);
        }

        $session->forceFill([
            'status' => $status,
            'reason' => $status === 'held' ? null : $reason,
            'recorded_by' => $by->id,
            'recorded_at' => now(),
        ])->save();

        return $session;
    }

    /**
     * The consultant who taught marks each student present or absent; doing
     * so also flips a pending session to held.
     *
     * @param  array<string, bool>  $presence  student id => present
     */
    public function recordAttendance(TeachingSession $session, array $presence, User $by): TeachingSession
    {
        if ($session->status === 'cancelled') {
            throw ValidationException::withMessages([
                'session' => ['A cancelled session has no attendance.'],
            ]);
        }

        $roster = $this->rosterFor($session)->keyBy('id');

        DB::transaction(function () use ($session, $presence, $by, $roster): void {
            foreach ($presence as $studentId => $present) {
                if (! $roster->has($studentId)) {
                    throw ValidationException::withMessages([
                        'presence' => ['One of the students is not on this session\'s roster.'],
                    ]);
                }

                StudentAttendance::query()->updateOrCreate(
                    ['teaching_session_id' => $session->id, 'student_id' => $studentId],
                    ['present' => (bool) $present, 'recorded_by' => $by->id],
                );
            }

            if ($session->status === 'pending') {
                $session->forceFill([
                    'status' => 'held',
                    'recorded_by' => $session->recorded_by ?? $by->id,
                    'recorded_at' => $session->recorded_at ?? now(),
                ])->save();
            }
        });

        return $session->refresh();
    }

    /**
     * The students expected at the session: the whole batch for cohort-scope
     * activities, one subgroup otherwise.
     *
     * @return Collection<int, Student>
     */
    public function rosterFor(TeachingSession $session): Collection
    {
        return Student::query()
            ->where('batch_id', $session->batch_id)
            ->where('active', true)
            ->when($session->subgroup !== null, fn ($query) => $query->where('subgroup', $session->subgroup))
            ->orderBy('full_name')
            ->get();
    }
}
