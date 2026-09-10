# Environment variables

Every variable the platform reads, with its default and the value production
must use. Backend variables live in `backend/.env` locally and in
`/opt/imreport/shared/backend.env` on the server; after changing any of them
on the server run `php artisan config:cache`. Frontend variables are baked
into the bundle at build time (`.env.local` locally; `deploy.sh` sets them).
Only `*.example` files are tracked in git.

## Backend: application

| Variable | Default | Production | Purpose |
|---|---|---|---|
| `APP_NAME` | St Paul's Reporting API | same | Display name |
| `APP_ENV` | `local` | `production` | Environment; `Dev*Seeder` and the test flush route exist only in `local` |
| `APP_KEY` | empty | generated on the host | Encryption key; never reuse `.env.docker`'s placeholder |
| `APP_DEBUG` | `false` | `false` | `true` in production makes the app refuse to boot |
| `APP_URL` | `http://localhost:8000` | `https://im.hospital.internal` | Public origin; `deploy.sh` bakes it into `VITE_API_BASE_URL` |
| `FRONTEND_URL` | `http://localhost:5173` | same as `APP_URL` | Password-reset links, CORS default |
| `APP_TIMEZONE` | `UTC` | `UTC` | Stored timestamps; do not change on an existing database |
| `HOSPITAL_TIMEZONE` | `Africa/Nairobi` | `Africa/Nairobi` | Date-only decisions and scheduled jobs |
| `TRUSTED_PROXIES` | empty | `*` | nginx terminates TLS on the same host |
| `APP_RELEASE_SHA`, `APP_RELEASE_BUILT_AT`, `APP_RELEASE_FILE` | from `release.json` | written by `deploy.sh` | Release identity in logs and the health view |
| `APP_MAINTENANCE_DRIVER` | `file` | `file` | Maintenance mode store |
| `APP_LOCALE`, `APP_FALLBACK_LOCALE`, `APP_FAKER_LOCALE` | `en` | `en` | |
| `BCRYPT_ROUNDS` | 12 | 12 | Password hashing cost (4 in tests) |
| `PASSWORD_BREACH_CHECK` | `false` | `false` unless egress to `api.pwnedpasswords.com` exists | Have I Been Pwned check on new passwords |
| `PASSWORD_BREACH_CHECK_TIMEOUT` | 5 | 5 | seconds |

## Backend: database

| Variable | Default | Production |
|---|---|---|
| `DB_CONNECTION` | `sqlite` | `mariadb` |
| `DB_HOST`, `DB_PORT`, `DB_DATABASE`, `DB_USERNAME`, `DB_PASSWORD` | unset | least-privilege application account |
| `DB_CHARSET`, `DB_COLLATION` | utf8mb4 | utf8mb4 |
| `DB_CONNECT_TIMEOUT` | driver default | set (a hung connect no longer blocks a PHP-FPM worker forever) |
| `DB_FOREIGN_KEYS`, `DB_BUSY_TIMEOUT`, `DB_JOURNAL_MODE`, `DB_SYNCHRONOUS` | SQLite tuning | n/a |
| `DB_SSLMODE`, `DB_ENCRYPT`, `DB_TRUST_SERVER_CERTIFICATE`, `MYSQL_ATTR_SSL_CA`, `DB_SOCKET`, `DB_URL` | unset | per Hospital IT |

## Backend: sessions, cookies, CORS

| Variable | Default | Production | Purpose |
|---|---|---|---|
| `SESSION_DRIVER` | `database` | `database` (or `redis`) | Server-side sessions |
| `SESSION_LIFETIME` | 120 | 120 | minutes |
| `SESSION_ENCRYPT` | `false` | `true` | |
| `SESSION_SECURE_COOKIE` | unset (secure when `APP_ENV=production`) | `true` | Cookie only over HTTPS |
| `SESSION_SAME_SITE` | `lax` | `lax` | Required by the same-origin model |
| `SESSION_DOMAIN` | `null` | unset (same host) | Only when SPA and API are on sibling subdomains |
| `SESSION_PATH`, `SESSION_HTTP_ONLY`, `SESSION_EXPIRE_ON_CLOSE`, `SESSION_PARTITIONED_COOKIE`, `SESSION_TABLE`, `SESSION_CONNECTION`, `SESSION_STORE` | framework defaults | defaults | |
| `SANCTUM_STATEFUL_DOMAINS` | `localhost:5173,127.0.0.1:5173,localhost,127.0.0.1` | `im.hospital.internal` | Origins that get cookie sessions; no localhost entries in production |
| `SANCTUM_TOKEN_PREFIX` | unset | unset | Unused (no tokens issued) |
| `CORS_ALLOWED_ORIGINS` | `http://localhost:5173,http://127.0.0.1:5173` | `https://im.hospital.internal` | Explicit list; credentials are on so `*` is impossible |

## Backend: queues, cache, scheduler

| Variable | Default | Production | Purpose |
|---|---|---|---|
| `QUEUE_CONNECTION` | `database` | `database` (or `redis`) | |
| `QUEUE_WORKER_MODE` | `cron` | `daemon` | `daemon` disables the scheduler's per-minute fallback worker; read via `config()`, so re-cache after changing |
| `QUEUE_WORKER_SERVICE` | `imreport-queue.service` | same | Legacy single-unit name |
| `QUEUE_WORKER_SERVICES` | `imreport-queue.service,imreport-queue-notifications.service` | same | Units readiness checks with `systemctl is-active` |
| `QUEUE_DEPTH_WARNING` | 100 | 100 | `queue:monitor-health` threshold |
| `QUEUE_OLDEST_WARNING_SECONDS` | 300 | 300 (120 recommended for alerting) | |
| `DB_QUEUE_RETRY_AFTER`, `REDIS_QUEUE_RETRY_AFTER` | 360 | 360 | seconds before a stuck job is retried |
| `QUEUE_TRANSIENT_RETRY_LIMIT` | 20 | 20 | `queue:retry-transient` batch size |
| `QUEUE_TRANSIENT_RETRY_MAX_AGE_HOURS` | 24 | 24 | |
| `QUEUE_FAILED_DRIVER`, `DB_QUEUE`, `DB_QUEUE_TABLE`, `DB_QUEUE_CONNECTION` | framework defaults | defaults | |
| `CACHE_STORE` | `database` | `database` (or `redis`) | Also holds the scheduler heartbeat and analytics cache |
| `CACHE_PREFIX`, `DB_CACHE_TABLE`, `DB_CACHE_LOCK_TABLE`, `DB_CACHE_CONNECTION`, `DB_CACHE_LOCK_CONNECTION` | defaults | defaults | |
| `REDIS_CLIENT`, `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD`, `REDIS_USERNAME`, `REDIS_DB`, `REDIS_CACHE_DB`, `REDIS_PERSISTENT`, `REDIS_PREFIX`, `REDIS_TIMEOUT`, `REDIS_MAX_RETRIES`, `REDIS_BACKOFF_*`, `REDIS_CLUSTER`, `REDIS_URL`, `REDIS_QUEUE*`, `REDIS_CACHE_*` | phpredis, 127.0.0.1:6379 | only if Redis is adopted; persistent connections mandatory | See `decisions/redis-optional.md` |
| `MEMCACHED_*`, `DYNAMODB_*`, `SQS_*`, `BEANSTALKD_*`, `AWS_*` | unset | unset | Framework options, unused |

## Backend: mail, SMS, broadcasting

| Variable | Default | Production | Purpose |
|---|---|---|---|
| `MAIL_MAILER` | `log` | a real transport (`smtp`) | Reminders, resets, digest; readiness warns on `log` |
| `MAIL_HOST`, `MAIL_PORT`, `MAIL_USERNAME`, `MAIL_PASSWORD`, `MAIL_SCHEME`, `MAIL_EHLO_DOMAIN`, `MAIL_URL`, `MAIL_SENDMAIL_PATH`, `MAIL_LOG_CHANNEL` | | per Hospital IT | |
| `MAIL_FROM_ADDRESS`, `MAIL_FROM_NAME` | `hello@example.com` | department address | |
| `POSTMARK_*`, `RESEND_API_KEY`, `SLACK_*`, `ABLY_KEY`, `PUSHER_*` | unset | unset | Unused transports |
| `SMS_DRIVER` | `log` | `http` | |
| `SMS_HTTP_ENDPOINT`, `SMS_HTTP_TOKEN`, `SMS_FROM` | empty | gateway values | |
| `SMS_HTTP_TO_FIELD`, `SMS_HTTP_MESSAGE_FIELD`, `SMS_HTTP_FROM_FIELD` | `to`, `message`, `from` | per gateway | Field names for simple HTTP gateways |
| `SMS_HTTP_TIMEOUT` | 10 | 10 | seconds |
| `SMS_LOG_CHANNEL` | default | default | |
| `BROADCAST_CONNECTION` | `log` | `log` | `reverb` only if a websocket server is hosted |
| `REVERB_*` | empty | empty | Websocket server settings, disabled |

## Backend: reporting behaviour

| Variable | Default | Production | Purpose |
|---|---|---|---|
| `REPORT_WINDOW_DEFAULT_COUNT` | 9 | 9 | Periods a normal listing spans |
| `REPORT_WINDOW_MAX_COUNT` | 104 | 104 | Ceiling for `reportPeriodWindow=all` |
| `REPORT_WINDOW_LIVE_START` | unset | **unset** | Fixture-only; the week the archive starts |
| `REPORT_OUTLIER_FACTOR` | 3 | 3 | Weekly total more than this multiple of the baseline warns |
| `REPORT_OUTLIER_MIN_PERIODS` | 3 | 3 | Baseline needs this many prior weeks |
| `REPORT_OUTLIER_LOOKBACK` | 6 | 6 | Weeks of baseline |
| `REPORT_OUTLIER_MIN_BASELINE` | 5 | 5 | Ignore tiny baselines |
| `ANALYTICS_EXPORT_MAX_REPORTS` | 5000 | 5000 | Largest export |
| `SEED_HISTORY_WEEKS` | 104 (`.env.example`), 52 (config default) | n/a | Weeks the development fixture fills |

## Backend: retention

| Variable | Default | Purpose |
|---|---|---|
| `NOTIFICATION_READ_RETENTION_DAYS` | 90 | Read notifications pruned weekly |
| `EXPORT_RETENTION_DAYS` | 30 | Export files and rows; 0 disables |
| `REPORT_AUDIT_RETENTION_DAYS` | 0 (keep) | Cell audit rows; set only after policy approval |
| `ADMIN_AUDIT_RETENTION_DAYS` | 0 (keep) | Admin audit rows |
| `REPORT_STATUS_HISTORY_RETENTION_DAYS` | 0 (keep) | Status history |
| `PERFORMANCE_METRIC_RETENTION_DAYS` | 90 | Browser timing samples |

## Backend: readiness, observability, host signals

| Variable | Default | Production | Purpose |
|---|---|---|---|
| `BACKUP_DIR` | `/var/backups/imreport` | same | Where `backup.sh` writes |
| `SECONDARY_BACKUP_DIR` | `/mnt/backup/imreport` | the mounted second disk | Off-box copy; `backup.sh` fails without it |
| `BACKUP_RESTORE_VERIFIED_AT` | empty | ISO-8601 time of the last restore drill | Strict readiness fails after `BACKUP_RESTORE_MAX_AGE_DAYS` |
| `BACKUP_RESTORE_MAX_AGE_DAYS` | 90 | 90 | |
| `ERROR_MONITORING_CHANNEL` | empty | a named procedure or webhook | Strict readiness fails when blank |
| `MIN_FREE_DISK_GB` | 5 | 5 | |
| `PHP_FPM_POOL_FILE` | unset | `/etc/php/8.3/fpm/pool.d/imreport.conf` | Readiness checks the upload limits in it |
| `SLOW_REQUEST_MS` | 1000 | 1000 | Slow-request log and counter |
| `OBSERVABILITY_WEBHOOK_URL`, `OBSERVABILITY_WEBHOOK_TOKEN`, `OBSERVABILITY_WEBHOOK_TIMEOUT` | unset, unset, 2 | optional collector | Best-effort forwarding of every signal |
| `CLIENT_ERROR_REPORTING` | `true` | `true` | Accept browser error reports |
| `CLIENT_ERROR_RATE_LIMIT` | 20 | 20 | per minute per IP |
| `LOG_CHANNEL`, `LOG_STACK`, `LOG_LEVEL`, `LOG_DAILY_DAYS`, `LOG_DEPRECATIONS_*`, `LOG_SLACK_*`, `LOG_PAPERTRAIL_*`, `LOG_STDERR_FORMATTER`, `LOG_SYSLOG_FACILITY` | `stack`/`single`/`debug` | `LOG_LEVEL=warning` or `info` | Laravel logging |
| `FILESYSTEM_DISK` | `local` | `local` | Uploads under `storage/app/private` |

## Frontend (build time, `VITE_` prefix)

| Variable | Local | Production | Purpose |
|---|---|---|---|
| `VITE_API_BASE_URL` | `http://localhost:5173` (the Vite origin, never `:8000`) | `APP_URL`, set by `deploy.sh` | The origin the browser calls; must equal the origin the page is opened on |
| `VITE_RELEASE_SHA` | `local` | git SHA, set by `deploy.sh` | Shown in the shell and error reports |
| `VITE_RUM_SAMPLE_RATE` | 0 | 0.1 default | Share of sessions sending performance samples |
| `VITE_LIVE_REPORTING_START` | unset | unset | Fixture-only; matches `REPORT_WINDOW_LIVE_START` |
| `VITE_REVERB_APP_KEY`, `VITE_REVERB_HOST`, `VITE_REVERB_PORT`, `VITE_REVERB_SCHEME` | empty | empty | Websockets, disabled |
| `VITE_DEV_API_TARGET` | unset | n/a | Points the dev proxy at another backend port |
| `VITE_APP_NAME` | from `APP_NAME` | | |

## Test and harness variables (never on the server)

| Variable | Used by |
|---|---|
| `E2E_BASE_URL`, `E2E_ALL_BROWSERS`, `E2E_A11Y`, `QA_ACCOUNT_PASSWORD` | Playwright gate and external config |
| `REGRESSION_BASE_URL`, `REGRESSION_DB` | business-logic regression harness |
| `SMOKE_BASE_URL`, `SMOKE_ADMIN_IDENTIFIER`, `SMOKE_ADMIN_PASSWORD`, `SMOKE_NURSE_IDENTIFIER`, `SMOKE_NURSE_PASSWORD`, `SMOKE_ACADEMIC_IDENTIFIER`, `SMOKE_ACADEMIC_PASSWORD`, `SMOKE_REP_IDENTIFIER`, `SMOKE_REP_PASSWORD`, `SMOKE_ALLOW_WRITE`, `SMOKE_EXPECTED_RELEASE` | production smoke suite |
| `LOAD_BASE_URL`, `LOAD_USERS`, `LOAD_DURATION_SECONDS`, `LOAD_RAMP_SECONDS`, `LOAD_PROFILE`, `LOAD_CREDENTIALS_FILE`, `LOAD_ALLOW_HIGH_CONCURRENCY`, `LOAD_SYNTHETIC_SOURCE_IPS` | load harness |
| `RELEASE_SHA`, `STACK_SEED_DEV_DATA` | parity stack build and seed |
