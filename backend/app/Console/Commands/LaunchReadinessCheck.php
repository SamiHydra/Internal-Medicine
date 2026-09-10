<?php

namespace App\Console\Commands;

use App\Support\Uploads;
use Illuminate\Console\Command;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

class LaunchReadinessCheck extends Command
{
    protected $signature = 'app:launch-readiness {--strict : Return a failing exit code when warnings are present.}';

    /** @var list<string> */
    protected $aliases = ['app:launch-check'];

    protected $description = 'Check production launch readiness settings and host prerequisites.';

    /**
     * @var array<int, array{status: string, check: string, detail: string}>
     */
    protected array $results = [];

    public function handle(): int
    {
        $this->results = [];

        $this->runChecks();

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

    /**
     * Kept as one overridable seam so command-level tests can prove strict
     * exit semantics without impersonating Linux/systemd/TLS on every CI OS.
     */
    protected function runChecks(): void
    {
        $this->checkProductionEnvironment();
        $this->checkDatabase();
        $this->checkReferenceData();
        $this->checkUploadLimits();
        $this->checkQueue();
        $this->checkMailAndSms();
        $this->checkPerformance();
        $this->checkSameOriginCookieSettings();
        $this->checkOperationalAttestations();
        $this->checkOnPremHost();
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

    /**
     * A migrated database is not a usable one: roles, templates, departments,
     * field definitions and settings come from the reference seeders, and the
     * maintenance account cannot even be created before the roles exist
     * (users.role_key is a foreign key). deploy.sh runs the seeding command on
     * every deploy; it is idempotent, so this only fails on a broken install.
     */
    private function checkReferenceData(): void
    {
        $counts = [];
        foreach (['roles', 'report_templates', 'departments', 'report_field_definitions', 'app_settings'] as $table) {
            try {
                $counts[$table] = Schema::hasTable($table) ? (int) DB::table($table)->count() : 0;
            } catch (\Throwable) {
                $counts[$table] = 0;
            }
        }

        $this->record(
            $counts['roles'] >= 5
                && $counts['report_templates'] > 0
                && $counts['departments'] > 0
                && $counts['report_field_definitions'] > 0
                && $counts['app_settings'] > 0,
            'Reference data seeded',
            sprintf(
                '%d roles, %d templates, %d departments, %d field definitions, %d settings.',
                $counts['roles'],
                $counts['report_templates'],
                $counts['departments'],
                $counts['report_field_definitions'],
                $counts['app_settings'],
            ),
            'Run php artisan app:seed-reference-data (safe in production; skips when data exists).',
        );
    }

    /**
     * PHP's own upload limits must cover the 10 MB the application promises
     * (QA-005). The CLI that runs this command does not share the FPM pool's
     * php_admin_value overrides, so the pool file is read directly when it
     * exists; otherwise the running SAPI's values are reported with a manual
     * instruction.
     */
    private function checkUploadLimits(): void
    {
        $poolFile = (string) config('operations.php_fpm_pool_file');
        $limits = $this->poolUploadLimits($poolFile);
        $source = 'PHP-FPM pool '.$poolFile;

        if ($limits === null) {
            $limits = [
                'upload_max_filesize' => (string) ini_get('upload_max_filesize'),
                'post_max_size' => (string) ini_get('post_max_size'),
            ];
            $source = PHP_SAPI === 'cli' ? 'the CLI php.ini (pool file not found)' : 'the running PHP SAPI';
        }

        $uploadBytes = Uploads::iniSizeToBytes($limits['upload_max_filesize']);
        $postBytes = Uploads::iniSizeToBytes($limits['post_max_size']);
        $sufficient = $uploadBytes >= Uploads::REQUIRED_UPLOAD_MAX_FILESIZE_BYTES
            && $postBytes >= Uploads::REQUIRED_POST_MAX_SIZE_BYTES;

        $detail = sprintf(
            'upload_max_filesize=%s, post_max_size=%s (from %s).',
            $limits['upload_max_filesize'] === '' ? 'unset' : $limits['upload_max_filesize'],
            $limits['post_max_size'] === '' ? 'unset' : $limits['post_max_size'],
            $source,
        );

        $this->record(
            $sufficient,
            sprintf('PHP upload limits cover the %s file rule', Uploads::maxFileLabel()),
            $detail,
            $detail.sprintf(
                ' Set php_admin_value[upload_max_filesize] >= %dM and php_admin_value[post_max_size] >= %dM in the FPM pool (deploy/php-fpm.conf), then reload PHP-FPM.',
                intdiv(Uploads::REQUIRED_UPLOAD_MAX_FILESIZE_BYTES, 1024 ** 2),
                intdiv(Uploads::REQUIRED_POST_MAX_SIZE_BYTES, 1024 ** 2),
            ),
            // Without the pool file the CLI values are only indicative; do not
            // hard-fail a host whose pool lives elsewhere, but strict mode (used
            // by deploy.sh) still refuses to proceed on the warning.
            warn: $this->poolUploadLimits($poolFile) === null,
        );
    }

    /**
     * @return array{upload_max_filesize: string, post_max_size: string}|null
     */
    private function poolUploadLimits(string $poolFile): ?array
    {
        if ($poolFile === '' || ! is_readable($poolFile)) {
            return null;
        }

        $contents = (string) file_get_contents($poolFile);
        $limits = ['upload_max_filesize' => '', 'post_max_size' => ''];

        if (preg_match_all('/^\s*php_(?:admin_)?value\[(upload_max_filesize|post_max_size)\]\s*=\s*([^\s;]+)/m', $contents, $matches, PREG_SET_ORDER)) {
            foreach ($matches as $match) {
                $limits[$match[1]] = $match[2];
            }
        }

        return $limits;
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
            filled(config('operations.trusted_proxies')),
            'Trusted proxies configured',
            'TRUSTED_PROXIES is set.',
            'Set TRUSTED_PROXIES="*" if TLS terminates at a host proxy.',
            warn: true,
        );
    }

    private function checkOperationalAttestations(): void
    {
        $verifiedAt = config('operations.backup_restore_verified_at');
        $maxAgeDays = (int) config('operations.backup_restore_max_age_days', 90);

        try {
            $verifiedAtDate = filled($verifiedAt) ? Carbon::parse((string) $verifiedAt) : null;
        } catch (\Throwable) {
            $verifiedAtDate = null;
        }

        $this->record(
            $verifiedAtDate !== null && $verifiedAtDate->greaterThanOrEqualTo(now()->subDays($maxAgeDays)),
            'Database restore drill is current',
            sprintf('Last verified restore: %s.', $verifiedAtDate?->toIso8601String()),
            sprintf('Set BACKUP_RESTORE_VERIFIED_AT after a successful restore drill within the last %d days.', $maxAgeDays),
            warn: true,
        );

        $monitoringChannel = trim((string) config('operations.error_monitoring_channel'));
        $this->record(
            $monitoringChannel !== '',
            'Production error visibility configured',
            sprintf('Operational channel: %s.', $monitoringChannel),
            'Set ERROR_MONITORING_CHANNEL to the configured alerting or scheduled log-review channel.',
            warn: true,
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
        $backupDir = (string) config('operations.backup_dir', '/var/backups/imreport');
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

        // Uploaded files (evidence, import files) are backed up as a tar.gz next
        // to the dump by the same script (QA-015); a fresh dump with a stale
        // archive means backup.sh is an old version or the archive step failed.
        $newestArchive = collect(is_dir($backupDir) ? (glob($backupDir.'/*-storage-*.tar.gz') ?: []) : [])
            ->map(fn (string $path) => filemtime($path))
            ->max();

        if ($newestArchive === null) {
            $this->recordWarning(
                'Storage backup fresher than 26h',
                sprintf('No *-storage-*.tar.gz found in %s. Run the current deploy/backup.sh once; it archives shared/storage/app next to the dump.', $backupDir),
            );
        } else {
            $ageHours = (now()->getTimestamp() - $newestArchive) / 3600;
            $this->record(
                $ageHours <= 26,
                'Storage backup fresher than 26h',
                sprintf('Newest storage archive is %.1f hours old.', $ageHours),
                sprintf('Newest storage archive is %.1f hours old. Check the deploy/backup.sh cron and its log.', $ageHours),
            );
        }

        $secondaryDir = (string) config('operations.secondary_backup_dir', '/mnt/backup/imreport');
        $newestSecondary = collect(is_dir($secondaryDir) ? (glob($secondaryDir.'/*.sql.gz') ?: []) : [])
            ->map(fn (string $path) => filemtime($path))
            ->max();

        if ($newestSecondary === null) {
            $this->recordWarning(
                'Secondary backup fresher than 26h',
                sprintf('No off-box *.sql.gz found in %s. Mount the secondary disk/NAS and run deploy/backup.sh.', $secondaryDir),
            );
        } else {
            $ageHours = (now()->getTimestamp() - $newestSecondary) / 3600;
            $this->record(
                $ageHours <= 26,
                'Secondary backup fresher than 26h',
                sprintf('Newest off-box dump is %.1f hours old.', $ageHours),
                sprintf('Newest off-box dump is %.1f hours old. Check the mount and deploy/backup.sh cron.', $ageHours),
            );
        }

        // The persistent named-queue workers replace the cron-tick worker.
        $units = (array) config('operations.queue_worker_services', [
            'imreport-queue.service',
            'imreport-queue-notifications.service',
        ]);

        if (config('queue.worker_mode') !== 'daemon') {
            $this->recordWarning(
                'Persistent queue workers active',
                'QUEUE_WORKER_MODE is not "daemon": the cron-tick worker is in use. On the department server set QUEUE_WORKER_MODE=daemon and install both deploy queue-worker units.',
            );
        } elseif (PHP_OS_FAMILY !== 'Linux' || ! function_exists('shell_exec')) {
            $this->recordWarning(
                'Persistent queue workers active',
                sprintf('Manual check: systemctl is-active %s.', implode(' ', $units)),
            );
        } else {
            foreach ($units as $unit) {
                $unit = (string) $unit;
                $state = trim((string) shell_exec(sprintf('systemctl is-active %s 2>/dev/null', escapeshellarg($unit))));
                $this->record(
                    $state === 'active',
                    "Persistent queue worker active: {$unit}",
                    sprintf('%s is active.', $unit),
                    sprintf('%s reports "%s". systemctl start %s and check journalctl -u %s.', $unit, $state === '' ? 'unknown' : $state, $unit, $unit),
                );
            }
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
        $minFreeGb = (float) config('operations.min_free_disk_gb', 5);
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

    protected function pass(string $check, string $detail): void
    {
        $this->results[] = ['status' => 'PASS', 'check' => $check, 'detail' => $detail];
    }

    protected function recordWarning(string $check, string $detail): void
    {
        $this->results[] = ['status' => 'WARN', 'check' => $check, 'detail' => $detail];
    }

    private function recordFailure(string $check, string $detail): void
    {
        $this->results[] = ['status' => 'FAIL', 'check' => $check, 'detail' => $detail];
    }
}
