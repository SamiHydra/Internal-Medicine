<?php

namespace App\Console\Commands;

use App\Services\Academic\TransferService;
use Illuminate\Console\Command;

class ApplySectionTransfers extends Command
{
    protected $signature = 'academic:apply-section-transfers';

    protected $description = 'Apply approved section transfers whose effective date has arrived.';

    public function handle(TransferService $transferService): int
    {
        $applied = $transferService->applyDue();

        $this->info(sprintf('Section transfers applied: %d.', $applied));

        return self::SUCCESS;
    }
}
