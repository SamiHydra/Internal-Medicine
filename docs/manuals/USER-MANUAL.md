# User manual

For everyone who signs in: nurses, residents, consultants, student
representatives, administrators. This manual covers what every role shares.
Your role's own manual covers your daily work:
[Nurse](NURSE-MANUAL.md), [Resident](RESIDENT-MANUAL.md),
[Consultant](CONSULTANT-MANUAL.md), [Student representative](STUDENT-REP-MANUAL.md),
[Administrator](ADMIN-MANUAL.md), [Maintenance](MAINTENANCE-MANUAL.md).

## 1. Opening the application

Use the address the department gave you (`https://im.hospital.internal` on
the hospital network). It works on a ward computer, a laptop, a tablet or a
phone. On a personal device you may be asked to trust the hospital's
certificate once; the administrator has the file and the steps.

The application installs as a small offline-capable web app: after the first
visit it opens even without network, and your report saves are kept until the
connection returns ([../workflows/OFFLINE-SYNC.md](../workflows/OFFLINE-SYNC.md)).

## 2. Signing in

Enter your e-mail address or username and your password. After ten failed
attempts in a minute from the same network address you must wait a minute.
The sign-in page never says whether an address exists.

**First sign-in or after a reset:** you are taken to a change-password
screen and nothing else works until you set a new password (at least 12
characters in production). Choose one you have not used elsewhere.

**Forgot your password:** "Forgot password?" sends a reset link to your
e-mail; it expires after an hour and can be requested once a minute.

**Signed out unexpectedly:** sessions end after two hours without activity,
when your password is changed elsewhere, or when an administrator deactivates
the account. Queued offline saves are kept and replay after you sign in
again.

## 3. Where you land

| Role | Landing page |
|---|---|
| Nurse | `/nurse` (Home) |
| Resident, consultant | `/academic` (Home) |
| Student representative | `/teaching` (Activity log) |
| Administrator, Maintenance | `/admin` (Dashboard); a workspace toggle switches between the clinical and academic sides |

The sidebar lists only what your role can do. Typing another role's address
brings you back to your own landing page; the server refuses anything the
page might have tried.

## 4. The shell

- **Sidebar**: navigation; collapses on small screens into a menu button.
- **Header**: the live reporting week, a sync indicator (a dot pulses while
  the app refreshes), the notifications bell with an unread count, and your
  name and role with **Sign out**.
- **Status chips** appear on pages and cards: Not started, Draft, Submitted,
  Edited, Locked, Overdue for reports; Pending, Recorded, Cancelled for
  sessions; and so on. The wording is the same everywhere.

## 5. Notifications

The bell opens your inbox. Each item links to the page it is about (a report,
an action item, the morning session, a request). Types you may receive:

| You are | Notifications |
|---|---|
| Nurse | report locked or unlocked, reminders before the deadline, overdue, access request reviewed, comments on your report |
| Resident, consultant | morning recorder reminder, transfer decisions (consultants), comments |
| Student representative | end-of-day reminder to log today's sessions |
| Administrator | new submission, submitted report edited, critical value alert and correction, access and account requests, action item assigned or overdue, export ready, trend alert, placement gaps |

**Mark all read**, **Clear inbox** (a snapshot is kept so **Restore last
clear** can bring back up to fifty rows), and a type filter are at the top.
Depending on the department's settings you may also receive e-mail or SMS
for reminders and reset links.

## 6. Working offline

If the wifi drops while you are editing a weekly report, saving shows
"Offline save queued". Nothing is lost: the save is kept on the device and
sent automatically when the connection returns, when you reopen the tab, or
when you sign in again. If the server refused it (someone else changed the
report, an administrator locked it, your assignment ended), the form shows a
review panel with your values beside the server's, and buttons to apply
yours, keep the server's, or copy yours to the clipboard. Details in
[../workflows/OFFLINE-SYNC.md](../workflows/OFFLINE-SYNC.md).

Only the weekly report form works this way. Every other action needs a
connection and tells you when it failed.

## 7. Your account

- Change your password from the account menu (you need your current
  password).
- Your profile (name, title, e-mail, phone) is maintained by an
  administrator; ask them for corrections.
- Accounts are never deleted, only deactivated, so history keeps its author.

## 8. Getting help

- The sign-in page shows the technical support contact.
- [../13-TROUBLESHOOTING.md](../13-TROUBLESHOOTING.md) lists the messages you
  might see and what they mean.
- For access (a new ward, a new role) ask your administrator; nurses can
  also request more departments from **Access Request** in the sidebar.
