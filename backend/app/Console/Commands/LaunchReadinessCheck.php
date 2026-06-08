<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
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
