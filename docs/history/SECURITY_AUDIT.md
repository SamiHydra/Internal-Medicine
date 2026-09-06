# SECURITY AUDIT

**System:** St Paul's Hospital IM reporting and academic platform. Vite/React SPA (repo root) + Laravel 12 / Sanctum API (`backend/`). Same-origin nginx deployment on a hospital LAN (`deploy/nginx.conf`).
**Date:** 2026-07-21 (reporting pass 2026-07-22)
**Scope:** OWASP-oriented defensive review. Broken access control, IDOR, privilege escalation, injection, XSS, CSRF, session/cookie, rate limiting, enumeration, secrets, headers/CORS, file upload, dependency posture.
**Basis:** working tree at `7c61392` (Checkpoint 8), with the remediation commit `43bbccc` ("Fix and verify 16 audit findings across both database lanes") already landed. Every line number is from the working tree.

---

## 0. How to read this document

**Evidence base.** This report does not re-audit. It synthesises evidence already on disk:
`AUDIT_FINDINGS.md` (the SEC/AUTHZ findings), `ROLE_PERMISSION_MATRIX.md` (route x role matrix, policy truth tables, 33 escalation paths checked), the route inventory `artifacts/audit-2026-07-21/discovery/02-backend-routes.md`, and the captured evidence under `artifacts/audit-2026-07-21/evidence/`.

**Verdict vocabulary**, used per category:

| Verdict | Meaning |
|---|---|
| **vulnerable-and-fixed** | A real defect was found, a fix landed, and the fix is backed by an executed regression test or an end-to-end reproduction. |
| **vulnerable-open** | A real defect (or a defence-in-depth gap) that is not yet remediated. |
| **not-vulnerable** | Checked; the control holds. |
| **not-tested** | Not empirically exercised. Reported as a boundary, not a clearance. |

**VERIFIED vs PREDICTED.** This distinction is the point of the audit and is stated per claim.
- **VERIFIED** means executed: a regression test that runs, or a request reproduced through the stack.
- **PREDICTED / code-derived** means established by reading source, not by running it. The route x role and policy truth tables in `ROLE_PERMISSION_MATRIX.md` are code-derived unless a named test executes them.

**Two coverage boundaries that bound every "not-tested" verdict below:**
1. **Browser-based role testing has not run.** Eight Playwright specs (cross-role authz, IDOR/object ownership, account enumeration, notification access, registration+approval, clinical report lifecycle, academic evaluation submit, responsive) were authored and committed (`af15ac0`) but NOT executed (`AUDIT_PROGRESS.md` CHECKPOINT 8). Their results are being produced separately; where this report needs e2e results it references `PLAYWRIGHT_TEST_REPORT.md` (produced separately) rather than inventing them.
2. **20 of 53 tables are empty in the seeded database**, including `audit_logs`, `notifications`, `access_requests`, `admin_access_requests`, `report_comments`, `action_items` (`AUDIT_FINDINGS.md` "CRITICAL CAVEAT"). No claim about the runtime behaviour of an empty path is made from that dataset.

**A documentation discrepancy the reader must know about.** `AUDIT_FINDINGS.md` still lists `AUD-SEC-004` (no CSP/HSTS) and `AUD-SEC-005` (duplicate Referrer-Policy) as `Fix status: Open`, and lists the `C-SEC-*` items as "CODE-DERIVED CANDIDATES - PENDING EMPIRICAL VERIFICATION". Those sections are stale: commit `43bbccc` fixed them, the working-tree source confirms the fixes, and `AUDIT_PROGRESS.md` CHECKPOINT 8 records the remediation as verified on both lanes. The findings file received only a 16-line reconciliation touch in that commit and was never fully re-statused. **This report follows the code and the progress log, not the stale status column, and flags each instance inline.**

---

## 1. Security release blockers

**Status: NONE.**

The two blockers that made the system undeployable were both deployment/release-engineering defects, not open security holes, and both are **FIXED - VERIFIED**:

| ID | Blocker | Verification |
|---|---|---|
| `AUD-DB-001` | Migrations abort on MariaDB (71-char index name vs the 64-char limit, `2026_08_12_000010_create_undergraduate_tables.php`). `deploy.sh` runs `migrate --force`, so the server could not be provisioned. | Container DB destroyed and rebuilt from empty: 72 migration/seeder steps, all services healthy (`AUDIT_FINDINGS.md` AUD-DB-001). |
| `AUD-DEPLOY-007` | `composer install` fails on the server's PHP 8.3 (lock required 8.4). `deploy.sh:149` runs it every deploy. | Reproduced on a real 8.3.32 runtime: 91 installs, stack healthy. Root cause fixed by pinning `config.platform.php=8.3.0` and re-resolving the lock (Symfony 8.1.x to 7.4.x). |

No open Critical or High **security** finding remains that should block release. The residual items in Section 15 are Low/Medium hardening and defence-in-depth gaps. The one caveat on "no blockers" is honest coverage: the browser role suite and a dependency CVE scan have not run (Sections 13, 16), so this is "no blocker found," not "no blocker exists."

---

## 2. Broken access control

**What was checked.** The four-layer authorization model (route middleware `permission:<string>` -> `Gate::before` inactive-user shortcut -> 26 policy classes -> service/query scoping), across 174 API routes (6 public, 15 authenticated-but-ungated, 153 permission-gated), for all six roles. Source of truth is the hard-coded `Permissions::ROLE_PERMISSIONS` constant (`Permissions.php:98-195`), which makes the middleware layer statically computable (`ROLE_PERMISSIONS`, route x role grid in `ROLE_PERMISSION_MATRIX.md` Section 3.2).

**Evidence and verdicts.**

- **Layered gating holds for the permission-gated surface.** Every non-granted cell returns 403 from `EnsurePermission` before the controller runs, and admin-shaped permissions are never granted to a non-admin role (`ROLE_PERMISSION_MATRIX.md` Section 2). **Verdict: not-vulnerable** (PREDICTED, code-derived; the whole-matrix assertion is not yet backed by a single test that dumps `ROLE_PERMISSIONS` at runtime, item T-01).

- **Notification API denied its own recipients (F-05 / C-AUTHZ-001). vulnerable-and-fixed.** All five `/api/notifications*` routes require `notifications.view` (`api.php:90-94`). Before the fix, `resident` and `consultant` did not hold that permission, yet the system addresses notifications to them (morning-session reminders, transfer decisions). They hard-403'd on notifications the SPA bell routed them to. The fix grants `NOTIFICATIONS_VIEW` to both roles (`Permissions.php:181,187`) with a comment establishing it grants no cross-user visibility (the controller pins non-admin callers to their own `recipient_id`, and `NotificationPolicy` is owner-or-admin). **VERIFIED** by `tests/Feature/NotificationRoleAccessTest.php` (`43bbccc`).

- **`GET /api/reports` returns 200 with an empty page to non-owning roles, not 403.** The only control is the query filter `whereHas('assignment', nurse_id = user, active = true)` (`ReportWorkflowController.php:51-55`); there is no `Gate::authorize` in `index`. This is an architectural inconsistency (data is correctly scoped, but the response shape differs from a 403), not a leak. **Verdict: not-vulnerable** for data exposure (PREDICTED; e2e item T-08 authored, not executed).

- **Analytics has no per-department scoping visible in-controller (F-04 / C-ARCH-010).** All 12 `/api/analytics/*` routes are gated only by `analytics.view` (superadmin/admin) with zero in-action authorization (`api.php:96-98`, `AnalyticsController`). Because only admin-like roles hold `analytics.view`, there is no cross-role leak today; whether the analytics themselves are department-scoped for a hypothetical scoped role is unproven. **Verdict: not-tested** (item T-22). Report as an open question, not a defect.

- **`recordAttendance` and `viewToday` ignore their `$session` argument (F-06).** `TeachingSessionPolicy::recordAttendance:88-91` authorizes "any active consultant, any session, any batch," contradicting its own docblock ("the consultant who taught"). With 18 active consultants live, that is 18 accounts able to write attendance for any student in any batch. **Verdict: vulnerable-open (Low, over-broad-within-role).** This is horizontal over-reach inside the consultant role, not cross-role escalation. Code-derived (PREDICTED); e2e items T-05/T-34 authored, not executed. Not remediated in `43bbccc`.

---

## 3. IDOR and object ownership

**What was checked.** Per-record ownership on reports, comments, notifications, evaluations, transfers, and the private broadcast channel. Predictable-identifier exposure (UUIDs throughout; `User` uses `HasUuids`).

**Evidence and verdicts.**

- **Report objects. not-vulnerable.** `ReportPolicy::view/update/submit` require admin-like or an owning active assignment; `lock/unlock/delete` require admin-like (`ROLE_PERMISSION_MATRIX.md` Section 4.4). `POST /api/reports` has no route gate but is enforced three layers down at `ReportSubmissionService.php:48 -> authorizeAssignmentEdit:388-400` (owner-or-admin). PREDICTED; e2e item T-09 (a `student_rep` clicking Save on another department's report; server must reject) authored, not executed.

- **Comments. not-vulnerable.** `ReportCommentController::destroy` adds an explicit author-or-admin check at `:75-82` on top of the report-view gate. PREDICTED (verified present by discovery); e2e item T-23 authored, not executed.

- **Notifications. not-vulnerable.** Non-admin callers are pinned to their own `recipient_id`; `NotificationPolicy` is owner-or-admin (`ROLE_PERMISSION_MATRIX.md` Section 4.8). This is what makes the F-05 grant (Section 2) safe.

- **Private broadcast channel UUID-to-int collapse. vulnerable-and-fixed.** The private channel `App.Models.User.{id}` (`channels.php`) must compare ids as strings: casting a non-numeric UUID to int yields 0, so an `(int)` comparison would authorize any user onto any other user's channel. `UserChannel::authorize` now compares `(string) $user->id === (string) $id` and additionally re-asserts `active` and `!password_change_required`, because `Gate::before` does not run for `Broadcast::channel` callbacks and `/broadcasting/auth` carries neither the `active` nor `password-changed` middleware (`UserChannel.php:23-30`). **VERIFIED** by `tests/Feature/ChannelAuthorizationTest.php`. Note: impact was latent regardless, because `BROADCAST_CONNECTION=log` (no live driver), but the fix removes the trap before any on-prem driver is enabled.

---

## 4. Privilege escalation (vertical)

**What was checked.** 33 named escalation paths (`ROLE_PERMISSION_MATRIX.md` Section 6, E-01 to E-33), the five sites that write `users.role_key` (Section 5), and the `UserPolicy` truth tables (Section 4.1). All are code-derived (PREDICTED) unless a named regression test executes them.

**Blocked paths (not-vulnerable, PREDICTED).** Self-promotion to `superadmin` (E-01, `superadmin` is not an accepted value in any API `Rule::in`), a plain admin creating or promoting an admin directly (E-02, E-03, gated by `admins.manage` = superadmin-only), deactivating the maintenance account (E-07), an admin-like actor self-deactivating (E-08), a plain admin deactivating another admin (E-09), client-supplied role in a registration payload (E-13, all three endpoints pin the role server-side), a `superadmin` request approved through the queue (E-14, `CREATABLE_ROLE_TITLES` aborts), `student_rep` reaching evaluation data (E-15, structural absence of `academic.*` permissions), out-of-scope teaching logs (E-16), an origin section head deciding a transfer away (E-17).

**Residual escalation and proliferation items (vulnerable-open, all Low, code-derived):**

- **E-04, a plain admin can cause a new admin account to exist by approving a pending admin signup.** `admins.approve` is held by admin as well as superadmin (`Permissions.php:138`); `AdminAccessRequestPolicy::review` checks only `admins.approve` and never inspects `requested_role`; `CREATABLE_ROLE_TITLES` includes `'admin'`. The pending row is enqueued by the unauthenticated `POST /api/admin-access-requests`. The `admins.manage`/`admins.approve` split is therefore not a containment boundary for admin proliferation. This may be intended (admins approving admins is a plausible workflow), but it is not what the permission split implies. **Not remediated in `43bbccc`.** e2e item T-02 authored, not executed.

- **E-05 / E-06, `UserPolicy::update` self-branch returns `true` before any role check (`UserPolicy.php:35-37`).** The only thing stopping a nurse from PATCHing their own row (including `role_key`) is the route middleware `permission:users.manage`; a superadmin can demote itself to `nurse` in one request, leaving zero superadmins (recoverable only from a shell). This is a defence-in-depth gap: the policy does not stand on its own if the route gate is ever removed. `UserPolicy.php` was flagged IN-FLUX and is not in the `43bbccc` change set. **vulnerable-open (Low, defence-in-depth).**

- **E-10, cross-workspace laundering.** A plain admin can convert a `resident`/`consultant`/`student_rep` into a `nurse` (accepted by `Rule::in` at `UserController.php:133-134`); nothing clears `training_year`, `section_id`, or orphaned `DutyAssignment`/`Section.head_user_id` rows. **vulnerable-open (Low, data-hygiene).**

- **E-21, forced password rotation neutralised without the current password.** `PasswordResetController::reset` clears `password_change_required` with no `active` check and no current-password check, and `forgot` issues links to inactive accounts. Anyone holding the mailbox defeats an admin-forced temporary-password rotation. Login still fails for inactive accounts, so this is a rotation-bypass, not an auth-bypass. `PasswordResetController` is not in the `43bbccc` change set. **vulnerable-open (Low).**

- **E-30, mass-assignment surface at `UserController` `forceFill`.** `update/setActive/resetPassword/destroy` write via `forceFill`, which disables mass-assignment protection, and `role_key` is in `$fillable`. The only constraint is the hand-assembled allow-list and `Rule::in`; the validator omits `active`, `password`, `password_change_required`, `email_verified_at`. Safe today, silently escalating if a future edit widens `$validated`. **vulnerable-open (Low, latent).** e2e item T-32 authored, not executed.

**Session revocation propagation. not-vulnerable (E-19).** An account flipped `active=false` mid-session is denied on every HTTP route by three independent mechanisms (`Gate::before`, `EnsureActiveUser`, `Permissions::forUser` returning `[]`), and now on the broadcast channel too (Section 3, `UserChannel`).

---

## 5. Injection (SQL, command)

**What was checked.** Raw-SQL construction, status/enum column validation, and free-form route bindings.

**Evidence and verdicts.**

- **SQL. not-vulnerable.** The data layer is Eloquent / query-builder throughout. The `whereRaw` calls observed use bound parameters, for example `whereRaw('lower(email) = ?', [$email])` (`AccessRequestSubmissionController.php:172`). No string-concatenated SQL was found in the reviewed controllers/services. PREDICTED (code-derived; no injection fuzzing has run).

- **Status/enum columns. not-vulnerable on the production engine, hardened on the dev lane.** On MariaDB 11.4 (production), `enum()` columns are native value-rejecting `ENUM`s: an out-of-range write fails with ERROR 1265. The code-derived candidate "29 unvalidated enum columns" (C-DB-011) therefore did NOT hold as a production defect and is **checked-and-cleared** for production. A narrower real gap existed only on SQLite: two columns (`departments.family`, `admin_access_requests.status`) lost their CHECK when an unrelated FK migration rebuilt the table, so the dev lane (which the test suite runs on) diverged from production. Migration `2026_09_16_000030_restore_sqlite_enum_check_constraints.php` restores those via driver-guarded triggers, closing the parity gap. **VERIFIED** by `tests/Feature/SchemaConstraintTest.php` (`43bbccc`).

- **Free-form `{key}` route bindings.** `AcademicEvaluationController@form` (`api.php`) and the evaluation-form draft endpoint take non-UUID string keys. These resolve through Eloquent lookups, not raw SQL. **Verdict: not-tested** for injection/unintended-disclosure (item T-25 authored, not executed).

- **Command injection.** No `exec`/`shell_exec`/`proc_open` on user input was surfaced in the reviewed surface. **Verdict: not-tested** (not exhaustively swept; no evidence of a shell-out sink).

---

## 6. Cross-site scripting (XSS)

**What was checked.** The SPA's output-encoding posture and the document-level content-security policy.

**Evidence and verdicts.**

- **Framework encoding. not-vulnerable (baseline).** The client is React, which escapes interpolated content by default. No audit finding records a `dangerouslySetInnerHTML` sink on user data. (Active stored/reflected/DOM XSS probing is part of the browser suite, item authored-not-executed; see `PLAYWRIGHT_TEST_REPORT.md`, produced separately.)

- **Content-Security-Policy on the SPA document. vulnerable-and-fixed (AUD-SEC-004).** The finding: CSP and HSTS were emitted by Laravel middleware (`SecurityHeaders.php`) and so reached `/api` and `/sanctum` responses but not the HTML document nginx serves from disk, which is the only response that can execute script. A CSP that never reaches the document protects nothing against XSS in the SPA. The fix sets the document policy in nginx (`deploy/nginx.conf:56-57,95` and `docker/nginx.conf`):

  `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' https: wss:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; upgrade-insecure-requests`

  `script-src` is `'self'` with no `'unsafe-eval'` (a grep for `new Function`/`Function("")` across all 79 built assets returns nothing, per `deploy/nginx.conf:25-26`). `style-src` retains `'unsafe-inline'` because Radix overlays inject runtime `<style>` elements. **VERIFIED in a real browser** (headless Chromium against the parity lane): sign-in, `/admin/*` pages, the workspace switcher and a Radix combobox all render with zero console CSP violations (`deploy/nginx.conf:16-23`). The stale `AUD-SEC-004: Open` status in `AUDIT_FINDINGS.md` does not reflect this fix.

**Verdict: not-vulnerable at the framework layer, and the document now carries a strict CSP as defence-in-depth. Active XSS probing: not-tested (Playwright pending).**

---

## 7. CSRF and session fixation

**What was checked.** The Sanctum stateful-SPA CSRF model and session regeneration.

**Evidence and verdicts.**

- **CSRF. not-vulnerable.** Auth is session-cookie based via `statefulApi()` (`bootstrap/app.php`), not bearer tokens (`config/auth.php` has no `sanctum` guard; no `createToken(` call exists anywhere in `backend/app`; `personal_access_tokens` has 0 rows, per `ROLE_PERMISSION_MATRIX.md` Section 1.1). The double-submit token is enforced: the `XSRF-TOKEN` cookie is issued by `GET /sanctum/csrf-cookie` and echoed in the `X-XSRF-TOKEN` header on every mutating request. The evidence harness confirms the handshake end to end (`artifacts/audit-2026-07-21/evidence/login.sh`, `req.sh`, and the cookie jar `cj.txt` showing both `XSRF-TOKEN` and the session cookie). **VERIFIED** through the parity stack (csrf 204 -> login 200).

- **Session fixation. not-vulnerable.** The session id is regenerated on login (`AuthController.php:64-66`) and invalidated with a fresh token on logout (`:107-109`).

---

## 8. Session and cookie security

**What was checked.** Cookie flags on the HTTPS parity lane, and revocation behaviour.

**Evidence and verdicts. not-vulnerable.**
- The session cookie is **HttpOnly** and marked **Secure** on HTTPS (`artifacts/audit-2026-07-21/evidence/cj.txt`: the session cookie line carries the `#HttpOnly_` prefix and the Secure column is `TRUE`). The `XSRF-TOKEN` cookie is deliberately not HttpOnly (the SPA must read it to echo the header) but is Secure.
- HSTS is set on the HTTPS server block only, honouring `X-Forwarded-Proto` so it is not dropped behind a TLS-terminating proxy (`SecurityHeaders.php:24-32`, `deploy/nginx.conf:96`).
- Session revocation on deactivation is enforced on HTTP and, post-fix, on the broadcast channel (Section 3). **VERIFIED** via header/cookie capture on the parity lane.

Boundary: cookie flags were captured on the containerised parity lane, which mirrors but is not the department server (`docker/README.md` enumerates 14 documented differences). PREDICTED for the real server until captured there.

---

## 9. Rate limiting and throttling

**What was checked.** Throttle coverage across the public and authenticated surface, and CPU-amplification primitives.

**Evidence and verdicts.**

- **Unthrottled `change-password` / `logout` / `me` (C-SEC-005). vulnerable-and-fixed, empirically reproduced.** `POST /api/auth/change-password` performs a bcrypt verify plus a bcrypt re-hash at `BCRYPT_ROUNDS=12`. Before the fix it carried no throttle, making it a CPU-exhaustion primitive available to any single logged-in account. **Reproduced:** a 60-request burst of wrong-current-password calls all returned 422 with no 429 (`artifacts/audit-2026-07-21/evidence/burst.txt`, per-request 0.68-1.40s of bcrypt work), and container stats show the `app` service at **576% CPU** during the burst versus ~0.01% idle (`cpu-during.txt` vs `cpu-before.txt`; harness `one.sh`). The fix adds a dedicated limiter with its own key prefix, `throttle:6,1,change-password`, and places `me`/`logout` under the shared `throttle:300,1` so they cannot be used to sidestep the API ceiling (`api.php:46-60`). **VERIFIED** by `tests/Feature/AuthThrottleTest.php` (`43bbccc`).

- **Public endpoints are throttled.** login `10,1`, forgot/reset `5,1`, all three registration endpoints `10,1` (`api.php:38-40,64-66`). **not-vulnerable** for unbounded anonymous request volume.

- **No per-account login lockout (E-24). vulnerable-open (Low, by-design-IP-keyed).** The login throttle is IP-keyed for unauthenticated requests; there is no per-account failed-attempt counter. A distributed credential-stuffing attack from many IPs is not rate-limited per target account. Whether a WAF/fail2ban fronts this on-prem is UNVERIFIED.

- **X-Forwarded-For throttle bypass. vulnerable-open (Low/Medium, deployment-conditional).** Laravel keys the unauthenticated throttles on the client IP. `TRUSTED_PROXIES` is read from env (`bootstrap/app.php:32-34`) and the launch-readiness check advises setting it to `"*"` when TLS terminates at a host proxy (`LaunchReadinessCheck.php:229`). With `TRUSTED_PROXIES="*"`, the client IP is taken from the attacker-controlled `X-Forwarded-For` header, so rotating that header yields a fresh throttle bucket per value and defeats the login and registration throttles. **Recommendation:** set `TRUSTED_PROXIES` to the specific proxy address on the LAN, never `"*"`, and document it in `deploy/`.

---

## 10. Account enumeration

**What was checked.** Whether the registration, login, and password-reset surfaces disclose which email addresses have accounts or pending requests, via message content or response timing.

**Evidence and verdicts.**

- **Registration message oracle across three endpoints (C-SEC-004 / E-23). vulnerable-and-fixed.** Before the fix, all three public registration endpoints returned distinct 422 messages separating "account exists" from "request already pending," giving an anonymous prober a classification oracle at 10 req/min/IP (the unauthenticated write reaching a pending row is visible in `artifacts/audit-2026-07-21/evidence/amp-resp.txt`). The fix makes all three non-committal: created, address-taken, and request-pending now return one identical body (`AccessRequestSubmissionController.php:145-152`; `AcademicRegistrationController.php:54-66`; `AdminRegistrationController.php:44-55`), matching the already-correct `PasswordResetController::forgot`. **VERIFIED** by `tests/Feature/AccessRequestSubmissionTest.php` and additions to `AcademicRegistrationTest`/`AdminRegistrationTest`/`AuthApiTest` (`43bbccc`).

- **Timing oracle on the nurse endpoint. vulnerable-and-fixed.** The nurse track uniquely writes a real inactive `users` row carrying the caller-supplied password, so a lazy hash meant only the "address is free" path paid the ~370ms bcrypt cost and a stopwatch recovered the bit the identical body hides. The fix hashes unconditionally and outside the transaction (`AccessRequestSubmissionController.php:84-89`), and the login path treats a never-activated account as indistinguishable from an unknown address (`AuthController.php:44-55`). **VERIFIED** by the same test.

- **Login message. not-vulnerable.** Unknown identifier and wrong password both return `auth.failed`; a pending/inactive account with no prior login also returns `auth.failed` rather than "awaiting approval" (`AuthController.php:30-55`).

- **Login timing side-channel (residual). vulnerable-open (Low).** `AuthController.php:38` short-circuits `! $user || ! Hash::check(...)`: when the identifier is unknown, no bcrypt runs, so an unknown address answers measurably faster than a known address with a wrong password. There is no dummy `Hash::check` on the user-not-found branch to equalise timing. This is the login-timing residual; the message oracle is closed but the timing oracle is not. **Recommendation:** compute a constant-time dummy hash when `$user` is null. Not remediated in `43bbccc`.

---

## 11. Secrets

**What was checked.** Default credentials reaching production, and secrets whose disclosure would be load-bearing.

**Evidence and verdicts.**

- **Dev-seeder default credentials. not-vulnerable (guarded).** `DevUserSeeder` creates a known-credential maintenance/superadmin account for local dev, but it refuses to run under `production` or `testing` (`DevUserSeeder.php:33`, `app()->environment('production','testing')`). A launch-readiness command additionally gates deployment readiness. So the documented dev login does not seed onto the server.

- **Load-bearing secrets (observation, not a finding).** `APP_KEY` encrypts session cookies and signs the relative URLs that guard `PUT /storage/{path}` (Section 12); its secrecy is therefore security-critical on-prem. `BROADCAST_CONNECTION=log` keeps the broadcast surface inert today.

- **Secret scanning of the bundle/repo/logs. not-tested.** No `git-secrets`/`trufflehog`-style scan and no bundle secret grep are present in the evidence set. **Recommendation:** run a secret scan over the repo and the built `dist/` before go-live; confirm no `.env` value is inlined into the SPA bundle.

---

## 12. Headers, CORS, and file upload

### 12.1 Security headers (AUD-SEC-004, AUD-SEC-005). vulnerable-and-fixed.

The document-level CSP/HSTS gap (AUD-SEC-004) is covered in Section 6. The second header finding:

- **AUD-SEC-005, conflicting duplicate `Referrer-Policy` and duplicated `Cache-Control`.** `Referrer-Policy` was previously sent twice with conflicting values (`strict-origin-when-cross-origin` vs `same-origin`) and `Cache-Control` was duplicated on assets, both originating in `deploy/nginx.conf` (so they hit the real server, not just the container). The fix single-sources every hardening header at the server level, sets one `Referrer-Policy` byte-identical to `SecurityHeaders.php` (`deploy/nginx.conf:87-96`), suppresses the document CSP on `/api|/sanctum` paths so Laravel's stricter JSON-shaped CSP is not doubled (`:47-59`), and replaces per-location `add_header` with a `map`-driven `Cache-Control` so nosniff is no longer silently stripped from `/assets/` and `/sw.js` (`:31-45`). The full header set is now `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, a single `Referrer-Policy`, `Permissions-Policy`, `Content-Security-Policy`, and `Strict-Transport-Security`. **VERIFIED** in headless Chromium against the parity lane. Both AUD-SEC-004 and AUD-SEC-005 still read `Open` in the stale `AUDIT_FINDINGS.md`.

### 12.2 CORS. not-vulnerable.

`config/cors.php` scopes CORS to `api/*`, `sanctum/csrf-cookie`, `login`, `logout`, `broadcasting/auth`; `allowed_origins` is env-driven (`CORS_ALLOWED_ORIGINS`, defaulting to `http://localhost:5173`) with no wildcard patterns; `supports_credentials` is true (required for cookie auth, and incompatible with an origin wildcard, so a wildcard cannot be silently introduced). On the same-origin nginx deployment CORS is not exercised at all (`deploy/nginx.conf:1-4`). **Recommendation:** confirm `CORS_ALLOWED_ORIGINS` is set to the exact LAN origin in the production `.env`.

### 12.3 File upload and path traversal. not-tested / hardening.

- **`PUT /storage/{path}` (E-27 / C-SEC-006).** An undeclared framework route writes arbitrary bytes to disk, guarded only by an `APP_KEY`-derived relative signature (`ReceiveFile.php`), with no auth middleware and no throttle, because `config/filesystems.php:36` sets `'serve' => true`. It is UNVERIFIED whether anything in the codebase mints such signed URLs. If nothing does, the capability is vestigial. **Verdict: vulnerable-open only if a signing site exists (unproven); otherwise a hardening item.** **Recommendation:** set `'serve' => false` unless a signed-upload feature is actually in use (item T-26).
- **Import upload validation (XlsxReader).** The `reports.import` surface accepts spreadsheet uploads. Upload validation, oversized/malformed-file handling, and formula-injection posture were **not empirically tested** (Playwright/API fuzzing pending).

---

## 13. Dependency posture

**What was checked.** The runtime platform pin and lock-file drift.

**Evidence and verdicts.**
- **Platform drift fixed (AUD-DEPLOY-007). not a vulnerability, but the fix matters.** `composer.json` now pins `config.platform.php=8.3.0` and the lock was re-resolved (31 downgrades, Symfony 8.1.x to 7.4.x), so the lock can never again resolve against a PHP newer than the server. This removes the false-green risk where CI/lock outran the deploy target.
- **CVE/vulnerability scan of dependencies. not-tested.** No `composer audit` or `npm audit` output is present in the evidence set. This report cannot assert the absence of known-vulnerable packages. **Recommendation:** run `composer audit` and `npm audit --production` as a release gate and record the output; the Symfony 7.4.x downgrade in particular should be re-checked for advisories.

---

## 14. Category verdict summary

| Category | Verdict | Key evidence |
|---|---|---|
| Broken access control | not-vulnerable, with 1 vulnerable-and-fixed (F-05) and 1 Low over-reach open (F-06) | `Permissions.php:181,187`; `NotificationRoleAccessTest`; `TeachingSessionPolicy.php:88-91` |
| IDOR / object ownership | not-vulnerable; broadcast UUID collapse vulnerable-and-fixed | `UserChannel.php:23-30`; `ChannelAuthorizationTest` |
| Privilege escalation | mostly blocked (not-vulnerable); residual Low: E-04, E-05/E-06, E-10, E-21, E-30 | `ROLE_PERMISSION_MATRIX.md` Section 6 |
| Injection (SQL/command) | not-vulnerable (prod ENUM strict); dev-lane CHECK vulnerable-and-fixed | `SchemaConstraintTest`; `2026_09_16_000030` migration |
| XSS | not-vulnerable; document CSP vulnerable-and-fixed (AUD-SEC-004) | `deploy/nginx.conf:56-57,95` |
| CSRF / session fixation | not-vulnerable | Sanctum stateful; `login.sh`/`cj.txt`; `AuthController.php:64-66` |
| Session / cookie | not-vulnerable | `cj.txt` (HttpOnly+Secure); `SecurityHeaders.php:24-32` |
| Rate limiting | vulnerable-and-fixed (C-SEC-005); residual: no per-account lockout, XFF bypass | `burst.txt`, `cpu-during.txt`; `AuthThrottleTest`; `api.php:46-60` |
| Enumeration | vulnerable-and-fixed (message + nurse-timing); residual: login timing | `AccessRequestSubmissionTest`; `AuthController.php:38` |
| Secrets | not-tested; dev-seeder guarded (not-vulnerable) | `DevUserSeeder.php:33` |
| Headers / CORS | vulnerable-and-fixed (AUD-SEC-004/005); CORS not-vulnerable | `deploy/nginx.conf:31-96`; `config/cors.php` |
| File upload / path traversal | not-tested / hardening (`PUT /storage`, import) | `ReceiveFile.php`; `filesystems.php:36` |
| Dependency posture | not-tested (no SCA); platform pin fixed | `composer.json` platform; AUD-DEPLOY-007 |

---

## 15. Residual risks (open, prioritised)

All are Low or deployment-conditional; none is a release blocker.

1. **X-Forwarded-For throttle bypass** (Section 9). Set `TRUSTED_PROXIES` to the exact proxy IP, never `"*"`.
2. **Login timing side-channel** (Section 10). Add a constant-time dummy hash on the user-not-found branch (`AuthController.php:38`).
3. **No per-account login lockout** (Section 9). Consider an account-scoped failed-attempt counter or a fronting WAF/fail2ban policy on the LAN.
4. **Admin proliferation via the approval queue, E-04** (Section 4). Decide explicitly whether an admin approving a new admin is intended; if not, narrow `AdminAccessRequestPolicy::review` to inspect `requested_role`.
5. **`UserPolicy` self-edit defence-in-depth, E-05/E-06** (Section 4). Remove the unconditional self-`true` branch so the policy stands without the route gate.
6. **`recordAttendance`/`viewToday` ignore `$session`, F-06** (Section 2). Bind attendance-write to the taught session or batch.
7. **`PUT /storage/{path}` vestigial signed-write, E-27** (Section 12.3). Set `'serve' => false` unless signed uploads are in use.
8. **Password-reset clears the forced-rotation flag without a current-password/active check, E-21** (Section 4).
9. **`forceFill` mass-assignment latent widening, E-30** (Section 4). Prefer an explicit allow-listed `fill` over `forceFill`.
10. **No dependency CVE scan on record** (Section 13). Add `composer audit`/`npm audit` to the release gate.

---

## 16. Coverage and boundaries (what this report does NOT clear)

Stated plainly because this system is going onto a hospital LAN and a report that implies more coverage than it has is worse than one that names its edges.

- **Browser-based role testing has not executed.** The eight authored specs (`af15ac0`) that would turn many Section 2-4 PREDICTED verdicts into VERIFIED ones were not run; their results appear in `PLAYWRIGHT_TEST_REPORT.md` (produced separately). Until then, the escalation and IDOR clearances are code-derived.
- **No production system was reachable.** All dynamic evidence comes from the local dev lane and the Docker production-parity stack, which mirrors but is not the department server (14 documented differences, `docker/README.md`).
- **20 of 53 tables are empty**, including every audit, notification, and access-request path, so no behaviour-at-volume claim is made about them from this dataset.
- **No injection fuzzing, no automated DAST, no secret scan, no dependency CVE scan** were run. Those categories are marked not-tested, not cleared.
- **Regression coverage that DID execute:** both database lanes are green post-fix, SQLite 313 passed / 1 skipped and MariaDB 314 passed / 0 failures (was 7 failures / 3 errors), 32 regression tests added across the 16 fixes (`AUDIT_PROGRESS.md` CHECKPOINT 8). The security-relevant regression tests are `AuthThrottleTest`, `NotificationRoleAccessTest`, `ChannelAuthorizationTest`, `AccessRequestSubmissionTest`, `SchemaConstraintTest`, and additions to `AuthApiTest`.

---

## 17. Source-evidence discrepancies found while writing this report

1. **`AUDIT_FINDINGS.md` is stale against the code.** Its "OPEN ISSUES" section still marks `AUD-SEC-004` and `AUD-SEC-005` as `Fix status: Open`, and its "CODE-DERIVED CANDIDATES" section still lists `C-SEC-002/003/004/005`, `C-AUTHZ-001`, and `C-SEC-009` as pending. All were fixed in commit `43bbccc`, with the working-tree source and regression tests confirming it, and `AUDIT_PROGRESS.md` CHECKPOINT 8 recording the remediation. The findings file received only a 16-line reconciliation in that commit. This report follows the code and the progress log; a maintenance pass should re-status the findings file so the two agree.
2. **The initial `git status` snapshot predates the remediation commits.** The session-start status showed HEAD at `6bb360f`, but `git log` shows `43bbccc`, `af15ac0`, and `7c61392` landed after it. Line numbers in this report are from the working tree at `7c61392`, which is what the code actually is now.
3. **The `AUDIT_FINDINGS.md` suite-comparison header still reads "281 tests / 7 failures"** (the pre-fix baseline), while the post-fix MariaDB count is 314 passed / 0 failures. Both numbers are correct for their moment; the file simply never updated the headline after the fixes.

*End of SECURITY_AUDIT.md. Companion documents: `ROLE_PERMISSION_MATRIX.md`, `AUDIT_FINDINGS.md`, and `PLAYWRIGHT_TEST_REPORT.md` (produced separately).*
