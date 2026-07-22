# FUNCTIONAL TEST MATRIX

Role x workflow coverage for the St Paul IM reporting and academic platform.

- **Date:** 2026-07-22
- **Branch / commit-ish:** `feat/excel-import`. Discovery baseline taken at `d82edb3`; remediation landed at
  `43bbccc` (16 findings fixed, 32 regression tests added) and `af15ac0` (8 new Playwright specs authored).
- **Purpose:** state, per role and per workflow, HOW each path was exercised and to WHAT confidence level.
  This document reports coverage; it does not re-audit. Every row cites its evidence.
- **Sources:** `artifacts/audit-2026-07-21/discovery/05-modules-workflows.md` (workflow inventory and state
  machines), `.../06-existing-tests-and-harness.md` (test estate and E2E spec coverage),
  `.../03-roles-permissions.md` (role x policy truth tables), `AUDIT_FINDINGS.md`, `AUDIT_PROGRESS.md`
  (CHECKPOINT 5 and 8), and the backend test classes under `backend/tests/`.

## Reading this matrix honestly

Most functional verification in this audit came from the **backend feature suite** and from **code
inspection**, not from a browser. The Playwright role sweep was **authored and committed** (`af15ac0`) but
its **execution is happening in a separate workflow**; its results live in **`PLAYWRIGHT_TEST_REPORT.md`
(produced separately)**, not here. Nothing in this document should be read as "browser-verified" unless a row
says so, and no such row exists yet: the running tally in `AUDIT_PROGRESS.md` still reads
`Roles fully tested: 0 / 6` for end-to-end browser testing.

### Status vocabulary (confidence, most to least)

| Status | Meaning |
|---|---|
| **VERIFIED (both lanes)** | Executed as a backend feature/unit test and green on BOTH the SQLite dev lane and the MariaDB production-engine lane. SQLite 313 passed / 1 skipped; MariaDB 314 passed / 0 failures (`AUDIT_PROGRESS.md` CHECKPOINT 8). |
| **VERIFIED (MariaDB journey)** | Reproduced end to end against the containerised production-parity stack through nginx, not only as a unit test. Used for exactly one workflow (`AUD-API-002`). |
| **UNVERIFIED (code inspection)** | Behaviour reasoned from source (file:line) during discovery. Not executed. This is the audit's explicit VERIFIED-vs-PREDICTED boundary. |
| **E2E PENDING** | A Playwright spec targets this path. It was committed but not executed in this reporting workflow. Result: see `PLAYWRIGHT_TEST_REPORT.md` (produced separately). |
| **NOT TESTED** | No backend test, no E2E spec, and no reproduced code-inspection finding covers this path. |

"How exercised" values used below: **Backend feature test**, **MariaDB lane**, **MariaDB nginx journey**,
**Vitest (frontend unit)**, **Playwright spec**, **Code inspection**, **NOT TESTED**.

### Roles

Six authenticatable roles (`discovery/03-roles-permissions.md` section 1.3): `superadmin` (labelled
"Maintenance", console-created only), `admin`, `nurse`, `resident`, `consultant`, `student_rep`. `student`
is a non-account subject record with no login path (`03` section 7). The dev DB holds **zero `admin`
accounts** (`03` section 1.4), so admin-specific behaviour was exercised in backend tests that create an
admin fixture; there is no seeded plain-admin account and the E2E harness substitutes superadmin for admin
(`06` section 9 A1), leaving the **admin vs superadmin boundary untested end to end**.

---

## Coverage at a glance

| # | Workflow | Backend feature test | MariaDB lane | Playwright (execution separate) | Headline gap |
|---|---|:--:|:--:|:--:|---|
| 1 | Clinical weekly reporting | Yes (ReportWorkflowTest, 13) | Yes | clinical report lifecycle spec (new) + `forms.spec.ts` (weak) | Browser write path never completed a submit at discovery time (`06` section 9.3) |
| 2 | Academic evaluation | Yes (AcademicEvaluationApiTest 9, AcademicEligibilityTest 9) | Yes | academic evaluation submit spec (new) + `forms.spec.ts` (weak) | Duplicate-submission guard is a code-derived finding (C-DB-012) |
| 3 | Morning session | Yes (MorningSessionTest 13, V2ReadAuthorizationTest) | Yes | `v2-role-workflows.spec.ts` (record/cancel + audit) | Override CRUD endpoints uncovered; `non_recorder` spec contradiction (see discrepancies) |
| 4 | Teaching / undergraduate | Yes (UndergraduateModuleTest 26) | Yes | `v2-role-workflows.spec.ts` (rep scope, API-only) | Rep pages never opened in a browser; `recordAttendance` over-permission (B.3) |
| 5 | Duty roster | Yes (RosterTest 17) | Yes + **nginx journey** | none | `AUD-API-002` fixed and verified; no browser spec for the grid |
| 6 | Rotations | Yes (RotationPlannerTest 7, RosterTest) | Yes | none | No browser coverage; some rotation admin endpoints uncovered |
| 7 | Section transfers | Yes (SectionTransferTest 14) | Yes | none | No browser coverage |
| 8 | Admin approval queues | Yes (AdminRegistrationTest 9, AcademicRegistrationTest 10, AccessRequestSubmissionTest) | Yes | registration+approval spec + account-enumeration spec (new) | Nurse-request terminal guard + admin-approve escalation are code-inspection findings |
| 9 | User management | Yes (AdminApiTest 10, AuthorizationTest) | Yes | cross-role authz spec (new) + `permissions.spec.ts` | True admin (non-super) boundary NOT TESTED E2E; role-change endpoint has no UI |
| 10 | Analytics | Yes (AnalyticsTest 12, AcademicOperationsTest 8, AnalyticsExportTest 3) | Yes | `dashboard.spec.ts` (shallow), `performance.spec.ts` | No per-department scoping test; empty-table caveat below |
| 11 | Notifications | Yes (NotificationsAndOverdueTest 4, NotificationRoleAccessTest 2, NotificationDeliveryTest 3) | Yes | notification access spec (new) | Email/SMS never tested against a real transport (log driver) |
| 12 | Import / export | Yes (ReportImportTest 12, AnalyticsExportTest 3, Xlsx*Test 6) | Yes | NONE (largest branch-specific hole) | No file-upload E2E at all despite `feat/excel-import` |

Test-class counts are the discovery-time figures from `06` section 1. The suite grew from 281 to 313 tests
(SQLite) after 32 regression tests were added in remediation (`AUDIT_PROGRESS.md` CHECKPOINT 8); the added
tests are cited inline where they close a specific finding.

---

## 1. Clinical weekly reporting

Actors and single-write path from `05` section 1: nurse fills/saves/submits/edits through
`ReportSubmissionService::save()`; admin/superadmin comment and lock/unlock.

| Role | Action in workflow | How exercised | Status | Evidence |
|---|---|---|---|---|
| nurse | Draft save, submit, post-submit edit, locked-report rejection, cross-nurse denial | Backend feature test | VERIFIED (both lanes) | ReportWorkflowTest (13: draft+recalc, submit->history+notify, edit->cell audit, lock rejects saves, cross-nurse save denial) `06` s1; state machine `05` s1 |
| nurse | Report save->submit->lock in a real browser | Playwright spec | E2E PENDING | clinical report lifecycle spec committed at `af15ac0`; pre-existing `forms.spec.ts` never completes a submit (`06` s5, s9.3) |
| admin / superadmin | Read any report, comment, lock, unlock | Backend feature test | VERIFIED (both lanes) | ReportWorkflowTest (lock/unlock history + nurse notifications), ReportCommentTest (6) `06` s1 |
| admin / superadmin | Index scoping and batch-detail authorization | Backend feature test | VERIFIED (both lanes) | ReportWorkflowTest (index/show scoping, batch detail order + authz) `06` s1 |
| resident / consultant / student_rep | `GET /api/reports` returns 200 empty rather than 403 (soft boundary) | Code inspection | UNVERIFIED (code inspection) | `ReportWorkflowController::index` has no Gate, scoping only (`03` B.1); AUDIT TARGET to assert 403-or-empty per non-clinical role |
| all | Negative authz: nurse-forbidden clinical endpoints | Backend feature test + Playwright spec | VERIFIED (both lanes); E2E PENDING for browser layer | AuthorizationTest (ReportPolicy nurse scoping) `06` s1; `permissions.spec.ts` nurse-forbidden 403 matrix (`06` s5) |

Note: `autoLockHoursAfterDeadline` is advertised in the SPA but has **no backend consumer** (`05` s1 gap);
`reports.status` values `not_started` and `overdue` are dead states never written (`05` s1). Both are
code-inspection observations, NOT TESTED as behaviour.

---

## 2. Academic evaluation

Actors from `05` section 6: resident evaluates consultant; consultant evaluates resident and student; admin
enters external evaluations. Single write: `EvaluationFormService::store()`.

| Role | Action in workflow | How exercised | Status | Evidence |
|---|---|---|---|---|
| resident | Submit consultant evaluation; wrong-direction rejection; pairing eligibility | Backend feature test | VERIFIED (both lanes) | AcademicEvaluationApiTest (9), AcademicEligibilityTest (9: ward pairing, OPD snapshot, back-dated rotations, client ward ignored) `06` s1 |
| consultant | Submit resident evaluation and student evaluation | Backend feature test | VERIFIED (both lanes) | AcademicEvaluationApiTest, UndergraduateModuleTest (consultant evaluates student + weekly prefill) `06` s1 |
| admin / superadmin | External evaluation entry; cannot forge an author | Backend feature test | VERIFIED (both lanes) | AcademicEligibilityTest (admin external entry), EvaluationFormEngineTest (ambiguous subject/evaluator DB rejection) `06` s1; header invariants `05` s6 |
| admin / superadmin | Peer-submit surface returns 403 (they lack `academic.submit`) | Code inspection | UNVERIFIED (code inspection) | `03` s4.13 note; matrix rows 24-26 `03` s2.1 |
| student_rep | 403 on every academic evaluation endpoint | Backend feature test | VERIFIED (both lanes) | UndergraduateModuleTest ("student rep never carries an academic permission"; "403 on every academic evaluation endpoint") `06` s1 |
| resident / consultant | Submit, then re-submit the identical evaluation | Code inspection | UNVERIFIED (code inspection) | No unique index and no service check (`05` s6 "No duplicate-submission guard"; candidate C-DB-012, 4 duplicate groups already in dev DB, `AUDIT_FINDINGS.md`) |
| all | Evaluation submit in a real browser | Playwright spec | E2E PENDING | academic evaluation submit spec committed at `af15ac0`; `forms.spec.ts` resident case only asserts URL did not change (`06` s5) |

---

## 3. Morning session

Actors from `05` section 8: scheduler opens; a data-driven designated recorder (a resident or consultant
listed in `academic.morning_recorder_ids`) records or cancels today; admin cancels any session and manages
roster overrides.

| Role | Action in workflow | How exercised | Status | Evidence |
|---|---|---|---|---|
| resident / consultant (designated recorder) | Record attendance with server-side delay; off-time requires an actual start; snapshot immutability; same-day correction | Backend feature test | VERIFIED (both lanes) | MorningSessionTest (13) `06` s1; invariants `05` s8 |
| resident / consultant (designated recorder) | Cancel today's pending session with reason; state + audit written | Backend feature test + Playwright spec | VERIFIED (both lanes); E2E PENDING for browser | MorningSessionTest (recorder cancels only today's pending; cancel state+audit rollback); `v2-role-workflows.spec.ts` cancels then verifies `status: cancelled` + reason + matching audit row (`06` s5) |
| resident / consultant (NON-designated) | `viewToday` returns 200 safe state (`session: null, canRecord: false`), not 403 | Backend feature test | VERIFIED (both lanes) | V2ReadAuthorizationTest asserts 200 for a non-designated academic (`06` s5); policy `03` s4.14 |
| non-recorder / recorder on a past session | record -> 403 | Backend feature test | VERIFIED (both lanes) | MorningSessionTest (non-designated denied); MorningSessionPolicy `03` s4.14 |
| admin | Change start time; cancel any session | Backend feature test | VERIFIED (both lanes) | MorningSessionTest (admin start-time change, admin cancel with reason) `06` s1 |
| admin | Morning-roster-override CRUD endpoints | NOT TESTED | NOT TESTED | 3 override routes referenced by no backend test and no E2E spec (`06` s1b); MorningSessionTest covers override effects only, never the admin CRUD endpoints |
| recorder / admin | Record/cancel writes an admin audit row | Backend feature test | VERIFIED (both lanes) | AcademicAuditTrailTest (6: admin audit rows for morning sessions, workspace split, readable labels). Discovery flagged missing audit as an AUDIT TARGET (`05` s8); audit-trail coverage is now present |

See the discrepancy section: `v2-role-workflows.spec.ts:18` expects **403** for the seeded `non_recorder`
account, which contradicts the backend contract above.

---

## 4. Teaching / undergraduate

Actors from `05` section 9: scheduler generates; admin manages batches/students/placements/rep-assignments
and cancels; student_rep records held/not-held for in-scope sessions; consultant records student attendance.

| Role | Action in workflow | How exercised | Status | Evidence |
|---|---|---|---|---|
| student_rep | Record log for in-scope sessions; group vs subgroup scope; not-held reason required | Backend feature test | VERIFIED (both lanes) | UndergraduateModuleTest (26: rep scope enforcement, not-held reason, one-active-rep-per-scope, batch deactivation revokes scope) `06` s1; scope table `03` s4.15/A.1 |
| student_rep | Rep-scope isolation (403 on out-of-scope endpoints) | Playwright spec (API-only) | E2E PENDING | `v2-role-workflows.spec.ts` rep-isolation asserts `scope.scope` and 403 on 5 endpoints (`06` s5); rep PAGES are never opened in a browser (`06` gap 21) |
| consultant | Record student attendance; session auto-flips to held | Backend feature test | VERIFIED (both lanes) | UndergraduateModuleTest (consultant attendance flips to held) `06` s1 |
| consultant | Attendance authorization is not narrowed to the teaching consultant | Code inspection | UNVERIFIED (code inspection) | `TeachingSessionPolicy::recordAttendance` ignores `$session`; any active consultant can write any batch's attendance (`03` B.3); AUDIT TARGET |
| admin | Student paste-import; batch lifecycle; cancel with reason | Backend feature test | VERIFIED (both lanes) | UndergraduateModuleTest (admin cancel reason + roster import, import dedupe, admin resource lifecycle completeness) `06` s1 |
| admin | Student import wraps the create loop in a transaction | Code inspection | UNVERIFIED (code inspection) | No transaction around the import loop; a mid-loop failure leaves a partial import (`05` s9 "No transaction"); AUDIT TARGET |
| student_rep / admin | Terminal-state guard on `record()` (held/not_held/cancelled re-record) | Code inspection | UNVERIFIED (code inspection) | No terminal guard; a held session can be re-recorded to any status (`05` s9 FINDING); AUDIT TARGET |
| all | Any teaching page rendered in a browser | NOT TESTED | NOT TESTED | `navigation.spec.ts` route map excludes the rep keys and never visits `/teaching` (`06` gap 21) |

---

## 5. Duty roster

Actors from `05` section 10: admin/superadmin save the monthly grid and daily rows via `DutyRosterController`
over `RosterService`.

| Role | Action in workflow | How exercised | Status | Evidence |
|---|---|---|---|---|
| admin / superadmin | Save month (carve + bulk-assign); overlap guard; cross-month carve/split | Backend feature test | VERIFIED (both lanes) | RosterTest (17: duty-roster month read/write, overlap guard monthly vs stacked daily, cross-month block carving) `06` s1 |
| admin / superadmin | `PUT /api/admin/roster/{year}/{month}` returns 200 on the production engine (was 500) | MariaDB nginx journey | **VERIFIED (MariaDB journey)** | `AUD-API-002` fixed (widen `admin_audit_logs.entity_id`, wrap `saveMonth` in a transaction); reproduced through nginx on the MariaDB stack: csrf 204 -> login 200 -> PUT 200, audit rows 5 -> 6 (`AUDIT_FINDINGS.md` AUD-API-002; `AUDIT_PROGRESS.md` CHECKPOINT 8) |
| non-admin roles | 403 on structure/roster/rotation writes | Backend feature test | VERIFIED (both lanes) | RosterTest (non-admin denial on structure/roster/rotation) `06` s1 |
| admin | Save the roster grid in a real browser | NOT TESTED | NOT TESTED | No E2E spec for the duty-roster grid; `duty-roster-page.test.ts` (Vitest) covers only grade-filter ordering, not the save workflow (`06` s2) |

---

## 6. Rotations

Actors from `05` section 10: admin manages rotation calendars and the rotation planner, gated by an
overwrite-confirmation rule.

| Role | Action in workflow | How exercised | Status | Evidence |
|---|---|---|---|---|
| admin | Block-aligned plan save; replace/clear; group expansion; matrix scoping | Backend feature test | VERIFIED (both lanes) | RotationPlannerTest (7) `06` s1 |
| admin | Overwrite gate: save over roster-sourced/mixed coverage without `confirmOverwrite` is rejected | Backend feature test | VERIFIED (both lanes) | RotationPlannerTest (mixed-block confirmation; daily-duty/foreign-block rejection); gate at `05` s10 |
| admin | Calendar generation (calendar_month, fixed_weeks), month-boundary blocks | Backend feature test | VERIFIED (both lanes) | RosterTest (fixed-weeks calendar, month-boundary blocks, current block/next boundary) `06` s1 |
| non-admin | 403 on rotation writes | Backend feature test | VERIFIED (both lanes) | RotationPlannerTest (non-admin denial) `06` s1 |
| admin | Rotation admin in a browser; `calendars/{calendar}/active` toggle | NOT TESTED | NOT TESTED | No E2E spec; `PATCH admin/rotations/calendars/{calendar}/active` referenced by no test (`06` s1b) |

---

## 7. Section transfers

Actors from `05` section 11: consultant requests/cancels; the destination section head or an admin decides;
scheduler applies at the next boundary. Authority is data-driven (`sections.head_user_id`), not a role.

| Role | Action in workflow | How exercised | Status | Evidence |
|---|---|---|---|---|
| consultant | File request; duplicate/same-section/no-section rejection; owner-only cancel while pending | Backend feature test | VERIFIED (both lanes) | SectionTransferTest (14) `06` s1; state machine `05` s11 |
| consultant (section head) / admin | Approve/reject; head-queue scoping; admin immediate override | Backend feature test | VERIFIED (both lanes) | SectionTransferTest (only head/admin decides, admin immediate override, head queue scoping) `06` s1; policy `03` s4.16 |
| scheduler / admin | Apply due transfer once; idempotency; conflicting-decision rejection | Backend feature test | VERIFIED (both lanes) | SectionTransferTest (scheduled command applies once, retry idempotency, reject/cancel idempotency, state+side-effect rollback) `06` s1 |
| all | Transfer workflow in a browser | NOT TESTED | NOT TESTED | No E2E spec; `GET transfer-requests/options` referenced by no test (`06` s1b) |

---

## 8. Admin approval queues

Two queues (`05` sections 4 and 5): the clinical nurse access-request queue, and the shared
admin/academic self-enrollment queue.

| Role | Action in workflow | How exercised | Status | Evidence |
|---|---|---|---|---|
| nurse (public, unauthenticated) | Submit access request; an INACTIVE `users` row is created | Backend feature test | VERIFIED (both lanes) | AccessRequestSubmissionTest; WorkspaceApiTest (public access request creates applicant + notifies admins); AuthApiTest (self-submitted request inactive until approved) `06` s1 |
| admin / superadmin | Review (approve/reject) a nurse request; activation flips `active=true` | Backend feature test | VERIFIED (both lanes) | AdminApiTest (access-request review); AccessRequestReviewService `03` A.3 |
| admin / superadmin | Approve an already-rejected/approved nurse request (missing terminal guard) | Code inspection | UNVERIFIED (code inspection) | `AccessRequestReviewService` has no `status === 'pending'` check, unlike the admin queue (`05` s4 FINDING; illegal-transition item 8); AUDIT TARGET |
| admin (public, unauthenticated) | Admin self-signup -> pending request, no user until approval | Backend feature test | VERIFIED (both lanes) | AdminRegistrationTest (9: public signup -> pending + notify, pending admin cannot log in, approval -> login works). Area was IN-FLUX; BLOCKER-1 landed and was verified by the auditor (`AUDIT_PROGRESS.md` CHECKPOINT 4) |
| resident / consultant (public) | Academic self-enrollment -> pending request | Backend feature test | VERIFIED (both lanes) | AcademicRegistrationTest (10: self-enrolment -> pending, pending applicant cannot log in, approval creates account, superadmin request never approvable, duplicate/invalid role/unknown ward) `06` s1 |
| admin / superadmin | Review self-enrollment; non-pending -> 422; superadmin/unknown role aborts | Backend feature test | VERIFIED (both lanes) | AdminRegistrationTest (double-approval rejected), AcademicRegistrationTest (superadmin never approvable); guard `05` s5 |
| admin | Approving a `requested_role='admin'` row yields a new active admin despite lacking `admins.manage` | Code inspection | UNVERIFIED (code inspection) | admin holds `admins.approve`; `AdminAccessRequestPolicy::review` does not inspect `requested_role` (`03` s6.2 "primary audit target") |
| all | Registration + approval, and account-enumeration, in a browser | Playwright spec | E2E PENDING | registration+approval spec and account-enumeration spec committed at `af15ac0`; discovery noted ZERO prior browser coverage of these flows (`06` s9.2) |

---

## 9. User management

Actors from `03` sections 4.1 and 5: superadmin creates admin/nurse/student_rep and promotes/deactivates;
admin creates nurse/student_rep and edits/deactivates non-admins.

| Role | Action in workflow | How exercised | Status | Evidence |
|---|---|---|---|---|
| superadmin / admin | User CRUD with role rules and audit; user-directory N+1 guard; workspace filter | Backend feature test | VERIFIED (both lanes) | AdminApiTest (10) `06` s1 |
| superadmin / admin | UserPolicy admin-account-management truth table (self-update, admin-target guard, setActive) | Backend feature test | VERIFIED (both lanes) | AuthorizationTest (`test_user_policy_protects_admin_account_management`) `06` s1; truth tables `03` s4.1 |
| admin | Convert resident/consultant/student_rep into a nurse via `PATCH /admin/users/{id}` (cross-role laundering) | Code inspection | UNVERIFIED (code inspection) | `Rule::in(['admin','nurse'])` applies to any target; academic columns not cleared (`03` s6.3); AUDIT TARGET |
| superadmin / admin | Self-demotion to nurse leaves zero superadmins / one-way admin demotion | Code inspection | UNVERIFIED (code inspection) | `03` B.5, s6.4; AUDIT TARGET |
| admin (non-superadmin) | Full user-management workflow in a browser | NOT TESTED (E2E) | NOT TESTED | `permissions.spec.ts` substitutes superadmin for admin, so the admin vs superadmin boundary is never exercised E2E (`06` s9.1); `user-management-page.tsx` has no unit test and no E2E spec (`06` s10) |
| all roles | Cross-role authorization, privilege-escalation, client-modified role values | Backend feature test + Playwright spec | VERIFIED (both lanes) at API layer; E2E PENDING at browser layer | AuthorizationTest, AdminApiTest `06` s1; cross-role authz spec (new, `af15ac0`); `permissions.spec.ts` escalation `role_key:'superadmin'` -> 422 (`06` s5) |

The `PATCH /api/admin/users/{id}` role-change endpoint has **no frontend caller** (`03` s6.5); it is
API-only surface, so browser testing can never cover it.

---

## 10. Analytics

Actors from `05` section 12: admin/superadmin read clinical analytics, academic evaluation analytics, and
academic operations analytics, and export. Nurse and academic roles are excluded.

| Role | Action in workflow | How exercised | Status | Evidence |
|---|---|---|---|---|
| admin / superadmin | Clinical overview/trends; cached dashboard + invalidation; ward/outpatient/procedure rollups | Backend feature test | VERIFIED (both lanes) | AnalyticsTest (12) `06` s1 |
| admin / superadmin | Academic operations analytics (morning/teaching/students), content-stamp cache purity | Backend feature test | VERIFIED (both lanes) | AcademicOperationsTest (8) `06` s1 |
| admin / superadmin | CSV and XLSX export | Backend feature test | VERIFIED (both lanes) | AnalyticsExportTest (3: CSV, XLSX, nurse 403) `06` s1 |
| nurse | 403 on analytics and export | Backend feature test | VERIFIED (both lanes) | AnalyticsTest (nurse 403), AnalyticsExportTest (nurse 403) `06` s1 |
| admin / superadmin | Dashboard charts render in a browser | Playwright spec | E2E PENDING | `dashboard.spec.ts` proves charts mount but asserts no specific value (SHALLOW-to-MEDIUM, `06` s5); `performance.spec.ts` measures load |
| admin / superadmin | Per-department analytics scoping | Code inspection | UNVERIFIED (code inspection) | `AnalyticsController` has 12 routes gated only by `analytics.view` with no per-department scoping visible (candidate C-ARCH-010, `AUDIT_FINDINGS.md`) |
| admin / superadmin | `GET /api/analytics/*` writes cache and registers a terminating callback (non-idempotent GET) | Code inspection | UNVERIFIED (code inspection) | candidate C-API-007, `AUDIT_FINDINGS.md` |

**Empty-table caveat:** analytics performance was not measured at scale on the empty paths. 20 of 53 tables
are empty in the seeded DB (audit, notifications, access-requests, action_items, calculated_metrics and
others); real volume exists in only four tables (`AUDIT_FINDINGS.md` "CRITICAL CAVEAT"). No performance or
scalability claim is made here for any workflow; those live in the performance/scalability deliverable and
are labelled PREDICTED.

---

## 11. Notifications

Storage and delivery from `05` section 13: one `notifications` table with list/mark-read/delete/restore
endpoints gated by `notifications.view`; out-of-band email/SMS via `NotificationDeliveryService`.

| Role | Action in workflow | How exercised | Status | Evidence |
|---|---|---|---|---|
| admin / superadmin / nurse / student_rep | List, mark-read, mark-all-read, delete, with recipient scoping | Backend feature test | VERIFIED (both lanes) | NotificationsAndOverdueTest (notification list/mark-read/read-all/delete scoping) `06` s1 |
| resident / consultant | Read and work their own notification queue | Backend feature test | VERIFIED (both lanes) | NotificationRoleAccessTest (`test_every_notified_role_can_work_its_own_notification_queue`, `test_an_inactive_resident_still_cannot_reach_the_notification_routes`). Closes candidate C-AUTHZ-001, which reported that residents/consultants could never read notifications the system sends them (`AUDIT_FINDINGS.md`) |
| all recipients | Notification access in a browser | Playwright spec | E2E PENDING | notification access spec committed at `af15ac0` |
| system | Email/SMS out-of-band delivery job (queue, retry, backoff, per-channel isolation) | Backend feature test | VERIFIED (both lanes) at unit level | NotificationDeliveryTest (3: service queues email+SMS, job sends both, scheduler drains DB queue) `06` s1 |
| system | Email/SMS against a real transport | NOT TESTED | NOT TESTED | `MAIL_MAILER=log`, `SMS_DRIVER=log` by default; only `ReportReminderService` calls `queue()`; no academic workflow sends email/SMS (`05` s13). No delivery to a live transport was exercised |

---

## 12. Import / export

Paths from `05` section 15: weekly report import (file upload, admin), analytics export, student roster
import (pasted string, admin). All imports funnel through `ReportSubmissionService::save()`.

| Role | Action in workflow | How exercised | Status | Evidence |
|---|---|---|---|---|
| admin | Weekly report import: CSV and XLSX persistence; quality-rule rejection; unknown department; blanked-cell clearing; out-of-range without a 500; UTF-8 BOM | Backend feature test | VERIFIED (both lanes) | ReportImportTest (12) `06` s1 |
| admin | Formula-injection neutralisation on export and unsanitize on round-trip | Backend feature test | VERIFIED (both lanes) | ReportImportTest (formula-injection on export, unsanitize on round-trip) `06` s1 |
| admin | XLSX reader/writer primitives; DOCTYPE (XXE/entity-expansion) rejection | Vitest / backend unit | VERIFIED (both lanes) | XlsxReaderTest (4, incl. DOCTYPE rejected), XlsxWriterTest (2) `06` s1 |
| nurse | 403 on report import | Backend feature test | VERIFIED (both lanes) | ReportImportTest (nurse 403) `06` s1 |
| admin | Analytics export (CSV/XLSX) | Backend feature test | VERIFIED (both lanes) | AnalyticsExportTest (3) `06` s1 |
| admin | Student roster paste-import; dedupe by external_id/name | Backend feature test | VERIFIED (both lanes) | UndergraduateModuleTest (roster import, import dedupe) `06` s1 |
| admin | File upload in a real browser | NOT TESTED | NOT TESTED | No file-upload E2E anywhere; `/admin/import` is visited but nothing is uploaded. This is the largest branch-specific hole given `feat/excel-import` (`06` s9.4) |
| admin | Upload-abuse: oversize, wrong MIME, malformed/zip-bomb XLSX | NOT TESTED (beyond DOCTYPE) | NOT TESTED | No backend test for upload abuse beyond `XlsxReaderTest`'s DOCTYPE guard (`06` s1) |

---

## What is explicitly NOT TESTED (functional boundaries)

1. **No workflow is browser-verified in this report.** Every "Playwright spec" row is E2E PENDING; results
   are in `PLAYWRIGHT_TEST_REPORT.md` (produced separately). Running tally: `Roles fully tested: 0 / 6`
   (`AUDIT_PROGRESS.md`).
2. **The admin (non-superadmin) role is untested end to end.** `permissions.spec.ts` uses superadmin in
   place of admin; the two differ on `admins.manage`, `templates.editStructure`,
   `evaluationForms.editStructure` (`06` s9.1, `03` s2.2).
3. **File upload (the active branch's headline feature) has no browser test and no upload-abuse backend
   test** beyond the DOCTYPE guard (`06` s9.4).
4. **Morning-roster-override CRUD, several rotation/ward/duty-type mutation endpoints, `notifications/restore`,
   and `evaluation-forms/{id}/publish` are referenced by no test at all** (17 API routes, `06` s1b).
5. **Duty roster, rotations, and section transfers have no browser coverage;** they are backend-only.
6. **Email/SMS delivery is never exercised against a real transport** (log driver by default).
7. **Several code-inspection findings are reasoned, not reproduced:** nurse access-request terminal guard,
   admin-approve escalation, teaching `record()` terminal guard, `recordAttendance` over-permission, student
   import partial-commit, cross-role laundering, superadmin self-demotion, duplicate evaluation submission.
   These are UNVERIFIED (code inspection) and are tracked as AUDIT TARGETs / candidates in
   `AUDIT_FINDINGS.md`, not as executed failing tests.
8. **No performance claim is attached to any workflow here** (empty-table caveat, section 10).

---

## Discrepancies found in the source evidence

1. **The `non_recorder` 403 contradiction (confirmed at code level, resolution pending execution).**
   `tests/e2e/v2-role-workflows.spec.ts:18` asserts **403** for the seeded `non_recorder` account on
   `GET /api/academic/morning-sessions/today`. The backend contract returns **200** with a safe empty state
   for that account, because `DevUserSeeder.php:104` seeds `samuel.alemu@stpaulhospital.demo` as a
   **`resident`**, `MorningSessionPolicy::viewToday` grants `resident`/`consultant`, and
   `V2ReadAuthorizationTest` explicitly asserts 200 for exactly that case (`06` section 5, re-verified). The
   spec and the backend cannot both be right; the spec should fail as written. This is the single
   highest-value item for the separate Playwright run to resolve, and it is flagged so no reader treats the
   morning-session recorder-vs-viewer boundary as settled.

2. **Test-count drift between discovery and remediation (temporal, not a conflict).** The test-estate
   inventory (`06`) reports **281** backend tests at commit `d82edb3`; after remediation the suite is
   **313** (SQLite) / **314** (MariaDB) at `43bbccc` (`AUDIT_PROGRESS.md` CHECKPOINT 8). The 32-test delta is
   the added regression coverage (for example NotificationRoleAccessTest, SchemaConstraintTest,
   AuthThrottleTest). The per-file class descriptions in `06` remain accurate for the workflows they cover;
   only the totals moved. This document uses the current totals for confidence and the `06` class names for
   per-workflow evidence.

3. **Two discovery passes of `05-modules-workflows.md` exist** (`05-modules-workflows.md` and
   `05-modules-workflows.pass-a.md`). This matrix follows the second pass, which is the one the discovery
   author marked authoritative; no material workflow disagreement was found between them for the rows above.

## Evidence index

- Workflow inventory and state machines: `artifacts/audit-2026-07-21/discovery/05-modules-workflows.md`
- Backend test estate, E2E spec table, route-coverage gaps: `.../06-existing-tests-and-harness.md`
- Role x permission x policy truth tables and authz findings: `.../03-roles-permissions.md`
- Confirmed findings and code-derived candidates: `AUDIT_FINDINGS.md`
- Suite results, lane comparison, remediation commits: `AUDIT_PROGRESS.md` (CHECKPOINT 5, 8)
- Browser (Playwright) execution results: `PLAYWRIGHT_TEST_REPORT.md` (produced separately)
- Backend test classes: `backend/tests/Feature/`, `backend/tests/Unit/`
