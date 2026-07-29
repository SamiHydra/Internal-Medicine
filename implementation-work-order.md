# Implementation Work Order: Post-Audit Fixes

> **Context for the agent:** Two audits are complete: `PERFORMANCE_AUDIT.md` (2026-07-28, SQLite/dev baseline) and `PERFORMANCE_AUDIT_DOCKER.md` (2026-07-29, production-shaped Nginx + PHP 8.3 FPM + MariaDB 11.4 verification). Read both before writing any code. This work order implements every accepted recommendation. Unlike the audits, you WILL modify application source, migrations, and the load harness here — but follow the sequencing exactly, keep each work item as its own commit (or small commit series) referencing its finding ID, and re-verify against the Docker audit stack where instructed. The Docker audit stack in `docker/audit/` and its seeded MariaDB named volume are the verification environment — reuse them, do not rebuild from scratch.
>
> **Official baselines to beat** (from `PERFORMANCE_AUDIT_DOCKER.md`, cold through Nginx/FPM/MariaDB): academic summary/trend/people 669/873/658 ms; three concurrent cold academic requests = 2.139 FPM worker-seconds and 3 workers; clinical all-time 2,940 ms; workspace default 234,840 bytes (SQLite run) / 224,109 bytes (Docker run); admin dashboard early-click transition 1,217 ms p50 / 1,358 ms p95; mobile login LCP 3,166 ms.

**General rules for every work item:**
- No behavior change for end users except speed, unless the item explicitly says otherwise.
- Every item ships with a regression test (query-count, payload-size, or timing assertion) so the fix cannot silently regress. Extend the existing patterns in `backend/tests/Feature/AnalyticsQueryShapeTest.php` and `check-performance-budget.mjs`.
- After Phases 1–3 are complete, rerun the scoped verification in Phase 6 before considering the work done.
- Do not add Redis. The Docker audit ruled it optional; the database drivers are the accepted production configuration. (See Phase 5 for the decision record you'll write instead.)

---

## Phase 1 — Small, low-risk items (land these first, one commit each)

### 1.1 PERF-05 — Ship the attendance index

Create a migration adding:

```sql
ALTER TABLE student_attendance
  ADD INDEX student_attendance_student_present_index (student_id, present);
```

MariaDB will treat this composite as satisfying the `student_id` foreign-key indexing requirement and may drop/replace the redundant single-column FK index. Handle this explicitly in the migration (and its `down()`), so the schema is deterministic on both a fresh install and an upgraded database. Verify the migration runs cleanly twice (up, down, up) against the Docker MariaDB. Also confirm it is a no-op-safe pattern on SQLite so the local dev/test environment still migrates.

**Acceptance:** `ANALYZE FORMAT=JSON` on the student-attendance GROUP BY (query at `AcademicOperationsAnalyticsService.php:250-253`) shows the new covering index chosen, no `Using temporary; Using filesort`. Audit evidence expects ~47% median improvement.

### 1.2 SCALE-05 — Port the harness corrections into the repository

Apply the audit harness's corrections to `scripts/load-test.mjs` and `docs/LOAD_TESTING.md`:

1. One distinct account, cookie jar, and session per VU (no shared sessions). Document the account-seeding requirement and how VU count interacts with the 300 req/min per-user API limiter.
2. Align the script's VU default with the documentation (make both 200, or both explicitly configurable with the same documented default — no silent mismatch).
3. Exclude setup/login/prime traffic from measured results.
4. Report successful RPS separately from attempted requests and timeouts.
5. Document the standard mix and spike mix percentages actually used by the Docker audit so future runs are comparable.

**Acceptance:** a 10-VU smoke run of the corrected harness against the Docker stack completes and its summary output shows per-endpoint p50/p95, successful RPS, and error rate in the same shape as `docker/audit/evidence/run-summary.json`.

### 1.3 NAV-02 — Mobile login LCP

Target: login LCP < 2,500 ms on the Lighthouse mobile profile (currently 3,166 ms).

1. Identify the login page's actual LCP element first; optimize that, not a guess.
2. Trim/inline the critical CSS the login route needs from the 134 KB global stylesheet; defer the rest.
3. Audit the ~118 KB raw `proxy` chunk: determine what pulls it into the initial graph and whether the login route can avoid it.
4. Preload the logo only if it is the LCP element.

**Acceptance:** Lighthouse mobile run on the production build: LCP < 2.5 s, CLS < 0.1, no regression to the desktop score. Record before/after numbers in the commit message.

### 1.4 Regression guardrails bundle (small CI additions)

1. **Payload contracts:** feature tests asserting default workspace response < 200 KB (this will fail until Phase 3.1 lands — mark it appropriately until then, e.g. an expected-failure/skip with a TODO referencing PERF-03), eight-week dashboard < 100 KB, and fixed page sizes on paginated list endpoints.
2. **Bundle budget:** add per-chunk limits to `check-performance-budget.mjs`; lower the initial gzip warning threshold to 245 KB.
3. **Lighthouse CI:** mobile login + authenticated shell with budgets LCP < 2.5 s, CLS < 0.1, TBT < 200 ms.
4. **Web Vitals RUM:** lightweight client-side collection of LCP, INP, CLS, route-transition duration, route name, device class, and release SHA, posted to a small authenticated endpoint and stored without any patient/report content. Keep the payload minimal; sample if needed.

---

## Phase 2 — The big backend fix

### 2.1 PERF-01 — Consolidate the academic analytics build

This is the highest-impact change. Today, `academic-dashboard-page.tsx:278-350` issues three requests (summary, trend, people) and each cold request independently hydrates the same evaluation graph via `AcademicAnalyticsService.php` `rows()` (~30 MiB each, three FPM workers per cache-miss page view).

Design:

1. Build **one cached aggregate snapshot per filter set** (the snapshot contains everything summary, trend, and people need). One cache key, one build, content-stamped like the existing five-minute academic cache.
2. Serve all three views from the snapshot. Preferred shape: a single endpoint returning all three sections, with the frontend making one request; acceptable alternative: keep three endpoints but have all three read the shared snapshot so a miss builds it exactly once (use a cache lock so concurrent misses don't stampede — only one worker builds, others wait).
3. Warm the snapshot after evaluation writes (extend the existing warm-job pattern, keep it queued and unique).
4. Update the frontend accordingly; preserve existing loading states and filter behavior. No visual change.

**Acceptance (measured on the Docker stack, cold, cache flushed):**
- One cold academic dashboard page view consumes **one** worker-build (≤ ~900 ms total build) instead of three; concurrent-request worker-seconds drop from 2.139 to roughly a third or better.
- Warm p95 stays ≤ 40 ms per view (current warm numbers are 35–37 ms — do not regress warm reads to fix cold ones).
- Aggregate allocation for a cold page view drops from ~90 MiB (3×30) toward a single ~30 MiB build.
- Add a query-shape test asserting the snapshot build's query count, and a test asserting a second view read after a cold build performs no graph hydration.

### 2.2 PERF-02 — Bound interactive dates; move all-time off the request path

1. Interactive clinical analytics endpoints must require a bounded date range. Enforce a server-side maximum window (choose a sensible cap, e.g. 26 or 52 weeks — check what the UI offers and cap just above its largest bounded option). Reject or clamp unbounded requests with a clear error/response the frontend handles.
2. The "all-time" need becomes an **export**: a queued job that streams the CSV using the existing `AnalyticsExportService` cursor/streaming patterns, notifies the user on completion via the existing notification system, and stores the file for authenticated download. No interactive request may aggregate the full history.
3. Frontend: replace any all-time interactive view with the bounded ranges + "Export full history" action with clear queued-job UX.
4. Bound the academic operations analytics the same way: teaching analytics (`AcademicOperationsAnalyticsService.php:129-140`) must not load every historical session — bound it by academic year/date range; apply the same bound to the student-analytics evaluation/attendance loads where semantically valid. The Docker plan review concluded the evaluation-answers cost is a selectivity problem fixed by bounding the academic time range, not by adding an index — this item is that fix.
5. Optional, only if the department actually uses archive views frequently (check with the owner before building): weekly rollup/materialized aggregate tables maintained on report finalization.

**Acceptance:** no interactive analytics route can trigger the 2.9 s all-time build; the export job completes against the seeded 249k-row dataset within the queue worker's timeout while streaming (bounded memory — assert peak under 64 MiB); a feature test proves the date-window clamp on clinical, teaching, and student analytics endpoints alike.

---

## Phase 3 — Payload and perceived-latency fixes

### 3.1 PERF-03 — Trim the workspace bootstrap payload

Target: default `/api/workspace` response < 200 KB (currently ~224–235 KB, growing linearly; all-history variant reached 1.8 MB on SQLite seed).

1. Make workspace hydration identity + reference data only: current user, roles/permissions, departments, templates/fields, the **latest bounded period window** only, and compact profile fields. Audit every collection in `WorkspaceController.php` (`:93`, `:131-158`) — remove the up-to-10,000-report inclusion and the all-periods list.
2. Reports, historical periods, and admin profile lists move to the paginated per-page endpoints that already exist (or add pagination where Phase 1.4's contracts require it: admin users, report assignments, students — this also closes SCALE-02's worst cases).
3. Keep the revision-poll rehydration contract working: trimming the payload must not break the 60-second revision check in `app-data-context.tsx:1145-1199`.
4. Frontend: update the app-data context to fetch what pages need when they need it. Watch for pages silently depending on workspace-carried data — grep consumers of the context before removing fields.

**Acceptance:** the Phase 1.4 payload contract test now passes (< 200 KB); no page regression (run the full frontend test suite plus a manual click-through of every module); workspace warm p95 does not regress above current 191 ms; the all-history variant either no longer exists or returns bounded data.

### 3.2 NAV-01 — Fix the admin dashboard early-click stall

Target: Dashboard → Submissions clicked immediately after shell render: p95 < 400 ms (currently 1,358 ms; settled navigation is already 238 ms).

1. First capture a React Profiler / main-thread trace of dashboard startup to identify the actual blocking work — fix what the trace shows, not assumptions.
2. Expected levers, per the audit: render below-fold charts only when visible (IntersectionObserver / lazy mount), yield between dashboard sections so navigation clicks can interleave, memoize derived chart series, and keep Recharts mounting off the critical first paint.
3. Do not degrade the settled experience: dashboard → users/audit/settings must stay under their current ~160–195 ms p95.

**Acceptance:** rerun the Playwright click-path protocol from the first audit (10 runs, production build): early-click p95 < 400 ms, settled Submissions p95 ≤ 250 ms, other transitions unchanged. Add the navigation smoke thresholds to CI per the guardrails table.

---

## Phase 4 — Medium-term scale items (implement now while context is fresh)

### 4.1 PERF-04 — Replace the revision-union scan with a revision ledger

The 19-branch UNION costs 11 ms today but grows linearly with retained facts and is multiplied by every polling tab (projected 40–50 ms per poll at +3 years).

1. Maintain a single workspace revision value: either one transactional row bumped by writes to any workspace-relevant table (model observers or a shared service call at the write sites), or a cached global version key invalidated on those writes. Choose the approach that guarantees correctness under concurrent writes — the poll must never miss a change.
2. `/api/workspace/revision` reads that single value.
3. Add jitter (±10–15 s) and backoff-when-hidden to the frontend poll.
4. Keep the old union query behind a temporary verification path or test that cross-checks ledger bumps against actual table changes for the write paths, then remove it.

**Acceptance:** a feature test proving every workspace-mutating write path bumps the revision; revision endpoint p95 < 20 ms warm; poll behavior verified in the browser (change data in one tab, second tab picks it up within one poll interval).

### 4.2 SCALE-03 — Named queues and worker layout

1. Split jobs onto named queues: `notifications` (mail/SMS deliveries, digests), `analytics` (dashboard warms, the new all-time export), `default` (everything else).
2. Update `deploy/queue-worker.service` (or add a second unit) so at least the layout supports two supervised workers with an explicit queue priority order; document the single-worker fallback for the smallest install.
3. Add queue depth and oldest-job-age to whatever monitoring hook exists (at minimum, a scheduled command that logs/alerts on thresholds).

**Acceptance:** jobs dispatch to the correct queues (test per job class); a slow notification job cannot delay an analytics warm when two workers run.

---

## Phase 5 — Documentation and decision records (no code)

1. **Redis decision record** (`docs/decisions/redis-optional.md`): database-backed cache/session/queue is the accepted production configuration; evidence: 200-VU/10-min pass at 224.38 RPS zero errors (`docker/audit/evidence/runs/database/peak-200vu-10m-r1/`). If Redis is ever adopted for headroom (+5.8% RPS, ~22% p95 improvement measured), persistent connections are **mandatory** — the non-persistent shape failed at 6.62% errors from client ephemeral-port exhaustion (`runs/redis/peak-200vu-10m/`).
2. **FPM sizing note** (`deploy/README.md` addition): keep 20 children on comparable hardware; formula `max_children = min(floor(PHP_RAM_budget / (p95_RSS × 1.25)), floor(max_connections × 0.8) − reserved, CPU/load-tested cap)`; measured p95 worker RSS ~47 MiB; the committed 256 MiB figure is an allocation limit, not observed RSS; CPU is the binding constraint — never raise children from memory math alone.
3. **Deadline-spike note:** record that the 0→200-in-60s spike passes error gates but sustains FPM queueing; mitigations are the Phase 2/3 fixes plus (operationally) staggered submission deadlines — flag the staggering option as a question for the department.
4. **Retention question:** a short doc listing what grows unboundedly (report_field_values, evaluations/answers, attendance) with the audit's 1-/3-year projections, framed as a policy question for the department to answer in writing. Do not implement archival until they answer.

---

## Phase 6 — Verification gate (after Phases 1–3, repeat after Phase 4)

Run against the existing Docker audit stack (reuse the seeded volume; restart services, flush caches, re-run `ANALYZE TABLE` if the schema changed):

1. **Scoped cold/warm re-baseline** of the eight endpoints from `PERFORMANCE_AUDIT_DOCKER.md` "Official cold/warm baselines", same protocol (one true cold + 20 warm samples). Produce a before/after table against the official baselines.
2. **Concurrent cold academic page view:** worker-seconds and aggregate allocation vs the 2.139 s / ~90 MiB baseline.
3. **Corrected harness runs:** 10-VU baseline, 200-VU/10-min peak, 200-VU spike — database drivers only. All prior pass gates must hold; the expectation is that peak p95s improve (workspace should drop with the smaller payload) and the spike's sustained FPM queue shrinks.
4. **Frontend checks:** Lighthouse mobile login, the Playwright navigation protocol, and the bundle budget.
5. Write `PERFORMANCE_FIXES_VERIFICATION.md` summarizing every acceptance criterion above with pass/fail, the before/after tables, and evidence paths. Any failed criterion blocks completion — fix and re-run, do not soften.

One extra, cheap and high-value: rerun only the 200-VU/10-min peak with the app service constrained to hospital-plausible CPU (e.g. `cpus: "8"` on the FPM container) and record whether the gates still pass. This is the early-warning proxy for the final hospital-hardware release gate, which remains mandatory before go-live and is out of scope for this work order.

---

## Sequencing summary

1. Phase 1 (four independent small commits) → 2. Phase 2.1 (biggest win) → 3. Phase 2.2 → 4. Phase 3.1 → 5. Phase 3.2 → 6. Phase 6 verification → 7. Phase 4 (both items) → 8. Phase 6 again (quick re-check: revision endpoint, one 200-VU peak) → 9. Phase 5 docs (can be written any time, must exist before completion).

Do not reorder Phases 2–3 after Phase 6's first run: the verification baselines assume the fixes land before measurement. Keep the audit stack's evidence directories untouched — new verification evidence goes under `docker/audit/evidence/post-fix/`.
