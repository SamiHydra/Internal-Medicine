<?php

namespace App\Console\Commands;

use App\Services\Academic\EvaluationMigrationService;
use Illuminate\Console\Command;

class VerifyAcademicMigration extends Command
{
    protected $signature = 'academic:verify-migration
        {--sample=50 : Random source rows to deep-compare per table}
        {--allow-empty-legacy : Allow verification without a legacy comparison set}';

    protected $description = 'Verify the legacy evaluation tables were copied faithfully into the unified evaluations tables.';

    public function handle(EvaluationMigrationService $migrationService): int
    {
        $result = $migrationService->verify(
            (int) $this->option('sample'),
            (bool) $this->option('allow-empty-legacy'),
        );

        foreach ($result['details'] as $line) {
            $this->line($line);
        }

        if ($result['passed']) {
            $this->info('PASS');

            return self::SUCCESS;
        }

        $this->error('FAIL');

        return self::FAILURE;
    }
}
