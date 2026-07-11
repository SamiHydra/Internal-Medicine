<?php

use Illuminate\Foundation\Inspiring;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Schedule;

Artisan::command('inspire', function () {
    $this->comment(Inspiring::quote());
})->purpose('Display an inspiring quote');

// A short overlap-lock expiry (10 min) means a hard-killed worker or cron (OOM,
// deploy SIGKILL) self-heals on the next tick instead of stranding the schedule
// mutex for the default 24h — which would silently halt delivery/digests.
Schedule::command('reports:sync-overdue')->hourly()->withoutOverlapping(10);
Schedule::command('academic:apply-section-transfers')->dailyAt('00:15')->withoutOverlapping(10);
Schedule::command('academic:generate-teaching-sessions')->dailyAt('00:10')->withoutOverlapping(10);
Schedule::command('academic:open-morning-session')->dailyAt('00:05')->withoutOverlapping(10);
Schedule::command('academic:remind-morning-recorder')->dailyAt('08:15')->withoutOverlapping(10);
Schedule::command('academic:remind-reps')->dailyAt('17:00')->withoutOverlapping(10);
Schedule::command('academic:check-placements')->weeklyOn(5, '10:00')->withoutOverlapping(10);
Schedule::command('reports:send-reminders')->hourly()->withoutOverlapping(10);
Schedule::command('reports:ensure-periods')->weeklyOn(0, '00:05')->withoutOverlapping(10);
Schedule::command('reports:send-digest')->weeklyOn(1, '07:00')->withoutOverlapping(10);

// Heartbeat read by app:launch-check: a silent cron failure surfaces as a
// stale key instead of jobs quietly never running.
Schedule::call(fn () => Cache::put('scheduler:heartbeat', now()->toIso8601String(), 3600))
    ->everyMinute()
    ->name('scheduler-heartbeat');

// The cron-tick worker serves shared hosting. On the department server the
// persistent systemd unit (deploy/queue-worker.service) replaces it: set
// QUEUE_WORKER_MODE=daemon there and this line becomes a no-op (V2 guide 11.1).
if (env('QUEUE_WORKER_MODE', 'cron') !== 'daemon') {
    Schedule::command('queue:work --stop-when-empty --max-time=50')->everyMinute()->withoutOverlapping(10);
}

// Re-attempt transiently-failed deliveries (e.g. a brief SMTP/SMS outage) so a
// dropped clinical reminder is not silently lost, then prune long-dead failures
// and old read notifications so neither table grows without bound.
Schedule::command('queue:retry all')->hourly()->withoutOverlapping(10);
Schedule::command('queue:prune-failed --hours=720')->daily();
Schedule::command('reports:prune-notifications')->weeklyOn(0, '01:00')->withoutOverlapping(10);
