<?php

namespace App\Support;

use Illuminate\Support\Carbon;

/**
 * Calendar dates used by hospital workflows.
 *
 * Database timestamps stay in the application's UTC timezone. Date-only
 * clinical and academic decisions use the hospital's wall-clock timezone so
 * a job running just after midnight in Nairobi does not act on yesterday.
 */
final class HospitalClock
{
    public static function now(): Carbon
    {
        return Carbon::now((string) config('app.business_timezone', 'Africa/Nairobi'));
    }

    public static function today(): Carbon
    {
        return self::now()->startOfDay();
    }

    public static function parseDate(string $date): Carbon
    {
        return Carbon::parse($date, (string) config('app.business_timezone', 'Africa/Nairobi'))->startOfDay();
    }
}
