# Playwright Pre-Deployment QA Suite

End-to-end QA for the St Paul's reporting app. Config: `../../playwright.config.ts` (repo root). The gate refuses to reuse existing servers and recreates a dedicated, gitignored `backend/database/e2e.sqlite` before every run.

## Run

```bash
# from repo root
npm run test:e2e                            # full suite (single worker, deterministic)
npm run test:e2e -- permissions.spec.ts     # one category
npm run test:e2e -- -g "IDOR"               # by title
npx playwright show-report playwright-report
```

## Layout

| File | Covers |
|------|--------|
| `fixtures/auth.setup.ts` | Logs in each role once and saves `.auth/<role>.json` for reuse |
| `pages/login-page.ts` | Reusable login page object |
| `helpers/accounts.ts` | Seeded dev accounts + `QA_MARKER` |
| `helpers/auth.ts` | `uiLogin` (throttle-resilient), `uiLogout`, `authFile` |
| `helpers/api.ts` | `apiContextFromState`, `apiLoginRaw`, `anonContext`, CSRF/XSRF helpers |
| `helpers/diagnostics.ts` | Console-error / pageerror / failed-request / 5xx capture |
| `auth.spec.ts` | login, invalid creds, session persistence, logout, protected redirect, double-submit |
| `permissions.spec.ts` | frontend guards + backend 403 matrix + escalation + IDOR |
| `api.spec.ts` | unauth 401, validation 422, 404, malformed body, secret-leak, timings, CRUD |
| `navigation.spec.ts` | per-role nav, console errors, dead links, blank pages |
| `dashboard.spec.ts` | clinical/academic/nurse/resident dashboards render |
| `workspace.spec.ts` | clinical-to-academic switch + persistence |
| `tables.spec.ts` | search, filter, pagination, empty states |
| `forms.spec.ts` | academic eval + nurse report form validation/render |
| `accessibility.spec.ts` | axe-core across 5 viewports + keyboard |
| `performance.spec.ts` | nav timing, resources, CLS, memory |
| `security-smoke.spec.ts` | headers, cookie flags, file exposure, XSS, session lifecycle |
| `regression.spec.ts` | repeat flows, multi-tab, back/forward, offline |
| `v2-role-workflows.spec.ts` | morning-recorder policy, consultant teaching, and all three representative scopes |
| `zz-rate-limiting.spec.ts` | login throttle (runs last - exhausts the limiter) |

Notes: single-worker for determinism (shared API + isolated SQLite). Database migration and current-date development seeding are automatic. Created records are marked `QA_TEST_DO_NOT_DEPLOY` and soft-deactivated - see `TEST_DATA_NOTES.md`.
