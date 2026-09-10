# Business-logic regression report

Final sign-off that the pre-server hardening phase preserved the platform's
clinical, academic, administrative, authorization and operational business
rules. Status date: 2026-09-10.

# Executive Summary

**The hardening work preserved the intended business logic.** Every rule in
the inventory below was exercised against the running application through
the API and, for the user-facing flows, through the real browser UI, with an
independent database re-read after each mutation. A side-by-side run of the
same 49 workflow steps on the pre-hardening baseline and on the hardened tree
showed five behavioural differences, all of them the intended hardening
changes. The authorization matrix (194 routes, 7 roles, 1,052 requests)
produced zero unexpected 2xx answers.

No hardening regression was found. The audit did surface two small defects
that pre-date the hardening (byte-identical code at the baseline commit) and
were fixed with regression tests because they are silent invalid-state
failures of the kind Phase 9 targets: an action item could be moved to
"in progress" while its assignee was cleared, and closing a deep-linked
action-item sheet re-opened it once. Three further pre-existing behaviours
are recorded as observations, unchanged, for the owners to decide on.

# Compared Versions

```text
Baseline:  b07b32c (fix/mobile-touch-targets), the remediated release candidate
Hardening: hardening/pre-server working tree, 2026-09-09/10
           (104 tracked files modified, 60 new files before this phase;
            this phase adds the regression harness and two one-line fixes)
```

# Runtime-Sensitive Files Reviewed

`BUSINESS_LOGIC_CHANGE_REVIEW.md` classifies every changed file
(BUSINESS LOGIC 7, AUTHORIZATION 5, DATA INTEGRITY 6, OBSERVABILITY 14,
UX ONLY 55, INFRASTRUCTURE 12, TEST ONLY 22, DOCUMENTATION 15) and reviews
the 32 runtime-sensitive ones with original behaviour, current behaviour,
intended impact, risk and the verification that closed it. Twenty-two
frontend files had zero non-colour changes (contrast tokens only).

Verification method (all phases): the regression harness
`playwright.regression.config.ts` with the specs under `tests/regression/`
(findings under `output/regression/*.json`, one row per rule with expected,
actual and evidence), `scripts/regression/differential.mjs` for the baseline
comparison, and the existing suites. Evidence labels: **VERIFIED** (rule
exercised, DB re-read, matches the code), **INFO** (observation, no
expectation), **PRE-EXISTING** (behaviour identical at the baseline).

# Authentication

VERIFIED (`tests/regression/auth.spec.ts`, 63 checks, 38 DB re-reads):
active user logs in and `last_login_at` is stamped; wrong password and
unknown identifier answer the identical 422 body (enumeration rule intact);
identifiers are case-insensitive; a deactivated user's login is refused and
their existing session answers 403 on the next request; logout invalidates
the session (`/api/auth/me` 401); the forced password change gate blocks
every non-auth route with `passwordChangeRequired: true` until
`POST /api/auth/change-password`, after which role, active flag and
permissions are unchanged and one `change_password` audit row exists with no
password or hash; a session whose password hash changed is signed out
(`AuthenticateSession`). Password reset: forgot-password answers the same
202 for known and unknown addresses and creates a token row only for the
known one; the token from the mail log resets once, a second use is 422; role
unchanged; audit row `method: reset_link`. Throttles: login 429 within the
10-per-minute bucket; forgot-password keeps answering (independent bucket);
registration 429 on the 11th request.

# Roles and Authorization

VERIFIED (`auth.spec.ts`, `authorization-matrix.spec.ts`,
`admin-boundary.spec.ts`): a pending nurse registration creates an inactive
user; approval activates the user, creates the requested assignments and
audits `userActive` plus `grantedAssignments`; rejection leaves the user
inactive and unable to log in. An ordinary admin cannot deactivate, delete or
re-role the maintenance account (403 x4) and cannot create an admin (403);
the maintenance account cannot deactivate itself. Role transition: a nurse
with an active assignment cannot become a student representative (422
"Retire this nurse's active reporting assignments"); after the assignment is
retired the change succeeds, and the converted account gets 403 on the report
list, report read, save and submit, with the former report row untouched and
an empty assignment list in the workspace.

# Clinical Assignment Rules

VERIFIED (`clinical.spec.ts`, 95 checks, 129 DB re-reads): an assignment
grants exactly that department to that nurse (workspace lists it); a second
identical assignment is an idempotent upsert (200, same id, one row,
PRE-EXISTING); an unrelated nurse cannot read or save against it (403);
retiring the assignment removes save (403), read (403) and the list entry,
while admin and maintenance still read the report; re-activation restores it.

# Clinical Report Lifecycle

VERIFIED through the API (`clinical.spec.ts`) and through the real form
(`ui-clinical.spec.ts`, 36 checks): save creates exactly one `reports` row
with status `draft`, one `report_field_values` row per cell equal to the
values sent, a status-history row, and UTC timestamps within a minute; the
read returns the same cells; a second save with the loaded `updatedAt`
updates in place (still one row); a save without the key keeps the historical
last-write-wins behaviour; submit sets `submitted`/`submitted_at`, writes the
history row, notifies the 13 active administrators and recomputes the
calculated metrics (BOR, BTR, ALOS recorded); editing after submission marks
`edited_after_submission` with one `audit_logs` row per changed cell (actor,
old, new). In the browser: My Reports shows the week card, typing three cells
and Save draft sends exactly one request, values persist across a reload,
the edited value is saved again, Submit changes the status chip and the DB,
and the buttons are disabled while a save is pending.

# Locking and Comments

VERIFIED: an admin lock sets `locked_at`, writes the history row and notifies
the nurse; nurse save/submit and admin save on a locked report are refused
(403 from `ReportPolicy::update`, values unchanged); unlock clears the lock
and restores the report's pre-lock lifecycle state, and the nurse may edit
again; the lock/unlock buttons send one request each. Comments: the report
owner and an administrator can comment (201, row, `comment` audit row
carrying the body, participants notified); a foreign nurse gets 403; a
comment leaves the report's status and values untouched; the author can
delete their own comment (audit `delete` keeps the body), a foreign user
cannot (403).

Business rule (product-owner decision, 2026-09-10): **locking a report
temporarily prevents modification. Locking does not submit a draft report.
Unlocking restores the report to its existing lifecycle state. A draft
remains a draft; a submitted report remains submitted.** Submission happens
only through the submit workflow.

VERIFIED after the fix (`clinical.spec.ts` E2, `ui-clinical.spec.ts` D-3,
`offline-rules.spec.ts` AA-09, backend `ReportLockLifecycleTest`, e2e
`report-lock-lifecycle.spec.ts`): a locked draft keeps `submitted_at` null;
the unlock response, an independent `GET /api/reports/{id}` and the row all
read `draft` with `locked_at` and `submitted_at` null; the trail reads
`draft -> locked -> draft` with no `submitted` row, no submission
notification and no `audit_logs` cell rows; the nurse's form shows the
Status card "Draft", no "Submitted" chip, the unchanged values, and a save
lands under draft rules; `submitted -> lock -> unlock` stays `submitted`
with `submitted_at` unchanged and the form still says "Submitted";
`edited_after_submission` is restored as before. Before the fix the same
draft came back as `submitted` (the four draft scenarios of
`ReportLockLifecycleTest` fail against the old service with
`'draft'` expected, `'submitted'` actual).

# Reporting Periods and Deadlines

VERIFIED: a save against a future week is refused (422 "has not started",
no row) for nurse and admin; a past week inside the window is accepted; the
default list is the newest nine periods since the live start, including the
current one, and `reportPeriodWindow=all` widens it; the current period's
`week_start` is the Monday of the Africa/Nairobi week. Deadline settings:
`00:00`, `09:30`, `10:00`, `23:59` are accepted and every one of the 136
`reporting_periods.deadline_at` values is recalculated from the weekday and
time; `24:00`, `25:99`, `12:60`, `99:99` are refused (422) with the setting
and every deadline unchanged; the original settings were restored and
verified.

# Action Items

VERIFIED (`action-items.spec.ts`, 74 checks): validation (title, severity,
assignee must be an active administrator); create writes the row, the
`opened` history row and the audit row and notifies the assignee; reassign,
update and comment write their history rows; the state machine accepts the
eight valid transitions and refuses eleven invalid ones (422, status
unchanged) including resolve without a note and close from anything but
resolved; nurses, residents and student representatives get 403 on every
route. **Defect fixed (pre-existing):** `status: in_progress` together with
`assigned_to: null` passed the "assign before starting" guard because the
null was read as "absent", leaving an in-progress item with no owner; the
guard now treats an explicit null as no assignee (`ActionItemController`,
regression test `test_starting_work_while_clearing_the_assignee_is_refused`).
**Defect fixed (pre-existing):** closing a deep-linked sheet
(`/admin/action-items?item=ID`) re-opened it once because the handled-id
reset raced the router transition; the id is now released only when the URL
has dropped the parameter (`action-items-page.tsx`, verified by AE-06).

# Evidence Uploads

VERIFIED (`action-items.spec.ts`, 23 filesystem re-reads): 1 KB PDF and PNG
uploads write the row and the file under `action-items/{item}/{uuid}.ext`
with history and audit rows; 11 MB is refused (413) with no row and no file;
HTML, SVG, PHP and EXE bodies are refused (422) with both their own and a
spoofed PDF MIME type; download works for the admin and the maintenance
account with the exact bytes, 403 for nurse and resident, 401 anonymous, 404
for an unknown id or another item's evidence id; delete removes the row and
the file; no orphan rows or files remained. 3 MB and 9 MB uploads were
SKIPPED on this workstation because its PHP has `upload_max_filesize=2M`; the
refusal carried the actionable message from `Uploads::failureMessage` (the
parity stack and the host use the 10 MB limit).

# Exports

VERIFIED: an export request is queued (202, `pending`), the running worker
makes it `ready` in about two seconds with the file on disk and
`expires_at` seven days out; the owner downloads it (CSV header and byte size
match the row); another administrator gets 403 (download is owner-only,
PRE-EXISTING), nurse 403, anonymous 401, unknown id 404; two identical rapid
requests produce two rows with two distinct files.

# Notifications

VERIFIED (`notifications.spec.ts`, 29 checks): a recipient lists only their
own rows (count equals the DB); `recipient_id` is ignored for non-admins;
mark-read sets `read_at` and is idempotent; mark-all reads every row; clear
hard-deletes; restore re-inserts the same ids; foreign ids in read, clear or
restore touch nothing (200 with a zero count); 51 ids in one restore call are
refused (422) and 50 accepted (the SPA batches by 50); deep links resolve.

# Workspace Switching

VERIFIED: the Clinical/Academic preference is client-side
(`localStorage stpaul:workspace`); switching Clinical to Academic to Clinical
as admin and as maintenance leaves `role` and the sorted permission list
identical (30 and 34 permissions); workspace-scoped endpoints refuse an
unknown workspace (422) and a nurse (403).

# Resident Evaluations

VERIFIED (`academic.spec.ts`, 87 checks, 88 DB re-reads): form options list
the resident's paired consultants for today; a valid submission creates one
`evaluations` row (form id, author, subject, today's date, ward snapshot) and
one answer per field; it appears in my-submissions and in the audit trail
(form key, subject, date, no answers); future dates, duplicates for the same
subject and day, unpaired subjects, wrong-role subjects, missing required
fields and the wrong endpoint direction are all refused (422); the subject's
my-performance view exposes aggregates only, never the author.

# Consultant Evaluations

VERIFIED: the mirror flow with the same rules (direction guard, pairing,
uniqueness, required fields, history, anonymised performance view).

# Student Evaluations

VERIFIED: a weekly evaluation stores the placement snapshot (ward,
placement type, week start) and its answers; a final evaluation is accepted
with a null week; unknown student ids and form keys are refused. INFO:
student evaluations are deliberately not ward-gated (any consultant may
evaluate any active student), unchanged.

# Evaluation Form Versioning

VERIFIED: a draft is version+1 with the same fields; content edits on the
published version stay in place; deactivating, removing or retyping a core
field is refused (422) and the draft is rolled back; reserved keys are
refused; adding one optional field and publishing archives the old version
and publishes the new one; the 1,052 historical evaluations keep their form
id and their answers are byte-identical (sha256 before and after); a new
evaluation binds to the new version and stores the new field; every step is
audited.

# Student Representative Workflow

VERIFIED: the representative's session list equals their `rep_assignments`
scope (group vs subgroup); recording held and not-held (with a reason)
updates the session row, actor and timestamp with an audit row; a missing
reason is refused; another subgroup's or cohort's session is 403; every
clinical, admin and evaluation route answers 403 (`GET /api/reports` answers
200 with zero rows, PRE-EXISTING: the list is scoped, not refused).

# Morning Sessions

VERIFIED: settings and the workspace agree on session days, time and the
designated recorder; the recorder opens today's session lazily and records
140 attendance rows (server-side delay computed); a non-recorder gets 403;
recording or cancelling a past session is refused; a recorder cannot cancel a
recorded session; an admin cancel removes the attendance (audited with the
row count); no session is ever `cancelled` with attendance rows attached.

# Transfers

VERIFIED (`structure.spec.ts`, 103 checks, 132 DB re-reads): a request into
the consultant's own section is refused; a second pending request is
refused; the request appears in "mine" and in the destination head's queue;
a non-destination head cannot approve and a non-owner cannot cancel; the
author cancels a pending request (audited) and cannot cancel it twice; a past
effective date is refused; approval by the destination head schedules the
move (`effective_on` = first of next month, `users.section_id` unchanged
until then); re-approval, cancelling an approved request and a nurse filing
are 403.

# Roster

VERIFIED: a month save writes the duty rows and the audit row; invalid user,
invalid type, a daily type in a month cell, month 13, day 32, dates beyond
two years and a monthly type on the day strip are refused; the same person
twice in one payload resolves last-wins and a second save replaces the month
(no confirmation flag exists in the code); a rotation-managed resident needs
an override reason; daily duties stack on monthly ones; nurses and residents
are 403.

# Rotations

VERIFIED: calendar creation validates labels, block lengths and start dates;
unknown users, consultants, foreign or unknown blocks and daily duty types
are refused; a plan writes the rows and the audit; a reasoned roster override
then requires `confirmOverwrite` on the next plan save (audited); seeded
calendars and other residents' assignments are untouched by re-planning.

# Undergraduate Administration

VERIFIED: batch date validation; student create, update and import (duplicate
external id skipped, nameless line ignored, counts match); a duplicate
placement for the same subgroup and week is an idempotent re-point (201,
same id, never a 500); moving a placement onto an occupied week is refused;
sessions are generated from placements; cancels need a reason; schedules and
representative assignments validate scope and uniqueness; deletes are
audited deactivations that keep dependants.

# Structure Administration

VERIFIED: ward, section and duty type create/update are audited; a ward
referenced by a placement, a section referenced by consultants or by a
transfer request (even a cancelled one), and a duty type referenced by a duty
assignment all refuse deletion with 422 "deactivate instead" and survive;
deactivation works; unreferenced rows delete; `set-consultant` validates the
role and moves the consultant's section with an audit row; consultants and
nurses get 403 on every structure route. The hardening widened the ward and
section guards (student placements, teaching sessions, evaluations, transfer
history) from a raw database 500 to the same 422 shape.

# Settings

VERIFIED: changing one setting changes only its `app_settings` row
(`updated_at` is touched on all rows because the update upserts every key,
INFO); deadlines are untouched by unrelated changes; the settings page's
toggles and direction selects still change values and save (verified by API
and DB in `ui-clinical.spec.ts`), and the originals were restored.

# Audit Trail

VERIFIED (`AuditIntegrityTest` 16 tests plus every domain spec): actor,
action, target type and id, timestamp and before/after values were checked
independently in `admin_audit_logs` / `audit_logs` for assignments, locks,
comments, password changes, access-request decisions, roster and rotation
saves, structure changes, evaluations, morning sessions and teaching logs;
nurses get 403 on both audit listings; no route can update or delete an
audit row (policies deny explicitly).

# Offline Business Rules

VERIFIED (`offline-rules.spec.ts`, 25 checks, all in the real browser with the IndexedDB queue inspected): an offline save
queued before an admin lock is refused on reconnect (409 with the locked
copy), parked as a conflict with reason `locked`, the DB cell unchanged and
the report still locked, with Save and Submit disabled while the panel is
open; a queued save whose assignment was retired meanwhile is refused (403)
and parked as `rejected` with the DB unchanged; a replayed payload for a
future week is refused (422) and writes nothing; a queued save survives a
session expiry (the app goes to the login page, the IndexedDB record stays)
and replays after the next sign-in. The queue carries no authority: every
replay is an ordinary authenticated request judged by the server.

Lock fix regression (2026-09-10): the same lock-while-waiting scenario now
asserts that after the unlock the status and `submitted_at` equal exactly
their pre-lock values (AA-09; the seeded report was `edited_after_submission`
and came back as such), and the isolated e2e scenario B
(`offline-sync.spec.ts`) asserts that a locked DRAFT returns as `draft` with
no `submitted_at`, the parked offline value (6) not replayed and the server
copy (5) kept. Server conflict rules stayed authoritative: the replay is
still refused with 409 while locked and "Keep the server copy" drops it.

# Concurrent Editing

VERIFIED (API in `clinical.spec.ts`, two browser sessions in
`offline-rules.spec.ts`): A saves with the loaded revision (200); B saves the
same stale revision (409 with A's values in `conflict.report`, DB unchanged);
B re-saves with the fresh revision (200); in the browser B sees the conflict
panel, "keep the server copy" shows A's values, "apply my changes" is an
explicit, audited overwrite; a client that omits the key keeps the historical
last-write-wins behaviour.

# Observability Isolation

VERIFIED (`observability.spec.ts`): malformed client-error reports are 422
and nothing is stored; with `OBSERVABILITY_WEBHOOK_URL` pointed at a dead
port, login, report save, submit and a forwarded client error all completed
(200/201) while the reporter logged its notices; `.env` was restored
byte-identically. `RecordRequestTiming` and the exception hook never changed
a response.

# Maintenance Health Authorization

VERIFIED: `GET /api/admin/system-health` answers 401 anonymous, 403 for
nurse, resident, consultant, student representative and ordinary admin, 200
for maintenance with `Cache-Control: no-store`; the body contains no key or
value that looks like a secret (no `APP_KEY`, database password or webhook
URL; the webhook is reported as a boolean).

# Accessibility Regression

VERIFIED (`ui-clinical.spec.ts` AE checks, `mobile.spec.ts`): one click on
Save draft, Submit, Lock and Unlock sends one request; buttons are disabled
while a save is pending; the sheet Close buttons close the action-item and
account sheets, send nothing and return focus to the opener; the Radix status
filter still filters the submissions board; the workspace toggle switches;
four chart SVGs render on the dashboard; settings toggles and selects change
and save; the report page shows no active hidden control while locked.
Mobile (320, 360, 375, 390, 430 px, touch): see Mobile Regression below (108 checks).

# API Authorization Matrix

`output/regression/authorization-matrix.md` (194 routes x 7 roles, 1,052
requests sent). Expectations come from each route's `permission:` middleware
and the permissions `/api/auth/me` reports per role; mutations were only sent
as roles the middleware refuses, so nothing was written. **Unexpected 2xx:
0.** Allowed GETs never answered 401/403 except two documented policy
narrowings that exist unchanged at the baseline: a consultant who heads no
section cannot list transfer requests, and an export download is owner-only.
No route answered 5xx to any role.

# Database Verification

Every mutation in the domain specs was followed by an independent read of the
affected rows: 46 (auth, observability) + 129 (clinical) + 117 (action items,
notifications) + 88 (academic) + 132 (structure) + UI/offline/mobile reads
(294) = 806 database re-reads, plus 23
filesystem re-reads for evidence and export files. Orphan records found: 0.
Unexpected duplicates: 0. Invalid states discovered: 1 (an in-progress action
item with no assignee, pre-existing, fixed).

# Mobile Regression

VERIFIED (`mobile.spec.ts`, 108 checks, 6 skipped where no free evaluation
subject remained for the day) at 320, 360, 375, 390 and 430 CSS px with touch
emulation. At every width: the nurse reaches My Reports from the tab bar,
opens the week's report, switches day tabs with "Next day" and a tapped day
(`aria-current` follows), types a value and taps Save, and the cell is in the
database; the resident selects a subject, rates and submits through the touch
form and one `evaluations` row appears; the student representative marks a
session held or not held from `/teaching` and the row updates; the nurse
opens a notification (read), clears the inbox (the shown rows are deleted)
and restores it (the same ids come back); at 390 px the admin opens an
action item from its row, starts it from the sheet (status `in_progress`,
history row) and closes the sheet with its Close button. No page scrolled
horizontally at any width and every tapped control measured at least 44 px
tall.

# Unexpected Behavioral Differences

`output/regression/differential.md`: the same 49 steps on the baseline and
the hardened tree, each on its own copy of one database snapshot.

| Workflow | Baseline | Hardened | Intended? |
|---|---|---|---|
| Maintenance permission count | 33 | 34 (`system.health`) | yes |
| Save with a stale `expectedUpdatedAt` | 200 (key ignored, overwrite) | 409 with the server copy | yes (opt-in conflict detection) |
| Comment create | no admin-audit row | one `comment` audit row | yes |
| Self-service password change | no audit row | one `change_password` audit row | yes |
| `GET /api/admin/system-health` | 404 | 200 | yes |

The other 44 steps answered identically: login and enumeration, workspace
shape, assignment creation and duplicate, draft save and re-save without the
key, submit, lock (403 while locked), unlock and edit after unlock, comments
and foreign comments, future period (422), settings validation and
recalculation, referenced-ward delete (422 on both; the hardened message
lists more reference types), unreferenced ward delete, action-item creation
and transitions, evidence upload and HTML refusal, export request,
notifications, student-rep and cross-nurse boundaries, role transition
refusal and completion, analytics dashboard.

# Regressions Found

Business-logic regressions introduced by the hardening: **0**.

Pre-existing defects found by the audit (identical code at `b07b32c`):

1. `PATCH /api/admin/action-items/{id}` with `status: in_progress` and
   `assigned_to: null` passed the assignee guard (`??` read the null as
   absent) and left an in-progress item without an owner.
2. Closing a deep-linked action-item sheet re-opened it once (handled-id
   reset raced the React Router transition that removes `?item=`).

# Regressions Fixed

Both pre-existing defects above, minimally:

- `backend/app/Http/Controllers/Api/Admin/ActionItemController.php`:
  `array_key_exists` instead of `??` in `assertTransition`; regression test
  `ActionItemTest::test_starting_work_while_clearing_the_assignee_is_refused`
  (422, status and assignee unchanged).
- `src/pages/admin/action-items-page.tsx`: the handled deep-link id is
  released by an effect once `?item=` is gone, not inside `closeSheet`;
  verified by `ui-clinical.spec.ts` AE-06 (closes within 4 s, no request
  sent, row unchanged).

Draft unlock business-rule correction (product-owner decision, 2026-09-10;
commit "fix: preserve draft status across report lock lifecycle"):

- Root cause: `ReportLockingService::setLockState(false)` restored
  `edited_after_submission` when that history row existed and otherwise
  `submitted`, without ever checking whether the report had been submitted,
  so `draft -> lock -> unlock` produced `submitted` with `submitted_at` still
  null. Lock state is design A (the `status` column itself becomes `locked`,
  `locked_at` set) and no explicit pre-lock column exists; the pre-lock state
  is nevertheless fully determined by `submitted_at`, which only the
  submission workflow writes and nothing clears (the same invariant
  `ReportSubmissionService::save` uses as `$hadSubmission`; every seeder and
  test that creates a submitted report sets it). No schema change.
- `backend/app/Services/Reports/ReportLockingService.php`: unlock restores
  `draft` when `submitted_at` is null, otherwise `edited_after_submission`
  when the history carries it or `submitted` (`restoredStatus()`); the lock
  branch is unchanged and never touches `submitted_at`. Regression class
  `backend/tests/Feature/ReportLockLifecycleTest.php` (8 tests: draft and
  submitted and edited round trips, no submission side effects on lock or
  unlock, view/comment/list never submit, nurse resumes draft editing and
  can still submit explicitly, submitted-report rules after unlock).
- `src/context/app-data-context.tsx` (`loadReportSummaries` merge): a
  pre-existing client gap that the corrected rule made reachable. When a
  report summary arrives with a changed `updatedAt` (an unlock changes it),
  the record was replaced by the value-less summary but its id stayed in the
  "details loaded" set, so the form rendered an empty grid for the draft and
  the next save wiped the stored cells (reproduced: two saved cells, lock,
  unlock, reload, empty inputs, no details request, one cell deleted by the
  save). Submitted and locked reports were protected by the form's
  empty-saved-cells verification; drafts were not, and before the fix a
  locked draft always came back as `submitted`, which is why it never
  showed. The merge now drops the id when the loaded record cannot be reused
  (the rule the workspace merge already applied), so the form fetches the
  details again. Verified by the probe (details request fires, inputs show
  the saved values) and by `ui-clinical.spec.ts` D-27/D-28.
- `tests/regression/action-items.spec.ts`: the committed file did not parse
  (`const body` declared twice in K-07) so Playwright refused the whole
  file; the second binding is now `text`. Harness only, no rule changed.

# Remaining Concerns

Pre-existing behaviours confirmed as intended by the product owner on
2026-09-10 (unchanged, now documented as rules):

- `GET /api/reports` answers 200 with zero rows to a student representative
  instead of 403 (scoped list). Intended: a student representative may
  receive an empty collection but never a clinical report or a clinical
  report permission; `GET/PUT /api/reports/{id}`, submit, lock and unlock
  stay denied (`auth.spec.ts` B4-list 200 total 0, B4-former-report
  403/403/403/403; authorization matrix 0 unexpected 2xx).
- An analytics export can be downloaded only by the administrator who
  requested it; other administrators get 403. Intended: owner-only
  downloads (`action-items.spec.ts` K-07 owner 200, K-08 other admin 403).

Pre-existing behaviours left unchanged (not regressions):

- The action-item search escapes `_` in a way SQLite ignores (dev only;
  MariaDB unaffected).
- This workstation's PHP limits uploads to 2 MB, so the 3 MB and 9 MB evidence
  cases were exercised only through the actionable refusal; the parity stack
  and host use 10 MB.

# Final Test Results

## Draft unlock fix (2026-09-10, after the audit)

Run from the working tree of the fix commit:

| Gate | Result |
|---|---|
| Targeted backend (`ReportLockLifecycleTest`) | 8 passed, 0 failed, 109 assertions; against the old service 4 failed (`'draft'` expected, `'submitted'` actual) |
| Neighbouring backend classes (`ReportWorkflowTest`, `AuditIntegrityTest`, `DataIntegrityInvariantsTest`, `AuthorizationTest`, `ReportCommentTest`, `RoleTransitionAuthorizationTest`) | 65 passed, 0 failed |
| `npm run verify` (lint, 171 unit tests in 30 files, load-test contract, build, bundle budget) | PASS |
| `php artisan test` (SQLite) | 453 tests: 452 passed, 1 skipped, 4,305 assertions |
| `php composer.phar audit --no-dev`, `vendor/bin/pint --test` | no advisories; PASS |
| MariaDB 11.4 lane (`docker compose --profile test run --build --rm test`) | OK, 453 tests, 4,426 assertions |
| Regression harness `clinical.spec.ts` (incl. new E2 draft lock cycle) | 103 PASS, 0 FAIL |
| Regression harness `ui-clinical.spec.ts` (incl. new D-3 draft lock cycle through the UI) | 47 PASS, 0 FAIL |
| Regression harness `offline-rules.spec.ts` (AA-09 now asserts the pre-lock state) | 25 PASS, 0 FAIL |
| Regression harness `auth.spec.ts` (student representative: list 200 with 0 rows, clinical routes 403) | 58 PASS, 0 FAIL |
| Regression harness `action-items.spec.ts` (export owner 200, other admin 403) | 74 PASS, 0 FAIL |
| Authorization matrix | 194 routes x 7 roles, 1,052 requests, 0 unexpected 2xx, 0 mismatches |
| `npm run test:e2e` (isolated gate, 227 tests incl. new `report-lock-lifecycle.spec.ts` and the strengthened `offline-sync` B) | first run 222 passed, 2 skipped, 1 failed (the new spec's fixture picked a department already reported this week; fixture fixed, spec re-run alone 3 of 3); full re-run: see the line below |
| Full `npm run test:e2e` re-runs after the fixture fix | second run 221 passed, 2 skipped, 2 failed while the parity smoke ran on the same machine (the new spec's history-trail assertion had no defined order for two transitions inside one second, now landed in separate seconds; `academic-evaluation-submit` timed out at 20 s, unrelated to the change); third run, nothing else running, 224 passed, 2 skipped, 1 failed (`performance.spec.ts` admin navigation p95 668 ms against the 650 ms budget on PHP's built-in server, an advisory budget on this host that passed in the two earlier runs of the same code); the failed specs re-run alone: `report-lock-lifecycle` 3 of 3, `academic-evaluation-submit` 4 of 4, `performance` 5 of 5. Every functional spec passed in at least one full run of the final tree; `report-lock-lifecycle.spec.ts` passed in the third full run. |
| Parity stack rebuilt (`RELEASE_SHA=lockfix-<sha>`), `npm run test:smoke` | 14 of 14 |
| Parity stack API + MariaDB row check (real requests, rows read with the `mariadb` client) | draft -> lock (`submitted_at` NULL) -> unlock -> draft; nurse PUT 403 while locked, 200 after; submit -> lock -> unlock -> submitted with `submitted_at` unchanged; trail `draft,locked,draft,submitted,locked,submitted` |

## Hardening audit (2026-09-10)

Run from the final working tree on 2026-09-10 (the same tree the commits
below were made from):

| Gate | Result |
|---|---|
| `npm run verify` (lint over the app, tests and the regression harness; 171 unit tests in 30 files; load-test contract; production build; bundle budget) | PASS |
| `php composer.phar install` + `audit --no-dev` | PASS, no advisories |
| `php artisan test` (SQLite) | 445 tests: 444 passed, 1 skipped, 4,196 assertions |
| `vendor/bin/pint --test` | PASS |
| `npm audit --omit=dev` | 0 vulnerabilities |
| `npm run test:e2e` (isolated Vite + `php artisan serve`, 224 tests incl. `offline-sync` and `failure-recovery`) | 222 passed, 2 skipped, 0 failed (21.8 min) |
| `E2E_A11Y=1 npm run test:e2e` (accessibility audit) | 48 passed, 0 failed (10.4 min) |
| MariaDB 11.4 lane (`docker compose --profile test run --build --rm test`) | OK, 445 tests, 4,273 assertions |
| Parity stack rebuilt from the final tree (`RELEASE_SHA=<sha>-regression`), `npm run test:smoke` | 14 of 14 (the first attempt, launched three minutes after the rebuild, failed only check 12 because the scheduler had not ticked yet; rerun 14 of 14) |
| Phase 7: the full Playwright suite against the parity production bundle (`playwright.external.config.ts`, all roles) | 248 passed, 2 skipped, 9 failed, none a product defect (see below) |
| Business-logic regression harness (`playwright.regression.config.ts`, 11 specs) | 631 checks PASS, 0 FAIL, 86 INFO, 8 SKIP; 806 database re-reads, 23 filesystem re-reads |
| Authorization matrix | 194 routes x 7 roles, 1,052 requests, 0 unexpected 2xx, 0 mismatches |
| Baseline differential (`scripts/regression/differential.mjs`) | 49 steps, 5 differences, all intended |

The nine parity-run failures, each traced to the environment or to a
harness assumption, not to the application: the four `navigation` specs
failed only their soft console-noise assertion because Chromium logs
"An SSL certificate error occurred when fetching the script" for the
self-signed certificate (the hard checks for page errors and 5xx passed
for every role and route); `account-enumeration` and the two
`failure-recovery` login and password-change scenarios hit the production
throttle and the production 12-character password policy, which the
parity stack enforces and the local-only limiter flush route cannot reset;
`security-smoke` probes the dev backend on port 8000 by design (the parity
stack has no such listener; nginx blocks dotfiles there); `offline-sync` B
timed out waiting for the conflict panel on the slower stack and, on a
retry, met its own fresh-assignment precondition already satisfied by the
first run. Scenario B passed in the isolated run and its browser
equivalent (AA-1) passed in the regression harness.

# Final Business Logic Verdict

**YES: the pre-server hardening preserved the intended business logic.**
Confidence: HIGH. Every inventoried rule was verified against the running
application with database re-reads, the baseline comparison shows only the
intended differences, and the authorization matrix has no unexpected access.
The two defects fixed in this phase pre-date the hardening, are one line
each, and are covered by tests.
