<?php

return [
    // Host settings must live in config so they remain available after
    // `php artisan config:cache` disables .env lookups at runtime.
    'trusted_proxies' => env('TRUSTED_PROXIES'),
    'backup_dir' => env('BACKUP_DIR', '/var/backups/imreport'),
    'secondary_backup_dir' => env('SECONDARY_BACKUP_DIR', '/mnt/backup/imreport'),
    'queue_worker_service' => env('QUEUE_WORKER_SERVICE', 'imreport-queue.service'),
    'queue_worker_services' => array_values(array_filter(array_map(
        'trim',
        explode(',', (string) env(
            'QUEUE_WORKER_SERVICES',
            'imreport-queue.service,imreport-queue-notifications.service',
        )),
    ))),
    // The PHP-FPM pool file app:launch-readiness reads to verify the upload
    // limits (php_admin_value[upload_max_filesize] / [post_max_size]) that the
    // 10 MB evidence rule depends on. Matches the install target in deploy/README.md.
    'php_fpm_pool_file' => env('PHP_FPM_POOL_FILE', '/etc/php/8.3/fpm/pool.d/imreport.conf'),
    'queue_depth_warning' => (int) env('QUEUE_DEPTH_WARNING', 100),
    'queue_oldest_warning_seconds' => (int) env('QUEUE_OLDEST_WARNING_SECONDS', 300),
    'min_free_disk_gb' => (float) env('MIN_FREE_DISK_GB', 5),

    // Operational attestations that cannot be inferred from application data.
    // A restore drill expires so a one-time historical test cannot stay green.
    // Have-I-Been-Pwned range check on new passwords. It needs outbound HTTPS to
    // api.pwnedpasswords.com; on the department LAN without egress every
    // password change waited for the timeout and then passed (QA-014), so it is
    // opt-in and readiness reports which way it is set.
    'password_breach_check' => filter_var(env('PASSWORD_BREACH_CHECK', false), FILTER_VALIDATE_BOOLEAN),
    'password_breach_check_timeout_seconds' => (int) env('PASSWORD_BREACH_CHECK_TIMEOUT', 5),
    'backup_restore_verified_at' => env('BACKUP_RESTORE_VERIFIED_AT'),
    'backup_restore_max_age_days' => (int) env('BACKUP_RESTORE_MAX_AGE_DAYS', 90),
    'error_monitoring_channel' => env('ERROR_MONITORING_CHANNEL'),
    'performance_metric_retention_days' => (int) env('PERFORMANCE_METRIC_RETENTION_DAYS', 90),
];
