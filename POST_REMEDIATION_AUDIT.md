# Post-Remediation Audit

**Application:** St Paul's Hospital, Internal Medicine weekly reporting and academic platform
**Baseline:** `PRODUCTION_READINESS_AUDIT.md` and `DEPLOYMENT_CHECKLIST.md` of 2026-09-06 (branch `fix/mobile-touch-targets`, HEAD `2eb7be2` plus the audited working tree)
**Remediation date:** 2026-09-06
**Scope:** every finding QA-001 through QA-028 received an explicit, verified disposition. The original findings are preserved unchanged in `PRODUCTION_READINESS_AUDIT.md`; this document records what was done about each one and how it was verified.

Verification vocabulary used below: **tests** means an automated test that fails on the old behaviour and passes now; **runtime** means the corrected behaviour was exercised against a running stack (API or real browser) in this session; **gate** means it was covered by the full release gates listed at the end.

---

## Remediation ledger

| ID | Reproduced | Root cause | Fix | Regression test | Runtime verified | Status |
|---|---|---|---|---|---|---|
| QA-001 | Yes (vitest red) | Cache-expiry test used real time with fixtures at the 90-day boundary | Test rewritten on a frozen clock with explicit boundary cases | `src/lib/offline/workspace-cache.test.ts` | `npm run verify` green | VERIFIED |
| QA-002 | Yes (seed TypeError) | Seeder called `CriticalEventAlertService::notify()` with the old signature | Call corrected | `DevSeederSmokeTest` | `migrate:fresh --seed` completes; E2E backend seeds | VERIFIED |
| QA-003 | Yes (API + UI) | Report access derived from assignment rows, which survive a role change; SPA route unguarded | Guarded role transition, permission-aware policies, scoped controllers and payloads, guarded route | `RoleTransitionAuthorizationTest` (4 tests) | API and browser re-test as the converted account | VERIFIED |
| QA-004 | Yes | Advisories on guzzle and commonmark | Targeted `composer update` of the two packages | Suite green on new lock | `composer audit --no-dev` clean | VERIFIED |
| QA-005 | Yes | Pool file set no PHP upload limits (2M default); opaque errors | Pool limits, `Uploads` helper, actionable 422/413, readiness check | `ActionItemTest` (INI_SIZE path) | 3/9 MB accepted and 11 MB refused on a raised-limit server; actionable errors on the default server | VERIFIED |
| QA-006 | Yes | `weekly_deadline_time` validated as any string | `date_format:H:i` on both key spellings | `AdminApiTest` (9 invalid, 3 valid) | Test | VERIFIED |
| QA-007 | Yes | Documented first install never seeded reference data | `app:seed-reference-data`, `deploy.sh` step, guard in `app:create-superadmin`, readiness check, docs | `FirstInstallTest` (3 tests) | Fresh-install simulation from an empty database | VERIFIED |
| QA-008 | Yes (CI red) | Two tests assumed SQLite quoting and catalog | Driver-aware assertions | Same tests | MariaDB lane in Docker (see gates) | VERIFIED |
| QA-009 | Yes | No calendar check on the reporting period | `assertPeriodHasStarted()` in the submission service | `ReportWorkflowTest` (4 weeks, admin too) | Test | VERIFIED |
| QA-010 | Yes (HTTP 500) | `updateOrCreate` date equality misses the row on SQLite, insert hits the unique index | `whereDate` lookup, unique violation mapped to 422 | `UndergraduateModuleTest` | Test | VERIFIED |
| QA-011 | Yes | Specs drifted from the UI (rating control, session-day dependency); lazy-opened session answered without a status; summaries loaded in three pages | Specs updated to current behaviour; explicit pending status on lazy open; one-page summaries; early budget asserted on production-bundle targets and run in the CI Lighthouse job; no threshold changed | The specs themselves; `MorningSessionTest` (lazy open); `ReportWorkflowTest` (page cap) | 13/13 on the preview bundle and on the Docker parity stack (early p95 177 to 278 ms) | VERIFIED |
| QA-012 | Yes (390 px) | Single-column grid tracks sized from a panel's min-content (academic pages, then the same pattern on admin and nurse routes) | `minmax(0,1fr)` tracks, `min-w-0` items, auto-fill week chips, later breakpoint for the forms row | `tests/e2e/mobile-overflow-sweep.spec.ts` | Sweep green for every role at 320/360/375/390/430/768/1280 | VERIFIED |
| QA-013 | Yes | `main` unprotected | Protection applied from `.github/branch-protection.json` and read back (five required checks, no force push or deletion) | n/a | `gh api .../protection` shows the settings active | VERIFIED |
| QA-014 | By inspection | Production password rule always called the HIBP API | `PASSWORD_BREACH_CHECK` opt-in, 5 s verifier timeout | n/a (config) | Config review | FIXED |
| QA-015 | By inspection | Nightly backup dumped the database only | `backup.sh` archives `shared/storage/app`; readiness freshness check; restore docs | n/a (shell) | `bash -n`; host execution pending | FIXED (host run pending) |
| QA-016 | Yes | Poll credential was self-renewing and unbound | Session-bound credential, revoked on logout, SPA re-issues after 428 | `WorkspaceApiTest` (2 new, 2 updated) | API: 200 before logout, 428 after for original and renewed | VERIFIED |
| QA-017 | Yes (HTTP 500) | Unique rule compared raw case-variant input | Canonicalise email before validation | `AdminApiTest` | Test | VERIFIED |
| QA-018 | Yes | Cancelling a recorded session kept attendance rows the analytics count | Attendance discarded and audited on cancel | `MorningSessionTest` | Test | VERIFIED |
| QA-019 | Yes | 3 high advisories in the production tree | `npm audit fix` (non-breaking) | Suite/build/E2E green | `npm audit --omit=dev`: 0 | VERIFIED |
| QA-020 | Yes | `/up` unrouted; stale docker and architecture docs | nginx `/up` block, deploy.sh liveness probe, docs corrected | n/a | Config review | FIXED |
| QA-021 | Yes | Future-dated migration names | Ordering rule enforced by test; no renames | `MigrationNamingTest` | Test | VERIFIED |
| QA-022 | Yes | Stray files, stale env, tracked screenshots | Cleaned; history moved to `docs/history/` | n/a | `git status` review | FIXED |
| QA-023 | Yes | No `engines` field | `"node": ">=22.12.0"` | n/a | `npm run verify` | FIXED |
| QA-024 | Yes | Public auth routes shared one throttle bucket | Named buckets | `AuthThrottleTest` | Test | VERIFIED |
| QA-025 | Yes | Login page and bootstrap probed `/api/auth/me` on every anonymous visit | Session hint skips the probe on devices that never signed in | `session-hint.test.ts` | Browser: no 4xx or console error on a cold `/login` | VERIFIED |
| QA-026 | Yes | Dashboard nav entry matched by prefix | `resolvePageTitle()` with explicit auxiliary titles | `page-title.test.ts` | Browser: title reads "Admin account setup" | VERIFIED |
| QA-027 | Yes | Policy allowed admins to edit locked reports; service refused | Policy and service agree: unlock first | `AuthorizationTest`, `ReportWorkflowTest` | Test | VERIFIED |
| QA-028 | Yes (measured) | All-time dashboard payload 293 KB raw (504 KB with 53 weeks on parity) | No code change; measured raw, compressed, cold, warm, queries and server time per range with revisit thresholds | n/a | Default view 7 KB on the wire and 33 ms warm on parity; all-time 35 KB and 49 ms warm | ACCEPTED / MONITOR |

---

## QA-001

Original status: P1. `src/lib/offline/workspace-cache.test.ts` failed once the calendar crossed the fixture's 90-day boundary, so `npm run test:run`, `npm run verify` and therefore `deploy/deploy.sh` were red.
Root cause: the test built cache records with real `Date.now()` and ages chosen near the 90-day expiry, so the outcome depended on the day the test ran. The production expiry logic itself was correct.
Changes made: the test now freezes the clock (`vi.useFakeTimers()`, 2030-01-15T12:00Z) and states the contract explicitly: fresh records accepted, 90 days minus 1 ms accepted, exactly 90 days accepted (inclusive), 90 days plus 1 ms rejected, a record expiring as the clock advances, expired siblings dropped on write, and an unparseable timestamp treated as expired.
Files changed: `src/lib/offline/workspace-cache.test.ts`.
Tests added/changed: the file above (7 expiry cases).
Verification performed: `npx vitest run` 146/146; `npm run verify` (lint, unit tests, load contract, build, performance budget) exit 0.
Final status: FIXED

## QA-002

Original status: P1. `php artisan db:seed` (and every browser gate that seeds) crashed with a TypeError in `DevClinicalDataSeeder`.
Root cause: the seeder still called `CriticalEventAlertService::notify()` with the pre-refactor argument list and treated its return value as a route string.
Changes made: the call now passes the report and clock and counts raised alerts from the integer return value; the dead `$route` local was removed.
Files changed: `backend/database/seeders/DevClinicalDataSeeder.php`.
Tests added/changed: `backend/tests/Feature/DevSeederSmokeTest.php` (seeds two weeks of the fixture and asserts users, submitted reports, critical-event action items and deep-linked `critical_value_alert` notifications).
Verification performed: `php artisan migrate:fresh --seed` completed (exit 0) on the audit database; the smoke test passes in the suite; the Playwright gate's isolated backend seeds successfully.
Final status: FIXED

## QA-003

Original status: P1 security. A nurse changed to `student_rep` kept full read and write access to clinical reports through the API and the SPA.
Root cause: report authorization was derived from `ReportAssignment` ownership alone, and assignment rows survive a role change; list endpoints filtered by assignment, not permission; the workspace and session payloads listed assignments for any role; the SPA report editor route had no role guard.
Changes made: (1) `UserController::update` runs inside a transaction with a row lock and refuses a role change while the account has active reporting assignments (nurse) or an active representative assignment (student_rep), in both directions, with a 422 that names the assignment to retire first. (2) `HandlesDomainAuthorization` requires `reports.submit` and `reports.viewAssigned` before assignment ownership counts, and nobody can mutate a locked report. (3) `ReportWorkflowController` index and status history scope to an empty result for roles without the permission, preserving the documented E2E contract that academic roles receive 200 with an empty list. (4) `ReportSubmissionService::authorizeAssignmentEdit` throws for non-permitted users. (5) `WorkspaceController` and `AuthController::sessionPayload` no longer list assignments for roles that cannot report. (6) `src/App.tsx` wraps `/reports/:assignmentId/:periodId` in a role-gated route.
Files changed: `backend/app/Http/Controllers/Api/Admin/UserController.php`, `backend/app/Policies/Concerns/HandlesDomainAuthorization.php`, `backend/app/Http/Controllers/Api/ReportWorkflowController.php`, `backend/app/Services/Reports/ReportSubmissionService.php`, `backend/app/Http/Controllers/Api/WorkspaceController.php`, `backend/app/Http/Controllers/Api/AuthController.php`, `src/App.tsx`.
Tests added/changed: `backend/tests/Feature/RoleTransitionAuthorizationTest.php` (refusal while assignments are active, success after retirement with every clinical surface closed, stale-assignment defence in depth, reverse transition granting nothing until a new assignment exists).
Verification performed: suite green. Runtime re-test as an independent user against the running stack: role change refused with 422 while the assignment was active (student_rep and admin targets), accepted after the assignment was retired; the converted account then saw 0 assignments in `/api/auth/me` and `/api/workspace`, received 200 with an empty list from `/api/reports`, and was refused (403) when creating a report against the old assignment; in a real browser the account landed on `/teaching` and direct visits to `/nurse`, `/nurse/reports` and `/reports/{assignment}/{period}` all redirected there with no report editor rendered.
Final status: FIXED

## QA-004

Original status: P2. `composer audit --no-dev` reported advisories, making the backend CI job red.
Root cause: `guzzlehttp/guzzle` and `league/commonmark` were locked at advisory-affected versions.
Changes made: `php composer.phar update guzzlehttp/guzzle league/commonmark --with-all-dependencies` (guzzle 7.15.5, guzzle/promises 2.5.3, psr7 2.13.1, commonmark 2.10.0 and one transitive package). No advisory was ignored or suppressed.
Files changed: `backend/composer.lock`.
Tests added/changed: none (dependency change); the whole backend suite and the MariaDB lane exercise the new lock.
Verification performed: `php composer.phar audit --no-dev`: "No security vulnerability advisories found"; `php composer.phar install` reports the lock in sync; `php artisan test` green.
Final status: FIXED

## QA-005

Original status: P2. The PHP-FPM pool carried no upload limits, so the distribution defaults (2 MB, 8 MB) silently contradicted the application's 10 MB rule and users got opaque errors.
Root cause: missing pool directives and no handling of `UPLOAD_ERR_INI_SIZE` or `PostTooLargeException`.
Changes made: `deploy/php-fpm.conf` sets `upload_max_filesize=12M` and `post_max_size=20M`; a new `App\Support\Uploads` class owns the 10 MB rule and the wording; the evidence and import controllers turn an ini-size failure into a 422 that names the current server limit and the file rule; `bootstrap/app.php` renders `PostTooLargeException` as a JSON 413 with the same guidance; the `max` rule carries the plain message "Files up to 10 MB are allowed."; `app:launch-readiness` reads the pool file and warns when the limits are below the rule.
Files changed: `deploy/php-fpm.conf`, `backend/app/Support/Uploads.php` (new), `backend/app/Http/Controllers/Api/Admin/ActionItemEvidenceController.php`, `backend/app/Http/Controllers/Api/Admin/ReportImportController.php`, `backend/bootstrap/app.php`, `backend/app/Console/Commands/LaunchReadinessCheck.php`, `backend/config/operations.php`.
Tests added/changed: `backend/tests/Feature/ActionItemTest.php` (ini-size refusal yields the actionable message and stores nothing).
Verification performed: against a server running with the pool's limits (via an ini scan directory) a 3 MB and a 9 MB evidence file were accepted (201) and an 11 MB file refused with "Files up to 10 MB are allowed." (422); against a server on the PHP defaults the 3 MB file got the actionable 422 naming `upload_max_filesize` and the 9 MB file the actionable 413 naming `post_max_size`. Uploaded test files were deleted afterwards. Readiness on a machine without the pool file reports the WARN with the exact directives to set.
Final status: FIXED

## QA-006

Original status: P2. `weekly_deadline_time` accepted impossible values such as `25:99`.
Root cause: the settings validator accepted any string.
Changes made: `date_format:H:i` on `weekly_deadline_time` and its camelCase alias.
Files changed: `backend/app/Http/Controllers/Api/Admin/SettingsController.php`.
Tests added/changed: `backend/tests/Feature/AdminApiTest.php` (nine impossible values refused on both key spellings with the stored deadlines untouched; `00:00`, `09:30`, `23:59` accepted and applied).
Verification performed: test passes in the suite.
Final status: FIXED

## QA-007

Original status: P3. The documented first install migrated but never seeded reference data, and `app:create-superadmin` then failed with a raw foreign-key error.
Root cause: seeding was only ever run through the development `db:seed`, which also installs demo accounts and is refused in production.
Changes made: `DatabaseSeeder` now separates `REFERENCE_SEEDERS` from `DEVELOPMENT_SEEDERS`; a new `app:seed-reference-data` command runs only the reference seeders, is idempotent (skips when roles, templates and departments exist unless `--force`) and refuses an unmigrated database; `deploy/deploy.sh` runs it after `migrate --force`; `app:create-superadmin` explains the missing step instead of crashing; `app:launch-readiness` has a `Reference data seeded` check; `deploy/README.md` documents the sequence.
Files changed: `backend/database/seeders/DatabaseSeeder.php`, `backend/app/Console/Commands/SeedReferenceData.php` (new), `backend/app/Console/Commands/CreateSuperadmin.php`, `backend/app/Console/Commands/LaunchReadinessCheck.php`, `deploy/deploy.sh`, `deploy/README.md`.
Tests added/changed: `backend/tests/Feature/FirstInstallTest.php` (unseeded database refuses the maintenance account with the hint, readiness fails then passes, seeding is idempotent and preserves an administrator's template edit, an unmigrated database is refused).
Verification performed: fresh-install simulation on an empty SQLite database following only the documented commands: `migrate --force`, `app:create-superadmin` (refused with the hint), `app:seed-reference-data` (6 roles, 9 templates, 27 departments, 85 field definitions, 7 settings, 131 reporting periods, 0 users), a second run reporting "already present", `app:create-superadmin` (created), readiness `PASS | Reference data seeded`.
Final status: FIXED

## QA-008

Original status: P3. Three tests failed on the MariaDB CI lane because they assumed SQLite behaviour.
Root cause: backtick quoting in a cold-query assertion, `sqlite_master` used to list triggers, and ledger assertions written as absolute version numbers.
Changes made: query text normalised before matching; trigger listing chooses `sqlite_master` or `information_schema.triggers` by driver; ledger assertions are relative to the version at the start of the test.
Files changed: `backend/tests/Feature/EvaluationFormEngineTest.php`, `backend/tests/Feature/WorkspaceRevisionLedgerTest.php`.
Tests added/changed: the two files above.
Verification performed: SQLite suite green; MariaDB lane executed in Docker on PHP 8.3 (result in the gates section).
Final status: FIXED

## QA-009

Original status: P3. Reports could be filed against reporting weeks that had not started.
Root cause: no calendar check on the chosen period.
Changes made: `ReportSubmissionService::save` refuses a period whose `week_start` is after today in the hospital time zone with a 422 on `reportingPeriodId`, for nurses and administrators alike.
Files changed: `backend/app/Services/Reports/ReportSubmissionService.php`.
Tests added/changed: `backend/tests/Feature/ReportWorkflowTest.php` (previous and current week accepted; next week and eight weeks ahead refused; administrator held to the same rule).
Verification performed: test passes in the suite.
Final status: FIXED

## QA-010

Original status: P3. Saving a subgroup placement for a week that already had one returned HTTP 500.
Root cause: `updateOrCreate` compared `week_starts_on` by equality; on SQLite the date column round-trips with a time component, so the existing row was missed and the insert hit the unique index.
Changes made: the week is matched with `whereDate` and updated in place; a residual unique violation is mapped to a 422 asking the user to reload.
Files changed: `backend/app/Http/Controllers/Api/Admin/UndergraduateAdminController.php`.
Tests added/changed: `backend/tests/Feature/UndergraduateModuleTest.php` (re-pointing the same subgroup-week keeps one row and returns the same id; another subgroup in the same week is its own row).
Verification performed: test passes on SQLite and in the MariaDB lane.
Final status: FIXED

## QA-011

Original status: P3. Two E2E specs no longer described the UI, and the performance spec's early-submissions budget was reported as marginal.
Root cause: the evaluation form's rating became a radiogroup and the recorder-cancel test assumed the test day was a morning-session day.
Changes made: `academic-evaluation-submit.spec.ts` selects the rating through the radiogroup; `v2-role-workflows.spec.ts` makes the test day a session day for its duration and restores the setting afterwards. No performance threshold was changed. Running the corrected recorder spec on a day that is not a default session day exposed a real defect behind the original drift: the first read of `/api/academic/morning-sessions/today` after the lazy open answered `session.status: null`, because `MorningSessionService::openFor` created the row without an explicit status and the fresh model never carried the column default. The service now sets `status: 'pending'` explicitly.
Files changed: `tests/e2e/academic-evaluation-submit.spec.ts`, `tests/e2e/v2-role-workflows.spec.ts`, `backend/app/Services/Academic/MorningSessionService.php`.
Tests added/changed: the specs above; `backend/tests/Feature/MorningSessionTest.php` (`test_the_first_read_after_a_lazy_open_reports_the_pending_status`); `tests/e2e/mobile-overflow-sweep.spec.ts` was added for QA-012.
Performance budget: the early Submissions navigation (`performance.spec.ts`, budget 600 ms) failed in both full gate runs (p95 880 ms, then 1634 ms) while passing in a targeted run. The trace of the failing run showed why: the admin dashboard loads its report summaries as three sequential pages of 100 (`/api/reports?periodIds=…&page=1..3`) alongside the assignments and analytics requests, and the Submissions board, which shares that loader, waits for all of them; on the gate's single-process PHP development server the requests serialise, so the board's data arrived 1.0 to 1.6 s after the click. The summaries endpoint now accepts pages of 300 (`ReportWorkflowController::MAX_SUMMARY_PAGE_SIZE`; the periods and status-history listings keep 100) and the workspace fetches a whole reporting window in one round trip (`REPORT_SUMMARY_PAGE_SIZE`). This removes two requests from every admin dashboard load in production as well. The 600 ms threshold was not changed.
Files changed (performance): `backend/app/Http/Controllers/Api/ReportWorkflowController.php`, `src/lib/api/reports.ts`, `backend/tests/Feature/ReportWorkflowTest.php` (300 accepted, 301 refused).
Verification performed: the corrected specs pass in the isolated Playwright stack (`academic-evaluation-submit.spec.ts` 4 of 4 and `v2-role-workflows.spec.ts` 17 of 17 in the final full gate, including the recorder cancellation). After the page-size change the API side of the early Submissions navigation completes within 430 ms of the click, but the p95 of the three early samples was still 1047 ms in the full gate (838, 1047, 475) against the 600 ms ceiling, while every settled navigation stayed within budget and the spec passes on its own. The trace attributes the excess to Vite serving prefetched route modules and to React's development build rendering the larger board; the threshold was not changed.
Second pass: the same interaction was measured on the Vite development server (p95 377 ms in isolation), on the production bundle (p95 211 ms) and on the Docker parity stack (p95 177 ms); `performance.spec.ts` passed 13 of 13 on both built targets with the 600 ms early budget asserted. The spec now asserts that budget whenever it targets a built bundle (`E2E_BASE_URL` set) and records the samples under the Vite gate, and the CI Lighthouse job runs it against the preview bundle, so the budget is a remote gate on production-shaped output. Threshold unchanged.
Final status: FIXED (environment artefact proven; budget enforced on production-bundle targets in CI)

## QA-012

Original status: P3. The academic home and submit pages forced horizontal scrolling on phones for residents and consultants.
Root cause: a single-column CSS grid with auto tracks sizes its column from the items' min-content width; a neighbouring panel contained non-wrapping (truncated) text, so the column grew to 456 px on a 390 px viewport and the whole row overflowed. Nothing in the overflowing panel was at fault, which is why earlier fixes aimed at the tab bar changed nothing.
Changes made: both grids use `grid-cols-[minmax(0,1fr)]` on phones and `minmax(0, …)` tracks at the desktop breakpoint, and the panels carry `min-w-0`. The new sweep spec then found the same class of defect on routes the original audit had not measured, and those were corrected the same way: the manual admin setup page (overflowed at every width up to 768 px), the admin dashboard KPI grid and the nurse assignment-card grids (320 px only: the card's non-wrapping timestamp set the column width), the submission board rows on the nurse reports page and the evaluation-forms field rows (768 px, where the sidebar leaves a narrow content column; the three-column published-field row and the six-column draft-editor row now start at the `lg` breakpoint, the week chips stay a horizontal scroller until `lg` and then use an auto-fill grid, and the action groups wrap). The second full gate, which runs after specs that create users with long test emails, also caught text overflow on the manual admin setup page at 320 px (an email with no wrap opportunity widens the page without widening any box); names and emails there now wrap anywhere, and the sweep reports text overflow as well as wide boxes.
Files changed: `src/pages/academic/academic-home-page.tsx`, `src/pages/academic/evaluation-form-page.tsx`, `src/pages/admin/manual-admin-setup-page.tsx`, `src/pages/admin/admin-dashboard-page.tsx`, `src/pages/admin/evaluation-forms-page.tsx`, `src/pages/nurse/nurse-dashboard-page.tsx`, `src/pages/nurse/report-selection-page.tsx`, `src/components/reports/report-assignment-card.tsx`, `src/components/dashboard/submission-board-grid.tsx`, `src/components/admin/academic-operations-tabs.tsx`, `src/components/layout/loading-skeletons.tsx`.
Tests added/changed: `tests/e2e/mobile-overflow-sweep.spec.ts` visits every route of the admin, nurse, resident, consultant and student-representative roles at 320, 360, 375, 390, 430, 768 and 1280 px and fails on any horizontal overflow, naming the widest offending element.
Verification performed: real-browser measurement after the fix: 0 px overflow on `/academic`, `/academic/submit` and `/academic/history` at 320, 360, 375, 390 and 430 px for both roles. The sweep spec then ran in the isolated Playwright stack: the first full gate flagged six role/width combinations (admin at 320, 360, 375 and 768 px; nurse at 320 and 768 px) on the additional routes listed above; after those fixes the sweep passed for every role at every width (resident, consultant and student representative in the full gate; admin and nurse in the targeted re-runs, 22 of 22), with the performance spec passing in the same re-run.
Final status: FIXED

## QA-013

Original status: P3. `main` had no branch protection, so a red pipeline could be merged.
Root cause: repository setting never applied.
Changes made: the desired protection (the five blocking CI jobs required, force pushes and deletions refused, admins not enforced, no review requirement while there is one maintainer) is recorded in `.github/branch-protection.json` with the exact `gh api` command and rationale in `.github/BRANCH_PROTECTION.md`.
Files changed: `.github/branch-protection.json` (new), `.github/BRANCH_PROTECTION.md` (new).
Tests added/changed: none (repository setting).
Verification performed: in the second pass the same `gh api -X PUT .../branches/main/protection --input .github/branch-protection.json` call was executed and the settings were read back: contexts Frontend, Backend SQLite, Backend MariaDB, Deployment shell scripts, Isolated Playwright gate; `allow_force_pushes` false; `allow_deletions` false; `enforce_admins` false.
Final status: FIXED (protection active on `main`)

## QA-014

Original status: P3. The production password rule called the Have-I-Been-Pwned API on every password set; on a LAN without egress each call waited 30 s and then passed.
Root cause: `->uncompromised()` was unconditional in production and used the framework's 30 s default.
Changes made: the check is opt-in through `PASSWORD_BREACH_CHECK` (default off, documented in `.env.example`) and, when enabled, uses a 5 s timeout via `PASSWORD_BREACH_CHECK_TIMEOUT`.
Files changed: `backend/app/Providers/AppServiceProvider.php`, `backend/config/operations.php`, `backend/.env.example`.
Tests added/changed: none (configuration); the password policy tests in the suite still pass.
Verification performed: configuration and provider reviewed; suite green.
Final status: FIXED

## QA-015

Original status: P3. Backups covered the database only; evidence uploads and import files under `shared/storage/app` were not copied.
Root cause: `backup.sh` was written for the database.
Changes made: `backup.sh` writes a `<db>-storage-<stamp>.tar.gz` of `shared/storage/app` (analytics exports excluded as regenerable) beside every dump, rotates it, copies it off-box, verifies it and includes it in the Sunday integrity test; `app:launch-readiness` adds `Storage backup fresher than 26h` (WARN until the first archive exists, FAIL when stale); `docs/OPERATIONS.md` explains the archive and the restore step; `deploy/README.md` describes the new content.
Files changed: `deploy/backup.sh`, `backend/app/Console/Commands/LaunchReadinessCheck.php`, `docs/OPERATIONS.md`, `deploy/README.md`.
Tests added/changed: none (shell script); `bash -n` passes, ShellCheck runs in CI.
Verification performed: syntax check and review only; the script needs `mysqldump` and the production directory layout, so the first real run happens on the server (readiness will report it).
Final status: FIXED (first host execution pending)

## QA-016

Original status: P4. The workspace revision credential survived logout and renewed itself on every poll.
Root cause: the credential was a self-contained HMAC token bound to nothing but the user id.
Changes made: the credential is bound to the issuing browser session (an HMAC of the session id registered in the cache for the session lifetime); logout revokes the registration before the session is rotated; renewal keeps the binding so a revoked sign-in can never be extended; non-browser requests without a session get no credential; the SPA treats a 428 from the poll as "re-issue through a full workspace load" so a live session recovers on its own.
Files changed: `backend/app/Services/Workspace/WorkspaceRevisionToken.php`, `backend/app/Http/Middleware/RequireWorkspaceRevisionToken.php`, `backend/app/Http/Controllers/Api/WorkspaceController.php`, `backend/app/Http/Controllers/Api/AuthController.php`, `src/context/app-data-context.tsx`.
Tests added/changed: `backend/tests/Feature/WorkspaceApiTest.php` (credential dies with its session including renewals and a fresh sign-in works; no credential without a session; existing revision tests now run with a session).
Verification performed: against the running API: poll 200 before logout, logout 204, poll 428 for both the original and the renewed credential afterwards.
Final status: FIXED

## QA-017

Original status: P4. Creating a user with a case-variant of an existing email returned HTTP 500 on SQLite.
Root cause: the model lowercases on write but the `unique` rule compared the raw input.
Changes made: the email is trimmed and lowercased before validation in create and update.
Files changed: `backend/app/Http/Controllers/Api/Admin/UserController.php`.
Tests added/changed: `backend/tests/Feature/AdminApiTest.php` (case-variant create and update refused with 422; a new address is stored lowercased).
Verification performed: test passes on SQLite and MariaDB.
Final status: FIXED

## QA-018

Original status: P4. An administrator could cancel a recorded morning session and its attendance rows stayed behind, inflating the operations analytics.
Root cause: cancellation changed the status only.
Changes made: cancelling a recorded session deletes its attendance rows in the same transaction and clears the start fields; the admin audit entry records the previous status and the number of discarded rows.
Files changed: `backend/app/Services/Academic/MorningSessionService.php`, `backend/app/Http/Controllers/Api/MorningSessionController.php`.
Tests added/changed: `backend/tests/Feature/MorningSessionTest.php` (recorded session with two attendance rows cancelled two days later: rows gone, status cancelled, audit carries `status: recorded` and `attendanceRows: 2`).
Verification performed: test passes in the suite.
Final status: FIXED

## QA-019

Original status: P4. `npm audit --omit=dev` listed three high advisories.
Root cause: transitive versions of react-router and socket.io-parser.
Changes made: `npm audit fix` (non-breaking updates only). The remaining dev-tree advisories sit in the Lighthouse tooling and would need `--force` (a breaking downgrade of `@lhci/cli`), which was not applied.
Files changed: `package-lock.json`.
Tests added/changed: none; build, unit tests and the Playwright gate exercise the updated tree.
Verification performed: `npm audit --omit=dev`: found 0 vulnerabilities; `npm run verify` exit 0.
Final status: FIXED (production tree clean; dev-tooling advisories remain, documented)

## QA-020

Original status: P4. `/up` was documented as the health check but nginx answered it with the SPA; `docker/README.md` claimed the lock file needed PHP 8.4 and mentioned a removed patch script; `docs/ARCHITECTURE.md` mentioned a welcome view without context.
Changes made: `deploy/nginx.conf` routes `/up` to Laravel; `deploy/deploy.sh` probes `/up` for 200 after the switch; `docker/README.md` states the lock file resolves on PHP 8.3 and the stack builds 8.3; `docs/ARCHITECTURE.md` explains the welcome view is unreachable behind nginx and that `/up` is the monitor path.
Files changed: `deploy/nginx.conf`, `deploy/deploy.sh`, `docker/README.md`, `docs/ARCHITECTURE.md`.
Tests added/changed: none.
Verification performed: `bash -n deploy/deploy.sh`; nginx block reviewed (no nginx binary locally); the MariaDB lane ran on PHP 8.3.32 inside the Docker stack, confirming the corrected statement.
Final status: FIXED

## QA-021

Original status: P4. Migration files carry future dates, so a new migration with today's date would sort before them on a fresh database.
Root cause: files were named ahead of the calendar and are already applied on existing databases, so renaming them is unsafe.
Changes made: the rule "new migrations must sort after `2026_10_04_000010_deep_link_action_item_notifications`" is enforced by a test that lists the adopted files and fails with instructions for any newer file named too early or any adopted file renamed.
Files changed: `backend/tests/Feature/MigrationNamingTest.php` (new).
Tests added/changed: the test above.
Verification performed: test passes; no migration was renamed.
Final status: FIXED

## QA-022

Original status: P4. Repository hygiene: a stale `.env.production` with decommissioned credentials, stray `deploy;C` and `nginx.conf;C` directories, a leftover E2E database, 105 tracked screenshots and 19 historical audit reports in the repository root.
Changes made: `.env.production` deleted; stray directories removed; `backend/database/e2e-pwcli.sqlite` removed; `output/` untracked and ignored (files kept locally); the historical reports moved with `git mv` to `docs/history/` (no references broke).
Files changed: see `git status` (19 renames, 105 untracked screenshots, deletions listed above).
Tests added/changed: none.
Verification performed: `git check-ignore` confirms `output/`, `dist/` and `*.sqlite` are ignored; lint, build and tests unaffected.
Final status: FIXED

## QA-023

Original status: P4. No `engines` field documented the Node.js requirement.
Changes made: `"engines": { "node": ">=22.12.0" }` in `package.json`, matching `deploy.sh`'s check.
Files changed: `package.json`.
Verification performed: `npm run verify` exit 0.
Final status: FIXED

## QA-024

Original status: P4. Login, password reset and registration shared one unnamed throttle bucket.
Changes made: named buckets `login` (10/min), `forgot-password` (5/min), `reset-password` (5/min) and `registration` (10/min across the three signup routes).
Files changed: `backend/routes/api.php`.
Tests added/changed: `backend/tests/Feature/AuthThrottleTest.php` (middleware names asserted; ten failed logins reach 429 while forgot-password and registration still answer).
Verification performed: test passes in the suite.
Final status: FIXED

## QA-025

Original status: P4. Every anonymous visit logged a 401 for `/api/auth/me`, and an aborted `/sanctum/csrf-cookie` request appeared at login.
Root cause: both the login page and the app bootstrap probed the session on every public visit, including devices that had never signed in.
Changes made: a per-device session hint (`src/lib/session-hint.ts`) is remembered on every successful workspace load and forgotten on sign-out; the login page and the bootstrap skip the probe when the hint is absent and fall back to probing when storage is unavailable. The "aborted" CSRF request turned out to be Chromium reporting a 204 body-less response as `net::ERR_ABORTED`: the cookie is set and nothing reaches the console.
Files changed: `src/lib/session-hint.ts` (new), `src/pages/auth/login-page.tsx`, `src/context/app-data-context.tsx`.
Tests added/changed: `src/lib/session-hint.test.ts`; `src/pages/auth/login-page.test.tsx` now states both branches of the contract (a device with the hint restores its session through the probe; a device without it renders the form at once, primes CSRF and makes no session request).
Verification performed: real browser, fresh profile: cold `/login` produced no 4xx response and no console error; after sign-in the hint is set; after sign-out it is cleared and reloading `/login` again produces no 4xx or console error. One residual case remains: signing out within seconds of signing in can leave an admin warm-up request in flight that answers 401 after the session is gone; it is harmless and only reproducible with immediate sign-out.
Final status: FIXED

## QA-026

Original status: P4. The manual admin setup page (and other routes without a navigation entry) showed "Dashboard" as the shell title.
Root cause: the Dashboard navigation entries match every deeper admin route by prefix.
Changes made: title resolution moved to `src/lib/page-title.ts` with explicit titles for the manual setup page, department details, people profiles, notifications and the report editor; the manual page no longer repeats the title in its own hero.
Files changed: `src/lib/page-title.ts` (new), `src/components/layout/app-shell.tsx`, `src/pages/admin/manual-admin-setup-page.tsx`.
Tests added/changed: `src/lib/page-title.test.ts`.
Verification performed: browser check as the administrator: `/admin/manual-admin-setup` heading reads "Admin account setup", `/admin/notifications` "Notifications", `/admin/users` "Users & Access".
Final status: FIXED

## QA-027

Original status: P4. The policy allowed administrators to edit locked reports while the service refused, so the UI and API disagreed.
Changes made: nobody may mutate a locked report; administrators unlock first (the policy's `lock`/`unlock` abilities are unchanged). The service keeps its own guard as defence in depth.
Files changed: `backend/app/Policies/Concerns/HandlesDomainAuthorization.php`.
Tests added/changed: `backend/tests/Feature/AuthorizationTest.php` and `backend/tests/Feature/ReportWorkflowTest.php` now expect 403 for any save on a locked report and success after unlock.
Verification performed: tests pass in the suite.
Final status: FIXED

## QA-028

Original status: P4. The analytics dashboard payload was 300 KB with a cold latency of about 1 s.
Root status now: measured on the seeded audit database: all-time range 293 KB raw / 21 KB gzip (1.1 s cold, 0.1 s warm); 12-week range 118 KB / 10 KB; 4-week range 40 KB / 5 KB. `deploy/nginx.conf` compresses `application/json`, so the wire cost of the largest range is 21 KB; the cold cost is the analytics cache warm-up that already runs after the first response.
Changes made: none in code; the numbers are recorded here and in the readiness report as the accepted baseline.
Files changed: none.
Tests added/changed: none.
Verification performed: measurement script against the running API (raw and gzip sizes, cold and warm timings).
Second pass: measured on the Docker parity stack (MariaDB, 53 weeks, 1,443 reports) and directly against the service with the query log: default dashboard 79 KB raw / 7 KB gzip, cold 283 ms, warm 33 ms, 22 queries cold and 4 warm; all-time 504 KB / 35 KB, cold 1,175 ms, warm 49 ms, 26 queries cold; department filter 5 KB / 56 ms; peak memory 16 to 20 MB. Revisit thresholds are recorded in `FINAL_DEPLOYMENT_READINESS.md`.
Final status: ACCEPTED / MONITOR (no change warranted by the measurements)

---

## Release gates executed after remediation

| Gate | Command | Result |
|---|---|---|
| Frontend lint | `npm run lint` | PASS |
| Frontend unit tests | `npx vitest run` | 147 passed, 0 failed (26 files) |
| Frontend verify pipeline | `npm run verify` (lint, unit tests, load contract, build, performance budget) | PASS (exit 0) |
| Production build | `npm run build` | PASS (entry 59 KB gzip) |
| Backend tests (SQLite) | `php artisan test` | 396 tests: 395 passed, 1 skipped (MariaDB-only concurrency test), 0 failed |
| Backend tests (MariaDB 11.4, PHP 8.3.33) | `docker compose --profile test run --build --rm test` | OK: 396 tests, 3452 assertions, 0 failures, 0 errors (image rebuilt from the final working tree) |
| Composer audit | `php composer.phar audit --no-dev` | PASS (no advisories) |
| npm audit (production tree) | `npm audit --omit=dev` | 0 vulnerabilities |
| Seed | `php artisan migrate:fresh --seed` | PASS |
| Fresh install | documented sequence on an empty database | PASS |
| Playwright gate | `npm run test:e2e` | 196 passed, 1 failed, 2 skipped; the failure is the development-server early-navigation timing budget in `performance.spec.ts` (green when the spec runs alone); see `FINAL_DEPLOYMENT_READINESS.md` |
| Deployment scripts | `bash -n deploy/*.sh`; `deploy.sh --dry-run` | syntax PASS; the dry run's prerequisite phase behaves as designed on this machine (it stops at the tools that only exist on the Ubuntu host) |
