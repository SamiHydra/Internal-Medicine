<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

class LaunchReadinessCheck extends Command
{
    protected $signature = 'app:launch-check {--strict : Return a failing exit code when warnings are present.}';

    protected $description = 'Check production launch readiness settings and host prerequisites.';

    /**
     * @var array<int, array{status: string, check: string, detail: string}>
     */
    private array $results = [];

    public function handle(): int
    {
        $this->results = [];

        $this->checkProductionEnvironment();
        $this->checkDatabase();
        $this->checkQueue();
        $this->checkMailAndSms();
        $this->checkPerformance();
        $this->checkSameOriginCookieSettings();
        $this->checkBackupsAndErrors();
        $this->checkOnPremHost();

        $this->newLine();
        $this->table(['Status', 'Check', 'Detail'], $this->results);

        $failures = collect($this->results)->where('status', 'FAIL')->count();
        $warnings = collect($this->results)->where('status', 'WARN')->count();

        if ($failures > 0 || ($warnings > 0 && $this->option('strict'))) {
            $this->error(sprintf(
                'Launch readiness incomplete: %d failure(s), %d warning(s).',
                $failures,
                $warnings,
            ));

            return self::FAILURE;
        }

        $this->info(sprintf(
            'Launch readiness check complete: %d failure(s), %d warning(s).',
            $failures,
            $warnings,
        ));

        return self::SUCCESS;
    }

    private function checkProductionEnvironment(): void
    {
        $this->record(
            app()->environment('production'),
            'APP_ENV is production',
            sprintf('Current environment: %s.', app()->environment()),
            'Set APP_ENV=production in the production .env.',
        );

        $this->record(
            ! config('app.debug'),
            'APP_DEBUG is disabled',
            'Debug pages expose stack traces and environment details.',
            'Set APP_DEBUG=false before launch.',
        );

        $this->record(
            filled(config('app.key')),
            'APP_KEY is set',
            'Laravel encryption key is present.',
            'Run php artisan key:generate on the host.',
        );
    }

    private function checkDatabase(): void
    {
        $connection = config('database.default');

        $this->record(
            $connection === 'mariadb',
            'Database connection is MariaDB',
            sprintf('Current DB_CONNECTION: %s.', $connection),
            'Set DB_CONNECTION=mariadb for production concurrency.',
        );

        try {
            DB::connection()->getPdo();
            $this->pass('Database connection opens', 'Connected successfully.');
        } catch (\Throwable $error) {
            $this->recordFailure('Database connection opens', $error->getMessage());
        }

        $this->record(
            Schema::hasTable('migrations'),
            'Migrations table exists',
            'Database schema has been initialized.',
            'Run php artisan migrate --force.',
        );
    }

    private function checkQueue(): void
    {
        $queueConnection = config('queue.default');

        $this->record(
            $queueConnection === 'database',
            'Queue uses database driver',
            sprintf('Current QUEUE_CONNECTION: %s.', $queueConnection),
            'Set QUEUE_CONNECTION=database for shared-host cron workers.',
        );

        foreach (['jobs', 'failed_jobs'] as $table) {
            $this->record(
                Schema::hasTable($table),
                sprintf('%s table exists', $table),
                sprintf('Queue table %s is present.', $table),
                sprintf('Run the queue migration that creates %s.', $table),
            );
        }
    }

    private function checkMailAndSms(): void
    {
        $mailDriver = config('mail.default');
        $smsDriver = config('services.sms.driver');

        $this->record(
            ! in_array($mailDriver, ['log', 'array'], true),
            'Mail delivery is real',
            sprintf('Current MAIL_MAILER: %s.', $mailDriver),
            'Configure SMTP/Postmark/SES/Resend before launch.',
            warn: true,
        );

        $this->record(
            $smsDriver === 'http' && filled(config('services.sms.http.endpoint')) && filled(config('services.sms.http.token')),
            'SMS delivery is real',
            sprintf('Current SMS_DRIVER: %s.', $smsDriver),
            'Set SMS_DRIVER=http with SMS_HTTP_ENDPOINT and SMS_HTTP_TOKEN.',
            warn: true,
        );
    }

    private function checkPerformance(): void
    {
        $this->record(
            extension_loaded('Zend OPcache'),
            'OPcache extension is enabled',
            'OPcache is available to PHP.',
            'Enable OPcache in the host PHP settings.',
            warn: true,
        );

        $this->record(
            app()->configurationIsCached(),
            'Configuration cache is built',
            'config:cache has been run for this deployment.',
            'Run php artisan config:cache after changing .env values.',
            warn: true,
        );

        $this->record(
            app()->routesAreCached(),
            'Route cache is built',
            'route:cache has been run for this deployment.',
            'Run php artisan route:cache after deployment.',
            warn: true,
        );
    }

    private function checkSameOriginCookieSettings(): void
    {
        $statefulDomains = array_filter(config('sanctum.stateful', []));
        $allowedOrigins = array_filter(config('cors.allowed_origins', []));

        $this->record(
            (bool) config('session.secure'),
            'Session secure cookies enabled',
            'SESSION_SECURE_COOKIE is true.',
            'Set SESSION_SECURE_COOKIE=true behind HTTPS.',
        );

        $this->record(
            (bool) config('session.encrypt'),
            'Session encryption enabled',
            'SESSION_ENCRYPT is true.',
            'Set SESSION_ENCRYPT=true before launch.',
        );

        $this->record(
            ! empty($statefulDomains) && ! $this->containsOnlyLocalHosts($statefulDomains),
            'Sanctum production domain configured',
            'SANCTUM_STATEFUL_DOMAINS includes non-local domains.',
            'Set SANCTUM_STATEFUL_DOMAINS to the production host.',
        );

        $this->record(
            ! empty($allowedOrigins) && ! $this->containsOnlyLocalHosts($allowedOrigins),
            'CORS production origin configured',
            'CORS_ALLOWED_ORIGINS includes non-local origins.',
            'Set CORS_ALLOWED_ORIGINS to the production frontend origin.',
        );

        $this->record(
            filled(env('TRUSTED_PROXIES')),
            'Trusted proxies configured',
            'TRUSTED_PROXIES is set.',
            'Set TRUSTED_PROXIES="*" if TLS terminates at a host proxy.',
            warn: true,
        );
    }

    private function checkBackupsAndErrors(): void
    {
            $this->recordWarning(
                'Database backup restore verified',
                'Manual check: create daily mysqldump outside web root and test a restore.',
            );

        $this->recordWarning(
            'Production error visibility configured',
            'Manual check: configure Sentry or a scheduled storage/logs review.',
        );

        $this->recordWarning(
            'Host cron installed',
            'Manual check: * * * * * cd /path/to/backend && php artisan schedule:run >> storage/logs/schedule.log 2>&1',
        );
    }

    /**
     * The on-prem checks (V2 guide 11.3): backup freshness, the persistent
     * queue worker unit, the scheduler heartbeat, free disk, and the HTTPS
     * certificate window. Everything degrades to a WARN with a manual
     * instruction when the host signal is unavailable (e.g. a dev machine).
     */
    private function checkOnPremHost(): void
    {
        // Last backup fresher than 26 hours (a daily 02:00 dump plus slack).
        $backupDir = (string) env('BACKUP_DIR', '/var/backups/imreport');
        $newestBackup = collect(is_dir($backupDir) ? (glob($backupDir.'/*.sql.gz') ?: []) : [])
            ->map(fn (string $path) => filemtime($path))
            ->max();

        if ($newestBackup === null) {
            $this->recordWarning(
                'Database backup fresher than 26h',
                sprintf('No *.sql.gz found in %s. Install deploy/backup.sh on the 02:00 cron.', $backupDir),
            );
        } else {
            $ageHours = (now()->getTimestamp() - $newestBackup) / 3600;
            $this->record(
                $ageHours <= 26,
                'Database backup fresher than 26h',
                sprintf('Newest dump is %.1f hours old.', $ageHours),
                sprintf('Newest dump is %.1f hours old. Check the deploy/backup.sh cron and its log.', $ageHours),
            );
        }

        // The persistent queue worker unit (replaces the cron-tick worker).
        $unit = (string) env('QUEUE_WORKER_SERVICE', 'imreport-queue.service');

        if (config('queue.worker_mode') !== 'daemon') {
            $this->recordWarning(
                'Persistent queue worker active',
                'QUEUE_WORKER_MODE is not "daemon": the cron-tick worker is in use. On the department server set QUEUE_WORKER_MODE=daemon and install deploy/queue-worker.service.',
            );
        } elseif (PHP_OS_FAMILY !== 'Linux' || ! function_exists('shell_exec')) {
            $this->recordWarning(
                'Persistent queue worker active',
                sprintf('Manual check: systemctl is-active %s.', $unit),
            );
        } else {
            $state = trim((string) shell_exec(sprintf('systemctl is-active %s 2>/dev/null', escapeshellarg($unit))));
            $this->record(
                $state === 'active',
                'Persistent queue worker active',
                sprintf('%s is active.', $unit),
                sprintf('%s reports "%s". systemctl start %s and check journalctl -u %s.', $unit, $state === '' ? 'unknown' : $state, $unit, $unit),
            );
        }

        // The scheduler heartbeat: routes/console.php touches this cache key
        // every minute, so a silent cron failure surfaces here.
        $heartbeat = Cache::get('scheduler:heartbeat');
        $heartbeatFresh = is_string($heartbeat)
            && Carbon::parse($heartbeat)->greaterThan(now()->subMinutes(5));

        $this->record(
            $heartbeatFresh,
            'Scheduler heartbeat fresh',
            sprintf('Last tick %s.', $heartbeat),
            'No scheduler tick in the last 5 minutes. Check the system cron entry for php artisan schedule:run.',
            warn: ! app()->environment('production'),
        );

        // Free disk above threshold (dumps + logs need headroom).
        $minFreeGb = (float) env('MIN_FREE_DISK_GB', 5);
        $freeBytes = @disk_free_space(base_path());

        if ($freeBytes === false) {
            $this->recordWarning('Free disk above threshold', 'Could not read free disk space.');
        } else {
            $freeGb = $freeBytes / 1024 ** 3;
            $this->record(
                $freeGb >= $minFreeGb,
                'Free disk above threshold',
                sprintf('%.1f GB free (threshold %.0f GB).', $freeGb, $minFreeGb),
                sprintf('%.1f GB free is under the %.0f GB threshold. Prune old backups/logs or grow the disk.', $freeGb, $minFreeGb),
            );
        }

        // HTTPS reachable with more than 21 days on the certificate. The PWA
        // service worker requires HTTPS even on a LAN.
        $appUrl = (string) config('app.url');
        $host = parse_url($appUrl, PHP_URL_HOST);

        if (! str_starts_with($appUrl, 'https://') || $host === null) {
            $this->record(
                false,
                'APP_URL is the HTTPS internal hostname',
                '',
                sprintf('APP_URL is "%s". Set it to the https:// internal hostname (the PWA requires HTTPS on the LAN).', $appUrl),
                warn: ! app()->environment('production'),
            );
        } else {
            $this->pass('APP_URL is the HTTPS internal hostname', sprintf('APP_URL is %s.', $appUrl));
            $this->checkCertificate($host, (int) (parse_url($appUrl, PHP_URL_PORT) ?: 443));
        }
    }

    private function checkCertificate(string $host, int $port): void
    {
        try {
            $context = stream_context_create(['ssl' => ['capture_peer_cert' => true, 'SNI_enabled' => true]]);
            $socket = @stream_socket_client(
                sprintf('ssl://%s:%d', $host, $port),
                $errorCode,
                $errorMessage,
                5,
                STREAM_CLIENT_CONNECT,
                $context,
            );

            if ($socket === false) {
                $this->recordWarning(
                    'HTTPS certificate valid > 21 days',
                    sprintf('Could not reach https://%s:%d from here (%s). Verify from a hospital device.', $host, $port, $errorMessage ?: 'no route'),
                );

                return;
            }

            $params = stream_context_get_params($socket);
            fclose($socket);
            $certificate = openssl_x509_parse($params['options']['ssl']['peer_certificate']);
            $validTo = Carbon::createFromTimestamp($certificate['validTo_time_t']);
            $daysLeft = now()->diffInDays($validTo, false);

            $this->record(
                $daysLeft > 21,
                'HTTPS certificate valid > 21 days',
                sprintf('Certificate expires %s (%d days).', $validTo->toDateString(), (int) $daysLeft),
                sprintf('Certificate expires %s (%d days). Renew now: see docs/OPERATIONS.md.', $validTo->toDateString(), (int) $daysLeft),
            );
        } catch (\Throwable $error) {
            $this->recordWarning('HTTPS certificate valid > 21 days', $error->getMessage());
        }
    }

    private function containsOnlyLocalHosts(array $values): bool
    {
        return collect($values)->every(function (string $value): bool {
            return str_contains($value, 'localhost')
                || str_contains($value, '127.0.0.1')
                || str_contains($value, '::1');
        });
    }

    private function record(
        bool $passes,
        string $check,
        string $passDetail,
        string $failureDetail,
        bool $warn = false,
    ): void {
        if ($passes) {
            $this->pass($check, $passDetail);

            return;
        }

        if ($warn) {
            $this->recordWarning($check, $failureDetail);

            return;
        }

        $this->recordFailure($check, $failureDetail);
    }

    private function pass(string $check, string $detail): void
    {
        $this->results[] = ['status' => 'PASS', 'check' => $check, 'detail' => $detail];
    }

    private function recordWarning(string $check, string $detail): void
    {
        $this->results[] = ['status' => 'WARN', 'check' => $check, 'detail' => $detail];
    }

    private function recordFailure(string $check, string $detail): void
    {
        $this->results[] = ['status' => 'FAIL', 'check' => $check, 'detail' => $detail];
    }
}
