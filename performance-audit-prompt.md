# Full System Performance, Scalability & Navigation Latency Audit

> **How to use:** Paste this entire prompt into Claude Code (or your agent of choice) from the root of the project repository. Fill in the two placeholders in the Context section first.

---

## Context

- **System:** [SYSTEM NAME — e.g., Department Management System / EAII Grocery Portal]
- **Stack:** Laravel (PHP 8.3) backend, React + TypeScript frontend (Inertia or SPA), MariaDB database, Nginx + PHP-FPM, queue worker for background jobs
- **Deployment target:** [e.g., on-premises Ubuntu LTS server on a LAN / VPS]
- **Expected concurrent users:** [fill in — e.g., 50–300]

You have full read access to the codebase. Do not make any code changes during this audit unless explicitly instructed. Your job is to **measure, analyze, and report** — with reproducible evidence for every finding.

---

## Objective

Perform a full, deep, end-to-end analysis of this system covering three pillars:

1. **Performance** — how fast the backend and database respond under normal use
2. **Scalability** — how the system behaves as users, data volume, and request rates grow
3. **Navigation latency** — how fast the UI feels when a user clicks links, switches pages, opens modals, and submits forms

Every finding must include: (a) the evidence (measurement, query log, trace, or code reference with file path and line numbers), (b) severity (Critical / High / Medium / Low), (c) estimated user-facing impact, and (d) a concrete, prioritized fix.

---

## Phase 1 — Codebase Reconnaissance (static analysis)

Before running anything, map the system:

1. Enumerate all routes (`php artisan route:list`) and group them into: auth, dashboards, CRUD-heavy pages, report/analytics pages, file upload/download endpoints, and API/AJAX endpoints.
2. Identify the 10 heaviest pages by expected data volume (e.g., anything that lists many rows, aggregates monthly data, renders tables, or joins across many tables).
3. Inventory all Eloquent models and their relationships. Flag any relationship that could grow unbounded (hasMany without pagination, morph relations, etc.).
4. Locate all middleware in the global and web stacks. Flag anything that runs a DB query on every request (permission checks, settings loads, locale lookups, notification counts).
5. Inventory scheduled jobs, queued jobs, and event listeners. Flag any listener that runs synchronously on user-facing requests.
6. Check frontend build config (Vite): code splitting, lazy loading of routes/pages, bundle analysis setup, tree shaking, and whether large libraries (chart libs, date libs, icon packs) are imported wholesale.

**Deliverable:** a system map table (route group → controllers → models → tables → frontend page component) plus a "suspicion list" of likely hotspots ranked before any measurement.

---

## Phase 2 — Backend Performance Analysis

### 2.1 Database query analysis
- Enable query logging (Laravel Telescope, Debugbar, or `DB::listen`) and exercise every major page and workflow.
- Detect and document every **N+1 query** pattern: file, line, model, and the fix (eager loading with `with()`, `withCount()`, or restructuring).
- For each of the 10 heaviest pages: record total queries per request, total query time, and slowest single query.
- Run `EXPLAIN` on every query slower than 50ms. Flag full table scans, filesorts, temporary tables, and missing indexes.
- Audit indexes: compare every `WHERE`, `JOIN`, `ORDER BY`, and `GROUP BY` column used in hot queries against the actual schema indexes. Produce a list of missing/redundant indexes with exact `ALTER TABLE` statements.
- Check for `SELECT *` on wide tables, unbounded queries with no `LIMIT`, and queries inside loops.

### 2.2 Application-level performance
- Measure server response time (TTFB) for every major route: cold and warm, p50 and p95, using at least 20 samples per route (script this with `curl -w` or `wrk`/`k6`).
- Audit caching: what is cached (config, routes, views, queries, computed aggregates), what should be but isn't, cache driver in use, and TTL strategy. Flag any expensive computation (dashboard stats, monthly aggregations, rankings) recomputed on every request.
- Audit session driver, cache driver, and queue driver — flag `file`/`sync` drivers if used in production config.
- Check OPcache configuration assumptions and PHP-FPM pool sizing (pm settings vs expected concurrency).
- Audit file upload/download paths (receipts, exports, PDFs): streaming vs loading into memory, size limits, and storage disk performance.
- Measure memory usage per request on the heaviest routes; flag anything above 64MB.

### 2.3 Serialization & payload
- For Inertia/API responses: measure JSON payload size per page. Flag any page sending more than 200KB of props/data. Identify over-fetching (sending full models where the page needs 3 fields) and recommend API Resources / partial reloads / pagination.

---

## Phase 3 — Frontend & Navigation Latency Analysis

This is the "how it feels when clicking around" pillar. Treat perceived latency as a first-class metric.

### 3.1 Core Web Vitals per page
For each major page (login, dashboard, each main module, heaviest list page, heaviest form):
- Measure **TTFB, FCP, LCP, INP (interaction latency), CLS, and TBT** using Lighthouse in a scripted run (both desktop and simulated slow 4G / mid-tier device, since real users may be on modest hardware).
- Report results in a table with pass/fail against targets: LCP < 2.5s, INP < 200ms, CLS < 0.1, TTFB < 500ms.

### 3.2 Page-to-page navigation latency
- Script realistic click paths (e.g., login → dashboard → list page → detail page → form submit → back) using Playwright. Measure wall-clock time from click to page interactive for each transition, 10 runs each, report p50/p95.
- For Inertia: verify partial reloads (`only`) are used where appropriate, check for full-page props being re-sent on every visit, and confirm `preserveState`/`preserveScroll` usage on filters and pagination.
- Identify any navigation that triggers a full browser reload instead of a client-side visit.
- Check for waterfall requests after navigation (page loads, then fires 3 more AJAX calls before it's usable) — document each waterfall and how to collapse it.
- Measure form submission round-trips: click submit → validation/response → UI updated. Flag anything over 1s without a loading indicator.

### 3.3 Bundle & rendering analysis
- Run a bundle analysis (rollup-plugin-visualizer or equivalent). Report: total JS shipped on first load, per-route chunk sizes, largest dependencies, and duplicate dependencies.
- Flag any page-level component not lazy-loaded, any chart/PDF/date library loaded on pages that don't use it.
- Use React Profiler on the heaviest interactive pages (large tables, checklists, dashboards): identify unnecessary re-renders, missing memoization, expensive computations in render, and large lists rendered without virtualization.
- Check image/font loading: formats, sizes, lazy loading, font-display strategy.
- Verify HTTP-level basics: gzip/brotli enabled in Nginx, cache headers on static assets, HTTP/2 enabled.

---

## Phase 4 — Scalability Analysis

### 4.1 Load testing
Build and run k6 (or equivalent) scenarios against a staging/local environment seeded with **realistic production-scale data** (write a seeder if one doesn't exist — specify row counts per table based on 1 year and 3 years of projected usage):
- **Baseline:** 10 concurrent users, mixed realistic journey.
- **Expected peak:** the concurrency figure from Context, sustained 10 minutes.
- **Stress:** ramp until p95 response time exceeds 2s or errors appear. Record the breaking point (requests/sec and concurrent users).
- **Spike:** e.g., start-of-month or deadline-day pattern — everyone hits the same submission workflow within a 30-minute window.

Report per scenario: throughput, p50/p95/p99 latency per endpoint, error rate, CPU/RAM on app server and DB, MariaDB connections used, PHP-FPM worker saturation, and queue depth.

### 4.2 Data-volume scaling
- Re-run the Phase 2 heavy-page measurements against the 1-year and 3-year seeded datasets. Show how each page's response time grows with data volume — flag anything with worse-than-logarithmic growth (usually missing indexes or unbounded queries).
- Audit pagination everywhere: any list rendering all rows will die at scale — enumerate them.
- Check archival strategy: are old monthly rounds / reports / logs ever pruned or partitioned? Estimate table sizes at 3 years and flag risks.

### 4.3 Architectural scalability
- Identify single points of failure and vertical-scaling ceilings: session storage, local file storage, queue worker count, cron overlap, DB connection pool.
- Assess: can a second app server be added without code changes (sessions, uploads, cache locality)?
- Review queue architecture: which jobs exist, their runtimes, retry/failure behavior, and whether worker count matches load.
- Review MariaDB config for the target hardware: buffer pool size, connection limits, slow query log enabled.

---

## Phase 5 — Report & Remediation Plan

Produce a final report (`PERFORMANCE_AUDIT.md`) with:

1. **Executive summary** — one page, plain language: overall health grade per pillar (Performance / Scalability / Navigation latency), the 5 most impactful findings, and the breaking point from load testing.
2. **Findings register** — every finding as a table row: ID, pillar, severity, evidence (with file:line or measurement), user impact, fix, estimated effort (S/M/L).
3. **Measurement appendix** — all raw tables: per-route TTFB, Core Web Vitals per page, navigation timings, query counts per page, bundle sizes, load test results.
4. **Prioritized remediation roadmap** — ordered by impact-per-effort:
   - **Quick wins** (hours): indexes, eager loading, caching, compression, lazy loading
   - **Medium** (days): payload trimming, virtualization, queue tuning, partial reloads
   - **Structural** (weeks): pagination refactors, archival strategy, horizontal-scaling prep
5. **Regression guardrails** — recommend a minimal set of automated checks to keep performance from degrading: Lighthouse CI budgets, a k6 smoke test in CI, slow-query log monitoring, and bundle-size limits.

Do not soften findings. If something will fail at scale, say so plainly with the numbers that prove it.
