# Operations handbook

For the department administrator. One page per task, written for a
non-specialist. The server is the machine named `im.hospital.internal` in the
department office. You need: its keyboard/screen or an SSH login from the
admin computer.

Every command below is typed into the server's terminal. Press Enter after
each line. Nothing here can destroy data unless a step says so explicitly.

---

## Is everything healthy? (run this first, always)

```
cd /opt/imreport/current/backend
php artisan app:launch-readiness --strict
```

You get a table of checks. Everything should say `PASS`. Each failing line
includes its own instruction. Common ones:

Production keeps application/storage timestamps in UTC (`APP_TIMEZONE=UTC`)
and uses `HOSPITAL_TIMEZONE=Africa/Nairobi` for hospital calendar dates and
wall-clock jobs such as the 08:15 and 17:00 reminders. Keep both settings as shown; changing
the application timezone can reinterpret existing clinical timestamps.

| Failing check | What it means | What to do |
|---|---|---|
| Database backup fresher than 26h | Last night's backup did not run | See "Backups" below |
| Persistent queue worker active | Emails/notifications are queuing up | See "Restart services" |
| Scheduler heartbeat fresh | Scheduled jobs stopped running | See "Restart services" |
| Free disk above threshold | The disk is filling up | Call Hospital IT |
| HTTPS certificate valid > 21 days | The certificate is about to expire | See "Certificate" |

---

## Restart services

Safe at any time; users see at most a few seconds of delay.

```
sudo systemctl restart php8.3-fpm      # the application
sudo systemctl restart nginx           # the web server
sudo systemctl restart imreport-queue  # analytics and ordinary jobs
sudo systemctl restart imreport-queue-notifications # email/SMS/digests
sudo systemctl restart cron            # scheduled jobs
```

Then run the health check above. If a service will not start, call Hospital IT.

---

## Backups

A backup of the whole database is taken automatically every night at 02:00,
kept for 30 days in `/var/backups/imreport`, and copied to the second disk.

**Check backups exist:**

```
ls -lh /var/backups/imreport | tail
```

You should see a file from last night (named like `imreport-20260915-020001.sql.gz`).

**Monthly restore drill (do this once a month, ~10 minutes):** restore last
night's backup into a scratch database and confirm it loads. This proves the
backups are real.

```
mysql -e "DROP DATABASE IF EXISTS imreport_drill; CREATE DATABASE imreport_drill;"
gunzip -c /var/backups/imreport/$(ls -t /var/backups/imreport | head -1) | mysql imreport_drill
mysql -e "SELECT COUNT(*) AS reports FROM imreport_drill.reports;"
mysql -e "DROP DATABASE imreport_drill;"
```

If the count looks like the number of reports you expect, the backup is good.
Record that successful drill in `/opt/imreport/shared/backend.env` by setting
`BACKUP_RESTORE_VERIFIED_AT` to the current ISO-8601 time (for example,
`2026-07-17T12:00:00+03:00`), then run `php artisan config:cache`. Strict
readiness deliberately fails after 90 days without another successful drill.

**Real restore (ONLY after data loss, and preferably with Hospital IT on the
phone):** the same `gunzip -c ... | mysql imreport` but into the live
database. This OVERWRITES current data with the backup - everything since the
backup was taken is lost.

---

## Certificate (HTTPS)

The default `.internal` hostname uses the Hospital IT internal CA. Its renewal
job writes the certificate and key under `/etc/imreport/tls`. If readiness
warns that it is expiring, run the internal renewal command pinned on the
server, then reload Nginx:

```
sudo /root/renew-imreport-certificate.sh
sudo systemctl reload nginx
```

Only use Certbot when Hospital IT has assigned a real DNS domain and configured
DNS-01 validation. Public certificate authorities do not issue certificates
for `im.hospital.internal`.

**Add a new device to the internal CA:** copy `/opt/imreport/ca/rootCA.crt` to
the device, then
- **Android**: Settings → Security → Install a certificate → CA certificate.
- **iPhone/iPad**: AirDrop/email the file, install the profile, then Settings
  → General → About → Certificate Trust Settings → enable it.
- **Windows**: double-click the file → Install Certificate → Local Machine →
  "Trusted Root Certification Authorities".

---

## Deploy an update

When the developer tells you a new version is ready:

```
sudo -u imreport /opt/imreport/source/deploy/deploy.sh
```

It builds a new release, verifies a pre-migration backup, and switches the
active release atomically. If a post-switch check fails, it restores the
previous code release and prints the database recovery warning.

---

## Where the logs are

| Log | Path |
|---|---|
| Application errors | `/opt/imreport/shared/storage/logs/laravel.log` |
| Scheduled jobs | `/opt/imreport/shared/storage/logs/schedule.log` |
| Analytics/default queue worker | `/var/log/imreport-queue.log` |
| Notification queue worker | `/var/log/imreport-queue-notifications.log` |
| Nightly backups | `/var/log/imreport-backup.log` |
| Web server | `/var/log/nginx/error.log` |

`tail -50 <path>` shows the last 50 lines.

Set `ERROR_MONITORING_CHANNEL` in `backend.env` to the real operational path
that watches these errors, such as a Sentry project name or a named daily
Hospital IT log-review procedure. Leaving it blank makes strict readiness fail.

The scheduler runs `php artisan queue:monitor-health --json` every minute.
Warnings mean a named queue exceeded `QUEUE_DEPTH_WARNING` or a database-backed
job waited longer than `QUEUE_OLDEST_WARNING_SECONDS`. Check both worker units
and their logs; do not move analytics work onto the notification worker as a
shortcut.

---

## When to call Hospital IT

- The server does not power on, or the disk-space check fails.
- The network is down (nobody on the ward wifi can reach anything).
- You are asked for passwords you do not have.

Everything else in this handbook is designed to be done by the department.
