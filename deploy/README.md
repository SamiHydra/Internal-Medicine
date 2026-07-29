# Department server deployment

Production runs on one Ubuntu LTS server on the hospital LAN. Nginx serves the SPA and proxies `/api` and `/sanctum` to PHP-FPM from the same HTTPS origin. MariaDB is local to the server. Cache, sessions, and queues may start on the database driver; Redis is the supported scale-up path once production measurements show database contention.

## Directory layout

```text
/opt/imreport/
  source/                 deployment Git checkout
  releases/               immutable release directories
  shared/backend.env      production Laravel environment
  shared/storage/         persistent uploads, framework data, and logs
  current -> releases/... atomic active-release link
```

The queue worker, Nginx, cron, and operators always use `/opt/imreport/current`. Never deploy by editing `current` or copying files into it.

## Files

| File | Purpose | Install target |
|---|---|---|
| `nginx.conf` | Same-origin SPA and Laravel host | `/etc/nginx/sites-available/imreport` |
| `php-fpm.conf` | Explicit worker limits, memory limit, recycling, timeout, and slow log | `/etc/php/8.3/fpm/pool.d/imreport.conf` |
| `queue-worker.service` | Analytics/default database queue worker | `/etc/systemd/system/imreport-queue.service` |
| `queue-notifications-worker.service` | Isolated notification/default worker | `/etc/systemd/system/imreport-queue-notifications.service` |
| `backup.sh` | Daily consistent dump, retention, secondary copy, integrity check | Cron at 02:00 |
| `deploy.sh` | Locked, versioned, backup-first atomic deployment | Run from the source checkout |
| `ufw.sh` | Hospital-LAN firewall rules | Run once |
| `logrotate.conf` | Application and operations log rotation | `/etc/logrotate.d/imreport` |

## First installation

1. Install Nginx, PHP-FPM 8.3, MariaDB, Composer, Node.js 22.12.0 or newer, Git, `flock`, UFW, and unattended security updates. Use the official Node.js/NodeSource 22 repository rather than Ubuntu's older generic `nodejs` package.
2. Create a non-login `imreport` deployment account in the `www-data` group. Pre-create `/opt/imreport`, `/var/backups/imreport`, and the secondary backup mount with owner `imreport` and group `www-data`; use setgid mode `2775` on shared writable directories.
3. Clone the repository into `/opt/imreport/source` as `imreport`.
4. Create `/opt/imreport/shared/backend.env` owned by `imreport:www-data` with mode `640` and the production Laravel settings.
5. Install `/etc/mysql/imreport-backup.cnf` as `root:imreport` with mode `640`, using a MariaDB account that has only the privileges required by `mysqldump`.
6. Grant `imreport` passwordless sudo for only `/usr/bin/systemctl reload php8.3-fpm`; the deployment script requires no broader sudo access.
7. Set at least:
   - `APP_ENV=production`, `APP_DEBUG=false`, `APP_TIMEZONE=UTC`, `HOSPITAL_TIMEZONE=Africa/Nairobi`
   - `APP_URL=https://im.hospital.internal`
   - `DB_CONNECTION=mariadb` and least-privilege credentials
   - `SESSION_SECURE_COOKIE=true`, `SESSION_ENCRYPT=true`
   - `SANCTUM_STATEFUL_DOMAINS=im.hospital.internal`
   - `CORS_ALLOWED_ORIGINS=https://im.hospital.internal`
   - `QUEUE_WORKER_MODE=daemon`
   - `TRUSTED_PROXIES=*`
   - `QUEUE_WORKER_SERVICES=imreport-queue.service,imreport-queue-notifications.service`
   - `QUEUE_DEPTH_WARNING=100`, `QUEUE_OLDEST_WARNING_SECONDS=300`
   - `BACKUP_DIR=/var/backups/imreport`, `SECONDARY_BACKUP_DIR=/mnt/backup/imreport`, `MIN_FREE_DISK_GB=5`
   - `BACKUP_RESTORE_VERIFIED_AT=<ISO-8601 time of the latest successful restore drill>`
   - `ERROR_MONITORING_CHANNEL=<Sentry project or named scheduled log-review process>`
8. Install the Nginx, PHP-FPM pool, both queue-worker systemd units, logrotate, and firewall files. Enable `imreport-queue.service` and `imreport-queue-notifications.service`. Disable the distribution `www` pool if it is otherwise unused, then validate with `php-fpm8.3 -t` before reloading PHP-FPM.
9. Install `/etc/cron.d/imreport` using the stable active-release link and the explicit service account:

   ```cron
   * * * * * imreport cd /opt/imreport/current/backend && php artisan schedule:run >> /opt/imreport/shared/storage/logs/schedule.log 2>&1
   0 2 * * * imreport /opt/imreport/source/deploy/backup.sh >> /var/log/imreport-backup.log 2>&1
   ```

   `backup.sh` reads `DB_DATABASE`, `BACKUP_DIR`, and `SECONDARY_BACKUP_DIR`
   from `/opt/imreport/shared/backend.env` without sourcing or executing that
   file. It refuses to dump an absent/unsafe database name or an override that
   does not match Laravel's `DB_DATABASE`.

10. Run `sudo -u imreport /opt/imreport/source/deploy/deploy.sh --dry-run` and correct every missing prerequisite.
11. Run `sudo -u imreport /opt/imreport/source/deploy/deploy.sh`.
12. Confirm `cd /opt/imreport/current/backend && php artisan app:launch-readiness --strict` is green.

## Queue worker layout

The primary worker consumes `analytics,default`; the second consumes
`notifications,default`. Analytics warms and exports therefore retain a worker
even when an SMTP/SMS delivery is slow. `queue:monitor-health --json` runs each
minute and logs every queue's depth and oldest-job age, warning above the
configured thresholds.

For the smallest install, one worker is supported only as an explicit fallback:
disable `imreport-queue-notifications.service` and override the primary unit's
command to:

```text
/usr/bin/php artisan queue:work --queue=analytics,notifications,default --tries=3 --backoff=10 --max-time=3600
```

The single-worker fallback sacrifices isolation and should be replaced by the
two-unit layout when notification delivery is enabled.

## Capacity and Redis scale-up

The committed PHP-FPM pool makes concurrency finite and observable instead of
depending on distribution defaults. Keep 20 children on hardware comparable to
the audited host. Before changing `pm.max_children`, measure p95 PHP worker RSS,
MariaDB `Threads_connected`, and CPU/queue behavior during the standard peak
and spike tests. Size the pool as:

```text
max_children = min(
  floor(PHP_RAM_budget / (p95_worker_RSS × 1.25)),
  floor(max_connections × 0.8) - reserved_non_FPM_connections,
  CPU/load-tested_cap
)
```

The production-shaped audit measured p95 worker RSS at about 47 MiB. The
committed 256 MiB PHP memory limit is an allocation ceiling, not observed
worker RSS, and must not be used as the divisor. CPU is the observed binding
constraint: never raise the child count from memory arithmetic alone. Retest
the candidate value on the target host and reject it if ordinary API latency or
FPM queue gates fail.

If database-backed cache/session/queue traffic is materially contributing to
MariaDB latency, install a LAN-local Redis instance with authentication and
persistence appropriate to Hospital IT policy, then set:

```dotenv
CACHE_STORE=redis
SESSION_DRIVER=redis
QUEUE_CONNECTION=redis
QUEUE_WORKER_MODE=daemon
REDIS_CLIENT=phpredis
REDIS_HOST=127.0.0.1
REDIS_PASSWORD=<managed secret>
REDIS_PORT=6379
```

Run the same load test before and after the switch. Do not enable Redis merely
from a development SQLite result: record workspace/API p95, MariaDB query time,
PHP-FPM queue depth, and failed-job count as the acceptance evidence.

## TLS for the internal hostname

The `.internal` hostname cannot use ordinary public HTTP ACME validation. The default Nginx paths expect a Hospital IT internal-CA certificate in `/etc/imreport/tls`. Install the internal CA root on managed devices and automate renewal through that CA.

If Hospital IT supplies a real domain that resolves privately, DNS-01 ACME may be used instead. Update the Nginx certificate paths to the issued files. Do not point Certbot at `im.hospital.internal` and assume public issuance will work.

## What deployment guarantees

The script:

1. Takes an exclusive deployment lock.
2. Creates a new release from the exact Git revision.
3. Installs dependencies and runs the full frontend verification before downtime.
4. Runs a migration preview.
5. Creates and decompress-verifies a pre-migration database backup.
6. Enters maintenance mode, migrates, and builds Laravel caches.
7. Atomically switches `current` and reloads PHP-FPM.
8. Verifies the authentication wall and launch readiness.
9. Restores the previous code release automatically if post-switch verification fails.

Database migrations are forward-only. Every production migration must remain backward compatible with the immediately previous code release. If a migration violates that rule, restoration uses the verified pre-migration dump during a declared outage.

## Manual code rollback

List releases, choose the last known-good directory, then atomically replace the link:

```bash
ls -1dt /opt/imreport/releases/*
ln -s /opt/imreport/releases/GOOD_RELEASE /opt/imreport/current.rollback
mv -Tf /opt/imreport/current.rollback /opt/imreport/current
sudo systemctl reload php8.3-fpm
cd /opt/imreport/current/backend
php artisan queue:restart
php artisan up
php artisan app:launch-readiness --strict
```

Do not run `migrate:rollback` automatically. Use an explicitly reviewed rollback migration or restore the verified dump after Hospital IT confirms the recovery window.

## Cutover

Stage the complete host first, import a recent data copy, run migrations, verify migration parity with meaningful legacy rows, and complete browser smoke testing on the LAN. During final cutover, freeze the old system, take the final dump, deploy, switch DNS or managed hosts entries, and require `app:launch-readiness --strict` to pass before users are admitted.
