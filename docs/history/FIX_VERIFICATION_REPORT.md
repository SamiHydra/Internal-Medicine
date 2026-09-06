# FIX VERIFICATION REPORT

**System:** St Paul's IM hospital reporting and academic platform (Laravel + Sanctum backend, React SPA)
**Audit date:** 2026-07-21 to 2026-07-22
**Scope of this document:** every finding the audit changed code for, what changed, the regression test that
guards it, and how the fix was verified. Fixes proven by reproducing the original failure are separated from
fixes proven only by a passing test. Outstanding items are listed honestly at the end.

**Source evidence for every claim below**
- `AUDIT_FINDINGS.md` (finding IDs, fix descriptions, verification notes)
- `AUDIT_PROGRESS.md` CHECKPOINT 5 to 8 (the remediation narrative)
- `AUDIT_COMMAND_LOG.md` commands 13 to 30 (the prod-parity lane build and baseline suite runs)
- `artifacts/audit-2026-07-21/evidence/mariadb-suite-full.txt` (baseline: 7 failures / 3 errors)
- `artifacts/audit-2026-07-21/evidence/mariadb-suite-postfix.txt` (post-fix: 314 OK on PHP 8.3.32)
- `artifacts/audit-2026-07-21/evidence/mariadb-failure-triage.md` (the 10-failure adjudication)
- Git commits `540c067`, `6bb360f`, `43bbccc`, `af15ac0` (the fixes themselves)

A note on honesty of scope. The role-based Playwright browser sweep was authored and committed
(`af15ac0`) but had **not been executed** when the code fixes below were verified. Every verification in this
report therefore rests on backend regression suites, the production-parity Docker stack, and direct
reproduction, never on browser e2e results. The browser run is being produced separately; see
`PLAYWRIGHT_TEST_REPORT.md (produced separately)`.

---

## 1. Verification taxonomy used in this report

The audit brief requires that VERIFIED (executed and reproduced) be distinguished from everything weaker.
This report uses three grades, and every fix below is tagged with one of them.

| Grade | Meaning | What backs it |
|---|---|---|
| **REPRODUCED** | The original failure was reproduced, the fix applied, and the exact failing operation re-run and shown to succeed | An executed command with a before/after result |
| **TEST-VERIFIED** | A regression test that fails without the fix now passes, and both database lanes are green, but the live user journey for this specific finding was not separately reproduced | The regression suite on both lanes |
| **FIXED-UNVERIFIED** | Code is changed and locally sound, but the environment that would confirm it (GitHub Actions) cannot be exercised from this machine | Premise verified, final confirmation pending |

---

## 2. Suite-level evidence: the headline before and after

The whole remediation was gated against both database engines. This is the single most important piece of
verification evidence, because it is the production database engine (MariaDB) that carried the defects SQLite
could not see.

| Lane | Before remediation | After remediation | Evidence |
|---|---|---|---|
| SQLite (dev + CI default) | 281 tests, 280 passed, 1 skipped, 0 failures | **313 passed, 1 skipped, 0 failures** | Before: `AUDIT_FINDINGS.md:24-26`. After: commit `43bbccc` message + `AUDIT_PROGRESS.md:409-411` |
| MariaDB 11.4 (production engine) | 281 tests, **7 failures, 3 errors**, 0 skipped | **OK (314 tests, 2188 assertions), 0 failures, 0 errors** | Before: `artifacts/audit-2026-07-21/evidence/mariadb-suite-full.txt`, `AUDIT_COMMAND_LOG.md` cmd 30. After: `artifacts/audit-2026-07-21/evidence/mariadb-suite-postfix.txt` |

The post-fix MariaDB run is on disk and was executed on **PHP 8.3.32** (the production runtime, not the 8.4
the parity lane originally used):

```
Runtime:       PHP 8.3.32
Configuration: /opt/imreport/current/backend/phpunit.mariadb.xml
..............................................................  314 / 314 (100%)
Time: 00:46.956, Memory: 85.00 MB
OK (314 tests, 2188 assertions)
```
(`artifacts/audit-2026-07-21/evidence/mariadb-suite-postfix.txt:12-23`)

The remediation commit records **16 findings fixed** and **32 regression tests added, each verified to fail
before its fix** (`43bbccc` message). The test-file additions in that commit corroborate the test count:
four new test files (`AccessRequestSubmissionTest.php` +299, `SchemaConstraintTest.php` +160,
`NotificationRoleAccessTest.php` +132, `AuthThrottleTest.php` +99) and ten expanded ones
(`AuthApiTest.php` +151, `RosterTest.php` +117, `MariaDbConcurrencyRegressionTest.php` +112,
`AcademicEvaluationApiTest.php` +65, `V2OperationalConfigurationTest.php` +60, `AcademicRegistrationTest.php`
+58, `AdminRegistrationTest.php` +52, `ChannelAuthorizationTest.php` +32, `WorkspaceApiTest.php` +17,
`EvaluationFormEngineTest.php` +4).

---

## 3. Deployment blockers (both REPRODUCED)

These two are the reason the department server could not be deployed to as the code stood. Both were verified
by reproducing the deployment operation, not by inspection.

### AUD-DB-001 - migrations could not run on MariaDB (index name over 64 chars) - REPRODUCED

- **What changed:** `backend/database/migrations/2026_08_12_000010_create_undergraduate_tables.php` line ~96/99.
  The auto-generated unique index name on `teaching_sessions` was 71 characters
  (`teaching_sessions_batch_id_subgroup_activity_type_scheduled_date_unique`), over MariaDB's 64-char limit.
  Named it explicitly: `$table->unique([...], 'teaching_sessions_slot_unique')` (29 chars). Commit `540c067`.
- **Regression test:** `backend/tests/Feature/SchemaConstraintTest.php` (new, 160 lines) asserts no
  generated identifier exceeds the limit, and it runs on **both** lanes. This replaced the container-only
  patch script `docker/patches/apply-parity-patches.sh`, which commit `43bbccc` deleted (90 lines removed).
- **How verified (REPRODUCED):** the container database was destroyed and rebuilt from empty.
  `docker compose down -v` then `docker compose build && docker compose up -d --wait` returned **exit 0**
  with all services healthy; **72 migration/seeder steps** completed, the same `migrate --force` path
  `deploy/deploy.sh` runs. The index was confirmed present in MariaDB's catalogue as
  `teaching_sessions_slot_unique`. The previously-required container patch now reports
  `PATCH 1 skipped: migration already carries an explicit index name (defect fixed upstream)`.
  Evidence: `AUDIT_FINDINGS.md:45-61`, `AUDIT_PROGRESS.md:363-366`.

### AUD-DEPLOY-007 - composer.lock required PHP 8.4; the server runs 8.3 - REPRODUCED

- **What changed:** root-cause fix, not just a version bump. `backend/composer.json` now pins
  `config.platform.php = "8.3.0"`, so the lock can never again resolve against a PHP newer than the server;
  `php composer.phar update` re-resolved the lock (**31 downgrades**, Symfony 8.1.x to 7.4.x);
  `.github/workflows/ci.yml` reverted to PHP 8.3 in all three jobs; `docker/Dockerfile` and `compose.yaml`
  moved from PHP 8.4 to 8.3 so the parity lane matches production. Commit `6bb360f`.
- **Regression protection:** the parity lane itself now runs on 8.3 (so the suite exercises the real runtime),
  and `backend/tests/Feature/V2OperationalConfigurationTest.php` (+60) guards deployment readiness with
  `deploy/` now copied into the test image (see AUD-INFRA / H2 below).
- **How verified (REPRODUCED) on a genuine 8.3 runtime:**

  | Check | Result |
  |---|---|
  | `docker compose build` on the 8.3 image | exit 0 |
  | `composer install --no-dev --optimize-autoloader` inside it (the exact `deploy.sh:149` command) | **91 installs, 0 updates, 0 removals**, optimized autoload generated |
  | `docker compose up -d --wait` | exit 0, all services healthy |
  | `php -v` in the app container | **PHP 8.3.32** confirmed, not assumed |

  The operation that failed on the department server now demonstrably succeeds on the same PHP version the
  server runs. Evidence: `AUDIT_FINDINGS.md:144-153`, `AUDIT_PROGRESS.md:366`.

### AUD-INFRA-003 - the CI pipeline could not install dependencies - FIXED-UNVERIFIED

- **What changed:** superseded by AUD-DEPLOY-007. CI was reverted to PHP 8.3 in all three jobs (`ci.yml`
  lines 51, 105, 156), matching production after the lock was re-resolved to install on 8.3.
- **Recorded auditor error, not hidden:** the first attempt raised CI to 8.4 to match the lock. That was
  backwards; it would have produced a green CI against a server that still could not install (a false green,
  exactly the failure class this audit exists to catch). Reverted, and retained in `AUDIT_FINDINGS.md:95-106`
  for the audit trail.
- **Honest verification limit:** GitHub Actions cannot be executed from this machine. The premise is verified
  (the pinned 8.3 lock installs cleanly, proven under AUD-DEPLOY-007), but **whether CI actually goes green
  must be confirmed on the next push.** This remains FIXED-UNVERIFIED. Evidence: `AUDIT_FINDINGS.md:85-121`.

---

## 4. The headline data-integrity fix (REPRODUCED end to end through nginx)

### AUD-API-002 / AUD-API-002b - saving a duty roster month returned 500 on MariaDB - REPRODUCED

- **Root cause:** `DutyRosterController.php:198-202` writes `sprintf('%04d-%02d', ...)`, the string `'2026-07'`,
  into `admin_audit_logs.entity_id`, which MariaDB 11.4 declares as a **native `uuid` type**
  (`2026_05_25_180140_create_admin_audit_logs_table.php:17`). SQLite stores it as plain varchar and accepts
  it; MariaDB rejects it with `SQLSTATE[22007]: 1292 Incorrect uuid value`. This single defect accounted for
  **7 of the 10** MariaDB suite failures. The column is a documented free-form key, not a UUID
  (`AuditLogController.php:74-75`: some rows key on a period like "2026-07"). Full adjudication:
  `artifacts/audit-2026-07-21/evidence/mariadb-failure-triage.md:29-111`.
- **What changed:**
  1. Migration `backend/database/migrations/2026_09_16_000010_relax_admin_audit_log_entity_id.php` (new, 41
     lines) widens `admin_audit_logs.entity_id` from native `uuid` to `string(64)` nullable. Lossless: every
     existing value is canonical UUID text, SQLite is already varchar (dev-lane no-op).
  2. `saveMonth` wrapped in a single `DB::transaction` (AUD-API-002b), so an audit failure can no longer leave
     partially-committed roster state behind a 500. The triage confirmed the pre-fix behaviour committed the
     duty-assignment rows and lost only the audit INSERT (`mariadb-failure-triage.md:81-90`).
  3. The fix deliberately did **not** patch the controller to emit a UUID, which would have broken the
     `entity_id=2026-07` filter contract admins rely on for roster-month history.
- **Regression tests:** `backend/tests/Feature/RosterTest.php` (+117) covers the month read/write and the
  rotation-override branch; `backend/tests/Feature/AdminAuditService`-touching paths retain the byte-faithful
  fixture at `AcademicAuditTrailTest.php:142` that keeps `entity_id` free-form.
- **How verified (REPRODUCED), executed through nginx on the MariaDB stack at https://localhost:8443:**
  csrf 204 to login 200 to `PUT /api/admin/roster/2028/3` returning **HTTP 200** (was 500), and
  `admin_audit_logs` where `entity_type='duty_roster'` went from **5 rows to 6**. The MariaDB suite that
  carried this failure is now OK. Evidence: `AUDIT_FINDINGS.md:210-213`, `AUDIT_PROGRESS.md:410-411`,
  commit `43bbccc` message.

---

## 5. Security-header fixes (REPRODUCED against the served document)

### AUD-SEC-004 - no CSP and no HSTS on the SPA document - REPRODUCED

- **Root cause:** CSP/HSTS were emitted by Laravel middleware, so they appeared on `/api` and `/sanctum`
  responses but never on the HTML document nginx serves from disk. A CSP that never reaches the only response
  that can execute script protects nothing (`AUDIT_FINDINGS.md:232-234`).
- **What changed:** `deploy/nginx.conf` now sets CSP, HSTS and Permissions-Policy on the SPA document, matched
  to the policy `public/_headers` and `public/.htaccess` already carried, so every hosting path enforces one
  policy. A `$imreport_cache_control` map fixes the nginx `add_header`-is-replace-not-merge trap that had been
  silently stripping `nosniff` from `/assets/` and `/sw.js`.
- **How verified (REPRODUCED):** verified in a real headless Chromium against the parity lane, not by header
  presence alone. Sign-in succeeds; `/admin/users`, `/admin/reports`, `/admin/notifications`,
  `/admin/settings`, `/admin/templates` all render; the workspace switcher works; a Radix combobox opens with
  its options and its scroll-lock. **Zero console CSP violations** across all of that. The policy keeps
  `style-src 'unsafe-inline'` (required by Radix runtime `<style>` injection) but carries no `unsafe-eval`; a
  grep for `new Function` / `Function("")` across all 79 built assets returns nothing. Evidence: commit
  `43bbccc` `deploy/nginx.conf` header comment and message.

### AUD-SEC-005 - conflicting duplicate Referrer-Policy, duplicated Cache-Control - REPRODUCED

- **What changed:** the conflicting duplicate `Referrer-Policy` (`strict-origin-when-cross-origin` vs
  `same-origin`) collapsed to one, and the duplicated `Cache-Control` on assets resolved via the single-source
  `$imreport_cache_control` map, all in `deploy/nginx.conf`.
- **How verified (REPRODUCED):** verified against the served document on the parity lane in the same headless
  browser pass as AUD-SEC-004. Evidence: commit `43bbccc` message, `AUDIT_FINDINGS.md:238-249`.

---

## 6. Application-logic and authorization fixes (TEST-VERIFIED)

Each of the following was reproduced against the running stack before being changed, then guarded by a
regression test verified to fail without the fix (commit `43bbccc` message). The suite is green on both lanes
(section 2). They are graded TEST-VERIFIED rather than REPRODUCED because the specific user journey for each
was proven by its regression test rather than re-driven by hand through the browser.

| Finding | What changed (file) | Regression test | Verification |
|---|---|---|---|
| **C-AUTHZ-001** residents and consultants could never read the notifications the system sends them (morning-recorder reminders, transfer decisions) | `Permissions.php` grants `NOTIFICATIONS_VIEW` to `resident` and `consultant`; the comment records that this grants no cross-user visibility because `NotificationController` pins non-admin callers to their own `recipient_id` | `NotificationRoleAccessTest.php` (new, 132 lines) | Both lanes green; test fails without the grant |
| **C-SEC-005** three auth routes had no throttle; `change-password` ran an unlimited bcrypt verify + re-hash (CPU-exhaustion primitive) | `routes/api.php`: `/me` and `/logout` wrapped in `throttle:300,1` (same unprefixed key as the API so they cannot sidestep it); `change-password` gets `throttle:6,1,change-password` with a named limiter prefix so it does not share the API-wide counter | `AuthThrottleTest.php` (new, 99 lines) | Both lanes green |
| **C-SEC-009** broadcast channel `App.Models.User.{id}` checked identity only, not `active` or `password_change_required`; `Gate::before`'s inactive shortcut does not cover `Broadcast::channel` callbacks | `Support/Broadcasting/UserChannel.php` re-asserts both session gates inside `authorize()` (a deactivated account is not session-flushed, so without this a revoked user keeps a live subscription) | `ChannelAuthorizationTest.php` (+32) | Both lanes green |
| **C-SEC-002 / C-SEC-003** public `POST /api/access-requests` wrote an inactive `users` row with no pending-duplicate guard, fanned out one notification per active admin synchronously, and honoured a `web` session cookie (bypassing the forced-password-change gate) | `AccessRequestSubmissionController.php` (+190) adds the duplicate guard and closes the session-bypass path | `AccessRequestSubmissionTest.php` (new, 299 lines) | Both lanes green |
| **C-SEC-004 / PRE-3** account-enumeration oracle across the three registration endpoints; and the pending-approval login message | The three registration controllers (`AccessRequestSubmissionController`, `AcademicRegistrationController`, `AdminRegistrationController`) no longer separate "account exists" from "request pending"; `AuthController` reveals pending status only **after** the submitted password matches, so login is not an oracle | `AuthApiTest.php` (+151), `AcademicRegistrationTest.php` (+58), `AdminRegistrationTest.php` (+52) | Both lanes green |
| **C-DB-012** `evaluations` had zero unique constraints; the dev DB already held 4 duplicate groups | Migration `2026_09_16_000020_enforce_evaluation_submission_uniqueness.php` (new, 146 lines) enforces submission uniqueness (written to survive the 4 existing duplicate groups per the review's named risk) | `AcademicEvaluationApiTest.php` (+65), `EvaluationFormEngineTest.php` (+4) | Both lanes green |
| **C-DB-016** no date-ordering constraint on `duty_assignments`; the seed already held a `2320-02-12` row | A duty-date guard added in the roster path | `RosterTest.php` (+117) | Both lanes green |
| **C-DB-011 / C-DB-015** two SQLite CHECK constraints lost to table rebuilds; migration rollback produced a third `is_core` state | Migration `2026_09_16_000030_restore_sqlite_enum_check_constraints.php` (new, 77 lines) restores the CHECK constraints; `2026_08_30_000040_restore_evaluation_core_field_contract.php` (+24) corrects the divergent `down()` | `SchemaConstraintTest.php` (new, 160 lines) | Both lanes green |
| **AUD-DB-006 / H1** `MariaDbConcurrencyRegressionTest` teardown deleted users while `admin_audit_logs` still referenced them (FK 1451), poisoning every alphabetically-later test | `MariaDbConcurrencyRegressionTest.php` (+112) and `tests/Support/MariaDbConcurrencyWorker.php` (+160/-) delete audit rows child-first, assert the cleanup worked, and reset `RefreshDatabaseState::$migrated` for order-independence | The test itself, now executing (all 3 concurrency scenarios pass, 14 assertions) | MariaDB lane green, 0 errors |
| **H2** the deployment-safety test was dark because `deploy/` was not in the test image | `docker/Dockerfile` copies `deploy/` into the test stage | `V2OperationalConfigurationTest.php` (+60) | Test now runs and passes on the MariaDB lane |
| **H3** parity lane ran PHP 8.4 while production runs 8.3 | `docker/Dockerfile` and `compose.yaml` pinned to 8.3 | Whole suite re-run on 8.3.32 | `mariadb-suite-postfix.txt` (PHP 8.3.32, 314 OK) |

---

## 7. Candidates checked and cleared (REFUTED, no code changed)

The audit reproduced these against the running stacks before concluding, and left them untouched because they
were intentional design or false premises. They are recorded here so they are not re-chased and not miscounted
as defects. The remediation commit states **7 of 23 candidates were refuted** (`43bbccc` message).

- **"44 foreign keys have no supporting index" (C-PERF-014)** did not hold on MariaDB. Refuted
  (`43bbccc` message).
- **"29 enum columns are unvalidated" (C-DB-011 as a defect)** did not hold on MariaDB; the enum columns are
  strict `ENUM`s on the production engine. The only real residue (SQLite CHECK constraints lost to rebuilds)
  was fixed, see section 6. Refuted as a production defect (`43bbccc` message).
- **`POST /api/reports` route/controller has no gate** was checked and cleared before the audit began:
  `ReportSubmissionService.php:48 -> authorizeAssignmentEdit (:388-400)` enforces `nurse_id` ownership, and
  `ReportCommentController@destroy` adds an author-or-admin check at `:75-82` (`AUDIT_FINDINGS.md:292-294`).
- The seven "harness artifact" MariaDB failures were adjudicated as test-hygiene, not product defects, and
  explicitly confirmed to share no root cause with the one product defect
  (`mariadb-failure-triage.md:281-291`). Only H1 (teardown FK) required a code change, listed in section 6.

---

## 8. Outstanding items (honest open list)

Nothing below is fixed-and-forgotten; each is a real open item on the path to a hospital LAN deployment.

1. **CI green confirmation is pending a push (FIXED-UNVERIFIED).** AUD-INFRA-003 / AUD-DEPLOY-007 are verified
   locally on a real PHP 8.3.32 runtime, but GitHub Actions cannot be run from this machine. Whether the three
   CI jobs actually go green must be confirmed on the next push. Until then, do not report CI as closed.
   Evidence: `AUDIT_FINDINGS.md:104-106`, `AUDIT_PROGRESS.md:431`.

2. **Lower-severity hardening findings remain open.** A login timing side-channel and an `X-Forwarded-For`
   throttle-bypass were noted as below-cap hardening and not fixed in this pass
   (`AUDIT_PROGRESS.md:432`). They should be scheduled before internet exposure; on a closed LAN they are
   lower priority but still real.

3. **The Playwright role-based browser sweep was authored but not executed here.** Eight new specs plus
   firefox/webkit/mobile/tablet projects were committed (`af15ac0`) and typecheck-clean, but the three-browser
   Execute run was interrupted before results were captured (`AUDIT_PROGRESS.md:413-420`). Its results are
   produced separately; see `PLAYWRIGHT_TEST_REPORT.md (produced separately)`. No fix in this report depends on
   those results, and no browser-e2e claim is made here.

4. **Coverage boundaries that bound what "verified" means (unchanged by any fix):**
   - **20 of 53 tables are empty in the seeded DB** (audit, notifications, access-requests, report status
     history, action items, report comments, calculated metrics), so no performance claim is verified for those
     paths, on either lane, which used the same seeders (`AUDIT_FINDINGS.md:309-317`). Fixes that touch those
     tables (notifications, access-requests, audit-log widening) are verified for **correctness** by their
     regression tests, not for **behaviour at volume**.
   - **Scalability numbers remain PREDICTED**, derived from schema and query analysis, never measured at
     1k/10k/100k (`AUDIT_PROGRESS.md:588-593`).
   - **The post-fix SQLite 313-passed run is recorded in commit `43bbccc` and `AUDIT_PROGRESS.md` CHECKPOINT 8**;
     the post-fix MariaDB 314-OK run is the one captured to disk
     (`artifacts/audit-2026-07-21/evidence/mariadb-suite-postfix.txt`).

---

## 9. Discrepancy found in the source evidence

One inconsistency was found while assembling this report and is recorded rather than smoothed over.

**`AUDIT_FINDINGS.md` was only partially updated by the remediation.** The commit `43bbccc` diff flips
**AUD-API-002** to "FIXED - VERIFIED" in the findings file, but leaves the code-derived candidates it fixed
(C-AUTHZ-001, C-SEC-002, C-SEC-003, C-SEC-004, C-SEC-005, C-SEC-009, C-DB-011, C-DB-012, C-DB-015, C-DB-016)
sitting under the heading **"CODE-DERIVED CANDIDATES - PENDING EMPIRICAL VERIFICATION"** with no status change
(`AUDIT_FINDINGS.md:268-307`). The commit message and the added regression tests show these were in fact fixed
and guarded. The findings file therefore **understates** the remediation: a reader consulting it alone would
believe those candidates are still unverified. The authoritative record of what was fixed is the commit
`43bbccc` message plus its test-file additions, which this report has used. The finding IDs and precise
line-level fix locations for those candidates should be back-filled into `AUDIT_FINDINGS.md` so the two records
agree.

A second, minor point: the "Suite comparison" table at `AUDIT_FINDINGS.md:22-26` still shows the pre-fix
281-test baseline. That is correct as a snapshot of the moment the defects were found, but a reader should pair
it with section 2 above (or `mariadb-suite-postfix.txt`) for the post-fix 313/314 figures.
