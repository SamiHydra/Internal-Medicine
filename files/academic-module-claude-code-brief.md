# Claude Code brief — "Academic" evaluations module

This adds a new **Academic** section to the St Paul Internal Medicine app: residents and consultants log in and submit short evaluations about each other after MDT rounds, and admins see the trends — overall, per ward, and per individual.

**Before you write anything:** read `docs/ARCHITECTURE.md` end to end, then open the reference files named in each step. This feature is the "How to Add a Feature" playbook (the Incident-Reports recipe), just larger, plus two new roles. The access-request flow (`AccessRequestController`, `access-request-page.tsx`) and the admin analytics dashboard (`AnalyticsController`, `admin-dashboard-page.tsx`, `department-detail-page.tsx`) are the closest existing patterns — mirror them.

## Locked design decisions (do not deviate)

- **Parallel module, NOT another `report_template`.** Evaluations are dated events (many per day per subject), not weekly reports. Do **not** touch `reports`, `report_templates`, `report_assignments`, `reporting_periods`, the overdue cron, or `ReportCalculationService`.
- **Two new roles:** `resident` (interns folded in) and `consultant`. Both log in, both self-submit, both are subjects of evaluations. Neither is admin-like.
- **Author and subject are both `users`** — plain FKs. No separate roster table.
- **Two evaluation tables**, named by who is evaluated:
  - `consultant_evaluations` = evaluations **of** a consultant, filled by a resident (this is the existing "IM daily MDT round form").
  - `resident_evaluations` = evaluations **of** a resident, filled by a consultant.
- **Ward on every evaluation** (`ward_id` FK → `departments`, required). This is the analytical source of truth and is rotation-proof. A separate optional `home_ward_id` on `users` is for pre-filling the form and labelling rosters only — analytics never depend on it.
- **No drafts, no locking, no lifecycle.** Submit-and-done. Only admins can edit/delete (via `academic.manage`).
- **Scores are computed on read**, never stored. The "round-quality score" and "resident performance score" are just the % of that row's yes/no items marked yes.
- **Dashboards are admin-only** (superadmin / admin / doctor_admin) behind `academic.view`. Residents/consultants get only the submission page (plus, optionally, their own submission history).
- **Multi-select answers are JSON columns** on the evaluation, expanded/counted in PHP by the analytics service. (Upgrade path if DB-level filtering by issue is ever needed: promote to child tables — not now.)

## Golden rule

Do the **backend first** and make the PHPUnit feature test (Stage 2) pass **before** touching the frontend. Each stage below ends with a verification gate — do not proceed past a failing gate.

---

## The two forms (field specs)

### Form 1 — Consultant evaluation (resident fills, about a consultant) — REAL, from the existing MDT form

Header: `evaluation_date` (date, required) · `ward_id` (required) · subject = the consultant/senior (user picker, required) · `senior_present` (bool, required) · `senior_joined_at` (time) · `presence_minutes` (int).

Round-quality yes/no items (these six form the score): `all_patients_reviewed`, `mgmt_plan_documented`, `vte_assessed`, `discharge_discussed`, `med_review_done`, `critical_labs_reviewed`.

Other: `pct_patients_seen` (int 0–100) · `round_delayed` (bool).

Multi-selects (JSON): `mdt_participants` (consultant, fellow, internist, residents, interns, nurse, clinical_pharmacy) · `system_issues` (lab_delay, imaging_delay, staff_shortage, bed_issue, emr_interruption, communication_issue).

### Form 2 — Resident evaluation (consultant fills, about a resident) — finalized; tweak labels freely

Header: `evaluation_date` (date, required) · `ward_id` (required) · subject = the resident (user picker, required).

Performance yes/no items — each is "met expectations this round"; the ten together form the score (grouped by ACGME competency):
- attendance / professionalism — `on_time` (present & on time), `professional` (professional conduct)
- preparation / patient care — `prepared` (knew patients; list & overnight events updated), `management_plan` (appropriate, prioritized plan)
- medical knowledge — `clinical_reasoning` (sound assessment & differential)
- communication — `presentation_clear` (case presentation clear & concise), `communication` (effective with team / nursing / patient)
- documentation / systems — `documentation_timely` (notes & orders complete and timely), `follow_through` (completed tasks; chased results & referrals)
- practice-based learning — `responsive_feedback` (receptive to feedback & teaching)

Other: `overall_rating` (int 1–5; 1 = well below expectations, 5 = excellent) · `comment` (text, optional).

Multi-select (JSON): `concerns` — areas to improve (punctuality, preparation, medical_knowledge, clinical_reasoning, documentation, communication, professionalism, follow_through, time_management).

> The score for each form = (yes/no items marked true) ÷ (total yes/no items) × 100. Compute it **on read** — the serializer returns it as `qualityScore` (Form 1) / `performanceScore` (Form 2), and the analytics service uses the same formula. Never persist it.

---

## Field & validation reference

These rules feed **both** the Laravel inline validator (Stage 2) and the Zod schema (Stage 3) — keep them identical. The backend accepts snake_case and camelCase keys; the tables use the snake_case column name.

**Form 1 — consultant evaluation**

| Field | Kind | Rules | Required |
|---|---|---|:--:|
| evaluation_date | date | a date, not in the future | ✓ |
| ward_id | uuid | exists in `departments` | ✓ |
| subject_id | uuid | exists in `users`; role = `consultant` | ✓ |
| senior_present | bool | — | ✓ |
| senior_joined_at | time | `HH:MM` | — |
| presence_minutes | int | 0–600 | — |
| all_patients_reviewed, mgmt_plan_documented, vte_assessed, discharge_discussed, med_review_done, critical_labs_reviewed | bool | — | ✓ |
| pct_patients_seen | int | 0–100 | — |
| round_delayed | bool | — | ✓ |
| mdt_participants | string[] | each ∈ {consultant, fellow, internist, residents, interns, nurse, clinical_pharmacy} | — |
| system_issues | string[] | each ∈ {lab_delay, imaging_delay, staff_shortage, bed_issue, emr_interruption, communication_issue} | — |
| comment | string | max 2000 | — |

**Form 2 — resident evaluation**

| Field | Kind | Rules | Required |
|---|---|---|:--:|
| evaluation_date | date | a date, not in the future | ✓ |
| ward_id | uuid | exists in `departments` | ✓ |
| subject_id | uuid | exists in `users`; role = `resident` | ✓ |
| on_time, prepared, presentation_clear, clinical_reasoning, management_plan, documentation_timely, communication, professional, responsive_feedback, follow_through | bool | — | ✓ |
| overall_rating | int | 1–5 | ✓ |
| concerns | string[] | each ∈ {punctuality, preparation, medical_knowledge, clinical_reasoning, documentation, communication, professionalism, follow_through, time_management} | — |
| comment | string | max 2000 | — |

The store endpoints must also reject a **direction/role mismatch**: only a `resident` may submit Form 1 (subject must be a `consultant`); only a `consultant` may submit Form 2 (subject must be a `resident`).

---

## STAGE 1 — Backend: data model, roles, permissions, policies

### 1.1 Migrations (`backend/database/migrations/`, timestamp after the latest existing migration)

Follow the conventions in `docs/ARCHITECTURE.md` → Data Model: UUID PKs + `HasUuids`, `foreignUuid(...)->constrained(...)`, and indexes on what you query.

- **`add_home_ward_to_users`** — add nullable `home_ward_id` uuid FK → `departments` (`nullOnDelete`).
- **`create_consultant_evaluations_table`:**
  - `id` uuid PK
  - `author_id` uuid FK → users (**restrictOnDelete** — referenced users are deactivated, never hard-deleted)
  - `subject_id` uuid FK → users (**restrictOnDelete**)
  - `ward_id` uuid FK → departments (**restrictOnDelete**, NOT NULL)
  - `evaluation_date` date (NOT NULL)
  - `senior_present` boolean · `senior_joined_at` time nullable · `presence_minutes` integer nullable
  - `all_patients_reviewed`, `mgmt_plan_documented`, `vte_assessed`, `discharge_discussed`, `med_review_done`, `critical_labs_reviewed` — all boolean
  - `pct_patients_seen` unsignedTinyInteger nullable · `round_delayed` boolean
  - `mdt_participants` json nullable · `system_issues` json nullable
  - `comment` text nullable
  - `timestamps()`
  - indexes: `(subject_id, evaluation_date)`, `(ward_id, evaluation_date)`, `(evaluation_date)`
- **`create_resident_evaluations_table`:** same envelope (`id`, `author_id`, `subject_id`, `ward_id`, `evaluation_date` + same FK/index rules), plus `on_time`, `prepared`, `presentation_clear`, `clinical_reasoning`, `management_plan`, `documentation_timely`, `communication`, `professional`, `responsive_feedback`, `follow_through` (booleans), `overall_rating` unsignedTinyInteger, `concerns` json nullable, `comment` text nullable, `timestamps()`.

Run `php artisan migrate`.

### 1.2 Models (`backend/app/Models/`)

- `ConsultantEvaluation`, `ResidentEvaluation` — copy the shape of `AccessRequest.php`: `use HasUuids;`, `$fillable`, `casts()` (booleans → `boolean`, `evaluation_date` → `date`, json columns → `array`, `senior_joined_at` → `datetime:H:i` or string). Relations: `author()`, `subject()` → `User`; `ward()` → `Department` (all `belongsTo`).
- Update `User`: add `home_ward_id` to `$fillable` and a `homeWard()` `belongsTo(Department::class, 'home_ward_id')`.

### 1.3 Roles + permissions

- **`RoleSeeder`** — add `resident` ("Resident") and `consultant` ("Consultant"). Idempotent like the existing rows.
- **`Permissions.php`** — add three constants and grant them in `ROLE_PERMISSIONS`:
  ```php
  public const ACADEMIC_SUBMIT = 'academic.submit';
  public const ACADEMIC_VIEW   = 'academic.view';
  public const ACADEMIC_MANAGE = 'academic.manage';
  ```
  Grants: `resident` → `[auth.viewSelf, academic.submit]`; `consultant` → `[auth.viewSelf, academic.submit]`; add `academic.view` and `academic.manage` to the **superadmin / admin / doctor_admin** arrays. Leave `ADMIN_ROLES` unchanged (resident/consultant are not admin-like). (`Permissions::all()` auto-registers each as a Gate in `AppServiceProvider::boot()`.)
- **`AuthController` `sessionPayload`/`defaultTitle`** — map `resident` → "Resident", `consultant` → "Consultant".

### 1.4 Policies (`backend/app/Policies/`)

`ConsultantEvaluationPolicy` and `ResidentEvaluationPolicy`, both `use HandlesDomainAuthorization;`:
- `viewAny`/`update`/`delete` → `isAdminLike($user)`.
- `view` → `isAdminLike($user) || $eval->author_id === $user->id || $eval->subject_id === $user->id`.
- `create` → `$user->active` (the direction/role match is enforced in the controller — see 2.1).

**Register both** in `AppServiceProvider::boot()` with `Gate::policy(...)`. (`Gate::before` already denies inactive users.)

### Gate 1: `php artisan migrate` clean, `composer dump-autoload` clean. No frontend yet.

---

## STAGE 2 — Backend: controllers, serializer, analytics, routes, tests

### 2.1 Submission controller (`backend/app/Http/Controllers/Api/AcademicEvaluationController.php`)

Non-admin (resident/consultant). Validate inline (accept snake_case **and** camelCase, per the codebase convention). `Gate::authorize('create', ...)` at the top of each store.

- `formOptions(Request)` → `{ subjects: [...], wards: [...] }`. `subjects` = active users of the **opposite** role to the caller (a resident gets consultants; a consultant gets residents), each `{ id, fullName, homeWardId }`. `wards` = active inpatient `departments` `{ id, name, slug }`.
- `storeConsultantEvaluation(Request)` — **reject unless the caller's role is `resident`** (422 or 403) and the chosen subject's role is `consultant`. Set `author_id = $request->user()->id`. Validate all Form 1 fields; `ward_id` required; multi-selects validated against their allowed value lists. Return the serialized record, 201.
- `storeResidentEvaluation(Request)` — mirror, caller must be `consultant`, subject must be `resident`, Form 2 fields.
- `mySubmissions(Request)` (optional) — the caller's own evaluations, newest first.

### 2.2 Admin listing controller (`backend/app/Http/Controllers/Api/Admin/AcademicEvaluationController.php`)

Copy `AccessRequestController.php`; `use SerializesAdminResources`. `Gate::authorize('viewAny', ...)`.
- `index(Request)` — paginated raw list for tables and the per-person detail page. Filters: `direction` (`consultant`|`resident` → which table), `subjectId`, `wardId`, `dateFrom`, `dateTo`. Returns camelCase under a `data` key.

### 2.3 Serializer — add to `SerializesAdminResources`

`serializeConsultantEvaluation()` and `serializeResidentEvaluation()`: camelCase keys, `loadMissing(['author','subject','ward'])`, include `authorName`/`subjectName`/`wardName`, booleans via `(bool)`, dates via `?->toJSON()`, json columns passed through as arrays. **The frontend types in 3.2 must mirror these exactly.**

### 2.4 Analytics service + filters (`backend/app/Services/Academic/`)

Mirror `Analytics\AnalyticsService` + `AnalyticsFilters`:
- `AcademicAnalyticsFilters` (immutable VO, `fromArray` accepting snake+camel): `direction`, `wardId`, `subjectId`, `dateFrom`, `dateTo`, `granularity` (`weekly`|`monthly`).
- `AcademicAnalyticsService` with a request-scoped query memo. Methods:
  - `summary(filters)` → counts, average score (% of yes/no items true, across the filtered rows), `seniorPresenceRate` (consultant direction) / `avgOverallRating` (resident direction), `avgPctSeen`, plus **per-indicator compliance** (the % true for each yes/no field) and **issue/concern frequency** (expand the JSON columns in PHP and count → Pareto data).
  - `trend(filters)` → time series bucketed by `evaluation_date` into weeks or months: average score + evaluation count per bucket.
  - `people(filters)` → per-subject aggregates for the leaderboard/comparison: `{ subjectId, subjectName, homeWardName, evaluationCount, averageScore, ... }`.

### 2.5 Analytics controller (`backend/app/Http/Controllers/Api/AcademicAnalyticsController.php`)

Thin façade over the service (mirror `AnalyticsController`). Each action validates filters into the VO. `summary`, `trend`, `people`.

### 2.6 Routes (`backend/routes/api.php`)

Inside the existing `['auth:sanctum','active']` group:
```php
Route::prefix('academic')->group(function (): void {
    Route::get('/form-options',            [AcademicEvaluationController::class, 'formOptions'])->middleware('permission:academic.submit');
    Route::post('/consultant-evaluations', [AcademicEvaluationController::class, 'storeConsultantEvaluation'])->middleware('permission:academic.submit');
    Route::post('/resident-evaluations',   [AcademicEvaluationController::class, 'storeResidentEvaluation'])->middleware('permission:academic.submit');
    Route::get('/my-submissions',          [AcademicEvaluationController::class, 'mySubmissions'])->middleware('permission:academic.submit');

    Route::get('/analytics/summary', [AcademicAnalyticsController::class, 'summary'])->middleware('permission:academic.view');
    Route::get('/analytics/trend',   [AcademicAnalyticsController::class, 'trend'])->middleware('permission:academic.view');
    Route::get('/analytics/people',  [AcademicAnalyticsController::class, 'people'])->middleware('permission:academic.view');
});
// inside the existing admin prefix block:
Route::get('/admin/academic/evaluations', [Admin\AcademicEvaluationController::class, 'index'])->middleware('permission:academic.view');
```
Two-layer authz on purpose: `permission:` on the route, `Gate::authorize` in the action. Keep both.

### 2.7 Feature test (`backend/tests/Feature/AcademicEvaluationApiTest.php`)

Copy the `WorkspaceApiTest`/`AdminApiTest` pattern (`use RefreshDatabase`, seed roles, seed a ward department). Build a resident, a consultant, an admin. Assert:
- Resident **can** `POST /api/academic/consultant-evaluations` → `assertCreated()`, `assertJsonPath` on a saved field.
- Consultant **cannot** post a consultant-evaluation (wrong direction) → forbidden/422.
- Consultant **can** post a resident-evaluation; resident cannot.
- Admin **can** `GET /api/academic/analytics/summary` → `assertOk()`; resident **cannot** → `assertForbidden()`.
- `GET /api/academic/form-options` returns the opposite role's users.

### Gate 2: `php artisan test` green. Do not start the frontend until this passes.

---

## STAGE 3 — Frontend: plumbing + the submission experience

### 3.1 Roles, routing, landing

- `src/types/domain.ts` → `UserRole` add `'resident' | 'consultant'`.
- **Fix the landing logic** (this is a real gotcha): in `HomeRedirect` (App.tsx) and `ProtectedRoute`'s role-redirect (`route-guards.tsx`), the current `role === 'nurse' ? '/nurse' : '/admin'` would misroute the new roles to `/admin`. Replace with a switch: `nurse → /nurse`, `resident | consultant → /academic`, admin-like → `/admin`.

### 3.2 API client + types

- `src/lib/api/academic.ts` — `fetchAcademicFormOptions`, `submitConsultantEvaluation`, `submitResidentEvaluation`, `fetchMySubmissions`, `fetchAcademicSummary`, `fetchAcademicTrend`, `fetchAcademicPeople`, `listAcademicEvaluations`. Each takes `LaravelApiClient` first; use `client.get/post` with `/api/...` paths (copy `reports.ts`/`access-requests.ts`).
- **Add `export * from '@/lib/api/academic'` to `src/lib/api/index.ts`** (keep alphabetical; **never** let the barrel pull in `realtime.ts`).
- `src/lib/api/types.ts` — payload types (`SaveConsultantEvaluationPayload`, `SaveResidentEvaluationPayload`) and response types (`AcademicFormOptions`, `AcademicSummary`, `AcademicTrendPoint`, `AcademicPersonStat`, `ConsultantEvaluationRecord`, `ResidentEvaluationRecord`) — **camelCase, matching the API payload shapes section exactly.**

Evaluation data does **not** join `AppState` — do not modify `createEmptyAppState`. The academic pages fetch via the client directly with `useEffect` + local state. Get the client the same way the admin analytics views already do (find how `AdminDashboardPage` obtains its client / calls `fetchAnalytics`) and mirror it; guard for a null client.

### 3.3 Submission page (`src/pages/academic/evaluation-form-page.tsx`, route `/academic`)

Role-aware: a `resident` sees the **consultant-evaluation** form (Form 1); a `consultant` sees the **resident-evaluation** form (Form 2). Build with **Zod + react-hook-form** (copy the schema/`zodResolver` from `access-request-page.tsx`; copy the per-field input patterns from `report-form.tsx`'s `FieldInput`). On mount, call `fetchAcademicFormOptions` to populate the subject picker and ward picker. On submit → the matching client call → `toast.success` → reset the form. Optionally render a "My recent submissions" list from `fetchMySubmissions`.

Match the design system exactly: page = `space-y-8` of `#eef2f6` section panels; blue uppercase eyebrow + `font-display` heading; `components/ui` primitives (`Select` for pickers, `Input`/`Textarea`, `Checkbox`/`Switch` for yes/no, `<input type="time">`); squared corners, no pills; blue primary / gold accent buttons.

### 3.4 Nav (`src/config/navigation.ts`)

- Add `resident` and `consultant` keys to `navigationByRole`, each with a single item: `{ label: 'Submit evaluation', href: '/academic', icon: ClipboardCheck }`.
- Add to the **superadmin / admin / doctor_admin** arrays: `{ label: 'Academic', href: '/admin/academic', icon: GraduationCap }`. Import the icons.

### 3.5 Routes (`src/App.tsx`)

- Lazy-load the submission page; route `/academic` inside a guard `<ProtectedRoute roles={['resident','consultant']} />`, `renderLazyRoute(..., 'inline')`.
- (Admin pages added in Stage 4.)

### Gate 3: `npm run verify` (lint + vitest + build) green. Log in as a seeded resident and consultant and submit one of each evaluation; confirm rows land in the DB.

---

## STAGE 4 — Frontend: admin dashboards + per-person detail

### 4.1 Academic dashboard (`src/pages/admin/academic-dashboard-page.tsx`, route `/admin/academic`)

Model the composition on `admin-dashboard-page.tsx`:
- `AdminPageHero` + a **`ReportingScopePanel`** filter bar: Direction (consultant evaluations / resident evaluations), Ward, Time range, optional specific person; plus a Weekly/Monthly segmented toggle. Reuse `ReportingScopePanel` — do not hand-roll a filter UI.
- KPI tiles (the 4-up tone-tile pattern): evaluation count · average score · senior-presence rate (consultant direction) or average overall rating (resident direction) · average % patients seen.
- **Score trend** — `ChartCard` + recharts `AreaChart`/`LineChart` from `fetchAcademicTrend`.
- **Per-indicator compliance** — each yes/no field's % true (small bars or a multi-series chart) from `summary`.
- **Issues / concerns Pareto** — recharts `BarChart` from `summary`.
- **Per-person comparison / leaderboard** — grid-as-table or `BarChart` from `fetchAcademicPeople`, each row linking to the detail page.

Use the restrained blue / navy / gold / steel chart palette and the white-gradient chart panels already used on the admin dashboard.

### 4.2 Per-person detail (`src/pages/admin/academic-person-detail-page.tsx`, route `/admin/academic/people/:userId`)

Model on `department-detail-page.tsx`: `PageHeader` + `ReportingScopePanel` (date range, ward) + 4-up summary + a `2xl:grid-cols-[1.35fr_1fr]` layout with the person's **score trend** (`LineChart`) beside the dark **`InsightPanel`**, then their indicator breakdown, a **recent evaluations** list (date · ward · author · score), and their issues/concerns. Drive it from `listAcademicEvaluations` (filtered by `subjectId`) plus the analytics endpoints. Works for both consultants and residents.

### 4.3 Routes (`src/App.tsx`)

Lazy-load both pages and add their `<Route>`s **inside the existing admin guard** `<Route element={<ProtectedRoute roles={['superadmin','admin','doctor_admin']} />}>`, each wrapped in `renderLazyRoute(..., 'inline')`.

### Gate 4: `npm run verify` green. Run both servers; as an admin, click through `/admin/academic` and a person detail page, exercising the Direction / Ward / Time-range filters.

---

## API payload shapes (the backend ⇄ frontend contract)

All responses are **camelCase**; requests accept snake_case or camelCase. The serializer **computes and includes** `qualityScore` / `performanceScore` (never persisted). The Stage 3 frontend types must mirror these exactly.

**GET `/api/academic/form-options`** — `subjects` = the opposite role to the caller
```json
{
  "subjects": [{ "id": "uuid", "fullName": "Dr. A. Tesfaye", "homeWardId": "uuid|null", "homeWardName": "Cardiology|null" }],
  "wards": [{ "id": "uuid", "name": "Cardiology", "slug": "cardiology" }]
}
```

**POST `/api/academic/consultant-evaluations`** — request body
```json
{ "evaluationDate":"2026-05-20","wardId":"uuid","subjectId":"uuid","seniorPresent":true,
  "seniorJoinedAt":"08:15","presenceMinutes":45,"allPatientsReviewed":true,"mgmtPlanDocumented":true,
  "vteAssessed":true,"dischargeDiscussed":false,"medReviewDone":true,"criticalLabsReviewed":true,
  "pctPatientsSeen":80,"roundDelayed":false,"mdtParticipants":["consultant","residents","nurse"],
  "systemIssues":["lab_delay"],"comment":null }
```

**Serialized consultant evaluation** — 201 response, and each item in the admin list
```json
{ "id":"uuid","authorId":"uuid","authorName":"...","subjectId":"uuid","subjectName":"...",
  "wardId":"uuid","wardName":"Cardiology","evaluationDate":"2026-05-20T00:00:00.000000Z",
  "seniorPresent":true,"seniorJoinedAt":"08:15","presenceMinutes":45,
  "allPatientsReviewed":true,"mgmtPlanDocumented":true,"vteAssessed":true,"dischargeDiscussed":false,
  "medReviewDone":true,"criticalLabsReviewed":true,"pctPatientsSeen":80,"roundDelayed":false,
  "mdtParticipants":["consultant","residents","nurse"],"systemIssues":["lab_delay"],"comment":null,
  "qualityScore":83.3,"createdAt":"...","updatedAt":"..." }
```
The resident evaluation mirrors this with the Form-2 booleans, `overallRating` (1–5), `concerns`, and `performanceScore` instead of `qualityScore`.

**GET `/api/academic/analytics/summary?direction=consultant&wardId=&subjectId=&dateFrom=&dateTo=`**
```json
{ "direction":"consultant","evaluationCount":42,"averageScore":81.5,
  "seniorPresenceRate":0.93,"avgPctSeen":78.2,
  "indicatorCompliance":[{ "key":"vteAssessed","label":"VTE risk assessed","pct":88.1 }],
  "issueFrequency":[{ "value":"lab_delay","label":"Lab delay","count":12 }] }
```
For `direction=resident`: replace `seniorPresenceRate`/`avgPctSeen` with `avgOverallRating`, and `issueFrequency` is keyed on `concerns`.

**GET `/api/academic/analytics/trend?direction=&granularity=weekly|monthly&...`**
```json
{ "direction":"consultant","granularity":"weekly",
  "points":[{ "bucket":"2026-W18","start":"2026-04-27","averageScore":80.0,"count":7 }] }
```

**GET `/api/academic/analytics/people?direction=&wardId=&dateFrom=&dateTo=`**
```json
{ "direction":"consultant",
  "people":[{ "subjectId":"uuid","subjectName":"...","homeWardName":"Cardiology","evaluationCount":9,"averageScore":84.4 }] }
```

**GET `/api/admin/academic/evaluations?direction=&subjectId=&wardId=&dateFrom=&dateTo=&page=`** → `{ "data": [ <serialized records> ], "meta": { ...pagination... } }`

---

## Cross-cutting gotchas checklist (verify each before declaring done)

1. **`useMemo` deps** — only relevant if any academic mutation is added to `AppDataContext`. The submission flow is page-level, so likely no context change. If you do add a handler, it must appear in **both** the `value` object **and** that `useMemo`'s dependency array.
2. **Barrel re-export** — add `academic.ts` to `src/lib/api/index.ts`; **never** pull in `realtime.ts`.
3. **camelCase contract** — the backend serializer/analytics emit camelCase; the `types.ts`/`domain.ts` shapes must match exactly. Controllers accept snake **and** camel on input; responses are camelCase.
4. **Two-layer authz** — `permission:` middleware on every route **and** `Gate::authorize` in every action.
5. **New-role plumbing complete** — `UserRole` type, `sessionPayload`/`defaultTitle` titles, `RoleSeeder`, the landing redirect switch, `navigationByRole` entries for the new roles, and `ProtectedRoute` guards on the academic routes.
6. **Frontend role guards are UX only** — the backend permissions are the real gate. Don't rely on the route guard for security.
7. **Boolean query params** serialize as `1`/`0` automatically via the client — don't send `"true"`/`"false"`.
8. **Ward is required on submit** and is the analytic source of truth; `home_ward_id` is display/pre-fill only.
9. **Reuse, don't rebuild** — `ReportingScopePanel`, `ChartCard`, `InsightPanel`, the tone-tile/section-panel patterns, the chart palette. Squared corners, never pills.

## Suggested seed for local testing (optional)

Extend `DevUserSeeder` (already guarded against production/testing) to create a couple of `resident` users, a couple of `consultant` users with a `home_ward_id`, and a handful of evaluations across two or three wards spread over the last several weeks — enough to make the trend and Pareto charts render with real shape.
