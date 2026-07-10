# V2 Implementation Guide for Claude Code

**Project:** St Paul's Hospital Millennium Medical College, Department of Internal Medicine, Reporting and Academic Accountability Platform.

**What this document is.** A complete, self-contained build instruction for the Version 2 expansion. It contains the client's locked requirements, the target data model, the phase-by-phase implementation plan with real file paths, the conventions you must follow, and the acceptance criteria for each phase. Work through it in order. Do not skip phases: later phases depend on tables and services created in earlier ones.

**Non-negotiables. Read before writing any code.**

1. **Do not break the clinical pillar.** Weekly report templates, submissions, locking, analytics, Excel import/export, reminders, action items, comments, and audit are in production use. The 129 backend and 57 frontend tests must stay green at the end of every phase. The only intentional test rewrite in the whole project is `AcademicEvaluationApiTest.php` eligibility assertions in Phase 3.
2. **Follow the existing conventions exactly** (Section 2). This codebase has a consistent style. Match it rather than introducing new patterns.
3. **Every phase ends green.** Run the full test suite plus a build before declaring a phase done. A phase that leaves the suite red is not done.
4. **Snapshot, never recompute.** Anything historical (an evaluation's ward, an attendance list, a form version) is written once at creation and never re-derived from current state. This rule is the single most important correctness property in the whole expansion, because people rotate.
5. **No em dashes in any user-facing string, comment, or document you produce.**

---

## 0. Repository orientation

### 0.1 Stack

| Layer | Technology |
|---|---|
| Backend | Laravel 13.8, PHP 8.3, Sanctum 4.3 SPA cookie auth |
| Database | MySQL / MariaDB, UUID string primary keys throughout (`HasUuids`) |
| Queue, cache, sessions | Database driver (no Redis) |
| Scheduler | `routes/console.php`, `Schedule::command(...)`, cron ticks `schedule:run` every minute |
| Frontend | React 19, TypeScript, Vite, React Router 7, TanStack Query, React Hook Form, Zod, Tailwind |
| Tests | Pest/PHPUnit feature tests in `backend/tests/Feature`, Vitest in `src/**/*.test.tsx` |

### 0.2 Layout

```
backend/
  app/
    Console/Commands/           SendReportReminders.php, LaunchReadinessCheck.php, ...
    Http/
      Controllers/Api/          AcademicEvaluationController.php, AcademicAnalyticsController.php,
                                WorkspaceController.php, Admin/...
      Middleware/               EnsurePermission.php
    Models/                     ConsultantEvaluation.php, ResidentEvaluation.php, User.php, Department.php, ...
    Policies/                   ConsultantEvaluationPolicy.php, ResidentEvaluationPolicy.php, ...
    Services/
      Academic/                 AcademicAnalyticsService.php, AcademicAnalyticsFilters.php
      Admin/  Analytics/  Notifications/  Reports/
    Support/Authorization/      Permissions.php   <- the role/permission matrix
  database/migrations/          YYYY_MM_DD_HHMMSS_verb_noun.php
  routes/api.php                all API routes, grouped, permission middleware on each
  routes/console.php            the scheduler
src/
  pages/academic/               academic-home-page.tsx, evaluation-form-page.tsx, academic-history-page.tsx
  pages/admin/                  academic-dashboard-page.tsx, template-management-page.tsx, user-management-page.tsx, ...
  pages/nurse/  pages/auth/
  routes/                       route-guards.tsx, landing.ts, route-prefetch.ts
  types/domain.ts               UserRole and all domain types
  context/                      app-data-context.tsx (workspace bootstrap consumer)
  components/
```

### 0.3 Current academic module (what you are extending)

- Two evaluation tables: `consultant_evaluations` (resident evaluates the consultant on the MDT round: presence, joining time, presence minutes, six round-quality booleans, participants, system issues) and `resident_evaluations` (consultant evaluates the resident on ACGME-aligned competencies).
- `AcademicEvaluationController::formOptions` currently returns **all active users of the opposite role** as candidate subjects, and returns wards by querying `departments` where `family = 'inpatient'`. Both of those are what Phase 3 replaces.
- `users.home_ward_id` exists and points at `departments`. It is a static single ward. V2 replaces it with dated assignments.
- `AcademicAnalyticsService` aggregates in PHP and **has no cache**. Phase 4 fixes that.

---

## 1. Locked client decisions

These came from three written rounds with the department. Treat them as the requirements spec. Where a decision was delegated to the implementer it is marked **[design]**.

### 1.1 Wards and units

- Six physical **teaching wards**: Cardiology/Endocrinology, Pulmonology, Hematology/Oncology, Gastroenterology/Neurology, Nephrology, Transition.
- Eight **inpatient units** exist because Cardiology + Endocrinology share one ward, and Gastroenterology + Neurology share another. The other pairs and singles map accordingly.
- Wards are a new entity, admin-creatable, so more can be added later without a code change.
- A ward maps to the existing `departments` rows of the inpatient family. Link them; do not duplicate them.

### 1.2 Sections (specialty units) and consultants

- Eight sections: Nephrology, Neurology, Cardiology, Endocrinology, Pulmonology, Hematology, Oncology, Gastroenterology.
- **A consultant belongs to a section and does not move between wards.** Within their section they rotate monthly between that section's duties. Example, Nephrology: nephrology ward one month, dialysis the next, transplant the next.
- Section-specific duties named by the client: Nephrology has Nephrology Ward, Transplant ICU/Ward, Dialysis. Gastroenterology has GI on-call, Emergency Endoscopy, Colonoscopy. Every section has an on-call duty.
- **Transition Ward** is covered by two internists per day, not owned by any section. **[design]** It is modeled as a day-level duty type.
- On-call consultants provide consults hospital-wide regardless of ward.
- The system holds the **complete month-by-month duty schedule** for every consultant, all duties, not just ward months. This doubles as the department's duty roster.
- A consultant may request **transfer to another section**. Approved by the **head of the section**, not by a system administrator. Admins may also change a consultant's section directly with no request.
- **[design]** Approval authority sits with the head of the destination section (they accept the member). Origin head and requester are notified.
- Transfers take effect at the start of the next rotation period by default; administrators may override to immediate. **[design]** The default boundary is the first day of the next calendar month.

### 1.3 Resident rotations

- Year 1 and Year 2 residents: **calendar-month** rotations.
- Year 3 residents: **continuous eight-week blocks**, no gaps. Residents are divided into groups (if there are five 8-week attachments, there are five groups) and each group cycles through all attachments over the year.
- The academic year start date **changes every year** with the national program, so rotation calendars are admin-configured per academic year, never hard-coded.
- Residents also rotate to: OPD, ICU, Emergency, Zewditu Memorial Hospital, Saint Peter Specialized Hospital, Dermatology, Radiology, Psychiatry, and one month of annual leave.
- **Evaluations continue during OPD**, completed by the supervising Internal Medicine consultant.
- For **ICU, Emergency, Dermatology, Radiology, Psychiatry** (and by the same logic the two external hospitals), the host department completes paper evaluations which are submitted to Internal Medicine for recording. **[design]** An administrator enters these into the system. No external logins in V2, but the schema keeps a nullable user link so departmental logins can be added later with no migration.

### 1.4 Evaluation scoping

- A resident evaluates, and is evaluated by, only the consultants they actually overlap with in the same ward or paired duty on that date. Rotation changes shift the pairings automatically.
- **[design] One rule for everything:** an evaluation is allowed if author and subject both have an active duty assignment covering the date, both duty types resolve to the same **pairing key**, and both duty types are flagged as pairing. The pairing key is the ward when the duty has one, otherwise a `pairing_group` string (`opd`, `transplant`).
- Every evaluation permanently stores the ward and placement it was written under. Never recompute from the person's current assignment.

### 1.5 Evaluation forms

- **All** evaluation forms become admin-editable: the MDT round form, the resident ACGME form, and the new undergraduate forms. Admins can insert and edit evaluation tools without a developer.
- **[design]** This mirrors the clinical template engine's split: content edits (labels, help text, order, option wording) are applied to the published version in place; structural edits (add/remove field, change key or type) create a new version. Past evaluations render against the version they were answered on.
- **[design]** A small set of core fields is protected from removal or type change because the accountability analytics depend on them: `senior_present`, `senior_joined_at`, `presence_minutes` on the MDT form; `overall_rating` on the resident form.
- The reps' activity log is not an evaluation and stays outside the form engine.

### 1.6 Undergraduate module

- Two cohorts: **C1** (Year 3, twelve-week attachment) and **C2** (Year 4, eight-week attachment). When a batch finishes, a new one starts. **Two C1 batches may overlap.**
- Each batch splits into **two subgroups** of roughly 8 to 10 students. Weekly movement between wards is **manual**, set by an administrator, not auto-generated.
- Weekly programs (seed these):
  - **C1:** Lecture Mon to Fri; Teaching round Tue and Thu; Bedside Mon and Fri; Seminar Wed.
  - **C2:** Lecture Fri; Teaching round Tue and Thu; Bedside Mon and Wed; Seminar Fri.
- **Three representative logins per batch:** one **group rep** who records whether each lecture and seminar was held (whole cohort), and one **subgroup rep per subgroup** who records bedside teaching and teaching rounds for their own subgroup only.
- Reps record **held / not held**, and a **reason is required when not held**. Reps have **no access to any evaluation, assessment, or score**, ever. Enforce this structurally by never granting them an academic permission.
- **[design]** A third state, `cancelled`, exists for holidays and exam weeks so legitimate skips do not distort occurrence statistics. Same for morning sessions.
- **Individual student attendance is recorded by the consultant conducting the activity**, for every activity type.
- **Students are evaluated at two levels:** a weekly evaluation at the end of each ward placement, and a final evaluation at the end of the attachment.
- **Any consultant may evaluate any student.** Students are **not** ward-gated for evaluation, because consultants from different wards teach across the program. The student's current ward placement is shown as context and pre-filled on the form.
- Undergraduate evaluation is **one-way**. Students never evaluate consultants. There is no route for it.
- Students do not appear on the morning session roster.

### 1.7 Morning sessions

- One **department-wide** session, not per ward.
- Held **Monday, Wednesday, Friday**, scheduled start **08:00**. The system measures punctuality and delay against that fixed time.
- **One standing designated recorder**, appointed by an admin, who is not necessarily an admin.
- The expected attendance roster is **generated automatically from current rotation and duty assignments**, with admins able to add or remove individuals.
- **Consultants on non-ward duties still appear on the roster.** **[design]** People on external rotations and annual leave do not.
- The form: one on-time toggle; if off, capture the actual start time; one present toggle per expected attendee.

### 1.8 Deployment

- The platform runs on the **department's own server**, reachable **only from inside the hospital network** (hospital wifi). Not exposed to the public internet.
- The **department** performs routine administration. Hospital IT is escalation only.
- Therefore: automate database backups, security updates, certificate renewal, and deployment; ship a plain-language operations handbook.
- **[design]** Keep the database queue/cache/session drivers. Do not introduce Redis. The one infrastructure upgrade is a persistent `queue:work` systemd unit replacing the cron-tick worker.
- Note: the app is an installable PWA, and the service worker requires HTTPS **even on a LAN**. A real certificate is required.

---

## 2. Conventions you must follow

Read one existing file of each kind before writing the new one. The patterns below are already in the codebase.

**Migrations.** Name `YYYY_MM_DD_HHMMSS_verb_noun.php`. UUID primary keys: `$table->uuid('id')->primary();`. Foreign keys: `$table->foreignUuid('user_id')->constrained()->restrictOnDelete();` (use `cascadeOnDelete` only for true child rows such as answers and attendance lines). Always add the indexes named in Section 3. Never drop a column in the same migration that adds its replacement; backfill first, drop in a later migration.

**Models.** `use Illuminate\Database\Eloquent\Concerns\HasUuids;`, declare `$fillable`, declare `$casts` for dates, booleans and json, and type the relations (`: BelongsTo`, `: HasMany`). Look at `app/Models/ConsultantEvaluation.php`.

**Authorization is two layers, always.**
1. Route middleware carries the coarse permission: `->middleware('permission:academic.submit')`.
2. The controller re-checks with a policy: `Gate::authorize('create', ConsultantEvaluation::class);`

Add the coarse permission to `app/Support/Authorization/Permissions.php` in the role matrix. Put the fine-grained, data-driven rule (is this user the designated recorder, does this user head that section, is this rep assigned to that subgroup, do these two people overlap) **in the policy**, never in the role matrix. Roles stay static; eligibility is data.

**Controllers.** Thin. Validate, authorize, delegate to a service, serialize. Business logic belongs in `app/Services/...`. Long-lived reference data goes through the admin controllers under `app/Http/Controllers/Api/Admin/`.

**Routes.** Add to `backend/routes/api.php` inside the existing `auth:sanctum` group, keep the `academic` and `admin` prefixes, one `permission:` middleware per route.

**Scheduler.** Register commands in `backend/routes/console.php` with `->withoutOverlapping(10)`, matching the existing entries.

**Audit.** Any administrative mutation (roster changes, transfer decisions, form publishes, session cancellations, roster overrides) writes an `AdminAuditLog` entry. Follow how the existing admin controllers do it.

**Frontend.** Pages under `src/pages/<area>/<name>-page.tsx`. Add new roles to `src/types/domain.ts` (`UserRole`), to `src/routes/route-guards.tsx`, and to `src/routes/landing.ts` so the role lands on the right page after login. Data fetching through TanStack Query, forms through React Hook Form plus Zod. Never introduce a new state library.

**Naming.** Backend snake_case columns, camelCase JSON keys in API responses (the controllers already do this conversion; follow `SerializesAdminResources`).

**Commands to run.**

```bash
# backend
cd backend && php artisan test                 # all feature tests
php artisan test --filter=Academic             # focused
php artisan migrate:fresh --seed               # rebuild local db

# frontend
npm run test        # vitest
npm run build       # typecheck + production build, must pass
npm run lint
```

---

## 3. Target data model

All tables use UUID primary keys and timestamps. Only new tables and changed columns are listed.

### 3.1 Structure (Phase 1)

**`wards`** the six physical teaching wards.
`name`, `slug` unique, `active` bool default true.

**`departments`** (existing table, one added column)
`ward_id` nullable FK `wards` nullOnDelete. Maps each inpatient reporting unit to its teaching ward. Outpatient and procedure departments stay null. Nothing in the clinical pillar reads this column; it exists so academic and clinical share one vocabulary.

**`sections`** the eight specialty units.
`name`, `slug` unique, `head_user_id` nullable FK `users` nullOnDelete, `active` bool.

**`duty_types`** the admin-editable catalog of everything a person can be assigned to. This table is the heart of the model.

| column | type | purpose |
|---|---|---|
| `name` | string | "Nephrology Ward Service", "Dialysis", "GI On call", "OPD", "Annual Leave" |
| `slug` | string(64) unique | |
| `section_id` | uuid nullable FK sections | null for department-wide duties |
| `ward_id` | uuid nullable FK wards | set for ward services and Transition |
| `category` | enum | `ward_service`, `clinical_duty`, `on_call`, `external`, `leave` |
| `granularity` | enum | `monthly` or `daily`. Daily = on-call and Transition |
| `pairs_for_evaluation` | bool | true for ward services, Transition, OPD, Transplant. False for on-call, dialysis, externals, leave |
| `pairing_group` | string nullable | used as the pairing key when `ward_id` is null: `opd`, `transplant` |
| `counts_for_morning_roster` | bool | true for everything except `external` and `leave` |
| `active` | bool | |

**`duty_assignments`** the universal dated placement. Residents and consultants both. This one table replaces `users.home_ward_id` and carries rotations, duty months, on-call days, OPD, externals, and leave.

| column | type |
|---|---|
| `user_id` | uuid FK users restrictOnDelete |
| `duty_type_id` | uuid FK duty_types restrictOnDelete |
| `starts_on` | date, inclusive |
| `ends_on` | date, inclusive |
| `source` | enum `admin`, `rotation_planner`, `transfer` |
| `created_by` | uuid FK users |
| `note` | string nullable |

Indexes: `(user_id, starts_on, ends_on)`, `(duty_type_id, starts_on, ends_on)`.

Overlap rule, enforced in `RosterService` inside the write transaction, not by a DB constraint: a user may not hold two overlapping **monthly-granularity** assignments. Daily-granularity assignments (on-call, Transition) are exempt because they legitimately stack on top of a monthly service month.

**`rotation_calendars`** / **`rotation_blocks`** the per-year, per-training-year calendar. Admin-configured because the intake date moves.

- `rotation_calendars`: `training_year` tinyint (1, 2, 3), `academic_year_label` string, `starts_on` date, `block_kind` enum `calendar_month` | `fixed_weeks`, `block_length_weeks` tinyint nullable (8 for Y3), `blocks_count` tinyint, `active` bool. Unique `(training_year, academic_year_label)`.
- `rotation_blocks`: `calendar_id` FK cascadeOnDelete, `block_index` tinyint, `starts_on`, `ends_on`. Generated by the service, never entered by hand.

**`users`** added columns: `training_year` tinyint nullable (residents), `rotation_group` string(8) nullable (Y3 group A..E), `section_id` uuid nullable FK sections (consultants). Keep `home_ward_id` but stop reading it; drop it in a cleanup migration one release later.

### 3.2 Transfers (Phase 2)

**`transfer_requests`**: `user_id` FK users, `from_section_id` FK sections, `to_section_id` FK sections, `reason` text nullable, `status` enum `pending|approved|rejected|cancelled`, `decided_by` uuid nullable FK users, `decided_at` timestamp nullable, `effective_on` date nullable, `applied_at` timestamp nullable.

### 3.3 Form engine (Phase 4)

**`evaluation_forms`**: `key` string (`consultant_mdt`, `resident_acgme`, `student_weekly`, `student_final`), `name`, `target` enum `consultant|resident|student`, `version` int, `status` enum `draft|published|archived`, `published_at` nullable. Unique `(key, version)`. Exactly one published version per key, enforced in the service.

**`evaluation_form_fields`**: `form_id` FK cascadeOnDelete, `section` string, `key` string, `label`, `help_text` nullable, `type` enum `boolean|rating|percent|integer|time|text|single_select|multi_select`, `options` json nullable, `required` bool, `sort_order` int, `active` bool, `is_core` bool. Unique `(form_id, key)`.

`is_core` fields cannot be removed or type-changed by anyone: `senior_present`, `senior_joined_at`, `presence_minutes` (MDT), `overall_rating` (resident).

**`evaluations`** the unified response header, replacing both legacy tables.

| column | notes |
|---|---|
| `form_id` | FK evaluation_forms, pins the version answered |
| `form_key` | string, denormalized for cheap filtering |
| `author_id` | uuid **nullable** FK users (null for externally sourced) |
| `subject_user_id` | uuid nullable FK users |
| `subject_student_id` | uuid nullable FK students |
| `evaluation_date` | date |
| `ward_id` | uuid nullable FK wards, **snapshot** |
| `placement_type` | string nullable: `ward`, `transition`, `opd`, `transplant`, or an external duty slug, **snapshot** |
| `week_starts_on` | date nullable, for `student_weekly` |
| `external_evaluator_name` | string nullable |
| `external_evaluator_department` | string nullable |
| `entered_by_id` | uuid nullable FK users, the admin who typed an external evaluation |
| `comment` | text nullable |

Service-level invariants: exactly one of `subject_user_id` / `subject_student_id` is set; exactly one of `author_id` / `external_evaluator_name` is set.

Indexes: `(subject_user_id, evaluation_date)`, `(subject_student_id, evaluation_date)`, `(ward_id, evaluation_date)`, `(form_key, evaluation_date)`, `(evaluation_date)`.

**`evaluation_answers`**: `evaluation_id` FK cascadeOnDelete, `field_key` string, `value` json. Unique `(evaluation_id, field_key)`.

> This is the only high-volume table the expansion adds, roughly 20 to 25 rows per evaluation, on the order of 150K to 220K rows per year. It is fine at this scale, but it is exactly why Phase 4 also adds the analytics cache. See Section 12.

### 3.4 Undergraduate module (Phase 5)

- **`student_batches`**: `cohort` enum `C1|C2`, `label`, `starts_on`, `ends_on`, `active`. Overlapping C1 batches are legal.
- **`students`**: `batch_id` FK, `full_name`, `external_id` string nullable, `subgroup` enum `A|B` nullable, `active`. Index `(batch_id, subgroup)`.
- **`subgroup_placements`**: `batch_id` FK, `subgroup` enum, `ward_id` FK wards, `week_starts_on`, `week_ends_on`, `created_by`. Unique `(batch_id, subgroup, week_starts_on)`.
- **`rep_assignments`**: `user_id` FK users (role `student_rep`), `batch_id` FK, `scope` enum `group|subgroup_a|subgroup_b`, `active`.
- **`teaching_activity_schedules`**: `cohort` enum, `activity_type` enum `lecture|seminar|bedside|teaching_round`, `weekday` tinyint (1=Mon), `scope` enum `cohort|subgroup`, `active`. Seed per Section 1.6. `lecture` and `seminar` are `cohort` scope; `bedside` and `teaching_round` are `subgroup` scope.
- **`teaching_sessions`**: `batch_id` FK, `subgroup` enum nullable (null for cohort scope), `activity_type` enum, `scheduled_date` date, `ward_id` uuid nullable FK wards (snapshot from the placement), `status` enum `pending|held|not_held|cancelled`, `reason` text nullable (**required** when `not_held` or `cancelled`), `recorded_by` uuid nullable FK users, `recorded_at` nullable. Unique `(batch_id, subgroup, activity_type, scheduled_date)`.
- **`student_attendance`**: `teaching_session_id` FK cascadeOnDelete, `student_id` FK, `present` bool, `recorded_by` FK users. Unique `(teaching_session_id, student_id)`.

Student evaluations live in `evaluations` via `subject_student_id`, form keys `student_weekly` and `student_final`.

### 3.5 Morning sessions (Phase 6)

- **`morning_sessions`**: `session_date` date unique, `scheduled_start_at` time (snapshot of the setting), `actual_start_at` time nullable, `started_on_time` bool nullable, `status` enum `pending|recorded|cancelled`, `reason` text nullable, `recorded_by` uuid nullable FK users, `recorded_at` nullable.
- **`morning_attendance`**: `morning_session_id` FK cascadeOnDelete, `user_id` FK users, `present` bool. Unique `(morning_session_id, user_id)`.
- **`morning_roster_overrides`**: `user_id` FK users, `action` enum `include|exclude`, `starts_on`, `ends_on` nullable, `created_by`.

New `app_settings` keys: `academic.morning_session_days` json default `[1,3,5]`, `academic.morning_session_time` default `"08:00"`, `academic.morning_recorder_ids` json array of user ids.

### 3.6 Permissions delta

Add to `app/Support/Authorization/Permissions.php`:

```php
public const ROSTER_MANAGE = 'roster.manage';                          // admin, superadmin
public const ROTATIONS_MANAGE = 'rotations.manage';                    // admin, superadmin
public const ACADEMIC_STRUCTURE_MANAGE = 'academicStructure.manage';   // admin, superadmin
public const TRANSFERS_CREATE = 'transfers.create';                    // consultant
public const TRANSFERS_REVIEW = 'transfers.review';                    // consultant (policy narrows to section head), admin, superadmin
public const MORNING_ATTENDANCE_RECORD = 'morningAttendance.record';   // resident, consultant, admin, superadmin (policy narrows to designated recorder)
public const TEACHING_LOG_RECORD = 'teachingLog.record';               // student_rep, admin, superadmin
public const STUDENT_ATTENDANCE_RECORD = 'studentAttendance.record';   // consultant, admin, superadmin
public const STUDENTS_MANAGE = 'students.manage';                      // admin, superadmin
public const EVALUATION_FORMS_EDIT_CONTENT = 'evaluationForms.editContent';     // admin, superadmin
public const EVALUATION_FORMS_EDIT_STRUCTURE = 'evaluationForms.editStructure'; // superadmin only
```

And a new role:

```php
'student_rep' => [
    self::AUTH_VIEW_SELF,
    self::NOTIFICATIONS_VIEW,
    self::TEACHING_LOG_RECORD,
],
```

**The `student_rep` role must never receive `academic.submit`, `academic.view`, or `academic.manage`.** That absence is the structural guarantee that reps cannot reach evaluation data. Write a test that asserts it.

### 3.7 Workspace bootstrap delta

`WorkspaceController::show` adds to its payload:

- `currentPlacement`: `{ dutyTypeName, wardId, wardName, endsOn }` or null, for residents and consultants
- `isMorningRecorder`: bool
- `headsSections`: string[] of section ids
- `repScope`: `{ batchId, cohort, scope }` or null
- `pendingTransferCount`: int, for heads and admins
- `academicSetup`: `{ calendarsMissing: bool, consultantsWithoutSection: int, peopleWithoutAssignment: int }` for the admin setup banner

Consume these in `src/context/app-data-context.tsx` and use them to show or hide the new nav entries. Keep this endpoint's window-bounded design; do not add any per-row payload.

---

## 4. Phase 1: Structure and roster foundation

**Goal.** Wards, sections, duty types, dated assignments, rotation calendars, and the `RosterService` that every later phase queries. Nothing user-visible changes yet except new admin screens.

**Depends on.** Nothing. Build first.

### 4.1 Create (backend)

```
database/migrations/  2026_07_15_000010_create_wards_table.php
                      2026_07_15_000020_create_sections_table.php
                      2026_07_15_000030_create_duty_types_table.php
                      2026_07_15_000040_add_ward_id_to_departments.php
                      2026_07_15_000050_add_academic_columns_to_users.php
                      2026_07_15_000060_create_duty_assignments_table.php
                      2026_07_15_000070_create_rotation_calendars_table.php
                      2026_07_15_000080_create_rotation_blocks_table.php
                      2026_07_15_000090_seed_academic_structure.php   (data migration)
                      2026_07_15_000100_backfill_duty_assignments.php (data migration)

app/Models/           Ward.php  Section.php  DutyType.php  DutyAssignment.php
                      RotationCalendar.php  RotationBlock.php

app/Services/Academic/RosterService.php
app/Services/Academic/RotationCalendarService.php

app/Policies/         WardPolicy.php  SectionPolicy.php  DutyTypePolicy.php
                      DutyAssignmentPolicy.php  RotationCalendarPolicy.php

app/Http/Controllers/Api/Admin/AcademicStructureController.php   (wards, sections, duty types CRUD)
app/Http/Controllers/Api/Admin/RotationController.php            (calendars, blocks, planner matrix)
app/Http/Controllers/Api/Admin/DutyRosterController.php          (month grid read/write)
```

### 4.2 `RosterService` API

This is the contract every later phase calls. Implement exactly these methods.

```php
final class RosterService
{
    /** The user's monthly-granularity assignment covering $date, or null. */
    public function assignmentFor(User $user, CarbonInterface $date): ?DutyAssignment;

    /** All assignments (monthly + daily) covering $date. */
    public function assignmentsFor(User $user, CarbonInterface $date): Collection;

    /**
     * The pairing keys the user holds on $date, from duty types where
     * pairs_for_evaluation = true. Returns e.g. ['ward:<uuid>'] or ['group:opd'].
     * A consultant on ward service + Transition duty the same day holds two.
     */
    public function pairingKeysFor(User $user, CarbonInterface $date): array;

    /** True when author and subject share at least one pairing key on $date. */
    public function canPair(User $author, User $subject, CarbonInterface $date): bool;

    /** Active users of $roleKey sharing a pairing key with $user on $date. */
    public function peersFor(User $user, CarbonInterface $date, string $roleKey): Collection;

    /** Everyone whose duty type has counts_for_morning_roster on $date, plus/minus overrides. */
    public function morningRosterOn(CarbonInterface $date): Collection;

    /** Guarded write: rejects an overlapping monthly assignment for the same user. */
    public function createAssignment(User $user, DutyType $type, CarbonInterface $from, CarbonInterface $to, string $source, User $by, ?string $note = null): DutyAssignment;

    /** Bulk write used by the rotation planner and duty roster grid, one transaction. */
    public function bulkAssign(array $rows, string $source, User $by): void;
}
```

Implementation notes:

- Date-range containment is `starts_on <= $date AND ends_on >= $date`. Use the composite indexes; do not load and filter in PHP.
- `pairingKeysFor` maps a duty type to `'ward:'.$type->ward_id` when `ward_id` is set, else `'group:'.$type->pairing_group`. Skip types where `pairs_for_evaluation` is false. Return `[]` when the user has no pairing duty (a consultant on dialysis, a resident on annual leave). An empty array means they cannot evaluate or be evaluated that day, which is correct.
- `peersFor` is one query: join `duty_assignments` to `duty_types`, filter by date containment, `pairs_for_evaluation`, `role_key`, `active`, and pairing key IN the author's keys. Bounded by department headcount, roughly 150 rows. No cache needed.
- `createAssignment` wraps the overlap check and the insert in `DB::transaction`. Overlap check only applies when `$type->granularity === 'monthly'`, and only against other monthly assignments.

### 4.3 `RotationCalendarService` API

```php
public function createCalendar(int $trainingYear, string $label, CarbonInterface $startsOn, string $blockKind, ?int $blockLengthWeeks, int $blocksCount): RotationCalendar;
public function generateBlocks(RotationCalendar $calendar): void;   // called by createCalendar
public function currentBlockFor(int $trainingYear, CarbonInterface $date): ?RotationBlock;
public function nextBoundaryAfter(CarbonInterface $date): CarbonInterface; // first day of next calendar month
```

`generateBlocks`: for `calendar_month`, emit `blocks_count` month-aligned blocks from `starts_on`. For `fixed_weeks`, emit `blocks_count` back-to-back blocks of `block_length_weeks * 7` days, no gaps (client requirement).

### 4.4 Seed data migration (`..._seed_academic_structure.php`)

1. Six wards (Section 1.1).
2. Eight sections (Section 1.2).
3. Duty types:
   - Per section: one `Ward Service` (category `ward_service`, `ward_id` set, monthly, pairs) and one `On call` (category `on_call`, daily, does not pair). **Cardiology Ward Service and Endocrinology Ward Service both point at the Cardiology/Endocrinology ward.** Same for Gastroenterology and Neurology.
   - Nephrology extra: `Transplant ICU/Ward` (clinical_duty, monthly, pairs, `pairing_group = 'transplant'`), `Dialysis` (clinical_duty, monthly, does **not** pair).
   - Gastroenterology extra: `Emergency Endoscopy` (daily), `Colonoscopy Duty` (monthly, does not pair).
   - Department-wide: `Transition Ward Duty` (clinical_duty, **daily**, `ward_id` = Transition, pairs), `OPD` (clinical_duty, monthly, pairs, `pairing_group = 'opd'`), `Annual Leave` (leave, monthly, no roster, no pairing).
   - External (category `external`, monthly, no roster, no pairing): `ICU`, `Emergency`, `Zewditu Memorial Hospital`, `Saint Peter Specialized Hospital`, `Dermatology`, `Radiology`, `Psychiatry`.
4. Map the eight inpatient `departments` rows to their `ward_id`.

### 4.5 Backfill migration (`..._backfill_duty_assignments.php`)

Existing users must keep working on day one.

- For every active resident and consultant with a `home_ward_id`: create one `duty_assignment` of the Ward Service duty type whose `ward_id` matches, from the first of the current month to the last day of the current month, `source = 'admin'`.
- Users without a resolvable ward are left unassigned. Do not guess. They surface in the admin setup banner via `academicSetup.peopleWithoutAssignment`.
- Consultants keep `section_id` null until an admin sets it. Surface the count as `consultantsWithoutSection`.
- Do **not** touch `home_ward_id`. It stays until the cleanup migration.

### 4.6 Routes

```php
Route::prefix('admin')->group(function (): void {
    Route::apiResource('/wards', AcademicStructureController::class)->middleware('permission:academicStructure.manage');
    Route::apiResource('/sections', ...)->middleware('permission:academicStructure.manage');
    Route::apiResource('/duty-types', ...)->middleware('permission:academicStructure.manage');
    Route::get('/rotations/calendars', [RotationController::class, 'calendars'])->middleware('permission:rotations.manage');
    Route::post('/rotations/calendars', [RotationController::class, 'storeCalendar'])->middleware('permission:rotations.manage');
    Route::get('/rotations/{calendar}/plan', [RotationController::class, 'plan'])->middleware('permission:rotations.manage');
    Route::post('/rotations/{calendar}/plan', [RotationController::class, 'savePlan'])->middleware('permission:rotations.manage');
    Route::get('/roster/{year}/{month}', [DutyRosterController::class, 'month'])->middleware('permission:roster.manage');
    Route::put('/roster/{year}/{month}', [DutyRosterController::class, 'saveMonth'])->middleware('permission:roster.manage');
    Route::post('/roster/daily', [DutyRosterController::class, 'saveDaily'])->middleware('permission:roster.manage');
});
```

### 4.7 Frontend

- `src/pages/admin/academic-structure-page.tsx`: three tabs (Wards, Sections, Duty types). Section tab includes assigning `head_user_id`. Model the CRUD interaction on `template-management-page.tsx`.
- Admin setup banner component, shown on `academic-dashboard-page.tsx` while `academicSetup` reports anything missing, linking to the screen that fixes it.
- Add the new admin routes to the router and `route-prefetch.ts`.

### 4.8 Tests (`backend/tests/Feature/RosterTest.php`)

- `pairingKeysFor` returns the ward key for a ward service, `group:opd` for OPD, `[]` for dialysis and for annual leave.
- Two consultants on Transition duty the same day pair with each other; on different days they do not.
- `canPair` is false when the dates do not overlap even though the ward matches.
- Overlap guard rejects a second monthly assignment, accepts a daily one stacked on a monthly one.
- `generateBlocks` produces 6 contiguous 8-week blocks with no gap and no overlap; month calendars align to month boundaries.
- Backfill migration leaves every existing academic test green.

### 4.9 Acceptance

`php artisan migrate:fresh --seed` builds the full structure. `php artisan test` green, all 129 prior tests plus the new ones. Admin can create a ward, a section, a duty type, and a rotation calendar through the UI. `npm run build` clean.

---

## 5. Phase 2: Duty roster, rotation planner, transfer requests

**Goal.** The screens that put real data into `duty_assignments`, plus the consultant transfer workflow.

**Depends on.** Phase 1.

### 5.1 Rotation planner

Endpoint `GET /api/admin/rotations/{calendar}/plan` returns residents of that training year (with `rotation_group`) down one axis and the calendar's blocks across the other, with the current assignment in each cell.

`POST .../plan` accepts `{ assignments: [{ userId, blockId, dutyTypeId }] }` and writes through `RosterService::bulkAssign` in one transaction, deriving `starts_on` / `ends_on` from the block. `source = 'rotation_planner'`.

Year 3 convenience: accept `{ groupPlan: [{ rotationGroup, blockId, dutyTypeId }] }` and expand it to every member of the group server-side. This is how the department actually plans (five groups cycling through five attachments).

### 5.2 Duty roster grid

`GET /api/admin/roster/{year}/{month}` returns consultants grouped by section, each with their monthly duty for that month and their daily duties (on-call, Transition) as a per-day strip. Residents included, filtered by training year.

`PUT .../roster/{year}/{month}` bulk-writes the monthly cells. `POST /api/admin/roster/daily` writes a single day-level assignment (used by the strip).

This screen is the department's live duty roster. It is worth making it good: sticky headers, keyboard navigation across cells, a section filter, and a warning when a monthly cell is left empty.

### 5.3 Transfer requests

```
POST   /api/academic/transfer-requests           permission:transfers.create   (consultant)
GET    /api/academic/transfer-requests/mine      permission:transfers.create
POST   /api/academic/transfer-requests/{id}/cancel  permission:transfers.create  (own, pending only)
GET    /api/admin/transfer-requests              permission:transfers.review
POST   /api/admin/transfer-requests/{id}/approve permission:transfers.review
POST   /api/admin/transfer-requests/{id}/reject  permission:transfers.review
POST   /api/admin/sections/{section}/set-consultant  permission:roster.manage  (direct admin change, no request)
```

`TransferRequestPolicy::decide($user, $request)` returns true when the user is an admin, **or** `$request->toSection->head_user_id === $user->id`. This is the data-driven designation pattern. Do not create a "section head" role.

`app/Services/Academic/TransferService.php`:
- `request()` creates the row, notifies the destination head.
- `approve(TransferRequest $r, User $by, ?CarbonInterface $effectiveOn)`: default `effective_on = RotationCalendarService::nextBoundaryAfter(today)`. If the caller passes today, apply immediately (admin override).
- `apply(TransferRequest $r)`: updates `users.section_id`, closes any open Ward Service assignment of the old section on the day before `effective_on`, writes `applied_at`, notifies the requester and both heads, writes an `AdminAuditLog` entry.

Scheduled command `academic:apply-section-transfers`, daily at 00:15, applies every approved request whose `effective_on` has arrived and `applied_at` is null. Register in `routes/console.php` with `->withoutOverlapping(10)`.

### 5.4 Frontend

- `src/pages/admin/duty-roster-page.tsx`, `src/pages/admin/rotation-planner-page.tsx`.
- Consultant: a "Request section transfer" card on `academic-home-page.tsx` plus a small status list of their own requests.
- Section head: a "Pending transfers" panel on `academic-home-page.tsx`, rendered only when `headsSections` is non-empty in the workspace payload.
- Admin: a Transfer requests tab on the academic dashboard.

### 5.5 Tests

Planner bulk save writes the right ranges; group plan expands to all members; a non-head consultant cannot approve; the destination head can; an admin can; approval defaults to next month boundary; immediate override applies inline; the scheduled command applies due transfers exactly once; every decision writes an audit row.

### 5.6 Acceptance

An admin can plan a full academic year for Y1, Y2, and Y3 and fill a month of consultant duties without touching the database. A consultant can request a transfer and the destination head can approve it. Suite green.

---

## 6. Phase 3: Rotation-aware evaluations

**Goal.** Evaluations become scoped to who actually works together. External evaluations become enterable by admin.

**Depends on.** Phase 1 (Phase 2 for realistic data).

### 6.1 Rewire eligibility

`app/Http/Controllers/Api/AcademicEvaluationController.php`:

- `formOptions(Request $request)`: accept an optional `date` query param (default today, must be `before_or_equal:today`). Replace the current "all active users of the opposite role" query with `RosterService::peersFor($user, $date, $oppositeRole)`. Replace the `Department::where('family','inpatient')` ward query with the `wards` table. Add `currentPlacement` to the response so the form can show context and pre-fill the ward. Remove `homeWardId` / `homeWardName` from the subject payload.
- `storeConsultantEvaluation` and `storeResidentEvaluation`: after the existing direction guard, call `RosterService::canPair($author, $subject, $date)` and throw a `ValidationException` with a clear message when false ("You and this person were not assigned to the same ward or duty on that date."). Snapshot the resolved `ward_id` and `placement_type` onto the row rather than trusting the client's `ward_id`.
- `ConsultantEvaluationPolicy::create` and `ResidentEvaluationPolicy::create`: mirror the pairing check so the Gate agrees with the controller. Authorization in depth is the house style.

Migration `..._add_ward_ref_to_evaluations.php`: add `ward_ref_id` (FK `wards`, nullable) and `placement_type` (string nullable) to both legacy tables, backfill `ward_ref_id` from the `departments.ward_id` map, set `placement_type = 'ward'`. Do not rename or drop the old `ward_id` yet; Phase 4 migrates these rows wholesale.

### 6.2 External evaluations

```
POST /api/admin/academic/external-evaluations   permission:academic.manage
```

New method on `Admin\AcademicEvaluationController`. Payload: subject resident, evaluation date, the external duty slug (`icu`, `emergency`, `dermatology`, `radiology`, `psychiatry`, `zewditu`, `saint_peter`), evaluator name, evaluator department, and the resident form fields. Writes an evaluation with `author_id = null`, `external_evaluator_name`, `external_evaluator_department`, `entered_by_id = auth id`, `placement_type = <slug>`. Until Phase 4 lands the unified table, write to `resident_evaluations` with the two new nullable columns added in a small migration; Phase 4 carries them across.

Frontend: an "Enter external evaluation" action on `src/pages/admin/academic-submissions-page.tsx`.

### 6.3 Frontend

`src/pages/academic/evaluation-form-page.tsx`:
- Subject dropdown is now whatever `formOptions` returns. No client-side filtering.
- Show the author's current placement as a read-only context line.
- Empty state when `subjects` is empty: "You have no ward or paired duty assignment covering this date. Contact your administrator." Do not render a disabled form with an empty dropdown.
- Allow back-dating within the current block; re-fetch `formOptions` when the date changes.

`src/pages/academic/academic-home-page.tsx`: show current placement and the block end date.

### 6.4 Tests (rewrite `AcademicEvaluationApiTest.php` eligibility assertions)

Peers listing returns only same-pairing-key people; a resident in Nephrology cannot evaluate a Pulmonology consultant; an OPD resident can evaluate the OPD consultant; two Transition-duty people pair only on shared days; a consultant on dialysis has no peers; back-dating to a previous rotation returns that rotation's peers, not today's; a stored evaluation keeps its ward after the author rotates; external entry requires evaluator name and rejects an `author_id`.

### 6.5 Acceptance

A resident sees only the consultants on their ward this month, and the list changes when the rotation planner moves them. Historical evaluations still display their original ward. Suite green.

---

## 7. Phase 4: Admin-editable evaluation forms, plus the analytics cache

**Goal.** One form engine for every evaluation surface, and the one scaling fix the expansion requires.

**Depends on.** Phase 1. Do this before Phase 5, which needs the student forms.

### 7.1 Build order inside the phase

1. Tables (`evaluation_forms`, `evaluation_form_fields`, `evaluations`, `evaluation_answers`).
2. `app/Services/Academic/EvaluationFormService.php`:
   - `published(string $key): EvaluationForm` (cached per request)
   - `validationRulesFor(EvaluationForm $form): array` builds Laravel rules from field types
   - `store(EvaluationForm $form, array $payload, array $context): Evaluation` writes header plus answers in one transaction
   - `createDraftFrom(EvaluationForm $form): EvaluationForm`, `publish(EvaluationForm $draft): void` (archives the prior published version, enforces exactly one published per key)
   - `assertCoreFieldsIntact(EvaluationForm $draft): void` throws when a core field was removed or type-changed
3. Seed v1 of `consultant_mdt` and `resident_acgme` **reproducing today's columns one for one, using the current column names as field keys**. This keeps every analytics key stable. Seed `student_weekly` and `student_final` as new forms.
4. Data migration copying `consultant_evaluations` and `resident_evaluations` into `evaluations` + `evaluation_answers`. Map booleans, times, integers, percents, and json multi-selects mechanically. `ward_id` comes from `ward_ref_id` (Phase 3).
5. `php artisan academic:verify-migration` command: compares row counts per form key, and deep-compares 50 random source rows against their reconstructed answers. Must print PASS before anything is dropped.
6. Repoint `AcademicEvaluationController`, both policies, `Admin\AcademicEvaluationController`, and `AcademicAnalyticsService` at the unified tables. Delete the hardcoded `MDT_PARTICIPANTS`, `SYSTEM_ISSUES`, `CONCERNS` constants and the fixed validation arrays; they now come from the form definition.
7. Keep the legacy tables read-only for one release. Drop them in a later migration once the department confirms.

### 7.2 Permission split

- `evaluationForms.editContent` (admin, superadmin): edit label, help text, sort order, option wording, activate/deactivate a **non-core** field. Applied in place on the published version.
- `evaluationForms.editStructure` (superadmin only): add or remove fields, change a key or type. Forces `createDraftFrom` + `publish`, so historical evaluations keep rendering against the version they were answered on.

This mirrors `TEMPLATES_EDIT_CONTENT` / `TEMPLATES_EDIT_STRUCTURE` exactly. Read those code paths first.

### 7.3 The analytics cache (do not defer this)

`AcademicAnalyticsService` currently has **no cache**, and moving to EAV means each per-person aggregation now folds answer rows in PHP. Add the same short content-keyed cache the clinical dashboard uses (see `app/Services/Analytics/`): key on filters plus a content stamp (max `updated_at` across `evaluations` for the filtered window), short TTL, invalidated naturally by the stamp. Add a cache-hit test.

This is the only scaling-relevant work item in the entire V2 scope. The rest of the expansion adds rows, not concurrency.

### 7.4 Frontend

- `src/components/academic/evaluation-form-renderer.tsx`: takes a published form definition, renders sections and fields by type, builds the Zod schema at runtime. One component serves all four forms.
- `evaluation-form-page.tsx` becomes a thin wrapper that picks the form key by flow and delegates.
- `src/pages/admin/evaluation-forms-page.tsx`: list forms, inline content editing, structural editor behind the superadmin permission, version history, publish. Model on `template-management-page.tsx`.
- Admin analytics label maps are deleted; labels come from the form definition.

### 7.5 Tests

Validation matrix per field type; required enforcement; version pinning (an old evaluation renders with its old labels after a structural change); content edit does not create a version, structural edit does; core field removal is rejected; `academic:verify-migration` passes on seeded data; **analytics parity**: aggregate numbers identical before and after the migration on a fixed seeded dataset; cache hit test.

### 7.6 Acceptance

An admin edits the MDT form's wording without a developer. A superadmin adds a new competency item and old evaluations still render correctly. `academic:verify-migration` prints PASS. Analytics numbers unchanged. Suite green.

---

## 8. Phase 5: Undergraduate module

**Goal.** Batches, subgroups, weekly placements, rep activity logging, consultant-recorded student attendance, weekly and final student evaluations.

**Depends on.** Phase 1 and Phase 4 (the student forms).

### 8.1 Backend

Tables per Section 3.4. Then:

`app/Services/Academic/TeachingService.php`:
- `generateSessions(CarbonInterface $date): int` upserts pending `teaching_sessions` for every active batch whose schedule matches that weekday. Cohort-scope activities produce one row (`subgroup = null`); subgroup-scope activities produce one row per subgroup, snapshotting `ward_id` from `subgroup_placements` for that week. Missing placement leaves `ward_id` null and the session still appears (admin sees it flagged). Idempotent: safe to run repeatedly.
- `record(TeachingSession $s, string $status, ?string $reason, User $by)`: `not_held` and `cancelled` both require a reason.
- `recordAttendance(TeachingSession $s, array $presence, User $by)`: writes `student_attendance` rows and flips a `pending` session to `held`.
- `rosterFor(TeachingSession $s): Collection` returns the students of the cohort or subgroup.

Scheduled command `academic:generate-teaching-sessions`, daily 00:10, `->withoutOverlapping(10)`. Also call `generateSessions` forward when an admin edits schedules or placements.

`TeachingSessionPolicy::record($user, $session)`: true when the user is an admin, **or** has an active `rep_assignments` row for `$session->batch_id` whose scope matches: `group` scope may record `lecture` and `seminar`; `subgroup_a` / `subgroup_b` may record `bedside` and `teaching_round` **only for their own subgroup**. Assert the negative in a test.

Routes:

```
GET  /api/teaching/my-sessions               permission:teachingLog.record
POST /api/teaching/sessions/{id}/record      permission:teachingLog.record
GET  /api/teaching/today                     permission:studentAttendance.record
PUT  /api/teaching/sessions/{id}/attendance  permission:studentAttendance.record

Admin, all permission:students.manage:
  apiResource /api/admin/student-batches
  apiResource /api/admin/students   (+ POST /api/admin/students/import for CSV)
  apiResource /api/admin/subgroup-placements
  apiResource /api/admin/teaching-schedules
  apiResource /api/admin/rep-assignments
  GET  /api/admin/teaching-sessions
  POST /api/admin/teaching-sessions/{id}/cancel   (reason required)
```

Student evaluations reuse the Phase 4 engine: `evaluations` with `subject_student_id`, `form_key` in (`student_weekly`, `student_final`), submitted by any consultant under the existing `academic.submit` permission. `student_weekly` pre-fills `ward_id` and `week_starts_on` from the student's subgroup placement for that week. No pairing check: the client explicitly ruled that any consultant may evaluate any student.

**One-way rule.** There is no endpoint, no form, and no permission by which a student or a rep evaluates a consultant. Do not create one.

### 8.2 Frontend

- `src/types/domain.ts`: add `student_rep` to `UserRole`.
- `src/routes/route-guards.tsx` and `src/routes/landing.ts`: `student_rep` lands on the rep log and can reach nothing else.
- `src/pages/teaching/rep-log-page.tsx`: the rep's only page. Today plus this week's sessions in their scope. One tap held / not held. Reason field appears (and is required) on not held. Nothing else on the page.
- `src/pages/academic/teaching-attendance-page.tsx`: consultant picks one of today's sessions, sees the roster, toggles present, saves.
- `src/pages/admin/students-page.tsx`: tabs for Batches, Students (with CSV import), Subgroup placements (a week grid), Rep accounts, and a Teaching sessions oversight board (held / not held with reasons / cancelled / pending).

### 8.3 Tests

Session generation is idempotent and produces the right counts for C1 (12-week batch) and C2 (8-week batch); overlapping C1 batches generate independent sessions; a group rep cannot record a bedside session; subgroup rep A cannot record subgroup B's session; `not_held` without a reason is rejected; recording attendance flips status to `held`; **a `student_rep` receives 403 on every academic evaluation endpoint** (assert against the full route list); a student weekly evaluation pre-fills the placement ward; any consultant can evaluate any student regardless of ward.

### 8.4 Acceptance

A full C1 batch can be created, split into two subgroups, given a term of weekly placements, and its three reps can log a week of activities. A consultant records attendance and submits a weekly evaluation. Reps can reach nothing else. Suite green.

---

## 9. Phase 6: Morning sessions

**Goal.** Mon/Wed/Fri attendance with punctuality against an 08:00 scheduled start.

**Depends on.** Phase 1. Independent of Phases 4 and 5, so it may be pulled earlier if the department wants it first.

### 9.1 Backend

Tables per Section 3.5. Settings keys added to the existing Settings screen under an Academic group.

`app/Services/Academic/MorningSessionService.php`:
- `openFor(CarbonInterface $date): MorningSession` creates the pending row (scheduled command `academic:open-morning-session`, 00:05 on configured days).
- `roster(CarbonInterface $date)` delegates to `RosterService::morningRosterOn`. Not materialized until recorded.
- `record(MorningSession $s, bool $onTime, ?string $actualStart, array $presence, User $by)`: computes `delay_minutes` server-side from `scheduled_start_at`, snapshots the roster into `morning_attendance`, sets status `recorded`.
- `cancel(MorningSession $s, string $reason, User $by)`.

A session left `pending` is a signal, not an error. Show it as "not recorded" in analytics rather than hiding it.

`MorningSessionPolicy::record($user, $session)`: true when the user's id is in the `academic.morning_recorder_ids` setting, or the user is an admin.

Reminder job at 08:15 on session days: if still pending, notify the recorders in-app and by email through the existing notification tiers.

Routes:

```
GET  /api/academic/morning-sessions/today        permission:morningAttendance.record
POST /api/academic/morning-sessions/{id}/record  permission:morningAttendance.record
GET  /api/admin/morning-sessions                 permission:academic.view
PATCH /api/admin/morning-sessions/{id}           permission:academic.manage
POST /api/admin/morning-sessions/{id}/cancel     permission:academic.manage
```

Same-day corrections by the recorder; after that, admin only.

### 9.2 Frontend

`src/pages/academic/morning-attendance-page.tsx`. The nav entry renders only when `isMorningRecorder` is true in the workspace payload. On-time toggle; when switched off, reveal a time input. One present toggle per roster row. Admin gets a Morning sessions tab on the academic dashboard: average delay trend, per-person attendance rate, and a log of not-recorded and cancelled sessions.

### 9.3 Tests

Roster includes a consultant on dialysis and excludes one on annual leave and one on an external rotation; include/exclude overrides apply; a non-designated user gets 403; recorded attendance is immune to a later roster change (snapshot); `started_on_time = false` requires `actual_start_at`; delay minutes computed against the setting, not the client; cancel requires a reason.

### 9.4 Acceptance

The designated recorder opens the page at 08:00 on Monday, sees the roster already built from rotations, and records in under a minute. Suite green.

---

## 10. Phase 7: Analytics, notifications, bootstrap polish

**Depends on.** Phases 2 to 6.

- Extend academic analytics (behind the Phase 4 cache) with: morning punctuality (average delay, trend) and per-person attendance rate; teaching occurrence (held rate by activity type and batch, reasons breakdown, pending backlog); student analytics (per-student attendance rate, weekly evaluation trajectory, weekly versus final comparison, per-batch rollup).
- Admin academic dashboard gains three tabs: Morning sessions, Teaching activities, Students. Person detail page gains attendance history.
- Weekly leadership digest (`SendLeadershipDigest`) gains a short academic block: morning punctuality for the week, teaching sessions held versus expected, evaluation counts.
- Notifications: transfer request lifecycle; morning recorder 08:15 reminder; rep end-of-day reminder at 17:00 for sessions still pending in their scope; admin alert on Friday when a subgroup has no placement for the coming week.
- Finish the workspace bootstrap payload (Section 3.7) and hide every new nav entry behind its flag.

**Acceptance.** No new polled endpoints. Bootstrap payload stays window-bounded. Suite green.

---

## 11. Phase 8: Deployment to the department's server

May run in parallel from Phase 1. The final cutover happens last.

### 11.1 Topology

One Ubuntu LTS box on the hospital LAN:

- nginx serves the built SPA **and** proxies `/api` to PHP-FPM 8.3. **Same origin.** This collapses the current cross-site Sanctum setup: `SANCTUM_STATEFUL_DOMAINS` and `SESSION_DOMAIN` become the single internal hostname and the CORS config goes away. Simpler than what runs today.
- MariaDB local.
- Queue, cache, sessions stay on the database driver. **Do not add Redis.** One fewer service for the department to run.
- Replace the cron-tick worker (`Schedule::command('queue:work --stop-when-empty ...')->everyMinute()`) with a systemd unit running `php artisan queue:work --tries=3 --backoff=10`, `Restart=always`. Remove the scheduled line once the unit is live.
- System cron: `* * * * * php artisan schedule:run`.
- logrotate for Laravel and nginx logs.

### 11.2 HTTPS on a LAN (required by the PWA service worker)

Preferred: a real domain (for example `im.hospital.example`) resolving to the private IP, certificate via ACME **DNS-01** (certbot DNS plugin or acme.sh), auto-renewed by cron. No inbound ports open.

Fallback: an internal CA (`step-ca` or a one-shot openssl CA), server cert in nginx, CA cert installed on department devices with a one-page guide for Android, iOS, and Windows.

### 11.3 `deploy/` directory (new, committed to the repo)

- `deploy/backup.sh` plus cron 02:00: `mysqldump --single-transaction`, gzip to `/var/backups/imreport/`, 30-day rotation, copy to a second disk or NAS mount, weekly `gunzip -t` integrity check. Document a monthly restore drill.
- `deploy/deploy.sh`: `git pull`, `composer install --no-dev --optimize-autoloader`, `php artisan migrate --force`, `config:cache route:cache view:cache`, `npm ci && npm run build` into the webroot, `php artisan queue:restart`, then a health check (`curl` the API root and expect 401, which proves the auth wall is up and the app is alive).
- `deploy/nginx.conf`, `deploy/queue-worker.service`, `deploy/ufw.sh` (allow 443 and 80-redirect **from the hospital subnet only**, SSH from the admin VLAN), fail2ban on SSH, unattended-upgrades for security patches.
- Extend `app/Console/Commands/LaunchReadinessCheck.php`: last backup fresher than 26 hours, queue worker unit active, scheduler heartbeat (a cache key the scheduler touches each run), free disk above threshold, HTTPS reachable, certificate more than 21 days from expiry, secure cookies on, `APP_URL` matches the internal hostname.
- `docs/OPERATIONS.md`: one page per task, written for a non-specialist. Restart services. Restore a backup. Renew the certificate manually. Add a device to the internal CA. Where the logs are. When to call Hospital IT.

### 11.4 Cutover

1. Stage on the server, import a fresh production dump, run the Phase 1 seed and backfill, smoke test on the LAN.
2. Freeze the old system Friday evening. Final dump, import, switch DNS or hosts. `php artisan app:launch-readiness` must be green. Go live Monday.
3. Keep the old hosting read-only for two weeks as rollback, then decommission.

### 11.5 Note on availability

Everything now depends on one box. The compensating controls are the UPS, the off-box backup copy, disk monitoring, and the rehearsed restore. In exchange, an external internet outage no longer affects the system at all, which strengthens the offline-continuity story rather than weakening it.

---

## 12. Scaling notes (what V2 does and does not change)

Rows added per year, at department scale:

| Table | Rows/year | Comment |
|---|---|---|
| `duty_assignments` | 5,000 to 7,000 | monthly rows plus daily on-call and Transition |
| `morning_attendance` | 15,000 to 25,000 | roster of 100 to 150 across ~156 sessions |
| `teaching_sessions` | 1,000 to 1,200 | |
| `student_attendance` | 15,000 to 20,000 | |
| `evaluations` | 7,000 to 9,000 | |
| `evaluation_answers` | **150,000 to 220,000** | the only high-volume addition |

Conclusions:

1. Annual row growth roughly doubles. Storage stays in the low hundreds of MB across several years. Daily dumps remain fast.
2. **No new concurrency pressure.** Peak load is still the end-of-week clinical submission deadline. The busiest new moment is 08:00 to 08:15 on session days: one recorder plus a handful of evaluation writers.
3. Eligibility queries (`peersFor`, `morningRosterOn`) are indexed range scans bounded by headcount. No caching required.
4. **The one scaling task is the academic analytics cache in Phase 4.** That path has no cache today, and EAV multiplies its PHP-side folding. Do it during Phase 4, not after.
5. The move on-premises removes the platform's historical number-one constraint (shared hosting forbidding always-on processes), and V2 spends exactly one unit of that headroom: the persistent queue worker. Redis stays a documented future option, not a dependency.

---

## 13. Definition of done

Per phase:

- [ ] `cd backend && php artisan test` fully green (129 prior tests plus the phase's new ones)
- [ ] `npm run test`, `npm run lint`, `npm run build` all clean
- [ ] Every new route has: a `permission:` middleware, a policy check in the controller, a happy-path test, a permission-denial test, and a policy-narrowing denial test
- [ ] Every administrative mutation writes an `AdminAuditLog` row
- [ ] No new polled endpoint; no per-row growth in the workspace bootstrap
- [ ] Snapshot rule upheld: nothing historical is recomputed from current assignments
- [ ] No em dashes in any string or comment

Project-wide, before go-live:

- [ ] `php artisan academic:verify-migration` prints PASS
- [ ] Analytics parity confirmed against a fixed seeded dataset, pre and post Phase 4
- [ ] A `student_rep` account receives 403 on every academic evaluation endpoint (asserted in a test, not by inspection)
- [ ] `php artisan app:launch-readiness` green on the department's server
- [ ] `docs/OPERATIONS.md` reviewed with the department administrator
- [ ] Backup restore drill performed once, successfully, from the off-box copy

---

## 14. Items to confirm with the department during the build (non-blocking)

1. Exact `departments` to `wards` mapping at data load. Assumed pairs: Cardiology + Endocrinology; Gastroenterology + Neurology; Hematology + Oncology. Singles: Nephrology, Pulmonology. Standalone: Transition.
2. Whether Transplant months pair Year 3 seniors for evaluation (assumed yes) and Dialysis does not (assumed no).
3. The three rotation calendar start dates for the current academic year. Admin enters them through the setup banner.
4. Consultant section assignments, one-time list.
5. Real headcounts for seed realism. Assumed roughly 30 to 40 residents per year, 3 to 6 consultants per section, batches of about 20 students.
