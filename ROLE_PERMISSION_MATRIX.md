# ROLE & PERMISSION MATRIX

**System:** St Paul's Hospital reporting & academic platform — Vite/React SPA (repo root) + Laravel 12 / Sanctum API (`backend/`), SQLite in dev.
**Date:** 2026-07-21
**Basis:** working tree at commit `d82edb3`, branch `feat/excel-import`, with **248 uncommitted paths** including 7 untracked migrations. Every line number below refers to the **working tree**, not to the commit.
**Derived from:** the phase-1 discovery evidence files in `artifacts/audit-2026-07-21/discovery/` (`01-database-schema.md`, `02-backend-routes.md`, `03-roles-permissions.md` — **three independent passes**, `04-spa-surface.md` — three passes, `05-modules-workflows.md` — two passes, `06-existing-tests-and-harness.md`), each of which cites source `file:line`.
**Status of every claim:** derived from *reading code*, not from running it. Section 8 lists what must be proven empirically.
**Revision 2 (this version)** folds in the third discovery pass over `03-roles-permissions.md` (Addendum 2, items E.1–E.6 and F.1) and the workflow evidence in `05-modules-workflows.md`, which the first synthesis did not have. Changes are marked **[rev2]**.

---

## HOW TO READ THIS DOCUMENT (for someone who has never seen the codebase)

There are **six roles**. Which role you hold is a single string column, `users.role_key`. There is no
many-to-many role assignment, no groups, no tenancy.

Authorization is applied in **four independent layers**, in this order. A request must survive all of them:

| # | Layer | Where it lives | What it does |
|---|---|---|---|
| 1 | **Route middleware** | `backend/routes/api.php` — `auth:sanctum`, `active`, `password-changed`, `permission:<string>`, `throttle:300,1` | Coarse. Maps a *permission string* to the roles that hold it. Returns **403** before the controller runs. |
| 2 | **`Gate::before`** | `backend/app/Providers/AppServiceProvider.php:77` | `fn (User $user) => $user->active ? null : false` — an inactive user is denied **every** gate and **every** policy method globally. |
| 3 | **Policy classes** | `backend/app/Policies/*.php` (26 classes) | Fine-grained, per-record. Invoked from controllers via `Gate::authorize(...)`. Returns 403 on failure. |
| 4 | **Service-layer / query scoping** | e.g. `ReportSubmissionService.php:388-400`, `ReportWorkflowController.php:51-55` | Last-resort ownership checks and `where` filters. |

**The permission strings are NOT in the database.** `Permissions::ROLE_PERMISSIONS`
(`backend/app/Support/Authorization/Permissions.php:98-195`) is a hard-coded PHP constant. Nothing at
runtime can grant a role a permission it does not have in that file. That makes the whole
middleware layer **statically computable** — which is why the matrices below are exact.

**Two authorization systems encode the same fact.** The route middleware asks "does this role hold
permission X?"; most policies then ask "is this user superadmin-or-admin?"
(`HandlesDomainAuthorization::isAdminLike`, `backend/app/Policies/Concerns/HandlesDomainAuthorization.php:12-15`).
For ~60 routes those two questions have the same answer today, purely because `ROLE_PERMISSIONS` never
grants an admin-shaped permission to a non-admin role. They can drift.

**Terminology:**
- **`isAdminLike`** = `$user->active && role_key ∈ {superadmin, admin}` (`HandlesDomainAuthorization.php:12-15`).
- **`isSuperadmin`** = `$user->active && role_key === 'superadmin'` (`:17-20`).
- **200** in the matrices below means "passes the *middleware* layer". It does **not** mean the request
  succeeds — a policy may still deny it. Where a policy narrows further, it is called out.

---

## 1. THE SIX ROLES

Schema: `roles` table — `role_key` varchar(32) **PK**, `label`, `description`, timestamps
(`backend/database/migrations/2026_05_25_180000_create_roles_table.php:11-16`), plus
`workspace` varchar(16) default `'both'` added by the **untracked** migration
`backend/database/migrations/2026_09_02_000010_add_workspace_to_roles_table.php:20-33`.
Seeded by `backend/database/seeders/RoleSeeder.php:12-49`.
Workspace vocabulary: `clinical | academic | both` (`backend/app/Support/Authorization/Workspaces.php:7-12`);
`Workspaces::selectable()` (`:28-31`) returns only `['clinical','academic']`, so `both` is a property a
role carries and never a value you can filter by.

| role_key | Label (UI) | Workspace | Live rows (dev DB, 2026-07-21) | Account-creation path | Cited to |
|---|---|---|---|---|---|
| `superadmin` | **Maintenance** | `both` | 1 / 1 active | **Console only.** `php artisan app:create-superadmin`. Refuses if any superadmin already exists. Not creatable or reachable from any API surface. | `backend/app/Console/Commands/CreateSuperadmin.php:22-82`, refusal at `:24-29`, role write at `:67`; excluded from `UserController` `Rule::in` at `backend/app/Http/Controllers/Api/Admin/UserController.php:84-85` and `:133-134`; excluded from `AdminAccessRequestReviewService::CREATABLE_ROLE_TITLES` at `backend/app/Services/Admin/AdminAccessRequestReviewService.php:24-28` |
| `admin` | Admin | `both` | **0 / 0** | **(a) Public self-signup + approval:** anonymous `POST /api/admin-access-requests` creates a *pending request row only*, no user; `requested_role` is hard-coded `'admin'`. Approved by anyone holding `admins.approve` (= superadmin **or admin**). **(b) Direct creation:** `POST /api/admin/users` with `role=admin`, which additionally requires `admins.manage` = **superadmin only**. | (a) `routes/api.php:53` → `AdminRegistrationController.php:26-67`, role pin at `:55`; approval `routes/api.php:146` → `AdminAccessRequestController.php:43-50` → `AdminAccessRequestReviewService::review:35-86`, user created at `:88-126`. (b) `UserController.php:94-98` + `UserPolicy::createAdmin:28-31` |
| `nurse` | Nurse | `clinical` | 2 / 2 active | **(a) Public self-register — uniquely, this immediately writes a REAL `users` row** with `role_key='nurse'`, `title='Applicant Nurse'`, **`active=false`**. Approval flips `active=true`. **(b) Admin-created** via `POST /api/admin/users`. | (a) `routes/api.php:51` → `AccessRequestSubmissionController.php:25-75`, user write at `:92-101` (`role_key` `:97`, `active=false` `:99`); activation at `backend/app/Services/Admin/AccessRequestReviewService.php:45-49`. (b) `UserController.php:84-85, 96-97` |
| `resident` | Resident | `academic` | 26 / 26 active | **Public self-signup + approval only.** `POST /api/academic-access-requests` with `role ∈ {resident, consultant}`; creates a pending `admin_access_requests` row, no user. **Cannot be created directly by an admin** — `resident` is not in `UserController::store`'s `Rule::in`. **IN-FLUX.** | `routes/api.php:52` → `AcademicRegistrationController.php:29-74`, `Rule::in(['resident','consultant'])` at `:35`, pin at `:61`; absent from `UserController.php:84-85` |
| `consultant` | Consultant | `academic` | 18 / 18 active | Same as `resident`. **IN-FLUX.** | as above |
| `student_rep` | Student representative | `academic` | 5 total / 3 active | **Admin-created only.** `POST /api/admin/users` with `role=student_rep`, gated `users.manage`. No self-service queue can produce one. A rep *assignment* additionally requires the target user be `role_key='student_rep' && active`. | `UserController.php:84-85` (`Rule::in(['admin','nurse','student_rep'])`), `:96-97`; assignment guard `UndergraduateAdminController.php:966-973` |

### 1.1 Facts about the role model that matter

- **There are ZERO `admin` accounts in the dev database.** Every "admin" behaviour in dev is currently
  exercised by the single `superadmin`. The audit must **create** a plain admin to test the
  admin/superadmin boundary at all (`01-database-schema.md` §0; `03-roles-permissions.md` §1.4).
- **[rev2] TEST PREREQUISITE — the "dev admin login" is not an admin.** `backend/database/seeders/DevUserSeeder.php:43-44`
  seeds `admin@stpaulos.local` / `admin1` with **`role_key = 'superadmin'`** and `title = 'Maintenance'`.
  A grep of every file in `backend/database/seeders/` for `role_key` finds **no seeder anywhere that
  writes `'admin'`** — which is why the live count is 0. Consequence: **every `admin` column in every
  table in this document is currently unexercised**, and any test that uses `admin@stpaulos.local` as
  "the admin" will silently pass every `isSuperadmin` check and therefore **over-authorize**. Create a
  real `role_key='admin'` fixture before running any admin-vs-superadmin test.
  (`03-roles-permissions.md` Addendum 2 §E.4.)
- **`students` are not accounts.** The `students` table has no `email`, `password` or `remember_token`
  column; `App\Models\Student:10` extends `Model`, not `Authenticatable`; `backend/config/auth.php:40-45`
  defines exactly one guard (`web`) over exactly one provider (`users`). There is no login path for a
  student record. A student *representative* is a separate `users` row with `role_key='student_rep'`.
- **A removed role still leaves traces.** `doctor_admin` / "Clinical Director" was dropped by
  `backend/database/migrations/2026_06_01_010000_remove_doctor_admin_role.php:15-18`; residual comments
  remain (e.g. `AdminRegistrationController.php:71`). **[rev2] VERIFIED live:** `roles` = 6 rows,
  `roles WHERE role_key='doctor_admin'` = 0, `users WHERE role_key='doctor_admin'` = 0. Belt-and-braces:
  the migration's `down()` (`:22-31`) would re-insert the role row, but `doctor_admin` has no entry in
  `Permissions::ROLE_PERMISSIONS`, so `forRole()` returns `[]` (`Permissions.php:220-223`) and
  `isAdminRole()` is false — a rolled-back-then-reassigned account would hold **zero** permissions.
  Fail-closed; no action needed. (Addendum 2 §E.5.)
- **[rev2] There is exactly one authenticatable model and no bearer-token surface.** `config/auth.php`
  contains no `sanctum` guard at all (grep returns nothing); `auth:sanctum` on `routes/api.php:58`
  resolves through Sanctum's own provider to the stateful `web` session guard, consistent with
  `statefulApi()` at `bootstrap/app.php:48-51` and `Auth::guard('web')->login()` at `AuthController.php:41`.
  `User` does `use HasApiTokens` (`User.php:14`) but **no `createToken(` call exists anywhere in
  `backend/app`**, and `personal_access_tokens` has 0 rows. Live auth is session-cookie only.
  (Addendum 2 §E.6.)
- **Three privilege-bearing designations are DATA, not roles**, each owned by a different permission:
  | Designation | Stored in | Who can set it | What it grants |
  |---|---|---|---|
  | Morning recorder | app setting `academic.morning_recorder_ids` | `settings.manage` (superadmin, admin) via `PUT/PATCH /api/admin/settings` (`routes/api.php:178-180`) | May record/cancel today's morning session. `MorningSessionService::isRecorder:44-47` is a **pure id-membership test** — no active check, no role check. **[rev2]** The validator is existence-only: `['uuid', Rule::exists('users','id')]` (`Admin/SettingsController.php:82-85`) — a nurse, a student_rep or a **deactivated** user can all be designated. |
  | Section head | `sections.head_user_id` | **[rev2] CORRECTED:** `academicStructure.manage` via `POST /api/admin/academic/sections` (`AcademicStructureController::storeSection:125-132`) and `PATCH /api/admin/academic/sections/{section}` (`updateSection:151-160`). `POST .../set-consultant` (`routes/api.php:222`, `roster.manage`) changes section **membership**, not headship. | May **decide** transfer requests whose `to_section_id` is that section (`TransferRequestPolicy:45-52`). Both write sites call `assertHeadIsConsultant` (`:331-347`, requires `role_key='consultant'` AND `active`), so the **write** is safe; the gap is temporal — see E-29. |
  | Rep scope | `rep_assignments.scope` ∈ `{group, subgroup_a, subgroup_b}` | `students.manage` (`routes/api.php:277-282`) | Determines which teaching activity types and which subgroup a student_rep may log (`RepAssignment.php:40-55`) |

---

## 2. THE 37 PERMISSIONS × 6 ROLES

Source of truth: `backend/app/Support/Authorization/Permissions.php` — constants `:9-94`, role map
`ROLE_PERMISSIONS` `:98-195`, `ADMIN_ROLES = ['superadmin','admin']` `:96`.
Resolution: `forUser()` `:208-215` returns **`[]` when `$user->active === false`**;
`forRole()` `:220-223` returns `[]` for an unknown role key (fail-closed).

Legend: **Y** granted · **–** not granted · **`!`** enforced nowhere (dead grant, see §2.2).

| # | Permission | superadmin | admin | nurse | resident | consultant | student_rep | Permissions.php |
|---|---|:--:|:--:|:--:|:--:|:--:|:--:|---|
| 1 | `auth.viewSelf` `!` | Y | Y | Y | Y | Y | Y | :9 |
| 2 | `users.view` | Y | Y | – | – | – | – | :11 |
| 3 | `users.manage` | Y | Y | – | – | – | – | :13 |
| 4 | **`admins.manage`** | **Y** | **–** | – | – | – | – | :15 |
| 5 | `admins.approve` | Y | **Y** | – | – | – | – | :17 |
| 6 | `departments.manage` | Y | Y | – | – | – | – | :19 |
| 7 | `templates.manage` | Y | Y | – | – | – | – | :21 |
| 8 | `templates.editContent` `!` | Y | Y | – | – | – | – | :24 |
| 9 | **`templates.editStructure`** | **Y** | **–** | – | – | – | – | :27 |
| 10 | `assignments.manage` | Y | Y | – | – | – | – | :29 |
| 11 | `accessRequests.create` `!` | – | – | **Y** | – | – | – | :31 |
| 12 | `accessRequests.review` | Y | Y | – | – | – | – | :33 |
| 13 | `reports.viewAssigned` `!` | – | – | **Y** | – | – | – | :35 |
| 14 | `reports.viewAny` `!` | Y | Y | – | – | – | – | :37 |
| 15 | `reports.submit` `!` | Y | Y | Y | – | – | – | :39 |
| 16 | `reports.lock` `!` | Y | Y | – | – | – | – | :41 |
| 17 | `reports.import` | Y | Y | – | – | – | – | :43 |
| 18 | `analytics.view` | Y | Y | – | – | – | – | :45 |
| 19 | `audit.view` | Y | Y | – | – | – | – | :47 |
| 20 | `settings.manage` | Y | Y | – | – | – | – | :49 |
| 21 | `actionItems.view` | Y | Y | – | – | – | – | :51 |
| 22 | `actionItems.manage` | Y | Y | – | – | – | – | :53 |
| 23 | `notifications.view` | Y | Y | Y | **–** | **–** | Y | :55 |
| 24 | `academic.submit` | **–** | **–** | – | Y | Y | – | :57 |
| 25 | `academic.view` | Y | Y | – | – | – | – | :59 |
| 26 | `academic.manage` | Y | Y | – | – | – | – | :61 |
| 27 | `academicStructure.manage` | Y | Y | – | – | – | – | :64 |
| 28 | `roster.manage` | Y | Y | – | – | – | – | :67 |
| 29 | `rotations.manage` | Y | Y | – | – | – | – | :70 |
| 30 | `evaluationForms.editContent` | Y | Y | – | – | – | – | :73 |
| 31 | **`evaluationForms.editStructure`** | **Y** | **–** | – | – | – | – | :76 |
| 32 | `morningAttendance.record` | Y | Y | – | Y | Y | – | :79 |
| 33 | `teachingLog.record` | Y | Y | – | – | – | **Y** | :82 |
| 34 | `studentAttendance.record` | Y | Y | – | – | Y | – | :85 |
| 35 | `students.manage` | Y | Y | – | – | – | – | :88 |
| 36 | `transfers.create` | **–** | **–** | – | – | **Y** | – | :91 |
| 37 | `transfers.review` | Y | Y | – | – | Y | – | :94 |

**Per-role totals (recomputed from the table above): superadmin 33 · admin 30 · nurse 5 · resident 3 ·
consultant 6 · student_rep 3.**

> **Correction to prior discovery output.** `03-roles-permissions.md` §2.1 states superadmin = 32. That is
> an arithmetic error: 37 permissions minus the 4 superadmin lacks (`accessRequests.create`,
> `reports.viewAssigned`, `academic.submit`, `transfers.create`) = **33**. 33 − 30 = 3, which reconciles
> exactly with the three superadmin-only deltas in §2.1 below. Both discovery passes flagged this
> discrepancy as unresolved; it is resolved here. **Still confirm at runtime** —
> see §8, item T-01.

### 2.1 The complete superadmin ⟂ admin delta — exactly three permissions

| Permission | Enforced at |
|---|---|
| `admins.manage` | **Only** in `UserPolicy::createAdmin` (`backend/app/Policies/UserPolicy.php:30`). Never used as route middleware. |
| `templates.editStructure` | **Only** in-body at `backend/app/Http/Controllers/Api/Admin/ReferenceDataController.php:416`. Never used as route middleware. |
| `evaluationForms.editStructure` | Route middleware on 3 routes (`routes/api.php:206-208`) + `EvaluationFormPolicy::editStructure:30-33`. |

Everything else is identical between the two roles. **The SPA has no superadmin-only route at all**
(`src/App.tsx:324` — `superadmin` and `admin` share one guard group), including
`/admin/manual-admin-setup`, which creates and deactivates admin accounts.

### 2.2 Nine permissions that are enforced NOWHERE (dead grants)

`auth.viewSelf`, `templates.editContent`, `accessRequests.create`, `reports.viewAssigned`,
`reports.viewAny`, `reports.submit`, `reports.lock` — zero enforcement sites anywhere in
`backend/app`, `backend/routes` or `src/`.
`admins.manage` and `templates.editStructure` are used exactly once each, in-body (§2.1).

Consequence: **the entire clinical-report pillar is gated by policies only, never by route middleware.**
The 7 truly-dead strings are still `Gate::define`d (`AppServiceProvider.php:79-81`) and still shipped to
the browser in the login payload (`AuthController.php:146`), so a future
`Gate::allows('reports.lock')` would silently succeed for admin.

### 2.3 The SPA does not use the permission list at all

`grep -rn "reports.viewAny|reports.lock|analytics.view|users.manage" src/` returns **nothing**. The only
`src/` file mentioning `permissions` is a type declaration (`src/lib/api/types.ts`). Every client-side
affordance is gated on the raw **role string** (e.g. `src/pages/admin/user-management-page.tsx:110,558-559`).
**The server permission model and the client visibility model are two independent implementations.**

---

## 3. ROUTE × ROLE ACCESS MATRIX

174 API routes: **6 public**, **15 authenticated-but-ungated**, **153 permission-gated**.
All 153 sit inside the group at `routes/api.php:58` = `['auth:sanctum','active','password-changed','throttle:300,1']`.
The single documented exception is `GET /api/workspace` (`routes/api.php:62`), which strips
`password-changed` via `withoutMiddleware`.

**"200" below = passes middleware.** Where a policy narrows further, the narrowing is stated.

### 3.0 Public routes — no authentication at all (the unauthenticated attack surface)

| routes/api.php | Method | URI | Throttle | Effect |
|---|---|---|---|---|
| :38 | POST | `/api/auth/login` | 10/1min | Session login by email **or** username (`AuthController.php:96-104`). No per-account lockout — throttle is IP-keyed only. |
| :39 | POST | `/api/auth/forgot-password` | 5/1min | Queues reset email. **Correctly non-enumerating** — constant 202 (`PasswordResetController.php:34-36`). |
| :40 | POST | `/api/auth/reset-password` | 5/1min | Consumes token, rewrites password, **clears `password_change_required`**, rotates `remember_token` (`PasswordResetController.php:55-60`). No `active` check. |
| :51 | POST | `/api/access-requests` | 10/1min | **Writes a real `users` row** (`AccessRequestSubmissionController.php:92-101`), an `access_requests` row, N items, and **one notification per active admin**. No pending-duplicate guard. |
| :52 | POST | `/api/academic-access-requests` | 10/1min | Pending `admin_access_requests` row, `requested_role ∈ {resident, consultant}`, + one notification per active admin. **IN-FLUX.** |
| :53 | POST | `/api/admin-access-requests` | 10/1min | Pending `admin_access_requests` row, `requested_role` hard-coded `'admin'`, + one notification per active admin. |

Additional non-`/api` surface (`02-backend-routes.md` §5): `GET /` (welcome view, `web`),
`GET|POST /broadcasting/auth` (**`web` group only — no `auth:sanctum`, no throttle, no `active`**),
`GET /sanctum/csrf-cookie`, `GET /up` (health, unauthenticated, unthrottled), and — undeclared by any
route file — `GET /storage/{path}` and **`PUT /storage/{path}`**, the latter writing arbitrary bytes to
disk guarded only by an `APP_KEY` relative signature (`ReceiveFile.php:28-31,45-47`), because
`backend/config/filesystems.php:36` sets `'serve' => true`.

### 3.1 Authenticated but with NO `permission:` middleware — 15 routes

Access = **every authenticated active role** at the middleware layer. Authorization is entirely policy
or service-level.

| routes/api.php | Method | URI | Who really gets data |
|---|---|---|---|
| :43 | GET | `/api/auth/me` | all — own payload. **No throttle at all.** |
| :44 | POST | `/api/auth/logout` | all. **No throttle.** |
| :47 | POST | `/api/auth/change-password` | all. Requires `current_password` (`AuthController.php:66`). **No throttle — bcrypt verify + bcrypt re-hash at unlimited rate.** |
| :62 | GET | `/api/workspace` | all; body branches on `Permissions::isAdminRole` (`WorkspaceController.php:52`). `password-changed` deliberately stripped. |
| :64 | GET | `/api/reports` | **No `Gate::authorize` anywhere in `index`.** Non-admin roles get **200 with an empty page**, not 403 — the only control is the query filter `whereHas('assignment', nurse_id = user, active = true)` at `ReportWorkflowController.php:51-55`. |
| :65 | POST | `/api/reports` | No route gate, no controller gate. Enforced three layers down at `ReportSubmissionService.php:48` → `authorizeAssignmentEdit:388-400` (admin, or `assignment.nurse_id === actor.id && assignment.active`). **Verified present — not a live hole, but an architectural inconsistency.** |
| :66 | GET | `/api/reports/details` | per-report `Gate::authorize('view')` at `:138` |
| :67 | GET | `/api/reports/{report}` | `ReportPolicy::view` (`:88`) → adminLike OR owning active assignment |
| :68 | PUT | `/api/reports/{report}` | `ReportPolicy::update` (`:174`) → adminLike OR (owning assignment AND report not locked) |
| :69 | POST | `/api/reports/{report}/submit` | `ReportPolicy::submit` (`:195`) → same as update |
| :70 | POST | `/api/reports/{report}/lock` | `ReportPolicy::lock` (`:215`) → `isAdminLike` |
| :71 | POST | `/api/reports/{report}/unlock` | `ReportPolicy::unlock` (`:224`) → `isAdminLike` |
| :73 | GET | `/api/reports/{report}/comments` | `Gate::authorize('view', $report)` (`ReportCommentController.php:20`) |
| :74 | POST | `/api/reports/{report}/comments` | `Gate::authorize('view', $report)` (`:35`) — **there is no separate comment-write ability** |
| :75 | DELETE | `/api/reports/{report}/comments/{comment}` | `Gate::authorize('view', $report)` (`:73`) **plus** an explicit author-or-admin check at `:75-82` (verified present) |

### 3.2 Permission-gated routes — the grid

Read: for each permission, which roles pass the middleware. Everything not marked **200** receives a
**403 from `EnsurePermission`** (`backend/app/Http/Middleware/EnsurePermission.php:19-24`) *before the
controller runs*.

| Permission (routes) | s.admin | admin | nurse | resident | consultant | s.rep | Policy that narrows further |
|---|:--:|:--:|:--:|:--:|:--:|:--:|---|
| `users.view` (2) | 200 | 200 | 403 | 403 | 403 | 403 | `UserPolicy::viewAny/view` — §4.1 |
| `users.manage` (5) | 200 | 200 | 403 | 403 | 403 | 403 | `UserPolicy::create/createAdmin/update/setActive` — §4.1 |
| `admins.approve` (3) | 200 | **200** | 403 | 403 | 403 | 403 | `AdminAccessRequestPolicy::viewAny/review` — **no narrowing at all**, §4.3 |
| `departments.manage` (7) | 200 | 200 | 403 | 403 | 403 | 403 | `ReferenceDataPolicy` — `isAdminLike` for writes |
| `templates.manage` (7) | 200 | 200 | 403 | 403 | 403 | 403 | `ReferenceDataPolicy`; `templates.editStructure` branch in-body at `ReferenceDataController.php:416` restricts structural edits to **superadmin** |
| `assignments.manage` (4) | 200 | 200 | 403 | 403 | 403 | 403 | `ReportAssignmentPolicy` — `isAdminLike` |
| `accessRequests.review` (5) | 200 | 200 | 403 | 403 | 403 | 403 | `AccessRequestPolicy` — `isAdminLike` |
| `reports.import` (2) | 200 | 200 | 403 | 403 | 403 | 403 | **none — zero in-action authorization** |
| `analytics.view` (12) | 200 | 200 | 403 | 403 | 403 | 403 | **none — zero in-action authorization, no per-department scoping visible** |
| `audit.view` (2) | 200 | 200 | 403 | 403 | 403 | 403 | `AuditLogPolicy` / `AdminAuditLogPolicy` — `isAdminLike` |
| `settings.manage` (3) | 200 | 200 | 403 | 403 | 403 | 403 | `AppSettingPolicy::update` — `isAdminLike` |
| `actionItems.view` (1) | 200 | 200 | 403 | 403 | 403 | 403 | **none** |
| `actionItems.manage` (2) | 200 | 200 | 403 | 403 | 403 | 403 | **none** |
| `notifications.view` (5) | 200 | 200 | **200** | **403** | **403** | **200** | `NotificationPolicy` — owner-or-admin. **See F-05 in §6.** |
| `academic.submit` (8) | **403** | **403** | 403 | **200** | **200** | 403 | `Consultant/ResidentEvaluationPolicy` + hard role checks in `AcademicEvaluationController.php:146-150,160-164,369-373` |
| `academic.view` (10) | 200 | 200 | 403 | 403 | 403 | 403 | `Gate::authorize('viewAny', ConsultantEvaluation)` → `isAdminLike` |
| `academic.manage` (5) | 200 | 200 | 403 | 403 | 403 | 403 | `MorningSessionPolicy::manage` / `ResidentEvaluationPolicy::createExternal` → `isAdminLike` |
| `academicStructure.manage` (12) | 200 | 200 | 403 | 403 | 403 | 403 | `WardPolicy` / `SectionPolicy` / `DutyTypePolicy` — all `isAdminLike` |
| `roster.manage` (4) | 200 | 200 | 403 | 403 | 403 | 403 | `DutyAssignmentPolicy` / `SectionPolicy::update` — `isAdminLike` |
| `rotations.manage` (5) | 200 | 200 | 403 | 403 | 403 | 403 | `RotationCalendarPolicy` — `isAdminLike` |
| `evaluationForms.editContent` (2) | 200 | 200 | 403 | 403 | 403 | 403 | `EvaluationFormPolicy::editContent` — `isAdminLike` |
| `evaluationForms.editStructure` (3) | 200 | **403** | 403 | 403 | 403 | 403 | `EvaluationFormPolicy::editStructure` — `isSuperadmin` |
| `morningAttendance.record` (3) | 200 | 200 | 403 | **200** | **200** | 403 | `MorningSessionPolicy::viewToday/record/cancel` — **the real gate**, §4.5 |
| `teachingLog.record` (2) | 200 | 200 | 403 | 403 | 403 | **200** | `TeachingSessionPolicy::viewMine/record` — rep-scope matrix, §4.6 |
| `studentAttendance.record` (2) | 200 | 200 | 403 | 403 | **200** | 403 | `TeachingSessionPolicy::viewToday/recordAttendance` — **does NOT narrow**, §4.6 |
| `students.manage` (30) | 200 | 200 | 403 | 403 | 403 | 403 | all 30 call `Gate::authorize(viewAny\|manage, TeachingSession::class)` → `isAdminLike` |
| `transfers.create` (4) | **403** | **403** | 403 | 403 | **200** | 403 | `TransferRequestPolicy::create/viewMine/cancel` — §4.7 |
| `transfers.review` (3) | 200 | 200 | 403 | 403 | **200** | 403 | `TransferRequestPolicy::viewAny/decide` — **narrows consultants to destination section heads only**, §4.7 |

### 3.3 The same controller action reachable through two different permissions

| Action | Route A | Route B | Single in-action gate |
|---|---|---|---|
| `MorningSessionController@cancel` | `routes/api.php:244` → `POST /api/academic/morning-sessions/{id}/cancel`, `permission:morningAttendance.record` (resident, consultant, admins) | `routes/api.php:244` → `POST /api/admin/morning-sessions/{id}/cancel`, `permission:academic.manage` (admins only) | one `Gate::authorize('cancel', $morningSession)` at `MorningSessionController.php:171` |

**The weaker route wins.** A resident wanting to cancel simply calls the `/academic/` URL. The only
thing holding the line is `MorningSessionPolicy::cancel:56-69` (non-admins need `status==='pending'`
AND same-day AND `isRecorder`). The route table misrepresents the actual control.

### 3.4 A permission mismatch inside one route block

`POST /api/admin/academic/sections/{section}/set-consultant` (`routes/api.php:222`) is gated on
`permission:roster.manage`, while all 11 sibling routes in the same block (`:212-227`) use
`permission:academicStructure.manage`. Both permissions belong to exactly `{superadmin, admin}`, so
there is no live gap — but the two permissions could be split in future.

### 3.5 SPA route guards vs server reality

`src/App.tsx:254-405`, guards at `src/routes/route-guards.tsx:10-72`. **The SPA has 28 routes.**

| SPA route | Client guard | Gap |
|---|---|---|
| `/reports/:assignmentId/:periodId` (`App.tsx:280-283`) | **authenticated, ANY role** | `report-form.tsx:485-487` computes `canView = role !== 'nurse' \|\| own assignment`, so **every non-nurse role — resident, consultant, student_rep — gets `canEdit === true` on any unlocked report** and sees enabled Save/Submit buttons (`:1095,1100,1429`). Only the server stands between a student rep and another department's clinical report. |
| `/admin/notifications` (`App.tsx:276-279`) | **authenticated, ANY role** despite the `/admin/` prefix | It is where the header bell sends *every non-nurse role* (`app-shell.tsx:357-361`) |
| `/notifications` (`App.tsx:272-275`) | **authenticated, ANY role** | — |
| `/academic/morning` (`App.tsx:285,295-298`) | `roles=['resident','consultant']` **only** | The morning-recorder designation gates only the **nav link** (`navigation.ts:107-113`). Any resident can reach the recorder UI by typing the URL. |
| `/admin/manual-admin-setup` (`App.tsx:324,370-373`) | `roles=['superadmin','admin']`, **no nav item anywhere** | Creates admins and deactivates admins; the page's own copy claims superadmin-only (`manual-admin-setup-page.tsx:236`) but that is a *claim about the server*, and the page redirects a plain admin at `:83` — a client-side check only. |
| `/admin/departments/:departmentId` (`App.tsx:359`) | `roles=['superadmin','admin']` | **No in-app link exists anywhere in `src/`** and the page does **no in-body role check** (`department-detail-page.tsx:38-47`). URL-only. |
| `/admin/academic/evaluation-forms` publish/draft buttons | hidden client-side for non-superadmin (`evaluation-forms-page.tsx:106,333,442`) | route itself admits plain `admin`; only `permission:evaluationForms.editStructure` on the server stops them |

Landing per role: `src/routes/landing.ts:8-20` — nurse→`/nurse`, resident/consultant→`/academic`,
student_rep→`/teaching`, admin & superadmin→`/admin`. **But `login-page.tsx:47-52,99` hardcodes
`role === 'nurse' ? '/nurse' : '/admin'`**, so academic roles are routed to `/admin`, fail the guard,
and are bounced — a second, divergent routing source of truth.

---

## 4. POLICY TRUTH TABLES

**26** policy classes in `backend/app/Policies/` — **[rev2] counted directly** (`ls backend/app/Policies/*.php | wc -l` = 26; the 27th entry in that directory is the `Concerns/` sub-directory holding the shared trait). `02-backend-routes.md` §1 says 27; 26 is correct. **20 are explicitly bound** at
`AppServiceProvider.php:83-102`; **9 rely on Laravel's convention auto-discovery**
(`DutyTypePolicy`, `DutyAssignmentPolicy`, `EvaluationFormPolicy`, `MorningSessionPolicy`,
`RotationCalendarPolicy`, `SectionPolicy`, `TeachingSessionPolicy`, `TransferRequestPolicy`,
`WardPolicy`). A discovery miss fails *closed* for `Gate::authorize` (throws
`AuthorizationException`), so this is a maintainability risk rather than an open door — **but it has
never been exercised under `php artisan optimize` / cached config.**

Shared trait `backend/app/Policies/Concerns/HandlesDomainAuthorization.php`:
`isAdminLike():12-15` · `isSuperadmin():17-20` · `ownsAssignment():22-27` ·
`canViewAssignedReport():29-43` · `canMutateAssignedUnlockedReport():45-52`.

### 4.1 `UserPolicy` — **STATUS: IN-FLUX — RE-VERIFY** (`backend/app/Policies/UserPolicy.php`)

The single most important policy in the system. Backs 7 routes (`routes/api.php:149-155`) via
`Gate::authorize` at `UserController.php:28, 95, 97, 119, 126, 148, 194, 211, 241`.

| Method | Line | Rule as written |
|---|---|---|
| `viewAny` | 13-16 | `users.view` → superadmin, admin |
| `view(target)` | 18-21 | `user.id === target.id` **OR** `isAdminLike(actor)` |
| `create` | 23-26 | `users.manage` → superadmin, admin |
| `createAdmin` | 28-31 | `admins.manage` → **superadmin only** |
| `update(target)` | 33-50 | ① target **is self** → **`true`, unconditionally** (`:35-37`) ② `isSuperadmin(actor)` → true (`:39-41`) ③ target is admin-or-superadmin → **false** (`:45-47`) ④ else `isAdminLike(actor)` (`:49`) |
| `setActive(target)` | 52-63 | target is superadmin → **false** (`:54-56`) · target is admin → `isSuperadmin(actor)` (`:58-60`) · else `isAdminLike(actor)` (`:62`) |
| `delete(target)` | 65-68 | delegates verbatim to `setActive` |

#### `update` — actor × target

| actor ↓ / target → | **self** | superadmin (other) | admin (other) | nurse / resident / consultant / student_rep |
|---|:--:|:--:|:--:|:--:|
| superadmin | **ALLOW** (:35) | ALLOW (:39) | ALLOW (:39) | ALLOW (:39) |
| admin | **ALLOW** (:35) | DENY (:45) | DENY (:45) | ALLOW (:49) |
| nurse / resident / consultant / student_rep | **ALLOW** (:35) — *but unreachable: `permission:users.manage` blocks the route at `routes/api.php:152`* | DENY (:49) | DENY (:49) | DENY (:49) |

> **The self branch at `:35-37` returns `true` BEFORE any role check.** The comment at `:43-44` claims it
> "mirrors setActive" — it does not; `setActive` has no self-allow. The only thing stopping a nurse from
> PATCHing their own row (including `role_key`) is the route middleware. That is a defence-in-depth gap.

#### `setActive` / `delete` — actor × target

| actor ↓ / target → | superadmin | admin | any other role |
|---|:--:|:--:|:--:|
| superadmin | **DENY** (:54) — *even itself* | ALLOW (:58) | ALLOW (:62) |
| admin | **DENY** (:54) | **DENY** (:58) — *including itself* | ALLOW (:62) |
| nurse / resident / consultant / student_rep | DENY | DENY | DENY (:62) |

**There is no API path to deactivate the maintenance (superadmin) account**, and no admin-like actor
can self-deactivate.

### 4.2 `RolePolicy` (`RolePolicy.php`)

`viewAny:12-15` / `view:17-20` = any **active** user · `create:22-25` / `update:27-30` /
`delete:32-35` = `isSuperadmin`.
**No route mounts this policy.** Roles are read-only at runtime — exposed to every authenticated user
inside the workspace bootstrap (`WorkspaceController.php:136-140`) and writable only by
seeder/migration. There is no create/rename/delete-role API.

### 4.3 `AdminAccessRequestPolicy` — **the pivot of the escalation finding**

| Method | Line | Rule |
|---|---|---|
| `viewAny` | 14-17 | `admins.approve` → superadmin **and admin** |
| `review(request)` | 19-22 | `admins.approve` → superadmin **and admin**. **No per-row narrowing. No inspection of `requested_role`.** |

### 4.4 Report family

**`ReportPolicy`** — `viewAny:14-17` `isAdminLike` · `view:19-22` `canViewAssignedReport` ·
`create(?assignment):24-31` adminLike, else `ownsAssignment` and the assignment must be `active` ·
`update:33-36` / `submit:38-41` `canMutateAssignedUnlockedReport` · `lock`/`unlock:43-51` /
`delete:53-56` `isAdminLike`.

| actor ↓ / ability → | view | update | submit | lock/unlock | delete |
|---|:--:|:--:|:--:|:--:|:--:|
| superadmin / admin | ALLOW | ALLOW | ALLOW | ALLOW | ALLOW |
| nurse **with** an active assignment on the report | ALLOW | ALLOW *(iff not locked)* | ALLOW *(iff not locked)* | DENY | DENY |
| nurse **without** that assignment | DENY | DENY | DENY | DENY | DENY |
| resident / consultant / student_rep | DENY | DENY | DENY | DENY | DENY |

**`ReportFieldValuePolicy`** — `create(?report):19-26` returns **`true` for any active user when
`$report === null`** (`:21-23`). The caller must always pass the report.
**`ReportStatusHistoryPolicy`** — `create:18-21` = **`$user->active` only, any role**.
**`CalculatedMetricPolicy`** — `view` scoped to the report; `create/update/delete` `isAdminLike`.
**`ReportAssignmentPolicy`** — `view` adminLike-or-owner; everything else `isAdminLike`.

### 4.5 `MorningSessionPolicy` — **IN-FLUX**

| Method | Line | Rule |
|---|---|---|
| `viewAny` | 14-17 | `isAdminLike` |
| `viewToday` | 25-28 | active **and** (`isAdminLike` **or** `role_key ∈ {resident, consultant}`) |
| `record(session)` | 35-50 | inactive→false; adminLike→true (`:41-43`); **not `MorningSessionService::isRecorder($user)`→false** (`:45-47`); else `session.session_date->isToday()` (`:49`) |
| `cancel(session)` | 56-69 | inactive→false; adminLike→true; else `status==='pending'` **and** same day **and** `isRecorder` |
| `manage` | 71-74 | `isAdminLike` |

| actor | viewToday | record (today, designated) | record (today, NOT designated) | record (not today) | cancel (pending, today, designated) |
|---|:--:|:--:|:--:|:--:|:--:|
| superadmin / admin | ALLOW | ALLOW | ALLOW | ALLOW | ALLOW |
| resident / consultant | **ALLOW (200 with `canRecord:false`)** | ALLOW | DENY | DENY | ALLOW |
| nurse / student_rep | 403 at middleware (`morningAttendance.record` not held) | — | — | — | — |

`isRecorder` (`backend/app/Services/Academic/MorningSessionService.php:44-47`) is
`in_array($user->id, config()['morningRecorderIds'], true)` — **a pure id-membership test with no
active check, no role check, no permission check.**

### 4.6 `TeachingSessionPolicy` — **IN-FLUX**

| Method | Line | Rule |
|---|---|---|
| `viewAny` / `manage` | 19-22 / 30-33 | `isAdminLike` |
| `viewMine` | 38-43 | active and (`isAdminLike` or an **active** `RepAssignment` on an **active** batch) |
| `viewToday` | 46-49 | active and (`isAdminLike` or `role_key === 'consultant'`) — **any consultant, any batch** |
| `record(session)` | 58-85 | see matrix |
| `recordAttendance(session)` | 88-91 | `active && (isAdminLike \|\| role_key === 'consultant')` — **`$session` is bound and never read** |

> **`recordAttendance` ignores its `$session` argument entirely.** The docblock at `:87` says
> "recorded by the consultant who taught, or an admin." The code implements "**any** active consultant,
> for **any** session in **any** batch." With 18 active consultants live, that is 18 accounts able to
> write attendance for any student in any batch.

`record` truth table (rep scope from `backend/app/Models/RepAssignment.php:40-45` `recordableActivities()`
and `:48-55` `subgroup()`):

| actor | schedule-backed? | scope | `session.activity_type` | subgroup match | Result |
|---|:--:|---|---|:--:|:--:|
| superadmin / admin | any | — | any | — | **ALLOW** (`:64-66`, short-circuits before the schedule check) |
| student_rep | no | any | any | any | DENY (`:68-70`) |
| student_rep | yes | `group` | `lecture`, `seminar` | n/a | ALLOW |
| student_rep | yes | `group` | `bedside`, `teaching_round` | — | **DENY** (`:79`) |
| student_rep | yes | `subgroup_a` | `bedside`, `teaching_round` | session.subgroup = `A` | ALLOW |
| student_rep | yes | `subgroup_a` | `bedside`, `teaching_round` | session.subgroup ≠ `A` | DENY (`:83`) |
| student_rep | yes | `subgroup_b` | `bedside`, `teaching_round` | session.subgroup = `B` | ALLOW |
| student_rep | yes | `subgroup_*` | `lecture`, `seminar` | — | **DENY** (`:79`) |
| student_rep | yes | no active assignment for `session.batch_id`, or batch inactive | any | any | DENY (`:72-77`) |
| resident / consultant / nurse | — | — | — | — | 403 at middleware (`teachingLog.record` not held) |

`rep_assignments.scope` is a plain varchar with a CHECK but the model's `default` arm yields
`['bedside','teaching_round']` + `subgroup() === null`, which can never satisfy `:83`. **Fail-closed.**

### 4.7 `TransferRequestPolicy` — **IN-FLUX**

| Method | Line | Rule |
|---|---|---|
| `viewAny` | 14-19 | `isAdminLike` **or** heads any section |
| `view(req)` | 21-27 | `isAdminLike` **or** own request **or** heads `to_section_id` **or** heads `from_section_id` |
| `create` | 29-32 | active **and** `role_key === 'consultant'` |
| `viewMine` | 35-38 | active **and** `role_key === 'consultant'` |
| `decide(req)` | 45-52 | inactive **or** not pending → false; else `isAdminLike` **or** heads the **DESTINATION** section (`to_section_id`) |
| `cancel(req)` | 54-57 | active **and** own request **and** still pending |

| actor | create | view own | decide (pending) | decide (already decided) | cancel own |
|---|:--:|:--:|:--:|:--:|:--:|
| superadmin / admin | **403 at middleware** (`transfers.create` not held) | ALLOW | ALLOW | **DENY** (`:47`) | 403 at middleware |
| consultant, **destination** section head | ALLOW | ALLOW | **ALLOW** | DENY | ALLOW |
| consultant, **origin** section head | ALLOW | ALLOW | **DENY** | DENY | ALLOW |
| consultant, no headship | ALLOW | ALLOW | DENY | DENY | ALLOW |
| resident / nurse / student_rep | 403 at middleware | — | — | — | — |

Comment at `:41-44`: "there is deliberately no 'section head' role" — headship is the data relation
`sections.head_user_id`.

### 4.8 `NotificationPolicy`

`viewAny:13-16` any active user · `view:18-21` / `update:28-31` / `delete:33-36` `isAdminLike` **or**
`recipient_id === user.id` · `create:23-26` `isAdminLike`.

**The policy is correct. The route middleware is not** — all 5 notification routes require
`permission:notifications.view` (`routes/api.php:77-81`), which resident and consultant do not hold.
See F-05 in §6.

### 4.9 Evaluation policies

`ConsultantEvaluationPolicy` / `ResidentEvaluationPolicy` (near-identical):
`viewAny:15-18` `isAdminLike` · `view:20-25` `isAdminLike` **or** author **or** subject ·
`create(?subject,?date):33-44` inactive→false, **`subject===null || date===null` → `true` for any active
user** (`:39-41`), else `RosterService::canPair(user, subject, date)` (`:43`) ·
`update`/`delete` `isAdminLike` · `ResidentEvaluationPolicy::createExternal:46-49` `isAdminLike`.

The permissive two-argument-less shortcut is deliberate; the real direction guard is in the controller:

| Author role | May evaluate | Pairing requirement | Route | Controller guard |
|---|---|---|---|---|
| resident | consultant | `RosterService::canPair` (shared duty pairing key on the date) | `POST /api/academic/consultant-evaluations` (`routes/api.php:102`) | `AcademicEvaluationController.php:146-150`, subject role check `:369-373`, re-check `:376` |
| consultant | resident | `RosterService::canPair` | `POST /api/academic/resident-evaluations` (`:103`) | `:160-164`, `:369-373`, `:376` |
| consultant | student (a `students` row, not an account) | **none — deliberately not ward-gated** | `POST /api/academic/student-evaluations` (`:126`) | `:291-295`; rationale comment `:236-241` |
| superadmin / admin | external resident evaluations only | — | `POST /api/admin/academic/external-evaluations` (`:200`) | `ResidentEvaluationPolicy::createExternal` |
| student_rep, nurse | **nothing** | — | — | blocked by `permission:academic.submit` |

**Neither `superadmin` nor `admin` holds `academic.submit`**, so the entire `/api/academic/*` submit
surface returns 403 for them. Admins reach academic data through `academic.view|manage` under
`/api/admin/academic/*`.

### 4.10 Uniform `isAdminLike` policies

`SectionPolicy`, `WardPolicy`, `DutyTypePolicy`, `RotationCalendarPolicy` — all five methods
(`viewAny`, `view`, `create`, `update`, `delete`) = `isAdminLike`, lines 13-36 of each file.
`DutyAssignmentPolicy` identical **except** `view:18-23` also allows `assignment.user_id === user.id`.
`AuditLogPolicy` / `AdminAuditLogPolicy` (`:12-25` each) — `viewAny`/`view`/`create` = `isAdminLike`.
`EvaluationFormPolicy` — `viewAny`/`view`/`editContent` `isAdminLike`; **`editStructure:30-33` `isSuperadmin`**.
`AppSettingPolicy` — `viewAny`/`view` any active user; `update:22-25` `isAdminLike`.
`ReferenceDataPolicy` (bound to Department, ReportTemplate, ReportFieldDefinition, ReportingPeriod) —
**`viewAny:12-15` / `view:17-20` = any active user of any role**; writes `isAdminLike`. Reachable
through routes only behind `templates.manage` / `departments.manage`, so the permissive read is not
exposed *via those routes* — but it is permissive wherever the policy is invoked without route gating.
`AccessRequestPolicy` — `viewAny`/`update`/`review`/`delete` `isAdminLike`; `view` adminLike-or-owner;
**`create:23-26` any active user**.
`AccessRequestItemPolicy` — owner-or-admin for `view`/`delete`; `create` any active user. **No call
sites found — possibly unreachable.**

---

## 5. WHERE `users.role_key` IS WRITTEN — the complete list

Grepped across `backend/app/Http/Controllers`, `backend/app/Http/Requests`, `backend/app/Services`.
**Five write sites. There are no others.**

| # | Write site | Possible new values | Gate(s) |
|---|---|---|---|
| 1 | `Admin/UserController.php:105` (store) | `admin \| nurse \| student_rep` (`Rule::in` `:84-85`) | route `permission:users.manage`; `Gate::authorize('createAdmin')` when admin-like (`:94-98`) else `create` |
| 2 | `Admin/UserController.php:166` (update) | `admin \| nurse` (`Rule::in` `:133-134`) | route `permission:users.manage`; `Gate::authorize('update', $user)` `:126`; **plus** `createAdmin` when promoting to admin `:147-149` |
| 3 | `AccessRequestSubmissionController.php:97` | hard-coded `'nurse'` | **none — unauthenticated public route**; row created `active=false` |
| 4 | `AdminAccessRequestReviewService.php:116` | `admin \| consultant \| resident` (whitelist `:24-28`, enforced `:95-99`) | `AdminAccessRequestPolicy::review` = `admins.approve` = **superadmin AND admin** |
| 5 | `CreateSuperadmin.php:67` | `'superadmin'` | console only; refuses when a superadmin exists (`:24-29`) |

`superadmin` is unreachable from every API surface (excluded from both `Rule::in` lists and from
`CREATABLE_ROLE_TITLES`).

---

## 6. ESCALATION PATHS CHECKED

Each row: the path, whether it is blocked, and **the exact line that blocks it** (or the exact line that
fails to).

| ID | Escalation attempt | Blocked? | Blocking / failing line |
|---|---|---|---|
| **E-01** | Any role sets its own `role_key` to `superadmin` via `PATCH /api/admin/users/{self}` | **BLOCKED** | `UserController.php:133-134` — `Rule::in(['admin','nurse'])`; `superadmin` is not an accepted value anywhere in the API |
| **E-02** | A plain `admin` promotes itself (or anyone) to `admin` via `PATCH /api/admin/users/{id}` | **BLOCKED** | `UserController.php:147-149` — extra `Gate::authorize('createAdmin')` when the *new* role is admin-like → `UserPolicy::createAdmin:28-31` requires `admins.manage`, which admin lacks (`Permissions.php:15`) |
| **E-03** | A plain `admin` creates an admin directly via `POST /api/admin/users {role:'admin'}` | **BLOCKED** | `UserController.php:94-95` + `UserPolicy::createAdmin:28-31` |
| **E-04** | **A plain `admin` causes a NEW `admin` account to exist by approving a pending admin signup** | **NOT BLOCKED — CONFIRMED BY BOTH DISCOVERY PASSES** | Chain: `Permissions.php:138` grants admin `admins.approve` → `AdminAccessRequestPolicy::review:19-22` checks **only** `admins.approve` and **never inspects `requested_role`** → `AdminAccessRequestReviewService::CREATABLE_ROLE_TITLES:24-28` **includes `'admin'`** → `createRequestedUser:109-122` creates a fully **active** `role_key='admin'` user with `password_change_required=false`. The pending row is enqueued by the **unauthenticated** `POST /api/admin-access-requests` (`routes/api.php:53`, `AdminRegistrationController.php:55`, throttle 10/min). **The `admins.manage` / `admins.approve` split is therefore not a containment boundary for admin proliferation.** |
| **E-05** | A non-admin (nurse/resident/consultant/student_rep) PATCHes its own user row | **BLOCKED — but by the route only** | `routes/api.php:152` `permission:users.manage`. `UserPolicy::update:35-37` returns `true` for the self branch *before* any role check, so if that middleware were ever removed, every active user could edit their own `full_name`/`email`/`username`/`training_year`/`section_id` — and set `role_key='nurse'`. **Defence-in-depth gap.** |
| **E-06** | A `superadmin` demotes itself to `nurse`, leaving zero superadmins | **NOT BLOCKED** | `UserPolicy::update:35-37` (self → true) + `UserController.php:133-134` (`nurse` accepted) + `:147-149` (the extra gate fires only when the *new* role is admin-like). One request removes the only holder of `admins.manage`, `templates.editStructure` and `evaluationForms.editStructure`. Recovery: `CreateSuperadmin.php:24-29` now finds no superadmin and will succeed — **but only from a shell.** |
| **E-07** | A `superadmin` or `admin` deactivates the maintenance account | **BLOCKED** | `UserPolicy::setActive:54-56` — target `superadmin` → `false`, unconditionally, including self |
| **E-08** | An admin-like actor deactivates itself | **BLOCKED** | superadmin hits `:54`; admin hits `:58` (`isSuperadmin(admin)` = false) |
| **E-09** | A plain `admin` deactivates another `admin` | **BLOCKED** | `UserPolicy::setActive:58-60` — requires `isSuperadmin` |
| **E-10** | A plain `admin` converts a `resident`/`consultant`/`student_rep` into a `nurse` (cross-workspace laundering) | **NOT BLOCKED** | `UserController.php:133-134` accepts `nurse` for **any** target; `UserPolicy::update` only blocks admin-like *targets* (`:45-47`). Nothing clears `training_year`, `rotation_group`, `section_id`, or the orphaned `DutyAssignment` / `RepAssignment` / `Section.head_user_id` rows. |
| **E-11** | A `superadmin` converts any account (incl. `student_rep`) to `admin` | **ALLOWED BY DESIGN** | `UserController.php:147-149` → `createAdmin` → `admins.manage`, which superadmin holds |
| **E-12** | An anonymous actor creates a real `users` row | **PARTIALLY BLOCKED** | `POST /api/access-requests` (`routes/api.php:51`) **does** create one (`AccessRequestSubmissionController.php:92-101`) but with `active=false` (`:99`), and login rejects inactive accounts at `AuthController.php:35-39`. The **only** activation path is `AccessRequestReviewService.php:45-49`, gated `accessRequests.review`. **Unbounded inactive-row growth is not blocked at all** — there is no pending-duplicate guard, unlike its two siblings (`AcademicRegistrationController.php:48-52`, `AdminRegistrationController.php:43-47`). |
| **E-13** | An anonymous actor self-selects a privileged role in a registration payload | **BLOCKED** | `AdminRegistrationController.php:55` hard-codes `requested_role='admin'` with the comment "Never trust a client-supplied role"; `AcademicRegistrationController.php:35` constrains to `Rule::in(['resident','consultant'])` and pins at `:61`; `AccessRequestSubmissionController.php:97` hard-codes `'nurse'`. **IN-FLUX for the academic path.** |
| **E-14** | A `superadmin` request is submitted to the approval queue and approved | **BLOCKED** | `AdminAccessRequestReviewService::createRequestedUser:95-99` **aborts** if `requested_role ∉ {admin, consultant, resident}` (`CREATABLE_ROLE_TITLES:24-28`). Covered by an existing test (`AdminRegistrationTest`, "superadmin request never approvable"). |
| **E-15** | A `student_rep` reaches evaluation data or any academic admin surface | **BLOCKED (claimed)** | `Permissions.php:186-193` grants student_rep only `auth.viewSelf`, `notifications.view`, `teachingLog.record`. All `/api/academic/*` submit routes require `academic.submit`; all `/api/admin/academic/*` require `academic.view|manage`. A structural test is claimed at `UndergraduateModuleTest.php` ("student rep never carries an academic permission", "403 on every academic evaluation endpoint"). |
| **E-16** | A `student_rep` logs a session outside its scope or subgroup | **BLOCKED** | `TeachingSessionPolicy::record:68-84` — schedule backing, active assignment on an active batch, activity type in `recordableActivities()`, and subgroup match. Fail-closed on unknown scope values. |
| **E-17** | The **origin** section head decides a transfer away from their section | **BLOCKED** | `TransferRequestPolicy::decide:45-52` — only `to_section_id` headship counts |
| **E-18** | A non-designated resident/consultant records or cancels a morning session | **BLOCKED — by the policy only** | `MorningSessionPolicy::record:45-47` and `cancel:56-69` require `isRecorder`. The *route* (`routes/api.php:122/244`) admits every resident and consultant; the stricter `academic.manage` route to the same action is decorative. |
| **E-19** | A privilege gained by having `active` flipped to `false` mid-session | **BLOCKED for HTTP, NOT for broadcast** | `Gate::before` (`AppServiceProvider.php:77`) + `EnsureActiveUser:16-22` + `Permissions::forUser` returning `[]` (`:210-212`) — three independent mechanisms. **But `Gate::before` does not cover `Broadcast::channel` callbacks**, and `routes/channels.php:11-13` checks identity only — no `active`, no `password_change_required`. `/broadcasting/auth` is on the `web` group with no `auth:sanctum`, no throttle. Impact is nil today only because `BROADCAST_CONNECTION=log` (`.env:48`). |
| **E-20** | A user owing a forced password change acts anyway | **PARTIALLY BLOCKED** | `EnsurePasswordChanged:21-31` returns 403 on every authed route. **Two documented exceptions:** ① `GET /api/workspace` strips it deliberately (`routes/api.php:62`, rationale `:59-61`); ② `POST /api/access-requests` carries **no auth middleware at all** yet reads `Auth::guard('web')->user()` (`AccessRequestSubmissionController.php:27`) and `statefulApi` is on (`bootstrap/app.php:48-51`), so a session cookie **is** honoured and validation degrades from `required` to `sometimes` (`:31-34`). |
| **E-21** | Forced password rotation neutralised without knowing the current password | **NOT BLOCKED** | `PasswordResetController::reset:47-64` sets `password_change_required = false` with **no `active` check and no current-password check**. `forgot:24` issues links to **inactive** accounts too. Anyone holding the mailbox defeats an admin-forced temporary-password rotation (`UserController::resetPassword:222` sets the flag). |
| **E-22** | Weak credentials on the most privileged account | **NOT BLOCKED** | `CreateSuperadmin.php:49` validates with a literal `['required','string','min:8']` — **not** `Password::defaults()`, which `AppServiceProvider.php:73-75` sets to `min(12)->mixedCase()->numbers()->uncompromised()` in production. `:71` also skips the forced rotation entirely when `--password` is supplied. |
| **E-23** | Account/pending-request enumeration across the trust boundary | **NOT BLOCKED** | Distinct 422 messages on all three public endpoints: `AccessRequestSubmissionController.php:81-85`; `AcademicRegistrationController.php:42-46` vs `:48-52`; `AdminRegistrationController.php:37-41` vs `:43-47`. 600 probes/hour/IP at `throttle:10,1`. Contrast `PasswordResetController::forgot:34-36`, which is correctly non-disclosing. |
| **E-24** | Credential stuffing / brute force on login | **PARTIALLY BLOCKED** | `routes/api.php:38` `throttle:10,1`, keyed by **IP** for unauthenticated requests. `AuthController` has **no per-account failed-attempt counter and no lockout**. Whether a WAF/fail2ban fronts this on-prem is **UNVERIFIED**. |
| **E-25** | Reading another user's private broadcast channel by UUID→int collapse | **BLOCKED** | `routes/channels.php:7-13` uses a string comparison via `UserChannel::authorize`, with a documented rationale and a regression test (`ChannelAuthorizationTest.php`, 3 tests). **The body of `UserChannel::authorize` was not read by any discovery agent — UNVERIFIED.** |
| **E-26** | Privilege via the SPA (client-side role checks) | **N/A — the SPA gates nothing that matters** | The client uses raw role strings only (`user-management-page.tsx:110,558-559`) and never reads the permission list. `PATCH /api/admin/users/{id}` — the role-change endpoint — **has no frontend caller at all** (`grep -rn "roleKey\|role_key" src/` → zero hits). It is API-only surface. |
| **E-27** | Arbitrary file write via the undeclared framework route | **PARTIALLY BLOCKED** | `PUT /storage/{path}` has **no auth middleware and no throttle**; the only guard is `abort_unless($request->boolean('upload') && $request->hasValidRelativeSignature())` (`ReceiveFile.php:28-31,45-47`) — an `APP_KEY`-derived signature. It exists solely because `backend/config/filesystems.php:36` sets `'serve' => true`. **UNVERIFIED whether anything in the codebase mints such signed URLs**; if nothing does, the capability is vestigial and should be disabled. |
| **[rev2] E-28** | An admin grants morning-recording capability to a role that must not have it, by writing an arbitrary id into `academic.morning_recorder_ids` | **NOT BLOCKED AT THE VALIDATION LAYER** | `Admin/SettingsController.php:82-85` validates `['uuid', Rule::exists('users','id')]` — **existence only. No `active` check, no role check.** `MorningSessionService::isRecorder:44-47` is a bare `in_array`. Containment is entirely incidental and downstream: a nurse/student_rep recorder is stopped by the route gate `permission:morningAttendance.record` (`routes/api.php:120-122`), an inactive recorder by `Gate::before` (`AppServiceProvider.php:77`). **The validation layer is not what makes this safe.** `MorningSessionService.php:232` reads the same list for a *second* purpose that sits behind **neither** gate — UNVERIFIED what it drives. |
| **[rev2] E-29** | A demoted section head retains transfer-decision authority in the data | **NOT BLOCKED AT THE POLICY — blocked only by the route** | The two `head_user_id` write sites are both guarded by `assertHeadIsConsultant` (`AcademicStructureController.php:331-347`, requires active consultant). But `TransferRequestPolicy::headsSection:59-65` and `headsAnySection:67-70` re-query `sections.head_user_id` with **no role and no `active` predicate**, and **nothing clears `head_user_id`** when an admin converts that consultant to `nurse` via `PATCH /api/admin/users` (see E-10). The demoted head is stopped only by `permission:transfers.review` (`routes/api.php:237-239`); **`TransferRequestPolicy::decide` itself would still return true.** Same shape as E-05. |
| **[rev2] E-30** | Mass-assignment of a protected column through the user-update endpoint | **BLOCKED — by the validator allow-list ONLY** | `UserController::update` writes with `$user->forceFill($updates)->save()` (`:184`; same at `setActive:201`, `resetPassword:220-223`, `destroy:244`), which **disables mass-assignment protection entirely**. `users.role_key` is *also* in `User::$fillable` (`User.php:22`), so neither mass-assignment layer constrains it. The only constraint is the hand-assembled allow-list at `:153-178` plus `Rule::in` at `:133-134`. The validator at `:128-142` **omits** `active`, `password`, `password_change_required` and `email_verified_at` — all four are real columns reachable by `forceFill`. Any future edit widening `$validated` escalates silently. |
| **[rev2] E-31** | Re-approving an already-**rejected** nurse access request re-activates the user | **NOT BLOCKED** | `AccessRequestReviewService::review()` (`backend/app/Services/Admin/AccessRequestReviewService.php:20`) has **no `status === 'pending'` guard**, unlike its sibling `AdminAccessRequestReviewService.php:47`. `AccessRequestPolicy::review:28-41` checks only `isAdminLike`, and `Admin/AccessRequestController.php:49-77` adds nothing. Approving a rejected request re-runs the whole approval: flips `active=true` (`:45-49`), re-upserts `ReportAssignment` rows, sends a second notification and writes a second audit row. **A rejected applicant can be silently activated by an approve call on a stale row.** |
| **[rev2] E-32** | An approval mints a user whose email already belongs to a real account | **BLOCKED** | `AdminAccessRequestReviewService::createRequestedUser` performs a case-insensitive duplicate-email check at approval time (`:102`) and aborts. Note the ordering risk this covers: two pending rows with the same email can both exist, and the **second** approval is what must fail. |
| **[rev2] E-33** | Approved-account password is unusable (or the copied hash is re-hashed) | **NOT AN ISSUE — RESOLVED** | `AdminAccessRequestReviewService.php:113-115` copies the request's already-bcrypt `password` into `User::create`. Laravel's `hashed` cast is a no-op on an already-hashed string: `vendor/laravel/framework/.../HasAttributes.php:1493-1509` guards with `Hash::isHashed($value)`. Approved accounts log in with the password chosen at signup. Third branch throws a `RuntimeException` if the stored hash's cost does not match the current `BCRYPT_ROUNDS` — fail-loud **inside the approval transaction** (a 500, not a broken account). Low-priority audit target: change `BCRYPT_ROUNDS` between signup and approval. |

### 6.1 [rev2] Functional (non-escalation) findings referenced elsewhere in this document

These are **capability gaps and contract violations**, not privilege escalations. They are given `F-`
IDs because §3.2, §4.8, §8 and §9 refer to them.

| ID | Finding | Evidence |
|---|---|---|
| **F-01** | `POST /api/notifications/restore` — a **view** permission (`notifications.view`, `routes/api.php:81`) gates an endpoint that creates/updates up to 50 `notifications` rows (`NotificationController@restore:101-140`), and it is the one notification route with **no in-action `Gate`**. | `routes/api.php:81`; `NotificationController.php:101-140` |
| **F-02** | `POST` and `DELETE` on report comments are both authorized with the **`view`** ability (`ReportCommentController.php:35`, `:73`). A read ability gates a write. `destroy` does add an explicit author-or-admin check at `:75-82`. | `ReportCommentController.php:20,35,73-82` |
| **F-03** | `GET /api/academic/morning-sessions/today` **mutates state** — it lazily INSERTs a `morning_sessions` row via `morningSessions->openFor($today)` when none exists and the caller is a recorder or admin. The only state-mutating GET in the API. | `MorningSessionController.php:41-50`; `routes/api.php:120` |
| **F-04** | Three whole controller surfaces have **no in-action authorization at all**, relying solely on `permission:` middleware: all 12 `/api/analytics/*` routes, `Admin/ActionItemController` (**and no `ActionItemPolicy` exists on disk**), and `Admin/ReportImportController`. | `routes/api.php:83-98, 191-196` |
| **F-05** | **`resident` and `consultant` do NOT hold `notifications.view`** (`Permissions.php:173-185`), yet all five `/api/notifications*` routes require it (`routes/api.php:77-81`). Those two roles therefore hard-403 on the entire notification API — while the strictly narrower `student_rep` **does** get it (`:190-194`). The system actively addresses notifications to residents and consultants (`morning_session_reminder`, `transfer_requested`, `transfer_decided`, `transfer_applied`, `admin_access_request_reviewed`), and the SPA header bell routes them to `/admin/notifications` (`app-shell.tsx:357-361`). A concrete, user-visible functional break. | `Permissions.php:173-194`; `routes/api.php:77-81`; `NotificationPolicy` is itself correct |
| **F-06** | `TeachingSessionPolicy::recordAttendance:88-91` and `::viewToday:46-49` **ignore the `$session` argument entirely** — "any active consultant, any session, any batch", contradicting the docblock at `:87` ("the consultant who taught"). 18 active consultants live. | `TeachingSessionPolicy.php:46-49, 87-91` |
| **F-07** | `TeachingService::record()` has **no terminal-state guard**. Its only checks are gated on `status === 'pending'` (`:162`), so a `held` / `not_held` / `cancelled` session can be flipped to any other status by a rep — `cancelled → held` is reachable. | `backend/app/Services/Academic/TeachingService.php:139,162` |
| **F-08** | **Evaluations have no duplicate-submission guard** — no unique index on `(author, subject, form_key, evaluation_date)` in `2026_08_05_000020_create_evaluations_tables.php` and no service check. The live dev DB already contains **4 duplicate groups**. Each duplicate counts into the analytics averages. | migration `2026_08_05_000020:39-44`; `01-database-schema.md` §4.3 |
| **F-09** | `autoLockHoursAfterDeadline` is validated (`Admin/SettingsController.php:48`), persisted (`AppSettingsService.php:44,78,102`) and advertised in the SPA as "Auto-locks {n}h after the deadline" (`src/pages/admin/settings-page.tsx:280,322`) — with **zero backend consumers**. There is no auto-lock command in `routes/console.php`. Locking is manual only; the UI is telling admins something untrue. | grep of `backend/app` + `backend/config` for `autoLockHours\|auto_lock_hours` |
| **F-10** | `reports.status` declares 6 values but only 4 are ever written. Nothing sets `not_started` or `overdue`, yet `AnalyticsService.php:569` counts `where('status','overdue')` — that dashboard number is **permanently 0**. | `2026_05_25_180090_create_reports_table.php:17`; `AnalyticsService.php:569` |

---

## 7. IN-FLUX — DO NOT TREAT ANY OF THIS AS SETTLED

A code-change workflow is landing in this exact area **right now**. Every claim in this document that
touches the files below is **provisional** and must be re-read before it is acted on.

| File | Git state | What in this document depends on it |
|---|---|---|
| `backend/app/Policies/UserPolicy.php` | ` M` modified | **§4.1 in full**, E-02, E-05, E-06, E-07, E-08, E-09, E-10, E-11. This is the highest-impact IN-FLUX file. |
| `backend/app/Http/Controllers/Api/AcademicRegistrationController.php` | ` M` modified | §1 (resident/consultant creation path), E-13, E-23 |
| `backend/app/Services/Admin/AdminAccessRequestReviewService.php` | ` M` modified | §5 write-site #4, **E-04 (the primary finding)**, E-14 |
| `backend/database/migrations/2026_09_09_000010_add_home_ward_to_admin_access_requests.php` | `??` untracked | `admin_access_requests.home_ward_id`; already applied to the live dev DB (batch 3) |
| `src/pages/auth/access-request-page.tsx` | ` M` modified | §3.5, all three public registration tracks |
| `src/pages/admin/user-management-page.tsx` | ` M` modified | §2.3, §3.5, the approval queue UI |
| `backend/app/Policies/MorningSessionPolicy.php` | ` M` — **not in the warned list, but dirty** | §4.5, E-18 |
| `backend/app/Policies/TeachingSessionPolicy.php` | ` M` — **not in the warned list, but dirty** | §4.6, E-16 |
| `backend/app/Policies/TransferRequestPolicy.php` | ` M` — **not in the warned list, but dirty** | §4.7, E-17 |
| `backend/database/migrations/2026_09_02_000010_add_workspace_to_roles_table.php` | `??` untracked | **The entire `roles.workspace` column in §1 is uncommitted work.** Live values verified present and matching the seeder. |

**Whole-tree caveat:** 248 entries in `git status --porcelain`, including 7 untracked migrations and 55
modified files under `src/`. Every line number above is from the **working tree**, not from `d82edb3`.

---

## 8. TO BE VERIFIED BY TESTING

Code reading is not proof that the running system behaves this way. Each item states the **experiment**
and the **expected result if the code reading is correct**.

### Priority 0 — [rev2] TEST PREREQUISITES (do these before anything else in §8)

| ID | Prerequisite | Why |
|---|---|---|
| **P-1** | **Create a real `role_key='admin'` fixture.** Do **not** use `admin@stpaulos.local` as "the admin". | `DevUserSeeder.php:43-44` seeds it as `superadmin` / "Maintenance"; **no seeder anywhere writes `'admin'`** and the live DB has 0 admin rows. Every admin-vs-superadmin assertion (T-01, T-02, T-10, and the whole `admin` column of §2, §3.2, §4.1) silently passes on a superadmin. (Addendum 2 §E.4.) |
| **P-2** | **Re-read the six IN-FLUX files (§7) before running any Priority-1 test**, and diff them against what §4.1, §5 and E-04 say. | `UserPolicy.php` has exactly **one** commit in its entire history (`b803f6b`), so its whole current shape is uncommitted content. |
| **P-3** | **Do not run destructive experiments (T-03, T-14, T-18) against `backend/database/database.sqlite`.** Use the e2e DB (`scripts/start-e2e-backend.mjs`, fixed `backend/database/e2e.sqlite`) or a copy. | T-03 leaves the deployment with zero superadmins; T-14 permanently grows `users`. |

### [rev2] Items RESOLVED by discovery pass 3 — do not re-spend budget on these

| Was | Resolution |
|---|---|
| **T-21** — does `SettingsController` validate `morning_recorder_ids`? | **RESOLVED: existence only.** `Admin/SettingsController.php:82-85` = `['uuid', Rule::exists('users','id')]`. No `active`, no role check. Promoted to escalation row **E-28**; the remaining experiment is to prove the downstream containment (route gate + `Gate::before`) actually holds, and to determine what `MorningSessionService.php:232` does with the same list. |
| **T-24** — does the `hashed` cast double-hash a copied bcrypt string? | **RESOLVED: no.** `HasAttributes.php:1493-1509` guards with `Hash::isHashed()`. See **E-33**. |
| **T-27** — residual `doctor_admin` rows? | **RESOLVED: zero**, in both `roles` and `users` (live query). See §1.1. |
| **§4.6 rep scope mapping** | **RESOLVED:** `RepAssignment.php:40-45` / `:48-55` read; the truth table in §4.6 is verified and fail-closed on unknown scope values. |
| **`AccessRequestReviewService` activation line** | **RESOLVED:** `:45-49` flips `active=true` only when the linked user is currently inactive. Now also the basis of **E-31**. |

### Priority 1 — escalation and authorization

| ID | Experiment | Expected if the reading is right |
|---|---|---|
| **T-01** | Dump `Permissions::ROLE_PERMISSIONS` at runtime and `array_diff` superadmin vs admin. | superadmin **33**, admin **30**, delta = exactly `{admins.manage, templates.editStructure, evaluationForms.editStructure}`. Settles the 32-vs-33 discrepancy in §2. |
| **T-02** | **(E-04, the primary target.)** Create a plain `admin`. As that admin: `POST /api/admin-access-requests` with a controlled email, then `POST /api/admin/admin-access-requests/{id}/approve` **as the same admin**. | **It succeeds and a second active `admin` exists.** Confirm the new account can log in immediately (`password_change_required=false`). |
| **T-03** | **(E-06.)** As the `superadmin`: `PATCH /api/admin/users/{own-id}` with `{"role_key":"nurse"}`. | **200.** Then `SELECT count(*) FROM users WHERE role_key='superadmin'` = 0. Do this on a throwaway DB. |
| **T-04** | **(E-05.)** Enumerate every `Gate::authorize('update', <User>)` call site and prove each sits behind `permission:users.manage`. Then remove nothing — just assert a nurse gets 403 at `PATCH /api/admin/users/{own-id}`. | 403 from middleware, **not** from the policy. |
| **T-05** | **(§4.6.)** As consultant A: `PUT /api/teaching/sessions/{session-taught-by-consultant-B}/attendance`. Also `GET /api/teaching/today` as a consultant with no relationship to the batch. | **Both succeed** — `recordAttendance:88-91` never reads `$session`. |
| **T-06** | **(E-18 / §3.3.)** As a resident who is NOT a designated recorder: `POST /api/academic/morning-sessions/{id}/cancel`. Then as one who IS, on a non-today and on a non-pending session. | 403 in all three cases, from `MorningSessionPolicy::cancel`, not from middleware. Also determine whether the duplicate route at `routes/api.php:122` vs `:244` is deliberate. |
| **T-07** | **(F-05.)** As `resident` and as `consultant`, hit all five `/api/notifications*` routes. Then trigger `MorningSessionService.php:237-239` and `TransferService.php:345` and confirm rows land in `notifications` addressed to those users. | **403 on all five**, yet rows exist that they can never read. Also confirm the SPA does not render a bell that 403s for them (`app-shell.tsx:357-361` sends them to `/admin/notifications`). |
| **T-08** | As each of `resident`, `consultant`, `student_rep`, `nurse`: `GET /api/reports` and `GET /api/reports/details`. | **200 with an empty page**, not 403 (`ReportWorkflowController.php:28-85` has no gate). Confirm the `whereHas` at `:51-55` is genuinely the only barrier. |
| **T-09** | **(§3.5.)** As a `student_rep`, open `/reports/:assignmentId/:periodId` in the browser and click Save/Submit on an unlocked report. | The buttons are **enabled** client-side; the server must reject at `ReportSubmissionService.php:388-400`. Prove the server rejects. |
| **T-10** | **(E-27 / T-06 sibling.)** As a plain `admin`: `POST /api/admin/academic/evaluation-forms/{key}/draft` and `.../publish`. | 403 — `evaluationForms.editStructure` is superadmin-only. The SPA merely hides the buttons. |
| **T-11** | Verify the **9 auto-discovered policies** actually bind at runtime, especially under `php artisan optimize` / `config:cache`: `DutyType`, `DutyAssignment`, `EvaluationForm`, `MorningSession`, `RotationCalendar`, `Section`, `TeachingSession`, `TransferRequest`, `Ward`. | All bind. A miss must fail **closed**. |
| **T-12** | As a `student_rep`, attempt every `/api/academic/*` and `/api/admin/academic/*` route; then the scope matrix from §4.6 (group rep on a bedside session; subgroup_a rep on a subgroup B session). | 403 everywhere except `/api/teaching/my-sessions` and `/api/teaching/sessions/{id}/record` within scope. |
| **T-13** | **(E-17.)** As the **origin** section head, decide a transfer. As an admin, decide an already-decided request. | Both 403 (`TransferRequestPolicy:45-52`, `:47`). |

### Priority 2 — the public surface

| ID | Experiment | Expected |
|---|---|---|
| **T-14** | **(E-12.)** Anonymous `POST /api/access-requests` repeatedly with the SAME email and differing payloads. Count rows in `users`, `access_requests`, `access_request_items`, `notifications`. Compare against `/api/admin-access-requests`, which *does* dedupe. | Unbounded `users` growth with `active=false`. Notification rows per request = number of active admins (write amplification). |
| **T-15** | **(E-20 ②.)** `POST /api/access-requests` while holding a valid session cookie for a user with `password_change_required=true`, with `full_name`/`email`/`password` **omitted**. | It succeeds where every other authed route 403s. |
| **T-16** | **(E-23.)** Submit all three registration endpoints with (a) a known-existing email and (b) an email with a pending request; diff the 422 bodies. **Re-run after the IN-FLUX workflow lands.** | Distinct, disclosing messages. |
| **T-17** | **(E-21.)** `POST /api/auth/forgot-password` for a **deactivated** user, then consume the link. | A link is issued; `password_change_required` is cleared without the current password. Login still fails at `AuthController.php:35-39` — confirm that. |
| **T-18** | **(E-22.)** Run `app:create-superadmin` with `APP_ENV=production` and an 8-char all-lowercase password; and again with `--password` supplied. | Accepted (literal `min:8`); with `--password`, no rotation forced. |
| **T-19** | **(E-24.)** 15+ bad logins against one account from one IP, then from a second IP. | 429 on the first IP; the second IP is unaffected — no per-account lockout. |

### Priority 3 — the layers nobody has tested

| ID | Experiment | Expected |
|---|---|---|
| **T-20** | Read `App\Support\Broadcasting\UserChannel::authorize` and confirm strict string comparison. Then switch `BROADCAST_CONNECTION` off `log` and test channel auth for a user whose `active` was flipped false mid-session. | Identity check passes; **`active` is not checked** (`channels.php:11-13`, `Gate::before` does not apply). |
| **T-21** | Read `Admin\SettingsController` and write `academic.morning_recorder_ids` with (a) a non-existent UUID, (b) an inactive user, (c) a `nurse` or `student_rep` id. | `isRecorder:44-47` validates none of these; whether the *settings controller* does is **UNVERIFIED**. |
| **T-22** | Determine whether `AnalyticsService` / `DashboardAnalyticsService` scope results by the caller. The 12 `/api/analytics/*` routes have **no policy** and no per-department scoping visible in the controller (`AnalyticsController.php:33-116`). | If unscoped, any `analytics.view` holder sees every department. |
| **T-23** | `ReportCommentController::destroy` — can a nurse delete **another** user's comment on a report they can view? | No: the author-or-admin check at `:75-82` should abort 403. **Verified present by one discovery pass; confirm empirically.** |
| **T-24** | Confirm Laravel's `hashed` cast no-ops on an already-bcrypt string, which `AdminAccessRequestReviewService.php:113-115` relies on when copying the pending request's stored hash into the new user. | No re-hash. If it re-hashed, every approved account would be unable to log in. |
| **T-25** | Free-form `{key}` route segments — `AcademicEvaluationController@form` (`routes/api.php:106`) and `EvaluationFormController@storeDraft` (`:206`) are the only non-UUID, non-constrained bindings. Probe for injection / unintended form disclosure. | — |
| **T-26** | Determine whether anything mints signed upload URLs for `PUT /storage/{path}`. If nothing does, `config/filesystems.php:36` `'serve' => true` is a hardening recommendation. | — |
| **T-27** | Query for residual `doctor_admin` rows after `2026_06_01_010000_remove_doctor_admin_role.php`. | Zero. Never queried by any discovery pass. |
| **T-28** | Confirm `DevUserSeeder` (which creates a superadmin at `:43`) cannot run in production. | — |
| **T-29** | Prove `AccessRequestItemPolicy` and `RolePolicy::create/update/delete` have **no call sites** and are dead code. | No route mounts them. |
| **[rev2] T-30** | **(E-31.)** Reject a nurse access request, then call `POST /api/admin/access-requests/{id}/approve` on the same row. Check `users.active`, `report_assignments`, `notifications` and `admin_audit_logs`. | **200 with duplicated side effects** — the user is (re)activated, assignments re-upserted, a second notification and a second audit row written. Contrast the sibling admin queue, which 422s (`AdminAccessRequestReviewService.php:47`). |
| **[rev2] T-31** | **(E-29.)** Make consultant C the head of section S. Demote C to `nurse` via `PATCH /api/admin/users/{C}`. Then invoke `TransferRequestPolicy::decide` **directly** (not through the route) for a pending transfer into S. | The **policy returns true**; only `permission:transfers.review` on `routes/api.php:237-239` produces the 403. Assert the policy, not the route. Also assert whether `training_year`, `rotation_group`, `section_id`, `DutyAssignment` and `RepAssignment` rows are left orphaned (they are — nothing at `UserController.php:151-184` clears them). |
| **[rev2] T-32** | **(E-30.)** `PATCH /api/admin/users/{id}` with a body containing `active:false`, `password:"x"`, `password_change_required:true`, `email_verified_at:null` alongside a legal field. | All four are **ignored** — they are absent from the validator at `:128-142`, and `$updates` is hand-assembled at `:153-178`. If any of them lands, `forceFill` at `:184` is the reason. |
| **[rev2] T-33** | **(E-28.)** `PUT /api/admin/settings` with `morningRecorderIds` containing (a) a `nurse` id, (b) a `student_rep` id, (c) an **inactive** user id. Then have each attempt `POST /api/academic/morning-sessions/{id}/record`, and separately exercise whatever `MorningSessionService.php:232` drives. | The write **succeeds** for all three. (a) and (b) 403 at the route gate; (c) 403 via `Gate::before`. Then prove the `:232` consumer is inert for all three — this one is behind neither gate and is **UNVERIFIED**. |
| **[rev2] T-34** | **(F-06.)** As consultant A with no relationship to batch B: `GET /api/teaching/today` and `PUT /api/teaching/sessions/{B-session}/attendance`. | **Both succeed.** `$session` is bound and never read (`TeachingSessionPolicy.php:88-91`). Duplicate of T-05 — run once, report under both IDs. |
| **[rev2] T-35** | **(F-07 / F-08.)** ① Record a teaching session as `cancelled`, then POST `record` again with `status=held`. ② Submit the identical `consultant_mdt` payload twice for the same subject and date, then read `/api/academic/analytics/summary` and `/api/academic/my-performance`. | ① **Succeeds** — no terminal-state guard (`TeachingService.php:139`). ② **Two rows exist** and both count into the averages — no unique index, no service check. Not privilege escalation, but both corrupt reported numbers. |
| **[rev2] T-36** | **(F-09 / F-10.)** Set `autoLockHoursAfterDeadline=1`, push a period deadline into the past, run the full scheduler; separately read the `overdue` counter on the admin dashboard. | The report **does not auto-lock** (no consumer exists) and the overdue counter is **structurally 0** (nothing ever writes `reports.status='overdue'`). Both are UI claims the backend does not honour. |
| **[rev2] T-37** | Prove the **student_rep-never-reaches-academic-data** invariant claimed at `Permissions.php:186-189` is actually asserted by a test, not just commented. | `AuthorizationTest.php` and `UndergraduateModuleTest.php` both reference `Permissions::`, but **no discovery pass read the specific assertion**. If it does not exist, write it. |

### Existing tests that already cover parts of this model (reuse, do not rewrite)

`backend/tests/Feature/AuthorizationTest.php` (6 tests — permission gates vs role map, role/permission
middleware, active middleware, UserPolicy admin management, ReportPolicy nurse scoping, owner-or-admin
request/notification policies) — **IN-FLUX, targets `UserPolicy`**.
`backend/tests/Feature/V2ReadAuthorizationTest.php` (6 — morning/teaching/transfer read gating).
`backend/tests/Feature/UndergraduateModuleTest.php` (26 — includes "student rep never carries an academic
permission" and "403 on every academic evaluation endpoint").
`backend/tests/Feature/AdminRegistrationTest.php` (9) and `AcademicRegistrationTest.php` (10) — **both
IN-FLUX**. `ChannelAuthorizationTest.php` (3). `CreateSuperadminTest.php` (4).
**No test asserts the whole matrix.** The matrix in §2 is derived directly from
`Permissions.php:98-195` and must be validated by T-01.

---

## 9. QUICK REFERENCE — "what can role X do?"

| | superadmin | admin | nurse | resident | consultant | student_rep |
|---|---|---|---|---|---|---|
| **Workspace** | both | both | clinical | academic | academic | academic |
| **Landing route** | `/admin` | `/admin` | `/nurse` | `/academic` | `/academic` | `/teaching` |
| **Manage users** | yes | yes (not other admins) | no | no | no | no |
| **Create an admin** | yes (direct) | **yes — via the approval queue (E-04)** | no | no | no | no |
| **Edit report *structure*** | yes | **no** | no | no | no | no |
| **Edit evaluation-form *structure*** | yes | **no** | no | no | no | no |
| **File / submit clinical reports** | yes (policy-allowed) | yes (policy-allowed) | **yes, own active assignments, unlocked only** | no | no | no |
| **Lock / unlock a report** | yes | yes | no | no | no | no |
| **Submit academic evaluations** | **no** | **no** | no | **yes → consultants** | **yes → residents & students** | no |
| **Read notifications** | yes | yes | yes | **no (F-05)** | **no (F-05)** | yes |
| **Record morning attendance** | yes | yes | no | **only if designated** | **only if designated** | no |
| **Log teaching sessions** | yes | yes | no | no | no | **yes, within rep scope** |
| **Record student attendance** | yes | yes | no | no | **yes — any session, any batch** | no |
| **Request a section transfer** | **no** | **no** | no | no | **yes** | no |
| **Decide a section transfer** | yes | yes | no | no | **only as destination section head** | no |
| **View analytics** | yes | yes | no | no | no | no |
| **View audit logs** | yes | yes | no | no | no | no |

---

*End of ROLE_PERMISSION_MATRIX.md. Companion document:
`artifacts/audit-2026-07-21/discovery/00-DISCOVERY-BASELINE.md`.*
