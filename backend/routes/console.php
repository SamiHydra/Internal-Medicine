<?php

use Illuminate\Foundation\Inspiring;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Schedule;

Artisan::command('inspire', function () {
    $this->comment(Inspiring::quote());
})->purpose('Display an inspiring quote');

Schedule::command('reports:sync-overdue')->hourly()->withoutOverlapping();
Schedule::command('reports:send-reminders')->hourly()->withoutOverlapping();
Schedule::command('reports:ensure-periods')->weeklyOn(0, '00:05')->withoutOverlapping();
Schedule::command('reports:send-digest')->weeklyOn(1, '07:00')->withoutOverlapping();
Schedule::command('queue:work --stop-when-empty --max-time=50')->everyMinute()->withoutOverlapping();
