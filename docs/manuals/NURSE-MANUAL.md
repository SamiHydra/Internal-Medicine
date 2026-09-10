# Nurse manual

Filing the weekly ward report. Read the [User manual](USER-MANUAL.md) first
for signing in, notifications and working offline.

## 1. Your pages

| Page | What it is for |
|---|---|
| **Home** (`/nurse`) | this week's cards, one per assigned department, with status; counts of assigned, drafts, locked and unread; recent activity |
| **My Reports** (`/nurse/reports`) | every week in the window, filtered by service line, with the status grid of your own rows |
| **Access Request** (`/register`) | ask for additional departments |
| **Activity** (`/nurse/activity`) | the timeline of changes on your reports: who did what and when |
| The report form (`/reports/<assignment>/<week>`) | the weekly grid |

## 2. The weekly cycle

1. **Monday**: the new week's cards appear as **Not started**.
2. **During the week**: open a card, enter each day's figures as they are
   known, save. The card shows **Draft**.
3. **Before the deadline** (Monday 10:00 hospital time by default): press
   **Submit report**. The card shows **Submitted** with the time.
4. **After submitting**: you can still correct a figure while the report is
   unlocked; the card shows **Edited** and every change is recorded.
5. **When an administrator locks it**: the form is read-only until they
   unlock it.

Reminders arrive in the app 24 hours before the deadline, by e-mail 4 hours
before and by SMS 1 hour before (the department can change these), and once
after it. A draft that is still unsubmitted after the deadline shows
**Overdue** until you submit it.

## 3. The form

- One row per field, one column per active day of the ward's template;
  sections group related fields. On a phone the grid stacks by day.
- Numeric cells accept whole numbers or decimals as the field defines; time
  cells `HH:MM`; some fields offer a list to choose from; text fields accept
  short notes.
- The summary tiles show status, deadline, last update and completeness.
- **Save draft** saves everything now. Autosave also saves 1.4 seconds after
  you stop typing when the form is valid; the status line says "Draft saved"
  or "Draft autosaved".
- **Submit report** files the week. If a figure fails a template rule (for
  example discharges exceeding admissions) the message names the field; fix
  it and submit again.
- Metrics (bed occupancy, turnover, length of stay) are computed for
  inpatient wards with a bed count.
- **Comments** at the bottom let you and the administrators discuss the
  report; comments never change values and are allowed even while locked.

## 4. What you cannot do, and why

| Attempt | What happens | Why |
|---|---|---|
| Open or save another ward's report | refused (403) | only the assigned nurse or an administrator may write a report |
| Save a report for a future week | refused (422) | a report may only describe a week that has started |
| Save or submit a locked report | buttons disabled; a forced request answers 403 | locked means read-only for everyone until an administrator unlocks it |
| Lock or unlock | not offered | administrators only |
| Delete a report or a value's history | not offered | nothing is deleted; clear a cell instead, which is recorded once the report is submitted |

## 5. Corrections after submission

Change the cell and save. The report becomes **Edited**, the change is
written to the audit trail with the old and new value, and administrators are
told. This is expected and permanent; it does not undo the submission.

## 6. Locked reports

A locked report shows "This report is read only" and the Status card
**Locked**. Ask an administrator if a correction is needed. When they unlock
it the report returns to exactly what it was: a draft stays a draft (you can
keep editing and then submit), a submitted report stays submitted.

## 7. Working offline

If the wifi drops, keep working: the save is queued on the device
("Offline save queued") and sent when the connection returns. If the report
changed on the server in the meantime, or was locked, a review panel shows
your values beside the server's and lets you choose. See
[../workflows/OFFLINE-SYNC.md](../workflows/OFFLINE-SYNC.md).

## 8. Requesting another department

**Access Request** lists the departments grouped by service line; tick the
ones you need and add a note. An administrator approves the request and the
new card appears on Home.

## 9. Quick answers

- *The card says Overdue but I saved it.* Saving is not submitting; press
  **Submit report**.
- *Metrics show dashes.* The ward has no bed count configured; tell an
  administrator.
- *A field I used to see is gone.* The template changed; earlier values are
  kept in history.
- *I submitted the wrong week.* Nothing is deleted; correct the figures (the
  changes are audited) and tell an administrator, who may lock the report
  once it is right.
