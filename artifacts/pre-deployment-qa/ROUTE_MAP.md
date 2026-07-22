# Route Map

Source of truth: `src/App.tsx`, `src/routes/route-guards.tsx`, `src/config/navigation.ts`, `src/routes/landing.ts`, `backend/routes/api.php`, `backend/bootstrap/app.php`. Machine-readable copies: `_raw/static-routes-frontend.json`, `_raw/static-routes-backend.json`.

Landing per role (`landing.ts`): nurse → `/nurse`; resident/consultant → `/academic`; admin/superadmin → `/admin`.

---

## Frontend routes (29)

### Public (no auth)
| Path | Component | Notes |
|------|-----------|-------|
| `/` | HomeRedirect | Auth-state dispatcher → `/login`, `/change-password`, or role landing |
| `/login` | LoginPage | Eager-loaded. Does not redirect already-authed users away at route level |
| `/forgot-password` | ForgotPasswordPage | |
| `/reset-password` | ResetPasswordPage | token/email via query string |
| `/register` | AccessRequestPage | Public self-signup (clinical/academic/admin tracks) |

### Authenticated — any role (under `ProtectedRoute` + `ProtectedShell`)
| Path | Component | Notes |
|------|-----------|-------|
| `/change-password` | ForcePasswordChangePage | Outside AppShell; reachable when `passwordChangeRequired` |
| `/notifications` | NotificationsPage | |
| `/admin/notifications` | NotificationsPage | Same component; **not** role-restricted despite `/admin` prefix (shared path) |
| `/reports/:assignmentId/:periodId` | ReportFormPage | Nurse fills; admin opens from board. Object access enforced backend-side |

### Role-restricted (nested `ProtectedRoute roles={...}`)
| Path | Component | Roles |
|------|-----------|-------|
| `/academic` | AcademicHomePage | resident, consultant |
| `/academic/submit` | AcademicEvaluationFormPage | resident, consultant |
| `/academic/history` | AcademicHistoryPage | resident, consultant |
| `/nurse` | NurseDashboardPage | nurse |
| `/nurse/reports` | ReportSelectionPage | nurse |
| `/nurse/activity` | NurseActivityPage | nurse |
| `/admin` | AdminDashboardPage | superadmin, admin |
| `/admin/academic` | AcademicDashboardPage | superadmin, admin |
| `/admin/academic/submissions` | AcademicSubmissionsPage | superadmin, admin |
| `/admin/academic/people/:userId` | AcademicPersonDetailPage | superadmin, admin |
| `/admin/departments/:departmentId` | DepartmentDetailPage | superadmin, admin (drill-down, no nav link) |
| `/admin/submissions` | SubmissionBoardPage | superadmin, admin |
| `/admin/users` | UserManagementPage | superadmin, admin |
| `/admin/manual-admin-setup` | ManualAdminSetupPage | superadmin, admin |
| `/admin/templates` | TemplateManagementPage | superadmin, admin |
| `/admin/action-items` | ActionItemsPage | superadmin, admin |
| `/admin/import` | DataImportPage | superadmin, admin |
| `/admin/audit` | AuditLogPage | superadmin, admin |
| `/admin/settings` | SettingsPage | superadmin, admin |
| `*` | NotFoundPage | catch-all |

**Guard behavior** (`route-guards.tsx`): unauthenticated → `/login`; `passwordChangeRequired` → `/change-password`; wrong role → redirect to own landing (never renders the page).

---

## Backend API routes (91)

Global middleware on `/api/*`: `SecurityHeaders`, `EnsureFrontendRequestsAreStateful` (Sanctum). Authenticated group adds `auth:sanctum`, `active`, `password-changed`, `throttle:300,1`. Guest redirect returns `null` and `/api/*` forces JSON → clean 401s.

### Public (no auth)
| Method | Path | Controller | Throttle |
|--------|------|------------|----------|
| POST | `/api/auth/login` | AuthController@login | 10/min |
| POST | `/api/auth/forgot-password` | PasswordResetController@forgot | 5/min |
| POST | `/api/auth/reset-password` | PasswordResetController@reset | 5/min |
| POST | `/api/access-requests` | AccessRequestSubmissionController@store | 10/min |
| POST | `/api/academic-access-requests` | AcademicRegistrationController@store | 10/min |
| POST | `/api/admin-access-requests` | AdminRegistrationController@store | 10/min |

### Auth (auth:sanctum)
| Method | Path | Controller | Extra |
|--------|------|------------|-------|
| GET | `/api/auth/me` | AuthController@me | `active` |
| POST | `/api/auth/logout` | AuthController@logout | |
| POST | `/api/auth/change-password` | AuthController@changePassword | `active` (reachable while password change required) |

### Authenticated general (auth:sanctum + active + password-changed + throttle:300/min)
| Method | Path | Controller | Permission |
|--------|------|------------|-----------|
| GET | `/api/workspace` | WorkspaceController@show | (reachable w/o password-changed) |
| GET | `/api/reports` | ReportWorkflowController@index | row-scoped (non-admin: own assignments) |
| POST | `/api/reports` | @store | submission service authz |
| GET | `/api/reports/details` | @details | per-report `Gate::view` |
| GET | `/api/reports/{report}` | @show | `Gate::view` |
| PUT | `/api/reports/{report}` | @update | `Gate::update` |
| POST | `/api/reports/{report}/submit` | @submit | `Gate::submit` |
| POST | `/api/reports/{report}/lock` | @lock | `Gate::lock` |
| POST | `/api/reports/{report}/unlock` | @unlock | `Gate::unlock` |
| GET/POST/DELETE | `/api/reports/{report}/comments[/{comment}]` | ReportCommentController | `Gate::view` + author/admin to delete |
| GET/PATCH/DELETE/POST | `/api/notifications[...]` | NotificationController | `notifications.view` |
| GET | `/api/analytics/{overview,dashboard,inpatient,outpatient,procedures,weekly,monthly,quarterly,yearly,departments,wards,export}` | AnalyticsController | `analytics.view` |
| GET/POST | `/api/academic/{form-options,my-submissions,my-performance,consultant-evaluations,resident-evaluations}` | AcademicEvaluationController | `academic.submit` |
| GET | `/api/academic/analytics/{summary,trend,people}` | AcademicAnalyticsController | `academic.view` |

### Admin group (`/api/admin/*`, each with a `permission:*`)
| Method | Path | Permission |
|--------|------|-----------|
| GET/POST | `/api/admin/admin-access-requests[/{id}/approve|reject]` | `admins.approve` |
| GET/POST/PATCH/DELETE | `/api/admin/users[...]` | `users.view` (read) / `users.manage` (write) |
| GET/POST/PATCH/DELETE | `/api/admin/assignments[...]` | `assignments.manage` |
| GET/POST/PATCH/DELETE | `/api/admin/templates[...]` | `templates.manage` (structural edits gated to superadmin in-controller) |
| GET/POST/PATCH/DELETE | `/api/admin/departments[...]`, `/api/admin/wards` | `departments.manage` |
| GET/PUT/PATCH | `/api/admin/settings` | `settings.manage` |
| GET/PATCH/POST | `/api/admin/access-requests[...]` | `accessRequests.review` |
| GET | `/api/admin/audit-logs`, `/api/admin/admin-audit-logs` | `audit.view` |
| GET/POST | `/api/admin/reports/import-template`, `/api/admin/reports/import` | `reports.import` |
| GET/POST/PATCH | `/api/admin/action-items[...]` | `actionItems.view` / `actionItems.manage` |
| GET | `/api/admin/academic/evaluations`, `/api/admin/academic/audit` | `academic.view` |

### Role → permission matrix (`Permissions.php`)
| Permission | superadmin | admin | nurse | resident | consultant |
|-----------|:--:|:--:|:--:|:--:|:--:|
| auth.viewSelf | ✓ | ✓ | ✓ | ✓ | ✓ |
| users.view / users.manage | ✓ | ✓ | | | |
| admins.manage | ✓ | | | | |
| admins.approve | ✓ | ✓ | | | |
| departments / templates / assignments.manage | ✓ | ✓ | | | |
| templates.editStructure | ✓ | | | | |
| accessRequests.review | ✓ | ✓ | | | |
| accessRequests.create | | | ✓ | | |
| reports.viewAny | ✓ | ✓ | | | |
| reports.viewAssigned | | | ✓ | | |
| reports.submit / lock / import | ✓ | ✓ | submit only | | |
| analytics.view / audit.view / settings.manage | ✓ | ✓ | | | |
| actionItems.view / manage | ✓ | ✓ | | | |
| notifications.view | ✓ | ✓ | ✓ | | |
| academic.view / academic.manage | ✓ | ✓ | | | |
| academic.submit | | | | ✓ | ✓ |

### Unknown / broken routes
None discovered statically. `/api/admin/notifications` does not exist server-side — the frontend `/admin/notifications` route reuses the same `GET /api/notifications` endpoint. The unauthenticated CSV export `<a href>` (non-JSON) historically 500'd via a missing `login` route; mitigated by `redirectGuestsTo(null)` + forced JSON in `bootstrap/app.php` (verify live).
