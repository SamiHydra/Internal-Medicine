# Administrator manual

Running the department's reporting and academic programme from the
application. Read the [User manual](USER-MANUAL.md) first. Server-side duties
(health, backups, services) are in the [Operations manual](../09-OPERATIONS-MANUAL.md);
the abilities reserved for the Maintenance account are in the
[Maintenance manual](MAINTENANCE-MANUAL.md).

## 1. The two workspaces

The toggle at the top of the sidebar switches between **Clinical** and
**Academic**. Each has its own dashboard and navigation; **Users & Access**,
**Audit Log** and **Settings** appear in both and scope their content to the
active workspace (Settings is global). Domain pages pin the workspace when
opened from a link.

## 2. Clinical workspace

### Dashboard (`/admin`)
KPI tiles, the submission pulse (delivered, open, overdue) and per-service-
line charts for the selected range and ending period. Scope panel: time
range, ending period, service line, weekly or monthly. Tiles turn amber or
green against the metric targets in Settings. **What changed this week** uses
the rise and drop thresholds.

### Submissions (`/admin/submissions`)
The status grid of every assignment across the window: Not started, Draft,
Submitted, Edited, Locked, Overdue. Filter by period, service line and status.
Open a cell to see the report with values, quality analysis, comments and
history.

**Lock and unlock.** Lock a report you have reviewed; it becomes read-only
for everyone, you included. Unlock to allow corrections; the report returns
to exactly the state it had before the lock (a draft stays a draft, a
submitted report stays submitted). Locking never files a report. Both actions
notify the nurse and appear in the report's history.

**Comments** are allowed in any state and never change values.

### Action items (`/admin/action-items`)
Follow-up tasks raised by alert rules or by hand. Assign, start, comment,
attach evidence (up to 10 MB; pdf, jpg, png, doc, docx, xls, xlsx, csv, txt),
resolve with a note, then close after verification. Overdue items escalate
hourly. Alert rules (field, operator, threshold, severity, deadline hours,
responsible role) are managed on the same page. Details in
[../workflows/ACTION-ITEMS.md](../workflows/ACTION-ITEMS.md).

### Templates (`/admin/templates`)
The reporting instruments by service line. As an administrator you make
**content edits**: labels, help text, order, choice options, active days,
thresholds, and soft-disabling a field (values are kept). Renaming a field
key, changing a type, or adding and removing fields are **structural** and
reserved for Maintenance. Every edit is audited.

### Import (`/admin/import`) and Export (`/admin/export`)
- **Import**: download the template for a week and department (Excel or
  CSV: week start, department, section, field, field key, one column per
  day), fill it, upload it. Rows go through the normal submission rules;
  blank cells on active days clear the value; malformed groups are skipped
  and listed.
- **Export**: request a CSV or Excel export of submissions for a date range
  and filters; it builds in the background and appears in your list when
  ready. Only you can download your export; it expires after seven days.

### Audit log (`/admin/audit`)
Two trails: cell edits on submitted reports (field, day, before, after,
who, when; filter by department, report, actor, date) and administrative
actions (every user, assignment, setting, template, form, lock, evidence and
transfer change). Both are read-only.

### Department detail (`/admin/departments/<id>`)
Trend, current week state and audit highlights for one department; reached
from the dashboard.

## 3. Users and access (`/admin/users`)

- **Requests**: nurse access requests (approve creates the assignments and
  activates the account), academic sign-ups (residents and consultants,
  with section and training year), and administrator sign-ups (approve
  creates the administrator with a forced password change).
- **Create**: nurses and student representatives directly, with an initial
  password and forced change. Administrators are created by Maintenance or
  through the sign-up queue.
- **Assignments**: the assignment studio pairs a nurse with a department and
  template; creating an existing pair re-activates it; retire an assignment
  to remove access while keeping history.
- **Roster**: activate or deactivate accounts (never administrators, never
  Maintenance), reset passwords (the user must change it at next sign-in),
  edit profiles. A nurse with an active assignment cannot change role until
  the assignments are retired.
- **Student representatives**: create the account here, then give it a
  representative assignment under the academic Students page.

## 4. Academic workspace

### Dashboard (`/admin/academic`)
Evaluation snapshot, summary, trend and people rankings; morning-session
punctuality; teaching held versus expected; student coverage.

### Submissions (`/admin/academic/submissions`)
Every evaluation with filters; the academic audit trail; entering an
**external** evaluation on behalf of a visiting evaluator.

### Duty & coverage (`/admin/academic/roster`)
The monthly duty grid: people against wards or services with a duty type.
Save a month or a single day. Overlaps for the same person and duty type in
a month are refused.

### Resident rotations (`/admin/academic/rotations`)
Create a calendar for the academic year (start date; calendar-month blocks
for Years 1 and 2, fixed-week blocks for Year 3), activate it, and plan each
resident or training-year group ward by block. Saving writes duty
assignments per block.

### Forms (`/admin/academic/evaluation-forms`)
Content edits to the published evaluation forms. Draft, structure and
publish are Maintenance actions.

### Students (`/admin/academic/students`)
Batches, students (create or import from a sheet), subgroup placements per
week, weekly teaching schedules (activity types and times), representative
assignments (scope: group, subgroup A or B), the generated sessions, and
cancelling a session.

### Structure (`/admin/academic/structure`)
Wards, sections (with their head consultant) and duty types. Referenced
records cannot be deleted; deactivate them.

### Transfers and morning sessions
Transfer requests into any section can be approved (with an optional earlier
effective date, never past) or rejected here. Morning sessions can be
corrected or cancelled, and roster overrides (include or exclude a person on
a date) managed.

## 5. Settings (`/admin/settings`)

| Group | Settings |
|---|---|
| Deadlines | enforce deadlines; weekly deadline day and time (recomputes every period's deadline immediately) |
| Locking rule | auto-lock hours after deadline (informational; locking is manual) |
| Insight thresholds | notable rise and drop percentages |
| Critical fields | which fields raise a critical value alert |
| Reminders | hours before the deadline for in-app, e-mail and SMS; hours after for the escalation |
| Metric targets | amber and green thresholds for delivery rate, safety events, same-day rate, procedure throughput |
| Academic | morning session days and time; morning recorders |

Every save is validated (`HH:MM` times, positive numbers, existing users)
and audited. Details in [../08-CONFIGURATION-GUIDE.md](../08-CONFIGURATION-GUIDE.md).

## 6. Weekly routine

- Monday morning: read the digest; open Submissions; chase Overdue wards
  (reminders already went out); lock reviewed reports.
- Through the week: work action items; approve requests; watch the
  dashboard's critical alerts.
- Friday: check the placement-gap notice for next week's student subgroups.
- Monthly: review templates and settings with the head of department.

## 7. Quick answers

- *A report I locked needs a correction.* Unlock it; the nurse corrects; lock
  again. The audit trail records both.
- *I locked a draft by mistake.* Unlock it; it is a draft again, nothing was
  submitted.
- *An export is stuck on pending.* The queue worker is down; see the
  [Operations manual](../09-OPERATIONS-MANUAL.md) section 3.
- *I cannot deactivate another administrator.* Only Maintenance can.
- *A nurse's role change is refused.* Retire their active assignments first.
