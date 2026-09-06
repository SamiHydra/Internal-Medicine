<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Queue;

class MonitorQueueHealth extends Command
{
    protected $signature = 'queue:monitor-health {--json : Emit machine-readable queue metrics}';

    protected $description = 'Report named queue depth and oldest-job age, alerting when thresholds are exceeded.';

    /** @var list<string> */
    private const QUEUES = ['analytics', 'notifications', 'default'];

    public function handle(): int
    {
        $connection = (string) config('queue.default');
        $driver = (string) config("queue.connections.{$connection}.driver");
        $depthThreshold = (int) config('operations.queue_depth_warning', 100);
        $ageThreshold = (int) config('operations.queue_oldest_warning_seconds', 300);
        $metrics = $driver === 'database'
            ? $this->databaseMetrics($connection)
            : $this->genericMetrics($connection);

        $breaches = collect($metrics)->filter(
            fn (array $metric): bool => $metric['depth'] > $depthThreshold
                || ($metric['oldestJobAgeSeconds'] !== null
                    && $metric['oldestJobAgeSeconds'] > $ageThreshold),
        )->values()->all();
        $context = [
            'connection' => $connection,
            'driver' => $driver,
            'depthWarning' => $depthThreshold,
            'oldestJobAgeWarningSeconds' => $ageThreshold,
            'queues' => $metrics,
            'breaches' => $breaches,
        ];

        if ($breaches !== []) {
            Log::warning('Queue health threshold exceeded', $context);
        } else {
            Log::info('Queue health check passed', $context);
        }

        if ($this->option('json')) {
            $this->line((string) json_encode($context, JSON_UNESCAPED_SLASHES));
        } else {
            $this->table(
                ['Queue', 'Depth', 'Oldest job age (seconds)'],
                collect($metrics)->map(fn (array $metric): array => [
                    $metric['queue'],
                    $metric['depth'],
                    $metric['oldestJobAgeSeconds'] ?? 'unavailable',
                ])->all(),
            );
        }

        return $breaches === [] ? self::SUCCESS : self::FAILURE;
    }

    /**
     * @return list<array{queue: string, depth: int, oldestJobAgeSeconds: int|null}>
     */
    private function databaseMetrics(string $connection): array
    {
        $databaseConnection = config("queue.connections.{$connection}.connection");
        $table = (string) config("queue.connections.{$connection}.table", 'jobs');
        $rows = DB::connection($databaseConnection ?: null)
            ->table($table)
            ->whereIn('queue', self::QUEUES)
            ->selectRaw('queue, COUNT(*) as depth, MIN(created_at) as oldest_created_at')
            ->groupBy('queue')
            ->get()
            ->keyBy('queue');

        return collect(self::QUEUES)->map(function (string $queue) use ($rows): array {
            $row = $rows->get($queue);
            $oldestCreatedAt = $row?->oldest_created_at;

            return [
                'queue' => $queue,
                'depth' => (int) ($row?->depth ?? 0),
                'oldestJobAgeSeconds' => $oldestCreatedAt === null
                    ? null
                    : max(0, now()->timestamp - (int) $oldestCreatedAt),
            ];
        })->all();
    }

    /**
     * Queue backends expose depth portably, but not enqueue timestamps. Depth
     * still alerts; database-backed production additionally reports exact age.
     *
     * @return list<array{queue: string, depth: int, oldestJobAgeSeconds: null}>
     */
    private function genericMetrics(string $connection): array
    {
        return collect(self::QUEUES)->map(fn (string $queue): array => [
            'queue' => $queue,
            'depth' => Queue::connection($connection)->size($queue),
            'oldestJobAgeSeconds' => null,
        ])->all();
    }
}
