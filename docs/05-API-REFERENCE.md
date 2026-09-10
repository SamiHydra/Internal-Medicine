# 05. API reference

Every endpoint the platform exposes, derived from `backend/routes/api.php`,
with the permission it requires and the conventions that apply to all of them.
Paths are relative to `/api` unless shown in full.

## 1. Conventions

**Authentication.** Session cookie plus `X-XSRF-TOKEN` (see
[06-SECURITY-AND-AUTHORIZATION](06-SECURITY-AND-AUTHORIZATION.md)). Send
`Accept: application/json`, `X-Requested-With: XMLHttpRequest`, and an
`Origin` or `Referer` matching a stateful domain, otherwise the request is
treated as token-based and answers 401.

**Middleware on the main group.** `auth:sanctum`, `active`,
`password-changed`, `throttle:300,1`. Route-level `permission:<key>` where
listed. `GET /workspace` is exempt from the password-change gate so the
change-password screen can bootstrap.

**Input.** Every write accepts both `snake_case` and `camelCase` keys.
Booleans in query strings must be `1` or `0`. Ids are UUID strings; reference
data (templates, departments) also resolves by slug.

**Output.** camelCase JSON. Lists return `{ data: [...], meta: { currentPage,
lastPage, perPage, total } }` where paginated. Timestamps are ISO 8601 UTC.
`204` for deletes and logout.

**Errors.** `{ message }` always; `{ message, errors: { field: [..] } }` on
422; `{ message, conflict: {...} }` on 409. Full catalogue in
[reference/ERROR-CODES](reference/ERROR-CODES.md).

**Rate limits.** Login 10/min, forgot and reset 5/min, registration 10/min,
password change 6/min, client errors 20/min, authenticated 300/min per user.

## 2. Public routes (no session)

| Method | Path | Purpose | Throttle |
|---|---|---|---|
| GET | `/sanctum/csrf-cookie` | prime the XSRF cookie (204) | |
| POST | `/auth/login` | `identifier`, `password`, `remember` → session payload | 10/min |
| POST | `/auth/forgot-password` | `email` → always 202 | 5/min |
| POST | `/auth/reset-password` | `email`, `token`, `password`, `password_confirmation` | 5/min |
| POST | `/access-requests` | nurse self-registration: profile plus department/template pairs → 201 | 10/min |
| POST | `/academic-access-requests` | resident or consultant self-signup → 201 | 10/min |
| POST | `/admin-access-requests` | administrator self-signup → 201 | 10/min |
| POST | `/client-errors` | browser error report (fixed schema) | 20/min |
| GET | `/workspace/revision` | revision counter; needs the signed revision token, not the session | |
| GET | `/up` (root) | liveness, 200 when the framework boots | |

`POST /testing/flush-rate-limits` exists only when `APP_ENV=local`.

## 3. Session

| Method | Path | Notes |
|---|---|---|
| GET | `/auth/me` | session payload for rehydration; requires `active` |
| POST | `/auth/logout` | 204 |
| POST | `/auth/change-password` | `current_password`, `password`, confirmation; clears the forced-change flag; 6/min |

Session payload:

```json
{
  "user": { "id", "fullName", "email", "username", "role", "roleLabel", "title", "workspace",
            "passwordChangeRequired", "lastLoginAt", "sectionId", ... },
  "assignments": [ { "id", "nurseId", "departmentId", "departmentSlug", "departmentName",
                     "departmentFamily", "templateId", "templateSlug", "templateName",
                     "active", "approvedAt" } ],
  "permissions": [ "reports.submit", "..." ]
}
```

## 4. Workspace

| Method | Path | Notes |
|---|---|---|
| GET | `/workspace` | the SPA bootstrap: `revision`, `revisionToken`, `currentUser`, `references` (slug to id maps), `state` (assignments, periods, report shells without values, settings, notifications, templates overlay), `academic` for academic roles; flags `includeProfiles`, `includeAccessRequests`, `includeHistory`, `reportPeriodWindow=default|all` |
| GET | `/workspace/profiles` | the user directory (deferred slice) |
| GET | `/workspace/access-requests` | pending requests (deferred slice) |
| POST | `/performance/rum` | sampled, content-free browser timings |

## 5. Clinical reports

No permission string; authorization is by policy and by the submission
service's ownership check.

| Method | Path | Who | Notes |
|---|---|---|---|
| GET | `/reports` | any active user | role-scoped summaries (no values); nurses see own active assignments, roles without clinical access get an empty page; filters `assignmentId`, `reportingPeriodId`, `periodIds`, `reportPeriodWindow`, `page`, `perPage` (max 300) |
| GET | `/reporting-periods` | any | newest first, paginated |
| POST | `/reports` | assigned nurse, admin | create or upsert for `assignmentId` + `reportingPeriodId`; body `values`, optional `submit`, optional `expectedUpdatedAt` (`null` = expect no report); 201, or 409 on conflict, 422 for a future week or invalid values |
| GET | `/reports/details?ids=a,b,c` | viewers of each | up to 100 full reports in one call |
| GET | `/reports/status-history` | any | the caller's visible history rows, newest first |
| GET | `/reports/{id}` | viewer | full report with values, metrics, quality |
| PUT | `/reports/{id}` | assigned nurse, admin; not while locked | `values`, optional `submit`, `expectedUpdatedAt` |
| POST | `/reports/{id}/submit` | assigned nurse, admin; not while locked | optional `values`; stamps `submitted_at` once |
| POST | `/reports/{id}/lock` | admin | 200 with the report; idempotent |
| POST | `/reports/{id}/unlock` | admin | restores the pre-lock status; idempotent |
| GET | `/reports/{id}/comments` | viewer | |
| POST | `/reports/{id}/comments` | viewer | `body`; allowed while locked |
| DELETE | `/reports/{id}/comments/{comment}` | author or admin | |

Report response shape:

```json
{ "id", "assignmentId", "departmentId", "departmentSlug", "departmentName", "templateId",
  "templateSlug", "templateName", "reportingPeriodId", "status", "submittedAt", "lockedAt",
  "createdById", "updatedById", "createdAt", "updatedAt",
  "values": { "<fieldKey>": { "fieldId", "dailyValues": { "monday": 30, "...": "..." } } },
  "calculatedMetrics": { "borPercent", "btr", "alos", "payload" },
  "quality": { "completeness": { "expectedCells", "filledCells", "missingCells", "percent" },
               "errors": [], "warnings": [] } }
```

Conflict response (409):

```json
{ "message": "...", "conflict": { "reason": "stale" | "exists",
  "report": { "id", "status", "lockedAt", "updatedAt", "updatedById", "updatedByName", "values": {...} } } }
```

## 6. Notifications (`permission:notifications.view`)

| Method | Path | Notes |
|---|---|---|
| GET | `/notifications` | filters `type`, `unread`, `limit` (max 200); admins may pass `recipient_id` |
| PATCH | `/notifications/read` | `ids[]` |
| PATCH | `/notifications/read-all` | |
| DELETE | `/notifications` | `ids[]` |
| POST | `/notifications/restore` | re-creates up to 50 of the caller's own cleared rows |

## 7. Analytics (`permission:analytics.view`)

| Method | Path | Notes |
|---|---|---|
| GET | `/analytics/overview`, `/dashboard`, `/inpatient`, `/outpatient`, `/procedures` | KPI summaries; filters `periodId`, `week`, `month`, `year`, `dateFrom`, `dateTo`, `department`, `ward`, `family`, `reportType`, `procedureCategory` |
| GET | `/analytics/weekly`, `/monthly`, `/quarterly`, `/yearly` | `{ scope, data }` series |
| GET | `/analytics/departments`, `/wards` | per-department summaries (`wards` forces inpatient) |
| GET | `/analytics/exports/scope` | report count and limit for a filter set |
| POST | `/analytics/exports` | `format` csv or xlsx, `dateFrom`, `dateTo`, filters → 202 with the export id |
| GET | `/analytics/exports` | the caller's exports |
| GET | `/analytics/exports/{id}/download` | owner only (403 otherwise); 409 not ready, 410 expired, 404 missing |

## 8. Academic (residents and consultants)

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/academic/form-options?date=` | `academic.submit` | eligible subjects for the date from the roster |
| POST | `/academic/consultant-evaluations` | `academic.submit` | resident evaluates a consultant |
| POST | `/academic/resident-evaluations` | `academic.submit` | consultant evaluates a resident |
| GET | `/academic/my-submissions`, `/my-performance` | `academic.submit` | |
| GET | `/academic/evaluation-forms/{key}` | `academic.submit` | the published form definition |
| GET | `/academic/students` | `academic.submit` | students placed with the consultant |
| POST | `/academic/student-evaluations` | `academic.submit` | weekly or final |
| GET | `/academic/morning-sessions/today` | `morningAttendance.record` | with `canRecord` |
| POST | `/academic/morning-sessions/{id}/record`, `/cancel` | `morningAttendance.record` | designated recorder, same day |
| GET | `/academic/transfer-requests/options`, `/mine` | `transfers.create` | consultants |
| POST | `/academic/transfer-requests`, `/{id}/cancel` | `transfers.create` | |
| GET | `/academic/analytics/snapshot`, `/summary`, `/trend`, `/people`, `/morning`, `/teaching`, `/students` | `academic.view` | administrators |

## 9. Teaching

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/teaching/my-sessions` | `teachingLog.record` | the representative's sessions |
| POST | `/teaching/sessions/{id}/record` | `teachingLog.record` | `held` boolean, `reason` required when not held |
| GET | `/teaching/today` | `studentAttendance.record` | consultant's sessions today |
| PUT | `/teaching/sessions/{id}/attendance` | `studentAttendance.record` | per-student presence |

## 10. Administration (`/admin`)

| Area | Routes | Permission |
|---|---|---|
| Administrator requests | `GET admin-access-requests`, `POST .../{id}/approve`, `/reject` | `admins.approve` |
| Users | `GET users`, `POST users`, `GET users/{id}`, `PATCH users/{id}`, `PATCH users/{id}/active`, `POST users/{id}/reset-password`, `DELETE users/{id}` (deactivate) | `users.view` / `users.manage`; creating an admin also needs `admins.manage` |
| Assignments | `GET/POST assignments`, `PATCH/DELETE assignments/{id}` (delete deactivates; create upserts and re-activates) | `assignments.manage` |
| Templates | `GET/POST templates`, `GET/PATCH templates/{id}`, `PATCH templates/{id}/active`, `PATCH templates/{id}/fields/{field}/active`, `DELETE templates/{id}` (blocked when referenced) | `templates.manage`; structural edits check `templates.editStructure` |
| Departments | `GET/POST departments`, `GET/PATCH departments/{id}`, `PATCH .../active`, `DELETE` (blocked when referenced), `GET wards` | `departments.manage` |
| Settings | `GET settings`, `PUT/PATCH settings` | `settings.manage` |
| Nurse access requests | `GET access-requests`, `GET .../{id}`, `PATCH .../{id}/review`, `POST .../approve`, `/reject` | `accessRequests.review` |
| Audit | `GET audit-logs` (cell edits), `GET admin-audit-logs`; filters by report, department, actor, entity, action, date; `limit` max 500 | `audit.view` |
| Import | `GET reports/import-template?period=&department=&format=`, `POST reports/import` (file) | `reports.import` |
| Action items | `GET/POST action-items`, `GET/PATCH action-items/{id}`, `POST .../comments`, `POST .../evidence`, `GET .../evidence/{id}/download`, `DELETE .../evidence/{id}` | `actionItems.view` / `actionItems.manage` |
| Alert rules | `GET/POST clinical-alert-rules`, `PATCH/DELETE clinical-alert-rules/{id}` | `actionItems.view` / `actionItems.manage` |
| System health | `GET system-health` | `system.health` (Maintenance) |
| Academic evaluations | `GET academic/evaluations`, `GET academic/audit`, `POST academic/external-evaluations` | `academic.view` / `academic.manage` |
| Evaluation forms | `GET academic/evaluation-forms`, `PATCH .../{id}/content` | `evaluationForms.editContent` |
| | `POST academic/evaluation-forms/{key}/draft`, `PUT .../{id}/structure`, `POST .../{id}/publish` | `evaluationForms.editStructure` (Maintenance) |
| Academic structure | wards, sections, duty types: list, create, update, delete; `POST sections/{id}/set-consultant` | `academicStructure.manage` (`roster.manage` for set-consultant) |
| Rotations | `GET/POST rotations/calendars`, `PATCH .../{id}/active`, `GET/POST rotations/{calendar}/plan` | `rotations.manage` |
| Transfers | `GET transfer-requests`, `POST .../{id}/approve` (optional `effectiveOn`), `/reject` | `transfers.review` |
| Morning sessions | `GET morning-sessions`, `PATCH .../{id}`, `POST .../{id}/cancel`, `GET/POST morning-roster-overrides`, `DELETE .../{id}` | `academic.view` / `academic.manage` |
| Undergraduate | `student-batches`, `students` (+ `import`), `subgroup-placements`, `teaching-schedules` (+ `active`), `rep-assignments` (+ `active`), `GET teaching-sessions`, `POST teaching-sessions/{id}/cancel` | `students.manage` |
| Duty roster | `GET/PUT roster/{year}/{month}`, `POST roster/daily` | `roster.manage` |

## 11. Where to look for payload details

The TypeScript declarations in `src/lib/api/types.ts` are the client-side
contract for every response shape; the controllers' inline `validate()` calls
are the input contract. Feature tests under `backend/tests/Feature` show a
working request for every route (`WorkspaceApiTest`, `ReportWorkflowTest`,
`AdminApiTest`, `AcademicEvaluationApiTest`, `UndergraduateModuleTest`,
`MorningSessionTest`, `SectionTransferTest`, `RotationPlannerTest`,
`ActionItemTest`, `AnalyticsExportTest`, `ReportImportTest`).
