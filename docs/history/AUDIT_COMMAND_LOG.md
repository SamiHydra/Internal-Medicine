# AUDIT COMMAND LOG

Chronological record of significant commands run during the audit, with outcomes.

**No secrets in this file.** Never record passwords, tokens, API keys, session cookies, or CSRF values here.
Where a command requires a credential, write `<redacted>` and note where the real value is kept.

**Plan:** `FULL_SYSTEM_AUDIT_PLAN.md` · **Progress:** `AUDIT_PROGRESS.md` · **Findings:** `AUDIT_FINDINGS.md`

---

## Reference commands for this project

| Purpose | Command | Working dir |
|---|---|---|
| Start backend | `php backend/artisan serve --host=127.0.0.1 --port=8000` | repo root |
| Start frontend | `npm run dev` | repo root |
| Proxy health probe | `Invoke-WebRequest http://localhost:5173/sanctum/csrf-cookie` (expect 204) | any |
| Backend test suite | `php artisan test` | `backend/` |
| Backend lint | `vendor/bin/pint --test` | `backend/` |
| Frontend typecheck | `npx tsc -b --force` | repo root |
| Frontend lint | `npm run lint` | repo root |
| Frontend unit tests | `npm run test:run` | repo root |
| Frontend build | `npm run build` | repo root |
| Forward migrations | `php artisan migrate` | `backend/` |
| Rebuild + reseed dev DB (DESTRUCTIVE to dev DB) | `php artisan migrate:fresh --seed` | `backend/` |
| Read-only DB query | `php artisan tinker --execute="..."` | `backend/` |

Note: there is **no** `/api/health` route. Probe `/sanctum/csrf-cookie` (204) for liveness.

---

## LOG

### 2026-07-21 - Audit preparation (CHECKPOINT 0)

| # | Command | Purpose | Result |
|---|---|---|---|
| 1 | _(none - file creation only)_ | Created the four persistence files via the editor, not the shell | 4 files created in repo root |

**Notes**
- No application commands have been run under the audit yet. Environment verification is the next step.
- Two dev servers were already running in this session before the audit began (backend :8000, frontend :5173);
  both were confirmed reachable earlier via the `/sanctum/csrf-cookie` probe returning 204. This will be
  re-confirmed under the audit and logged here properly before any test is credited.

### 2026-07-21 - Environment verification (CHECKPOINT 1)

| # | Command | Purpose | Result |
|---|---|---|---|
| 2 | `Get-NetTCPConnection -State Listen -LocalPort 5173,8000` | Confirm dev servers listening | Both listening (started earlier this session) |
| 3 | `Invoke-WebRequest http://localhost:5173/sanctum/csrf-cookie` | Sanctum handshake through the Vite proxy | **204** - proxy and backend both healthy |
| 4 | `node -e "...package.json scripts + @playwright/test dep..."` | Confirm Playwright present | `@playwright/test ^1.60.0` present; `test:e2e` script = `node scripts/run-e2e.mjs` |
| 5 | `ls $LOCALAPPDATA/ms-playwright` | Confirm which browser binaries are cached | chromium-1217/1223/1228, chromium_headless_shell, **webkit-2327**, ffmpeg-1011, winldd. **No firefox.** |
| 6 | `find tests -type f` | Inventory existing e2e harness | 22 files: 15 specs + `fixtures/auth.setup.ts` + `helpers/{accounts,api,auth,diagnostics}.ts` + `pages/login-page.ts` + README + TEST_DATA_NOTES |
| 7 | `ls scripts/` | Inventory existing tooling | `run-e2e.mjs`, `start-e2e-backend.mjs`, `load-test.mjs`, `analytics-probe.mjs`, `walkthrough.mjs`, `page-shot.mjs`, `dashboard-shot.mjs` |

### 2026-07-21 - GAP-1 Firefox install attempts (unresolved)

| # | Command | Result |
|---|---|---|
| 8 | `npx playwright install firefox` (background) | **FAILED** - process killed by session restart at 0% of 116 MiB |
| 9 | `npx playwright install firefox 2>&1 \| tail -5` (background) | **FAILED** - `Download failure, code=1`. NOTE: the shell reported exit 0 because the pipe returned *tail's* status. Masked failure - do not pipe a command whose exit code matters. |
| 10 | `DEBUG=pw:install npx playwright install firefox` (foreground) | **KILLED** at the 2-minute tool timeout, mid-download. This is what left the lockfile behind. |
| 11 | `npx playwright install firefox` (background, unpiped) | **FAILED** - `An active lockfile is found at %LOCALAPPDATA%\ms-playwright\__dirlock` |
| 12 | Lock triage: `Get-Process node` filter + 3x `LastWriteTime` samples 6s apart | Lock mtime advances ~5s per sample -> **live heartbeat, holder still active**. Lock NOT removed; removing an in-use lock would corrupt a concurrent install. |

**Status:** `GAP-1` remains **OPEN**. Firefox binaries absent. Chromium + WebKit available and sufficient
to begin. Retry once concurrent background jobs have finished and the lock is released.

**Process lesson recorded:** command #9 reported success while actually failing. Any audit command whose
exit status is load-bearing must be run unpiped, or the pipeline status must be read explicitly
(`${PIPESTATUS[0]}`). A masked exit code in an audit is how a red run gets reported green.

**Outcome**
- Environment is READY. Playwright is installed with a working harness already in place; the audit will
  EXTEND it rather than rebuild it.
- **Gap identified:** Firefox binaries are absent. Chromium and WebKit can run immediately.
  Firefox requires `npx playwright install firefox` before it can be credited. Logged as an
  environment gap, not a defect.
- No destructive command has been run. The dev database has not been modified.

### 2026-07-21 - Docker prod-parity stack (MariaDB + nginx + PHP-FPM)

Purpose: build the lane that can measure what SQLite physically cannot (write concurrency, real query
plans, connection limits, TLS headers, `Secure` cookie flags), and make
`MariaDbConcurrencyRegressionTest` actually execute instead of skipping.

**No secrets in this file.** The stack's env file `.env.docker` contains only throwaway local
placeholders for a disposable container database; its `APP_KEY` / `DB_PASSWORD` are deliberate
non-secrets and are still not reproduced here. Real values, if any ever exist, live only in
`deploy/`-managed `shared/backend.env` on the server.

Ports: nginx **8080** (HTTP, 301) and **8443** (HTTPS), MariaDB **33306** - all bound to `127.0.0.1`.
Dev servers on `:5173` / `:8000` were left running and untouched; `backend/.env` was never modified.

| # | Command | Purpose | Result |
|---|---|---|---|
| 13 | `docker compose build` | Build app / web / frontend images | **exit 0** (read via `${PIPESTATUS[0]}`, not the pipe's status) |
| 14 | `docker compose up -d --wait` | First start | **exit 1 - app unhealthy.** `migrate` failed |
| 15 | `docker compose logs app` | Diagnose | `SQLSTATE[42000]: 1059 Identifier name 'teaching_sessions_batch_id_subgroup_activity_type_scheduled_date_unique' is too long` (71 chars vs MariaDB's 64) |
| 16 | migration-wide scan for auto-generated index names > 64 chars | Blast radius | Exactly **1** occurrence repo-wide |
| 17 | `docker compose down -v` + rebuild with `docker/patches/apply-parity-patches.sh` | Apply the fix **inside the image only** (repo source untouched, per brief) | Patch applied: index renamed to `teaching_sessions_slot_unique` |
| 18 | `docker compose up -d --wait --wait-timeout 420` | Restart | **exit 0**, all 5 services healthy/running |
| 19 | `docker compose ps` | Health | db healthy, app healthy, web healthy, queue up, scheduler up |
| 20 | `docker compose logs app \| grep DONE` | Confirm bootstrap | 61 migrations DONE, all 10 seeders DONE |
| 21 | `mariadb ... -e "SELECT COUNT(*) ..."` (read-only) | Confirm seed volume | roles **6**, users **50**, migrations **61**, reports **695**, report_field_values **61001**, evaluations **758** |
| 22 | `php artisan tinker --execute="echo app()->environment()..."` | Confirm prod shape | `production debug=false driver=mariadb` |
| 23 | `curl -sSI http://localhost:8080/dashboard` | HTTP vhost | **301** -> `https://localhost:8443/dashboard` |
| 24 | `curl -sSkI https://localhost:8443/` | SPA served by nginx | **200**, hashed `/assets/index-*.js` (built bundle, not Vite) |
| 25 | `curl -sSk -o /dev/null -w '%{http_code}' .../sanctum/csrf-cookie` | Liveness | **204** |
| 26 | `curl ... /api/workspace` (no session) | Auth wall | **401** |
| 27 | login handshake: csrf-cookie -> `POST /api/auth/login` -> `GET /api/auth/me` | End-to-end containerised login | **200 / 200 / 200.** Account from `DevUserSeeder` (password `<redacted - see backend/database/seeders/DevUserSeeder.php>`). Seeder is production-gated, so the entrypoint runs the **seed step only** under `APP_ENV=local`; the app itself stays `APP_ENV=production` |
| 28 | `curl -sSk -D -` on `/`, `/assets/*.js`, `/sanctum/csrf-cookie`, `/api/workspace` | Capture real headers | Cookies `secure; httponly; samesite=lax` confirmed. HSTS + CSP present on **API only**, absent from the SPA document. `Referrer-Policy` duplicated with conflicting values; `Cache-Control` duplicated on assets |
| 29 | `docker compose --profile test run --rm test --filter MariaDbConcurrencyRegressionTest` | **The headline check** | First attempt exit 64 - base image's `docker-php-entrypoint` swallowed the args; fixed by making the wrapper an `ENTRYPOINT`. Then: **the test RUNS - it no longer skips.** 14 assertions, all three concurrency scenarios pass |
| 30 | `docker compose --profile test run --rm test` (unpiped, full capture) | Whole suite on MariaDB | **`Tests: 281, Assertions: 1874, Errors: 3, Failures: 7`, 0 skipped.** Reproduced twice, identical |

**Outcome**

- The parity stack is **up and verified end to end**: build, health, migrate, seed, HTTPS, SPA, Sanctum
  handshake, authenticated API, queue and scheduler workers.
- **`MariaDbConcurrencyRegressionTest` now executes.** On the SQLite lane the suite is
  `281 tests, 280 passed, 1 skipped`; here it is `281 tests, 0 skipped`. The locking behaviour it guards
  **passes** - it errors only in its own `finally` teardown (see below).

**Findings raised by this lane (all invisible on SQLite)**

1. **BLOCKER - the app cannot migrate onto MariaDB.** A 71-character auto-generated unique-index name in
   `2026_08_12_000010_create_undergraduate_tables.php` exceeds MariaDB's 64-char identifier limit.
   `deploy/deploy.sh` runs `php artisan migrate --force`, so **the department server cannot be deployed
   to**, and the `backend-mariadb` CI job cannot be green. One-line fix (explicit short index name).
   Also note MariaDB has no transactional DDL, so the half-applied migration then masks itself behind
   `1050 Table already exists` on retry.
2. **HIGH - saving a duty roster month 500s on MariaDB.** `DutyRosterController.php:198-202` writes
   `sprintf('%04d-%02d', ...)` (e.g. `'2026-07'`) into `admin_audit_logs.entity_id`, which is a native
   `uuid` column. `SQLSTATE[22007]: 1292 Incorrect uuid value`. Accounts for 7 of the 10 suite failures.
3. **HIGH - the `backend-mariadb` CI job cannot install dependencies.** `ci.yml` pins PHP 8.3 but
   `composer.lock` locks 17 packages requiring `php >=8.4.1`. This stack runs PHP 8.4 as a result.
4. **MEDIUM - no CSP or HSTS on the SPA document.** Both are set by Laravel middleware and therefore
   appear only on `/api` and `/sanctum` responses; `/` and `/assets/*` are served by nginx and get
   neither.
5. **LOW - duplicated/conflicting headers** inherited from `deploy/nginx.conf`: `Referrer-Policy` sent
   twice with different values, `Cache-Control` sent twice on hashed assets.
6. **LOW - `MariaDbConcurrencyRegressionTest` teardown is broken**, only discoverable now that it runs:
   `removeCommittedFixtures()` deletes users while `admin_audit_logs` rows still reference them (FK 1451).

**Process note:** every command whose exit status mattered was run unpiped or read via `${PIPESTATUS[0]}`,
per the lesson recorded at command #9. Two masked-failure traps were caught this way (#13 and #29).
