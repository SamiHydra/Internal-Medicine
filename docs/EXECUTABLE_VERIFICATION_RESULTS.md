# Executable Verification Results

Audit date: 2026-07-12  
Audit specification: `FULL_SYSTEM_AUDIT.md`  
Scope: Follow-on executable verification only. No application code, migration, test, or assertion was changed.

## Outcome

The controlled SQLite verification database migrated and seeded successfully, all 17 targeted integrity queries returned zero violations, all 154 Sanctum-protected API routes returned `401` to anonymous requests, and the production-preview accessibility, security, regression, PWA, and performance-smoke subset passed 31 of 31 Playwright tests.

The complete Playwright run did not pass cleanly: 90 tests passed, 2 failed, and 1 skipped out of 93. One failure was caused by the isolated server using a non-persistent array cache for a cross-request rate-limit test and passed after the server was restarted with the database cache. The remaining failure and skip expose incomplete seeded browser fixtures for the academic evaluation and nurse report workflows. Those workflows remain unverified end to end.

Repeated scheduler execution exposed one new functional risk: `reports:send-digest` queued the same reporting-window digest for one recipient on both consecutive invocations. The command does not demonstrate same-window delivery idempotency.

## Safety and environment classification

| Item | Verification value | Classification |
|---|---|---|
| Host | Windows local developer workstation | Local |
| Original application database | `backend/database/database.sqlite` | User local data, not used for migration or seeding |
| Original database SHA-256 | `F820471216EA4EF671FA95AEF1C87717A7FFB8EE887C1501E19C43365FCC82FC` before and after verification | Unchanged |
| Verification database | `C:\tmp\mesay-audit-e2e-20260712.sqlite` | Explicitly isolated disposable SQLite database |
| Verification application environment | `APP_ENV=local` with explicit database override | Local and isolated |
| Browser target | Local Vite development server, then local Vite production preview | Local and isolated |
| API target | Local Laravel built-in server on `127.0.0.1:8000` using the isolated database | Local and isolated |
| Browser tooling | Repository-installed Playwright 1.60.0 and installed compatible Chromium | Existing tooling only |

The absolute verification database path was checked before `migrate:fresh`. No command targeted the repository's local application database. No stress test, destructive security test, or production service was used. A running unrelated `MySQL84` Windows service was not accessed because the repository did not provide an isolated audit database and credentials.

## Commands executed

Environment overrides in this section refer only to `C:\tmp\mesay-audit-e2e-20260712.sqlite`.

### Environment and database preparation

```powershell
Get-FileHash backend/database/database.sqlite -Algorithm SHA256
php artisan migrate:fresh --seed --force
php artisan academic:verify-migration --sample=50
php artisan schedule:list
php artisan app:launch-check
php artisan app:launch-readiness
```

`migrate:fresh`, the migration verifier, schedule inventory, and launch commands were run from `backend/` with explicit `DB_CONNECTION=sqlite` and `DB_DATABASE=C:\tmp\mesay-audit-e2e-20260712.sqlite`. The disposable database seed produced 49 users, 695 reports, 520 duty assignments, 732 evaluations, 2 student batches, and 161 morning sessions.

### Integrity and route authorization

```powershell
php backend/storage/app/audit-integrity.php
node backend/storage/app/audit-anonymous-routes.mjs
```

The two temporary audit scripts were created only to execute the checks and were removed after execution. The anonymous-route result was also written to `C:\tmp\mesay-anonymous-route-audit.json` while evidence was collected.

### Scheduled commands

Each command below was run twice, serially, against the isolated database:

```powershell
php artisan academic:apply-section-transfers
php artisan academic:generate-teaching-sessions
php artisan academic:open-morning-session
php artisan academic:remind-morning-recorder
php artisan academic:remind-reps
php artisan academic:check-placements
php artisan reports:sync-overdue
php artisan reports:send-reminders
php artisan reports:ensure-periods
php artisan reports:send-digest
php artisan reports:prune-notifications
```

### Browser verification

```powershell
npx playwright test --list
npx playwright test
npx playwright test zz-rate-limiting.spec.ts
npm run preview -- --host 127.0.0.1 --port 5173
npx playwright test accessibility.spec.ts performance.spec.ts security-smoke.spec.ts regression.spec.ts
```

The focused rate-limit rerun used the persistent database cache. The production subset used the already-built Vite `dist` output through `vite preview`.

### Direct PWA checks

Read-only `Invoke-WebRequest` probes were run against:

```text
http://127.0.0.1:5173/manifest.webmanifest
http://127.0.0.1:5173/favicon.svg
http://127.0.0.1:5173/sw.js
http://127.0.0.1:5173/admin/settings
http://127.0.0.1:5173/api/workspace
```

Source checks also confirmed that `src/main.tsx` registers the service worker only in production and that `public/sw.js` excludes `/api` and `/sanctum` requests from caching.

## Database migration and integrity results

### Migration verifier

`academic:verify-migration --sample=50` exited successfully:

| Evaluation type | Legacy rows | Unified rows | Result |
|---|---:|---:|---|
| Consultant MDT | 0 | 344 | Pass |
| Resident ACGME | 0 | 334 | Pass |

This is only a structural verifier result for the seeded unified dataset. Because the isolated seed contains no legacy rows, it does not prove deterministic legacy-to-unified parity on a real migration dataset.

### Integrity query results

All 17 checks returned zero violations:

- Foreign-key violations.
- Monthly duty-assignment overlaps.
- Inverted duty-assignment ranges.
- Rotation gaps or overlaps.
- Evaluations without answers.
- Answers not defined by the pinned form version.
- Evaluation/form key mismatch.
- Impossible evaluation subjects.
- Impossible evaluator-source combinations.
- Duplicate evaluation answers.
- Duplicate morning attendance.
- Duplicate student attendance.
- Duplicate teaching sessions.
- Attendance outside the session roster.
- Duplicate pending transfer requests.
- Due approved transfers not applied.
- Evaluation-form keys without exactly one published version.

These results apply to the synthetic SQLite seed only. They do not replace production-like MariaDB checks or a sanitized real-data integrity audit.

## Scheduler and queue results

| Command | First invocation | Second invocation | Assessment |
|---|---|---|---|
| `academic:apply-section-transfers` | 0 applied | 0 applied | Stable for empty transfer set |
| `academic:generate-teaching-sessions` | 0 created | 0 created | Stable for the audit date |
| `academic:open-morning-session` | Not configured day | Not configured day | Stable for the audit date |
| `academic:remind-morning-recorder` | 0 reminders | 0 reminders | Stable for seeded state |
| `academic:remind-reps` | 0 reminders | 0 reminders | Stable for seeded state |
| `academic:check-placements` | All placed | All placed | Stable |
| `reports:sync-overdue` | 80 items; 160 created | 0 created, updated, or deleted | Idempotent in the serial check |
| `reports:send-reminders` | 10 candidates; 10 reminders; 10 deliveries | 0 created or queued | Idempotent in the serial check |
| `reports:ensure-periods` | 26 created | 0 created | Idempotent in the serial check |
| `reports:send-digest` | 1 recipient queued | 1 recipient queued again | Same-window duplicate risk |
| `reports:prune-notifications` | 0 pruned | 0 pruned | Stable |

The scheduler registration contains 15 events and mostly uses `withoutOverlapping`. The executable serial checks do not prove distributed locking, worker retry behavior, or exactly-once semantics under parallel workers.

## Launch-readiness results

`php artisan app:launch-check` exited with status 1 in the intentionally local environment. It correctly reported 7 failures and 13 warnings, including non-production environment, SQLite instead of MariaDB, non-production cookie/CORS settings, unavailable production domains, mail/SMS gaps, uncached configuration, trusted-proxy configuration, backup freshness, queue-worker heartbeat, scheduler heartbeat, and production URL concerns. Free disk space passed.

`php artisan app:launch-readiness` exited with status 1 because the command is not defined and suggested `app:launch-check`. This confirms IA-013.

## API authentication result

The generated anonymous-request audit exercised all 154 routes carrying `auth:sanctum`:

| Result | Count |
|---|---:|
| Protected routes tested | 154 |
| Returned `401` | 154 |
| Unexpected status | 0 |
| Duration | 33.18 s |

This proves that the protected route set rejects anonymous requests before controller validation or object lookup. It does not prove correct-role success, wrong-role `403`, object-level authorization, request schema correctness, or mutation audit logging for every route.

## Playwright results

### Complete development-server run

| Metric | Result |
|---|---:|
| Discovered | 93 tests in 14 files |
| Passed | 90 |
| Failed | 2 |
| Skipped | 1 |
| Duration | 304.504 s |
| Flaky retries | 0 reported |

Passing coverage included authentication, dashboards, navigation, route permissions, IDOR probes represented by the suite, offline recovery, accessibility scans, security headers, sensitive-file probes, reflected-XSS probes, and session revocation. Password-change session revocation returned `200` for the change and `401` for the revoked session's subsequent `/api/me` request.

The failures and skip were:

1. Academic evaluation submission failed because the configured resident fixture, Dr Rediet Bekele, had no ward or paired duty assignment covering the audit date. The application displayed the expected eligibility denial and no submit button. The academic browser journey is therefore not executable with the current seed.
2. The rate-limit browser test initially failed because `CACHE_STORE=array` does not persist counters across requests served by PHP's built-in server. After restart with `CACHE_STORE=database`, the focused file passed 5 of 5 tests in 18.7 s. This was an audit-environment mismatch, not an application failure.
3. The nurse clinical report-flow test skipped because the seeded nurse had no report assignment. The workflow remains unverified.

### Production-preview subset

```text
31 passed, 0 failed, 0 skipped, 103.294 s wall time
```

The subset passed the repository's accessibility, keyboard, offline-recovery, security-header, cookie, sensitive-file, reflected-XSS, session-revocation, regression, and performance-smoke checks against the production bundle.

Observed production-preview timings were:

| Page | Wall navigation | DOM content loaded | Load | First contentful paint | Transfer |
|---|---:|---:|---:|---:|---:|
| Login | 1,437 ms | 462 ms | 466 ms | 580 ms | 388 kB |
| Admin | 2,411 ms | 491 ms | 493 ms | 1,384 ms | 741 kB |
| Academic | 3,425 ms | 469 ms | 470 ms | 1,364 ms | 631 kB |

Academic analytics calls observed by the smoke test included trend at about 1,114 ms and people at about 1,366 ms. These are local single-user observations, not load-test percentiles. Cache state and database query plans were not isolated, so no production performance conclusion should be drawn from them.

## PWA result

| Check | Result |
|---|---|
| Manifest response | `200`, `application/manifest+json` |
| Manifest identity | `St Paul Hospital Internal Medicine`; short name `St Paul` |
| Scope and start URL | `/` and `/` |
| Display and orientation | `standalone`; `portrait-primary` |
| Icon | `/favicon.svg`, `200`, `image/svg+xml`, `any`, `any maskable` |
| Service worker | `200`, JavaScript, build version stamped |
| API cache exclusion | `/api` and `/sanctum` excluded by source logic |
| Nested SPA fallback | `/admin/settings` returned the SPA root |
| API fallback separation | `/api/workspace` returned `401`, not the SPA shell |
| Registration mode | Production only |

Browser tests prove offline-page recovery for their scripted scenario. Install prompts, service-worker upgrade races, offline mutation replay, multi-user device reuse, and logout cache isolation still require dedicated executable scenarios.

## New or confirmed findings

- Confirmed IA-008 in part: the browser suite is runnable but is disconnected from npm scripts and the requested `tests/e2e` layout. Its current result is 90 passed, 2 failed, and 1 skipped, with one application flow failure and one skip caused by fixture gaps.
- Confirmed IA-013: `app:launch-readiness` is absent.
- New IA-016: `reports:send-digest` does not demonstrate same-window idempotency and queues a recipient again on immediate serial re-execution.
- New IA-017: browser fixtures do not make the resident academic-submit and nurse report-submit journeys executable.
- IA-002, IA-003, and IA-004 remain design findings. Runtime concurrency reproduction is blocked until a dedicated isolated MariaDB database is available.

## Still requiring executable verification

- Backend migrations and the complete backend test suite on an isolated MariaDB 11.4 instance.
- Parallel MariaDB race tests for roster overlap, transfer decision/application, and evaluation-form draft/publish.
- Correct-role, wrong-role, and object-level authorization for every protected route.
- Academic evaluation and nurse report browser journeys with valid assignments.
- Real database queue workers, retries, backoff, failed jobs, SMTP, and SMS behavior.
- Migration parity using controlled legacy and unified records.
- Production or sanitized-real-data integrity checks.
- PWA upgrade, user-switching, logout cache isolation, and offline mutation tests.
- Cross-browser and assistive-technology checks beyond the installed Chromium suite.
- Lighthouse/Web Vitals, API percentile load tests, query plans, resource telemetry, stress, and soak tests.
- Actual Cloudflare or on-premises TLS, CORS, cookie, Nginx, PHP-FPM, cron, systemd, backup, restore, firewall, monitoring, and rollback behavior.

## Cleanup and restoration

After evidence collection, the verification Laravel server and Vite preview were stopped. The disposable SQLite database and temporary anonymous-route JSON were removed after their results were documented. The repository's original local Laravel and Vite development servers were restarted and returned `200` from `/up` and `/`. The original local database SHA-256 still matched `F820471216EA4EF671FA95AEF1C87717A7FFB8EE887C1501E19C43365FCC82FC`.
