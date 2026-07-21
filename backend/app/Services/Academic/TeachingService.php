<?php

namespace App\Services\Academic;

use App\Models\Student;
use App\Models\StudentAttendance;
use App\Models\StudentBatch;
use App\Models\SubgroupPlacement;
use App\Models\TeachingActivitySchedule;
use App\Models\TeachingSession;
use App\Models\User;
use App\Support\HospitalClock;
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

        $schedules = TeachingActivitySchedule::query()
            ->where('active', true)
            ->where('weekday', $weekday)
            ->get()
            ->groupBy('cohort');

        // One query each for the day's placements and existing sessions:
        // the loop below is per batch x activity x subgroup and must not
        // query per cell.
        $placements = $batches->isEmpty()
            ? collect()
            : SubgroupPlacement::query()
                ->whereIn('batch_id', $batches->pluck('id'))
                ->whereDate('week_starts_on', '<=', $date->toDateString())
                ->whereDate('week_ends_on', '>=', $date->toDateString())
                ->get()
                ->keyBy(fn (SubgroupPlacement $placement) => $placement->batch_id.'|'.$placement->subgroup);

        $existingSessions = $batches->isEmpty()
            ? collect()
            : TeachingSession::query()
                ->whereIn('batch_id', $batches->pluck('id'))
                ->whereDate('scheduled_date', $date->toDateString())
                ->get()
                ->keyBy(fn (TeachingSession $session) => $this->sessionKey(
                    $session->batch_id,
                    $session->subgroup,
                    $session->activity_type,
                ));

        $generated = 0;
        $expectedKeys = [];

        foreach ($batches as $batch) {
            foreach ($schedules->get($batch->cohort, collect()) as $schedule) {
                $subgroups = $schedule->scope === 'cohort' ? [null] : ['A', 'B'];

                foreach ($subgroups as $subgroup) {
                    $sessionKey = $this->sessionKey($batch->id, $subgroup, $schedule->activity_type);
                    $expectedKeys[$sessionKey] = true;
                    $wardId = $subgroup === null
                        ? null
                        : $placements->get($batch->id.'|'.$subgroup)?->ward_id;

                    $existing = $existingSessions->get($sessionKey);

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

        // Schedule lifecycle changes reconcile the coming range through this
        // same path. Past pending rows remain evidence of activities that were
        // never recorded, while current/future pending rows with no active
        // schedule backing are safe to remove.
        if ($date->toDateString() >= HospitalClock::today()->toDateString()) {
            $this->removeObsoletePendingSessions($date, $expectedKeys);
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

        return DB::transaction(function () use ($session, $status, $reason, $by): TeachingSession {
            $locked = TeachingSession::query()->lockForUpdate()->find($session->id);

            if ($locked === null) {
                throw ValidationException::withMessages([
                    'session' => ['This teaching session is no longer available.'],
                ]);
            }

            if ($locked->status === 'pending' && ! $this->isBackedByActiveSchedule($locked)) {
                throw ValidationException::withMessages([
                    'session' => ['This teaching session is no longer part of the active schedule.'],
                ]);
            }

            $locked->forceFill([
                'status' => $status,
                'reason' => $status === 'held' ? null : $reason,
                'recorded_by' => $by->id,
                'recorded_at' => now(),
            ])->save();

            return $locked;
        });
    }

    /** Whether a session still corresponds to the active batch program. */
    public function isBackedByActiveSchedule(TeachingSession $session): bool
    {
        $batch = $session->batch()->first();

        if ($batch === null || ! $batch->active
            || $session->scheduled_date->lt($batch->starts_on)
            || $session->scheduled_date->gt($batch->ends_on)) {
            return false;
        }

        return TeachingActivitySchedule::query()
            ->where('active', true)
            ->where('cohort', $batch->cohort)
            ->where('activity_type', $session->activity_type)
            ->where('weekday', $session->scheduled_date->isoWeekday())
            ->where('scope', $session->subgroup === null ? 'cohort' : 'subgroup')
            ->exists();
    }

    /**
     * The consultant who taught marks each student present or absent; doing
     * so also flips a pending session to held.
     *
     * @param  array<string, bool>  $presence  student id => present
     */
    public function recordAttendance(TeachingSession $session, array $presence, User $by): TeachingSession
    {
        return DB::transaction(function () use ($session, $presence, $by): TeachingSession {
            $locked = TeachingSession::query()->lockForUpdate()->find($session->id);

            if ($locked === null) {
                throw ValidationException::withMessages([
                    'session' => ['This teaching session is no longer available.'],
                ]);
            }

            if ($locked->status === 'cancelled') {
                throw ValidationException::withMessages([
                    'session' => ['A cancelled session has no attendance.'],
                ]);
            }

            if ($locked->status === 'pending' && ! $this->isBackedByActiveSchedule($locked)) {
                throw ValidationException::withMessages([
                    'session' => ['This teaching session is no longer part of the active schedule.'],
                ]);
            }

            $roster = $this->rosterFor($locked)->keyBy('id');

            foreach ($presence as $studentId => $present) {
                if (! $roster->has($studentId)) {
                    throw ValidationException::withMessages([
                        'presence' => ['One of the students is not on this session\'s roster.'],
                    ]);
                }

                StudentAttendance::query()->updateOrCreate(
                    ['teaching_session_id' => $locked->id, 'student_id' => $studentId],
                    ['present' => (bool) $present, 'recorded_by' => $by->id],
                );
            }

            if ($locked->status === 'pending') {
                $locked->forceFill([
                    'status' => 'held',
                    'recorded_by' => $locked->recorded_by ?? $by->id,
                    'recorded_at' => $locked->recorded_at ?? now(),
                ])->save();
            }

            return $locked->refresh();
        });
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

    /**
     * @param  array<string, true>  $expectedKeys
     */
    private function removeObsoletePendingSessions(CarbonInterface $date, array $expectedKeys): void
    {
        TeachingSession::query()
            ->whereDate('scheduled_date', $date->toDateString())
            ->where('status', 'pending')
            ->get()
            ->each(function (TeachingSession $session) use ($expectedKeys): void {
                $key = $this->sessionKey($session->batch_id, $session->subgroup, $session->activity_type);

                if (! isset($expectedKeys[$key])) {
                    // Include status in the DELETE predicate: if a recorder
                    // wins the race, their completed evidence is preserved.
                    TeachingSession::query()
                        ->whereKey($session->id)
                        ->where('status', 'pending')
                        ->delete();
                }
            });
    }

    private function sessionKey(string $batchId, ?string $subgroup, string $activityType): string
    {
        return $batchId.'|'.($subgroup ?? '-').'|'.$activityType;
    }
}
