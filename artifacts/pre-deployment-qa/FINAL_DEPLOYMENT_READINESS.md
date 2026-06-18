# Final Deployment Readiness — Pre-Deployment QA (post-remediation)

**Project:** St Paul Internal Medicine — Clinical Operations & Academic Review
**Date:** 2026-06-13 · **Environment tested:** local dev (not deployed)
**Status:** initial audit + **blocker remediation pass** complete.

## Verdict

> **Safe to deploy: YES — conditional on the production-config checklist below.**
> All confirmed **Critical/High blockers are fixed and verified**. 0 Critical, 0 High remain. The full automated gate is green. The only outstanding items are Medium/Low improvements (non-blocking) and standard production **deployment configuration** (TLS, `APP_DEBUG=false`, secrets) — which are operational steps, not code defects.

### Automated gate (all green, post-fix)
| Suite | Result |
|-------|--------|
| Backend PHPUnit | **136 / 136** passed (790 assertions) — +3 new channel-auth tests |
| Frontend Vitest | **58 / 58** passed |
| Frontend lint + production build | clean / succeeds |
| Playwright E2E (this suite) | **93 / 93** passed · 0 failed · 0 skipped · 0 flaky |
| axe-core (critical gate) | **0 critical** violations on all scanned pages |

Evidence: `evidence/html-report/index.html`, `evidence/results.json`, `evidence/test-results/` (traces/screenshots/video on failure).

---

## High blockers — all RESOLVED

| ID | Blocker | Fix | Verification |
|----|---------|-----|--------------|
| **H1** | Radix `Select` triggers had no accessible name (axe `button-name`, critical) | Added real `aria-label`s to **all** Select triggers (shared `reporting-scope-panel`, academic `PickerField`, users, audit, action-items, templates×2, settings×2, admin-dashboard, data-import); labeled the bare settings inputs; added `focus-visible` ring to `TabsTrigger` | axe critical = **0** on `/admin`, `/admin/users`, `/admin/settings`, `/admin/academic`, `/academic/submit` (Playwright a11y specs pass) |
| **H2** | `channels.php` cast UUID→int → `0===0`/`19===19` authorized ANY user onto another's private channel | Compare as strings via new testable `UserChannel::authorize` helper | **3 regression tests** (`ChannelAuthorizationTest`) prove deny-for-other / allow-for-self / int-collapse demonstration; backend 136/136 |
| **H3** | Admin dashboard gated by two ~5 s calls (`/api/workspace` + `/api/analytics/dashboard`) | Root cause was SQLite reader/writer **lock contention** (`journal_mode=delete`): the cold analytics read blocked the workspace session write. Enabled **WAL**; raised analytics cache TTL 300s→1800s; reduced admin poll 20s→60s | **Measured:** `/api/workspace` **5076 ms → 346 ms** during a concurrent cold build; warm dashboard 260 ms. Shell + data now load in ~350 ms |

**Residual (reclassified to Medium, non-blocking):** the analytics dashboard *cold-cache* build is still ~5.8 s of PHP aggregation over ~6.2k field-values — but it is now **non-blocking** (doesn't freeze the shell) and **cached** (30 min + fingerprint invalidation). A SQL-aggregation rewrite is the proper long-term fix and is **deliberately deferred** (it would risk the 136 green backend tests; tracked in `PERFORMANCE_REPORT.md`).

## Medium items addressed (safe, low-risk)
- **HTTP 419 handling** — SPA client now treats 419 (expired CSRF/session) like 401: resets CSRF + signs out → no more stranding. (`src/lib/api/client.ts`)
- **Secure cookie** — `config/session.php` defaults `secure=true` when `APP_ENV=production` (false on local HTTP). `.env.example` guidance updated.
- **Password policy** — `Password::defaults()`: `min(8)+mixedCase()+numbers()` locally; `min(12)+uncompromised()` in production. Applied at all 7 password entry points.

## Medium / Low — deferred (non-blocking, documented)
- **[Medium] Color contrast** (WCAG AA): muted labels at 4.11–4.47:1 (need 4.5:1) on 5 pages — tracked, recorded in every axe attachment. Deferred: it's a global design-token decision (the muted `#74777f`/`#6c7f95` tokens are used app-wide), not a focused bug fix. See `ACCESSIBILITY_UI_REPORT.md`.
- **[Medium] Analytics SQL aggregation** (H3 residual), **per-identifier brute-force lockout** (per-IP throttle works; per-identifier risked locking out test/dev logins), **users list pagination** (needs coordinated frontend changes). See `BUG_REPORT.md`.
- **[Low]** self-demotion guard, in-controller authz for action-items/import, import MIME/magic-byte check, XLSX row cap, details existence-before-authz, settings bounds, CORS tightening, `TrustHosts`, CSP `style-src`, forgot-password timing, rotate Supabase anon key, list virtualization.

## Verified-good (unchanged from initial audit, re-confirmed)
Server-enforced RBAC (all cross-role 403), privilege-escalation blocked, superadmin lockout-proof, IDOR protected, **password change invalidates other sessions** (live), no secret leakage, security headers + HttpOnly/SameSite cookies, clean error codes, login rate-limiting (429), no console errors / 5xx / blank pages / dead links.

---

## Production deployment checklist (operational — local vs prod clearly separated)

These are **deployment-time configuration** steps. They are NOT code defects and are intentionally NOT applied to the local dev environment (no live `.env` was touched).

- [ ] `APP_ENV=production`, `APP_DEBUG=false`, fresh `php artisan key:generate`
- [ ] Set `SESSION_SECURE_COOKIE=true` (or leave unset — config now defaults it true in production) and serve over **TLS** (+ HSTS; `trustProxies` already wired)
- [ ] Use a real database (MySQL/Postgres) + Redis cache/sessions — removes the SQLite single-file contention entirely (WAL is the local mitigation)
- [ ] Rotate `REVERB_APP_SECRET`; **the channel-auth fix (H2) is in place** before enabling Reverb/websockets
- [ ] Do not ship dev `.env`/`.env.bak`; deploy only `backend/public/` as docroot
- [ ] `cors.allowed_origins` = the SPA origin only; ensure the host serves `dist/_headers` (CSP)
- [ ] Set front-end `VITE_API_BASE_URL` to the prod API; `npm run build`
- [ ] Rotate the Supabase anon key still in git history

## Post-deploy backlog (Medium)
- [ ] Move analytics aggregation into SQL (`GROUP BY … SUM`) to kill the ~5.8s cold build
- [ ] Raise muted-text contrast to ≥4.5:1 (design-token pass)
- [ ] Per-identifier login lockout; paginate the users list

## How to reproduce
```bash
npx playwright test                              # 93/93
cd backend && php artisan test                   # 136/136
npm run verify                                   # lint + vitest(58) + build
npx playwright show-report artifacts/pre-deployment-qa/evidence/html-report
```
