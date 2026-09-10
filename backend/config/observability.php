<?php

return [
    /*
    |--------------------------------------------------------------------------
    | Error and signal forwarding (docs/OBSERVABILITY.md)
    |--------------------------------------------------------------------------
    |
    | Everything here is optional. With no webhook the application still logs
    | every signal to the Laravel log and counts it for the maintenance health
    | view; a webhook (Sentry-style ingest, an n8n/Teams/Slack bridge, or the
    | hospital's own collector) receives the same sanitised JSON documents.
    | No vendor SDK is bundled and no credential is hard-coded.
    |
    */

    'webhook_url' => env('OBSERVABILITY_WEBHOOK_URL'),

    // Sent as a bearer token when set; the hospital's collector decides.
    'webhook_token' => env('OBSERVABILITY_WEBHOOK_TOKEN'),

    // Forwarding is synchronous and best-effort; keep it short so a dead
    // collector cannot slow the request that failed.
    'webhook_timeout_seconds' => max(1, (int) env('OBSERVABILITY_WEBHOOK_TIMEOUT', 2)),

    // Requests slower than this are logged (path, method, status, duration:
    // never a body) and counted. 0 disables slow-request logging.
    'slow_request_ms' => (int) env('SLOW_REQUEST_MS', 1000),

    'client_errors' => [
        // POST /api/client-errors from the SPA (uncaught exceptions, rejected
        // promises, route render failures, 5xx answers, offline-sync failures).
        'enabled' => filter_var(env('CLIENT_ERROR_REPORTING', true), FILTER_VALIDATE_BOOLEAN),
        // Per-IP ceiling; the endpoint is public so the login page can report.
        'per_minute' => max(1, (int) env('CLIENT_ERROR_RATE_LIMIT', 20)),
    ],

    'release' => [
        // Preferred: injected by the deploy (deploy.sh writes release.json
        // next to backend/; the Docker image bakes it). Env values win when set.
        'sha' => env('APP_RELEASE_SHA'),
        'built_at' => env('APP_RELEASE_BUILT_AT'),
        'file' => env('APP_RELEASE_FILE', base_path('../release.json')),
    ],
];
