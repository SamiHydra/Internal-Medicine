# DATABASE_REVIEW.md

St Paul IM reporting and academic platform. Database structural review, produced in the reporting phase
of the 2026-07-21 full-system audit.

**Evidence basis.** This document is a synthesis of already-collected evidence, not a fresh audit. Its
primary source is the schema inventory `artifacts/audit-2026-07-21/discovery/01-database-schema.md`, which
was read read-only from the live dev SQLite database via `PRAGMA` (`table_info`, `table_xinfo`,
`foreign_key_list`, `index_list`, `index_info`) with the connection opened `PRAGMA query_only = 1`. Confirmed
defects and their verification status come from `AUDIT_FINDINGS.md`; the MariaDB behaviour and fixes come from
`artifacts/audit-2026-07-21/evidence/mariadb-failure-triage.md`, `mariadb-suite-full.txt`,
`mariadb-suite-postfix.txt`, and the migration source under `backend/database/migrations/`. Every claim below
cites its evidence.

**Reading conventions used throughout.**
- **VERIFIED** means executed or reproduced against a running system (named lane and command cited).
- **PREDICTED / UNVERIFIED** means reasoned from schema or query analysis, never measured.
- **Cleared / refuted** means a candidate defect was checked and did not hold; it is reported so later readers
  do not re-chase it, not as a defect.

---

## 1. Headline inventory

| Fact | Value | Source |
|---|---|---|
| Migration files on disk (at discovery) | 61 | `01-database-schema.md:62`; now 64 after the remediation migrations |
| Tables in the dev DB (excl. `sqlite_*`) | 53 | `01-database-schema.md:64` |
| DB-level triggers | 2 (now 6 on SQLite after enum-guard restore) | `01-database-schema.md:65,1463-1472`; migration `2026_09_16_000030` |
| Views | 0 | `01-database-schema.md:66` |
| Virtual generated columns | 3 (now 4 after the evaluation uniqueness key) | `01-database-schema.md:1477-1484`; migration `2026_09_16_000020:29-31` |
| Total rows across all tables (dev DB) | 80,025 | `01-database-schema.md:67` |
| Dev driver | SQLite, WAL / synchronous NORMAL | `01-database-schema.md:69,72` |
| Intended production driver | MySQL / MariaDB (parity lane runs MariaDB 11.4) | `01-database-schema.md:74`; `mariadb-failure-triage.md:3` |
| Empty tables in the dev DB | 20 of 53 | `01-database-schema.md:91,104-109` |

**Where the data actually is.** Real volume exists in only four tables: `report_field_values` 61,001,
`evaluation_answers` 8,804, `morning_attendance` 6,440, `student_attendance` 900
(`01-database-schema.md:79-102`). Every conclusion in this review that concerns behaviour at volume is bounded
by that fact and by the 20 empty tables (section 10).

---

## 2. Keys, foreign keys, unique constraints, nullability

### 2.1 Primary keys

- **Application tables use string UUID primary keys** (`id varchar`, backed by
  `sqlite_autoindex_*_1 UNIQUE`). This is uniform across every domain table
  (`01-database-schema.md`, per-table sections).
- **Laravel-owned infrastructure tables use INTEGER rowid PKs** where the framework ships them that way:
  `failed_jobs`, `jobs`, `personal_access_tokens`, `migrations` (`01-database-schema.md:616,658,825,699`).
- **Natural-key PKs** exist where they are the identity: `app_settings.setting_key`, `roles.role_key`,
  `password_reset_tokens.email`, `cache.key`, `cache_locks.key`
  (`01-database-schema.md:269,1133,810,319,333`).

### 2.2 Foreign keys and ON DELETE behaviour

The resolved (not inferred) `ON DELETE` behaviour was read from `pragma foreign_key_list`. The distribution is
deliberate and worth stating because it governs whether a delete cascades, nulls, or is refused
(`01-database-schema.md:119-121`):

- **CASCADE** on owned child rows: `evaluation_answers -> evaluations`, `report_field_values -> reports`,
  `access_request_items -> access_requests/departments/report_templates`, `report_comments -> reports`,
  `rotation_blocks -> rotation_calendars`, etc. (`01-database-schema.md:509-510,968-970,135-138`).
- **SET NULL** on optional references and actor columns: `*.reviewed_by`, `*.approved_by`, `*.recorded_by`,
  `sections.head_user_id`, `users.section_id`, `users.home_ward_id`
  (`01-database-schema.md:162,275,771,1205,1430-1432`).
- **RESTRICT** on records that must not orphan: `duty_assignments -> users/duty_types`,
  `morning_attendance.user_id -> users`, `student_attendance -> students/users`, both legacy evaluation tables
  to `users`/`departments` (`01-database-schema.md:457-459,721,1246-1247,398-400`). Consequence: the legacy
  `consultant_evaluations` and `resident_evaluations`, though 0-row, still block deletion of any referenced
  user or department (`01-database-schema.md:1665-1668`).
- **NO ACTION** (Laravel's default for `constrained()` without an `onDelete`), which under both SQLite and
  MySQL refuses the delete while a child exists: `reports.created_by / updated_by`,
  `report_status_history.changed_by`, `admin_audit_logs.user_id`, `audit_logs.*`, `users.role_key`
  (`01-database-schema.md:121,1064-1065,992,256,299-302,1431`).

`users` is never hard-deleted in the product: `DELETE /api/users/{user}` resolves to
`UserController::destroy`, which only sets `active = false`; there is no `SoftDeletes` trait and no
`->delete()` on `User` anywhere in `app/` (VERIFIED by grep in `mariadb-failure-triage.md:286-290`). The
RESTRICT / NO-ACTION FKs onto `users` are therefore latent, not exercised by a real workflow.

### 2.3 Unique constraints

Scoped uniqueness is used correctly and widely (a representative, not exhaustive, list):
`report_field_values (report_id, field_definition_id, day_name)`,
`report_assignments (nurse_id, department_id, template_id)`,
`reports (assignment_id, reporting_period_id)`,
`evaluation_answers (evaluation_id, field_key)`,
`evaluation_form_fields (form_id, key)`,
`report_field_definitions (template_id, field_key)`,
`calculated_metrics (report_id)`, `morning_sessions (session_date)`,
`student_attendance (teaching_session_id, student_id)`
(`01-database-schema.md:974,898,1077,513,541,948,364,774,1251`).

**Partial-uniqueness via virtual generated columns + a NULL-tolerant unique index** is used in three places and
is a sound technique on both SQLite and MariaDB (`01-database-schema.md:1477-1491`):

| Table | Generated column | Enforces |
|---|---|---|
| `evaluation_forms` | `active_status` | one active (draft/published) row per `key` |
| `rep_assignments` | `active_scope_key` | one active rep per (batch, scope) |
| `rep_assignments` | `active_user_key` | one active assignment per user |

### 2.4 Nullability and audit-field conventions

- **Append-only tables use `useCurrent()` rather than `timestamps()`** on purpose:
  `admin_audit_logs.created_at`, `audit_logs.changed_at`, `notifications.created_at`,
  `report_status_history.changed_at`, `reporting_periods.created_at`, and the request tables
  (`01-database-schema.md:1655-1658`). Noted so it is not misread as a missing-timestamp bug.
- **`app_settings` has no `created_at`** and a bare `updated_at` (`01-database-schema.md:1652-1654`). Any
  Eloquent model over it needs `$timestamps = false`. Model-layer behaviour is **UNVERIFIED** (out of scope
  for a schema inventory).
- **`users.username` is UNIQUE and nullable**, so "no username" is representable many times on both engines;
  username is not a reliable identifier (`01-database-schema.md:1646-1648`).
- **`morning_sessions.started_on_time` is a tri-state nullable boolean** (on time / late / not yet recorded),
  a classic `if (!$x)` hazard flagged for the behaviour agents, not the schema (`01-database-schema.md:1674`).

---

## 3. The central theme: dev-vs-prod divergence (SQLite permissive, MariaDB strict)

This is the single most important structural finding of the database review, and it is the class of defect
that produced both deployment blockers. **The dev lane runs SQLite, which is permissive; production runs
MariaDB, which is strict.** Code authored and tested only against SQLite passes locally and then fails on the
engine the hospital LAN actually runs. The audit's entire MariaDB parity lane exists to surface exactly this
class (`AUDIT_FINDINGS.md:19-30`).

The measured proof is the same-commit suite comparison, before any fix:

| Lane | Result | Source |
|---|---|---|
| SQLite (dev + CI default) | 281 tests, 280 passed, 1 skipped, **0 failures** | `AUDIT_FINDINGS.md:25`; `mariadb-failure-triage.md:5` |
| MariaDB (production engine) | 281 tests, **7 failures, 3 errors** | `AUDIT_FINDINGS.md:26`; `mariadb-suite-full.txt` |

The divergence shows up in five concrete ways.

### 3.1 Index-name length (VERIFIED defect, now fixed) - AUD-DB-001

SQLite has no identifier-length limit; MariaDB caps identifiers at 64 characters. Laravel's auto-generated
unique-index name on `teaching_sessions` resolved to **71 characters**
(`teaching_sessions_batch_id_subgroup_activity_type_scheduled_date_unique`), over by 7. `php artisan migrate
--force`, the exact command `deploy/deploy.sh` runs, aborted with `SQLSTATE[42000]: 1059 Identifier name ...
is too long` (`AUDIT_FINDINGS.md:68-71`). This was the **only** occurrence in the repo. See section 5.

### 3.2 Native `uuid` columns (VERIFIED defect, now fixed) - AUD-API-002

`$table->uuid('entity_id')` maps to MariaDB 11.4's **native `uuid` type** (BINARY(16), value-validating) but to
plain `varchar` on SQLite. `admin_audit_logs.entity_id` is used by the product as an opaque free-form key: the
duty roster writes a period string such as `'2026-07'` into it, and the read side documents that contract
(`AuditLogController.php:74-75`, validation `string|max:64`). SQLite accepts the string; MariaDB rejects it with
`ERROR 1292 Incorrect uuid value: '2026-07'`, reproduced directly against the parity database
(`mariadb-failure-triage.md:40-70`). See section 5.

### 3.3 Enum handling (checked; the production risk did NOT hold) - refutes C-DB-011

`->enum(...)` becomes a **native, value-rejecting `ENUM`** on MySQL/MariaDB. On MariaDB the 29 enum columns are
therefore validated by the engine and reject out-of-range writes. The candidate C-DB-011 framed this as "29
unvalidated enum columns" of the same class as the deployment blocker (`AUDIT_FINDINGS.md:301`); **that framing
does not hold on the production engine** - the enums are enforced there.

The residual risk is SQLite-only and narrower than stated. Two enum columns lost their SQLite-side CHECK when a
later `constrained()` foreign key forced a full table rebuild that did not re-emit the CHECK:
`departments.family` (rebuilt by the `ward_id` migration) and `admin_access_requests.status` (rebuilt by the
`home_ward_id` migration). Migration `2026_09_16_000030_restore_sqlite_enum_check_constraints.php` restores
enforcement for exactly those two columns via BEFORE INSERT/UPDATE triggers on SQLite, and is a deliberate no-op
on MariaDB where the native enum already rejects the write (`2026_09_16_000030:22-63`).

**Evidence correction (a discrepancy in the source, resolved here).** The discovery inventory states that
SQLite emits enum columns as "plain `varchar` with **no CHECK constraint** - confirmed: live `pragma
table_info` shows `varchar` for every one" (`01-database-schema.md:1642`). A direct read of the live SQLite
`CREATE TABLE` SQL (`sqlite_master.sql`) contradicts that: `reports` carries 1 CHECK and `teaching_sessions`
carries 3, while `departments` and `admin_access_requests` carry 0. In other words the CHECK constraints **do**
exist for enum columns; they live in the table's SQL, not in the column type that `pragma table_info` returns
(which is `varchar` regardless). The two columns without a CHECK are precisely the two the remediation migration
targets. The migration's premise is correct and the inventory's blanket "no CHECK" claim is a pragma-reading
artifact. This was a spot check of four tables, not a full re-derivation of all 29 enum sites, but it is
sufficient to establish that the "unvalidated on SQLite too" reading is wrong for the general case.

### 3.4 A `NOT NULL` generated column (flagged, effectively cleared) - UNVERIFIED then bounded

`evaluation_forms.active_status` is a generated column declared `NOT NULL` whose expression yields `NULL` for
archived rows; MySQL would in principle reject that where SQLite tolerates it silently
(`01-database-schema.md:1489-1492`). This was flagged UNVERIFIED against a real MySQL/MariaDB instance at
discovery time. It is now bounded by evidence rather than closed by test: the parity lane ran all 61 migrations
from an empty MariaDB from scratch (72 migration/seeder steps, all services healthy -
`AUDIT_FINDINGS.md:50-56`), so this migration applies on MariaDB without aborting. No standalone assertion
targets the archived-row path, so treat it as "did not block a full migrate on MariaDB," not as "proven correct
for every archived-row transition."

### 3.5 No transactional DDL on MariaDB (compounding factor)

MariaDB has no transactional DDL, so a half-applied migration masks itself behind `1050 Table already exists`
on retry, making the true cause of a failed deploy hard to find in the field (`AUDIT_FINDINGS.md:73-75`). This
is what turned AUD-DB-001 from a one-line bug into a genuine deployment hazard.

### 3.6 Postgres is simultaneously supported and forbidden (observation)

`config/database.php:46` names Postgres as a production option, but
`2026_08_30_000020_enforce_evaluation_header_invariants.php:46` throws `RuntimeException` on any driver that is
not sqlite/mysql/mariadb, so a Postgres deployment cannot migrate (`01-database-schema.md:1473-1475,1639`).
A real conflict between two files. Not a defect on the actual target (MariaDB), recorded so the "Postgres is
fine" statement in config is not trusted.

---

## 4. Triggers and generated columns (non-obvious surface)

Two BEFORE INSERT/UPDATE triggers on `evaluations` enforce the "exactly one subject and exactly one evaluator
source" invariant, created by `2026_08_30_000020_enforce_evaluation_header_invariants.php` with a SQLite variant
(`:74-84`) and a MySQL variant (`:95-107`) (`01-database-schema.md:1463-1472`). The remediation added two more
enum-guard triggers on SQLite (section 3.3). Three virtual generated columns back the partial-uniqueness indexes
(section 2.3); a fourth, `evaluations.subject_ref`, was added by the remediation to key the new uniqueness
constraint (section 6). Generated columns are invisible to `pragma table_info` and only appear in `table_xinfo`
(`01-database-schema.md:1477-1479`), so tooling that introspects `table_info` will not see them.

---

## 5. VERIFIED defects that broke MariaDB, now fixed

These are separated from every observation in this document because they were **reproduced against a running
system and then re-verified after the fix**. They are the only database items in this review carrying that
status.

| ID | Severity | Defect | Fix | Verification |
|---|---|---|---|---|
| **AUD-DB-001** | Critical (deployment blocker) | 71-char auto-generated unique-index name on `teaching_sessions` exceeds MariaDB's 64-char limit; `migrate --force` aborts, so the department server cannot be deployed to | Explicit index name `teaching_sessions_slot_unique` (29 chars) at `2026_08_12_000010_create_undergraduate_tables.php:96/99` | Reproduced by destroying the container DB and rebuilding from empty: `docker compose ... up -d --wait` exit 0, 72 migration/seeder steps, index confirmed in MariaDB's catalogue; SQLite suite unchanged (`AUDIT_FINDINGS.md:45-57`) |
| **AUD-API-002** | Critical (100% failure of a core admin workflow) | Duty-roster month save returns HTTP 500 on MariaDB because `admin_audit_logs.entity_id` is a native `uuid` but the product writes a period string `'2026-07'` into it | Migration `2026_09_16_000010_relax_admin_audit_log_entity_id.php` widens `entity_id` to `string(64) nullable`; the `(entity_type, entity_id, created_at)` index rebuilds in place | Executed end to end through nginx on the MariaDB stack: csrf 204 -> login 200 -> `PUT /api/admin/roster/2028/3` -> **HTTP 200** (was 500), and `admin_audit_logs` rows for `entity_type='duty_roster'` went 5 -> 6 (`AUDIT_FINDINGS.md:210-213`) |
| **AUD-API-002b** | Critical (secondary) | `saveMonth` had no wrapping transaction, so the roster rows committed while only the trailing audit INSERT threw; the admin saw a 500 but the save had landed | `saveMonth` wrapped in a single `DB::transaction` | Same run; the roster save is now all-or-nothing (`AUDIT_FINDINGS.md:206-208`; root cause `mariadb-failure-triage.md:81-90`) |

**Why AUD-API-002 is a database finding, not just a controller bug.** The correct fix is a schema change (widen
the column to match the documented free-form contract), explicitly *not* a controller patch that would emit a
UUID and break the `entity_id=2026-07` filter contract at `AuditLogController.php:74-75`
(`mariadb-failure-triage.md:93-108`).

**Post-fix suite state (VERIFIED).** After remediation, both lanes are green: SQLite 313 passed / 1 skipped, and
MariaDB **314 tests, 2188 assertions, 0 failures** (`mariadb-suite-postfix.txt` final line; `AUDIT_FINDINGS.md`
comparison was 7 failures / 3 errors before). The audit's remediation commit `43bbccc` records 16 findings
fixed and 32 regression tests added across the two lanes.

Two adjacent deployment blockers were dependency/runtime rather than schema, and are covered fully in
`AUDIT_FINDINGS.md`: **AUD-DEPLOY-007** (`composer.lock` required PHP 8.4, server runs 8.3; fixed by pinning
`config.platform.php` to 8.3.0 and re-resolving, VERIFIED on a real 8.3.32 runtime -
`AUDIT_FINDINGS.md:124-172`) and **AUD-INFRA-003** (CI could not install dependencies, superseded by -007).

---

## 6. Data-integrity constraint added: uniqueness on `evaluations` (C-DB-012 confirmed, then fixed)

At discovery, `evaluations` had **zero unique constraints** of any kind - six plain indexes and no uniqueness
(`01-database-schema.md:601-608,1593`). The live dev DB **already contained 4 duplicate groups** (2
`consultant_mdt`, 2 `resident_acgme`) where the same author evaluated the same subject on the same date on the
same form twice (`01-database-schema.md:1593`). Because every analytics aggregate is a per-row mean, each repeat
re-weights the subject's score by a full extra vote (`2026_09_16_000020:13-16`).

The remediation added the missing key. Migration
`2026_09_16_000020_enforce_evaluation_submission_uniqueness.php`:

- Adds a virtual generated discriminator `subject_ref = coalesce(subject_user_id, subject_student_id)` so the
  key works across the two nullable subject columns without NULL defeating the unique index (`:29-31`).
- Adds `UNIQUE (author_id, subject_ref, evaluation_date, form_key)` named
  `evaluations_author_subject_date_form_unique` (`:33-36`). External entries (`author_id NULL`) stay outside
  the key by design (`:18-22`).
- Collapses the pre-existing duplicate groups before adding the key, keeping the earliest submission of each
  group and **archiving the deleted rows and their answers to a JSON file under `storage/app` first**, with a
  console/log announcement, because these are clinical records that `down()` cannot restore (`:48-118`).

This is the one genuinely missing structural constraint that the review both identified and closed. It was
listed at discovery as "the product does not say whether the duplicates are legitimate double-rounds or a
double-submit bug"; the fix resolves that in favour of one-per-day-per-form, with an auditable archive of what
it removed.

---

## 7. Foreign-key / index coverage, and the "44 unindexed FKs" correction

### 7.1 The true state on the production engine

Discovery reported **44 foreign keys with no supporting index** (`01-database-schema.md:1510-1562`, an exact
list). It is essential to read that list correctly:

> "On MySQL/InnoDB an index is auto-created for every FK, so this list is specific to the SQLite deployment"
> (`01-database-schema.md:1512-1516`).

**On MariaDB, the production engine, InnoDB auto-creates a backing index for every foreign key.** The "44
unindexed FKs" therefore **does not hold as a production defect** - it is an artifact of the SQLite dev lane,
which does not auto-index FKs. Reported here as checked-and-cleared for production, consistent with the audit's
broader pattern of refuting schema candidates that only look like defects on SQLite.

### 7.2 What genuinely remains, as a query-plan observation (not a MariaDB FK-index gap)

One item on that list is a real read-path consideration independent of FK-index auto-creation:
`report_field_values.field_definition_id` (61,001 rows, the largest table). It was indexed at creation as part
of `(report_id, field_definition_id)` and that index was **deliberately dropped** by
`2026_05_29_000000_add_performance_indexes.php:41` as "a strict prefix of the unique index." That reasoning is
correct for lookups by report, but it leaves no index leading with `field_definition_id`, so a "all values for
field X across all reports" aggregation or a field-definition DELETE is a full-table scan on both engines
(`01-database-schema.md:1566-1572`). This is a design tradeoff (write-amplification avoided in exchange for a
rare aggregation cost), not a defect, and it belongs to the scalability analysis, not to the fixed-defect list.

A secondary asymmetry: `student_attendance.student_id` has no index while the analogous
`morning_attendance.user_id` does carry a deliberate one (`01-database-schema.md:1573-1577`). It reads as an
oversight rather than a decision, but at 900 rows it is not a current problem and was not fixed.

### 7.3 Tables with no index beyond the primary key

Five tables have no secondary index: `roles` (6 rows), `app_settings` (8), `migrations` (61),
`password_reset_tokens` (0), `job_batches` (0). All are lookup or framework tables accessed by key or
full-scanned by design. **No application table is missing an index it plausibly needs**
(`01-database-schema.md:1498-1508`).

### 7.4 Unique constraints that are arguably missing (observations, not fixed)

Beyond the `evaluations` key that was added (section 6), discovery flagged several columns that look like they
want a unique constraint and lack one (`01-database-schema.md:1589-1600`). These were **not** remediated and are
recorded as observations:

- `admin_access_requests.email` / `.username` - not unique even scoped to `status='pending'`; two pending
  signups for the same email collide only at the second approval, late. **IN-FLUX at discovery** (the review
  service was being changed).
- `students.external_id` - nullable, no unique; duplicates would silently split a student's attendance history.
- `notifications.related_entity` - used as a dedup key (`reminder:{tier}:{assignmentUuid}:{periodUuid}`) but has
  no unique index; dedup is application-code only, and the widening migration itself warns that silent
  truncation "silently breaks dedup."
- `sections.head_user_id` - no unique; one user can head multiple sections, which changes who can approve a
  transfer. **UNVERIFIED intent.**

---

## 8. Retention and unbounded growth

Retention is essentially unmanaged, and this is the core input to the scalability review. **13 tables grow
without bound** (C-DB-013, `AUDIT_FINDINGS.md:303`; per-table breakdown `01-database-schema.md:1602-1624`).

The only application retention job is `reports:prune-notifications` (weekly), and it deletes **only read
notifications older than 90 days** - unread notifications are never pruned
(`PruneStaleNotifications.php:22-28`; `01-database-schema.md:1616`). Beyond that:

| Table | Grows with | Pruned? |
|---|---|---|
| `report_field_values` (61,001) | every report cell x 7 weekdays | **No** |
| `evaluation_answers` (8,804) | every evaluation x ~12 fields | **No** |
| `morning_attendance` (6,440) | roster size x one session per weekday | **No** |
| `student_attendance` (900) | batch size x sessions per week | **No** |
| `audit_logs` (0, unexercised) | one row per edited report cell; its own migration calls it the fastest-growing table in the system | **No - highest-risk unbounded table** |
| `admin_audit_logs` (17) | one row per admin mutation, with full old/new JSON | **No** |
| `report_status_history` (0) | one row per status transition | **No** |
| `notifications` (0) | one row per event per recipient | **Read-only, partial** |
| `sessions` / `cache` / `cache_locks` | browser sessions / cache keys | GC/lazy only, no scheduled sweep |
| `personal_access_tokens` (0) | Sanctum tokens | **No** - `sanctum:prune-expired` is not scheduled |
| `leadership_digest_deliveries` (0) | 1 row per (period x recipient) per week | **No** |
| `duty_assignments` (523) / `evaluations` (732) | 1 row per placement / evaluation | **No** |

`failed_jobs` is pruned (`queue:prune-failed --hours=720` daily) and `jobs` self-drains
(`01-database-schema.md:1619`). No retention job was added by the remediation; retention is deferred to the
scalability deliverable. Growth projections there are **PREDICTED** from seeded rates, not measured, and cannot
be stated at all for the empty audit/notification paths (section 10).

---

## 9. Other schema observations (real, not deployment blockers, mostly not fixed)

These are recorded from discovery section 4.5/4.6 with their severities as assessed there. None was reproduced
against a running system except where noted; they are observations, not VERIFIED defects.

- **Migration rollback produces a third state (Medium).** `2026_08_30_000040`'s `up()` marks four evaluation
  fields `is_core`, but its `down()` (`:28-36`) marks a different, larger set (`CONSULTANT_SCORE_ITEMS` /
  `RESIDENT_SCORE_ITEMS`), so a rollback silently locks extra fields from editing rather than restoring the
  prior state (`01-database-schema.md:1637-1638`). Also `2026_08_26_000010` is now dead weight because
  `2026_08_30_000040` re-sets the same values it set (`01-database-schema.md:1637`).
- **Two parallel "ward" vocabularies (Medium).** `users.home_ward_id` and the newer
  `admin_access_requests.home_ward_id` point at `departments`, while everything from Phase 3 onward
  (`evaluations.ward_id`, `teaching_sessions.ward_id`, `subgroup_placements.ward_id`, `duty_types.ward_id`,
  the legacy `*.ward_ref_id`) points at `wards`. `departments.ward_id -> wards` is the only bridge and it is
  nullable, so outpatient/procedure departments have no ward at all. This mapping is where academic and clinical
  analytics can silently diverge (`01-database-schema.md:1641`). **IN-FLUX at discovery** on the
  `admin_access_requests` side.
- **No date-ordering or uniqueness on `duty_assignments` (Low).** Overlap is enforced only in `RosterService`
  inside a write transaction, not by the DB; the seeded dev DB already contains a row with
  `starts_on = ends_on = '2320-02-12'`, and any `where starts_on <= :date and ends_on >= :date` query matches it
  for the next three centuries (`01-database-schema.md:1598,1670-1673`).
- **`report_comments.parent_id` self-references with ON DELETE CASCADE but nothing enforces depth <= 1 (Low)**
  despite the migration comment intending one level of replies (`01-database-schema.md:1659-1661`).
- **Shared SQLite file on the dev lane only (Informational).** `sessions`, `cache`, `cache_locks`, `jobs`,
  `job_batches`, `failed_jobs` live in the same SQLite file as clinical data, so every session/cache write
  serialises against report submission; WAL fixes reader/writer but not writer/writer contention
  (`01-database-schema.md:1626-1630`). **Does not apply to the production-parity lane**, where these are
  separate MariaDB tables (C-ARCH-017).
- **`AUD-DB-006` concurrency-test teardown FK (Low, test-only).** The MariaDB concurrency test's `finally`
  teardown deleted users while `admin_audit_logs` still referenced them (FK 1451); all three concurrency
  scenarios themselves passed (`AUDIT_FINDINGS.md:253-264`; mechanism and fix in `mariadb-failure-triage.md:119-172`).
  See the ledger-staleness note in section 11.

---

## 10. The 20 empty tables and what they mean for every data-driven claim

**20 of the 53 tables are completely empty in the dev DB** (`01-database-schema.md:91,104-109`):

`access_request_items`, `access_requests`, `action_items`, `admin_access_requests`, `audit_logs`,
`cache_locks`, `calculated_metrics`, `consultant_evaluations`, `failed_jobs`, `job_batches`, `jobs`,
`leadership_digest_deliveries`, `morning_roster_overrides`, `notifications`, `password_reset_tokens`,
`personal_access_tokens`, `report_comments`, `report_status_history`, `resident_evaluations`,
`transfer_requests`.

This includes **every table on the clinical audit path** (`audit_logs`, `report_status_history`), the **entire
notification path** (`notifications`), and the **entire access-request path** (both `access_requests` and
`admin_access_requests`). Consequences that this review holds to strictly:

1. **No performance, growth, or behaviour claim may be made about those paths from this dataset.** They were
   never exercised by the seeders. This applies to the production-parity lane too, which was seeded from the
   same seeders (`AUDIT_FINDINGS.md:309-317`).
2. In particular the "highest-risk unbounded table," `audit_logs`, has **0 rows**, so its growth is a
   structural prediction, not an observation (section 8).
3. A further data-shape caveat even where rows exist: all 61,001 `report_field_values` rows share a single
   `updated_at` (`2026-07-12 15:14:37`) because the clinical dataset was bulk-seeded in one write, so any query
   plan that depends on `updated_at` selectivity behaves unrealistically here (`01-database-schema.md:111-113`).

---

## 11. Coverage boundaries: what is VERIFIED, PREDICTED, and UNVERIFIED

**VERIFIED (executed / reproduced).**
- AUD-DB-001 fix, by rebuilding the container DB from empty on MariaDB (section 5).
- AUD-API-002 / 002b fix, end to end through nginx on the MariaDB stack (section 5).
- Both post-fix suites green: SQLite 313/1-skip, MariaDB 314/0-fail (`mariadb-suite-postfix.txt`).
- Enum CHECK constraints exist in the live SQLite schema on `reports` (1) and `teaching_sessions` (3) and are
  absent on `departments` / `admin_access_requests` (spot check, section 3.3).
- The 4 pre-existing duplicate `evaluations` groups existed and were collapsed by migration `2026_09_16_000020`
  (section 6).

**PREDICTED / UNVERIFIED (reasoned from schema, not measured).**
- All growth and retention projections (section 8) - PREDICTED from seeded rates, never measured at 1k/10k/100k,
  and not measurable at all for the 20 empty tables (section 10). Empirical scale numbers, where they exist,
  belong in `PERFORMANCE_SCALABILITY_AUDIT.md` (produced separately) and are labelled PREDICTED there.
- The `evaluation_forms.active_status` NOT NULL generated-column behaviour on archived-row transitions is
  bounded only by "a full MariaDB migrate did not abort," not proven for every path (section 3.4).
- Whether the legacy `consultant_evaluations` / `resident_evaluations` tables are still read by any code path is
  UNVERIFIED (`01-database-schema.md:1694`).
- Model-layer `$timestamps` handling for `useCurrent()`-only tables, `app_settings` especially, is UNVERIFIED
  (`01-database-schema.md:1696`).
- End-to-end e2e results referenced anywhere in this review come from `PLAYWRIGHT_TEST_REPORT.md` (produced
  separately); no browser results are asserted here.

**Discrepancies found in the source evidence (flagged, not silently reconciled).**
1. **Enum CHECK on SQLite.** `01-database-schema.md:1642` asserts SQLite enum columns carry no CHECK ("varchar
   for every one"); the live schema SQL shows CHECKs do exist and are missing only on the two columns the
   remediation targets. The inventory conflated `pragma table_info`'s column type with the presence of a
   table-level CHECK. Resolved in section 3.3 in favour of the migration's premise.
2. **Findings ledger lags the committed remediation.** `AUDIT_FINDINGS.md` still lists the schema-derived
   candidates (C-DB-011, C-DB-012, C-PERF-014, ...) under "PENDING EMPIRICAL VERIFICATION" and AUD-DB-006 as
   "Open," even though migrations `2026_09_16_000020` (evaluations uniqueness, C-DB-012) and `2026_09_16_000030`
   (SQLite enum guard, C-DB-011 residue) are committed on disk and the MariaDB lane is now 0-failure / 0-error.
   The narrative (`AUDIT_PROGRESS.md` CHECKPOINT 8, commit `43bbccc`: "16 audit findings fixed, both lanes
   green") is the current truth; the `AUDIT_FINDINGS.md` OPEN/PENDING sections predate it. This review reflects
   the post-remediation state and cites the migrations directly.

---

## 12. Evidence index

| Evidence | Used for |
|---|---|
| `artifacts/audit-2026-07-21/discovery/01-database-schema.md` | Full 53-table inventory, FK/index/constraint/nullability, triggers, generated columns, retention table, disagreements |
| `AUDIT_FINDINGS.md` | AUD-DB-001, AUD-API-002/002b, AUD-DB-006, AUD-DEPLOY-007, AUD-INFRA-003; C-DB-011/012/013, C-PERF-014, empty-table caveat |
| `artifacts/audit-2026-07-21/evidence/mariadb-failure-triage.md` | MariaDB reproduction of the roster 500, entity_id column-type proof, fix recommendation, harness classifications |
| `artifacts/audit-2026-07-21/evidence/mariadb-suite-full.txt` / `mariadb-suite-postfix.txt` | Pre-fix 7 failures/3 errors; post-fix 314 tests / 0 failures |
| `backend/database/migrations/2026_09_16_000010_relax_admin_audit_log_entity_id.php` | AUD-API-002 fix (widen native uuid to string(64)) |
| `backend/database/migrations/2026_09_16_000020_enforce_evaluation_submission_uniqueness.php` | Evaluations uniqueness constraint added + duplicate collapse/archive |
| `backend/database/migrations/2026_09_16_000030_restore_sqlite_enum_check_constraints.php` | SQLite enum-CHECK restoration for the two rebuilt columns |
| Live `backend/database/database.sqlite` (`sqlite_master.sql`, read-only) | CHECK-constraint spot check resolving the enum discrepancy |

*End of DATABASE_REVIEW.md.*
