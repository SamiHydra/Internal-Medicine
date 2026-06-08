# Production Launch Checklist

Use this before any real users enter weekly reports. The app is built to run on a
small Laravel host with database-backed cache, queue, session, and scheduler.

## Realtime And Polling

- On shared hosting, set `BROADCAST_CONNECTION=log` in `backend/.env`.
- Leave `VITE_REVERB_APP_KEY` unset in the frontend build environment unless a
  Reverb daemon is actually running.
- Verify two signed-in browser sessions: submit or edit a report in one session
  and confirm the other session updates through the 20-second polling refresh.
- There should be no WebSocket connection errors in the browser console.

## Secure Production Environment

- Generate a fresh production key on the host with `php artisan key:generate`.
- Set `APP_ENV=production` and `APP_DEBUG=false`.
- Set `SESSION_SECURE_COOKIE=true` and `SESSION_ENCRYPT=true`.
- Set `SANCTUM_STATEFUL_DOMAINS` to the production browser hostnames.
- Set `CORS_ALLOWED_ORIGINS` to the exact production HTTPS origin(s).
- Verify the Laravel session cookie is `Secure`, `HttpOnly`, and `SameSite=Lax`.

## Same-Site SPA/API Topology

- Prefer serving the SPA and API from the same site, with API requests resolving
  under `/api` and Sanctum under `/sanctum`.
- If the SPA and API are on separate subdomains, keep them under the same parent
  domain and configure `SESSION_DOMAIN`, `SANCTUM_STATEFUL_DOMAINS`, and CORS
  together.
- Set `VITE_API_BASE_URL` to the production origin the browser should use.
- Verify login succeeds without CORS or 419 CSRF errors.

## Database And Runtime

- Use MariaDB/MySQL in production, not SQLite.
- Run `php artisan migrate --force` and `php artisan db:seed` during setup.
- Install dependencies with `composer install --optimize-autoloader --no-dev`.
- After each deploy, run:
  - `php artisan config:cache`
  - `php artisan route:cache`
  - `php artisan event:cache`
- Confirm OPcache is enabled in the host PHP settings.

## Scheduler

Add one host cron entry:

```cron
* * * * * cd /path/to/backend && php artisan schedule:run >> storage/logs/schedule.log 2>&1
```

The app scheduler currently runs:

- `reports:sync-overdue` hourly
- `reports:send-reminders` hourly
- `reports:ensure-periods` Sundays at 00:05
- `queue:work --stop-when-empty --max-time=50` every minute

Verify by checking `storage/logs/schedule.log` and by testing that overdue report
notifications update without someone visiting the SPA.

## Email, SMS, And Queue Delivery

- Configure SMTP or a transactional mailer through `MAIL_*`.
- Configure SMS through `SMS_DRIVER`; use `log` locally and `http` with
  `SMS_HTTP_ENDPOINT`/`SMS_HTTP_TOKEN` for the production gateway.
- Keep `QUEUE_CONNECTION=database` on shared hosting.
- Verify a queued delivery sends both an email and SMS to a test user with a
  populated `email` and `phone`.

## Backups

- Run a daily `mysqldump` cron job to a folder outside the web root.
- Compress dumps and rotate them, keeping about 30 days.
- Restore a dump into a scratch database before launch. An untested backup does
  not count.

## Error Visibility

- Prefer Sentry for Laravel, or establish a scheduled production log-review
  habit before launch.
- With `APP_DEBUG=false`, verify a deliberate test exception is captured or
  visible through the chosen review process.
