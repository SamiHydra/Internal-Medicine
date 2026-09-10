# Observability

What the platform records about its own health, where each signal goes, what
should alert, and what must never leave the server. Prepared before the
hospital server exists: every integration below is optional and configured by
environment variables, nothing is hard-coded, and the application works with
none of it configured.

Status date: 2026-09-07. Code: `backend/app/Support/Observability/*`,
`backend/app/Http/Middleware/RecordRequestTiming.php`,
`backend/app/Http/Controllers/Api/ClientErrorController.php`,
`backend/app/Services/Operations/SystemHealthService.php`,
`src/lib/observability/error-reporter.ts`,
`src/components/layout/route-error-boundary.tsx`. Tests:
`backend/tests/Feature/ObservabilityTest.php`,
`src/lib/observability/error-reporter.test.ts`,
`src/components/layout/route-error-boundary.test.tsx`.

## 1. Signals

| Signal | Source | Log line | Counter (health view) | Webhook document `kind` |
|---|---|---|---|---|
| Unhandled backend exception | exception handler (`bootstrap/app.php`) | Laravel's own `ERROR` line, as before | `exceptions` | `exception` |
| HTTP 5xx answer (with or without an exception) | `RecordRequestTiming` middleware | none (the exception line covers it) | `serverErrors` | none |
| Slow request (`>= SLOW_REQUEST_MS`, default 1000) | `RecordRequestTiming` | `WARNING Slow request {method, path, route, durationMs, status, userId}` | `slowRequests` | `slow_request` |
| Failed queue job (export, delivery, analytics warm-up) | `Queue::failing` listener | `WARNING Queue job failed {job, queue, connection, exception, message}` | `failedJobs` | `failed_job` |
| Queue depth / oldest job age | `queue:monitor-health --json` every minute (scheduler) | `WARNING Queue health threshold exceeded` or `INFO Queue health check passed` | read live from the `jobs` table | none |
| Scheduler heartbeat | `scheduler-heartbeat` task every minute | none | cache key `scheduler:heartbeat`, age shown | none |
| Database connectivity | health snapshot, readiness command | none | `database.connected`, `latencyMs`, `pendingMigrations` | none |
| Backup age (dump, storage archive, off-box copy) | health snapshot, readiness command | none | ages in hours | none |
| Disk free, storage writable | health snapshot, readiness command | none | `storage.freeDiskGb`, `storage.writable` | none |
| Export failures | `BuildAnalyticsExport` marks the export `failed`; the job failure above fires too | `WARNING Queue job failed` | `failedJobs` | `failed_job` |
| Browser: uncaught exception, unhandled rejection | `window.error` / `unhandledrejection` hooks (`installGlobalErrorReporting`) | `WARNING Client error {kind, message, stack, route, status, clientRelease, userAgent, fingerprint, userId}` | `clientErrors` | `client_error`, `client_unhandledrejection` |
| Browser: route render failure | `RouteErrorBoundary` (shows a recovery panel instead of a blank page) | same | `clientErrors` | `client_render` |
| Browser: API answered 5xx | API client observer | same | `clientErrors` | `client_api` |
| Browser: offline save gave up | replay loop after `MAX_QUEUED_SAVE_ATTEMPTS` | same | `clientErrors` | `client_offline-sync` |

Every log line also carries `release` (the short commit SHA) through
`Log::shareContext`, so an operator reading `laravel.log` can tell which deploy
produced it. Every HTTP response carries `Server-Timing: app;dur=<ms>` so the
browser and the load harness can separate server time from network time.

Counters are hourly buckets in the application cache (`observability:<signal>:<UTC hour>`,
kept three hours). They are for the health view ("errors in the last hour"), not
for long-term metrics; the log and the webhook receiver keep the history.

## 2. Where the signals go

1. **The Laravel log** (`/opt/imreport/shared/storage/logs/laravel.log`,
   rotated by `deploy/logrotate.conf`). Always on. This is the record of truth.
2. **The maintenance health view**: `GET /api/admin/system-health`
   (permission `system.health`, Maintenance account only) and the page
   `/admin/system-health` in the SPA, which mirrors
   `php artisan app:launch-readiness` for an operator who is not at the
   console: overall status, release, database latency, pending migrations,
   queue depth and age per queue, failed jobs (24 h / total), scheduler
   heartbeat age, backup ages, disk, storage writability, mail and SMS
   transport names, error counters, and the readiness check table.
3. **An optional webhook** (`OBSERVABILITY_WEBHOOK_URL`, optional
   `OBSERVABILITY_WEBHOOK_TOKEN` sent as a bearer token,
   `OBSERVABILITY_WEBHOOK_TIMEOUT` default 2 s). Every signal above is POSTed
   as one JSON document with `application`, `environment`, `release` and
   `occurredAt` added. The call is synchronous, best-effort and short: a dead
   collector costs at most the timeout and one `NOTICE Observability webhook
   unreachable` line; it never fails the request or job that produced the
   signal. This is the hook for Sentry (its generic ingest / a relay), an
   n8n or Teams/Slack bridge, or the hospital's own log collector. No vendor
   SDK is bundled; adopting one later is a normal dependency review.

## 3. Sensitive-data rules

The reports are operational, never clinical. What is **never** collected:
request bodies, report cell values, evaluation answers, uploaded documents,
passwords, password hashes, session identifiers, CSRF/XSRF tokens, cookies,
authorization headers, reset tokens, query strings.

What the backend collects for a request: method, path (no query string),
route pattern, authenticated user id, status, duration. For an exception:
class, message, file path relative to the application root, line. For a job:
job class, queue, connection, attempts, exception class and message.

Every free-text field passes through `Redactor` (backend) or `scrubText`
(browser): `password=`, `token=`, `secret=`, `api_key=` style pairs, `Bearer`
values, long opaque tokens and query strings are replaced with `[redacted]`;
e-mail addresses keep only their first character and domain; messages are
capped (500 characters, stacks 4000). Array payloads drop any key that looks
like a credential (`password`, `token`, `cookie`, `authorization`, `session`,
`xsrf`, `api_key`, `secret`, ...). `ObservabilityTest` proves the redaction
for exceptions, failed jobs and client reports; the client endpoint accepts
only its fixed schema (kind, message, stack, route, status, release, user
agent, fingerprint), so nothing else can even be sent.

Client reports are public (the sign-in page must be able to report a broken
bundle), rate limited per IP (`CLIENT_ERROR_RATE_LIMIT`, default 20/min),
capped at 10 reports per page load and deduplicated by fingerprint in the
browser, and can be switched off with `CLIENT_ERROR_REPORTING=false`.

## 4. Alerts and recommended thresholds

These are proposed engineering thresholds; the hospital's IT/owner sets the
final values and the channel (`ERROR_MONITORING_CHANNEL` names it so strict
readiness knows one exists). See `docs/RELIABILITY_TARGETS.md`.

| Condition | Threshold | Source | Suggested response |
|---|---|---|---|
| Server errors | any `exception` / 5xx in production | webhook, `laravel.log`, health `serverErrors` | investigate the same day |
| Server error burst | more than 10 in an hour | health counters | page the maintainer |
| Slow requests | `SLOW_REQUEST_MS` 1000 ms (log), more than 20 per hour (alert) | log, health | check DB, queue backlog, disk |
| Queue backlog | depth > `QUEUE_DEPTH_WARNING` (100) or oldest job > `QUEUE_OLDEST_WARNING_SECONDS` (300, alert at 120 recommended) | `queue:monitor-health` log line, health | restart the worker units (`docs/OPERATIONS.md`) |
| Failed jobs | any failed job in 24 h | health, webhook | `php artisan queue:failed`; exports and deliveries are safe to retry |
| Scheduler heartbeat | older than 2 minutes (health warns at 5) | health, readiness | check `cron` and `schedule.log` |
| Database | connection fails or pending migrations > 0 | health | stop; follow the deploy runbook |
| Backups | dump or storage archive older than 26 h; off-box copy older than 26 h | readiness (nightly), health | check `imreport-backup.log`, the mount |
| Disk | free below `MIN_FREE_DISK_GB` (5) | readiness, health | prune backups/logs, grow the disk |
| Client errors | more than 20 per hour or the same fingerprint from many users | log, webhook | a bundle or API regression: compare `release` |

## 5. Provider configuration

```
# backend.env (all optional)
OBSERVABILITY_WEBHOOK_URL=https://collector.hospital.internal/imreport
OBSERVABILITY_WEBHOOK_TOKEN=...
OBSERVABILITY_WEBHOOK_TIMEOUT=2
SLOW_REQUEST_MS=1000
CLIENT_ERROR_REPORTING=true
CLIENT_ERROR_RATE_LIMIT=20
ERROR_MONITORING_CHANNEL="Hospital IT daily log review + webhook to collector"

# release identification (deploy.sh writes release.json; these override it)
APP_RELEASE_SHA=
APP_RELEASE_BUILT_AT=
```

Sentry, if adopted later: point `OBSERVABILITY_WEBHOOK_URL` at a small relay
that maps the JSON documents onto the Sentry event API, or add the official
SDK as a normal dependency review; either way the redaction above stays in
front of it, and the DSN lives only in `backend.env`.

## 6. Fallback when no provider is configured

Nothing changes for users. Signals are logged and counted; the health view
and `php artisan app:launch-readiness` show them; the operations handbook's
"Where the logs are" table remains the way to read them. Strict readiness
only insists that `ERROR_MONITORING_CHANNEL` names the human procedure that
watches the log.

## 7. Verification (2026-09-07)

- `ObservabilityTest`: 12 tests, 116 assertions: client reports accepted,
  validated, throttled, logged and forwarded without secrets; exceptions
  counted and forwarded with request context only; slow requests logged and
  counted; `Server-Timing` present; failed jobs counted and forwarded; the
  webhook failing or absent never surfaces; redaction; release resolution;
  the health endpoint is 401/403 for anonymous, nurse and admin and 200 for
  Maintenance, with no `APP_KEY`, `DB_PASSWORD` or `base64:` material in the
  body; every log line carries `release`.
- Frontend: 8 unit tests for the reporter (scrubbing, fingerprint, per-page
  cap, transport failures swallowed, idempotent install) and the boundary
  (recovery panel, single report, reset on navigation).
