# 03. Architecture

How the pieces fit together and why they are shaped that way. The deep
component-level reference (every controller, service, table and design token)
is `docs/ARCHITECTURE.md`; the plain-language narrative is
`docs/TECHNICAL_OVERVIEW.md`. This guide is the current, condensed map.

## 1. Shape

A **React single-page application** talks to a **Laravel REST API**. The
browser never touches the database; the server never renders HTML pages.

```text
Browser (React 19, TypeScript, Vite 8, Tailwind v4, Radix)
   │  fetch /api/* and /sanctum/*  with the session cookie + X-XSRF-TOKEN
   ▼
nginx (one HTTPS origin, im.hospital.internal)
   ├─ /            → dist/ (built SPA, service worker shell)
   ├─ /up          → Laravel liveness
   └─ /api /sanctum → PHP-FPM 8.3 (Laravel 12)
                        ├─ routes → middleware → controllers → policies → services → models
                        ├─ MariaDB 11.4 (sessions, cache, queues, all domain data)
                        ├─ queue workers: analytics,default and notifications,default
                        └─ scheduler: cron runs schedule:run every minute
```

In development, Vite serves the SPA on `localhost:5173` and proxies `/api` and
`/sanctum` to `php artisan serve` on `127.0.0.1:8000`, so the browser still
sees one origin.

### The same-origin constraint

Authentication is a Sanctum SPA cookie session. The session cookie is
`HttpOnly` and `SameSite=Lax`, so the browser only sends it to the same site.
`localhost` and `127.0.0.1` are different sites to a browser, which is why the
frontend must always be opened on the origin named in `VITE_API_BASE_URL` and
why the dev proxy exists. Do not "simplify" this away; every login problem
that looks like CSRF starts here.

## 2. Backend layers

| Layer | Responsibility | Never does |
|---|---|---|
| `routes/api.php` | Declares every endpoint and the permission it needs, inline | Logic |
| Middleware | `auth:sanctum`, `active`, `password-changed`, `permission:<key>`, throttles, revision token | Business decisions |
| Controllers (`app/Http/Controllers/Api`) | Validate input (inline `$request->validate`, snake and camel keys), call a gate and one service, shape camelCase JSON | Business rules |
| Policies (`app/Policies`, 26) | Per-record authorization via `Gate::authorize` | Data access |
| Services (`app/Services`) | All business logic: reports, locking, quality, alerts, import, analytics, academic roster, sessions, transfers, forms, notifications, admin | HTTP |
| Models (`app/Models`, 44, UUID keys) | Table mapping and relationships | Decisions |

Services are grouped by domain: `Reports/`, `Analytics/`, `Academic/`,
`Notifications/`, `Admin/`, `Operations/`, `Workspace/`. A change to evaluation
scoring cannot touch clinical reporting because they never share a file.

### Authorization in four layers

1. Route middleware maps a permission string to roles (static matrix in
   `Support/Authorization/Permissions.php`; 403 before the controller runs).
2. `Gate::before` denies everything for inactive users.
3. Policies narrow per record (owner, lock state, section head, designated
   recorder, representative scope).
4. Query scoping filters listings by workspace and ownership.

The frontend's role checks are decorative; deleting the entire frontend would
not weaken security. See [06-SECURITY-AND-AUTHORIZATION](06-SECURITY-AND-AUTHORIZATION.md).

## 3. Frontend layers

| Piece | Role |
|---|---|
| `src/App.tsx` | Route table; every page lazy-loaded; guards by role; role landing pages |
| `src/context/app-data-context.tsx` | The workspace snapshot: current user, assignments, periods, reports, settings, notifications; the offline replay loop; lock and save handlers |
| TanStack Query | Page-scoped server data: analytics slices, directories, admin lists; cleared on sign-out |
| `src/lib/api/*` | Typed API client per domain; CSRF priming; `credentials: include`; 401/419 self-heal; boolean query params as 1/0 |
| `src/data/selectors.ts` | Pure derivations: status display (draft past deadline shows Overdue), boards, trends |
| `src/lib/offline/*` | IndexedDB save queue and conflict classification |
| `src/config/templates.ts` | Static floor of templates and departments; the database overlay is applied at parse time |
| `src/components/reports/report-form.tsx` | The weekly grid: autosave, validation, lock state, conflict panel |

Convention: the context owns the workspace snapshot; Query owns everything
page-scoped.

## 4. Data model in brief

All domain tables use UUID primary keys. Report values are stored as
entity-attribute-value rows (`report_field_values`: report, field definition,
day, typed value columns) so administrators can add or retire fields without a
migration. Calculated metrics are stored on save. Reporting periods are rows.
Evaluation forms and their fields are rows with versions; answers reference
the version. Full detail: [04-DATABASE-DESIGN](04-DATABASE-DESIGN.md).

## 5. Freshness without websockets

A single `workspace_revisions` row holds a counter; database triggers on
every domain table increment it on insert, update and delete, so bulk writes
and imports are never missed. The browser polls one tiny endpoint,
`GET /api/workspace/revision`, authenticated by a short-lived signed token
issued at bootstrap (no session lookup per poll), every 60 seconds with jitter
and every 5 minutes when the tab is hidden. When the number changes the
workspace is refetched. The counter is global: a write anywhere refreshes
everyone, which wastes an occasional fetch but can never miss a change.

Laravel Reverb and Echo are wired but disabled by default; the launch checklist
says to leave them off unless a websocket server is actually hosted.

## 6. Analytics engine

The EAV layout makes every aggregate query heavier than a column read, so four
techniques pay that cost down:

1. **Aggregate in SQL.** Sums and groupings run in the database; PHP receives
   totals. Loading raw values into PHP caused an out-of-memory failure on the
   "all time" range and that path is closed.
2. **Content-stamped cache keys.** `analytics:v3:{operation}:{hash(row_count|latest_updated_at)}`.
   New data produces a new key; there is no invalidation to forget.
3. **Lock on build.** Concurrent cold requests share one computation.
4. **Background warming.** After a write a unique queued job rebuilds the
   recently viewed slices.

Exports are queued jobs, never built inside a web request, written through a
spreadsheet-injection-safe writer.

## 7. Background work

| Queue | Carries | Worker |
|---|---|---|
| `analytics` | Export building, dashboard warming | `imreport-queue.service` (`analytics,default`) |
| `notifications` | E-mail and SMS delivery, digests | `imreport-queue-notifications.service` (`notifications,default`) |
| `default` | Everything else | both |

`QUEUE_WORKER_MODE=daemon` on the server disables the scheduler's per-minute
fallback worker (used on shared hosting). The scheduler runs about twenty
commands pinned to hospital time with a 10-minute overlap lock, and writes a
heartbeat to the cache every minute so a dead cron shows up as a stale key.
The list is in [09-OPERATIONS-MANUAL](09-OPERATIONS-MANUAL.md).

Failed jobs are retried only when recent and transient, at most once per job.
Notifications dispatch after the database transaction commits.

## 8. Offline and continuity

The service worker caches the application shell (never API responses) under
a cache name derived from the built asset names, so every deploy purges the
old shell. Report saves made offline go to an IndexedDB queue, replay on
reconnect through the ordinary API with the ordinary authorization, and are
parked for review on a real refusal (lock, stale copy, retired assignment)
rather than retried forever. For long outages, administrators export a
spreadsheet template, edit it offline and import it back through the same
validated path. See [workflows/OFFLINE-SYNC](workflows/OFFLINE-SYNC.md).

## 9. Observability

Every response carries `Server-Timing`; slow requests, exceptions, 5xx
answers, failed jobs and browser errors are logged with the release SHA,
counted for the Maintenance health view, and optionally forwarded to a
webhook. Nothing clinical is ever collected. See
[11-MONITORING-AND-OBSERVABILITY](11-MONITORING-AND-OBSERVABILITY.md).

## 10. Deployment shape

One Ubuntu server. `deploy/deploy.sh` builds an immutable release directory,
verifies, backs up, migrates in maintenance mode, switches a symlink, checks
readiness, and rolls back automatically on failure. Host configuration (nginx,
PHP-FPM pool, two systemd units, logrotate, firewall, backup script) is
versioned under `deploy/`. Docker is for parity testing only. See
[07-INSTALLATION-AND-DEPLOYMENT](07-INSTALLATION-AND-DEPLOYMENT.md) and
[15-RELEASE-AND-ROLLBACK](15-RELEASE-AND-ROLLBACK.md).

## 11. Principles the code keeps returning to

- Fail loudly: debug mode in production refuses to boot; a dead scheduler shows as a stale heartbeat; a bad deploy rolls back.
- Snapshot what a later edit could rewrite: session start times, attendance rosters, form versions.
- Make the correct thing structural: triggers over remembered events, content-stamped keys over invalidation, unique constraints over application checks.
- Server-side truth, client-side convenience: every validation exists twice and only the server's is trusted.
- Configurable where the department needs to change it; locked where a change would corrupt history.
- One guarded path per operation: live saves and spreadsheet imports share the submission service.
