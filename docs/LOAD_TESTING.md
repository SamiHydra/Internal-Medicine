# Load Testing

This repo includes a safe read-heavy load test for the Laravel API. It simulates signed-in users, hits the same hot endpoints used after login, and writes latency/error summaries to `artifacts/load-tests/`.

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
npm run load:test
```

Defaults:

- `LOAD_BASE_URL=http://127.0.0.1:8000`
- `LOAD_USERS=200`
- `LOAD_DURATION_SECONDS=60`
- `LOAD_RAMP_SECONDS=20`
- local dev credentials from `DevUserSeeder`

## Staging / Production-Like Test

Use a staging backend with production-like database, cache, queue, and PHP-FPM/web-server settings:

```bash
LOAD_BASE_URL=https://api-staging.example.com \
LOAD_USERS=200 \
LOAD_DURATION_SECONDS=300 \
LOAD_RAMP_SECONDS=60 \
LOAD_CREDENTIALS_FILE=./load-credentials.csv \
npm run load:test
```

Credential CSV format:

```csv
admin@example.org,StrongPassword
nurse1@example.org,StrongPassword
```

Use real staging accounts with realistic roles. The script logs in once per credential and then shares those authenticated sessions across virtual users, which avoids turning the test into a login-rate-limit test. Test login floods separately if needed.

## What It Measures

The default scenario is read-heavy:

- workspace hydration
- batched report details
- notifications
- current session

Output includes per-endpoint request count, failures, RPS, p50, p95, p99, max latency, and status codes.

## Pass Targets For 200 Users

Good initial targets:

- error rate below 1%
- `/api/workspace` p95 below 1,000 ms
- report details p95 below 1,500 ms
- no sustained 5xx responses

Local `php artisan serve` is not production-like. Treat local results as a smoke test only.
