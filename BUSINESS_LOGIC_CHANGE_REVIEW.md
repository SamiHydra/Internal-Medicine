# Business-logic change review

Scope: every file that differs between the pre-hardening baseline and the
hardening tree, classified by whether it can change how the hospital system
behaves, with the runtime-sensitive ones reviewed line by line.

```text
Baseline:  b07b32c (fix/mobile-touch-targets, the remediated release candidate)
Hardening: hardening/pre-server working tree on 2026-09-09
           104 tracked files modified, 60 new files (artefact folders excluded)
```

Method: `git diff --numstat b07b32c` for tracked files, `git ls-files --others
--exclude-standard` for new ones, then a full read of every diff in the
BUSINESS LOGIC, AUTHORIZATION, DATA INTEGRITY and OBSERVABILITY categories.
Frontend files whose diff is only colour tokens (the contrast fix) were
confirmed by filtering the diff for non-colour lines: 22 files have zero
non-colour changes.

## 1. Classification summary

| Category | Files | What they can affect |
|---|---:|---|
| BUSINESS LOGIC | 7 | report save / submit / conflict handling, offline replay, the report form |
| AUTHORIZATION | 5 | one new permission (`system.health`), audit policies, two new routes, the health page route |
| DATA INTEGRITY | 6 | ward/section deletion guards, evidence storage failure, export retention, the two new model relations, the DB connect timeout |
| OBSERVABILITY | 14 | error reporting, request timing, client error intake, health snapshot; all designed to be passive |
| UX ONLY | 55 | contrast tokens, accessible names, focus handling, headings, table captions, touch targets, chart titles |
| INFRASTRUCTURE | 12 | Docker, deploy, nginx, compose, `.gitattributes`, Vite proxy override |
| TEST ONLY | 22 | backend feature tests, unit tests, Playwright specs and helpers, harness scripts |
| DOCUMENTATION | 15 | reports, ledgers, runbooks, templates |

## 2. Runtime-sensitive files (reviewed one by one)

### 2.1 BUSINESS LOGIC

**File:** `backend/app/Services/Reports/ReportSubmissionService.php`
**Why it changed:** offline conflict safety (Priority 1): stale-write detection.
**Original behavior:** `save()` always wrote the submitted values over the current row (last write wins) after the lock check.
**Current behavior:** `save()` accepts an optional `expectedRevision`. When it is `null` (the key was absent from the request) the behaviour is unchanged. When it is the sentinel `none` and a report exists, or a timestamp that does not match the stored `updated_at` at second precision, the save is refused with `ReportConflictException` (HTTP 409) inside the same row lock, before the lock check and before any write. A report that has disappeared since the client loaded it is recreated (no conflict).
**Intended business-rule impact:** none for existing callers; the check is opt-in by key presence. The SPA now always sends the key, so two devices editing the same week no longer overwrite each other silently.
**Regression risk:** a legitimate save refused because the client's timestamp differs in precision or timezone; a locked report answering 409 instead of the lock message.
**Verification performed:** `ReportWorkflowTest` (20 tests: matching revision saves, stale refuses with the server copy, `none` with an existing report refuses, absent key keeps last-write-wins, lock check still answers 422 when the revision matches); Playwright `offline-sync.spec.ts` A to G; regression spec `clinical.spec.ts` (save, reload, re-save with the returned `updatedAt`, then a stale timestamp).
**Result:** PASS, behaviour preserved; the new refusal only fires when the client opts in and is stale.

**File:** `backend/app/Services/Reports/ReportLockingService.php` (business-rule correction after the audit, 2026-09-10)
**Why it changed:** product-owner decision: locking is an overlay on the lifecycle, not a step in it. Locking must not submit a draft; unlocking must restore the pre-lock state.
**Original behavior:** unlock restored `edited_after_submission` when that history row existed and otherwise `submitted`, whatever the report was before the lock, so `draft -> lock -> unlock` produced `submitted` with `submitted_at` null.
**Current behavior:** unlock restores `draft` when `submitted_at` is null, otherwise `edited_after_submission` when the history carries it or `submitted` (`restoredStatus()`). The lock branch is unchanged and never touches `submitted_at`. No schema change: `submitted_at` is written only by the submission workflow and never cleared, the invariant `ReportSubmissionService::save` already relies on as `$hadSubmission`.
**Intended business-rule impact:** `draft -> lock -> unlock -> draft`; `submitted -> lock -> unlock -> submitted`; `edited_after_submission` round-trips as before. Submission stays explicit (`ReportSubmissionService::save(..., submit: true)`); lock, unlock, view, list, comment and history never submit.
**Regression risk:** a submitted report demoted to draft (guarded by `submitted_at`); a seeded or imported submitted report without `submitted_at` (none exists: every seeder and test that writes `submitted`/`locked`/`edited_after_submission` sets it).
**Verification performed:** `ReportLockLifecycleTest` (8 tests; the four draft scenarios fail against the old service with `'submitted'` where `'draft'` is expected); `ReportWorkflowTest`, `AuditIntegrityTest`, `DataIntegrityInvariantsTest`, `AuthorizationTest` unchanged and green; regression `clinical.spec.ts` E and E2, `ui-clinical.spec.ts` D-2 and D-3, `offline-rules.spec.ts` AA-1; e2e `report-lock-lifecycle.spec.ts` and `offline-sync.spec.ts` B.
**Result:** PASS.

**File:** `src/context/app-data-context.tsx` (`loadReportSummaries` merge; pre-existing gap made reachable by the correction above)
**Why it changed:** a report summary that arrives with a changed `updatedAt` (an admin unlock changes it) replaced the loaded record with a value-less summary while the id stayed in the "details loaded" set.
**Original behavior:** after `draft -> lock -> unlock` and a reload, the form rendered an empty grid for the draft, fetched no details, and the next save deleted the stored cells (reproduced with a probe: two saved cells, one deleted by the save). Submitted and locked reports were protected by the form's empty-saved-cells verification, and a locked draft used to come back as `submitted`, so the gap never showed.
**Current behavior:** the merge drops the id from the loaded set whenever the loaded record cannot be reused (same `updatedAt` rule the workspace merge applies), so the form fetches the details again before it renders the grid.
**Intended business-rule impact:** none; data preservation. The stale offline conflict handling is untouched (server 409 rules unchanged).
**Regression risk:** an extra details request after a summary refresh for reports that changed on the server (intended).
**Verification performed:** probe (details request fires after the unlock reload, inputs show the saved values); `ui-clinical.spec.ts` D-27 (values unchanged by the lock cycle) and D-28 (save lands, cells intact); `offline-rules.spec.ts` AA-1 and AB; e2e `offline-sync.spec.ts`; `npm run verify` (171 unit tests, build).
**Result:** PASS.

**File:** `backend/app/Http/Controllers/Api/ReportWorkflowController.php`
**Why it changed:** carry `expectedUpdatedAt` / `expected_updated_at` from the request into the service; share the value serializer with the conflict response.
**Original behavior:** `store`, `update`, `submit` validated `values` and `submit` only; `serializeValues()` was a private method.
**Current behavior:** the three actions also accept `expectedUpdatedAt` (`sometimes|nullable|date`) and pass `expectedRevision` to the service; `serializeValues()` delegates to `App\Support\Reports\ReportValues::serialize`, an extraction with identical output (numbers as int when whole, time as `HH:MM`, text, json).
**Intended business-rule impact:** none.
**Regression risk:** a serialization difference in the values the SPA reads back.
**Verification performed:** `ReportWorkflowTest` compares saved and re-read values; regression spec re-reads `/api/reports/{id}` and the DB rows after each save and compares cell by cell.
**Result:** PASS.

**File:** `backend/app/Exceptions/ReportConflictException.php` (new)
**Why it changed:** carries the 409 answer with the server copy.
**Original behavior:** n/a.
**Current behavior:** renders `{message, conflict: {reason, report: {...values}}}` with status 409; the report snapshot is built with the same serializer as the normal read and is only produced after `Gate::authorize('view')` passed in the controller.
**Intended business-rule impact:** none.
**Regression risk:** disclosure of a report the caller may not read. The exception is thrown from `save()`, which already verified the actor may edit that assignment (`authorizeAssignmentEdit`), so the snapshot is of a report the actor may see.
**Verification performed:** `ReportWorkflowTest::test_a_stale_revision_is_refused_with_409_and_the_current_server_values`; authorization matrix (a foreign nurse cannot reach the save path at all: 403 before the conflict check).
**Result:** PASS.

**File:** `backend/app/Support/Reports/ReportValues.php` (new)
**Why it changed:** shared serializer (see the controller).
**Result:** PASS (covered above).

**File:** `src/lib/offline/report-save-queue.ts`
**Why it changed:** queued saves are never deleted on the user's behalf; failures are classified.
**Original behavior:** a queued save was retried on any non-offline error and deleted after five attempts ("dead-lettered"); an HTTP 4xx from the server was treated like a transient failure.
**Current behavior:** each queued save has a `status` (`pending` or `conflict`). Failures are classified: offline (no attempt counted), auth 401/419 (queue kept, replay after sign-in), conflict 409/422-locked/400/403/404/422 (parked with the server's answer for the user's decision), transient (counted, parked after five). The `expectedUpdatedAt` the client loaded before going offline is preserved when later offline saves coalesce into the same queue entry.
**Intended business-rule impact:** the server's decision is now surfaced instead of silently discarded; the server rules are unchanged (the queue still sends the same request).
**Regression risk:** a parked save re-applied against a lock or a revoked role. Both are refused by the server on replay (the queue carries no authority); "apply my changes" only re-bases `expectedUpdatedAt`, it never removes the lock or grants permission.
**Verification performed:** `report-save-queue.conflict.test.ts` (unit), `offline-sync.spec.ts` B (lock while queued), E (session expiry), F (flapping network, no duplicates); regression spec `offline-rules.spec.ts` replays a queued payload after the role was revoked and after the report was locked and asserts 403/422 and unchanged DB rows.
**Result:** PASS.

**File:** `src/context/app-data-context.tsx`
**Why it changed:** replay under a Web Lock, conflict surfacing, parked-save actions.
**Original behavior:** `flushQueuedReportSaves` replayed every queued save, discarded after five failures, one tab guard only.
**Current behavior:** replay runs under `navigator.locks` (`stpaul:offline-report-sync`) so one tab drains the queue; `saveReport` returns `{saved:false, conflict}` on a 409 instead of a toast; `discardQueuedReportSave` and `applyQueuedReportSave` exist; sign-out no longer clears the queue (it is per user in IndexedDB).
**Intended business-rule impact:** none on the server; the client keeps unsynced work across sign-out.
**Regression risk:** a queued save from user A replayed after user B signs in on the same device. The queue is keyed by user id and `listQueuedReportSaves(userId)` filters by it; the replay uses the signed-in user's session, so a foreign payload would be refused by the server (`authorizeAssignmentEdit`).
**Verification performed:** `offline-sync.spec.ts` D (persistent profile, queue survives restart), E; regression spec `offline-rules.spec.ts`.
**Result:** PASS.

**File:** `src/components/reports/report-form.tsx`
**Why it changed:** conflict panel, autosave storm fix, lock/unlock double-submit guard, status line live region, touch targets.
**Original behavior:** every save was last-write-wins; a failed autosave re-armed after 1.4 s and toasted per attempt; lock/unlock buttons had no pending state.
**Current behavior:** every save sends `expectedUpdatedAt: report?.updatedAt ?? null`; a 409 opens the conflict panel and disables autosave/save/submit until the user applies or keeps the server copy; a refused save is not retried for the same values; one lock/unlock request in flight at a time.
**Intended business-rule impact:** none; the form still sends the same values and the same `submit` flag.
**Regression risk:** the disabled state while a conflict is open could block a legitimate save; autosave suppression could skip a save after an edit (cleared on any value change by signature comparison).
**Verification performed:** `failure-recovery.spec.ts` (save/submit/lock scenarios), `offline-sync.spec.ts` C (apply after conflict), `clinical-report-lifecycle.spec.ts`; regression Playwright `ui-clinical.spec.ts` (draft, reload, edit, submit through the real form with DB re-reads).
**Result:** PASS.

### 2.2 AUTHORIZATION

**File:** `backend/app/Support/Authorization/Permissions.php`
**Why it changed:** new `system.health` permission for the maintenance health snapshot.
**Original behavior:** superadmin = admin + `admins.manage`, `templates.editStructure`, `evaluationForms.editStructure`.
**Current behavior:** superadmin also holds `system.health`; no other role list changed (diff shows one added constant and one added line in the superadmin list only).
**Intended business-rule impact:** Maintenance can read the health snapshot; nobody else can.
**Regression risk:** an ordinary admin gaining or losing a permission. None removed; none added to admin.
**Verification performed:** `admin-boundary.spec.ts` pins the exact delta; `AuthorizationTest`; authorization matrix (`GET /api/admin/system-health`: anonymous 401, nurse/resident/consultant/student_rep/admin 403, maintenance 200).
**Result:** PASS.

**File:** `backend/routes/api.php`
**Why it changed:** `POST /api/client-errors` (public, throttle 20/min per IP, its own limiter key) and `GET /api/admin/system-health` (permission `system.health`).
**Original behavior:** neither route existed.
**Current behavior:** the client-error route stores nothing (log, counters, optional webhook); the health route is read-only.
**Intended business-rule impact:** none.
**Regression risk:** the public route sharing the auth limiter bucket (it does not: key `client-errors`); the health route leaking secrets (the snapshot exposes no credentials, `ObservabilityTest` asserts the payload keys).
**Verification performed:** `ObservabilityTest` (12), matrix, `security-smoke.spec.ts`.
**Result:** PASS.

**File:** `backend/app/Policies/{AdminAuditLogPolicy,AuditLogPolicy,ReportStatusHistoryPolicy}.php`
**Why it changed:** audit rows are append-only.
**Original behavior:** `update`/`delete` were undefined (denied by omission).
**Current behavior:** `update`, `delete`, `forceDelete` return `false` explicitly for every role, Maintenance included. `viewAny`/`view`/`create` unchanged.
**Intended business-rule impact:** none observable (no mutation route exists); it is now a stated rule.
**Regression risk:** none (only denials added).
**Verification performed:** `AuditIntegrityTest` (16, including 20 attempted mutations across three roles leaving the tables byte-identical).
**Result:** PASS.

**File:** `src/App.tsx`, `src/config/navigation.ts`, `src/routes/route-guards.tsx`
**Why it changed:** the `/admin/system-health` route (superadmin only), its navigation entry (superadmin only), the shared-admin-path list, and a route error boundary keyed by pathname.
**Original behavior:** no health route; the shell rendered `<Outlet/>` directly.
**Current behavior:** the route sits under `ProtectedRoute roles={['superadmin']}`; the nav item is appended only for superadmin; a render error in one page shows a recovery panel instead of blanking the shell.
**Intended business-rule impact:** none.
**Regression risk:** an admin reaching the page via URL (client guard redirects; the API refuses with 403 regardless).
**Verification performed:** `permissions.spec.ts` (route guards), matrix, `route-error-boundary.test.tsx`.
**Result:** PASS.

### 2.3 DATA INTEGRITY

**File:** `backend/app/Http/Controllers/Api/Admin/AcademicStructureController.php`, `backend/app/Models/Ward.php`, `backend/app/Models/Section.php`
**Why it changed:** deleting a referenced ward or section answered a raw 500 (database restrict) or silently nulled snapshot columns.
**Original behavior:** ward delete refused only when duty types or departments referenced it; section delete only for duty types or consultants.
**Current behavior:** ward delete also refuses when student placements, teaching sessions or evaluations reference it; section delete also refuses when any transfer request references it. The refusal is the same 422 `ValidationException` shape with a longer message; unreferenced rows still delete.
**Intended business-rule impact:** stricter, in the direction the existing rule intended ("deactivate instead").
**Regression risk:** a ward that used to be deletable no longer is (only when history references it, which the database would have refused or corrupted anyway).
**Verification performed:** `DataIntegrityInvariantsTest` (12); regression spec `structure.spec.ts` (create, reference, delete refused 422, deactivate allowed, unreferenced delete allowed, DB rows checked).
**Result:** PASS.

**File:** `backend/app/Http/Controllers/Api/Admin/ActionItemEvidenceController.php`, `backend/app/Exceptions/StorageWriteFailedException.php` (new)
**Why it changed:** the storage drill produced a 201 with a metadata row for a file that was never written.
**Original behavior:** `putFileAs()` return value ignored; the row, history and audit entries were written regardless.
**Current behavior:** a `false` from the disk throws `StorageWriteFailedException` (500 with a plain message) before any row is written; the success path is unchanged (same path scheme, same transaction).
**Intended business-rule impact:** none for a healthy disk.
**Regression risk:** none on the success path (one added condition).
**Verification performed:** `ActionItemTest::test_evidence_upload_refuses_and_records_nothing_when_storage_cannot_write`; regression spec `action-items.spec.ts` uploads 1 KB, 3 MB, 9 MB, refuses > 10 MB, HTML/SVG/PHP/EXE, and checks the row, the file on disk and the download authorization.
**Result:** PASS.

**File:** `backend/app/Console/Commands/PruneOperationalData.php`, `backend/config/reports.php`
**Why it changed:** retention (Priority 11): generated analytics exports were the one unbounded generated data on disk.
**Original behavior:** exports were never pruned.
**Current behavior:** exports older than `EXPORT_RETENTION_DAYS` (default 30, `0` disables) are deleted file-first then row, only under `analytics-exports/`; downloads already 410 after seven days. No other retention default changed (audit, admin audit and status history stay at `0`, disabled).
**Intended business-rule impact:** an operational cleanup, no user-facing rule.
**Regression risk:** a live export deleted. The cutoff is 30 days against a 7-day download expiry.
**Verification performed:** `OperationalMaintenanceTest` (+2: prunes old rows and files, keeps recent, dry run).
**Result:** PASS.

**File:** `backend/config/database.php`
**Why it changed:** MariaDB drill: workers hung on connect without a timeout.
**Original behavior:** no `PDO::ATTR_TIMEOUT`.
**Current behavior:** `PDO::ATTR_TIMEOUT = DB_CONNECT_TIMEOUT` (default 5 s) on the MariaDB connection only.
**Intended business-rule impact:** none.
**Regression risk:** a slow but healthy database refused at connect. 5 s is far above any local connect time; the MariaDB lane (444 tests) runs with it.
**Verification performed:** MariaDB lane, parity drills.
**Result:** PASS.

### 2.4 AUDIT (append-only additions)

**File:** `backend/app/Http/Controllers/Api/AuthController.php`, `backend/app/Http/Controllers/Api/PasswordResetController.php`
**Why it changed:** self-service password change and reset-link reset wrote no audit row.
**Original behavior:** password changed, flag cleared, no trail.
**Current behavior:** identical password handling, plus one `change_password` admin-audit row per change with `password_change_required` before/after and `method` (`self_service` or `reset_link`); never the password, hash or token. The login, logout and forgot paths are untouched.
**Intended business-rule impact:** none.
**Regression risk:** a failing audit write blocking the password change. The audit service writes in the same request; `AuditIntegrityTest` covers both paths end to end.
**Verification performed:** `AuditIntegrityTest`, `AuthApiTest`; regression spec `auth.spec.ts` (change password, verify the row, verify the role and permissions unchanged, restore).
**Result:** PASS.

**File:** `backend/app/Http/Controllers/Api/ReportCommentController.php`
**Why it changed:** comments had no trail.
**Original behavior:** create and delete wrote the row only.
**Current behavior:** create and delete run in a transaction with an audit row (`comment` / `delete` on `report_comment`, carrying report id, author, parent and body). Authorization (`Gate::authorize('view')`, `Permissions::REPORTS_VIEW_ANY` / own-report rules, "cannot delete this comment") is untouched. Notifications to participants unchanged.
**Intended business-rule impact:** none.
**Regression risk:** none on the success path; a failed audit write now rolls back the comment (desired: no comment without its trail).
**Verification performed:** `ReportCommentTest`, `AuditIntegrityTest::test_report_comments_are_audited_on_create_and_delete`; regression spec `clinical.spec.ts` (nurse comments on own report, foreign nurse 403, admin comments, DB row, audit row, report status unchanged).
**Result:** PASS.

**File:** `backend/app/Services/Admin/AccessRequestReviewService.php`
**Why it changed:** approval recorded the status change but not the activation and assignments it caused.
**Original behavior:** approve/reject flipped the status, activated the user and created assignments (approve) and audited `status/reviewed_at/reviewed_by`.
**Current behavior:** identical decisions and side effects; the audit row additionally carries `userActive` before/after and the granted assignment ids.
**Intended business-rule impact:** none.
**Verification performed:** `AuditIntegrityTest::test_access_request_decisions_record_activation_and_granted_assignments`, `registration-approval.spec.ts`; regression spec `auth.spec.ts` (pending nurse, approve, active, role, assignment rows, reject path stays inactive).
**Result:** PASS.

**File:** `backend/app/Support/Audit/AuditRegistry.php`
**Why it changed:** two new labels (`report_comment` target, `change_password` action) so the audit UI can name them.
**Result:** PASS (labels only).

### 2.5 OBSERVABILITY (must be passive)

**File:** `backend/bootstrap/app.php`
**Why it changed:** global `RecordRequestTiming` middleware; `$exceptions->report()` hook.
**Original behavior:** no timing; exceptions logged by Laravel only.
**Current behavior:** every request is timed (a `Server-Timing` header, a counter for 5xx, a log line above `SLOW_REQUEST_MS`); every reportable exception is mirrored to the counters and the optional webhook after the normal log write. Neither path changes the response status or body.
**Intended business-rule impact:** none.
**Regression risk:** an exception inside the reporter aborting a request. `ErrorReporter` wraps its work in try/catch and the webhook client has a short timeout; `ObservabilityTest` proves a failing webhook does not fail the request; regression spec `observability.spec.ts` points `OBSERVABILITY_WEBHOOK_URL` at a closed port and saves a report.
**Result:** PASS.

**File:** `backend/app/Providers/AppServiceProvider.php`
**Why it changed:** `Log::shareContext(['release'])`, `Queue::failing` hook.
**Intended business-rule impact:** none; the `Gate::before` inactive-user denial and the permission gates below it are unchanged.
**Result:** PASS.

**File:** `backend/app/Support/Observability/{ErrorReporter,Redactor,Release}.php`, `backend/app/Http/Middleware/RecordRequestTiming.php`, `backend/app/Http/Controllers/Api/ClientErrorController.php`, `backend/app/Services/Operations/SystemHealthService.php`, `backend/app/Http/Controllers/Api/Admin/SystemHealthController.php`, `backend/config/observability.php` (all new)
**Why it changed:** Priority 5 and 6.
**Current behavior:** read-only or write-to-log/cache only; the health snapshot reads queue depth, failed jobs, scheduler heartbeat, migrations, disk, backups and the release; the redactor strips passwords, tokens, cookies, e-mail addresses and report values from anything forwarded.
**Intended business-rule impact:** none.
**Verification performed:** `ObservabilityTest` (12), `error-reporter.test.ts`, matrix (health endpoint), regression spec `observability.spec.ts`.
**Result:** PASS.

**File:** `src/lib/api/client.ts`, `src/lib/observability/error-reporter.ts`, `src/main.tsx`, `src/components/layout/route-error-boundary.tsx`
**Why it changed:** client-side error capture.
**Original behavior:** none.
**Current behavior:** an observer is told the status and path of every 5xx (never the body); global error handlers post sanitised reports (capped at 10 per page load) to `/api/client-errors`; a route render error shows a recovery panel. The request pipeline (retries on 502/503/504 for GETs, timeouts, 401 sign-out) is unchanged: the observer call sits in a try/catch after the response is received.
**Verification performed:** `error-reporter.test.ts`, `route-error-boundary.test.tsx`, `failure-recovery.spec.ts` (the client timeouts and 401/419 paths), regression spec `observability.spec.ts` (client-error endpoint unreachable, the app still saves).
**Result:** PASS.

### 2.6 Other frontend runtime changes (behavioural, non-business)

| File | Change | Business impact | Verification |
|---|---|---|---|
| `src/lib/api/notifications.ts` | restore is sent in batches of 50 (the API validates `max:50`) | none; a cleared inbox over 50 rows can now be restored, which the UI already promised | `failure-recovery.spec.ts` notifications scenario; regression spec `notifications.spec.ts` (clear 60, restore, DB rows) |
| `src/pages/notifications-page.tsx` | one inbox action in flight at a time | none (prevents duplicate requests) | same |
| `src/pages/auth/login-page.tsx` | outage / throttle / inactive wording no longer says "check your password"; a credential rejection keeps the generic message | none; enumeration protection kept (401 and 422 share one message) | `account-enumeration.spec.ts`, `failure-recovery.spec.ts`, `auth.spec.ts` |
| `src/pages/admin/action-items-page.tsx`, `action-item-sheet.tsx` | focus returns to the row after the sheet closes | none | `a11y-keyboard.spec.ts`, regression `action-items.spec.ts` (UI lifecycle) |
| `src/components/ui/sheet.tsx` | close button named and 44 px; opener focus restored on close | none (no handler changed) | `a11y-*`, regression UI specs |
| `src/components/layout/app-shell.tsx` | landmark label, focus ring, reduced-motion, opener focus, 44 px toggle | none | `navigation.spec.ts`, `workspace.spec.ts` |
| `src/lib/api/admin.ts` | `fetchSystemHealth()` | none | matrix |
| `src/lib/api/types.ts`, `src/lib/api/reports.ts` | `expectedUpdatedAt` sent only when defined; conflict types | none | unit + e2e |
| `vite.config.ts` | `VITE_DEV_API_TARGET` proxy override (dev only) | none | harness |

### 2.7 UX ONLY (55 files)

Colour-token replacement (243 utilities, text colours only), `aria-label`s on
the template editor inputs and the import file input, table captions and
`scope="col"` on the roster and rotation tables, `<h1>`/`<h2>`/`<h3>` level
changes, chart `title`s and `rootTabIndex={-1}` on the pie, `min-h-11` /
`min-w-11` touch targets, the dashboard `SectionHeading` stacking below `md`,
`role="status"` on the report form status line, `role="alert"` on the login
error. None of these touch a handler, a disabled condition, a validation rule
or a request. Verified functionally by the full Playwright suite (222 passed)
and the regression UI specs at 320 to 430 px.

### 2.8 INFRASTRUCTURE, TEST ONLY, DOCUMENTATION

Docker/deploy/nginx/compose/`.gitattributes` (LF pinning, release stamp,
`fpm-status` for telemetry, first-install fix in `deploy.sh`): no application
code path. Tests and harness scripts: no runtime effect. Documentation: none.

## 3. Behavioural differences that are intended

| Behaviour | Baseline | Hardening | Why |
|---|---|---|---|
| Save with a stale `expectedUpdatedAt` | overwrite | 409 with the server copy | conflict safety; opt-in by key |
| Save without the key | overwrite | overwrite | unchanged for API clients |
| Delete a ward with placements / teaching sessions / evaluations | 500 or silent null | 422 "deactivate instead" | integrity |
| Delete a section with transfer history | 500 | 422 | integrity |
| Evidence upload when the disk write fails | 201 + orphan row | 500, nothing written | integrity |
| Password change / reset, comment create / delete, access-request approval | no or partial audit row | audit row with before/after | audit coverage |
| Reportable exception | log only | log + counters + optional webhook | observability |
| Every response | | `Server-Timing` header added | observability |
| Failed queue job | log only | counted + webhook | observability |
| Maintenance | no health view | `/admin/system-health` | health |
| Offline save refused by the server | deleted after 5 tries | parked for review, never deleted | offline model |
| Restore of a cleared inbox over 50 rows | 422 | batched, restored | fix |
| Login during an outage | "check your password" | "sign-in is unavailable" | fix |
| Exports older than 30 days | kept forever | pruned by the maintenance command | retention |

## 4. Files that were NOT changed (rule anchors)

For the record, these business-rule owners have no diff against the baseline:
`ReportPolicy`, `ReportAssignment*`, `ReportPeriodWindow`, `ReportingPeriod*`,
`SettingsController` / settings service, `EvaluationFormService`, the
evaluation controllers and eligibility service, `MorningSession*`,
`TransferRequest*` services, `RosterController`, `RotationController`,
`UndergraduateAdminController`, `UserController`, `RoleTransition*`,
`AccessRequestSubmission*`, `AnalyticsExport*`, `NotificationController`,
`NotificationPolicy`, `EnsurePermission`, `EnsureActiveUser`,
`EnsurePasswordChanged`, every policy except the three audit policies, every
migration, every seeder, every form request. The authorization matrix and the
domain regression specs exercise them anyway, because a change elsewhere
(middleware order, a provider hook) could still alter their behaviour.

## 5. Changes made during the regression phase itself

Two one-line product fixes for defects that pre-date the hardening (the code
is byte-identical at `b07b32c`), each with a test, and the harness that found
them:

**File:** `backend/app/Http/Controllers/Api/Admin/ActionItemController.php`
**Why it changed:** `assertTransition` read an explicit `assigned_to: null` as "absent" (`??`), so `status: in_progress` plus a cleared assignee passed the "assign before starting" guard and left an in-progress item nobody owned.
**Original behavior:** 200, `status=in_progress`, `assigned_to=NULL`.
**Current behavior:** 422 `assigned_to` "Assign an active administrator before starting this work."; status and assignee unchanged. Every other transition is untouched.
**Intended business-rule impact:** the existing rule is now enforced for the null case; no rule changed.
**Verification performed:** `ActionItemTest::test_starting_work_while_clearing_the_assignee_is_refused`; `tests/regression/action-items.spec.ts` I-33 (74 PASS after the fix); the eight valid and eleven invalid transitions still answer as before.
**Result:** PASS.

**File:** `src/pages/admin/action-items-page.tsx`
**Why it changed:** closing a deep-linked sheet (`?item=`) re-opened it once: `closeSheet` cleared the handled id in the same tick as the router transition that removes the parameter, and one render still saw the old URL with the flag cleared.
**Original behavior:** Close (or Escape) on a deep-linked sheet appeared not to work; a second dismissal closed it.
**Current behavior:** the handled id is released by an effect once the URL no longer carries `?item=`; the sheet closes on the first dismissal and a later deep link to the same item opens again.
**Intended business-rule impact:** none (UI state only; no request is sent on close).
**Verification performed:** `tests/regression/ui-clinical.spec.ts` AE-06 (closed within 4 s, zero action-item requests, row unchanged) and AE-06b (row-opened sheet, focus returned to the trigger).
**Result:** PASS.

**Files (TEST ONLY):** `playwright.regression.config.ts`, `tests/regression/**`, `scripts/regression/differential.mjs`: the business-logic regression harness (API and browser specs with database re-reads, the authorization matrix, the baseline differential). Findings are written under `output/regression/` (ignored).
