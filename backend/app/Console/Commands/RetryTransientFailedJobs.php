<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

class RetryTransientFailedJobs extends Command
{
    protected $signature = 'queue:retry-transient';

    protected $description = 'Retry a bounded set of recent, allow-listed transient failures once.';

    public function handle(): int
    {
        if (config('queue.failed.driver') !== 'database-uuids') {
            $this->warn('Transient retry is only enabled for the database-uuids failed-job driver.');

            return self::SUCCESS;
        }

        $connection = config('queue.failed.database');
        $table = (string) config('queue.failed.table', 'failed_jobs');
        if (! Schema::connection($connection)->hasTable($table)) {
            return self::SUCCESS;
        }

        $limit = max(1, min(100, (int) config('queue.transient_retry.limit', 20)));
        $hours = max(1, (int) config('queue.transient_retry.max_age_hours', 24));
        $allowedJobs = (array) config('queue.transient_retry.allowed_jobs', []);
        $patterns = array_map('strtolower', (array) config('queue.transient_retry.exception_patterns', []));
        $retried = 0;

        $failedJobs = DB::connection($connection)
            ->table($table)
            ->where('failed_at', '>=', now()->subHours($hours))
            ->oldest('failed_at')
            ->limit($limit * 5)
            ->get();

        foreach ($failedJobs as $failedJob) {
            if ($retried >= $limit || ! $this->isTransient($failedJob, $allowedJobs, $patterns)) {
                continue;
            }

            // queue:retry resets attempts. The marker prevents a repeatedly
            // failing job UUID from being picked up by every scheduler run.
            $marker = 'queue:auto-retried:'.$failedJob->uuid;
            if (! Cache::add($marker, true, now()->addDays(7))) {
                continue;
            }

            $exitCode = Artisan::call('queue:retry', ['id' => [$failedJob->uuid]]);
            if ($exitCode !== self::SUCCESS) {
                Cache::forget($marker);

                continue;
            }

            $retried++;
        }

        $this->info("Retried {$retried} recent transient failed job(s).");

        return self::SUCCESS;
    }

    /**
     * @param  list<string>  $allowedJobs
     * @param  list<string>  $patterns
     */
    private function isTransient(object $failedJob, array $allowedJobs, array $patterns): bool
    {
        $payload = json_decode((string) $failedJob->payload, true);
        $displayName = (string) ($payload['displayName'] ?? '');
        if (! in_array($displayName, $allowedJobs, true)) {
            return false;
        }

        $exception = strtolower((string) $failedJob->exception);

        return collect($patterns)->contains(
            fn (string $pattern): bool => $pattern !== '' && str_contains($exception, $pattern),
        );
    }
}
