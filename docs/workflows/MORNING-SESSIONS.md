# Workflow: morning sessions

How the daily academic morning session is opened, who records it, what is
snapshotted, and how it is corrected. Rules are numbered as in
[../02-BUSINESS-RULES.md](../02-BUSINESS-RULES.md) section 8.

## 1. Configuration

In Settings (academic block):

| Setting | Default | Meaning |
|---|---|---|
| Morning session days | Monday, Wednesday, Friday (1, 3, 5) | Days a session opens |
| Morning session time | 08:00 | The start time snapshotted onto each session |
| Morning recorders | none | Residents or consultants allowed to record and cancel today's session |

Recorders are a designation held as data, not a role; an administrator can
always record. The validator only checks that a recorder id exists, so keep
the list current when people leave.

## 2. Opening

`academic:open-morning-session` runs at 00:05 hospital time. On a configured
day it creates one `pending` session for the date with the configured start
time copied onto it (`snapshotted start`). Changing the setting later never
changes past sessions (rule 8.1). Nothing opens on other days; a session can
be opened for a specific date with `--date=` by an operator.

## 3. The expected roster

When the session is viewed, the expected attendees are derived from the day's
duty assignments through the roster service, adjusted by **roster overrides**:
an administrator can include or exclude a person for a date (for example a
visiting resident, or someone on leave). Overrides are managed under the
admin morning-sessions panel.

## 4. Recording

```text
recorder opens /academic/morning ──▶ GET /academic/morning-sessions/today  (canRecord true or false)
                                  ──▶ marks each person present or absent, on time or late
                                  ──▶ POST /academic/morning-sessions/{id}/record
```

Who may record: an administrator, or a designated recorder, on the session's
own day only. The recording snapshots the roster and each person's presence
and punctuality against the snapshotted start; a later roster change never
rewrites it (rule 8.2). A session that nobody records stays `pending`; that
is a signal for oversight and appears as such in the academic analytics, not
an error to clean up (rule 8.3).

## 5. Reminders

`academic:remind-morning-recorder` runs every minute. Fifteen minutes after a
pending session's snapshotted start, each designated recorder receives one
in-app reminder (deep link `/academic/morning`); the reminder is deduplicated
so nobody is nudged twice.

## 6. Cancelling and correcting

- **Cancel**: a designated recorder on the day, or an administrator, may cancel
  a pending session (a public holiday, for example). Cancelled sessions do not
  count against punctuality.
- **Correct**: an administrator may update a recorded session (attendance and
  punctuality) from the admin panel; the correction is audited.

## 7. Analytics

The academic dashboard's morning view reports sessions held versus expected,
punctuality per person and per section over the window, and pending sessions.
The leadership digest's academic block includes the week's punctuality.

## 8. Where each step is proven

| Step | Tests |
|---|---|
| Opening on configured days, snapshotted start | `MorningSessionTest` |
| Roster and overrides | `RosterTest`, `MorningSessionTest` |
| Recorder authorization (designated, same day, admin) | `MorningSessionTest`, the authorization matrix |
| Recording snapshot and correction | `MorningSessionTest` |
| Reminder deduplication | `MorningSessionTest`, `AcademicOperationsTest` |
