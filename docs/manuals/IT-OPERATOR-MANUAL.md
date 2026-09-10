# IT operator manual

Host-level duties for Hospital IT on the department server
(`im.hospital.internal`, Ubuntu LTS, on the hospital LAN). The department
administrator handles the application-level routine in the
[Operations manual](../09-OPERATIONS-MANUAL.md); this manual is what needs
root, the network, or the hardware.

## 1. What runs on the server

| Component | Unit or file | Notes |
|---|---|---|
| nginx | `nginx.service`, vhost `/etc/nginx/sites-available/imreport` | one HTTPS origin; serves `dist/` and proxies `/api`, `/sanctum`, `/up` to PHP-FPM over a unix socket |
| PHP-FPM 8.3 | `php8.3-fpm.service`, pool `/etc/php/8.3/fpm/pool.d/imreport.conf` | 20 children, 256M memory limit, 12M/20M upload limits, slow log |
| MariaDB 11.4 | `mariadb.service` | database `imreport`; application account plus a dump-only backup account |
| Queue workers | `imreport-queue.service` (`analytics,default`), `imreport-queue-notifications.service` (`notifications,default`) | run as `www-data`, restart on failure |
| Scheduler | `/etc/cron.d/imreport`: `schedule:run` every minute as `imreport` | plus `backup.sh` at 02:00 |
| Application | `/opt/imreport/current` (symlink to `releases/<id>`) | never edit files under it |
| Shared state | `/opt/imreport/shared/backend.env`, `/opt/imreport/shared/storage` | environment file and uploads, logs, framework data |
| Backups | `/var/backups/imreport`, secondary mount (`SECONDARY_BACKUP_DIR`) | 30 days each |
| TLS | `/etc/imreport/tls`, internal CA root `/opt/imreport/ca/rootCA.crt` | renewal script pinned on the server |
| Firewall | UFW rules from `deploy/ufw.sh` | LAN only |
| Log rotation | `/etc/logrotate.d/imreport` | daily, keep 30, compressed |

All of these files are versioned under `deploy/` in the repository
(`/opt/imreport/source/deploy`). Change them there, then install.

## 2. Accounts and permissions

- `imreport`: non-login deployment account in group `www-data`; owns
  `/opt/imreport`, the backups, and runs the cron lines and `deploy.sh`.
  Passwordless sudo only for `/usr/bin/systemctl reload php8.3-fpm`.
- `www-data`: runs PHP-FPM and the queue workers; needs write on
  `shared/storage` and `bootstrap/cache` (setgid 2775 directories).
- MariaDB: the application account with data privileges on `imreport`; a
  dump-only account in `/etc/mysql/imreport-backup.cnf` (`root:imreport`, 640).
- The application's Maintenance account is created with
  `php artisan app:create-superadmin` and is not a system account.

## 3. Routine

| Cadence | Task |
|---|---|
| Daily (automated) | `app:launch-readiness --strict` is run by the deploy and read by the health view; the department checks it. Nightly backup at 02:00 |
| Weekly | glance at `journalctl -u imreport-queue -u imreport-queue-notifications --since -7d` for restarts; `df -h`; `/var/log/imreport-backup.log` |
| Monthly | restore drill ([../10-BACKUP-AND-DISASTER-RECOVERY.md](../10-BACKUP-AND-DISASTER-RECOVERY.md) section 3); OS security updates (unattended for security; reboot in a maintenance window if the kernel changed) |
| Quarterly | certificate expiry check (readiness warns at 21 days); review firewall rules; test the secondary backup mount |
| Every deploy | `deploy.sh --dry-run`, `deploy.sh`, smoke suite ([../15-RELEASE-AND-ROLLBACK.md](../15-RELEASE-AND-ROLLBACK.md)) |

## 4. Services

```bash
systemctl status nginx php8.3-fpm mariadb imreport-queue imreport-queue-notifications cron
sudo systemctl restart php8.3-fpm          # after PHP config changes
sudo systemctl reload nginx                # after vhost or certificate changes
sudo systemctl restart imreport-queue imreport-queue-notifications
journalctl -u imreport-queue -n 100
```

Symptoms: exports stuck pending or no e-mail means a worker; no morning
session or overdue notices means cron; 502 means PHP-FPM; connection refused
means nginx.

## 5. Certificates

The `.internal` hostname uses the hospital's internal CA. Renewal:

```bash
sudo /root/renew-imreport-certificate.sh
sudo nginx -t && sudo systemctl reload nginx
```

Distribute `/opt/imreport/ca/rootCA.crt` to managed devices (MDM or the
manual steps in the Operations manual). A device without the root sees a
browser warning and its service worker does not register. Only use Certbot
with a real DNS domain and DNS-01 validation; public issuance for
`im.hospital.internal` is impossible.

## 6. Network and firewall

- Inbound: 443 (and 80 redirecting to 443) from the hospital LAN only; SSH
  from the administration network. Everything else closed (`deploy/ufw.sh`).
- Outbound: SMTP to the mail relay, the SMS gateway if configured, the
  optional observability webhook, package repositories for updates, and
  `api.pwnedpasswords.com` only if `PASSWORD_BREACH_CHECK=true`.
- No public exposure; the application is LAN-only by design.
- An uptime probe of `https://im.hospital.internal/up` every minute from
  the hospital monitor is the availability signal (target 99.5 percent
  during 07:00 to 19:00).

## 7. Backups and restore

`deploy/backup.sh` (cron 02:00 as `imreport`): consistent dump with the
dump-only account, storage archive, integrity checks, copy to the secondary
location, 30-day rotation. It exits non-zero if the secondary location is
missing, so watch `/var/log/imreport-backup.log`. Restore drills and real
restores: [../10-BACKUP-AND-DISASTER-RECOVERY.md](../10-BACKUP-AND-DISASTER-RECOVERY.md).
Record every drill in `BACKUP_RESTORE_VERIFIED_AT` and re-cache the config.

## 8. Deploying and rolling back

Deploys are run by the department administrator or by you:

```bash
sudo -u imreport /opt/imreport/source/deploy/deploy.sh --dry-run
sudo -u imreport /opt/imreport/source/deploy/deploy.sh
cd /opt/imreport/current/backend && php artisan app:launch-readiness --strict
```

Automatic rollback on a failed post-switch check; manual code rollback is a
symlink swap plus a PHP-FPM reload ([../15-RELEASE-AND-ROLLBACK.md](../15-RELEASE-AND-ROLLBACK.md)
section 5). Database rollback is by restoring the pre-migration dump the
script took. Never run `migrate`, `migrate:rollback` or seeders by hand.

## 9. Environment changes

Edit `/opt/imreport/shared/backend.env`, then:

```bash
cd /opt/imreport/current/backend
php artisan config:cache
sudo systemctl reload php8.3-fpm
sudo systemctl restart imreport-queue imreport-queue-notifications
php artisan app:launch-readiness --strict
```

The full variable list is [../reference/ENVIRONMENT-VARIABLES.md](../reference/ENVIRONMENT-VARIABLES.md);
the production set is in [../08-CONFIGURATION-GUIDE.md](../08-CONFIGURATION-GUIDE.md).
A hostname change also needs a redeploy because the origin is baked into the
bundle.

## 10. Capacity

The committed PHP-FPM pool (20 children) was sized on hardware comparable to
the audited host; p95 worker memory was about 47 MiB and CPU was the binding
constraint. Before raising `pm.max_children`, measure worker RSS, MariaDB
`Threads_connected` and CPU under the standard and spike load profiles
(`docs/LOAD_TESTING.md`, `docs/CAPACITY_TEST_REPORT.md`). Redis is an
optional scale-up (`decisions/redis-optional.md`): if adopted, persistent
connections are mandatory and the load gates must be repeated.

## 11. Escalation

Application defects (a page error, a wrong figure, a refused action that
should be allowed) go to the maintainer with the release SHA from the health
view and the relevant `laravel.log` lines. Host problems (disk, hardware,
network, certificates, OS) stay with Hospital IT. Data restores are done
together with the department administrator and recorded.
