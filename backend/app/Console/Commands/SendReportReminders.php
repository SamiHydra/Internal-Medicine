<?php

namespace App\Console\Commands;

use App\Services\Reports\ReportReminderService;
use Illuminate\Console\Command;

class SendReportReminders extends Command
{
    protected $signature = 'reports:send-reminders';

    protected $description = 'Send scheduled report deadline reminders and escalations.';

    public function handle(ReportReminderService $reminders): int
    {
        $result = $reminders->sendDue();

        $this->info(sprintf(
            'Report reminders complete: deadline enforced=%s, %d candidates, %d reminders created, %d deliveries queued.',
            $result['deadlineEnforced'] ? 'yes' : 'no',
            $result['candidates'],
            $result['remindersCreated'],
            $result['deliveriesQueued'],
        ));

        return self::SUCCESS;
    }
}
