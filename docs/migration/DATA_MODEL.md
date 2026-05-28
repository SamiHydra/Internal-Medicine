# Data Model — St Paulos / Mesay Hospital Reporting System

**Phase 2 deliverable.** Schema inferred from `supabase/migrations/*.sql`, `supabase/seed.sql`, and `src/types/domain.ts`, restated in MySQL/MariaDB-compatible terms for the Laravel migration plan.

- Source of truth: existing Supabase schema (see `SUPABASE_AUDIT.md` §15)
- Target: MySQL 8.x / MariaDB 10.6+ (Laravel 11 migrations)
- Conventions: keep snake_case table + column names (matches current code & RPC arg shapes), keep UUID primary keys (Laravel `ulid()` or `uuid()` columns), keep `created_at`/`updated_at` timestamps.

> **NEEDS CONFIRMATION** markers below flag places where the audit could not unambiguously decide. Confirm each before generating Laravel migrations.

---

## 0. Cross-cutting decisions

### 0.1 Report model choice — A vs B

The prompt asks us to pick A (generic `reports + report_values`) or B (per-family tables).

**Recommendation: A — keep the generic model.** Reasons:

1. The existing frontend ([src/components/reports/report-form.tsx](src/components/reports/report-form.tsx)) drives the entire form from `report_field_definitions`. A single `report_field_values` table maps 1:1 to that model.
2. Templates ship 11 different field sets (1 inpatient, 1 outpatient, 9 procedure). A normalized model would mean 11 wide tables.
3. Cell-level audit (`audit_logs.field_definition_id`, `field_key`, `day_name`) is already designed around the generic model.
4. BOR/BTR/ALOS are derived metrics stored in `calculated_metrics`, not duplicated as table columns. That isolation is worth preserving.

Trade-off: aggregate queries (e.g. weekly totals per dept) need joins against `report_field_definitions.field_key` rather than direct column access. The existing SQL views (`v_department_metric_weekly`, `v_dashboard_weekly_summary`) already do this and perform well at the current data volume (~30 departments × 52 weeks/yr).

### 0.2 Primary keys

Keep UUIDs everywhere except `roles`, `app_settings` (already text-keyed).

Laravel migration: `$table->uuid('id')->primary()` and use `Str::uuid7()` (or ulid) on model create.

### 0.3 Timestamps

All timestamps stored in UTC. Laravel default is fine. Use `timestamp` for write-tracking columns; `date` for `week_start`/`week_end`.

### 0.4 JSON columns

MySQL 8 / MariaDB 10.6 both support `JSON` natively. Replace `jsonb` with `JSON`.

### 0.5 Enums

Use MySQL `ENUM(...)` for fixed sets (mirror the Postgres types). For flexibility (e.g. future notification types) consider VARCHAR + DB-level CHECK on MariaDB 10.6+, or model-level validation. Default: `ENUM` for status/family/kind, `VARCHAR(64)` for notification type (so adding new types doesn't require a migration).

### 0.6 Soft deletes

The current schema does **not** use soft deletes — instead it uses `active` flags on `profiles`, `departments`, `report_assignments`, and `report_templates`. **Recommendation: keep the same pattern.** Hard delete is only used for clearing notifications.

### 0.7 Locking / approval columns

`reports` already has:
- `submitted_at TIMESTAMP NULL` — set on first submit
- `locked_at TIMESTAMP NULL` — set when locked
- `status ENUM(...)` — derived from above

No separate `report_locks` table is needed. The Laravel `ReportLockingService` reads/writes these columns and inserts into `report_status_history`.

### 0.8 Audit logging

The existing `audit_logs` table covers per-cell-edit changes to **submitted** reports. For broader admin-action audit (PHASE 6/9/17 requirement) we add a second table, `admin_audit_logs`, since the schemas differ:

| Existing `audit_logs` | New `admin_audit_logs` |
|---|---|
| Tied to a report + field | Generic entity tracking |
| Logs old/new cell value | Logs old/new JSON snapshot |
| Inserted by `save_report` RPC | Inserted by `AuditLogService` middleware |

Both should be queryable from `/admin/audit-logs`.

---

## 1. Authentication & users

### `users` (renames Supabase `auth.users` + merges `profiles`)

| Column | Type | Notes |
|---|---|---|
| `id` | CHAR(36) PK | UUID |
| `email` | VARCHAR(190) UNIQUE NOT NULL | |
| `username` | VARCHAR(64) NULL | Case-insensitive unique via `lower(username)` index. Regex: `^[a-z0-9._-]{3,32}$` |
| `password` | VARCHAR(255) NOT NULL | Laravel `bcrypt` hash |
| `full_name` | VARCHAR(190) NOT NULL | |
| `title` | VARCHAR(190) NULL | e.g. "Head Nurse" |
| `role_key` | VARCHAR(32) NOT NULL | FK → `roles.role_key` |
| `phone` | VARCHAR(32) NULL | |
| `active` | BOOLEAN NOT NULL DEFAULT TRUE | Inactive users blocked at login |
| `email_verified_at` | TIMESTAMP NULL | Laravel-standard |
| `remember_token` | VARCHAR(100) NULL | Laravel-standard (not used with Sanctum tokens, harmless to keep) |
| `last_login_at` | TIMESTAMP NULL | **NEW** — not in Supabase; useful for admin view |
| `password_change_required` | BOOLEAN NOT NULL DEFAULT FALSE | **NEW** — for forced reset on first login post-migration |
| `created_at`, `updated_at` | TIMESTAMP | |

**Indexes:**
- `UNIQUE(email)`
- `UNIQUE(lower(username))` — generated column `username_ci` + unique key (MySQL can't index expressions before 8.0.13; use a `username_ci` column maintained by trigger or model event)
- `UNIQUE(role_key) WHERE role_key='superadmin'` — MySQL doesn't support partial indexes; enforce in `User` model + a DB CHECK trigger. **Alternative:** a `singletons` table.
- INDEX on `role_key`

**Relationships:** `belongsTo(Role)`, `hasMany(ReportAssignment)`, `hasMany(AccessRequest)`, `hasMany(Notification, 'recipient_id')`, `hasMany(Report, 'created_by')`.

> **NEEDS CONFIRMATION** — the existing Supabase model used `auth.users.raw_user_meta_data` to carry `username` between signup and profile creation. In Laravel, signup directly writes to `users`; the username regex constraint should be enforced in the `StoreUserRequest` Form Request.

### `roles`

| Column | Type | Notes |
|---|---|---|
| `role_key` | VARCHAR(32) PK | `superadmin`, `admin`, `doctor_admin`, `nurse` |
| `label` | VARCHAR(64) NOT NULL | Display label (e.g. "Admin 1", "Dr. Mesay") |
| `description` | TEXT NOT NULL | |
| `created_at`, `updated_at` | TIMESTAMP | |

> **NEEDS CONFIRMATION** — the current system uses 4 fixed roles. Phase 6 of the prompt lists 5 (Super Admin, Admin, Department Head/User, Report Submitter, View Only). Recommendation: **keep the existing 4**, since the entire app is built around them. Adding "View Only" later is a one-line role insert plus policy update.

### `access_requests`

| Column | Type | Notes |
|---|---|---|
| `id` | CHAR(36) PK | UUID |
| `user_id` | CHAR(36) FK → `users.id` ON DELETE CASCADE | |
| `email` | VARCHAR(190) NOT NULL | Snapshot at submit time |
| `status` | ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending' | |
| `notes` | TEXT NULL | |
| `requested_at` | TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP | |
| `reviewed_at` | TIMESTAMP NULL | |
| `reviewed_by` | CHAR(36) FK → `users.id` NULL | |
| `created_at`, `updated_at` | TIMESTAMP | |

### `access_request_items`

| Column | Type | Notes |
|---|---|---|
| `id` | CHAR(36) PK | |
| `access_request_id` | CHAR(36) FK ON DELETE CASCADE | |
| `department_id` | CHAR(36) FK | |
| `template_id` | CHAR(36) FK | |
| `created_at` | TIMESTAMP | (no updates expected) |

**Indexes:** `UNIQUE(access_request_id, department_id, template_id)`.

---

## 2. Organization structure

### `report_templates`

| Column | Type | Notes |
|---|---|---|
| `id` | CHAR(36) PK | |
| `slug` | VARCHAR(64) UNIQUE NOT NULL | e.g. `inpatient_weekly`, `eeg_weekly`, `dialysis_weekly` |
| `family` | ENUM('inpatient','outpatient','procedure') NOT NULL | |
| `name` | VARCHAR(190) NOT NULL | Display name |
| `description` | TEXT NOT NULL | |
| `active_days` | JSON NOT NULL DEFAULT (JSON_ARRAY()) | Array of `monday`..`sunday` strings |
| `metadata` | JSON NOT NULL DEFAULT (JSON_OBJECT()) | e.g. `{ "ui_family": "inpatient", "supports_metrics": ["bor_percent","btr","alos"] }` |
| `active` | BOOLEAN NOT NULL DEFAULT TRUE | **NEW** — required by `POST /api/admin/report-templates/{id}/activate` (the current schema has no `active` flag on templates; today every template is implicitly active) |
| `created_at`, `updated_at` | TIMESTAMP | |

**Seed templates (9):** `inpatient_weekly`, `outpatient_weekly` (display name "ART"), `eeg_weekly`, `echocardiography_weekly`, `endoscopy_weekly`, `hematology_procedures_weekly`, `bronchoscopy_weekly`, `renal_procedures_weekly`, `dialysis_weekly`.

### `departments`

In the existing schema, "ward" and "department" are the same concept — every reporting unit is a row in `departments` with a `family` discriminator. The prompt asks about a separate `wards` table; the recommendation is to **keep one table** unless the user needs hierarchical (department → ward) data, which the current UI does not.

> **NEEDS CONFIRMATION** — should we keep one `departments` table or split into `departments` + `wards`? Current frontend treats them as one. **Recommended: keep one.**

| Column | Type | Notes |
|---|---|---|
| `id` | CHAR(36) PK | |
| `slug` | VARCHAR(64) UNIQUE NOT NULL | e.g. `gi_neuro_inpatient`, `eeg_lab`, `outpatient_main` |
| `family` | ENUM('inpatient','outpatient','procedure') NOT NULL | |
| `template_id` | CHAR(36) FK → `report_templates.id` NOT NULL | The form schema this dept uses |
| `name` | VARCHAR(190) NOT NULL | |
| `description` | TEXT NOT NULL | |
| `accent_color` | VARCHAR(16) NULL | Hex color |
| `bed_count` | INT NULL | Only relevant for `family='inpatient'` (drives BOR/BTR) |
| `active` | BOOLEAN NOT NULL DEFAULT TRUE | |
| `created_at`, `updated_at` | TIMESTAMP | |

**Indexes:** UNIQUE(slug), INDEX(family).

### `report_field_definitions`

| Column | Type | Notes |
|---|---|---|
| `id` | CHAR(36) PK | |
| `template_id` | CHAR(36) FK ON DELETE CASCADE | |
| `section_key` | VARCHAR(64) NOT NULL | e.g. `patient_flow`, `quality_safety`, `staffing` |
| `field_key` | VARCHAR(64) NOT NULL | e.g. `total_patient_days`, `discharged_home`, `senior_physician_availability` |
| `label` | VARCHAR(255) NOT NULL | Display label |
| `field_kind` | ENUM('integer','decimal','time','text','choice') NOT NULL | |
| `aggregate_type` | ENUM('sum','average','latest','none') NOT NULL DEFAULT 'sum' | |
| `display_order` | INT NOT NULL | |
| `metadata` | JSON NOT NULL DEFAULT (JSON_OBJECT()) | e.g. choice options |
| `created_at`, `updated_at` | TIMESTAMP | |

**Indexes:** `UNIQUE(template_id, field_key)`, INDEX(template_id, display_order).

**Field keys referenced in code (use as seeder source of truth):**
- Inpatient: `total_admitted_patients`, `new_admitted_patients`, `readmitted_30d`, `new_deaths`, `new_pressure_ulcer`, `total_pressure_ulcer`, `total_hai`, `hai_clabsi`, `hai_cauti`, `hai_pneumonia`, `hai_vap`, `hai_cdi`, `urinary_catheter`, `transferred_icu`, `transferred_hdu`, `transferred_ward`, `discharged_home`, `discharged_ama`, `free_beds`, `median_los_days`, `total_patient_days`, `mdt_round_start_day`, `mdt_round_start_duty`, `duty_resident`, `duty_senior_physician`, `nurse_in_charge`
- Outpatient (ART): `total_patients_seen`, `follow_up_patients`, `new_patients_seen`, `not_seen_same_day`, `wait_time_new_days`, `wait_time_followup_months`, `failed_to_come`, `not_seen_appointment`, `clinic_start_time`, `senior_physician_availability` (choice: `full_day`/`partial_day`/`unavailable`), `nurse_in_charge`
- Procedure-family keys: `eeg_done`, `ncs_done`, `emg_done`, `ep_done`, `echo_done`, `stress_echo`, `tee`, `ecg_done`, `stress_ecg`, `ambulatory_ecg`, `angiography_screening`, `valvotomy_screening`, `upper_gi_elective`, `upper_gi_emergency`, `ercp`, `colonoscopy`, `proctoscopy`, `bronchoscopy`, `therapeutic_upper_gi`, `esophageal_dilation`, `variceal_ligation`, `stenting`, `liver_biopsy`, `bone_marrow_biopsy`, `bronchoscopy_done`, `elective_renal_biopsy`, `central_venous_catheter_insertion`, `dialysis_acute`, `dialysis_chronic`, plus per-template `reporting_staff` and `nurse_in_charge` text fields and assorted `*_wait` decimal fields.

> **NEEDS CONFIRMATION** — the field `senior_physician_availability` is a `choice` field. The exact option values (`full_day`, `partial_day`, `unavailable`) come from `metadata` in the seed; confirm the exact strings before seeding (Phase 8 calls them "Full day / Partial day / Unavailable").

### `report_assignments`

| Column | Type | Notes |
|---|---|---|
| `id` | CHAR(36) PK | |
| `nurse_id` | CHAR(36) FK → `users.id` ON DELETE CASCADE | |
| `department_id` | CHAR(36) FK ON DELETE CASCADE | |
| `template_id` | CHAR(36) FK ON DELETE CASCADE | |
| `active` | BOOLEAN NOT NULL DEFAULT TRUE | |
| `approved_at` | TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP | |
| `approved_by` | CHAR(36) FK → `users.id` NULL | |
| `created_at`, `updated_at` | TIMESTAMP | |

**Indexes:** `UNIQUE(nurse_id, department_id, template_id)`, INDEX(nurse_id, active), INDEX(department_id).

Although the FK column is named `nurse_id`, an admin can also hold assignments. Keep the name for backward compatibility — but document that the column simply means "the user who owns this assignment slot".

---

## 3. Reporting periods

### `reporting_periods`

| Column | Type | Notes |
|---|---|---|
| `id` | CHAR(36) PK | |
| `week_start` | DATE UNIQUE NOT NULL | Always a Monday |
| `week_end` | DATE NOT NULL | Must equal `week_start + 6` (enforce in model) |
| `deadline_at` | TIMESTAMP NOT NULL | Computed per app settings; default `week_end + 1 day at 10:00 UTC` |
| `month_label` | VARCHAR(16) NOT NULL | e.g. `May 2026` |
| `quarter_label` | VARCHAR(8) NOT NULL | e.g. `Q2 2026` |
| `year_num` | SMALLINT NOT NULL | |
| `created_at` | TIMESTAMP | (no `updated_at` in current schema; keep that way) |

**Indexes:** `UNIQUE(week_start)`, INDEX(year_num, month_label).

Seeded ±26 weeks around the deployment date in Supabase; for Laravel use a console command `php artisan reports:ensure-periods` that runs daily (Laravel Scheduler) to keep the window rolling.

---

## 4. Report submissions

### `reports`

| Column | Type | Notes |
|---|---|---|
| `id` | CHAR(36) PK | |
| `assignment_id` | CHAR(36) FK ON DELETE CASCADE | |
| `department_id` | CHAR(36) FK ON DELETE CASCADE | Denormalized for filter speed |
| `template_id` | CHAR(36) FK ON DELETE CASCADE | Denormalized |
| `reporting_period_id` | CHAR(36) FK ON DELETE CASCADE | |
| `status` | ENUM('not_started','draft','submitted','edited_after_submission','locked','overdue') NOT NULL DEFAULT 'draft' | |
| `submitted_at` | TIMESTAMP NULL | First submit timestamp |
| `locked_at` | TIMESTAMP NULL | |
| `created_by` | CHAR(36) FK → `users.id` NOT NULL | |
| `updated_by` | CHAR(36) FK → `users.id` NOT NULL | |
| `created_at`, `updated_at` | TIMESTAMP | |

**Indexes:** `UNIQUE(assignment_id, reporting_period_id)`, INDEX(reporting_period_id, template_id), INDEX(status, locked_at, submitted_at), INDEX(department_id, reporting_period_id).

### `report_field_values`

| Column | Type | Notes |
|---|---|---|
| `id` | CHAR(36) PK | |
| `report_id` | CHAR(36) FK ON DELETE CASCADE | |
| `field_definition_id` | CHAR(36) FK ON DELETE CASCADE | |
| `day_name` | ENUM('monday','tuesday','wednesday','thursday','friday','saturday','sunday') NOT NULL | One row per (field × day) |
| `value_number` | DECIMAL(14,4) NULL | For integer / decimal fields |
| `value_text` | TEXT NULL | For text fields |
| `value_time` | TIME NULL | For time fields |
| `value_json` | JSON NULL | For choice (and future complex) fields |
| `created_at`, `updated_at` | TIMESTAMP | |

**Indexes:** `UNIQUE(report_id, field_definition_id, day_name)`, INDEX(report_id, field_definition_id).

**Invariant:** exactly one of `value_number`/`value_text`/`value_time`/`value_json` is non-null. Enforce in `ReportFieldValue` model + Form Request.

### `calculated_metrics`

| Column | Type | Notes |
|---|---|---|
| `id` | CHAR(36) PK | |
| `report_id` | CHAR(36) FK UNIQUE ON DELETE CASCADE | |
| `bor_percent` | DECIMAL(7,3) NULL | |
| `btr` | DECIMAL(7,3) NULL | |
| `alos` | DECIMAL(7,3) NULL | |
| `metric_payload` | JSON NOT NULL DEFAULT (JSON_OBJECT()) | Stores `total_patient_days`, `total_discharge`, and future derived values |
| `created_at`, `updated_at` | TIMESTAMP | |

Recomputed by `ReportCalculationService` on every save. Only populated for `family='inpatient'`; for other families, write an empty row (so we don't have to LEFT JOIN — or skip the row entirely, depending on Phase 8 preference). Keep parity with current Supabase RPC.

### `report_status_history`

| Column | Type | Notes |
|---|---|---|
| `id` | CHAR(36) PK | |
| `report_id` | CHAR(36) FK ON DELETE CASCADE | |
| `status` | ENUM(...) NOT NULL | Matches `reports.status` enum |
| `changed_by` | CHAR(36) FK → `users.id` NOT NULL | |
| `changed_by_name` | VARCHAR(190) NULL | Denormalized snapshot (defends against user renames) |
| `note` | TEXT NULL | |
| `changed_at` | TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP | |

**Indexes:** INDEX(report_id, changed_at DESC).

### `audit_logs` (per-cell edits to submitted reports)

| Column | Type | Notes |
|---|---|---|
| `id` | CHAR(36) PK | |
| `report_id` | CHAR(36) FK ON DELETE CASCADE | |
| `field_definition_id` | CHAR(36) FK NULL | NULL only if field was deleted before the audit was written |
| `field_key` | VARCHAR(64) NOT NULL | Snapshot |
| `day_name` | VARCHAR(16) NULL | NULL for non-per-day metadata changes |
| `old_value` | TEXT NULL | Stringified value |
| `new_value` | TEXT NULL | Stringified value |
| `changed_by` | CHAR(36) FK → `users.id` NOT NULL | |
| `changed_by_name` | VARCHAR(190) NULL | Denormalized snapshot |
| `changed_at` | TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP | |
| `department_id` | CHAR(36) FK NOT NULL | Denormalized for filtering |
| `template_id` | CHAR(36) FK NOT NULL | Denormalized for filtering |

**Indexes:** INDEX(report_id, changed_at DESC), INDEX(department_id, changed_at DESC), INDEX(template_id, changed_at DESC).

### `admin_audit_logs` (**NEW** — generic admin actions)

| Column | Type | Notes |
|---|---|---|
| `id` | CHAR(36) PK | |
| `user_id` | CHAR(36) FK → `users.id` NOT NULL | Who did it |
| `user_name` | VARCHAR(190) NULL | Denormalized snapshot |
| `action` | VARCHAR(64) NOT NULL | e.g. `user.activate`, `user.deactivate`, `assignment.upsert`, `settings.update`, `template.activate`, `access_request.approve` |
| `entity_type` | VARCHAR(64) NOT NULL | e.g. `User`, `Department`, `ReportTemplate`, `Setting` |
| `entity_id` | CHAR(36) NULL | |
| `old_values` | JSON NULL | |
| `new_values` | JSON NULL | |
| `ip_address` | VARCHAR(45) NULL | IPv4 or IPv6 |
| `user_agent` | VARCHAR(255) NULL | |
| `created_at` | TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP | |

**Indexes:** INDEX(user_id, created_at DESC), INDEX(entity_type, entity_id, created_at DESC).

The audit-log admin page should union the two tables (or expose them as separate tabs).

---

## 5. Notifications

### `notifications`

Mirrors current Supabase table. Not using Laravel's `notifications` table format (which is JSON-blob heavy) because the frontend already expects flat columns.

| Column | Type | Notes |
|---|---|---|
| `id` | CHAR(36) PK | |
| `recipient_id` | CHAR(36) FK → `users.id` ON DELETE CASCADE | |
| `type` | VARCHAR(64) NOT NULL | `new_report_submitted`, `submitted_report_edited`, `report_locked`, `report_unlocked`, `overdue_report`, `nurse_access_request`, `access_request_reviewed` |
| `title` | VARCHAR(190) NOT NULL | |
| `message` | TEXT NOT NULL | |
| `related_route` | VARCHAR(255) NULL | e.g. `/reports/{assignmentId}/{periodId}` |
| `related_entity` | VARCHAR(64) NULL | |
| `related_id` | CHAR(36) NULL | |
| `read_at` | TIMESTAMP NULL | |
| `created_at` | TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP | |

**Indexes:** INDEX(recipient_id, read_at, created_at DESC).

> **NEEDS CONFIRMATION** — should we add an `access_request_reviewed` value to a DB enum? The frontend declares it, the SQL enum did not. Using `VARCHAR(64)` here side-steps the problem. If the user prefers strict enums, list all 7 values.

### Optional: `overdue_report_sync_log` (**NEW**)

Useful for ops visibility: when did the scheduler run, how many notifications did it create.

| Column | Type | Notes |
|---|---|---|
| `id` | BIGINT PK AUTO_INCREMENT | |
| `ran_at` | TIMESTAMP NOT NULL | |
| `notifications_created` | INT NOT NULL DEFAULT 0 | |
| `periods_checked` | INT NOT NULL DEFAULT 0 | |
| `error` | TEXT NULL | |

(Not required — listed because it pays for itself the first time someone asks "is the cron running?".)

---

## 6. Settings

### `app_settings`

Stay key/value-of-JSON to match the current frontend shape.

| Column | Type | Notes |
|---|---|---|
| `setting_key` | VARCHAR(64) PK | |
| `value_json` | JSON NOT NULL | |
| `updated_by` | CHAR(36) FK → `users.id` NULL | |
| `updated_at` | TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP | |

**Known keys (must seed):**

| Key | Example value |
|---|---|
| `workflow_controls` | `{"deadline_enforced":true}` |
| `weekly_deadline` | `{"day":"monday","time":"10:00"}` |
| `locking_rules` | `{"auto_lock_hours_after_deadline":36}` |
| `insight_thresholds` | `{"rise_percent":10,"drop_percent":10}` |
| `critical_non_zero_fields` | `["new_deaths","new_pressure_ulcer","total_hai","hai_clabsi","hai_cauti","hai_vap"]` |

The `AppSettings` shape the frontend expects (`src/types/domain.ts`):

```ts
{ deadlineEnforced, weeklyDeadlineDay, weeklyDeadlineTime,
  autoLockHoursAfterDeadline, notableRiseThresholdPercent,
  notableDropThresholdPercent, criticalNonZeroFields }
```

The Laravel `SettingsController` flattens these 5 rows into the same JSON object on read, and explodes back into 5 rows on write (same shape as `update_app_settings` RPC's 7 parameters).

---

## 7. Personal-access tokens (Sanctum)

Laravel Sanctum adds its own table — included for completeness:

### `personal_access_tokens` (Laravel-default)

| Column | Type | Notes |
|---|---|---|
| `id` | BIGINT PK AUTO_INCREMENT | |
| `tokenable_type` | VARCHAR(255) NOT NULL | `App\Models\User` |
| `tokenable_id` | CHAR(36) NOT NULL | UUID of user |
| `name` | VARCHAR(190) NOT NULL | e.g. `spa-session` |
| `token` | CHAR(64) UNIQUE NOT NULL | Hashed |
| `abilities` | TEXT NULL | |
| `last_used_at` | TIMESTAMP NULL | |
| `expires_at` | TIMESTAMP NULL | |
| `created_at`, `updated_at` | TIMESTAMP | |

Use SPA mode (cookie + CSRF) if the React app and Laravel API share a parent domain; otherwise use bearer tokens with `expires_at` set.

> **NEEDS CONFIRMATION** — SPA cookie mode (more secure, simpler XSRF story, requires same parent domain) **OR** bearer token mode (works cross-domain, store token in memory/sessionStorage). The current Supabase setup uses bearer tokens stored in browser localStorage.

---

## 8. Reference data summary (for seeders)

| Seeder | Source | Notes |
|---|---|---|
| `RoleSeeder` | seed.sql:1–9 | 4 roles |
| `DepartmentSeeder` + `ReportTemplateSeeder` | seed.sql:11–140 | 9 templates, ~27 departments (8 inpatient, 12 outpatient, 7 procedure) |
| `ReportFieldDefinitionSeeder` | seed.sql:196–299 | All field keys/labels/kinds/aggregates with display_order |
| `AppSettingsSeeder` | seed.sql:142–174 | 5 settings keys |
| `ReportingPeriodSeeder` | seed.sql:176–194 | ±26 weeks; superseded by scheduled command in Laravel |
| `InitialHospitalSeeder` | — | Composes above + creates default superadmin (or leaves the slot empty for first-login claim) |

---

## 9. Decisions (confirmed 2026-05-25)

| # | Question | Decision |
|---|---|---|
| 1 | One `departments` table vs split `departments` + `wards`? | **One table** — matches current UI; `family` discriminator already serves the purpose |
| 2 | Roles | **Keep existing 4**: `superadmin`, `admin`, `doctor_admin`, `nurse` |
| 3 | Add `access_request_reviewed` to notification types? | **Yes** — store as `VARCHAR(64)` to allow future types without migrations |
| 4 | `calculated_metrics` for non-inpatient reports? | **Persist empty row** — preserves current behavior, avoids LEFT JOIN edge cases |
| 5 | Sanctum auth mode | **SPA cookie + CSRF** — HttpOnly session cookie. Requires shared parent domain between frontend and API in production (e.g. `app.stpaulos.com` + `api.stpaulos.com`), local dev uses `localhost` for both |
| 6 | MySQL or MariaDB | **MariaDB 10.6+** unless hosting pins MySQL 8 (then MySQL 8) — both support `JSON`, `lower()` functional indexes, and CHECK constraints we need |
| 7 | Soft deletes? | **No** — keep `active` flags |
| 8 | Add `admin_audit_logs` table? | **Yes** — separate from per-cell `audit_logs` |
| 9 | `senior_physician_availability` choice values | `full_day`, `partial_day`, `unavailable` |
| 10 | `reporting_periods` strategy | **Both** — seed ±4 weeks; `php artisan reports:ensure-periods` daily keeps the rolling window |
| 11 | Real-time replacement | **Laravel Reverb** — first-party WebSocket server. Best fit for "fast, reliable, scalable, powerful". Falls back to polling automatically if WS connection fails |
| 12 | One `audit_logs` table or split? | **Split** — `audit_logs` for per-cell report edits (unchanged), `admin_audit_logs` for admin actions. Audit-log admin page unions or tabs |

### Sanctum SPA cookie mode implications

- `config/sanctum.php` `stateful` array includes the frontend hostnames (production + staging + `localhost`).
- `SESSION_DOMAIN` set to `.stpaulos.com` (or equivalent) in production so the cookie is shared.
- Frontend axios/fetch client always sets `withCredentials: true` and POSTs to `/sanctum/csrf-cookie` once on app boot before any auth call.
- `VITE_API_BASE_URL` must point at the same parent domain as the frontend.
- For staging/local: the React dev server (`vite`) needs a proxy entry so `/api/*` and `/sanctum/*` route to the Laravel dev server; otherwise the cookie won't be set on the right domain.

### Reverb implications

- Adds `php artisan reverb:start` as a long-running process alongside the web worker.
- Frontend uses `laravel-echo` + `pusher-js` (Reverb is Pusher-protocol-compatible).
- Channels:
  - Private `admin-reports.{userId}` for admin-dashboard updates (broadcast on `ReportSaved`, `ReportLocked`, `ReportUnlocked` events).
  - Private `notifications.{userId}` for new notification push.
- Auth via Sanctum cookie (Reverb honors the same session).
- Polling fallback (existing visibility/focus refresh) stays as a safety net.

---

## 10. ERD-style relationship summary

```
roles (role_key) ──< users (role_key)
users ──< report_assignments >── departments ──> report_templates
                          \
                           └─> report_templates

users ──< access_requests ──< access_request_items >── departments
                                                  >── report_templates

reporting_periods ──< reports (assignment_id) ──> report_assignments
                              ──> departments
                              ──> report_templates
                              ──< report_field_values >── report_field_definitions
                              ──< calculated_metrics (1:1)
                              ──< report_status_history
                              ──< audit_logs

users ──< notifications
users ──< admin_audit_logs
app_settings (standalone)
```

---

## 11. Decision log to revisit before Phase 4

When the user signs off on this doc, the Phase 4 (`Laravel migrations`) work should:

1. Resolve every NEEDS CONFIRMATION row in section 9 (defaults are listed).
2. Generate migrations in this order: `users` → `roles` (or roles first, then users with FK), → `report_templates` → `departments` → `report_field_definitions` → `reporting_periods` → `report_assignments` → `access_requests` + `access_request_items` → `reports` → `report_field_values` → `calculated_metrics` → `report_status_history` → `audit_logs` → `admin_audit_logs` → `notifications` → `app_settings` → `personal_access_tokens` (sanctum default).
3. Generate seeders in this order: `RoleSeeder` → `ReportTemplateSeeder` → `DepartmentSeeder` → `ReportFieldDefinitionSeeder` → `AppSettingsSeeder` → `ReportingPeriodSeeder` → optional `InitialHospitalSeeder` orchestrator.
