# Performance, Scalability, and Navigation Latency Audit

Audit date: 2026-07-28  
Audited revision: `3c9a412`  
Application: St Paul's Weekly Hospital Reporting / Department Management System, including academic operations  
Production target: one on-premises Ubuntu host on the hospital LAN, with Nginx, PHP 8.3 FPM, Laravel, MariaDB, and a queue worker  
Working peak assumption: 200 concurrent users, inferred from `docs/LOAD_TESTING.md:22-37`; the prompt's concurrency placeholder was not filled in and this assumption needs owner confirmation

## Executive summary

| Pillar | Grade | Plain-language conclusion |
|---|---:|---|
| Performance | B- | Normal, bounded, warm requests are generally acceptable. Default workspace hydration is already 235 KB and about 316 ms p95 locally. Cold academic analytics and all-history clinical analytics are materially heavier. |
| Scalability | C | The bounded clinical dashboard query shape is sound, but several academic/admin reads grow linearly, the default workspace over-fetches, only one queue worker is configured, and the real PHP-FPM/MariaDB peak has not been tested. |
| Navigation latency | B- | Settled client-side navigation is usually fast. The initial admin dashboard can block an immediate click for about 1.36 seconds p95, academic dashboard readiness is about 598 ms p95, and mobile login LCP misses the 2.5-second target at 3.17 seconds. |

No Critical defect was proven at the current data volume. The most important findings are:

1. **Cold academic dashboard fan-out is the largest backend hotspot.** The frontend requests summary, trend, and people separately (`src/pages/admin/academic-dashboard-page.tsx:278-350`). Each cold request independently hydrates essentially the same evaluation graph (`backend/app/Services/Academic/AcademicAnalyticsService.php:258-283`). The three requests took 881 ms, 1,323 ms, and 981 ms and allocated about 30 MB each: approximately 3.18 worker-seconds and 90 MB of allocation for one cold page view.
2. **History-wide reads scale linearly.** The clinical all-time dashboard took 2.19 seconds, made 27 queries, spent 895 ms in SQLite, and returned 1.04 MB. `reportPeriodWindow=all` workspace hydration took 1.11 seconds and returned 1.83 MB. The normal UI uses a bounded period window, but these routes remain reachable.
3. **The default workspace response is already above the payload budget.** It returned 234,840 bytes with 26 queries. It includes up to 10,000 reports (`backend/app/Http/Controllers/Api/WorkspaceController.php:146-158`) and all reporting periods (`:131`).
4. **The production-build admin dashboard delays early interaction.** An immediate click to Submissions was 1,217 ms p50 / 1,358 ms p95. Waiting 1.5 seconds for dashboard startup reduced the same transition to 212 ms / 238 ms. This points to startup chart/render work, not a slow Submissions route.
5. **The 200-user production target is not validated.** The local `php artisan serve` smoke exceeded the 2-second p95 threshold at 25 virtual users and timed out 75.6% of recorded requests at 200 virtual users. That server is single-listener development infrastructure, not the committed 20-worker PHP-FPM pool, so the production breaking point remains unknown.

The measured **local development breaking point is 25 concurrent virtual users / about 5.7 completed requests per second**, where endpoint p95 rose to 4.1-4.9 seconds. This is not a production capacity claim. A production-like 200-user, 10-minute test is a release gate, not optional follow-up.

## Scope, method, and limits

The audit did not change application source, schema, or business records. It built production frontend assets, issued authenticated read requests, called service/controller methods under query logging, and ran the repository's read-heavy load harness. Local session, cache, queue, and rate-limit tables naturally received transient writes. Raw local load outputs are in `output/playwright/load-*.json`.

Measurements were made on Windows, PHP 8.4.19 CLI, Node 24.14, an Intel i9-14900HX (24 cores/32 threads), 31.8 GB RAM, SQLite, Vite preview/dev servers, and `php artisan serve`. The production code targets PHP 8.3, MariaDB, Nginx, and PHP-FPM. Consequently:

- Browser production-build and bundle measurements are representative of shipped frontend code.
- Query shape, payload, allocation, and relative cold/warm comparisons are useful.
- Absolute database latency, CPU/RAM saturation, MariaDB connections, PHP-FPM queue depth, and the real breaking point are **not** production measurements.
- Warm API p50/p95 values use 20 authenticated samples per route. Controlled cold figures are single cold builds or concurrent cold process measurements, not 20 cold HTTP samples.
- Lab Lighthouse cannot provide real-user INP. The Playwright click-to-ready measurements are interaction proxies.
- No business form was submitted because the audit was read-oriented. Login POST was measured; write-workflow latency still needs staging coverage.
- A React DevTools Profiler trace was not available. Browser main-thread symptoms, production TBT, bundle boundaries, and source-level render inspection were used instead.

## System map

`php artisan route:list --json` reports 184 routes. Counts below describe route families and can overlap where an academic route is also an undergraduate-operation route.

| Route family | Count | Controllers/services | Primary models/tables | Frontend consumers |
|---|---:|---|---|---|
| Auth and public registration | 10 | `AuthController`, `PasswordResetController`, registration/access-request controllers, Sanctum CSRF | `users`, `sessions`, `password_reset_tokens`, `access_requests`, `admin_access_requests`, `notifications` | auth pages, access request page |
| Workspace/bootstrap | 4 | `WorkspaceController`, `WorkspaceRevisionService` | users, roles, templates, fields, departments, periods, assignments, reports, notifications, academic reference/operations tables | `app-data-context.tsx`, protected shell |
| Clinical reports/comments/import | 13 | `ReportWorkflowController`, `ReportCommentController`, `ReportImportController` | reports, report assignments, field values, calculated metrics, status history, comments, audit logs | report selection/form, Submission Board, import page |
| Clinical analytics/export | 12 | `AnalyticsController`, `DashboardAnalyticsService`, `AnalyticsExportService` | reports, periods, departments, templates, field definitions/values, audit logs | admin dashboard, department detail |
| Academic evaluation/analytics/structure | 43 | academic analytics/evaluation controllers, operation analytics, structure/form controllers | evaluations, answers, forms/fields, users, wards, sections, duties, rotations, transfers | academic dashboard, submissions, evaluation forms, structure, roster, rotations |
| Undergraduate operations | 40 | `UndergraduateAdminController`, `TeachingSessionController`, `MorningSessionController` | students, batches, sessions, attendance, placements, rep assignments, schedules, morning sessions/attendance | students, rep log, teaching attendance, morning attendance |
| Admin configuration | 35 | users, reference data, assignments, requests, settings, audit/action-item controllers | users/roles, departments/templates/fields, assignments, settings, audit/action items | users, templates, access requests, settings, audit/action items |
| Notifications | 5 | `NotificationController` | notifications | notification page/shell |
| Downloads/uploads | 4 relevant routes | analytics export, report import/template, student paste import | streamed report/audit reads; bounded uploaded CSV/XLSX | import and analytics pages |

### Model and relationship inventory

There are 43 Eloquent model files:

- Clinical/reporting: `AccessRequest`, `AccessRequestItem`, `ActionItem`, `AdminAccessRequest`, `AdminAuditLog`, `AppSetting`, `AuditLog`, `CalculatedMetric`, `Department`, `Notification`, `Report`, `ReportAssignment`, `ReportComment`, `ReportFieldDefinition`, `ReportFieldValue`, `ReportingPeriod`, `ReportStatusHistory`, `ReportTemplate`, `Role`, `User`.
- Academic/evaluation: `ConsultantEvaluation`, `ResidentEvaluation`, `Evaluation`, `EvaluationAnswer`, `EvaluationForm`, `EvaluationFormField`, `DutyAssignment`, `DutyType`, `RotationBlock`, `RotationCalendar`, `Section`, `TransferRequest`, `Ward`.
- Undergraduate/morning: `MorningAttendance`, `MorningRosterOverride`, `MorningSession`, `RepAssignment`, `Student`, `StudentAttendance`, `StudentBatch`, `SubgroupPlacement`, `TeachingActivitySchedule`, `TeachingSession`.

No polymorphic/morph relationship was found. Potentially unbounded `hasMany` collections include:

- `Department`: assignments, access-request items, reports.
- `Report`: field values, status history, audit logs/comments.
- `ReportTemplate`: fields, departments, assignments, reports.
- `ReportingPeriod`: reports.
- `EvaluationForm`: evaluations; `Evaluation`: answers.
- `Student`: attendance/evaluations; `StudentBatch`: students, placements, reps, sessions.
- `MorningSession` and `TeachingSession`: attendance.
- `User`: assignments, requests, notifications, duty assignments.

The existence of a `hasMany` is not itself a defect. The risk appears where controllers/services call `get()` without a date range, limit, or paginator; those cases are enumerated below.

### Middleware and request-wide work

The configured stack is visible at `backend/bootstrap/app.php:24-57`:

- `SecurityHeaders` is globally appended and performs no database work.
- Sanctum stateful middleware and `auth:sanctum` resolve the session/user. With `SESSION_DRIVER=database`, authenticated requests incur database session access.
- `EnsureActiveUser`, `EnsurePasswordChanged`, `EnsurePermission`, and `EnsureRole` inspect the already-resolved user; no additional per-request query was found in these custom middleware classes.
- The authenticated API group has a 300 requests/minute per-user limiter (`backend/routes/api.php:81-84`), backed by the configured cache store.

The 60-second workspace revision poll (`src/context/app-data-context.tsx:1145-1199`) deliberately avoids rebuilding the workspace when nothing changed. It still executes a union of table freshness aggregates on every poll.

### Jobs, schedules, and listeners

Queued jobs:

- `WarmDashboardAnalytics`: unique-until-processing, two attempts, 90-second timeout, `[15, 60]` backoff.
- `SendNotificationDelivery`: three attempts, 30-second timeout, `[60, 300, 900]` backoff; channel failures are isolated.
- Password-reset mail implements `ShouldQueue`.

No synchronous domain event listener that performs heavy work on a user request was found. Dispatches inspected are queued after commit.

The scheduler runs report/period generation and reminder commands, operational cleanup, weekly digests, failed-job pruning, and a per-minute queue drain when daemon mode is disabled. The production service config has one always-on database-queue worker (`deploy/queue-worker.service:2-25`).

### Pre-measurement suspicion list and outcome

| Rank | Suspected hotspot | Why it looked risky | Measurement outcome |
|---:|---|---|---|
| 1 | Workspace bootstrap | Many collections and optional history in one response | Confirmed: 235 KB default; 1.83 MB all-history |
| 2 | Academic evaluation analytics | Three endpoints call the same row-hydration method | Confirmed: about 3.18 cold worker-seconds / 90 MB allocation |
| 3 | Clinical all-time analytics | Archive-wide aggregate over fastest-growing field-values table | Confirmed: 2.19 s / 1.04 MB; normal eight-week query is healthy |
| 4 | Academic student analytics | All attendance and all student evaluations are loaded | Confirmed: 828 ms cold / 30 MB allocation |
| 5 | Large admin rosters | Users/students/assignments use unpaginated `get()` | Confirmed structurally; current row counts are still small |
| 6 | Dashboard client render | Recharts and several dashboard sections | Confirmed as early-click blocking; settled navigation is fast |
| 7 | Revision polling | Count/max scan across many tables every minute | Confirmed full scans, currently only 15.8 ms |
| 8 | Database cache/session/queue | Extra DB traffic and a single shared contention point | Confirmed configuration risk; not saturated in local baseline |
| 9 | Spreadsheet import/export | Potential worker-memory/file-size risk | Mostly refuted: limits and streaming are implemented |
| 10 | Frontend bundle | React, charts, motion, icons, date helpers | Controlled by splitting, but gzip budget has only 24.8 KB headroom |

## Findings register

| ID | Pillar | Severity | Evidence | User-facing impact | Concrete fix | Effort |
|---|---|---|---|---|---|---:|
| PERF-01 | Backend | High | Cold academic summary/trend/people: 881/1,323/981 ms, 19/13/13 queries, ~30 MB allocation each. All call `rows()` at `AcademicAnalyticsService.php:258-283`; frontend fans out at `academic-dashboard-page.tsx:278-350`. | A cold dashboard occupies three PHP workers and may delay every user behind them during cache expiry or a write burst. | Build one cached aggregate snapshot per filter set and return summary/trend/people from one endpoint or one shared materialization. Warm it after evaluation writes. | M |
| PERF-02 | Backend | High | Clinical all-time build: 2,192 ms, 27 queries, 895 ms DB time, 1,041,990-byte payload, 26 MB peak. Normal eight-week build: 189 ms / 81 KB. | Archive/all-time views become multi-second and consume a worker for the duration. | Require bounded dates in interactive endpoints; move all-time export to a queued/streamed job; optionally maintain weekly aggregate tables. | M |
| PERF-03 | Backend/payload | High | Default workspace: 26 queries, 286 ms cold, 234,840 bytes; all-history: 1,829,533 bytes. It loads all periods and permits up to 10,000 reports (`WorkspaceController.php:131-158`). | Initial login and refresh transfer/process more data than most pages need; growth is linear. | Make workspace identity/reference-only. Fetch paginated reports/history per page; send only the latest period window and compact profile fields. Set a <200 KB contract test. | L |
| PERF-04 | Database | Medium | Workspace revision is a 2,473-character `UNION ALL` over count/max aggregates. SQLite plan has 130 steps with full scans/temp B-trees; 15.8 ms now. Poll interval is 60 seconds (`app-data-context.tsx:1199`). | Many idle admin tabs produce database work proportional to table sizes. | Maintain a single workspace revision/version row transactionally on relevant writes, or cache a global revision and invalidate it. Add jitter/backoff to polling. | M |
| PERF-05 | Database | Medium | `student_attendance GROUP BY student_id` scans the covering `(teaching_session_id, student_id)` index and uses a temporary B-tree. Query is at `AcademicOperationsAnalyticsService.php:250-253`; table has 9,925 rows. | Student analytics grows linearly and adds sort/temp work as attendance accumulates. | Validate on MariaDB, then add `ALTER TABLE student_attendance ADD INDEX student_attendance_student_present_index (student_id, present);`. Re-run `EXPLAIN ANALYZE`; remove it if MariaDB does not choose it. | S |
| PERF-06 | Caching | Medium | Example/local defaults are `SESSION_DRIVER=database`, `CACHE_STORE=database`, `QUEUE_CONNECTION=database` (`backend/.env.example:48,70,91`). Redis is only a deployment recommendation (`deploy/README.md:83-87`). | Sessions, rate limits, cached analytics, and jobs compete with application queries; cache invalidations write to the primary DB. | Use Redis for cache/session/queue before the 200-user test. Keep DB drivers only as a documented small-install fallback. | S |
| NAV-01 | Navigation | High | Immediate Dashboard→Submissions: 1,217 ms p50 / 1,358 ms p95. After a 1.5-second settle: 212/238 ms. Authenticated production build had 149 ms TBT. | A user who clicks while the dashboard is starting perceives a frozen navigation. | Defer below-fold charts, yield between dashboard sections, memoize derived series, and render charts only when visible. Capture a React Profiler/main-thread trace to verify. | M |
| NAV-02 | Web Vitals | Medium | Production login Lighthouse mobile: LCP 3,166 ms and FCP 2,710 ms; desktop LCP 692 ms. | Users on modest devices/links wait beyond the 2.5-second “good” LCP threshold. | Inline/trim critical login CSS, audit the 121 KB proxy/vendor chunk, preload only the tiny logo if it is the LCP element, and add mobile Lighthouse CI. | S |
| NAV-03 | Navigation/backend | Medium | Academic dashboard starts summary and trend together and people separately; each cold endpoint hydrates the same graph. Interactive readiness was 492 ms p50 / 598 ms p95 while warm. | Warm use is acceptable, but cache misses create an avoidable request/worker waterfall. | Collapse the three reads into one aggregate endpoint or share a single backend snapshot/cache payload. | M |
| NAV-04 | Bundle | Medium | Initial graph is 835,853 raw / 241,424 gzip bytes and 26 requests against budgets of 900 KB / 260 KB / 32 (`check-performance-budget.mjs:27-51`). Only 24.8 KB gzip headroom remains. | A modest new initial dependency can regress mobile load abruptly. | Tighten ownership of the initial graph; keep Recharts route-only; inspect the 121 KB `proxy` chunk; fail CI on per-chunk as well as total growth. | S |
| SCALE-01 | Load/capacity | High | Local 25-VU smoke: p95 4.1-4.9 s at 5.7 RPS. Local 200-VU burst: 75.6% failures/timeouts, 197 successful records, 15 s p95 ceiling. `docs/LOAD_TESTING.md:72` correctly says artisan serve is not production-like. | The promised 200-user capacity is unknown; a release could saturate FPM/DB without warning. | Run 200 distinct-user-equivalent sessions for 10 minutes on Nginx+FPM+MariaDB+Redis with CPU/RAM, FPM status, DB connections, slow log, and queue depth. Treat stated pass targets as a release gate. | M |
| SCALE-02 | Data scaling | High | Unpaginated endpoints include users (`Admin/UserController.php:27-73`), report assignments (`ReportAssignmentController.php:28-61`), students (`UndergraduateAdminController.php:163-176`), and workspace profiles (`WorkspaceController.php:93,134-135`). Teaching analytics loads every session (`AcademicOperationsAnalyticsService.php:129-140`). | Admin pages and analytics eventually return thousands of models and large DOMs, increasing DB, PHP, JSON, and render cost together. | Add cursor/page pagination and server-side filters. Bound teaching analytics by academic year/date. Virtualize tables only after the API is paginated. | L |
| SCALE-03 | Queue | Medium | Exactly one worker is committed; service runs `queue:work --tries=3 --backoff=10 --max-time=3600` (`queue-worker.service:24`). | Slow mail/SMS or analytics warms can delay unrelated jobs; worker loss stops all asynchronous work until restart. | Use named queues (`notifications`, `analytics`, `default`) and at least two supervised workers if host memory allows. Alert on oldest-job age and failed jobs. | M |
| SCALE-04 | Operations | High | No committed MariaDB server config, slow-query-log policy, buffer-pool sizing, or OPcache production config was found. FPM exposes status/slowlog but no monitoring integration (`deploy/php-fpm.conf:16-31`). | The team cannot prove why a real host slows down or size workers safely; performance regression detection begins after users complain. | Record target hardware; set/verify OPcache; size `innodb_buffer_pool_size`, `max_connections`, and FPM from measured RSS; enable slow log; scrape FPM and DB metrics. | M |
| SCALE-05 | Test tooling | Medium | Documentation says default `LOAD_USERS=200` (`docs/LOAD_TESTING.md:22-27`), while code defaults to 8 (`scripts/load-test.mjs:14`). The script shares a small set of sessions (`docs/LOAD_TESTING.md:50`) under a per-user 300/min limiter. | Results can be mislabeled and high-VU runs can test account throttling/session contention rather than independent users. | Align docs/code; require enough staged accounts or a documented per-account request model; report successful RPS separately from attempted/timeouts. | S |
| SCALE-06 | Retention | Medium | Reporting data is retained indefinitely; `report_field_values` is already 249,554 rows. Operational/audit pruning exists, but no report archive/partition policy was found. | Three years is manageable, but all-time analytics and backups continue to grow linearly; a long-lived installation accumulates avoidable hot-table data. | Define retention and archive rules by legal/clinical need. Keep recent periods hot; export/archive immutable old report facts or maintain rollups. | M |
| SCALE-07 | FPM sizing | Medium | Pool is fixed initially at 20 children and 256 MB/worker (`deploy/php-fpm.conf:16-31`). Measured heavy cold workers peaked around 38-40 MB locally, but production RSS is unknown. | Twenty workers may be too many for a small host or too few for a cold three-request dashboard fan-out. | Measure p95 worker RSS and DB connection use during staging load. Set `max_children = floor(PHP RAM budget / p95 RSS)` below the DB connection budget. | S |

## Backend measurements and analysis

### Seed/data shape

The local SQLite file was 124.2 MB after the audit's transient cache/session writes. Important row counts:

| Table | Rows | Domain coverage where available |
|---|---:|---|
| reporting_periods | 131 | 2024-07-29 to 2027-01-25 |
| reports | 2,939 | linked to the 131 reporting periods |
| report_field_values | 249,554 | linked to reports |
| audit_logs | 1,080 | current seed |
| evaluations | 3,720 | 2025-07-15 to 2026-07-27 |
| evaluation_answers | 35,060 | current seed |
| teaching_sessions | 413 | 2025-11-17 to 2026-08-03 |
| student_attendance | 9,925 | 2025-11-17 to 2026-07-24 |
| morning_sessions | 167 | 2025-07-02 to 2026-07-24 |
| morning_attendance | 23,380 | current seed |
| duty_assignments | 2,100 | current seed |
| users / students | 184 / 200 | current seed |

### Cold query/build measurements

These measurements enabled Laravel's query log and called the relevant controller/service build in a fresh CLI process. “Allocation” is the increase in PHP allocated memory; “peak” is process peak. Cached endpoint figures were measured after clearing the relevant cache or by invoking the uncached private builder.

| Page/operation | Cold ms | Queries | DB ms | Slowest query ms | JSON bytes | Allocation MB | Peak MB |
|---|---:|---:|---:|---:|---:|---:|---:|
| Clinical dashboard, all time | 2,192.46 | 27 | 895.22 | 64.72 | 1,041,990 | 16 | 26 |
| Academic trend | 1,323.05 | 13 | 74.31 | 45.21 | 1,022 | 30 | 38 |
| Workspace, all periods/history window | 1,107.32 | 26 | 50.39 | 21.99 | 1,829,533 | 14 | 26 |
| Academic people | 980.58 | 13 | 58.76 | 39.79 | 17,151 | 30 | 38 |
| Academic summary | 881.08 | 19 | 67.58 | 42.04 | 633 | 30 | 38 |
| Undergraduate student analytics | 828.16 | 12 | 166.23 | 115.33 | 119,285 | 30 | 40 |
| Workspace, default nine-period window | 286.46 | 26 | 28.43 | 13.86 | 234,840 | 4 | 12 |
| Clinical dashboard, eight weeks | 189.18 | 13 | 79.43 | 33.90 | 81,057 | 2 | 10 |
| Undergraduate teaching analytics | 120.83 | 8 | 3.13 | 1.48 | 30,258 | <2 | 10 |
| Morning analytics | 59.00 | 7 | 37.82 | 18.51 | 25,612 | 2 | 10 |
| Paginated reports, 25 rows | 36.20 | 6 | 7.76 | 5.50 | 16,648 | not isolated | 10 |
| Workspace revision | 15.80 | 1 union | 14.47 | 14.47 | 79 over HTTP | <2 | not isolated |

The warm student-analytics build fell from 828 ms to 17.7 ms, confirming that the five-minute content-stamped cache is effective. It does not remove cache-stamp scans or cold-miss worker pressure.

### Warm authenticated HTTP timings

Twenty sequential samples per route through the local Laravel HTTP server:

| Route | Bytes | TTFB p50 ms | TTFB p95 ms | Total p50 ms | Total p95 ms | TTFB target |
|---|---:|---:|---:|---:|---:|---|
| `/api/workspace` default | 234,840 | 269.7 | 315.9 | 283.8 | 327.3 | Pass |
| `/api/workspace/revision` | 79 | 68.7 | 76.2 | 79.1 | 85.1 | Pass |
| `/api/analytics/dashboard` eight weeks | 81,057 | 63.0 | 76.5 | 74.4 | 86.0 | Pass |
| `/api/academic/analytics/summary` | 633 | 66.0 | 77.5 | 75.9 | 86.9 | Pass |
| `/api/academic/analytics/trend` | 1,022 | 64.5 | 74.0 | 72.7 | 86.7 | Pass |
| `/api/academic/analytics/people` | 17,151 | 63.9 | 77.4 | 74.8 | 86.0 | Pass |
| `/api/academic/operations/students` | 119,285 | 70.6 | 75.9 | 79.6 | 84.6 | Pass |
| `/api/academic/operations/morning` | 25,612 | 67.6 | 77.4 | 76.5 | 86.2 | Pass |
| `/api/academic/operations/teaching` | 30,258 | 62.8 | 74.1 | 72.4 | 84.0 | Pass |
| `/api/reports?perPage=25` | 16,545 | 98.1 | 108.9 | 107.0 | 116.8 | Pass |

These are warm, sequential, local values. Under the 25-VU smoke, the same development server's queuing delay dominated and raised p95 into seconds.

### Slow-query plans and index audit

| Query/plan | Evidence | Conclusion |
|---|---|---|
| All-time field-value aggregate | Repeated 63-65 ms chunk aggregates join `report_field_values` to field definitions and group by report/field. The actual composite unique index starts with `report_id`. | Not a missing-index proof; the route asks the database to aggregate a very large history. Bound the range/materialize aggregates. |
| Student attendance by student | `SCAN student_attendance USING ... (teaching_session_id, student_id)` plus `USE TEMP B-TREE FOR GROUP BY`. | Test the recommended `(student_id, present)` index on MariaDB. |
| Student evaluations | Uses `evaluations_form_key_evaluation_date_index`; an `IN` filter still produces a temporary order step in SQLite. | Existing hot filter is indexed. Do not add another index without MariaDB `EXPLAIN ANALYZE`. |
| Evaluation answers | The `(evaluation_id, field_key)` unique index supplies the eager-load `WHERE evaluation_id IN (...)`. A warmed reproduction was 32.8 ms for about 1,900 bindings. | The first 115 ms observation was cold I/O/large hydration, not an unindexed lookup. |
| Workspace revision | 130 SQLite plan rows, several table scans/temp B-trees across reports, assignments, attendance, duties, and other workspace tables. | Replace polling aggregates with a revision ledger rather than adding many low-value indexes. |

No proven redundant hot index was found in the actual SQLite schema. In particular, the redundant non-unique report-field-value prefix index has already been removed; the unique `(report_id, field_definition_id, day_name)` index covers that prefix. MariaDB index decisions must be based on its own plans and cardinalities.

### N+1 and query-shape review

No active N+1 pattern was reproduced in the measured heavy reads:

- Admin users eager-load assignment department/template/nurse/approver before mapping.
- Report assignments eager-load nurse/department/template/approver.
- Academic evaluation rows eager-load subject/home ward, answers, and form fields.
- Student analytics eager-load answers and batches.
- Clinical analytics aggregates field values in SQL chunks rather than hydrating a relation per report.

`backend/tests/Feature/AnalyticsQueryShapeTest.php:30-105` already asserts that field values are not relationship-hydrated and that archive query count stays flat. `ReportWorkflowTest.php:139-153` has bounded query-count assertions for report persistence. Keep and extend these tests. The dominant defects are unbounded result size and duplicated cold hydration, not per-row query multiplication.

### Pagination and unbounded reads

Needs pagination or an explicit small-domain guarantee:

- Admin users: all matching users and assignments.
- Admin report assignments: all matching assignments.
- Admin students: all matching students.
- Workspace profiles: every user for admins.
- Workspace reporting periods: every period; reports allow 10,000 rows.
- Academic teaching analytics: all historical teaching sessions.
- Academic student analytics: all student attendance and all weekly/final evaluations.
- Access-request/admin-access-request indexes use `get()`, although present counts are tiny.

Already bounded:

- Report workflow index uses Laravel pagination.
- Admin academic evaluation index and action items use pagination.
- Placements limit 200; teaching-session admin list limits 300.
- Morning analytics uses the latest 60 sessions and limits people to 200.
- Notifications are limited.
- Workspace “all” is capped at 104 periods by `ReportPeriodWindow`, preventing an actually infinite response but still producing 1.83 MB in this seed.

### Caching and runtime configuration

Good:

- Academic/operations analytics use a five-minute content-stamped cache.
- Dashboard caches can be warmed asynchronously and the warm job is unique.
- Frontend uses a compact workspace revision endpoint before rehydrating.
- Laravel deployment flow supports config/route/view caching.

Risks:

- Every content stamp performs count/max work before cache lookup.
- Database cache/session/queue cause extra primary-database reads/writes.
- OPcache settings are not committed or verified.
- No production MariaDB configuration/metrics were available.
- Cache TTLs are time-based but writes also dispatch warm/invalidation behavior; this is directionally sound.

### Uploads, downloads, and memory

The earlier suspicion of an unbounded spreadsheet reader was not confirmed:

- HTTP upload is limited to 10 MB (`ReportImportController.php:65`); Nginx allows 20 MB.
- CSV and XLSX parsing cap 25,000 rows, 256 columns, and 65,536 bytes/cell.
- XLSX uncompressed content is capped at 48 MB (`XlsxReader.php:23-29,154-223`), with XML entity protections.
- CSV analytics export streams through `php://output`; large reads use database cursors (`AnalyticsExportService.php:143-150,250,369,744-810`).

No measured request exceeded the 64 MB flag threshold. The heaviest measured peak was 40 MB. Three parallel cold academic requests nevertheless allocate about 90 MB in aggregate and occupy three FPM workers.

## Frontend and navigation analysis

### Production bundle

The production build transformed 3,355 modules. React, date-fns, Framer Motion, Recharts, and Lucide resolve to single installed versions; no duplicate React/runtime copy was found.

| Asset/chunk | Raw KB | Gzip KB | Initial? |
|---|---:|---:|---|
| Initial graph total | 816.3 | 235.8 | Yes, 26 requests |
| `CartesianChart` | 327.8 | 98.8 | No, chart routes |
| main `index` | 252.9 | 81.1 | Yes |
| `proxy` | 117.9 | 39.2 | Initial/shared |
| global CSS | 134.3 | 25.5 | Yes |
| admin dashboard | 75.0 | 19.7 | Route |
| schemas | 65.1 | 18.0 | Shared/route dependent |
| select | 57.6 | 18.4 | Shared/route dependent |
| app data context | 53.6 | 16.1 | Authenticated shell |
| academic dashboard | 30.5 | 9.9 | Route |
| user management | 20.9 | 5.2 | Route |
| audit log | 15.7 | 4.9 | Route |
| settings | 10.8 | 3.3 | Route |
| submission board | 3.8 | 1.7 | Route |

All page components are lazy-loaded (`src/App.tsx:16-198`). Navigation prefetch uses the same dynamic imports on hover/focus/pointer-down (`src/routes/route-prefetch.ts:7-55`, `src/components/layout/app-shell.tsx:92-93`). Recharts is excluded from the initial module-preload graph and the existing budget test rejects initial Recharts/dev-lab code.

The UI uses local system fonts (Aptos/Segoe fallbacks), so there is no font network waterfall. The logo JPEG is about 14.8 KB and public icon assets are small. Missing `loading` attributes on the above-fold logo do not materially affect this application.

### Core Web Vitals/lab metrics

| Page/run | Network/device | TTFB ms | FCP ms | LCP ms | TBT ms | CLS | INP | Result |
|---|---|---:|---:|---:|---:|---:|---|---|
| Login, production build | Desktop Lighthouse | 3 | 636 | 692 | 0 | 0 | unavailable | Pass |
| Login, production build | Simulated slow 4G / mid-tier mobile | 3 | 2,710 | 3,166 | 97 | 0 | unavailable | **Fail LCP** |
| Authenticated admin startup | Unthrottled production browser | 5 | 492 | 780 | 149 | 0.0008 | click proxy below | Pass lab thresholds |

Lighthouse performance scores were 100 desktop and 88 mobile for login. The authenticated measurement covered the initial admin shell/dashboard rather than a clean Lighthouse run per protected route. Real-user INP must be added through RUM; it cannot be inferred from TBT alone.

### Click-to-ready navigation timings

Ten production-build runs per transition:

| Transition | Ready condition | p50 ms | p95 ms | Assessment |
|---|---|---:|---:|---|
| Admin dashboard → Submissions, clicked immediately after shell appears | Submissions content visible | 1,217 | 1,358 | Fail interaction target; dashboard startup contention |
| Admin dashboard → Submissions, after 1.5 s settle | Submissions content visible | 212 | 238 | Slightly above 200 ms p95 |
| Admin dashboard → Users | User page content visible | 123 | 160 | Good |
| Admin dashboard → Audit | Audit content visible | 115 | 155 | Good |
| Admin dashboard → Settings | Settings content visible | 99 | 195 | Good |
| Clinical → academic workspace switch | Academic navigation visible | 185 | 208 | Borderline p95 |
| Academic navigation → dashboard interactive | Score trend visible | 492 | 598 | Needs improvement but under 1 s |

No navigation tested caused a document-level full reload; React Router client transitions were used. Loading states exist in the route/Suspense and data layers, but the early-click stall still feels blocked because main-thread work delays the transition itself.

## Scalability

### Controlled local load smoke

The repository harness models workspace revision (45%), workspace hydration (15%), report details (22%), notifications (10%), and session reads (8%). It logs in once per configured credential and shares those sessions.

| Scenario | VUs | Duration/ramp | Think time | Recorded RPS | Successful records | Error rate | Representative p95 | Outcome |
|---|---:|---|---|---:|---:|---:|---|---|
| Baseline | 10 | 45 s / 10 s | 1.5-3.0 s | 4.0 | 180 | 0% | workspace 381 ms; details 691 ms; revision 346 ms | Pass local smoke |
| Midpoint/stress | 25 | 30 s / 10 s | 0.75-1.5 s | 5.7 | 171 | 0% | workspace 4,282 ms; details 4,871 ms; revision 4,667 ms | **Breaks 2 s p95 target** |
| Peak burst, local only | 200 | 30 s / 15 s | 0.25-1.2 s | 26.9 recorded; about 6.6 successful | 197 | 75.59% | timeout ceiling about 15,012 ms | Fail; development listener saturated |

No sustained 10-minute 200-user run was performed against the development server because it would only repeat the already-proven single-listener saturation. Required production-like test:

1. Nginx + PHP-FPM using the committed pool configuration.
2. MariaDB with production indexes/statistics.
3. Redis for session/cache/queue.
4. At least enough credentials/account traffic distribution to avoid turning the test into a per-user throttle test.
5. 10 VU baseline, 200 VU for 10 minutes, incremental stress, and a deadline spike focused on workspace/report details and a safe staging copy of submission.
6. Capture host CPU/RAM/disk I/O, PHP-FPM active/idle/listen queue/max children, MariaDB active/max connections/buffer-pool hit ratio/slow queries/locks, Redis latency, and queue depth/oldest age.

Pass gates:

- overall errors <1%, no sustained 5xx;
- workspace p95 <1,000 ms and report-details p95 <1,500 ms, matching `docs/LOAD_TESTING.md:63-70`;
- ordinary API p95 <500 ms where practical;
- FPM listen queue does not grow continuously;
- DB connections remain below 80% of configured maximum;
- queue oldest-job age remains inside the notification SLA.

### One-year and three-year growth projection

The seed mixes about 2.5 years of reporting periods with about one year of academic operations, so storage extrapolation is a planning range, not a precise forecast.

| Fact type | Observed annualized increment | +1 year | +3 years |
|---|---:|---:|---:|
| Reporting periods | ~52 | 52 | 156 |
| Reports | ~1,170 | 1,170 | 3,510 |
| Report field values | ~99,000 | 99,000 | 297,000 |
| Evaluations | ~3,600 | 3,600 | 10,800 |
| Evaluation answers | ~34,000 | 34,000 | 102,000 |
| Morning attendance | ~22,000 | 22,000 | 66,000 |
| Student attendance | ~14,000 | 14,000 | 42,000 |
| Teaching sessions | ~580 | 580 | 1,740 |
| Approximate fact-row increment | ~174,000/year | ~174,000 | ~522,000 |

Planning envelope from the current 124 MB SQLite seed:

- One additional year: roughly 180-230 MB total logical database footprint.
- Three additional years: roughly 300-450 MB.
- Reserve at least 1 GB for primary data plus separate capacity for indexes, temporary tables, binary logs, backups, and restore workspace.

MariaDB row/index sizes will differ. The capacity issue in the first three years is query shape and worker contention, not raw disk. Long-term reporting history should still have an explicit retention/archive policy.

### Architectural scale and failure domains

- A second app server is mostly possible without application changes because Sanctum uses shared server-side sessions and current uploads/exports are request-scoped. Redis should replace DB cache/session/queue first.
- Only one scheduler instance should own scheduled dispatches, or Laravel's distributed overlap/one-server controls must use a shared cache.
- Queue workers can be added, but there is currently one queue and one worker.
- MariaDB and the single on-prem host remain single points of failure. A second web node does not remove DB/host failure.
- Nginx already enables HTTP/2 and gzip for JSON/JS/CSS and applies immutable caching to hashed assets (`deploy/nginx.conf:70-108,133`). Brotli is not configured; it is lower priority than payload reduction.
- FPM has slow logging at three seconds, a 60-second termination timeout, recycling after 500 requests, and a status endpoint. Those controls are good but must be monitored.

## Prioritized remediation roadmap

### Quick wins: hours

1. Align `docs/LOAD_TESTING.md` with the harness default and document the credential/per-user throttle model.
2. Add and validate the proposed `student_attendance (student_id, present)` index on a MariaDB staging copy.
3. Add payload assertions for default workspace (<200 KB target after trimming) and existing dashboard ranges.
4. Add mobile Lighthouse CI for login and the authenticated shell; keep LCP <2.5 s, CLS <0.1, TBT <200 ms.
5. Add dashboard render instrumentation (`performance.mark`) and real-user Web Vitals collection for INP/LCP.
6. Verify and record OPcache settings on the target host.

### Medium: days

1. Collapse academic summary/trend/people into one cached aggregate build/response.
2. Defer below-fold admin-dashboard charts and expensive derived calculations; profile before/after.
3. Move session/cache/queue to Redis and split queue classes.
4. Add pagination/server filtering to admin users, assignments, and students.
5. Replace workspace freshness union scans with a revision ledger/version key.
6. Instrument FPM, MariaDB, Redis, queue age/depth, and Nginx request timings.
7. Run and publish the required 200-user, 10-minute production-like test.

### Structural: weeks

1. Split workspace bootstrap into identity/reference data plus paginated page-specific APIs.
2. Require bounded interactive analytics ranges and maintain weekly/materialized rollups for archive queries.
3. Add date/academic-year bounds to teaching and student analytics; paginate people-level detail.
4. Define archive/retention and backup/restore objectives.
5. If availability requires it, separate MariaDB/Redis from the app host and document failover; otherwise explicitly accept the single-host risk.

## Regression guardrails

| Guardrail | Proposed check |
|---|---|
| Existing bundle budget | Keep `check-performance-budget.mjs`; add per-chunk limits and reduce the initial gzip warning threshold to 245 KB until the graph is trimmed. |
| Lighthouse CI | Mobile login and authenticated shell: LCP <2.5 s, CLS <0.1, TBT <200 ms; desktop as a secondary check. |
| Navigation smoke | Playwright: dashboard→users/settings p95 <200 ms; settled dashboard→submissions <250 ms; early-click transition <400 ms after render work is fixed. |
| Query shape | Preserve `AnalyticsQueryShapeTest`; add max-query assertions for workspace, academic snapshot, and student analytics. |
| Payload contracts | Default workspace <200 KB, eight-week dashboard <100 KB, list endpoints fixed page size. |
| Load CI/staging | Small CI smoke at 10 VUs; scheduled/staging 200-VU 10-minute gate with distinct-user traffic and host telemetry. |
| Slow-query monitoring | Enable MariaDB slow log with a low staging threshold (50-100 ms) and an appropriate production threshold; review top normalized queries weekly. |
| FPM/queue alerts | Alert on non-zero sustained FPM listen queue, max-children events, queue oldest age, failed jobs, and restart loops. |
| RUM | Record LCP, INP, CLS, route transition duration, route name, device class, and release SHA without patient/report contents. |
| Data-growth review | Quarterly row/index-size report for field values, evaluations/answers, attendance, audit logs, jobs, and sessions. |

## Final disposition

The application has a stronger baseline than a typical unoptimized SPA/API: route-level splitting, prefetching, bounded clinical query counts, streaming exports, hardened imports, cache warming, gzip/HTTP/2, and useful FPM controls are already present.

It is not yet defensible to claim 200-user readiness. The next release should be blocked on the academic aggregate consolidation or an equivalent cold-miss mitigation, workspace payload reduction, and a production-like instrumented load test. The local numbers prove the development listener is unsuitable for capacity validation; they do not absolve the production stack from being measured.
