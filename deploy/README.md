# Deployment: the department's server

The platform runs on ONE Ubuntu LTS box on the hospital LAN, reachable only
from inside the hospital network (V2 guide Section 11). Same-origin: nginx
serves the built SPA and proxies `/api` and `/sanctum` to PHP-FPM 8.3.
MariaDB is local. Queue, cache, and sessions stay on the database driver;
do not add Redis. The one always-on process is the systemd queue worker.

## Files here

| File | Purpose | Install target |
|---|---|---|
| `nginx.conf` | Same-origin site: SPA + `/api` proxy, HTTPS, SPA fallback | `/etc/nginx/sites-available/imreport` |
| `queue-worker.service` | Persistent `queue:work` daemon (replaces the cron tick) | `/etc/systemd/system/imreport-queue.service` |
| `backup.sh` | Nightly consistent dump, 30-day rotation, off-box copy, weekly integrity test | cron `0 2 * * *` |
| `deploy.sh` | Pull, migrate, cache, build SPA, restart worker, health-check | run per release |
| `ufw.sh` | Firewall: 443/80 from the hospital subnet, SSH from the admin VLAN | run once |
| `logrotate.conf` | Laravel + worker + backup logs | `/etc/logrotate.d/imreport` |

## First-time install (summary)

1. Ubuntu LTS with `nginx`, `php8.3-fpm` (+ common extensions), `mariadb-server`,
   `composer`, `nodejs` 20+, `git`, `ufw`, `fail2ban`, `unattended-upgrades`.
2. Clone the repository to `/opt/imreport`; create the MariaDB database and a
   least-privilege app user plus a read-only `imreport_backup` user
   (credentials in `/etc/mysql/imreport-backup.cnf`, chmod 600).
3. `backend/.env` (then `php artisan config:cache`):
   - `APP_ENV=production`, `APP_DEBUG=false`, `APP_URL=https://im.hospital.internal`
   - `DB_CONNECTION=mariadb` + credentials
   - `SESSION_SECURE_COOKIE=true`, `SESSION_ENCRYPT=true`
   - `SANCTUM_STATEFUL_DOMAINS=im.hospital.internal`, `SESSION_DOMAIN=im.hospital.internal`
   - `QUEUE_WORKER_MODE=daemon` (the systemd unit replaces the cron-tick worker)
   - `BACKUP_DIR=/var/backups/imreport`, `SECONDARY_DIR=<second disk or NAS mount>`
4. HTTPS (required by the PWA service worker even on a LAN):
   - Preferred: a real domain resolving to the private IP, certificate via ACME
     **DNS-01** (`certbot` DNS plugin or `acme.sh`), auto-renewed by cron. No
     inbound ports need to open.
   - Fallback: an internal CA (`step-ca` or a one-shot openssl CA); install the
     CA certificate on department devices (guide in `docs/OPERATIONS.md`).
5. Install `nginx.conf`, `queue-worker.service`, `logrotate.conf`; run `ufw.sh`.
6. System cron (as the app user):
   ```
   * * * * *  cd /opt/imreport/backend && php artisan schedule:run >> storage/logs/schedule.log 2>&1
   0 2 * * *  /opt/imreport/deploy/backup.sh >> /var/log/imreport-backup.log 2>&1
   ```
7. Run `deploy.sh`, then `php artisan app:launch-check`; it must be green
   (it verifies backup freshness, the worker unit, the scheduler heartbeat,
   free disk, HTTPS, and the certificate window).

## Cutover (guide 11.4)

1. **Stage**: install on the server, import a fresh production dump, run the
   migrations (the academic seed + backfill run automatically), smoke test on
   the LAN. `php artisan academic:verify-migration` must print `PASS`.
2. **Freeze Friday evening**: final dump from the old hosting, import, switch
   DNS or the hosts entries. `php artisan app:launch-check` must be green.
   Go live Monday.
3. Keep the old hosting read-only for two weeks as rollback, then decommission.

## Availability note

Everything depends on one box. The compensating controls are the UPS, the
off-box backup copy, disk monitoring (in `app:launch-check`), and the
rehearsed monthly restore. In exchange, an internet outage no longer affects
the system at all.
