# 14. Developer guide

How the repository is laid out, the conventions the code follows, how to add
a feature end to end, and the traps that have caught people before. Read
[03-ARCHITECTURE](03-ARCHITECTURE.md) first.

## 1. Repository layout

```text
/                        the frontend SPA (Vite, React 19, TypeScript)
├── src/
│   ├── App.tsx                      route table, lazy pages, role guards
│   ├── context/app-data-context.tsx the workspace snapshot, offline replay, save/lock handlers
│   ├── lib/api/                     typed API client per domain (client.ts, reports.ts, workspace.ts, ...)
│   ├── lib/offline/                 IndexedDB save queue and conflict classification
│   ├── lib/observability/           browser error reporter
│   ├── data/selectors.ts            pure derivations (status display, boards, trends)
│   ├── config/                      static template floor, navigation by role, support contact
│   ├── components/                  ui/ (Radix primitives), layout/, dashboard/, reports/, academic/, admin/
│   ├── pages/                       auth/, nurse/, academic/, teaching/, admin/, notifications, report form
│   ├── routes/                      guards, landing per role
│   └── types/domain.ts              the domain types the API contract must match
├── public/                          manifest, service worker (sw.js), redirects for preview hosting
├── tests/e2e/                       Playwright gate; helpers/, fixtures/, pages/
├── tests/regression/                business-logic regression harness
├── tests/smoke/                     production smoke suite
├── scripts/                         run-e2e, start-e2e-backend, load test, capacity/, chaos/, regression/, large-data/
├── deploy/                          nginx, PHP-FPM, systemd units, cron lines, backup, deploy, firewall, logrotate
├── docker/, compose.yaml            parity stack and MariaDB test lane
├── docs/                            this manual set, plus the deep-dive sources
└── backend/                         the Laravel 12 API
    ├── routes/api.php               the entire API surface, one permission per route
    ├── routes/console.php           the scheduler
    ├── app/Http/Controllers/Api/    controllers (Admin/ for /admin routes), Middleware/
    ├── app/Policies/                26 policies + Concerns/HandlesDomainAuthorization
    ├── app/Services/                Reports/, Analytics/, Academic/, Notifications/, Admin/, Operations/, Workspace/
    ├── app/Models/                  44 UUID-keyed models
    ├── app/Support/                 Authorization/Permissions.php, HospitalClock, Reports/, Observability/
    ├── app/Console/Commands/        19 commands
    ├── database/migrations, seeders, factories
    ├── config/reports.php, observability.php, ...
    └── tests/Feature, tests/Unit
```

## 2. Conventions

**Backend**
- Every route declares its permission inline; no convention-based
  registration. Add `Gate::authorize` in the controller as well.
- Validation is inline `$request->validate([...])` accepting both snake and
  camel keys (`required_without` pairs). No Form Request classes.
- Responses are hand-mapped camelCase arrays; admin controllers share
  `SerializesAdminResources`. No API Resource classes.
- Business logic lives in services; controllers call one service and shape
  the answer. Multi-step writes run in `DB::transaction` with
  `lockForUpdate` on the row they change.
- Every admin mutation records an `AdminAuditService::record(...)` row.
- Notifications dispatch after commit.
- Read configuration through `config()`, never `env()` outside `config/`,
  because `config:cache` makes `env()` return null in production.
- Date-only decisions go through `HospitalClock`; timestamps stay UTC.
- Formatting: `vendor/bin/pint`. PHP 8.3 syntax.

**Frontend**
- Files are kebab-case; components and types PascalCase; `@/` maps to `src/`.
- The context owns the workspace snapshot; TanStack Query owns page-scoped
  data. Do not fetch the same thing through both.
- Add every new context handler to both the `value` object and its `useMemo`
  dependency list, or you get stale closures.
- Add new API modules to `src/lib/api/index.ts`; never re-export
  `realtime.ts` (it pulls a 40 KB websocket client into the main bundle).
- Query booleans serialise as `1`/`0`; the client does this.
- Forms: React Hook Form with a Zod schema; the server validates again.
- Pages are lazy; wrap route elements with `renderLazyRoute` and keep the
  charting library out of the login path.
- Status colours and labels come from `StatusBadge` and the `statusLabels`
  map; do not invent new tones.
- Design system: section panels, four-tile summaries, grid-as-table,
  squared corners, the navy/blue/gold palette; `docs/ARCHITECTURE.md` has
  the token table.

**Tests**
- Backend first, with the right role and the wrong role.
- Re-read the database after a mutation.
- Name the rule; cite [02-BUSINESS-RULES](02-BUSINESS-RULES.md).

## 3. Adding a feature end to end

Worked example: an "incident" entity with admin-only CRUD and a page.

1. **Migration** (`backend/database/migrations/2026_10_04_000020_create_incidents_table.php`
   or later; names must sort after `2026_10_04_000010`): UUID primary key,
   `foreignUuid(...)->constrained()`, indexes you will query, identifiers
   under 64 characters.
2. **Model**: `use HasUuids`, `$fillable`, `casts()`, relationships.
3. **Permissions**: constants `INCIDENTS_VIEW` and `INCIDENTS_MANAGE` in
   `Permissions.php`, added to the role arrays that should hold them. Every
   constant auto-registers as a gate.
4. **Policy**: copy `AccessRequestPolicy`, use `HandlesDomainAuthorization`,
   register with `Gate::policy(Incident::class, IncidentPolicy::class)` in
   `AppServiceProvider::boot()`.
5. **Service** for multi-step logic (transaction, audit row, notifications);
   simple CRUD may live in the controller.
6. **Controller** under `Controllers/Api/Admin`: `Gate::authorize` first,
   inline validation, camelCase output, 201 on create, 204 on delete.
7. **Routes** in the `/admin` block with `permission:incidents.view` or
   `permission:incidents.manage`.
8. **Feature test**: create, list, show, update, delete as an administrator;
   403 as a nurse; 401 anonymous; audit row present.
9. **Frontend**: types in `src/lib/api/types.ts`, a module in `src/lib/api/`,
   a TanStack Query hook for the list, a page under `src/pages/admin/`, a
   lazy route in `App.tsx` inside the admin guard, a navigation item in
   `src/config/navigation.ts` for the right workspace.
10. **Authorization matrix**: add the new routes' expectations to
    `tests/regression/authorization-matrix.spec.ts` and rerun it.
11. **Docs**: the rule in `02-BUSINESS-RULES`, the routes in
    `05-API-REFERENCE`, the permission in `reference/ROLES-AND-PERMISSIONS`,
    a changelog line.

## 4. Working with the data model

- Report values are EAV rows; aggregate in SQL and never hydrate
  `report_field_values` for a dashboard (this caused an out-of-memory crash
  once and is guarded by `AnalyticsQueryShapeTest`).
- `submitted_at` means "has been submitted" everywhere; `locked_at` means
  read-only; `status` is derived from those facts plus the history.
- New status-like facts should be columns or history rows, not new enum
  values, unless the workflow genuinely gains a state.
- Anything a later edit could rewrite (a start time, a roster, a form) is
  snapshotted at the moment it matters.

## 5. Working with the frontend data layer

- `loadUserState` fetches `/api/workspace`, merges with what is loaded, and
  reuses a report's cell values only when its `updatedAt` is unchanged.
  `loadReportSummaries` applies the same rule and drops the id from the
  "details loaded" set otherwise, so the form fetches values again. Keep both
  paths in step.
- `ensureReportDetails` loads values on demand; the form shows "Loading saved
  cells" until then and refuses to save before values are loaded.
- The offline replay loop runs under a Web Lock, oldest first, and stops at
  the first offline or authentication failure. Classification of a refusal is
  in `src/lib/offline/report-save-queue.ts` and is unit-tested.
- The revision poll (`/api/workspace/revision`) triggers a refetch when the
  counter changes; do not add per-feature polling.

## 6. Gotchas checklist

1. Opening the app on `127.0.0.1` breaks the cookie session; use `localhost:5173`.
2. `VITE_API_BASE_URL` is the Vite origin locally, never `:8000`.
3. Exports and mail need a running worker; locally start `queue:work`.
4. `QUEUE_WORKER_MODE` is read through `config()`; re-cache after changing it.
5. Server-side authorization is mandatory: `permission:` on the route and
   `Gate::authorize` in the action. Frontend guards are UX.
6. A locked report is read-only for administrators too.
7. Register new policies explicitly with `Gate::policy`; discovery is not
   relied on.
8. `Dev*Seeder` classes never run in production; reference data comes from
   `app:seed-reference-data`.
9. MariaDB caps identifiers at 64 characters and has no transactional DDL.
10. The e2e gate binds 8000 and 5173; stop dev servers first.
11. Status-history order within one second is undefined; separate
    transitions by a second in tests.
12. The weekly deadline makes current-week drafts render as Overdue after
    Monday 10:00; UI tests that assert "Draft" move the deadline for their run.
13. `deploy/` and `docker/` are twins; change both.
14. Never commit `.env` files, screenshots, traces, `test-results`, `output`,
    `artifacts` or `dist`.

## 7. Branches, commits and reviews

- Work on a branch; open a pull request against `main`; CI must be green;
  branch protection requires the five blocking jobs.
- One focused commit per change with a conventional subject
  (`fix:`, `feat:`, `test:`, `docs:`), a body that names the rule and the
  tests, and the co-author line the project uses.
- Before committing: `git status`, `git diff`, `git diff --check`; stage only
  the files that belong to the change.
- Update the owning document and the changelog in the same commit.

## 8. Useful local commands

```bash
npm run dev                                   # Vite with the API proxy
cd backend && php artisan serve               # API
cd backend && php artisan queue:work --queue=analytics,notifications,default
cd backend && php artisan migrate:fresh --seed  # rebuild the development database (about a minute)
cd backend && php artisan route:list --path=api/reports
cd backend && php artisan schedule:list
cd backend && php artisan tinker
npx playwright test --config playwright.regression.config.ts tests/regression/clinical.spec.ts
```
