<?php

namespace App\Jobs;

use App\Services\Analytics\DashboardAnalyticsService;
use Illuminate\Contracts\Queue\ShouldBeUniqueUntilProcessing;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;

/**
 * Rebuilds recently viewed dashboard slices outside the web request.
 *
 * Uniqueness collapses bursts of writes into one pending warm. The lock is
 * released immediately before processing so a write that lands while a warm is
 * running can enqueue a follow-up for the newer cache version.
 */
class WarmDashboardAnalytics implements ShouldBeUniqueUntilProcessing, ShouldQueue
{
    use Queueable;

    public int $tries = 2;

    public int $timeout = 90;

    public int $uniqueFor = 120;

    public array $backoff = [15, 60];

    public function __construct()
    {
        $this->onQueue('analytics');
    }

    public function handle(DashboardAnalyticsService $analytics): void
    {
        $analytics->warm();
    }

    public function uniqueId(): string
    {
        return 'dashboard-analytics';
    }
}
