# FULL SYSTEM AUDIT

**System:** St Paul's Hospital Millennium Medical College, Department of Internal Medicine Reporting and
Academic Accountability Platform (Laravel + Sanctum backend, React SPA).
**Audit window:** 2026-07-21 (audit and remediation) / 2026-07-22 (reporting).
**Reporting environment:** local dev (Vite + Laravel + SQLite) plus a purpose-built Docker
production-parity lane (MariaDB 11.4 + nginx + PHP-FPM 8.3 + queue + scheduler).

This is the top-level executive report. It summarises the audit and points to the specialist deliverables.
The source of truth for individual issues is `AUDIT_FINDINGS.md`; the reconciled master index is
`ISSUE_REGISTER.md`; the full narrative is `AUDIT_PROGRESS.md` (checkpoints 0 to 8); the command record is
`AUDIT_COMMAND_LOG.md`. Every claim below cites one of those or a named evidence artifact under
`artifacts/audit-2026-07-21/`.

---

## 1. Readiness verdict

**Before this audit the application was NOT deployable to the department server.** Two independent,
confirmed blockers each stopped `deploy/deploy.sh` cold on the production stack, and a third critical defect
broke a core admin workflow at runtime on the production database engine. None of the three was observable on
the developer's machine, because the dev machine (SQLite + PHP 8.4) is more permissive than the production
target (MariaDB 11.4 + PHP 8.3). All three are now **fixed and verified on the production engine.**

**Current state: deployable and verified on the production-parity stack, with residual work that is
lower-risk but real and must not be skipped.**

| Dimension | Verdict | Basis |
|---|---|---|
| Can the server be deployed to? | **Yes, now** (was No) | Both blockers verified by rebuild-from-empty and a real PHP 8.3.32 `composer install`. `AUDIT_FINDINGS.md:44-57,144-153` |
| Core admin workflow (duty roster save) | **Works on MariaDB** (was 500) | Reproduced through nginx: `PUT /api/admin/roster/2028/3` returned HTTP 200, audit row written. `AUDIT_FINDINGS.md:210-213` |
| Backend regression suite, both DB lanes | **Green** | SQLite 313 passed / 1 skipped; MariaDB 314 passed / 0 failures. `mariadb-suite-postfix.txt:23`; `ISSUE_REGISTER.md:412-413` |
| Critical security release blockers | **None open** | All confirmed criticals are FIXED-VERIFIED; no open Critical or High remains except deferred retention (Medium). `ISSUE_REGISTER.md:89-96` |
| CI pipeline green | **Not confirmed** | Fix applied but GitHub Actions cannot be run from this machine; needs a push. `AUDIT_FINDINGS.md:102-106` |
| Browser role sweep (every page x every viewport) | **Partial / pending** | 8 e2e specs authored and committed (`af15ac0`); execution reported separately in `PLAYWRIGHT_TEST_REPORT.md`. `AUDIT_PROGRESS.md:413-419` |
| Empirical load testing (1k/10k/100k) | **Not performed** | Scalability figures are PREDICTED from schema and query analysis only. `ISSUE_REGISTER.md:420-422` |

**Plain-language bottom line for a decision-maker.** The application moved from a state where it could not be
installed on the hospital server to a state where installation, boot, and the previously-broken core
workflow are all demonstrated on the same database engine and PHP version production runs. That is the
headline and it is genuine. What remains before this is a clean go-live is operational, not architectural:
confirm CI goes green on a push, complete the lower-severity hardening items, run the empirical load test
the brief asked for, and finish the full every-page every-viewport browser sweep. This document states those
boundaries plainly because the system is destined for a hospital LAN, where a report that implies more
completeness than it has would be actively harmful.

---

## 2. Counts

Reconciled from `ISSUE_REGISTER.md:85-97` (which itself reconciles `AUDIT_FINDINGS.md` against the
remediation commit `43bbccc` and the blocker commits `540c067`, `6bb360f`). Note the source caveat below the
tables.

### 2.1 By fix status

| Fix status | Count | Items |
|---|---|---|
| FIXED-VERIFIED | 20 | Both blockers, roster-500 (+transaction), the two SPA header fixes, the test-teardown FK, nine code/schema candidates, one new finding, and four carried-over concerns |
| FIXED-UNVERIFIED | 1 | `AUD-INFRA-003` CI (root cause closed; green needs a push) |
| OPEN (deferred) | 1 | `C-DB-013` retention (real; the core of the scalability section) |
| REFUTED (checked and cleared, not defects) | 8 | 7 candidates + `PRE-5` (intentional design) |

**Findings fixed total: 16** (4 confirmed + 9 candidates + 1 new + 2 carried-over), matching commit
`43bbccc` and the blocker commits. **32 regression tests added**, each verified to fail before its fix
(`ISSUE_REGISTER.md:96-97`). The count of 20 FIXED-VERIFIED rows above is larger than 16 because it counts
`AUD-API-002b`, the two SPA header fixes, and the test-teardown fix as separate rows.

### 2.2 By severity (tracked findings and fixed candidates)

| Severity | Count | Examples |
|---|---|---|
| Critical | 4 | `AUD-DB-001`, `AUD-DEPLOY-007`, `AUD-INFRA-003`, `AUD-API-002` |
| High | 5 | `AUD-API-002b`, `C-AUTHZ-001`, `C-SEC-002`, `C-SEC-003`, `C-DB-012`, `PRE-1` (`C-SEC-009` is Low-now/High-on-prem) |
| Medium | 8 | `AUD-SEC-004`, `C-SEC-004`, `C-SEC-005`, `C-DB-015`, `AUD-DB-018`, `PRE-3`, `PRE-2`, `C-DB-013` (open) |
| Low | 5 | `AUD-SEC-005`, `AUD-DB-006`, `C-SEC-009`, `C-DB-016`, `PRE-4` |

Every Critical and every High is FIXED-VERIFIED except `AUD-INFRA-003` (FIXED-UNVERIFIED, awaiting a CI
push). The only unfixed item at any severity is `C-DB-013` (Medium, retention), deferred as an operational
task. Source: `ISSUE_REGISTER.md:108-131`.

### 2.3 By category (frontend / backend / db / security / perf)

| Category | Count | Notes |
|---|---|---|
| Release engineering / deployment | 3 | `AUD-DB-001`, `AUD-DEPLOY-007`, `AUD-INFRA-003` - all three blocker-class |
| Database / data integrity / migration | 6 | `AUD-DB-001`, `C-DB-012`, `C-DB-015`, `C-DB-016`, `AUD-DB-018`, `C-DB-013` (open) |
| Backend / data integrity | 2 | `AUD-API-002`, `AUD-API-002b` (duty roster) |
| Security | 8 | `AUD-SEC-004`, `AUD-SEC-005`, `C-SEC-002/003/004/005/009`, `PRE-3` |
| Authorization | 3 | `C-AUTHZ-001`, `PRE-1`, `PRE-2` |
| Frontend / UI | 1 | `PRE-4` (title fallback) |
| Test hygiene | 1 | `AUD-DB-006` |

**The frontend count is deliberately low and must be read as a coverage gap, not a clean bill of health.**
The audit's high-value findings came from the production-parity lane and code inspection; the
every-page-every-viewport browser sweep that would surface UI-layer defects is reported separately and is
partial (Section 8). Do not infer that the SPA is defect-free from the single frontend row here.

**Source caveat on all counts.** `AUDIT_FINDINGS.md` was not fully refreshed after remediation: three fixed
items still read "Open" in that file and nine fixed candidates still sit under its "PENDING" heading. The
authoritative record for those is the committed code, migrations, and tests in `43bbccc`. This discrepancy
is documented at length in `ISSUE_REGISTER.md:47-102,382-406`. The single corrective action is to refresh
`AUDIT_FINDINGS.md`; until then the register defers to the commit and cites the artifact per row.

---

## 3. The single most important theme: systematic dev-vs-prod divergence

This is the structural lesson of the audit, not merely a list of bugs. **The environment that runs the code
in production is stricter than the environment it was authored on, and that gap produced three separate
deployment-class defects that all passed local testing.**

| Blocker | Dev machine (permissive) | Production target (strict) | Consequence |
|---|---|---|---|
| `AUD-DB-001` | SQLite ignores identifier length | MariaDB rejects index names over 64 chars (a 71-char name) | `migrate --force` aborts; server cannot boot. `AUDIT_FINDINGS.md:33-81` |
| `AUD-DEPLOY-007` | dev machine ran PHP 8.4, so `composer.lock` resolved against 8.4 | server runs PHP 8.3; 17 locked packages require `php >=8.4.1` | `composer install` cannot resolve; server cannot install. `AUDIT_FINDINGS.md:124-190` |
| `AUD-API-002` | SQLite accepts a string in a `uuid` column | MariaDB rejects `'2026-07'` in `admin_audit_logs.entity_id` (native uuid) | roster save 500s on the production engine. `AUDIT_FINDINGS.md:194-219` |

A fourth, narrower instance of the same class was found while verifying a candidate: two SQLite CHECK
constraints were silently lost to table rebuilds, so a bad-value regression would pass the SQLite suite and
fail only in production (`AUD-DB-018`, `ISSUE_REGISTER.md:297-305`). And the schema carries 29 `enum()`
columns that are unvalidated `varchar` on SQLite but value-rejecting on MariaDB (`C-DB-011`); the broad
claim that this was a live defect did not hold, but it is the same divergence surface (`AUDIT_FINDINGS.md:301`).

**Why this matters more than any single fix.** The reason all three blockers reached the deployment branch
undetected is a fourth divergence in the pipeline itself: CI pinned PHP 8.3 while the lock required 8.4, so
**no CI job could install dependencies and CI has not been green since the lock file drifted**
(`AUD-INFRA-003`, `AUDIT_FINDINGS.md:110-118`). A green local SQLite suite was never evidence of a healthy
pipeline. The remediation addressed the root cause rather than the symptom: `config.platform.php` is now
pinned in `composer.json` so the lock can never again resolve ahead of the server's PHP, and the parity lane
itself was moved from PHP 8.4 to 8.3 so it actually mirrors production (`AUDIT_FINDINGS.md:134-143`).

The durable recommendation carried by this theme: **run the production database engine and the production
PHP version in CI.** The entire class of blocker above is invisible to any lane that does not.

---

## 4. Highest-risk workflows

Ranked in the discovery baseline by (likelihood broken) x (blast radius); full list at
`artifacts/audit-2026-07-21/discovery/00-DISCOVERY-BASELINE.md:563-597`. The status column records where each
stands after remediation.

| Workflow | Risk | Status after remediation |
|---|---|---|
| Registration / approval subsystem (highest-privilege path, unauthenticated write endpoints) | Was rewritten mid-audit; four unauthenticated write endpoints; enumeration oracle | Hardened: duplicate guard added, session-cookie bypass closed, enumeration aligned to non-revealing responses, academic signup now enters the approval queue (`C-SEC-002/003/004`, `PRE-1`; `ISSUE_REGISTER.md:119-121,130`). Browser coverage still reported separately |
| Duty roster save (admin, superadmin) | 100% failure on the production engine | Fixed and verified end to end through nginx; wrapped in a transaction so an audit failure cannot leave partial roster state (`AUD-API-002/002b`) |
| Academic evaluation submission | No uniqueness key; 4 duplicate groups already in the DB, each counting into published averages | Fixed: uniqueness constraint added, designed to survive the existing duplicates (`C-DB-012`) |
| Notifications for resident / consultant | The system addresses notifications to roles that could not read them (guaranteed functional break) | Fixed: `notifications.view` granted to those roles, caller pinned to own recipient id (`C-AUTHZ-001`) |
| Excel/CSV import + export (active branch headline feature) | No client size/MIME check; a swallowed 422 could turn validation failures into silent "imported 0" | Not addressed by remediation; browser coverage reported separately. Treat as an open verification item |
| Unbounded log tables at scale (`audit_logs`, `notifications`, `admin_audit_logs`, `report_status_history`) | No retention; some read paths pull the whole table into the browser; 11 admin lists unpaginated | Open (`C-DB-013`). These tables are empty in the seeded DB, so behaviour at volume is UNTESTED |
| Analytics endpoints and export | 12 routes with zero in-action authorization and no per-department scoping visible in the controller | REFUTED as a defect (permission middleware is the intended sole control; no cross-department leak demonstrated) but service-level scoping remains UNVERIFIED by any discovery pass (`ISSUE_REGISTER.md:341`; baseline item 13) |

---

## 5. Security release blockers

**There are no open Critical or High security release blockers.** Every confirmed critical and high-severity
security or authorization defect is FIXED-VERIFIED:

- Unauthenticated write amplification and the missing duplicate guard on `POST /api/access-requests`
  (`C-SEC-002`, High) - fixed.
- The session-cookie auth-gate bypass on that same public endpoint (`C-SEC-003`, High) - fixed.
- Residents and consultants unable to read their own notifications (`C-AUTHZ-001`, High) - fixed.
- Public academic signup creating a live account with no approval (`PRE-1`, High) - fixed.
- Account-enumeration oracle across the three registration endpoints and the login path
  (`C-SEC-004`, `PRE-3`, Medium) - fixed.
- Unthrottled `change-password` as a bcrypt CPU-exhaustion primitive (`C-SEC-005`, Medium) - fixed with a
  named limiter.
- CSP/HSTS absent from the SPA document nginx serves (`AUD-SEC-004`, Medium) - fixed at the nginx layer.

The full defensive review is in `SECURITY_AUDIT.md` (OWASP-structured, 13 categories). Two boundary items
remain and are documented, not hidden:
1. The broadcast-channel authorization fix (`C-SEC-009`) is verified in code and unit test, but the live
   exploit path is PREDICTED for on-prem because dev runs `BROADCAST_CONNECTION=log`. Low now, High once a
   real broadcast driver is live (`ISSUE_REGISTER.md:271-277`).
2. Lower-severity hardening the audit named but did not close: the login timing side-channel and the
   `X-Forwarded-For` / `TRUSTED_PROXIES` throttle-bypass question if the deployed value is `'*'`
   (`AUDIT_PROGRESS.md:432`; baseline item 11, open question 6).

---

## 6. Scalability posture (PREDICTED)

**Every scalability figure in this audit is PREDICTED from schema and query analysis. None was measured at
1k, 10k, or 100k users, and no high-concurrency load test was run.** This is stated per the brief's own
requirement and repeated wherever a figure appears. Full detail in `PERFORMANCE_SCALABILITY_AUDIT.md`.

What is MEASURED (not predicted):
- Seeded volume on the parity stack: 50 users, 695 reports, 61,001 `report_field_values`, 758 evaluations,
  61 migrations, 10 seeders (`AUDIT_COMMAND_LOG.md:107`).
- Backend parity suite timing: 314 tests on the production engine, 0 failures (`mariadb-suite-postfix.txt:23`).
- MariaDB write-concurrency: `MariaDbConcurrencyRegressionTest` now executes (it had never run anywhere) and
  all three concurrency scenarios pass, 14 assertions (`AUDIT_PROGRESS.md:259-261`).

The dominant predicted risk is unmanaged retention (`C-DB-013`): 13 unbounded tables, the only prune job
touches read notifications only, `sanctum:prune-expired` is not scheduled, and `audit_logs` is described by
its own migration as "the fastest-growing audit table" (`AUDIT_FINDINGS.md:303`). This is OPEN.

**Hard limit on every performance claim: 20 of 53 tables are empty in the seeded DB**, including
`audit_logs`, `notifications`, `access_requests`, `report_status_history`, `report_comments`, and
`calculated_metrics`. No performance or scalability claim may be made about those paths from this dataset;
real volume exists in only four tables. This caveat applies to the parity lane too, which used the same
seeders (`AUDIT_FINDINGS.md:309-317`; `ISSUE_REGISTER.md:39-43`).

---

## 7. Verified vs predicted: the boundary this audit draws

The entire point of this audit was to separate what was executed and reproduced from what was reasoned about.

**VERIFIED by execution:**
- Both deployment blockers, by destroying and rebuilding the container DB from empty (72 migration/seeder
  steps, exit 0) and by a real `composer install --no-dev --optimize-autoloader` on PHP 8.3.32 (91 installs)
  (`AUDIT_FINDINGS.md:49-57,144-153`).
- The duty-roster 500 fix, end to end through nginx (`PUT` returned 200, audit row 5 to 6)
  (`AUDIT_FINDINGS.md:210-213`).
- Both DB lanes green (SQLite 313 passed / 1 skipped; MariaDB 314 passed / 0 failures), where MariaDB was
  7 failures / 3 errors before remediation (`mariadb-suite-postfix.txt:23`; `AUDIT_FINDINGS.md:22-30`).
- 32 regression tests, each confirmed to fail before its fix.

**NOT executed from this machine:**
- CI green (`AUD-INFRA-003`): GitHub Actions cannot be run locally; needs a push.
- The live broadcast-driver exploit path (`C-SEC-009`): dev uses `BROADCAST_CONNECTION=log`.

**PREDICTED, never measured:** all 1k/10k/100k and high-concurrency figures, and the growth behind
`C-DB-013`.

**Checked and CLEARED (report as non-defects, not as risks):** 7 candidates were refuted as intentional
design or false premises, including the two named in the evidence - "44 unindexed foreign keys"
(`C-PERF-014`) and "29 unvalidated enum columns" (`C-DB-011`) - neither of which held on MariaDB. Five
further refutations are inferred from the remediation leaving them untouched and are flagged as inferred, not
recorded fact (`ISSUE_REGISTER.md:328-352`). `PRE-5` (`student_rep` cannot self-register) is confirmed
intentional.

---

## 8. Remaining untested areas (candid)

This section states plainly what the brief asked for that was not completed. It is deliberately explicit
because the system targets a hospital LAN.

1. **Empirical load testing at 1k / 10k / 100k users and under high concurrency was NOT performed.** All
   scalability numbers are PREDICTED. A `scripts/load-test.mjs` harness exists but was not run at scale
   against a seeded target (baseline honourable mentions; `PERFORMANCE_SCALABILITY_AUDIT.md`).
2. **The full every-page, every-viewport browser sweep is partial.** 8 e2e specs (cross-role authz, IDOR,
   enumeration, notification access, registration+approval, clinical report lifecycle, academic evaluation
   submit, responsive) were authored and committed (`af15ac0`) with firefox/webkit/mobile/tablet projects,
   but the three-browser execution run was interrupted and is being produced separately. Results live in
   `PLAYWRIGHT_TEST_REPORT.md` (produced by the browser workflow), not here (`AUDIT_PROGRESS.md:413-419`).
   Phases 2 to 8 of the audit plan (viewport sweeps, cross-role browser sweeps) are reported there.
3. **CI green is not confirmed.** The PHP 8.3 pin is correct and the parity lane proves the suite passes on
   8.3, but whether GitHub Actions actually goes green must be confirmed on the next push
   (`AUDIT_FINDINGS.md:102-106`).
4. **Performance of the empty paths is UNTESTED.** 20 of 53 tables are empty in the seeded DB, so the audit,
   notification, access-request, and status-history read paths carry no measured behaviour at any volume
   (`AUDIT_FINDINGS.md:309-317`).
5. **Lower-severity hardening is not closed:** login timing side-channel; `X-Forwarded-For` /
   `TRUSTED_PROXIES` throttle-bypass depending on the deployed value; `sanctum:prune-expired` scheduling;
   retention for the 13 unbounded tables (`C-DB-013`) (`AUDIT_PROGRESS.md:430-432`).
6. **Import/export pipeline verification** (client-side size/MIME check, the swallowed-422 discriminator in
   `lib/api/admin.ts`) was flagged as high-risk but not exercised in a browser (baseline item 6).
7. **Several discovery open questions remain unresolved** (analytics service-level scoping, whether the
   on-prem deploy serves `public/_headers`, the deployed `TRUSTED_PROXIES` value): baseline Section 11.

None of these blocks deployment. All should be scheduled before or immediately after go-live and tracked as
open operational items.

---

## 9. Deliverable index

| Document | Contents |
|---|---|
| `FULL_SYSTEM_AUDIT.md` (this file) | Executive report: readiness, counts, the dev-vs-prod theme, risks, boundaries, repro commands |
| `SECURITY_AUDIT.md` | OWASP-structured defensive review across 13 categories, each finding cited to source |
| `DATABASE_REVIEW.md` | 53-table schema; keys, FKs, ON DELETE behaviour, unique constraints, the dev-vs-prod divergence class |
| `PERFORMANCE_SCALABILITY_AUDIT.md` | Strict MEASURED-vs-PREDICTED split; seeded volume, parity timing, concurrency; 1k/10k/100k projections |
| `ISSUE_REGISTER.md` | Reconciled master index; one row per finding with severity, category, verification and fix status, evidence pointer |
| `FIX_VERIFICATION_REPORT.md` | Per-finding fix records: what changed, how it was verified, on which lane |
| `FUNCTIONAL_TEST_MATRIX.md` | Role x workflow coverage for all 12 major workflows across the 6 roles |
| `ROLE_PERMISSION_MATRIX.md` | Roles, permission matrix, route x role access matrix, policy truth tables, escalation paths |
| `PLAYWRIGHT_TEST_REPORT.md` | Browser-based e2e results (produced separately by the browser workflow) |
| `AUDIT_FINDINGS.md` | Source of truth for individual findings (note: not refreshed after remediation; see `ISSUE_REGISTER.md:47-102`) |
| `AUDIT_PROGRESS.md` | Full narrative, checkpoints 0 to 8, deferred items, master checklist |
| `AUDIT_COMMAND_LOG.md` | Chronological command record with outcomes |
| `artifacts/audit-2026-07-21/discovery/` | 6 inventories (schema, routes, roles, SPA surface, modules, tests) + baseline with the 15 risk areas |
| `artifacts/audit-2026-07-21/evidence/` | MariaDB suite runs, `mariadb-failure-triage.md`, header captures, concurrency and CPU probes |

---

## 10. Reproduction commands for the whole audit

All paths relative to the repo root unless noted. Reference set drawn from `AUDIT_COMMAND_LOG.md:14-29,97-116`.

**Backend regression suite, SQLite lane (dev + CI default):**
```
cd backend
php artisan test          # expect: 313 passed, 1 skipped, 0 failures
```

**Frontend gates:**
```
npx tsc -b --force        # typecheck (silent on success)
npm run lint              # zero problems
npm run test:run          # 15 files, 85 tests passed
```

**Production-parity lane (MariaDB 11.4 + nginx + PHP-FPM 8.3), from the docker kit:**
```
docker compose build                          # expect exit 0 on the PHP 8.3 image
docker compose up -d --wait                   # expect exit 0, all 5 services healthy
docker compose ps                             # db/app/web healthy, queue/scheduler up
```
Ports: 8080 (HTTP, 301 to HTTPS), 8443 (HTTPS), 33306 (MariaDB), all bound to 127.0.0.1. The dev servers on
:5173 / :8000 and `backend/.env` are untouched. See `docker/README.md` for the 14 ways this lane still
differs from real production.

**Backend regression suite on the production engine (the lane that catches the divergence blockers):**
```
docker compose --profile test run --rm test   # expect: 314 tests, 0 failures, 0 errors
docker compose --profile test run --rm test --filter MariaDbConcurrencyRegressionTest   # executes, no longer skips
```

**Verify the two deployment blockers are gone (rebuild from empty):**
```
docker compose down -v                        # destroy the container DB
docker compose build && docker compose up -d --wait   # 72 migration/seeder steps, exit 0
# inside the app container:
composer install --no-dev --optimize-autoloader --no-interaction   # 91 installs on PHP 8.3.32 (the deploy.sh:149 command)
php -v                                         # confirm PHP 8.3.32, not assumed
```

**Reproduce the duty-roster fix through nginx (was 500, now 200):**
```
# csrf-cookie -> login -> PUT /api/admin/roster/2028/3 ; expect HTTP 200 and one new admin_audit_logs row
# scripted in artifacts/audit-2026-07-21/evidence/ (login.sh, req.sh)
```

**End-to-end browser suite (self-manages its servers):**
```
npx playwright test       # results reported in PLAYWRIGHT_TEST_REPORT.md (produced separately)
```

**CI (cannot be run locally):** push the branch; confirm all three jobs install dependencies and go green on
PHP 8.3. This is the one verification `AUD-INFRA-003` still needs.

**Liveness note:** there is no `/api/health` route. Probe `/sanctum/csrf-cookie` (expect 204) for liveness
(`AUDIT_COMMAND_LOG.md:29`).

---

## 11. Coverage boundaries (do not overstate)

- **Verified means:** both DB lanes green by direct execution, targeted HTTP reproduction through nginx on
  the parity stack, and rebuild-from-empty plus a real 8.3 `composer install`. It does **not** mean the full
  browser role sweep, which is reported separately and is partial.
- **The findings file is stale post-remediation.** Where `AUDIT_FINDINGS.md` and `ISSUE_REGISTER.md`
  disagree on fix status, the committed code/migrations/tests in `43bbccc` are authoritative
  (`ISSUE_REGISTER.md:47-102`).
- **Scalability is predicted, not measured**, and 20 of 53 tables are empty in the dataset, so whole classes
  of path carry no measured behaviour.
- **Cross-browser claims are bounded:** Chromium and WebKit ran; Firefox was installed and proven to render
  the app; the three-browser execution run itself is reported in `PLAYWRIGHT_TEST_REPORT.md`.

This report is intentionally honest about what it did not do. On a hospital LAN, a report that implies
completeness it does not have is worse than one that states its limits.

---

*End of FULL_SYSTEM_AUDIT.md. Companion deliverables listed in Section 9. Source of truth for issues:
`AUDIT_FINDINGS.md` (with the post-remediation caveat in `ISSUE_REGISTER.md`).*
