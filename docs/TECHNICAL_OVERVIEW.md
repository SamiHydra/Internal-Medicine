# Technical Overview — St Paul's Internal Medicine Platform

*A plain-language breakdown of how this system is built and why. Written for a technical reader who has not seen the code, and for a non-technical reader who needs to understand the engineering decisions.*

Audit date: 2026-08-07 · Branch: `fix/mobile-touch-targets`

---

## Contents

1. [What the product is](#1-what-the-product-is)
2. [System shape](#2-system-shape)
3. [Frontend stack and concepts](#3-frontend-stack-and-concepts)
4. [Backend stack and concepts](#4-backend-stack-and-concepts)
5. [Authentication](#5-authentication)
6. [Authorization — three layers](#6-authorization--three-layers)
7. [Data model concepts](#7-data-model-concepts)
8. [Time and calendars](#8-time-and-calendars)
9. [The clinical pillar](#9-the-clinical-pillar)
10. [The academic pillar](#10-the-academic-pillar)
11. [Forms as data](#11-forms-as-data)
12. [Analytics engine](#12-analytics-engine)
13. [Keeping screens fresh](#13-keeping-screens-fresh)
14. [Background work](#14-background-work)
15. [Notifications and alerting](#15-notifications-and-alerting)
16. [Audit, retention and compliance](#16-audit-retention-and-compliance)
17. [Offline and continuity](#17-offline-and-continuity)
18. [Performance engineering](#18-performance-engineering)
19. [Security posture](#19-security-posture)
20. [Testing strategy](#20-testing-strategy)
21. [Deployment and operations](#21-deployment-and-operations)
22. [Engineering principles that recur](#22-engineering-principles-that-recur)
23. [Audit observations](#23-audit-observations)

---

## 1. What the product is

Two products sharing one login, one database, and one server.

**Clinical workspace.** Nurses are assigned to a *(department × report template)* pair. Every ISO week a reporting period opens and they fill in per-day values for their ward — admissions, discharges, deaths, patient days, procedures, and so on. Admins review, lock, and analyse the results. The system computes bed occupancy rate, bed turnover, and average length of stay, raises overdue and critical-event alerts, and mails a weekly leadership digest.

**Academic workspace.** Residents evaluate consultants on ward rounds; consultants evaluate residents; consultants evaluate medical students. Morning sessions are opened and attendance recorded; undergraduate teaching sessions are generated from a schedule and logged as held or not held; residents rotate through blocks on an academic calendar; consultants can request transfers between sections.

The concept that unites them is the **workspace**. Every role carries a workspace tag — `clinical`, `academic`, or `both`. Admins get a toggle in the UI that swaps navigation, dashboards, and scoping; everyone else only ever sees their own side. This is why one codebase does not feel like two applications bolted together.

**Six roles:**

| Role | Label shown | Workspace | What they do |
|---|---|---|---|
| `superadmin` | Maintenance | both | Protected owner. Created only from the server/database. Approves admin accounts, makes structural changes |
| `admin` | Admin | both | Full platform administration |
| `nurse` | Nurse | clinical | Files weekly reports for assigned departments |
| `resident` | Resident | academic | Evaluates consultants; is evaluated by them |
| `consultant` | Consultant | academic | Evaluates residents and students; is evaluated by residents |
| `student_rep` | Student representative | academic | Logs whether teaching happened. Sees no score, ever |

Scale at time of audit: 33 API controllers, 44 database models, 26 authorization policies, 73 migrations, 38 page components, 163 TypeScript source files, 50 backend test files, 28 end-to-end browser suites.

---

## 2. System shape

A **single-page application** in the browser talks to a **REST API**. Nothing else. The browser never touches the database, and the server never renders HTML pages.

```
Browser (React SPA)
      │  fetch /api/*  with session cookie
      ▼
Nginx (one HTTPS origin)
      │  static files → dist/
      │  /api, /sanctum → PHP-FPM
      ▼
Laravel API
      │  Eloquent
      ▼
MariaDB
```

### The same-origin decision

In production, Nginx serves both the built app and the API from a single HTTPS address. In development, Vite fakes exactly the same arrangement with a proxy.

This is not cosmetic. The entire authentication model depends on the browser believing the app and the API are the *same site*. Serving the app from `localhost` and the API from `127.0.0.1` — technically the same machine — would be treated by the browser as cross-site, and the session cookie would be silently dropped. Same-origin is a load-bearing constraint, documented in the config so nobody "simplifies" it away.

---

## 3. Frontend stack and concepts

**React 19 · TypeScript · Vite 8 · Tailwind CSS v4 · Radix UI**

### Type safety end to end

Every API response shape is declared once in TypeScript. If the backend changes a field name and the frontend type is not updated, the build fails rather than the page breaking in front of a user.

### Route-level code splitting

Every page is loaded lazily. The login screen does not download the charting library, the admin shell, or the rotation planner — those arrive only when someone navigates to them. This is the single largest contributor to fast first load.

Build configuration goes further and explicitly keeps charting libraries out of the login page's preload graph, because a stray import once dragged the entire Recharts bundle into the first paint.

### Route prefetching

When the mouse hovers over a navigation link, the app quietly starts downloading that page's code. By the time the click lands, the page is already in memory and the navigation is instant. If a prefetch mapping ever drifts out of sync it simply does nothing — the normal lazy load still works.

### Two state layers, deliberately separated

| Layer | Holds | Lifetime |
|---|---|---|
| `AppDataContext` | The cross-domain workspace model: current user, reports, assignments, settings, notifications | Loaded at sign-in, lives for the session |
| **TanStack Query** | Per-page server data — analytics slices, directories, admin lists | Cached with staleness rules, refetched on demand |

TanStack Query gives request de-duplication, caching, and background refresh for free. The context layer exists because a large amount of the UI derives from one coherent snapshot of the workspace rather than from independent endpoint calls.

The query cache is **cleared on sign-out**, so a second person logging in on the same browser can never inherit the previous user's analytics or directory results.

### Component foundations

- **Radix UI** supplies accessible, unstyled behaviour — dialogs, selects, tabs, tooltips, popovers. Keyboard navigation, focus trapping, and screen-reader semantics are correct because they are not hand-rolled.
- **Tailwind v4** supplies the visual system through design tokens. We own the look; we do not own the accessibility mechanics.
- **React Hook Form + Zod** — forms validate against a declared schema in the browser for instant feedback. The server validates independently against its own rules; the client check is a convenience, never a control.
- **Recharts** for dashboards, **sonner** for toasts, **framer-motion** for transitions.

### Derived data lives in pure functions

Dashboard aggregations, trend series, status derivation, and period windowing are pure functions over the state snapshot. They take data in and return data out with no side effects, which makes them directly unit-testable without rendering anything.

---

## 4. Backend stack and concepts

**Laravel on PHP 8.3**, organised into four layers with strict responsibilities.

| Layer | Responsibility | Does *not* |
|---|---|---|
| **Routes** | Declare the API surface and the permission each endpoint requires | Contain logic |
| **Controllers** | Validate input, call one service, shape the response | Contain business rules |
| **Services** | All business logic — submission, scoring, rostering, analytics | Know about HTTP |
| **Models** | Map tables to objects, define relationships | Make decisions |

Services are grouped by domain:

```
app/Services/
├── Academic/       morning sessions, teaching, transfers, rotations, forms, roster
├── Analytics/      dashboard, inpatient, outpatient, procedures, exports
├── Reports/        submission, locking, periods, overdue, quality, alerts, import
├── Notifications/  multi-channel delivery, SMS
├── Admin/          access-request review, settings, admin audit
└── Workspace/      the freshness ledger
```

A change to evaluation scoring cannot accidentally touch clinical reporting, because the two never share a file.

### The route table is the security document

Every route declares its own permission inline. Reading `routes/api.php` top to bottom tells you the complete surface area of the system and exactly who may reach each part of it. There is no hidden route, no convention-based auto-registration, and no endpoint that inherits access implicitly.

---

## 5. Authentication

We use **Laravel Sanctum in SPA cookie mode**, not bearer tokens.

### The flow

1. The browser requests a CSRF cookie.
2. The browser posts credentials. The server verifies them, creates a **session row in the database**, and returns an encrypted, `HttpOnly` cookie.
3. Every later request carries that cookie plus a CSRF header proving the request came from our own page.

### Why cookies rather than JWT

| Concern | Cookie session | Bearer token |
|---|---|---|
| Theft via XSS | Cookie is `HttpOnly` — JavaScript cannot read it | Token sits in JS-readable storage |
| Revocation | Delete the session row; effective on the next request | Token stays valid until it expires |
| Deactivating a user | Immediate | Requires a denylist you must also maintain |

For a system holding hospital operational data, immediate revocation was worth the same-origin constraint it imposes.

### Supporting mechanics

- **Forced password change** — new and reset accounts are gated behind a change-password screen. Only the change-password endpoint and the minimal bootstrap call are reachable until it is cleared.
- **Password reset** — emailed tokens with a 60-minute expiry and a 60-second re-request throttle.
- **Rate limits sized to their real cost.** The general ceiling is 300 requests/minute per user — far above any legitimate session. Login is 10/minute. Password change is **6/minute on its own dedicated counter**, because each attempt costs a deliberately expensive bcrypt hash and an unthrottled burst would be a CPU amplification attack. Giving it a separate counter also prevents it from consuming the app-wide budget.
- **Account-enumeration resistance** — failed logins and password resets do not reveal whether an address exists. There is a dedicated end-to-end test suite for this.

---

## 6. Authorization — three layers

The most carefully engineered part of the system, appropriately for hospital data. Three independent mechanisms, each of which must pass.

### Layer 1 — Permissions (coarse, role-based)

A static matrix maps each role to named capabilities: `reports.lock`, `academic.submit`, `students.manage`, `transfers.review`, and roughly forty others. Middleware enforces it before the controller executes.

The permission names are deliberately fine-grained. Rather than one blunt "admin" flag, content editing and structural editing are separate capabilities:

- `templates.editContent` — rename a label, reorder fields, change a threshold. Admins and Maintenance.
- `templates.editStructure` — rename a key, change a field type, add or remove a field. **Maintenance only.**

The same split exists for evaluation forms. The reasoning: content edits are reversible and harmless; structural edits change the meaning of historical data.

### Layer 2 — Policies (fine, per-record)

Permissions answer *"may this role do this kind of thing?"* Policies answer *"may this specific user touch this specific record?"* There are 26 of them, one per model.

The pattern throughout is **coarse permission, narrow policy**:

- `transfers.review` gets a consultant to the endpoint. The policy then narrows approval authority to the head of the **destination** section.
- `morningAttendance.record` gets a user to the recording endpoint. The policy narrows it to the designated recorder for that day.

This keeps the route table readable while keeping the actual rule precise.

### Layer 3 — Workspace scoping

Queries are filtered by workspace, so an academic user cannot enumerate clinical records even by guessing an ID. Combined with UUID primary keys, guessing is not a viable attack.

### The frontend's role checks are decorative

Client-side role logic hides menu items and disables buttons. **Every real decision is made server-side.** Deleting the entire frontend would not weaken security by one step. This is verified by dedicated end-to-end suites — `object-authorization.spec.ts`, `admin-boundary.spec.ts`, `permissions.spec.ts` — that call the API directly as the wrong user and assert the rejection.

---

## 7. Data model concepts

### UUID primary keys everywhere

Records are identified by random UUIDs rather than sequential integers. Two consequences: IDs cannot be guessed or counted (you cannot learn how many patients-days records exist by watching the numbers climb), and records created on separate machines never collide during import or migration.

### EAV for report values

Instead of one database column per metric, each value is stored as a row:

```
report_field_values: (report, field_definition, day_name, value)
```

with a uniqueness constraint on the triple so the same field-day can never be recorded twice.

**Why:** an admin can add a new reporting field, retire an old one, or rename a label without a database migration or a deploy. The report form renders itself from the field definitions.

**The cost:** every analytics query is more complex than a simple column read. The caching architecture in [section 12](#12-analytics-engine) exists specifically to pay this tax down. It is not an optional extra.

Values are stored in typed columns (`value_number`, `value_text`, `value_time`, `value_json`) rather than one stringly-typed column, so the database can still sum and compare numerically.

### Reporting periods are records, not calculations

The ISO week is a first-class row in the database, created ahead of time by a scheduled job, carrying its own deadline day and time. Nothing computes "which week is this" at read time, so a job running at 00:05 or a user in a different timezone can never disagree about which period a report belongs to.

### Calculated metrics are stored, not recomputed

Bed occupancy rate, bed turnover rate, and average length of stay are derived on save and written to a `calculated_metrics` row. Dashboards read the stored value. Recomputing them per view would multiply the EAV cost across every chart.

### The reporting window

Two configured boundaries decide what anyone can see:

- A **live start date** — the week the hospital actually began using this system. Nothing earlier is exposed, because earlier weeks were never filed here and would render as a wall of missing reports.
- A **default span** of nine periods, with a hard ceiling of 104 even on "show everything", so an unpaginated response stays bounded as history accumulates.

---

## 8. Time and calendars

Time handling is a common source of silent bugs, so it is centralised.

**Database timestamps stay in UTC. Date-only decisions use hospital wall-clock time** (`Africa/Nairobi`). A single helper enforces this. Without it, a scheduled job running just after midnight UTC would act on *yesterday* from the hospital's point of view — opening the wrong morning session, or marking a report overdue a day early.

Scheduled jobs are pinned to the business timezone explicitly rather than inheriting the server's.

**Rotation calendars are configured, never hard-coded.** The academic year start moves each year with the national programme. Year 1 and Year 2 residents rotate by calendar month; Year 3 runs continuous fixed-week blocks with no gaps. An admin creates a calendar with the year's real start date and the block structure is generated from it.

---

## 9. The clinical pillar

### The report lifecycle

A report moves through a fixed set of states:

```
not_started → draft → submitted → edited_after_submission → locked
                ↓
             overdue
```

Each transition is its own endpoint with its own permission, and each writes a row to status history recording who, when, and why.

**Editing after submission is permitted but permanently visible.** The status is not reset to `submitted` — it becomes `edited_after_submission` and stays that way. That was a governance decision encoded in the schema rather than left to policy documents.

### Submission is one guarded path

Every value that enters the system — typed in the browser, or imported from a spreadsheet — passes through the same submission service, which:

1. Authorizes the actor against the specific assignment.
2. **Coerces and validates each value by declared type** — integers, decimals, times, and constrained choices each have their own rule. A value that cannot be coerced raises a validation error naming the field.
3. Diffs against the previous value and writes an audit row for anything that changed.
4. Computes the next status from what actually happened, rather than trusting the client's claim.
5. Recomputes derived metrics.
6. Runs quality checks and critical-event detection.
7. Notifies the right people.

Because import shares this path, an offline-edited spreadsheet cannot bypass a single validation rule.

### Quality and alerting

- **Quality analysis** flags internally inconsistent reports (discharges exceeding admissions, implausible ratios) and cross-week trend anomalies.
- **Critical-event detection** flags clinically important non-zero values — deaths, hospital-acquired infections, pressure ulcers — the moment a report is submitted or edited, and pushes a notification to admins. The set of critical fields is configurable in app settings, not hard-coded. *This is the capability a spreadsheet structurally cannot provide.*
- **Overdue synchronisation** runs hourly, creating notifications for missing reports past deadline and — importantly — **deleting stale ones** when a report finally arrives. Alerts that never clear stop being read.

### Import and export as an outage-continuity loop

An admin can download a round-trippable template, edit it offline in Excel during a network or system outage, and import it back. A present-but-blank cell for an active day is treated as an intentional clear, so an offline deletion round-trips correctly. A malformed group degrades to a reported skip rather than aborting the whole import.

---

## 10. The academic pillar

### The roster is the single source of truth

One service answers *"who was placed where on this date?"* Every downstream academic surface reads through it: evaluation eligibility, the morning roster, the duty grid, the rotation planner. Nothing reads a user's home ward field directly.

This matters because evaluation eligibility depends on it — a resident may only evaluate a consultant they actually shared a placement with on that date. Centralising the question means there is exactly one definition of "worked together", not five subtly different ones.

### Morning sessions

Opened automatically on configured days by a scheduled job. Key design decisions:

- The configured start time is **snapshotted onto the session** when it opens, so an admin changing the department's start time next month does not retroactively rewrite whether last week was punctual.
- The expected roster is generated from current duty assignments plus explicit admin include/exclude overrides.
- **Attendance is snapshotted at recording time.** A later roster change never rewrites history.
- A session left un-recorded stays pending. That is a signal for oversight, not an error state to be cleaned up.
- Recorders are reminded automatically fifteen minutes after the session's own snapshotted start, with de-duplication so nobody is reminded twice.

### Undergraduate teaching

Sessions are generated ahead of time from a weekly activity schedule for each active batch. The batch's **student representative** records whether each session was held — and a reason is **required** when it was not. The consultant who taught records per-student attendance.

Student representatives can reach only those two endpoints. They see no evaluation, no assessment, and no score. The restriction is enforced by permission, by policy, and by an end-to-end test.

### Section transfers

A consultant requests a transfer to another section. The head of the **destination** section approves — an admin can override. By default the transfer applies at the **next rotation boundary**, not immediately, so mid-block rosters stay stable; an admin can force an immediate effective date.

Applying a transfer is the single place this workflow changes a user's section, and it also closes the old section's open ward-service assignment so the roster stays truthful. A scheduled job applies transfers whose effective date has arrived.

### Evaluation scoring

Two directions, each with its own indicator set:

- **Consultant evaluation** — six yes/no indicators (all patients reviewed, management plan documented, VTE assessed, discharge discussed, medication review done, critical labs reviewed).
- **Resident evaluation** — ten yes/no indicators (punctuality, preparation, presentation clarity, clinical reasoning, management planning, documentation timeliness, communication, professionalism, feedback responsiveness, follow-through).

The combined ranking normalises two different scales into one comparable number: a 1–5 overall rating and the percentage of indicators marked true, weighted equally. Both components are mandatory. The scoring inputs are identified by **field key, not database column**, so they survived the migration of evaluations into the configurable-form engine unchanged.

---

## 11. Forms as data

Both report templates and evaluation forms live in database tables rather than in code. This is what allows the department to adapt the instrument without a developer.

### Two classes of edit

**Content edits** apply atomically to the currently published version: labels, help text, ordering, option wording, active days, thresholds, soft-disabling a field. Admins can make these.

**Structural edits** — adding or removing a field, renaming a key, changing a type — go through a **draft → publish** cycle and are restricted to Maintenance. Publishing creates a **new version**; historical submissions keep rendering against the version they were answered on. A three-year-old evaluation still displays the questions that were actually asked.

### Core fields cannot be broken

Certain fields feed the accountability analytics. They are marked core and can never be removed or type-changed, in a draft or otherwise. A guard asserts this before any draft can be published. Database-level constraints back the same rules up, so even a direct database edit cannot produce two published versions of one form or a form missing its core contract.

---

## 12. Analytics engine

The hard problem: a year of weekly reports across seventy departments is a large volume of EAV rows, and dashboards must feel instantaneous.

Four techniques, layered.

### 1. Aggregate in SQL, never in PHP

Sums and groupings happen inside the database; PHP receives totals, not raw rows. Loading raw field values into application memory was the direct cause of an out-of-memory crash on the "All time" range at seeded scale. That code path is now deliberately closed, and the constraint is recorded so it is not reintroduced.

### 2. Content-stamp caching

The cache key includes a **fingerprint of the underlying data** — row count plus newest modification timestamp.

```
key = analytics:v3:{operation}:{hash(row_count | latest_updated_at)}
```

New data automatically produces a new key. Two consequences:

- **A write is visible on the very next read.** There is no invalidation step to forget.
- **Unchanged data never recomputes.** The TTL exists only as a backstop against unreachable stale keys.

This is the "no manual cache invalidation anywhere" property, and it is the reason the analytics layer does not suffer from stale-dashboard bugs.

### 3. Lock-on-build

If ten people open the same cold dashboard simultaneously, one builds it and the others wait for that result rather than performing nine identical expensive computations. If the builder is slow, waiters prefer its completed value; if the lock times out, the endpoint degrades to one local build rather than failing.

### 4. Background cache warming

After a write, a queued job rebuilds recently viewed dashboard slices so the next viewer hits a warm cache. The job is **unique-until-processing**: a burst of twenty writes collapses into one pending warm, and the lock releases before processing so a write landing mid-warm can still queue a follow-up for the newer data.

### Exports

Excel and CSV exports are **queued**, not generated inside the web request, so a large export cannot time out a browser or block a worker thread. Output goes through a spreadsheet-injection-safe writer, so a cell value beginning with `=` or `+` cannot execute as a formula when someone opens the file.

---

## 13. Keeping screens fresh

We deliberately did **not** put websockets in the critical path.

### The revision ledger

- A single database row holds a version number.
- **Database triggers on all 43 domain tables** increment it on every insert, update, and delete.
- The browser polls one very small endpoint and asks only: *has the number changed?*
- If yes, refetch. If no, do nothing.

### Why triggers rather than application events

Triggers fire for **bulk operations, imports, and direct query-builder writes** that bypass the application's model layer entirely. It is structurally impossible for a write to slip through unnoticed. Application-level events would miss exactly the paths most likely to change a lot of data at once.

### Polling behaviour

- Roughly 60 seconds, **jittered** by ±15 seconds so a thousand tabs do not synchronise into a thundering herd.
- Backs off to **5 minutes when the tab is hidden**.
- The endpoint is authenticated by a **short-lived signed token** issued at workspace bootstrap, rather than a full session lookup. This avoids a database session read and write on every poll from every open tab. It exposes no workspace data — only an opaque hash.

### The tradeoff, stated honestly

The counter is **global**. A write anywhere refreshes everyone. This can cause an occasional wasted refetch for a user who could not have seen that write — but it can never *miss* a change the user should see. Correctness was chosen over precision. At significantly higher concurrency, per-workspace counters would be the next step.

### Websockets exist but are off

Laravel Reverb with Laravel Echo is wired up and functional, gated behind environment variables and disabled by default. The poll is sufficient for this scale and does not require a second always-on service on hospital infrastructure. The launch checklist explicitly says to leave it off unless it is actually hosted.

---

## 14. Background work

### Queues

Anything slow or failure-prone runs outside the request cycle, on named queues with retries and exponential backoff:

| Queue | Carries |
|---|---|
| `analytics` | Excel/CSV export building, dashboard cache warming |
| `notifications` | Email and SMS delivery |
| `default` | Everything else |

### The scheduler

Around eighteen recurring jobs, all pinned to hospital time, all with a **10-minute overlap lock**. The short lock expiry matters: a worker killed by an out-of-memory event or a deploy signal self-heals on the next tick instead of stranding the schedule mutex for the framework default of 24 hours — which would silently halt every digest and reminder.

| Cadence | Job |
|---|---|
| Every minute | Morning-recorder due check; queue health monitor; scheduler heartbeat |
| Hourly | Overdue report sync; report reminders |
| Daily 00:05–01:20 | Open morning session; generate teaching sessions; apply due transfers; prune failed jobs, batches, and operational data |
| Daily 17:00 | Remind student representatives |
| Weekly | Ensure reporting periods exist; leadership digest; placement checks; prune notifications |

### The heartbeat

The scheduler writes a timestamp to the cache every minute. The launch-readiness command reads it. **A silently dead cron therefore surfaces as a stale key rather than as jobs mysteriously never running** — the failure mode that is otherwise invisible until someone notices reminders stopped weeks ago.

### Two worker modes

The queue worker runs either as a **persistent systemd service** (the department server) or as a **cron-tick drain** every minute (constrained shared hosting). One config value switches between them, and the scheduler entry becomes a no-op in daemon mode. The value is read through config rather than the environment directly, because environment reads return null once config caching is enabled in production.

### Selective retry

Failed jobs are **not** replayed indiscriminately. Only recent, allow-listed *transient* delivery failures are retried, at most once per job UUID. A job that failed for a business or validation reason stays failed, because retrying it would produce the same failure forever.

---

## 15. Notifications and alerting

One call fans out to three channels: in-app notification rows, email, and SMS. Invalid channel names are filtered rather than throwing.

Dispatch happens **after commit**. Nothing is sent until the database change has actually committed, so nobody receives an email about a report that then failed to save.

Notification volume is managed actively:

- Overdue notifications are **upserted and then reconciled** — stale ones are deleted once the underlying report arrives.
- Old notifications are pruned weekly.
- The audit log surface is capped so a dashboard cannot pull an unbounded history.

The weekly **leadership digest** assembles the most recent period into a single at-a-glance summary and mails it, so leadership never has to build it from a spreadsheet by hand.

---

## 16. Audit, retention and compliance

Two separate, independent trails:

| Trail | Records |
|---|---|
| **Cell audit** | Every changed report value — old value, new value, who, when |
| **Admin audit** | Every user creation, approval, rejection, role change, lock, unlock, settings change |

Both are indexed for retention queries and pruned on a schedule, so tables that would otherwise grow without bound stay operationally manageable.

Status history is a third, narrower trail: every report state transition with its actor and note.

---

## 17. Offline and continuity

Built for nurses working on unreliable ward wifi.

### The service worker

Caches the application shell so the app opens with no network at all. Its cache name is a **hash of the built asset filenames**, which are themselves content-hashed. Any code change therefore produces a new cache key, and the activation step purges the stale shell automatically.

This eliminates the classic "users are running last month's app and nobody knows why" support call. The first online visit installs the complete shell rather than caching chunks lazily as they happen to be used.

**API responses are never cached** — only the application itself. Stale clinical data is worse than no data.

### The offline save queue

Submissions made while offline are written to IndexedDB and replayed on reconnect. Saves that fail for a *real* reason — the report was locked, the assignment was removed — are **dead-lettered after five attempts** rather than retried forever, so a permanently impossible save does not accumulate as a phantom pending item.

### The wider continuity loop

Offline queue (short outage) → spreadsheet export/import round-trip (long outage). Both funnel back through the same validated submission path.

---

## 18. Performance engineering

Performance is measured and gated, not assumed.

- **Real-user monitoring.** Actual load and interaction timings are sampled from real browsers and posted back. The receiving endpoint accepts a **strict allow-list of timing metadata** and carries no report or patient fields — telemetry is not a data-exfiltration surface.
- **Performance budgets in CI.** `npm run perf:budget` fails the build if bundles grow past agreed limits. Regressions are caught before merge rather than reported by users.
- **Lighthouse CI** for scored page audits with its own config.
- **Load testing** with a contract test guarding the load script itself, so a broken harness cannot silently report success.
- **Debounced persistence** on heavy editors, **poll skip-guards** so a slow response cannot stack up requests, and **O(1) lookups** replacing linear scans on hot dashboard paths.

The `npm run verify` command runs lint, unit tests, load contract, build, and performance budget as a single gate.

---

## 19. Security posture

Beyond authentication and authorization:

| Control | Detail |
|---|---|
| **CSP** | `default-src 'self'`, no object sources, no framing, `base-uri` and `form-action` locked to self |
| **Clickjacking** | `X-Frame-Options: DENY` plus `frame-ancestors 'none'` |
| **MIME sniffing** | `X-Content-Type-Options: nosniff` |
| **Referrer** | `strict-origin-when-cross-origin` |
| **Device access** | Camera, microphone, geolocation, payment all disabled by policy header |
| **HSTS** | One year, including subdomains — and it honours forwarded-proto so TLS terminating at a proxy does not silently drop it |
| **CSRF** | Enforced on every state-changing request |
| **Debug mode** | `AppServiceProvider` throws a hard exception at boot if debug is enabled in production. Not a warning — a refusal to start |
| **Secrets** | Only `.example` templates are tracked. Real `.env` files are never committed |
| **Spreadsheet injection** | Export writer neutralises formula-leading characters |
| **Rate limiting** | Per-endpoint, sized to each endpoint's real cost |

---

## 20. Testing strategy

Four layers, each catching what the others cannot.

| Layer | Tool | Catches |
|---|---|---|
| **Frontend unit** | Vitest + Testing Library | Pure logic — date maths, metrics, selectors, cache behaviour, poll timing |
| **Backend feature** | PHPUnit with database refresh | Real endpoints called as real roles; 50 test files |
| **End-to-end** | Playwright | 28 suites in a real browser |
| **Accessibility** | axe-core in Playwright | WCAG violations on rendered pages |

The end-to-end suites are notable for what they cover beyond happy paths: `object-authorization`, `admin-boundary`, `account-enumeration`, `permissions`, `notification-access`, `security-smoke`, `rate-limiting`, `responsive`, `touch-target-check`, and `out-of-window-report`.

A test-only rate-limit flush endpoint exists so the suite can reset the shared throttle bucket between specs. It is registered **only in the local environment** and does not exist in production or testing builds.

The backend can also be run against MariaDB rather than SQLite via a dedicated Docker path, so database-specific behaviour is verified against what production actually runs.

---

## 21. Deployment and operations

Production is **one on-premises Ubuntu server on the hospital LAN**. No cloud, appropriate for patient-adjacent data and for a hospital network that may not have reliable external connectivity.

### The release process

Atomic and reversible:

1. Take an exclusive lock, so two deploys cannot interleave.
2. Fast-forward the source checkout; derive a release ID from timestamp plus git revision.
3. Build an **immutable release** in a new directory via `git archive` — never by mutating the live checkout.
4. Symlink shared state (environment file, storage) into the release.
5. Install dependencies without dev packages, **dry-run the migrations** to prove they parse and apply.
6. Run the **full verification suite** against the release: lint, tests, build, performance budget.
7. Take a database backup and **verify its integrity** — it actually tests the gzip archive rather than assuming the file is good.
8. Enter maintenance mode, run migrations.
9. **Flip a symlink.** The switch itself is instantaneous.
10. Check the auth wall responds and run `app:launch-readiness --strict`.
11. Keep the last five releases for rollback.

**Any failure triggers automatic rollback** via an error trap that restores the previous release and exits maintenance mode.

### Launch readiness

A dedicated command verifies, before anyone is let in: production environment sanity, database connectivity, queue worker liveness, mail and SMS configuration, performance thresholds, **same-origin cookie settings**, operational attestations, on-premises host expectations, and **TLS certificate validity and expiry**.

### Host configuration is versioned

Nginx config, PHP-FPM tuning, two systemd queue-worker units, logrotate rules, firewall script, and the backup script all live in `deploy/` next to the code. The server's configuration is reviewable and reproducible, not folklore in someone's shell history.

### Docker

Present for local MariaDB-parity testing and audit runs. **Not the production deployment path.**

### Preview hosting

`wrangler.toml` and `public/_redirects` are retained only for non-production preview builds. They have no role in the hospital deployment.

---

## 22. Engineering principles that recur

Reading the codebase, the same handful of ideas appear repeatedly. They are worth naming because they explain most of the specific decisions above.

**1. Fail loudly rather than degrade silently.** Debug mode in production throws at boot. A dead scheduler shows as a stale heartbeat. A failed deploy rolls back rather than half-applying.

**2. Snapshot anything a later edit could rewrite.** Morning session start times, attendance rosters, evaluation form versions. History should record what was true then, not what is true now.

**3. Make the correct thing structural.** Database triggers rather than remembering to fire an event. Content-stamped cache keys rather than remembering to invalidate. Uniqueness constraints rather than trusting application checks.

**4. Server-side truth, client-side convenience.** Every validation exists twice — once in the browser for speed, once on the server for correctness. Only one of them is trusted.

**5. Configurable where the department will need to change it; locked where changing it would corrupt history.** Field labels, thresholds, critical-event lists, and academic calendars are all editable. Field keys, types, and core scoring inputs are not.

**6. One guarded path per operation.** Live submission and spreadsheet import both funnel through the same submission service. There is no second entry point with weaker rules.

**7. Comment the *why*, not the *what*.** The codebase is unusually well annotated at decision points — throttle sizes, cache lock behaviour, timezone choices, and the same-origin constraint all carry an explanation of the reasoning and the failure mode that motivated it.

---

## 23. Audit observations

Honest findings from this pass.

### Repository hygiene

Roughly 25 large audit and report markdown files sit in the project root, alongside stray artifacts:

- `deploy;C` and `nginx.conf;C` — accidental shell-redirection artifacts that should be deleted
- A 6 MB `.pptx`, `files.zip`, and a `files/` directory
- Multiple stale build outputs (`dist-fperf-audit`, `output`, `test-results`, `playwright-report`)
- `.codex-temp`

None of this affects the running product, but it makes the repository hard for a newcomer to navigate and makes the root directory a poor index of what matters. **Recommendation:** move historical audits to `docs/archive/`, delete the artifacts, and extend `.gitignore`.

### Dual state layers

`AppDataContext` and TanStack Query both hold server-derived data. The split is intentional and documented, but it is the most likely place for a new developer to be uncertain about where a given piece of data comes from, or to fetch something twice. Worth a short written convention: *context owns the workspace snapshot; Query owns everything page-scoped.*

### EAV is a permanent tax

Configurable fields without migrations is a genuine product win — it is why the department can adapt the instrument itself. But it means every analytics query is structurally more expensive than it would be with fixed columns. The SQL-aggregation rule, content-stamp caching, lock-on-build, and background warming are not performance polish; they are the price of that flexibility and must not be removed.

### The revision counter is coarse

Any write anywhere bumps the global version, so all connected clients refetch. Correct and safe, and appropriate at current scale. At significantly higher concurrency, per-workspace or per-domain counters would be the natural next step.

### Documentation drift

`docs/ARCHITECTURE.md` (1,120 lines) is detailed and largely accurate but predates parts of the V2 academic expansion — its repository layout section does not list the academic pages, services, or morning/teaching modules. It should either be updated or explicitly marked as describing the V1 clinical core.

### Uncommitted work

Three academic evaluation files are modified on `fix/mobile-touch-targets` and not committed:

- `src/components/academic/evaluation-form-renderer.tsx`
- `src/pages/academic/academic-home-page.tsx`
- `src/pages/academic/evaluation-form-page.tsx`

### What is strongest

The **security and authorization architecture** is the best-engineered part of this system: three independent layers, entirely server-enforced, with dedicated end-to-end tests that call the API as the wrong user and prove the boundaries hold. For a platform holding hospital operational data, that is precisely the thing to have gotten right.

Close behind it: the **failure-mode thinking** visible throughout — automatic deploy rollback, verified backups, scheduler heartbeat, dead-lettered offline saves, self-healing schedule locks, and stale-notification reconciliation. These are the concerns that separate a system that works on a good day from one that works on a bad one.
