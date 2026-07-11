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
cd /opt/imreport/backend
php artisan app:launch-check
```

You get a table of checks. Everything should say `PASS`. Each failing line
includes its own instruction. Common ones:

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
sudo systemctl restart imreport-queue  # emails & notifications
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

**Real restore (ONLY after data loss, and preferably with Hospital IT on the
phone):** the same `gunzip -c ... | mysql imreport` but into the live
database. This OVERWRITES current data with the backup - everything since the
backup was taken is lost.

---

## Certificate (HTTPS)

The certificate renews automatically. If the health check warns it is
expiring, renew by hand:

```
sudo certbot renew
sudo systemctl reload nginx
```

If the department uses the internal-CA setup instead, run the renewal command
pinned on the server (`/root/renew-cert.sh`), then reload nginx as above.

**Add a new device to the internal CA** (only for the internal-CA setup; not
needed with certbot): copy `/opt/imreport/ca/rootCA.crt` to the device, then
- **Android**: Settings → Security → Install a certificate → CA certificate.
- **iPhone/iPad**: AirDrop/email the file, install the profile, then Settings
  → General → About → Certificate Trust Settings → enable it.
- **Windows**: double-click the file → Install Certificate → Local Machine →
  "Trusted Root Certification Authorities".

---

## Deploy an update

When the developer tells you a new version is ready:

```
sudo -u imreport /opt/imreport/deploy/deploy.sh
```

It finishes with a health check. If it prints `HEALTH CHECK FAILED`, nothing
is lost - call the developer before touching anything else.

---

## Where the logs are

| Log | Path |
|---|---|
| Application errors | `/opt/imreport/backend/storage/logs/laravel.log` |
| Scheduled jobs | `/opt/imreport/backend/storage/logs/schedule.log` |
| Queue worker (emails/notifications) | `/var/log/imreport-queue.log` |
| Nightly backups | `/var/log/imreport-backup.log` |
| Web server | `/var/log/nginx/error.log` |

`tail -50 <path>` shows the last 50 lines.

---

## When to call Hospital IT

- The server does not power on, or the disk-space check fails.
- The network is down (nobody on the ward wifi can reach anything).
- You are asked for passwords you do not have.

Everything else in this handbook is designed to be done by the department.
