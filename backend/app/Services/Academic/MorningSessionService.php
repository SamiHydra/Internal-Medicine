<?php

namespace App\Services\Academic;

use App\Models\MorningAttendance;
use App\Models\MorningRosterOverride;
use App\Models\MorningSession;
use App\Models\Notification;
use App\Models\User;
use App\Services\Admin\AppSettingsService;
use App\Support\HospitalClock;
use Carbon\CarbonInterface;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Validation\ValidationException;

/**
 * The department-wide morning session (V2 Phase 6): opened automatically on
 * the configured days, punctuality measured against the configured start
 * (snapshotted per session), the expected roster generated from current duty
 * assignments plus admin include/exclude overrides, and attendance
 * SNAPSHOTTED at recording so later roster changes never rewrite history.
 * A session left pending is a signal, not an error.
 */
final class MorningSessionService
{
    public function __construct(
        private readonly RosterService $rosterService,
        private readonly AppSettingsService $settings,
    ) {}

    /** @return array{morningSessionDays: list<int>, morningSessionTime: string, morningRecorderIds: list<string>} */
    public function config(): array
    {
        return $this->settings->structured()['academic'];
    }

    public function isSessionDay(CarbonInterface $date): bool
    {
        return in_array($date->isoWeekday(), $this->config()['morningSessionDays'], true);
    }

    public function isRecorder(User $user): bool
    {
        return in_array($user->id, $this->config()['morningRecorderIds'], true);
    }

    /** Idempotently open the pending session for a configured day. */
    public function openFor(CarbonInterface $date): ?MorningSession
    {
        if (! $this->isSessionDay($date)) {
            return null;
        }

        // whereDate, not firstOrCreate: the date column round-trips with a
        // time component on SQLite, which would dodge the equality match and
        // trip the unique key.
        $existing = MorningSession::query()
            ->whereDate('session_date', $date->toDateString())
            ->first();

        // The status is set explicitly rather than left to the column default:
        // a freshly created model carries only the attributes it was given, so
        // the first read after a lazy open serialised `status: null` and the
        // recorder page could not tell a pending session from a missing one.
        return $existing ?? MorningSession::query()->create([
            'session_date' => $date->toDateString(),
            'scheduled_start_at' => $this->config()['morningSessionTime'],
            'status' => 'pending',
        ]);
    }

    /**
     * The expected attendees: everyone whose duty type counts for the morning
     * roster (consultants on non-ward duties included; external rotations and
     * leave excluded), adjusted by admin include/exclude overrides. Never
     * materialized until recording.
     *
     * @return Collection<int, User>
     */
    public function roster(CarbonInterface $date): Collection
    {
        $base = $this->rosterService->morningRosterOn($date)->keyBy('id');

        $overrides = MorningRosterOverride::query()
            ->with('user')
            ->covering($date)
            ->orderBy('created_at')
            ->get();

        foreach ($overrides as $override) {
            if ($override->action === 'exclude') {
                $base->forget($override->user_id);
            } elseif ($override->user !== null && $override->user->active) {
                $base->put($override->user_id, $override->user);
            }
        }

        return $base->values()->sortBy('full_name')->values();
    }

    /**
     * Record the session: on-time toggle (an actual start time is REQUIRED
     * when off; the delay is computed server-side against the snapshotted
     * schedule, never trusted from the client), plus one present flag per
     * expected attendee. The roster is snapshotted into morning_attendance.
     *
     * @param  array<string, bool>  $presence  user id => present
     */
    public function record(MorningSession $session, bool $onTime, ?string $actualStart, array $presence, User $by): MorningSession
    {
        if (! $onTime && ($actualStart === null || trim($actualStart) === '')) {
            throw ValidationException::withMessages([
                'actualStartAt' => ['Enter the actual start time when the session did not start on time.'],
            ]);
        }

        return DB::transaction(function () use ($session, $onTime, $actualStart, $presence, $by): MorningSession {
            $locked = $this->lockSession($session->id);

            // Route-model authorization is only an early boundary. Repeat it
            // against the locked row so a stale caller cannot act after a
            // concurrent cancellation or a same-day policy state change.
            Gate::forUser($by)->authorize('record', $locked);

            if ($locked->status === 'cancelled') {
                throw ValidationException::withMessages([
                    'session' => ['A cancelled session cannot be recorded.'],
                ]);
            }

            if (! in_array($locked->status, ['pending', 'recorded'], true)) {
                throw ValidationException::withMessages([
                    'session' => ['This morning session cannot be recorded in its current state.'],
                ]);
            }

            // A correction of an already-recorded session updates the
            // SNAPSHOT (the existing attendance rows), never a roster
            // recomputed from current assignments.
            $isCorrection = $locked->status === 'recorded';
            $rosterIds = $isCorrection
                ? $locked->attendance()->pluck('user_id')->all()
                : $this->roster($locked->session_date)->pluck('id')->all();

            $locked->forceFill([
                'started_on_time' => $onTime,
                'actual_start_at' => $onTime ? null : substr(trim((string) $actualStart), 0, 5),
                'status' => 'recorded',
                'recorded_by' => $by->id,
                'recorded_at' => now(),
            ])->save();

            // Snapshot: one row per expected attendee. On first recording an
            // untouched attendee defaults to absent; on a correction an
            // omitted attendee keeps the flag already on their row.
            foreach ($rosterIds as $userId) {
                if ($isCorrection && ! array_key_exists($userId, $presence)) {
                    continue;
                }

                MorningAttendance::query()->updateOrCreate(
                    ['morning_session_id' => $locked->id, 'user_id' => $userId],
                    ['present' => (bool) ($presence[$userId] ?? false)],
                );
            }

            return $locked->refresh();
        });
    }

    /** @return array{session: MorningSession, transitioned: bool} */
    public function cancel(MorningSession $session, string $reason, User $by): array
    {
        if (trim($reason) === '') {
            throw ValidationException::withMessages([
                'reason' => ['A reason is required to cancel a morning session.'],
            ]);
        }

        return DB::transaction(function () use ($session, $reason, $by): array {
            $locked = $this->lockSession($session->id);

            // This preserves the policy distinction: an administrator can
            // cancel a recorded session and retry a cancellation, while a
            // designated recorder can cancel only today's pending session.
            Gate::forUser($by)->authorize('cancel', $locked);

            if ($locked->status === 'cancelled') {
                return ['session' => $locked, 'transitioned' => false];
            }

            if (! in_array($locked->status, ['pending', 'recorded'], true)) {
                throw ValidationException::withMessages([
                    'session' => ['This morning session cannot be cancelled in its current state.'],
                ]);
            }

            $previousStatus = $locked->status;

            // A recorded session that is cancelled afterwards (a public holiday
            // recorded by mistake, for example) must not keep its attendance:
            // the analytics count attendance rows across every session that
            // exists, so leftover rows would silently inflate the figures for
            // a day that officially never happened (QA-018). The removed count
            // is returned so the audit trail records what was discarded.
            $removedAttendance = $previousStatus === 'recorded'
                ? MorningAttendance::query()->where('morning_session_id', $locked->id)->delete()
                : 0;

            $locked->forceFill([
                'status' => 'cancelled',
                'reason' => trim($reason),
                'recorded_by' => $by->id,
                'recorded_at' => now(),
                'started_on_time' => null,
                'actual_start_at' => null,
            ])->save();

            return [
                'session' => $locked->refresh(),
                'transitioned' => true,
                'previousStatus' => $previousStatus,
                'removedAttendance' => $removedAttendance,
            ];
        });
    }

    private function lockSession(string $sessionId): MorningSession
    {
        return MorningSession::query()->lockForUpdate()->findOrFail($sessionId);
    }

    /** Notify recorders once a pending session is 15 minutes past its snapshotted start. */
    public function remindRecorders(CarbonInterface $date, ?CarbonInterface $at = null): int
    {
        $session = MorningSession::query()
            ->whereDate('session_date', $date->toDateString())
            ->where('status', 'pending')
            ->first();

        if ($session === null) {
            return 0;
        }

        $scheduledAt = $date->copy()
            ->setTimezone((string) config('app.business_timezone', 'Africa/Nairobi'))
            ->setTimeFromTimeString(substr((string) $session->scheduled_start_at, 0, 5));
        $reminderDueAt = $scheduledAt->copy()->addMinutes(15);

        if (($at ?? HospitalClock::now())->lessThan($reminderDueAt)) {
            return 0;
        }

        $recorderIds = $this->config()['morningRecorderIds'];

        $notified = 0;

        foreach ($recorderIds as $recorderId) {
            $notification = Notification::query()->firstOrCreate(
                [
                    'recipient_id' => $recorderId,
                    'type' => 'morning_session_reminder',
                    'related_id' => $session->id,
                ],
                [
                    'title' => 'Morning session not recorded yet',
                    'message' => sprintf(
                        "Today's %s morning session has not been recorded. It takes under a minute.",
                        substr((string) $session->scheduled_start_at, 0, 5),
                    ),
                    'related_route' => '/academic/morning',
                    'related_entity' => 'morning_session',
                    'created_at' => now(),
                ],
            );

            if ($notification->wasRecentlyCreated) {
                $notified++;
            }
        }

        return $notified;
    }
}
