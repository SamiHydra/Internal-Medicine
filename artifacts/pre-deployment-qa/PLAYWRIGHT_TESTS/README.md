# Playwright Pre-Deployment QA Suite

End-to-end QA for the St Paul reporting app. Config: `../../playwright.config.ts` (repo root). Servers auto-start if not already running (`reuseExistingServer`).

## Run

```bash
# from repo root
npx playwright test                         # full suite (single worker, deterministic)
npx playwright test permissions.spec.ts     # one category
npx playwright test -g "IDOR"               # by title
npx playwright show-report artifacts/pre-deployment-qa/evidence/html-report
```

## Layout

| File | Covers |
|------|--------|
| `auth.setup.ts` | Logs in each role once → saves `.auth/<role>.json` (storageState) reused by other specs |
| `helpers/accounts.ts` | Seeded dev accounts + `QA_MARKER` |
| `helpers/auth.ts` | `uiLogin` (throttle-resilient), `uiLogout`, `authFile` |
| `helpers/api.ts` | `apiContextFromState`, `apiLoginRaw`, `anonContext`, CSRF/XSRF helpers |
| `helpers/diagnostics.ts` | Console-error / pageerror / failed-request / 5xx capture |
| `auth.spec.ts` | login, invalid creds, session persistence, logout, protected redirect, double-submit |
| `permissions.spec.ts` | frontend guards + backend 403 matrix + escalation + IDOR |
| `api.spec.ts` | unauth 401, validation 422, 404, malformed body, secret-leak, timings, CRUD |
| `navigation.spec.ts` | per-role nav, console errors, dead links, blank pages |
| `dashboard.spec.ts` | clinical/academic/nurse/resident dashboards render |
| `workspace.spec.ts` | clinical↔academic switch + persistence |
| `tables.spec.ts` | search, filter, pagination, empty states |
| `forms.spec.ts` | academic eval + nurse report form validation/render |
| `accessibility.spec.ts` | axe-core across 5 viewports + keyboard |
| `performance.spec.ts` | nav timing, resources, CLS, memory |
| `security-smoke.spec.ts` | headers, cookie flags, file exposure, XSS, session lifecycle |
| `regression.spec.ts` | repeat flows, multi-tab, back/forward, offline |
| `zz-rate-limiting.spec.ts` | login throttle (runs last — exhausts the limiter) |

Notes: single-worker for determinism (shared API + SQLite). Data-dependent tests skip gracefully when seed data is absent. Created records are marked `QA_TEST_DO_NOT_DEPLOY` and soft-deactivated — see `TEST_DATA_NOTES.md`.
