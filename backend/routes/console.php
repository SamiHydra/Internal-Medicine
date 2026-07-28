<?php

use Illuminate\Foundation\Inspiring;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Schedule;

Artisan::command('inspire', function () {
    $this->comment(Inspiring::quote());
})->purpose('Display an inspiring quote');

$businessTimezone = (string) config('app.business_timezone', 'Africa/Nairobi');

// A short overlap-lock expiry (10 min) means a hard-killed worker or cron (OOM,
// deploy SIGKILL) self-heals on the next tick instead of stranding the schedule
// mutex for the default 24h - which would silently halt delivery/digests.
Schedule::command('reports:sync-overdue')->hourly()->timezone($businessTimezone)->withoutOverlapping(10);
Schedule::command('academic:apply-section-transfers')->dailyAt('00:15')->timezone($businessTimezone)->withoutOverlapping(10);
Schedule::command('academic:generate-teaching-sessions')->dailyAt('00:10')->timezone($businessTimezone)->withoutOverlapping(10);
Schedule::command('academic:open-morning-session')->dailyAt('00:05')->timezone($businessTimezone)->withoutOverlapping(10);
// The session start is admin-configurable. Run a cheap due-check each minute;
// the service waits until 15 minutes after that session's snapshotted start and
// de-duplicates notifications, so schedule registration never needs a DB read.
Schedule::command('academic:remind-morning-recorder')->everyMinute()->timezone($businessTimezone)->withoutOverlapping(10);
Schedule::command('academic:remind-reps')->dailyAt('17:00')->timezone($businessTimezone)->withoutOverlapping(10);
Schedule::command('academic:check-placements')->weeklyOn(5, '10:00')->timezone($businessTimezone)->withoutOverlapping(10);
Schedule::command('reports:send-reminders')->hourly()->timezone($businessTimezone)->withoutOverlapping(10);
Schedule::command('reports:ensure-periods')->weeklyOn(0, '00:05')->timezone($businessTimezone)->withoutOverlapping(10);
Schedule::command('reports:send-digest')->weeklyOn(1, '07:00')->timezone($businessTimezone)->withoutOverlapping(10);

// Heartbeat read by app:launch-check: a silent cron failure surfaces as a
// stale key instead of jobs quietly never running.
Schedule::call(fn () => Cache::put('scheduler:heartbeat', now()->toIso8601String(), 3600))
    ->everyMinute()
    ->timezone($businessTimezone)
    ->name('scheduler-heartbeat');

// The cron-tick worker serves shared hosting. On the department server the
// persistent systemd unit (deploy/queue-worker.service) replaces it: set
// QUEUE_WORKER_MODE=daemon there and this line becomes a no-op (V2 guide 11.1).
// Read through config(), NOT env(): env() returns null once config:cache runs.
if (config('queue.worker_mode') !== 'daemon') {
    Schedule::command('queue:work --stop-when-empty --max-time=50')->everyMinute()->timezone($businessTimezone)->withoutOverlapping(10);
}

// Retry only recent, allow-listed transient deliveries, at most once per job
// UUID. Never replay every failed business/validation job indiscriminately.
Schedule::command('queue:retry-transient')->everyThirtyMinutes()->timezone($businessTimezone)->withoutOverlapping(10);
Schedule::command('queue:prune-failed --hours=720')->daily()->timezone($businessTimezone);
Schedule::command('queue:prune-batches --hours=168 --unfinished=168 --cancelled=168')->daily()->timezone($businessTimezone);
Schedule::command('reports:prune-notifications')->weeklyOn(0, '01:00')->timezone($businessTimezone)->withoutOverlapping(10);
Schedule::command('app:prune-operational-data')->dailyAt('01:20')->timezone($businessTimezone)->withoutOverlapping(10);
