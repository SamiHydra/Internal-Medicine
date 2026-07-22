# Performance Report — Pre-Deployment QA

> ## ✅ REMEDIATION UPDATE — 2026-06-13 (post-fix)
> **Root cause identified by isolation testing:** `/api/workspace` was never slow on its own (~350ms). The 5s seen on page-load was **SQLite reader/writer lock contention** — with `journal_mode=delete`, the cold analytics aggregation held a shared read lock that blocked the concurrent workspace **session write** (`SESSION_DRIVER=database`).
>
> **Fixes applied:** SQLite **WAL mode** (`config/database.php`) + `synchronous=NORMAL` + 5s busy_timeout; analytics cache TTL **300s→1800s** (`DashboardAnalyticsService`); admin workspace poll **20s→60s** (`app-data-context.tsx`).
>
> **Before → after (concurrent page-load, cold analytics cache):**
>
> | Endpoint | Before | After |
> |----------|-------:|------:|
> | `GET /api/workspace` | ~5076 ms (blocked) | **346 ms** ✅ |
> | `GET /api/analytics/dashboard` (warm) | 276 ms | 260 ms |
> | `GET /api/analytics/dashboard` (cold) | ~5044 ms | ~5790 ms (compute unchanged) |
>
> The admin shell + all non-chart data now load in ~350ms. The analytics **cold-build** (~5.8s of PHP aggregation over ~6.2k field-values) remains but is **non-blocking** and **cached** (invalidated only on data change). Production should use a real DB + Redis (removes contention entirely) and ideally move analytics aggregation into SQL (`GROUP BY … SUM`) — **deferred** here as it would risk the 136 green backend tests. Build chunks confirmed reasonable (charts 114KB gz, admin-dashboard 13KB gz). Sections below are the original audit.

---

# Performance Report — Pre-Deployment QA

Date: 2026-06-13. Measured live with Playwright + Chromium (Navigation Timing, Resource Timing, PerformanceObserver layout-shift, `performance.memory`). Raw: `_raw/pw-perf-metrics.log`, `_raw/static-perdimension.json`.

> **Important caveat:** transfer sizes and request counts below are from the **Vite dev server** (unbundled ES modules, one request per module, unminified). **Production `npm run build` chunks/minifies/tree-shakes** (the config already splits `charts`, `motion`, `radix-ui`, `react-core`, `vendor`). Re-measure on a `vite preview` of the production build for shippable bundle numbers. **Timing and API latency, however, are representative** and are the real story here.

## 1. Measured page metrics

| Page | Wall (load+idle) | FCP | DOMContentLoaded | CLS | JS heap | Notes |
|------|------:|----:|----:|----:|----:|------|
| `/login` | 2318 ms | 464 ms | 324 ms | 0 | 22 MB | Clean. Eagerly pulls `recharts` (1.2 MB) + `admin-dashboard` chunk via dashboard preload |
| `/admin` (clinical) | **7206 ms** | 800 ms | 321 ms | 0.0003 | 58 MB | Shell paints fast; **data-ready blocked ~5 s** by two API calls (below) |
| `/admin/academic` | 2578 ms | 744 ms | 308 ms | 0 | 40 MB | One 1.1 s call (`analytics/people`); otherwise snappy |

**Layout stability is excellent** (CLS 0–0.0003). **First paint is good** (≤800 ms). **Memory is stable** — repeated `/admin ↔ /admin/academic` navigation (6 cycles) did not balloon the heap. **Console: no errors; no failed/5xx requests** on any route.

## 2. Slow API calls (the dominant cost)

| Endpoint | Time | Where | Severity |
|----------|-----:|-------|:--------:|
| `GET /api/analytics/dashboard` | **5044 ms** (5478 ms in the API spec) | admin dashboard first load | **High** |
| `GET /api/workspace` | **5076 ms** | admin shell bootstrap (and every 20 s poll) | **High** |
| `GET /api/academic/analytics/people` | 1120 ms | academic dashboard | Medium |

The clinical admin dashboard cannot be usable until **both** ~5 s calls resolve. On a single SQLite connection these heavy reads may also serialize, compounding the wall time. This will worsen as report history accumulates.

## 3. Findings & fixes, ranked by impact

1. **[High] All-time analytics aggregates full history in PHP memory.** `AnalyticsService::reports()` eager-loads `fieldValues` for every report and runs sums/averages/rollups in PHP with no `LIMIT`. → Push aggregation into SQL (`GROUP BY … SUM(value_number)`), require/default a bounded date range, add a defensive cap. *(BUG-H3)*
2. **[High] `/api/workspace` rebuilds the entire payload every call (~5 s) and is polled every 20 s.** ~10 queries (reports up to `limit(10000)`, 100 notifications, all profiles/assignments) re-serialized with no `ETag`/`If-None-Match`/fingerprint. → Add a `max(updated_at)` fingerprint → `304`/empty when unchanged, or a lightweight `/workspace/since` poll. Split the heavy report payload out of the bootstrap. *(BUG-M5)*
3. **[Medium] Admin users list is unpaginated and bundled into the workspace bootstrap.** → Paginate + server-side search (`q` exists); lazy-load the directory. *(BUG-M6)*
4. **[Medium] Academic analytics also aggregates in PHP** (`AcademicAnalyticsService`), 1.1 s today, same growth pattern. → SQL aggregation. *(BUG-L8)*
5. **[Medium] Eager chart/animation libraries on first paint.** `recharts` (1.2 MB raw), `framer-motion` (485 KB), `lucide-react` (795 KB) are pulled during login (dashboard preload) and the admin dashboard is a single ~2786-line route chunk importing recharts eagerly. → Lazy-import recharts at the chart boundary; split the admin dashboard; reconsider preloading both dashboards from `/login`. *(BUG-L14)*
6. **[Low] No list virtualization** for potentially large feeds (audit log, submissions, academic submissions). → Add windowing (`react-window`/virtua) when rows can exceed a few hundred.
7. **[Low] XLSX import has no row/cell cap.** → Cap rows/cells to bound memory/CPU on import. *(BUG-L5)*

## 4. What's already good

- Route-level code splitting via `React.lazy` for every page; `manualChunks` separates charts/motion/radix/react-core/vendor.
- `DashboardAnalyticsService` has a 300 s cache + request-scoped memo + cheap `dataFingerprint` — the right pattern; the gap is that the raw `AnalyticsService` cold-build and `/api/workspace` don't use it.
- Excellent CLS and stable memory across repeated navigation.
- Service worker stamps a content-hash cache key on build (stale-shell protection).

## 5. Recommended verification before deploy

- Run `npm run build && npx vite preview` and re-measure bundle transfer (the dev 7 MB/100-request figures are not shippable numbers).
- Re-measure `/api/analytics/dashboard` and `/api/workspace` against a **larger** seeded dataset to size the growth curve before go-live.
