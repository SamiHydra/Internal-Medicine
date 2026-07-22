<?php

namespace App\Console\Commands;

use App\Services\Academic\MorningSessionService;
use App\Support\HospitalClock;
use Illuminate\Console\Command;

class OpenMorningSession extends Command
{
    protected $signature = 'academic:open-morning-session {--date= : Open for a specific date (defaults to today)}';

    protected $description = 'Open the pending morning session on configured session days.';

    public function handle(MorningSessionService $morningSessions): int
    {
        $date = $this->option('date')
            ? HospitalClock::parseDate((string) $this->option('date'))
            : HospitalClock::today();

        $session = $morningSessions->openFor($date);

        $this->info($session === null
            ? sprintf('%s is not a configured morning-session day.', $date->toDateString())
            : sprintf('Morning session open for %s (scheduled %s).', $date->toDateString(), substr((string) $session->scheduled_start_at, 0, 5)));

        return self::SUCCESS;
    }
}
