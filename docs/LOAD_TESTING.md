# Load Testing

This repo includes a safe read-heavy load test for the Laravel API. It simulates signed-in users, hits the same hot endpoints used after login, and writes latency/error summaries to `artifacts/load-tests/`.

Each virtual user requires its own account, cookie jar, and authenticated session. The harness never shares credentials or sessions between VUs. Login, CSRF setup, and workspace priming complete before the measurement clock starts.

## Local Smoke Test

Start the backend:

```bash
cd backend
php artisan migrate
php artisan db:seed
php artisan serve
```

Then run from the repo root:

```bash
LOAD_USERS=3 npm run load:test
```

Defaults:

- `LOAD_BASE_URL=http://127.0.0.1:8000`
- `LOAD_USERS=200`
- `LOAD_DURATION_SECONDS=60`
- `LOAD_RAMP_SECONDS=20`
- `LOAD_PROFILE=standard`
- local dev credentials from `DevUserSeeder` (three accounts, so set `LOAD_USERS=3`)

The 200-VU default intentionally requires a credential file containing at least 200 distinct accounts. The authenticated API limiter allows 300 requests/minute per user. The standard audit mix generates roughly 60-90 requests/minute per VU, so one account per VU stays below that limiter and measures application capacity instead of shared-account throttling.

For the Docker audit stack, the retained audit helper seeds 800 isolated accounts and writes the matching CSV:

```bash
docker compose -f docker/audit/docker-compose.yml exec app php /audit/seed-audit-users.php
```

Use `docker/audit/evidence/load-credentials.csv` as `LOAD_CREDENTIALS_FILE`. Only use `LOAD_SYNTHETIC_SOURCE_IPS=1` when the isolated target explicitly trusts the harness proxy headers.

## Staging / Production-Like Test

Use a staging backend with production-like database, cache, queue, and PHP-FPM/web-server settings:

```bash
LOAD_BASE_URL=https://api-staging.example.com \
LOAD_USERS=200 \
LOAD_DURATION_SECONDS=600 \
LOAD_RAMP_SECONDS=60 \
LOAD_CREDENTIALS_FILE=./load-credentials.csv \
LOAD_ALLOW_HIGH_CONCURRENCY=I_UNDERSTAND \
npm run load:test
```

Credential CSV format:

```csv
admin@example.org,StrongPassword
nurse1@example.org,StrongPassword
```

Use real staging accounts with realistic roles. Provide at least as many credentials as `LOAD_USERS`; the harness fails fast rather than sharing a session. Setup/login traffic is deliberately excluded from measured requests. Test login floods separately if needed.

## What It Measures

The standard scenario uses the production-audit mix:

- workspace revision: 45%
- workspace hydration: 15%
- batched report details: 22%
- notifications: 10%
- current session: 8%

Set `LOAD_PROFILE=spike` for the deadline-spike mix:

- workspace revision: 15%
- workspace hydration: 35%
- batched report details: 40%
- notifications: 5%
- current session: 5%

Both profiles use 250-1,200 ms think time by default. Output includes per-endpoint counts, p50/p95/p99/max latency, status codes, error rate, timeouts, attempted RPS, and successful RPS. This matches the result shape retained under `docker/audit/evidence/run-summary.json`.

## Pass Targets For 200 Users

Good initial targets:

- error rate below 1%
- `/api/workspace` p95 below 1,000 ms
- report details p95 below 1,500 ms
- no sustained 5xx responses

Local `php artisan serve` is not production-like. Treat local results as a smoke test only.
