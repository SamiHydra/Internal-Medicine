# 11. Monitoring and observability

What the platform records about its own health, where each signal goes, what
should alert, and what is never collected. Every integration is optional and
configured by environment variables; the application works with none of them.
The long-form source is `docs/OBSERVABILITY.md`; the targets are
`docs/RELIABILITY_TARGETS.md`.

## 1. The signals

| Signal | Source | Where it goes |
|---|---|---|
| Unhandled backend exception | exception handler | `laravel.log` ERROR line, hourly counter `exceptions`, webhook `exception` |
| HTTP 5xx answer | `RecordRequestTiming` middleware | counter `serverErrors` |
| Slow request (over `SLOW_REQUEST_MS`, default 1000) | same middleware | `WARNING Slow request {method, path, route, durationMs, status, userId}`, counter `slowRequests`, webhook `slow_request` |
| Failed queue job | `Queue::failing` listener | `WARNING Queue job failed`, counter `failedJobs`, webhook `failed_job` |
| Queue depth and oldest job | `queue:monitor-health --json` every minute | `WARNING Queue health threshold exceeded` or `INFO Queue health check passed` |
| Scheduler heartbeat | scheduler task every minute | cache key `scheduler:heartbeat`; age shown in health and readiness |
| Database connectivity and pending migrations | health snapshot, readiness | health view |
| Backup ages (dump, storage archive, off-box) | health snapshot, readiness | health view |
| Disk free, storage writable | health snapshot, readiness | health view |
| Browser: uncaught error, unhandled rejection, route render failure, API 5xx, offline save gave up | `installGlobalErrorReporting`, `RouteErrorBoundary`, the API client, the replay loop | `POST /api/client-errors` → `WARNING Client error {...}`, counter `clientErrors`, webhook `client_*` |

Every log line carries `release` (the short commit SHA). Every HTTP response
carries `Server-Timing: app;dur=<ms>` so browser tools and the load harness
can separate server time from network time. Counters are hourly buckets kept
three hours in the cache; the log and any collector keep history.

## 2. Where to look

1. **The log** `/opt/imreport/shared/storage/logs/laravel.log`: the record
   of truth, always on, rotated daily and kept 30 days.
2. **The health view**: `GET /api/admin/system-health` and the page
   `/admin/system-health`, Maintenance only (`system.health`). Overall status,
   release, database latency and pending migrations, queue depth and age per
   queue, failed jobs (24 h and total), heartbeat age, backup ages, disk,
   storage, mail and SMS transport names, hourly error counters, and the full
   readiness table. It mirrors `php artisan app:launch-readiness` for someone
   who is not at the console.
3. **The readiness command**: `php artisan app:launch-readiness [--strict]`,
   run nightly and after every deploy.
4. **An optional webhook** (`OBSERVABILITY_WEBHOOK_URL`, bearer
   `OBSERVABILITY_WEBHOOK_TOKEN`, timeout 2 s): every signal above is POSTed
   as one JSON document with `application`, `environment`, `release`,
   `occurredAt` and `kind`. Best effort and short: a dead collector costs at
   most the timeout and one NOTICE line, never a failed request. This is the
   hook for Sentry (through a relay), a Teams or Slack bridge, or the
   hospital's log collector.

## 3. Recommended alert thresholds

Proposed values; the hospital sets the final ones and names the channel in
`ERROR_MONITORING_CHANNEL` so strict readiness knows one exists.

| Condition | Threshold | Response |
|---|---|---|
| Server errors | any exception or 5xx in production | investigate the same day |
| Error burst | more than 10 in an hour | page the maintainer |
| Slow requests | logged at 1000 ms; alert at more than 20 per hour | check database, queue backlog, disk |
| Queue backlog | depth over 100, or oldest job over 300 s (alert at 120 recommended) | restart the worker units |
| Failed jobs | any in 24 h | `php artisan queue:failed`; exports and deliveries are safe to retry |
| Scheduler heartbeat | older than 2 minutes (health warns at 5) | check `cron` and `schedule.log` |
| Database | connection fails or pending migrations | stop; follow the deploy runbook |
| Backups | dump, archive or off-box copy older than 26 h | check `imreport-backup.log` and the mount |
| Disk | free below `MIN_FREE_DISK_GB` (5) | prune, grow the disk |
| Client errors | more than 20 per hour, or one fingerprint from many users | a bundle or API regression; compare `release` |
| Availability | `/up` probe from the Hospital IT monitor every minute | 99.5 percent target during 07:00 to 19:00 |

## 4. Performance targets to compare against

From the parity measurements (`docs/RELIABILITY_TARGETS.md`): routine API
p95 under 500 ms and p99 under 1000 ms at up to 100 concurrent users; sign-in
p95 under 1000 ms; dashboard analytics p95 under 1500 ms cold and 300 ms warm;
error rate under 0.5 percent per hour; a queued job starting within 30 s;
deploy downtime under 60 s. Real-user timings are sampled from browsers
(`VITE_RUM_SAMPLE_RATE`, 10 percent by default) into `performance_metrics`,
content-free, kept 90 days.

## 5. What is never collected

Request bodies, report cell values, evaluation answers, uploaded documents,
passwords and hashes, session identifiers, CSRF tokens, cookies,
authorization headers, reset tokens, query strings. Free text passes through
a redactor on both sides (`password=`, `token=`, bearer values, long opaque
tokens and query strings become `[redacted]`; e-mail addresses keep the first
character and the domain; messages are capped). The client endpoint accepts
only its fixed schema, is public (the sign-in page must be able to report a
broken bundle), rate limited per IP, capped per page load, deduplicated by
fingerprint, and can be disabled with `CLIENT_ERROR_REPORTING=false`.
`ObservabilityTest` proves the redaction and that the health endpoint leaks no
key material.

## 6. Configuration

```dotenv
OBSERVABILITY_WEBHOOK_URL=https://collector.hospital.internal/imreport   # optional
OBSERVABILITY_WEBHOOK_TOKEN=...
OBSERVABILITY_WEBHOOK_TIMEOUT=2
SLOW_REQUEST_MS=1000
CLIENT_ERROR_REPORTING=true
CLIENT_ERROR_RATE_LIMIT=20
ERROR_MONITORING_CHANNEL="Hospital IT daily log review + webhook to collector"
```

With nothing configured, users notice no difference: signals are logged and
counted, the health view and readiness show them, and the operations manual's
log table is the way to read them.

## 7. Review cadence

After the first full month in production compare the health counters, the
slow-request log and a re-run of the load harness on the real host against
the targets; adjust `SLOW_REQUEST_MS`, `QUEUE_DEPTH_WARNING`,
`QUEUE_OLDEST_WARNING_SECONDS` and `MIN_FREE_DISK_GB` together with the
thresholds above.
