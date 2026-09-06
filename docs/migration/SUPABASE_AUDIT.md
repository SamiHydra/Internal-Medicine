# Supabase Audit — St Paul's Hospital Reporting System

**Phase 1 deliverable.** Read-only inventory of every Supabase touch-point in the React/Vite frontend. No code modified.

- Project root: `c:\Users\Hasse\OneDrive\Desktop\Mesay`
- Frontend stack: React 19, Vite 8, TypeScript, Tailwind, React Router 7, React Hook Form, Zod, Recharts, TanStack Query, framer-motion, sonner
- Auth client: `@supabase/supabase-js` 2.100.1
- Storage: **none used** — database-only model
- Real-time: 1 channel (admin dashboard) on 3 tables
- Audit performed: 2026-05-25

Legend for **Migration priority** column:
- **Critical** — blocks login, profile load, or report submit/save/lock
- **Important** — admin/analytics/notifications, can briefly fall back during cutover
- **Later** — dev convenience, one-time setup, or polish

---

## 1. Supabase imports

| File | Imports | Notes |
|---|---|---|
| [src/lib/supabase/client.ts](src/lib/supabase/client.ts) | `createClient`, `SupabaseClient` from `@supabase/supabase-js` | Browser singleton; configures storage persistence |
| [src/lib/supabase/env.ts](src/lib/supabase/env.ts) | `import.meta.env.VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | Reads env, shows config-blocker screen when missing |
| [src/lib/supabase/api.ts](src/lib/supabase/api.ts) | `SupabaseClient`, `AuthError`, `Session` | All data and RPC operations |
| [src/context/app-data-context.tsx](src/context/app-data-context.tsx) | Re-imports `api.ts` helpers + `client.auth.*` directly | Global app state, auth listener, realtime |
| [src/app/providers.tsx](src/app/providers.tsx) | `AppDataProvider` (indirect) | Root provider tree |
| [src/pages/auth/forgot-password-page.tsx](src/pages/auth/forgot-password-page.tsx) | `client.auth.resetPasswordForEmail()` | Password reset email |
| [src/pages/auth/reset-password-page.tsx](src/pages/auth/reset-password-page.tsx) | `client.auth.{getSession,exchangeCodeForSession,updateUser,signOut}` | Recovery-link → set-password flow |
| [src/pages/admin/manual-admin-setup-page.tsx](src/pages/admin/manual-admin-setup-page.tsx) | `client.auth.getUser()` | Superadmin claim eligibility check |
| [scripts/create-demo-users.mjs](scripts/create-demo-users.mjs) | `createClient` with **service role key** | Dev seeding only |

---

## 2. Direct Supabase calls

### 2a. Auth calls

| File | Line(s) | Call | Purpose | Migration priority |
|---|---|---|---|---|
| src/lib/supabase/api.ts | ~592 | `client.rpc('resolve_sign_in_email', { p_identifier })` | Resolve username → email before sign-in | Critical |
| src/lib/supabase/api.ts | ~1033 | `client.auth.signInWithPassword()` | Login | Critical |
| src/lib/supabase/api.ts | ~1050 | `client.auth.signOut()` | Logout | Critical |
| src/lib/supabase/api.ts | ~1067 | `client.auth.signUp()` | Nurse self-signup before access request | Critical |
| src/lib/supabase/api.ts | ~1240 | `client.auth.updateUser({ email, password, data })` | Superadmin auth-metadata update | Important |
| src/context/app-data-context.tsx | ~749 | `client.auth.getSession()` | Session restore on mount | Critical |
| src/context/app-data-context.tsx | ~813 | `client.auth.onAuthStateChange()` | Listen for SIGN_IN / SIGN_OUT / token refresh | Critical |
| src/pages/auth/forgot-password-page.tsx | ~36 | `client.auth.resetPasswordForEmail(email)` | Email password-reset link | Important |
| src/pages/auth/reset-password-page.tsx | ~48 | `client.auth.getSession()` | Verify session present before reset | Important |
| src/pages/auth/reset-password-page.tsx | ~85 | `client.auth.exchangeCodeForSession(code)` | PKCE recovery exchange | Important |
| src/pages/auth/reset-password-page.tsx | ~147 | `client.auth.updateUser({ password })` | Set new password | Important |
| src/pages/auth/reset-password-page.tsx | ~154 | `client.auth.signOut()` | Force re-login after password change | Important |
| src/pages/admin/manual-admin-setup-page.tsx | ~232 | `client.auth.getUser()` | Check whether superadmin claim is allowed | Important |
| scripts/create-demo-users.mjs | — | `client.auth.admin.createUser()` | Demo seeding (service-role) | Later |

### 2b. RPC calls

| File | RPC name | Arg shape | Purpose | Migration priority |
|---|---|---|---|---|
| src/lib/supabase/api.ts:~592 | `resolve_sign_in_email` | `{ p_identifier: text }` | Map email-or-username to email | Critical |
| src/lib/supabase/api.ts:~1091 | `submit_access_request` | `{ p_user_id, p_full_name, p_email, p_requested_assignments: jsonb, p_notes }` | Create access request + items + admin notifications | Critical |
| src/lib/supabase/api.ts:~1110 | `save_report` | `{ p_assignment_id, p_reporting_period_id, p_values: jsonb, p_submit: boolean }` | Insert/update report + field values + audit + metrics + status history + notifications | Critical |
| src/lib/supabase/api.ts:~1129 | `set_report_lock_state` | `{ p_report_id, p_locked: boolean }` | Lock/unlock report; emit history + notifications | Critical |
| src/lib/supabase/api.ts:~1144 | `review_access_request` | `{ p_request_id, p_decision: 'approved' \| 'rejected' }` | Approve/reject; create assignments; notify nurse | Important |
| src/lib/supabase/api.ts:~1256 | `claim_superadmin` | `{ p_full_name, p_username }` | Promote current user to superadmin (one-time) | Important |
| src/lib/supabase/api.ts:~1313 | `provision_admin_account` | `{ p_email, p_full_name, p_role_key, p_title, p_user_id, p_username }` | Superadmin creates admin/doctor_admin profile | Important |
| src/lib/supabase/api.ts:~1334 | `set_profile_active_state` | `{ p_user_id, p_active: boolean }` | Activate/deactivate user | Important |
| src/lib/supabase/api.ts:~1481 | `update_app_settings` | `{ p_deadline_enforced, p_weekly_deadline_day, p_weekly_deadline_time, p_auto_lock_hours_after_deadline, p_notable_rise_threshold_percent, p_notable_drop_threshold_percent, p_critical_non_zero_fields }` | Update workflow/deadline/threshold settings | Important |
| src/lib/supabase/api.ts:~1500 | `sync_overdue_notifications` | `()` | Generate overdue-report notifications | Important |

### 2c. Table SELECTs

| File | Line(s) | Table | Conditions | Purpose | Priority |
|---|---|---|---|---|---|
| src/lib/supabase/api.ts | ~293 | `profiles` | `eq('id', userId)` OR `order('full_name')` (admin) | Current user; full directory (admin) | Critical |
| src/lib/supabase/api.ts | ~646 | `report_templates` | `order('name')` | Reference data | Critical |
| src/lib/supabase/api.ts | ~650 | `departments` | `order('name')` | Reference data | Critical |
| src/lib/supabase/api.ts | ~657 | `report_field_definitions` | `order('display_order')` | Field schema | Critical |
| src/lib/supabase/api.ts | ~662 | `reporting_periods` | `order('week_start')` | Period list | Critical |
| src/lib/supabase/api.ts | ~665 | `app_settings` | none | Workflow + thresholds | Critical |
| src/lib/supabase/api.ts | ~667 | `report_assignments` | `order('approved_at' desc)` | Nurse↔Dept↔Template links | Critical |
| src/lib/supabase/api.ts | ~672 | `access_requests` | admin only, `order('requested_at' desc)` | Pending/reviewed requests | Important |
| src/lib/supabase/api.ts | ~677 | `notifications` | `eq('recipient_id', userId)` `order('created_at' desc)` | Inbox | Important |
| src/lib/supabase/api.ts | ~718 | `reports` | `in('reporting_period_id', visibleIds)` `order('updated_at' desc)` | Reports in visible window | Critical |
| src/lib/supabase/api.ts | ~744 | `access_request_items` | `in('access_request_id', ids)` | Requested dept/template pairs | Important |
| src/lib/supabase/api.ts | ~750 | `report_status_history` | `in('report_id', ids)` `order('changed_at' desc)` | Audit trail | Important |
| src/lib/supabase/api.ts | ~759 | `audit_logs` | admin only | Field-level change history | Important |
| src/lib/supabase/api.ts | ~949 | `report_field_definitions` | (per-report detail) | Field schema for report detail | Critical |
| src/lib/supabase/api.ts | ~953 | `report_field_values` | `in('report_id', ids)` | Cell values | Critical |
| src/lib/supabase/api.ts | ~959 | `calculated_metrics` | `in('report_id', ids)` | BOR/BTR/ALOS | Critical |

### 2d. Table writes (INSERT / UPDATE / UPSERT / DELETE)

| File | Line(s) | Table | Operation | Purpose | Priority |
|---|---|---|---|---|---|
| src/lib/supabase/api.ts | ~1166 | `notifications` | `update({ read_at })` `eq('recipient_id', userId)` `in('id', ids)` | Mark notifications read | Important |
| src/lib/supabase/api.ts | ~1188 | `notifications` | `delete()` `eq('recipient_id', userId)` `in('id', ids)` | Clear notifications | Important |
| src/lib/supabase/api.ts | ~1220 | `notifications` | `upsert(rows, { onConflict: 'id' })` | Restore undo | Important |
| src/lib/supabase/api.ts | ~1350 | `report_assignments` | `update({ active })` `eq('id', assignmentId)` | Toggle assignment active | Important |
| src/lib/supabase/api.ts | ~1367 | `report_templates` | `upsert(...)` `onConflict: 'slug'` | Ensure template before assignment | Later |
| src/lib/supabase/api.ts | ~1389 | `departments` | `upsert(...)` `onConflict: 'slug'` | Ensure department before assignment | Later |
| src/lib/supabase/api.ts | ~1425 | `report_field_definitions` | `upsert(rows)` `onConflict: 'template_id,field_key'` | Ensure fields before assignment | Later |
| src/lib/supabase/api.ts | ~1455 | `report_assignments` | `upsert(...)` `onConflict: 'nurse_id,department_id,template_id'` | Create/restore assignment | Important |

Everything else that looks like a write (`reports`, `report_field_values`, `calculated_metrics`, `report_status_history`, `audit_logs`, `access_requests`, `access_request_items`, `app_settings`, `profiles.active`, etc.) flows through the RPCs in section 2b — the frontend never inserts/updates those tables directly.

---

## 3. Auth logic locations

| Area | File | Lines | Notes |
|---|---|---|---|
| Session restore on app mount | [src/context/app-data-context.tsx](src/context/app-data-context.tsx) | ~732–811 | `getSession()` → load profile → warm workspace cache |
| Auth-state listener | src/context/app-data-context.tsx | ~813–886 | INITIAL_SESSION, SIGNED_IN, SIGNED_OUT, TOKEN_REFRESHED |
| Login | src/context/app-data-context.tsx | ~1096–1136 | Wraps `loginWithPassword` (resolves identifier → email via RPC, then `signInWithPassword`) |
| Logout | src/context/app-data-context.tsx | ~1137–1150 | Clears local state and cache after `signOut()` |
| Signup (nurse access request) | src/lib/supabase/api.ts | ~1053–1104 | `signUp()` then `submit_access_request` RPC |
| Forgot password | src/pages/auth/forgot-password-page.tsx | ~36 | `resetPasswordForEmail()` |
| Reset password flow | src/pages/auth/reset-password-page.tsx | ~48–154 | PKCE: `exchangeCodeForSession` → `updateUser({password})` → `signOut` |
| Superadmin one-time claim | src/lib/supabase/api.ts | ~1232–1274 | `updateUser()` + `claim_superadmin` RPC; index `idx_profiles_single_superadmin` enforces uniqueness |
| Admin/Doctor-admin provisioning | src/lib/supabase/api.ts | ~1276–1327 | Ephemeral client `signUp()` + `provision_admin_account` RPC |

---

## 4. Role / permission logic

| Layer | File | Lines | Purpose |
|---|---|---|---|
| Route guards | [src/routes/route-guards.tsx](src/routes/route-guards.tsx) | 9–61 | `ProtectedRoute` redirects by role; `/admin/*` is admin/doctor_admin/superadmin only; `/nurse/*` is nurse only |
| Workspace-data loader gating | src/context/app-data-context.tsx | ~639, 670, 655 | `includeProfiles`, `includeAccessRequests`, `includeHistory` flags only set true for admin roles |
| Lazy admin loaders | src/context/app-data-context.tsx | ~1498–1539 | `ensureProfileDirectoryData`, `ensureAccessRequestData`, `ensureHistoryData` |
| Server-side enforcement | supabase/migrations/202603300001_live_integration.sql | many | Each mutating RPC calls `is_admin()` / `is_superadmin()` before acting |
| RLS — profiles | supabase/migrations/202604060002_superadmin_admin_setup.sql | 55–72 | Self-update (safe subset), admin updates nurses, superadmin updates all |
| RLS — reports / report_field_values | supabase/migrations/202603290001_initial_schema.sql | 580–696 | Nurse limited to their active assignment; admins unrestricted; locked rows blocked unless admin |

**Frontend roles in use:** `superadmin`, `admin`, `doctor_admin`, `nurse` (see [src/types/domain.ts](src/types/domain.ts):1).

---

## 5. Table inventory (deduplicated, with operations)

Tables actually referenced by frontend code:

| Table | SELECT | INSERT | UPDATE | DELETE | UPSERT | Through RPC |
|---|---|---|---|---|---|---|
| `roles` | (via seed only) | — | — | — | — | implicit reference |
| `profiles` | ✓ | — | — | — | — | `set_profile_active_state`, `claim_superadmin`, `provision_admin_account` |
| `report_templates` | ✓ | — | — | — | ✓ | — |
| `departments` | ✓ | — | — | — | ✓ | — |
| `report_field_definitions` | ✓ | — | — | — | ✓ | — |
| `reporting_periods` | ✓ | — | — | — | — | — |
| `report_assignments` | ✓ | — | ✓ (active) | — | ✓ | `review_access_request` (inserts) |
| `access_requests` | ✓ | — | — | — | — | `submit_access_request`, `review_access_request` |
| `access_request_items` | ✓ | — | — | — | — | `submit_access_request` |
| `reports` | ✓ | — | — | — | — | `save_report`, `set_report_lock_state` |
| `report_field_values` | ✓ | — | — | — | — | `save_report` |
| `calculated_metrics` | ✓ | — | — | — | — | `save_report` → `upsert_calculated_metrics` |
| `report_status_history` | ✓ | — | — | — | — | `save_report`, `set_report_lock_state`, `review_access_request` |
| `audit_logs` | ✓ | — | — | — | — | `save_report` (edits to submitted reports) |
| `notifications` | ✓ | — | ✓ (read_at) | ✓ | ✓ (restore) | `save_report`, `set_report_lock_state`, `submit_access_request`, `review_access_request`, `sync_overdue_notifications` |
| `app_settings` | ✓ | — | — | — | — | `update_app_settings` |

---

## 6. RPCs called from frontend

(See section 2b for the full table.) Summary by category:

- **Auth helpers:** `resolve_sign_in_email`
- **Onboarding:** `submit_access_request`, `review_access_request`, `claim_superadmin`, `provision_admin_account`, `set_profile_active_state`
- **Reports:** `save_report`, `set_report_lock_state`
- **Settings:** `update_app_settings`
- **Background:** `sync_overdue_notifications`

---

## 7. Report submission workflow

End-to-end trace (nurse path):

1. Nurse opens `/reports/:assignmentId/:periodId` → [src/pages/report-form-page.tsx](src/pages/report-form-page.tsx).
2. `AppDataProvider` already holds `reports`, `report_field_values`, `calculated_metrics` in state (loaded in `fetchLiveAppState`).
3. [src/components/reports/report-form.tsx](src/components/reports/report-form.tsx) renders fields from `report_field_definitions` (filtered by template + active days).
4. On change (debounced) → `saveReport({ submit: false })` → `client.rpc('save_report', ...)`.
   - RPC upserts `reports` row (status `draft`), upserts `report_field_values`, calls `upsert_calculated_metrics`, inserts `report_status_history`.
5. On submit → same RPC with `p_submit: true`.
   - Sets status `submitted`, `submitted_at`, emits `notifications` to admins (type `new_report_submitted`), inserts history row.
6. Admin edits a submitted report → same RPC; if status was `submitted`/`edited_after_submission`/`locked`, each cell delta is logged to `audit_logs`; status moves to `edited_after_submission`; notification `submitted_report_edited` is emitted.
7. Admin clicks Lock → `set_report_lock_state(p_locked: true)` → `locked_at` set, status `locked`, history + notification `report_locked`.
8. Admin clicks Unlock → same RPC with `false` → `locked_at` cleared, status reverts, notification `report_unlocked`.

Post-mutation, context refreshes `report_field_values` + `calculated_metrics` for the affected report ids (`fetchReportDetails`).

---

## 8. Analytics calculations

| Metric | Where it's computed | Notes |
|---|---|---|
| BOR % | SQL function `upsert_calculated_metrics` ([supabase/migrations/202603290001_initial_schema.sql:343](supabase/migrations/202603290001_initial_schema.sql#L343)) | `(total_patient_days / (bed_count * 30)) * 100` — inpatient only |
| BTR | Same function | `(discharged_home + discharged_ama) / bed_count` |
| ALOS | Same function | `total_patient_days / (discharged_home + discharged_ama)` |
| Persisted | `calculated_metrics` table; fetched as-is by frontend | No client-side recomputation of BOR/BTR/ALOS |
| Weekly field aggregation | [src/lib/metrics.ts](src/lib/metrics.ts):51–73 (`computeWeeklyValue`) | Sums/averages/picks-latest across days per `aggregate_type` |
| Dashboard selectors | [src/data/selectors.ts](src/data/selectors.ts) | Builds chart series, dept comparisons, monthly comparisons from `state.reports + report_field_values + calculated_metrics` client-side |
| SQL aggregates (unused on FE) | Views `v_dashboard_weekly_summary`, `v_department_metric_weekly` | Defined but not queried by frontend; reference only |

Procedure / outpatient / availability analytics are derived **client-side** from `report_field_values` keyed by the seed field keys (e.g. `eeg_done`, `colonoscopy`, `dialysis_acute`, `senior_physician_availability`, …) — see [supabase/seed.sql](supabase/seed.sql):196+.

---

## 9. Admin workflows

| Page | Route | Key calls |
|---|---|---|
| Admin dashboard | `/admin` → [src/pages/admin/admin-dashboard-page.tsx](src/pages/admin/admin-dashboard-page.tsx) | Reads everything; realtime subscription |
| Submission board | `/admin/submissions` → [src/pages/admin/submission-board-page.tsx](src/pages/admin/submission-board-page.tsx) | Reads reports + assignments |
| Department detail | `/admin/departments/:id` → [src/pages/admin/department-detail-page.tsx](src/pages/admin/department-detail-page.tsx) | Reads scoped reports |
| User management | `/admin/users` → [src/pages/admin/user-management-page.tsx](src/pages/admin/user-management-page.tsx) | `ensureProfileDirectoryData`, `ensureAccessRequestData`, `set_profile_active_state`, `review_access_request`, assignment upsert/toggle |
| Templates | `/admin/templates` → [src/pages/admin/template-management-page.tsx](src/pages/admin/template-management-page.tsx) | Mostly read-only; references `config/templates.ts` |
| Settings | `/admin/settings` → [src/pages/admin/settings-page.tsx](src/pages/admin/settings-page.tsx) | `update_app_settings` |
| Audit log | `/admin/audit` → [src/pages/admin/audit-log-page.tsx](src/pages/admin/audit-log-page.tsx) | `ensureHistoryData` |
| Manual admin setup | `/admin/setup` → [src/pages/admin/manual-admin-setup-page.tsx](src/pages/admin/manual-admin-setup-page.tsx) | `claim_superadmin`, `provision_admin_account` |

---

## 10. Notifications & overdue logic

Notification types emitted by RPCs:

- `new_report_submitted` — `save_report(p_submit: true)`
- `submitted_report_edited` — `save_report` (delta on already-submitted)
- `report_locked` / `report_unlocked` — `set_report_lock_state`
- `overdue_report` — `sync_overdue_notifications`
- `nurse_access_request` — `submit_access_request`
- `access_request_reviewed` — `review_access_request` (referenced in frontend enum [src/types/domain.ts](src/types/domain.ts):28; not in the SQL enum — see "Inconsistencies" below)

Overdue logic:

- RPC `sync_overdue_notifications` scans drafts whose `reporting_periods.deadline_at` has passed in the **current live-reporting window** (since 2026-03-02 per migration `202604060003_shift_live_reporting_start_to_20260302.sql`).
- Frontend calls it on initial admin load (throttled ≥60 s) — there is **no server-side schedule**; it relies on someone visiting the app.
- In Laravel target: this must become a true scheduled job (`reports:sync-overdue` via `php artisan schedule:run`).

Frontend notification ops (section 2d): mark-read (UPDATE), clear (DELETE), restore (UPSERT).

---

## 11. Real-time subscriptions

| Channel | Tables (postgres_changes) | Where | Behavior |
|---|---|---|---|
| `admin-report-sync:{userId}` | `reports`, `report_field_values`, `calculated_metrics` (event `*`) | [src/context/app-data-context.tsx](src/context/app-data-context.tsx):987–1005 | Debounced refresh; fallback 20 s poll when tab hidden; immediate refresh on visibility/focus |

Realtime is **admin-only**. Nurse view does not subscribe.

**Migration replacement options:** polling with smart cache, server-sent events, or websockets via Laravel Reverb. Polling is the lowest-risk fallback.

---

## 12. Storage usage

None. No `storage.from(...)` calls anywhere in `src/`. No bucket configured in `supabase/`.

---

## 13. Environment variables

| Var | Used by | Purpose | Browser-safe? |
|---|---|---|---|
| `VITE_SUPABASE_URL` | [src/lib/supabase/env.ts](src/lib/supabase/env.ts) | Project URL | Yes (public) |
| `VITE_SUPABASE_ANON_KEY` | src/lib/supabase/env.ts | Anon API key | Yes (public) |
| `SUPABASE_URL` | scripts/create-demo-users.mjs | Service-role client | **No** (script only) |
| `SUPABASE_SERVICE_ROLE_KEY` | scripts/create-demo-users.mjs | Admin user creation | **No** (script only) |
| `SUPABASE_DB_URL` | .env.example (psql convenience) | Direct DB connection | **No** |

Post-migration replacement (browser): `VITE_API_BASE_URL` only. Service-role uses disappear (Laravel handles admin user creation via `php artisan` + seeders + admin API).

---

## 14. Service-role / script usage

| File | Service-role calls |
|---|---|
| [scripts/create-demo-users.mjs](scripts/create-demo-users.mjs) | `auth.admin.createUser()` + `profiles.upsert()` for 5 demo accounts (`admin1`, `abel.gemechu`, `hana.abera`, `samuel.hailu`, `ruth.mamo`) with shared dev password `StPaul2026!` |

Service role is **not** used anywhere in browser bundle.

---

## 15. Database schema snapshot (from `supabase/migrations/*.sql`)

### Enum types

| Enum | Values |
|---|---|
| `report_family` | `inpatient`, `outpatient`, `procedure` |
| `access_request_status` | `pending`, `approved`, `rejected` |
| `report_status` | `not_started`, `draft`, `submitted`, `edited_after_submission`, `locked`, `overdue` |
| `notification_type` | `new_report_submitted`, `submitted_report_edited`, `report_locked`, `report_unlocked`, `overdue_report`, `nurse_access_request` |
| `field_kind` | `integer`, `decimal`, `time`, `text`, `choice` |
| `field_aggregate` | `sum`, `average`, `latest`, `none` |

### Tables (column names only — full types in DATA_MODEL.md)

`roles`, `profiles`, `report_templates`, `departments`, `report_field_definitions`, `access_requests`, `access_request_items`, `report_assignments`, `reporting_periods`, `reports`, `report_field_values`, `calculated_metrics`, `report_status_history`, `audit_logs`, `notifications`, `app_settings`.

### Views

- `v_submission_board`
- `v_department_metric_weekly`
- `v_dashboard_weekly_summary`

### SQL functions / RPCs

- Triggers: `touch_updated_at`, `sync_profile_from_auth_user`
- Auth helpers: `current_role`, `is_admin`, `is_admin_role`, `is_superadmin`, `resolve_sign_in_email`, `claim_superadmin`, `provision_admin_account`, `set_profile_active_state`
- Status / metrics: `derive_submission_status`, `deadline_day_offset`, `report_value_to_text`, `recalculate_reporting_period_deadlines`, `upsert_calculated_metrics`
- Workflow RPCs: `submit_access_request`, `review_access_request`, `save_report`, `set_report_lock_state`, `sync_overdue_notifications`, `update_app_settings`

### Indexes / uniqueness worth noting

- `idx_profiles_username_unique` on `lower(username)` (partial: where not null)
- `idx_profiles_single_superadmin` on `role_key` (partial: where `role_key = 'superadmin'`) — enforces **exactly one** superadmin
- Unique `(template_id, field_key)` on field defs
- Unique `(nurse_id, department_id, template_id)` on assignments
- Unique `(assignment_id, reporting_period_id)` on reports
- Unique `(report_id, field_definition_id, day_name)` on report_field_values
- `reporting_periods.week_start` unique + check `week_end = week_start + 6`

### RLS policy themes

- Reference data (`roles`, `templates`, `departments`, `field_defs`, `periods`, `settings`): readable by any authenticated user; admin-managed writes.
- `profiles`: self-read or admin; admin updates nurses; superadmin updates all.
- `reports` / `report_field_values` / `calculated_metrics` / `status_history`: nurse limited to own active assignment; admin unrestricted; writes blocked when `locked_at is not null` for nurses.
- `audit_logs`: admin only.
- `notifications`: own recipient or admin.

---

## 16. Inconsistencies & "NEEDS CONFIRMATION"

| # | Issue | Where | Suggested action during migration |
|---|---|---|---|
| 1 | Frontend `NotificationType` includes `access_request_reviewed`, SQL enum does not | [src/types/domain.ts](src/types/domain.ts):28 vs initial_schema.sql:13 | Add `access_request_reviewed` to Laravel enum; backfill historical rows if any |
| 2 | `username` column added in later migration; not present in initial schema | 202604060002_superadmin_admin_setup.sql | Include `username` in `users` migration from day 1 |
| 3 | `app_settings` is key/value-of-JSON, not a strongly-typed row | initial_schema.sql:206 | Either replicate as-is or normalize to a single `settings` row with typed columns. **Decision needed.** |
| 4 | Critical-non-zero-fields list lives in DB JSON, but the actual field keys live in seed; no FK | seed.sql:148 | Consider validating values against `report_field_definitions.field_key` on save |
| 5 | `sync_overdue_notifications` is client-triggered today; no cron | api.ts:~1500 | Move to Laravel Scheduler in Phase 10 — true scheduled job |
| 6 | Outpatient `nurse_in_charge` field key is reused across templates (not globally unique) | seed.sql:240,251,259,… | Keys are unique only **within** a template (`unique(template_id, field_key)`); confirm Laravel keeps this scoping |
| 7 | `audit_logs.field_definition_id` is nullable but `field_key` is not | initial_schema.sql:182 | Confirm: are there orphan/global audit entries? Otherwise enforce both |
| 8 | Real-time admin sync currently relies on Supabase Realtime; no equivalent in Laravel | app-data-context.tsx:987–1005 | Choose polling vs Reverb vs SSE before Phase 11 |
| 9 | Demo seeding uses service role + a shared password | scripts/create-demo-users.mjs | Replace with Laravel seeder + forced password change |
| 10 | Some report fields (e.g. `nurse_in_charge`) are `text/latest` so they store per-day text but only "latest" is used. Confirm UX still expects that | seed.sql + metrics.ts | Should carry over unchanged unless we explicitly drop per-day for "latest" fields |

---

## 17. Migration-priority summary

| Area | Priority | Reason |
|---|---|---|
| Auth (login/logout/session/me) | **Critical** | Blocks every page |
| Profiles fetch + role exposure | **Critical** | Drives route guards everywhere |
| `save_report` RPC equivalent | **Critical** | Sole path for draft/submit/edit + audit + metrics |
| `set_report_lock_state` RPC equivalent | **Critical** | Lock/unlock + history + notifications |
| Reference data fetch (templates, depts, fields, periods, assignments, settings) | **Critical** | App can't render forms or dashboards without |
| BOR/BTR/ALOS recomputation | **Critical** | Inpatient analytics depend on persisted values |
| `submit_access_request` / `review_access_request` | **Important** | Nurse onboarding |
| Admin user mgmt (`set_profile_active_state`, assignment upsert) | **Important** | Day-to-day admin |
| Notifications CRUD + overdue sync | **Important** | UX + compliance |
| Settings (`update_app_settings`) | **Important** | Workflow control |
| Audit log read | **Important** | Compliance / oversight |
| Real-time admin subscription | **Important** | Falls back to polling cleanly |
| Templates/departments/fields upsert (one-off bootstrap) | **Later** | Mostly seed-time |
| Demo user seeding script | **Later** | Dev-only |

---

## Companion documents

- `DATA_MODEL.md` — column-level inferred schema for the Laravel migrations.
- `API_MAP.md` (Phase 11) — old RPC/query → new Laravel endpoint mapping.
- `MIGRATION_RUNBOOK.md` (Phase 18) — deploy + cutover steps.
- `ROLLBACK_PLAN.md` (Phase 18) — fallback procedure.
- `PRODUCTION_CHECKLIST.md` (Phase 18) — env / DB / security / cron checklist.
