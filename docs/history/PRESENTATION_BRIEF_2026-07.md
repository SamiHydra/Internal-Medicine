# Internal Medicine Reporting and Academic Accountability Platform
## Presentation content brief, July 2026 revision

**Purpose of this file.** This is source material for a PowerPoint deck. It is not the deck. It contains the full, accurate feature set of the product as it stands today, written so a presentation can be assembled from it without going back to the codebase. A suggested slide plan sits at the end (Section 10); everything before it is the substance.

**What changed since the June 2026 deck.** That deck presented two pillars with the clinical pillar first and the academic pillar as the second, newer half. That ordering is now wrong. The academic side has since grown from two evaluation forms into a complete academic operations system: a departmental duty roster, resident rotation planning, section transfers, an admin-editable evaluation form engine, a full undergraduate teaching module, department-wide morning sessions, and operations analytics. **The deck must now lead with the academic pillar.** Section 9 lists the delta explicitly.

**Style rules for the deck.**
- Do not use em dashes anywhere in the slides. Use commas, colons, or a spaced hyphen.
- Institution: St Paul's Hospital Millennium Medical College, Department of Internal Medicine.
- Presenter: Samuel Sisay.
- Keep the tone factual and operational. This is a departmental system-of-record proposal, not a startup pitch.
- Every number in this document is taken from the shipped code and is safe to put on a slide.

---

## 1. The product in one paragraph

One controlled web platform, running on the department's own server inside the hospital network, that owns two departmental records end to end. The **academic record**: who taught, who attended, who was evaluated, on what, by whom, under which rotation, with what result. The **clinical record**: the weekly operational report of every ward, clinic, and procedure service, validated at entry, locked after the deadline, and aggregated for leadership. Both pillars share one identity system, one permission model, one audit trail, and one dashboard shell. Nothing in either pillar depends on a spreadsheet being emailed correctly.

**Scale it serves today:** 26 clinical reporting units, 6 teaching wards, 8 specialty sections, 6 user roles, 4 evaluation instruments, 2 undergraduate cohorts.

---

## 2. Why the academic pillar leads

The clinical reporting problem was a data-quality problem: the numbers existed, they were just unverifiable. The academic problem is worse, because most of the record did not exist at all.

- The daily MDT teaching round happened, but nothing recorded whether the senior consultant was present, when they joined, or how long they stayed.
- Residents were evaluated on paper, monthly, after the moment had passed, by whichever consultant happened to be asked.
- Nobody could answer "which consultant supervised this resident in March" without asking someone who was there.
- Undergraduate teaching, lectures, seminars, bedside sessions, and teaching rounds, was scheduled but its occurrence was never logged, so "the lecture did not happen" and "the lecture happened and nobody remembers" looked identical.
- The department's own duty schedule lived in a monthly file, so evaluation eligibility, morning attendance expectations, and supervision pairing all had to be reconstructed by hand.
- Accreditation and program review need documented evidence of supervision and feedback. Memory is not evidence.

The academic module is now the larger half of the system, and it is the half that produces evidence that cannot be produced any other way.

---

## 3. PART A: The academic pillar

### A.1 The academic backbone: structure that mirrors the department

Everything academic resolves through one shared model of who is where, on which date.

- **Wards.** Six physical teaching wards: Cardiology/Endocrinology, Pulmonology, Hematology/Oncology, Gastroenterology/Neurology, Nephrology, Transition. Wards are admin-creatable, so the department can add one without a developer. Each ward links to the existing clinical inpatient units rather than duplicating them, which is what keeps the two pillars consistent.
- **Sections (specialty units).** Eight: Nephrology, Neurology, Cardiology, Endocrinology, Pulmonology, Hematology, Oncology, Gastroenterology. A consultant belongs to a section and rotates between that section's duties, not between wards.
- **Duty types.** The catalog of what a person can be doing in a month: ward service, on-call, and section-specific duties such as Transplant ICU, Dialysis, Emergency Endoscopy, Colonoscopy. Each duty type declares whether it participates in supervision pairing and which ward or pairing group it resolves to.
- **Duty assignments.** Dated rows: this person, this duty type, from this date to that date. This single table is the source of truth read by evaluation eligibility, the morning attendance roster, the duty grid, and the rotation planner. Nothing reads a static "home ward" field any more.

**Slide-worthy point:** one dated assignment table replaced four different informal answers to "who is where."

### A.2 The consultant duty roster

The system holds the complete month-by-month duty schedule for every consultant, all duties, not only ward months. In practice this means the platform doubles as the department's duty roster rather than sitting beside it.

- A month grid per person with the duty in each cell, editable by administrators.
- Day-level coverage for duties that are not monthly. Transition Ward, for example, is covered by two internists per day and belongs to no section, so it is modeled as a day-level duty.
- On-call consultants provide consults hospital-wide, so their duty does not pin them to a ward.
- Every roster change is written to the administrative audit log.

### A.3 Resident rotation calendars and the rotation planner

- **Calendars are configured per academic year.** The national program moves the academic year start date every year, so nothing about the year is hard-coded. An administrator creates the calendar and activates it.
- **Year 1 and Year 2 residents rotate by calendar month.**
- **Year 3 residents run continuous eight-week blocks with no gaps.** Residents are divided into groups, and each group cycles through every attachment across the year.
- **The planner grid** lets an administrator lay a whole rotation plan onto the shared duty timeline. Each cell reports its true state: empty, consistent (fully covered by one duty), or **mixed** (a gap or a mid-block duty change). Mixed cells are surfaced rather than hidden behind whichever assignment happened to be first, and overwriting a covered cell requires explicit confirmation.
- **Off-service rotations are first class:** OPD, ICU, Emergency, Dermatology, Radiology, Psychiatry, Zewditu Memorial Hospital, Saint Peter Specialized Hospital, and the annual leave month.

### A.4 Section transfer requests

A consultant can request a move to another section, and the request follows the department's real authority line rather than an IT queue.

- The consultant files the request from their own home page.
- **The head of the destination section approves it,** not a system administrator. The origin section head and the requester are notified of the decision.
- Approved transfers apply at the next rotation boundary by default (the first day of the next calendar month); an administrator can override to immediate.
- Applying a transfer also closes the old section's open ward-service assignment, so the roster never silently claims a person is in two places.
- A scheduled job applies due transfers every night, so the boundary is honored without anyone remembering.
- Administrators can still move a consultant directly with no request, and that action is audited.

### A.5 Rotation-aware evaluation eligibility

This is the correctness core of the academic pillar and deserves its own slide.

**One rule governs every evaluation.** An evaluation is allowed only if the author and the subject both hold an active duty assignment covering that date, both duty types resolve to the same pairing key (the ward, or a pairing group such as `opd` or `transplant`), and both duty types are flagged as pairing. A resident therefore evaluates, and is evaluated by, only the consultants they actually worked with, and the pairing shifts automatically when the rotation changes. No administrator maintains a pairing list.

**Snapshot, never recompute.** Every evaluation permanently stores the ward and placement it was written under. When people rotate next month, last month's evaluations do not silently change what they claim. The same discipline applies to morning attendance lists, teaching session wards, and the form version an answer was given on. This is the single most important data-integrity property in the expansion, because in a teaching hospital everybody moves.

### A.6 The MDT round evaluation (resident evaluates the consultant)

Filed against the teaching round, on the round's own date, by a resident who was actually paired with that consultant.

- **Round details:** senior present (yes/no), the time the senior joined, presence in minutes, percentage of patients seen, whether the round was delayed.
- **Round quality checks:** all patients reviewed, management plan documented, VTE risk assessed, discharge discussed, medication review done, critical labs reviewed.
- **MDT participants:** who actually joined the round, from consultant, fellow, internist, residents, interns, nurse, clinical pharmacy.
- **System issues:** the friction that degraded the round, from lab delay, imaging delay, staff shortage, bed issue, EMR interruption, communication issue. This turns a teaching complaint into a departmental operations signal.
- **Overall rating** and free-text comment.

### A.7 The resident performance evaluation (consultant evaluates the resident)

ACGME-aligned competency items, grouped the way the framework groups them:

- Attendance and professionalism: present and on time, professional conduct.
- Preparation and patient care: knew patients with the list and overnight events updated, appropriate and prioritized plan.
- Medical knowledge: sound assessment and differential.
- Communication: case presentation clear and concise, effective with team, nursing, and patient.
- Documentation and systems: notes and orders complete and timely, completed tasks and chased results and referrals.
- Practice-based learning: receptive to feedback and teaching.
- Overall rating on a 1 to 5 scale, plus a structured "areas to improve" list (punctuality, preparation, medical knowledge, clinical reasoning, documentation, communication, professionalism, follow-through, time management) and a narrative comment.

The result is a documented mentorship record with a follow-up trail, instead of a verbal impression that evaporates.

### A.8 External and off-service evaluations

Residents rotate to ICU, Emergency, Dermatology, Radiology, Psychiatry, and two external hospitals, where the host department evaluates them on paper. Those forms are submitted to Internal Medicine and entered into the system by an administrator, so a resident's record stays complete across the whole year rather than going dark for the months they were off service. Evaluations continue during OPD, completed by the supervising Internal Medicine consultant. The schema keeps a nullable link for an external evaluator account, so departmental logins can be added later with no migration.

### A.9 Admin-editable evaluation forms

Every evaluation instrument in the system is now editable by the department, without a developer and without a deployment.

- **Four seeded forms:** MDT round evaluation, resident performance evaluation, student weekly ward evaluation, student final attachment evaluation.
- **Content edits apply in place.** Labels, help text, option wording, and field order change on the published version immediately.
- **Structural edits go through draft and publish.** Adding, removing, retyping, or rekeying a field creates a new version. Past evaluations keep rendering against the version they were answered on, so history stays readable and honest.
- **Core fields are protected.** `senior_present`, `senior_joined_at`, and `presence_minutes` on the MDT form and `overall_rating` on the resident form can never be removed or retyped, because the accountability analytics are computed from them.
- **The two edit rights are split by role.** Administrators hold content editing. Structural editing is reserved to the Maintenance role.
- Field types available to the editor: boolean, integer, percent, time, rating, single and multi select, and free text.
- Every publish is audited.

### A.10 The undergraduate teaching module

A complete second academic program, added in full.

**Cohorts and batches.** Two cohorts: C1 (Year 3, twelve-week attachment) and C2 (Year 4, eight-week attachment). When a batch finishes, the next starts, and two C1 batches may legitimately overlap. Each batch splits into two subgroups of roughly 8 to 10 students. Weekly movement between wards is set by an administrator, deliberately manual rather than auto-generated, because real placement decisions are not formulaic.

**Student roster.** Students are created individually or imported in bulk, held in batches, and placed into subgroups with dated ward placements.

**Weekly programs, seeded and editable.**
- C1: lecture Monday to Friday, teaching round Tuesday and Thursday, bedside Monday and Friday, seminar Wednesday.
- C2: lecture Friday, teaching round Tuesday and Thursday, bedside Monday and Wednesday, seminar Friday.

**Sessions are generated automatically.** A nightly job creates the day's pending sessions for every active batch from its weekly schedule. Cohort-wide activities produce one session; subgroup activities produce one per subgroup, with that week's ward snapshotted onto the session at creation.

**Three representative logins per batch.** One group representative records whether each lecture and seminar was held for the whole cohort. One subgroup representative per subgroup records bedside teaching and teaching rounds for their own subgroup only.

**Held, not held, or cancelled.** Representatives record occurrence. A reason is required when a session was not held. A separate `cancelled` state exists for holidays and exam weeks, so a legitimate skip does not distort the occurrence statistics.

**Representatives can never see a score.** This is enforced structurally, not by a UI hint: the student representative role is granted no academic permission at all, its navigation contains exactly one page, and a test asserts the absence. This matters because reps are students in the cohort being assessed.

**Consultants record individual student attendance** for every activity type, on the session they taught.

**Students are evaluated at two levels:** a weekly evaluation at the end of each ward placement, and a final evaluation at the end of the attachment. Any consultant may evaluate any student, because consultants from different wards teach across the program; the student's current placement is shown as context and pre-filled. Undergraduate evaluation is **one-way**: students never evaluate consultants, and there is no route in the system that would allow it.

**A weekly job checks placements** and warns administrators when an active batch has weeks without placements, before the students arrive on a ward nobody expected them on.

### A.11 Morning sessions

- One **department-wide** session, not one per ward.
- Held Monday, Wednesday, and Friday with a scheduled 08:00 start, both configurable in settings.
- The session **opens itself** each morning through a scheduled job.
- **Punctuality is measured against the scheduled start,** which is snapshotted onto the session, so changing the department's start time next term does not rewrite last term's delays. If the session did not start on time, the recorder captures the actual start and the delay is computed.
- **The expected roster generates itself** from current rotation and duty assignments. Consultants on non-ward duties still appear. People on external rotations and annual leave do not. Administrators can add or remove individuals with explicit overrides, and those overrides are audited.
- **One standing designated recorder,** appointed by an administrator and not necessarily an administrator. The morning session page appears in the navigation only for the person currently designated, driven by data rather than by role.
- **Attendance is snapshotted at recording,** so a later roster change never rewrites who was marked present.
- A **reminder job runs every minute** and nudges the recorder 15 minutes after that session's start if nothing has been recorded, de-duplicated so it never nags twice.
- A session left unrecorded stays visible as a pending signal rather than disappearing.

### A.12 The academic leadership dashboard

The administrative academic workspace, built from four analytic surfaces.

**Evaluation analytics.**
- Summary counts and averages across a filtered window, by ward, by direction (evaluations of consultants versus of residents), and by granularity.
- Trend charts over weeks, months, or quarters.
- **A people leaderboard** ranked by a normalized combined score. The 1 to 5 overall rating and the percentage-based round-quality indicator score are measured on different scales, so the rating is mapped onto 0 to 100 and the two are blended with equal weight. People below an evidence threshold are still listed and still ranked but flagged `provisional`, so a single flattering evaluation never tops the board.
- A **person detail page** with that individual's history and breakdown.
- An **evaluation detail sheet** that renders any single submission exactly as it was answered.

**Operations analytics, in three tabs.**
- **Morning:** sessions recorded versus not recorded, on-time rate, average delay in minutes, a delay chart, and per-person attendance rates.
- **Teaching:** held, not held, held rate, and pending backlog, filterable by student block, with per-activity and per-batch breakdowns.
- **Students:** student count, average attendance, average weekly rating, and finals recorded, with a per-student progress table.

**Workflow surfaces on the same dashboard.** Pending section transfer reviews for section heads, morning session oversight and roster overrides, and an academic setup banner that tells a new department what still needs configuring.

**Performance discipline.** Every academic analytics endpoint sits behind a content-stamp cache keyed on the maximum update time plus row count for the filtered window. A new submission changes the key and is therefore visible on the next read, while idle dashboards never re-aggregate the same rows. No academic endpoint is polled.

### A.13 What each person sees about themselves

- **Residents and consultants** get a home page with their own aggregated performance, their submission history, and their pending transfer request if any.
- **Privacy is strict:** residents and consultants see only their own aggregated results. Cross-person comparison is a leadership view.
- **Submit** and **History** are the other two pages. Consultants additionally get a **Students** page for undergraduate attendance and evaluation.
- Every evaluation form renders from the live form definition, so a form the department edits on Monday is what everyone fills in on Tuesday.

### A.14 Getting people into the system

- **Academic registration and approval.** Residents and consultants request access with their scheduling profile, including training year for residents, and an administrator approves from a queue. The scheduling profile carries through the queue into the created account, so an approved resident is immediately placeable on a rotation.
- **Administrator self-signup with approval.** New administrators request access and an existing approver admits them. The Maintenance role is database-only and cannot be requested.
- **Student representative accounts** are created directly by administrators and bound to a batch and, for subgroup reps, to a subgroup.
- Forced password change on first login, self-service password reset, and account deactivation are standard across all roles.

### A.15 The academic notification and job pipeline

Running on the schedule, every day, without anyone remembering:

| Job | When | What it does |
|---|---|---|
| Open morning session | 00:05 | Creates the day's session and its expected roster |
| Generate teaching sessions | 00:10 | Creates pending sessions for every active batch |
| Apply section transfers | 00:15 | Applies transfers that reached their boundary |
| Remind morning recorder | every minute, fires once per session | Nudges the recorder 15 minutes past the start |
| Remind representatives | 17:00 | Nudges reps with unrecorded sessions |
| Check subgroup placements | Fridays 10:00 | Warns about missing upcoming placements |

### A.16 The academic audit trail

Every administrative academic mutation is written to the administrative audit log: roster changes, transfer decisions, form publishes, session cancellations, roster overrides, structure edits, student and batch changes. The academic submissions page carries its own audit view, so a question about a specific evaluation has an answer.

---

## 4. PART B: The clinical pillar

The clinical pillar was the original system and remains in production use. It has also gained substantial capability since the June deck.

### B.1 Coverage

26 reporting units across three families: 8 inpatient wards, 11 outpatient clinics, 7 procedure services (EEG, Echocardiography, Endoscopy, Hematology Procedures, Bronchoscopy, Renal Procedures, Dialysis). Each family has its own weekly template, and each unit reports on a one-week cycle.

### B.2 The controlled report lifecycle

**Draft, submitted, locked.** A report is drafted through the week, submitted at the deadline, and locked read-only afterwards. Corrections before locking stay possible; they are simply on the record. Auto-lock runs a configurable number of hours after the deadline (36 by default). Unlocking is a privileged, audited action.

### B.3 Validation at the point of entry

- Typed fields with range checks and numeric bounds that cannot be exceeded silently.
- Cross-field rules, so internally contradictory weeks are caught while the person who knows the answer is still looking at the screen.
- Completeness warnings for missing active days.
- **Baseline and outlier warnings**: a value far outside the unit's own recent history is flagged at entry, not discovered a quarter later.
- The same validation runs on live entry and on spreadsheet import, so no path bypasses it.

### B.4 Cell-level audit trail

Every correction records old value, new value, user, and timestamp. Reports carry a status history. Any figure in the system can be traced to who entered it and who changed it. This is the accountability property a shared spreadsheet cannot provide at any price.

### B.5 Server-calculated indicators

Indicators are computed on the server from the submitted cells, once, the same way for every unit. There are no per-unit spreadsheet formulas to drift, break, or be quietly edited.

### B.6 The editable clinical template engine

Templates are database-backed and editable by administrators. Content edits (labels, units, ordering, active days, signal thresholds, soft-disable of a field) apply in place. Structural edits (renaming keys, changing field types, adding or removing fields) are reserved to the Maintenance role. A configuration floor in code guarantees that a template can never be edited into an unusable state.

### B.7 Reminders, overdue tracking, and escalation

- A configurable weekly deadline (day and time).
- Escalating reminders: in-app 24 hours before the deadline, email 4 hours before, SMS 1 hour before, and an overdue notice after. All four thresholds are settings, not code.
- An hourly job re-syncs overdue state, so the overdue list is never stale.
- Notifications are deliverable in-app, by email, and by SMS through one delivery service.

### B.8 Critical event alerts and action items

- **Critical event alerts.** The moment a report containing a critical non-zero value is submitted or edited (deaths, hospital-acquired infections, pressure ulcers, and any other field the department adds to the configurable list), leadership is notified. A passive spreadsheet can never do this.
- **Action items.** A fired alert opens a trackable follow-up task, so a bad outcome is not merely recorded, it is driven to resolution. Items are idempotent per report, never silently reopened after a clinician resolves them, and managed from a dedicated admin page.

### B.9 Threaded comments on reports

Discussion about a specific week's report lives on the report, not in a Telegram thread that nobody can find in March.

### B.10 The leadership dashboard and submission board

- **The submission board:** who has reported, who is late, per unit, per week, filterable by status (not started, draft, submitted, edited after submission, locked, overdue).
- **Red, amber, green targets** on the department's key metrics: delivery rate, inpatient safety events, outpatient same-day rate, procedure throughput. Thresholds and direction are configurable per metric.
- **Trends** across weekly, monthly, quarterly, and yearly granularity, with period-over-period change, filterable by service family, department, and date range.
- **Insight panels** that call out notable rises and drops against configurable percentage thresholds.
- Inpatient, outpatient, and procedure analytics each have their own aggregation service and views.

### B.11 The weekly leadership digest

A scheduled Monday 07:00 summary of the most recent reporting period, delivered to leadership, so nobody has to assemble a status picture by hand. Deliveries are tracked so a digest is never sent twice.

### B.12 Export

- **CSV** is the lossless long-format data set: one row per entered daily cell, for every report ever submitted.
- **Excel** is the human-facing record: an index sheet, then one worksheet per submitted ward-week rendered in the same metric-by-weekday matrix the nurse used to enter it, plus a final audit sheet retaining post-submission edits.
- The .xlsx writer is native to the codebase with no external library dependency, and both exports stream over scalar database rows, so memory and time stay bounded as history grows.

### B.13 Round-trippable Excel import for outages

The other half of the continuity loop. Administrators download a pre-filled template laid out as a per-day grid keyed by unit and field, staff complete it offline during a longer outage, and it uploads back losslessly. Imported reports pass exactly the same validation as live entries. A blank cell on an active day round-trips as an intentional clear, inactive fields and days are ignored, and one bad group degrades into a reported skip instead of aborting the whole import.

### B.14 Configurable reporting scope

A live-start floor and a rolling window (9 weeks by default) control which periods the workspace presents, so a department that starts using the system in July is not confronted with a year of empty historical weeks. Period generation runs weekly so the calendar is always ahead of the department.

### B.15 Offline-ready by design

The application is an installable progressive web app. Entries made during a network interruption are queued locally and submitted when the connection returns, with a bounded dead-letter queue so a permanently failing entry cannot grow without limit. This matters on hospital wifi.

---

## 5. PART C: The platform both pillars share

### C.1 The workspace switcher

Administrators toggle between the **Clinical** and **Academic** workspaces. Each workspace has its own navigation and its own dashboard. Shared surfaces, Users, Audit, and Settings, re-scope in place: the Users page in the Academic workspace shows academic people, and the same page in Clinical shows clinical reporters. Settings stay global. Opening a weekly report always pins the shell to Clinical, so an administrator is never looking at a clinical report inside an academic frame.

### C.2 Roles and authorization

Six roles: **Maintenance** (database-only, structural rights), **Administrator**, **Nurse**, **Resident**, **Consultant**, **Student representative**.

Authorization is **two layers, always**:
1. A coarse permission on the route, for example `permission:academic.submit`.
2. A policy re-check in the controller for the fine, data-driven rule: is this user the designated recorder today, does this user head the destination section, is this representative assigned to that subgroup, did these two people actually overlap on that date.

**Roles stay static; eligibility is data.** That separation is why a rotation change automatically changes who can evaluate whom, with no permission edit anywhere. There are roughly 40 distinct permissions in the matrix, and the absence of a permission is used deliberately as a structural guarantee, most importantly for student representatives.

### C.3 Audit

Two audit trails: cell-level edits on clinical reports, and an administrative action log covering every privileged mutation in both pillars. Both are viewable in the admin Audit page, scoped to the active workspace, with retention indexes and a pruning job so the tables stay fast.

### C.4 Notifications

One notification center for every role. Non-administrative users are pinned server-side to their own rows, every write goes through an owner-or-admin policy, and read, read-all, delete, and restore are all supported. Stale notifications are pruned weekly.

### C.5 Performance and scale

- The dashboard's aggregates are versioned and cached; every write that can affect analytics rotates the version, and the most recently viewed filter sets are rebuilt **after the response is sent**, so the next viewer does not pay for a cold build.
- Clinical field values are aggregated in SQL and never hydrated into objects.
- Academic analytics use content-stamp caching, as described in A.12.
- Polling is skip-guarded, persistence is debounced, and the audit log is capped.
- The system is exercised against a one-year scale fixture: 30 consultants, 10 sections, 70 residents, 70 users of other kinds, and 200 students, with a full year of weekly reports behind it.
- The queue, cache, and session layers run on the database driver. No Redis is required, though it is a documented scale-up path.

### C.6 Accessibility and mobile

Touch targets meet the WCAG minimum on mobile across every screen, with the desktop layout untouched. The application has a mobile bottom tab bar per role, a desktop sidebar, and a shared page shell, and it was audited for keyboard and screen-reader behavior.

---

## 6. PART D: Deployment

**Topology.** One Ubuntu LTS server, on the hospital LAN, not exposed to the public internet. Nginx serves the single-page application and proxies the API to PHP-FPM 8.3 from the same HTTPS origin. MariaDB is local to the server.

**Why HTTPS on a LAN.** The installable app's service worker requires it, so offline capability requires a real certificate even inside the hospital.

**A committed deployment kit,** not a set of verbal instructions:

| File | Purpose |
|---|---|
| `nginx.conf` | Same-origin SPA and API host |
| `php-fpm.conf` | Explicit worker limits, memory, recycling, slow log |
| `queue-worker.service` | Persistent systemd queue worker |
| `backup.sh` | Daily consistent dump, retention, off-server copy, integrity check |
| `deploy.sh` | Locked, versioned, backup-first, atomic release deployment |
| `ufw.sh` | Hospital-LAN firewall rules |
| `logrotate.conf` | Log rotation |

**Operations.** Releases are immutable directories with an atomic symlink switch, so a deployment is reversible. Backups run nightly at 02:00 with a secondary off-server copy and a verified restore drill recorded in configuration. Security updates are unattended. A launch-readiness command validates the whole environment and refuses to pass on a misconfiguration, including a scheduler heartbeat so a silently dead cron surfaces as a failure rather than as jobs quietly never running. A plain-language operations handbook ships with the system, because the department administers it and hospital IT is escalation only.

---

## 7. PART E: Quality assurance

The platform is verified at three levels, and the suites are run on continuous integration on every change.

| Level | Scope | Volume |
|---|---|---|
| Backend feature tests | API, workflow, authorization, analytics, jobs | 338 tests, 2,324 assertions, across 47 files |
| Frontend unit tests | Components, offline queue, caching, analytics tabs | 91 tests across 15 files |
| Browser end-to-end tests | Real logins walking real screens, by role | 163 tests across 28 specs |

Rounded for a slide: **more than 590 automated tests**, up from the 129 plus 57 quoted in the June deck.

**What the coverage actually asserts:** the report workflow and every validation rule, locking and unlocking boundaries, analytics correctness and caching, Excel import and export safeguards, reminders and escalation, weekly digests, action items, academic evaluation eligibility including the rotation pairing rule, form versioning and core-field protection, morning session punctuality and roster snapshotting, undergraduate session generation and representative restrictions, transfer approval authority, and access boundaries for all six roles.

**Beyond the suites:** a full security audit, a database review, a performance and scalability audit, a role and permission matrix review, an interaction-latency audit, and a pre-deployment quality-assurance pass were each carried out and their findings fixed and re-verified. Go-live verification in the hospital environment is part of the delivery.

---

## 8. What changes, today versus the platform

| | Today | The platform |
|---|---|---|
| Clinical source of truth | Telegram-shared Excel copies | One server-owned record per unit per week |
| Clinical validation | Manual review, after the fact | Checked at the point of entry |
| Follow-up | Manual chasing on Telegram | Automated reminders, escalation, and alerts |
| Leadership view | Delayed consolidation | Live dashboards, trends, and targets |
| Teaching round | Memory and impressions | Presence, punctuality, and quality on the record |
| Resident feedback | Monthly paper, arrives after the moment | Documented ACGME feedback tied to the round |
| Who supervised whom | Reconstructed by asking people | Derived from the dated duty roster |
| Duty schedule | A monthly file | A live system that drives eligibility and rosters |
| Undergraduate teaching | Scheduled, never verified | Held, not held, or cancelled, with reasons |
| Morning session | Unrecorded | Auto-opened, punctuality measured, attendance snapshotted |
| Student assessment | Paper, per consultant | Weekly and final evaluations in one record |
| Evaluation forms | Fixed, developer-owned | Department-editable, versioned, history-safe |
| Accreditation evidence | Assembled under pressure | Continuously accumulated |

---

## 9. Delta since the June 2026 deck

Everything in this list is new and should be visible in the updated presentation.

**Academic, new:**
1. Wards, sections, and duty types as admin-managed structure.
2. Dated duty assignments as the single source of placement truth.
3. The full month-by-month consultant duty roster, plus day-level coverage.
4. Admin-configured rotation calendars per academic year, with monthly rotations for Years 1 and 2 and continuous eight-week blocks for Year 3.
5. The rotation planner grid, with honest empty, consistent, and mixed cell states.
6. Consultant section transfer requests, approved by the destination section head, applied at the rotation boundary.
7. Rotation-aware evaluation eligibility through the pairing rule, replacing "any active user of the opposite role."
8. Permanent snapshotting of ward, placement, and form version on every evaluation.
9. Administrator entry of external and off-service evaluations.
10. The admin-editable evaluation form engine, with content-in-place versus structural-draft-and-publish, versioned history, and protected core fields.
11. The complete undergraduate module: batches, subgroups, placements, weekly programs, automatic session generation, three representative logins per batch, held/not-held/cancelled logging with mandatory reasons, per-student attendance by the teaching consultant, and weekly plus final student evaluations.
12. Department-wide morning sessions: auto-opening, configurable days and start time, punctuality measurement, auto-generated roster with admin overrides, a designated recorder, and snapshotted attendance.
13. Academic operations analytics: morning punctuality, teaching occurrence, and student progress, as three dashboard tabs.
14. The normalized combined-score leaderboard with provisional flagging for thin evidence.
15. Personal academic home pages with self-performance for residents and consultants.
16. Academic registration with a scheduling profile, and an approval queue that carries it through.
17. Six scheduled academic jobs covering session opening, generation, transfers, and reminders.

**Clinical, new since the June deck:**
18. Threaded comments on reports.
19. Critical event alerts wired to trackable action items.
20. The scheduled weekly leadership digest.
21. Native .xlsx export with a per-report worksheet layout and an audit sheet.
22. Round-trippable Excel import for outage continuity, with a Data Import admin page.
23. The database-backed, admin-editable clinical template editor.
24. Configurable reporting scope: live-start floor plus a rolling window.
25. Analytics warm-path caching and after-response cache warming.

**Platform, new:**
26. The Clinical and Academic workspace switcher with per-workspace navigation and scoping.
27. Administrator self-signup with an approval queue, and the Maintenance role separation.
28. A significantly expanded permission matrix with policy-level, data-driven eligibility.
29. The on-premises deployment kit and operations handbook.
30. WCAG-minimum touch targets on mobile.
31. A one-year scale fixture and the performance work it drove.
32. The full audit programme: security, database, performance, roles, latency, and pre-deployment QA.

---

## 10. Suggested slide plan

18 slides. The academic pillar occupies the center of the deck and appears before the clinical pillar. Keep the visual language of the previous deck.

| # | Slide | Content source |
|---|---|---|
| 1 | Title. Internal Medicine Reporting and Academic Accountability Platform. Presenter and date. | Section 1 |
| 2 | Context: two missions, one department. Keep the 26 units and weekly cycle figures. | Section 1 |
| 3 | The problem, restated with the academic gap first: teaching, supervision, and assessment were never recorded; reporting was recorded but unverifiable. | Section 2 |
| 4 | The proposal: one platform, two pillars, academic listed first. Badges: built, tested, ready to deploy. | Sections 1 and 2 |
| 5 | **Academic 1.** The backbone: wards, sections, duty types, dated assignments. One table answers "who is where." | A.1 |
| 6 | **Academic 2.** The duty roster and rotation planner. Month-by-month for consultants, calendars and blocks for residents, mixed-state honesty. | A.2, A.3 |
| 7 | **Academic 3.** Rotation-aware eligibility. The pairing rule, and snapshot-never-recompute. This is the correctness slide. | A.5 |
| 8 | **Academic 4.** The MDT round on the record: presence, punctuality, round quality, participants, system issues. | A.6 |
| 9 | **Academic 5.** Documented mentorship: the ACGME-aligned resident evaluation, plus external and off-service entry. | A.7, A.8 |
| 10 | **Academic 6.** Forms the department owns: content in place, structure versioned, core fields protected. | A.9 |
| 11 | **Academic 7.** The undergraduate module: batches, subgroups, three rep logins, held/not-held/cancelled, attendance, weekly and final evaluation. Note that reps can never see a score. | A.10 |
| 12 | **Academic 8.** Morning sessions: auto-opened, punctuality measured, roster generated, attendance snapshotted. | A.11 |
| 13 | **Academic 9.** The academic leadership dashboard: evaluation trends, the combined-score leaderboard, and the morning, teaching, and students operations tabs. | A.12 |
| 14 | **Clinical 1.** The controlled report: draft, submitted, locked, validated at entry, every correction logged, indicators on the server. | B.2 to B.5 |
| 15 | **Clinical 2.** Leadership view and the closed loop: submission board, targets, trends, critical event alerts into action items, weekly digest, export and outage import. | B.8 to B.13 |
| 16 | **What changes.** The today-versus-platform table, trimmed to eight rows. | Section 8 |
| 17 | **Built for this department.** On-premises LAN deployment, department-administered, offline-ready, backed up, plus the test and audit figures. | Sections 6 and 7 |
| 18 | **Recommendation and rollout.** Adopt as the system of record. Deploy, train, pilot one or two units, scale in phases. Investment figures carried over from the June deck. | Previous deck, slides 13 and 14 |

**If a shorter deck is needed,** merge slides 5 and 6, merge 8 and 9, and drop 16. Do not cut slides 7, 11, or 12: the pairing rule, the undergraduate module, and morning sessions are the three things the department cannot get any other way.

---

## 11. Numbers safe to put on a slide

- 26 clinical reporting units: 8 inpatient, 11 outpatient, 7 procedure services.
- 6 teaching wards, 8 specialty sections.
- 6 roles, around 40 distinct permissions.
- 4 evaluation instruments, all department-editable.
- 2 undergraduate cohorts, C1 at twelve weeks and C2 at eight weeks, 2 subgroups per batch, 3 representative logins per batch.
- Morning sessions: 3 days a week, 08:00 scheduled start, both configurable.
- Reminder escalation: in-app at 24 hours, email at 4 hours, SMS at 1 hour before the deadline.
- Auto-lock 36 hours after the deadline, configurable.
- Tests: 338 backend (2,324 assertions), 91 frontend unit, 163 browser end-to-end. More than 590 in total, against 186 in the June deck.
- Scale fixture: a full year of data over 30 consultants, 70 residents, 200 students.
- 8 delivered build phases in the V2 expansion, from structure through deployment.
