# 08. Configuration guide

Three layers of configuration, from least to most often changed:

1. **Environment variables** (`backend.env`, build-time `VITE_*`): host,
   database, secrets, transports, retention. Changed by Hospital IT or the
   Maintenance holder; re-cached with `php artisan config:cache`. The full
   list with defaults is [reference/ENVIRONMENT-VARIABLES](reference/ENVIRONMENT-VARIABLES.md).
2. **Application settings** (Settings page, `app_settings` table): deadlines,
   locking, thresholds, reminders, critical fields, morning sessions. Changed
   by administrators; take effect immediately; audited.
3. **Reference data** (Templates, departments, wards, sections, forms):
   the instruments themselves. Content edits by administrators, structural
   edits by Maintenance. See [manuals/ADMIN-MANUAL](manuals/ADMIN-MANUAL.md)
   and [manuals/MAINTENANCE-MANUAL](manuals/MAINTENANCE-MANUAL.md).

## 1. The production environment file

`/opt/imreport/shared/backend.env`, owner `imreport:www-data`, mode 640. The
minimum set for the department server:

```dotenv
APP_ENV=production
APP_DEBUG=false
APP_KEY=                       # php artisan key:generate on the host
APP_URL=https://im.hospital.internal
FRONTEND_URL=https://im.hospital.internal
APP_TIMEZONE=UTC
HOSPITAL_TIMEZONE=Africa/Nairobi
TRUSTED_PROXIES=*

DB_CONNECTION=mariadb
DB_HOST=127.0.0.1
DB_PORT=3306
DB_DATABASE=imreport
DB_USERNAME=imreport_app
DB_PASSWORD=<managed secret>

SESSION_DRIVER=database
SESSION_SECURE_COOKIE=true
SESSION_ENCRYPT=true
SESSION_SAME_SITE=lax
SANCTUM_STATEFUL_DOMAINS=im.hospital.internal
CORS_ALLOWED_ORIGINS=https://im.hospital.internal

CACHE_STORE=database
QUEUE_CONNECTION=database
QUEUE_WORKER_MODE=daemon
QUEUE_WORKER_SERVICES=imreport-queue.service,imreport-queue-notifications.service
QUEUE_DEPTH_WARNING=100
QUEUE_OLDEST_WARNING_SECONDS=300

MAIL_MAILER=smtp               # plus MAIL_HOST, MAIL_PORT, credentials, MAIL_FROM_*
SMS_DRIVER=http                # plus SMS_HTTP_ENDPOINT, SMS_HTTP_TOKEN, SMS_FROM
BROADCAST_CONNECTION=log

BACKUP_DIR=/var/backups/imreport
SECONDARY_BACKUP_DIR=/mnt/backup/imreport
BACKUP_RESTORE_VERIFIED_AT=    # set after the first restore drill
ERROR_MONITORING_CHANNEL=      # name the procedure or webhook that watches the log
MIN_FREE_DISK_GB=5
PHP_FPM_POOL_FILE=/etc/php/8.3/fpm/pool.d/imreport.conf
PASSWORD_BREACH_CHECK=false
```

Leave `REPORT_WINDOW_LIVE_START` unset in production; it is a fixture switch.
`php artisan app:launch-readiness --strict` reports every missing or unsafe
value, and is the way to confirm the file after editing.

### What to change and when

| Change | Variables | Then |
|---|---|---|
| New hostname or certificate name | `APP_URL`, `FRONTEND_URL`, `SANCTUM_STATEFUL_DOMAINS`, `CORS_ALLOWED_ORIGINS`, nginx `server_name` and certificate paths | redeploy (the origin is baked into the bundle) |
| Mail or SMS gateway | `MAIL_*`, `SMS_*` | `config:cache`, restart the notification worker, send a test reminder |
| Adopting Redis | `CACHE_STORE`, `SESSION_DRIVER`, `QUEUE_CONNECTION`, `REDIS_*` with `REDIS_PERSISTENT=true` | repeat the load gates; see `decisions/redis-optional.md` |
| Retention decisions | `*_RETENTION_DAYS` | `config:cache`, then `app:prune-operational-data --dry-run` and read the counts |
| Observability collector | `OBSERVABILITY_WEBHOOK_*`, `ERROR_MONITORING_CHANNEL` | `config:cache` |
| Backup locations | `BACKUP_DIR`, `SECONDARY_BACKUP_DIR` | run `backup.sh` once by hand |

## 2. Local development configuration

```bash
cd backend && cp .env.example .env && php artisan key:generate
cp .env.local.example .env.local       # VITE_API_BASE_URL=http://localhost:5173
```

The committed `.env.example` is already local-ready: SQLite, `APP_ENV=local`,
database sessions and queues, log mail and SMS, localhost origins in Sanctum
and CORS, `QUEUE_WORKER_MODE=cron`. Two things people trip over:

- `VITE_API_BASE_URL` must be the Vite origin, not the Laravel port. Vite
  proxies `/api` and `/sanctum`; pointing the browser at `:8000` directly
  breaks the cookie session.
- Exports and mail need a worker. Run `php artisan queue:work --queue=analytics,notifications,default`
  in its own terminal, or a queued export sits at "pending" forever.

## 3. Application settings (Settings page)

Stored as JSON rows in `app_settings`; read through `AppSettingsService`;
every save writes an admin audit row. Both key styles are accepted by the API.

| Setting | Key | Default | Effect |
|---|---|---|---|
| Enforce deadlines | `deadlineEnforced` | on | Off: nothing is ever shown or notified as overdue |
| Weekly deadline day and time | `weeklyDeadlineDay`, `weeklyDeadlineTime` | Monday 10:00 | Recomputes `deadline_at` on every reporting period immediately; drives Overdue, reminders and the digest |
| Auto-lock hours after deadline | `autoLockHoursAfterDeadline` | 36 | Informational locking-rule setting shown on the board (locking itself is manual) |
| Notable rise and drop thresholds | `notableRiseThresholdPercent`, `notableDropThresholdPercent` | 10, 10 | "What changed this week" insight thresholds |
| Critical non-zero fields | `criticalNonZeroFields` | new_deaths, new_pressure_ulcer, total_hai, hai_clabsi, hai_cauti, hai_vap | Fields whose non-zero weekly total raises a critical alert |
| Report reminder tiers | `reminderInAppHoursBeforeDeadline`, `reminderEmailHoursBeforeDeadline`, `reminderSmsHoursBeforeDeadline`, `reminderOverdueHoursAfterDeadline` | 24, 4, 1, 0 | When each channel reminds; 0 hours after the deadline escalates as soon as the hourly job runs |
| Metric targets | `metricTargets` (deliveryRate, inpatientSafetyEvents, outpatientSameDayRate, procedureThroughput) | delivery 75/90 at least, safety 3/0 at most, same-day 75/90 at least, throughput 50/100 at least | Amber and green thresholds on dashboard tiles; `direction` is `atLeast` or `atMost` |
| Morning session days | `morningSessionDays` | 1, 3, 5 (Mon, Wed, Fri) | Days the session opens |
| Morning session time | `morningSessionTime` | 08:00 | Snapshotted onto each session when it opens |
| Morning recorders | `morningRecorderIds` | empty | Users allowed to record and cancel today's session |

Validation: times must be `HH:MM` (a value such as `25:99` is refused with
422), thresholds are positive integers, session days are 1 to 7, recorder ids
must exist.

## 4. Reporting-window behaviour

`REPORT_WINDOW_DEFAULT_COUNT` (9) is what a nurse or the submissions board
sees by default; `REPORT_WINDOW_MAX_COUNT` (104) caps "show everything".
Analytics ignore the window. The window never shows a week before the live
start, and never a future week.

## 5. Queue worker modes

| Mode | Where | How work runs |
|---|---|---|
| `daemon` | the department server | two systemd units run `queue:work` continuously; the scheduler's fallback line is a no-op |
| `cron` | shared hosting, local development | the scheduler starts a short-lived worker every minute (`--stop-when-empty --max-time=50`), so a queued export starts within about a minute |

The value is read through `config()`, so after changing it run
`php artisan config:cache` and restart the workers.

## 6. Reference data that is configuration

- **Report templates and fields**: family, active days, sections, field
  kinds, aggregate types, choice options, validation rules
  (`validation_rules` such as `sum_lte` with a severity and message). Content
  edits are live; structural edits are Maintenance-only.
- **Departments**: family, template, bed count (inpatient only; metrics are
  null without it), accent colour, active flag. Deleting a referenced
  department or template is refused; deactivate instead.
- **Reporting periods**: generated by `reports:ensure-periods`; never edited
  by hand.
- **Clinical alert rules**: template field, operator, threshold, severity,
  deadline hours, responsible role, notification roles, effective dates,
  versioned.
- **Academic**: wards, sections and heads, duty types, rotation calendars,
  teaching schedules, batches, representative assignments.
- **Evaluation forms**: versioned; see [workflows/ACADEMIC-EVALUATIONS](workflows/ACADEMIC-EVALUATIONS.md).

## 7. Host files that are configuration

All under `deploy/`, installed once by Hospital IT:

| File | Target | Notes |
|---|---|---|
| `nginx.conf` | `/etc/nginx/sites-available/imreport` | same-origin vhost, `/up` to Laravel, security headers, cache map |
| `php-fpm.conf` | `/etc/php/8.3/fpm/pool.d/imreport.conf` | 20 children, 256M memory limit, 12M/20M upload limits, slow log |
| `queue-worker.service`, `queue-notifications-worker.service` | `/etc/systemd/system/` | the two workers |
| `logrotate.conf` | `/etc/logrotate.d/imreport` | daily, keep 30, compressed |
| `ufw.sh` | run once | LAN firewall rules |
| `backup.sh` | cron 02:00 | nightly dump and storage archive |

Change these alongside their parity twins under `docker/` (see
`docs/PARITY_ENVIRONMENT.md` section 5).
