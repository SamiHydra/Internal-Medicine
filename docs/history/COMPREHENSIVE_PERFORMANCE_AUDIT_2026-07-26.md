# Comprehensive System Performance Audit

**System:** St Paul's Hospital Internal Medicine reporting and academic platform
**Audit date:** 2026-07-26  
**Audited state:** Current dirty worktree, without changing application behavior  
**Frontend:** Vite 8, React 19, TypeScript SPA  
**Backend:** Laravel 13, Sanctum cookie authentication  
**Local database:** SQLite WAL  
**Production target reviewed:** Nginx + PHP-FPM + MariaDB on one hospital-LAN Ubuntu server

## 1. Executive summary

No Critical performance defect was confirmed. The system is functional and remained stable during a safe eight-user read-only concurrency run, but several High-priority bottlenecks already produce measurable lag at the current data volume:

1. A cold `GET /api/analytics/dashboard` takes **3.61–4.25 seconds**, returns **373 KB**, and peaks at **78 MB** of PHP memory.
2. Re-saving one representative **182-cell report executes 396 SQL statements**. The frontend then waits for three additional serial reads after the write.
3. Analytics warming runs in `app()->terminating()` and retained a PHP worker for **7.2 seconds** in a three-filter measurement.
4. The superadmin workspace bootstrap is approximately **220 KB**, executes **24 controller queries**, is fetched on focus and every 60 seconds, and is also part of broad post-mutation refreshes.
5. The production login entry graph eagerly downloads protected dashboard libraries. The cold entry is approximately **1.396 MB raw / 398.6 KB gzip**, including a **406.7 KB raw Recharts chunk**.
6. Academic pages fan out into several uncancelled requests. On the single-worker local server, small responses queue behind unrelated calls and complete in **1.3–1.9 seconds**.

The production-preview public login page itself has good local lab paint and stability:

- **FCP:** 784 ms
- **LCP:** 784 ms
- **CLS:** 0

Those results do not extend to authenticated data readiness. Admin login to dashboard data-ready took **1.63 seconds**, included **198 ms and 289 ms** main-thread tasks, and transferred approximately **219 KB of workspace JSON** plus **116 KB of analytics JSON**.

The safe concurrency run completed **127 requests with zero failures at 6.35 requests/second**, but workspace p95 increased to **1.07 seconds** and even an 11-byte notifications response reached **1.11 seconds p95**. This is strong evidence of queueing in the local `php artisan serve` + SQLite lane, not a production capacity result.

### Priority count

| Priority | Confirmed problems | Suspected risks |
|---|---:|---:|
| Critical | 0 | 0 |
| High | 6 | 1 |
| Medium | 9 | 5 |
| Low | 2 | 1 |

### Recommended first implementation sequence

1. Bulk-load, diff, and upsert report values; return the complete saved DTO and end the button busy state after the write.
2. Move analytics warming to a deduplicated queue job and reduce the cold aggregation cost.
3. Slim and split `/api/workspace`; remove the redundant `/api/auth/me` refresh and unchanged full-payload polling.
4. Separate public/auth and protected frontend entry graphs; correct role landing and route preloading.
5. Add cancellation, a single bounded retry policy, mutation timeouts, pagination, and sargable date queries.
6. Move large imports to a staged queued workflow and production-load-test PHP-FPM + MariaDB before setting capacity claims.

## 2. Audit method and evidence labels

This audit combined:

- Playwright CLI journeys in real Chromium across superadmin, nurse, resident, and consultant roles.
- Desktop and 390×844 mobile rendering.
- Vite development and same-origin production-preview builds.
- Navigation, Event Timing, long-task, heap, resource, API, payload, and response-header capture.
- A safe, disposable eight-user read-only concurrency run.
- Production bundle and static asset inspection.
- Laravel controller/service benchmarks using the populated local database.
- Laravel query listener measurements and SQLite `EXPLAIN QUERY PLAN`.
- Authentication cost and route/middleware inspection.
- Schema, index, retention, session, cache, queue, import, and export review.
- Full Laravel regression suite.

Findings are labelled:

- **Confirmed:** reproduced in the browser, measured in the application, or directly demonstrated by a query plan/configuration.
- **Confirmed code behavior, unmeasured at scale:** the implementation is certain, but its production-volume impact was not safely exercised.
- **Suspected risk:** supported by architecture or source evidence, but requiring production-shaped or larger-volume verification.

Core Web Vitals are judged against the current “good” thresholds of LCP ≤2.5 seconds, INP ≤200 ms, and CLS ≤0.1 at the 75th percentile. This audit is a lab sample, not a field percentile. See [web.dev’s current Web Vitals guidance](https://web.dev/articles/vitals).

## 3. Environment and data baseline

### 3.1 Execution environment

| Item | Audited value |
|---|---|
| OS | Windows local workstation |
| Browser | Chromium through Playwright CLI |
| Node | 24.14.0 |
| npm | 11.9.0 |
| PHP | 8.4.19, OPcache enabled locally |
| Frontend dev | Vite on `localhost:5173` |
| Production preview | Built Vite bundle, same-origin on `localhost:5173` |
| Backend | `php artisan serve` on `127.0.0.1:8000` |
| Database | SQLite WAL, isolated E2E database for browser/load work |
| Production parity | Unavailable; Docker/MariaDB daemon was not running |

Production-preview static assets were served with gzip. Authenticated JSON responses in the local lane had no `Content-Encoding`, and encoded/decoded workspace sizes were identical. The checked-in Nginx site does not explicitly guarantee JSON gzip/Brotli; the actual hospital server was not inspected.

### 3.2 Populated developer database

The current database is **38.2 MB**.

| Table | Rows |
|---|---:|
| `report_field_values` | 70,482 |
| `evaluation_answers` | 12,554 |
| `morning_attendance` | 7,260 |
| `student_attendance` | 3,681 |
| `evaluations` | 1,360 |
| `reports` | 804 |
| `duty_assignments` | 661 |
| `teaching_sessions` | 422 |
| `cache` | 159 |
| `students` | 72 |
| `users` | 50 |
| `admin_audit_logs` | 41 |
| `report_assignments` | 27 |
| `sessions` | 13 |
| `jobs` | 1 |

`audit_logs`, notifications, access requests, action items, comments, transfer requests, and failed jobs have zero rows. Runtime claims for those paths are therefore limited; schema/query risks are reported separately.

## 4. Browser and user-journey baseline

### 4.1 Production-preview and Core Web Vitals

| Journey | FCP | LCP | CLS | Data/action readiness | Notes |
|---|---:|---:|---:|---:|---|
| Public login, desktop preview | 784 ms | 784 ms | 0 | — | Local loopback, production bundle |
| Admin login → dashboard ready | — | — | 0 observed | 1,627 ms | Login 482 ms; workspace 548 ms; analytics 84 ms |
| Resident mobile home, 390×844 | 888 ms | 1,476 ms | 0.0056 | — | No horizontal document overflow |
| Admin Students mobile, 390×844 | 1,392 ms | 3,372 ms | 0.0014 | — | One 281 ms long task; no overflow |

The mobile admin LCP is above the 2.5-second “good” threshold in this lab run. It is a single sample on local infrastructure and must be verified on physical hospital devices before it is treated as a field percentile.

### 4.2 Role workflows

| Workflow | Measured result |
|---|---:|
| Nurse dev login | 832 ms |
| Resident dev login | 1,075 ms |
| Consultant dev login | 1,157 ms |
| Resident home → evaluation form | 352 ms |
| Consultant home → teaching/students | 345 ms |
| Admin clinical → academic data-ready | 1,451 ms |
| Production Students tab ready | 200 ms |
| Production student search action | 359 ms, including 120 ms synthetic typing and 100 ms settle |
| Production worst search key event | 48 ms |

Click processing itself was generally responsive. For example, the clinical-to-academic click registered a 32 ms Event Timing duration, but the user waited 1.45 seconds for the data-dependent surface and the transition produced 55, 190, and 111 ms long tasks.

### 4.3 Memory

Six admin ↔ academic cycles sampled:

`87 MB → 84 → 106 → 124 → 149 → 182 → 194 → 84 MB after GC`

This does **not** confirm a leak. It does confirm substantial transient allocation and garbage-collection pressure while repeatedly mounting the two heaviest workspaces.

## 5. Backend and API baseline

Direct controller measurements use the populated database and exclude HTTP, Sanctum, network, and browser overhead.

### 5.1 Workspace

| Variant | Wall time | Controller queries | Response |
|---|---:|---:|---:|
| Default superadmin | 148–295 ms across measurements | 24–25 | 219,792 B |
| All periods | 249 ms | 25 | 406.6 KB |
| Profiles/history/access/all-period options | 304 ms | 29 | 428,853 B |
| `/api/workspace/profiles` only | 7.3 ms | 1 | 12,441 B |
| Nurse default | 83 ms in-process | 15 | 142.4 KB |
| Resident default | 37–40 ms | 14 | 68.2 KB |
| Consultant default | 37–43 ms | 15 | 68.2 KB |

For the default superadmin call, SQL consumed approximately **11 ms**; hydration, mapping, application logic, and JSON construction dominate.

### 5.2 Other expensive endpoints/work

| Feature | Wall time | Queries | Payload / memory |
|---|---:|---:|---|
| Cold analytics dashboard | 3,614–4,253 ms | 16 | 373,348 B; 78 MB peak |
| Warm analytics cache hit | 3.8 ms | — | — |
| Three-filter post-response warm | 7,205 ms | 36 | 80 MB peak |
| Unchanged 182-cell report save | 239.8 ms | 396 | SQL itself 21 ms locally |
| Reports list, 100 detailed rows | 485.2 ms | 13 | 209,702 B; 18 MB peak |
| Largest populated monthly export | 2,161 ms | 6 | 1,655 rows; 26 MB peak |
| Bcrypt cost-12 check | median 398 ms | — | Intentional auth security cost |

## 6. Safe load and concurrency baseline

Configuration:

- Eight virtual users.
- 20 seconds.
- Five-second ramp.
- 250–800 ms think time.
- Three authenticated credential sessions.
- Read-only workspace, report-detail, notifications, and auth/me mix.
- Disposable local E2E database.

Results:

| Endpoint | Count | p50 | p95 | Max | Failures |
|---|---:|---:|---:|---:|---:|
| Workspace | 75 | 816 ms | 1,069 ms | 1,159 ms | 0 |
| Report details | 21 | 763 ms | 1,058 ms | 1,104 ms | 0 |
| Notifications | 16 | 609 ms | 1,105 ms | 1,105 ms | 0 |
| Auth/me | 6 | 379 ms | 947 ms | 947 ms | 0 |
| Login | 3 | 518 ms | 541 ms | 541 ms | 0 |

Overall: **127 requests, 0 failures, 6.35 requests/second**.

The load run confirms local queueing and latency degradation. It does not establish production capacity because `php artisan serve` is single-worker and SQLite serializes writes. Production PHP-FPM, MariaDB, LAN latency, disk I/O, and real connection limits were not exercised.

## 7. Confirmed findings

### PERF-H01 — Cold analytics dashboard is CPU, memory, and payload heavy

**Priority:** High  
**Affected:** `GET /api/analytics/dashboard`, clinical admin dashboard

**Reproduction**

1. Clear only the dashboard analytics cache.
2. Request a populated date range.
3. Capture controller wall time, query log, response size, and peak memory.
4. Repeat immediately to compare the cache hit.

**Measured evidence**

- Cold: 3.61–4.25 seconds.
- Warm: 3.8 ms.
- 16 queries; SQL 185–463 ms.
- 373,348-byte response.
- 78 MB peak PHP memory.
- Browser E2E fixture still returned approximately 116 KB of analytics JSON.

**Likely root cause**

`AnalyticsService::reports()` hydrates reports and EAV value models, then `DashboardAnalyticsService::buildSummary()` folds large structures in PHP. Model hydration, repeated collection work, response construction, and serialization dominate over SQL.

**User impact**

The first viewer after cache expiry or invalidation can wait more than four seconds. Several simultaneous cold builds can consume a large fraction of the PHP-FPM memory/process budget.

**Recommended fix**

- Push stable grouping/totals into SQL.
- Introduce pre-aggregated summary tables or incrementally maintained rollups.
- Select scalar export/analytics columns instead of full Eloquent graphs.
- Split the response into independently cached visible sections.
- Do not return series the current viewport/tab does not render.

**Expected improvement**

Cold p95 below 750 ms, response below 150 KB, and peak memory below 40 MB.

**Verification**

Run five forced-cold requests on PHP-FPM + MariaDB, record p50/p95, memory, queries, payload, and compare result equivalence.

### PERF-H02 — Report save combines 396 SQL statements with four serial network operations

**Priority:** High  
**Affected:** report create, draft save, autosave, submit, and spreadsheet import

**Reproduction**

1. Open a populated 182-cell report.
2. Save without changing values while listening to database queries.
3. In Playwright, trace the disabled-button period through final feedback.

**Measured evidence**

- In-process save: 239.8 ms and 396 queries.
- The value persistence path performs a lookup and `updateOrCreate()` decision per cell.
- A submitted edit can also insert one audit row per changed cell.
- Frontend critical path:

  `POST report → GET /api/auth/me → GET /api/workspace → GET /api/reports/details`

- The UI waits for the entire chain before clearing its busy state.

**Likely root cause**

Per-cell ORM reads/writes are combined with broad client-side revalidation because the mutation response is reduced to an ID rather than the complete updated report.

**User impact**

Save feedback accumulates database round trips and three extra network round trips. MariaDB on another process/host will magnify the 396-query cost. Offline import repeats the same path for every group.

**Recommended fix**

- Load all existing values once and key them by field/day.
- Diff in memory.
- Bulk `upsert`, bulk delete, and bulk audit insert.
- Skip unchanged rows.
- Return the complete saved report DTO, including derived values/quality.
- Merge locally and acknowledge success after the POST; refresh non-critical aggregates in the background.

**Expected improvement**

Fewer than 20–30 SQL statements and a 70–95% write-latency reduction depending on database round-trip time. User-visible save latency becomes approximately the POST duration.

**Verification**

Add a performance regression test for a full 180+ cell save with query-count and wall-time budgets. In Playwright, require only the mutation before success feedback.

### PERF-H03 — Post-response analytics warming holds a PHP worker for seconds

**Priority:** High  
**Affected:** every write that calls `DashboardAnalyticsService::invalidate()`

**Reproduction**

1. Populate three recently used analytics filter sets.
2. Perform an invalidating write.
3. Time `app()->terminating()` work and poll `/up` concurrently.

**Measured evidence**

- `warm()` can rebuild three filters.
- The three-filter measurement took 7,205 ms, 36 queries, and 80 MB peak.
- The callback runs from `app()->terminating()`.

**Likely root cause**

The response can be flushed before the callback, but the same PHP process remains occupied by multi-second work.

**User impact**

Under the local single-worker server, all following requests wait. Under PHP-FPM, one child is unavailable per warm; repeated saves can shrink or exhaust the effective pool.

**Recommended fix**

Dispatch a deduplicated after-commit queue job. Use one bounded filter per job, coalesce invalidations, and consider cache-on-read until the cold builder is reduced.

**Expected improvement**

Request workers become free immediately after the response and background analytics has explicit queue observability/backpressure.

**Verification**

Simultaneously save and poll health/workspace on production-shaped FPM. Track active/idle children, queue lag, and post-response CPU duration.

### PERF-H04 — Workspace bootstrap and refresh strategy transfer broad state repeatedly

**Priority:** High  
**Affected:** authentication restore, every role’s focus/visibility refresh, admin 60-second pulse, post-mutation refresh, route changes

**Reproduction**

1. Log in as superadmin.
2. Record `/api/auth/me` and `/api/workspace` on bootstrap.
3. Leave the page open for several minutes and switch focus.
4. Navigate clinical → academic and inspect the request waterfall.

**Measured evidence**

- Default superadmin workspace: approximately 220 KB and 24 controller queries.
- All-period/options variant: approximately 429 KB and 29 queries.
- Authenticated preview observed full workspace durations of 441–1,358 ms.
- The admin interval issues `/api/auth/me` then full workspace every 60 seconds.
- At 100 idle admin sessions, the workspace body alone is approximately 22 MB/minute before focus events and headers.
- Clinical → academic required auth/me, workspace, transfers, wards, summary, trend, and people; data-ready took 1,451 ms.
- Under overlapping preview requests, student-page calls completed progressively at 1.34–1.90 seconds.

**Likely root cause**

One bootstrap endpoint returns identity, roles, templates, periods, assignments, reports, notifications, settings, and academic setup. Refresh verifies the session separately before downloading the same broad state. Pages also fetch multiple tab datasets eagerly.

**User impact**

Navigation and focus can feel slow even when each controller is individually acceptable. Polling consumes bandwidth, PHP workers, JSON serialization, browser parsing, and global state renders.

**Recommended fix**

- Make bootstrap contain identity, permissions, navigation references, and version stamps.
- Split reports, templates, notifications, settings, and academic setup.
- Let authenticated workspace/bootstrap 401 replace the preceding auth/me request.
- Use ETag/If-None-Match or versioned/delta refresh.
- Stop unchanged full polling; pause hidden tabs and refresh narrowly.
- Lazy-load inactive tabs and cancel requests from abandoned routes/filters.

**Expected improvement**

Bootstrap below 75 KB and approximately ten queries; half as many focus/poll requests; materially lower route data-ready time.

**Verification**

Budget workspace bytes/queries by role, record a five-minute idle session, and require no unchanged full-state transfer.

### PERF-H05 — Public cold entry eagerly loads protected dashboard libraries

**Priority:** High  
**Affected:** `/login`, password reset, registration, every cold route

**Reproduction**

1. Run `npm run build`.
2. Inspect `dist/index.html`.
3. Load `/login` with a clean cache and capture the resource waterfall.

**Measured evidence**

- Initial HTML requests 17 JavaScript files plus CSS.
- Approximately 1.396 MB raw / 398.6 KB gzip.
- Largest eager chunks:

| Chunk | Raw | Gzip |
|---|---:|---:|
| Charts | 406.74 KB | 116.23 KB |
| Vendor | 235.85 KB | 70.04 KB |
| React core | 221.22 KB | 71.09 KB |
| Motion | 130.86 KB | 42.94 KB |
| Radix UI | 119.75 KB | 32.22 KB |
| CSS | 136.30 KB | 25.33 KB |

Charts, motion, and Radix account for approximately 191 KB gzip before authentication. Media is not the problem: the only emitted raster is the 14.8 KB hospital logo, with no bundled webfonts or video.

**Likely root cause**

Public/auth and protected shell code share one entry graph. Manual chunks create shared dependency edges that cause Vite modulepreloads, including Recharts.

**User impact**

Unnecessary download, decompression, parse, and execution on every cold login, especially on hospital Wi-Fi and lower-end mobile hardware.

**Recommended fix**

- Split the public/auth router from the protected application tree.
- Lazy-load `ProtectedShell`.
- Keep Recharts reachable only from chart routes.
- Revisit fixed `manualChunks` with a bundle visualizer.
- Replace tiny entry-state animations with CSS or lazy-load motion.

**Expected improvement**

Reduce cold gzip from about 399 KB toward 210–250 KB and remove chart parsing from public pages.

**Verification**

The production login waterfall must not request charts, protected Radix components, or admin page code. Compare transferred bytes and long tasks under mobile throttling.

### PERF-H06 — Non-nurse login loads and visits the wrong dashboard first

**Priority:** High  
**Affected:** resident, consultant, and student-representative sign-in

**Reproduction**

Sign in as one of the affected roles and inspect awaited imports and route changes.

**Measured evidence**

- The login page sends every non-nurse role to `/admin`.
- It explicitly awaits the admin dashboard import.
- The authorization guard then redirects to `/academic` or `/teaching`.
- Admin dashboard page chunk: 58.54 KB raw / 14.21 KB gzip, excluding shared dependencies.
- The login page also preloads nurse and admin dashboards for every anonymous visitor.

**Likely root cause**

The login page duplicates an outdated two-role landing decision instead of using `landingPathForRole`.

**User impact**

The “Signing in…” state waits for irrelevant code, then the user sees another route fallback while the correct page loads.

**Recommended fix**

Use the central landing function and a role-to-loader map. Preload only after the authenticated role is known.

**Expected improvement**

Remove one incorrect transition and at least 14.21 KB gzip for affected roles.

**Verification**

Resident, consultant, and student-rep traces must contain no admin-dashboard request and only one final navigation.

### PERF-M01 — Authenticated dashboard hydration creates long main-thread tasks

**Priority:** Medium  
**Affected:** admin dashboard and academic/student management

**Reproduction**

Capture PerformanceObserver `longtask` and Event Timing entries through login and workspace transitions.

**Measured evidence**

- Production admin login produced 198 ms and 289 ms long tasks after data arrived.
- Dev clinical → academic produced 55, 190, and 111 ms tasks.
- Dev Students tab produced a 492 ms task and a 512 ms interaction.
- Production Students improved to 152 ms for the tab click and 48 ms for the worst search key event.
- The admin page mounts roughly 15 chart containers, including below-fold content.

**Likely root cause**

Large payload parsing, one broad app-data context invalidation, synchronous derived-data construction, and mounting/diffing many chart/table components together.

**User impact**

Interactions that land during hydration can miss the 200 ms INP “good” target even though the click handler itself is small.

**Recommended fix**

- Split context by slice or use selector subscriptions.
- Memoize indexed/derived dashboard datasets.
- Split and memoize sections.
- Mount below-fold charts with `IntersectionObserver` or `content-visibility`.
- Paginate/virtualize roster tables and memoize rows.

**Expected improvement**

No task above 50 ms during normal hydration/filtering; interaction samples below 100 ms.

**Verification**

React Profiler plus production Performance traces on the current fixture and a 10× dataset, with CPU throttling.

### PERF-M02 — Retry, timeout, and cancellation behavior can amplify outages

**Priority:** Medium  
**Affected:** all GETs, TanStack Query screens, writes, CSRF bootstrap, academic filters

**Reproduction**

Intercept requests and simulate a black hole, 401, 404, 503, abandoned filter, and stalled write.

**Measured/code evidence**

- API client: two GET attempts, 15-second timeout each, 200 ms delay.
- TanStack Query globally retries once again.
- A black-holed query can remain loading for roughly 61 seconds.
- Unsafe methods default to no client timeout.
- `/sanctum/csrf-cookie` has no explicit timeout.
- Academic filter cleanup ignores old results but does not abort the network/server work.
- A dashboard filter triggers three calls; person detail triggers four.

**Likely root cause**

Two independent retry owners, no total deadline, non-status-aware retries, and no `AbortSignal` propagation through API helpers.

**User impact**

Minute-long skeletons during outages, writes that can spin indefinitely, and extra load precisely while the backend is recovering.

**Recommended fix**

- One retry owner.
- 15–20 second total deadline.
- Retry only transient idempotent failures with exponential backoff/jitter.
- Never retry normal 4xx.
- Add bounded mutation and CSRF timeouts.
- Propagate `AbortSignal`; debounce rapid filters.

**Expected improvement**

Predictable failure feedback and only the newest filter request set consuming backend resources.

**Verification**

Automated Playwright interception assertions for elapsed time, attempts, visible feedback, and cancelled requests.

### PERF-M03 — Reports list ships detail data for 100 rows

**Priority:** Medium  
**Affected:** `GET /api/reports`

**Reproduction**

Request the default list page and capture payload, memory, and eager-loaded relations.

**Measured evidence**

- 485.2 ms in-process.
- 13 queries.
- 209,702-byte response.
- 18 MB peak memory.
- Every row eager-loads field values and definitions.

**Likely root cause**

The list response mixes headers and full report detail.

**Recommended fix**

Return header/status rows only and use existing detail endpoints for the selected report. Reduce the default page size if 100 rows are not visible.

**Expected improvement**

Payload below 50–100 KB and significantly lower hydration/memory.

**Verification**

Compare list/result behavior and selected-detail correctness with payload/memory budgets.

### PERF-M04 — Export is streamed but PHP-heavy

**Priority:** Medium  
**Affected:** `GET /api/analytics/export`, CSV and XLSX downloads

**Reproduction**

Export the busiest populated month and measure first byte, completion, queries, memory, and row count.

**Measured evidence**

- 116 submitted reports and 1,655 output rows.
- 2,161 ms generation.
- Six queries; only 36 ms SQL.
- 26 MB peak.
- CSV and XLSX paths are correctly lazy/streamed.

**Likely root cause**

Model hydration and repeatedly filtering each report’s full value collection once per definition.

**Recommended fix**

Group values by definition once per report and select only required export columns.

**Expected improvement**

500–750 ms generation before transfer for the current busiest month.

**Verification**

Benchmark CSV/XLSX first byte, total time, peak RSS, and exact output equivalence.

### PERF-M05 — Imports are fully materialized and processed synchronously

**Priority:** Medium  
**Affected:** `POST /api/admin/reports/import`

**Reproduction**

Use disposable-database near-limit CSV/XLSX fixtures and measure memory, worker availability, group progress, and timeout semantics. This mutation was not executed during the audit.

**Confirmed code evidence**

- Up to 10 MB compressed upload.
- CSV rows accumulate fully in an array.
- XLSX shared strings and worksheet XML are loaded into memory and converted into another dense row array.
- Individual XML parts may reach 64 MB; there is no aggregate uncompressed-workbook cap.
- Another grouped structure is created.
- Groups run sequentially through the 396-query-prone report save.
- Groups commit separately, so a timeout can leave partial work without a final response.

**Likely root cause**

Request/response processing is used for a batch job and parsing is not streamed end-to-end.

**User impact**

Long frozen upload feedback, PHP memory exhaustion, worker starvation, timeouts, and ambiguous partial success.

**Recommended fix**

Stream parsing, stage/validate, enqueue bounded batches, expose progress/status, add an aggregate uncompressed cap, and define atomic versus partial semantics.

**Expected improvement**

Bounded memory and no multi-minute request worker.

**Verification**

Near-limit disposable fixtures with peak RSS, completion, progress, rollback, and concurrent `/up` checks.

### PERF-M06 — Date, auth, and audit query shapes bypass useful indexes

**Priority:** Medium  
**Affected:** authentication, evaluation/session/roster date filters, default audit feeds

**Reproduction**

Run `EXPLAIN` for current ORM SQL and equivalent direct comparisons.

**Measured evidence**

- Auth lookup with `lower(email)`, `lower(coalesce(username,''))`, and computed sort: user table scan plus temporary sort.
- `whereDate()` appears 91 times.
- Evaluation and teaching-session function-wrapped dates scan, while direct date comparisons use existing indexes.
- Default audit feeds scan and temporary-sort because no standalone leading time index matches the default order.
- A current unindexed `report_field_values.field_definition_id` filter measured 22.5 ms p50 versus 0.425 ms for an indexed report lookup, although that filter was not found on the primary hot path.

**Likely root cause**

Functions wrap indexed columns, and feed indexes do not match default sort/access patterns.

**User impact**

Negligible at 50 users or empty audit tables, but linear degradation as login directories, attendance, evaluations, and audits grow.

**Recommended fix**

- Normalize identifiers and use exact indexed equality.
- Use direct comparisons for SQL `DATE`.
- Use half-open ranges for timestamps.
- Add default audit time indexes and cursor pagination.
- Add new indexes only after verifying real hot queries on MariaDB.

**Expected improvement**

Indexed range/ordered walks rather than full scans/sorts.

**Verification**

SQLite and MariaDB `EXPLAIN ANALYZE` with large representative fixtures.

### PERF-M07 — Unbounded collections and retention gaps create data-volume risk

**Priority:** Medium  
**Affected:** admin users, students, profiles, access requests, assignments, rep assignments, audit history, notifications

**Reproduction**

Inspect collection endpoints and scheduled pruning, then benchmark at increasing synthetic volumes.

**Confirmed code evidence**

- Several collections call `get()` without pagination or a server limit.
- Current users response is 34 KB and students response is 14.5 KB, so present impact is small.
- Teaching oversight caps at 300 instead of paginating, making older rows inaccessible.
- Clinical/admin audit tables have no general retention job.
- Only stale read notifications are pruned; unread/history growth remains.

**Likely root cause**

The application was designed for current department-scale data without explicit lifecycle/page contracts.

**User impact**

Payload, JSON parsing, filters, table rendering, and default feed scans grow linearly over years.

**Recommended fix**

Cursor pagination and server search for users/students first; retention/archive policy for audit/history; real pagination instead of silent caps.

**Expected improvement**

Bounded response/render time independent of total history.

**Verification**

10× and multi-year fixtures with first/next page, count, payload, and browser-render budgets.

### PERF-M08 — Session, cache, locks, and queue share the clinical database

**Priority:** Medium scalability risk  
**Affected:** every authenticated request, analytics cache, scheduler, background jobs, report writes

**Reproduction**

Inspect runtime configuration and run mixed reads/writes on production-shaped storage.

**Confirmed evidence**

- `SESSION_DRIVER=database`
- `CACHE_STORE=database`
- `QUEUE_CONNECTION=database`
- SQLite WAL remains single-writer.
- Production MariaDB removes the single-file writer but still shares connections and writes with clinical data.
- Eight-user local load produced 1.07-second workspace p95 with no failures.

**Likely root cause**

All stateful infrastructure is consolidated into one database.

**User impact**

Session/rate-limit/cache/queue traffic competes with report and academic transactions. Lock waits and connection pressure can appear abruptly under bursts.

**Recommended fix**

Measure the actual deployment first. Move cache/locks/session/queue to Redis or separate stores/connections before sustained concurrency.

**Expected improvement**

Lower primary DB write pressure and more predictable application request latency.

**Verification**

PHP-FPM + MariaDB load with active DB connections, lock waits, queue lag, p95/p99, CPU, and memory.

### PERF-M09 — First-visit offline shell does not precache its hashed assets

**Priority:** Medium  
**Affected:** installed/offline nurse workflow

**Reproduction**

Clear site data, visit online once, wait for activation, close, go offline, and reopen.

**Confirmed code evidence**

- Service-worker install caches only `/` and `/index.html`.
- Registration occurs after `window.load`, so initial JS/CSS load before the worker controls the page.
- Hashed assets are cached only when requested under later worker control.

**Likely root cause**

No build-generated precache manifest.

**User impact**

HTML can reopen after one visit while required JS/CSS is unavailable, producing an apparently slow or blank offline start.

**Recommended fix**

Generate a precache list from emitted assets or use a maintained Workbox/Vite PWA strategy. Treat required shell-cache failure as visible.

**Expected improvement**

Deterministic one-online-visit offline startup.

**Verification**

Automated clean-profile one-visit/offline-relaunch with every referenced asset asserted in Cache Storage.

### PERF-L01 — Production emits development-only lab chunks

**Priority:** Low  
**Affected:** build artifact

**Evidence**

`tab-bar-lab` and `header-lab` are emitted in production: 23.45 KB raw / approximately 6.42 KB gzip combined. They are not eagerly requested.

**Root cause**

Lazy import declarations exist unconditionally even though route rendering checks `import.meta.env.DEV`.

**Fix / expected improvement**

Move declarations behind a build-time dev module boundary; remove 23.45 KB raw from deploy output.

**Verification**

No lab chunks in `dist/assets`.

### PERF-L02 — Permanent retry of failed jobs can create background churn

**Priority:** Low now; Medium if notification failures occur  
**Affected:** notification delivery queue

**Evidence**

The scheduler runs `queue:retry all` hourly while notification jobs already have bounded tries/backoff. Permanent configuration failures can be resurrected indefinitely and refresh their failed timestamp.

**Root cause**

No transient/permanent failure classification or dead-letter policy.

**Fix**

Retry only transient classes, cap redrive age/count, and dead-letter permanent errors. Set explicit SMTP/SMS connection timeouts.

**Expected improvement**

No indefinite background retries or invisible queue/database load.

**Verification**

Simulate permanent delivery configuration failure and assert bounded attempts and terminal state.

## 8. Suspected risks requiring targeted verification

### RISK-H01 — Global context and dashboard monolith may degrade INP at larger volumes

The admin dashboard is approximately 3,000 lines and mounts around 15 responsive charts. The app provider exposes the full workspace in one context value, so state replacement invalidates every consumer. Production long tasks already reached 289 ms, but React commit attribution and 10× data behavior were not captured.

**Verify:** React Profiler, 4× CPU throttling, current and 10× records.  
**Recommended direction:** slice/selector state, memoized sections/datasets, viewport-driven chart mounting.

### RISK-M01 — Report form whole-template validation may create low-end-device input lag

The form uses a whole-template Zod resolver in `mode: onChange`, watches all values, stringifies the full value object, and subscribes per field. No physical low-end-device typing trace on the largest template was recorded.

**Verify:** largest inpatient form, 4× CPU, keyboard Event Timing and commit count.  
**Recommended direction:** field/section subscriptions, memoized rows, debounced autosave signature, scoped validation.

### RISK-M02 — Client caches and local workspace snapshots may grow without bounds

Academic page caches are module-level Maps without a global LRU. Workspace persistence reparses/restringifies a multi-user localStorage envelope. The six-cycle heap test eventually returned below baseline, so a leak is not confirmed.

**Verify:** many people/filter keys, account switches, heap snapshots, storage size, page-hide duration.  
**Recommended direction:** bounded user-scoped query cache and IndexedDB LRU for large snapshots.

### RISK-M03 — Rotation setup computation grows with cells × assignments

The current admin workspace evaluates only 26 block/resident cells. Each call filters the complete current-assignment collection. At larger resident/fragmented-assignment volumes this becomes multiplicative.

**Verify:** 10× residents and fragmented assignments, isolated academic-payload benchmark.  
**Recommended direction:** group assignments by user once before cell evaluation.

### RISK-M04 — Production compression and FPM sizing are not guaranteed by the deployment artifact

Vite preview compressed static assets, but local API JSON was uncompressed. The checked-in site config does not explicitly enable JSON gzip/Brotli, and the Docker FPM pool setting is not an installation artifact for the host’s distro pool.

**Verify:** actual hospital response headers, FPM `pm.*` configuration, active/idle workers, RSS per worker.  
**Recommended direction:** explicit compression and hardware-based FPM sizing in deploy/readiness checks.

### RISK-M05 — MariaDB query plans and write concurrency remain unverified

Docker was unavailable and the MariaDB-only concurrency regression skipped. SQLite plans identify query-shape risks but do not prove MariaDB plans, disk latency, lock waits, or transaction throughput.

**Verify:** production-parity MariaDB/FPM lane, `EXPLAIN ANALYZE`, concurrent report saves, imports, and analytics reads.

### RISK-L01 — Permanent compositor hints may retain extra layers

The shell keeps `will-change` on large elements beyond active transitions. No GPU layer/memory trace was captured.

**Verify:** Chrome Layers/Memory on representative mobile hardware.  
**Recommended direction:** apply `will-change` only around transitions.

## 9. Positive findings and cleared concerns

- No Critical performance issue was confirmed.
- Safe local concurrency had zero failed requests.
- Public production-preview LCP/FCP and CLS were good on desktop loopback.
- Mobile CLS was very low, and neither tested mobile workflow had document-level horizontal overflow.
- Production student search key events stayed at or below 48 ms; the severe 352 ms dev sample did not reproduce in production.
- Repeated navigation returned from 194 MB to 84 MB after GC; no monotonic memory leak was confirmed.
- Major read paths generally eager-load relations; no classic read-side N+1 was confirmed.
- Authorization permission checks are in-memory and inexpensive relative to session/endpoint work.
- Bcrypt cost should **not** be reduced; login/password-change throttles correctly bound the intentional ~400 ms password check.
- Images are small, system fonts are used, and no video is bundled.
- CSV/XLSX export is streamed/lazy rather than fully buffered.
- Route-level page chunks generally work and range from approximately 0.67–58.54 KB raw.
- Listener and interval cleanup is generally present.
- Frontend production build passed: 3,357 modules, approximately 22 seconds total, 3.54-second bundle phase.
- Laravel suite passed: **324 passed, 1 skipped, 2,234 assertions**. The skipped test is MariaDB-only concurrency.

## 10. Prioritized recommendations

### Quick wins

1. Use `landingPathForRole` and preload only the authenticated role’s page.
2. Remove `/api/auth/me` from refresh paths that immediately call authenticated workspace.
3. Add a bounded timeout to writes and CSRF setup.
4. Make one layer own retries; disable retries for ordinary 4xx.
5. Pass `AbortSignal` through API helpers and debounce rapid academic filters.
6. Lazy-load inactive student/admin tabs.
7. Change SQL `DATE` filters from `whereDate()` to direct comparison.
8. Add matching default audit time indexes before audit volume grows.
9. Explicitly enable/verify JSON gzip/Brotli and immutable static caching in the production readiness check.
10. Remove dev lab chunks from production output.

### Medium-term improvements

1. Bulk report value diff/upsert and complete mutation DTO.
2. Split workspace and reports list into summary/detail resources.
3. Paginate users, students, audit, access, and assignment collections.
4. Split public/protected frontend entry graphs.
5. Memoize/split dashboards and mount charts near viewport.
6. Group export and rotation collections once instead of repeatedly filtering.
7. Add server/browser performance budgets to CI.

### Long-term scalability improvements

1. Pre-aggregate analytics and make cache rebuilds queue-managed.
2. Move session/cache/locks/queue away from the primary clinical DB when load evidence justifies it.
3. Make imports staged, streamed, queued, observable, and bounded.
4. Define retention/archive policy for audit, history, notification, session, cache, and failed-job data.
5. Establish a repeatable PHP-FPM + MariaDB performance lane with realistic multi-year data.
6. Add field Web Vitals and server timing telemetry on the hospital LAN.

## 11. Proposed implementation order and acceptance gates

### Phase 1 — Save path

- Bulk value persistence.
- Complete saved-report response.
- End UI busy state after mutation.

**Gate:** fewer than 30 queries for a 180-cell save; one request before success feedback; p95 save established on MariaDB.

### Phase 2 — Analytics throughput

- Queue/dedupe warming.
- Reduce cold object hydration and payload.
- Instrument cache hit/miss/build time.

**Gate:** cold p95 <750 ms, warm p95 <50 ms, peak <40 MB, no request worker held by warm.

### Phase 3 — Bootstrap and request topology

- Split workspace.
- Collapse auth + workspace.
- Conditional/delta refresh.
- Lazy/cancel tab/filter requests.

**Gate:** admin bootstrap <75 KB and ≤10 queries; no unchanged minute poll; route data-ready <750 ms on production-shaped lane.

### Phase 4 — Frontend loading/rendering

- Split public/protected entry.
- Correct role landing.
- Defer charts and below-fold work.
- Memoize/virtualize heavy tables.

**Gate:** login ≤250 KB gzip, no charts on public route, no task >50 ms during tested interactions, mobile LCP <2.5 seconds in repeated lab samples.

### Phase 5 — Database and collection scale

- Sargable date/auth queries.
- Audit indexes/retention.
- Cursor pagination.
- Production MariaDB plans.

**Gate:** indexed plans on representative million-row audit and multi-year attendance/evaluation fixtures.

### Phase 6 — Batch/infrastructure

- Queued import with progress.
- Explicit FPM/compression configuration.
- Primary DB offload where justified.
- Production capacity test.

**Gate:** near-limit import has bounded memory and does not degrade concurrent health; documented supported concurrency at agreed p95/error budgets.

## 12. Verification plan

For every implemented fix:

1. Re-run the exact browser artifact journey.
2. Compare request count, transferred/decoded bytes, action data-ready time, Event Timing, long tasks, and heap.
3. Compare controller wall time, query count/time, payload, and peak memory.
4. Capture MariaDB `EXPLAIN ANALYZE` for changed queries.
5. Run the full Laravel/frontend test and production build gates.
6. Re-run safe load at 1, 8, and an agreed realistic concurrent-user level on PHP-FPM + MariaDB.
7. Reject fixes that improve means while worsening p95/p99 or error rate.

Suggested automated budgets:

| Budget | Initial target |
|---|---:|
| Public login initial gzip | ≤250 KB |
| Desktop lab LCP | ≤2.5 s |
| Mobile lab LCP | ≤2.5 s |
| CLS | ≤0.1 |
| Tested interaction Event Timing | ≤100 ms target, 200 ms hard ceiling |
| Long task | none >50 ms during interaction window |
| Admin bootstrap | ≤75 KB, ≤10 queries |
| Cold analytics | ≤750 ms, ≤40 MB, ≤150 KB |
| Warm analytics | ≤50 ms |
| 180-cell save | ≤30 queries |
| Save success critical path | one mutation request |
| Load error rate | <1% |

## 13. Evidence index

Key browser evidence:

- [`preview-admin-login.txt`](output/playwright/performance-audit/preview-admin-login.txt)
- [`preview-students-interactions.txt`](output/playwright/performance-audit/preview-students-interactions.txt)
- [`preview-periodic-workspace-requests.txt`](output/playwright/performance-audit/preview-periodic-workspace-requests.txt)
- [`dev-desktop-admin-academic-transition.txt`](output/playwright/performance-audit/dev-desktop-admin-academic-transition.txt)
- [`dev-desktop-students-interactions.txt`](output/playwright/performance-audit/dev-desktop-students-interactions.txt)
- [`dev-desktop-repeated-nav-heap.txt`](output/playwright/performance-audit/dev-desktop-repeated-nav-heap.txt)
- [`load-8u-20s.json`](output/playwright/performance-audit/load-8u-20s.json)
- [`load-8u-20s.log`](output/playwright/performance-audit/load-8u-20s.log)
- [`production-build.log`](output/playwright/performance-audit/production-build.log)
- [`api-response-headers.txt`](output/playwright/performance-audit/api-response-headers.txt)
- [`response-compression-headers.txt`](output/playwright/performance-audit/response-compression-headers.txt)

Screenshots:

- [`preview-admin.png`](output/playwright/performance-audit/preview-admin.png)
- [`preview-students-filtered.png`](output/playwright/performance-audit/preview-students-filtered.png)
- [`dev-mobile-resident-home.png`](output/playwright/performance-audit/dev-mobile-resident-home.png)
- [`dev-mobile-admin-students.png`](output/playwright/performance-audit/dev-mobile-admin-students.png)

Raw Playwright trace resources are under `output/playwright/performance-audit/trace/`.

## 14. Limitations

- No production server or real hospital LAN/device was available.
- No MariaDB runtime, PHP-FPM worker metrics, production disk, TLS, or network latency.
- Chromium only for performance; no Firefox/WebKit performance comparison.
- Lab Web Vitals are not field 75th-percentile metrics.
- Event Timing samples are INP-like, not statistically valid field INP.
- No CPU/network throttling; local loopback makes transfer/paint optimistic.
- Vite dev overstates some JS work; production preview was used where possible.
- Several fast-growing tables are empty.
- No destructive import, submission, upload, or write stress was executed.
- The load test is intentionally small and read-only.
- SQLite concurrency behavior cannot be used as a MariaDB capacity claim.
- The current worktree contained extensive pre-existing modifications; the audit evaluated that exact state and did not revert or overwrite them.

## 15. Final assessment

The system is viable for its intended department-scale use, but current responsiveness depends too heavily on warm caches and low concurrency. The principal latency is not one slow SQL query. It is multiplication:

- hundreds of per-cell statements,
- several serial client refreshes,
- broad workspace payloads,
- several parallel page requests queued by limited workers,
- PHP aggregation and object hydration,
- and eager frontend code/render work.

Addressing the save path and analytics worker behavior first will remove the largest backend amplification. Slimming workspace and the public bundle next will improve nearly every user journey. Only after those changes should the team set a production concurrency target from a MariaDB/PHP-FPM lane.

## 16. Implementation results — 2026-07-26

The repository-level recommendations that preserve the current product/API contracts were implemented after this audit was accepted. The changes cover the confirmed frontend, API, query, cache, authentication, import/export, maintenance, and deployment-configuration findings. No production data was modified and no unsafe stress test was run.

### Confirmed before/after results

| Area | Audit baseline | Implemented result | Outcome |
|---|---:|---:|---|
| 182-cell report save | 396 SQL statements | 17 SQL statements | 95.7% fewer queries |
| Save browser critical path | POST plus three serial reads | One POST; no workspace/detail follow-up | Three network round trips removed |
| Save feedback | Not separately isolated | 227 ms in the production-browser journey | Immediate server response is merged locally |
| Cold dashboard analytics | 3.61–4.25 s | 1.764 s | 51–59% faster in the same local E2E lane |
| Warm dashboard analytics | Cache-dependent | 102 ms observed | Expensive aggregation avoided on cache hit |
| Dashboard browser response body | 115,987 B | 85,949 B | 25.9% smaller |
| Public initial JS/CSS graph | ~1.396 MB raw / 398.6 KB gzip | 835,761 B raw / 241,928 B gzip | ~40% smaller |
| Public initial requests | Unbudgeted | 28, with a CI budget of 32 | Regression gate added |
| Unchanged workspace check | Full ~220 KB workspace | 79-byte revision body (379 B with local headers) | Full unchanged transfer removed |
| Users route | Broad workspace refresh and duplicate risk | Three scoped requests, no duplicate, no workspace reload | Verified in rebuilt production preview |

The final Chromium production-preview sample recorded DCL/load at 722 ms, FCP at 1,020 ms, no observed long tasks, and 15 MiB used JS heap. These are local loopback lab values, not field Core Web Vitals.

### Implemented changes

- Report submission now preloads existing values, bulk upserts/deletes cells, batches audit work, and returns the complete updated report. The SPA merges that response rather than refetching authentication, workspace, and report details.
- Dashboard analytics hydrates relevant report data once, reuses indexed aggregates, omits duplicate dashboard rollups, uses versioned 30-minute caching, serializes cold builds with a lock, and queues bounded unique warm jobs after commits when an asynchronous queue is configured.
- Protected startup no longer performs a redundant `/api/auth/me` request before workspace bootstrap. Direct role landing and route-scoped preloading replace broad eager loading.
- Idle/focus refresh uses `/api/workspace/revision`; unchanged state no longer downloads the full workspace. Profiles and access requests have dedicated, scoped endpoints.
- Notification mutations and offline report saves merge server responses locally. Bulk notification actions use set-based database updates/deletes.
- The report form memoizes schema/default construction, validates on blur, removes JSON serialization from its change detector, and avoids repeated form-store reads.
- Analytics and person caches are bounded. Local workspace snapshots are age-limited and capped to two users.
- The service worker precaches emitted hashed assets, registers earlier, and avoids a hard-coded stale asset inventory. Permanent `will-change` declarations were removed and secondary chart work is deferred.
- Login identifiers are normalized and indexed. Report list/detail retrieval is split, report values are paginated/batched, audit filters are sargable, and audit/retention indexes plus pruning commands were added.
- Imports preload reference data and enforce explicit XLSX/CSV row, column, cell, and file-size limits. Export grouping was changed from repeated scans to a single indexed pass.
- Queue retry handling is limited to transient failures. Operational pruning and transient-job retry commands are scheduled and documented.
- Nginx JSON/static compression and cache headers, PHP-FPM worker settings, Redis-ready cache/queue/session configuration, and deployment checks are included in `deploy/`.
- The load tool defaults to eight users and refuses potentially unsafe non-loopback loads above 25 users without an explicit opt-in.
- CI now enforces a 900 KiB raw, 260 KiB gzip, 32-request initial graph budget.

### Verification completed

- Frontend production build: passed.
- Frontend tests: 91/91 passed across 15 files.
- Frontend lint: passed.
- Performance budget: passed at 835,761 raw bytes, 241,928 gzip bytes, and 28 requests.
- Laravel tests: 330 passed, one existing MariaDB-only test skipped, 2,268 assertions.
- Focused analytics contract: 13 tests and 147 assertions passed.
- Safe load: eight virtual users, 83 requests, zero failures, 0% error rate.
- Playwright verified superadmin and nurse journeys, direct role landing, scoped Users loading, report editing/saving, screenshots, request evidence, and a trace.

Implementation evidence:

- [`results.json`](output/playwright/performance-implementation/results.json)
- [`load-after.json`](output/playwright/performance-implementation/load-after.json)
- [`admin-login-after.trace`](output/playwright/performance-implementation/admin-login-after.trace)
- [`admin-dashboard-after.png`](output/playwright/performance-implementation/admin-dashboard-after.png)
- [`admin-users-after.png`](output/playwright/performance-implementation/admin-users-after.png)
- [`report-save-after.png`](output/playwright/performance-implementation/report-save-after.png)

### Remaining production verification

The safe eight-user run remained error-free, but p95 latency still showed development-server queueing. It used one `php artisan serve` worker and SQLite, so it cannot validate the configured PHP-FPM worker pool, Redis queue/cache, MariaDB indexes, gzip behavior, connection limits, or hospital-LAN latency.

Before release, deploy the supplied Nginx/PHP-FPM/Redis configuration to staging, run migrations, start the queue worker, capture MariaDB `EXPLAIN ANALYZE` for the changed queries, and repeat the same Playwright and load journeys. The asynchronous import-with-progress API remains a deliberate workflow/product migration; the existing synchronous contract was retained but is now bounded, preloaded, and protected against resource-exhaustion inputs.
