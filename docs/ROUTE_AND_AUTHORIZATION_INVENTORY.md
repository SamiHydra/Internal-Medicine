# Route and Authorization Inventory

Audit date: 2026-07-12  
Evidence: `php artisan route:list -v`, `php artisan route:list --json`, `backend/routes/api.php`, `src/App.tsx`, `Permissions.php`, policies, middleware, controllers, jobs, and `routes/console.php`.

## Summary

| Inventory | Count |
|---|---:|
| All registered Laravel routes | 166 |
| Application API routes under `/api` | 160 |
| Public API routes | 6 |
| Sanctum-authenticated API routes | 154 |
| Frontend explicit non-wildcard paths | 36 |
| Frontend wildcard path | 1 |
| Permission constants | 37 |
| Role keys | 6 |
| Policy files | 27, including one shared concern |
| Scheduled entries | 16, including queue health and the conditional queue worker entry |
| Queue job classes | 4 |

## Backend route middleware model

Follow-on executable evidence: an automated anonymous-request audit exercised all 154 routes carrying `auth:sanctum`; all 154 returned `401` and none reached controller validation or model lookup first. Correct-role, wrong-role, and object-level matrices remain incomplete. See `EXECUTABLE_VERIFICATION_RESULTS.md`.

The main protected API group applies:

1. `auth:sanctum`.
2. `active` (`EnsureActiveUser`).
3. `password-changed` (`EnsurePasswordChanged`).
4. `throttle:300,1`.
5. Per-route permission middleware where listed below.
6. Controller policy authorization for object-level or action-level narrowing where implemented.

`/api/workspace` removes only `password-changed` so the SPA can display the forced-password-change state. Login and public registration routes use tighter rate limits. `SecurityHeaders` is appended globally. Middleware aliases are `active`, `password-changed`, `permission`, and `role`.

## Backend API routes

All paths below are registered. A blank permission means the route relies on Sanctum plus controller policy or service checks instead of coarse permission middleware.

### Public and authentication routes

| Method | Path | Controller action | Authentication / permission |
|---|---|---|---|
| POST | `/api/access-requests` | `AccessRequestSubmissionController@store` | Public, throttle 10/min |
| POST | `/api/academic-access-requests` | `AcademicRegistrationController@store` | Public, throttle 10/min |
| POST | `/api/admin-access-requests` | `AdminRegistrationController@store` | Public, throttle 10/min |
| POST | `/api/auth/login` | `AuthController@login` | Public, throttle 10/min |
| POST | `/api/auth/forgot-password` | `PasswordResetController@forgot` | Public, throttle 5/min |
| POST | `/api/auth/reset-password` | `PasswordResetController@reset` | Public, throttle 5/min |
| GET | `/api/auth/me` | `AuthController@me` | Sanctum + active |
| POST | `/api/auth/logout` | `AuthController@logout` | Sanctum |
| POST | `/api/auth/change-password` | `AuthController@changePassword` | Sanctum + active |
| GET | `/api/workspace` | `WorkspaceController@show` | Sanctum + active |

### Clinical reports and comments

| Method | Path | Controller action | Permission / policy |
|---|---|---|---|
| GET | `/api/reports` | `ReportWorkflowController@index` | Report scoping in controller/policy |
| POST | `/api/reports` | `ReportWorkflowController@store` | `ReportPolicy@create` |
| GET | `/api/reports/details` | `ReportWorkflowController@details` | Report scoping |
| GET | `/api/reports/{report}` | `ReportWorkflowController@show` | `ReportPolicy@view` |
| PUT | `/api/reports/{report}` | `ReportWorkflowController@update` | `ReportPolicy@update` |
| POST | `/api/reports/{report}/submit` | `ReportWorkflowController@submit` | `ReportPolicy@submit` |
| POST | `/api/reports/{report}/lock` | `ReportWorkflowController@lock` | `ReportPolicy@lock` |
| POST | `/api/reports/{report}/unlock` | `ReportWorkflowController@unlock` | `ReportPolicy@unlock` |
| GET | `/api/reports/{report}/comments` | `ReportCommentController@index` | Parent report authorization |
| POST | `/api/reports/{report}/comments` | `ReportCommentController@store` | Parent report authorization |
| DELETE | `/api/reports/{report}/comments/{comment}` | `ReportCommentController@destroy` | Author or admin narrowing |

### Notifications

| Method | Path | Controller action | Permission |
|---|---|---|---|
| GET | `/api/notifications` | `NotificationController@index` | `notifications.view` |
| PATCH | `/api/notifications/read` | `NotificationController@markRead` | `notifications.view` |
| PATCH | `/api/notifications/read-all` | `NotificationController@markAllRead` | `notifications.view` |
| DELETE | `/api/notifications` | `NotificationController@destroy` | `notifications.view` |
| POST | `/api/notifications/restore` | `NotificationController@restore` | `notifications.view` |

`NotificationPolicy` further scopes individual notification access to the recipient.

### Clinical analytics

All 12 routes use `AnalyticsController` and require `analytics.view`.

| Method | Paths |
|---|---|
| GET | `/api/analytics/overview`, `/dashboard`, `/inpatient`, `/outpatient`, `/procedures`, `/weekly`, `/monthly`, `/quarterly`, `/yearly`, `/departments`, `/wards`, `/export` |

### Academic evaluation and analytics

| Method | Path | Controller action | Permission / policy |
|---|---|---|---|
| GET | `/api/academic/form-options` | `AcademicEvaluationController@formOptions` | `academic.submit`; pairing logic |
| POST | `/api/academic/consultant-evaluations` | `AcademicEvaluationController@storeConsultantEvaluation` | `academic.submit`; consultant-evaluation policy |
| POST | `/api/academic/resident-evaluations` | `AcademicEvaluationController@storeResidentEvaluation` | `academic.submit`; resident-evaluation policy |
| GET | `/api/academic/my-submissions` | `AcademicEvaluationController@mySubmissions` | `academic.submit`; self scope |
| GET | `/api/academic/my-performance` | `AcademicEvaluationController@myPerformance` | `academic.submit`; self scope |
| GET | `/api/academic/evaluation-forms/{key}` | `AcademicEvaluationController@form` | `academic.submit` |
| GET | `/api/academic/students` | `AcademicEvaluationController@students` | `academic.submit`; consultant narrowing |
| POST | `/api/academic/student-evaluations` | `AcademicEvaluationController@storeStudentEvaluation` | `academic.submit`; consultant narrowing |
| GET | `/api/academic/analytics/summary` | `AcademicAnalyticsController@summary` | `academic.view` |
| GET | `/api/academic/analytics/trend` | `AcademicAnalyticsController@trend` | `academic.view` |
| GET | `/api/academic/analytics/people` | `AcademicAnalyticsController@people` | `academic.view` |
| GET | `/api/academic/analytics/morning` | `AcademicOperationsAnalyticsController@morning` | `academic.view` |
| GET | `/api/academic/analytics/teaching` | `AcademicOperationsAnalyticsController@teaching` | `academic.view` |
| GET | `/api/academic/analytics/students` | `AcademicOperationsAnalyticsController@students` | `academic.view` |
| GET | `/api/academic/morning-sessions/today` | `MorningSessionController@today` | `morningAttendance.record`; designated-recorder policy |
| POST | `/api/academic/morning-sessions/{morningSession}/record` | `MorningSessionController@record` | `morningAttendance.record`; designated-recorder policy |
| GET | `/api/academic/transfer-requests/options` | `TransferRequestController@formOptions` | `transfers.create` |
| POST | `/api/academic/transfer-requests` | `TransferRequestController@store` | `transfers.create`; consultant policy |
| GET | `/api/academic/transfer-requests/mine` | `TransferRequestController@mine` | `transfers.create`; self scope |
| POST | `/api/academic/transfer-requests/{transferRequest}/cancel` | `TransferRequestController@cancel` | `transfers.create`; owner and pending policy |

### Undergraduate teaching routes

| Method | Path | Controller action | Permission / policy |
|---|---|---|---|
| GET | `/api/teaching/my-sessions` | `TeachingSessionController@mySessions` | `teachingLog.record`; representative scope |
| POST | `/api/teaching/sessions/{teachingSession}/record` | `TeachingSessionController@record` | `teachingLog.record`; representative scope and cutoff |
| GET | `/api/teaching/today` | `TeachingSessionController@today` | `studentAttendance.record` |
| PUT | `/api/teaching/sessions/{teachingSession}/attendance` | `TeachingSessionController@attendance` | `studentAttendance.record`; teaching-session policy |

### Administration: access, users, and clinical reference data

| Method(s) | Path | Controller | Permission |
|---|---|---|---|
| GET | `/api/admin/admin-access-requests` | `AdminAccessRequestController@index` | `admins.approve` |
| POST | `/api/admin/admin-access-requests/{adminAccessRequest}/approve` | `AdminAccessRequestController@approve` | `admins.approve` |
| POST | `/api/admin/admin-access-requests/{adminAccessRequest}/reject` | `AdminAccessRequestController@reject` | `admins.approve` |
| GET, POST | `/api/admin/users` | `UserController@index/store` | `users.view` / `users.manage` |
| GET, PATCH, DELETE | `/api/admin/users/{user}` | `UserController@show/update/destroy` | `users.view` / `users.manage` |
| PATCH | `/api/admin/users/{user}/active` | `UserController@setActive` | `users.manage` |
| POST | `/api/admin/users/{user}/reset-password` | `UserController@resetPassword` | `users.manage` |
| GET, POST | `/api/admin/assignments` | `ReportAssignmentController@index/store` | `assignments.manage` |
| PATCH, DELETE | `/api/admin/assignments/{assignment}` | `ReportAssignmentController@update/destroy` | `assignments.manage` |
| GET, POST | `/api/admin/templates` | `ReferenceDataController@templates/storeTemplate` | `templates.manage` |
| GET, PATCH, DELETE | `/api/admin/templates/{template}` | `ReferenceDataController@showTemplate/updateTemplate/destroyTemplate` | `templates.manage` |
| PATCH | `/api/admin/templates/{template}/active` | `ReferenceDataController@setTemplateActive` | `templates.manage` |
| PATCH | `/api/admin/templates/{template}/fields/{field}/active` | `ReferenceDataController@setFieldActive` | `templates.manage` |
| GET, POST | `/api/admin/departments` | `ReferenceDataController@departments/storeDepartment` | `departments.manage` |
| GET, PATCH, DELETE | `/api/admin/departments/{department}` | `ReferenceDataController@showDepartment/updateDepartment/destroyDepartment` | `departments.manage` |
| PATCH | `/api/admin/departments/{department}/active` | `ReferenceDataController@setDepartmentActive` | `departments.manage` |
| GET | `/api/admin/wards` | `ReferenceDataController@wards` | `departments.manage` |
| GET, PUT, PATCH | `/api/admin/settings` | `SettingsController@show/update` | `settings.manage` |
| GET | `/api/admin/access-requests` | `AccessRequestController@index` | `accessRequests.review` |
| GET | `/api/admin/access-requests/{accessRequest}` | `AccessRequestController@show` | `accessRequests.review` |
| PATCH | `/api/admin/access-requests/{accessRequest}/review` | `AccessRequestController@review` | `accessRequests.review` |
| POST | `/api/admin/access-requests/{accessRequest}/approve` | `AccessRequestController@approve` | `accessRequests.review` |
| POST | `/api/admin/access-requests/{accessRequest}/reject` | `AccessRequestController@reject` | `accessRequests.review` |
| GET | `/api/admin/audit-logs` | `AuditLogController@cellEdits` | `audit.view` |
| GET | `/api/admin/admin-audit-logs` | `AuditLogController@adminActions` | `audit.view` |
| GET | `/api/admin/reports/import-template` | `ReportImportController@template` | `reports.import` |
| POST | `/api/admin/reports/import` | `ReportImportController@import` | `reports.import` |
| GET, POST | `/api/admin/action-items` | `ActionItemController@index/store` | `actionItems.view` / `actionItems.manage` |
| PATCH | `/api/admin/action-items/{actionItem}` | `ActionItemController@update` | `actionItems.manage` |

### Administration: academic evaluations and form versions

| Method | Path | Controller action | Permission |
|---|---|---|---|
| GET | `/api/admin/academic/evaluations` | `Admin\AcademicEvaluationController@index` | `academic.view` |
| GET | `/api/admin/academic/audit` | `Admin\AcademicEvaluationController@audit` | `academic.view` |
| POST | `/api/admin/academic/external-evaluations` | `Admin\AcademicEvaluationController@storeExternal` | `academic.manage` |
| GET | `/api/admin/academic/evaluation-forms` | `EvaluationFormController@index` | `evaluationForms.editContent` |
| PATCH | `/api/admin/academic/evaluation-forms/{evaluationForm}/content` | `EvaluationFormController@updateContent` | `evaluationForms.editContent` |
| POST | `/api/admin/academic/evaluation-forms/{key}/draft` | `EvaluationFormController@storeDraft` | `evaluationForms.editStructure` |
| PUT | `/api/admin/academic/evaluation-forms/{evaluationForm}/structure` | `EvaluationFormController@updateStructure` | `evaluationForms.editStructure` |
| POST | `/api/admin/academic/evaluation-forms/{evaluationForm}/publish` | `EvaluationFormController@publish` | `evaluationForms.editStructure` |

### Administration: academic structure, roster, rotations, and transfers

| Method(s) | Path | Controller | Permission |
|---|---|---|---|
| GET, POST | `/api/admin/academic/wards` | `AcademicStructureController@wards/storeWard` | `academicStructure.manage` |
| PATCH, DELETE | `/api/admin/academic/wards/{ward}` | `AcademicStructureController@updateWard/destroyWard` | `academicStructure.manage` |
| GET, POST | `/api/admin/academic/sections` | `AcademicStructureController@sections/storeSection` | `academicStructure.manage` |
| PATCH, DELETE | `/api/admin/academic/sections/{section}` | `AcademicStructureController@updateSection/destroySection` | `academicStructure.manage` |
| POST | `/api/admin/academic/sections/{section}/set-consultant` | `AcademicStructureController@setSectionConsultant` | `roster.manage` |
| GET, POST | `/api/admin/academic/duty-types` | `AcademicStructureController@dutyTypes/storeDutyType` | `academicStructure.manage` |
| PATCH, DELETE | `/api/admin/academic/duty-types/{dutyType}` | `AcademicStructureController@updateDutyType/destroyDutyType` | `academicStructure.manage` |
| GET, PUT | `/api/admin/roster/{year}/{month}` | `DutyRosterController@month/saveMonth` | `roster.manage` |
| POST | `/api/admin/roster/daily` | `DutyRosterController@saveDaily` | `roster.manage` |
| GET, POST | `/api/admin/rotations/calendars` | `RotationController@calendars/storeCalendar` | `rotations.manage` |
| PATCH | `/api/admin/rotations/calendars/{calendar}/active` | `RotationController@setCalendarActive` | `rotations.manage` |
| GET, POST | `/api/admin/rotations/{calendar}/plan` | `RotationController@plan/savePlan` | `rotations.manage` |
| GET | `/api/admin/transfer-requests` | `Admin\TransferRequestController@index` | `transfers.review`; head/admin scope |
| POST | `/api/admin/transfer-requests/{transferRequest}/approve` | `Admin\TransferRequestController@approve` | `transfers.review`; destination-head/admin policy |
| POST | `/api/admin/transfer-requests/{transferRequest}/reject` | `Admin\TransferRequestController@reject` | `transfers.review`; destination-head/admin policy |

### Administration: morning and undergraduate modules

| Method(s) | Path | Controller | Permission |
|---|---|---|---|
| GET | `/api/admin/morning-sessions` | `MorningSessionController@index` | `academic.view` |
| PATCH | `/api/admin/morning-sessions/{morningSession}` | `MorningSessionController@update` | `academic.manage` |
| POST | `/api/admin/morning-sessions/{morningSession}/cancel` | `MorningSessionController@cancel` | `academic.manage` |
| GET, POST | `/api/admin/morning-roster-overrides` | `MorningSessionController@overrides/storeOverride` | `academic.view` / `academic.manage` |
| DELETE | `/api/admin/morning-roster-overrides/{override}` | `MorningSessionController@destroyOverride` | `academic.manage` |
| GET, POST | `/api/admin/student-batches` | `UndergraduateAdminController@batches/storeBatch` | `students.manage` |
| PATCH | `/api/admin/student-batches/{batch}` | `UndergraduateAdminController@updateBatch` | `students.manage` |
| GET, POST | `/api/admin/students` | `UndergraduateAdminController@students/storeStudent` | `students.manage` |
| POST | `/api/admin/students/import` | `UndergraduateAdminController@importStudents` | `students.manage` |
| PATCH | `/api/admin/students/{student}` | `UndergraduateAdminController@updateStudent` | `students.manage` |
| GET, POST | `/api/admin/subgroup-placements` | `UndergraduateAdminController@placements/storePlacement` | `students.manage` |
| DELETE | `/api/admin/subgroup-placements/{placement}` | `UndergraduateAdminController@destroyPlacement` | `students.manage` |
| GET | `/api/admin/teaching-schedules` | `UndergraduateAdminController@schedules` | `students.manage` |
| PATCH | `/api/admin/teaching-schedules/{schedule}/active` | `UndergraduateAdminController@setScheduleActive` | `students.manage` |
| GET, POST | `/api/admin/rep-assignments` | `UndergraduateAdminController@repAssignments/storeRepAssignment` | `students.manage` |
| PATCH | `/api/admin/rep-assignments/{repAssignment}/active` | `UndergraduateAdminController@setRepAssignmentActive` | `students.manage` |
| GET | `/api/admin/teaching-sessions` | `UndergraduateAdminController@sessions` | `students.manage` |
| POST | `/api/admin/teaching-sessions/{teachingSession}/cancel` | `UndergraduateAdminController@cancelSession` | `students.manage` |

## Frontend routes

| Path | Component / behavior | Client guard |
|---|---|---|
| `/` | Role-aware home redirect | Public bootstrap |
| `/login` | Login | Public |
| `/forgot-password` | Forgot password | Public |
| `/reset-password` | Reset password | Public |
| `/register` | Access or academic registration | Public |
| `/change-password` | Forced password change | Authenticated |
| `/notifications` | Notifications | Any authenticated role |
| `/admin/notifications` | Notifications alias | Any authenticated role |
| `/reports/:assignmentId/:periodId` | Clinical report form | Any authenticated role; API policy is authoritative |
| `/academic` | Academic home | Resident or consultant |
| `/academic/submit` | Evaluation form | Resident or consultant |
| `/academic/history` | Personal academic history | Resident or consultant |
| `/academic/morning` | Morning attendance | Resident or consultant route; API policy narrows recorder |
| `/academic/teaching` | Student attendance | Consultant |
| `/teaching` | Representative activity log | Student representative |
| `/nurse` | Nurse dashboard | Nurse |
| `/nurse/reports` | Nurse report selection | Nurse |
| `/nurse/activity` | Nurse activity | Nurse |
| `/admin` | Clinical admin dashboard | Admin or superadmin |
| `/admin/academic` | Academic admin dashboard | Admin or superadmin |
| `/admin/academic/submissions` | Academic submissions | Admin or superadmin |
| `/admin/academic/structure` | Wards, sections, duty types | Admin or superadmin |
| `/admin/academic/roster` | Duty roster | Admin or superadmin |
| `/admin/academic/rotations` | Rotation planner | Admin or superadmin |
| `/admin/academic/evaluation-forms` | Form editor | Admin or superadmin; API distinguishes content and structure permissions |
| `/admin/academic/students` | Undergraduate administration | Admin or superadmin |
| `/admin/academic/people/:userId` | Academic person detail | Admin or superadmin |
| `/admin/departments/:departmentId` | Department detail | Admin or superadmin |
| `/admin/submissions` | Clinical submission board | Admin or superadmin |
| `/admin/users` | User administration | Admin or superadmin |
| `/admin/manual-admin-setup` | Manual admin setup | Admin or superadmin |
| `/admin/templates` | Clinical template management | Admin or superadmin |
| `/admin/action-items` | Action items | Admin or superadmin |
| `/admin/import` | Clinical import | Admin or superadmin |
| `/admin/audit` | Audit log | Admin or superadmin |
| `/admin/settings` | Settings | Admin or superadmin |
| `*` | Not found | Public fallback |

Frontend route guards are navigation controls only. Backend permission middleware and policies remain the authorization boundary.

## Roles and permission mappings

Role keys are `superadmin` (labelled Maintenance), `admin`, `nurse`, `resident`, `consultant`, and `student_rep`.

### Permission catalog

`auth.viewSelf`, `users.view`, `users.manage`, `admins.manage`, `admins.approve`, `departments.manage`, `templates.manage`, `templates.editContent`, `templates.editStructure`, `assignments.manage`, `accessRequests.create`, `accessRequests.review`, `reports.viewAssigned`, `reports.viewAny`, `reports.submit`, `reports.lock`, `reports.import`, `analytics.view`, `audit.view`, `settings.manage`, `actionItems.view`, `actionItems.manage`, `notifications.view`, `academic.submit`, `academic.view`, `academic.manage`, `academicStructure.manage`, `roster.manage`, `rotations.manage`, `evaluationForms.editContent`, `evaluationForms.editStructure`, `morningAttendance.record`, `teachingLog.record`, `studentAttendance.record`, `students.manage`, `transfers.create`, `transfers.review`.

### Role map summary

| Role | Effective permission profile |
|---|---|
| `superadmin` | All administrative, reporting, analytics, audit, academic, roster, rotation, form-content, form-structure, teaching, student, morning, and transfer-review permissions. It does not carry ordinary `academic.submit` or `transfers.create`. |
| `admin` | Administrative profile comparable to superadmin, but no `admins.manage`, template structure, or evaluation-form structure permission. |
| `nurse` | Self, access-request creation, assigned reports, report submission, notifications. |
| `resident` | Self, academic submission, morning recording coarse permission. |
| `consultant` | Self, academic submission, transfer create/review, student attendance, morning recording coarse permission. Transfer review and morning recording are narrowed by policy. |
| `student_rep` | Self, notifications, and teaching log only. It has no academic submit, view, manage, analytics, attendance, or score permission. |

Inactive users receive no permissions. `Gate::before` also denies inactive users.

## Policies and model relationships

### Explicit Gate registrations

- `AccessRequest` -> `AccessRequestPolicy`.
- `AccessRequestItem` -> `AccessRequestItemPolicy`.
- `AdminAccessRequest` -> `AdminAccessRequestPolicy`.
- `AdminAuditLog` -> `AdminAuditLogPolicy`.
- `AppSetting` -> `AppSettingPolicy`.
- `AuditLog` -> `AuditLogPolicy`.
- `CalculatedMetric` -> `CalculatedMetricPolicy`.
- `ConsultantEvaluation` -> `ConsultantEvaluationPolicy`.
- `Department`, `ReportFieldDefinition`, `ReportingPeriod`, and `ReportTemplate` -> shared `ReferenceDataPolicy`.
- `Notification` -> `NotificationPolicy`.
- `Report` -> `ReportPolicy`.
- `ReportAssignment` -> `ReportAssignmentPolicy`.
- `ReportFieldValue` -> `ReportFieldValuePolicy`.
- `ReportStatusHistory` -> `ReportStatusHistoryPolicy`.
- `ResidentEvaluation` -> `ResidentEvaluationPolicy`.
- `Role` -> `RolePolicy`.
- `User` -> `UserPolicy`.

### Convention-discovered policy classes present

`DutyTypePolicy`, `DutyAssignmentPolicy`, `EvaluationFormPolicy`, `MorningSessionPolicy`, `RotationCalendarPolicy`, `SectionPolicy`, `TeachingSessionPolicy`, `TransferRequestPolicy`, and `WardPolicy` follow Laravel model-policy naming. Runtime registration for these convention-discovered policies was inferred from Laravel discovery and passing policy-backed tests, but was not separately dumped from the Gate registry.

Important object-level narrowing includes report assignment ownership, notification recipient ownership, destination-section-head transfer decisions, designated morning recorder checks, representative batch/subgroup scope, student-attendance recording, and superadmin account lockout protections.

## Scheduled commands

All schedules inherit the application timezone, currently UTC. No schedule specifies a timezone explicitly.

| Schedule | Command / callback | Overlap protection |
|---|---|---|
| Hourly | `reports:sync-overdue` | 10-minute mutex expiry |
| Daily 00:15 | `academic:apply-section-transfers` | 10-minute mutex expiry |
| Daily 00:10 | `academic:generate-teaching-sessions` | 10-minute mutex expiry |
| Daily 00:05 | `academic:open-morning-session` | 10-minute mutex expiry |
| Daily 08:15 | `academic:remind-morning-recorder` | 10-minute mutex expiry |
| Daily 17:00 | `academic:remind-reps` | 10-minute mutex expiry |
| Friday 10:00 | `academic:check-placements` | 10-minute mutex expiry |
| Hourly | `reports:send-reminders` | 10-minute mutex expiry |
| Sunday 00:05 | `reports:ensure-periods` | 10-minute mutex expiry |
| Monday 07:00 | `reports:send-digest` | 10-minute mutex expiry |
| Every minute | Scheduler heartbeat cache callback | Named event, no overlap mutex |
| Every minute | `queue:monitor-health --json` | 10-minute mutex expiry |
| Every minute when worker mode is not daemon | `queue:work --stop-when-empty --max-time=50 --queue=analytics,notifications,default` | 10-minute mutex expiry |
| Hourly | `queue:retry all` | 10-minute mutex expiry |
| Daily | `queue:prune-failed --hours=720` | None declared |
| Sunday 01:00 | `reports:prune-notifications` | 10-minute mutex expiry |

## Queue inventory

- `WarmDashboardAnalytics`, `WarmAcademicAnalytics`, and `BuildAnalyticsExport`
  use the `analytics` queue. `BuildAnalyticsExport` has a 300-second timeout.
- `SendNotificationDelivery`, `PasswordResetMail`, and `LeadershipDigestMail`
  use the `notifications` queue. Delivery jobs record failure state and handle
  email and SMS delivery.
- The local runtime uses the database queue; PHPUnit uses synchronous queues.
- Production uses two systemd units with `--tries=3 --backoff=10
  --max-time=3600`: one consumes `analytics,default`, and one consumes
  `notifications,default`.
- The shared-host scheduler fallback consumes
  `analytics,notifications,default`; hourly `queue:retry all` retries all
  failed jobs.
- `queue:monitor-health --json` reports per-queue depth and oldest database-job
  age, and exits non-zero when a configured threshold is exceeded.

## Administrative mutation inventory

Administrative write operations include:

- Admin access approval and rejection.
- User create, update, activation/deactivation, password reset, and delete.
- Clinical report-assignment create, update, and delete.
- Clinical template create, content update, activation, field activation, and delete.
- Department create, update, activation, and delete.
- Settings update.
- Access-request review, approval, and rejection.
- Clinical report import.
- Action-item create and update.
- External evaluation entry.
- Evaluation form content edit, draft creation, structural edit, and publish.
- Academic ward, section, and duty-type create, update, and delete.
- Direct section consultant assignment.
- Rotation calendar create/activation and plan save.
- Transfer approve and reject.
- Morning-session update/cancel and roster-override create/delete.
- Student batch create/update, student create/update/import, placement create/delete, schedule activation, representative assignment create/activation, and teaching-session cancel.
- Monthly and daily roster saves.

`AdminAuditService`, clinical `AuditLog`, and module-specific audit calls are present. Atomicity of every mutation plus its audit row has not been executable-verified. Transfer approval, rejection, application, and related audit/notification side effects are not contained in one transaction.
