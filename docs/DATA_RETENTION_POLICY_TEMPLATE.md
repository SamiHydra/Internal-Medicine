# Data retention policy template

The platform does not decide how long hospital data is kept. This document
lists every category of data the system holds, says which categories are
essential records and which are disposable by-products, states what the
software already does, and leaves the decisions to the department and
Hospital IT. Fill in the "Decision" column and the mechanisms below apply
them; nothing is deleted until a decision is written here and configured.

Status date: 2026-09-07. Related: `docs/decisions/data-retention-policy-question.md`
(the growth projection), `docs/OBSERVABILITY.md`, `docs/OPERATIONS.md`.

## 1. Essential long-lived data (never pruned automatically)

| Category | Tables | Why it is essential | Current behaviour | Decision needed |
|---|---|---|---|---|
| Weekly clinical reports and their cell values | `reports`, `report_field_values`, `calculated_metrics` | the clinical record of ward activity; feeds every dashboard and export | kept forever; locked reports are read-only | online retention period; archive/export format after that; who approves deletion |
| Report workflow history | `report_status_history` | who submitted, locked, unlocked, and when | kept forever (`reports.retention.status_history_days = 0`) | same as reports |
| Per-cell edit trail of submitted reports | `audit_logs` | shows every change to a submitted figure with before/after and actor | kept forever (`reports.retention.audit_log_days = 0`); append-only through the API | accreditation / legal retention period |
| Administrative action trail | `admin_audit_logs` | role changes, approvals, locks, settings, template and form changes, evidence, transfers, roster changes, password changes | kept forever (`reports.retention.admin_audit_log_days = 0`); append-only through the API; stores IP address and user agent | retention period; whether IP/user agent must be dropped earlier than the row |
| Academic evaluations and answers | `evaluations`, `evaluation_answers` (+ legacy `consultant_evaluations`, `resident_evaluations`) | training assessment records | kept forever; immutable after submission | retention period per the training programme's rules |
| Attendance and teaching records | `morning_sessions`, `morning_attendance`, `teaching_sessions`, `student_attendance`, `student_evaluations` | punctuality and teaching evidence | kept forever | retention period |
| Rosters, rotations, transfers, placements | `duty_assignments`, `rotation_*`, `transfer_requests`, `subgroup_placements` | who was where; needed to interpret evaluations | kept forever | retention period |
| User accounts | `users`, `report_assignments` | identity of every actor in the trails | never deleted through the UI; accounts are deactivated (`active = false`) so history keeps its author | how long a deactivated account stays; whether personal fields are anonymised after departure |
| Uploaded evidence files | `action_item_evidence` + `storage/app/private/...` | documentary evidence attached to action items | kept; deletable one file at a time by an administrator (audited); backed up nightly | retention period; whether files follow the action item's closure |
| Action items and comments | `action_items`, `action_item_comments`, `action_item_status_history`, `report_comments` | governance follow-up | kept forever | retention period |

## 2. Disposable generated data (safe to prune; mechanisms exist)

| Category | Where | Regenerable? | Mechanism | Default | Recommended default |
|---|---|---|---|---|---|
| Analytics export files | `storage/app/private/analytics-exports/<user>/<id>.(csv,xlsx)` and `analytics_exports` rows | yes, on demand | `app:prune-operational-data` deletes export files and rows older than `EXPORT_RETENTION_DAYS`; excluded from the storage backup | 30 days (this pass) | 30 days |
| Read notifications | `notifications` (`read_at` set) | no, but informational | `reports:prune-notifications` weekly, `NOTIFICATION_READ_RETENTION_DAYS` | 90 days | 90 days |
| Unread notifications | `notifications` | informational | never pruned | keep | decide a ceiling (for example 365 days) |
| Password reset tokens | `password_reset_tokens` | yes | expire after `auth.passwords.users.expire` minutes; expired rows are cleared on the next reset request; `auth:clear-resets` available | 60 minutes | as is |
| Sessions, cache, cache locks | `sessions`, `cache`, `cache_locks` | yes | `app:prune-operational-data` daily 01:20 removes expired rows | always on | as is |
| Real-user performance metrics | `performance_metrics` | yes | `PERFORMANCE_METRIC_RETENTION_DAYS` | 90 days | 90 days |
| Failed queue jobs | `failed_jobs` | yes | `queue:prune-failed --hours=720` daily | 30 days | 30 days |
| Job batches | `job_batches` | yes | `queue:prune-batches` daily | 7 days | as is |
| Temporary import files | `storage/app/private/imports/...` (report and student imports) | yes, the import is applied on upload | consumed immediately; nothing is kept beyond the request | none stored | as is |
| Application logs | `storage/logs/laravel.log`, `schedule.log`, worker and backup logs | no, but operational | `deploy/logrotate.conf` (daily, keep 30, compressed) | 30 days | 30 to 90 days per Hospital IT |
| Backups | `/var/backups/imreport`, secondary location | derived from the database | `backup.sh` keeps 30 days locally and off-box | 30 days | Hospital IT policy (consider a monthly long-term copy) |
| Workspace cache and offline queue | browser storage on each device | yes | 90-day cache expiry; the offline queue is cleared only when synced or discarded by the user | as is | as is |

## 3. What this pass changed

- `EXPORT_RETENTION_DAYS` (default 30): `app:prune-operational-data` now
  removes analytics export files and their rows once they are older than the
  window, because exports are regenerable and were the only unbounded
  generated data on disk (32 MB after one seeded year, growing with every
  export request). `0` disables it.
- No clinical, academic, audit or account data is pruned by default; the
  retention keys for the trails stay at `0` (disabled) until the policy
  below is decided.

## 4. Decisions required (fill in)

| # | Question | Decision | Approved by | Date |
|---|---|---|---|---|
| 1 | How long must submitted reports and their cell values remain online? | | | |
| 2 | How long must the per-cell edit trail and the administrative trail be kept? Is an export to a hospital archive acceptable after that? | | | |
| 3 | Must IP addresses and user agents in the administrative trail be removed earlier than the rows? | | | |
| 4 | How long are evaluations, attendance and teaching records kept, and who may read them after a trainee leaves? | | | |
| 5 | What happens to a deactivated account after N months (keep, anonymise name/e-mail, or keep as is)? | | | |
| 6 | Do evidence files follow the action item's retention, or a separate one? | | | |
| 7 | Is 30 days right for exports, failed jobs and backups? | | | |
| 8 | Who approves a deletion run, and what restore evidence is required first? | | | |

## 5. How a decision is applied

1. Record it in the table above and in the department's policy document.
2. Set the matching variable in `/opt/imreport/shared/backend.env`
   (`REPORT_AUDIT_LOG_RETENTION_DAYS`, `ADMIN_AUDIT_LOG_RETENTION_DAYS`,
   `REPORT_STATUS_HISTORY_RETENTION_DAYS`, `EXPORT_RETENTION_DAYS`,
   `NOTIFICATION_READ_RETENTION_DAYS`, `PERFORMANCE_METRIC_RETENTION_DAYS`),
   then `php artisan config:cache`.
3. Run `php artisan app:prune-operational-data --dry-run` and read the
   counts before letting the nightly run apply them.
4. Anything without a mechanism above (report data, evaluations, accounts,
   evidence) is a development task, not a configuration change; it must
   arrive with its own restore evidence and audit row.
