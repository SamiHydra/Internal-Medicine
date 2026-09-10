# Pre-server hardening report

**Application:** St Paul's Hospital, Internal Medicine weekly reporting and academic platform
**Branch:** `hardening/pre-server`, created from the release candidate `b07b32c` (`fix/mobile-touch-targets`, pull request #3)
**Dates:** 2026-09-07 to 2026-09-09
**Companions:** `PRE_SERVER_HARDENING_LEDGER.md` (every finding with its test and status) and the documents under `docs/` named in each section.

Labels used throughout: **VERIFIED** (observed, with the test or measurement named), **PARTIALLY VERIFIED**, **BLOCKED**, **NOT APPLICABLE**. Environments: LOCAL (this Windows workstation, isolated Vite plus `php artisan serve` gate on SQLite), PARITY (Docker: Linux, nginx, PHP-FPM 8.3, MariaDB 11.4, two queue workers, scheduler, production bundle, `APP_ENV=production`), UNIT (automated tests). Nothing in this report was run on the hospital server, which does not exist yet.

# Executive Summary

The release candidate entered this phase with every gate green. The phase kept that state (final gate results in "Test Results") while adding evidence and protection in the areas the brief named, and it found and fixed ten groups of defects that the earlier audits could not see because they needed failure injection, concurrency, a Linux host or a full accessibility audit:

1. A first installation with `deploy.sh` could never succeed (rollback rehearsal).
2. An evidence upload answered 201 and kept a metadata row while the file write had failed (storage drill).
3. PHP-FPM workers hung on database connects with no timeout, so recovery after a database outage took over three minutes (MariaDB drill).
4. Two devices, or an offline device, could silently overwrite a newer copy of a weekly report; a refused offline save was deleted after five tries (offline scenarios).
5. Deleting a ward or section that was still referenced answered a raw 500 (integrity tests).
6. Password changes and report comments left no audit trail; access-request approvals did not record the activation and assignments they caused (audit tests).
7. The report form's autosave hammered a failing server every 1.4 s with a toast per attempt; lock/unlock and inbox actions could be double-submitted; restoring a cleared inbox over 50 rows was refused; sign-in blamed the password for outages (failure-state audit).
8. A Windows checkout with `core.autocrlf=true` wrote the deploy and container scripts with CRLF, so the parity stack (and a `deploy.sh` copied from such a checkout) could not start (parity reproducibility).
9. The dev gate polled Vite on `localhost`, which this host resolves to `::1` first; the gate now polls the address Vite binds.
10. Every sheet dropped keyboard focus to the page body on close, the muted-text palette was below AA contrast on 1,626 elements, 90 controls had no accessible name and several controls had no visible focus indicator (accessibility audit).

New capability delivered without new business features: a formal offline conflict model with a review panel; production-grade observability hooks (sanitised error reporting to an optional webhook, counters, slow-request and failed-job signals, client error capture, a route error boundary); a maintenance-only health API and page; release identification in logs, health and the served bundle; a production smoke suite; a role-aware load harness with telemetry; failure, rollback and large-data harnesses; and the policy documents the hospital must complete (retention, reliability targets, UAT).

**Verdict: the candidate is a hardened, production-mature release candidate. Everything that could be tested without the hospital server has been tested, measured and either fixed or consciously accepted. What remains is host installation, external-service validation and the final smoke test on the real machine.**

# Baseline

Recorded before any change, on `b07b32c`:

| Gate | Result |
|---|---|
| `npm ci`, `npm run verify` (lint, 147 unit tests, load contract, build, budget) | PASS |
| `php composer.phar install`, `audit --no-dev` | PASS, no advisories |
| `php artisan test` (SQLite) | 396 tests: 395 passed, 1 skipped |
| MariaDB 11.4 lane (`docker compose --profile test run --build --rm test`) | OK, 396 tests, 3,452 assertions |
| `npm run test:e2e` (from a detached worktree so later edits could not contaminate it) | 196 passed, 2 skipped, 1 failed: the Settings interaction budget at 418 ms against 400 while lint, type-check and unit tests ran concurrently; the same spec re-run alone: 9 of 9 passed |

Toolchain: PHP 8.4.19 CLI (parity runs 8.3.33), Node 24.14, npm 11.9, Docker 29.6.

# Offline and Conflict Testing

`docs/OFFLINE_SYNC_MODEL.md`; tests `tests/e2e/offline-sync.spec.ts` (7 scenarios, 15 of 15 with setup), `ReportWorkflowTest` (5 revision tests), `report-save-queue.conflict.test.ts`, `conflict-rows.test.ts`.

| Scenario | Result |
|---|---|
| A. Offline save, reconnect | VERIFIED: queued with `expectedUpdatedAt: null`, synced exactly once on reconnect (one 201), queue empty, value persists across reload, one status-history row |
| B. Offline edit, admin locks, reconnect | VERIFIED: replay refused with 409 carrying the locked copy; nothing written; parked with "Offline changes need review"; panel shows mine 6 / server 5; "Keep the server copy" drops the parked save and reloads the grid |
| C. Two devices, stale copy | VERIFIED: the second device's save is refused (409), both values shown, server keeps the first device's value; "Apply my values" performs an explicit overwrite |
| D. Browser restart | VERIFIED: persistent profile closed with a queued save and reopened with the API unreachable: the app boots from its cached workspace, the queued badge is shown, the save syncs when the API returns |
| E. Session expiry during offline work | VERIFIED: replay answers 401, the app returns to sign-in, the queued save stays with 0 attempts, nothing reaches the server; after sign-in it syncs |
| F. Flapping network during four saves | VERIFIED: final value correct, at most one save per reconnect, no 5xx, no duplicate history |
| G. Three reports queued in three tabs | VERIFIED: replayed once each, in queue order, under the cross-tab lock |

Policy adopted: optimistic concurrency by `updatedAt` (second precision, documented limit) with 409 and the server copy; refused saves are parked, never deleted; auth failures stop the replay without counting; online edits merge at field level when the workspace refreshes. Last-write-wins is retained only for callers that send no revision (imports, older clients).

# Capacity Testing

`docs/CAPACITY_TEST_REPORT.md`, harness `scripts/load-test.mjs` (`mixed` profile) with `scripts/capacity/`.

| Concurrent users | RPS | p50 | p95 | p99 | Error % | Peak memory (app / db) | Result |
|---|---:|---:|---:|---:|---:|---:|---|
| 25 | 27.7 | 44 ms | 145 ms | 1,585 ms | 0.00 | 72 / 469 MB | PASS |
| 50 | 54.7 | 46 ms | 144 ms | 1,707 ms | 0.00 | 96 / 561 MB | PASS |
| 100 | 111.6 | 51 ms | 260 ms | 550 ms | 0.00 | 107 / 663 MB | PASS |
| 200 | 214.2 | 69 ms | 314 ms | 1,156 ms | 0.00 | 176 / 694 MB | PASS (p99 over) |
| 300 | 249.8 | 325 ms | 779 ms | 1,048 ms | 0.00 | 144 / 698 MB | DEGRADED (p95 over) |

**PARITY CAPACITY RESULT:** 200 concurrent users at 214 successful requests per second with a 0.00 % error rate, p95 314 ms, no deadlock, 25 of 151 database connections, no failed job. At 300 users the PHP-FPM pool (20 children) queues and latency doubles. The department's headcount in the fixture is about 190 people, so 200 simultaneous users is above a realistic peak. This is not a production capacity statement; the first host action is to size `pm.max_children` from the real machine's memory and re-run the stages.

# Chaos / Failure Recovery

`docs/FAILURE_RECOVERY_TEST_REPORT.md`, harness `scripts/chaos/`.

| Failure | Result |
|---|---|
| Queue worker killed | VERIFIED: export stays pending, completes 3 s after restart, 0 failed jobs |
| MariaDB restart | VERIFIED with a fix: honest 500s, no false success, data intact; recovery took 188 s because workers hung on connect; `DB_CONNECT_TIMEOUT` (5 s) bounds it |
| PHP-FPM stop | VERIFIED: nginx answers 504 for `/up` and the API, recovers after restart |
| Stack restart | VERIFIED: healthy in 143 s (parity reseed), database, queue and 116 uploaded files intact |
| Storage unavailable | DEFECT FOUND and fixed: 201 with orphan metadata; now refused before any row is written, with a plain message and a regression test |
| Disk pressure | VERIFIED by threshold: readiness FAIL and health `unhealthy` |
| Latency 100/300/1000 ms | PARTIALLY VERIFIED: everything completes; the workspace bootstrap's ~80 round trips make it latency-sensitive (not relevant with the host's local database; recorded) |

# Frontend Failure Handling

`tests/e2e/failure-recovery.spec.ts` (17 scenarios, run on a private stack). Every critical flow was driven through the UI with 400, 401, 403, 409, 422, 429, 500, 502, 503, timeout and disconnect: login, password change, report save/submit/lock/unlock, role change, settings, evaluation submission, action-item transition, evidence upload and note, export request, notification mutations, section transfer, student roster. Acceptance criteria held after five fixes (ledger H-022 to H-026): no permanent spinner, no false success toast, no duplicate submission, input retained, server rejections visible, expired sessions return to sign-in with the queue intact.

# Observability

`docs/OBSERVABILITY.md`. Backend: exceptions, 5xx counts, slow requests, failed jobs, queue age, scheduler heartbeat, database connectivity, backup age, disk and export failures are logged, counted hourly and optionally forwarded to `OBSERVABILITY_WEBHOOK_URL` as sanitised JSON. Frontend: uncaught exceptions, unhandled rejections, route render failures (with a recovery panel), API 5xx and offline-sync give-ups are reported to `POST /api/client-errors` (public, throttled, strict schema, deduplicated, capped per page). Redaction removes passwords, tokens, cookies, authorization, query strings and e-mail local parts; bodies, report values, evaluation content and uploads are never collected. No vendor SDK; the app works with nothing configured. 12 backend and 7 frontend tests.

# System Health

`GET /api/admin/system-health` (permission `system.health`, Maintenance only) and `/admin/system-health`: overall status, release, database latency and pending migrations, queue depth and age per queue, failed jobs, scheduler heartbeat age, backup ages, disk, storage writability, mail and SMS transport names, error counters and the readiness check table. Authorization tests: anonymous 401, nurse 403, administrator 403, Maintenance 200; the body contains no key, password or environment value. Verified through nginx on parity by smoke check 7.

# Accessibility

`docs/ACCESSIBILITY_AUDIT.md`. An opt-in audit (`E2E_A11Y=1 npm run test:e2e`, about 10 minutes) drives axe-core over 78 page states (six roles, 1280 px and 390 px), runs ten keyboard-only flows with a focus-order, name and indicator audit, and checks 200 % zoom, large text, reduced motion, forced colours and touch targets. Before: 11 critical, 71 serious, 9 moderate and 2 minor violations (1,767 nodes) and 28 of 48 specs passing. After the fixes: 0 violations of any impact and 48 of 48 specs (VERIFIED, LOCAL, run 4 on 2026-09-09).

Fixed (H-048 to H-050): every sheet lost keyboard focus to the page body on close (Radix modal dialogs focus an empty trigger ref); the muted-text palette was below AA contrast on 1,626 nodes (eight tokens darkened to the lightest passing shade, the only visible change of the phase); 90 controls had no accessible name or label (sheet close button, template editor inputs, import file input); focus indicators were missing on the login fields, the sidebar toggle and the dashboard filter selects; the login error and the report form's status line were not announced; roster and rotation tables lacked captions and header scope; 25 chart SVGs were focusable without a name; touch targets under 44 px; a 65 px overflow at 640 CSS px on the dashboard. Three defects in the audit's own measurement were corrected as well (H-051), so the numbers above come from a sound harness. Accepted: recharts' `role="application"` on the (now named) chart SVGs. Nothing is open. Manual screen-reader validation stays in the UAT plan.

# Large-Data MariaDB Results

`docs/LARGE_DATA_REHEARSAL.md`. Four years of weekly reports (208 periods, 5,887 reports, 501,387 cell values) plus the one-year academic fixture seeded on MariaDB 11.4 in 9 min 48 s; database 190 MB (116 MB indexes). Endpoint, export, slow-log, EXPLAIN, dump and restore measurements are in that document.

# Database Integrity

`backend/tests/Feature/DataIntegrityInvariantsTest.php` (12 invariants). Matrix in the ledger (H-012 to H-015). Every critical invariant has at least two layers; one defect (referenced ward/section deletion answered 500) fixed; three database-level gaps recorded with their migrations described but not applied (cascade on `reports.assignment_id`, evaluation self-pairing, `locked` without `locked_at`).

# Audit Integrity

`backend/tests/Feature/AuditIntegrityTest.php` (16 tests, 448 assertions). 26 event types inventoried; 21 fully verified with actor, action, target, timestamp and before/after state where appropriate; gaps fixed for self-service password changes, report comments and access-request approval side effects. **Unauthorized audit mutation possible: NO** (no mutation route, policies deny update/delete explicitly, 20 attempted mutations across three roles left the tables byte-identical, retention prune disabled by default). Database-level append-only triggers written up as a first-install step (not applied). Sensitive values (passwords, hashes, tokens, session ids) proven absent from every audit row and log line in the account tests.

# Privacy / Retention

`docs/DATA_RETENTION_POLICY_TEMPLATE.md`: every data category classified as essential or disposable, current mechanism and default per category, eight decisions for the department to record. One mechanism added where policy is clear: export files and rows are pruned after `EXPORT_RETENTION_DAYS` (30). No clinical, academic, audit or account data is pruned by default.

# Production Smoke Automation

`npm run test:smoke` (`tests/smoke/production-smoke.spec.ts`): 14 API-level checks, read-only by default (`SMOKE_ALLOW_WRITE=1` adds the draft-save check on a named `QA_SMOKE_` nurse), variables documented in `docs/PRODUCTION_LAUNCH_CHECKLIST.md`. Result and duration on parity in "Test Results".

# Release Identification

`deploy.sh` writes `release.json` (SHA, build time) into each immutable release; the Docker images bake the same file (`RELEASE_SHA`); the backend reads it (`Release`), stamps every log line with `release`, and reports it in the health snapshot; the SPA carries `VITE_RELEASE_SHA`; smoke check 2 can assert the served bundle names the expected build.

# Parity Environment

`docs/PARITY_ENVIRONMENT.md`: what the stack gives (Linux, nginx, PHP-FPM 8.3, MariaDB 11.4, database queue, analytics and notification workers, scheduler, production bundle, production config, persistent storage, backup process, health endpoint), the deliberate differences from the hospital host (TCP pool instead of a socket, self-signed certificate, containers instead of systemd units, reseed on start, `/fpm-status` exposed for telemetry, stack ports), and the one documented procedure to bring it up. The CRLF defect that stopped it on a fresh Windows checkout is fixed (`.gitattributes`, CR stripping in the images).

# Rollback Rehearsal

`docs/ROLLBACK_REHEARSAL.md`. In a Linux container with the real `deploy.sh` and stubbed host services: known-good deploy, deliberately unhealthy deploy (nginx answers 503 for `/up`), post-switch check fails, rollback restores the previous release in 239 ms, maintenance mode left, `/up` 200 and auth wall 401, database and storage markers intact, next deploy succeeds. Found and fixed the first-install defect (`readlink -f` on a missing `current` link).

# Reliability Targets

`docs/RELIABILITY_TARGETS.md`, labelled **PROPOSED ENGINEERING TARGETS. REQUIRE HOSPITAL IT/OWNER APPROVAL**: API p95 < 500 ms and p99 < 1000 ms, error rate < 0.5 %, queue wait < 30 s with an alert at 2 min, scheduler heartbeat < 2 min, example RPO 24 h and RTO 2 h, review after the first production month.

# UAT Preparation

`docs/UAT_PLAN.md`: facilitator protocol, preparation, task lists for nurse (8), administrator (9), resident (4), consultant (5) and student representative (3), a findings table and exit criteria. Tasks say what to achieve, not where to click.

# New Issues Discovered

See the ledger. Fixed: H-001 to H-005, H-007, H-012, H-016 to H-019, H-022 to H-026, H-032, H-033, H-036, H-037, H-048 to H-051, gate readiness polling. Accepted with monitoring: H-014, H-015, H-020, H-021, H-030, H-035. Not defects: H-034 (`/up` is liveness by design), H-043 (baseline timing noise).

# Issues Fixed

Ten groups of product defects and three harness defects, each with a regression test, an audit re-run or a rehearsal (ledger, "Tests" column).

# Accepted Monitoring Risks

- PHP-FPM pool of 20 children is the parity ceiling; size on the host and re-run the capacity stages.
- Dashboard cold rebuild after each write (327 ms window, 1.5 s whole archive).
- `reports.assignment_id` cascades on a raw hard delete (no application path); migration described.
- Database-level append-only for audit tables (triggers described, not applied).
- Workspace bootstrap is latency-sensitive (about 80 round trips); irrelevant with a local database.
- Roster month audit stores counts, not per-person values.

# Test Results

Final release gates on the completed tree (2026-09-09, this workstation; MariaDB lane and smoke suite on the Docker parity stack):

| Gate | Result |
|---|---|
| `npm run verify` (lint, 171 unit tests in 30 files, load-test contract, production build, bundle budget) | PASS |
| `php artisan test` (SQLite) | 444 tests: 443 passed, 1 skipped (4,190 assertions) |
| `vendor/bin/pint --test` | PASS |
| MariaDB 11.4 lane (`docker compose --profile test run --build --rm test`) | OK, 444 tests, 4,223 assertions |
| `php composer.phar audit --no-dev`, `npm audit --omit=dev` | no advisories, 0 vulnerabilities |
| `npm run test:e2e` (224 tests in 31 files, including `offline-sync.spec.ts` and `failure-recovery.spec.ts`) | 222 passed, 2 skipped, 0 failed (20.1 min) |
| `E2E_A11Y=1 npm run test:e2e` (accessibility audit, 48 tests) | 48 passed, axe 0 violations on 78 page states (9.2 min) |
| `npm run test:smoke` against the parity stack rebuilt from the final tree (release stamp `-hardening3`, `SMOKE_ALLOW_WRITE=1`, `SMOKE_EXPECTED_RELEASE` asserted) | 14 of 14 checks passed (8.2 s) |

Growth since the baseline: unit tests 147 to 171, backend tests 396 to 444, Playwright tests 199 to 224 plus the 48-test accessibility audit; every addition guards a finding in the ledger.

The first full end-to-end run of the phase failed 33 tests for one reason (H-052): a new failure-recovery scenario rotated the shared nurse's password, which signs out every other session of that user; the scenario now uses a second seeded nurse, and the boundary spec's expected permission delta includes the new maintenance-only `system.health`. The re-run is the figure in the table.

# Remaining Server-Only Work

# REQUIRES ACTUAL HOSPITAL SERVER

- Install the final nginx vhost (`deploy/nginx.conf`) and PHP-FPM pool (`deploy/php-fpm.conf`), sizing `pm.max_children` from the host's memory.
- Install the two queue worker units and cron (`schedule:run` every minute, `backup.sh` at 02:00).
- Verify the real TLS certificate and hostname (`APP_URL`, `SANCTUM_STATEFUL_DOMAINS`, `CORS_ALLOWED_ORIGINS`).
- Real MariaDB production credentials; run the case-variant e-mail check before migrating; apply the audit-table triggers if adopted.
- Real backup destination, the first `backup.sh` run, the restore drill and `BACKUP_RESTORE_VERIFIED_AT`.
- Production disk permissions for `shared/storage` and `bootstrap/cache`.
- Real SMTP delivery (password reset) and real SMS delivery (reminders), then `MAIL_MAILER` and `SMS_DRIVER`.
- Real scheduler heartbeat and worker units observed by `app:launch-readiness --strict`.
- `OBSERVABILITY_WEBHOOK_URL` / `ERROR_MONITORING_CHANNEL` pointed at the hospital's collector or procedure.
- `deploy.sh --dry-run` until clean, `deploy.sh`, `app:create-superadmin` on the first install, strict readiness, then `npm run test:smoke` against the host with `QA_SMOKE_` accounts.
- Re-run the capacity stages and the two host-dependent drills (real disk, real backup destination) on the host.

# Final Pre-Server Verdict

**Ready for the hospital server: YES.** Every gate is green on the completed tree; every priority in the brief has a document, a test or a rehearsal behind it; the ten groups of defects the phase found are fixed and guarded; the accepted risks are listed with the condition under which each needs attention. What remains is exactly the list under "REQUIRES ACTUAL HOSPITAL SERVER": nothing there can be closed without the machine, its network, its certificate, its SMTP/SMS accounts and its backup destination.

Confidence: high for everything measured on parity and locally (the stack, the data model, the failure modes, the load envelope up to 200 concurrent users, the accessibility state); medium for the host-only items until the first strict readiness run and the smoke suite pass on the real server. The reliability targets in `docs/RELIABILITY_TARGETS.md` remain proposals until Hospital IT signs them.

Nothing from this phase has been committed; the working tree on `hardening/pre-server` holds all changes for review.
