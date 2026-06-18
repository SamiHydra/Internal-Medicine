# Security Review — Pre-Deployment QA

> ## ✅ REMEDIATION UPDATE — 2026-06-13 (post-fix)
> - 🔴→✅ **Channel-auth bypass (H2) FIXED**: `routes/channels.php` now compares UUIDs as strings via `UserChannel::authorize`; 3 regression tests added (`ChannelAuthorizationTest`). Safe to enable Reverb.
> - 🟠→✅ **Password policy added**: `Password::defaults()` = min8+mixedCase+numbers (local), **min12+uncompromised in production** — applied at all 7 password entry points (register/reset/change/admin-create).
> - 🟠→✅ **HTTP 419 handled**: SPA client resets CSRF + signs out on 419 (expired token), no longer stranding users.
> - 🟠→⚙️ **Secure cookie**: `config/session.php` now defaults `secure=true` when `APP_ENV=production` (false on local HTTP); `.env.example` guidance updated. Verified live: session cookie is HttpOnly + SameSite; Secure correctly false on local HTTP (annotation), true in prod.
> - 🟠→⏸ **Brute-force**: per-IP throttle confirmed (429); per-identifier lockout deferred (would lock out dev/test logins) — documented.
> - **Local-vs-prod config** is explicitly separated: `APP_DEBUG`/TLS/secret-rotation are deploy-time checklist items (`FINAL_DEPLOYMENT_READINESS.md`), not code changes; no live `.env` was edited.
>
> Authorization positives re-verified by the Playwright run (93/93): all cross-role 403s, escalation blocked, IDOR protected, no secret leakage, headers present. Sections below are the original audit.

---

# Security Review — Pre-Deployment QA

Date: 2026-06-13. Safe, non-destructive local testing only. Sources: Playwright security/permissions/api specs (live), 11-agent static analysis, PHPUnit `AuthorizationTest`. Risk legend: 🔴 High · 🟠 Medium · 🟡 Low · 🟢 Verified-good.

**Overall posture:** The **authorization core is sound and server-enforced** — this was the highest risk for a medical/PII app and it holds up under live cross-role probing. Remaining work is hardening (deploy config, password policy, 419 handling, brute-force depth) and one **latent** channel-auth bug to fix before enabling websockets. No live auth bypass, no secret exposure, no SQL injection indicators.

---

## 1. Authentication 🟢 (with 🟠 hardening)

- 🟢 **Sanctum cookie/session SPA auth works correctly.** Login primes `/sanctum/csrf-cookie` → `POST /api/auth/login`; CSRF echoed via `X-XSRF-TOKEN`. Session **persists across reload**, **logout clears it**, and back-navigation after logout does **not** restore access (live, `auth.spec.ts`).
- 🟢 **Password change invalidates other sessions** — *live-verified*: a second session returns **401** immediately after a password change (`change=200, meB=401`). This **overturns** a static finding that claimed otherwise. Not a defect.
- 🟢 **No user enumeration on login** — wrong credentials return the generic "These credentials do not match our records."
- 🟠 **No password-strength policy** (min:8 only) on every entry point (login-adjacent, reset, change, all three registrations). → `Password::defaults()->min(12)->mixedCase()->numbers()->uncompromised()`. *(BUG-M2)*
- 🟠 **Coarse brute-force protection.** Throttling is live-confirmed (15 bad logins → **429**), but it's per-IP `throttle:10,1` with no per-account lockout/backoff. → per-identifier limiter + lockout + audit logging. *(BUG-M4)*
- 🟡 Forgot-password has a residual timing side-channel (enumeration); inactive-account login returns a distinct 403 (mild post-auth enumeration).

## 2. Authorization 🟢

All live-verified via `permissions.spec.ts` against the matrix in `Permissions.php`:

- 🟢 **Frontend route guards**: nurse/resident/consultant hitting routes outside their allow-list are redirected to their own landing — the restricted page never renders.
- 🟢 **Backend enforcement (not just UI hiding)**: every privileged call by a low-privilege role returns **403** — nurse→`/api/admin/users|settings|audit-logs|action-items|import-template|analytics|academic` (8/8), resident/consultant→admin & analytics & `academic.view`. Roles can still reach what they should (positive checks green).
- 🟢 **Privilege escalation blocked**: creating a `superadmin` via the user API → **422**; `createAdmin` is superadmin-only; a **superadmin cannot be deactivated** (Maintenance lockout protection, live 403).
- 🟢 **IDOR protected**: a nurse cannot read another nurse's report (live 403/404); `Gate::authorize('view')` on report show/details/update/submit/lock; comment-thread authorization correct.
- 🔴 **Latent: broadcast channel auth bypass** — `channels.php:5-7` casts UUID→int so `0===0` matches any id. Inert today (Reverb off) but **must be fixed before enabling websockets**. *(BUG-H2)*
- 🟡 Defense-in-depth: `ActionItemController` and `ReportImportController` writes rely solely on route middleware (no in-controller `Gate`). Admin self-demotion is ungated with no last-admin invariant. *(BUG-L1/L2/L3)*
- ⚪ `academic.manage` permission is granted but never enforced (dead permission — remove or wire up).

## 3. API exposure & data leakage 🟢

- 🟢 **No sensitive fields in responses** (live): `/api/auth/me` and `/api/admin/users` contain no `password`/`remember_token`/hash keys. Serializers are allow-listed (`SerializesAdminResources`, `User::$hidden`).
- 🟢 **Clean error semantics** (live): unauth → **401 JSON** (no redirect, no 500); unknown id → **404**; missing fields → **422** with `errors`; malformed JSON → **4xx** (never 5xx). No stack traces, file paths, or SQL in responses (`APP_DEBUG` must stay false in prod — see §6).
- 🟡 Batch `reports/details` returns 404 (existence) before per-report authorization. 🟡 Admin notification index can read another user's feed (third-party names) — privacy review item.
- 🟢 `$request->all()` key-normalizers are de-fanged by strict validators (not mass-assignment).

## 4. Headers & cookies 🟢 (🟠 prod flag)

- 🟢 **Headers present on API responses** (live): `Content-Security-Policy: default-src 'self'; …`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy: camera=(),microphone=(),geolocation=(),payment=()`.
- 🟢 **Cookies** (live): session cookie is **HttpOnly** + **SameSite** (Lax/Strict); `XSRF-TOKEN` is intentionally JS-readable (double-submit pattern).
- 🟠 **Session cookie not `Secure`** (live, false on local HTTP). `config/session.php:172` has no default and `.env.example` ships `SESSION_SECURE_COOKIE=false`. → `env('SESSION_SECURE_COOKIE', true)` + enforce TLS in prod. *(BUG-M1)*
- 🟡 SPA HTML CSP is delivered via `dist/_headers` (host-dependent) and `style-src` uses `unsafe-inline`. Ensure the production host honors `_headers`; tighten `style-src`. No `Strict-Transport-Security` on local HTTP (expected; add in prod behind TLS — `trustProxies` is wired).

## 5. CORS / CSRF 🟢 (🟡 tighten)

- 🟢 **CSRF**: Sanctum stateful double-submit works; unsafe requests require a valid `X-XSRF-TOKEN`.
- 🟡 `config/cors.php` sets `allowed_methods='*'` and `allowed_headers='*'`. Tighten to the verbs/headers actually used. `allowed_origins` should be the SPA origin only in prod (verify the prod value).
- 🟡 No `TrustHosts` allow-list — absolute URLs (e.g. password-reset links) are Host-header dependent. Add `trustHosts`.

## 6. Deployment-config exposure 🟠

- 🟠 Local `backend/.env` (and `.env.bak`) carry `APP_DEBUG=true` + a real `APP_KEY`/`REVERB_APP_SECRET`. Both are git-ignored (no committed exposure) but **must not be packaged/uploaded**. → ship only `public/` as docroot; set `APP_ENV=production`, `APP_DEBUG=false`; rotate the Reverb secret; delete `.env.bak`. *(BUG-M1)*
- 🟢 **No sensitive files served** (live, against `127.0.0.1:8000`): `/.env`, `/.git/config`, `/storage/logs/laravel.log`, `/.env.bak`, `/composer.json` all return 403/404.
- 🟡 A Supabase **anon** key remains in git history (commit `a450f89`); rotate it. (Anon keys are low-sensitivity, but rotate as hygiene.)

## 7. Input validation & injection 🟢

- 🟢 **No SQL-injection indicators**: the few `whereRaw`/`lower(...) like ?` uses are parameterized (`UserController` search). No string-interpolated SQL.
- 🟢 **XSS**: no `dangerouslySetInnerHTML` anywhere in `src`; React auto-escaping. Live: a `<img onerror>` payload in user search renders as inert text (handler never fires, no dialog).
- 🟡 **File upload**: import trusts the client-supplied extension (no `mimes`/magic-byte check) and the XLSX parser has no row/cell cap. → validate MIME + sniff magic bytes + cap rows. *(BUG-L4/L5)*
- 🟡 Settings update accepts unbounded integers / arbitrary `metric_targets` keys — bound + allow-list.

## 8. Recommended mitigations before deploy (security)

| Priority | Action |
|----------|--------|
| Before websockets | Fix `channels.php` UUID string comparison (**BUG-H2**) |
| Before deploy | `APP_DEBUG=false`, `SESSION_SECURE_COOKIE=true`, TLS/HSTS, fresh `APP_KEY`, rotated Reverb secret, only `public/` exposed |
| Before deploy | Add `Password::defaults()` strength policy |
| Before deploy | Handle HTTP **419** in the SPA client (**BUG-M3**) |
| Soon after | Per-identifier login lockout; tighten CORS; add `TrustHosts`; rotate Supabase anon key |
