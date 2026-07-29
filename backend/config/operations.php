<?php

return [
    // Host settings must live in config so they remain available after
    // `php artisan config:cache` disables .env lookups at runtime.
    'trusted_proxies' => env('TRUSTED_PROXIES'),
    'backup_dir' => env('BACKUP_DIR', '/var/backups/imreport'),
    'secondary_backup_dir' => env('SECONDARY_BACKUP_DIR', '/mnt/backup/imreport'),
    'queue_worker_service' => env('QUEUE_WORKER_SERVICE', 'imreport-queue.service'),
    'min_free_disk_gb' => (float) env('MIN_FREE_DISK_GB', 5),

    // Operational attestations that cannot be inferred from application data.
    // A restore drill expires so a one-time historical test cannot stay green.
    'backup_restore_verified_at' => env('BACKUP_RESTORE_VERIFIED_AT'),
    'backup_restore_max_age_days' => (int) env('BACKUP_RESTORE_MAX_AGE_DAYS', 90),
    'error_monitoring_channel' => env('ERROR_MONITORING_CHANNEL'),
    'performance_metric_retention_days' => (int) env('PERFORMANCE_METRIC_RETENTION_DAYS', 90),
];
