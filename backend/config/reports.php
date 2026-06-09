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
];
