<?php

namespace App\Console\Commands;

use App\Services\Reports\OverdueReportService;
use Illuminate\Console\Command;

class SyncOverdueReports extends Command
{
    protected $signature = 'reports:sync-overdue';

    protected $description = 'Synchronize overdue report notifications.';

    public function handle(OverdueReportService $overdueReportService): int
    {
        $result = $overdueReportService->sync();

        $this->info(sprintf(
            'Overdue sync complete: %d items, %d created, %d updated, %d deleted.',
            $result['overdueItems'],
            $result['notificationsCreated'],
            $result['notificationsUpdated'],
            $result['notificationsDeleted'],
        ));

        return self::SUCCESS;
    }
}
