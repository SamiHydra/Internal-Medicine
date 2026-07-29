<?php

namespace App\Jobs;

use App\Services\Academic\AcademicAnalyticsService;
use Illuminate\Contracts\Queue\ShouldBeUniqueUntilProcessing;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;

/**
 * Rebuild recently viewed academic analytics snapshots after a write.
 *
 * Uniqueness collapses a burst of evaluation submissions into one pending
 * warm while allowing a newer write to enqueue a follow-up during processing.
 */
class WarmAcademicAnalytics implements ShouldBeUniqueUntilProcessing, ShouldQueue
{
    use Queueable;

    public int $tries = 2;

    public int $timeout = 90;

    public int $uniqueFor = 120;

    public array $backoff = [15, 60];

    public function handle(AcademicAnalyticsService $analytics): void
    {
        $analytics->warm();
    }

    public function uniqueId(): string
    {
        return 'academic-analytics';
    }
}
