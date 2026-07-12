<?php

namespace App\Services\Academic;

use App\Models\MorningAttendance;
use App\Models\MorningRosterOverride;
use App\Models\MorningSession;
use App\Models\Notification;
use App\Models\User;
use App\Services\Admin\AppSettingsService;
use Carbon\CarbonInterface;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
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

        return $existing ?? MorningSession::query()->create([
            'session_date' => $date->toDateString(),
            'scheduled_start_at' => $this->config()['morningSessionTime'],
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
        if ($session->status === 'cancelled') {
            throw ValidationException::withMessages([
                'session' => ['A cancelled session cannot be recorded.'],
            ]);
        }

        if (! $onTime && ($actualStart === null || trim($actualStart) === '')) {
            throw ValidationException::withMessages([
                'actualStartAt' => ['Enter the actual start time when the session did not start on time.'],
            ]);
        }

        // A correction of an already-recorded session updates the SNAPSHOT
        // (the existing attendance rows), never the roster recomputed from
        // current data: assignments may have changed since, and a re-derived
        // roster would silently drop off-roster attendees' flags.
        $isCorrection = $session->status === 'recorded';
        $rosterIds = $isCorrection
            ? $session->attendance()->pluck('user_id')->all()
            : $this->roster($session->session_date)->pluck('id')->all();

        DB::transaction(function () use ($session, $onTime, $actualStart, $presence, $by, $rosterIds, $isCorrection): void {
            $session->forceFill([
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
                    ['morning_session_id' => $session->id, 'user_id' => $userId],
                    ['present' => (bool) ($presence[$userId] ?? false)],
                );
            }
        });

        return $session->refresh();
    }

    public function cancel(MorningSession $session, string $reason, User $by): MorningSession
    {
        if (trim($reason) === '') {
            throw ValidationException::withMessages([
                'reason' => ['A reason is required to cancel a morning session.'],
            ]);
        }

        $session->forceFill([
            'status' => 'cancelled',
            'reason' => $reason,
            'recorded_by' => $by->id,
            'recorded_at' => now(),
        ])->save();

        return $session;
    }

    /** The 08:15 nudge: a still-pending session notifies every designated recorder. */
    public function remindRecorders(CarbonInterface $date): int
    {
        $session = MorningSession::query()
            ->whereDate('session_date', $date->toDateString())
            ->where('status', 'pending')
            ->first();

        if ($session === null) {
            return 0;
        }

        $recorderIds = $this->config()['morningRecorderIds'];

        foreach ($recorderIds as $recorderId) {
            Notification::query()->create([
                'recipient_id' => $recorderId,
                'type' => 'morning_session_reminder',
                'title' => 'Morning session not recorded yet',
                'message' => sprintf(
                    "Today's %s morning session has not been recorded. It takes under a minute.",
                    substr((string) $session->scheduled_start_at, 0, 5),
                ),
                'related_route' => '/academic/morning',
                'related_entity' => 'morning_session',
                'related_id' => $session->id,
                'created_at' => now(),
            ]);
        }

        return count($recorderIds);
    }
}
