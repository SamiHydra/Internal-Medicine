<?php

namespace App\Console\Commands;

use App\Services\Academic\MorningSessionService;
use Illuminate\Console\Command;

class RemindMorningRecorder extends Command
{
    protected $signature = 'academic:remind-morning-recorder';

    protected $description = 'Nudge the designated recorders when today\'s morning session is still pending.';

    public function handle(MorningSessionService $morningSessions): int
    {
        $notified = $morningSessions->remindRecorders(now());

        $this->info(sprintf('Morning-session reminders sent: %d.', $notified));

        return self::SUCCESS;
    }
}
