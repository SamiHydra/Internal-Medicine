# AUDIT PROGRESS

**Audit started:** 2026-07-21
**Environment:** local dev (Vite :5173 + Laravel :8000 + SQLite dev DB). No production system reachable.
**Plan:** see `FULL_SYSTEM_AUDIT_PLAN.md`
**Findings:** see `AUDIT_FINDINGS.md`
**Commands:** see `AUDIT_COMMAND_LOG.md`

Status legend: `[ ]` not started · `[~]` in progress · `[x]` complete · `[!]` blocked · `[F]` failed

---

## CHECKPOINT 0 - 2026-07-21, audit preparation

**Work completed**
- Created the four persistence files.
- Copied the complete audit instruction into `FULL_SYSTEM_AUDIT_PLAN.md`.
- Identified the testing environment and recorded it in the plan, Part 3.
- Recorded two explicit deviations (no production lane; scalability numbers are predicted, not measured).

**Current blocker**
- `[!] BLOCKER-1` A code-change workflow (`wf_1daf517d-18d`) is still running and actively editing
  `backend/app/Http/Controllers/Api/AcademicRegistrationController.php`,
  `backend/app/Services/Admin/AdminAccessRequestReviewService.php`, `backend/app/Policies/UserPolicy.php`,
  a new `admin_access_requests` migration, `src/pages/auth/access-request-page.tsx`, and
  `src/pages/admin/user-management-page.tsx`.
  Auditing a tree that is being mutated produces a baseline that describes code which no longer exists.
  **Resolution:** wait for that workflow to land, re-verify the affected area, then take the baseline.
  Discovery work that does not touch the auth/registration area may proceed in parallel.

**Files created**
- `FULL_SYSTEM_AUDIT_PLAN.md`
- `AUDIT_PROGRESS.md`
- `AUDIT_FINDINGS.md`
- `AUDIT_COMMAND_LOG.md`

**Exact next task**
- Confirm Playwright browsers are installed and the two dev servers are reachable (environment setup).
- Then run system discovery (read-only) to produce `ROLE_PERMISSION_MATRIX.md`.

**Last verified checkpoint:** CHECKPOINT 0 (preparation only, no application testing performed yet)

---

## CHECKPOINT 1 - 2026-07-21, environment verified + discovery launched

**Work completed**
- Verified both dev servers reachable; Sanctum handshake through the Vite proxy returns 204.
- Verified Playwright `^1.60.0` is installed with a working harness already in the repo.
- Inventoried the existing e2e estate: 15 specs, page-object dir, auth fixture, 4 helper modules,
  plus 7 support scripts including an existing `load-test.mjs`.
- **Decision recorded:** the audit will EXTEND the existing harness, not rebuild it. Rebuilding would
  discard working auth fixtures and page objects and would risk contradicting the repo's own conventions.
- Launched audit phase 1 (discovery) as a 6-agent read-only workflow writing evidence to
  `artifacts/audit-2026-07-21/discovery/`.

**Environment gap (not a defect)**
- `[!] GAP-1` Firefox browser binaries are not installed; only Chromium and WebKit are cached.
  The instruction requires Chromium at minimum and Firefox/WebKit "where the application supports them".
  Chromium + WebKit will run now. Firefox requires `npx playwright install firefox` and is currently
  **BLOCKED** rather than skipped. Recorded so no cross-browser claim is overstated.

**Blockers**
- `[!] BLOCKER-1` still open: workflow `wf_1daf517d-18d` is still editing the auth/registration area.
  Discovery agents were explicitly instructed to mark that area `IN-FLUX - RE-VERIFY` rather than
  baseline it. Must be re-read once that workflow lands.

**Tests executed:** 0 (discovery is read-only inventory, not testing)

**Files created**
- `artifacts/audit-2026-07-21/discovery/` (6 inventory files, in progress)

**Exact next task**
1. Re-verify the IN-FLUX auth/registration area once `wf_1daf517d-18d` completes.
2. Read the discovery baseline + `ROLE_PERMISSION_MATRIX.md`.
3. Build phase 2: extend the Playwright harness to close the gap list produced by discovery agent 06
   (viewports, per-role auth states, video/trace, test-data factory with unicode/boundary/duplicate data,
   cleanup script).

**Last verified checkpoint:** CHECKPOINT 1

---

## CHECKPOINT 2 - 2026-07-21, session restart recovery + prod-parity lane

**Incident**
The Claude Code process exited while three background jobs were in flight. All three were interrupted,
NOT completed. Recorded here because an audit must never silently lose work:

| Job | State at exit | Recovery |
|---|---|---|
| Code-change workflow `wf_1daf517d-18d` (BLOCKER-1) | mid backend-implementation | Resumed from cache; only unfinished agents re-run |
| Audit discovery workflow `wf_35a05839-78a` | mid discovery | Resumed from cache |
| Firefox browser install (GAP-1) | died at 0% of 116 MiB | Retried |
| Dev servers (:5173, :8000) | killed with the process | Restarted |

**Lesson recorded:** background work in this environment does not survive a process restart. Long audit
phases must checkpoint to disk (which is what these files are for) rather than relying on job survival.

**Work completed**
- Restarted both dev servers.
- Retried the Firefox install (GAP-1) - previous attempt was interrupted, not a genuine failure.
- Resumed both stopped workflows from their cached checkpoints.
- Confirmed the Docker daemon is now reachable (`29.6.1`, linux containers) after the operator started
  Docker Desktop.
- Commissioned the **Docker production-parity stack** (MariaDB + php-fpm + nginx + queue worker),
  mirroring the `deploy/` kit.

**Why the prod-parity lane matters to this audit**
The local lane is SQLite, which is single-writer. Concurrency, lock contention, connection limits, real
query plans, index effectiveness, nginx security headers and HTTPS cookie flags are all unmeasurable on it.
The repo itself concedes this: `backend/tests/Feature/MariaDbConcurrencyRegressionTest.php` skips locally
with "True parallel locking regression runs only in the MariaDB CI lane."
This stack converts a block of **PREDICTED** findings into **VERIFIED** ones. If it lands, the deviation
recorded in `FULL_SYSTEM_AUDIT_PLAN.md` Part 3 item 1 is narrowed and that must be restated there.

**Blockers**
- `[!] BLOCKER-1` still open - resumed, not yet finished.
- `[~] GAP-1` Firefox install retried, outcome not yet confirmed. Do not claim cross-browser coverage
  until the binary is verified present AND a spec has actually run on it.

**Tests executed:** 0 (still no application testing credited)

**Exact next task**
1. Confirm Firefox install succeeded; only then mark GAP-1 closed.
2. Confirm BLOCKER-1 workflow completed; re-verify the IN-FLUX auth/registration area against final code.
3. Read discovery output + `ROLE_PERMISSION_MATRIX.md`.
4. Verify the Docker stack, then decide which audit sections run on the prod-parity lane vs the dev lane.

**Last verified checkpoint:** CHECKPOINT 2

---

## CHECKPOINT 3 - 2026-07-21, discovery partially complete

**Work completed**
- Phase-1 discovery ran: 7 agents, **5 succeeded, 2 failed** (`discover:schema` and `discover:modules`
  both died on "API Error: Connection closed mid-response"). Re-running those two; the 5 good agents
  replay from cache, and synthesis re-runs because its inputs changed.
- Evidence written to `artifacts/audit-2026-07-21/discovery/`:
  `02-backend-routes.md` (+ .part2/.part3), `03-roles-permissions.md`, `04-spa-surface.md`,
  `06-existing-tests-and-harness.md`, and a partial `01-database-schema.md`.
- **10 code-derived candidate defects recorded** in `AUDIT_FINDINGS.md`, each cited to file:line,
  explicitly marked NOT confirmed pending empirical verification.

**Headline numbers from the route inventory (evidence-backed)**
| Metric | Count |
|---|---|
| Registered routes | 180 (174 under `/api`) |
| Public API routes (no auth) | 6 |
| Authed but ungated | 15 |
| Permission-gated | 153 |
| API routes with no throttle | 3 |
| Controllers with zero in-action Gate check | 9 |
| Policies on disk / explicitly registered | 27 / 20 |
| Scheduled tasks / Artisan commands | 14 / 15 |

**Highest-priority candidates to verify first** (full detail in AUDIT_FINDINGS.md):
1. `C-AUTHZ-001` residents/consultants appear unable to read notifications the system sends them
2. `C-SEC-002` public endpoint writes a `users` row with no duplicate guard + per-admin notification fan-out
3. `C-SEC-003` that same public endpoint honours a session cookie, bypassing the forced-password-change gate
4. `C-API-007` a GET request creates a database row

**Caveat recorded:** these came from the ROUTE agent. The SCHEMA and MODULES inventories failed, so the
database and workflow pictures are still incomplete. No conclusion about DB integrity or workflow state
machines may be drawn until those two land.

**Tests executed:** 0. Discovery is inspection, not testing. Nothing is credited as passed or failed.

**Blockers**
- `[!] BLOCKER-1` code-change workflow still running.
- `[!] GAP-1` Firefox still absent; install blocked behind a live Playwright lockfile held by a
  concurrent job. Retry when background work quiesces. See AUDIT_COMMAND_LOG.md commands 8-12.
- `[~] Docker prod-parity stack` still building.

**Exact next task**
1. Wait for the 2 re-run discovery agents + synthesis; read `ROLE_PERMISSION_MATRIX.md` and the baseline.
2. Then build phase 2: extend the Playwright harness per discovery agent 06's gap list.
3. Verify the 4 highest-priority candidates above as the first executed tests of the audit.

**Last verified checkpoint:** CHECKPOINT 3

---

## CHECKPOINT 4 - 2026-07-21 ~11:00, SESSION LIMIT reached

**Incident: API session limit hit, resets 13:10 Africa/Nairobi.** All sub-agent capacity stopped mid-flight.
This is the second infrastructure interruption of the audit (see CHECKPOINT 2). Impact:

| Job | Outcome |
|---|---|
| Docker prod-parity stack | **FAILED** - agent terminated by session limit. No `compose.yaml`, no `docker/` dir. Nothing partially built to clean up. |
| Discovery re-run (schema + modules) | **FAILED** - all 7 agents errored on the limit. **The 4 evidence files from the FIRST run remain valid on disk**; only `01-database-schema.md` (partial) and `05-modules-workflows.md` (absent) are still missing. |
| BLOCKER-1 code workflow | **COMPLETED 30/31 agents.** Only its independent `final-gate` agent died on the limit. |

**BLOCKER-1 is now CLOSED as a code change, with a caveat.**
The workflow ran 19 raw findings -> 13 refuted -> **6 confirmed and fixed**. Its own fix pass reported
green gates, but the *independent* verification gate never ran. **Because an agent's claim of a passing
test is not evidence, the auditor is re-running both suites directly.** Result recorded below.

**Most important thing the reviewers caught** (a genuine regression this change introduced):
academic enrollment requests were being filtered out of the approval queue in the clinical workspace,
while the approver notification deep-links to `/admin/users` - a *shared* path that leaves the workspace
at its stored default of `clinical`. An admin clicking the notification would land on a panel reading
"0 in queue" while a real resident sat unapproved and unable to log in or re-submit. Before this change
academic signup created a live account, so the failure mode is new - signups would have silently rotted.
Fixed by exempting the queue from workspace scoping (the queue is inherently cross-workspace; the
per-row role badge now carries the distinction). Five further copy/visibility defects fixed alongside.

**Independent verification by the auditor (not agent-reported) - ALL PASS**

| Gate | Command | Result | Exit |
|---|---|---|---|
| Backend suite | `php artisan test` (in `backend/`) | `{"tool":"phpunit","result":"passed","tests":281,"passed":280,"assertions":1909,"duration_ms":40252,"skipped":1}` | **0** |
| Typecheck | `npx tsc -b --force` | no output (tsc is silent on success) | **0** |
| Lint | `npm run lint` | no output (zero problems) | **0** |
| Unit tests | `npm run test:run` | `Test Files 15 passed (15)` / `Tests 85 passed (85)` | **0** |

Test count rose 275 -> 281, i.e. the change added 6 backend tests. The single skip is the pre-existing
`MariaDbConcurrencyRegressionTest`, which self-skips off the MariaDB lane - **the exact test the Docker
prod-parity stack (GAP-2) exists to enable.** It is still skipping, so nothing about concurrency has been
verified.

All commands were run UNPIPED so the reported exit status is the program's own, per the lesson recorded in
`AUDIT_COMMAND_LOG.md` after the masked-exit-code incident.

**Tests executed under the audit proper:** still 0. The above verifies a code change, it is not audit testing.

**Blockers**
- `[!] BLOCKER-2 (new)` API session limit until **13:10 Africa/Nairobi**. No sub-agent work possible until
  then. Auditor-run shell commands still work.
- `[!] GAP-1` Firefox still absent (Playwright lockfile was held by a concurrent job; that job is now dead,
  so **retry is likely to succeed now**).
- `[!] GAP-2 (new)` Docker prod-parity stack not built. Must be redone after the limit resets.
- `[ ]` Discovery still missing the DB-schema and modules/workflows inventories.

**Exact next task (in order, on resume)**
1. Retry `npx playwright install firefox` - the lock holder is gone. Run UNPIPED.
2. Re-run the 2 failed discovery agents + synthesis (`resumeFromRunId: wf_35a05839-78a`).
3. Re-commission the Docker prod-parity stack.
4. Then phase 2: extend the Playwright harness and begin actual testing, starting with the four
   highest-priority code-derived candidates in `AUDIT_FINDINGS.md`.

**Last verified checkpoint:** CHECKPOINT 4

---

## CHECKPOINT 5 - 2026-07-21 ~14:20, prod-parity lane LIVE, first confirmed defects

**GAP-2 CLOSED.** The Docker production-parity stack is built, verified, and left running.
- Services: `db` (MariaDB 11.4), `app` (PHP-FPM), `web` (nginx serving the **built** SPA), `queue`,
  `scheduler`, plus a `test` profile. Healthcheck-gated startup, no sleeps.
- Ports **8080** (HTTP, 301s to HTTPS), **8443** (HTTPS), **33306** (MariaDB), all bound to `127.0.0.1`.
  Dev servers on :5173 / :8000 untouched; `backend/.env` never modified.
- Seeded at real scale: 61 migrations, 10 seeders, 50 users, 695 reports, **61,001 report field values**.
- Full login journey verified end to end through nginx: login 200 -> `/api/auth/me` 200 -> `/api/workspace` 200.
- Documentation in `docker/README.md` enumerates **14** ways this lane still differs from real production.

**The headline: `MariaDbConcurrencyRegressionTest` now EXECUTES rather than skipping.**
14 assertions ran; all three concurrency scenarios PASS. This test had never actually run anywhere
(see AUD-INFRA-003 for why).

**Suite comparison at the same commit - this is the finding that matters**
| Lane | Result |
|---|---|
| SQLite (dev + what CI defaults to) | 281 tests, 280 passed, **1 skipped, 0 failures** |
| MariaDB (the engine production uses) | 281 tests, **7 failures, 3 errors, 0 skipped** |

**Six confirmed defects recorded in AUDIT_FINDINGS.md**, two of them CRITICAL:
- `AUD-DB-001` **Migrations cannot run on MariaDB** - a 71-char index name vs the 64-char limit
  (`2026_08_12_000010_create_undergraduate_tables.php:96`). `deploy.sh` runs `migrate --force`, so
  **the department server cannot currently be deployed to.** Auditor-verified independently.
- `AUD-INFRA-003` **The whole CI pipeline cannot install dependencies** - `ci.yml` pins PHP 8.3 at lines
  51, 105 and 156 while `composer.lock` requires `php >=8.4.1` for 17 packages. Auditor-verified, and
  **broader than the agent reported**: all three jobs are affected, not just the MariaDB one. This is the
  root cause of why AUD-DB-001 was never caught.
- Plus `AUD-API-002` (duty roster 500s on MariaDB), `AUD-SEC-004` (no CSP/HSTS on the SPA document),
  `AUD-SEC-005` (conflicting duplicate `Referrer-Policy` in `deploy/nginx.conf`), `AUD-DB-006` (test teardown FK).

**Verification discipline note:** the auditor independently re-verified the two CRITICAL findings rather
than accepting the agent's report, and in doing so found AUD-INFRA-003 to be worse than described.
AUD-API-002, -004 and -005 remain agent-reported and are labelled as such in AUDIT_FINDINGS.md; they must
be reproduced before any fix is credited.

**One deviation to note:** the stack could not start at all until AUD-DB-001 was worked around. Because the
brief forbade editing application source, the fix was applied **inside the image only** via
`docker/patches/apply-parity-patches.sh`; the repo file still contains the defect and git reports it
unmodified. The patch script fails the build loudly if the migration drifts. **This is a real bug that
still needs fixing in source.**

**Tests executed under the audit proper:** still 0 Playwright tests. The MariaDB suite run is backend
regression testing, not the role-based audit.

**Blockers**
- `[x] GAP-1` CLOSED - Firefox installed and proven to render the app.
- `[x] GAP-2` CLOSED - prod-parity lane live.
- `[x] BLOCKER-1` CLOSED - change verified by the auditor directly.
- `[x] BLOCKER-2` CLOSED - session limit reset at 13:10.
- `[ ]` Discovery still missing the DB-schema and modules/workflows inventories (re-running).

**Exact next task**
1. Finish discovery (schema + modules + synthesis -> `ROLE_PERMISSION_MATRIX.md`).
2. Reproduce `AUD-API-002` on the MariaDB lane and re-capture headers for `AUD-SEC-004/005`.
3. Then phase 2: extend the Playwright harness and begin role-based testing, starting with the four
   highest-priority code-derived candidates.

**Last verified checkpoint:** CHECKPOINT 5

---

## CHECKPOINT 6 - 2026-07-21 ~14:32, PHASE 1 DISCOVERY COMPLETE

**All 7 discovery agents succeeded on the third attempt** (2 died on API errors, then all 7 on the session
limit; the resume-from-cache mechanism made each retry cheap). Deliverables on disk:

| File | Size | Contents |
|---|---|---|
| `ROLE_PERMISSION_MATRIX.md` | 83 KB | Roles, permission matrix, route x role access matrix, policy truth tables, escalation paths checked, claims flagged for empirical verification |
| `discovery/00-DISCOVERY-BASELINE.md` | 63 KB | Consolidated system map + **section 10: the 15 highest-risk areas this audit must not fail to test** |
| `discovery/01-database-schema.md` | 81 KB | 53 tables, 61 migrations, FK/index/constraint inventory |
| `discovery/02-backend-routes.md` | 57 KB | 180 routes with auth/permission/throttle per route |
| `discovery/03-roles-permissions.md` | 68 KB | Permission model + every policy rule |
| `discovery/04-spa-surface.md` | 55 KB | Every SPA route, form, table, export, modal |
| `discovery/05-modules-workflows.md` | 56 KB | Module state machines and invariants |
| `discovery/06-existing-tests-and-harness.md` | 55 KB | Existing coverage + the gap list phase 2 builds against |

**System scale established:** 180 routes (174 API), 6 public/unauthenticated, 153 permission-gated,
53 tables, 80,025 rows, 6 roles, 27 policies.

**Seven further schema-derived candidates recorded** (C-DB-011 to C-ARCH-017), including one that is the
same class as the confirmed deployment blocker: **29 `enum()` columns are unvalidated `varchar` on SQLite
but strict on MariaDB.** AUD-DB-001 was one symptom of that divergence; there are 29 more places it can bite.

**CRITICAL CAVEAT now recorded in AUDIT_FINDINGS.md:** 20 of 53 tables are EMPTY in the dev DB, including
every audit, notification and access-request path. **No performance or scalability conclusion may be drawn
about those paths from this dataset.** They must be seeded or explicitly reported as UNTESTED. This applies
to the prod-parity lane too, which used the same seeders.

**Master checklist section 1 (System discovery): COMPLETE** - all 13 items evidenced.

**Tests executed under the audit proper:** still 0 Playwright tests.

**Exact next task**
1. **Recommended to the operator: commit the working tree, then fix `AUD-INFRA-003` (CI PHP 8.3 -> 8.4)
   and `AUD-DB-001` (index name) - one line each - and re-run the MariaDB lane to confirm.** CI first,
   because green CI is what would have caught AUD-DB-001 before it landed. Awaiting the operator's go-ahead.
2. Phase 2: extend the Playwright harness against `discovery/06`'s gap list.
3. Begin role-based testing from `00-DISCOVERY-BASELINE.md` section 10.

**Last verified checkpoint:** CHECKPOINT 6

---

## CHECKPOINT 7 - 2026-07-21 ~15:00, both deployment blockers cleared; remediation run in flight

**Scope decision recorded.** The operator authorised fixing everything found. The auditor chose the
verify-then-fix path over both extremes: not a ship-only patch, and not the full seven-track browser sweep.
Rationale: every high-value finding so far came from the production-parity lane and code inspection, not
from Playwright. The remaining risk sits in the ~17 written-down candidates, not in untested viewports.
Browser-based role testing (phases 2-8 of the plan) remains **NOT STARTED** and must be reported as such.

**Both deployment blockers are now CLOSED and VERIFIED**
| ID | Was | Now |
|---|---|---|
| `AUD-DB-001` | `migrate --force` failed on MariaDB (71-char index name) | Verified by destroying the container DB and rebuilding from empty: 72 migration/seeder steps, all services healthy |
| `AUD-DEPLOY-007` | `composer install` failed on the server's PHP 8.3 (lock required 8.4) | Verified on a real 8.3.32 runtime: 91 installs, stack healthy. Root cause fixed by pinning `config.platform.php`, not just bumping a version |

Commits: `6494dec` (checkpoint), `540c067` (migration + first CI attempt), `6bb360f` (composer platform).

**Auditor error, recorded not hidden:** the first CI fix raised the pinned PHP to 8.4 to match the lock.
That was backwards - it would have produced a green CI against a server that still could not install.
Reverted. Retained in `AUD-INFRA-003` so the audit trail shows the correction.

**Parity lane realigned:** it had been running PHP 8.4 while production runs 8.3, so it could not have
caught `AUD-DEPLOY-007` itself. Now pinned to 8.3 in `docker/Dockerfile` and `compose.yaml`.

**Remediation workflow in flight** (`fix-all-audit-findings`): verify -> 4 sequential fix lanes ->
adversarial review with refuters -> full gate on BOTH lanes. Design notes:
- Verify precedes fix, so only real defects are changed and deliberate behaviour (e.g. `student_rep`
  being appointed rather than self-registering) is left alone.
- Fix lanes are sequential with disjoint file ownership; parallel edits to `api.php` and
  `Permissions.php` would clobber each other.
- Every fix requires a regression test that fails without it; one review lens checks only that.
- Named risks the reviewers must disprove rather than assume: a CSP that breaks the SPA, a constraint
  migration that fails against the 4 existing duplicate evaluation groups and the 2320-02-12 duty row,
  a pending-approval login message that leaks on the wrong-password path, and the concurrency test whose
  10 ms barrier permits false passes.
- The gate ends by logging into the containerised app and performing the roster save that returns 500
  today, so the headline fix is proven by user journey rather than by a passing test.

**Tests executed under the audit proper:** still 0 Playwright tests. Backend/parity suites are regression
verification, not the role-based audit.

**Exact next task**
1. Read the remediation gate output; record every fix in `AUDIT_FINDINGS.md` with its verification status.
2. Commit the remediation.
3. Then decide, with the operator, whether to run the browser-based role testing or close the audit with
   an honest UNTESTED section covering it.

**Last verified checkpoint:** CHECKPOINT 7

---

## CHECKPOINT 8 - 2026-07-21 ~08:20, paused for sleep mid Playwright run

**State saved before the operator sleeps the machine.**

Remediation fully committed and verified earlier this session:
- `43bbccc` - 16 audit findings fixed, both lanes green (SQLite 313 pass, MariaDB 314 pass, 0 failures).
  Roster-500 proven fixed end to end through nginx on the MariaDB stack (PUT -> 200, audit row 5->6).
- Two deployment blockers closed and verified (AUD-DB-001 index name, AUD-DEPLOY-007 composer/PHP 8.3).

Playwright role audit (this checkpoint):
- `af15ac0` - **8 new e2e specs authored and committed** (cross-role authz, IDOR/object ownership,
  account enumeration, notification access, registration+approval, clinical report lifecycle, academic
  evaluation submit, responsive) plus firefox/webkit/mobile/tablet projects in playwright.config.ts.
  All typecheck clean. **NOT YET EXECUTED.**
- The three-browser Execute run was IN PROGRESS when paused; no results.json was written, so that run is
  lost and must be re-done. The workflow was stopped cleanly (TaskStop) so nothing is half-written.

**On wake - exact resume steps**
1. Re-run the interrupted phases. Either resume the workflow from cache
   (`Workflow({scriptPath: ".../playwright-role-audit-wf_59d26afe-552.js", resumeFromRunId: "wf_59d26afe-552"})`
   - scout + authors replay from cache, only Execute+Triage+Report re-run), OR simply run the suite directly:
   `npx playwright test` (it self-manages its servers), then triage failures.
2. The specs are already committed, so even if the workflow cache is gone, no authoring is lost.
3. Triage failures into product-defect vs test-bug vs flake; write PLAYWRIGHT_TEST_REPORT.md; fold genuine
   defects into AUDIT_FINDINGS.md.

**Still open after the Playwright run**
- CI green confirmation (needs an operator push; cannot run GitHub Actions locally).
- Lower-severity hardening findings (login timing side-channel, X-Forwarded-For throttle bypass).
- The remaining audit deliverable documents (FULL_SYSTEM_AUDIT.md, SECURITY_AUDIT.md, etc.).

**Last verified checkpoint:** CHECKPOINT 8

## MASTER CHECKLIST

### 1. System discovery
- [ ] Project structure, README, AGENTS.md, docs/ inventory
- [ ] Environment configuration (`backend/.env`, `.env.local`, `vite.config.ts`, CORS/Sanctum config)
- [ ] Database schema from migrations (all tables, columns, FKs, indexes)
- [ ] Route inventory (`backend/routes/api.php`, `channels.php`, `console.php`) - public vs authed vs permission-gated
- [ ] SPA route inventory (`src/App.tsx`, `src/config/navigation.ts`, `src/routes/`)
- [ ] Authentication system (Sanctum config, session vs token, middleware stack)
- [ ] Middleware inventory (`permission:` middleware, `EnsurePasswordChanged`, throttles)
- [ ] Role definitions + permission map (`Permissions.php`, `roles` table, policies)
- [ ] Seeders and migrations inventory
- [ ] Existing test inventory (backend feature/unit, frontend vitest, e2e specs)
- [ ] Module/workflow inventory (clinical reporting, academic evaluation, morning session, teaching,
      undergraduate, duty roster, rotations, transfers, analytics, notifications, import/export)
- [ ] Background jobs / scheduled commands inventory (`routes/console.php`, queue worker mode)
- [ ] File upload + export surface inventory (XlsxReader/XlsxWriter, import, CSV export)

### 2. Environment setup
- [x] Confirm backend dev server reachable — evidence: CMD-2/3, `/sanctum/csrf-cookie` -> 204
- [x] Confirm frontend dev server reachable + proxy handshake (`/sanctum/csrf-cookie` -> 204) — evidence: CMD-3
- [x] Confirm Playwright installed; install browsers if absent — PW 1.60 + chromium + webkit + **firefox-1522**.
      **GAP-1 CLOSED 2026-07-21 14:04** on the 5th attempt, once the concurrent lock holder died.
      Not closed on binary presence alone: proven by launching Firefox against the running app and
      capturing `artifacts/audit-2026-07-21/evidence/gap1-firefox-smoke.png`, which renders the sign-in
      page correctly. All three engines are now available.
- [x] Confirm existing e2e harness state (`playwright.config.ts`, `tests/`, `scripts/run-e2e.mjs`) — evidence: CMD-6/7
- [~] Establish evidence directory layout under `artifacts/audit-2026-07-21/` — discovery/ in progress
- [ ] Snapshot the dev DB before destructive test-data creation (restore path recorded)

### 3. Identified roles
- [ ] Enumerate every role from the `roles` table + `Permissions::ROLE_PERMISSIONS`
- [ ] For each role: can it self-register? does it need approval? can only an admin create it?
- [ ] Produce `ROLE_PERMISSION_MATRIX.md` (role x permission x route x policy)

### 4. Account creation for every role
- [ ] superadmin (maintenance) - DB/console only
- [ ] admin - public signup + approval queue
- [ ] nurse - admin-created
- [ ] resident - public signup (approval status under change, re-verify after BLOCKER-1)
- [ ] consultant - public signup (approval status under change, re-verify after BLOCKER-1)
- [ ] student_rep - admin-created only
- [ ] student (non-account person record) - admin-created, confirm no login path exists

### 5. Authentication testing (Agent A)
- [ ] Signup per publicly-registerable role
- [ ] Admin-created account flow per role
- [ ] Login / logout
- [ ] Email verification behaviour
- [ ] Password reset flow
- [ ] Remember-me
- [ ] Session expiration
- [ ] Invalid credentials
- [ ] Duplicate email / username
- [ ] Weak passwords
- [ ] Disabled / suspended / rejected / deleted / unverified accounts
- [ ] Access after logout
- [ ] Concurrent sessions
- [ ] CSRF protection
- [ ] Cookie security flags
- [ ] Token storage + expiration
- [ ] Account enumeration via error messages
- [ ] Rate limiting: login, signup, password reset, verification

### 6. Authorization testing (Agent A)
- [ ] Direct URL access without authentication (every protected SPA route)
- [ ] Cross-role page access
- [ ] Cross-role API access (every permission-gated route x every role)
- [ ] Privilege escalation attempts
- [ ] Client-modified role/permission values
- [ ] Backend enforcement confirmed independently of frontend hiding

### 7. Role-by-role workflows (Agent B)
- [ ] superadmin
- [ ] admin (clinical workspace)
- [ ] admin (academic workspace)
- [ ] nurse
- [ ] resident
- [ ] consultant
- [ ] student_rep
- [ ] Cross-role data visibility checks
- [ ] Post-refresh / new-tab / re-login persistence checks
- [ ] Produce `FUNCTIONAL_TEST_MATRIX.md`

### 8. Frontend and responsive testing (Agent C)
- [ ] Desktop viewport sweep
- [ ] Laptop viewport sweep
- [ ] Tablet viewport sweep
- [ ] Mobile viewport sweep
- [ ] Layout defects (overflow, clipping, overlap, spacing, typography)
- [ ] Interaction defects (modals, dropdowns, dead buttons, disabled-state logic)
- [ ] State defects (loading, error, empty, confirmation, duplicate submit, data loss)
- [ ] Navigation (back/forward, refresh, deep link)
- [ ] Accessibility (keyboard, focus, tab order, labels, contrast)
- [ ] Console errors/warnings + failed network requests + missing assets
- [ ] Screenshots captured for every confirmed UI issue

### 9. Backend and API testing (Agent D)
- [ ] Endpoint inventory with method/auth/permission per route
- [ ] Valid + invalid + missing + wrong-type + boundary + oversized + empty inputs
- [ ] Duplicate records, invalid IDs, deleted IDs
- [ ] Unauthorized (401) vs forbidden (403) correctness
- [ ] Mass assignment / over-posting / modified ownership IDs
- [ ] Unexpected HTTP methods
- [ ] Repeated submissions + concurrent updates + race conditions
- [ ] Transaction rollback + partial operation behaviour
- [ ] File upload validation
- [ ] Error response consistency + status codes + stack-trace leakage
- [ ] N+1 queries, excessive calls, missing pagination, unbounded search
- [ ] Caching correctness / stale data
- [ ] Frontend-vs-direct-API bypass comparison

### 10. Security testing (Agent E)
- [ ] Broken access control / IDOR / horizontal + vertical escalation
- [ ] Injection: SQL, command (where relevant)
- [ ] XSS: stored, reflected, DOM
- [ ] CSRF / session fixation
- [ ] SSRF (where relevant)
- [ ] File upload safety / path traversal
- [ ] Open redirects
- [ ] Password policy / brute force / rate limits
- [ ] Predictable identifiers
- [ ] Secrets in bundle, repo, logs
- [ ] CORS config / security headers / cookie flags
- [ ] Validation + output encoding
- [ ] Account enumeration / password-reset safety
- [ ] Unauthorized exports and downloads
- [ ] Dependency vulnerabilities
- [ ] Produce `SECURITY_AUDIT.md`

### 11. Performance testing (Agent F)
- [ ] Initial page load / auth response / dashboard load
- [ ] Large-table rendering, search, filter, pagination
- [ ] Form submission, upload, download
- [ ] Repeated navigation, concurrent users, slow network
- [ ] API response times + DB query times
- [ ] Memory / CPU / console performance warnings
- [ ] Failures under load, timeouts, retry, recovery
- [ ] Bundle size, excessive JS, images, duplicate/blocking requests

### 12. Database review (Agent G)
- [ ] Keys, FKs, unique constraints, nullability, cascade behaviour
- [ ] Soft deletes, orphans, duplicates
- [ ] Transaction safety, consistency, audit fields, timestamps
- [ ] Index coverage + composite indexes vs actual query patterns
- [ ] Search / sort / pagination strategy
- [ ] Concurrency, locks, connection usage
- [ ] Archiving, backup/recovery, unbounded table growth
- [ ] Multi-tenant isolation (if applicable)
- [ ] Produce `DATABASE_REVIEW.md`

### 13. Scalability review (Agent G)
- [ ] 1,000 users - PREDICTED
- [ ] 10,000 users - PREDICTED
- [ ] 100,000 users - PREDICTED
- [ ] High concurrency - PREDICTED
- [ ] Verified defects clearly separated from predicted risks
- [ ] Produce `PERFORMANCE_SCALABILITY_AUDIT.md`

### 14. Issue fixing
- [ ] Baseline frozen before any fix
- [ ] Fixes applied in severity order
- [ ] Regression test added per fix
- [ ] Files changed + reason recorded

### 15. Regression testing
- [ ] Affected workflow re-run per fix
- [ ] Full role-based suite re-run
- [ ] Cross-role breakage check
- [ ] Original reproduction steps confirmed to no longer reproduce
- [ ] Produce `FIX_VERIFICATION_REPORT.md`

### 16. Final reporting
- [ ] `FULL_SYSTEM_AUDIT.md`
- [ ] `ROLE_PERMISSION_MATRIX.md`
- [ ] `FUNCTIONAL_TEST_MATRIX.md`
- [ ] `SECURITY_AUDIT.md`
- [ ] `PERFORMANCE_SCALABILITY_AUDIT.md`
- [ ] `DATABASE_REVIEW.md`
- [ ] `PLAYWRIGHT_TEST_REPORT.md`
- [ ] `ISSUE_REGISTER.md`
- [ ] `FIX_VERIFICATION_REPORT.md`
- [ ] Final summary with counts, groupings, blockers, priorities, untested areas, repro commands

---

## RUNNING TALLY

| Metric | Count |
|---|---|
| Tests executed | 0 |
| Passed | 0 |
| Failed | 0 |
| Blocked | 0 |
| Confirmed issues | 0 |
| Roles fully tested | 0 / 6 |
