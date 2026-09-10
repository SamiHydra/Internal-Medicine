<?php

namespace App\Services\Operations;

use App\Support\Observability\ErrorReporter;
use App\Support\Observability\Release;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Throwable;

/**
 * The maintenance health snapshot (docs/OBSERVABILITY.md, "System health").
 *
 * Everything returned is safe to show an operator: states, ages, counts and
 * driver NAMES. No credential, no environment dump, no stack trace, no file
 * system path beyond the backup directory the runbook already names.
 */
class SystemHealthService
{
    private const QUEUES = ['analytics', 'notifications', 'default'];

    /**
     * @return array<string, mixed>
     */
    public function snapshot(): array
    {
        $checks = [];
        $now = Carbon::now();

        $database = $this->database($checks);
        $queue = $this->queue($checks);
        $scheduler = $this->scheduler($checks, $now);
        $backups = $this->backups($checks, $now);
        $storage = $this->storage($checks);
        $transports = $this->transports($checks);
        $application = $this->application($checks);
        $observability = $this->observability($checks);

        $failures = collect($checks)->where('status', 'fail')->count();
        $warnings = collect($checks)->where('status', 'warn')->count();

        return [
            'status' => $failures > 0 ? 'unhealthy' : ($warnings > 0 ? 'degraded' : 'healthy'),
            'checkedAt' => $now->toIso8601String(),
            'release' => Release::describe(),
            'application' => $application,
            'database' => $database,
            'queue' => $queue,
            'scheduler' => $scheduler,
            'backups' => $backups,
            'storage' => $storage,
            'transports' => $transports,
            'observability' => $observability,
            'checks' => $checks,
        ];
    }

    /**
     * @param  list<array{key: string, label: string, status: string, detail: string}>  $checks
     * @return array<string, mixed>
     */
    private function application(array &$checks): array
    {
        $environment = (string) app()->environment();
        $debug = (bool) config('app.debug');
        $opcache = extension_loaded('Zend OPcache');
        $configCached = app()->configurationIsCached();
        $routesCached = app()->routesAreCached();

        $this->check($checks, 'environment', 'Application environment', $environment === 'production' ? 'pass' : 'warn', $environment);
        $this->check($checks, 'debug', 'Debug mode disabled', $debug ? 'fail' : 'pass', $debug ? 'APP_DEBUG is on' : 'off');
        $this->check($checks, 'opcache', 'OPcache enabled', $opcache ? 'pass' : 'warn', $opcache ? 'enabled' : 'not loaded');
        $this->check($checks, 'config-cache', 'Configuration cache built', $configCached ? 'pass' : 'warn', $configCached ? 'cached' : 'not cached');
        $this->check($checks, 'route-cache', 'Route cache built', $routesCached ? 'pass' : 'warn', $routesCached ? 'cached' : 'not cached');

        return [
            'name' => (string) config('app.name'),
            'environment' => $environment,
            'debug' => $debug,
            'phpVersion' => PHP_VERSION,
            'frameworkVersion' => app()->version(),
            'opcache' => $opcache,
            'configCached' => $configCached,
            'routesCached' => $routesCached,
            'timezone' => (string) config('app.timezone'),
            'hospitalTimezone' => (string) config('app.business_timezone', 'Africa/Nairobi'),
        ];
    }

    /**
     * @param  list<array{key: string, label: string, status: string, detail: string}>  $checks
     * @return array<string, mixed>
     */
    private function database(array &$checks): array
    {
        $driver = (string) config('database.default');
        $connected = false;
        $latencyMs = null;
        $pendingMigrations = null;
        $error = null;

        try {
            $startedAt = microtime(true);
            DB::connection()->getPdo();
            DB::select('select 1');
            $latencyMs = (int) round((microtime(true) - $startedAt) * 1000);
            $connected = true;
        } catch (Throwable $exception) {
            $error = 'connection failed';
        }

        if ($connected) {
            try {
                $migrator = app('migrator');
                $files = $migrator->getMigrationFiles([database_path('migrations')]);
                $ran = $migrator->getRepository()->repositoryExists() ? $migrator->getRepository()->getRan() : [];
                $pendingMigrations = count(array_diff(array_keys($files), $ran));
            } catch (Throwable) {
                $pendingMigrations = null;
            }
        }

        $this->check($checks, 'database', 'Database connection', $connected ? 'pass' : 'fail', $connected ? sprintf('%s, %d ms', $driver, $latencyMs) : ($error ?? 'unreachable'));
        $this->check(
            $checks,
            'migrations',
            'Migrations applied',
            $pendingMigrations === null ? 'warn' : ($pendingMigrations === 0 ? 'pass' : 'fail'),
            $pendingMigrations === null ? 'unknown' : sprintf('%d pending', $pendingMigrations),
        );

        return [
            'driver' => $driver,
            'connected' => $connected,
            'latencyMs' => $latencyMs,
            'pendingMigrations' => $pendingMigrations,
        ];
    }

    /**
     * @param  list<array{key: string, label: string, status: string, detail: string}>  $checks
     * @return array<string, mixed>
     */
    private function queue(array &$checks): array
    {
        $connection = (string) config('queue.default');
        $driver = (string) config("queue.connections.{$connection}.driver");
        $depthWarning = (int) config('operations.queue_depth_warning', 100);
        $ageWarning = (int) config('operations.queue_oldest_warning_seconds', 300);
        $queues = [];
        $failed = ['total' => null, 'last24h' => null, 'latestFailedAt' => null];

        // The jobs table is read whenever it exists: production runs the database
        // driver, and a test or a misconfigured host still shows what is queued.
        $jobsTable = (string) config('queue.connections.database.table', 'jobs');
        if (Schema::hasTable($jobsTable)) {
            $rows = DB::table($jobsTable)
                ->whereIn('queue', self::QUEUES)
                ->selectRaw('queue, COUNT(*) as depth, MIN(created_at) as oldest_created_at')
                ->groupBy('queue')
                ->get()
                ->keyBy('queue');

            foreach (self::QUEUES as $name) {
                $row = $rows->get($name);
                $oldest = $row?->oldest_created_at;
                $queues[] = [
                    'name' => $name,
                    'depth' => (int) ($row?->depth ?? 0),
                    'oldestJobAgeSeconds' => $oldest === null ? null : max(0, Carbon::now()->timestamp - (int) $oldest),
                ];
            }
        }

        if (Schema::hasTable((string) config('queue.failed.table', 'failed_jobs'))) {
            $table = (string) config('queue.failed.table', 'failed_jobs');
            $failed['total'] = (int) DB::table($table)->count();
            $failed['last24h'] = (int) DB::table($table)->where('failed_at', '>=', Carbon::now()->subDay())->count();
            $latest = DB::table($table)->max('failed_at');
            $failed['latestFailedAt'] = $latest ? Carbon::parse($latest)->toIso8601String() : null;
        }

        $breaches = collect($queues)->filter(
            fn (array $queue): bool => $queue['depth'] > $depthWarning
                || ($queue['oldestJobAgeSeconds'] !== null && $queue['oldestJobAgeSeconds'] > $ageWarning),
        )->pluck('name')->all();

        $this->check($checks, 'queue-driver', 'Queue driver', $driver === 'database' ? 'pass' : 'warn', $driver);
        $this->check(
            $checks,
            'queue-backlog',
            'Queue backlog within thresholds',
            $breaches === [] ? 'pass' : 'warn',
            $breaches === [] ? sprintf('%d job(s) waiting', (int) collect($queues)->sum('depth')) : 'over threshold: '.implode(', ', $breaches),
        );
        $this->check(
            $checks,
            'failed-jobs',
            'Failed jobs (24h)',
            ($failed['last24h'] ?? 0) === 0 ? 'pass' : 'warn',
            sprintf('%s in the last 24h, %s total', $failed['last24h'] ?? 'unknown', $failed['total'] ?? 'unknown'),
        );

        return [
            'connection' => $connection,
            'driver' => $driver,
            'workerMode' => (string) config('queue.worker_mode'),
            'thresholds' => ['depth' => $depthWarning, 'oldestJobAgeSeconds' => $ageWarning],
            'queues' => $queues,
            'failedJobs' => $failed,
        ];
    }

    /**
     * @param  list<array{key: string, label: string, status: string, detail: string}>  $checks
     * @return array<string, mixed>
     */
    private function scheduler(array &$checks, Carbon $now): array
    {
        $heartbeat = Cache::get('scheduler:heartbeat');
        $lastTick = null;
        $ageSeconds = null;

        if (is_string($heartbeat)) {
            try {
                $lastTick = Carbon::parse($heartbeat);
                $ageSeconds = max(0, $now->timestamp - $lastTick->timestamp);
            } catch (Throwable) {
                $lastTick = null;
            }
        }

        $fresh = $ageSeconds !== null && $ageSeconds <= 300;
        $this->check(
            $checks,
            'scheduler',
            'Scheduler heartbeat',
            $fresh ? 'pass' : (app()->environment('production') ? 'fail' : 'warn'),
            $ageSeconds === null ? 'no tick recorded' : sprintf('%d s ago', $ageSeconds),
        );

        return [
            'lastTick' => $lastTick?->toIso8601String(),
            'ageSeconds' => $ageSeconds,
            'fresh' => $fresh,
        ];
    }

    /**
     * @param  list<array{key: string, label: string, status: string, detail: string}>  $checks
     * @return array<string, mixed>
     */
    private function backups(array &$checks, Carbon $now): array
    {
        $backupDir = (string) config('operations.backup_dir', '/var/backups/imreport');
        $secondaryDir = (string) config('operations.secondary_backup_dir', '/mnt/backup/imreport');

        $dump = $this->newest($backupDir, '/*.sql.gz');
        $archive = $this->newest($backupDir, '/*-storage-*.tar.gz');
        $secondary = $this->newest($secondaryDir, '/*.sql.gz');

        $describe = function (?int $timestamp) use ($now): array {
            if ($timestamp === null) {
                return ['at' => null, 'ageHours' => null];
            }

            return [
                'at' => Carbon::createFromTimestamp($timestamp)->toIso8601String(),
                'ageHours' => round(($now->timestamp - $timestamp) / 3600, 1),
            ];
        };

        $status = fn (?int $timestamp): string => $timestamp === null
            ? 'warn'
            : ((($now->timestamp - $timestamp) / 3600) <= 26 ? 'pass' : 'fail');

        $this->check($checks, 'backup-dump', 'Database backup fresher than 26h', $status($dump), $dump === null ? 'none found' : $describe($dump)['ageHours'].' h old');
        $this->check($checks, 'backup-storage', 'Storage backup fresher than 26h', $status($archive), $archive === null ? 'none found' : $describe($archive)['ageHours'].' h old');
        $this->check($checks, 'backup-secondary', 'Off-box backup fresher than 26h', $status($secondary), $secondary === null ? 'none found' : $describe($secondary)['ageHours'].' h old');

        $verifiedAt = config('operations.backup_restore_verified_at');
        $maxAgeDays = (int) config('operations.backup_restore_max_age_days', 90);
        $verified = null;

        try {
            $verified = filled($verifiedAt) ? Carbon::parse((string) $verifiedAt) : null;
        } catch (Throwable) {
            $verified = null;
        }

        $drillCurrent = $verified !== null && $verified->greaterThanOrEqualTo($now->copy()->subDays($maxAgeDays));
        $this->check($checks, 'restore-drill', 'Restore drill current', $drillCurrent ? 'pass' : 'warn', $verified?->toDateString() ?? 'never recorded');

        return [
            'directory' => $backupDir,
            'secondaryDirectory' => $secondaryDir,
            'latestDump' => $describe($dump),
            'latestStorageArchive' => $describe($archive),
            'latestSecondaryDump' => $describe($secondary),
            'restoreDrillVerifiedAt' => $verified?->toIso8601String(),
            'restoreDrillMaxAgeDays' => $maxAgeDays,
        ];
    }

    /**
     * @param  list<array{key: string, label: string, status: string, detail: string}>  $checks
     * @return array<string, mixed>
     */
    private function storage(array &$checks): array
    {
        $minFreeGb = (float) config('operations.min_free_disk_gb', 5);
        $freeBytes = @disk_free_space(base_path());
        $freeGb = $freeBytes === false ? null : round($freeBytes / 1024 ** 3, 1);
        $writable = is_writable(storage_path('app')) && is_writable(storage_path('logs'));

        $this->check($checks, 'disk', 'Free disk above threshold', $freeGb === null ? 'warn' : ($freeGb >= $minFreeGb ? 'pass' : 'fail'), $freeGb === null ? 'unknown' : sprintf('%.1f GB free (threshold %.0f GB)', $freeGb, $minFreeGb));
        $this->check($checks, 'storage-writable', 'Storage writable', $writable ? 'pass' : 'fail', $writable ? 'storage/app and storage/logs writable' : 'storage is not writable');

        return [
            'writable' => $writable,
            'freeDiskGb' => $freeGb,
            'minFreeDiskGb' => $minFreeGb,
            'uploadsDisk' => (string) config('filesystems.default'),
        ];
    }

    /**
     * @param  list<array{key: string, label: string, status: string, detail: string}>  $checks
     * @return array<string, mixed>
     */
    private function transports(array &$checks): array
    {
        $mail = (string) config('mail.default');
        $mailConfigured = ! in_array($mail, ['log', 'array', ''], true);
        $sms = (string) config('services.sms.driver');
        $smsConfigured = $sms === 'http'
            && filled(config('services.sms.http.endpoint'))
            && filled(config('services.sms.http.token'));

        $this->check($checks, 'mail', 'Mail transport', $mailConfigured ? 'pass' : 'warn', $mailConfigured ? $mail : 'not configured ('.($mail ?: 'none').')');
        $this->check($checks, 'sms', 'SMS transport', $smsConfigured ? 'pass' : 'warn', $smsConfigured ? $sms : 'not configured ('.($sms ?: 'none').')');

        return [
            'mail' => ['driver' => $mail, 'configured' => $mailConfigured],
            'sms' => ['driver' => $sms, 'configured' => $smsConfigured],
        ];
    }

    /**
     * @param  list<array{key: string, label: string, status: string, detail: string}>  $checks
     * @return array<string, mixed>
     */
    private function observability(array &$checks): array
    {
        $counters = ErrorReporter::counters();
        $channel = trim((string) config('operations.error_monitoring_channel'));
        $serverErrors = $counters[ErrorReporter::SIGNAL_SERVER_ERRORS]['lastHour'] + $counters[ErrorReporter::SIGNAL_EXCEPTIONS]['lastHour'];

        $this->check($checks, 'error-channel', 'Error monitoring channel named', $channel !== '' ? 'pass' : 'warn', $channel !== '' ? $channel : 'ERROR_MONITORING_CHANNEL not set');
        $this->check($checks, 'server-errors', 'Server errors in the last hour', $serverErrors === 0 ? 'pass' : 'warn', (string) $serverErrors);

        return [
            'webhookConfigured' => ErrorReporter::webhookConfigured(),
            'errorMonitoringChannel' => $channel !== '' ? $channel : null,
            'slowRequestThresholdMs' => (int) config('observability.slow_request_ms'),
            'clientErrorReporting' => (bool) config('observability.client_errors.enabled', true),
            'counters' => $counters,
        ];
    }

    private function newest(string $directory, string $pattern): ?int
    {
        if (! is_dir($directory)) {
            return null;
        }

        $newest = collect(glob($directory.$pattern) ?: [])
            ->map(fn (string $path) => filemtime($path))
            ->filter()
            ->max();

        return $newest === null ? null : (int) $newest;
    }

    /**
     * @param  list<array{key: string, label: string, status: string, detail: string}>  $checks
     */
    private function check(array &$checks, string $key, string $label, string $status, string $detail): void
    {
        $checks[] = ['key' => $key, 'label' => $label, 'status' => $status, 'detail' => $detail];
    }
}
