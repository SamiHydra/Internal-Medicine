# ISSUE REGISTER

Consolidated master index of every issue surfaced by the full-system audit of the St Paul's IM reporting and
academic platform. One row per finding, reconciled against `AUDIT_FINDINGS.md` (the source of truth for
issues), `AUDIT_PROGRESS.md` (audit narrative, checkpoints 0-8), the remediation commits, and the evidence
artifacts under `artifacts/audit-2026-07-21/`.

**Generated:** 2026-07-22 (reporting phase)
**Reconciles with:** `AUDIT_FINDINGS.md`, `AUDIT_PROGRESS.md`, `AUDIT_COMMAND_LOG.md`, `ROLE_PERMISSION_MATRIX.md`
**Companion e2e report:** `PLAYWRIGHT_TEST_REPORT.md` (produced separately by the browser workflow)

---

## How to read this register

**Verification status** (was the issue proven real?):
- `VERIFIED` - reproduced or executed against a running system (MariaDB parity stack, HTTP, or a backend
  regression test that was confirmed to fail before its fix).
- `UNVERIFIED` - recorded from code inspection or a single agent report, not independently reproduced at the
  time it was written into `AUDIT_FINDINGS.md`.
- `PREDICTED` - a scalability or growth projection from schema and query analysis, never measured at
  1k/10k/100k rows. Per the audit brief, all scalability numbers are predicted, not measured.

**Fix status:**
- `FIXED-VERIFIED` - fix applied and proven (regression test green on both DB lanes, or a reproduced HTTP
  journey, or a rebuilt-from-empty deployment).
- `FIXED-UNVERIFIED` - fix applied, but the decisive proof cannot be executed from this machine (CI green
  needs a push to GitHub Actions).
- `OPEN` - real, not yet fixed.
- `REFUTED` - checked and cleared: intentional design or a false premise. Not a defect.

**Boundary of "VERIFIED" in this register.** Verification here means the backend regression suite on both
database lanes (SQLite 313 passed / 1 skipped; MariaDB 314 passed / 0 failures, `mariadb-suite-postfix.txt:23`)
plus targeted HTTP reproduction through nginx on the MariaDB production-parity stack. It does **not** mean
browser-based role testing: the Playwright role audit ran in a separate workflow and its results live in
`PLAYWRIGHT_TEST_REPORT.md` (produced separately). Phases 2-8 of the plan (viewport, cross-role browser
sweeps) are reported there, not here.

**Data-coverage caveat that bounds every performance claim.** 20 of 53 tables are empty in the seeded dev DB,
including `audit_logs`, `notifications`, `access_requests`, `report_status_history`, `report_comments` and
`calculated_metrics` (`AUDIT_FINDINGS.md:310-313`). No performance or scalability claim may be made about
those paths from this dataset. Real volume exists in only four tables: `report_field_values` 61,001,
`evaluation_answers` 8,804, `morning_attendance` 6,440, `student_attendance` 900.

---

## READ THIS FIRST: reconciliation discrepancy in the source evidence

This register is required to reconcile exactly with `AUDIT_FINDINGS.md`. It does not, and the reason is a
documented gap, not an error in this register:

**`AUDIT_FINDINGS.md` was not fully updated after the remediation run.** The remediation is committed as
`43bbccc` ("Fix and verify 16 audit findings across both database lanes", 2026-07-22), whose message and code
artifacts show 16 findings fixed and 7 of 23 candidates refuted. But that commit changed `AUDIT_FINDINGS.md`
by only 16 lines: it updated the `AUD-API-002` block alone (`git show 43bbccc -- AUDIT_FINDINGS.md`). As a
result the findings file at HEAD still reads:
- `AUD-SEC-004` fix status **"Open"** (`AUDIT_FINDINGS.md:230`) although the commit added CSP and HSTS to the
  SPA document in `deploy/nginx.conf` and `docker/nginx.conf` and states they were "Verified against the
  served document."
- `AUD-SEC-005` fix status **"Open"** (`AUDIT_FINDINGS.md:244`) although the commit collapsed the conflicting
  `Referrer-Policy` to one value in `deploy/nginx.conf`.
- `AUD-DB-006` fix status **"Open"** (`AUDIT_FINDINGS.md:260`) although the concurrency-test teardown was
  fixed (`MariaDbConcurrencyRegressionTest` teardown now deletes audit rows before users) and the MariaDB
  suite consequently returns 0 errors.
- The entire "CODE-DERIVED CANDIDATES - PENDING EMPIRICAL VERIFICATION" section
  (`AUDIT_FINDINGS.md:268-317`) is still labelled pending, although the remediation reproduced, fixed, and
  regression-tested nine of those candidates and refuted others.

**Where this register takes its truth from when the findings file is stale:** the committed code, migrations,
and regression tests in `43bbccc` (and the earlier blocker commits `540c067`, `6bb360f`), which are primary
evidence, plus the adjudicated triage in `mariadb-failure-triage.md`. Every such row cites the concrete
artifact.

**A second, narrower discrepancy: only 2 of the 7 refuted candidates are named in the evidence.** Commit
`43bbccc` names exactly two by content (the "44 unindexed FKs" claim = `C-PERF-014`, and the "29 unvalidated
enum columns" claim = `C-DB-011`). The per-candidate adjudication for the other five refutations was never
written back to any audit file. This register therefore lists those five as **REFUTED (disposition inferred)**
- inferred from the fact that the remediation commit left them untouched and their `AUDIT_FINDINGS.md`
descriptions match the commit's stated refutation basis ("intentional or ... false premises"). They are
flagged as inferred rather than presented as recorded fact. This is the single place where this register
cannot fully close the loop against the evidence, and it is called out rather than papered over.

---

## Summary counts

| Bucket | Count | Notes |
|---|---|---|
| Confirmed findings, deployment blockers | 2 | `AUD-DB-001`, `AUD-DEPLOY-007` - both FIXED-VERIFIED |
| Confirmed findings, other | 6 | `AUD-INFRA-003`, `AUD-API-002` (+`002b`), `AUD-SEC-004`, `AUD-SEC-005`, `AUD-DB-006` |
| Code/schema candidates FIXED | 9 | `C-AUTHZ-001`, `C-SEC-002`, `C-SEC-003`, `C-SEC-004`, `C-SEC-005`, `C-SEC-009`, `C-DB-012`, `C-DB-015`, `C-DB-016` |
| New finding found during verification, FIXED | 1 | SQLite CHECK lost to table rebuilds (`departments.family`, `admin_access_requests.status`) |
| Candidates REFUTED | 7 | 2 named in evidence (`C-DB-011`, `C-PERF-014`); 5 inferred (`C-SEC-006`, `C-API-007`, `C-AUTHZ-008`, `C-ARCH-010`, `C-ARCH-017`) |
| Candidates OPEN / deferred | 1 | `C-DB-013` retention (real, not fixed; the core of the scalability section) |
| Carried-over concerns (PRE-*) | 5 | 3 fixed, 1 fixed pre-remediation area, 1 confirmed intentional |
| **Findings fixed total (matches commit 43bbccc + brief)** | **16** | 4 confirmed + 9 candidates + 1 new + 2 PRE = 16 |
| Regression tests added | 32 | each verified to fail before its fix (`43bbccc` commit body) |

Headline conclusion: the two deployment blockers and the critical duty-roster 500 are fixed and verified;
16 findings fixed with 32 regression tests, both DB lanes green; 7 candidates cleared as non-defects; one
real retention gap (`C-DB-013`) remains open, and browser-based role testing is reported separately. The
register's one unresolved reconciliation is that `AUDIT_FINDINGS.md` was not refreshed after remediation.

---

## Master table (sortable) - confirmed findings and fixed candidates

| ID | Title | Severity | Category | Affected role / module | Verification | Fix status | Evidence pointer |
|---|---|---|---|---|---|---|---|
| AUD-DB-001 | Migrations cannot run on MariaDB: index name exceeds 64-char limit | Critical (deploy blocker) | Database / release engineering | All / undergraduate teaching sessions | VERIFIED | FIXED-VERIFIED | `AUDIT_FINDINGS.md:33-81`; commit `540c067`; `2026_08_12_000010_create_undergraduate_tables.php:96`; `SchemaConstraintTest.php` |
| AUD-DEPLOY-007 | `composer.lock` requires PHP 8.4; server runs 8.3 | Critical (deploy blocker) | Release engineering / deps | All / deployment | VERIFIED | FIXED-VERIFIED | `AUDIT_FINDINGS.md:124-190`; commit `6bb360f`; `composer.json` `config.platform.php` |
| AUD-INFRA-003 | Entire CI pipeline cannot install dependencies | Critical | Release engineering | All / CI | VERIFIED | FIXED-UNVERIFIED | `AUDIT_FINDINGS.md:85-121`; superseded by `AUD-DEPLOY-007`; CI reverted to 8.3, green needs a push |
| AUD-API-002 | Saving a duty roster month returns 500 on MariaDB | Critical | Backend / data integrity | admin, superadmin / duty roster | VERIFIED | FIXED-VERIFIED | `AUDIT_FINDINGS.md:194-219`; `2026_09_16_000010_relax_admin_audit_log_entity_id.php`; `mariadb-failure-triage.md` Product Defect 1; commit `43bbccc` |
| AUD-API-002b | `saveMonth` not wrapped in a transaction (partial-commit risk) | High (sub of API-002) | Backend / data integrity | admin, superadmin / duty roster | VERIFIED | FIXED-VERIFIED | `AUDIT_FINDINGS.md:207-208`; `DutyRosterController.php`; `mariadb-failure-triage.md` "Secondary defect" |
| AUD-SEC-004 | No CSP and no HSTS on the SPA document | Medium | Security headers | All / SPA document | UNVERIFIED (finding); fix VERIFIED | FIXED-VERIFIED | `AUDIT_FINDINGS.md:223-234` (still "Open"); `deploy/nginx.conf` + `docker/nginx.conf` in `43bbccc` |
| AUD-SEC-005 | Conflicting duplicate `Referrer-Policy`, duplicated `Cache-Control` | Low | Security headers | All / production nginx | UNVERIFIED (finding); fix VERIFIED | FIXED-VERIFIED | `AUDIT_FINDINGS.md:238-249` (still "Open"); `deploy/nginx.conf` in `43bbccc` |
| AUD-DB-006 | Concurrency test teardown violates a foreign key | Low (test-only) | Test hygiene | Test harness | VERIFIED | FIXED-VERIFIED | `AUDIT_FINDINGS.md:253-264` (still "Open"); `mariadb-failure-triage.md` H1; `MariaDbConcurrencyRegressionTest.php` teardown |
| C-AUTHZ-001 | Residents and consultants cannot read their own notifications | High | Authorization | resident, consultant / notifications | VERIFIED | FIXED-VERIFIED | `AUDIT_FINDINGS.md:281`; `Permissions.php` (+`NOTIFICATIONS_VIEW` to resident/consultant); `NotificationRoleAccessTest.php` |
| C-SEC-002 | Public `POST /api/access-requests` has no duplicate guard + write amplification | High | Security / unauthenticated write | Anonymous / registration | VERIFIED | FIXED-VERIFIED | `AUDIT_FINDINGS.md:282`; `AccessRequestSubmissionController.php`; `AccessRequestSubmissionTest.php` |
| C-SEC-003 | `POST /api/access-requests` honours a session cookie (auth-gate bypass) | High | Security / auth bypass | Anonymous or forced-password user / registration | VERIFIED | FIXED-VERIFIED | `AUDIT_FINDINGS.md:283`; `AccessRequestSubmissionController.php`; `AccessRequestSubmissionTest.php` |
| C-SEC-004 | Account-enumeration oracle across the three registration endpoints | Medium | Security / enumeration | Anonymous / registration | VERIFIED | FIXED-VERIFIED | `AUDIT_FINDINGS.md:284`; `AcademicRegistrationController.php`, `AdminRegistrationController.php`, `AccessRequestSubmissionController.php`; tests |
| C-SEC-005 | Three `/api` routes unthrottled (`change-password` CPU DoS) | Medium | Security / DoS | Any logged-in user / auth | VERIFIED | FIXED-VERIFIED | `AUDIT_FINDINGS.md:285`; `api.php` (`throttle:300,1` + `throttle:6,1,change-password`); `AuthThrottleTest.php` |
| C-SEC-009 | Broadcast channel `App.Models.User.{id}` checks identity only | Low now / High on-prem | Security / broadcasting | Any user / private channel | VERIFIED (code + test); exploit path PREDICTED on-prem | FIXED-VERIFIED | `AUDIT_FINDINGS.md:289`; `UserChannel.php` (+`active` +`password_change_required`); `ChannelAuthorizationTest.php` |
| C-DB-012 | `evaluations` has zero unique constraints (4 duplicate groups exist) | High | Database / data integrity | resident, consultant / academic evaluation | VERIFIED | FIXED-VERIFIED | `AUDIT_FINDINGS.md:302`; `2026_09_16_000020_enforce_evaluation_submission_uniqueness.php`; `AcademicEvaluationApiTest.php` |
| C-DB-015 | Migration rollback produces a third `is_core` state | Medium | Database / migration correctness | Academic / evaluation forms | VERIFIED | FIXED-VERIFIED | `AUDIT_FINDINGS.md:305`; `2026_08_30_000040_restore_evaluation_core_field_contract.php` modified in `43bbccc` |
| C-DB-016 | No date-ordering / unique constraint on `duty_assignments` | Low | Database / data integrity | admin / duty roster | VERIFIED | FIXED-VERIFIED | `AUDIT_FINDINGS.md:306`; duty-date guard in `DutyRosterController.php` / `RotationController.php`; `RosterTest.php` |
| AUD-DB-018 (new) | Two SQLite CHECK constraints lost to table rebuilds | Medium | Database / dev-prod divergence | All / `departments.family`, `admin_access_requests.status` | VERIFIED | FIXED-VERIFIED | `2026_09_16_000030_restore_sqlite_enum_check_constraints.php` (header); `SchemaConstraintTest.php`; found while verifying `C-DB-011` |
| PRE-3 | Pending applicant login gives a generic message (planned reveal-after-match) | Medium | Security / enumeration | Pending applicant / login | VERIFIED | FIXED-VERIFIED | `AUDIT_FINDINGS.md:381`; `AuthController.php` (reveal after password match); `AuthApiTest.php` |
| PRE-4 | Duplicate `defaultTitle()` renders a null-title student rep as "Nurse" | Low | UI / data correctness | student_rep / profile, workspace | VERIFIED | FIXED-VERIFIED | `AUDIT_FINDINGS.md:382`; new `RoleTitles.php`; `WorkspaceController.php`; `WorkspaceApiTest.php` |
| PRE-1 | Public academic signup created an active account with no approval step | High | Workflow / authorization | resident, consultant / registration | VERIFIED | FIXED-VERIFIED | `AUDIT_FINDINGS.md:379`; BLOCKER-1 workflow, `AUDIT_PROGRESS.md:196-208`; academic signup now enters the approval queue |
| PRE-2 | `UserPolicy::update` let an admin deactivate but not edit academic users | Medium | Authorization | admin / user management | VERIFIED | FIXED-VERIFIED | `AUDIT_FINDINGS.md:380`; BLOCKER-1 workflow, `AUDIT_PROGRESS.md:196-208` |

---

## Detail entries - confirmed findings

### AUD-DB-001 - Migrations cannot run on MariaDB: index name exceeds the 64-character limit
- **Severity:** Critical (deployment blocker). **Category:** Database / release engineering.
- **Affected:** All roles (nobody can be deployed to); undergraduate / teaching sessions module.
- **What it is:** `$table->unique(['batch_id','subgroup','activity_type','scheduled_date'])` on
  `teaching_sessions` generated a 71-character index identifier against MariaDB's 64-char limit, so
  `php artisan migrate --force` (what `deploy/deploy.sh` runs) aborted with SQLSTATE 42000 / 1059. Invisible
  on SQLite. The only occurrence in the repo.
- **Verification:** VERIFIED by the auditor by reproducing the deployment, not by inspection: `docker compose
  down -v` then rebuild from empty completed 72 migration/seeder steps, exit 0, all services healthy
  (`AUDIT_FINDINGS.md:49-57`).
- **Fix:** named the index `teaching_sessions_slot_unique` (29 chars),
  `2026_08_12_000010_create_undergraduate_tables.php:96`, commit `540c067`. Regression guard: a
  schema-identifier-length test now runs on both lanes (`SchemaConstraintTest.php`), replacing the former
  container-only patch. **Fix status: FIXED-VERIFIED.**

### AUD-DEPLOY-007 - `composer.lock` requires PHP 8.4; the production server runs 8.3
- **Severity:** Critical (second deployment blocker). **Category:** Release engineering / dependency management.
- **Affected:** All roles; deployment and all CI jobs.
- **What it is:** `composer.lock` carried 17 packages requiring `php >=8.4.1` (Symfony 8.1.x and others)
  while the server, `deploy/README.md`, `deploy/deploy.sh` and `docs/OPERATIONS.md` are all PHP 8.3.
  `composer install` on the server therefore cannot resolve. Root cause: `config.platform` was never pinned,
  so the lock drifted to whatever PHP the dev machine ran (8.4).
- **Verification:** VERIFIED on a genuine 8.3.32 runtime: `docker compose build` exit 0; the exact
  `deploy.sh:149` command `composer install --no-dev --optimize-autoloader` produced 91 installs; stack
  healthy; `php -v` = PHP 8.3.32 (`AUDIT_FINDINGS.md:144-153`).
- **Fix:** `composer.json` `config.platform.php = "8.3.0"`, lock re-resolved (31 downgrades, Symfony 7.4.x),
  CI reverted to 8.3 in all three jobs, Docker moved 8.4 to 8.3. Commit `6bb360f`. **Fix status:
  FIXED-VERIFIED.**
- **Note:** supersedes `AUD-INFRA-003`. The auditor's first attempt raised CI to 8.4 to match the lock, which
  was backwards; recorded and reverted rather than hidden (`AUDIT_FINDINGS.md:95-106,155-157`).

### AUD-INFRA-003 - The entire CI pipeline cannot install dependencies
- **Severity:** Critical. **Category:** Release engineering. **Affected:** All / CI.
- **What it is:** `.github/workflows/ci.yml` pins PHP 8.3 at lines 51, 105 and 156 (all three jobs) while the
  lock required 8.4 for 17 packages, so no CI job could `composer install`. This is why `AUD-DB-001` reached
  the branch undetected and why `MariaDbConcurrencyRegressionTest` had never run anywhere.
- **Verification:** VERIFIED by the auditor, and found broader than first reported (all three jobs, not just
  MariaDB) (`AUDIT_FINDINGS.md:110-118`).
- **Fix status: FIXED-UNVERIFIED.** The root cause is closed by `AUD-DEPLOY-007`; CI is reverted to 8.3 to
  match production. Whether CI actually goes green cannot be executed from this machine and must be confirmed
  on the next push (`AUDIT_FINDINGS.md:102-106`; `AUDIT_PROGRESS.md:431`).

### AUD-API-002 - Saving a duty roster month returns 500 on MariaDB (+ AUD-API-002b partial-commit)
- **Severity:** Critical (100% failure of a core admin workflow on the production engine). **Category:**
  Backend / data integrity. **Affected:** admin, superadmin; duty roster.
- **What it is:** `DutyRosterController.php:198-202` writes a period key `sprintf('%04d-%02d', ...)` (e.g.
  `'2026-07'`) into `admin_audit_logs.entity_id`, declared native `uuid`
  (`2026_05_25_180140_create_admin_audit_logs_table.php:17`). SQLite accepts it; MariaDB rejects it with
  ERROR 1292. The column is a documented free-form key, not a UUID (`AuditLogController.php:74-75`). This one
  defect produced 3 of the 10 MariaDB suite failures (`mariadb-failure-triage.md` failures 1-3). `saveMonth`
  had no wrapping transaction, so roster rows committed while only the trailing audit INSERT threw
  (`AUD-API-002b`, `mariadb-failure-triage.md` "Secondary defect confirmed").
- **Verification:** VERIFIED end to end through nginx on the MariaDB stack: csrf 204, login 200,
  `PUT /api/admin/roster/2028/3` returned HTTP 200 (was 500), `admin_audit_logs` rows for
  `entity_type='duty_roster'` went 5 to 6 (`AUDIT_FINDINGS.md:210-213`). Also reproduced directly against the
  parity DB with a raw INSERT (`mariadb-failure-triage.md:66-71`).
- **Fix:** migration `2026_09_16_000010_relax_admin_audit_log_entity_id.php` widens `entity_id` to
  `string(64)` nullable; `saveMonth` wrapped in one `DB::transaction`. Commit `43bbccc`. The MariaDB suite
  went from 7 failures / 3 errors to OK (314 tests, 2188 assertions) (`mariadb-suite-postfix.txt:23`).
  **Fix status: FIXED-VERIFIED.**

### AUD-SEC-004 - No CSP and no HSTS on the SPA document
- **Severity:** Medium. **Category:** Security headers. **Affected:** All / SPA document.
- **What it is:** CSP and HSTS are emitted by Laravel middleware, so they appear on `/api` and `/sanctum`
  responses but not on the HTML document nginx serves. A CSP that never reaches the document protects nothing
  against XSS in the SPA. Only observable on the nginx lane, not the Vite dev server.
- **Verification:** finding was UNVERIFIED at write time (agent-reported from captured headers,
  `AUDIT_FINDINGS.md:229`). The fix was verified against the served document.
- **Fix:** `deploy/nginx.conf` and `docker/nginx.conf` now add `Content-Security-Policy`,
  `Strict-Transport-Security "max-age=31536000; includeSubDomains"`, and `Permissions-Policy` at the server
  level. Commit `43bbccc`. **Fix status: FIXED-VERIFIED.**
- **Register note:** `AUDIT_FINDINGS.md:230` still records this as "Open" (see the reconciliation discrepancy
  section). The commit's code and message are the current truth.

### AUD-SEC-005 - Conflicting duplicate `Referrer-Policy`, duplicated `Cache-Control`
- **Severity:** Low. **Category:** Security headers. **Affected:** All / production nginx.
- **What it is:** `Referrer-Policy` was sent twice with conflicting values
  (`strict-origin-when-cross-origin` vs `same-origin`); `Cache-Control` was duplicated on assets. Both
  originate in `deploy/nginx.conf`, so they affect the real production server.
- **Verification:** finding UNVERIFIED at write time (`AUDIT_FINDINGS.md:243`); fix verified against the
  served document.
- **Fix:** `deploy/nginx.conf` collapsed `Referrer-Policy` to a single `strict-origin-when-cross-origin`
  matching `SecurityHeaders.php`, and removed the per-location duplicate `Cache-Control` in favour of a single
  `$imreport_cache_control` map. Commit `43bbccc`. **Fix status: FIXED-VERIFIED.**
- **Register note:** `AUDIT_FINDINGS.md:244` still records this as "Open" (reconciliation discrepancy).

### AUD-DB-006 - Concurrency test teardown violates a foreign key
- **Severity:** Low (test-only). **Category:** Test hygiene. **Affected:** Test harness.
- **What it is:** `MariaDbConcurrencyRegressionTest`'s `finally` teardown deleted users while
  `admin_audit_logs` still referenced them (a `TransferService.php:78` row), tripping the RESTRICT FK 1451.
  All three concurrency scenarios themselves passed (14 assertions); only teardown failed, and because it
  aborted the whole DELETE, three `active` admin users leaked into every alphabetically later test, producing
  5 of the 7 remaining MariaDB "failures" (`mariadb-failure-triage.md` H1, failures 4-9).
- **Verification:** VERIFIED in the triage (isolation experiments run both directions,
  `mariadb-failure-triage.md:144-154`).
- **Fix:** teardown now deletes `admin_audit_logs` rows before users, asserts the cleanup worked, and resets
  `RefreshDatabaseState::$migrated` for order-independence. Commit `43bbccc`. MariaDB suite now 0 errors.
  **Fix status: FIXED-VERIFIED.**
- **Register note:** `AUDIT_FINDINGS.md:260` still records this as "Open" (reconciliation discrepancy).

---

## Detail entries - code and schema candidates that became confirmed defects and were fixed

### C-AUTHZ-001 - Residents and consultants cannot read their own notifications (High, FIXED-VERIFIED)
All five notification routes required `permission:notifications.view` (`api.php:77-81`), granted only to
superadmin/admin/nurse/student_rep, yet `MorningSessionService.php:237-239` and `TransferService.php:345`
notify residents and consultants. Their own notifications were therefore unreadable.
**Fix:** `Permissions.php` grants `NOTIFICATIONS_VIEW` to `resident` and `consultant`; the controller pins
non-admin callers to their own `recipient_id`, so no cross-user visibility is added.
Regression: `NotificationRoleAccessTest.php`. Evidence: `git show 43bbccc -- backend/app/Support/Authorization/Permissions.php`.

### C-SEC-002 / C-SEC-003 - Public access-request endpoint: no duplicate guard, write amplification, and session-cookie honoured (High, FIXED-VERIFIED)
`POST /api/access-requests` was public (`api.php:51`) yet wrote an inactive `users` row with no
pending-duplicate guard and fanned out one notification INSERT per active admin
(`AccessRequestSubmissionController.php:92-101,141-154`). It also read `Auth::guard('web')->user()` with
`statefulApi` enabled, so a session cookie was honoured, bypassing `EnsureActiveUser` and
`EnsurePasswordChanged`. **Fix:** heavy rework of `AccessRequestSubmissionController.php` (+190 lines) adds a
duplicate guard and closes the session-bypass path. Regression: `AccessRequestSubmissionTest.php` (+299
lines). Evidence: `git show 43bbccc --stat`.

### C-SEC-004 - Account-enumeration oracle across the three registration endpoints (Medium, FIXED-VERIFIED)
All three registration endpoints returned distinct 422 messages separating "account exists" from "request
already pending", while `PasswordResetController@forgot` was correctly non-enumerating. **Fix:** the three
controllers were aligned to a non-enumerating response. Regression across `AcademicRegistrationTest.php`,
`AdminRegistrationTest.php`, `AccessRequestSubmissionTest.php`.

### C-SEC-005 - Three `/api` routes unthrottled; `change-password` is a CPU amplifier (Medium, FIXED-VERIFIED)
`POST /auth/change-password`, `POST /auth/logout`, `GET /auth/me` had no throttle; `change-password` runs a
bcrypt verify plus a re-hash at unlimited rate. **Fix:** `api.php` now wraps `/me` and `/logout` in
`throttle:300,1` and `change-password` in a named `throttle:6,1,change-password` limiter so it cannot drain
the API-wide ceiling. Regression: `AuthThrottleTest.php`. Evidence:
`git show 43bbccc -- backend/routes/api.php`.

### C-SEC-009 - Broadcast channel checks identity only (Low now / High on-prem, FIXED-VERIFIED)
`App.Models.User.{id}` checked identity but not `active` or `password_change_required`; `Gate::before`'s
inactive-user shortcut does not cover `Broadcast::channel` callbacks. **Fix:** `UserChannel::authorize` now
returns false when `! $user->active || $user->password_change_required`. Regression:
`ChannelAuthorizationTest.php`. Evidence: `git show 43bbccc -- backend/app/Support/Broadcasting/UserChannel.php`.
**Live-exploit caveat:** `BROADCAST_CONNECTION=log` in dev, so the runtime exploit path on a real broadcast
driver remains PREDICTED for the on-prem deployment; the code fix and unit test are verified.

### C-DB-012 - `evaluations` has zero unique constraints; 4 duplicate groups already exist (High, FIXED-VERIFIED)
Without a uniqueness key a resident could POST the same evaluation N times and cast N votes, since every
analytics aggregate is a per-row mean. **Fix:** migration
`2026_09_16_000020_enforce_evaluation_submission_uniqueness.php` enforces one author / subject / date / form,
handling the two nullable subject columns; the controller returns a clean conflict. The migration was
explicitly designed to survive the 4 pre-existing duplicate groups. Regression: `AcademicEvaluationApiTest.php`.

### C-DB-015 - Migration rollback produces a third `is_core` state (Medium, FIXED-VERIFIED)
`2026_08_26_000010` and `2026_08_30_000040` disagreed: the second re-set four fields while its `down()`
restored a different, larger set, silently locking extra fields from editing on rollback. **Fix:**
`2026_08_30_000040_restore_evaluation_core_field_contract.php` was corrected in `43bbccc`. Evidence:
`git show 43bbccc --stat`.

### C-DB-016 - No date-ordering / unique constraint on `duty_assignments` (Low, FIXED-VERIFIED)
Overlap was enforced only in `RosterService`; the seeded DB already held a row with
`starts_on = ends_on = '2320-02-12'`. **Fix:** a duty-date guard was added on the write paths
(`DutyRosterController.php`, `RotationController.php`). Regression: `RosterTest.php` (+117 lines).

### AUD-DB-018 (new, surfaced during verification) - Two SQLite CHECK constraints lost to table rebuilds (Medium, FIXED-VERIFIED)
Not in the original candidate list. Adding a constrained FK forces SQLite to rebuild a table, and the rebuild
does not re-emit the CHECK an earlier `enum()` produced: `departments.family` lost it to the `ward_id`
migration and `admin_access_requests.status` to the `home_ward_id` one. MariaDB still rejects out-of-range
values, so the two lanes disagreed and a bad-value regression would pass the SQLite test suite and fail only
in production. This is the narrow, real kernel that verifying `C-DB-011` turned up (the broad "29 columns"
claim did not hold). **Fix:** migration `2026_09_16_000030_restore_sqlite_enum_check_constraints.php`
restores the two constraints via driver-guarded triggers. Regression: `SchemaConstraintTest.php`. Evidence:
migration file header.

### PRE-3 - Pending applicant login message (Medium, FIXED-VERIFIED)
A pending applicant received a generic "credentials do not match" with no indication that approval was
pending. **Fix:** `AuthController` reveals pending status only after the submitted password matches, so login
does not become a second enumeration oracle. Regression: `AuthApiTest.php`. This is the login-side complement
to the `C-SEC-004` fix.

### PRE-4 - Duplicate `defaultTitle()` renders a null-title student rep as "Nurse" (Low, FIXED-VERIFIED)
Three private title-fallback copies (AuthController, WorkspaceController, Admin\UserController) disagreed; a
student rep with a null title rendered as "Nurse" on `/api/workspace` and `/api/auth/me`. **Fix:** new
`backend/app/Support/RoleTitles.php` is the single source of truth, aligned with
`CREATABLE_ROLE_TITLES`. Regression: `WorkspaceApiTest.php`. Evidence: `RoleTitles.php` header.

### PRE-1 / PRE-2 - Academic signup approval and academic-user editing (High / Medium, FIXED-VERIFIED)
Fixed by the pre-remediation BLOCKER-1 workflow (`AUDIT_PROGRESS.md:196-208`): academic signup now enters the
admin approval queue instead of creating a live account, and `UserPolicy::update` allows admins to edit
academic users. The reviewers also caught and fixed a regression that workflow introduced (academic
enrollment requests filtered out of the clinical-workspace approval queue), verified by the auditor with the
full backend suite (`AUDIT_PROGRESS.md:210-217`).

---

## REFUTED candidates (checked and cleared - NOT defects)

Report these as checked-and-cleared, per the audit brief. Commit `43bbccc` states "7 of 23 [candidates] were
refuted as intentional or as false premises ... and left untouched." Two are named in the evidence; five are
inferred from the remediation leaving them untouched and matching the stated refutation basis.

| ID | Candidate (as written) | Why cleared | Disposition source |
|---|---|---|---|
| C-DB-011 | "29 `enum()` columns are unvalidated `varchar` on SQLite" | The broad claim did not hold: MariaDB still enforces the enums. A narrow real defect (2 columns lost their SQLite CHECK to table rebuilds) was carved out and fixed as `AUD-DB-018`. | **Named in evidence** (`43bbccc` body; `AUDIT_FINDINGS.md:301`) |
| C-PERF-014 | "44 foreign keys have no supporting index" | Did not hold on MariaDB: the flagged plans do not degrade as claimed; `report_field_values.field_definition_id` is a strict prefix of the unique index by design (`2026_05_29_000000:41`). | **Named in evidence** (`43bbccc` body; `AUDIT_FINDINGS.md:304`) |
| C-SEC-006 | `PUT/GET /storage/{path}` no middleware; `/broadcasting/auth` ungated | Intentional: the storage route is guarded by an APP_KEY-relative signed URL by design; left untouched by the remediation. | REFUTED (disposition inferred; not individually recorded) |
| C-API-007 | `GET /api/academic/morning-sessions/today` creates a DB row | Intentional idempotent `openFor($today)`; analytics GET cache-warming is a deliberate after-response pattern. Left untouched. | REFUTED (disposition inferred) |
| C-AUTHZ-008 | `MorningSessionController@cancel` reachable via two routes | `MorningSessionPolicy::cancel` (`:56-69`) holds the line regardless of which route is used; no privilege crossing. Left untouched. | REFUTED (disposition inferred) |
| C-ARCH-010 | Nine controllers with zero in-action authorization; analytics scoping | Permission middleware is the intended sole control; no cross-department leak demonstrated. Informational. Left untouched. | REFUTED (disposition inferred) |
| C-ARCH-017 | `sessions`/`cache`/`jobs` share the SQLite file | Dev-lane only; does not apply to the prod-parity lane where these are MariaDB tables (`AUDIT_FINDINGS.md:307`). Not a production defect. | REFUTED (disposition inferred) |

**Also recorded as verified non-holes** (so no one re-chases them, `AUDIT_FINDINGS.md:292-294`):
`POST /api/reports` has no route/controller gate but `ReportSubmissionService.php:388-400` enforces `nurse_id`
ownership; `ReportCommentController@destroy:75-82` adds an author-or-admin check.

**Honesty note on the inferred five.** The individual adjudication for `C-SEC-006`, `C-API-007`, `C-AUTHZ-008`,
`C-ARCH-010` and `C-ARCH-017` was not written back to `AUDIT_FINDINGS.md` or `AUDIT_PROGRESS.md`. Their
REFUTED status here is inferred, not quoted. If a definitive per-candidate ledger is required before
go-live, re-run the four verification steps in each candidate's "Verify by" column in `AUDIT_FINDINGS.md` and
record the result.

---

## OPEN / deferred (real, not fixed)

### C-DB-013 - Retention is essentially unmanaged (Medium, OPEN)
- **Verification:** VERIFIED from code; growth projections are PREDICTED.
- **What it is:** the only retention job is `reports:prune-notifications`, which deletes only *read*
  notifications older than 90 days (`PruneStaleNotifications.php:22-28`); unread ones are never pruned.
  `audit_logs` (its own migration calls it "the fastest-growing audit table"), `admin_audit_logs`,
  `report_status_history`, `report_field_values`, `evaluation_answers`, `morning_attendance`,
  `student_attendance` have no retention. `sanctum:prune-expired` is not scheduled. 13 unbounded tables.
- **Status:** not addressed by the remediation commit. This is the core input to the scalability section and
  should be tracked as an open operational item. Any growth figure derived from it is PREDICTED and, per the
  data-coverage caveat, several of the named tables are empty in the seeded DB so their rates are modelled,
  not measured. Evidence: `AUDIT_FINDINGS.md:303`.

---

## Carried-over concern still open

### PRE-5 - `access-request-page.tsx` hardcodes the academic signup role list (confirmed intentional)
`student_rep` cannot self-register through the SPA. The remediation deliberately left this alone: the design
is that `student_rep` is admin-appointed, not self-registering (`AUDIT_PROGRESS.md:380-382`, "deliberate
behaviour ... left alone"). **Disposition: REFUTED / confirmed intentional**, not a defect. Evidence:
`AUDIT_FINDINGS.md:383`.

---

## Reconciliation ledger against `AUDIT_FINDINGS.md`

| Item in `AUDIT_FINDINGS.md` | State in findings file | State in this register | Reconciles? |
|---|---|---|---|
| AUD-DB-001 | FIXED-VERIFIED | FIXED-VERIFIED | Yes |
| AUD-INFRA-003 | "FIXED - NOT YET VERIFIED IN CI" | FIXED-UNVERIFIED | Yes |
| AUD-DEPLOY-007 | FIXED-VERIFIED | FIXED-VERIFIED | Yes |
| AUD-API-002 (+002b) | FIXED-VERIFIED | FIXED-VERIFIED | Yes |
| AUD-SEC-004 | **"Open"** | FIXED-VERIFIED (per commit `43bbccc`) | **No - findings file stale** |
| AUD-SEC-005 | **"Open"** | FIXED-VERIFIED (per commit `43bbccc`) | **No - findings file stale** |
| AUD-DB-006 | **"Open"** | FIXED-VERIFIED (per commit `43bbccc`) | **No - findings file stale** |
| C-AUTHZ-001, C-SEC-002/003/004/005/009, C-DB-012/015/016 | **"PENDING EMPIRICAL VERIFICATION"** | FIXED-VERIFIED (per commit `43bbccc` artifacts) | **No - findings file not refreshed after remediation** |
| C-DB-011, C-PERF-014 | pending candidate | REFUTED (named in `43bbccc`) | **No - findings file not refreshed** |
| C-SEC-006, C-API-007, C-AUTHZ-008, C-ARCH-010, C-ARCH-017 | pending candidate | REFUTED (inferred; not recorded per-ID) | **Partial - count reconciles (7 of 23), IDs inferred** |
| C-DB-013 | pending candidate | OPEN / deferred | Consistent (never claimed fixed) |
| AUD-DB-018 (SQLite CHECK) | **absent** | FIXED-VERIFIED (new, from `43bbccc`) | **No - not present in findings file** |
| PRE-1, PRE-2, PRE-3, PRE-4 | carried-over concern | FIXED-VERIFIED | Consistent (findings file does not track fix state for PRE items) |
| PRE-5 | carried-over concern | REFUTED / intentional | Consistent |

**Single required action to make the two documents reconcile exactly:** refresh `AUDIT_FINDINGS.md` to record
the remediation - flip `AUD-SEC-004/005` and `AUD-DB-006` to FIXED-VERIFIED, move the nine fixed candidates
out of the "PENDING" section, add the `AUD-DB-018` SQLite-CHECK finding, and write the per-candidate REFUTED
adjudication for the five currently-inferred refutations. Until that is done, commit `43bbccc` (code,
migrations, tests) is the authoritative record and this register defers to it, citing the artifact on every
row where the findings file is stale.

---

## Verification and coverage boundaries (do not overstate)

- **Verified by execution:** both DB lanes (SQLite 313 passed / 1 skipped; MariaDB 314 passed / 0 failures,
  `mariadb-suite-postfix.txt:23`); the duty-roster 500 fix through nginx (PUT 200, audit row 5 to 6); both
  deployment blockers by rebuild-from-empty and a real 8.3.32 `composer install`.
- **Not executed from this machine:** CI green (`AUD-INFRA-003`, needs a push); the live broadcast-driver
  exploit path (`C-SEC-009`, dev uses `BROADCAST_CONNECTION=log`).
- **Reported separately:** browser-based role, authz, IDOR, enumeration, notification, lifecycle and
  responsive testing - see `PLAYWRIGHT_TEST_REPORT.md` (produced separately). 8 e2e specs were authored and
  committed (`af15ac0`) and the execution run is being produced in that workflow.
- **PREDICTED, never measured at scale:** all 1k/10k/100k and high-concurrency figures, and the growth
  behind `C-DB-013`. 20 of 53 tables are empty in the seeded DB, so no performance claim may be made about
  the audit, notification, or access-request paths from this dataset.
