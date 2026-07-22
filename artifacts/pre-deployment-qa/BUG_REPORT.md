# Bug Report — Pre-Deployment QA

> ## ✅ REMEDIATION UPDATE — 2026-06-13 (post-fix)
> Re-validated gate: **PHPUnit 136/136 · Vitest 58/58 · lint+build clean · Playwright 93/93 (0 fail)**.
>
> | ID | Status | What changed |
> |----|--------|--------------|
> | **BUG-H1** (Select a11y) | ✅ **FIXED** | `aria-label`s on every Select trigger + labeled bare settings inputs + Tabs `focus-visible`. axe **critical = 0** on all scanned pages. |
> | **BUG-H2** (channel-auth bypass) | ✅ **FIXED** | String UUID comparison via `UserChannel::authorize`; 3 regression tests. |
> | **BUG-H3** (dashboard perf) | ✅ **FIXED** (blocking resolved) | SQLite **WAL** → `/api/workspace` 5076ms→**346ms** (no longer blocked); analytics cache TTL→30m; poll 20s→60s. Cold analytics ~5.8s **reclassified to Medium** (non-blocking + cached; SQL rewrite deferred). |
> | **BUG-M1** (insecure defaults) | ⚙️ **Config fixed** | `SESSION_SECURE_COOKIE` defaults true in production (config); `APP_DEBUG`/secrets are deploy-time (checklist). |
> | **BUG-M2** (password policy) | ✅ **FIXED** | `Password::defaults()` min8+mixedCase+numbers (prod: min12+uncompromised). |
> | **BUG-M3** (HTTP 419) | ✅ **FIXED** | SPA client handles 419 like expired session. |
> | **BUG-M4** (brute-force depth) | ⏸ Deferred | Per-IP throttle works (429 verified); per-identifier lockout risked locking out dev/test logins. |
> | **BUG-M5/M6** (poll / users list) | ◑ Partial | Poll reduced 20s→60s; users-list pagination deferred (needs frontend changes). |
> | **BUG-M7** (contrast / focus) | ◑ Partial | Tabs `focus-visible` ✅; **color-contrast deferred** (tracked Medium, global design-token decision — recorded in every axe attachment). |
> | **Low L1–L14** | ⏸ Deferred | Documented backlog; none blocking. |
>
> **Remaining High/Critical: 0.** See `FINAL_DEPLOYMENT_READINESS.md` for the verdict and prod checklist. The sections below are the **original audit** (pre-fix), retained as the audit trail.

---

# Bug Report — Pre-Deployment QA

Date: 2026-06-13. Sources: 12-spec Playwright suite (86 passed / 7 failed — all 7 are the findings below or intended prod-flag surfaces; **0 test-script defects**), 11-agent static analysis, PHPUnit 133/133, Vitest 58/58.

**Severity summary:** Critical 0 · High 3 · Medium 7 · Low 14 · Info/Positive (verified-good) 10.
**No deployment blocker is a true Critical** (no data loss, no auth bypass, no secret exposure live). The High items are an accessibility blocker, a latent channel-auth bug, and an analytics perf risk.

Evidence lives in `evidence/test-results/<test>/` (trace.zip, screenshots, video, error-context.md) and `_raw/static-*.json`.

---

## HIGH

### BUG-H1 — Radix Select fields have no accessible name (screen-reader blocker)
- **Severity:** High · **Category:** Accessibility · **Source:** Live (axe-core) + static
- **Route/role:** `/academic/submit` (resident/consultant), `/admin/settings`, `/admin/users`, `/admin`, `/admin/academic` (admin/superadmin)
- **Steps:** Run axe-core on any page using the `Select` component; or navigate with a screen reader to a dropdown.
- **Expected:** Each select control exposes a programmatic accessible name.
- **Actual:** axe rule **`button-name` (impact: critical)** fires — the `<button role="combobox">` Select trigger has no inner text, `aria-label`, `aria-labelledby`, `title`, or associated `<label>`. SR announces only the placeholder. Confirmed on 5 routes; `/academic/submit` also shows `button-name(2)`.
- **Evidence:** `evidence/test-results/accessibility-*a11y-scan-*/error-context.md`; `accessibility.spec.ts`.
- **Root cause:** `SelectTrigger` (FieldShell/PickerField) renders a label with `htmlFor` but the trigger gets no matching `id`/`aria-label`. `src/pages/academic/evaluation-form-page.tsx:197,451-461`, `src/pages/admin/audit-log-page.tsx:541-544`, shared `src/components/ui/select.tsx`.
- **Fix:** Give each `SelectTrigger` an `id` matching the label's `htmlFor`, or pass `aria-label`/`aria-labelledby`. Add the wiring once in the shared `Select` wrapper.

### BUG-H2 — Private broadcast channel authorization bypass (latent until Reverb enabled)
- **Severity:** High · **Category:** Permission/Security · **Source:** Static (could not be live-verified — Reverb off in dev)
- **Steps:** Enable Reverb (`BROADCAST_CONNECTION=reverb`); as user A, subscribe via `/broadcasting/auth` to user B's private notification channel.
- **Expected:** Only the owning user may subscribe to their private channel.
- **Actual:** `backend/routes/channels.php:5-7` returns `(int) $user->id === (int) $id`. `User` uses `HasUuids`, so both are UUID strings; `(int)"<uuid>"` is `0`, making the check `0 === 0` → **true for any id**. Any authenticated user could receive another user's realtime events.
- **Root cause:** Integer cast on UUID identifiers.
- **Fix:** `return (string) $user->id === (string) $id;` Add a test that subscribing to another user's channel is rejected. **Must be fixed before enabling Reverb in production.**

### BUG-H3 — All-time analytics hydrates full history into PHP memory; `/api/analytics/dashboard` > 5s
- **Severity:** High · **Category:** Performance · **Source:** Live + static
- **Steps:** As admin, `GET /api/analytics/dashboard` (also `/overview`, `/yearly`).
- **Expected:** Sub-second to low-second response, bounded memory.
- **Actual:** Live timing **5478 ms** (exceeds the 5s budget) on the seeded dataset. `AnalyticsService::reports()` (`backend/.../AnalyticsService.php:351-395`) eager-loads `fieldValues.fieldDefinition` + 5 other relations and ends in `->get()->sortBy(...)` with **no LIMIT**; all sums/averages/rollups run in PHP. `report_field_values` is the fastest-growing table (~fields×7/week) → cold-build memory and latency grow with history.
- **Evidence:** `evidence/test-results/api-API-response-times-*/error-context.md` (`/api/analytics/dashboard took 5478ms`); `api.spec.ts:126`.
- **Fix:** Push aggregation into SQL (`GROUP BY` with `SUM(value_number)` joined to `field_definitions`) for unbounded ranges; require a bounded date range and/or a defensive LIMIT on the heaviest endpoints.

---

## MEDIUM

### BUG-M1 — Insecure-by-default deployment config (session cookie not Secure; APP_DEBUG=true in local .env)
- **Severity:** Medium · **Category:** DeploymentReadiness/Security · **Source:** Live + static
- **Actual:** Live: the Sanctum session cookie has **Secure=false** (HttpOnly ✓, SameSite Lax/Strict ✓). `config/session.php:172` is `env('SESSION_SECURE_COOKIE')` with no default → null; `.env.example` ships `SESSION_SECURE_COOKIE=false`. The local `backend/.env` (and `.env.bak`) have `APP_DEBUG=true` + a real `APP_KEY`/`REVERB_APP_SECRET`.
- **Evidence:** `security-smoke.spec.ts` cookie test (soft-flag: "must be true in prod").
- **Fix:** `env('SESSION_SECURE_COOKIE', true)`, set it `true` in `.env.example`, enforce TLS in prod; never ship dev `.env`/`.env.bak`; deploy with `APP_ENV=production`, `APP_DEBUG=false`, fresh key, rotated Reverb secret, only `public/` as docroot.

### BUG-M2 — No password-strength policy (min:8 only)
- **Severity:** Medium · **Category:** Security · **Source:** Static
- **Actual:** Every entry point (`AuthController:60`, `PasswordResetController:44`, `Admin/UserController:66,182,189`, the three registration controllers) validates only `['string','min:8']`. No complexity, no breach check. Clinical-data system allows trivially weak/known-breached passwords.
- **Fix:** Define `Password::defaults()` in `AppServiceProvider::boot()` (e.g. `min(12)->mixedCase()->numbers()->uncompromised()`); apply on all entry points; keep `confirmed`/`different`.

### BUG-M3 — SPA does not handle HTTP 419 (expired CSRF/session) → user stranded
- **Severity:** Medium · **Category:** Functional · **Source:** Static (code-confirmed)
- **Actual:** `src/lib/api/client.ts:203` only handles `401 && !/api/auth/`. With `SESSION_LIFETIME=120`, an expired session returns **419** on the next unsafe request; `csrfReady` stays true, no sign-out fires, every subsequent write 419s. The `markSignedOut` comment even acknowledges 419 but nothing calls it.
- **Fix:** In the `!response.ok` branch, treat 419 like expiry: reset `csrfReady` (re-prime `/sanctum/csrf-cookie`) and `markSignedOut()` for non-auth paths.

### BUG-M4 — Coarse brute-force protection (per-IP only, no per-account lockout)
- **Severity:** Medium · **Category:** Security · **Source:** Live + static
- **Actual:** Live: throttling works — 15 rapid bad logins returned **429** (good). But it's a generic `throttle:10,1` keyed by user-or-IP; no per-identifier lockout/backoff. A shared NAT IP can lock out legit users; distributed stuffing gets 10/min/IP indefinitely.
- **Evidence:** `zz-rate-limiting.spec.ts` (passed; 429 observed).
- **Fix:** Add a per-identifier `RateLimiter::for('login')` (lower(identifier)+IP, ~5/min) + temporary lockout after N failures; log to the audit trail.

### BUG-M5 — 20s admin poll refetches the entire workspace payload (no ETag/diff)
- **Severity:** Medium · **Category:** Performance · **Source:** Static
- **Actual:** `app-data-context.tsx:1040` polls `GET /api/workspace` every 20s; `WorkspaceController::show()` runs ~10 queries (incl. reports up to `limit(10000)`, 100 notifications, all profiles/assignments) and re-serializes the whole payload each call, no conditional response. Every active admin tab = full rebuild + full transfer every 20s.
- **Fix:** Add a change fingerprint (max `updated_at`) → return 304/empty when unchanged, or a lightweight `/workspace/since` poll endpoint.

### BUG-M6 — Admin users list is unpaginated and bundled into workspace bootstrap
- **Severity:** Medium · **Category:** Performance/API · **Source:** Static
- **Actual:** `UserController::index()` does `User::query()->with(...)->get()` (no pagination); also pulled into the workspace bootstrap via `includeProfiles`. Payload grows linearly with staff count, unlike all other lists which `->paginate()`.
- **Fix:** Paginate + server-side search (the `q` filter already exists); lazy-load the profile directory.

### BUG-M7 — Color-contrast and focus-visibility accessibility defects
- **Severity:** Medium · **Category:** Accessibility/UI · **Source:** Live + static
- **Actual:** axe **`color-contrast` (serious)** on every authenticated scan (e.g. 15 nodes on `/academic/submit`); `#9aa7b8`/`#74777f` muted tokens ≈2.4–4.3:1 (< 4.5:1 AA). `TabsTrigger` (`src/components/ui/tabs.tsx:31-38`) has no `focus-visible` ring (WCAG 2.4.7). `/admin/settings` also shows an axe `label` violation (input without a programmatic label).
- **Fix:** Darken muted greys to ≥4.5:1; add `focus-visible:ring-2` to `TabsTrigger`; label the settings input.

---

## LOW

| ID | Title | Category | Location / Fix |
|----|-------|----------|----------------|
| L1 | Admin can self-demote to nurse; no last-admin invariant | Functional | `UserController:107-152`, `UserPolicy:33-44` — block self role-downgrade; guard against removing the last admin |
| L2 | ActionItem write endpoints rely only on route middleware (no in-controller authz) | Permission | `ActionItemController` — add `Gate`/policy for defense-in-depth |
| L3 | Report import endpoints rely only on route middleware | Permission | `ReportImportController:23-75` — add explicit authorization |
| L4 | File type trusts client extension; no mimes/magic-byte check | Security | `ReportImportController:62-83` — validate `mimes`/`mimetypes` + sniff magic bytes |
| L5 | XLSX parser has no row/cell cap (DoS via huge sheet) | Performance/Security | `XlsxReader.php:139-172` — cap rows/cells |
| L6 | Batch report-details reveals existence (404) before per-report authz | Security | `ReportWorkflowController:124-142` — authorize before existence disclosure |
| L7 | Settings accepts unbounded integers + arbitrary `metric_targets` keys | Functional | `SettingsController:41-76` — bound + allow-list keys |
| L8 | Academic analytics aggregates entire set in PHP | Performance | `AcademicAnalyticsService:67-207` — SQL aggregation |
| L9 | CORS `allowed_methods` and `allowed_headers` are `*` | API/Security | `config/cors.php:19,25` — tighten to needed verbs/headers |
| L10 | No `TrustHosts` allow-list (Host-header dependent absolute URLs, e.g. reset links) | Security | `bootstrap/app.php` — add `trustHosts` |
| L11 | SPA CSP only via `dist/_headers`; `style-src` uses `unsafe-inline` | Security | `SecurityHeaders.php:22`, `dist/_headers` — ensure host serves `_headers`; tighten style-src |
| L12 | Forgot-password residual timing side-channel (account enumeration) | Security | `PasswordResetController:18-37` — constant-time path |
| L13 | Supabase anon key remains in git history | Security | rotate the key (commit `a450f89`) |
| L14 | No client-side list virtualization; admin dashboard is one ~2786-line eager-recharts chunk | Performance | virtualize large feeds; split the admin dashboard route/chunk |

---

## INFO / Verified-good (live-confirmed positives)

- **Authorization is genuinely server-enforced** (live): every cross-role privileged API call returns **403** (nurse/resident/consultant); the matrix also allows what it should (admin/nurse/resident positives green). `permissions.spec.ts`.
- **Privilege escalation blocked** (live): creating a `superadmin` via the user API → **422**; an admin cannot create another admin (`createAdmin` = superadmin-only); a **superadmin cannot be deactivated** (Maintenance lockout protection). 
- **IDOR protected** (live): a nurse cannot read another nurse's report (`403/404`); comment thread authorization is correct (static).
- **Password change invalidates other sessions** (live: other session → **401**) — *this overturns the static "sessions not invalidated" High finding; it is NOT a defect.*
- **No secret leakage** (live): `/api/auth/me` and `/api/admin/users` expose no `password`/`remember_token`/hash fields. Serializers are allow-listed.
- **Security headers present** (live): CSP `default-src 'self'`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy`.
- **Cookies** (live): session cookie is **HttpOnly** + **SameSite** Lax/Strict; `XSRF-TOKEN` intentionally JS-readable (double-submit).
- **Clean error handling** (live): unauth → 401 JSON (no redirect/500); invalid id → 404; missing fields → 422; malformed JSON → 4xx (never 5xx).
- **No console errors / no 5xx / no blank pages / no dead links** across every role's navigation; dashboards render charts; reflected XSS payload in user search is escaped (not executed).
- **Info:** `academic.manage` permission is granted but never enforced (dead). Notification index lets an admin read another user's feed (third-party names) — minor privacy review item. Inactive-login returns a distinct 403 (mild post-auth enumeration).
