# 09. Operations manual

Running the department server day to day. Written for the department
administrator with Hospital IT as backup; every command is typed on the
server (`im.hospital.internal`) in a terminal. Nothing here destroys data
unless the step says so. The original one-page handbook is `docs/OPERATIONS.md`;
this manual is the fuller version.

## 1. Daily: is everything healthy?

Two equivalent views.

**On the server:**

```bash
cd /opt/imreport/current/backend
php artisan app:launch-readiness --strict
```

**In the browser:** sign in as Maintenance and open System health
(`/admin/system-health`). It shows the same checks plus live counters.

Everything should say PASS. Each failing line prints its own instruction.
The common ones:

| Failing check | Meaning | Action |
|---|---|---|
| Database backup fresher than 26h | last night's dump did not run | section 5 |
| Storage backup fresher than 26h | the files archive did not run | section 5 |
| Off-box copy fresher than 26h | the secondary location was missing or unwritable | check the mount, rerun `backup.sh` |
| Restore drill within 90 days | no recorded drill | section 5, then set `BACKUP_RESTORE_VERIFIED_AT` |
| Persistent queue worker active | a worker unit stopped | section 3 |
| Scheduler heartbeat fresh | cron stopped running `schedule:run` | section 3, then check `schedule.log` |
| Free disk above threshold | the disk is filling | prune old backups or logs; call Hospital IT to grow the disk |
| HTTPS certificate valid > 21 days | the certificate is expiring | section 6 |
| PHP upload limits cover the 10 MB rule | the pool file was not installed | install `deploy/php-fpm.conf`, reload PHP-FPM |
| Error monitoring channel named | `ERROR_MONITORING_CHANNEL` is blank | name the procedure in `backend.env`, `config:cache` |
| Mail or SMS transport is `log` | deliveries only go to the log | configure the transport when the gateway exists |

## 2. Weekly

- Read the leadership digest (Monday 07:00) and confirm it arrived.
- Open Submissions on Monday after the deadline: overdue wards are marked;
  reminders and escalations went out automatically.
- Glance at `tail -50 /opt/imreport/shared/storage/logs/laravel.log` for
  WARNING or ERROR lines; the health view counts them.
- Confirm `ls -lh /var/backups/imreport | tail` shows a dump and a storage
  archive for each night.

## 3. Services and restarts

Safe at any time; users see a few seconds of delay at most.

```bash
sudo systemctl restart php8.3-fpm                    # the application
sudo systemctl restart nginx                         # the web server
sudo systemctl restart imreport-queue                # analytics and ordinary jobs
sudo systemctl restart imreport-queue-notifications  # e-mail, SMS, digests
sudo systemctl restart cron                          # scheduled jobs
sudo systemctl status imreport-queue imreport-queue-notifications
```

After a restart run the health check. If a service will not start, read its
log (section 4) and call Hospital IT.

**Signs a worker is down:** exports stay "pending", reminders and password
reset e-mails stop, the health view shows queue depth climbing or "oldest job"
in minutes. **Signs cron is down:** the heartbeat check fails, no morning
session opened, no overdue notifications.

## 4. Where the logs are

| Log | Path |
|---|---|
| Application errors and warnings | `/opt/imreport/shared/storage/logs/laravel.log` |
| Scheduled jobs | `/opt/imreport/shared/storage/logs/schedule.log` |
| Analytics and default queue worker | `/var/log/imreport-queue.log` |
| Notification queue worker | `/var/log/imreport-queue-notifications.log` |
| Nightly backups | `/var/log/imreport-backup.log` |
| Web server | `/var/log/nginx/error.log`, `/var/log/nginx/access.log` |
| PHP-FPM slow requests | the slow log named in `/etc/php/8.3/fpm/pool.d/imreport.conf` |

`tail -50 <path>` shows the last 50 lines; `grep -c ERROR <path>` counts
errors. Every application line carries `release=<sha>`, so a problem can be
tied to a deploy. Logs rotate daily and are kept 30 days.

## 5. Backups (summary)

A dump and a storage archive are taken at 02:00 every night, kept 30 days
locally, and copied to the secondary location. A restore drill into a scratch
database is required at least every 90 days. Full procedures, including a real
restore, are in [10-BACKUP-AND-DISASTER-RECOVERY](10-BACKUP-AND-DISASTER-RECOVERY.md).

## 6. Certificate

The `.internal` hostname uses the Hospital IT internal CA. When readiness
warns, run the renewal command pinned on the server, then reload nginx:

```bash
sudo /root/renew-imreport-certificate.sh
sudo systemctl reload nginx
```

To trust the CA on a new device, copy `/opt/imreport/ca/rootCA.crt` to it
(Android: Settings, Security, Install a certificate; iPhone: install the
profile then enable it under Certificate Trust Settings; Windows: install into
Trusted Root Certification Authorities). Certbot applies only if Hospital IT
assigns a real domain with DNS-01 validation.

## 7. Deploying an update

```bash
sudo -u imreport /opt/imreport/source/deploy/deploy.sh
```

The script backs up, migrates in maintenance mode, switches atomically and
rolls back on failure. Afterwards run the health check and the smoke suite.
See [15-RELEASE-AND-ROLLBACK](15-RELEASE-AND-ROLLBACK.md).

## 8. The scheduled jobs

All pinned to hospital time (`Africa/Nairobi`) with a 10-minute overlap lock.

| When | Command | What it does |
|---|---|---|
| every minute | `academic:remind-morning-recorder` | reminds recorders 15 minutes after a still-pending session's start |
| every minute | `queue:monitor-health --json` | logs queue depth and oldest-job age; warns above thresholds |
| every minute | scheduler heartbeat | writes the cache key readiness checks |
| every minute (cron mode only) | `queue:work --stop-when-empty --max-time=50` | fallback worker; a no-op when `QUEUE_WORKER_MODE=daemon` |
| every 30 minutes | `queue:retry-transient` | retries recent transient delivery failures once |
| hourly | `reports:sync-overdue` | creates and reconciles overdue notifications |
| hourly | `reports:send-reminders` | tiered deadline reminders and escalations |
| hourly | `action-items:escalate-overdue` | notifies owners and administrators of overdue action items |
| 00:05 daily | `academic:open-morning-session` | opens the session on configured days |
| 00:10 daily | `academic:generate-teaching-sessions` | creates the day's teaching sessions from schedules |
| 00:15 daily | `academic:apply-section-transfers` | applies approved transfers whose date arrived |
| 01:20 daily | `app:prune-operational-data` | expired sessions, cache, performance samples, exports, configured retention |
| daily | `queue:prune-failed --hours=720`, `queue:prune-batches` | housekeeping |
| 17:00 daily | `academic:remind-reps` | end-of-day nudge to student representatives |
| Sunday 00:05 | `reports:ensure-periods` | keeps 26 past and 52 future weeks in place |
| Sunday 01:00 | `reports:prune-notifications` | read notifications older than 90 days |
| Monday 07:00 | `reports:send-digest` | the leadership digest |
| Friday 10:00 | `academic:check-placements` | alerts when a subgroup has no ward next week |

`php artisan schedule:list` prints the live table; `schedule.log` records
each run.

## 9. Useful commands

```bash
cd /opt/imreport/current/backend
php artisan app:launch-readiness --strict     # health
php artisan queue:monitor-health              # queue depth and age now
php artisan queue:failed                      # failed jobs
php artisan queue:retry <id>                  # retry one failed job (exports and deliveries are safe)
php artisan app:prune-operational-data --dry-run   # what tonight's prune would remove
php artisan reports:sync-overdue              # rebuild overdue notifications now
php artisan reports:ensure-periods            # make sure future weeks exist
php artisan schedule:list                     # the scheduler table
php artisan down / php artisan up             # maintenance mode by hand
```

Never run `migrate`, `migrate:rollback`, `db:seed` or any `Dev*` seeder on
the server by hand; `deploy.sh` owns migrations and reference data.

## 10. Queue health thresholds

`QUEUE_DEPTH_WARNING` (100 waiting jobs) and `QUEUE_OLDEST_WARNING_SECONDS`
(300) trigger a WARNING line every minute until cleared. Do not move analytics
work onto the notification worker as a shortcut; restart the stuck unit
instead. The single-worker fallback layout in `deploy/README.md` is for the
smallest install only.

## 11. When to call Hospital IT

- The server does not power on, or the disk check fails.
- The network is down for the ward wifi.
- A service refuses to start after a restart.
- A certificate renewal fails.
- A real restore is needed (do it together, section 5 of the recovery guide).
- You are asked for a password you do not hold.

Everything else in this manual is designed to be done by the department.
