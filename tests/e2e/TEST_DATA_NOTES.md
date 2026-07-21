# Test Data Notes

All accounts used for login are the synthetic seeded dev users (`backend/database/seeders/DevUserSeeder.php`) - never present in production. No real patient/staff/PII data was touched.

## Records created by this suite (all marked `QA_TEST_DO_NOT_DEPLOY`)

| Email | Created by | Final state | Cleanup |
|-------|-----------|-------------|---------|
| `qa.crud.donotdeploy@stpaul.local` | `api.spec.ts` (controlled CRUD) | role=nurse, **soft-deactivated** (`active=false`) | Auto-deactivated by the test |
| `qa.session.donotdeploy@stpaul.local` | `security-smoke.spec.ts` (session lifecycle) | role=nurse, password rotated, **soft-deactivated** | Auto-deactivated by the test |

These are **soft-deactivated**, not deleted (the app has no hard-delete; `destroy` = deactivate). The entire isolated E2E database is removed when the test backend stops, so neither record reaches the normal development database.

## Database isolation

`scripts/start-e2e-backend.mjs` owns the fixed `backend/database/e2e.sqlite` path. It clears Laravel's cached configuration, recreates and seeds that file, and starts the API with explicit local cookie/CORS settings. The launcher never accepts a caller-provided database path, and Playwright refuses to reuse an existing backend or frontend server. The `npm run test:e2e` wrapper removes the database and auth state after Playwright has stopped both servers, including after a failed test run.

## Auth state files

`tests/e2e/.auth/*.json` hold per-role Sanctum session cookies captured by `fixtures/auth.setup.ts`. Startup removes stale files and the npm runner deletes them after the suite. They remain git-ignored as defense in depth.
