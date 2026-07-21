# V2 Remediation Implementation Guide

## Purpose

This root-level file is the durable implementation and verification ledger for `V2_IMPLEMENTATION_GUIDE.md` and findings IA-001 through IA-017 in `docs/INITIAL_AUDIT_FINDINGS.md`. A code item is complete only when its relevant automated, browser, or operational check passes. Checks that require unavailable host infrastructure are marked `[!]`, never silently treated as green.

## Status legend

- `[ ]` Not started
- `[~]` In progress
- `[x]` Implemented and verified in the available environment
- `[!]` Implementation/gate exists, but execution requires unavailable external infrastructure

## Finding-to-fix ledger

| Finding | Implemented resolution | Evidence |
| --- | --- | --- |
| IA-001 npm advisories | Upgraded React Router and the vulnerable Socket.IO chain; refreshed the lockfile. | Full and production-only npm audits: 0 vulnerabilities. |
| IA-002 roster race | Monthly writes lock the user row and recheck overlaps. Added a true two-process MariaDB regression for simultaneous first assignments. | Sequential/constraint tests pass locally; MariaDB worker is executable in CI and intentionally skips on SQLite. |
| IA-003 transfer race | Pending creation and every transition lock/reload state; application is idempotent with atomic side effects. Added a two-process MariaDB pending-create regression. | Transfer tests pass locally; parallel MariaDB worker is ready for CI. |
| IA-004 evaluation form race | Form-key versions/fields are locked. Content edits require the still-current published row; structure is draft-only and validates before commit. Added a two-process MariaDB draft-create regression. | Form suite and rollback/stale-state tests pass; parallel worker is ready for CI. |
| IA-005 evaluation invariants | Database triggers enforce exactly one subject and evaluator source; active draft/published versions use generated-column uniqueness. | SQLite invariant tests pass; trigger migration explicitly supports `mysql` and `mariadb`. |
| IA-006 timezone ambiguity | Storage/timestamp interpretation remains UTC; hospital calendar decisions and wall-clock scheduling use `HOSPITAL_TIMEZONE=Africa/Nairobi`. | Schedule assertions cover the 00:05/00:10/00:15 jobs, 08:15, 17:00, and Friday 10:00. A midnight-boundary regression proves Sunday 21:10 UTC is handled as Monday in Nairobi. |
| IA-007 partial deployment risk | Locked immutable releases, verified primary/off-box backup, maintenance-held strict readiness, atomic activation, auth-wall check, late queue restart, rollback, and safe dry run. | Deployment contract tests and `bash -n` pass; production-host run remains external. |
| IA-008 disconnected Playwright | Moved tests to `tests/e2e`; isolated launcher recreates a fixed SQLite DB, clears cached config, pins local CORS/cookies/API, refuses server reuse, and cleans DB/cookies. | 106/106 Playwright tests pass; a matching CI browser job exists. |
| IA-009 Composer advisories | Added fail-on-advisory `composer audit` to CI, then upgraded Laravel 13.11.2 to 13.20.0 and the affected Guzzle/Symfony dependency chain. | Local locked audit initially found 9 advisories across 6 packages; the updated lock now reports no security vulnerability advisories and the full backend suite passes. |
| IA-010 Pint failure | Formatted the Laravel tree and added Pint to CI. | `vendor/bin/pint --test` passes. |
| IA-011 undergraduate lifecycle | Completed lifecycle operations, active-scope and active-user DB invariants, inactive-batch validation/revocation, and policy/query defense in depth. | Undergraduate and authorization tests pass. |
| IA-012 recorder cancellation absent | Added designated-recorder cancellation policy/API/UI/audit; record/cancel lock/reload state and retry idempotently. | Race/rollback tests and live Playwright cancel-with-audit pass. |
| IA-013 launch command mismatch | Canonical `app:launch-readiness`; old command retained as alias. Strict mode is satisfiable and any warning fails deployment. | Command-level strict pass/fail tests pass. |
| IA-014 hosting ambiguity | V2 target is documented as on-premises, same-origin Nginx/Laravel with internal-CA TLS. | README, architecture, operations, and deploy files agree. |
| IA-015 TanStack Query missing | Added one QueryClient, validated academic-operation queries, five-minute cache reuse, and auth-cache clearing on every signed-out path. | Unit cache-isolation tests and live repeated-tab request counting pass. |
| IA-016 duplicate leadership digests | Added per-period/per-recipient delivery uniqueness with atomic idempotent queuing. | Running the command twice queues one mail. |
| IA-017 incomplete fixtures | Current/future academic data is rerunnable; today is pending for the recorder; only current-batch reps are active; completed-batch assignments remain historical. | Double-seed/lifecycle tests and all eight browser role setups pass. |

## Track A: Analytics and cache safety

- [x] Cache arrays/scalars rather than Eloquent or paginator objects.
- [x] Cover summary, morning, teaching, student, and per-person cache miss/hit paths.
- [x] Prevent incomplete-class serialization responses.
- [x] Use an explicitly labelled, consistent morning analytics window.
- [x] Validate frontend academic-operation payloads with Zod and render controlled error states.
- [x] Remove invalid chart width/NaN failures from tested flows.
- [x] Prove a morning-to-teaching-to-morning revisit makes one morning request while fresh.
- [x] Clear all QueryClient query/mutation state when authentication is cleared.

## Track B: Authorization and privacy

- [x] Authorize before opening or serializing today's morning session.
- [x] Return 403 to non-designated recorders without creating/exposing a roster.
- [x] Add class/object policy checks to teaching and transfer reads.
- [x] Cover allowed, coarse-permission denial, and policy-narrowing denial paths.
- [x] Keep representatives out of all evaluation endpoints.
- [x] Require active batch and active assignment for representative workspace/session authority.
- [x] Verify recorder, non-recorder, consultant, and three representative scopes in Playwright.

## Track C: Concurrency and database integrity

- [x] Serialize roster writes and reject overlapping assignments.
- [x] Make transfer pending creation and transitions atomic, locked, and idempotent.
- [x] Serialize evaluation content/structure/draft/publish operations by form key.
- [x] Enforce active form, evaluation header, active rep scope, and active rep user invariants in the DB.
- [x] Make morning record/cancel mutually race-safe and audit-idempotent.
- [x] Add true independent-process MariaDB regressions for roster, transfer, and draft races.
- [!] Execute the MariaDB worker suite: Docker Desktop's Linux daemon is unavailable locally; `.github/workflows/ci.yml` runs it on MariaDB 11.4.

## Track D: Evaluation form contract

- [x] Protect only `senior_present`, `senior_joined_at`, `presence_minutes`, and resident `overall_rating` as required core fields.
- [x] Calculate scoring denominators from active score fields.
- [x] Prove optional score fields can be disabled while core fields cannot be removed, disabled, or type-changed.
- [x] Preserve published in-place content editing while keeping structural changes draft/publish-only.
- [x] Roll back invalid mixed content/structure edits before commit.

## Track E: Undergraduate module and development data

- [x] Complete batch, student, placement, schedule, session, and rep-assignment lifecycle routes.
- [x] Deactivate safely where history makes hard deletion unsafe.
- [x] Reconcile schedule edits by removing obsolete current/future pending sessions while preserving recorded history.
- [x] Hide and reject obsolete pending teaching rows at representative/consultant read and write boundaries even after an out-of-band write.
- [x] Enforce one active rep per batch/scope and one active assignment per rep account.
- [x] Reject activation on inactive batches and revoke rep authority when a batch is deactivated.
- [x] Seed current/future rotations, placements, sessions, heads, duties, recorder, and three current rep roles.
- [x] Keep completed-batch rep rows inactive as historical records.
- [x] Make seeding current-date aware and rerunnable through conflict/replacement states.
- [x] Verify group/subgroup isolation and consultant teaching in Playwright.

## Track F: Frontend architecture and runtime quality

- [x] Introduce TanStack Query with one application QueryClient.
- [x] Migrate academic-operation server state to validated queries with cache reuse.
- [x] Clear authenticated query data on logout, expiry, and other signed-out paths.
- [x] Keep ordinary forms on React Hook Form/Zod; dynamic server-authored renderers validate at API/backend boundaries.
- [x] Fix the missing duty-roster row key.
- [x] Remove prohibited em dashes from files touched by this remediation (not claimed as a repository-wide legacy-doc rewrite).
- [x] Cover cache, guards, forms, roster, and role states with Vitest/Laravel/Playwright.
- [x] Keep tested flows free of React key, runtime, and chart warnings.

## Track G: Scheduling, migration verification, and commands

- [x] Keep `APP_TIMEZONE=UTC` for existing clinical timestamp compatibility.
- [x] Configure `HOSPITAL_TIMEZONE=Africa/Nairobi` for wall-clock schedules.
- [x] Derive hospital date-only workflow decisions from a central Nairobi clock while keeping database timestamps in UTC.
- [x] Assert 00:05, 00:10, 00:15, 08:15, 17:00, and Friday 10:00 hospital-time jobs, including a UTC/local midnight-boundary execution.
- [x] Fail vacuous migration comparisons unless `--allow-empty-legacy` is explicit.
- [x] Add canonical launch-readiness command and compatible alias.
- [x] Store readiness host settings in config so they survive `config:cache`.
- [x] Verify a cached-config application boot and clear the generated cache afterward.

## Track H: Deployment and production safety

- [x] Use immutable release directories and an atomic `current` switch.
- [x] Build/validate before migration or activation.
- [x] Require and integrity-check a primary and secondary/off-box pre-migration backup.
- [x] Keep maintenance active through strict readiness; only then bring the app up, check the auth wall, and restart the queue.
- [x] Roll back the active code link on any post-activation error.
- [x] Add lock, first-deploy cleanup, rollback guidance, and no-write `--dry-run`.
- [x] Pin Node.js 22.12.0+ and validate it in dry-run.
- [x] Document on-premises same-origin hosting and internal-CA TLS.
- [x] Pass local `bash -n`; add ShellCheck as a required CI job.
- [!] Run strict readiness on the actual host after MariaDB, systemd, cron heartbeat, primary/secondary backups, restore-drill attestation, error monitoring, and TLS exist.

## Track I: Dependencies and quality gates

- [x] Resolve all npm advisories.
- [x] Resolve all locally observed Composer advisories and validate the updated lock file.
- [x] Add Composer audit, Pint, ShellCheck, MariaDB, and isolated Playwright gates to CI.
- [x] Pass local Pint, frontend verification, npm audit, SQLite backend, and browser suite.
- [!] Observe ShellCheck/MariaDB CI results after pushing; the local workstation lacks ShellCheck and a running MariaDB daemon. Composer audit passes locally and is repeated in CI.

## Final verification matrix (2026-07-17, Africa/Nairobi)

- [x] `npm run verify`: ESLint pass; 11 Vitest files/65 tests pass; TypeScript and Vite production build pass.
- [x] `npm audit` and `npm audit --omit=dev`: 0 vulnerabilities.
- [x] `php composer.phar validate --strict`: valid; `php composer.phar audit --locked`: no security vulnerability advisories.
- [x] `backend/vendor/bin/pint --test`: pass.
- [x] `php artisan test --compact`: 259 tests discovered; 258 pass, 1 intentional MariaDB-only skip; 1,753 assertions.
- [x] Isolated SQLite migrate/fresh/current-date seed is automatic in the Playwright launcher; rerun/conflict seeder regressions pass.
- [x] Meaningful academic migration verification fixture and empty-legacy fail/override tests pass.
- [x] Launch-readiness alias and strict pass/warn-fail command tests pass.
- [x] Laravel `config:cache` followed by an application boot passes; cache cleared afterward.
- [x] Git Bash syntax check passes for deploy, backup, and firewall scripts.
- [x] Playwright recorder cancellation with reason/state/audit.
- [x] Playwright analytics revisit makes one cached request; admin dashboard has no 390px horizontal overflow.
- [x] Playwright resident pairing, nurse 60-field report, consultant teaching, and all representative isolation flows.
- [x] Full isolated Playwright on the final code/dependency lock: 106/106, 0 skipped/unexpected/flaky, 8.0 minutes.
- [x] E2E cleanup: `backend/database/e2e.sqlite` and `tests/e2e/.auth` absent after the run.
- [x] Independent sub-agent review completed; every reported lifecycle, cache, deployment, backup, migration, and authorization blocker was addressed and the full local gates were rerun afterward.

## Browser evidence

- Full HTML report: `playwright-report/index.html`
- Full JSON result: `test-results/results.json`
- Interactive CLI evidence and screenshots intentionally retained under `output/playwright/v2-remediation/.playwright-cli/`
- Mobile admin screenshot: `page-2026-07-17T08-25-33-514Z.png`

## Environment-only release gates

Before production release, the pushed CI run must repeat Composer audit and show ShellCheck, MariaDB 11.4 (including true parallel workers), and isolated Playwright green. The real host must then pass `php artisan app:launch-readiness --strict`. Those external checks are explicit gates, not waived application failures.
