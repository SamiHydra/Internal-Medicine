# INTERACTION LATENCY AUDIT

**Scope:** page load time and toggle-switch latency, with emphasis on the academic section
**Audit date:** 2026-07-25
**Branch:** `fix/mobile-touch-targets`
**Companion:** `PERFORMANCE_SCALABILITY_AUDIT.md` (2026-07-21) covers schema, indexes, and production-parity concurrency. This document does not repeat that work; it isolates why *interactions* feel slow.

Claims are tagged **VERIFIED** (measured, with the command that produced it) or **REASONED** (read from code, not executed at scale).

> **Status: R1, R2, and R3 step 1 implemented on 2026-07-25.** Sections 2 and 3
> record the original diagnosis and are left unedited so the before/after is
> traceable. Section 8 records what changed and the measured result.

---

## 1. Headline

The slowness is **not** database work. Every analytics service measured runs in 3–524 ms with 3–11 queries and no N+1.

The cost is **fixed per-request overhead multiplied by request count**. Each HTTP request to the API costs roughly **600 ms of pure framework boot** in the current dev setup, and the app issues **29 requests to open the students page** and **7 requests to flip one switch**.

```
7 requests x ~600 ms boot = ~4.2 s   (measured: 3.8 s for one toggle)
```

Fixing the per-request overhead and the request count are independent wins. Both are needed: the overhead is mostly a dev-environment artifact that production largely solves, while the request count is an architectural problem that gets worse with data volume, exactly as reported.

---

## 2. Measurements

### 2.1 One toggle costs seven requests — VERIFIED

Driving the real UI with Playwright against the dev database (72 students, full demo year):

```
=== ONE student toggle: 7 API calls in ~3821 ms ===
  PATCH /api/admin/students/019f895c-...
  GET   /api/admin/student-batches
  GET   /api/admin/students
  GET   /api/admin/subgroup-placements
  GET   /api/admin/rep-assignments
  GET   /api/admin/teaching-sessions
  GET   /api/admin/academic/wards
```

One boolean write triggers a full page reload of six collections, including an 85 KB teaching-sessions payload that the toggle cannot possibly have changed.

### 2.2 Page loads — VERIFIED

| Surface | Wall | API calls | Payload |
|---|---|---|---|
| `/admin/academic/students` | 8.25 s | 29 | 746 KB |
| `/admin/academic` (dashboard) | 13.9 s | 28 | 399 KB |

Slowest individual calls on the students page:

```
5808 ms  225.8 KB  GET /api/workspace?includeProfiles=1...
4762 ms    0.7 KB  GET /api/admin/academic/wards
3710 ms   85.2 KB  GET /api/admin/teaching-sessions
1339 ms  213.9 KB  GET /api/workspace?includeProfiles=0...
```

Note the second and fourth rows: **`/api/workspace` is fetched twice**, 440 KB combined, and a 0.7 KB response took 4.7 s. Both are symptoms of queueing, not of those endpoints being expensive.

### 2.3 The services are fast — VERIFIED

Called directly, in-process, with the query log enabled:

```
analytics/summary      55 ms     5 queries
analytics/trend         3 ms     5 queries
analytics/people        3 ms     5 queries
ops/morning            10 ms     3 queries
ops/teaching          204 ms     8 queries
ops/students          524 ms    11 queries
```

No N+1 anywhere. The 7.3 s that `analytics/people` took in the browser was 3 ms of work plus 7.3 s of waiting.

### 2.4 Per-request overhead is ~600 ms — VERIFIED

`/sanctum/csrf-cookie` performs no authentication and essentially no database work:

```
csrf-cookie -> 0.605 s
csrf-cookie -> 0.707 s
csrf-cookie -> 0.528 s
```

A 646-byte authenticated response (`/api/admin/student-batches`) costs ~0.70 s. That is the floor for *any* request right now.

---

## 3. Root causes, in order of impact

### C1. No opcache under `php artisan serve` — VERIFIED, dev-only

`artisan serve` runs the PHP **CLI** SAPI, where opcache is off by default (`php -i` reports no opcache configuration). Every request recompiles the entire Laravel framework from source. This is the bulk of the 600 ms.

`bootstrap/cache/` contains only `packages.php` and `services.php`: **no `config.php`, no route cache**, so config and route resolution are rebuilt per request too.

Production runs php-fpm (`deploy/nginx.conf`, `fastcgi_pass unix:/run/php/php8.3-fpm.sock`), where opcache is normally on, so this specific multiplier mostly disappears on the department server. It does not disappear locally, and it is why development feels far worse than production will.

### C2. `artisan serve` is single-threaded — VERIFIED, dev-only

The built-in server handles one request at a time. The 28 concurrent requests on the dashboard queue head-to-tail, which is why a 3 ms endpoint reported 7.3 s. php-fpm in production runs a worker pool, so these overlap instead.

**Caveat:** the deploy kit does not pin `pm.max_children` or any pool sizing. With the default pool and a burst of 29 requests per page load per admin, concurrent users will contend. Worth setting explicitly.

### C3. Every mutation refetches the whole page — REASONED (code), VERIFIED (effect)

The pattern, from `src/pages/admin/students-page.tsx`:

```js
onCheckedChange={(active) => void run(`student-${student.id}`, async () => {
  await updateStudent(client!, student.id, { active });
  await load();          // <- six GETs, every time
}, ...)}
```

`load()` refetches batches, students, placements, reps, sessions, and wards in parallel, then replaces all six state slices, re-rendering the whole page.

Spread across the codebase:

| File | `await load()` sites | Endpoints per `load()` |
|---|---|---|
| `src/pages/admin/students-page.tsx` | 10 | 6 |
| `src/pages/admin/evaluation-forms-page.tsx` | 5 | 1 |
| `src/components/admin/morning-sessions-panel.tsx` | 3 | - |
| `src/pages/academic/teaching-attendance-page.tsx` | 1 | 4 |
| `src/pages/admin/duty-roster-page.tsx` | 2 | 2 |
| `src/components/academic/transfer-request-card.tsx` | 2 | - |
| `src/pages/academic/morning-attendance-page.tsx` | 2 | 1 |
| `src/pages/teaching/rep-log-page.tsx` | 1 | 1 |

26 call sites. The students page is the worst offender by a wide margin.

This is the cause that **scales with data**, matching the reported "worse when there is more data": the refetch cost grows with roster size while the actual change stays one boolean.

### C4. `/api/workspace` is a god-endpoint, fetched twice — VERIFIED

`WorkspaceController` returns roles, templates, profiles, assignments, access requests, reporting periods, reports, status history, audit logs, notifications, the academic payload, and reference maps in a single 214 KB response.

The students page fetches it **twice**: once by the app shell (`includeProfiles=0`), then again by `ensureProfileDirectoryData()` (`includeProfiles=1`), which re-downloads all 214 KB of unrelated data to obtain the profile list. See `src/context/app-data-context.tsx:2040`.

Admins additionally re-fetch this payload on a **60 s poll** (`app-data-context.tsx:1170`) and on every window focus.

### C5. Unbounded list endpoints — REASONED

`UndergraduateAdminController::students()` has no limit and no pagination; it returns every student with `->get()`. At 72 students that is 14 KB. At 2,000 it is roughly 400 KB, refetched on every toggle.

`sessions()` is capped at `limit(300)` but still ships 85 KB per call. `placements()` is capped at 200.

### C6. Debug mode — VERIFIED, dev-only

`APP_DEBUG=true` and `LOG_LEVEL=debug` in `backend/.env`. Debug mode collects stack traces and query information on every request. Correct for local work, but it compounds C1.

---

## 4. Recommendations

Ordered by benefit-to-effort. Items 1–3 are the ones that matter.

### R1. Stop refetching everything after a mutation — highest impact

Toggles should update local state from the response they already receive, not reload the page.

```js
// Instead of: await updateStudent(...); await load()
const updated = await updateStudent(client, student.id, { active })
setStudents((prev) => prev.map((s) => (s.id === updated.id ? { ...s, ...updated } : s)))
```

Two cautions learned in this session:

- Several endpoints return **partial** records. `PATCH /teaching-schedules/{id}/active` returns only `{id, active}`. Merge into existing state (`{ ...item, ...patch }`); replacing wholesale drops fields and causes real bugs (that exact mistake produced a spurious "already has this activity" error earlier today).
- Where the server derives values, re-fetch **that one collection**, not all six.

Expected effect: one toggle goes from 7 requests to 1. At the current 600 ms floor that is ~3.8 s to ~0.6 s.

Apply to the 26 sites in the C3 table, starting with `students-page.tsx`.

### R2. Turn on opcache and the caches for local development

Add to the PHP ini used by `artisan serve`:

```ini
opcache.enable=1
opcache.enable_cli=1
opcache.validate_timestamps=1
opcache.revalidate_freq=0
```

`validate_timestamps=1` keeps edits picked up immediately, so this is safe for development.

Then, when not actively editing config or routes:

```bash
php artisan config:cache
php artisan route:cache
```

Remember `php artisan config:clear` before changing `.env`, since cached config ignores it.

Expected effect: the ~600 ms floor should drop substantially. **Measure it before and after** rather than trusting the estimate; the exact gain depends on the machine.

For production, confirm opcache is enabled in the php-fpm pool and consider `opcache.preload` for the framework.

### R3. Split `/api/workspace`

Two changes, in order:

1. **Stop the double fetch.** Give the profile directory its own endpoint (`GET /api/admin/profiles`) so `ensureProfileDirectoryData()` does not re-download 214 KB to read one list. Cheapest real win on the students page.
2. **Break up the payload.** Audit logs, notifications, and report history do not belong in the bootstrap response for every page. Move them behind the routes that display them.

Also reconsider the 60 s admin poll: it re-transfers the full payload for every admin, indefinitely. Focus and visibility refreshes already cover the realistic case.

### R4. Paginate `students()`

Add `limit`/`offset` or cursor pagination, and push the search filter server-side. The client already filters by name and ID; at a few thousand students that filtering should not require shipping the whole roster.

### R5. Pin php-fpm pool sizing in the deploy kit

`deploy/nginx.conf` wires up the socket but nothing sets `pm.max_children`, `pm.start_servers`, or `pm.max_requests`. Given each admin page load bursts ~29 requests, set these deliberately for the department server's core count and RAM.

### R6. Reduce the request burst per page

Even at 50 ms per request, 29 requests is 1.5 s of overhead. The students page fetches six collections up front for six tabs, five of which are not visible. Fetch the active tab's data and load the rest on demand. The academic operations tabs already do this correctly with react-query (`staleTime: 5 * 60 * 1000`) and are a good model to copy.

---

## 5. What was left alone deliberately

- **Indexes and schema.** Covered by `PERFORMANCE_SCALABILITY_AUDIT.md`; nothing in these measurements contradicts it.
- **The analytics services.** Measured fast with no N+1. Optimising them would be wasted effort.
- **The cache warming layer.** Working as intended; `ops/students` showed the cache lookups firing.

---

## 6. Reproducing these numbers

A Playwright probe was added at `tests/e2e/zz-perf-audit.spec.ts`:

```bash
npm run test:e2e -- zz-perf-audit.spec.ts --project=chromium --reporter=line
```

It prints per-request timings and payload sizes for the students page, the academic dashboard, and one toggle, and asserts that a single toggle does not exceed 7 API calls, so R1 regressions surface.

**Two caveats on that spec.** It runs against the freshly-seeded e2e fixture database, which holds less data than the dev database, so its absolute numbers are lower than those in section 2. And the runner recreates `backend/database/e2e.sqlite` and refuses to start if ports 5173/8000 are occupied, so stop the dev servers first.

The section 2 figures came from an ad-hoc probe against the dev database, driving the real UI at `localhost:5173`.

---

## 7. Suggested order of work

1. **R1 on `students-page.tsx`** alone. Biggest single improvement, contained to one file, immediately measurable with the probe.
2. **R2**, then re-measure the 600 ms floor to see what the real per-request cost is.
3. **R3 step 1** (separate profiles endpoint), which removes 226 KB from every admin page load.
4. Re-measure. Decide whether R4, R5, and R6 are still warranted, based on numbers rather than on this document.

---

## 8. Implemented on 2026-07-25 — VERIFIED

### 8.1 Results

| Measurement | Before | After | Change |
|---|---|---|---|
| One student toggle | 3,821 ms, 7 calls | ~400 ms, 1 call | **9x faster** |
| Student subgroup change | 7 calls | 1 call | |
| Batch toggle (activate) | 7 calls | 1 call | |
| Batch toggle (deactivate) | 7 calls | 2 calls | second call is the rep side effect |
| Students page load | 8,251 ms | 2,008 ms | **4.1x faster** |
| Students page payload | 746 KB | 534 KB | −212 KB |
| Academic dashboard load | 13,926 ms | 2,809 ms | **5.0x faster** |
| Per-request floor | ~600 ms | ~100 ms | **6x faster** |

### 8.2 R1 — mutations no longer refetch the page

`src/pages/admin/students-page.tsx`: all 10 `await load()` calls removed. `load()` is now first-mount only; per-collection loaders (`loadBatches`, `loadStudents`, `loadReps`, `loadSessions`) back the mutations. Most toggles update state from the mutation response and issue no follow-up request.

Server-side side effects that a blanket reload used to mask, now handled explicitly:

- Deactivating a batch also deactivates its rep assignments, so that path alone re-reads reps.
- Saving a placement regenerates that week's sessions server-side, so that path re-reads sessions.
- Creating or importing students changes the owning batch's `studentCount`, so those paths re-read batches.
- `cancelTeachingSession` returns `{id, status}` only; the reason is merged from what was sent.

`src/pages/academic/teaching-attendance-page.tsx`: saving attendance refreshed sessions, the student directory, and both evaluation form definitions. Only sessions can change, so it now reloads that one collection (4 requests to 1).

**Backend fix required by this work.** `serializeBatch()` reads `students_count`, which route-model binding never loads, so `PATCH /api/admin/student-batches/{id}` was returning `studentCount: 0`. Any client trusting that response would blank the count. Fixed with `loadCount('students')` in `updateBatch`.

Not changed: `duty-roster-page.tsx` already memoises its second fetch, and the remaining files reload a single collection, which is already minimal.

### 8.3 R2 — opcache enabled for local development

opcache was present but unloaded. Enabled in the WinGet PHP 8.4 `php.ini`:

```ini
zend_extension=opcache        ; was commented out

[opcache-local-dev]
opcache.enable=1
opcache.enable_cli=1
opcache.memory_consumption=192
opcache.interned_strings_buffer=16
opcache.max_accelerated_files=20000
opcache.validate_timestamps=1
opcache.revalidate_freq=0
```

`validate_timestamps=1` with `revalidate_freq=0` means edited files are picked up immediately, so this is safe during development.

**This is a machine-level change, outside the repository, and it will not travel to other developers or to the server.** The original file is backed up alongside it as `php.ini.bak-claude`. Production must be verified separately: confirm opcache is enabled in the php-fpm pool on the department server.

Config and route caching (`php artisan config:cache`, `route:cache`) were **not** applied, since cached config ignores `.env` edits and that trap costs more in daily development than it saves.

### 8.3b R3 step 1 — the profile directory has its own endpoint

`GET /api/workspace/profiles` (`WorkspaceController::profiles`) returns the directory alone. It reuses the same private `profile()` serializer as the workspace payload, so the rows are identical by construction rather than by convention, and visibility matches `show()` exactly: admins see every user, everyone else sees only themselves.

`ensureProfileDirectoryData()` in `src/context/app-data-context.tsx` now calls it and writes `state.profiles` directly, instead of re-running the whole workspace load with `includeProfiles=1`.

`loadUserState` was deliberately **not** touched. Its load-version guard, poll-skip signature, report-detail merge, and cache write are load-bearing, and none of them needed to change for this.

Measured on the endpoint alone: **12.4 KB in 92 ms**, replacing **226 KB in 1,324 ms**.

Correctness checks run against the live server:

- The 50 rows returned are **byte-identical** to `state.profiles` from `GET /api/workspace?includeProfiles=1` (compared as parsed JSON, `a == b`).
- A nurse account receives exactly one profile, itself. No directory leak to non-admins.

Left alone: `ensureUserManagementData()` still uses the workspace path, because Users & Access genuinely needs profiles and access requests together and is a single screen.

### 8.4 Verification

- Frontend unit tests: 85 passed (15 files).
- Backend tests: **full suite**, 324 passed, 1 skipped, 2,234 assertions.
- Typecheck and lint clean.
- Interaction counts re-measured through the real UI with Playwright.
- New endpoint diffed against the payload it replaces, and checked for directory leakage to a non-admin role.

### 8.5 Still open

**R3 step 2** — the remaining `/api/workspace` call is still 214 KB on every page, carrying reports, audit logs, notifications, and status history that most screens never render. Splitting those out is the next meaningful payload reduction.

**R4** — `students()` is still unbounded. It is fine at 72 students and will not be at 2,000.

**R5** — the deploy kit still sets no php-fpm pool sizing.

**R6** — the students page still issues 29 requests on load, fetching all six collections for six tabs when only one is visible. The academic operations tabs already do this correctly with react-query and are the model to copy.

Note on interpreting further dev-lane numbers: `artisan serve` remains single-threaded, so any burst of concurrent requests still queues. A 12 KB endpoint that measures 92 ms alone showed 929 ms inside a 29-request page load. Production runs php-fpm, so treat concurrent dev timings as an upper bound, and prefer **request count and payload size** as the stable signals.
