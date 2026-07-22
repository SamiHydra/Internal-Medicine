<?php

namespace App\Console\Commands;

use App\Services\Reports\ReportingPeriodService;
use Illuminate\Console\Command;

class EnsureReportingPeriods extends Command
{
    protected $signature = 'reports:ensure-periods {--past=26 : Weeks to keep before the current week} {--future=52 : Weeks to create after the current week}';

    protected $description = 'Ensure the rolling weekly reporting-period window exists.';

    public function handle(ReportingPeriodService $reportingPeriodService): int
    {
        $result = $reportingPeriodService->ensureRollingWindow(
            pastWeeks: (int) $this->option('past'),
            futureWeeks: (int) $this->option('future'),
        );

        $this->info(sprintf(
            'Reporting periods ensured from %s to %s: %d created, %d updated, %d total in window.',
            $result['from'],
            $result['to'],
            $result['created'],
            $result['updated'],
            $result['total'],
        ));

        return self::SUCCESS;
    }
}
