# AUDIT FINDINGS

Confirmed issues only. Speculative or unreproduced observations belong in the "Unconfirmed observations"
section at the bottom and must never be promoted without evidence.

**Plan:** `FULL_SYSTEM_AUDIT_PLAN.md` · **Progress:** `AUDIT_PROGRESS.md` · **Commands:** `AUDIT_COMMAND_LOG.md`

Issue ID format: `AUD-<AREA>-<NNN>` where AREA is one of
`AUTH` `AUTHZ` `WORKFLOW` `UI` `API` `SEC` `PERF` `DB`

Severity: `Critical` · `High` · `Medium` · `Low` · `Informational`

Fix status: `Open` · `In progress` · `Fixed - unverified` · `Fixed - verified` · `Won't fix` · `Not reproducible`

---

## OPEN ISSUES

Surfaced 2026-07-21 by the Docker production-parity lane (MariaDB 11.4 + nginx + PHP-FPM), which exists
precisely because none of these are observable on the SQLite dev lane.

**Suite comparison, same commit:**
| Lane | Result |
|---|---|
| SQLite (dev + CI default) | 281 tests, **280 passed, 1 skipped**, 0 failures |
| MariaDB (production DB engine) | 281 tests, **7 failures, 3 errors, 0 skipped** |

Ten tests fail on the database engine production actually uses. They pass locally because SQLite is
permissive where MariaDB is strict.

---

### AUD-DB-001 - Migrations cannot run on MariaDB: index name exceeds the 64-character limit

| Field | Value |
|---|---|
| **Severity** | **CRITICAL - deployment blocker** |
| **Category** | Database / release engineering |
| **Affected role(s)** | All (nobody can be deployed to) |
| **Affected module** | Undergraduate / teaching sessions |
| **Environment** | MariaDB 11.4 (production engine). Invisible on SQLite. |
| **Verification** | **Independently verified by the auditor**, not agent-reported |
| **Fix status** | Open |

**Reproduction**
1. Point the app at MariaDB and run `php artisan migrate --force` (exactly what `deploy/deploy.sh` runs).
2. Migration `2026_08_12_000010_create_undergraduate_tables.php:96` executes
   `$table->unique(['batch_id', 'subgroup', 'activity_type', 'scheduled_date'])` on `teaching_sessions`.

**Expected** Migrations complete; the app boots.
**Actual** `SQLSTATE[42000]: 1059 Identifier name 'teaching_sessions_batch_id_subgroup_activity_type_scheduled_date_unique' is too long`.

**Auditor's own measurement:** the generated identifier is **71 characters** against MariaDB's **64**-char
limit - over by 7. A repo-wide scan found this is the **only** occurrence.

**Impact** `deploy/deploy.sh` runs `migrate --force`, so **the department server cannot be deployed to as
the code stands**. Worse, MariaDB has no transactional DDL, so the half-applied migration then masks itself
behind `1050 Table already exists` on retry, making the true cause hard to find during a live deployment.

**Recommended fix** Name the index explicitly and keep it under 64 chars, e.g.
`$table->unique([...], 'teaching_sessions_slot_unique');`. One line.

**Regression test** Add a MariaDB lane to CI that runs `migrate:fresh` (see AUD-INFRA-003 - the existing
lane is broken, which is why this was never caught).

---

### AUD-INFRA-003 - The entire CI pipeline cannot install dependencies

| Field | Value |
|---|---|
| **Severity** | **CRITICAL** |
| **Category** | Release engineering |
| **Environment** | GitHub Actions |
| **Verification** | **Independently verified by the auditor** - and found to be broader than first reported |
| **Fix status** | Open |

**Reproduction** `composer install` on any CI job.

**Auditor's own measurement:** `.github/workflows/ci.yml` pins `php-version: '8.3'` at lines **51, 105 and
156** - i.e. **all three jobs**, not only the MariaDB one. `backend/composer.lock` contains **17 packages
requiring `php >=8.4.1`** (`symfony/console`, `symfony/clock`, `symfony/error-handler`,
`dragonmantank/cron-expression`, and 13 more).

**Impact** No CI job can install dependencies, so **CI cannot have been green at any point since the
lock file was updated**. This is the root cause of why AUD-DB-001 reached this branch undetected, and why
`MariaDbConcurrencyRegressionTest` had never executed anywhere. The audit's green local suite is not
evidence of a healthy pipeline.

**Recommended fix** Raise all three jobs to PHP 8.4 to match `composer.lock` and the documented runtime.

---

### AUD-API-002 - Saving a duty roster month returns 500 on MariaDB

| Field | Value |
|---|---|
| **Severity** | High |
| **Category** | Backend / data integrity |
| **Affected role(s)** | admin, superadmin |
| **Affected module** | Duty roster |
| **Verification** | Agent-reported from the MariaDB lane. **Not yet independently reproduced by the auditor.** |
| **Fix status** | Open |

**Actual** `DutyRosterController.php:198-202` writes `sprintf('%04d-%02d', ...)` - i.e. the string
`'2026-07'` - into `admin_audit_logs.entity_id`, which is a native `uuid` column. SQLite accepts it;
MariaDB rejects it. Reported to account for **7 of the 10** suite failures.

**Next step** Reproduce directly against the MariaDB lane and confirm the failing assertion before fixing.

---

### AUD-SEC-004 - No CSP and no HSTS on the SPA document

| Field | Value |
|---|---|
| **Severity** | Medium |
| **Category** | Security headers |
| **Verification** | Agent-reported from captured headers. Auditor to re-capture. |
| **Fix status** | Open |

Both headers are emitted by Laravel middleware, so they appear on `/api` and `/sanctum` responses but
**not on the HTML document nginx serves**. A CSP that never reaches the document protects nothing against
XSS in the SPA. Only observable on this lane - the Vite dev server does not use `deploy/nginx.conf`.

---

### AUD-SEC-005 - Conflicting duplicate `Referrer-Policy`, duplicated `Cache-Control`

| Field | Value |
|---|---|
| **Severity** | Low |
| **Category** | Security headers |
| **Verification** | Agent-reported. Auditor to re-capture. |
| **Fix status** | Open |

`Referrer-Policy` is sent **twice with conflicting values** (`strict-origin-when-cross-origin` vs
`same-origin`); `Cache-Control` is duplicated on assets. Both originate in `deploy/nginx.conf`, so they
affect the **real production server**, not just the container.

---

### AUD-DB-006 - Concurrency test teardown violates a foreign key

| Field | Value |
|---|---|
| **Severity** | Low (test-only) |
| **Category** | Test hygiene |
| **Verification** | Agent-reported |
| **Fix status** | Open |

`MariaDbConcurrencyRegressionTest`'s `finally` teardown deletes users while `admin_audit_logs` still
references them (FK 1451). **All three concurrency scenarios themselves PASS** with 14 assertions
executed - the error is teardown only. Worth noting: this is the first time this test has ever run.

---

## CODE-DERIVED CANDIDATES - PENDING EMPIRICAL VERIFICATION

Produced by phase-1 discovery (read-only code inspection, 2026-07-21). Every entry cites file:line.

**These are NOT confirmed defects.** The audit instruction requires that conclusions rest on executed
tests, not code reading alone. Each becomes a real issue only when a test reproduces it against the
running system; each becomes closed if a test shows the code reads worse than it behaves. Ranked by
apparent severity.

Evidence: `artifacts/audit-2026-07-21/discovery/02-backend-routes.md` (+ .part2/.part3)

| ID | Apparent severity | Candidate defect | Verify by |
|---|---|---|---|
| C-AUTHZ-001 | **High** (functional) | Residents and consultants can never read their own notifications. All 5 notification routes require `permission:notifications.view` (`api.php:77-81`), but that permission is granted only to superadmin/admin/nurse/student_rep (`Permissions.php:120,153,171,192`). Yet `MorningSessionService.php:237-239` notifies designated morning recorders (residents/consultants) and `TransferService.php:345` notifies consultants. Those notifications appear to be undeliverable to their intended recipients. | Log in as resident and as consultant, GET `/api/notifications`, expect 403; then trigger the morning-recorder and transfer-decision notify paths and confirm rows exist that the recipient cannot read |
| C-SEC-002 | **High** (unauthenticated write) | `POST /api/access-requests` is public (`api.php:51`, throttle 10/min) and writes a real inactive row into `users` (`AccessRequestSubmissionController.php:92-101`) with **no pending-duplicate guard**, unlike its two siblings. All three registration endpoints also loop every active admin and INSERT one notification each, synchronously (`:141-154`, `:102-115`, `:72-85`). Unauthenticated write amplification. | Anonymous POST repeatedly with the same email; count rows in `users`, `access_requests`, `notifications`; measure notification rows as a function of admin count |
| C-SEC-003 | **High** (auth bypass path) | `POST /api/access-requests` carries no auth middleware yet reads `Auth::guard('web')->user()` (`:27`), and `statefulApi` is enabled (`bootstrap/app.php:48-51`), so a session cookie IS honoured. It therefore bypasses both `EnsureActiveUser` and `EnsurePasswordChanged`. | Hold a session for a user with `password_change_required=true` and POST; confirm it succeeds where every other authed route 403s |
| C-SEC-004 | **Medium** | Account-enumeration oracle: all three registration endpoints return distinct 422 messages separating "account exists" from "request already pending" (`AccessRequestSubmissionController.php:81-85`; `AcademicRegistrationController.php:42-46,48-52`; `AdminRegistrationController.php:37-41,43-47`). `PasswordResetController@forgot` is correctly non-enumerating (`:34-36`), so the same surface is protected inconsistently. | Probe each endpoint with a known and an unknown email; diff the responses and status codes |
| C-SEC-005 | **Medium** (DoS primitive) | Three `/api` routes have no throttle at all: `POST /api/auth/change-password`, `POST /api/auth/logout`, `GET /api/auth/me` (`api.php:43-47`). `change-password` performs a bcrypt verify (`AuthController.php:66`) plus a bcrypt re-hash (`:74-77`) at unlimited rate - a CPU-exhaustion primitive available to any single logged-in account. | Measure sustained request rate and server CPU against `change-password` with a valid session |
| C-SEC-006 | **Medium** | `PUT /storage/{path}` and `GET /storage/{path}` exist with NO middleware because `config/filesystems.php:36` sets `'serve' => true` on the local disk. The PUT writes arbitrary bytes (`ReceiveFile.php:33`), guarded only by an APP_KEY-relative signature (`:28-31,45-47`) - not by auth, not throttled. `/broadcasting/auth` is on the `web` group with no `auth:sanctum`, no throttle, no active check. | Attempt unsigned and signed PUT; confirm what a valid signature grants and whether path traversal is possible |
| C-API-007 | **Medium** | `GET /api/academic/morning-sessions/today` **creates a database row** (`MorningSessionController.php:44-50` calls `openFor($today)`). A non-idempotent, state-mutating GET: any prefetcher, crawler or proxy can create the day's session. `GET /api/analytics/*` likewise writes cache and registers `app()->terminating` (`DashboardAnalyticsService.php:70,84,138,157,187`). | Issue a bare GET as a recorder and diff the `morning_sessions` table before/after |
| C-AUTHZ-008 | **Medium** | `MorningSessionController@cancel` is reachable via TWO routes with different middleware: `api.php:122` gates on `morningAttendance.record` (held by resident/consultant) while `api.php:244` gates on `academic.manage` (superadmin/admin only). Both reach the same single `Gate::authorize('cancel', ...)` at `:171`. The weaker route wins; only `MorningSessionPolicy::cancel` (`:56-69`) holds the line. | Cancel via the weaker route as a non-recorder resident, and as a recorder on a non-today/non-pending session |
| C-SEC-009 | **Low now, High on-prem** | The broadcast channel `App.Models.User.{id}` (`channels.php:11-13`) checks identity only - no `active`, no `password_change_required`. `Gate::before`'s inactive-user shortcut (`AppServiceProvider.php:77`) does **not** cover `Broadcast::channel` callbacks. Currently inert because `BROADCAST_CONNECTION=log`, but becomes live on the on-prem deployment. | Verify on the Docker prod-parity lane with a real broadcast driver, not on the dev lane |
| C-ARCH-010 | Informational | Nine controllers have zero in-action authorization; permission middleware is the sole control. Largest block is `AnalyticsController` (12 routes, `api.php:83-98`), gated only by `analytics.view` with no per-department scoping visible. | Confirm whether analytics leaks cross-department data to a role that should be scoped |

**Recorded as verified NOT holes** (so later agents do not re-chase them): `POST /api/reports` has no route or
controller gate, but `ReportSubmissionService.php:48 -> authorizeAssignmentEdit (:388-400)` enforces
`nurse_id` ownership. `ReportCommentController@destroy` adds an author-or-admin check at `:75-82`.

### Schema-derived candidates (evidence: `discovery/01-database-schema.md`)
53 tables, 61 migrations, 80,025 rows in the dev DB.

| ID | Apparent severity | Candidate defect | Verify by |
|---|---|---|---|
| C-DB-011 | **High** (same class as the confirmed AUD-DB-001) | **29 `->enum()` declarations become plain `varchar` with NO CHECK constraint on SQLite** but value-rejecting `ENUM`s on MySQL/MariaDB. Confirmed in live pragma output. Every status field is therefore unvalidated locally and strict in production - the same dev/prod divergence class that produced the deployment blocker. Additionally `2026_08_30_000020:46` throws on any driver that is not sqlite/mysql/mariadb, so Postgres cannot migrate, while `config/database.php:46` says "Prod should use MySQL/Postgres". | Write an out-of-range status value on both lanes; compare |
| C-DB-012 | **High** (data integrity, already occurring) | **`evaluations` has ZERO unique constraints** (`2026_08_05_000020:39-44` declares six plain indexes, no uniques). The live dev DB **already contains 4 duplicate groups** - same author, same subject, same date, same form. Either legitimate double-rounds or a double-submit bug; the schema does not say. | Submit the same evaluation twice through the UI and API; check whether the service layer blocks it and what analytics do when it does not |
| C-DB-013 | **Medium** (operational, grows forever) | **Retention is essentially unmanaged.** The only retention job is `reports:prune-notifications`, and `PruneStaleNotifications.php:22-28` deletes only **read** notifications older than 90 days - unread ones are never pruned. `audit_logs`, described by its own migration as "the fastest-growing audit table", has no retention at all; nor do `admin_audit_logs`, `report_status_history`, `report_field_values`, `evaluation_answers`, `morning_attendance`, `student_attendance`. `sanctum:prune-expired` is **not scheduled**. 13 unbounded tables total. | Project growth from seeded rates; this is the core of the scalability section |
| C-PERF-014 | **Medium** | **44 foreign keys have no supporting index.** Most consequential: `report_field_values.field_definition_id` was indexed at creation then deliberately dropped (`2026_05_29_000000:41`) as "a strict prefix of the unique index" - correct for lookups by report, but leaves per-field aggregation and any field-definition DELETE as a **61,001-row scan on the largest table**. Also `student_attendance.student_id` has no index while the analogous `morning_attendance.user_id` does - reads as oversight, not design. | Capture `EXPLAIN QUERY PLAN` / MariaDB `EXPLAIN` for per-field aggregation and per-student history |
| C-DB-015 | **Medium** | **Migration rollback produces a third state.** `2026_08_26_000010` and `2026_08_30_000040` disagree: the second clears `is_core` for both forms then re-sets the same four fields (making the first dead weight), but its `down()` at `:28-36` restores a **different, larger** set, silently locking extra fields from editing. | Roll back and inspect `is_core` |
| C-DB-016 | Low | **No date-ordering constraint anywhere on `duty_assignments`**, and no unique constraint of any kind - overlap is enforced only in `RosterService` inside a transaction. The seeded DB already contains a row with `starts_on = ends_on = '2320-02-12'`. | Post an assignment with `ends_on < starts_on`, and a far-future date, via the API |
| C-ARCH-017 | Informational (dev lane only) | `sessions`, `cache`, `cache_locks`, `jobs`, `job_batches`, `failed_jobs` share the **same SQLite file** as clinical data. WAL fixes reader/writer contention but not writer/writer, so every session and cache write serialises against report submission. Does not apply to the prod-parity lane, where these are MariaDB tables. | Compare write throughput across the two lanes |

### CRITICAL CAVEAT for every performance and behaviour conclusion
**20 of the 53 tables are completely empty in the dev DB**, including `audit_logs`, `notifications`,
`report_status_history`, `access_requests`, `admin_access_requests`, `action_items`, `report_comments`
and `calculated_metrics`. Real volume exists in only four tables: `report_field_values` 61,001,
`evaluation_answers` 8,804, `morning_attendance` 6,440, `student_attendance` 900.

No performance or scalability claim may be made about the empty paths from this dataset. Either seed them
first or explicitly mark those areas UNTESTED in the final report. This constraint applies to the
prod-parity lane too, which was seeded from the same seeders.

### Note on C-SEC-004 and work already in flight
The enumeration finding independently corroborates the design decision already taken for the pending
"awaiting approval" login message: reveal pending status only after the submitted password matches, so the
login form does not become a second enumeration oracle. See PRE-3 below. That fix should be extended to
cover the three registration endpoints named in C-SEC-004, which are the larger exposure.

---

## ISSUE TEMPLATE (copy per finding)

### AUD-XXX-000 - <title>

| Field | Value |
|---|---|
| **Severity** | |
| **Category** | |
| **Affected role(s)** | |
| **Affected module** | |
| **Environment** | local dev (Vite :5173 / Laravel :8000 / SQLite) |
| **Preconditions** | |
| **Fix status** | Open |
| **Regression test** | None yet |

**Reproduction steps**
1.
2.

**Expected result**

**Actual result**

**Evidence**
- Screenshot:
- Video:
- Trace:
- Request/response:
- Log:

**Relevant files**
- Frontend:
- Backend:
- DB table / query:

**Suspected root cause**

**Security / business impact**

**Recommended fix**

**Regression-test recommendation**

---

## CARRIED-OVER CONCERNS (pre-audit, from prior work in this repo)

These were identified before the audit began and are recorded so the audit either confirms or clears them.
They are **not** counted as audit findings until independently reproduced with evidence.

| Ref | Concern | Status |
|---|---|---|
| PRE-1 | Public academic signup created an active account with no approval step. A fix was in flight at audit start (workflow `wf_1daf517d-18d`). | To be re-verified after BLOCKER-1 clears |
| PRE-2 | `UserPolicy::update` let an admin deactivate but not edit academic users. Fix in flight in the same workflow. | To be re-verified after BLOCKER-1 clears |
| PRE-3 | A pending applicant attempting to log in receives a generic "credentials do not match" with no indication that approval is pending. Planned follow-up: reveal pending status only after the submitted password matches, to avoid account enumeration. | Not yet implemented |
| PRE-4 | `WorkspaceController` carries a duplicate `defaultTitle()` that renders a null-title student rep as "Nurse". | Not yet fixed |
| PRE-5 | `src/pages/auth/access-request-page.tsx` hardcodes the academic signup role list, so `student_rep` cannot self-register (likely intentional, unconfirmed). | To be confirmed as intentional |

---

## UNCONFIRMED OBSERVATIONS

_Observations noticed during testing that lack reproduction or evidence. Promote to an issue only with evidence._

_None yet._
