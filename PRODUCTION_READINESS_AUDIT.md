# Production Readiness Audit

**Application:** St Paul's Hospital, Internal Medicine weekly reporting and academic platform
**Repository:** `c:\Users\Hasse\OneDrive\Desktop\Mesay` (GitHub `SamiHydra/Internal-Medicine`)
**Branch audited:** `fix/mobile-touch-targets`, HEAD `2eb7be2`, including the uncommitted working-tree changes (23 modified files, 5 untracked source files)
**Audit date:** 2026-09-06
**Auditor role:** Senior QA, full-stack, DevOps, security and release engineering, acting as the final sign-off before production

This report supersedes the draft that was found untracked in the repository root at the start of the session. Every claim below was re-executed and re-verified in this session; nothing was carried over unverified.

---

## 1. Executive Summary

### NOT READY FOR PRODUCTION: the release gate is red and one authorization defect must be fixed first

The system is mature and, for the most part, works as designed. Across roughly 390 API-level checks and 230 browser-level page loads and interactions, the core business workflows all succeeded end to end: nurse weekly reporting (draft, save, submit, lock, unlock, comments, audit trail), admin approval of access requests, action-item governance with evidence uploads, queued Excel/CSV exports, the whole academic pillar (peer evaluations in both directions through the real rendered form, student evaluations, the representative's held/not-held log, morning-session policy, section transfers with head-of-section review, rotation planning, duty roster, structure administration, the evaluation-form editor with draft/publish), notifications with restore, workspace switching, offline shell via service worker, and every role boundary I could think of. Authorization in particular is genuinely strong: not one of the cross-role, IDOR, escalation, CSRF or enumeration probes got through, with a single exception described below.

It is nevertheless not deployable today, for four narrow reasons:

1. **The project's own deploy script cannot complete.** `deploy/deploy.sh` runs `npm run verify`, and `npm run verify` fails as of 2026-09-06 because a test fixture in `src/lib/offline/workspace-cache.test.ts` hard-codes a date that crossed the product's 90-day cache-expiry boundary today (QA-001). The deploy would abort before touching the server.
2. **`php artisan db:seed` throws a `TypeError`** committed at HEAD, so the 164-test Playwright gate and the Lighthouse CI job cannot start, and a fresh local or staging environment cannot be seeded (QA-002). I had to apply a one-line temporary patch (disclosed in section 2) to run the browser gate at all.
3. **A student representative can read and write clinical reports.** An uncommitted change lets an admin convert a nurse to `student_rep`; the converted account keeps its report assignment and I verified end to end that it still lists, opens, edits and submits clinical reports with HTTP 200 (QA-003).
4. **`composer audit` reports 12 advisories against two production packages**, and the CI `backend-sqlite` job has been failing on exactly that step since 2026-09-05 (QA-004).

GitHub shows the last four CI runs on this branch failing (4 of 6 jobs on the most recent run); `main` has no branch protection, so the red pipeline does not stop a merge. None of the four blockers is architectural; together they are well under a day of work, after which the remaining findings (upload size limits, a deadline validation gap, first-install documentation, stale E2E specs, a mobile overflow) can be scheduled around the launch.

---

## 2. Audit Scope

### What was actually executed

| Activity | Status |
|---|---|
| Repository and architecture inspection (routes, policies, migrations, seeders, configs, deploy kit, CI) | Done |
| Backend test suite (`php artisan test`, in-memory SQLite) | Executed: 377 tests |
| Frontend unit suite (`npx vitest run`) | Executed: 131 tests |
| Lint (`npm run lint`), production build (`npm run build`, twice), performance budget (`npm run perf:budget`) | Executed |
| Full Playwright gate (`npm run test:e2e`, isolated seeded database) | Executed: 164 tests, after the disclosed seeder patch |
| Composer audit (bundled `composer.phar`), `composer install --no-dev --dry-run`, npm audit | Executed |
| Fresh-install simulation (`migrate` only, then `app:create-superadmin`, then `db:seed`) on a throwaway SQLite file | Executed |
| Live stack with a disposable seeded database: Laravel `artisan serve` on :8000 and :8001, database queue worker, standard Vite dev server on :5173, `vite preview` of the production bundle on :4173 | Executed |
| Custom API probes: authentication, authorization matrix, IDOR, escalation, validation, uploads, exports, CRUD lifecycles, business rules, academic workflows | Executed: 393 checks |
| Browser sweep: 5 roles x every route x desktop (1440) and phone (390), plus anonymous routes | Executed: 107 page loads with console, network, overflow and content capture |
| Browser workflows through the real UI (login UX, nurse report lifecycle, admin approvals, settings, action items, export, import, templates, evaluation submission, rep log, notifications, mobile shell) | Executed: about 125 checks |
| Production bundle smoke via `vite preview` (styling, service worker, offline shell, navigation) | Executed |
| Repo load-test harness (`npm run load:test`, 3 virtual users, 20 s) | Executed (results in section 18) |
| GitHub Actions history and failed-job logs (`gh run view`) | Read |
| Migration safety review (all 77 migrations) | Code review |
| Docker parity stack | BLOCKED: Docker Desktop daemon not running on this machine (`compose config` validates) |
| MariaDB behaviour | BLOCKED locally (no MariaDB; the local MySQL 8.4 instance does not accept the CI credentials). Evidence taken from the CI `backend-mariadb` job, which migrated and ran 372 of 375 tests successfully on MariaDB 11.4 |
| Real SMTP / SMS delivery | BLOCKED: `MAIL_MAILER=log`, `SMS_DRIVER=log`; the readiness command warns on both |
| Realtime (Reverb) | NOT APPLICABLE: deliberately disabled, the SPA polls |
| The on-prem Ubuntu host (nginx, PHP-FPM, systemd, TLS, cron) | BLOCKED: no access; reviewed from the deploy kit |

### Test-environment modifications (disclosed)

- **One temporary source patch:** `backend/database/seeders/DevClinicalDataSeeder.php` line 348, `$alerts->notify($report, $route, $now)` changed to `$alerts->notify($report, $now)` so that seeding (and therefore the browser gate) could run. This file was restored to its committed state at the end of the audit (`git diff` on it is empty). The change is exactly the fix recommended in QA-002.
- **One disposable database:** `backend/database/qa-audit.sqlite`, seeded with `SEED_HISTORY_WEEKS=30` and removed at the end. The developer's `database.sqlite` was never opened by any server or script in this audit.
- **One disposable settings change:** while probing validation I wrote an invalid deadline time into the disposable database's settings, observed the side effect (QA-006), and restored `10:00`.
- Scratch scripts, screenshots and logs lived in the session scratchpad, not in the repository. One temporary Vite config under the gitignored `.codex-temp/` was removed.
- `dist/` was rebuilt at the end with the standard environment so the working tree matches a normal `npm run build`.

---

## 3. Architecture Summary

| Layer | Technology |
|---|---|
| Frontend | React 19, Vite 8, TypeScript 5.9, Tailwind 4, React Router 7 (client-side only), React Hook Form + Zod, Recharts, Framer Motion, sonner toasts, service worker for an offline shell, IndexedDB offline save queue |
| Backend | Laravel 13.20 on PHP 8.3 (8.4 locally), Sanctum SPA cookie authentication, permission middleware plus 28 policies, Eloquent, 42 services, 4 queued jobs, 18 console commands |
| Database | SQLite for development and the E2E gate; MariaDB 11.4 in production (enforced by `app:launch-readiness`) |
| Cache, session, queue | Database driver everywhere (no Redis, an explicit on-prem decision) |
| Realtime | Disabled; focus/visibility refresh plus a 60 s jittered poll and a lightweight signed revision token |
| Files | Laravel `local` disk, streamed through policy-checked download endpoints |
| Deployment | One Ubuntu host on the hospital LAN; nginx serves `dist/` and proxies `/api` and `/sanctum` to PHP-FPM on the same origin; `deploy/deploy.sh` builds immutable releases and switches a symlink atomically |

Codebase scale: 200 routes (194 under `/api`), 48 models, 36 controllers, 28 policies, 42 services, 77 migrations, 13 seeders, 18 commands, 4 jobs, 51 test files, 38 lazy-loaded pages.

---

## 4. Test Environment

| Item | Value |
|---|---|
| OS | Windows 11 Pro 10.0.26200 |
| Node / npm | v24.14.0 / 11.9.0 (project baseline 22.12+, CI uses 22) |
| PHP | 8.4.19 CLI (project requires ^8.3; composer platform pinned to 8.3.0) |
| Laravel | 13.20.0 |
| Composer | 2.9.8 via the bundled `backend/composer.phar` (not on PATH) |
| Browser | Chromium via Playwright 1.60 |
| Frontend (dev) | http://localhost:5173 (standard `npm run dev`) |
| Frontend (production bundle) | http://localhost:4173 (`vite preview`, bundle built with `VITE_API_BASE_URL=http://localhost:4173`) |
| Backend | http://127.0.0.1:8000 and :8001 (`php artisan serve`, `APP_DEBUG=false`, database queue with a running worker) |
| Database | Disposable `backend/database/qa-audit.sqlite`: 27 departments, 30 nurses, 189 users, 235 reports (30 weeks), 3,700+ academic evaluations |
| Test data marker | `QA_TEST_DO_NOT_DEPLOY` on every record created by the audit |

No secret values were read into this report. Environment files were inspected with values redacted.

---

## 5. Feature Inventory

| # | Module | Feature | Route / page | Roles | Expected behaviour |
|---|---|---|---|---|---|
| 1 | Authentication | Login by email or username | `/login`, `POST /api/auth/login` | All | Session cookie issued, throttled, enumeration-safe |
| 2 | Authentication | Logout, session restore, refresh | `POST /api/auth/logout`, `GET /api/auth/me` | All | Session invalidated; shell restored on reload |
| 3 | Authentication | Forgot / reset password | `/forgot-password`, `/reset-password` | Guest | Non-committal reply, token-validated reset |
| 4 | Authentication | Forced password change | `/change-password`, `POST /api/auth/change-password` | New accounts | All other endpoints 403 until changed |
| 5 | Registration | Nurse self-signup with requested departments | `/register`, `POST /api/access-requests` | Guest | Inactive nurse + pending request |
| 6 | Registration | Academic (resident/consultant) enrollment | `POST /api/academic-access-requests` | Guest | Pending request, no account |
| 7 | Registration | Admin self-signup | `POST /api/admin-access-requests` | Guest | Pending request, role forced to admin |
| 8 | Users | Approve / reject nurse access requests | `/admin/users` | Admin | Activates user, creates assignments |
| 9 | Users | Approve / reject admin and academic requests | `/admin/users` | Admin, Maintenance | Creates the account |
| 10 | Users | Directory search, workspace-scoped roster, pagination | `/admin/users` | Admin | Client-side search over the full directory |
| 11 | Users | Create nurse / student rep / admin accounts | `POST /api/admin/users`, `/admin/manual-admin-setup` | Admin (admins: Maintenance only) | Audit-logged |
| 12 | Users | Edit profile, correct role, reset password, deactivate / activate | `PATCH /api/admin/users/{id}` and siblings | Admin | Soft deactivate only; superadmin protected |
| 13 | Assignments | Assignment studio (nurse to department/template) | `/admin/users`, `POST /api/admin/assignments` | Admin | Idempotent upsert; nurse-only |
| 14 | Clinical reports | Weekly report form: draft, save, submit, edit after submit | `/reports/:assignment/:period` | Nurse, Admin | Values persisted per day; history and audit rows |
| 15 | Clinical reports | Lock / unlock | `POST /api/reports/{id}/lock` | Admin | Locked reports read-only |
| 16 | Clinical reports | Comments | `/reports/...`, `/api/reports/{id}/comments` | Nurse, Admin | Owner or admin only |
| 17 | Clinical reports | My Reports, Activity (status history) | `/nurse/reports`, `/nurse/activity` | Nurse | Own reports only |
| 18 | Clinical reports | Submission board with filters | `/admin/submissions` | Admin | All reports, filters, lock |
| 19 | Clinical import | Template download (CSV/XLSX) and spreadsheet import | `/admin/import` | Admin | Validates columns, reports errors |
| 20 | Analytics | Clinical dashboard, overview, inpatient/outpatient/procedures, rollups, department detail | `/admin`, `/admin/departments/:id` | Admin | Cached, filter-aware |
| 21 | Analytics | Queued exports (CSV/XLSX) with date filters and download | `/admin/export` | Admin | Worker builds file; owner-only download |
| 22 | Action items | Queue, deep link, state machine, assignment, notes, evidence upload/download, alert rules, overdue escalation | `/admin/action-items` | Admin | Transitions enforced; evidence policy-checked |
| 23 | Templates | Content editing, field show/hide, structural edits (Maintenance), delete guard | `/admin/templates` | Admin, Maintenance | Persisted; in-use templates cannot be deleted |
| 24 | Settings | Deadlines, locking, reminders, thresholds, metric targets, morning session config | `/admin/settings` | Admin | Deadline change recalculates periods |
| 25 | Audit | Clinical field-edit log, admin action log, academic evaluation feed | `/admin/audit` | Admin | Workspace-scoped |
| 26 | Notifications | List, unread filter, mark read, mark all read, clear, restore | `/notifications`, bell | All | Owner-scoped; restore refuses foreign ids |
| 27 | Workspace | Clinical / Academic switcher, per-workspace navigation, persistence | Shell | Admin, Maintenance | Persisted in localStorage |
| 28 | Academic | Resident evaluates consultant (published form engine) | `/academic/submit` | Resident | Pairing, date and uniqueness enforced |
| 29 | Academic | Consultant evaluates resident | `/academic/submit` | Consultant | Same rules |
| 30 | Academic | Consultant evaluates students (weekly/final) | `/academic/teaching` | Consultant | Placement snapshot |
| 31 | Academic | History, my performance (anonymised) | `/academic/history`, `/academic` | Resident, Consultant | Author identity hidden from subject |
| 32 | Academic | Morning session recording, cancel, roster overrides | `/academic/morning`, admin panel | Designated recorder, Admin | Same-day only for recorders |
| 33 | Academic | Section transfer request, cancel, head-of-section review, admin review, scheduled apply | Academic home, admin panel | Consultant, Admin | Effective on a future date |
| 34 | Academic admin | Dashboard with direction toggle and ops tabs | `/admin/academic` | Admin | Cached snapshot |
| 35 | Academic admin | Submissions list with evaluator identity, external evaluation entry | `/admin/academic/submissions` | Admin | Author never spoofable |
| 36 | Academic admin | Duty roster (monthly + daily), rotation calendars and planner | `/admin/academic/roster`, `/admin/academic/rotations` | Admin | Validated ids, overwrite confirmation |
| 37 | Academic admin | Structure: wards, sections, duty types, section heads | `/admin/academic/structure` | Admin | Delete guards on referenced rows |
| 38 | Academic admin | Evaluation form editor: content edits, draft, structure, publish (Maintenance) | `/admin/academic/evaluation-forms` | Admin, Maintenance | Core fields protected; versions immutable |
| 39 | Undergraduate | Batches, students (create/import/update/delete), placements, rep assignments, schedules, sessions | `/admin/academic/students` | Admin | Rep accounts scoped to batch |
| 40 | Undergraduate | Representative held / not-held log | `/teaching` | Student rep | Own batch and scope only |
| 41 | Undergraduate | Consultant student attendance | `/academic/teaching` | Consultant | Roster-validated |
| 42 | Platform | Offline shell (service worker), offline save queue | All | All | Shell loads offline |
| 43 | Platform | Scheduled jobs: overdue sync, reminders, digest, escalation, session generation, pruning, queue monitoring | cron | System | Heartbeat checked by readiness |
| 44 | Platform | Launch readiness command, backup script, atomic deploy, rollback | `deploy/` | Operators | See sections 21 to 26 |

---

## 6. Functional Test Results

Legend: VERIFIED (executed and confirmed), PARTIAL, CODE-REVIEW ONLY, FAILED, BLOCKED.

| Feature | Result | Evidence |
|---|---|---|
| Login, logout, refresh, guards | VERIFIED | Sections 8 and 12 |
| Forgot / reset password | PARTIAL | UI and API verified; mail delivery BLOCKED (`MAIL_MAILER=log`) |
| Forced password change | VERIFIED | New admin: 403 until `change-password`, then 200 |
| Nurse self-signup, approve, reject | VERIFIED | API and UI; DB state checked after each step |
| Admin self-signup and approval | VERIFIED | UI approval created an active admin |
| Academic enrollment | CODE-REVIEW ONLY | Endpoint reviewed; UI toggle rendered; not submitted end to end |
| User CRUD, role correction, reset password, deactivate/activate | VERIFIED | API lifecycle plus UI deactivate/activate; audit rows present |
| Assignment studio | VERIFIED (API), PARTIAL (UI) | API upsert verified; UI control located but not exercised |
| Weekly report lifecycle | VERIFIED | API and real form; values persisted, double-click safe, history and audit rows |
| Lock / unlock | VERIFIED | Admin lock, nurse 403, unlock, nurse 200 |
| Comments | VERIFIED | Nurse posts, admin reads, other nurse 403 |
| Submission board | VERIFIED (render + filter), PARTIAL (deep interactions) | |
| Import | VERIFIED | Templates download; garbage, executable and header-only files rejected with clear errors |
| Clinical analytics | VERIFIED | All endpoints 200, charts render, filters validated |
| Exports | VERIFIED | Queue, worker, ready, download 17 MB CSV, cross-user 403, invalid format/range 422 |
| Action items | VERIFIED | Full state machine, notes, evidence, deep link, sheet interactions |
| Templates | VERIFIED | Content edit persists (API and UI), structural change refused for admins, field hide persists, delete guard |
| Settings | VERIFIED with one FAILED rule | Persist and reload verified; time validation gap (QA-006) |
| Audit logs | VERIFIED | Clinical, admin and academic feeds populated after actions |
| Notifications | VERIFIED | Read, delete, restore, clear, undo, cross-user refusals |
| Workspace switcher | VERIFIED | Desktop and mobile; persists across reload |
| Peer evaluations (both directions) | VERIFIED | API and rendered form; duplicates, future dates, pairing, wrong roles rejected |
| Student evaluations | VERIFIED | API |
| History / my performance | VERIFIED | Anonymous to the subject |
| Morning sessions | PARTIAL | No session on the audit day (Sunday); policy, admin update and overrides verified; recording BLOCKED by calendar |
| Section transfers | VERIFIED | Consultant, head-of-section and admin paths |
| Duty roster, rotations | VERIFIED | API save and reload; UI renders |
| Structure | VERIFIED | Create, rename, delete guards, delete |
| Evaluation form editor | VERIFIED | Content edit, draft, core-field guard, add field, publish, version visible to residents |
| Undergraduate admin | VERIFIED with one FAILED case | Batches, students, import, placements, reps; duplicate placement returns 500 (QA-010) |
| Rep log | VERIFIED | API and UI, scope refusals |
| Consultant attendance | PARTIAL | Roster validation verified; no session on the audit day |
| Offline shell | VERIFIED | Production bundle reloads offline |
| Scheduled jobs | CODE-REVIEW ONLY | `schedule:list` shows 19 entries; not executed against a live clock |
| Email / SMS delivery | BLOCKED | No transport configured |

---

## 7. Playwright End-to-End Results

### The repository gate (`npm run test:e2e`, chromium, isolated database)

Result after the disclosed seeder patch: **158 passed, 4 failed, 2 skipped, 10.3 minutes**. Without the patch the gate cannot start (QA-002).

| Failing spec | Diagnosis |
|---|---|
| `academic-evaluation-submit.spec.ts` "resident submits a peer evaluation" | Spec is stale: it waits for a combobox named "Overall rating" but the renderer now uses a `radiogroup`. The application path works (verified separately through the real form, section 7 below). Test defect, but it leaves the core evaluation path ungated (QA-011). |
| `performance.spec.ts` "admin navigation stays within interaction budgets" | p95 801 ms versus a 600 ms budget during the full run, and 1,086 ms when the spec was re-run alone on an otherwise idle machine (12 of 13 performance checks passed in that isolated run). The failure is therefore reproducible on this Windows host with the single-process `artisan serve`; whether the Submissions page's early-interaction latency regressed on the Linux parity stack where the budget was calibrated could not be determined here (QA-011). |
| `responsive.spec.ts` "resident landing renders with no horizontal overflow @ phone-390" | Real defect: 82 px overflow caused by the fixed bottom tab bar (QA-012). Reproduced independently. |
| `v2-role-workflows.spec.ts` "designated recorder cancels a pending session" | Spec assumes a morning session exists today; the audit ran on a Sunday and the page correctly shows "No morning session today". Day-dependent test (QA-011). |

Skipped: the out-of-window locked report spec (fixture precondition) and the diagnostic mobile sweep.

### Workflows executed through the real UI in this audit

- Login UX: empty submit validation, wrong password message, password visibility toggle, forgot-password navigation and non-committal confirmation, register page three-way toggle with inline validation messages.
- Nurse: login lands on `/nurse`, survives refresh, `/admin` redirects to `/nurse`, My Reports lists 81 report links, open a report, change a value, Save draft (toast), reload (value persisted), double-click Save draft (no duplicate row, verified in DB), Activity and Notifications pages, unknown route shows the not-found page, back/forward, Sign out, protected route after logout redirects, browser back after logout stays on `/login`.
- Admin: login lands on `/admin` with 15 charts, switch to Academic (nav shows Roster, Rotations, Forms, Students), ops tabs, persistence across reload, back to Clinical, users search and empty state, approve a pending nurse request (DB approved and user active, row leaves the list), reject another, deactivate and reactivate a user (DB verified), approve a pending admin request (active admin created), settings toggle (dirty state, save, DB flip, reload, restore), action item deep link opens the sheet, assign owner, resolve with note, verify and close, add note (all verified in DB), queue an export and see it reach ready with a download control, import page templates and a CSV import run with reported outcome, template label edit persisted and visible after reload, submissions board filter, audit log, all academic admin pages render.
- Resident: empty evaluation submit shows "Select the consultant evaluated", full submission through the rendered form on a free date (row created, subject and date correct, history lists it); the same form correctly refused a duplicate for a date already used.
- Representative: pending session shows Held / Not held, not-held without a reason is blocked, not-held with reason persists.
- Consultant: teaching page shows the empty state on a non-session day, Mark all read persists.
- Notifications: Clear inbox deletes rows, restore banner appears, Restore brings them back (API 200).
- Mobile (390 px): nurse landing has no overflow, account menu opens with Sign out, tab bar navigation (see section 12 for the resident/consultant overflow).
- Production bundle (`vite preview`): styled login, admin/nurse/resident landings, service worker active and controlling, five admin pages navigate in 1.2 to 1.6 s, app shell loads while offline.

---

## 8. Authentication Results

| Check | Result |
|---|---|
| Anonymous `GET /api/workspace`, `/api/admin/users` | 401 JSON, no redirect, no stack trace |
| Empty credentials | 422 |
| Wrong password and unknown identifier | Identical 422 body ("These credentials do not match our records.") |
| Case-insensitive email login | 200 |
| Session payload contains no password hash | Confirmed |
| Logout | 204, then `/api/auth/me` 401 |
| POST without `X-XSRF-TOKEN` from a stateful origin | 419 |
| Login throttle | 429 after 10 attempts per minute per IP |
| Forgot-password known vs unknown address | Identical 202 body |
| Reset with bogus token | 422 |
| Deactivated account with an existing session | 403 on the next request |
| Deactivated account login (had logged in before) | 403 "This account is inactive." |
| Never-activated applicant login | 422 (indistinguishable from unknown) |
| Password change: same as current, wrong current | 422; success releases the gate |
| Admin-reset password: old password rejected | Confirmed |
| Session cookie flags | HttpOnly, SameSite=Lax; Secure defaults on in production |
| Password policy | min 8 + mixed case + numbers locally; min 12 + breach check in production (see QA-014) |

---

## 9. Authorization and Role Results

Role matrix executed live (31 combinations) plus object-level checks (13) plus escalation checks (5) plus admin-boundary checks (11): **every check passed except the role-change bypass (QA-003)**.

Highlights:

- Nurse: 403 on users, analytics, audit, settings, action items, academic endpoints, admin user PATCH, self-promotion.
- Resident: 403 on admin, analytics, admin academic; 200 on own form options.
- Consultant: 403 on admin users, academic audit, rep sessions; 200 on teaching today.
- Student rep: 403 on form options, submissions, students, batches, analytics, admin academic; 200 only on own sessions and notifications; `GET /api/reports` returns zero rows (until QA-003 is triggered).
- IDOR: another nurse's report GET/PUT/submit/lock/details/comments all 403; malformed id 404; other users' notifications never returned; user PATCH 403.
- Escalation: admin cannot create superadmin or resident (422), cannot PATCH a role to superadmin (422), cannot deactivate, delete or edit the superadmin (403), cannot create admins or promote a nurse to admin (403), cannot create evaluation-form structural drafts or publish (403), cannot change a template key (422 "Only Maintenance can change a template key").
- Exports are owner-scoped: another admin and a nurse get 403 on download, and an admin's export list shows only own exports.
- Section heads only see and decide requests destined for their section (foreign approve by id 403).
- Reps cannot record another batch's session or another subgroup's session (403); consultants and nurses cannot touch the rep log (403).
- Workspace revision token: forged token 428; valid token works without a session (by design), see QA-016.

**QA-003 (FAILED):** after `PATCH /api/admin/users/{nurse}` with `role=student_rep` (200), the same account received 200 on `GET /api/reports/{id}`, `PUT /api/reports/{id}` (value saved) and `POST /api/reports/{id}/submit`. Root cause: `HandlesDomainAuthorization::ownsAssignment`/`canViewAssignedReport` authorize from the assignment row alone, and `UserController::assertRoleChangeIsSafe` only guards the rep-to-other direction.

---

## 10. CRUD Results

| Resource | Create | Read | Update | Delete | Persistence check |
|---|---|---|---|---|---|
| Users | 201; duplicate email 422; 300-char name 422; whitespace name 422 | 200 | Rename, phone, role, password 200 | Soft deactivate (`active=false`), 200 | DB and audit rows verified |
| Assignments | 201; repeat 200 (idempotent); resident 422; unknown template 404 | via users | n/a | Deactivate | DB |
| Reports | 201; repeat POST reuses the row; future period accepted (QA-009) | 200 | 200 with per-field validation | none | Field values, history, audit rows in DB |
| Report comments | 201 | 200 | n/a | route exists, not exercised | DB |
| Departments | 201 with description; duplicate slug 422 | 200 | 200 | In use 422; unused 204 | Row removed |
| Templates | not created (seeded) | 200 | Content 200; slug by admin 422 | In use 422 | DB |
| Template fields | n/a | n/a | Hide/show by `fieldKey` persists | n/a | DB |
| Action items | Manual 201 | 200 | Transitions per state machine | n/a | Status history rows |
| Evidence | txt/pdf 201; exe/html/svg/php 422; empty 422; 3 MB 422 locally (QA-005); 11 MB 413 JSON | Download 200 with attachment name | n/a | 204, then 404 | Disk and DB |
| Exports | 202 | list scoped | n/a | n/a | File on disk, `status=ready` |
| Wards / sections / duty types | 201 | 200 | 200 | Referenced 422; empty 204 | List reflects |
| Batches | 201; duplicate label 422; bad dates 422 | 200 | 200 | Soft deactivate 204 | Students retained on the inactive batch |
| Students | 201; paste import 201 (2 created) | filtered list | subgroup update persists | 204 | DB |
| Placements | 201; duplicate 500 (QA-010) | 200 | n/a | n/a | DB |
| Rep assignments | 201; nurse refused 422 | 200 | retire 200 | n/a | Role guard verified |
| Rotation calendars | 201; invalid year 422 | 200 | deactivate 200 | n/a | DB |
| Transfer requests | 201; second pending 422; own section 422 | 200 | cancel/approve/reject | n/a | DB status |
| Notifications | restore | 200 | mark read | delete | DB |
| Settings | n/a | 200 | persists | n/a | DB and reload |

"Delete everything then create again": performed on wards, sections and duty types (create, delete to empty, recreate) and on a batch's students; no dependence on previous rows was observed.

---

## 11. Validation and Edge Cases

Verified server-side (all 422 unless stated): negative numbers, strings in numeric fields, decimals in integer fields, absurd 1e12 values, unknown field keys, invalid day names for the template, invalid report status transitions (locked), reports per_page above 100, non-numeric page, invalid notification filter, invalid morning recorder id, invalid time in academic forms, integer above the form maximum, missing required form fields, future evaluation dates, wrong subject role, unpaired subject, wrong evaluator role, unknown student, override date ordering, roster override reason shorter than 10 characters, unknown users in roster and plan, training year outside 1 to 3, duplicate ward slug, nurse as section head, endsOn before startsOn, import files with missing columns or no data rows, export format and date range, analytics direction and date formats, malformed JSON bodies (419/422), SQL-injection strings in search (200, no effect), 100-plus report ids in one details call (422).

Gaps found: deadline time `25:99` accepted (QA-006), future reporting periods accepted (QA-009), duplicate placement 500 (QA-010), case-variant duplicate email 500 on SQLite (QA-017).

Concurrency and repeat actions: double POST of the same report returns the same row; double-click Save draft in the UI creates one row; approving an access request twice is idempotent and creates no duplicate assignment; approving a decided transfer twice returns 403; the export request is rejected before queueing when the range exceeds 5,000 reports.

---

## 12. Responsive / Mobile Results

Measured with a 390 x 844 touch viewport on every route for every role, plus the repository's responsive spec.

| Surface | Result |
|---|---|
| Nurse home, My Reports, Activity, Notifications, Register | No horizontal overflow |
| Admin: dashboard, submissions, action items, templates, import, export, users, audit, settings, notifications, academic dashboard, academic submissions, roster, rotations, forms, students, structure | No horizontal overflow (wide tables scroll inside their containers) |
| Student rep activity log | No overflow |
| Resident and consultant landing (`/academic`) | **FAILED: 82 px overflow** from the fixed bottom tab bar with four items (QA-012); confirmed by the gate's responsive spec |
| Resident/consultant `/academic/submit` | 16 px overflow from the subject block (QA-012) |
| Mobile shell | Account sheet opens from the "Open account menu" button and contains the workspace switcher and Sign out; workspace switch to Academic works from the sheet |
| Mobile report form | No overflow, 20 visible numeric inputs, day navigation works; the "Back to my reports" link (24 px tall) and the Save draft / Submit report buttons (36 px tall) are the only controls under 40 px, which still meets the WCAG 2.5.8 minimum this branch targets |
| Mobile admin pages | Dashboard, academic dashboard, submissions, users, action items and roster all fit the viewport; the workspace switch works from the account sheet |

Desktop (1440 px): all 21 admin routes, 5 nurse routes, 5 resident routes, 6 consultant routes and 4 rep routes rendered with a correct H1 and content; no page errors on any route.

---

## 13. Browser Console Findings

- **Cold visit noise (QA-025):** every unauthenticated visit logs `Failed to load resource: 401` for `/api/auth/me`, and each login logs an aborted `/sanctum/csrf-cookie` request cancelled by the navigation. These are benign but appear on every page load, which will train operators to ignore the console.
- **No uncaught exceptions** (`pageerror`) on any route for any role, dev or production bundle.
- **No CORS or mixed-content errors** when the bundle is opened on its configured origin. (Opening the SPA on `127.0.0.1` instead of `localhost` produces CORS failures: the API origin is baked in at build time, so the deployed hostname must match `VITE_API_BASE_URL` exactly.)
- No hydration warnings (no SSR), no deprecated API warnings observed.

---

## 14. Network / API Findings

- No unexpected 4xx or 5xx during any UI flow; the only 4xx are the expected cold `/api/auth/me` 401s.
- Error contract is consistent: JSON on every `/api/*` error including 404 for unknown routes and 401 for non-JSON `Accept` headers; 413 for oversize uploads is JSON ("The POST data is too large."). No `200 {success:false}` patterns found.
- Polling: the workspace poll runs every 60 s with 15 s jitter and backs off to 5 minutes when the tab is hidden; the revision endpoint avoids a session read. No duplicate request storms observed.
- Payload sizes (single PHP built-in server, warm cache): `/api/workspace` 95 KB in 0.21 s; `/api/analytics/dashboard` 300 KB in 1.08 s; `/api/analytics/overview` 28 KB in 0.95 s; `/api/reports?per_page=100` 67 KB in 0.75 s; `/api/admin/users?per_page=100` 41 KB in 0.16 s; `/api/academic/analytics/snapshot` 19 KB in 1.5 s; `/api/admin/action-items` 57 KB; `/api/admin/audit-logs?per_page=100` 60 KB. The dashboard payload is the one to watch (QA-028).
- Server-side errors logged during the audit: the two seeder `TypeError`s, one `UNIQUE constraint users.email` (QA-017), one `UNIQUE constraint subgroup_placements` (QA-010), and one SQLite "database is locked" between the queue worker and the web server (SQLite-only, irrelevant on MariaDB).

---

## 15. Database and Data-Integrity Findings

- Schema: UUID primary keys, foreign keys everywhere with explicit `cascadeOnDelete` (35) or `nullOnDelete`/`restrictOnDelete` (61) rules, unique constraints on the natural keys (assignment+period, evaluation author+subject+date+form, placement batch+subgroup+week, batch label, ward/section/duty slugs, users email/username), SQLite check constraints restored for enum columns, retention and performance indexes added in dedicated migrations.
- Transactions: 43 `DB::transaction` blocks and 35 `lockForUpdate` calls cover report saves, evaluation submission, action-item transitions, batch/rep changes, evidence upload (with file cleanup on rollback) and transfers.
- Persistence verified in SQLite after every create/update/delete in sections 10 and 7 (values, status history, audit logs, notifications, evaluation answers, teaching session status, transfer status, settings rows).
- Workspace revision ledger: database triggers on 42 tables bump a single counter inside the same transaction; verified indirectly through the revision endpoint changing after writes.
- Orphans: none created by the audit; batch deletion is a soft deactivate that retires rep assignments, students stay attached.
- Time handling: `APP_TIMEZONE=UTC` with `HOSPITAL_TIMEZONE=Africa/Nairobi`; evaluation and external-entry dates are bounded by `HospitalClock::today()`; reporting periods are recalculated from the weekday offset and time in the settings service. Reporting periods are pre-seeded six months ahead, which combined with QA-009 lets API callers file reports for weeks that have not started.
- Cross-layer consistency: report statuses (`draft`, `submitted`, `edited_after_submission`) and action-item statuses (`open`, `assigned`, `in_progress`, `resolved`, `closed`) match between `src/types/domain.ts` and the backend; role keys match the five roles plus `student_rep`; both camelCase and snake_case inputs are accepted by the API and the SPA sends camelCase consistently.

---

## 16. Business-Logic Findings

Verified rules: draft to submitted to edited_after_submission with audit rows; locked reports refuse nurse edits and submits (403) and admin edits (422 "Locked reports are read-only", see QA-027); action items: open cannot close, in_progress needs an assignee, resolve needs a note, only resolved can close, reopen allowed; access request approval activates the user and creates assignments idempotently; rejected applicants stay inactive; evaluations require pairing on the same ward/duty on that date, one per author/subject/date/form, no future dates, correct roles; external evaluations cannot spoof an author; reps cannot change role while a batch assignment is active; a rep loses teaching access immediately after a role change; transfers: one pending per consultant, not to the own section, decided by the destination head or an admin, section switch deferred to the effective date; morning session recording limited to designated recorders on the same day; roster overrides validate date order; rotation plans validate users and blocks; form editor protects core fields and keeps historical evaluations on version 1 after publishing version 2 (912 rows verified).

Gaps: QA-003 (role change keeps clinical access), QA-006 (deadline time), QA-009 (future periods), QA-018 (cancelling an already recorded morning session succeeds and leaves 140 attendance rows attached to a cancelled session).

---

## 17. Security Findings

| Area | Result |
|---|---|
| Authentication bypass | None found |
| Authorization bypass | One: QA-003 (P1) |
| IDOR | None found (reports, notifications, exports, users, transfers, sessions) |
| CSRF | Enforced (419 without token); same-origin deployment |
| XSS | No `dangerouslySetInnerHTML`; React escaping; CSP on API responses and in nginx/htaccess; HTML and SVG uploads rejected |
| SQL injection | Parameterised queries; search strings inert; raw SQL limited to aggregates |
| Mass assignment | Role, author and admin flags validated or prohibited; `authorId` spoof 422 |
| Uploads | MIME sniffing via finfo (executable, HTML, SVG, PHP rejected), 10 MB rule, sanitised names, non-public disk, policy-checked downloads |
| Secrets | No secrets tracked in git; `.env.example` files only. Untracked `.env.production` in the repo root still holds a Supabase URL and anon key from the decommissioned backend (QA-022): delete it and rotate at the provider if it still exists |
| Debug endpoints | `/api/testing/flush-rate-limits` registered only in `local`; `APP_DEBUG=true` in production throws at boot |
| Directory listing / stack traces | 404 for `/.env` and `/storage/`; JSON errors without traces at `APP_DEBUG=false` |
| Password storage | bcrypt (rounds 12); breach check in production (QA-014 egress caveat) |
| Cookies | HttpOnly, SameSite=Lax, Secure in production, session encryption required by readiness |
| Headers | nosniff, DENY, Referrer-Policy, Permissions-Policy, CSP on API; nginx adds document CSP and HSTS |
| CORS | Explicit origin list with credentials; same-origin in production |
| Rate limiting | Login 10/min, registration 10/min, reset 5/min, authenticated 300/min per user, password change 6/min; shared per-IP bucket side effect (QA-024) |
| Brute force | Throttle plus constant-time hash check on unknown identifiers |
| Enumeration | Login, registration (all three tracks) and reset answer identically |
| Dangerous admin endpoints | Superadmin creation removed from HTTP; superadmin immune to deactivation and edits by admins |
| Public storage | Not used |
| Default passwords | Only in the local seeder, which no-ops in production |
| Revision token | 12 h HMAC credential, exposes only a global counter, not invalidated on logout, renews on every poll (QA-016) |

---

## 18. Performance Findings

- Production bundle: entry 59 KB gzip, largest chunk (charts) 99 KB gzip loaded only on chart pages, total well within the 260 KB budget; `npm run perf:budget` passes.
- Production-bundle navigation (vite preview, single PHP process): login to landing 3.7 to 4.6 s including the first authenticated bootstrap; subsequent admin pages 1.2 to 1.6 s.
- Dev-server page loads were 2.3 to 5.9 s (Vite module graph; not representative). The heaviest pages are Resident rotations (309 buttons) and Audit log (211 buttons).
- The repository's interaction-budget spec (Submissions page early interaction, p95 600 ms) failed on this host in isolation at 1,086 ms while the other 12 performance checks (login load, dashboard metrics, memory leak guard) passed. See QA-011.
- API: analytics dashboard 300 KB and about 1 s when cold, cached afterwards with after-response warming; academic snapshot 1.5 s cold, content-stamp cached; everything else under 0.25 s at the seeded size.
- Exports run in the queue worker; a 30-week CSV was 17 MB and completed in under a minute; a full-history export is bounded to 5,000 reports.
- The repository's load harness (`npm run load:test`) was run with 3 virtual users for 20 s against the single-process dev server: 66 requests, 0 failures, 0 timeouts; p95 latencies of 125 ms (workspace), 206 ms (revision poll), 228 ms (report details), 55 ms (auth), 234 ms (notifications). This is a smoke test, not a capacity measurement; real capacity numbers exist from the earlier Docker-based audit (`docker/audit/evidence`), which I could not re-run (daemon down).
- N+1: the users directory test asserts constant query counts; analytics aggregates in SQL; report index is summary-only with details fetched per opened report.
- Known scaling caveats: the dashboard payload grows with the archive (QA-028); SQLite lock contention exists only in dev.

---

## 19. Automated Test Suite Results

| Suite | Executed | Passed | Failed | Skipped | Notes |
|---|---|---|---|---|---|
| Backend PHPUnit (`php artisan test`, SQLite in memory) | 377 | 376 | 0 | 1 | 2,666 assertions, 50 s; the skip is the MariaDB concurrency test |
| Backend PHPUnit on MariaDB (CI job, 2026-09-05) | 375 | 372 | 2 + 1 error | 0 | The three failures are SQLite-specific assertions (QA-008) |
| Frontend Vitest | 131 | 128 | 3 | 0 | All three in `workspace-cache.test.ts` (QA-001) |
| ESLint | pass | | | | |
| Playwright gate (chromium) | 164 | 158 | 4 | 2 | Only after patching the seeder (QA-002); failures analysed in section 7 |
| `test:load-contract` | not run separately; part of `npm run verify`, which fails earlier on Vitest | | | | |
| Coverage | Not configured | | | | |

The existing suites are substantial (authorization route sweeps, schema constraints, MariaDB identifier-length guard, deploy-script ordering assertions) but they do not cover the role-change path that produced QA-003, and the E2E spec for the core evaluation path is stale.

---

## 20. Build and Dependency Findings

- `npm run build`: success in 2.5 s, 80 assets. `npm run lint`: clean. TypeScript: clean.
- `npm audit --omit=dev`: 3 high (react-router 7.18.1 RSC-mode CSRF advisory, twice via `react-router-dom`; `socket.io-parser` via `laravel-echo`). Neither is reachable in this client-only SPA with realtime disabled (QA-019). Dev tree: 23 advisories, mostly Lighthouse tooling.
- `composer audit --no-dev`: 12 advisories in `guzzlehttp/guzzle` 7.15.1 and `league/commonmark` 2.8.3 (QA-004).
- `composer install --no-dev --dry-run` resolves against the `php: 8.3.0` platform pin; the lock file no longer requires PHP 8.4 (the note in `docker/README.md` is stale, QA-020).
- No `engines` field in `package.json` (QA-023); README documents Node 22.12+.
- Uncommitted work in the tree: action-item deep-link notifications (plus an untracked data migration), audit narrative helpers, user role correction, UI panels. The backend part of it is what introduces QA-003.

---

## 21. DevOps Review

Strengths: `deploy/deploy.sh` takes a lock, builds an immutable release from `git archive`, runs `composer install --no-dev`, `migrate --pretend`, `npm ci`, `npm run verify`, takes and gunzip-tests a backup, enters maintenance mode, migrates, builds config/route/view caches, switches the symlink atomically, runs `app:launch-readiness --strict`, checks the auth wall (expects 401/419), restarts the queue, prunes old releases, and rolls the code back on any error. `backup.sh` reads its settings without sourcing the env file, refuses unsafe names, rotates for 30 days, copies off-box and tests integrity. `logrotate.conf`, `ufw.sh`, two systemd worker units and an nginx vhost with a single header policy are provided. `app:launch-readiness` checks 27 conditions including backup freshness, worker units, scheduler heartbeat, disk, TLS expiry and restore-drill attestation. `docs/OPERATIONS.md` is a usable runbook.

Gaps:

- QA-005: no PHP upload limits in the kit (nginx allows 20 MB, PHP default 2 MB, app promises 10 MB).
- QA-007: first-install steps never seed reference data or create the maintenance account; verified that `app:create-superadmin` fails on an unseeded database.
- QA-015: backups cover the database only; `shared/storage/app` (evidence files, export files) is not copied.
- QA-014: production password policy calls an internet API; on a LAN without egress every password operation waits for a 30 s timeout and passes.
- The deploy script's health check hits `/api/workspace`; `/up` is not routed through nginx (SPA fallback answers 200 with HTML), so external monitors must not use `/up` (QA-020).
- `deploy.sh --dry-run` validates prerequisites (git, tar, flock, php, composer, node 22.12+, npm, curl, gunzip, mysqldump) which is good; it does not check PHP-FPM pool or php.ini values.

---

## 22. CI/CD Review

`.github/workflows/ci.yml`: six jobs on pull requests and pushes to `main`: frontend (lint, test, build, budget), backend-sqlite (composer install, `composer audit`, Pint, tests), lighthouse (build, seeded backend, mobile budgets), backend-mariadb (MariaDB 11.4 service, `phpunit.mariadb.xml`), deployment-scripts (`bash -n`, ShellCheck), e2e (`npm run test:e2e`). There is no deploy job; production deploys are manual through `deploy.sh`, so CI cannot deploy anything by accident, but it also cannot stop a bad merge because `main` is unprotected (QA-013).

Actual state (run 33954070018, 2026-09-05): backend-sqlite failed at `composer audit` (QA-004); backend-mariadb failed with 2 failures and 1 error (QA-008); e2e and lighthouse failed at "E2E database preparation exited 1" (QA-002); frontend and deployment-scripts passed. From 2026-09-06 the frontend job also fails (QA-001). The four earlier runs on this branch were red too.

Secrets: none printed; the MariaDB test password is a throwaway service credential. Node version pinned to 22, PHP to 8.3, matching the server.

---

## 23. Docker / Infrastructure Review

`compose.yaml` and `docker/Dockerfile` define a production-parity stack (MariaDB 11.4, PHP-FPM 8.3 with opcache and 20 MB upload limits, nginx with the real vhost and a self-signed cert, queue worker, scheduler, and a MariaDB test lane). `docker compose config` validates. Health checks gate startup; ports bind to 127.0.0.1; `.dockerignore` excludes env files and SQLite databases. The daemon was not running on the audit machine so the stack was not built. `docker/README.md` still says the lock file forces PHP 8.4 and that a parity patch is applied; both statements are out of date (QA-020). The stack is not used for production (the department server is a plain Ubuntu host), so this does not affect the verdict.

---

## 24. Environment and Secrets Review

Tracked: `.env.example`, `.env.local.example`, `backend/.env.example`, `.env.docker` (documented placeholders including a throwaway `APP_KEY`). Untracked and ignored: `backend/.env` (local SQLite, debug on, log mail), `.env.local`, `.env.production` (stale Supabase pair, QA-022). Required production variables are fully documented in `deploy/README.md` step 7 and `backend/.env.example`; `config/operations.php` maps the host signals so they survive `config:cache`; `TRUSTED_PROXIES` is read from the cached config in `bootstrap/app.php`. `REPORT_WINDOW_LIVE_START=2024-08-05` and `SEED_HISTORY_WEEKS=104` in the local backend env are fixture settings that must not be copied to the server (documented). Nothing hard-coded to localhost exists in application code outside setup hints and dev proxies.

---

## 25. Migration and Database Deployment Safety

All 77 migrations were read. They are additive (new tables, nullable columns, indexes) or data repairs (repointing notification routes, normalising identifiers and titles, copying legacy evaluations into the unified tables, seeding structure and forms). No table or column holding user data is dropped; the legacy evaluation tables are kept read-only. Risky points:

- `2026_09_27_000005_normalize_user_login_identifiers` deliberately throws on case-variant duplicate emails or usernames; check the production dump first (query given in the checklist).
- `2026_10_02_000010_strengthen_clinical_action_governance` rebuilds `action_items` on SQLite and re-creates the ledger triggers; on MariaDB it is a plain ALTER. MariaDB has no transactional DDL, so a mid-way failure needs manual cleanup; `deploy.sh` mitigates with a verified backup and maintenance mode.
- Several `down()` methods are intentionally no-ops; rollback is by restore, which the deploy kit states clearly.
- Identifier length is guarded by a test (`V2OperationalConfigurationTest`) and the MariaDB CI job ran the full migration set successfully.
- Migration filenames carry future dates (QA-021).

Verdict: the migrations can run against the existing production database, provided the identifier check passes and the pre-migration backup is taken (which `deploy.sh` enforces).

---

## 26. Backup, Rollback and Recovery

- Backup before migration: yes, enforced and integrity-tested by `deploy.sh`.
- Nightly backup: `deploy/backup.sh` on cron with off-box copy and weekly integrity test; freshness checked by readiness.
- File/storage backup: **missing** for `shared/storage/app` (QA-015).
- Restore procedure: documented monthly drill and real-restore steps in `docs/OPERATIONS.md`; readiness fails without a drill within 90 days.
- Code rollback: automatic on failed post-switch checks; manual symlink procedure documented.
- Failed deployment recovery: maintenance mode is lifted and the previous release restored by the ERR trap; database recovery is by dump.

---

## 27. Logging and Monitoring

- Application log: `laravel.log` (single channel, rotated weekly by logrotate); queue workers log to `/var/log/imreport-queue*.log`; scheduler to `schedule.log`.
- Health: `app:launch-readiness` (also aliased `app:launch-check`) and `queue:monitor-health --json` every minute with depth and age thresholds.
- Frontend: sampled real-user timings posted to `/api/performance/rum` (10 percent by default), no client error reporting.
- Error alerting: none built in; `ERROR_MONITORING_CHANNEL` must name a Sentry project or a review procedure, otherwise strict readiness fails. This is a conscious, documented gap rather than an oversight.
- Blind spots: no uptime probe path suitable for external monitors (QA-020), no alert on failed queue jobs beyond the log, console noise on every page (QA-025).

---

## 28. Production Deployment Checklist

- [!] `npm run verify` green (QA-001)
- [!] `php artisan db:seed` works (QA-002)
- [!] Role-change authorization fixed and tested (QA-003)
- [!] `composer audit --no-dev` clean (QA-004)
- [!] PHP upload limits in the FPM pool (QA-005)
- [x] Backend tests green locally (376/1 skipped)
- [x] Production build and performance budget green
- [x] Playwright gate green except the four analysed failures (after QA-002)
- [x] `APP_DEBUG=false` enforced; secure cookie defaults in production
- [x] Atomic deploy script with verified backup and rollback
- [ ] First-install seeding and superadmin creation added to the runbook (QA-007)
- [ ] Storage directory included in backups (QA-015)
- [ ] MariaDB duplicate-identifier pre-check on the production dump
- [ ] SMTP and SMS transports configured and test-delivered
- [ ] Both queue worker units and cron installed; `app:launch-readiness --strict` green on the host
- [ ] Branch protection on `main` (QA-013)
- [ ] Egress to the breach-check API or `uncompromised()` removed (QA-014)
- [ ] Mobile tab bar overflow fixed for academic roles (QA-012)

---

## 29. Full Issue Register

### QA-001: `npm run verify` fails, so `deploy/deploy.sh` aborts

- Severity: P1 (Critical)
- Module: Frontend / offline workspace cache / release pipeline
- Feature: `npm run verify` (the deploy gate) and the CI `frontend` job
- Environment: all, time-triggered from 2026-09-06
- Status: FAILED (reproduced)
- Description: `src/lib/offline/workspace-cache.test.ts` builds records with `cachedAt: '2026-06-08T00:00:00.000Z'`; `MAX_CACHE_AGE_MS` is 90 days, so the fixture expired today and three tests fail.
- Expected: `npx vitest run` passes 131 tests.
- Actual: 3 failed, 128 passed; `npm run verify` exits 1; `deploy.sh` stops before building a release.
- Steps: 1. `npx vitest run`. 2. Observe the three failures. 3. `npm run verify` exits non-zero.
- Evidence: Vitest output in section 19; `deploy/deploy.sh` line `npm run verify` after `npm ci`.
- Root cause: absolute date in a fixture that interacts with wall-clock expiry.
- Files: `src/lib/offline/workspace-cache.test.ts` (createRecord), `src/lib/offline/workspace-cache.ts` (MAX_CACHE_AGE_MS).
- Fix: use `new Date().toISOString()` or `vi.useFakeTimers()` with `vi.setSystemTime`.
- Deployment impact: blocks the documented deploy path.

### QA-002: `php artisan db:seed` crashes with a `TypeError`

- Severity: P1 (Critical)
- Module: Database seeding / CI / local and staging setup
- Feature: `DevClinicalDataSeeder`, Playwright gate, Lighthouse job
- Environment: any environment that is not `production` or `testing`
- Status: FAILED (reproduced locally and in CI)
- Description: `DevClinicalDataSeeder::raiseCriticalEventAlerts` calls `CriticalEventAlertService::notify($report, $route, $now)` but the method signature is `notify(Report $report, Carbon $now)`.
- Expected: seeding completes as documented in README and required by `scripts/start-e2e-backend.mjs`.
- Actual: `TypeError: Argument #2 ($now) must be of type Illuminate\Support\Carbon, string given` at line 348; Playwright reports "E2E database preparation exited 1"; CI e2e and lighthouse jobs fail.
- Steps: 1. `cd backend`. 2. `php artisan migrate:fresh --seed --force` with `APP_ENV=local`.
- Evidence: seeder output in section 2; CI log excerpt in section 22.
- Root cause: `notify()` was refactored to build the route from the action item; the seeder call was not updated. Committed at HEAD.
- Files: `backend/database/seeders/DevClinicalDataSeeder.php:340-350`, `backend/app/Services/Reports/CriticalEventAlertService.php:77`.
- Fix: `$raised += $alerts->notify($report, $now) > 0 ? 1 : 0;` and remove the `$route` local; add a test that boots the dev seeders under `APP_ENV=local`.
- Deployment impact: production runtime unaffected (the seeder self-guards), but the release cannot be validated and staging cannot be built.

### QA-003: Role change to `student_rep` keeps clinical report access

- Severity: P1 (Critical)
- Module: Users / authorization
- Feature: `PATCH /api/admin/users/{user}` role correction (uncommitted change) and report policies
- Environment: all
- Status: FAILED (verified live)
- Description: `ASSIGNABLE_ROLES` now allows `student_rep` in `update`, and `assertRoleChangeIsSafe` only guards rep-to-other. Report policies authorise from the assignment row without checking permissions, so a converted account keeps full nurse access to its ward reports.
- Expected: a `student_rep` never lists, reads, edits or submits clinical reports (the code documents this as a structural guarantee).
- Actual: after the role change, `GET /api/reports/{id}` 200, `PUT /api/reports/{id}` 200 (value persisted), `POST /api/reports/{id}/submit` 200; `/api/auth/me` reports role `student_rep` with only `teachingLog.record`.
- Steps: 1. As superadmin create a nurse and an assignment. 2. As the nurse create a draft report. 3. `PATCH /api/admin/users/{id}` with `{"role":"student_rep"}` (200). 4. As that account call the three report endpoints.
- Evidence: probes ROLE-01, ROLE-04, ROLE-05, ROLE-06 in this session.
- Root cause: `HandlesDomainAuthorization::ownsAssignment`/`canViewAssignedReport` and `ReportWorkflowController::index` rely on `report_assignments.nurse_id`.
- Files: `backend/app/Http/Controllers/Api/Admin/UserController.php` (ASSIGNABLE_ROLES, assertRoleChangeIsSafe), `backend/app/Policies/Concerns/HandlesDomainAuthorization.php`, `backend/app/Http/Controllers/Api/ReportWorkflowController.php` (index, statusHistory).
- Fix: require `Permissions::REPORTS_SUBMIT` / `REPORTS_VIEW_ASSIGNED` in the policy helpers and controller scopes; refuse or retire active assignments on nurse-to-other role changes; regression test.
- Deployment impact: must be fixed before deploying the uncommitted change; if the change is not shipped the exposure does not exist, but the policy hardening should ship regardless.

### QA-004: `composer audit` fails on production dependencies

- Severity: P2 (High)
- Module: Backend dependencies / CI
- Status: FAILED (reproduced)
- Description: 12 advisories: `guzzlehttp/guzzle` 7.15.1 (CVE-2026-69246 high, CVE-2026-69245 medium), `league/commonmark` 2.8.3 (eight high DoS advisories and CVE-2026-71478 medium plus an XSS in the attributes extension). Both are transitive production dependencies of `laravel/framework`.
- Actual: `composer audit --no-dev` exit 1; CI `backend-sqlite` job fails at "Audit backend dependencies".
- Evidence: `php composer.phar audit --no-dev --format=json` in this session; CI run 33954070018.
- Exposure: CommonMark is only used for framework mail markdown; Guzzle for outbound HTTP (breach check). Practical risk is low, CI impact is total.
- Fix: `composer update guzzlehttp/guzzle league/commonmark --with-all-dependencies`, re-run tests.
- Deployment impact: blocks CI; policy decision for production.

### QA-005: Uploads between 2 MB and 10 MB fail in the documented production setup

- Severity: P2 (High)
- Module: Action items / evidence upload, deploy kit
- Status: FAILED (reproduced with default PHP limits)
- Description: The app allows 10 MB (`max:10240`), the UI says "max 10 MB", nginx allows 20 MB, but `deploy/php-fpm.conf` never raises PHP's default `upload_max_filesize=2M` / `post_max_size=8M`. A 3 MB text file returned 422 "The file failed to upload."; an 11 MB file returned 413 JSON.
- Evidence: probes UPL-06 and UPL-07; `docker/php/php.ini` sets 20M/21M for the parity stack, the production pool file does not.
- Fix: add `php_admin_value[upload_max_filesize] = 12M` and `php_admin_value[post_max_size] = 20M` to `deploy/php-fpm.conf`; add a check to `app:launch-readiness`.
- Deployment impact: evidence uploads above 2 MB fail in production until fixed.

### QA-006: Settings accept an impossible deadline time and rewrite every period deadline

- Severity: P2 (High)
- Module: Settings
- Status: FAILED (reproduced)
- Description: `weeklyDeadlineTime` is validated with `regex:/^\d{2}:\d{2}$/`; `25:99` and `99:99` are accepted. The service then recalculates `deadline_at` for all reporting periods with `setTime(25, 99)`, moving every deadline to the next day at 02:39.
- Evidence: `PUT /api/admin/settings` 200 with `25:99`; `reporting_periods.deadline_at` changed from Monday 10:00 to Tuesday 02:39 for all rows; restored afterwards.
- Mitigation: the settings page uses `<input type="time">`, so only API callers hit it.
- Fix: `date_format:H:i` on both key spellings.
- Deployment impact: not blocking; data-integrity risk from any scripted caller.

### QA-007: First-install runbook never seeds reference data or creates the maintenance account

- Severity: P3 (Medium)
- Module: Deployment documentation
- Status: FAILED (verified)
- Description: `deploy/README.md` "First installation" runs `deploy.sh` (migrate only). `users.role_key` references `roles`, and `app:create-superadmin` fails with `FOREIGN KEY constraint failed` on an unseeded database; templates, departments, field definitions and settings are also empty.
- Fix: add `php artisan db:seed --force` and `php artisan app:create-superadmin` after the first deploy (the launch checklist already mentions seeding).

### QA-008: MariaDB CI lane is red because three tests are SQLite-specific

- Severity: P3 (Medium)
- Module: Backend tests
- Status: FAILED (CI evidence)
- Description: `WorkspaceRevisionLedgerTest` queries `sqlite_master` and asserts a version of 0 that MariaDB does not start at; `EvaluationFormEngineTest::test_snapshot_hydrates...` matches `from "evaluations"` with SQLite quoting. The other 372 tests pass on MariaDB, so this is a test defect that hides real regressions.
- Fix: query `information_schema.triggers` on MariaDB; compare identifiers driver-agnostically; reset the ledger in setUp.

### QA-009: Reports for future reporting periods are accepted and then invisible

- Severity: P3 (Medium)
- Module: Clinical reports
- Status: FAILED (reproduced)
- Description: periods are seeded six months ahead; `POST /api/reports` accepted a report for 2027-02-22 (201) and neither the default nor the `all` window lists it.
- Fix: reject periods whose `week_start` is after the current hospital week in `ReportWorkflowController::store` and the submission service.

### QA-010: Duplicate subgroup placement returns HTTP 500

- Severity: P3 (Medium)
- Module: Undergraduate admin
- Status: FAILED (reproduced)
- Description: second `POST /api/admin/subgroup-placements` with the same batch, subgroup and week hits the unique index and surfaces as "Server Error".
- Fix: validate the triple or catch `UniqueConstraintViolationException` and return 422.

### QA-011: Stale or fragile E2E specs

- Severity: P3 (Medium)
- Module: Playwright gate
- Status: FAILED (gate run)
- Description: (a) `academic-evaluation-submit.spec.ts` targets a combobox that became a radiogroup, so the core peer-evaluation path is ungated; (b) `v2-role-workflows.spec.ts` assumes a morning session exists today; (c) the `performance.spec.ts` interaction budget for the Submissions page (p95 600 ms) fails on this Windows host both in the full run (801 ms) and in isolation (1,086 ms), so it must be re-measured on the Linux parity stack before it is trusted as a gate or dismissed as environmental.
- Fix: update selectors; skip on non-session days; re-run the budget spec on the parity stack and either fix the Submissions early-interaction cost or record the budget as parity-stack-only.

### QA-012: Mobile bottom tab bar overflows for academic roles

- Severity: P3 (Medium)
- Module: App shell (mobile)
- Status: FAILED (reproduced at 390 px)
- Description: resident and consultant landings scroll horizontally by 82 px because the fixed bottom `nav` with four tabs is 472 px wide; the evaluation form's subject block overflows by 16 px.
- Fix: constrain the tab bar to the viewport with shrinking labels and `min-w-0` on the subject grid.

### QA-013: `main` has no branch protection

- Severity: P3 (Medium)
- Module: Repository / CI
- Status: VERIFIED (GitHub API 404 "Branch not protected")
- Fix: require the six CI jobs before merge.

### QA-014: Production password policy depends on internet egress

- Severity: P3 (Medium)
- Module: Authentication
- Status: CODE-REVIEW ONLY
- Description: `Password::defaults()` adds `->uncompromised()` in production, which calls `api.pwnedpasswords.com` with a 30 s timeout and passes on failure. On a LAN-only server every password create, reset or change waits up to 30 s and the check silently passes.
- Fix: allow egress or drop the rule; document the decision.

### QA-015: Uploaded files are not part of the backup

- Severity: P3 (Medium)
- Module: Backup
- Status: CODE-REVIEW ONLY
- Description: `backup.sh` dumps the database only; `shared/storage/app` (evidence, exports) is not copied.
- Fix: add an rsync of `shared/storage/app` to the secondary location.

### QA-016: Workspace revision token survives logout and renews itself

- Severity: P4 (Low)
- Module: Workspace polling
- Status: VERIFIED
- Description: the 12 h HMAC token remains valid after logout and each `/api/workspace/revision` call issues a fresh one, so a leaked token can poll the global change counter indefinitely. No workspace data is exposed.
- Fix: bind the token to the session id or stop re-issuing without a session.

### QA-017: Duplicate email differing only by case returns 500 on SQLite

- Severity: P4 (Low)
- Module: Users
- Status: FAILED on SQLite, not reproducible on MariaDB (case-insensitive collation)
- Fix: lowercase before the `unique` rule.

### QA-018: Cancelling an already recorded morning session succeeds

- Severity: P4 (Low)
- Module: Morning sessions
- Status: FAILED (reproduced)
- Description: `POST /api/admin/morning-sessions/{id}/cancel` on a recorded session returned 200; status became `cancelled` while 140 attendance rows remain.
- Fix: refuse cancellation once recorded, or clear attendance in the same transaction.

### QA-019: npm audit shows three high advisories in the production tree

- Severity: P4 (Low)
- Description: `react-router` RSC-mode CSRF (not applicable to client-only routing) and `socket.io-parser` via `laravel-echo` (realtime disabled, tree-shaken). Update at the next dependency pass.

### QA-020: Stale documentation

- Severity: P4 (Low)
- Description: `/up` is described as the health check but nginx does not route it (SPA fallback answers 200 HTML); `docker/README.md` claims the lock file needs PHP 8.4 and mentions a parity patch that no longer exists; `docs/ARCHITECTURE.md` mentions a welcome view.

### QA-021: Migration filenames are dated in the future

- Severity: P4 (Low)
- Description: files named `2026_09_09` to `2026_10_04` exist while today is 2026-09-06; a new migration with a real timestamp sorts before them on a fresh database.

### QA-022: Repository hygiene

- Severity: P4 (Low)
- Description: untracked `.env.production` with a Supabase URL and anon key (delete; rotate at the provider if the project still exists); an empty `deploy;C` directory from a mistyped redirect; `.codex-temp/` logs and old SQLite copies; more than twenty audit and planning markdown files in the repo root.

### QA-023: No `engines` field in `package.json`

- Severity: P4 (Low)
- Description: Node 22.12+ is documented only in README and checked only by `deploy.sh --dry-run`.

### QA-024: Shared per-IP throttle bucket across public auth routes

- Severity: P4 (Low)
- Description: the default limiter key is domain plus IP, so after five failed logins the forgot-password route (limit 5/min) answers 429 for a minute. Observed during probing.

### QA-025: Console error on every cold visit

- Severity: P4 (Low)
- Description: `/api/auth/me` is probed unauthenticated and the browser logs a 401 resource error; the CSRF request aborted by login navigation is also logged.

### QA-026: Manual admin setup page shows the title "Dashboard"

- Severity: P4 (Low)
- Description: `/admin/manual-admin-setup` is not a navigation item, so the shell header falls back to "Dashboard".

### QA-027: Locked-report semantics differ between policy and service

- Severity: P4 (Low)
- Description: `ReportPolicy::update` allows admins on locked reports but `ReportSubmissionService` returns 422 "Locked reports are read-only". Behaviour is safe; document that admins must unlock first.

### QA-028: Analytics dashboard payload and cold latency

- Severity: P4 (Low)
- Description: 300 KB and about 1 s cold for a 30-week archive; cached and warmed afterwards. Watch as the archive grows; consider server-side pagination of the department breakdown.

---

## 30. Feature Verification Matrix

| ID | Module | Feature | Test method | Desktop | Mobile | Backend/API | Result | Severity | Notes |
|---|---|---|---|---|---|---|---|---|---|
| F01 | Auth | Login (email/username) | UI + API | PASS | PASS | PASS | PASS | | |
| F02 | Auth | Logout / session restore | UI + API | PASS | PASS | PASS | PASS | | |
| F03 | Auth | Invalid / empty credentials | UI + API | PASS | n/t | PASS | PASS | | |
| F04 | Auth | Throttling | API | n/a | n/a | PASS | PASS | | QA-024 side effect |
| F05 | Auth | Forgot password | UI + API | PASS | n/t | PASS | PARTIAL | | mail delivery BLOCKED |
| F06 | Auth | Reset password | API | n/t | n/t | PASS | PARTIAL | | token path verified, mail BLOCKED |
| F07 | Auth | Forced password change | API | n/t | n/t | PASS | PASS | | |
| F08 | Auth | Protected routes redirect | UI | PASS | PASS | PASS | PASS | | |
| F09 | Registration | Nurse signup | UI + API | PASS | PASS (renders) | PASS | PASS | | |
| F10 | Registration | Academic signup | UI (render) | PASS | n/t | reviewed | CODE-REVIEW ONLY | | |
| F11 | Registration | Admin signup | UI + API | PASS | n/t | PASS | PASS | | |
| F12 | Users | Approve / reject nurse request | UI + API | PASS | n/t | PASS | PASS | | |
| F13 | Users | Approve admin request | UI | PASS | n/t | PASS | PASS | | |
| F14 | Users | Search / roster / workspace scope | UI + API | PASS | PASS | PASS | PASS | | |
| F15 | Users | Create accounts | API | n/t | n/t | PASS | PASS | | |
| F16 | Users | Edit / reset password | API | n/t | n/t | PASS | PASS | | |
| F17 | Users | Deactivate / activate | UI + API | PASS | n/t | PASS | PASS | | |
| F18 | Users | Role correction | API | n/t | n/t | FAIL | FAIL | P1 | QA-003 |
| F19 | Assignments | Assignment studio | API (+UI render) | PASS | n/t | PASS | PASS | | |
| F20 | Reports | Draft / save / submit | UI + API | PASS | PASS (form) | PASS | PASS | | |
| F21 | Reports | Validation | API | n/a | n/a | PASS | PASS | P3 | QA-009 future period |
| F22 | Reports | Lock / unlock | API | n/t | n/t | PASS | PASS | P4 | QA-027 |
| F23 | Reports | Comments | API | n/t | n/t | PASS | PASS | | |
| F24 | Reports | My Reports / Activity | UI | PASS | PASS | PASS | PASS | | |
| F25 | Reports | Submission board | UI | PASS | PASS | PASS | PASS | | |
| F26 | Import | Templates + import | UI + API | PASS | PASS (render) | PASS | PASS | | |
| F27 | Analytics | Dashboard + endpoints | UI + API | PASS | PASS | PASS | PASS | P4 | QA-028 |
| F28 | Analytics | Department detail | UI (render) | PASS | n/t | PASS | PASS | | |
| F29 | Export | Queue / worker / download | UI + API | PASS | PASS (render) | PASS | PASS | | |
| F30 | Action items | Queue + sheet + state machine | UI + API | PASS | PASS | PASS | PASS | | |
| F31 | Action items | Evidence upload/download | API | n/t | n/t | PASS | PASS | P2 | QA-005 size limits |
| F32 | Action items | Alert rules | API list | n/t | n/t | PASS | PARTIAL | | CRUD not exercised |
| F33 | Templates | Content edit / hide / delete guard | UI + API | PASS | PASS (render) | PASS | PASS | | |
| F34 | Settings | Persist / reload | UI + API | PASS | PASS (render) | PASS | PASS | P2 | QA-006 |
| F35 | Audit | Clinical / admin / academic logs | UI + API | PASS | PASS | PASS | PASS | | |
| F36 | Notifications | Read / delete / restore / clear / undo | UI + API | PASS | PASS | PASS | PASS | | |
| F37 | Workspace | Switcher + persistence | UI | PASS | PASS | n/a | PASS | | |
| F38 | Academic | Resident evaluates consultant | UI + API | PASS | overflow | PASS | PASS | P3 | QA-012 (16 px) |
| F39 | Academic | Consultant evaluates resident | API | n/t | n/t | PASS | PASS | | |
| F40 | Academic | Student evaluation | API | n/t | n/t | PASS | PASS | | |
| F41 | Academic | History / my performance | UI + API | PASS | PASS | PASS | PASS | | |
| F42 | Academic | Morning session record | API | n/t | n/t | policy PASS | PARTIAL | | no session on audit day |
| F43 | Academic | Morning admin update / overrides / cancel | API | n/t | n/t | PASS | PASS | P4 | QA-018 |
| F44 | Academic | Transfer request lifecycle | API | n/t | n/t | PASS | PASS | | |
| F45 | Academic admin | Dashboard + ops tabs | UI + API | PASS | PASS | PASS | PASS | | |
| F46 | Academic admin | Submissions + external entry | UI + API | PASS | PASS | PASS | PASS | | |
| F47 | Academic admin | Duty roster | UI + API | PASS | PASS | PASS | PASS | | |
| F48 | Academic admin | Rotation planner | UI + API | PASS | PASS | PASS | PASS | | |
| F49 | Academic admin | Structure CRUD | UI + API | PASS | PASS | PASS | PASS | | |
| F50 | Academic admin | Form editor draft/publish | API (+UI render) | PASS | PASS | PASS | PASS | | |
| F51 | Undergraduate | Batches / students / import | API (+UI render) | PASS | PASS | PASS | PASS | | |
| F52 | Undergraduate | Placements | API | n/t | n/t | FAIL on duplicate | PARTIAL | P3 | QA-010 |
| F53 | Undergraduate | Rep assignments + role guard | API | n/t | n/t | PASS | PASS | | |
| F54 | Undergraduate | Rep held / not-held log | UI + API | PASS | PASS | PASS | PASS | | |
| F55 | Undergraduate | Consultant attendance | API + UI | PASS (empty state) | PASS | PASS (validation) | PARTIAL | | no session on audit day |
| F56 | Platform | Mobile shell (tab bar, sheet) | UI | n/a | FAIL for academic roles | n/a | FAIL | P3 | QA-012 |
| F57 | Platform | Production bundle + service worker + offline | UI | PASS | n/t | n/a | PASS | | |
| F58 | Platform | 404 page, back/forward | UI | PASS | n/t | n/a | PASS | | |
| F59 | Platform | Scheduled commands | schedule:list | n/a | n/a | listed | CODE-REVIEW ONLY | | |
| F60 | Platform | Email / SMS delivery | n/a | n/a | n/a | BLOCKED | BLOCKED | | no transport |
| F61 | Platform | Realtime | n/a | n/a | n/a | disabled | NOT APPLICABLE | | |
| F62 | DevOps | deploy.sh gate | executed `npm run verify` | n/a | n/a | n/a | FAIL | P1 | QA-001 |
| F63 | DevOps | Seed / E2E gate | executed | n/a | n/a | n/a | FAIL | P1 | QA-002 |
| F64 | DevOps | Dependency audits | executed | n/a | n/a | n/a | FAIL | P2 | QA-004 |
| F65 | DevOps | Launch readiness command | executed locally | n/a | n/a | n/a | PASS | | fails on local config as designed |
| F66 | DevOps | First install | simulated | n/a | n/a | n/a | FAIL | P3 | QA-007 |
| F67 | DevOps | Migrations on MariaDB | CI evidence | n/a | n/a | n/a | PASS | | |
| F68 | DevOps | Backups | code review | n/a | n/a | n/a | PARTIAL | P3 | QA-015 |
| F69 | DevOps | Load test harness | executed 3 VU / 20 s | n/a | n/a | n/a | PASS | | 66/66 requests OK, p95 under 235 ms on the single-process dev server |

n/t = not tested on that surface.

---

## 31. Deployment Blockers

1. QA-001: `npm run verify` fails, so `deploy/deploy.sh` cannot build a release.
2. QA-002: `php artisan db:seed` crashes, so the browser gate and staging setup cannot run; the release cannot be validated.
3. QA-003: student representative keeps clinical report access after a role change (authorization defect in the uncommitted change).
4. QA-004: production dependency advisories fail `composer audit`, keeping CI red.

---

## 32. Recommended Fix Order

1. Security and data integrity: QA-003, then QA-006, QA-009, QA-018.
2. Broken pipeline and core validation: QA-001, QA-002, QA-004, QA-008, QA-011, QA-013.
3. Deployment and configuration: QA-005, QA-007, QA-015, QA-014, QA-020, QA-023.
4. Authorization hardening beyond the defect: QA-016.
5. API and data consistency: QA-010, QA-017, QA-027, QA-021.
6. UX and responsive: QA-012, QA-026, QA-025, QA-024.
7. Performance: QA-028, QA-019.
8. Cleanup: QA-022.

---

## 33. Final Deployment Verdict

### Can I deploy this system right now?

**NO.**

The application itself is in good shape: every core workflow succeeded through both the API and the real interface, and the security model held up against a broad set of probes. But the project's own release gate is red on three independent counts (a date-sensitive unit test, a seeder crash, and failing dependency audits), and the uncommitted role-correction change opens a real authorization hole. Fix those four, re-run `npm run verify`, `php artisan test`, `composer audit` and `npm run test:e2e`, and this system is ready for the launch checklist.

**Confidence: MEDIUM.** High confidence in the findings themselves (all reproduced first hand), medium confidence in overall readiness because MariaDB behaviour was only observed through CI, email and SMS delivery could not be exercised, the Docker parity stack and the department server were not reachable, and morning-session recording could not be exercised on a Sunday.

---

### FINAL VERDICT

**Deploy now:** NO
**Confidence:** MEDIUM
**P0 Blockers:** 0
**P1 Critical Issues:** 3
**P2 High Issues:** 3
**Functional Coverage:** 90% (62 of 69 inventoried features verified or partially verified; 5 blocked or code-review only; 2 not applicable)
**Automated Tests:** 662 passed / 7 failed (backend 376/0, frontend 128/3, Playwright 158/4; 3 skipped not counted)
**Playwright Workflows Tested:** 164 gate tests plus 14 custom end-to-end workflows across 5 roles and 2 viewports
**Deployment Readiness:** 80%

### TOP REASONS FOR THE VERDICT

1. The sanctioned deploy path (`deploy.sh` with `npm run verify`) and four of six CI jobs fail today; nothing can be built or validated through the process the team designed.
2. The uncommitted role-correction feature lets an admin turn a nurse into a student representative who still reads, edits and submits clinical reports.
3. Two production configuration gaps would surface immediately after go-live: uploads over 2 MB fail with the shipped PHP-FPM pool, and the first-install runbook produces a database on which the maintenance account cannot be created.

### MUST FIX BEFORE DEPLOYMENT

1. `QA-003` Refuse or retire active report assignments on role changes and require the report permission in the assignment policies.
2. `QA-001` Make the workspace-cache test fixture relative to the current time.
3. `QA-002` Fix the seeder call to `CriticalEventAlertService::notify()`.
4. `QA-004` Update `guzzlehttp/guzzle` and `league/commonmark`.
5. `QA-005` Add PHP upload limits to `deploy/php-fpm.conf`.
6. `QA-007` Add `db:seed --force` and `app:create-superadmin` to the first-install steps.

### SAFE TO FIX AFTER DEPLOYMENT

1. `QA-006` Deadline time validation (`date_format:H:i`).
2. `QA-008`, `QA-011`, `QA-013` Test-lane and branch-protection hygiene.
3. `QA-009`, `QA-010`, `QA-017`, `QA-018` Validation and business-rule edges.
4. `QA-012` Mobile tab bar overflow for academic roles.
5. `QA-014`, `QA-015`, `QA-016`, `QA-019` through `QA-028` Operational, documentation and cleanup items.

### UNVERIFIED AREAS

1. MariaDB runtime behaviour on the department server (only CI evidence).
2. Email and SMS delivery (no transport configured locally).
3. Morning-session recording and consultant attendance on a live session day.
4. Academic self-enrollment end to end (endpoint reviewed, form rendered, not submitted).
5. The Docker parity stack and the real host: nginx, PHP-FPM, systemd units, TLS, cron, backups.
6. Scheduled commands executing on a live clock (only `schedule:list` reviewed).
