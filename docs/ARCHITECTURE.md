# System Overview

**St Paul's Internal Medicine Weekly Reporting** is a hospital clinical-operations reporting platform. Nurses are assigned to (department × report-template) pairs; each ISO week a *reporting period* opens, and assigned nurses fill in per-day field values for their departments. Reports move through a status lifecycle (draft → submitted → edited-after-submission → locked); the system computes inpatient bed metrics (BOR / BTR / ALOS), aggregates analytics across three service-line "families" (inpatient / outpatient / procedure), raises overdue and critical-event alerts, and maintains two audit trails. Admins (superadmin / admin) review submissions, lock/unlock reports, manage users, departments, templates, and settings, and view aggregated analytics dashboards.

**Tech stack.** A **React 19 + TypeScript + Vite 8** single-page app talks to a **Laravel API** in `backend/`. Authentication uses **Laravel Sanctum SPA cookie sessions**. TanStack Query owns remote server state while `AppDataContext` retains the existing cross-domain workspace model. UI is Tailwind CSS v4 over Radix primitives. The data store is SQLite locally and MariaDB in production. V2 production runs the SPA and API from one Nginx HTTPS origin on the hospital LAN.

```
                              Browser (SPA, http://localhost:5173)
                              ┌───────────────────────────────────────────────┐
                              │  React 19 + Vite + TypeScript                   │
                              │  AppDataProvider (single context store)         │
                              │  LaravelApiClient (fetch wrapper)               │
                              │    - credentials: 'include'                     │
                              │    - X-XSRF-TOKEN header on unsafe methods      │
                              └───────────────────────────────────────────────┘
                                        │  /api/*  and  /sanctum/*
                                        │  (same-origin to the browser)
                                        ▼
                              ┌───────────────────────────────────────────────┐
                              │  Vite dev proxy (vite.config.ts)                │
                              │   /api      -> http://127.0.0.1:8000            │
                              │   /sanctum  -> http://127.0.0.1:8000            │
                              │   changeOrigin: false                          │
                              │  (keeps SameSite=lax cookies "same-site")       │
                              └───────────────────────────────────────────────┘
                                        │  server-side forward
                                        ▼
                              ┌───────────────────────────────────────────────┐
                              │  Laravel API (http://127.0.0.1:8000)            │
                              │   bootstrap/app.php: statefulApi() +            │
                              │     EnsureFrontendRequestsAreStateful           │
                              │   Sanctum (web guard, session driver)           │
                              │   auth:sanctum -> active -> permission:<key>    │
                              │   Controllers -> Policies / Gates -> Services   │
                              └───────────────────────────────────────────────┘
                                        │  Eloquent (HasUuids)
                                        ▼
                              ┌───────────────────────────────────────────────┐
                              │  Database (SQLite local / MariaDB prod)         │
                              │   sessions table holds server-side auth state   │
                              └───────────────────────────────────────────────┘
```

In production there is no Vite proxy. Nginx serves the SPA and Laravel from the same origin, and `VITE_API_BASE_URL` points at that origin.

---

# Repository Layout

```
/  (frontend SPA - repo root)
├── src/
│   ├── main.tsx                     # React 19 createRoot entry; mounts <AppProviders><App/></AppProviders>
│   ├── App.tsx                      # BrowserRouter + full route table; HomeRedirect; lazy routes
│   ├── app/providers.tsx            # AppProviders = AppDataProvider + <Toaster/> (sonner)
│   ├── routes/route-guards.tsx      # ProtectedRoute (auth + role), ProtectedShell (renders AppShell)
│   ├── context/app-data-context.tsx # THE data hub: AppDataContext + AppSyncContext, all handlers
│   ├── lib/
│   │   ├── api/                     # hand-rolled typed API client (per-domain modules + barrel)
│   │   ├── app-state.ts             # createEmptyAppState(), defaultAppSettings
│   │   ├── metrics.ts               # computeWeeklyValue and numeric helpers
│   │   └── utils.ts                 # cn() = clsx + tailwind-merge
│   ├── types/domain.ts              # core TS domain types (UserProfile, ReportRecord, AppState, ...)
│   ├── data/selectors.ts            # pure derivations over AppState (dashboards, status, trends)
│   ├── config/
│   │   ├── templates.ts             # static report-template + department catalog (slug-based)
│   │   ├── navigation.ts            # navigationByRole nav items
│   │   └── support.ts               # technical-support contact (name + phone)
│   ├── components/
│   │   ├── ui/                      # shadcn/Radix primitives (Button, Card, Badge, Input, ...)
│   │   ├── layout/                  # app-shell, app-state-screen, page-header
│   │   ├── dashboard/               # ChartCard, StatusBadge, InsightPanel, SubmissionBoardGrid
│   │   ├── admin/                   # AdminPageHero, ReportingScopePanel
│   │   └── reports/                 # report-form, report-assignment-card
│   ├── pages/                       # route components (auth/, nurse/, admin/, top-level)
│   ├── assets/                      # logo image(s)
│   ├── index.css                    # Tailwind v4 @theme tokens, fonts, aurora bg, keyframes
│   └── test/setup.ts                # Vitest jsdom setup
├── public/manifest.webmanifest      # PWA manifest (theme #002147, "St Paul's")
├── index.html                       # PWA shell
├── vite.config.ts                   # proxy, alias @ -> src, manualChunks, vitest config
├── wrangler.toml                    # Optional Cloudflare preview build config only
├── package.json
│
├── backend/  (Laravel API)
│   ├── bootstrap/app.php            # middleware wiring: statefulApi(), aliases active/permission/role
│   ├── routes/
│   │   ├── api.php                  # the entire /api surface
│   │   ├── web.php                  # welcome view + /up health check
│   │   └── console.php              # scheduler: reports, queue health, and shared-host queue drain
│   ├── app/
│   │   ├── Http/
│   │   │   ├── Controllers/Api/         # AuthController, WorkspaceController, ReportWorkflowController, ...
│   │   │   ├── Controllers/Api/Admin/   # UserController, ReferenceDataController, SettingsController, ...
│   │   │   ├── Controllers/Api/Concerns/SerializesAdminResources.php  # shared camelCase serializers
│   │   │   └── Middleware/              # EnsureActiveUser, EnsurePermission, EnsureRole
│   │   ├── Models/                  # User, Report, ReportFieldValue, Department, ... (all HasUuids)
│   │   ├── Policies/                # per-model authorization + HandlesDomainAuthorization trait
│   │   ├── Providers/AppServiceProvider.php  # Gate::before, Gate::define per permission, Gate::policy bindings
│   │   ├── Services/                # Reports/, Analytics/, Admin/ business logic
│   │   ├── Support/Authorization/Permissions.php  # static role->permission matrix
│   │   └── Console/Commands/        # CreateSuperadmin, SyncOverdueReports, EnsureReportingPeriods
│   ├── database/migrations/         # UUID-keyed schema (2026_05_25_180000_* ...)
│   ├── database/seeders/            # RoleSeeder, ReportTemplateSeeder, ..., DevUserSeeder
│   ├── config/{sanctum,auth,session,cors}.php
│   ├── tests/{Unit,Feature}/        # PHPUnit; Feature tests use RefreshDatabase + actingAs
│   └── phpunit.xml
│
└── docs/
    ├── ARCHITECTURE.md              # this document
    └── migration/                   # Supabase->Laravel migration notes (DATA_MODEL, HANDOFF, audit)
```

The SPA was migrated from a prior Supabase backend to the Laravel API. Vestiges remain: the API client is deliberately *shaped like* the old Supabase client (`client.auth.getSession()`, `onAuthStateChange`, `channel()`/`removeChannel()`) so the context did not need a rewrite. Those realtime/auth surfaces now wrap the Laravel REST API.

---

# Backend

A Laravel 11/12-style application. All routes live under the `api` middleware group at the `/api` prefix (`routes/api.php`). Authentication is Sanctum session cookies on the `web` guard, not bearer tokens.

## Request Lifecycle & Middleware (`backend/bootstrap/app.php`)

```php
->withMiddleware(function (Middleware $middleware): void {
    $middleware->statefulApi();
    $middleware->api(prepend: [EnsureFrontendRequestsAreStateful::class]);
    $middleware->alias([
        'active'     => EnsureActiveUser::class,
        'permission' => EnsurePermission::class,
        'role'       => EnsureRole::class,
    ]);
})
```

- **`$middleware->statefulApi()`** enables Sanctum SPA mode: requests from configured **stateful domains** (`config/sanctum.php → stateful`, sourced from `SANCTUM_STATEFUL_DOMAINS`) are treated as first-party **session-cookie** requests rather than token requests, activating session + CSRF cookie middleware for the API group. The explicit `prepend: [EnsureFrontendRequestsAreStateful]` is redundant but harmless.
- The guard is **`web`** (session driver = `database` by default), so authenticated state lives server-side in the `sessions` table, carried by an encrypted session cookie. CSRF is enforced via Sanctum's `ValidateCsrfToken`.
- `routes/web.php` serves a welcome view at `/`; `route('/up')` is the health check.
- **Production safety:** `AppServiceProvider::boot()` throws `RuntimeException('APP_DEBUG must be false in production.')` if `app.debug` is true in the `production` environment.

### Custom middleware aliases

| Alias | Class | Effect |
|---|---|---|
| `active` | `EnsureActiveUser` | 403 `{"message":"This account is inactive."}` unless `$request->user()?->active` is truthy. |
| `permission` | `EnsurePermission` | One param `permission:<key>`. 403 `{"message":"This action is unauthorized."}` unless `Permissions::userCan($user, $permission)`. |
| `role` | `EnsureRole` | Variadic `role:a,b`. 403 unless user exists, is `active`, and `role_key` ∈ allowed list. **Defined but not used in `routes/api.php`** (permission middleware is used instead). |

### Throttling

| Route | Limit |
|---|---|
| `POST /api/auth/login` | `throttle:10,1` |
| `POST /api/auth/forgot-password` | `throttle:5,1` |
| `POST /api/auth/reset-password` | `throttle:5,1` |
| `POST /api/access-requests` | `throttle:10,1` |

The password broker additionally has `throttle => 60` seconds and reset tokens `expire => 60` minutes (`config/auth.php → passwords.users`).

## Authentication Flow

The User model (`backend/app/Models/User.php`) uses `HasUuids` (UUID string PKs), `HasApiTokens`, casts `password` to `hashed`, `active`/`password_change_required` to boolean, lowercases/trims `username` via a mutator, and stores role as the string column `role_key`.

### Sanctum SPA cookie sequence (end to end)

1. **`GET /sanctum/csrf-cookie`** - Sanctum's built-in route (registered by the package, *not* in `routes/api.php`). Sets the `XSRF-TOKEN` cookie; the SPA must echo its value as `X-XSRF-TOKEN` on subsequent mutating requests or CSRF validation fails.
2. **`POST /api/auth/login`** (`AuthController@login`) - validates `identifier`, `password`, optional `remember`. Lowercases/trims `identifier`; `findUserForIdentifier` matches `lower(email)` OR `lower(coalesce(username,''))`, preferring an email match. Bad credentials throw `ValidationException` (`identifier => auth.failed`, 422); an existing-but-inactive user gets 403. On success: `Auth::guard('web')->login($user, $remember)`, `session()->regenerate()` (fixation protection), stamps `last_login_at = now()`, returns `sessionPayload($user)` (200) = `{ user: {...camelCase profile incl. role, roleLabel, title, passwordChangeRequired, lastLoginAt}, assignments: [...active assignments with dept/template names+slugs], permissions: Permissions::forUser($user) }`.
3. **Authenticated requests** carry the session cookie + `X-XSRF-TOKEN`; `auth:sanctum` resolves the user.
4. **`GET /api/auth/me`** (`auth:sanctum` + `active`) returns the same `sessionPayload` for session rehydration on app load.
5. **`POST /api/auth/logout`** (`auth:sanctum`) - `Auth::guard('web')->logout()`, `session()->invalidate()`, `session()->regenerateToken()`, `Auth::forgetGuards()`; returns **204**.

`sessionPayload`/`defaultTitle` map `role_key` to display titles: superadmin → "Maintenance", admin → "Administrator", resident → "Resident", consultant → "Consultant", else "Nurse".

### Password reset (`PasswordResetController`)

Uses Laravel's `Password::broker()` (`password_reset_tokens` table, 60-min expiry, 60-sec throttle).
- **`POST /api/auth/forgot-password`** - validates `email`, finds user by `lower(email)`, **always returns 202** (enumeration-safe). If the user exists, creates a token and emails a raw link to `FRONTEND_URL/reset-password?token=...&email=...` via `Mail::raw`.
- **`POST /api/auth/reset-password`** - validates `email`, `token`, `password` (min 8, `confirmed`). On success hashes the password, sets `password_change_required = false`, rotates `remember_token`, deletes the token.

### Superadmin bootstrap

- **CLI** - `php artisan app:create-superadmin` (`CreateSuperadmin`): for a fresh DB; **refuses if any superadmin already exists**. Options `--email --username --full-name --title --password` (prompts if omitted; generates a 16-char password and sets `password_change_required=true` if none given). Creates `role_key=superadmin`, `active=true`, stamps `email_verified_at`.
- **API** - `POST /api/admin/claim-superadmin` (`ClaimSuperadminController@store`, middleware `permission:users.manage`): one-time bootstrap / self-update. If a superadmin already exists AND the actor is not that superadmin → ValidationException (closes a self-promotion hole). Requires admin-like role; force-fills the **actor's own** record to superadmin + records a `claim_superadmin` admin-audit entry.

## Authorization Model

Three layers combine, in order, on a typical request:

1. **`auth:sanctum`** - resolves the session-authenticated user or 401.
2. **`active` middleware** - rejects inactive accounts (403) before any controller runs.
3. **`permission:<key>` middleware** (coarse, role→permission) and/or **`Gate::authorize(...)` inside the controller** (fine-grained, instance/ownership-aware via policies). For admin routes the route enforces `permission:<key>` *and* the controller also calls `Gate::authorize(...)` - the middleware is coarse (role grants), the in-controller Gate adds instance-level checks (e.g. "admin can only edit nurses", "cannot deactivate a superadmin"). **Both must pass.**

### Roles

Five roles (`roles` table / `RoleSeeder`): **`superadmin`** ("Maintenance" - the single protected owner, created only via the `app:create-superadmin` console command / DB; never via any app flow; approves/provisions admins), **`admin`** ("Admin", the administrative doctors, full platform admin), **`nurse`** (reporting only), **`resident`** and **`consultant`** (academic evaluations only). The pair superadmin/admin is the **admin-like** set (`Permissions::ADMIN_ROLES`, `User::isAdminLike()`).

### Permission matrix (`app/Support/Authorization/Permissions.php`)

A static, hard-coded role→permission matrix (no DB-driven permissions). 17 constants. `forUser($user)` returns `[]` for inactive users (hard cutoff) and is what the SPA receives in the auth payload.

| Permission | superadmin | admin | nurse |
|---|:--:|:--:|:--:|
| `auth.viewSelf` | ✓ | ✓ | ✓ |
| `users.view` | ✓ | ✓ | - |
| `users.manage` | ✓ | ✓ | - |
| `admins.manage` | ✓ | - | - |
| `admins.approve` | ✓ | ✓ | - |
| `departments.manage` | ✓ | ✓ | - |
| `templates.manage` | ✓ | ✓ | - |
| `assignments.manage` | ✓ | ✓ | - |
| `accessRequests.create` | - | - | ✓ |
| `accessRequests.review` | ✓ | ✓ | - |
| `reports.viewAssigned` | - | - | ✓ |
| `reports.viewAny` | ✓ | ✓ | - |
| `reports.submit` | ✓ | ✓ | ✓ |
| `reports.lock` | ✓ | ✓ | - |
| `analytics.view` | ✓ | ✓ | - |
| `audit.view` | ✓ | ✓ | - |
| `settings.manage` | ✓ | ✓ | - |
| `notifications.view` | ✓ | ✓ | ✓ |

`resident` and `consultant` hold only `auth.viewSelf` + `academic.submit`; the admin-like roles additionally hold `academic.view` + `academic.manage`.

Only `admins.manage` distinguishes superadmin from admin (admin holds `admins.approve` but not `admins.manage`). Helpers: `userCan`, `roleHas`, `isAdminRole` (∈ {superadmin, admin}), `isSuperadmin`, `all()` (union of all permissions).

### Gate registration (`AppServiceProvider::boot()`)

- **`Gate::before(fn (User $user) => $user->active ? null : false)`** - globally denies all gates/policies for inactive users, regardless of role.
- For every permission string, `Gate::define($permission, fn (User $user) => Permissions::userCan($user, $permission))` - so `Gate::allows('users.manage')` mirrors the permission middleware.
- Per-model policies are bound via `Gate::policy(Model::class, Policy::class)`.

### Policies (`app/Policies/*`) and the ownership trait

All policies use **`HandlesDomainAuthorization`** (`app/Policies/Concerns/HandlesDomainAuthorization.php`), which centralizes ownership logic:
- `isAdminLike($user)` = active AND admin role; `isSuperadmin($user)` = active AND superadmin.
- `ownsAssignment($user, $assignment)` = active user, active assignment, `assignment.nurse_id === user.id`.
- `canViewAssignedReport($user, $report)` = admin-like OR the user has an active assignment matching the report.
- `canMutateAssignedUnlockedReport($user, $report)` = can-view AND (admin-like OR `!report->isLocked()`). **This is the core write-gate: nurses may only mutate their own reports while unlocked; admins may mutate locked reports.**

| Policy | Model(s) | Notable rules |
|---|---|---|
| **ReportPolicy** | Report | `viewAny`/`lock`/`unlock`/`delete` = admin-like. `view` = canViewAssignedReport. `create` = admin or nurse owning the assignment. `update`/`submit` = canMutateAssignedUnlockedReport. |
| **ReportFieldValuePolicy** | ReportFieldValue | view/mutate gated on the parent report's assignment + lock state. |
| **CalculatedMetricPolicy** | CalculatedMetric | `view` follows report visibility; writes admin-only. |
| **ReportStatusHistoryPolicy** | ReportStatusHistory | `view` follows report visibility; `create` = any active user (service-written). |
| **ReportAssignmentPolicy** | ReportAssignment | `view` = admin or owner; all mutations admin-like. |
| **AccessRequestPolicy** | AccessRequest | `create` = any active user; `view` = admin or owner; `viewAny`/`review`/mutations admin-like. |
| **AccessRequestItemPolicy** | AccessRequestItem | `view`/`delete` = admin or owning request's user; `create` = active. |
| **NotificationPolicy** | Notification | `viewAny` = any active user; `view`/`update`/`delete` = admin-like or recipient; `create` = admin. |
| **UserPolicy** | User | `view` = self or admin-like. `create` needs `users.manage`; `createAdmin` needs `admins.manage` (superadmin only). `update` = self, OR superadmin, OR admin-like editing a **nurse** only. `setActive`/`delete`: a superadmin target can **never** be toggled; toggling another admin requires superadmin; toggling a nurse requires admin-like. |
| **ReferenceDataPolicy** | Department, ReportTemplate, ReportFieldDefinition, ReportingPeriod | read = any active user; create/update/delete admin-like. |
| **RolePolicy** | Role | read = active; mutations superadmin-only. |
| **AppSettingPolicy** | AppSetting | read = active; `update` admin-like. |
| **AuditLogPolicy / AdminAuditLogPolicy** | AuditLog / AdminAuditLog | all admin-like. |

**Nurse isolation in practice:** beyond `ReportPolicy::view`, `ReportWorkflowController::index` explicitly scopes non-admin listing to `whereHas('assignment', nurse_id = me AND active = true)`. A nurse can only ever see/list/edit reports for their own active assignments, and never edit one that is locked.

## Controllers

### Conventions across all controllers

- **No Form Request classes.** Every action validates inline with `$request->validate([...])`. Most write endpoints accept **both** `snake_case` and `camelCase` keys (via `required_without` pairs and `$validated['snake'] ?? $validated['camel']`) because the SPA sends camelCase.
- **No Eloquent API Resource classes.** Everything is hand-mapped to camelCase arrays; timestamps emitted via `?->toJSON()`. Admin controllers share the `SerializesAdminResources` trait; non-admin controllers have private serializers.
- **IDs are UUID strings.** Route-model binding works for `User`, `Report`, `ReportAssignment`, `AccessRequest`, `Notification`; reference data (templates/departments) are resolved manually by **id OR slug** (`resolveTemplate`/`resolveDepartment`).
- **Every admin mutation records an audit entry** via `AdminAuditService::record(...)`.

### Non-admin controllers (`app/Http/Controllers/Api/`)

- **`AuthController`** - `login`, `me`, `logout` (see Authentication Flow).
- **`PasswordResetController`** - `forgot`, `reset` (enumeration-safe).
- **`AccessRequestSubmissionController`** (uses `SerializesAdminResources`) - public `store`. Adapts validation by `Auth::guard('web')->user()`: when unauthenticated, `full_name/email/password` are required; when authenticated they are `sometimes` and the actor is reused. In a `DB::transaction`: creates an applicant nurse user if anonymous (rejects duplicate email), creates the `AccessRequest` + `AccessRequestItem`s (each requested dept/template validated by id-or-slug, must be active + family-matched, de-duplicated), then `notifyAdmins` (a `nurse_access_request` notification for every active admin-like user). Returns `{ signedIn, data: serializeAccessRequest(...) }` 201.
- **`WorkspaceController`** - `show`. Builds the entire SPA initial state in one response (see API surface). Role-scopes every collection. Computes `visibleReportingPeriodIds` between `LIVE_REPORTING_START = '2026-03-02'` and the current period. Reports here are **shells** (`values` is `{}`); full values come from `/reports`.
- **`ReportWorkflowController`** - `index/show/store/update/submit/lock/unlock`. Constructor-injects `ReportSubmissionService` + `ReportLockingService`. `store`/`update`/`submit` delegate to `submissionService->save(...)`; `lock`/`unlock` to `lockingService->setLockState(...)`. `show/update/submit/lock/unlock` call `Gate::authorize`. Private serializers turn `ReportFieldValue` rows into `{ fieldKey: { fieldId, dailyValues: { day: value } } }` (picking the typed column) plus `calculatedMetrics`.
- **`AnalyticsController`** - thin façade over five analytics services; each endpoint validates filters into an `AnalyticsFilters` DTO. `export` returns a `StreamedResponse` CSV.
- **`NotificationController`** - `index/markRead/markAllRead/destroy/restore`. Admins can target another `recipient_id`; nurses are forced to their own. `restore` has explicit IDOR protection (won't overwrite a row owned by a different recipient).

### Admin controllers (`app/Http/Controllers/Api/Admin/`) - all use `SerializesAdminResources`

- **`UserController`** (DI `AdminAuditService`) - CRUD-ish over users; every write records an admin-audit entry. `store` chooses `createAdmin` vs `create` ability by target role (admins cannot mint admins). `destroy` is a soft deactivate.
- **`ReportAssignmentController`** (DI `AdminAuditService`) - `index/store/update/destroy`. `store` upserts keyed on (nurse, department, template); enforces nurse role + dept/template family match; stamps `approved_at`/`approved_by`.
- **`ReferenceDataController`** (DI `AdminAuditService`) - templates + departments + wards. Largest validator set (`validateTemplate`, `validateDepartment`). Template create/update is transactional and calls `syncFields` (upsert field defs keyed on template+field_key, auto `display_order = (index+1)*10`). Delete guards block deletion when referenced. `wards()` merges `family=inpatient` and reuses `departments()`.
- **`SettingsController`** (DI `AppSettingsService`, `AdminAuditService`) - `show`/`update`; validates a fixed schema; delegates persistence to `AppSettingsService::update`.
- **`AccessRequestController`** (DI `AccessRequestReviewService`) - `index/show/review/approve/reject`; delegates side effects to the review service.
- **`AuditLogController`** - `cellEdits` (report `AuditLog`) and `adminActions` (`AdminAuditLog`); read-only, admin-only, rich filters, `limit` cap 500.
- **`ClaimSuperadminController`** (DI `AdminAuditService`) - `store` (see Superadmin bootstrap).

### Shared serialization trait - `SerializesAdminResources`

Provides `serializeUser`, `serializeAssignment`, `serializeDepartment`, `serializeTemplate`, `serializeFieldDefinition`, `serializeAccessRequest`, `serializeAuditLog`, `serializeAdminAuditLog`, `serializeAppSetting`, `serializeReportingPeriod`. All emit camelCase keys, eager-`loadMissing` related models, render timestamps via `?->toJSON()`.

## Services / Business Logic (`app/Services/`)

| Service | Responsibility |
|---|---|
| **Reports\ReportSubmissionService** | The submit/draft engine. `save(actor, assignment, period, values, submit)` runs in a transaction: authorizes the edit, finds the report for (assignment, period) with `lockForUpdate()` (rejects locked reports), creates it if missing, `persistValues` writes EAV rows (coercing by `field_kind`, validating day ∈ template `active_days`, logging `audit_logs` for post-submission changes), computes `nextStatus`, records `report_status_history`, notifies admins (`new_report_submitted` / `submitted_report_edited`), fires `CriticalEventAlertService::notify`, then recomputes metrics via `ReportCalculationService::upsertForReport`. |
| **Reports\ReportLockingService** | `setLockState(actor, report, locked)` - active-admin only; transactional `lockForUpdate`, idempotent. Lock sets `status=locked`/`locked_at`; unlock restores `edited_after_submission` or `submitted` and clears `locked_at`. Notifies the nurse (`report_locked`/`report_unlocked`). |
| **Reports\ReportCalculationService** | `upsertForReport(report)` - inpatient BOR% = `patientDays / (bedCount × 30) × 100`, BTR = `(discharged_home + discharged_ama) / bedCount`, ALOS = `patientDays / totalDischarge`. Null when `bed_count` is falsy. Non-inpatient ⇒ null metrics. |
| **Reports\OverdueReportService** | `sync()` (cron `hourly`) - upserts `overdue_report` notifications for active assignments lacking a submitted report past the deadline (live periods only, `week_start >= 2026-03-02`); deletes stale ones; no-ops if deadline enforcement is off. |
| **Reports\CriticalEventAlertService** | `detect`/`notify` - sums configured `critical_non_zero_fields` (default `new_deaths`, `new_pressure_ulcer`, `total_hai`, `hai_clabsi`, `hai_cauti`, `hai_vap`); creates `critical_value_alert` notifications to admins when any weekly total > 0. |
| **Reports\ReportReminderService** | `sendDue()` (cron `hourly`) - sends one in-app/email/SMS reminder per configured tier for active assignments with no submitted report near `deadline_at`; delivery goes through the database queue. |
| **Reports\ReportingPeriodService** | `ensureRollingWindow(pastWeeks=26, futureWeeks=52)` (cron `weekly`, Sundays at 00:05) - `firstOrNew` a `reporting_periods` row per Monday in the window; fills week_end, deadline, labels. |
| **Analytics\AnalyticsService** | Central read-side aggregator. Request-scoped memo collapses repeated report queries. `reports(filters, family?)`, `summary(...)` (totalReports, expectedReports, missingReports, statusCounts, totals, occupancy), `occupancy(...)` (analytics BOR uses actual covered days = `max(periods×7, 30)`), `weekly`/`monthly`/`departmentSummaries`, `outpatientExtras`, `procedureExtras` (driven by `PROCEDURE_SERVICES`), `scope`. |
| **Analytics\{Inpatient,Outpatient,Procedure}AnalyticsService** | Thin family façades merging `familySummary(...)` with the relevant extras. |
| **Analytics\AnalyticsFilters** | Immutable VO; `fromArray` accepts snake+camel, normalizes dates/months. |
| **Analytics\AnalyticsExportService** | `streamCallback(periods)` streams long-format CSV via `lazy(500)`; `sanitizeCell` neutralizes CSV formula injection (important: values include nurse free text). |
| **Admin\AppSettingsService** | `structured()` reads the 5 setting rows into a defaulted array; `update(...)` upserts and **recalculates `deadline_at` on every reporting period**. |
| **Admin\AdminAuditService** | `record(actor, action, entityType, entityId?, old?, new?, request?)` inserts an `admin_audit_logs` row with IP/user-agent snapshots. |
| **Admin\AccessRequestReviewService** | `review(actor, request, decision)` (transactional) - sets status/reviewer; on approval upserts `report_assignment`s; notifies the requester (`access_request_reviewed`); records an admin audit entry. |

## Console / Scheduling (`routes/console.php`)

```php
Schedule::command('reports:sync-overdue')->hourly();           // OverdueReportService::sync
Schedule::command('reports:send-reminders')->hourly();         // ReportReminderService::sendDue
Schedule::command('reports:ensure-periods')->weeklyOn(0, '00:05'); // ReportingPeriodService::ensureRollingWindow
Schedule::command('queue:monitor-health --json')->everyMinute()->withoutOverlapping();
Schedule::command('queue:work --stop-when-empty --max-time=50 --queue=analytics,notifications,default')
    ->everyMinute()->withoutOverlapping(); // shared-host fallback only
```
Production runs separate persistent workers for `analytics,default` and
`notifications,default`. Commands include `SyncOverdueReports`,
`EnsureReportingPeriods` (`--past`/`--future`), `MonitorQueueHealth`, and
`CreateSuperadmin`.

## Full API Surface

> All paths are prefixed `/api`. Unless noted, every route in the main group requires **`auth:sanctum` + `active`**. "Permission" = route-level `permission:` middleware; "Gate" = additional in-controller `Gate::authorize`. Body params accept snake_case and camelCase.

### Auth

| Method | Path | Controller@method | Middleware |
|---|---|---|---|
| POST | `/auth/login` | `AuthController@login` | `throttle:10,1` |
| POST | `/auth/forgot-password` | `PasswordResetController@forgot` | `throttle:5,1` |
| POST | `/auth/reset-password` | `PasswordResetController@reset` | `throttle:5,1` |
| GET | `/auth/me` | `AuthController@me` | `auth:sanctum`, `active` |
| POST | `/auth/logout` | `AuthController@logout` | `auth:sanctum` |
| GET | `/sanctum/csrf-cookie` | (Sanctum package route) | - |

### Public submission & workspace

| Method | Path | Controller@method | Auth / scope |
|---|---|---|---|
| POST | `/access-requests` | `AccessRequestSubmissionController@store` | `throttle:10,1`, no auth required |
| GET | `/workspace` | `WorkspaceController@show` | auth+active; role-scoped internally; query flags `include_profiles`/`include_access_requests`/`include_history` (snake or camel) |

### Reports / Workflow

| Method | Path | Controller@method | Permission / Gate |
|---|---|---|---|
| GET | `/reports` | `ReportWorkflowController@index` | scoped: nurses limited to own active assignments; filters `assignment_id`, `reporting_period_id` |
| POST | `/reports` | `ReportWorkflowController@store` | ownership enforced via service; returns 201 |
| GET | `/reports/{report}` | `ReportWorkflowController@show` | `Gate::authorize('view')` |
| PUT | `/reports/{report}` | `ReportWorkflowController@update` | `Gate::authorize('update')`; `values` required, optional `submit` |
| POST | `/reports/{report}/submit` | `ReportWorkflowController@submit` | `Gate::authorize('submit')` |
| POST | `/reports/{report}/lock` | `ReportWorkflowController@lock` | `Gate::authorize('lock')` (admin-like) |
| POST | `/reports/{report}/unlock` | `ReportWorkflowController@unlock` | `Gate::authorize('unlock')` (admin-like) |

### Notifications - all `permission:notifications.view`

| Method | Path | Controller@method | Gate |
|---|---|---|---|
| GET | `/notifications` | `NotificationController@index` | `viewAny`; filters `type`, `unread`, `limit` (≤200, default 100), admin `recipient_id` |
| PATCH | `/notifications/read` | `NotificationController@markRead` | per-item `update`; `ids[]` |
| PATCH | `/notifications/read-all` | `NotificationController@markAllRead` | `viewAny` |
| DELETE | `/notifications` | `NotificationController@destroy` | per-item `delete`; `ids[]` |
| POST | `/notifications/restore` | `NotificationController@restore` | IDOR-guarded inline; re-creates up to 50 client notifications |

### Analytics - prefix `/analytics`, all `permission:analytics.view`

| Method | Path | Controller@method | Purpose |
|---|---|---|---|
| GET | `/analytics/overview` | `overview` | KPI overview |
| GET | `/analytics/inpatient` | `inpatient` | Inpatient summary |
| GET | `/analytics/outpatient` | `outpatient` | Outpatient summary |
| GET | `/analytics/procedures` | `procedures` | Procedure summary |
| GET | `/analytics/weekly` | `weekly` | `{scope, data}` weekly series |
| GET | `/analytics/monthly` | `monthly` | `{scope, data}` monthly series |
| GET | `/analytics/departments` | `departments` | per-department summaries |
| GET | `/analytics/wards` | `wards` | as departments, `family=inpatient` |
| GET | `/analytics/export` | `export` | streams CSV; selects period by `period`/`periodId`, `month` (`Y-m`), or latest ≤ today; 404 if none |

Non-export endpoints build `AnalyticsFilters` from a large optional-filter set (`period_id`, `week_start`/`week`, `month`, `year`, `date_from`/`date_to`, `department_id`/`department`, `ward_id`/`ward`, `family` ∈ {inpatient,outpatient,procedure}, `report_type`, `procedure_category` - each snake/camel).

### Admin - prefix `/admin`

| Method | Path | Controller@method | Permission | Gate |
|---|---|---|---|---|
| POST | `/admin/claim-superadmin` | `ClaimSuperadminController@store` | `users.manage` | inline role checks |
| GET | `/admin/users` | `UserController@index` | `users.view` | `viewAny` |
| POST | `/admin/users` | `UserController@store` | `users.manage` | `createAdmin` if admin role else `create` |
| GET | `/admin/users/{user}` | `UserController@show` | `users.view` | `view` |
| PATCH | `/admin/users/{user}` | `UserController@update` | `users.manage` | `update`; `createAdmin` if promoting |
| PATCH | `/admin/users/{user}/active` | `UserController@setActive` | `users.manage` | `setActive` |
| POST | `/admin/users/{user}/reset-password` | `UserController@resetPassword` | `users.manage` | `update` |
| DELETE | `/admin/users/{user}` | `UserController@destroy` | `users.manage` | `setActive` (soft deactivate) |
| GET | `/admin/assignments` | `ReportAssignmentController@index` | `assignments.manage` | `viewAny` |
| POST | `/admin/assignments` | `ReportAssignmentController@store` | `assignments.manage` | `create` (upsert; 201/200) |
| PATCH | `/admin/assignments/{assignment}` | `ReportAssignmentController@update` | `assignments.manage` | `update` |
| DELETE | `/admin/assignments/{assignment}` | `ReportAssignmentController@destroy` | `assignments.manage` | `delete` (soft deactivate) |
| GET | `/admin/templates` | `ReferenceDataController@templates` | `templates.manage` | `viewAny` |
| POST | `/admin/templates` | `ReferenceDataController@storeTemplate` | `templates.manage` | `create` |
| GET | `/admin/templates/{template}` | `ReferenceDataController@showTemplate` | `templates.manage` | `view` (id or slug) |
| PATCH | `/admin/templates/{template}` | `ReferenceDataController@updateTemplate` | `templates.manage` | `update` |
| PATCH | `/admin/templates/{template}/active` | `ReferenceDataController@setTemplateActive` | `templates.manage` | `update` |
| DELETE | `/admin/templates/{template}` | `ReferenceDataController@destroyTemplate` | `templates.manage` | `delete`; blocked if referenced; 204 |
| GET | `/admin/departments` | `ReferenceDataController@departments` | `departments.manage` | `viewAny` |
| POST | `/admin/departments` | `ReferenceDataController@storeDepartment` | `departments.manage` | `create` |
| GET | `/admin/departments/{department}` | `ReferenceDataController@showDepartment` | `departments.manage` | `view` (id or slug) |
| PATCH | `/admin/departments/{department}` | `ReferenceDataController@updateDepartment` | `departments.manage` | `update` |
| PATCH | `/admin/departments/{department}/active` | `ReferenceDataController@setDepartmentActive` | `departments.manage` | `update` |
| DELETE | `/admin/departments/{department}` | `ReferenceDataController@destroyDepartment` | `departments.manage` | `delete`; blocked if referenced; 204 |
| GET | `/admin/wards` | `ReferenceDataController@wards` | `departments.manage` | `viewAny` (forced `family=inpatient`) |
| GET | `/admin/settings` | `SettingsController@show` | `settings.manage` | `viewAny` |
| PUT/PATCH | `/admin/settings` | `SettingsController@update` | `settings.manage` | `update` |
| GET | `/admin/access-requests` | `AccessRequestController@index` | `accessRequests.review` | `viewAny`; filter `status` |
| GET | `/admin/access-requests/{accessRequest}` | `AccessRequestController@show` | `accessRequests.review` | `view` |
| PATCH | `/admin/access-requests/{accessRequest}/review` | `AccessRequestController@review` | `accessRequests.review` | `review` (`decision` ∈ approved/rejected) |
| POST | `/admin/access-requests/{accessRequest}/approve` | `AccessRequestController@approve` | `accessRequests.review` | `review` |
| POST | `/admin/access-requests/{accessRequest}/reject` | `AccessRequestController@reject` | `accessRequests.review` | `review` |
| GET | `/admin/audit-logs` | `AuditLogController@cellEdits` | `audit.view` | `viewAny`; filters report/dept/changedBy/date; `limit`≤500 (default 200) |
| GET | `/admin/admin-audit-logs` | `AuditLogController@adminActions` | `audit.view` | `viewAny`; filters user/entity/action/date; `limit`≤500 |

---

# Data Model

All domain tables use **UUID string primary keys** (`$table->uuid('id')->primary()` + `HasUuids` on the model). Exceptions: `roles` (string PK `role_key`), `app_settings` (string PK `setting_key`), `personal_access_tokens` (auto-increment), and framework tables (`password_reset_tokens`, `sessions`, `cache`, `jobs`). Foreign keys created with `foreignUuid(...)->constrained()` default to `RESTRICT` on delete unless `cascadeOnDelete`/`nullOnDelete` is noted.

## Table reference

### `roles`
Lookup table of the five roles. `role_key` string(32) **PK**, `label` string(64), `description` text, timestamps. Values: `superadmin`, `admin`, `nurse`, `resident`, `consultant`.

### `users`
`id` uuid PK; `email` (unique); `username` string(64) (unique, lowercased by mutator); `password` (hashed); `full_name`; `title`; `role_key` string(32) **FK → roles** (RESTRICT, indexed); `phone`; `active` bool (default true - inactive users denied everything); `email_verified_at`; `remember_token`; `last_login_at`; `password_change_required` bool (default false - forces reset on first login); timestamps. The same migration creates framework `password_reset_tokens` (PK `email`) and `sessions` (PK `id`, nullable `user_id`, payload, last_activity).

### `report_templates`
The shape of a report. `id` uuid PK; `slug` string(64) unique (e.g. `inpatient_weekly`); `family` enum `inpatient|outpatient|procedure`; `name`; `description`; `active_days` json (weekday names the template collects); `metadata` json (`ui_family`, `supports_metrics`); `active` bool; timestamps.

### `departments`
A reporting unit (ward/clinic/lab), each bound to exactly one template. `id` uuid PK; `slug` unique; `family` enum (indexed); `template_id` uuid **FK → report_templates** (RESTRICT); `name`; `description`; `accent_color` string(16); `bed_count` int (drives BOR/BTR/ALOS; null for non-inpatient); `active` bool; timestamps.

### `report_field_definitions`
The field catalog per template - the "schema" half of the EAV model. `id` uuid PK; `template_id` uuid **FK → report_templates** (**cascade**); `section_key` string(64) (UI grouping); `field_key` string(64); `label`; `field_kind` enum `integer|decimal|time|text|choice`; `aggregate_type` enum `sum|average|latest|none` (default sum); `display_order` int; `metadata` json (e.g. choice `options`); timestamps. Indexes: **unique `(template_id, field_key)`**, index `(template_id, display_order)`.

### `reporting_periods`
One row per ISO week (Monday-start); `timestamps = false`. `id` uuid PK; `week_start` date unique (Monday); `week_end` date (Sunday); `deadline_at` timestamp (computed from app settings); `month_label` string(16) (`Mar 2026`); `quarter_label` string(8) (`Q1 2026`); `year_num` smallint; `created_at useCurrent()`. Index `(year_num, month_label)`.

### `report_assignments`
Grants a nurse the right/duty to report for a (department, template). `id` uuid PK; `nurse_id` uuid **FK → users** (**cascade**); `department_id` uuid **FK → departments** (**cascade**); `template_id` uuid **FK → report_templates** (**cascade**); `active` bool; `approved_at useCurrent()`; `approved_by` uuid **FK → users** (**nullOnDelete**); timestamps. Indexes: **unique `(nurse_id, department_id, template_id)`**, `(nurse_id, active)`, `department_id`.

### `access_requests`
A nurse's request for reporting access. `id` uuid PK; `user_id` uuid **FK → users** (**cascade**); `email`; `status` enum `pending|approved|rejected` (default pending); `notes`; `requested_at useCurrent()`; `reviewed_at`; `reviewed_by` uuid **FK → users** (**nullOnDelete**); timestamps. Index `(status, requested_at)`.

### `access_request_items`
The (department, template) pairs a request asks for; `timestamps = false`. `id` uuid PK; `access_request_id` uuid **FK → access_requests** (**cascade**); `department_id` uuid **FK → departments** (**cascade**); `template_id` uuid **FK → report_templates** (**cascade**); `created_at useCurrent()`. **Unique `(access_request_id, department_id, template_id)`**.

### `reports`
The aggregate root of a weekly submission - one report = one assignment × one period. `id` uuid PK; `assignment_id` uuid **FK → report_assignments** (**cascade**); `department_id` uuid **FK → departments** (**cascade**, denormalized from assignment); `template_id` uuid **FK → report_templates** (**cascade**, denormalized); `reporting_period_id` uuid **FK → reporting_periods** (**cascade**); `status` enum `not_started|draft|submitted|edited_after_submission|locked|overdue` (default draft); `submitted_at` (set on first submit, preserved); `locked_at` (non-null ⇒ read-only); `created_by`/`updated_by` uuid **FK → users** (RESTRICT); timestamps. Indexes: **unique `(assignment_id, reporting_period_id)`**, `(reporting_period_id, template_id)`, `(status, locked_at, submitted_at)`, `(department_id, reporting_period_id)`, and `(assignment_id, updated_at)` for the report-listing sort.

### `report_field_values` (the EAV "value" table)
One row per (report, field, weekday) - the entity-attribute-value store; the *attribute* is `field_definition_id`, the value lands in one of four typed columns. `id` uuid PK; `report_id` uuid **FK → reports** (**cascade**); `field_definition_id` uuid **FK → report_field_definitions** (**cascade**); `day_name` enum `monday…sunday`; `value_number` **decimal(14,4)** (integers and decimals both); `value_text` text (text + choice); `value_time` time (`HH:MM`); `value_json` json (reserved); timestamps. **Unique `(report_id, field_definition_id, day_name)`**. (The earlier `(report_id, field_definition_id)` index was dropped as a redundant strict prefix of the unique key on this highest-volume table.)

### `calculated_metrics`
One-to-one with a report; computed inpatient metrics. `id` uuid PK; `report_id` uuid unique **FK → reports** (**cascade**); `bor_percent`/`btr`/`alos` **decimal(7,3)**; `metric_payload` json (`total_patient_days`, `total_discharge`); timestamps.

### `report_status_history`
Append-only status timeline; `timestamps = false`; table name `report_status_history` (not pluralized). `id` uuid PK; `report_id` uuid **FK → reports** (**cascade**); `status` enum (same 6 values); `changed_by` uuid **FK → users** (RESTRICT); `changed_by_name`; `note`; `changed_at useCurrent()`. Index `(report_id, changed_at)`.

### `audit_logs` (per-cell edit trail)
Records every value change **after** a report has been submitted; `timestamps = false`. `id` uuid PK; `report_id` uuid **FK → reports** (**cascade**); `field_definition_id` uuid **FK** (**nullOnDelete**); `field_key` (snapshot, survives definition deletion); `day_name`; `old_value`/`new_value` text; `changed_by` uuid **FK → users** (RESTRICT); `changed_by_name`; `changed_at useCurrent()`; `department_id`/`template_id` uuid **FK** (RESTRICT, denormalized for filtering). Indexes: `(report_id, changed_at)`, `(department_id, changed_at)`, `(template_id, changed_at)`, `(changed_by, changed_at)`.

### `admin_audit_logs` (admin-action trail)
Generic admin action log; `timestamps = false`. `id` uuid PK; `user_id` uuid **FK → users** (RESTRICT); `user_name`; `action` string(64); `entity_type` string(64); `entity_id` uuid; `old_values`/`new_values` json; `ip_address` string(45); `user_agent`; `created_at useCurrent()`. Indexes: `(user_id, created_at)`, `(entity_type, entity_id, created_at)`.

### `notifications`
In-app notifications; `timestamps = false`. `id` uuid PK; `recipient_id` uuid **FK → users** (**cascade**); `type` string(64) (`new_report_submitted`, `submitted_report_edited`, `critical_value_alert`, `overdue_report`, `report_locked`, `report_unlocked`, `access_request_reviewed`, `nurse_access_request`); `title`; `message`; `related_route` (deep link); `related_entity` string(64) (category, also reused as a dedup key, e.g. `overdue:{assignment}:{period}`); `related_id` uuid; `read_at`; `created_at useCurrent()`. Indexes: `(recipient_id, read_at, created_at)`, `(type, recipient_id)`.

### `app_settings`
Key/value config; string PK; `timestamps = false`. `setting_key` string(64) **PK** (keys: `workflow_controls`, `weekly_deadline`, `locking_rules`, `insight_thresholds`, `critical_non_zero_fields`); `value_json` json; `updated_by` uuid **FK → users** (**nullOnDelete**); `updated_at useCurrent()`.

### `personal_access_tokens`
Standard Sanctum table but with `uuidMorphs('tokenable')` so it can reference UUID-keyed users. Auto-increment `id`; unique `token(64)`; `abilities`, `last_used_at`, `expires_at`.

## ERD-style relationship overview

```
report_templates 1─* departments              (each department bound to one template)
report_templates 1─* report_field_definitions  (cascade; the field catalog per template)
reporting_periods                                (standalone weekly calendar)

users (nurse) 1─* access_requests 1─* access_request_items   (each item = department + template)
        approving an access request upserts report_assignments + notifies the requester

report_assignment (nurse × department × template)
        +  reporting_period (the week)
        ─────────────────────────────────────────►  report   (unique on assignment_id + reporting_period_id)
report ──1..*── report_field_values     (EAV: per field-definition, per weekday)
report ──1..1── calculated_metrics      (BOR/BTR/ALOS, inpatient only)
report ──1..*── report_status_history   (status timeline, append-only)
report ──1..*── audit_logs              (per-cell edits AFTER first submission)

notifications  belong to a recipient user; produced by submission, locking, critical-event,
               overdue, and access-review flows
admin_audit_logs  independent admin-action trail (e.g. access-request review, user edits)
app_settings   configures deadlines, auto-lock window, insight thresholds, critical-field list
roles          FK target for users.role_key and the basis of the permission matrix
```

A `report` denormalizes `department_id` and `template_id` from its assignment, so analytics / audit / export can filter without joining through the assignment.

**onDelete summary.** Deleting a `report` cascades to its field values, status history, audit logs, and calculated metric. Deleting a `report_assignment`, `department`, `report_template`, `reporting_period`, or `user` (nurse) cascades to dependent `reports`. `approved_by`/`reviewed_by`/`app_settings.updated_by` null out on user deletion; `report.created_by`/`updated_by` and the `changed_by` columns are RESTRICT - a user referenced there cannot be hard-deleted, so the app **deactivates** instead.

**EAV read/write note.** Reads (analytics, export, serialization) join `report_field_definitions` to recover `field_key`/`field_kind`/`aggregate_type`, then pick the populated value column. Writes choose the column from the definition's `field_kind` (see `ReportSubmissionService::coerceValue`).

## The report lifecycle

```
draft ──submit──► submitted ──edit──► edited_after_submission ──lock──► locked
                                                                          │
                              unlock ◄───────────────────────────────────┘
                              (restores edited_after_submission, else submitted)
```

- **One report per (assignment, period)** - enforced by the unique index and a `lockForUpdate` lookup.
- **`not_started`/`overdue`** exist in the enum, but overdue is surfaced via notifications by the every-minute sync job rather than persisted as a stored status. The frontend *derives* `not_started`/`overdue` for display.
- **Lock = read-only.** The submission service rejects edits to a locked report; only active admins lock/unlock.
- **Audit trail starts at first submission** - value changes are logged to `audit_logs` only once `submitted_at` is set.
- **Metrics:** per-report BOR uses a fixed 30-day denominator; analytics occupancy uses actual covered days (`max(periods×7, 30)`). Metrics are inpatient-only and depend on `department.bed_count`.
- **Deadlines/overdue:** governed by `app_settings`; the sync job runs every minute, only for live periods (`week_start >= 2026-03-02`).
- **Inactive users get zero access** at every layer (Gate::before, `Permissions::forUser`, the `active` middleware, every policy ownership check).

## Seeders (`database/seeders/`)

`DatabaseSeeder` runs (all idempotent): **RoleSeeder → ReportTemplateSeeder → DepartmentSeeder → ReportFieldDefinitionSeeder → AppSettingSeeder → ReportingPeriodSeeder → DevUserSeeder**.
- **ReportTemplateSeeder** - 9 templates: 1 inpatient (`inpatient_weekly`, Mon–Sun, supports BOR/BTR/ALOS), 1 outpatient (`outpatient_weekly` "ART", Mon–Fri), 7 procedure (EEG, Echocardiography, Endoscopy, Hematology procedures, Bronchoscopy, Renal procedures Mon–Sun, Dialysis Mon–Sun).
- **DepartmentSeeder** - 27 departments: 8 inpatient wards (bed_count GI/Neuro 26, Cardiac 22, Nephrology 20, Chest 18, Hematology 16, Oncology 24, HDU 12, Transition null), 12 outpatient clinics, 7 procedure labs.
- **ReportFieldDefinitionSeeder** - ~85 field definitions. Inpatient includes `total_patient_days`, `discharged_home`, `discharged_ama` (metrics) and the critical fields. Only `senior_physician_availability` (outpatient `choice`) carries `metadata.options` = Full day / Partial day / Unavailable.
- **AppSettingSeeder** - `workflow_controls={deadline_enforced:true}`, `weekly_deadline={day:monday, time:10:00}`, `locking_rules={auto_lock_hours_after_deadline:36}`, `insight_thresholds={rise_percent:10, drop_percent:10}`, `critical_non_zero_fields=[new_deaths, new_pressure_ulcer, total_hai, hai_clabsi, hai_cauti, hai_vap]`.
- **ReportingPeriodSeeder** - 53 weekly periods from −26 to +52 weeks.
- **DevUserSeeder** - **local-dev only; self-guards with `app()->environment('production','testing') → return`.** Creates superadmin `admin@stpaulos.local` / `admin1` and two nurses, all password **`StPaul2026!`**. Production must create its superadmin via `php artisan app:create-superadmin`.

---

# Frontend

A React 19 + Vite + TypeScript SPA with **no external state library** (no Redux/Zustand/React Query). All global state lives in one context.

## Bootstrap & Routing

- **`src/main.tsx`** - mounts React 19 via `createRoot` into `#root`, wrapping `<App/>` in `<AppProviders>`.
- **`src/app/providers.tsx`** - `AppProviders` = `<AppDataProvider>{children}<Toaster richColors position="top-right"/></AppDataProvider>`. `AppDataProvider` is the *only* state provider; `Toaster` (sonner) renders the `toast.error(...)` calls made throughout the data layer.
- **`src/App.tsx`** - `BrowserRouter` + `Routes`. **Every page except `LoginPage` and `HomeRedirect` is `React.lazy`-loaded** with named-export unwrapping. `renderLazyRoute(node, fallback)` wraps each lazy element in `<Suspense>` with `'page'` (full-screen `AppStateScreen`) or `'inline'` (`InlineRouteFallback`, an in-shell card). Routes inside the authenticated shell use `'inline'` so the chrome stays put while a chunk loads.

### Route table

| Path | Component | Lazy | Fallback | Guard / role |
|---|---|---|---|---|
| `/` | `HomeRedirect` (in App.tsx) | no | - | none (redirect logic) |
| `/login` | `LoginPage` | **no** (eager) | - | public |
| `/forgot-password` | `ForgotPasswordPage` | yes | page | public |
| `/reset-password` | `ResetPasswordPage` | yes | page | public |
| `/register` | `AccessRequestPage` | yes | page | public |
| `/notifications` | `NotificationsPage` | yes | inline | any authed role |
| `/admin/notifications` | `NotificationsPage` | yes | inline | any authed role |
| `/reports/:assignmentId/:periodId` | `ReportFormPage` | yes | inline | any authed role |
| `/nurse` | `NurseDashboardPage` | yes | inline | `roles={['nurse']}` |
| `/nurse/reports` | `ReportSelectionPage` | yes | inline | nurse |
| `/nurse/activity` | `NurseActivityPage` | yes | inline | nurse |
| `/admin` | `AdminDashboardPage` | yes | inline | `roles={['superadmin','admin']}` |
| `/admin/departments/:departmentId` | `DepartmentDetailPage` | yes | inline | admin |
| `/admin/submissions` | `SubmissionBoardPage` | yes | inline | admin |
| `/admin/users` | `UserManagementPage` | yes | inline | admin |
| `/admin/manual-admin-setup` | `ManualAdminSetupPage` | yes | inline | admin (hidden from nav) |
| `/admin/templates` | `TemplateManagementPage` | yes | inline | admin |
| `/admin/audit` | `AuditLogPage` | yes | inline | admin |
| `/admin/settings` | `SettingsPage` | yes | inline | admin |
| `*` | `NotFoundPage` | yes | page | public |

**Guard layering.** A double-`ProtectedRoute` pattern: the outer `<ProtectedRoute/>` enforces authentication and renders the bootstrap/error/unconfigured screens once; `<ProtectedShell/>` wraps the `<Outlet/>` in `<AppShell>` (persistent chrome that does not unmount across navigation); the inner `<ProtectedRoute roles={[...]}/>` enforces the role check (user already known authenticated).

**`route-guards.tsx`.** `ProtectedRoute({roles?})` decision order: `!isConfigured` → config screen; `isBootstrapping` → loading screen; `error && !currentUser` → error screen; `!currentUser` → `<Navigate to="/login" state={{from}}/>`; `roles && !roles.includes(currentUser.role)` → role-based redirect (nurse → `/nurse`, admins → `/admin`); else `<Outlet/>`. **Frontend role guards are UX only - server-side authorization is the source of truth.**

**`HomeRedirect`** at `/` is a state machine over `useAppData()`: config-required → bootstrapping → error → `!currentUser` → `/login` → role-based landing (`currentUser.role === 'nurse' ? '/nurse' : '/admin'`).

## The AppDataContext data layer - `src/context/app-data-context.tsx`

This ~1700-line file is the single source of truth, exposing **two** React contexts plus five hooks.

### `AppState` shape (`src/types/domain.ts`, created by `createEmptyAppState()` in `src/lib/app-state.ts`)

```ts
interface AppState {
  currentUserId: string | null
  profiles: UserProfile[]
  assignments: ReportAssignment[]
  accessRequests: AccessRequest[]
  reportingPeriods: ReportingPeriod[]
  reports: ReportRecord[]
  statusHistory: ReportStatusHistoryEntry[]
  auditLogs: AuditLogEntry[]
  notifications: NotificationItem[]
  settings: AppSettings
  pendingDrafts: PendingDraftState[]
}
```

The current user is *not* stored as an object - it is `currentUserId`, resolved against `state.profiles` via `getCurrentUser(state)`. `settings` defaults to `defaultAppSettings`.

### Context API (`AppDataContextValue`, memoized)

- **Read state:** `state`, `currentUser`, `isBootstrapping`, `isConfigured`, `missingEnvVars`, `error`.
- **Auth:** `login(email, password) => Promise<UserRole|null>`, `logout()`.
- **Reports:** `saveReport(payload) => Promise<boolean>`, `lockReport(id, actorId)`, `unlockReport(id, actorId)`, `isReportDetailLoaded(id)`, `getReportDetailLoadState(id)`.
- **Notifications:** `markNotificationsRead(userId, ids)`, `clearNotifications(userId, ids)`, `restoreNotifications(notifications)`.
- **Access-request / admin:** `submitAccessRequest`, `claimSuperadmin`, `createAdminAccount`, `approveAccessRequest`, `rejectAccessRequest`, `updateSettings`, `toggleUserActive`, `toggleAssignmentActive`, `assignUserToDepartment`.
- **Lazy deferred loaders (`ensure*`):** `ensureProfileDirectoryData()`, `ensureAccessRequestData()`, `ensureHistoryData()`, `ensureReportDetails(reportIds, options?)`, `refreshData(options?)`.

Every handler is wrapped in `useCallback` with explicit deps; the context `value` is built with `useMemo` over those stable handlers + reactive state. Handler identities stay stable across renders so consumers using them in effect deps don't thrash.

### The SEPARATE `AppSyncContext` + `useAppSync`

A deliberate split to avoid re-render storms: `type AppSyncContextValue = { isSyncing: boolean; isDataRefreshing: boolean }`. The 20s poll and background sync flip these flags constantly; isolating them means only components calling `useAppSync()` (e.g. `AppShell`'s sync indicator) re-render on sync flips. `beginBackgroundSync`/`endBackgroundSync` use a ref counter; `isDataRefreshing` flips immediately, while `isSyncing` only flips after a **220ms** timer (so a fast refresh never flashes the spinner).

### Bootstrap / auth-restore flow

A single large `useEffect`. `isBootstrapping` initial value is `isApiConfigured`.
1. No client → clear everything, stop bootstrapping.
2. `client.auth.getSession()` (→ `GET /api/auth/me`). No `userId` → `clearSignedOutState()`.
3. With a `userId`: **cache-hit** → `applyWorkspaceCache(record)` paints the UI synchronously, then a *background* `loadUserState(..., {showBootstrapping:false})` revalidates; **cache-miss** → blocking `loadUserState(..., {showBootstrapping:true})`. For admins, warm report details via `ensureReportDetails(getAdminDashboardWarmReportIds(...))`.
4. `client.auth.onAuthStateChange((event, session) => ...)` handles `SIGNED_IN`/`SIGNED_OUT`; a mid-session 401 → `markSignedOut()` → `SIGNED_OUT` event → clears state → redirect to `/login`.

**Concurrency guards (refs):** `loadVersionRef` (monotonic; bails out of applying superseded loads), `currentUserIdRef`/`currentStateRef` (stale-closure-safe), `isSigningOutRef`, `suppressNextSignedInLoadRef`, `pendingExplicitAuthUserIdRef`.

### `loadUserState` - core fetch + merge

Behind bootstrap, refresh, and every `ensure*`. Calls `fetchLiveAppState(client, userId, {include*})` → `GET /api/workspace?...`. Stale-guard via `loadVersionRef`.
- **Smart merge:** workspace returns reports *without* heavy cell `values`/`calculatedMetrics`. For each incoming report, if a previously-loaded report with the same `id` and **identical `updatedAt`** exists, it reuses the cached detail (avoids blanking on every poll).
- **Selective field merge:** `profiles`, `accessRequests`, `statusHistory`, `auditLogs` are only taken from the response when their `include*` flag is set; otherwise previous values are preserved (this is what makes deferred loading durable across plain refreshes).
- Persists via `persistWorkspaceCache(...)`, sets loaded-flag refs, clears error, schedules overdue sync.

### The 20s admin live-refresh poll

A `useEffect` running only for admins: subscribes to a (no-op) realtime channel, adds `window` `focus` + `document` `visibilitychange` listeners (`refreshWhenVisible`, 150ms debounce), and **`window.setInterval(refreshWhenVisible, 20_000)`** - the live-dashboard heartbeat. `scheduleAdminLiveRefresh(delayMs=700)` debounces and guards re-entrancy, calling `refreshDataWithOptions(...)` preserving already-loaded deferred slices.

### Deferred loading - the `ensure*` family

The workspace payload is kept lean; expensive slices load on demand, gated by ref flags so they load **once**:
- `ensureProfileDirectoryData()` (`profileDirectoryLoadedRef`, `{includeProfiles:true}`; pre-set true for non-admins).
- `ensureAccessRequestData()` (`accessRequestDataLoadedRef`, `{includeAccessRequests:true}`).
- `ensureHistoryData()` (`historyDataLoadedRef`, `{includeHistory:true}`).
- `ensureReportDetails(reportIds, {force?})` - per-report cell-value loader: computes missing ids, marks them `loading`, `fetchReportDetails(client, ids)` (parallel `GET /api/reports/:id`), merges `values`/`calculatedMetrics`, marks `loaded`, persists cache; rolls back + toasts on error. Admin dashboard warming uses `getAdminDashboardWarmReportIds(state)` (reports in the last 8 visible periods).

### sessionStorage workspace cache

Key `'stpaul:workspace-state:v3'`. Record `{ version:3, userId, state, profileDirectoryLoaded, accessRequestDataLoaded, historyDataLoaded }`. `readWorkspaceCache(userId)` validates `version===3` AND `userId` match. `applyWorkspaceCache(record)` synchronously rehydrates - instant UI on reload before network revalidation returns.

### Optimistic saves - `applySavedReportDetails`

After `saveReport`, cell values are patched directly into state (matched by `id` OR by `(assignmentId, reportingPeriodId)` so a server-created report still matches). `saveReport` flow: `POST /api/reports`, invalidate history, full `refreshDataWithOptions()`, find the saved report, `fetchReportDetails` for it to get authoritative values, then `applySavedReportDetails` (falling back to the optimistic payload if the detail fetch fails).

### Hooks

`useAppData()` (full context; throws outside provider), `useAppSync()` (`{isSyncing, isDataRefreshing}`), `useAppState()` (= `useAppData().state`), `useCurrentUserProfile()`, `useCurrentReportingPeriod()`.

## The API client - `src/lib/api/*`

A hand-rolled typed client shaped like the old Supabase client to minimize migration churn, but speaking the Laravel/Sanctum REST API.

- **`client.ts` - `LaravelApiClient`.** `getApiBrowserClient()` returns `null` if `!isApiConfigured`, else memoizes a single `LaravelApiClient(apiEnv.baseUrl)`; `export const api = getApiBrowserClient()`.
  - **CSRF:** `ensureCsrfCookie()` runs before any unsafe method (`GET /sanctum/csrf-cookie`, caches `csrfReady`), then reads the `XSRF-TOKEN` cookie and sets `X-XSRF-TOKEN` (URL-decoded). All requests set `Accept: application/json`, `X-Requested-With: XMLHttpRequest`, and **`credentials: 'include'`**.
  - **`request<T>`:** JSON-encodes object bodies; passes FormData/string through; serializes query params (**booleans → `1`/`0`** because Laravel's `boolean` rule rejects `"true"`/`"false"` - regression-tested in `client.test.ts`); drops null/undefined; `204` → `null`.
  - **401 self-heal:** a 401 on any non-`/api/auth/` path calls `markSignedOut()` (clears `csrfReady`, emits a synthetic `SIGNED_OUT` event). All failures throw `ApiError(message, status, payload)`; `errorMessage()` extracts `payload.message` or the first validation error.
  - **Faux auth/realtime surface:** `auth.getSession()` maps `GET /api/auth/me`; `auth.onAuthStateChange(listener)` registers in-memory; `channel()`/`removeChannel()` are **stubs** (realtime not wired).
- **`env.ts`** - reads `import.meta.env.VITE_API_BASE_URL`, trims trailing slashes; `missingApiEnvKeys`, `isApiConfigured`, `apiEnvSetupHint`.
- **`helpers.ts`** - `isAdminRole(role)`, `resolveAssignmentReference(references, deptSlug, templateSlug)` (slug → DB ids via `departmentDbIdBySlug`/`templateDbIdBySlug`), `getErrorMessage`.
- **`auth.ts`** - `loginWithPassword` (field is `identifier`, supports email-or-username), `signOut`, `fetchSession`, `claimSuperadmin`, `sessionUserId`.
- **`workspace.ts`** - `fetchCurrentUserProfile` (throws if inactive), `fetchLiveAppState` (→ `GET /api/workspace?...` → `{ currentUser, references, state }`).
- **`reports.ts`** - `fetchReportDetails` (parallel `GET /api/reports/:id`), `saveReport` (`POST /api/reports`), `setReportLockState`, `listReports`. `syncOverdueNotifications` is a **no-op** (sync moved to the Laravel scheduler).
- **`analytics.ts`** - `fetchAnalytics<T>(client, endpoint, query?)`.
- **`admin.ts`** - `createAdminAccount` (forces `passwordChangeRequired: true`), `updateUserActiveState`, `updateAssignmentActiveState`, `reviewAccessRequest`, `ensureDepartmentReferenceData` (lazily creates template + department), `assignUserToDepartment`.
- **`access-requests.ts`**, **`notifications.ts`**, **`settings.ts`**, **`passwords.ts`** - domain mutations (the password client maps camelCase `passwordConfirmation` → snake_case `password_confirmation`).
- **`realtime.ts`** - a Laravel **Reverb** Echo client (`VITE_REVERB_*`), **deliberately NOT re-exported from `index.ts`** (it would pull `laravel-echo` + `pusher-js`, ~40KB gz, into the main bundle for a feature with no callers). The context's channel calls use the client *stub*; **the 20s poll is the actual live-update mechanism.**
- **`index.ts`** re-exports every module except `realtime`. **`types.ts`** defines `SaveReportPayload`, `AccessRequestPayload`, `ClaimSuperadminPayload`/`Result`, `CreateAdminAccountPayload`, `ApiReferenceState`, `LiveAppStateLoadOptions`, `ReportDetailRecord`, `WorkspacePayload`, `SessionPayload`, `ReportResponse`, `ListResponse<T>`, `SettingsResponse`, `DepartmentReferencePayload`, `NotificationRestorePayload`.

## Types, selectors, config

**`src/types/domain.ts`** - `UserRole = 'superadmin'|'admin'|'nurse'|'resident'|'consultant'`; `ReportFamily = 'inpatient'|'outpatient'|'procedure'`; `ReportStatus = 'not_started'|'draft'|'submitted'|'edited_after_submission'|'locked'|'overdue'` (UI/derived; `StoredReportStatus` is the persisted subset); `FieldKind`, `FieldAggregate`, `MetricFormat`; entities `UserProfile`, `Department` (`family`, `templateId`, `accent`, optional `bedCount`), template-config types (`ReportTemplateField`, `TemplateSection`, `SummaryCardConfig`, `ChartMappingConfig`, `ChangeWatchRule`, `ReportTemplateConfig`), `ReportAssignment`, `AccessRequest`, `ReportingPeriod`, `ReportFieldValue` (`dailyValues: Partial<Record<Weekday, CellValue>>`, `CellValue = number|string|null`), `CalculatedMetricSet`, `ReportRecord` (incl. `values: Record<fieldId, ReportFieldValue>` and `calculatedMetrics`), `NotificationItem`, `AppSettings`, `AppState`.

**`src/data/selectors.ts`** - pure functions over `AppState`; the model is weekly (each `ReportFieldValue` holds a Mon–Sun `dailyValues` map; selectors aggregate via `sumField`/`computeWeeklyValue`). A hard floor `liveReportingStartDate = 2026-03-02` excludes legacy periods.
- **Periods:** `getSortedReportingPeriods`, `getCurrentPeriod`, `getVisibleReportingPeriods`, `getPreviousPeriod`, `getReportingPeriodsForRange(range, anchor)` where `range: 'current'|'last4'|'last8'|'all'`.
- **Lookups:** `getCurrentUser`, `getAssignmentsForUser`, `getReportForAssignmentPeriod`, `getAssignmentCardsForPeriod`/`getCurrentWeekAssignmentCards`.
- **Status derivation:** `deriveReportStatusForPeriod`/`deriveReportStatus` encode the rules (no period→not_started; deadline-enforced past deadline via `isPastDeadline`; locked→locked; draft past deadline→overdue; else stored status).
- **Summaries:** `getReportingRangeSummary`, `getSubmissionBoard`, `getNurseSubmissionBoard`, `getDashboardSummary(periodId?, family?)` (the big KPI/delta computation; inpatient capacity via `aggregateInpatientMetrics`).
- **Trends/charts:** inpatient/outpatient/procedure weekly+monthly series + mix breakdowns driven by `PROCEDURE_SERVICE_DEFINITIONS`; generic `getTrendSeries`, `getDepartmentComparisonData`.
- **Insights/detail:** `getWhatChangedThisWeek`, `getRecentNotifications`, `getUnreadNotificationCount`, `getDepartmentDetail`, `getLockDeadlineNote`.

**`src/config/templates.ts`** - the static, **slug-based** catalog of 9 report templates and 27 departments (matching the seeded backend). Field builders (`numericField`, `decimalAverageField`, `timeField`, `textField`, `choiceField`) keep definitions DRY. `templateMap`/`departmentMap` are id→config lookups. These maps bridge **slug-based** client identifiers (selectors, routing params, `assignUserToDepartment`) to the Laravel DB ids (resolved at runtime via `ApiReferenceState`/`resolveAssignmentReference`).

---

# UI & Design System

## Tooling

Tailwind CSS v4 via `@tailwindcss/vite` (no `tailwind.config.js`; tokens in `src/index.css` via the v4 `@theme` directive). `clsx` + `tailwind-merge` combined into `cn()` (`src/lib/utils.ts`). Component base: shadcn/ui-style primitives wrapping Radix UI in `src/components/ui/*` (`components.json`: `style: default`, `baseColor: slate`, `cssVariables: false`), **heavily re-skinned** to a navy/blue/gold hospital theme using hard-coded hex values. Variants via `class-variance-authority`. Icons: `lucide-react`. Animation: `framer-motion` (section entrance reveals, count-up `AnimatedMetric`) + CSS keyframes. Toasts: `sonner`. Charts: `recharts`. Forms: `react-hook-form` + `zod`. Path alias `@/` → `src/`. PWA: `index.html` + `public/manifest.webmanifest` (theme `#002147`, "St Paul's").

## Design tokens

**Fonts (Google Fonts in `src/index.css`):** `Plus Jakarta Sans` (body/UI, `--font-sans`), `Manrope` (display/headings, `font-display` utility, tight tracking `-0.03em` to `-0.055em`), `Inter` (login form only).

**Color palette** (CSS custom properties + raw hex):

| Token | Hex | Role |
|---|---|---|
| brand-primary / admin-blue | `#005db6` | Primary blue - buttons, eyebrows, links, accents |
| brand-primary-strong | `#00468c` | Hover/darker blue |
| admin-navy | `#002147` | Deep navy (PWA theme, dark buttons, CSV export) |
| admin-ink | `#000a1e` | Near-black - headings, sidebar gradient start, dark panels |
| brand-accent / admin-gold | `#f0b429` | Gold accent - active nav, request-access CTA, chart highlight |
| brand-accent-strong | `#dea11b` | Gold hover |
| admin-blue-soft | `#63a1ff` | Light blue - gradient mids |
| admin-bg | `#f8f9fa` | App background |
| section panel | `#eef2f6` / `#f1f4f7` | Dominant card surface for page sections |
| admin-surface | `#ffffff` | White cards/inner surfaces |
| ink-soft / muted | `#44474e` / `#74777f` | Secondary / tertiary text |
| body text | `#091223` / `#000a1e` | Primary text |
| borders | `#d4dde8`, `#d9e0e7`, `#c4c6cf` | Hairline borders/outlines |

**Status semantic colors** (consistent across `Badge`/`StatusBadge`/tiles): Not started - bg `#edf1f5` text `#44474e`; Draft (info) - bg `#edf4fb` text `#005db6` border `#cfe0f4`; Submitted (success) - bg `#edf7f0` text `#1f6b3b` border `#cfe7d9`; Edited (warning) - bg `#fbf4e6` text `#8a5a00` border `#edd9b0`; Overdue (danger) - bg `#fff1f1` text `#b42318`/`#ba1a1a` border `#f1d1d1`. `#ba1a1a` is the canonical error red; emerald/rose denote Active/Inactive users.

**Light mode only** - no dark toggle. "Dark" surfaces are intentional emphasis: navy sidebar, `InsightPanel` (`bg-[#000a1e]`), `AdminPageHero` stats panel, login left panel, access-request hero. The global `body` has a layered aurora background (radial gradients over a light blue linear gradient), a faint 72px grid (`body::before`), drifting blobs (`body::after`, `@keyframes aurora-drift`), and custom thin scrollbars. Login-only keyframes drive ambient effects. **All decorative motion is disabled under `@media (prefers-reduced-motion: reduce)`.** Two global button classes `.auth-primary-button` (blue) and `.auth-accent-button` (gold) are reused by the cva `Button` default and auth pages.

**Shape language.** Corners are deliberately **small/squared**: `rounded-[0.35rem]` (sections/cards), `rounded-[0.25rem]` (buttons/chips/inputs/badges), `rounded-[0.5rem]` (a few larger panels); login inputs are `rounded-none` with a bottom border only. **Avoid pill / `rounded-2xl` for new primitives.** Surfaces favor `outline outline-1 outline-[#d4dde8]/65` over `border`; shadows are soft, navy-tinted, "lifted from below" (e.g. `shadow-[0_24px_60px_-42px_rgba(0,33,71,0.45)]`).

## UI primitives inventory (`src/components/ui/*`)

All accept `className` merged via `cn()`. Radix-based ones forward props through `ComponentProps<typeof X>`.

| File | Component(s) | Notable styling |
|---|---|---|
| `button.tsx` | `Button` (Radix `Slot`, cva) | Variants `default` (solid blue, bold), `secondary` (white→`#f3f4f5`, often flattened to white), `ghost`, `outline`, `destructive` (`#ba1a1a`). Sizes `default`/`lg` (h-12), `sm` (h-9), `icon`. Radius `0.25rem`. Common: `<Button asChild>` around a `<Link>` with a trailing lucide icon. |
| `card.tsx` | `Card`, `CardHeader/Title/Description/Content/Footer` | White, `rounded-[0.35rem]`, `outline outline-1 outline-[#d4dde8]/65`, padding `p-6 md:p-7`; Title uses `font-display`. |
| `badge.tsx` | `Badge` (cva) | Tiny uppercase chip, `rounded-[0.25rem]`, `text-[10px] font-bold uppercase tracking-[0.16em]`; variants `neutral/info/success/warning/danger`. |
| `input.tsx` | `Input` | h-11, white→`#f6f8fa` gradient, focus → blue border + `ring-4 ring-[#d6e3ff]/70`. |
| `textarea.tsx` | `Textarea` | min-h-28, same focus, `rounded-[0.5rem]`. |
| `select.tsx` | Radix Select set | h-11 trigger, `ChevronDown`; content portaled `z-[100]`, `data-[highlighted]:bg-[#edf4fb]`. |
| `checkbox.tsx` / `switch.tsx` | Radix | checked → blue fill / blue track. |
| `label.tsx` / `separator.tsx` / `scroll-area.tsx` | Radix | `text-sm font-medium text-slate-700` / 1px slate line / thin scrollbar. |
| `tabs.tsx` | Radix Tabs | default rounded, but consumers override to squared navy-active pills. |
| `sheet.tsx` | Radix Dialog | side drawer, **navy gradient bg, white text**; used for mobile nav. |
| `avatar.tsx` | Radix Avatar | fallback initials; shell overrides to `rounded-[0.35rem]` light-blue. |

**No Dialog/Modal, Table, Tooltip, Popover, Progress, or DropdownMenu primitive is in active use** - tables are hand-built CSS `grid` layouts, tooltips are Recharts-only. New screens should follow the **grid-as-table** and **section-panel** patterns.

## Layout shell (`src/components/layout/`)

**`app-shell.tsx`** - the authenticated chrome (renders only when `currentUser` exists; otherwise passes children through, so auth pages render full-bleed).
- **Sidebar (`<aside>`):** fixed left, `hidden sm:block`, navy gradient `linear-gradient(150deg,#000a1e,#07162f,#002147)`. Width animates `w-[292px]` ↔ `w-[84px]`; collapse state persists in `localStorage` key `stpaul:sidebar-collapsed`. Contains the **BrandLockup** (St Paul's logo + "St Paul's Hospital" / "Internal Medicine"), **SidebarNav** (maps `navigationByRole[role]`; active = left gold border `#f0b429`, white text, gold icon, `bg-white/[0.04]`), and a reporting-week footer.
- **Header (`<header>`):** sticky, `bg-[#f8f9fa]/96 backdrop-blur-sm`. Left: mobile hamburger (opens left `Sheet`), desktop collapse toggle, a "Live reporting period" chip. Right: **Sync indicator** (chip + animated ping dot when `isSyncing`, via `useAppSync()`), **Notifications bell** (unread `bg-[#ba1a1a]` `pulse-ring` badge), **User chip** (avatar initials + name + uppercase title + `LogOut`).
- **Main:** `<main className="min-w-0 flex-1">`; content wrapper left padding animates with the sidebar.
- **Dev only:** `ViewportDebugReadout` (gated by `import.meta.env.DEV`).
- **Breakpoints:** phone `<640` (mobile nav via Sheet), tablet `640–1024`, desktop `≥1024`. `sm:` (640) toggles the sidebar; admin two-column grids collapse at `xl` (1280).

**`app-state-screen.tsx`** - full-screen status card (loading / config-required / error / info) with a gradient top bar `linear-gradient(90deg,#005db6,#63a1ff,#f0b429)`, logo lockup, tone-colored eyebrow + icon (`CircleDashed`/`Wrench`/`AlertTriangle`/`ShieldCheck`), display `<h1>`, description, optional `detail` block. Tone inferred from the title text.

**`src/config/navigation.ts`** - `navigationByRole: Record<UserRole, NavigationItem[]>` (`{label, href, icon}`).
- superadmin/admin (identical): Dashboard `/admin`, Submissions `/admin/submissions`, Users & Access `/admin/users`, Templates `/admin/templates`, Audit Log `/admin/audit`, Settings `/admin/settings`.
- nurse: Home `/nurse`, My Reports `/nurse/reports`, Access Request `/register`, Activity `/nurse/activity`.
- `/admin/manual-admin-setup` is intentionally **not** in nav (hidden bootstrap route).

## Recurring page composition patterns (match these for new screens)

1. **Page = vertical stack of section panels:** `<div className="space-y-8">` of `<motion.section>` blocks styled `rounded-[0.35rem] bg-[#eef2f6] px-5 py-5/6 md:px-6` (admin dashboard uses `#f1f4f7`).
2. **Section header trio:** blue uppercase **eyebrow** (`text-[11px] font-semibold uppercase tracking-[0.22em] text-[#005db6]`), display `<h1>`/`<h2>` (`font-display`, `text-[2rem] md:text-[2.35rem]`), muted description.
3. **Summary stat tiles:** `grid gap-3 sm:grid-cols-2 xl:grid-cols-4` of small tone-colored tiles (`rounded-[0.35rem] px-3.5 py-3 outline outline-1`): icon + uppercase label + big `font-display` value + muted note. Tone strings reused verbatim (blue `text-[#005db6] bg-[#edf4fb] outline-[#cfe0f4]/75`, gold, green, navy).
4. **Counter chips:** white bordered `rounded-[0.25rem] border-[#d4dde8] px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.18em]` with a leading blue icon.
5. **Empty states:** centered dashed-border white box (`min-h-[180–240px] border-dashed`), blue lucide glyph, bold + muted lines.
6. **Hairline dividers:** `border-t border-[#d9e0e7]` with `pt-4`.

## Key feature components

- **`reports/report-form.tsx`** - the core weekly data-entry experience (`ReportFormPage` reads `:assignmentId/:periodId`). Per-field Zod schema from the template (`createTemplateSchema`; numerics non-negative ≤1e9, `time` `HH:MM`, `choice` ∈ options, text ≤120), `mode: 'onChange'`. Header section (status chip + 4-tile summary). **Autosave** debounces 1400ms (saves `{submit:false}` when dirty+valid+editable, resets the form, sets a "Draft autosaved" label; `beforeunload` guard). The grid per template section has **two layouts**: desktop (`hidden xl:block`) horizontally-scrollable CSS grid `minmax(220px,2fr) repeat(activeDays, minmax(76px,0.9fr)) minmax(96px,0.95fr)`; mobile (`xl:hidden`) stacked cards. `FieldInput` picks the control by `field.kind` (choice→Select, name-text→Input, text→Textarea, integer/decimal→numeric Input, time→`<input type="time">`). Sticky footer `sticky bottom-4`. `ReportStatePanel` covers loading/restricted/no-report states.
- **`dashboard/chart-card.tsx` (`ChartCard`)** - `motion.div` over a `Card` (`bg-[#eef2f6] shadow-none`) with a white inner box; generic chart container.
- **`dashboard/status-badge.tsx` (`StatusBadge`)** - the single source of truth mapping each `ReportStatus` to a `Badge` variant + lucide icon + label.
- **`dashboard/insight-panel.tsx` (`InsightPanel`)** - dark navy card (`bg-[#000a1e] text-white`) with a gold `Lightbulb` and a stagger-animated list of "what changed" strings.
- **`dashboard/submission-board-grid.tsx` (`SubmissionBoardGrid`)** - the matrix board (admin Submissions + nurse selection). `md+` CSS grid `minmax(180px,1.2fr) minmax(160px,1fr) repeat(4, minmax(120px,1fr))`; each cell is a `<Link>` to the report, status-tinted with a `StatusBadge`.
- **`admin/admin-page-hero.tsx` (`AdminPageHero`)** - large hero (`#eef2f6`) in `grid xl:grid-cols-[1fr_320px]`; left eyebrow + big display title + description + optional `meta`/`actions`; right optional dark navy "Weekly posture" stats panel. `PageHeader` (`layout/page-header.tsx`) is a thin wrapper.
- **`admin/reporting-scope-panel.tsx` (`ReportingScopePanel`)** - the standard filter bar: `#f8fafc` outlined box of labeled `Select`s (auto-fit columns) + optional tone-colored metric tiles. Used by admin Dashboard, Submissions, Audit, Department Detail. **New admin filter UIs should reuse this.**
- **`reports/report-assignment-card.tsx`** - the nurse's report tile: white card with hover lift, period eyebrow, display department name, template, `StatusBadge`, state chips, "Last update" box, and an "Open report"/"View report" `Button asChild` `<Link>`.

## Page-by-page map

**Auth (public, full-bleed, no shell)**
- **Login** `src/pages/auth/login-page.tsx` · `/login` - signature split-screen: navy gradient left panel with a Manrope headline "Weekly Reporting **& Review Dashboard**", white right form with **underline-style inputs** (`rounded-none border-b-2`) for username/email + password (show/hide), "Forgot password?" link, blue submit, gold "Request access", technical-support footer (`src/config/support.ts`). Preloads dashboards on idle.
- **Forgot password** `forgot-password-page.tsx` · `/forgot-password` - centered white card, one email input, "Send reset link".
- **Reset password** `reset-password-page.tsx` · `/reset-password` - new + confirm password (validates length ≥8 and match), navigates to `/login` on success.
- **Access request** `access-request-page.tsx` · `/register` - public (new account) and signed-in (request more). Elaborate: `xl:grid-cols-[1fr_380px]` with a dark navy "01 Profile / 02 Assignments / 03 Review" hero, a Profile panel, a department chooser grouped by service line (accent-topped checkbox cards), an optional reviewer note, and a sticky right "Review and submit" summary with the gold submit CTA.

**Nurse**
- **Dashboard** `nurse/nurse-dashboard-page.tsx` · `/nurse` - hero + 4-tile summary (Assigned/Drafts/Locked/Unread), `xl:grid-cols-[1.08fr_0.92fr]` (assigned-reports grid of `ReportAssignmentCard`s + latest-activity notifications list), access CTA strip.
- **My Reports** `report-selection-page.tsx` · `/nurse/reports` - hero with service-line filter buttons + 4-tile summary, period `Select` + `ReportAssignmentCard` grid, a `SubmissionBoardGrid` of the nurse's own rows.
- **Activity** `activity-page.tsx` · `/nurse/activity` - hero + 4-tile summary, a "Recent changes" timeline (`lg:grid-cols-[1fr_220px]` rows with service `Badge` + `StatusBadge` + change note + actor + timestamp).

**Admin (superadmin/admin)**
- **Dashboard** `admin/admin-dashboard-page.tsx` · `/admin` - the analytics centerpiece (~2400 lines). Hero with status pills + a navy **Export CSV** link (`<a>` to `${apiEnv.baseUrl}/api/analytics/export`); a `ReportingScopePanel` (Time range / Ending period / Service line) + a Weekly/Monthly segmented toggle. **Submission pulse**: donut `PieChart` (animated center `AnimatedMetric`) + status ledger + delivered/open/overdue trend (`AreaChart`/`BarChart`). **Per-service-line sections** (Inpatient: ward movement + BOR/BTR/ALOS; Outpatient: seen vs not-seen, follow-up wait, availability stacked bars; Procedures: throughput, dialysis split, endoscopy mix) in white-gradient `chartPanelClass` panels with the restrained blue/navy/gold/steel palette.
- **Submissions** `submission-board-page.tsx` · `/admin/submissions` - `ReportingScopePanel` (+ Status) + 4-tile summary + full-org `SubmissionBoardGrid`.
- **Users & Access** `user-management-page.tsx` · `/admin/users` - hero + 4-tile summary; **Access requests** queue (Approve secondary / Reject destructive) + **Assignment studio** (two `Select`s + preview + "Add assignment"); **Active roster** cards (role `Badge`, Active/Inactive emerald/rose chip, assignment `Checkbox` toggles, Deactivate/Activate protected for admins unless superadmin).
- **Templates** `template-management-page.tsx` · `/admin/templates` - `Tabs` (Inpatient/Outpatient/Procedures, navy-active squared); per-template `xl:grid-cols-[1.2fr_0.8fr]` panel (day chips, sections, summary-metric `Badge`s; signal rules with gold % chips). Read-only display of config.
- **Department detail** `department-detail-page.tsx` · `/admin/departments/:departmentId` - `PageHeader` + `ReportingScopePanel` + 4-up summary `Card`s + `2xl:grid-cols-[1.35fr_1fr]` (historical trend `LineChart` beside the dark `InsightPanel`) + current report state + audit highlights.
- **Audit log** `audit-log-page.tsx` · `/admin/audit` - hero + 4-tile summary + `ReportingScopePanel` (Department); "Audit stream" rows (`lg:grid-cols-[1.2fr_0.95fr_180px]`) with Before/After boxes (`ArrowRightLeft`).
- **Settings** `settings-page.tsx` · `/admin/settings` - hero + 4-tile summary; `xl:grid-cols-[1.05fr_0.95fr]` (Rule settings form: `Switch` enforce-deadlines, deadline day/time `Select`s, auto-lock hours, rise/drop thresholds, live "Unsaved/Saved" chip, "Save settings"; right Current-week preview panel + critical-fields coverage).
- **Manual admin setup** `manual-admin-setup-page.tsx` · `/admin/manual-admin-setup` (hidden, redirects ineligible users) - **Claim superadmin** form (shown only when no superadmin exists) and, for superadmins, a **Create admin user** form + restricted admin roster.

**Top-level**
- **Notifications** `notifications-page.tsx` · `/notifications` and `/admin/notifications` - hero with Mark all read / Restore last clear / Clear inbox + 4-tile summary; inbox of `<Link>` cards routed by `notification.relatedRoute`, each with a type-specific icon tile (`notificationMeta` maps the 8 `NotificationType`s). Clearing snapshots to `sessionStorage` for restore.
- **Not found** `not-found-page.tsx` · `*` - centered `Card` with "Return to login".

## Visual identity summary (for matching new screens)

Clean clinical/institutional, dense but calm; deep navy + medical blue with a single gold accent; soft navy-tinted shadows and 1px hairline outlines. Manrope display headings, Plus Jakarta Sans body, Inter on login; eyebrows/chips always uppercase, small, letter-spaced. Squared corners (`0.25–0.5rem`), never pills. Buttons: blue (primary) / gold (accent CTA) / flat white (secondary) / red (destructive). Page = vertical `space-y-8` of `#eef2f6` section panels; KPIs as 4-up tone tiles; tables as CSS grids; filters via `ReportingScopePanel`; charts in white-gradient panels with the blue/navy/gold/steel palette. Dark surfaces reserved for emphasis. Motion is subtle and respects `prefers-reduced-motion`. **Key files to mirror:** `src/index.css`, `src/components/ui/*`, `admin-page-hero.tsx` + `reporting-scope-panel.tsx`, `src/components/dashboard/*`, `report-assignment-card.tsx` + `report-form.tsx`, and any existing `src/pages/**` as a structural template.

---

# Frontend ↔ Backend Contract

## The Vite dev proxy (`vite.config.ts`)

```ts
server: {
  proxy: {
    '/api':     { target: 'http://127.0.0.1:8000', changeOrigin: false },
    '/sanctum': { target: 'http://127.0.0.1:8000', changeOrigin: false },
  },
},
```

**Why it exists.** Sanctum SPA auth is cookie + session based. After `GET /sanctum/csrf-cookie`, Laravel sets the session cookie (e.g. `st-paul-reporting-api-session`, `HttpOnly`) and `XSRF-TOKEN` (JS-readable). Both are `SameSite=lax` (`config/session.php → same_site = 'lax'`). A `SameSite=lax` cookie is only sent on **same-site** requests, and **`localhost` and `127.0.0.1` are different sites to the browser** even though they resolve to the same host. The dev SPA runs on `http://localhost:5173`, the API on `http://127.0.0.1:8000` - a direct cross-origin XHR would drop the cookie or be blocked. The proxy fixes this: the browser only talks to the **Vite origin**, and Vite forwards `/api/*` and `/sanctum/*` server-side, so from the browser's perspective SPA and API are the *same origin* and cookies "just work." `changeOrigin: false` keeps the `Host` header as the Vite origin so Sanctum still recognizes the stateful domain.

`manualChunks` (in `build.rollupOptions.output`) splits vendor code: `recharts`→`charts`, `framer-motion`→`motion`, `@radix-ui`→`radix-ui`, react/react-dom/react-router→`react-core`, rest of `node_modules`→`vendor`.

## `VITE_API_BASE_URL` (`src/lib/api/env.ts`)

```ts
const rawApiBaseUrl = import.meta.env.VITE_API_BASE_URL
export const apiEnv = { baseUrl: rawApiBaseUrl?.trim().replace(/\/+$/, '') || null }
export const isApiConfigured = !!apiEnv.baseUrl
```

- **Locally** set to the **Vite origin** (e.g. `http://localhost:5173`), *not* the Laravel port - the client issues requests to `http://localhost:5173/api/...` which the proxy forwards. Pointing it at `:8000` would reintroduce the cross-site cookie problem.
- **In production** it points at the real same-origin/same-site API host.
- If unset, `isApiConfigured` is false, `getApiBrowserClient()` returns `null`, every context handler early-returns, and the app renders the "Laravel API Configuration Required" `AppStateScreen`.

## API client behaviors (Sanctum/CSRF) - see also Frontend → API client

CSRF priming before unsafe methods; `credentials: 'include'` always; `X-XSRF-TOKEN` echoed from the cookie; query booleans serialized as `1`/`0`; mid-session 401 → `markSignedOut()` → `SIGNED_OUT` → redirect to `/login`; failures throw `ApiError`; `errorMessage()` surfaces `{message}` or the first `{errors:{...}}` entry into toasts.

## Backend CORS / Sanctum / Session config

**`backend/config/cors.php`**
```php
'paths' => ['api/*', 'sanctum/csrf-cookie', 'login', 'logout', 'broadcasting/auth'],
'allowed_origins' => explode(',', env('CORS_ALLOWED_ORIGINS', env('FRONTEND_URL', 'http://localhost:5173'))),
'supports_credentials' => true,
```
`supports_credentials => true` is **mandatory** for cookie auth (emits `Access-Control-Allow-Credentials: true`). Because credentials are on, `allowed_origins` **cannot be `*`** - it's an explicit list from `CORS_ALLOWED_ORIGINS` (defaults to `FRONTEND_URL`). In dev the proxy means CORS rarely triggers, but the config must still be correct for production.

**`backend/config/sanctum.php`**
```php
'stateful' => explode(',', env('SANCTUM_STATEFUL_DOMAINS',
  'localhost,localhost:3000,127.0.0.1,127.0.0.1:8000,::1'.Sanctum::currentApplicationUrlWithPort())),
'guard' => ['web'],
```
`SANCTUM_STATEFUL_DOMAINS` lists every origin that should get **stateful session-cookie auth** (`.env.example` sets `localhost:5173,127.0.0.1:5173,localhost,127.0.0.1`). **In production drop the localhost entries and add the real frontend host** - a request from a non-listed domain falls back to bearer-token auth and the SPA session won't work. `guard => ['web']` ties Sanctum to the web session guard.

**`backend/config/session.php`** - `driver` = `SESSION_DRIVER` (`database` in `.env.example`, `array` in phpunit); `same_site = 'lax'`; `secure` = `SESSION_SECURE_COOKIE` (false local http, **must be true in production https**); `http_only = true` (session cookie not JS-readable; `XSRF-TOKEN` is the JS-readable one); `domain` = `SESSION_DOMAIN` (set in prod if SPA + API share a parent domain).

---

# Build, Run, Test, Deploy

## Local run (two servers)

The Vite SPA and the Laravel API run **separately**.

**Backend** (`backend/`):
```bash
composer setup     # first time: install, copy .env, key:generate, migrate, npm build
php artisan serve  # API on http://127.0.0.1:8000
# or: composer dev # concurrently runs serve + queue:listen + pail + npm run dev
```
- Local DB is **SQLite** (`DB_CONNECTION=sqlite`; `composer post-create-project-cmd` touches `database/database.sqlite`). **Production uses MariaDB/MySQL**.
- `.env` must set `APP_KEY`, `SANCTUM_STATEFUL_DOMAINS`, `CORS_ALLOWED_ORIGINS`/`FRONTEND_URL`. **`APP_DEBUG=false` by default** (boot throws if true in production).

**Frontend** (repo root):
```bash
npm install
npm run dev        # vite on http://localhost:5173 (proxies /api + /sanctum to :8000)
# npm run dev:host # same with --host (LAN access)
```
Set `VITE_API_BASE_URL=http://localhost:5173` (the Vite origin).

## Tests

| Layer | Command | Notes |
|---|---|---|
| Frontend | `npm run test` (watch) / `npm run test:run` (CI) | **Vitest**, jsdom, globals, `./src/test/setup.ts`; config in `vite.config.ts` `test:` block. Example `src/lib/api/client.test.ts`. |
| Backend | `composer test` / `php artisan test` | **PHPUnit** (`backend/phpunit.xml`). Testing env forces `DB_CONNECTION=sqlite`, `DB_DATABASE=:memory:`, `SESSION_DRIVER=array`, `BROADCAST_CONNECTION=null`, `MAIL_MAILER=array`, `BCRYPT_ROUNDS=4`. Suites `tests/Unit`, `tests/Feature`. |

Frontend combined gate: `npm run verify` = `lint` + `test:run` + `build`. Backend feature tests use `RefreshDatabase`, seed the domain, and drive endpoints with `$this->actingAs($user)->getJson(...)->assertJsonPath(...)` (canonical pattern: `tests/Feature/WorkspaceApiTest.php`).

## Build and deploy

Production uses one atomic on-premises release. `deploy/deploy.sh` creates an immutable release directory, installs dependencies, runs validation, verifies a pre-migration backup, migrates during maintenance mode, switches `/opt/imreport/current` atomically, and fails closed on health or readiness errors. Nginx serves `current/dist` and forwards API requests to `current/backend/public/index.php`.

---

# Conventions & Gotchas

**File organization & naming.** Frontend files are **kebab-case** (`app-data-context.tsx`); components/types PascalCase; `@/` → `src/`. The API layer is split by domain in `src/lib/api/*` with a barrel at `src/lib/api/index.ts` - **one deliberate exception: `realtime.ts` is NOT re-exported** (it statically imports `laravel-echo` + `pusher-js` ~40KB gz for an unwired feature). Backend follows Laravel conventions; models use `HasUuids` (string UUID PKs); serialization lives in `SerializesAdminResources` (snake_case columns → camelCase JSON).

**Validation.** Frontend: **Zod** + `react-hook-form` `zodResolver`; cross-field rules Zod can't express (password confirm) checked imperatively via `form.setError`. Backend: **inline `$request->validate([...])`** at the top of each action (no FormRequest classes), accepting **both** snake_case and camelCase keys (`'full_name'`/`'fullName'`, `required_without` pairs).

**Error handling.** Backend returns `{message}` (and `{errors}` on 422). The client's `errorMessage()` extracts the human string into `ApiError.message`; frontend handlers `toast.error(getMessage(error, fallback))`. A mid-session 401 self-heals via `markSignedOut()` → context clears → `/login`.

**Realtime is scaffolded but unused.** `backend/composer.json` includes `laravel/reverb`; `src/lib/api/realtime.ts` has `getEchoClient()` but **no callers**. `client.channel(...)`/`subscribe()` are no-op stubs; "live" admin refresh is actually a **20s `setInterval` + window focus/visibilitychange poll** (`scheduleAdminLiveRefresh`).

**Server-side authorization is mandatory and is the source of truth.** Frontend role guards (`ProtectedRoute`, nav) are **UX only**.

### Consolidated gotchas checklist

1. **`useMemo` dep array** (`app-data-context.tsx`): every context handler must appear in **both** the `value` object AND that `useMemo`'s deps array - forgetting the dep array yields stale closures.
2. **Barrel re-export:** add new `src/lib/api/*` modules to `index.ts`, but **never** let the barrel pull in `realtime.ts`.
3. **The proxy / `VITE_API_BASE_URL`:** locally points at the **Vite origin** (`localhost:5173`), not the Laravel port, so `SameSite=lax` cookies stay same-site. Don't "fix" it to `:8000`.
4. **Server-side authz is mandatory:** `permission:` route middleware + `Gate::authorize` in the action. Frontend guards/nav are UX only.
5. **Two contexts:** data/handlers in `AppDataContext` (`useAppData`); only sync flags in `AppSyncContext` (`useAppSync`).
6. **camelCase contract:** the backend serializer emits camelCase; the frontend `domain.ts` type must match exactly. Controllers accept both cases on input, but responses are camelCase.
7. **Permission registration:** a new permission constant in `Permissions.php` auto-wires as a Gate via `AppServiceProvider::boot()` (`Permissions::all()`) - but you still must add it to the relevant `ROLE_PERMISSIONS` arrays, and **manually register new policies** with `Gate::policy(...)`.
8. **Boolean query params** serialize as `1`/`0` (Laravel rejects `"true"`/`"false"`); the client does this automatically.
9. **Realtime is unwired:** "live" admin refresh is a 20s poll + focus/visibility listener, not WebSockets.
10. **Production config:** `SESSION_SECURE_COOKIE=true`, the internal HTTPS hostname in Sanctum and CORS configuration, `APP_DEBUG=false`, `DB_CONNECTION=mariadb`, `APP_TIMEZONE=UTC`, and `HOSPITAL_TIMEZONE=Africa/Nairobi`. SPA and API share the Nginx origin; hospital calendar dates and wall-clock schedules use Nairobi time while stored timestamps remain UTC.

---

# How to Add a Feature (end-to-end playbook)

The canonical, ordered recipe, using a running example: **"Incident Reports"** - a new entity `incidents`, admin-only CRUD, a new `/admin/incidents` page. The access-request flow (public submission + admin review) and the report flow are the two best end-to-end references.

> **Golden rule:** do the **backend first** and verify with a PHPUnit feature test before touching the frontend. The frontend is a thin client over the API.

## PART A - Backend

### A1. Migration - `backend/database/migrations/`
Copy `2026_05_25_180070_create_access_requests_table.php`. Use a UUID PK, `foreignUuid(...)->constrained(...)`, and the indexes you'll query on.
```php
Schema::create('incidents', function (Blueprint $table) {
    $table->uuid('id')->primary();
    $table->foreignUuid('reported_by')->constrained('users')->cascadeOnDelete();
    $table->string('title');
    $table->text('description')->nullable();
    $table->enum('severity', ['low','medium','high'])->default('low');
    $table->timestamps();
    $table->index(['severity', 'created_at']);
});
```
Run `php artisan migrate`.

### A2. Model - `backend/app/Models/`
Copy `AccessRequest.php`. Add `use HasUuids;`, `$fillable`, `casts()`, relationships.
```php
class Incident extends Model {
    use HasUuids;
    protected $fillable = ['reported_by','title','description','severity'];
    public function reporter(): BelongsTo { return $this->belongsTo(User::class, 'reported_by'); }
}
```

### A3. Permission entries - `backend/app/Support/Authorization/Permissions.php`
Add constants and grant them in `ROLE_PERMISSIONS`. (`Permissions::all()` auto-registers every permission as a Gate in `AppServiceProvider::boot()`.)
```php
public const INCIDENTS_VIEW   = 'incidents.view';
public const INCIDENTS_MANAGE = 'incidents.manage';
// add to the 'superadmin','admin' arrays (and 'nurse' if applicable)
```

### A4. Policy - `backend/app/Policies/`
Copy `AccessRequestPolicy.php` (uses `HandlesDomainAuthorization` → `isAdminLike($user)`).
```php
class IncidentPolicy {
    use HandlesDomainAuthorization;
    public function viewAny(User $u): bool { return $this->isAdminLike($u); }
    public function view(User $u, Incident $i): bool { return $this->isAdminLike($u) || $i->reported_by === $u->id; }
    public function create(User $u): bool { return $u->active; }
    public function update(User $u, ?Incident $i = null): bool { return $this->isAdminLike($u); }
    public function delete(User $u, ?Incident $i = null): bool { return $this->isAdminLike($u); }
}
```
**Register it** in `backend/app/Providers/AppServiceProvider.php::boot()`:
```php
Gate::policy(Incident::class, IncidentPolicy::class);
```
(`Gate::before` already short-circuits inactive users to `false`.)

### A5. Service (only if non-trivial logic)
For multi-step write logic (transactions, notifications, side effects), extract a service like `App\Services\Admin\AccessRequestReviewService` and inject it into the controller constructor. Simple CRUD can live directly in the controller. (The access-request *review* delegates to a service; the *submission* controller does its transaction inline - both patterns are acceptable.)

### A6. Controller - `backend/app/Http/Controllers/Api/Admin/`
Copy `AccessRequestController.php`. Use `SerializesAdminResources` (add `serializeIncident()` - see A8), call `Gate::authorize(...)` at the top of every action, validate inline, return camelCase JSON under a `data` key (lists) or the bare object (show).
```php
class IncidentController extends Controller {
    use SerializesAdminResources;
    public function index(Request $r): JsonResponse {
        Gate::authorize('viewAny', Incident::class);
        return response()->json(['data' => Incident::query()->with('reporter')->latest()->get()
            ->map(fn (Incident $i) => $this->serializeIncident($i))]);
    }
    public function store(Request $r): JsonResponse {
        Gate::authorize('create', Incident::class);
        $v = $r->validate([
            'title' => ['required','string','max:255'],
            'description' => ['nullable','string','max:2000'],
            'severity' => ['required', Rule::in(['low','medium','high'])],
        ]);
        $incident = Incident::query()->create([...$v, 'reported_by' => $r->user()->id]);
        return response()->json($this->serializeIncident($incident), 201);
    }
    // show / update / destroy follow the same shape
}
```

### A7. Routes - `backend/routes/api.php`
Add inside the `['auth:sanctum','active']` group → `admin` prefix block, guarding each route with `permission:`. View vs. manage map to the two permissions.
```php
Route::prefix('admin')->group(function (): void {
    Route::get('/incidents',  [IncidentController::class, 'index'])->middleware('permission:incidents.view');
    Route::post('/incidents', [IncidentController::class, 'store'])->middleware('permission:incidents.manage');
    Route::get('/incidents/{incident}',    [IncidentController::class, 'show'])->middleware('permission:incidents.view');
    Route::patch('/incidents/{incident}',  [IncidentController::class, 'update'])->middleware('permission:incidents.manage');
    Route::delete('/incidents/{incident}', [IncidentController::class, 'destroy'])->middleware('permission:incidents.manage');
});
```
**Two layers of authz on purpose:** `permission:` middleware gates the route by role-permission; `Gate::authorize` gates the specific record/ability. Keep both.

### A8. Serializer - `backend/app/Http/Controllers/Api/Concerns/SerializesAdminResources.php`
Add a method converting snake_case → camelCase, dates via `?->toJSON()`, booleans via `(bool)`. This is the shape the frontend type in B2 must mirror.
```php
protected function serializeIncident(Incident $i): array {
    $i->loadMissing('reporter');
    return [
        'id' => $i->id, 'title' => $i->title, 'description' => $i->description,
        'severity' => $i->severity, 'reportedBy' => $i->reported_by,
        'reportedByName' => $i->reporter?->full_name,
        'createdAt' => $i->created_at?->toJSON(), 'updatedAt' => $i->updated_at?->toJSON(),
    ];
}
```
*If the entity belongs in the initial workspace hydration* (rather than lazily fetched), also add it to `WorkspaceController::show()` and `WorkspacePayload`/`AppState`. For an admin-fetched list, a dedicated endpoint (above) is simpler.

### A9. Feature test - `backend/tests/Feature/`
Copy the `WorkspaceApiTest.php`/`AdminApiTest.php` pattern: `use RefreshDatabase`, seed roles + domain, build a user (`User::factory()->role('admin','Administrator')->create()`), then `$this->actingAs($admin)->postJson('/api/admin/incidents', [...])->assertCreated()->assertJsonPath('severity','high')`. Also assert a non-admin gets `assertForbidden()`. Run `php artisan test`.

## PART B - Frontend

### B1. API client function + barrel export - `src/lib/api/`
Create `src/lib/api/incidents.ts` (copy `reports.ts`/`access-requests.ts`). Each function takes the `LaravelApiClient` first and uses `client.get/post/patch/delete` with `/api/...` paths.
```ts
import type { LaravelApiClient } from '@/lib/api/client'
import type { Incident, ListResponse, SaveIncidentPayload } from '@/lib/api/types'

export async function listIncidents(client: LaravelApiClient) {
  return client.get<ListResponse<Incident>>('/api/admin/incidents')
}
export async function createIncident(client: LaravelApiClient, payload: SaveIncidentPayload) {
  return client.post<Incident>('/api/admin/incidents', payload)
}
// updateIncident / deleteIncident similarly
```
**Add the re-export** to `src/lib/api/index.ts`: `export * from '@/lib/api/incidents'` (keep alphabetical; do **not** add anything that statically pulls in `realtime.ts`).

### B2. Types - `src/types/domain.ts` (+ payload types in `src/lib/api/types.ts`)
Add the `Incident` domain type **matching the serializer's camelCase shape exactly** (A8). Put request/response payload shapes (`SaveIncidentPayload`) in `src/lib/api/types.ts` next to `SaveReportPayload`/`AccessRequestPayload`. If incidents join `AppState`, add `incidents: Incident[]` to the `AppState` type and to `createEmptyAppState()` in `src/lib/app-state.ts`.

### B3. Context handler - `src/context/app-data-context.tsx` ← **the most error-prone step**
1. Import your mutation from `@/lib/api`.
2. Add the method signature to the `AppDataContextValue` type.
3. Define a `useCallback` handler (copy `submitAccessRequest`/`approveAccessRequest`): guard `if (!client) return`, optionally check `isAdminRole(currentUser.role)`, `try { await createIncident(client, payload); await refreshDataWithOptions({...}) } catch (e) { toast.error(getMessage(e, '...')) }`.
4. **Add it to BOTH the `value` `useMemo` object AND that `useMemo`'s dependency array.** This is the classic bug: add the function to the returned object but forget the dep array → consumers get a stale closure. Every handler appears in both places - match that exactly.
```ts
const createIncident = useCallback(async (payload: SaveIncidentPayload): Promise<boolean> => {
  if (!client) { toast.error(`Laravel API is not configured. ${apiEnvSetupHint}`); return false }
  try { await createIncidentMutation(client, payload); await refreshDataWithOptions(); return true }
  catch (e) { toast.error(getMessage(e, 'Unable to create the incident.')); return false }
}, [client, refreshDataWithOptions])
// → add `createIncident` to the value object AND to the useMemo deps array
```
If your entity is **lazily fetched** rather than carried in the workspace payload, add an `ensureIncidentData()` loader (copy `ensureAccessRequestData`/`ensureHistoryData`) with a `loadedRef` flag so it fetches once, and call it from the page's `useEffect`.

### B4. Selector (if derived/filtered data is needed) - `src/data/selectors.ts`
Pure functions over `AppState` (e.g. `getOpenIncidents(state)`), matching `getCurrentUser`/`getVisibleReportingPeriods`. Skip if the page just renders the raw list.

### B5. Page + lazy route + role guard - `src/pages/` and `src/App.tsx`
Create `src/pages/admin/incident-management-page.tsx` (copy `user-management-page.tsx`). Consume `const { state, createIncident, ensureIncidentData } = useAppData()`; build forms with **Zod + react-hook-form** (copy `access-request-page.tsx`'s `requestSchema`/`zodResolver`); use `components/ui` primitives and the section-panel composition patterns; surface errors via the context handlers' toasts.

In `src/App.tsx`:
- Add `lazy(() => import('@/pages/admin/incident-management-page').then(m => ({ default: m.IncidentManagementPage })))`.
- Add a `<Route>` inside the existing admin guard `<Route element={<ProtectedRoute roles={['superadmin','admin']} />}>`, wrapped in `renderLazyRoute(..., 'inline')`:
```tsx
<Route path="/admin/incidents" element={renderLazyRoute(<IncidentManagementPage />, 'inline')} />
```
**Frontend guards are UX only.** `ProtectedRoute roles={...}` only hides/redirects in the browser; it is **not** security. The real gate is the backend `permission:` middleware + `Gate::authorize` (A7/A6).

### B6. Nav entry - `src/config/navigation.ts`
Add a `NavigationItem` (`label`, `href`, lucide `icon`) to the relevant role arrays. For admin-only features add to both `superadmin` and `admin` (maintained as parallel lists). Import the icon at the top.
```ts
{ label: 'Incidents', href: '/admin/incidents', icon: AlertTriangle },
```

## Final verification
Backend: `php artisan test`. Frontend: `npm run verify` (lint + vitest + build). Then run both servers and click through `/admin/incidents`.
