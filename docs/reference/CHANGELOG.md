# Changelog

What changed, newest first, grouped by phase. Releases are identified by git
SHA (there are no version tags); dates are commit dates. Earlier phases are
summarised from the commit history and the audit reports in `docs/history/`.

## 2026-09-10: business-rule correction after the regression audit

- `c9aab50` **fix: preserve draft status across report lock lifecycle.**
  Unlocking now restores the pre-lock state (`draft` stays `draft`; submitted
  reports stay submitted) instead of always producing `submitted`. A
  pre-existing client gap that the correction exposed was closed: the report
  summary merge no longer leaves a changed report marked as detail-loaded, so
  an unlocked draft re-fetches its values instead of rendering empty. New
  backend, e2e and regression coverage; the action-items regression spec
  parse error fixed. Owner decisions recorded: the empty report list for
  non-clinical roles and owner-only export downloads are intended.

## 2026-09-09 to 2026-09-10: pre-server hardening (branch `hardening/pre-server`)

- `1ad435e` test: deterministic slow-request observability assertion.
- `f8c2b1a` fix: deployment rollback and recovery strengthened; the
  first-install defect in `deploy.sh` (`readlink -f` on a missing link) fixed
  and covered by the rollback rehearsal.
- `51434b7` docs: hardening report, ledger, operational targets, parity
  environment, reliability targets, retention template, UAT plan.
- `4255283` test: resilience harnesses (capacity stages, failure drills,
  rollback rehearsal, large-data rehearsal), the production smoke suite, the
  business-logic regression harness and differential.
- `23ac9b9` fix: accessibility across clinical and academic workflows (sheet
  focus restoration, muted-text contrast, labels, focus rings, 44 px targets,
  chart titles); 0 axe violations across 78 states.
- `315995e` fix: resilience and data integrity (evidence write failures
  reported, DB connect timeout, referenced ward and section deletion refused,
  autosave retry storm removed, double-submit guards, inbox restore over 50
  rows, login wording, password-change and comment audit rows).
- `172b5f2` feat: offline synchronization hardened (stale-write detection
  with `expectedUpdatedAt` and 409 bodies, the conflict review panel, Web Lock
  replay, dead-lettering after five transient failures).
- `e7251cd` feat: observability (error reporter, request timing with
  `Server-Timing`, client error intake, redaction, optional webhook) and the
  Maintenance health page and endpoint (`system.health`).
- Business-logic regression audit: no hardening regression; two pre-existing
  one-line defects fixed (action-item assignee guard with explicit null; the
  deep-linked action-item sheet re-opening once).

## 2026-09-05 to 2026-09-06: production-readiness remediation and release validation

- `b07b32c`, `32fabae`, `7f0b14f`, `4fce246`, `87d0aef`, `afdaab2`, `88bf241`,
  `984ddf9`: findings QA-001 to QA-028 remediated. Highlights: `npm run verify`
  green again, seeding fixed, the nurse-to-student-representative role
  transition closed at the guard, policies, controllers, payloads and route
  (QA-003), composer advisories cleared, locked reports read-only for
  administrators too (QA-027), future-week reports refused (QA-009), workspace
  revision credential bound to the session (QA-016), separate throttle buckets
  for the public auth routes (QA-024), migration naming rule (QA-021),
  reference-data seeding on first install (QA-007), storage archive in the
  nightly backup (QA-015), `/up` routed to Laravel (QA-020), PHP-FPM upload
  limits (QA-005), Linux-font overflow fixes, parity stack defects fixed
  (queue names, worker user, backup exclusion), branch protection applied.
- `2eb7be2` checkpoint: clinical action governance (alert rules, action
  items with evidence, escalation), the analytics export page (queued CSV and
  Excel), the academic gap seeder.

## 2026-07-28 to 2026-07-29: performance and scalability pass

- Analytics aggregated in SQL with content-stamped caches, lock-on-build and
  background warming (PERF-01, 02); workspace bootstrap payload trimmed and
  report details batched (PERF-03); the revision ledger with database
  triggers and a signed poll token off database sessions (PERF-04); covering
  student-attendance index (PERF-05); production capacity decisions recorded
  (PERF-06, SCALE-07); analytics and notification queues isolated (SCALE-03);
  load harness corrected to one session per virtual user (SCALE-05);
  responsive admin navigation during startup and a lighter mobile login path
  (NAV-01, 02); performance regression guardrails in CI (NAV-04); St Paul's
  naming standardised; clinical workflows finalised (`dc3f815`).
- Decisions recorded: Redis optional; submission-deadline spike handled with
  the database driver.

## 2026-07-21 to 2026-07-23: audit remediation and academic completion

- Role workspaces (clinical and academic toggle), academic approval queue
  with resident scheduling profile, production-parity Docker stack, the
  audit harness (`6494dec`); the two defects blocking deployment and CI fixed
  and the Composer platform pinned to PHP 8.3 (`540c067`, `6bb360f`); sixteen
  audit findings fixed on both database lanes (`43bbccc`); Playwright role,
  authorization and regression specs with multi-browser projects; notification
  defects; e2e stabilisation; WCAG touch-target minimum on mobile;
  administrators can create student representative accounts (`3080e46`).

## 2026-07-12 and earlier: V2 academic expansion

- Academic pillar built in eight phases: sections, wards, duty types and the
  roster service; rotation calendars and the planner; section transfers;
  configurable evaluation forms with versions (the legacy evaluation tables
  copied into the unified engine and verified); morning sessions with
  snapshotted rosters; undergraduate batches, placements, schedules,
  teaching sessions, representative logging and student evaluations; academic
  analytics and the leadership digest's academic block; on-premises LAN
  deployment kit without Redis.
- Clinical additions: editable templates (database overlay over the static
  configuration floor), combined evaluation ranking, the one-year scalability
  fixture, the reporting-period window and live start, export performance
  and the queue worker modes, the fixture gap seeder.

## 2026-05 to 2026-06: V1 clinical platform

- Migration from a Supabase backend to the Laravel API with Sanctum cookie
  sessions (`docs/migration/`).
- Weekly reporting: assignments, periods, draft and submit, edit after
  submission with per-cell audit, lock and unlock, comments, calculated
  metrics, quality analysis, critical-value alerts, overdue sync, tiered
  reminders, notifications, analytics dashboards and CSV export, admin user
  and access-request management, settings, the admin audit trail, the
  security and performance audit (2026-05), the dashboard performance pass
  (2026-06), the white-panel design system and workspace switcher.

## Recording a change

Add a line under a dated heading with the SHA once known, one sentence on
what changed for users or operators, and the document that now owns the rule.
Keep this file free of test counts and run logs; those live in the audit
reports.
