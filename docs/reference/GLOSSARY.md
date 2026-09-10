# Glossary

Terms as they are used in the application, the code and these documents.
Where the user interface shows a different label, it is given in brackets.

**Access request.** A nurse's request for reporting access, listing the
department and template pairs wanted. Creating one also creates the nurse's
inactive account. Approval activates the account and creates the assignments.

**Action item.** A governance follow-up task, usually created by a clinical
alert rule when a submitted value trips a threshold. Carries a severity, an
assignee, a due time, comments, evidence files and a status chain (open,
assigned, in progress, resolved, closed).

**Active days.** The weekdays a report template collects values for (for
example Monday to Friday for outpatient clinics). A cell on any other day is
refused.

**Admin (administrator).** The `admin` role: full platform administration in
both workspaces, except the three abilities reserved for Maintenance.

**Administrator access request.** A public self-signup request for an
administrator account, reviewed by any account holding `admins.approve`.

**Aggregate type.** How a field's daily values roll up for analytics: sum,
average, latest or none.

**Analytics export.** A queued CSV or Excel file of clinical submissions for a
date range, downloadable only by the administrator who requested it, expiring
after seven days.

**Assignment (reporting assignment).** The link between one nurse, one
department and one report template. Active assignments give the nurse the
right and duty to report; retired assignments are kept for history.

**Audit log (cell audit).** One row per changed cell on a submitted report:
field, day, old value, new value, actor, time.

**Admin audit log.** One row per administrative action: user changes,
approvals, locks, settings, template and form edits, evidence, transfers,
roster changes, password changes; with IP address and user agent.

**Batch (student batch).** A cohort of medical students with a start and end
date, subgroups A and B, weekly placements, a teaching schedule and one or
more representatives.

**Bed occupancy rate (BOR).** Patient days divided by beds times 30, as a
percentage. Per report it uses a fixed 30-day month; analytics use the days
actually covered.

**Bed turnover rate (BTR).** Discharges (home plus against advice) divided by
beds.

**Average length of stay (ALOS).** Patient days divided by total discharges.

**Calculated metrics.** The stored BOR, BTR and ALOS of an inpatient report,
recomputed on every save.

**Clinical alert rule.** A configured threshold on a template field that
creates an action item when a submission trips it.

**Clinical workspace.** The nursing-report side of the application.

**Consultant.** The `consultant` role: evaluates residents and students,
records teaching attendance, may request transfers and may head a section.

**Content edit.** A change to a template or evaluation form that does not
change the meaning of stored data: labels, help text, order, options, active
days, thresholds, soft-disabling a field. Administrators may make these.

**Core field.** An evaluation form field that feeds the accountability
analytics; it can never be removed or retyped.

**Critical value.** A weekly total above zero in one of the configured
critical fields (deaths, pressure ulcers, hospital-acquired infections). Raises
a critical value alert to administrators.

**Deadline.** The weekly cut-off (day and time, configurable, default Monday
10:00 hospital time) after which an unsubmitted draft shows as Overdue.

**Department.** A reporting unit: an inpatient ward, an outpatient clinic or a
procedure lab. Bound to exactly one report template; inpatient wards carry a
bed count.

**Draft.** A report that has been saved but never submitted.

**Duty assignment.** A monthly placement of a person on a ward or service with
a duty type; the input to the roster.

**Duty type.** A configured kind of duty (for example ward service, on-call)
used by duty assignments.

**Edited after submission.** The status of a submitted report whose cells were
changed afterwards; permanent, audited per cell.

**Evaluation form.** A versioned, database-defined evaluation instrument with
typed fields (boolean, rating, percent, integer, time, text, single select,
multi select). Keys in use: `consultant_mdt`, `resident_acgme`,
`student_weekly`, `student_final`.

**Family (service line).** Inpatient, outpatient or procedure; groups
templates, departments and dashboards.

**Field definition.** The catalogue entry for one report cell type: key,
label, kind, aggregate type, section, order, options.

**Field kind.** The data type of a report field: integer, decimal, time, text
or choice.

**Hospital time.** The Africa/Nairobi wall clock used for every date-only
decision; timestamps are stored in UTC.

**Leadership digest.** The weekly e-mail summarising the most recent
reporting period and a short academic block, sent Mondays at 07:00.

**Live start.** The week the department began using the platform; earlier
weeks are never shown.

**Lock.** A temporary read-only overlay applied by an administrator to a
report. Locking never submits; unlocking restores the prior state.

**Maintenance.** The `superadmin` role, one protected account created from the
server console. Approves administrators, makes structural edits, watches
system health.

**Morning session.** The daily academic session opened automatically on
configured days with a snapshotted start time; attendance and punctuality are
recorded by designated recorders.

**Morning recorder.** A resident or consultant listed in the academic settings
as allowed to record the morning session.

**Notification.** An in-app inbox item, optionally also mailed or sent by SMS.

**Nurse.** The `nurse` role: files weekly reports for assigned departments.

**Offline save queue.** The browser-side queue (IndexedDB) that holds report
saves made without a network and replays them on reconnect.

**Overdue.** A derived display state for a draft past its deadline while
enforcement is on; also the notification raised for a missing report.

**Parity stack.** The Docker environment that mirrors the production server
(nginx, PHP-FPM, MariaDB, workers, scheduler) for testing.

**Permission.** A named capability (for example `reports.lock`) granted to
roles by a static matrix and enforced by route middleware and gates.

**Placement (subgroup placement).** A student subgroup's ward for a week.

**Policy.** A per-model authorization class deciding whether a specific user
may act on a specific record.

**Quality analysis.** The completeness percentage, template consistency rules
and cross-week outlier warnings computed for a report.

**Release.** An immutable deployment directory named by timestamp and git
revision, switched into service atomically.

**Rep assignment.** The record making a student representative responsible
for a batch, with a scope (group, subgroup A or subgroup B).

**Report.** One assignment in one reporting period, with per-day cell values,
metrics, history, comments and audit rows.

**Reporting period.** An ISO week (Monday to Sunday) row with its own deadline.

**Report template.** The shape of a report: family, active days, sections and
field definitions.

**Resident.** The `resident` role: evaluates consultants, is evaluated, may be
a morning recorder, rotates through blocks.

**Revision (updatedAt).** The report's last-modified timestamp, echoed by
clients as `expectedUpdatedAt` for stale-write detection.

**Revision ledger.** The single database counter, bumped by triggers on every
domain-table write, that clients poll to learn whether anything changed.

**Roster.** The single service answering who was placed where on a given
date; the source of truth for eligibility and attendance.

**Rotation calendar.** An admin-configured academic year with blocks (calendar
months or fixed weeks) that residents rotate through.

**Section.** An academic organisational unit with a head consultant; the
target of transfer requests.

**Status history.** The append-only timeline of a report's state changes.

**Structural edit.** A change that alters the meaning of stored data: adding
or removing a field, renaming a key, changing a type. Maintenance only, and
for evaluation forms through draft and publish.

**Student representative.** The `student_rep` role: records whether teaching
sessions were held. Sees no evaluation or score.

**Submission (submitted).** The explicit act that files a report, stamping
`submitted_at` once; also the report's status afterwards.

**Teaching session.** A generated undergraduate teaching event (lecture,
seminar, bedside, teaching round) for a batch on a date, recorded as held or
not held with attendance.

**Transfer request.** A consultant's request to move to another section,
decided by the destination head, applied at the next rotation boundary.

**Ward (academic).** An academic ward record used by placements and duty
assignments; distinct from the clinical department record, which may
reference it.

**Workspace.** The clinical or academic side of the application. Roles carry
one; administrators carry both and switch in the navigation.
