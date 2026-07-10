<?php

use Illuminate\Foundation\Inspiring;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Schedule;

Artisan::command('inspire', function () {
    $this->comment(Inspiring::quote());
})->purpose('Display an inspiring quote');

// A short overlap-lock expiry (10 min) means a hard-killed worker or cron (OOM,
// deploy SIGKILL) self-heals on the next tick instead of stranding the schedule
// mutex for the default 24h — which would silently halt delivery/digests.
Schedule::command('reports:sync-overdue')->hourly()->withoutOverlapping(10);
Schedule::command('academic:apply-section-transfers')->dailyAt('00:15')->withoutOverlapping(10);
Schedule::command('reports:send-reminders')->hourly()->withoutOverlapping(10);
Schedule::command('reports:ensure-periods')->weeklyOn(0, '00:05')->withoutOverlapping(10);
Schedule::command('reports:send-digest')->weeklyOn(1, '07:00')->withoutOverlapping(10);
Schedule::command('queue:work --stop-when-empty --max-time=50')->everyMinute()->withoutOverlapping(10);

// Re-attempt transiently-failed deliveries (e.g. a brief SMTP/SMS outage) so a
// dropped clinical reminder is not silently lost, then prune long-dead failures
// and old read notifications so neither table grows without bound.
Schedule::command('queue:retry all')->hourly()->withoutOverlapping(10);
Schedule::command('queue:prune-failed --hours=720')->daily();
Schedule::command('reports:prune-notifications')->weeklyOn(0, '01:00')->withoutOverlapping(10);
