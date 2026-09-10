# 06. Security and authorization

How identity, access and data protection work. The permission matrix itself
is in [reference/ROLES-AND-PERMISSIONS](reference/ROLES-AND-PERMISSIONS.md).

## 1. Authentication

**Sanctum SPA cookie sessions**, not bearer tokens. The flow:

1. `GET /sanctum/csrf-cookie` sets the JavaScript-readable `XSRF-TOKEN`.
2. `POST /api/auth/login` with `identifier` (e-mail or username) and
   `password`. On success the server creates a session row in the database,
   regenerates the session id, stamps `last_login_at`, and returns the session
   payload: the user profile, active assignments and the permission list.
3. Every later request carries the `HttpOnly` session cookie and the
   `X-XSRF-TOKEN` header; unsafe methods without a valid token answer 419.
4. `GET /api/auth/me` rehydrates the session on app load.
5. `POST /api/auth/logout` invalidates the session and rotates the CSRF token
   (204).

Why cookies: the cookie cannot be read by script, a session can be revoked by
deleting its row, and deactivating a user is effective on their next request.
The price is the same-origin constraint described in
[03-ARCHITECTURE](03-ARCHITECTURE.md).

### Password rules

| Rule | Value |
|---|---|
| Hashing | bcrypt, cost 12 |
| Minimum length | 8 in development; 12 under the production policy |
| Breach check | optional Have I Been Pwned lookup (`PASSWORD_BREACH_CHECK`), off by default because the LAN may have no internet egress |
| Forced change | new and reset accounts must change their password before any other route answers |
| Reset | e-mailed token, 60-minute expiry, 60-second re-request throttle, always answers 202 |
| Change | requires the current password; 6 attempts per minute on a dedicated counter |

Changing a password signs out that user's other sessions.

### Rate limits

| Endpoint | Limit (per IP unless noted) |
|---|---|
| Login | 10 per minute |
| Forgot and reset password | 5 per minute each |
| Registration queues (nurse, academic, administrator) | 10 per minute, shared bucket |
| Password change | 6 per minute |
| Client error reports | 20 per minute (`CLIENT_ERROR_RATE_LIMIT`) |
| Authenticated API | 300 per minute per user |

Throttle answers are 429 with "Too Many Attempts."; the local environment
exposes `POST /api/testing/flush-rate-limits` for test suites, and nothing
else.

### Enumeration resistance

Wrong password and unknown identifier produce the same 422 body; forgot-
password always answers 202; identifiers are compared case-insensitively.
`tests/e2e/account-enumeration.spec.ts` proves this.

## 2. Authorization: four layers, all must pass

1. **Route middleware.** `auth:sanctum`, then `active` (inactive accounts get
   403 "This account is inactive."), then `password-changed`, then
   `permission:<key>` where declared. The permission strings map to roles in
   a hard-coded matrix; 403 "This action is unauthorized." before the
   controller runs.
2. **`Gate::before`.** An inactive user is denied every gate and policy.
3. **Policies.** 26 classes, one per model, invoked with `Gate::authorize`.
   The pattern is coarse permission, narrow policy: `transfers.review` gets a
   consultant to the endpoint, the policy narrows approval to the head of the
   destination section; `morningAttendance.record` gets a resident to the
   endpoint, the policy narrows it to a designated recorder on the same day.
4. **Query scoping.** Listings are filtered by ownership and workspace, so an
   academic user cannot enumerate clinical rows even by guessing an ID (and
   IDs are UUIDs).

The frontend hides menu items and disables buttons by role, purely for
usability. Server-side checks are the only checks.

### Rules worth knowing

- A locked report is read-only for everyone, administrators included; they
  unlock first (`ReportPolicy::update`, `submit`).
- Administrators cannot edit or deactivate other administrators; only
  Maintenance can. Nobody can deactivate Maintenance or themselves.
- A nurse cannot change role while holding an active assignment.
- Student representatives are refused on every evaluation and analytics
  route; the report list answers 200 with zero rows by decision.
- Export downloads are owner-only, by decision.
- Notifications are readable and mutable only by their recipient (an
  administrator may target another recipient's inbox explicitly); restore is
  guarded against overwriting another recipient's rows.

## 3. Audit trails

| Trail | Table | Records |
|---|---|---|
| Cell audit | `audit_logs` | every changed cell on a submitted report: field, day, old, new, actor, time |
| Admin audit | `admin_audit_logs` | user creation, approvals, rejections, role changes, activation, password resets and changes, locks, settings, template and form edits, evidence, transfers, roster changes; with IP and user agent |
| Status history | `report_status_history` | every report state change with actor and note |
| Action-item history | `action_item_status_history` | every action-item transition |

All are append-only through the API. Retention defaults to forever
(`*_RETENTION_DAYS=0`) until the department decides otherwise.

## 4. Transport and browser protections

Applied by nginx (`deploy/nginx.conf`, mirrored in `docker/nginx.conf`) and
by Laravel middleware on API responses:

| Control | Value |
|---|---|
| TLS | 1.2 and 1.3, internal-CA certificate for `im.hospital.internal`, HSTS one year including subdomains (honours forwarded proto) |
| Content Security Policy | `default-src 'self'`, no object sources, `frame-ancestors 'none'`, `base-uri` and `form-action` self |
| Clickjacking | `X-Frame-Options: DENY` |
| MIME sniffing | `X-Content-Type-Options: nosniff` |
| Referrer | `strict-origin-when-cross-origin` |
| Device access | camera, microphone, geolocation, payment disabled by `Permissions-Policy` |
| Cookies | session cookie `HttpOnly`, `SameSite=Lax`, `Secure` in production, encrypted (`SESSION_ENCRYPT=true`) |
| CORS | explicit `CORS_ALLOWED_ORIGINS` list with credentials; never `*` |
| Debug | `APP_DEBUG=true` in production makes the application refuse to boot |

## 5. Data protection

- **Secrets** live only in `/opt/imreport/shared/backend.env` (mode 640) and
  in the deployment account's MariaDB dump credentials file; only `*.example`
  templates are tracked in git.
- **Uploads** are stored under `storage/app/private`, never in the web root,
  and streamed through policy-checked controllers.
- **Spreadsheet injection**: export and import writers neutralise cells that
  start with `=`, `+`, `-`, `@`, tab or carriage return.
- **Observability never collects** request bodies, cell values, answers,
  documents, passwords, hashes, session ids, tokens, cookies or query strings;
  free text is redacted before logging or forwarding.
- **Sign-out clears** the TanStack Query cache and the workspace cache for
  that user; the offline save queue is keyed by user and never replays for a
  different account on the same device.
- **Backups** are taken with a dump-only database account and copied off the
  box nightly; restore drills are required every 90 days.

## 6. Testing the boundaries

| Suite | What it proves |
|---|---|
| `backend/tests/Feature/AuthorizationTest.php` | policies and the permission matrix |
| `RoleTransitionAuthorizationTest.php` | the role-change guard and the converted account's isolation |
| `UndergraduateModuleTest.php` | the student representative receives 403 on every academic evaluation route |
| `tests/e2e/object-authorization.spec.ts`, `admin-boundary.spec.ts`, `permissions.spec.ts`, `notification-access.spec.ts` | calling the API as the wrong user and asserting the refusal; the admin/Maintenance delta |
| `tests/e2e/account-enumeration.spec.ts`, `zz-rate-limiting.spec.ts`, `security-smoke.spec.ts` | enumeration resistance, throttles, headers, sensitive-file probes |
| `tests/regression/authorization-matrix.spec.ts` | every route as every role, compared with the declared expectation |

## 7. Adding a permission (developer note)

Add the constant to `Permissions.php` and to the relevant `ROLE_PERMISSIONS`
arrays; every constant auto-registers as a gate. Guard the route with
`permission:<key>`, call `Gate::authorize` in the controller, and register a
new policy with `Gate::policy`. Then extend `authorization-matrix.spec.ts`'s
expectations and rerun it. See [14-DEVELOPER-GUIDE](14-DEVELOPER-GUIDE.md).
