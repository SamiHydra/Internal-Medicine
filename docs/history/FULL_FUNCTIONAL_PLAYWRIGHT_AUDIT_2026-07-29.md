# Full Functional Playwright Audit

**Application:** St Paul's Hospital Internal Medicine Department Management System  
**Audit date:** 2026-07-29  
**Local application URL:** <http://localhost:5173>  
**Audit method:** Multi-agent exploratory browser audit followed by a clean, serial Playwright regression run  
**Final verdict:** **PASS WITH LOW-RISK FOLLOW-UPS**

## 1. Executive summary

The system is functioning end to end at the audited local revision. The originally reported SQLite failure and the admin sign-in/logout redirect vibration were reproduced, fixed, and verified in a real Chromium browser.

The audit exercised the public registration and approval paths, post-approval authentication, role dashboards, authorization boundaries, clinical reporting, academic evaluations, morning attendance, teaching attendance, student representative activity, administration, data import validation, notifications, security controls, responsive behavior, and production compilation.

Final automated results:

| Validation | Result |
|---|---:|
| Playwright browser suite | **162 passed, 2 skipped, 0 failed** |
| Frontend unit/component tests | **99 passed, 0 failed** |
| Laravel tests | **359 passed, 1 skipped, 0 failed** |
| Laravel assertions | **2,513** |
| Load-contract tests | **4 passed, 0 failed** |
| ESLint | **Passed** |
| TypeScript and Vite production build | **Passed** |

The two skipped Playwright cases are documented in section 10. Neither represents an observed failing user workflow.

## 2. Environment and audit discipline

- Frontend: Vite, React, and TypeScript at `http://localhost:5173`.
- Backend: Laravel at `http://127.0.0.1:8000`, accessed by the SPA through Vite's same-origin `/api` and `/sanctum` proxies.
- Browser: Chromium driven by Playwright.
- Final Playwright execution: 164 discovered tests, one worker, 8.9 minutes.
- Parallel exploratory agents covered administration/teaching, clinical reporting, and academic workflows.
- The Windows `php artisan serve` process is single-threaded. Concurrent exploratory sessions saturated it and caused request aborts/timeouts. Those observations were not counted as product failures; all affected workflows were rerun sequentially at the configured origin.
- The final clean Playwright run was serial to avoid test-environment contention.

### Local data safety

The pre-audit local SQLite database was backed up before browser mutations:

`.codex-temp/database-pre-full-playwright-audit-20260729.sqlite`

The development database now contains audit-only users, approvals, assignments, reports, evaluations, attendance entries, action items, and notifications created through the audited workflows. No production system was contacted.

## 3. Defects reproduced and fixed

| Defect | Resolution | Browser verification |
|---|---|---|
| Fatal `SQLSTATE[HY000]: no such table: workspace_revisions` page | Applied the missing database migrations. | Public and authenticated application routes load; final suite has no database-schema failure. |
| Admin sign-in/logout/relogin caused redirect vibration or a stale login screen | Unified login with application auth state, redirected already-authenticated users by role, and hardened signed-out bootstrap handling. | Repeated login/logout test passed; fresh `/admin` redirects to `/login`; admin relogin lands on `/admin`. |
| Fresh anonymous `/` or `/admin` could display “Unable To Load The App” after a 401 | Treat 401/419/inactive-account responses as invalid sessions, clear cached identity, and avoid promoting them to fatal workspace errors. | Fresh protected navigation redirects safely to login. |
| Approved self-registered nurse retained the visible title “Applicant Nurse” | Approval now normalizes the title to `Nurse`; a migration normalizes existing active records. | Newly approved nurse header displays `Nurse`; backend test verifies the persisted title. |
| Unassigned student representative received a generic error toast plus a contradictory “Nothing scheduled” state | Added an explicit “Representative assignment needed” state with administrator guidance. | Verified in Chromium with a newly created, unassigned representative. |
| Desktop notification and sign-out controls were only 36px | Increased fine-pointer controls to 40px while retaining 44px coarse-pointer targets. | All three pointer/touch target tests passed. |

Primary application files changed:

- `src/App.tsx`
- `src/context/app-data-context.tsx`
- `src/pages/auth/login-page.tsx`
- `src/pages/auth/login-page.test.tsx`
- `src/pages/teaching/rep-log-page.tsx`
- `src/components/layout/app-shell.tsx`
- `backend/app/Services/Admin/AccessRequestReviewService.php`
- `backend/database/migrations/2026_10_01_000050_normalize_approved_nurse_titles.php`
- `backend/tests/Feature/AuthApiTest.php`

Several existing Playwright specifications were also brought into line with current product contracts: the required academic overall rating, summary-versus-detail report APIs, exact 404 heading matching, paginated superadmin lookup, the mobile sign-out assertion, duplicate-name scoping, route-prefetch performance measurement, and isolated clinical report data.

## 4. Public access and authentication

| Workflow | Result | Evidence |
|---|---|---|
| Fresh login page | PASS | Form renders at `/login`; no fatal workspace screen. |
| Fresh protected URL | PASS | `/admin` redirects to `/login`. |
| Invalid login | PASS | API returns 422 and UI shows a generic, non-enumerating message. |
| Request-access navigation | PASS | `/login` to `/register` renders the registration UI without a manual refresh. |
| Superadmin login | PASS | Login returns 200 and the admin dashboard loads. |
| Repeated login/logout | PASS | Clean Playwright regression passed without redirect vibration. |
| Session restoration | PASS | Refresh, browser back/forward, multi-tab use, and offline recovery passed. |
| Password change | PASS | Required first-login password change completed for a new representative. |
| Session revocation | PASS | Changing a password invalidated the other active session (`/api/auth/me` returned 401). |

The anonymous `/api/auth/me` probe returns the expected 401 and Chromium records it as a failed resource. The application handles it correctly and presents a clean login form.

## 5. Role lifecycle results

### 5.1 Administrator lifecycle

Audit account:

- Email: `audit.admin.20260729.1357@stpaulos.local`
- Access request: `019fae2b-1607-73bd-961d-f5e8f2b2f108`
- Provisioned user: `019fae2c-b8b4-7310-999a-0db55695ab19`

Verified flow:

1. Submitted the public admin access request.
2. Approved it as superadmin through **Users & Access**.
3. Signed in as the newly provisioned administrator.
4. Loaded the clinical and academic admin dashboards.
5. Opened submissions, templates, users, audit log, settings, action items, and notifications.
6. Queued a report export (`202 Accepted`).
7. Downloaded CSV output.
8. Submitted an intentionally invalid import and received a visible 422 missing-column validation response.
9. Started and resolved an action item (`200 OK` for each state change).
10. Marked notifications as read.

Observed academic dashboard data included evaluations, attendance, morning timeliness, teaching activity, student attendance, ratings, and final-evaluation counts. Charts and tab transitions rendered successfully.

### 5.2 Nurse lifecycle and clinical report

Audit account:

- Email: `audit.nurse.clinical.20260729@stpaul.local`
- Access request: `019fae2b-c563-7176-9c3d-f2081b306e9b`
- Assignment: Cardiac / Inpatient / Inpatient Weekly Report

Verified flow:

1. Submitted the public clinical registration form (`201 Created`).
2. Approved the request through the admin queue (`200 OK`).
3. Confirmed the active reporting assignment.
4. Signed in as the new nurse (`200 OK`) and loaded the nurse dashboard.
5. Opened the assigned report.
6. Entered `73` for **Total Number of Admitted Patients**.
7. Saved the report (`201 Created`).
8. Reloaded and confirmed draft persistence, status `Draft`, and the exact saved value.
9. Submitted the report and confirmed status `Submitted`.
10. Confirmed the draft/submission in nurse Activity.
11. Located the submission on the admin board.
12. Locked it as admin (`200 OK`).
13. Reopened it as the nurse and confirmed `Locked`, `Read only`, retained value `73`, and disabled save/submit controls.
14. Confirmed the approved title is `Nurse`.
15. Confirmed direct nurse navigation to `/admin` redirects to `/nurse`.

The final isolated clinical Playwright lifecycle specification passed all **12 of 12** assertions.

### 5.3 Resident lifecycle and academic submission

New audit account:

- Email: `audit.resident.20260729@stpaul.local`
- Access request: `019fae2c-2b3a-7393-8971-914e9238755a`
- Provisioned user: `019fae3b-24c8-70dc-a3cf-3c6dbf64310c`

Verified flow:

1. Submitted public resident registration (`201 Created`).
2. Approved it through the admin interface (`200 OK`).
3. Signed in and loaded `/academic`.
4. Confirmed the role cannot access `/admin`; it redirects to `/academic`.

The optional home ward on a new registration does not itself create a current monthly placement or paired duty relationship. The new account therefore correctly displayed that no ward or paired duty assignment was available for evaluation.

The complete active resident workflow was then verified with a seeded, placed resident:

1. Selected an eligible consultant.
2. Completed time, presence, patients, quality, participant, rating, and comment controls.
3. Submitted the consultant evaluation (`201 Created`).
4. Confirmed it in History with the correct date, `5/5`, and `100%`.
5. Opened Morning attendance, confirmed the designated-recorder surface, and recorded the session (`200 OK`).
6. Confirmed the session became `RECORDED` and `ON TIME`.

### 5.4 Consultant lifecycle and academic/teaching submissions

New audit account:

- Email: `audit.consultant.20260729@stpaul.local`
- Access request: `019fae2e-5061-70dd-b0a2-cf63713d8144`
- Provisioned user: `019fae3a-b5fd-712a-90fb-70255eb402d3`

Verified flow:

1. Submitted public consultant registration (`201 Created`).
2. Approved it through the admin interface (`200 OK`).
3. Signed in and loaded `/academic`.

As with the new resident, the optional home ward is profile metadata rather than a live placement. The UI correctly withheld evaluation submission until a current relationship is configured.

The complete active consultant workflow was verified with a seeded, placed consultant:

1. Selected an eligible resident.
2. Completed all ten evaluation switches, selected rating `5`, and entered a comment.
3. Submitted the resident evaluation (`201 Created`).
4. Confirmed it in History with `5/5` and `100%`.
5. Opened Teaching and selected a pending Lecture/Seminar.
6. Took attendance, marked one student absent, and saved (`200 OK`).
7. Confirmed the activity became `Lecture Held`.
8. Evaluated a student using all required controls, rating `5`, and a comment (`201 Created`).

### 5.5 Student representative lifecycle

Audit account:

- Email: `audit.rep.20260729.1434@stpaul.local`
- Created by an administrator through the Students page.

Verified flow:

1. Created the student representative (`201 Created`).
2. Signed in with the temporary credential.
3. Confirmed forced redirect to `/change-password`.
4. Changed the password and landed on `/teaching`.
5. Confirmed a new unassigned account displays **Representative assignment needed**.
6. Attempted to assign a group that already had an active representative and received the expected controlled 422 uniqueness response; the seeded representative was not displaced.
7. Signed in as the seeded group representative.
8. Confirmed only in-scope group lectures/seminars were visible.
9. Marked the first Lecture as Held and confirmed the UI state changed.
10. Confirmed direct `/admin` navigation redirects to `/teaching`.

## 6. Administration and data-management coverage

| Feature | Result |
|---|---|
| Clinical dashboard cards and charts | PASS |
| Academic dashboard and all major tabs | PASS |
| Users and access-request queues | PASS |
| Nurse, resident, consultant, and admin approval | PASS |
| Student representative creation | PASS |
| Submission board | PASS |
| Report lock/read-only enforcement | PASS |
| Templates | PASS |
| CSV export/download | PASS |
| Invalid CSV import validation | PASS |
| Notifications/read state | PASS |
| Action-item start and resolution | PASS |
| Audit log | PASS |
| Settings | PASS |
| Search, filtering, pagination, and empty states | PASS |
| Workspace switching and persistence | PASS |

## 7. Authorization and security coverage

The final browser run verified:

- Nurse requests to admin users, settings, audit logs, action items, import template, clinical analytics, academic analytics, and academic admin evaluation endpoints return 403.
- Resident and consultant access to admin/analytics endpoints is denied.
- Nurse, resident, consultant, and administrator permitted endpoints remain accessible.
- A non-superadmin cannot create a superadmin through the user API.
- The protected superadmin cannot be deactivated.
- A nurse cannot read another nurse's report by guessing its ID.
- API hardening headers are present.
- Session cookies are `HttpOnly`; the XSRF token remains readable as required by Sanctum; SameSite is set.
- `.env`, `.git`, and log files are not exposed through the public root.
- Reflected script content is escaped and does not execute.
- Repeated failed logins are rate-limited with 429.
- Password changes revoke other sessions.

## 8. Responsive, stability, and performance results

Responsive checks passed for admin, nurse, and resident landing pages at 390px and 820px without horizontal overflow. The mobile **More** sheet exposes the expected administrative navigation, and touch workspace switching persists after reload.

Stability checks passed for:

- repeated refreshes;
- repeated workspace switching;
- rapid navigation;
- back/forward navigation;
- two tabs sharing one session;
- offline navigation and online recovery;
- repeated login/logout;
- mobile and desktop pointer-target sizes.

Representative final development-server measurements:

| Surface | Wall time | First contentful paint |
|---|---:|---:|
| Login | ~1,458ms | ~824ms |
| Admin dashboard | ~3,281ms | ~1,396ms |
| Academic dashboard | ~2,439–2,494ms | ~1,404ms |
| Academic Morning tab switch | ~131ms UI wall time | Not applicable |

These are local Windows Vite/PHP development measurements, not production Nginx/PHP-FPM benchmarks.

## 9. Final validation record

### Playwright

Command: `npm run test:e2e`

Result:

```text
2 skipped
162 passed (8.9m)
```

### Frontend tests

Command: `npm run test:run`

Result:

```text
Test Files  18 passed (18)
Tests       99 passed (99)
```

### Laravel tests

Command: `php artisan test`

Result:

```text
Tests:      359 passed, 1 skipped
Assertions: 2,513
```

### Static and build validation

- `npm run lint` — passed.
- `npm run build` — passed; 3,362 modules transformed.
- `npm run test:load-contract` — 4 of 4 passed.

## 10. Skipped and residual items

### Skipped Playwright cases

1. `AUD-UI-020`: locked report outside the default reporting window.
   - Reason: the isolated test database did not contain the specific out-of-window locked fixture required by this test.
   - Related current-window lock/read-only behavior was verified manually and by the clinical lifecycle tests.
2. Mobile audit sweep diagnostic.
   - This route-by-route 393px geometry sweep is explicitly marked diagnostic and non-gating.
   - The dedicated responsive and touch-target suites passed.

### Low-risk follow-ups

1. **Anonymous console noise:** the expected unauthenticated `/api/auth/me` response appears as a 401 resource error in Chromium. The UI handles it correctly.
2. **Academic onboarding clarity:** approving a resident or consultant with an optional home ward does not establish a current monthly placement or paired duty relationship. An administrator must still configure the live roster/rotation before evaluations become eligible. The UI communicates the missing relationship, but the approval workflow could explain this dependency more explicitly.
3. **Dialog accessibility warning:** opening the mobile sheet emits Radix's development warning that `DialogContent` has no description/`aria-describedby`. Functional keyboard, mobile, and touch tests pass, but adding a concise accessible description would remove the warning.
4. **Logout-race development log:** one regression scenario produced a rejected report-summary request after the session had already been invalidated. The application suppressed the fatal UI and the repeated login/logout test passed, but the development log can still record that 401.
5. **Local concurrency:** multiple simultaneous browser audits can saturate Windows `php artisan serve`. Use a serial browser worker locally, or test concurrency against the production-like Nginx/PHP-FPM stack.

No open critical, high, or medium functional defect was observed after the fixes and sequential retests.

## 11. Audit artifacts

Primary exploratory notes:

- `output/playwright/admin-teaching-audit-notes.md`
- `output/playwright/academic-audit-notes.md`
- `output/playwright/clinical-audit-notes.md`

Selected browser artifacts:

- `output/playwright/admin-after-login.png`
- `output/playwright/admin-relogin-fixed.png`
- `output/playwright/admin-login-flow.webm`
- `output/playwright/academic-resident-signup-success.png`
- `output/playwright/academic-consultant-signup-success.png`
- `output/playwright/clinical-04-request-submitted.png`
- `output/playwright/clinical-05-pending-request-admin.png`
- `output/playwright/clinical-06-approved-active-assignment.png`

Final Playwright logs:

- `.codex-temp/e2e-full-final-20260729.stdout.log`
- `.codex-temp/e2e-full-final-20260729.stderr.log`

## 12. Readiness recommendation

The audited local build is suitable for user acceptance testing. The essential role lifecycles and server-side authorization boundaries are operational, the production build compiles, and all gating tests pass.

Before a hospital-LAN production release:

1. Run migrations as part of the atomic deployment so `workspace_revisions` and the nurse-title normalization are guaranteed.
2. Validate against the production-like Nginx/PHP-FPM stack with HTTPS and the final domain.
3. Perform a backup/restore rehearsal on production-shaped data.
4. Address the two low-severity console/accessibility warnings when convenient.
5. Add a deterministic out-of-window locked-report fixture so `AUD-UI-020` can become a required gate.
