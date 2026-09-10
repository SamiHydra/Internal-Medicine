# 04. Database design

MariaDB 11.4 in production (utf8mb4), SQLite for local development and the
default test suite. Every domain table uses a UUID string primary key
(`HasUuids` on the model); only `roles` (`role_key`), `app_settings`
(`setting_key`) and the framework tables differ. The column-level reference
for the clinical core is in `docs/ARCHITECTURE.md` under "Data Model"; this
guide is the map and the rules.

## 1. Tables by domain (58)

| Domain | Tables |
|---|---|
| Identity and access | `roles`, `users`, `access_requests`, `access_request_items`, `admin_access_requests`, `password_reset_tokens`, `sessions`, `personal_access_tokens` (unused, no tokens are issued) |
| Reference data | `report_templates`, `report_field_definitions`, `departments`, `reporting_periods`, `app_settings` |
| Clinical reporting | `report_assignments`, `reports`, `report_field_values`, `calculated_metrics`, `report_status_history`, `audit_logs`, `report_comments` |
| Clinical governance | `clinical_alert_rules`, `action_items`, `action_item_comments`, `action_item_evidence`, `action_item_status_history` |
| Analytics and delivery | `analytics_exports`, `leadership_digest_deliveries`, `notifications`, `performance_metrics` |
| Academic structure | `wards`, `sections`, `duty_types`, `duty_assignments`, `rotation_calendars`, `rotation_blocks`, `transfer_requests` |
| Evaluations | `evaluation_forms`, `evaluation_form_fields`, `evaluations`, `evaluation_answers`, `consultant_evaluations` and `resident_evaluations` (legacy, copied into the unified tables) |
| Morning sessions | `morning_sessions`, `morning_attendance`, `morning_roster_overrides` |
| Undergraduate | `student_batches`, `students`, `subgroup_placements`, `teaching_activity_schedules`, `teaching_sessions`, `student_attendance`, `rep_assignments` |
| Platform | `admin_audit_logs`, `workspace_revisions`, `cache`, `cache_locks`, `jobs`, `job_batches`, `failed_jobs` |

## 2. The clinical core

```text
report_templates 1─* report_field_definitions      the field catalogue (schema half of the EAV)
report_templates 1─* departments                   one template per department; wards carry bed_count
reporting_periods                                  one row per ISO week, with deadline_at

users(nurse) 1─* report_assignments ─(nurse × department × template, unique)
report_assignments × reporting_periods ──▶ reports  (unique on assignment_id + reporting_period_id)
reports 1─* report_field_values                    (report, field_definition, day_name) unique; typed value columns
reports 1─1 calculated_metrics                     BOR, BTR, ALOS, payload
reports 1─* report_status_history                  append-only timeline
reports 1─* audit_logs                             per-cell edits after first submission
reports 1─* report_comments
reports 1─* action_items                           raised by clinical_alert_rules
```

Key columns on `reports`: `status` enum (`not_started`, `draft`, `submitted`,
`edited_after_submission`, `locked`, `overdue`; the workflow writes only the
middle four), `submitted_at` (written once, never cleared), `locked_at`
(non-null means read-only), `created_by`, `updated_by`, `updated_at` (the
revision clients echo back). `department_id` and `template_id` are
denormalised from the assignment so analytics and audit can filter without a
join.

### Why values are rows (EAV)

`report_field_values` holds one row per report, field definition and weekday,
with the value in one of `value_number` (decimal 14,4), `value_text`,
`value_time` or `value_json` according to the field kind. Administrators can
add, retire or relabel fields without a migration or deploy. The cost is that
every aggregate query is heavier than a column read, which the analytics
layer pays for with SQL aggregation, content-stamped caches, build locks and
background warming ([03-ARCHITECTURE](03-ARCHITECTURE.md)). Never load raw
value rows into PHP for a dashboard.

## 3. The academic core

```text
sections 1─* users(consultant, resident)  users.section_id, head_user_id on sections
wards    1─* duty_assignments             monthly placements by duty_type (no overlap per person, type, month)
rotation_calendars 1─* rotation_blocks    calendar-month or fixed-week blocks from starts_on
transfer_requests                         from_section, to_section, status, effective_on

evaluation_forms (key, version, status) 1─* evaluation_form_fields (field_key, type, core)
evaluations (form version, evaluator, subject, ward, date)  1─* evaluation_answers (field_key, typed value)

morning_sessions (date, snapshotted start) 1─* morning_attendance (snapshotted roster, present, on time)
morning_roster_overrides                  include or exclude a person on a date

student_batches 1─* students, subgroup_placements, teaching_activity_schedules, rep_assignments
teaching_sessions (batch, subgroup, activity_type, date, status) 1─* student_attendance
```

## 4. Invariants enforced by the database

| Invariant | Mechanism |
|---|---|
| One report per assignment and week | unique `(assignment_id, reporting_period_id)` plus a row lock in the service |
| One value per report, field and day | unique `(report_id, field_definition_id, day_name)` |
| One field key per template | unique `(template_id, field_key)` |
| One assignment per nurse, department, template | unique triple; re-creating a retired one re-activates the same row |
| One published version per evaluation form key | `enforce_evaluation_form_active_status_uniqueness` |
| Evaluation header consistency and one submission per evaluator, subject, form and date | `enforce_evaluation_header_invariants`, `enforce_evaluation_submission_uniqueness` |
| Core scoring fields present | `mark_score_item_fields_core`, `restore_evaluation_core_field_contract` |
| One active representative assignment per scope | `enforce_rep_assignment_uniqueness` |
| Enum values on SQLite behave like MariaDB | `restore_sqlite_enum_check_constraints` (a status outside the enum is refused on both engines) |
| Login identifiers unique regardless of case | `normalize_user_login_identifiers` (throws if two users differ only by e-mail case) |
| Authors never disappear | `created_by`, `updated_by`, `changed_by`, `user_id` on audit rows are RESTRICT; the application deactivates instead of deleting |
| Every domain write bumps the revision ledger | triggers on all domain tables into `workspace_revisions` |

Cascades: deleting a report removes its values, history, audit rows, comments
and metric; deleting an assignment, department, template, period or nurse
cascades to dependent reports. Reviewer and approver columns null out.

## 5. Indexes that matter

- `reports (status, locked_at, submitted_at)`, `(reporting_period_id, template_id)`, `(department_id, reporting_period_id)`, `(assignment_id, updated_at)`: boards, analytics and the report-list sort.
- `report_field_values (report_id, field_definition_id, day_name)` unique; the redundant `(report_id, field_definition_id)` prefix index was removed on this highest-volume table.
- `audit_logs` and `admin_audit_logs` by report, department, template, actor and time, plus the retention indexes on `changed_at` and `created_at`.
- `notifications (recipient_id, read_at, created_at)` and `(type, recipient_id)`.
- Academic read indexes on evaluations, and a covering index on `student_attendance (student_id, present)`.

The parity stack's MariaDB runs with the slow-query log and
`log_queries_not_using_indexes` on; use it when adding a query.

## 6. Retention and growth

Nothing clinical, academic or audit-related is pruned unless the matching
`*_RETENTION_DAYS` is set above 0. Generated data has defaults: read
notifications 90 days, export files and rows 30 days, performance samples 90
days, failed jobs 30 days, expired sessions and cache rows daily. Growth
estimates (about 174,000 rows a year across fact tables) and the questions the
department must answer are in `docs/DATA_RETENTION_POLICY_TEMPLATE.md` and
`docs/decisions/data-retention-policy-question.md`.

## 7. Migration rules

1. **Forward-only.** `down()` methods are best effort; recovery is by
   restoring the pre-migration dump `deploy.sh` takes and verifies.
2. **Backward compatible with the previous release**, so a rolled-back code
   release still runs against the migrated schema.
3. **Naming.** New files must sort after `2026_10_04_000010_...`;
   `MigrationNamingTest` enforces it and no existing file is renamed.
4. **Identifiers at most 64 characters** (MariaDB's limit; SQLite would
   silently accept longer). Name long unique indexes explicitly.
   `V2OperationalConfigurationTest` walks every table, index and foreign key
   on both lanes.
5. **MariaDB has no transactional DDL.** A migration that fails part-way
   leaves tables behind; on the parity stack recover with
   `docker compose down -v`, in production with the dump.
6. **Reference data is seeded by command**, not by migration:
   `php artisan app:seed-reference-data` is idempotent and never installs
   development accounts. `Dev*Seeder` classes refuse to run in production.
7. **Test on both lanes**: `php artisan test` (SQLite) and
   `docker compose --profile test run --build --rm test` (MariaDB).

## 8. Inspecting the database

```bash
cd backend
php artisan migrate:status
php artisan db:show                      # driver, size, table list
php artisan db:table reports             # columns, indexes, foreign keys
```

On the parity stack: `docker compose exec db mariadb -uimreport -plocal-parity-stack imreport`.
On the server the dump-only account in `/etc/mysql/imreport-backup.cnf` is
for backups; use the application account from `backend.env` for read queries,
and never run DDL by hand.
