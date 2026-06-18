# Test Data Notes

All accounts used for login are the synthetic seeded dev users (`backend/database/seeders/DevUserSeeder.php`) — never present in production. No real patient/staff/PII data was touched.

## Records created by this suite (all marked `QA_TEST_DO_NOT_DEPLOY`)

| Email | Created by | Final state | Cleanup |
|-------|-----------|-------------|---------|
| `qa.crud.donotdeploy@stpaul.local` | `api.spec.ts` (controlled CRUD) | role=nurse, **soft-deactivated** (`active=false`) | Auto-deactivated by the test |
| `qa.session.donotdeploy@stpaul.local` | `security-smoke.spec.ts` (session lifecycle) | role=nurse, password rotated, **soft-deactivated** | Auto-deactivated by the test |

These are **soft-deactivated**, not deleted (the app has no hard-delete; `destroy` = deactivate). They are inert (cannot log in). Safe to leave in the dev DB.

## To fully remove them (optional, dev DB only)

A pre-test backup exists at `backend/database/database.sqlite.qa-backup`. To restore the DB to its exact pre-QA state:

```bash
# stop the backend first, then:
cp backend/database/database.sqlite.qa-backup backend/database/database.sqlite
```

Or re-seed: `cd backend && php artisan migrate:fresh --seed` (restores the dev users + reference + academic data).

## Auth state files

`PLAYWRIGHT_TESTS/.auth/*.json` hold per-role Sanctum session cookies captured by `auth.setup.ts`. They expire with the server session (`SESSION_LIFETIME`); re-running the suite regenerates them. They contain dev-only session cookies — safe, but git-ignore the `.auth/` folder if committing the suite.
