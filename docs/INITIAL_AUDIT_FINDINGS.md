# Initial Audit Findings

Audit date: 2026-07-12  
Stage: Initial inspection plus follow-on executable verification

## Initial readiness assessment

The application has broad clinical and academic functionality, a substantial Laravel feature-test suite, passing frontend unit tests, server-side permission middleware, object-level policies, database indexes, PWA assets, CI for SQLite and MariaDB, and on-premises deployment definitions. The existing automated baseline passes.

The platform is not ready to receive a final go-live rating. High-risk dependency findings and concurrency-sensitive write paths require remediation or executable proof. Browser smoke, isolated SQLite integrity, serial scheduler behavior, anonymous route denial, local production-preview security, accessibility, performance smoke, and PWA configuration now have executable evidence. Production-like MariaDB, queue failure handling, deployment, performance percentiles, and scalability verification remain outstanding.

## Implemented functional surface

Code and route inspection confirms implementations for:

- Sanctum cookie authentication, password reset/change, inactive-user gating, and forced password change.
- Clinical report assignment, draft/save/submit/lock/unlock, comments, import/export, reminders, action items, notifications, audit logs, and analytics.
- Academic wards, sections, duty types, roster assignments, rotation calendars, rotation planning, and workspace bootstrap.
- Consultant transfer request, review, scheduling, application, notifications, and audit calls.
- Unified versioned evaluation forms, user evaluations, external evaluations, student evaluations, historical form references, and content-stamp analytics caching.
- Undergraduate batches, students, placement snapshots, representatives, teaching-session generation, representative logging, attendance, and analytics.
- Morning-session generation, roster calculation, overrides, recording, cancellation by administrators, reminder scheduling, and analytics.
- PWA manifest, service worker, offline shell behavior, Cloudflare Pages configuration, Nginx/systemd/backup/firewall deployment files, and GitHub Actions CI.

Implementation presence is not equivalent to verified correctness. The detailed status is in `TEST_COVERAGE_MATRIX.md`.

## Findings

### IA-001: High-severity npm dependency advisories

| Field | Value |
|---|---|
| Severity | High |
| Confidence | High |
| Module | Frontend dependency chain |
| Verification | Executed `npm audit` |
| Actual result | 10 vulnerabilities: 6 high, 3 moderate, 1 low |
| Evidence | `package-lock.json`; `BASELINE_TEST_RESULTS.md` |

High advisories affect React Router, Vite, Undici, and `ws`. Some Vite findings apply to development-server exposure rather than the production static bundle, but React Router is a browser runtime dependency. Applicability and safe upgrade impact must be assessed before remediation. No audit fix was run.

### IA-002: Monthly assignment overlap check is race-prone

| Field | Value |
|---|---|
| Severity | High |
| Confidence | High for design gap; runtime reproduction pending |
| Module | Academic roster |
| Requirement | Overlap check and insert must use a transaction and appropriate locking |
| Evidence | `backend/app/Services/Academic/RosterService.php:191`; `backend/app/Services/Academic/RosterService.php:331`; duty-assignment migration |

`createAssignment()` wraps the overlap query and insert in a transaction, but `assertNoMonthlyOverlap()` uses an unlocked `exists()` query. The table has range indexes but no constraint capable of excluding overlapping date ranges. Two concurrent transactions can both observe no overlap and insert conflicting monthly assignments.

Impact can include invalid pairing, incorrect evaluation eligibility, wrong morning rosters, and conflicting planner data. A parallel MariaDB regression test is required before and after a fix.

### IA-003: Transfer decisions and side effects are not concurrency-safe or atomic

| Field | Value |
|---|---|
| Severity | High |
| Confidence | High for design gap; runtime reproduction pending |
| Module | Section transfers |
| Requirement | Only one decision, application exactly once, audit plus mutation atomicity |
| Evidence | `backend/app/Services/Academic/TransferService.php:82`; `:129`; `:168`; `:235` |

The controller policy checks pending status before service execution. Approval then updates the passed model in a transaction without reloading or locking the transfer row. Rejection is not transaction-wrapped. Two actors can authorize the same pending object before either commits and then issue conflicting updates. Audit records and notifications occur outside the decision transaction.

`apply()` locks the consultant but not the transfer request and does not re-check `applied_at` inside the transaction. Concurrent scheduler/manual application can repeat audit and notification side effects even when the consultant update converges.

### IA-004: Evaluation form draft and publish races are not protected

| Field | Value |
|---|---|
| Severity | High |
| Confidence | High for design gap; runtime reproduction pending |
| Module | Evaluation form versioning |
| Requirement | Version-number and concurrent-publish safety |
| Evidence | `backend/app/Services/Academic/EvaluationFormService.php:112`; `:124`; `:146` |

Draft versioning computes `max(version) + 1` without a lock. Publishing archives current published rows and promotes the draft without a per-key lock. The database uniquely constrains `(key, version)` but does not enforce one published row per key. Concurrent draft or publish requests can fail with uniqueness errors or produce an invalid publication state.

### IA-005: Unified evaluation invariants are absent at database level

| Field | Value |
|---|---|
| Severity | Medium |
| Confidence | High |
| Module | Unified evaluations |
| Requirement | Exactly one subject and one evaluator source, enforced at service and database levels where practical |
| Evidence | `backend/database/migrations/2026_08_05_000020_create_evaluations_tables.php` |

The migration documents the invariants as service-level rules but defines no database `CHECK` constraints for subject or evaluator exclusivity. Direct SQL, a future write path, or a defect can create impossible evaluation headers. The evaluation-answer uniqueness constraint is present.

### IA-006: Scheduled business times inherit UTC

| Field | Value |
|---|---|
| Severity | Medium |
| Confidence | High for configuration; business intent confirmation pending |
| Module | Scheduler |
| Requirement | Correct schedule and timezone |
| Evidence | `php artisan about`; `backend/config/app.php:68`; `backend/routes/console.php` |

Laravel reports UTC and `config/app.php` hard-codes UTC. Schedules such as the 08:15 morning-recorder reminder and 17:00 representative reminder do not specify a timezone. If these values are intended as local hospital time, they will run three hours late in East Africa. Production configuration cannot override the hard-coded timezone through an environment variable.

### IA-007: Deployment can leave a partial release and ignores readiness failure

| Field | Value |
|---|---|
| Severity | High |
| Confidence | High for script behavior; production use not verified |
| Module | Deployment |
| Requirement | Backup before migration, rollback, failure handling, readiness enforcement |
| Evidence | `deploy/deploy.sh` |

The script pulls in place, installs backend dependencies, migrates the database, and only then builds the frontend. A later npm/build/rsync/health failure can leave migrated backend code and an older SPA without an automated rollback. It does not call the backup script before migration. `php artisan app:launch-check || true` explicitly ignores readiness failures. There is no release-directory or atomic symlink strategy and no concurrent-deployment lock.

### IA-008: Browser suite is disconnected from the requested test architecture

| Field | Value |
|---|---|
| Severity | Medium |
| Confidence | High |
| Module | End-to-end testing |
| Requirement | `tests/e2e`, fixtures, pages, helpers, artifacts, and configured execution |
| Evidence | `playwright.config.ts`; `artifacts/pre-deployment-qa/PLAYWRIGHT_TESTS`; `package.json` |

Playwright 1.60.0 and 14 discovered spec files exist, but the suite is under an artifact directory rather than `tests/e2e`, and no npm script runs it. The complete run produced 90 passed, 2 failed, and 1 skipped. A focused rate-limit rerun passed after correcting the audit cache driver. The remaining academic failure and nurse skip show that the seeded role fixtures do not make those core submission journeys executable. The production-preview accessibility, performance, security-smoke, and regression subset passed 31 of 31 tests.

### IA-009: PHP dependency advisory status is unknown

| Field | Value |
|---|---|
| Severity | Medium |
| Confidence | High |
| Module | Backend dependencies |
| Verification | `composer audit` attempted |
| Actual result | Composer executable not found |

Laravel can report Composer metadata, but the shell has no Composer executable or adjacent `composer.phar`. Locked package versions were inventoried; security advisories were not queried.

### IA-010: Pint formatting baseline fails

| Field | Value |
|---|---|
| Severity | Low |
| Confidence | High |
| Module | Maintainability |
| Verification | `php vendor/bin/pint --test` |
| Actual result | 38 files require formatting |

No formatting changes were applied. This is pre-existing technical debt, not a functional regression.

### IA-011: Required delete/deactivate behavior is incomplete for undergraduate records

| Field | Value |
|---|---|
| Severity | Medium |
| Confidence | High for route absence |
| Module | Undergraduate administration |
| Requirement | Student-batch and student lifecycle, including referenced-record behavior |
| Evidence | `backend/routes/api.php`; `UndergraduateAdminController.php` |

Student batches and students have create and update routes but no delete routes. Active-state updates may cover deactivation, but foreign-key delete behavior cannot be exercised through the API. The audit requirement for batch/student delete behavior is therefore not implemented as an API workflow.

### IA-012: Recorder cancellation workflow is not exposed

| Field | Value |
|---|---|
| Severity | Medium |
| Confidence | High for route absence |
| Module | Morning sessions |
| Requirement | Recorder cancellation rules plus admin cancellation |
| Evidence | `backend/routes/api.php`; `MorningSessionController.php` |

Recording is available to the designated recorder, but morning cancellation exists only under the admin route with `academic.manage`. There is no recorder-side cancellation endpoint. If the business rule expects designated recorders to cancel, that function is not implemented.

### IA-013: Required launch-readiness command name is absent

| Field | Value |
|---|---|
| Severity | Low |
| Confidence | High |
| Module | Operations |
| Requirement | `php artisan app:launch-readiness` |
| Evidence | `LaunchReadinessCheck.php`; command search |

The implemented command is `app:launch-check`, not `app:launch-readiness`. Deployment documentation uses the implemented name, while the authoritative audit specification requires the other name. This will make the specified verification command fail unless an alias or specification correction is made later.

### IA-014: Deployment target is ambiguous

| Field | Value |
|---|---|
| Severity | Medium |
| Confidence | High |
| Module | Deployment architecture |
| Evidence | `AGENTS.md`; `wrangler.toml`; `deploy/nginx.conf`; `deploy/README.md` |

Repository guidance names Cloudflare Pages as the frontend target with a separately deployed Laravel API. The `deploy/` directory defines an on-premises same-origin Nginx deployment. Both may be intentional, but the authoritative production topology and environment-variable contract are not singularly documented. Sanctum cookie, CORS, TLS, and service-worker verification depend on choosing the actual target.

### IA-015: TanStack Query requirement has no implementation

| Field | Value |
|---|---|
| Severity | Low |
| Confidence | High |
| Module | Frontend data layer |
| Requirement | Inventory and inspect a TanStack Query implementation |
| Evidence | `package.json`; source-wide search |

`@tanstack/react-query`, `QueryClient`, `useQuery`, and `useMutation` are absent. The application uses a custom API client, application-data context, and custom cache helpers. This is not automatically a defect, but the audit requirement is not applicable to the current architecture unless TanStack Query was intended.

### IA-016: Leadership digest repeats same-window dispatch

| Field | Value |
|---|---|
| Severity | Medium |
| Confidence | High for serial reproduction |
| Module | Scheduled leadership digest |
| Requirement | Idempotent scheduling and delivery behavior |
| Evidence | Two consecutive `reports:send-digest` invocations; `EXECUTABLE_VERIFICATION_RESULTS.md` |

On the isolated seeded database, `reports:send-digest` reported one queued recipient on the first invocation and queued one recipient again on the immediate second invocation. `withoutOverlapping` prevents concurrent overlap but does not suppress a completed same-window rerun. Scheduler retries, duplicate cron invocation, or manual reruns can therefore dispatch duplicate digest work unless a downstream provider or job guard not visible in this check deduplicates it.

### IA-017: Browser fixtures omit required academic and clinical assignments

| Field | Value |
|---|---|
| Severity | Medium |
| Confidence | High |
| Module | End-to-end test fixtures |
| Requirement | Executable resident evaluation and nurse report journeys |
| Evidence | Complete Playwright run; `EXECUTABLE_VERIFICATION_RESULTS.md` |

The configured resident account has no ward or paired duty assignment on the test date, so the application correctly denies academic evaluation submission. The configured nurse has no report assignment, so the nurse clinical report test skips. These are fixture/test-environment gaps, not evidence that the application authorization is defective, but they prevent executable verification of two core workflows.

## Missing or not yet implemented audit functionality

- Required `tests/e2e`, page-object, fixture, and helper layout.
- Required `tests/performance/k6` layout and documented multi-tier workloads.
- Automated direct API coverage for every route and every permission boundary.
- Concurrency tests for roster, transfers, form publishing, evaluation submission, morning recording, and teaching attendance.
- Deterministic database integrity query suite.
- Database-level unified-evaluation checks and published-form uniqueness.
- Student-batch and student delete API workflows.
- Designated-recorder morning cancellation route.
- `app:launch-readiness` command alias or matching implementation.
- TanStack Query implementation, if it is an intended architecture requirement.
- Same-window leadership-digest deduplication.
- Browser fixtures that align resident and nurse accounts with current assignments.

## Positive controls visible in the initial stage

- PHPUnit uses in-memory SQLite, preventing the test suite from touching the local application database.
- All 54 migrations are applied locally with none pending.
- The test suite includes a route-level student-representative denial check across every academic evaluation endpoint.
- Evaluation headers and answers are saved in one transaction.
- Historical evaluations pin their form version and have passing regression coverage.
- Clinical import/export includes formula-injection neutralization tests and XML entity-expansion rejection.
- Security headers exist in both Laravel middleware and static hosting configuration.
- CI runs frontend checks, backend SQLite tests, and backend MariaDB tests.
- Scheduler entries mostly use `withoutOverlapping`.
- Deployment scripts use `set -euo pipefail`, and backup, queue-worker, Nginx, logrotate, and firewall definitions exist.
- All 154 Sanctum-protected routes returned `401` to anonymous requests.
- Seventeen integrity queries returned zero violations on the isolated seeded SQLite database.
- The production-preview accessibility, security, regression, PWA, and performance-smoke subset passed 31 of 31 Playwright tests.

## Executable verification still required

1. Provide an isolated MariaDB 11.4 database and run migrations plus the complete backend test suite.
2. Reproduce concurrency scenarios with parallel requests on MariaDB.
3. Align the resident and nurse browser fixtures with current assignments, then rerun the complete suite.
4. Run the migration verifier on controlled legacy and unified records for deterministic parity evidence.
5. Exercise the persistent worker with controlled time, retries, failed delivery, and duplicate-digest cases.
6. Complete correct-role, wrong-role, object-policy, mutation-audit, and safe-input probes for every route.
7. Test PWA update, offline mutation, logout cache isolation, and multi-user device reuse.
8. Run Lighthouse and approved load, stress, and soak scenarios on local or staging infrastructure.
9. Validate the actual Nginx, PHP-FPM, systemd, cron, TLS, backup, restore, firewall, monitoring, and rollback host behavior.

## Recommended next-stage order

1. Resolve the authoritative deployment topology and provision isolated MariaDB with sanitized, assignment-complete role fixtures.
2. Run MariaDB migration/test parity and the three highest-risk concurrency reproductions.
3. Complete route-by-route authorization, browser submission journeys, PWA session isolation, and queue failure/deduplication checks.
4. Perform OWASP-aligned security testing and file/import review.
5. Measure query plans, cache behavior, API latency, frontend Web Vitals, queue throughput, and approved load tiers.
6. Model scalability, validate backup/restore and rollback, and complete deployment readiness on the actual target.
7. Only after evidence is complete, add regression tests and make the smallest approved critical/high fixes.
