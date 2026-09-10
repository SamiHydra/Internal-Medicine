# Follow-Up Audit: Production-Shaped Validation in Docker

> **Context for the agent:** A full performance/scalability/navigation audit was already completed on 2026-07-28 against revision `3c9a412` (see `PERFORMANCE_AUDIT.md` in the repo root — read it first). That audit ran on Windows / PHP 8.4 CLI / SQLite / `php artisan serve`, so its database plans and load-test results are explicitly NOT production evidence. Docker Desktop is running on this machine. Your job is to rebuild the missing production-shaped evidence for a specific subset of findings — not to rerun the full audit. Do not re-measure bundles, payloads, navigation timings, or anything else the prior audit already settled.

**Findings in scope:** PERF-01, PERF-02, PERF-04, PERF-05, PERF-06, SCALE-01, SCALE-05, SCALE-07. Nothing else.

---

## Phase 0 — Build the stack

Create a `docker/audit/` directory with a `docker-compose.yml` that mirrors the committed production configs as closely as possible:

- **nginx** — based on `deploy/nginx.conf` (adapt paths/upstream for the container network; keep gzip, HTTP/2 if practical, and static asset cache headers).
- **php-fpm** — PHP **8.3** (not 8.4), with the pool settings from `deploy/php-fpm.conf` (20 children, status endpoint, slowlog at 3s). Install OPcache and enable it with production-appropriate settings; record the exact values used.
- **mariadb** — a current stable MariaDB image. **Data must live on a named Docker volume, never a Windows bind mount** — bind-mount I/O through WSL2 distorts database timings badly enough to invalidate the results. Enable the slow query log at a 50ms threshold and `long_query_time` logging to a table or file you can read back.
- **redis** — for the Redis-variant runs in Phase 3.
- **queue worker** — one container running the same command as `deploy/queue-worker.service:24`.
- **scheduler** — optional; only if any in-scope measurement needs it.

Then:

1. Point the Laravel `.env` at MariaDB, run migrations, and seed the **same dataset shape** as the prior audit (target the row counts in its "Seed/data shape" table: ~2,939 reports, ~249k report_field_values, ~3.7k evaluations, ~35k evaluation_answers, ~9.9k student_attendance, ~23k morning_attendance, etc.). If the existing seeder can't hit those counts, extend it in `docker/audit/` seeding scripts without touching the main seeder.
2. After seeding, run `ANALYZE TABLE` on all hot tables so the optimizer has real statistics.
3. Record the container resource limits (or note that none are set) and the host specs in the report header. Verify Nginx→FPM→MariaDB serves an authenticated request end-to-end before measuring anything.

---

## Phase 1 — MariaDB query plans (PERF-02, PERF-04, PERF-05)

For each item below, capture `EXPLAIN` **and** `EXPLAIN ANALYZE` output verbatim, with timing, and state a clear verdict.

1. **`student_attendance` GROUP BY (PERF-05).** Run the query from `AcademicOperationsAnalyticsService.php:250-253` as MariaDB executes it. Capture the plan **before** adding any index. Then apply `ALTER TABLE student_attendance ADD INDEX student_attendance_student_present_index (student_id, present);`, re-run `EXPLAIN ANALYZE`, and compare. **Verdict required:** does MariaDB choose the new index, and does it measurably help? If not, drop it and say so plainly — do not keep an index the optimizer ignores.
2. **All-time field-value aggregate (PERF-02).** Capture the plan for the chunked aggregate queries the all-time clinical dashboard issues. Confirm or refute the prior audit's conclusion that this is a "bounded-range problem, not a missing-index problem" on MariaDB specifically. If MariaDB reveals a genuinely missing index, provide the exact `ALTER TABLE` statement and before/after `EXPLAIN ANALYZE`.
3. **Workspace revision UNION (PERF-04).** Capture the full plan for the revision union query on MariaDB. Report per-branch cost, total execution time at current row counts, and — using the prior audit's 1-year and 3-year growth projections — a reasoned estimate of how this query's cost grows. State whether the revision-ledger replacement remains the right fix or whether MariaDB handles the union acceptably.
4. **Evaluation answers eager-load and student evaluations `IN` filter.** Confirm the existing indexes are chosen on MariaDB (the prior audit validated these only on SQLite).

**Deliverable:** a table per query — SQLite conclusion (from prior audit) vs MariaDB plan vs verdict vs action. Any recommended migration must include the exact DDL and its before/after `EXPLAIN ANALYZE` evidence.

---

## Phase 2 — Heavy cold builds re-baselined (PERF-01, PERF-02)

Re-measure ONLY these, through the full Nginx→FPM→MariaDB path, with query logging on:

| Endpoint | Prior SQLite cold figure |
|---|---|
| Academic summary | 881 ms / ~30 MB alloc |
| Academic trend | 1,323 ms / ~30 MB alloc |
| Academic people | 981 ms / ~30 MB alloc |
| Clinical dashboard, all-time | 2,192 ms / 895 ms DB |
| Clinical dashboard, 8 weeks | 189 ms |
| Undergraduate student analytics | 828 ms |
| Workspace, default window | 286 ms |
| Workspace, all-history | 1,107 ms |

Protocol: for each endpoint take one true cold measurement (relevant cache cleared, fresh FPM worker where practical) and 20 warm samples (p50/p95). Also repeat the prior audit's three-concurrent-cold academic requests scenario and report total worker-seconds and aggregate allocation on FPM.

**Deliverable:** a before/after table (SQLite baseline vs MariaDB/FPM) with a one-line interpretation per row. These MariaDB numbers become the official baselines that the PERF-01 aggregate-consolidation fix will later be measured against — label them as such in the report.

---

## Phase 3 — Load testing against the real pool (SCALE-01, PERF-06, SCALE-05, SCALE-07)

First fix SCALE-05 in the harness setup: seed enough distinct user accounts that the test models independent users rather than a shared-session throttle test (the API has a 300 req/min **per-user** limiter — document how the credential count interacts with it). Align the harness VU default with what you actually run.

Run the repository load harness (same endpoint mix as documented) against the Docker stack in this sequence, and run the entire sequence **twice** — once with `CACHE_STORE`/`SESSION_DRIVER`/`QUEUE_CONNECTION` on `database`, once on `redis`:

1. **Baseline:** 10 VUs, 2 minutes.
2. **Expected peak:** 200 VUs, sustained **10 minutes**.
3. **Stress:** ramp from 200 upward until p95 exceeds 2s or errors exceed 1%; record the breaking point in VUs and successful RPS.
4. **Spike:** 0→200 VUs inside 60 seconds, weighted toward workspace hydration and report details (the deadline-day pattern).

During every run, capture at ~10s intervals: host/container CPU and RAM per service; PHP-FPM status (active/idle processes, listen queue, max-children reached events); MariaDB `SHOW GLOBAL STATUS` deltas (Threads_connected, Threads_running, Aborted_connects, buffer pool hit ratio, Created_tmp_disk_tables), slow-log entries, and lock waits; Redis latency (redis runs only); queue depth and oldest-job age.

**Pass gates (same as the prior audit's release gate):** overall errors <1% with no sustained 5xx; workspace p95 <1,000 ms; report-details p95 <1,500 ms; other API p95 <500 ms where practical; FPM listen queue not growing continuously; DB connections below 80% of max; queue oldest-job age within notification SLA.

**Deliverables:**

1. Per-scenario results table (throughput, p50/p95/p99 per endpoint, error rate) for BOTH driver configurations side by side.
2. **The Redis verdict.** Answer explicitly: do the database-backed drivers pass all gates at 200 VUs on this stack? This decides whether Redis is a hard production requirement or an optional optimization for the hospital deployment — the deciding factor is the gates, not the default recommendation.
3. **FPM sizing evidence (SCALE-07):** p95 worker RSS under the 200-VU run, and the resulting recommended `pm.max_children` formula result for the committed 256 MB/worker assumption vs measured reality.
4. The measured breaking point, clearly labeled as "Docker-on-dev-laptop" — with an explicit statement that this validates architecture and degradation behavior, and that the final release gate must run on hardware comparable to the hospital host.

---

## Phase 4 — Report

Write `PERFORMANCE_AUDIT_DOCKER.md`:

1. **Delta summary** — one page: which prior findings are confirmed, revised, or refuted by production-shaped evidence, by finding ID.
2. **Updated findings register rows** — only the in-scope IDs, same table format as the prior audit, with severity re-graded where the MariaDB evidence changes it.
3. **The three verdicts stated plainly:** (a) which index migrations to actually ship, with DDL; (b) whether Redis is required or optional at 200 users; (c) the revised FPM sizing recommendation.
4. **Raw evidence appendix** — all `EXPLAIN ANALYZE` output, load-run JSON paths, and telemetry snapshots.

Rules: do not modify application source, schema (outside the tested index in Phase 1, applied only in the Docker database), or committed deploy configs. Everything you create lives under `docker/audit/`. Do not soften a failed gate — if 200 users fails on this stack, report the number that passed.
