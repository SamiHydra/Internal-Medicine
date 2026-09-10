# 02. Business rules

Every rule the software enforces, stated once. Each rule names the code that
enforces it so a reader can verify it, and the test that proves it where one
exists. Rules marked **owner decision** were confirmed by the product owner and
must not be changed without a new decision.

The rules are grouped: accounts (1), reporting calendar (2), the clinical
report lifecycle (3), clinical governance (4), analytics and data movement (5),
the academic roster (6), evaluations (7), morning sessions (8), undergraduate
teaching (9), transfers and rotations (10), notifications and retention (11).

## 1. Accounts and access

1.1 **Six roles, one per account.** `users.role_key` holds exactly one of
`superadmin`, `admin`, `nurse`, `resident`, `consultant`, `student_rep`. There
are no groups and no multi-role accounts. Roles are seeded, never created at
runtime.

1.2 **The Maintenance account is created only from the server.**
`php artisan app:create-superadmin` creates the single superadmin and refuses
if one already exists. No API or page can create, promote to, deactivate, or
delete a superadmin (`UserPolicy::setActive`, `CreateSuperadmin`).

1.3 **Only Maintenance creates administrators directly.** `POST /api/admin/users`
with role `admin` requires `admins.manage`, held by superadmin only. An
administrator may create nurses and student representatives. Administrators
can also be created through the public administrator self-signup queue,
which any account holding `admins.approve` (superadmin or admin) reviews.

1.4 **Three self-registration paths.**
- Nurses: `POST /api/access-requests` creates a real, **inactive** user plus a
  request listing the departments wanted. Approval activates the account and
  creates the assignments.
- Residents and consultants: `POST /api/academic-access-requests` creates a
  pending request only; approval creates the account with its academic profile
  (section, training year for residents).
- Administrators: `POST /api/admin-access-requests` creates a pending request
  with the role pinned to `admin`.
Each path is rate limited to 10 per minute per IP and notifies every active
administrator.

1.5 **Inactive means zero access, everywhere.** An inactive account is refused
at the `active` middleware, receives an empty permission list, is denied by
`Gate::before` for every policy, and cannot sign in. Deactivation takes effect
on the account's next request because the session is checked server-side.

1.6 **Accounts are deactivated, never deleted.** Every audit trail references
its author with a restricting foreign key; the delete endpoints deactivate.

1.7 **Forced password change.** A newly created or reset account carries
`password_change_required`. Until it changes its password, only the
change-password endpoint and the workspace bootstrap answer; everything else
returns 403. Password change is throttled at 6 per minute on its own counter.
Password reset tokens expire after 60 minutes and may be requested at most
once per 60 seconds; the forgot-password endpoint always answers 202 so it
cannot reveal whether an address exists.

1.8 **Role transition guard (owner decision).** A nurse with an active
reporting assignment cannot be moved to another role; the request is refused
with 422 ("Retire this nurse's active reporting assignments before changing
their role."). Once converted, the account holds no clinical permission, sees
no assignment, and is refused on every report route (`RoleTransitionAuthorizationTest`,
regression `auth.spec.ts` B4).

1.9 **Login accepts e-mail or username**, case-insensitively, throttled at 10
per minute per IP. Failed logins and inactive accounts answer with the same
message shape so accounts cannot be enumerated.

## 2. The reporting calendar

2.1 **Weeks are rows.** One `reporting_periods` row per ISO week, Monday to
Sunday, created ahead of time by `reports:ensure-periods` (26 weeks back, 52
forward). Each row carries `deadline_at`, recomputed from the weekly deadline
setting whenever the setting changes.

2.2 **Hospital time decides dates.** Timestamps are stored in UTC. Date-only
decisions (which week is current, whether the deadline passed, which day a
session opens) use `HOSPITAL_TIMEZONE` (Africa/Nairobi) through one helper,
`HospitalClock`. Scheduled jobs are pinned to that timezone.

2.3 **A report may only describe a week that has started.** Saving against a
future week is refused with 422 on `reportingPeriodId` for nurses and
administrators alike (`ReportSubmissionService::assertPeriodHasStarted`, QA-009).

2.4 **The visible window.** Listings show the weeks from the live start date
(`REPORT_WINDOW_LIVE_START`, unset in production) up to the current week,
limited to the default count (9) unless the caller asks for `all`, which is
capped at 104. Analytics are not subject to the window.

2.5 **Deadline enforcement is a setting.** With `deadlineEnforced` on, a draft
that is still unsubmitted after `deadline_at` is shown as **Overdue** in the
application and an overdue notification is raised for the assignment. The
stored status stays `draft`; Overdue is a derived display state. With
enforcement off, nothing is marked overdue.

## 3. The clinical report lifecycle

3.1 **One report per assignment and week**, enforced by a unique index and a
row lock at save time.

3.2 **Only the assigned nurse or an administrator may write a report.** The
nurse must hold the assignment, the assignment must be active, and the account
must still hold `reports.submit` (`ReportSubmissionService::authorizeAssignmentEdit`,
`ReportPolicy`). Another nurse is refused with 403 and no row is created.

3.3 **Stored statuses** are `draft`, `submitted`, `edited_after_submission`
and `locked`. `not_started` and `overdue` exist in the enum for history but are
derived for display, never written by the workflow.

3.4 **Submission is one explicit action.** A report becomes `submitted` only
through `POST /api/reports` or `PUT /api/reports/{id}` with `submit: true`, or
`POST /api/reports/{id}/submit`. `submitted_at` is written exactly once, on the
first submission, and never cleared. Nothing else submits a report: not
locking, unlocking, viewing, listing, commenting, notification processing, or
offline replay.

3.5 **Editing after submission is allowed and permanently visible.** A changed
cell on a submitted report writes one `audit_logs` row (old value, new value,
actor, time) and moves the status to `edited_after_submission`, which is never
reset to `submitted`. Drafts are not audited cell by cell: the cell trail
starts at the first submission.

3.6 **Locking is an overlay, not a lifecycle step (owner decision, 2026-09-10).**
An administrator may lock any report. While locked, nobody may save, submit or
comment-edit it: nurses and administrators alike receive 403 from the policy;
administrators unlock first. Locking does not submit a draft. Unlocking
restores the report to its pre-lock state: a draft comes back as `draft`, a
submitted report as `submitted` or `edited_after_submission`, with
`submitted_at` untouched. The pre-lock state is read from `submitted_at`
(`ReportLockingService::restoredStatus`). Proof: `ReportLockLifecycleTest`,
e2e `report-lock-lifecycle.spec.ts`.

3.7 **Every transition writes history.** `report_status_history` records
draft creation, submission, post-submission edits, lock and unlock with the
actor and a note. Lock and unlock also notify the assigned nurse.

3.8 **Values are validated by declared type.** Integers must be whole and
non-negative, decimals non-negative, times `HH:MM`, choices one of the
template's options, and every value at most 9,999,999,999. A day not in the
template's active days is refused. Blocking template rules (for example, a
`sum_lte` rule between two fields) refuse a save with 422 on `values`.

3.9 **Stale writes are refused.** A save may carry `expectedUpdatedAt`; when
it differs from the stored revision at second precision the save answers 409
with the server's copy, before the lock check. A save without the key keeps
last-write-wins for imports and older clients. See
[workflows/OFFLINE-SYNC](workflows/OFFLINE-SYNC.md).

3.10 **Comments never change a report.** Anyone who can view a report may
comment; only the author or an administrator may delete a comment. Comments
are allowed on locked reports.

3.11 **Metrics are computed on every save.** For inpatient departments with a
bed count: bed occupancy rate = patient days / (beds x 30) x 100, bed turnover
= (discharged home + discharged against advice) / beds, average length of stay
= patient days / total discharges. Non-inpatient reports carry null metrics.

## 4. Clinical governance

4.1 **Critical values raise alerts on submission and on edit.** The configured
critical fields (default: deaths, pressure ulcers, and the hospital-acquired
infection fields) produce a `critical_value_alert` notification to
administrators whenever a weekly total is above zero; a later correction to
zero produces `critical_value_corrected`.

4.2 **Alert rules create action items.** A clinical alert rule names a
template field, an operator and threshold, a severity, a response deadline in
hours and a responsible role. When a submission trips it, an action item is
created and linked to the report.

4.3 **Action items follow a fixed chain.** Statuses are `open`, `assigned`,
`in_progress`, `resolved`, `closed`. Moving to `assigned` or `in_progress`
requires an active administrator as assignee, including when the same request
clears the assignee. Closing requires a resolution note. The allowed moves are
in [reference/STATUS-TRANSITIONS](reference/STATUS-TRANSITIONS.md).

4.4 **Evidence is bounded.** Files up to 10 MB of types pdf, jpg, jpeg, png,
doc, docx, xls, xlsx, csv, txt; stored outside the web root; downloadable only
by administrators through a policy-checked stream; deletable one at a time,
audited. A failed disk write is reported, never recorded as a success.

4.5 **Overdue action items escalate hourly** to the owner and administrators,
once, until the item leaves an outstanding status.

## 5. Analytics and data movement

5.1 **Aggregation happens in SQL.** Field values are summed and grouped in the
database; PHP never loads raw cell rows for a dashboard.

5.2 **Dashboards are always current.** Cache keys include a fingerprint of
the data (row count and newest change), so a write is visible on the next read
and unchanged data is never recomputed.

5.3 **Exports are queued and owner-only (owner decision).** An export request
answers 202 and a worker builds the file; only the administrator who requested
it may download it, other administrators receive 403. Files expire after seven
days (410 afterwards) and are pruned after `EXPORT_RETENTION_DAYS`. Cells that
start with a formula character are neutralised.

5.4 **Import shares the submission path.** A spreadsheet import goes through
`ReportSubmissionService` row by row: the same authorization, coercion,
validation, audit and alert rules apply. A present-but-blank cell for an active
day is an intentional clear. A malformed group is skipped and reported; the
rest of the file is applied.

5.5 **The report list is role scoped, never a blanket 403 (owner decision).**
`GET /api/reports` answers 200 with the caller's own rows; for a role without
`reports.viewAssigned` (residents, consultants, student representatives, or a
converted nurse) the page is empty. Reading, saving, submitting, locking or
unlocking a specific report is denied to those roles.

## 6. The academic roster

6.1 **The roster is the single source of truth for placement.** One service
answers who was placed where on a date, from duty assignments and rotation
blocks. Evaluation eligibility, the morning roster, the duty grid and the
planner all read through it; nothing reads a home-ward field directly.

6.2 **Sections and heads.** A section's head must be an active consultant.
Setting a section's consultant changes membership; changing the head is a
structure edit.

6.3 **Monthly duty assignments cannot overlap** for the same person and duty
type in the same month.

## 7. Evaluations

7.1 **Two directions with fixed indicator sets.** Residents evaluate
consultants on six yes/no indicators; consultants evaluate residents on ten.
Both carry a 1 to 5 overall rating, which is mandatory.

7.2 **Eligibility comes from the roster.** A resident may evaluate only a
consultant they shared a placement with on the evaluation date, and vice
versa. The form offers only eligible subjects; a forged subject is refused
server-side.

7.3 **One evaluation per evaluator, subject, form and date**, enforced by a
unique constraint. Submitted evaluations are immutable.

7.4 **Ranking normalises two scales equally.** The combined score weights the
overall rating (1 to 5) and the percentage of indicators marked true at 50
percent each; a person needs at least three evaluations to be ranked. Scoring
inputs are identified by field key, not column, so form edits do not break
them.

7.5 **Forms are versioned data.** Content edits (labels, help, order, options,
thresholds, soft-disabling a field) apply in place and need
`evaluationForms.editContent` (administrators). Structural edits (add or remove
a field, rename a key, change a type) go through draft, structure, publish and
need `evaluationForms.editStructure` (Maintenance only). Publishing creates a
new version; earlier answers keep rendering against their version. Core
scoring fields can never be removed or retyped; a database constraint keeps
one published version per form key.

7.6 **External evaluations** may be entered by an administrator on behalf of
an external evaluator; they are audited and never impersonate a user.

7.7 **Student representatives see no score, ever.** They hold only
`teachingLog.record`; every evaluation and analytics route answers 403
(`UndergraduateModuleTest`, the authorization matrix).

## 8. Morning sessions

8.1 **Opened automatically** at 00:05 on the configured days (default Monday,
Wednesday, Friday) with the configured start time (default 08:00)
**snapshotted onto the session**, so a later setting change never rewrites
past punctuality.

8.2 **Recording** is allowed to administrators, and to residents and
consultants who are designated recorders, on the session's own day only.
Attendance and the roster are snapshotted at recording time. Recorders are
reminded 15 minutes after the snapshotted start if the session is still
pending, once.

8.3 **A session left unrecorded stays pending**: it is a signal, not an error.
Cancellation needs a pending, same-day session and a recorder, or an
administrator.

## 9. Undergraduate teaching

9.1 **Sessions are generated** daily at 00:10 from each active batch's weekly
activity schedule (activity types: lecture, seminar, bedside, teaching round).

9.2 **The representative's scope decides what they may log.** A group-scope
representative records lectures and seminars for the cohort; a subgroup
representative records bedside sessions and teaching rounds for subgroup A or
B only. A reason is **required** when a session is recorded as not held.

9.3 **Attendance** is recorded per student by a consultant or an
administrator. Student evaluations (weekly and final) are filed by
consultants against the batch's placements.

9.4 **Placements are checked weekly**: on Fridays at 10:00 administrators are
alerted when a subgroup has no ward placement for the coming week.

## 10. Transfers and rotations

10.1 **A consultant requests a transfer** to another section; the head of the
**destination** section decides, and an administrator may override.

10.2 **Transfers apply at the next rotation boundary by default.** An
administrator may set an earlier effective date, never one in the past. The
scheduled job `academic:apply-section-transfers` applies due transfers at
00:15; applying moves the user's section and closes the old ward-service
assignment.

10.3 **Rotation calendars are configured, never hard-coded.** Year 1 and Year
2 rotate by calendar month from the configured start date; Year 3 runs fixed-
week blocks with no gaps. Only one calendar is active at a time.

## 11. Notifications and retention

11.1 **Delivery is after commit.** In-app rows, e-mail and SMS fan out only
once the underlying change is committed.

11.2 **Reminders are tiered** by hours before the deadline (in-app 24, e-mail
4, SMS 1 by default) and one overdue escalation, each sent once per assignment
and week.

11.3 **Overdue notifications reconcile**: they are created for missing reports
past the deadline and deleted once the report arrives.

11.4 **Nothing clinical, academic or audit-related is pruned by default.**
Retention keys for the trails default to 0 (keep forever). Read notifications
are pruned after 90 days, exports after 30, performance samples after 90,
failed jobs after 30. See [10-BACKUP-AND-DISASTER-RECOVERY](10-BACKUP-AND-DISASTER-RECOVERY.md)
and `DATA_RETENTION_POLICY_TEMPLATE.md`.

## Owner decisions on record

| Date | Decision |
|---|---|
| 2026-09-10 | Locking never submits a draft; unlocking restores the pre-lock state (3.6). |
| 2026-09-10 | `GET /api/reports` answers 200 with an empty page for roles without clinical access, never 403 (5.5). |
| 2026-09-10 | Analytics export downloads are owner-only; other administrators receive 403 (5.3). |
| 2026-09-06 | A nurse with an active assignment cannot change role (1.8). |
| 2026-09-06 | Locked reports are read-only for administrators too; unlock first (3.6). |
| 2026-09-06 | Reports cannot be filed for a week that has not started (2.3). |
| 2026-07-29 | Redis stays optional; database-backed cache, sessions and queues are the production baseline (`decisions/redis-optional.md`). |
