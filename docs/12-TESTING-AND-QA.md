# 12. Testing and QA

The test layers, the commands, the gates a change must pass, the harnesses
that exist beyond the gates, and the lessons that keep them from producing
false failures.

## 1. Layers

| Layer | Tool | Location | Catches |
|---|---|---|---|
| Frontend unit | Vitest, Testing Library | `src/**/*.test.ts(x)` (about 30 files, 170 tests) | pure logic: dates, metrics, selectors, cache behaviour, offline queue semantics, error reporter, route boundary |
| Backend feature and unit | PHPUnit | `backend/tests/Feature`, `backend/tests/Unit` (about 450 tests) | real endpoints called as real roles with a refreshed database; policies; services; migrations |
| Backend on MariaDB | PHPUnit in Docker | `backend/phpunit.mariadb.xml` via the `test` compose profile | database-specific behaviour: concurrency, identifier limits, constraints |
| Browser end to end | Playwright | `tests/e2e/*.spec.ts` (28 suites) | complete flows in a real browser on a fresh seed; authorization from the outside; offline; failure recovery |
| Accessibility audit | Playwright plus axe | `tests/e2e/a11y-*.spec.ts` (opt-in) | WCAG violations across routes and roles, keyboard flows |
| Business-logic regression | Playwright against a running stack | `tests/regression/*.spec.ts` (11 specs) | every business rule exercised through the API and UI with database re-reads |
| Production smoke | Playwright API only | `tests/smoke/production-smoke.spec.ts` | a deployed host, read-only, under a minute |
| Load and capacity | Node harness | `scripts/load-test.mjs`, `scripts/capacity/` | latency percentiles and error rates under concurrent users |
| Failure drills and rollback | shell | `scripts/chaos/` | worker and database failures; the deploy script's rollback |

## 2. Commands

```bash
# Frontend
npm run lint
npm run test:run                    # unit tests once
npm run build
npm run perf:budget                 # bundle size budget
npm run verify                      # lint + test:run + load contract + build + budget

# Backend (SQLite)
cd backend
php artisan test                    # whole suite
php artisan test tests/Feature/ReportWorkflowTest.php
php artisan test --filter=test_name
vendor/bin/pint --test              # formatting, as CI runs it
php composer.phar audit --no-dev

# Backend (MariaDB, Docker)
docker compose --profile test run --build --rm test
docker compose --profile test run --build --rm test --filter ReportWorkflowTest

# Browser gate (stop dev servers on 8000 and 5173 first)
npm run test:e2e
npm run test:e2e -- tests/e2e/report-lock-lifecycle.spec.ts
E2E_ALL_BROWSERS=1 npm run test:e2e     # adds Firefox, WebKit, mobile, tablet projects
E2E_A11Y=1 npm run test:e2e             # the accessibility audit (about 10 minutes)

# Against a live target (parity stack or preview bundle)
E2E_BASE_URL=https://localhost:8443 npx playwright test --config playwright.external.config.ts

# Business-logic regression (dev stack must be running)
npx playwright test --config playwright.regression.config.ts
npx playwright test --config playwright.regression.config.ts tests/regression/clinical.spec.ts

# Smoke
SMOKE_BASE_URL=https://localhost:8443 ... npm run test:smoke

# Load
LOAD_USERS=3 npm run load:test      # local smoke; see docs/LOAD_TESTING.md for real runs
```

## 3. The gates

| Gate | When | Must be |
|---|---|---|
| `npm run verify` | every change | green |
| `php artisan test` | every change | green (one test skips on SQLite: the MariaDB concurrency regression) |
| `composer audit --no-dev`, `pint --test` | every change | clean |
| `npm run test:e2e` | every change; CI on every pull request | green; the admin-navigation interaction budget in `performance.spec.ts` is advisory on shared hardware and enforced on the parity stack |
| MariaDB lane | schema, query or concurrency changes; CI on every pull request | green |
| Regression harness | business-rule changes | 0 FAIL |
| Smoke | after every deploy | 14 of 14 |
| Accessibility audit | UI changes of any size | 0 axe violations |

CI (`.github/workflows/ci.yml`) runs Frontend, Backend SQLite, Backend
MariaDB, Mobile Lighthouse budgets, Deployment shell scripts and the Isolated
Playwright gate on every pull request; branch protection on `main` requires
the five blocking jobs. The e2e job retries twice on CI to absorb UI timing
flakes; locally there are no retries.

## 4. Fixtures and accounts

- **Backend tests** seed roles, templates, departments and field definitions
  per test and create users with factories; the canonical patterns are
  `WorkspaceApiTest` and `ReportWorkflowTest` (`actingAs`, `postJson`,
  `assertJsonPath`, `assertDatabaseHas`). Requests that must look stateful
  send `Referer: http://localhost` and `withCredentials()`.
- **The e2e gate** seeds the development fixture into `e2e.sqlite`, signs in
  each role once in `auth.setup.ts` and shares the storage state. Isolated
  flows create a dedicated assignment in a department nobody reports for and
  retire it afterwards; a retired assignment re-activates with the same id, so
  check for an existing report before assuming a fresh draft.
- **The regression harness** creates a `QA_REG_` nurse through the admin API
  (`passwordChangeRequired: false`), reads the SQLite file directly with
  `node:sqlite`, and records one row per rule under `output/regression/<domain>.json`
  with expected, actual and evidence.
- **The smoke suite** needs a dedicated `QA_SMOKE_` nurse with its own ward
  on the target; never a real nurse.
- **The parity stack** seeds the development fixture (as `APP_ENV=local`)
  into a production-configured application.

## 5. Harness gotchas (each one cost a debugging loop)

- The browser origin must be `http://localhost:5173`; `127.0.0.1` makes every
  API call cross-site.
- The login limiter is 10 per minute per IP and the public auth routes share
  a bucket; the local-only `POST /api/testing/flush-rate-limits` resets it,
  and the parity or production stack has no such route.
- `php artisan serve` handles one request at a time. Two browser sessions
  hammering it can queue a details fetch behind an admin refresh; the
  isolated gate starts a multi-worker server on Linux, and timing budgets
  belong on the parity stack.
- Status-history rows carry second-precision timestamps and the endpoint
  orders by them; land transitions in separate seconds before asserting the
  order (the regression harness uses `nextSecondAfter`).
- The form shows a derived Overdue for an unsubmitted current-week draft
  once the weekly deadline (Monday 10:00) has passed; UI scenarios that assert
  "Draft" move the deadline to Sunday 23:59 for their duration and restore it.
- Playwright restarts the worker after a failed test and re-runs `beforeAll`;
  harness state that must survive is persisted per run (`process.ppid`).
- Chromium reports a `fetch` that receives 204 (`/sanctum/csrf-cookie`) as
  `net::ERR_ABORTED`; it is not an application error.
- Radix sheets make the shell inert; wait for `role=dialog`, not for shell
  buttons.
- Changing an account's password signs out that user's other sessions, so a
  spec that rotates a password must use a dedicated account.
- The e2e gate binds 8000 and 5173 with `reuseExistingServer: false`; stop
  dev servers first, and kill lingering `node` or `php` listeners after a
  stopped background task.
- On Windows, a running `docker compose run` needs `--build` or it reuses a
  stale image; ports 8443 and 8080 may sit in an excluded range (see
  `docs/PARITY_ENVIRONMENT.md`).
- Six concurrent writers on the dev SQLite occasionally hit "database is
  locked"; the harness retries 5xx and records it as INFO.

## 6. Writing a good test here

- Backend first: a feature test that calls the endpoint as the right role and
  the wrong role, asserts the JSON, and re-reads the database.
- Prove the rule, not the implementation: the lock-lifecycle tests were
  written to fail against the old service before the fix.
- Re-read independently: after a mutation, `GET` the record again and query
  the row; do not trust the mutation's response alone.
- Keep the seeded nurse's reports untouched; create isolated assignments.
- Name the business rule in the test name and cite the rule number from
  [02-BUSINESS-RULES](02-BUSINESS-RULES.md) in a comment.

## 7. Reports the harnesses produce

| Harness | Output |
|---|---|
| e2e gate | `playwright-report/`, `test-results/results.json`, traces and screenshots on failure |
| regression harness | `output/regression/<domain>.json`, `output/regression/results.json`, screenshots under `output/regression/shots` |
| smoke | `test-results-smoke/results.json` |
| load | `artifacts/load-tests/` |
| chaos and rollback | `artifacts/chaos/` |
| accessibility audit | `docs/ACCESSIBILITY_AUDIT.md` summarises the last run |

None of these directories are committed.
