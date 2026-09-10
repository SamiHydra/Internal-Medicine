<?php

return [
    /*
    |--------------------------------------------------------------------------
    | Reporting period window
    |--------------------------------------------------------------------------
    |
    | Controls how much report history is loaded into a single workspace/report
    | payload. "default_count" is the number of recent periods loaded on a normal
    | dashboard bootstrap. "max_count" is a hard ceiling applied even when a user
    | asks for "all available data", so the unpaginated workspace payload can
    | never grow without bound as history accumulates (important on shared
    | hosting with a constrained PHP memory_limit).
    |
    */
    'window' => [
        'default_count' => (int) env('REPORT_WINDOW_DEFAULT_COUNT', 9),
        'max_count' => (int) env('REPORT_WINDOW_MAX_COUNT', 104),
        // The week this system went live. Weeks before it are never exposed,
        // because nothing was filed here then. Override locally (Y-m-d) when a
        // seeded fixture carries more history than go-live would reveal.
        'live_start' => env('REPORT_WINDOW_LIVE_START'),
    ],

    /*
    |--------------------------------------------------------------------------
    | Data-quality outlier detection
    |--------------------------------------------------------------------------
    |
    | A weekly field total is flagged as a (non-blocking) warning when it
    | deviates from the assignment's recent baseline by more than "factor"x.
    | Baselines are only used once at least "min_periods" prior reports exist,
    | sampling the last "lookback" reports. "min_baseline" suppresses noise from
    | tiny numbers (e.g. 0 -> 1 should not warn).
    |
    */
    'quality' => [
        'outlier' => [
            'factor' => (float) env('REPORT_OUTLIER_FACTOR', 3),
            'min_periods' => (int) env('REPORT_OUTLIER_MIN_PERIODS', 3),
            'lookback' => (int) env('REPORT_OUTLIER_LOOKBACK', 6),
            'min_baseline' => (float) env('REPORT_OUTLIER_MIN_BASELINE', 5),
        ],
    ],

    /*
    |--------------------------------------------------------------------------
    | Notification retention
    |--------------------------------------------------------------------------
    |
    | Read notifications older than this many days are pruned by the weekly
    | reports:prune-notifications command so the table does not grow without
    | bound. Unread notifications are never pruned.
    |
    */
    'notifications' => [
        'read_retention_days' => (int) env('NOTIFICATION_READ_RETENTION_DAYS', 90),
    ],

    /*
    | Clinical audit/history retention is disabled (0) until hospital policy
    | supplies an approved window. Expired sessions and cache rows are always
    | operational data and are pruned independently.
    */
    'retention' => [
        'audit_log_days' => (int) env('REPORT_AUDIT_RETENTION_DAYS', 0),
        'admin_audit_log_days' => (int) env('ADMIN_AUDIT_RETENTION_DAYS', 0),
        'status_history_days' => (int) env('REPORT_STATUS_HISTORY_RETENTION_DAYS', 0),
        // Generated analytics exports are regenerable on demand and are the
        // only unbounded generated data on disk (they are already excluded
        // from the nightly storage archive). A download 410s after seven days
        // (BuildAnalyticsExport sets expires_at), so the file and its row are
        // dead weight after that. 0 disables the cleanup.
        // See docs/DATA_RETENTION_POLICY_TEMPLATE.md.
        'export_days' => (int) env('EXPORT_RETENTION_DAYS', 30),
    ],

    /*
    |--------------------------------------------------------------------------
    | Analytics export ceiling
    |--------------------------------------------------------------------------
    |
    | The largest number of reports one export request may cover. Checked before
    | anything is queued, so an over-wide request is refused for free instead of
    | being abandoned part-built after it has already consumed the memory. This
    | is a backstop against a stale client or a bug, not a limit the ward/date
    | pickers should let anyone reach - raise it on a machine with headroom.
    |
    */
    'export' => [
        'max_reports' => (int) env('ANALYTICS_EXPORT_MAX_REPORTS', 5000),
    ],

    /*
    |--------------------------------------------------------------------------
    | Local fixture size
    |--------------------------------------------------------------------------
    |
    | How many trailing weeks of clinical reporting the LOCAL dev seeders build
    | (DevClinicalDataSeeder, and the matching backfill in ReportingPeriodSeeder).
    | The default is one year. Raise it to load-test a deeper archive without
    | editing a seeder:
    |
    |     SEED_HISTORY_WEEKS=156 php artisan migrate:fresh --seed
    |
    | Has no effect in production or testing, where the dev seeders never run.
    |
    */
    'dev_seed' => [
        'history_weeks' => max(1, (int) env('SEED_HISTORY_WEEKS', 52)),
    ],
];
