# Workflow: clinical reporting

From a nurse being assigned to a ward to the week's figures appearing on the
dashboard. Rules are numbered as in [../02-BUSINESS-RULES.md](../02-BUSINESS-RULES.md).

## The actors

| Actor | Does |
|---|---|
| Nurse | Fills the weekly form, saves drafts, submits, corrects after submission while unlocked |
| Administrator | Approves access, creates assignments, reviews the board, locks and unlocks, comments, follows up alerts |
| Scheduler | Creates periods, raises reminders and overdue notices, sends the digest |
| Analytics | Computes metrics on save and serves dashboards |

## 1. Getting an assignment

```text
nurse registers (/register) ──▶ inactive account + access request listing departments
administrator approves (Users & Access) ──▶ account active, one assignment per department/template pair
                                            requester notified (access_request_reviewed)
```

An administrator can also create a nurse directly and add assignments in the
assignment studio; creating an existing pair re-activates it (rule 1.4, 3.2).

## 2. The week opens

Every Sunday at 00:05 `reports:ensure-periods` keeps 26 past and 52 future
weekly periods in place, each with `deadline_at` from the settings (default
Monday 10:00 hospital time). The nurse's Home and My Reports show a card per
assignment for the current week: **Not started** until a row exists (rule 2.1).

## 3. Filling in the form

The nurse opens `/reports/<assignment>/<period>` from the card. The form is
generated from the template: sections, fields, active days. Cells validate as
typed (rule 3.8). Autosave sends a draft 1.4 seconds after the last change
when the form is valid; **Save draft** sends one explicitly. The first save
creates the report as `draft` and writes a "Draft created" history row; later
draft saves write values only (no history, no cell audit).

If the network drops, the save is queued on the device and replays when it
returns ([OFFLINE-SYNC.md](OFFLINE-SYNC.md)).

Saving for a future week is refused (rule 2.3). Saving for another nurse's
assignment is refused with 403 and creates nothing (rule 3.2).

## 4. Submitting

**Submit report** sends the values with `submit: true`. If a blocking template
rule fails (for example a discharge total exceeding admissions) the submission
is refused with the rule's message (rule 3.8). On success:

- `status` becomes `submitted`, `submitted_at` is stamped once (rule 3.4);
- a "Weekly report submitted." history row is written;
- every active administrator receives `new_report_submitted`;
- critical fields are checked and `critical_value_alert` raised if any weekly
  total is above zero; alert rules may create action items (rules 4.1, 4.2);
- metrics are recomputed (rule 3.11); quality warnings are attached.

The form shows a "Submitted <time>" chip and stays editable.

## 5. Correcting after submission

While unlocked, the nurse (or an administrator) can change cells. Each changed
cell writes one audit row; the status becomes `edited_after_submission` and
never returns to `submitted`; administrators receive `submitted_report_edited`;
critical checks and alerts run again (rule 3.5). The submission board shows
"Edited" and the audit log shows before and after per cell.

## 6. Review, lock, unlock

On **Submissions** the administrator sees every assignment for the window as
a status grid (Not started, Draft, Submitted, Edited, Locked, Overdue). Opening
a report shows the values, quality analysis, comments and history.

**Lock** makes the report read-only for everyone, administrators included, and
notifies the nurse. **Unlock** restores the pre-lock state and notifies the
nurse. A locked draft returns as a draft, with no submission stamped; a locked
submitted report returns as submitted or edited (rule 3.6). Comments are
allowed while locked (rule 3.10).

```text
draft ──lock──▶ locked ──unlock──▶ draft
submitted ──lock──▶ locked ──unlock──▶ submitted
edited_after_submission ──lock──▶ locked ──unlock──▶ edited_after_submission
```

## 7. Deadlines, reminders, overdue

With deadline enforcement on:

- `reports:send-reminders` (hourly) sends tiered reminders per assignment and
  week: in-app 24 hours before the deadline, e-mail 4 hours, SMS 1 hour, and
  an overdue escalation after it (rule 11.2).
- After the deadline an unsubmitted draft shows as **Overdue** on every
  surface; `reports:sync-overdue` (hourly) creates an `overdue_report`
  notification for each missing report and deletes it once the report is
  submitted (rules 2.5, 11.3).

## 8. Analytics

Every save recomputes the report's metrics. Dashboards aggregate in SQL by
family (inpatient: movement and BOR, BTR, ALOS; outpatient: seen and same-day
rates, availability; procedures: throughput and mix), by week, month, quarter
and year, and per department, with content-stamped caching so a submission is
visible on the next view. Department detail shows the trend and the current
week's state; "What changed this week" applies the rise and drop thresholds.

## 9. Export and import

Administrators queue CSV or Excel exports for a date range and download them
when ready (owner-only, seven-day life). For an outage, the import template
for a week and department is downloaded, filled offline, and imported through
the same submission path, so every rule above still applies (rule 5.4).

## 10. Where each step is proven

| Step | Tests |
|---|---|
| Assignment and ownership | `AdminApiTest`, `ReportWorkflowTest`, regression `clinical.spec.ts` C |
| Draft, submit, edit, audit | `ReportWorkflowTest`, `AuditIntegrityTest`, regression D, UI D-1 |
| Lock and unlock | `ReportLockLifecycleTest`, e2e `report-lock-lifecycle.spec.ts`, regression E and E2, UI D-2 and D-3 |
| Periods and deadlines | `ReportWorkflowTest` (future week), regression G and H |
| Reminders and overdue | `ReportReminderTest`, `NotificationsAndOverdueTest` |
| Alerts and action items | `ActionItemTest`, `NotificationsAndOverdueTest` |
| Analytics | `AnalyticsTest`, `AnalyticsQueryShapeTest`, `AnalyticsExportTest` |
| Import | `ReportImportTest`, `XlsxReaderTest` |
