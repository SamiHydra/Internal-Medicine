# Migration Handoff — St Paul Hospital Reporting System

**Last updated:** 2026-05-28
**Purpose:** Hand off the in-progress Supabase → Laravel migration to another agent/developer. Read this top-to-bottom before touching anything.

---

## 1. The goal (read this first)

Migrate the **St Paul Hospital Internal Medicine weekly reporting system** off Supabase (unreliable on the free tier) onto a self-hostable **Laravel API + MySQL/MariaDB** backend, **without rewriting the existing React/Vite frontend UI**.

- **Keep:** the React/Vite frontend's dashboard, pages, charts, forms, filters, layout, UX.
- **Replace:** only the data/auth/backend layer (Supabase → Laravel).
- **Do NOT** break the currently-deployed production app (Cloudflare Pages frontend + Supabase). All work happens in a **new sibling `backend/` folder** and (later) a new frontend API layer. Supabase stays as the rollback path until the new stack is proven stable for 2–4 weeks.
- **Out of scope / explicitly excluded:** AICC. This is only the St Paul system.

The full 18-phase plan is the user's original brief (see §9 of this doc for the phase list). The two reference documents already produced — **[SUPABASE_AUDIT.md](SUPABASE_AUDIT.md)** and **[DATA_MODEL.md](DATA_MODEL.md)** — are the source of truth for what the old system does and what the new schema must be. **Always cross-check against them.**

---

## 2. Locked-in decisions (confirmed with the user — do not relitigate)

| # | Decision | Value |
|---|---|---|
| 1 | Backend location | New Laravel app in `c:\Users\Hasse\OneDrive\Desktop\Mesay\backend\` (sibling folder inside the existing repo) |
| 2 | Auth mode | **Sanctum SPA cookie + CSRF** (not bearer tokens). Requires shared parent domain in prod; `localhost` for dev |
| 3 | Roles | **Keep existing 4**: `superadmin`, `admin`, `doctor_admin`, `nurse`. Do NOT expand to the Phase-6 generic role list |
| 4 | Realtime | **Laravel Reverb** (WebSockets) — user explicitly wanted "best/fastest/most scalable". Polling stays as fallback |
| 5 | Report model | **Generic model** (`reports` + `report_field_values` + `report_field_definitions`), NOT per-family tables. Mirrors the existing frontend which renders forms from field definitions |
| 6 | Local DB | **SQLite** for dev now; MariaDB/MySQL for staging/prod later. Migrations are written DB-agnostic |
| 7 | Departments vs wards | **One `departments` table** with a `family` discriminator (inpatient/outpatient/procedure). No separate `wards` table |
| 8 | Soft deletes | **No** — use `active` boolean flags, matching current behavior |
| 9 | Audit logging | **Two tables**: existing `audit_logs` (per-cell report edits) + new `admin_audit_logs` (generic admin actions) |
| 10 | Notification type column | `VARCHAR(64)` not a DB enum, so new types don't need migrations. Includes `access_request_reviewed` |
| 11 | `calculated_metrics` for non-inpatient | Persist an empty row (matches Supabase RPC behavior) |
| 12 | `senior_physician_availability` choice values | `Full day`, `Partial day`, `Unavailable` |

---

## 3. Environment & toolchain state (Windows 11, PowerShell)

- **OS:** Windows 11 Pro. Shell: PowerShell (use PS syntax; Bash tool also available).
- **PHP:** 8.4.19 (NTS x64), installed via winget at
  `C:\Users\Hasse\AppData\Local\Microsoft\WinGet\Packages\PHP.PHP.NTS.8.4_Microsoft.Winget.Source_8wekyb3d8bbwe\`
  - **IMPORTANT:** I enabled `curl` and `intl` extensions in that PHP's `php.ini`. A backup of the original is at `php.ini.bak.before-mesay-migration` in the same folder. (User was informed.)
- **Composer:** NOT installed globally. We use a **local `backend/composer.phar`** (Composer 2.9.8). Always invoke as `php composer.phar ...` from inside `backend/`.
  - ⚠️ Gotcha: `php artisan install:api` / `reverb:install` try to shell out to a global `composer` command and fail with "'composer' is not recognized". Run the package install manually with `php composer.phar require ...` instead.
- **Node/npm:** the existing frontend uses npm (already set up at repo root).
- **MySQL/MariaDB:** NOT installed locally. No XAMPP/Laragon/WAMP. Dev uses SQLite (`backend/database/database.sqlite`).
- **Laravel version:** 13.11.2 (newer than the brief assumed Laravel 11 — adjust any version-specific guidance).

### Key gotchas already hit
- `reverb:install` crashes in `--no-interaction` mode (a `Laravel\Prompts\select()` null-return bug). Worked around by installing the package via composer.phar and publishing config manually. **Reverb is fully installed** — don't re-run `reverb:install`.
- Laravel 13's `User` model scaffold uses PHP-attribute `#[Fillable]`/`#[Hidden]`; I replaced it with conventional `protected $fillable`/`$hidden` properties.
- PowerShell working directory is sticky within a single tool call but env/state does not persist across calls. Use absolute paths or `cd backend;` at the start of compound commands.

---

## 4. What's DONE ✅

### Phase 1 — Audit (COMPLETE)
- `docs/migration/SUPABASE_AUDIT.md` — full inventory: ~40 direct Supabase calls, 10 RPCs, 16 tables, 1 realtime channel, 0 storage, env vars, role-enforcement layers, per-area migration priorities, and an "inconsistencies / NEEDS CONFIRMATION" section.

### Phase 2 — Data model (COMPLETE)
- `docs/migration/DATA_MODEL.md` — MySQL/MariaDB-ready schema for all tables, the A-vs-B report-model decision, the confirmed decisions table (§9 of that doc), Sanctum/Reverb implications, ERD summary, and the migration/seeder ordering.

### Phase 3 — Laravel bootstrap (COMPLETE & VERIFIED)
- Laravel 13.11.2 scaffolded in `backend/`.
- **Sanctum 4.3.2** installed; `HasApiTokens` trait on `User`; `statefulApi()` + `EnsureFrontendRequestsAreStateful` wired in `backend/bootstrap/app.php`.
- **Reverb 1.10** installed; `config/broadcasting.php`, `config/reverb.php`, `routes/channels.php` published; `BROADCAST_CONNECTION=reverb` in `.env`.
- **CORS** (`backend/config/cors.php`): `supports_credentials=true`, origins from `CORS_ALLOWED_ORIGINS`/`FRONTEND_URL`, paths include `api/*`, `sanctum/csrf-cookie`, `login`, `logout`, `broadcasting/auth`.
- **`.env` and `.env.example`** configured: app name "St Paul Reporting API", `FRONTEND_URL=http://localhost:5173`, `SANCTUM_STATEFUL_DOMAINS`, `SESSION_SAME_SITE=lax`, SQLite DB, Reverb keys (auto-generated in `.env`; blank placeholders in `.env.example`).
- Verified: `php artisan migrate` runs clean; `GET /up` returns 200 with the correct app title.

### Phase 4 — Migrations (COMPLETE & VERIFIED)
All 17 domain migrations written and **`migrate:fresh` runs clean** (20 migrations total incl. cache/jobs/sanctum). Files in `backend/database/migrations/`:
- `..._180000_create_roles_table` (text PK `role_key`)
- `..._180010_create_users_table` (UUID PK; also creates `password_reset_tokens` + `sessions` with UUID `user_id`)
- `..._180020_create_report_templates_table` (+ added `active` boolean not in old schema)
- `..._180030_create_departments_table`
- `..._180040_create_report_field_definitions_table`
- `..._180050_create_reporting_periods_table`
- `..._180060_create_report_assignments_table`
- `..._180070_create_access_requests_table`
- `..._180080_create_access_request_items_table`
- `..._180090_create_reports_table`
- `..._180100_create_report_field_values_table`
- `..._180110_create_calculated_metrics_table`
- `..._180120_create_report_status_history_table`
- `..._180130_create_audit_logs_table`
- `..._180140_create_admin_audit_logs_table` (NEW table, not in Supabase)
- `..._180150_create_notifications_table`
- `..._180160_create_app_settings_table`
- The Sanctum `personal_access_tokens` migration was edited to use `uuidMorphs('tokenable')` (because users have UUID PKs).
- The default Laravel `0001_01_01_000000_create_users_table.php` scaffold was **deleted** (folded into our users migration).

### Phase 4 — Models (COMPLETE & VERIFIED)
Written in `backend/app/Models/`:
`User` (updated: UUID, `role_key` FK, `username` lowercasing mutator, `isAdminLike()`/`isSuperadmin()` helpers, custom `notifications()` hasMany — NOTE: I removed Laravel's `Notifiable` trait because our `notifications` table has a custom schema, not Laravel's polymorphic one), `Role`, `ReportTemplate`, `Department`, `ReportFieldDefinition`, `ReportingPeriod`, `ReportAssignment`, `AccessRequest`, `AccessRequestItem`, `Report`, `ReportFieldValue`, `CalculatedMetric`, `ReportStatusHistory`, `AuditLog`, `AdminAuditLog`, `Notification`, `AppSetting`.

---

## 5. Phase 4 completion checkpoint

Phase 4 is complete as of this checkpoint.

- Added the final 5 Eloquent models: `ReportStatusHistory`, `AuditLog`, `AdminAuditLog`, `Notification`, `AppSetting`.
- Added seeders: `RoleSeeder`, `ReportTemplateSeeder`, `DepartmentSeeder`, `ReportFieldDefinitionSeeder`, `AppSettingSeeder`, `ReportingPeriodSeeder`.
- Wired seeders into `DatabaseSeeder.php`; removed the default placeholder `User::factory()` call because the current users table has no `name` column.
- Verified `php artisan migrate:fresh --seed`.
- Verified seeded row counts: roles 4, templates 9, departments 27, field definitions 85, settings 5, reporting periods 53.
- Verified `senior_physician_availability` metadata options: `Full day`, `Partial day`, `Unavailable`.
- Verified `vendor\bin\pint --test` and `php artisan test` pass.

### Phase 5 — Authentication (COMPLETE & VERIFIED)
Implemented in `backend/app/Http/Controllers/Api/AuthController.php` and `backend/routes/api.php`:

- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/auth/me`

Behavior covered:

- Sanctum SPA/session auth via the `web` guard.
- Login by email or username, case-insensitive and trimmed, matching the old `resolve_sign_in_email` behavior.
- Inactive users are rejected with `403`.
- Successful login updates `last_login_at`.
- `/me` returns sanitized user data, active assignments with department/template context, and backend-defined permissions.
- Logout invalidates the session, regenerates the CSRF token, and calls `Auth::forgetGuards()` so persistent test/runtime guard caches do not keep a stale user.
- Updated `UserFactory` to match the real users table (`full_name`, `role_key`, etc.).
- Added `tests/Feature/AuthApiTest.php`.
- Verified `php artisan migrate:fresh --seed`, `vendor\bin\pint --test`, and `php artisan test` pass.

### Phase 6 — Roles & permissions (COMPLETE & VERIFIED)
Implemented authorization foundations:

- `app/Support/Authorization/Permissions.php` centralizes the role → permission map for the four locked roles.
- Middleware aliases registered in `bootstrap/app.php`:
  - `active` rejects deactivated authenticated sessions.
  - `role:...` gates routes by role key.
  - `permission:...` gates routes by named permission.
- `AppServiceProvider` registers permission Gates and policies for all current domain models.
- Policies mirror the Supabase RLS themes:
  - Reference data readable by authenticated active users; admin-like roles manage it.
  - Nurses are scoped to their active assignments.
- Locked reports block nurse edits; admin-like roles can still manage/report-lock workflows. The Phase 7 save service additionally rejects any save to a locked report, matching the old RPC.
  - Access requests and notifications are owner-or-admin visible.
  - Audit logs are admin-like only.
  - Admin account activation/deactivation is superadmin-only; protected superadmin cannot be deactivated here.
- Added `tests/Feature/AuthorizationTest.php`.
- Verified `php artisan migrate:fresh --seed`, `vendor\bin\pint --test`, and `php artisan test` pass.

### Phase 7 — Report workflows (COMPLETE & VERIFIED)
Implemented the Laravel equivalents of `save_report`, `set_report_lock_state`, and `upsert_calculated_metrics`:

- Services:
  - `app/Services/Reports/ReportSubmissionService.php`
  - `app/Services/Reports/ReportLockingService.php`
  - `app/Services/Reports/ReportCalculationService.php`
- API controller/routes:
  - `GET /api/reports`
  - `POST /api/reports`
  - `GET /api/reports/{report}`
  - `PUT /api/reports/{report}`
  - `POST /api/reports/{report}/submit`
  - `POST /api/reports/{report}/lock`
  - `POST /api/reports/{report}/unlock`

Behavior covered:

- Nurses can save/submit only active assigned reports; admin-like roles can save assigned reports across users.
- Save validates template field keys, active days, integer/decimal/time/choice values.
- Save upserts/deletes `report_field_values` cells from the frontend `dailyValues` payload.
- Draft creation writes `report_status_history`.
- Submit writes submitted status/history and `new_report_submitted` notifications to active admin-like users.
- Edits after submission write per-cell `audit_logs`, move status to `edited_after_submission`, and notify admins.
- Locked reports reject save attempts.
- Lock/unlock writes status/history and notifies the assigned nurse; unlock restores `edited_after_submission` if any edit history exists, else `submitted`.
- Metrics are recalculated on save: inpatient BOR/BTR/ALOS + payload; non-inpatient empty metric row.
- GET report endpoints serialize saved values back into field-key/daily-values shape.
- Added `tests/Feature/ReportWorkflowTest.php`.
- Verified `php artisan migrate:fresh --seed`, `vendor\bin\pint --test`, and `php artisan test` pass.

Important note: the SQL RPC computes `v_had_submission` after inserting a brand-new submitted report, which can misclassify a direct first submit if no autosaved draft exists. The Laravel service uses the intended documented behavior: a first submit becomes `submitted`, writes draft+submitted history, and notifies admins.

### Phase 8 — Analytics (COMPLETE & VERIFIED)
Implemented the backend analytics layer:

- Services:
  - `app/Services/Analytics/AnalyticsFilters.php`
  - `app/Services/Analytics/AnalyticsService.php`
  - `app/Services/Analytics/InpatientAnalyticsService.php`
  - `app/Services/Analytics/OutpatientAnalyticsService.php`
  - `app/Services/Analytics/ProcedureAnalyticsService.php`
- API controller/routes:
  - `GET /api/analytics/overview`
  - `GET /api/analytics/inpatient`
  - `GET /api/analytics/outpatient`
  - `GET /api/analytics/procedures`
  - `GET /api/analytics/weekly`
  - `GET /api/analytics/monthly`
  - `GET /api/analytics/departments`
  - `GET /api/analytics/wards`

Behavior covered:

- Routes are protected by `auth:sanctum`, `active`, and `permission:analytics.view`; nurses are forbidden.
- Filters support period, week, month, year, date range, department/ward, family/report type, and procedure category aliases.
- Overview returns expected/missing reports, status counts, inpatient totals, outpatient totals, HAI/no-show aliases, procedure throughput, and occupancy metrics.
- Inpatient analytics calculate BOR/BTR/ALOS with the Phase 8 formula; department/ward summaries use that department's bed count.
- Outpatient analytics include access averages and senior physician availability buckets.
- Procedure analytics include service totals plus dialysis/endoscopy mix.
- Weekly, monthly, department, and ward grouping endpoints are in place.
- Added `tests/Feature/AnalyticsTest.php`.
- Verified `php artisan migrate:fresh --seed`, `vendor\bin\pint --test`, and `php artisan test` pass.

### Phase 9 — Admin APIs (COMPLETE & VERIFIED)
Implemented the admin API layer:

- Services:
  - `app/Services/Admin/AdminAuditService.php`
  - `app/Services/Admin/AppSettingsService.php`
  - `app/Services/Admin/AccessRequestReviewService.php`
- API controllers/routes:
  - User directory + create/update/activate/deactivate/reset-password under `/api/admin/users`
  - Report assignment list/upsert/activate/deactivate under `/api/admin/assignments`
  - Template CRUD + activate/deactivate under `/api/admin/templates`
  - Department CRUD + activate/deactivate under `/api/admin/departments`; inpatient ward alias at `/api/admin/wards`
  - Settings GET/PUT/PATCH under `/api/admin/settings`
  - Access request list/show/review/approve/reject under `/api/admin/access-requests`
  - Cell audit logs at `/api/admin/audit-logs`
  - Admin action audit logs at `/api/admin/admin-audit-logs`

Behavior covered:

- All admin routes require Sanctum auth, active users, and the appropriate Phase 6 permission middleware.
- User management respects the protected superadmin rule and superadmin-only admin-account activation/deactivation.
- Password reset sets `password_change_required` and never writes the password into `admin_audit_logs`.
- Access-request approval creates/restores active `report_assignments`, writes requester notifications, and records admin audit rows.
- Direct assignment upsert/toggle supports existing frontend user-management workflows.
- Department/template deletes are hard deletes only when safe; referenced rows are rejected with validation errors.
- Settings updates preserve the existing key/value `app_settings` model and recalculate `reporting_periods.deadline_at`.
- Cell audit and admin audit logs are queryable with basic filters.
- Added `tests/Feature/AdminApiTest.php`.
- Verified `php artisan migrate:fresh --seed`, `vendor\bin\pint --test`, and `php artisan test` pass.

### Phase 10 — Overdue reports & notifications (COMPLETE & VERIFIED)
Implemented the overdue-report and notification layer:

- Services:
  - `app/Services/Reports/OverdueReportService.php`
  - `app/Services/Reports/ReportingPeriodService.php`
- Commands:
  - `php artisan reports:sync-overdue`
  - `php artisan reports:ensure-periods`
- Scheduler entries in `routes/console.php`:
  - `reports:sync-overdue` every minute
  - `reports:ensure-periods` daily
- Notification API controller/routes:
  - `GET /api/notifications`
  - `PATCH /api/notifications/read`
  - `PATCH /api/notifications/read-all`
  - `DELETE /api/notifications`

Behavior covered:

- Overdue sync uses current app settings, active assignments, reporting periods, and the live-start date from the old SQL semantics.
- Deadlines disabled clears active overdue notifications.
- Overdue notifications are upserted by recipient and event key, so reruns avoid duplicates and preserve `read_at`.
- Stale overdue notifications are removed once a report is submitted or no longer overdue.
- Nurses receive their own overdue report notifications; active admin-like users receive admin visibility notifications.
- Reporting-period command keeps a rolling weekly window available for frontend/report workflows.
- Notification endpoints list, mark read, mark all read, and delete only notifications visible to the current user; admin-like users may filter by recipient.
- Added `tests/Feature/NotificationsAndOverdueTest.php`.
- Verified `php artisan migrate:fresh --seed`, `vendor\bin\pint --test`, and `php artisan test` pass.

### Phase 11 — Frontend API client replacement (COMPLETE & VERIFIED)
Implemented the Laravel frontend API layer without rewriting the React/Vite UI:

- Added `src/lib/api/` modules:
  - `client.ts` — fetch client with `credentials: 'include'`, Sanctum CSRF-cookie bootstrapping, JSON errors, and a small auth-listener shim for the existing app-data provider.
  - `auth.ts`, `workspace.ts`, `reports.ts`, `admin.ts`, `notifications.ts`, `settings.ts`, `analytics.ts`, `access-requests.ts`, `passwords.ts`, `realtime.ts`, `types.ts`, `helpers.ts`.
- Rewired `src/context/app-data-context.tsx` from `@/lib/supabase/*` to `@/lib/api/*` while keeping the existing context API used by pages/components.
- Rewired app config screens and route guards to `VITE_API_BASE_URL`.
- Rewired forgot/reset password pages and manual superadmin setup off Supabase browser auth.
- Added `laravel-echo` + `pusher-js` and Reverb env placeholders; polling fallback remains in the provider.
- Kept `VITE_SUPABASE_*` in `.env.local.example` for rollback/legacy scripts until cutover is complete.

Backend support added for the frontend swap:

- `GET /api/workspace` hydrates the frontend `AppState` shape and reference maps, with nurse/admin scoping and optional profile/access-request/history inclusion.
- `POST /api/access-requests` supports public applicant requests and authenticated additional-access requests.
- `POST /api/admin/claim-superadmin` supports the existing hidden setup workflow.
- `POST /api/notifications/restore` supports the existing notification undo UI.
- `POST /api/auth/forgot-password` and `POST /api/auth/reset-password` support Laravel password reset links.
- Added `tests/Feature/WorkspaceApiTest.php`.

Verified:

- Backend: `php artisan migrate:fresh --seed`, `vendor\bin\pint --test`, `php artisan test` (40 tests / 323 assertions).
- Frontend: `npm run lint`, `npm run test:run` (40 tests), `npm run build`.
- Local smoke: `GET http://127.0.0.1:8000/up` and `GET http://127.0.0.1:5173` returned 200.

Important note: after `migrate:fresh --seed`, the local DB has reference data only, not real users. Phase 12 imports Supabase users/data; until then, use tests/factories or a temporary local user to log into the running Laravel-backed UI.

### DECISION (2026-05-28): fresh start — NOT migrating Supabase data
The user decided the new system launches **fresh**: the old Supabase reporting data is NOT carried over. Consequences:
- **No Supabase access is required at all.** Reference data (templates, departments, field defs, settings) is already seeded from `seed.sql`; old reports/users/history are intentionally dropped. There is no storage or other external service to migrate (audit confirmed DB-only).
- **Phase 12 (data migration) is therefore skipped on the launch path.** The export/import tooling below was built and tested *before* this decision and is **retained only as a safety net** — run it later only if you ever decide to pull historical data.
- Bootstrap is via `php artisan app:create-superadmin`, then normal in-app onboarding.

### Fresh-start bootstrap (the launch path)
After `migrate:fresh --seed` the DB has reference data but **zero users**, and `claim-superadmin` requires an already-authenticated admin — so create the first user from the CLI:
```powershell
cd backend
php artisan app:create-superadmin --email=you@hospital.org --username=admin1 --full-name="Your Name"
# Omit --password to get a strong generated one (printed once; forces reset on first login).
```
Then log in as that superadmin and use the admin UI to provision other admins/doctor-admins and approve nurse access requests (approval creates their `report_assignments`). Nurses self-apply via the public `POST /api/access-requests`.
- Command: `app/Console/Commands/CreateSuperadmin.php`; test `tests/Feature/CreateSuperadminTest.php`. Refuses to run if a superadmin already exists.

### Phase 12 tooling — BUILT & TESTED, retained as a safety net (not on the launch path)
Key finding that shaped the design: every column the new `users` table needs (`email`, `username`, `full_name`, `title`, `role_key`, `active`, `phone`) lives in `public.profiles`. The only thing in the `auth` schema is the password, which can't migrate anyway. **So the whole migration runs against the `public` schema** — a service-role key + PostgREST is sufficient; no DB password and no `pdo_pgsql` needed. Both Supabase and Laravel use UUID/text PKs, so IDs are preserved 1:1 and all foreign keys stay valid.

Built:
- `config/supabase.php` — reads `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_IMPORT_PATH` (default `backend/database/imports/supabase`, **gitignored** — holds PII/PHI), `SUPABASE_EXPORT_PAGE_SIZE`.
- `app/Support/Migration/SupabaseSchemaMap.php` — declarative source→target map for all 16 tables in FK order: per-column type coercion (datetime/date/time/bool/json), target-only column generators, and `insertOnly` columns (so re-runs never reset a user's password/`password_change_required`).
- `app/Console/Commands/ExportSupabaseData.php` (`php artisan supabase:export`) — paginated PostgREST pull of every `public` table → JSON snapshots + `_manifest.json`. `--table=` for one table.
- `app/Console/Commands/ImportSupabaseData.php` (`php artisan supabase:import`) — reads snapshots, transforms, upserts in FK order preserving UUIDs, then prints a source-vs-target row-count validation table. Flags: `--dry-run`, `--truncate` (clean slate), `--skip-reference`, `--only=`.
- `profiles → users`: password set to a random bcrypt hash, `password_change_required = true`, `email_verified_at` proxied from `created_at`.
- Reference data (roles, templates, departments, field defs, periods, settings) is **re-imported from prod** (upsert, prod is source of truth) per the confirmed decision.
- `tests/Feature/SupabaseImportTest.php` — FK-complete fixture covering all 16 tables; asserts ID preservation, forced password reset, JSON/datetime/numeric coercion, dry-run writes nothing, and re-run does not reset existing passwords. Whole backend suite at this checkpoint: `php artisan test` = 47 tests / 358 assertions; `pint --test` passes.

**Safety-net runbook (only if you later choose to import historical data — NOT the launch path):**
```powershell
cd backend
# 1. Put the service-role key in backend/.env (SUPABASE_URL is already set):
#    SUPABASE_SERVICE_ROLE_KEY=<service_role key from Supabase dashboard -> Project Settings -> API>
php artisan config:clear
# 2. Export the live public schema to JSON snapshots (gitignored):
php artisan supabase:export
# 3. Preview what will be written, no DB changes:
php artisan supabase:import --dry-run
# 4. Import for real (add --truncate for an exact clean-slate copy):
php artisan supabase:import
#    Review the printed source-vs-target count table; all rows should match.
```
After import: spot-check analytics output against Supabase, then **rotate/remove the service-role key** from `.env`. Snapshots in `backend/database/imports/` must never be committed.

---

## 6. What's LEFT (in priority order)

### Phase 12 — Data migration: DROPPED (fresh start)
- Per the 2026-05-28 decision, the new system launches fresh and does not import old Supabase data. Export/import tooling is retained as a safety net only. Launch bootstrap is `php artisan app:create-superadmin` (see §5). No further Phase 12 work is needed unless the user reverses the decision.

### Phases 13–18
- 13 Testing (Pest/PHPUnit): auth, reports, analytics, admin, notifications, security.
- 14 Staging deploy (backend) + checklist.
- 15 Frontend staging connection.
- 16 Production cutover (keep Supabase as rollback; don't delete for 2–4 weeks).
- 17 Production hardening (backups, rate limiting, indexes, pagination, HTTPS, etc.).
- 18 Final docs: `API_MAP.md`, `MIGRATION_RUNBOOK.md`, `ROLLBACK_PLAN.md`, `PRODUCTION_CHECKLIST.md` (SUPABASE_AUDIT.md + DATA_MODEL.md already exist).

---

## 7. Target backend structure (from the brief — partially created)

```
app/Http/Controllers/Api/  -> Auth, User, Department, Ward, Report, ReportTemplate,
                              Analytics, Notification, AccessRequest, Settings
app/Services/Reports/      -> ReportSubmissionService, ReportLockingService,
                              ReportCalculationService, OverdueReportService
app/Services/Analytics/    -> Inpatient/Outpatient/ProcedureAnalyticsService
app/Services/Audit/        -> AuditLogService
app/Policies/  app/Models/ (done)  app/Http/Requests/  app/Http/Resources/
```
Created so far: all models, policies, auth/report/analytics/admin/notification/workspace controllers, report services including overdue and reporting-period sync, analytics services, admin services, console commands, scheduler entries, frontend Laravel API adapter modules, Reverb client dependencies, and auth/report/analytics/admin/notification/workspace feature tests. Data migration and production docs remain for later phases.

---

## 8. How to verify / resume quickly

```powershell
# from repo root
cd backend
php artisan --version            # expect Laravel 13.11.2
php composer.phar --version      # expect 2.9.8 (note: composer.phar, not composer)
php artisan migrate:fresh        # expect 20 migrations green
php artisan migrate:fresh --seed # expect seeded reference data
vendor\bin\pint --test           # expect passed
php artisan test                 # expect 40 tests / 323 assertions
php artisan serve --port=8000    # GET http://127.0.0.1:8000/up -> 200
```
- DB is SQLite at `backend/database/database.sqlite`. To switch to MariaDB later, edit `.env` `DB_CONNECTION` block (commented example already present in `.env.example`).
- Reverb dev server: `php artisan reverb:start` (separate long-running process).
- Frontend: repo root, `.env.local` needs `VITE_API_BASE_URL=http://127.0.0.1:8000`, then `npm run dev` (Vite, port 5173). `npm run lint`, `npm run test:run`, and `npm run build` are passing at this checkpoint.

## 9. Git / safety state
- `backend/` and `docs/` are **untracked** (new, not committed). Phase 11 also modifies frontend source files and `package-lock.json`/`package.json` for the Laravel API adapter and Echo/Reverb dependencies. Nothing has been committed yet. The already-deployed production app (Cloudflare Pages + Supabase) is untouched until a future deployment.
- The only change outside the repo is the `php.ini` curl/intl enable (backed up; see §3).
- No secrets were added beyond the auto-generated local Reverb keys in `backend/.env` (gitignored by Laravel's default `.gitignore`).

## 10. Reference files in the OLD system (don't modify — read for fidelity)
- `supabase/migrations/202603290001_initial_schema.sql` — base tables, views, `upsert_calculated_metrics`, RLS.
- `supabase/migrations/202603300001_live_integration.sql` — `save_report`, `set_report_lock_state`, `submit_access_request`, `review_access_request`, notification/audit logic. **This is the behavioral spec for Phase 7.**
- `supabase/seed.sql` — all reference data (roles, templates, departments, field definitions, settings). **Source for the seeders.**
- `src/lib/supabase/api.ts` — every frontend data call (maps to new endpoints in Phase 11).
- `src/types/domain.ts` — the TypeScript shapes the frontend expects responses to match.
- `src/context/app-data-context.tsx` — auth/session/state/realtime wiring on the frontend.
