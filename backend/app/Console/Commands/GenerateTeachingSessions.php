<?php

namespace App\Console\Commands;

use App\Services\Academic\TeachingService;
use Illuminate\Console\Command;

class GenerateTeachingSessions extends Command
{
    protected $signature = 'academic:generate-teaching-sessions {--date= : Generate for a specific date (defaults to today)}';

    protected $description = 'Generate the pending undergraduate teaching sessions for the scheduled activities of the day.';

    public function handle(TeachingService $teachingService): int
    {
        $date = $this->option('date') ? now()->parse($this->option('date')) : now();

        $generated = $teachingService->generateSessions($date);

        $this->info(sprintf('Teaching sessions generated for %s: %d.', $date->toDateString(), $generated));

        return self::SUCCESS;
    }
}
