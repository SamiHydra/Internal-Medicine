# Pre-Deployment QA — Test Plan

**Project:** St Paul Internal Medicine — Clinical Operations & Academic Review platform
**Location:** `C:\Users\Hasse\OneDrive\Desktop\Mesay`
**Environment:** Local development (NOT deployed). Date: 2026-06-13.
**Prepared by:** QA / Playwright automation + multi-agent static analysis pass.

---

## 1. Project overview

A medical/PII reporting application. Two tiers, same-origin via a Vite proxy:

| Tier | Stack | Port |
|------|-------|------|
| Frontend SPA | Vite 8, React 19, TypeScript, React Router 7, Tailwind 4, Radix UI, Recharts, react-hook-form + Zod | `http://localhost:5173` |
| Backend API | Laravel 13, Sanctum 4 (cookie/session SPA auth), Reverb (websockets), SQLite (dev) | `http://127.0.0.1:8000` |

- **Auth model:** Sanctum stateful cookie auth. The SPA primes `/sanctum/csrf-cookie`, then `POST /api/auth/login`. `XSRF-TOKEN` cookie is echoed as the `X-XSRF-TOKEN` header on unsafe methods. `credentials: include` on every call. The Vite proxy forwards `/api` and `/sanctum` to the API so the browser treats both as same-origin (required for SameSite cookies).
- **Roles (exactly 5):** `superadmin` (="Maintenance", DB/console-only), `admin`, `nurse`, `resident`, `consultant`.
- **Permission model:** static role→permission matrix in `backend/app/Support/Authorization/Permissions.php`, enforced by `permission:*` route middleware + per-resource Policies (`Gate::authorize`).

## 2. Local startup commands

```bash
# Backend (PHP 8.4; SQLite dev DB already migrated + seeded)
cd backend && php artisan serve --host=127.0.0.1 --port=8000

# Frontend (proxies /api + /sanctum to the backend)
npm run dev            # http://localhost:5173

# Existing automated tests
cd backend && php artisan test     # PHPUnit feature/unit
npm run test:run                   # Vitest (frontend unit)

# This QA suite (auto-starts servers if not already running)
npx playwright test
```

**Seeded dev accounts** (all password `StPaul2026!`, from `DevUserSeeder.php`; never present in production):

| Role | Identifier |
|------|------------|
| superadmin | `admin@stpaulos.local` |
| nurse | `abel.gemechu@stpaulhospital.demo`, `hana.abera@stpaulhospital.demo` |
| resident | `rediet.bekele@stpaulhospital.demo`, `samuel.alemu@stpaulhospital.demo` |
| consultant | `chaltu.tesfaye@stpaulhospital.demo`, `mesfin.girma@stpaulhospital.demo` |

## 3. Discovered routes / features

- **29 frontend routes** (5 public, the rest behind `ProtectedRoute`/`ProtectedShell` with role arrays). Full list in `ROUTE_MAP.md`.
- **91 backend API endpoints** across auth, reports workflow, comments, notifications, analytics, academic, and the admin group (users, assignments, templates, departments, settings, access-requests, audit, import, action-items, academic admin). Full list in `ROUTE_MAP.md`.
- **Features:** clinical weekly report submission (nurse) + admin review/lock; academic peer-evaluation submission (resident/consultant) + admin analytics; user & access management with self-signup + approval; editable templates; Excel/XLSX round-trippable import; threaded report comments; notifications; clinical & academic dashboards; clinical↔academic workspace switcher.

## 4. Test scope (this pass)

| Category | Method | Spec file |
|----------|--------|-----------|
| Authentication / session | Playwright UI + storageState | `auth.spec.ts`, `auth.setup.ts` |
| Role & permission enforcement (frontend + backend) | Playwright + API | `permissions.spec.ts` |
| API validation / error codes / secret leakage / timing | Playwright API | `api.spec.ts` |
| Navigation / console errors / dead links / blank pages | Playwright UI | `navigation.spec.ts` |
| Dashboards (clinical, academic, nurse, resident) | Playwright UI | `dashboard.spec.ts` |
| Workspace switching + persistence | Playwright UI | `workspace.spec.ts` |
| Tables: search / filter / pagination / empty states | Playwright UI | `tables.spec.ts` |
| Forms: validation + render | Playwright UI | `forms.spec.ts` |
| Accessibility (axe-core, 5 viewports) + keyboard | Playwright + axe | `accessibility.spec.ts` |
| Performance (nav timing, resources, CLS, memory) | Playwright metrics | `performance.spec.ts` |
| Security smoke (headers, cookies, XSS, file exposure, session lifecycle) | Playwright | `security-smoke.spec.ts` |
| Regression / stability (repeat, multi-tab, offline, back/forward) | Playwright UI | `regression.spec.ts` |
| Rate limiting (login throttle) | Playwright API (runs last) | `zz-rate-limiting.spec.ts` |
| Full-stack static analysis (routes/roles/API/security/perf/a11y) | 11-agent read-only fan-out | see `_raw/static-*.json` |

**Viewports tested:** 1920×1080, 1366×768, 1024×768, 390×844, 360×800.

## 5. Blocked / out-of-scope areas

- **No deployment, no production DB, no `.env` edits, no destructive commands** (per engagement rules).
- **Reverb / websocket channel auth** (`/broadcasting/auth`) not live — Reverb is not running in dev; the channel-auth UUID→int finding is verified statically only.
- **Production CSP via `dist/_headers`** — host-dependent (Netlify/Cloudflare style); not exercised by the dev server.
- **Production source-map exposure** — requires a `vite build`; Vite default is no sourcemaps (noted, not built).
- **Email flows** (password-reset delivery) — not sent in dev.

## 6. Assumptions

- The seeded SQLite dev DB is entirely synthetic test data (no real patient/staff/PII). Testing against it is safe; a backup copy was taken (`backend/database/database.sqlite.qa-backup`).
- The dev login throttle (`throttle:10,1`) is the production value; the suite is throttle-resilient and the rate-limit test runs last.
- Same-origin proxy behavior in dev mirrors a same-origin production deployment.

## 7. Risks

- Tests share **one** API + **one** SQLite DB; the suite runs single-worker for determinism. A few specs create data — all marked `QA_TEST_DO_NOT_DEPLOY` and soft-deactivated afterward (see test-data notes in `PLAYWRIGHT_TESTS/`).
- Data-dependent UI tests (clinical report form, IDOR) skip gracefully when the relevant seed data is absent, rather than producing false failures.
- `APP_DEBUG=true` and a real `APP_KEY`/Reverb secret are present in the **local** `backend/.env`; these must not ship (see `FINAL_DEPLOYMENT_READINESS.md`).
