# 01. System overview

## What the platform is

The St Paul's Internal Medicine Platform is a single web application with two
workspaces that share one login, one database and one server.

**Clinical workspace.** Each nurse is assigned to one or more department and
report-template pairs. Every ISO week a reporting period opens; the nurse fills
in per-day figures for the ward (admissions, discharges, deaths, patient days,
procedures, and so on), saves drafts, and submits. Administrators review the
submissions board, lock finished reports, follow up critical values with action
items, and read dashboards that compute bed occupancy, turnover and length of
stay. A weekly leadership digest is mailed automatically.

**Academic workspace.** Residents evaluate the consultants they worked with;
consultants evaluate residents and medical students. Morning sessions are opened
on configured days and attendance is recorded. Undergraduate teaching sessions
are generated from a weekly schedule; a student representative records whether
each session was held, and the teaching consultant records who attended.
Residents rotate through blocks on an academic calendar, and consultants can
request transfers between sections.

Administrators see both workspaces and switch between them with a toggle in
the navigation. Every other role sees only its own side.

## Who uses it

| Role | Shown as | Workspace | Typical day |
|---|---|---|---|
| Nurse | Nurse | Clinical | Opens this week's ward report, enters daily figures, submits before the deadline |
| Resident | Resident | Academic | Evaluates the consultant on the ward round, records morning attendance when designated |
| Consultant | Consultant | Academic | Evaluates residents and students, records teaching attendance, may head a section |
| Student representative | Student representative | Academic | Logs whether today's teaching happened; sees nothing else |
| Administrator | Admin | Both | Approves accounts, manages assignments, reviews and locks reports, runs follow-up, reads dashboards |
| Maintenance | Maintenance | Both | The protected owner account: creates administrators, makes structural changes, watches system health |

The full permission model is in [06-SECURITY-AND-AUTHORIZATION](06-SECURITY-AND-AUTHORIZATION.md)
and [reference/ROLES-AND-PERMISSIONS](reference/ROLES-AND-PERMISSIONS.md).

## How it is built, in one paragraph

A React single-page application in the browser talks to a Laravel REST API.
Nothing else: the browser never touches the database and the server never
renders pages. In production nginx serves the built application and forwards
`/api` and `/sanctum` to PHP-FPM from one HTTPS origin on the hospital LAN,
with MariaDB on the same server. Sessions, cache and queues live in the
database (Redis is optional). Two queue workers and a per-minute scheduler run
as system services. Details: [03-ARCHITECTURE](03-ARCHITECTURE.md).

```text
Browser (React SPA)  ──cookie session──▶  nginx (one HTTPS origin)
                                            ├─ static files: dist/
                                            └─ /api, /sanctum ──▶ PHP-FPM (Laravel) ──▶ MariaDB
                                                                     ├─ queue workers (analytics, notifications)
                                                                     └─ scheduler (cron, every minute)
```

## Module map

| Area | What it holds | Where the rules live |
|---|---|---|
| Accounts and access | Sign-in, password reset, forced password change, self-registration queues, admin approval, role transitions | [02-BUSINESS-RULES](02-BUSINESS-RULES.md) section 1, [06-SECURITY-AND-AUTHORIZATION](06-SECURITY-AND-AUTHORIZATION.md) |
| Reference data | Report templates and their fields, departments (wards, clinics, labs), reporting periods, application settings | [08-CONFIGURATION-GUIDE](08-CONFIGURATION-GUIDE.md), [manuals/ADMIN-MANUAL](manuals/ADMIN-MANUAL.md) |
| Clinical reporting | Assignments, weekly reports, drafts and submission, editing after submission, locking, comments, the audit trails | [workflows/CLINICAL-REPORTING](workflows/CLINICAL-REPORTING.md) |
| Clinical governance | Critical-value alerts, alert rules, action items with evidence, escalation, the leadership digest | [workflows/ACTION-ITEMS](workflows/ACTION-ITEMS.md) |
| Analytics and export | Dashboards per service line, department detail, queued CSV and Excel exports, spreadsheet import | [manuals/ADMIN-MANUAL](manuals/ADMIN-MANUAL.md) |
| Academic evaluations | Configurable evaluation forms with versions, the two evaluation directions, student evaluations, rankings | [workflows/ACADEMIC-EVALUATIONS](workflows/ACADEMIC-EVALUATIONS.md) |
| Academic operations | Sections, wards, duty types, the duty roster, rotation calendars and the planner, section transfers, morning sessions, undergraduate batches and teaching | [workflows/MORNING-SESSIONS](workflows/MORNING-SESSIONS.md), [workflows/TRANSFERS-AND-ROTATIONS](workflows/TRANSFERS-AND-ROTATIONS.md) |
| Notifications | In-app inbox, e-mail and SMS delivery, reminders, overdue and critical alerts | [manuals/USER-MANUAL](manuals/USER-MANUAL.md) |
| Offline continuity | The service worker shell, the offline save queue, conflict review, spreadsheet round trip | [workflows/OFFLINE-SYNC](workflows/OFFLINE-SYNC.md) |
| Operations | Deployment, backups, health, observability, retention | guides 07 to 11 |

## Scale and shape

At the time of writing the codebase carries roughly 175 API routes, 58
database tables, 44 models, 26 authorization policies, 77 migrations, 40 page
components, 19 scheduled or console commands, 450 backend tests, 170 frontend
unit tests and 28 browser suites. The seeded development fixture covers 27
departments across three service lines (inpatient, outpatient, procedures),
eight academic sections, and a year of clinical and academic history.

## Key concepts in one line each

- **Reporting period**: an ISO week (Monday to Sunday) with its own deadline; a database row, never computed on the fly.
- **Assignment**: a nurse's right and duty to report for one department with one template.
- **Report**: one assignment in one period; unique, with per-day cell values stored as rows, not columns.
- **Lock**: a temporary read-only overlay applied by an administrator; it never changes whether a report was submitted.
- **Workspace**: the clinical or academic side of the application; roles carry one, administrators carry both.
- **Roster**: the single answer to "who was placed where on this date", used by every academic surface.
- **Evaluation form**: a versioned, database-defined instrument; historical answers render against the version they were given on.
- **Action item**: a governance follow-up task, usually raised from a critical value, with evidence and a status chain.
- **Maintenance account**: the one superadmin, created only from the server console, never through the application.

The full vocabulary is in [reference/GLOSSARY](reference/GLOSSARY.md).

## Where things run

| Environment | Purpose | Database | Origin |
|---|---|---|---|
| Local development | Vite dev server plus `php artisan serve` | SQLite | `http://localhost:5173` (Vite proxies the API) |
| Isolated test gate | Playwright starts its own backend on a fresh seed | SQLite (`backend/database/e2e.sqlite`) | `http://localhost:5173` |
| Parity stack | Docker: nginx, PHP-FPM, MariaDB, workers, scheduler, production bundle | MariaDB 11.4 | `https://localhost:8443` |
| Production | One Ubuntu server on the hospital LAN | MariaDB 11.4 | `https://im.hospital.internal` (internal CA) |

See [07-INSTALLATION-AND-DEPLOYMENT](07-INSTALLATION-AND-DEPLOYMENT.md).
