# Roles and permissions

The complete permission model, derived from
`backend/app/Support/Authorization/Permissions.php`, the route table and the
policies. The matrix is static code: nothing at runtime can grant a role a
permission it does not hold here.

## The six roles

| Role key | Label | Workspace | How the account comes to exist |
|---|---|---|---|
| `superadmin` | Maintenance | both | `php artisan app:create-superadmin` on the server; refuses if one exists |
| `admin` | Admin | both | Created by Maintenance (`admins.manage`), or approved from the administrator self-signup queue (`admins.approve`) |
| `nurse` | Nurse | clinical | Self-registration (inactive until approved) or created by an administrator |
| `resident` | Resident | academic | Academic self-signup, approved by an administrator; carries section and training year |
| `consultant` | Consultant | academic | Academic self-signup, approved by an administrator; carries section |
| `student_rep` | Student representative | academic | Created by an administrator only |

Per-role permission counts: superadmin 34, admin 30, nurse 5, resident 4,
consultant 7, student representative 3. Inactive accounts hold none.

## The permission matrix

Y = granted. The last column names where the permission is enforced beyond
the route middleware.

| Permission | Maint. | Admin | Nurse | Resident | Consultant | Rep | Narrowed by |
|---|:-:|:-:|:-:|:-:|:-:|:-:|---|
| `auth.viewSelf` | Y | Y | Y | Y | Y | Y | session payload only |
| `users.view` | Y | Y | | | | | `UserPolicy` |
| `users.manage` | Y | Y | | | | | `UserPolicy` (admins cannot edit admins) |
| `admins.manage` | Y | | | | | | `UserPolicy::createAdmin` |
| `admins.approve` | Y | Y | | | | | `AdminAccessRequestPolicy` |
| `departments.manage` | Y | Y | | | | | `ReferenceDataPolicy` |
| `templates.manage` | Y | Y | | | | | `ReferenceDataPolicy` |
| `templates.editContent` | Y | Y | | | | | in-controller check |
| `templates.editStructure` | Y | | | | | | in-controller check |
| `assignments.manage` | Y | Y | | | | | `ReportAssignmentPolicy` |
| `accessRequests.create` | | | Y | | | | public route (any active user may request more) |
| `accessRequests.review` | Y | Y | | | | | `AccessRequestPolicy` |
| `reports.viewAssigned` | | | Y | | | | `ReportPolicy::view`, list scoping |
| `reports.viewAny` | Y | Y | | | | | `ReportPolicy` |
| `reports.submit` | Y | Y | Y | | | | `ReportPolicy::update/submit`, service ownership |
| `reports.lock` | Y | Y | | | | | `ReportPolicy::lock/unlock` |
| `reports.import` | Y | Y | | | | | none beyond middleware |
| `analytics.view` | Y | Y | | | | | export download is owner-only |
| `audit.view` | Y | Y | | | | | `AuditLogPolicy` |
| `settings.manage` | Y | Y | | | | | `AppSettingPolicy` |
| `actionItems.view` | Y | Y | | | | | none beyond middleware |
| `actionItems.manage` | Y | Y | | | | | none beyond middleware |
| `notifications.view` | Y | Y | Y | Y | Y | Y | `NotificationPolicy` (own rows) |
| `academic.submit` | | | | Y | Y | | evaluation policies, roster eligibility |
| `academic.view` | Y | Y | | | | | `isAdminLike` |
| `academic.manage` | Y | Y | | | | | `MorningSessionPolicy::manage` |
| `academicStructure.manage` | Y | Y | | | | | ward, section, duty-type policies |
| `roster.manage` | Y | Y | | | | | `DutyAssignmentPolicy` |
| `rotations.manage` | Y | Y | | | | | `RotationCalendarPolicy` |
| `evaluationForms.editContent` | Y | Y | | | | | `EvaluationFormPolicy` |
| `evaluationForms.editStructure` | Y | | | | | | `EvaluationFormPolicy::editStructure` |
| `morningAttendance.record` | Y | Y | | Y | Y | | `MorningSessionPolicy`: designated recorder, same day |
| `teachingLog.record` | Y | Y | | | | Y | `TeachingSessionPolicy`: representative scope |
| `studentAttendance.record` | Y | Y | | | Y | | `TeachingSessionPolicy` |
| `students.manage` | Y | Y | | | | | `TeachingSessionPolicy::manage` |
| `transfers.create` | | | | | Y | | `TransferRequestPolicy` (own requests) |
| `transfers.review` | Y | Y | | | Y | | `TransferRequestPolicy`: destination section head |
| `system.health` | Y | | | | | | Maintenance only |

The four abilities that separate Maintenance from an administrator:
`admins.manage`, `templates.editStructure`, `evaluationForms.editStructure`,
`system.health`.

## What each role can reach

### Maintenance
Everything an administrator can, plus creating administrators directly,
structural edits to report templates and evaluation forms (draft, structure,
publish), and the system-health page and endpoint. The only role that can
deactivate an administrator. Cannot itself be deactivated or demoted through
the application.

### Administrator
Both workspaces. Users and access (create nurses and student representatives,
approve every kind of request, deactivate non-admin accounts, reset
passwords), assignments, departments and wards, template content edits,
submissions, lock and unlock, comments, action items, alert rules, evidence,
imports, exports, analytics, audit logs, settings, academic structure, roster,
rotations, transfer decisions, morning-session administration, students,
batches, schedules, representative assignments, external evaluations.

### Nurse
Own dashboard, own assignments' reports (draft, save, submit, edit after
submission while unlocked), comments on own reports, request more access,
own notifications, own activity. Nothing administrative or academic.

### Resident
Academic home, submit consultant evaluations for eligible subjects, own
history and performance, the morning-session page (recording only when
designated), own notifications and transfer-free profile.

### Consultant
As resident for the resident-evaluation direction, plus student evaluations,
today's teaching attendance, transfer requests (create, view own, cancel),
and, when head of a section, deciding transfers into that section.

### Student representative
The activity log only: today's and recent teaching sessions within the
representative's scope, recorded as held or not held with a reason. Every
evaluation, report, analytics and administrative route answers 403; the
report list answers 200 with no rows.

## Designations that are data, not roles

| Designation | Where it lives | Set by | Grants |
|---|---|---|---|
| Morning recorder | academic settings `morningRecorderIds` | `settings.manage` | recording and cancelling today's morning session |
| Section head | `sections.head_user_id` (must be an active consultant) | `academicStructure.manage` | deciding transfers into that section |
| Representative scope | `rep_assignments.scope` (`group`, `subgroup_a`, `subgroup_b`) | `students.manage` | which activity types and subgroup the representative may log |

## Route groups without a permission string

Fifteen routes rely on policies alone: `auth/me`, `logout`, `change-password`,
`workspace` and its sub-lists, the performance sample endpoint, and the report
routes (`GET/POST /reports`, `details`, `status-history`, show, update, submit,
lock, unlock, comments). Each calls `Gate::authorize` or the submission
service's ownership check.

## Verifying the matrix

`tests/regression/authorization-matrix.spec.ts` requests every route as every
role (194 routes x 7 identities, 1,052 requests) and compares the answer with
the expectation derived from the route middleware and the session payload;
the last run reported 0 unexpected 2xx and 0 mismatches. Backend:
`AuthorizationTest`, `RoleTransitionAuthorizationTest`, `UndergraduateModuleTest`.
