# Baseline Test Results

Audit date: 2026-07-12  
Audit stage: Initial repository inspection and non-destructive baseline only  
Audit specification: `FULL_SYSTEM_AUDIT.md`

Follow-on browser, isolated-database, scheduler, integrity, route-authentication, launch, and PWA results are recorded separately in `EXECUTABLE_VERIFICATION_RESULTS.md`. This file preserves the initial baseline snapshot.

## Baseline outcome

The existing backend and frontend automated test suites pass. The frontend lint and production build also pass. The baseline is not clean overall because Pint reports formatting drift in 38 PHP files and `npm audit` reports 10 dependency vulnerabilities, including 6 high-severity advisories. Composer advisory checking could not run because no Composer executable is installed on the shell PATH.

No application code, migration, test, or assertion was changed during this stage.

## Environment classification

| Item | Baseline value | Classification |
|---|---|---|
| Host | Windows workspace under OneDrive | Local developer workstation |
| Laravel environment | `APP_ENV=local`, `APP_DEBUG=true` | Local only, not production-safe configuration |
| Runtime database | SQLite 3.49.2 at `backend/database/database.sqlite` | Local database |
| Test database | PHPUnit `DB_CONNECTION=sqlite`, `DB_DATABASE=:memory:` | Isolated, in-memory test database |
| Test cache/session | Array drivers | Isolated |
| Test queue | Sync driver | Isolated |
| Runtime cache/session/queue | Database drivers | Local database-backed services |
| Frontend API URL | `http://localhost:5173`, with Vite proxy to `127.0.0.1:8000` | Local same-origin development |
| Application timezone | UTC | Local configuration; business-time correctness is not verified |

Safety determination: the requested `migrate:status`, `db:show`, and PHPUnit commands were safe to run. No migration, truncation, seeding, stress test, synthetic data generation, or destructive security command was run.

## Repository state before audit documentation

| Item | Value |
|---|---|
| Branch | `feat/excel-import` |
| Commit | `d82edb3ac9cc7a88a056a93bdcf72fed46985143` |
| Upstream | `origin/feat/excel-import` |
| Ahead/behind | 14 ahead, 0 behind |
| Modified before this stage | `backend/database/seeders/DatabaseSeeder.php` |
| Untracked before this stage | `FULL_SYSTEM_AUDIT.md`; `backend/database/seeders/DevAcademicDataSeeder.php` |
| Git warning | Global ignore file `C:\Users\Hasse\.config\git\ignore` was unreadable in the sandbox |

The pre-existing seeder changes and audit specification were preserved and not edited.

## Configured toolchain

### Backend

| Tool | Version or configuration |
|---|---|
| PHP | 8.4.19 |
| Laravel | 13.11.2 |
| Composer metadata | 2.9.8 reported by Laravel; CLI unavailable |
| Laravel Sanctum | 4.3.2, SPA cookie authentication |
| Laravel Reverb | 1.10.2 |
| PHPUnit | 12.5.27 |
| Pint | 1.29.1 |
| Local database | SQLite 3.49.2, 52 tables, 54 applied migrations |
| CI database | SQLite plus MariaDB 11.4 service |
| Static analysis | No PHPStan configuration or package detected |
| Alternative test runner | Pest not configured |

### Frontend

| Tool | Installed version |
|---|---|
| Node package manager | npm, lockfile-based install |
| React / React DOM | 19.2.4 |
| TypeScript | 5.9.3 |
| Vite | 8.0.3 |
| React Router DOM | 7.13.2 |
| React Hook Form | 7.72.0 |
| Zod | 4.3.6 |
| Tailwind CSS | 4.2.2 |
| Vitest | 4.1.2 |
| Playwright | 1.60.0 |
| TanStack Query | Not installed; custom API/context caching is used |
| ESLint | 9.39.4 |

## Commands executed and results

PowerShell invoked npm through `C:\Program Files\nodejs\npm.cmd` because the `npm.ps1` shim is blocked by the workstation execution policy.

| Command | Exit | Result | Duration |
|---|---:|---|---:|
| `git branch --show-current` | 0 | `feat/excel-import` | Not measured |
| `git rev-parse HEAD` | 0 | Commit captured | Not measured |
| `git status --short` | 0 | Existing dirty tree captured | Not measured |
| `php artisan about` | 0 | Passed | 2.285 s |
| `php artisan route:list -v` | 0 | Passed, 166 routes | 0.605 s |
| `php artisan migrate:status` | 0 | Passed, 54 ran and 0 pending | 0.671 s initial run |
| `php artisan db:show --database=sqlite` | 0 | Passed, SQLite 3.49.2 and 52 tables | Not measured |
| `php artisan test` | 0 | Passed, 220 tests and 1,338 assertions | 24.957 s PHPUnit; 26.266 s wall |
| `php artisan test --filter=Academic` | 0 | Passed, 31 tests and 210 assertions | 3.348 s PHPUnit; 4.636 s wall |
| `php vendor/bin/pint --test` | 1 | Failed, 38 files require formatting | 22.546 s |
| `composer audit` | Not started | Composer CLI not found | 0.792 s attempt |
| `npm ci` through `npm.ps1` | Not started | Blocked by PowerShell execution policy | 0.145 s attempt |
| `npm.cmd ci`, first two attempts | -4048 | Failed because an active Vite process locked a native Lightning CSS file | 7.306 s and 1.788 s |
| `npm.cmd ci`, after approved stop of project Vite processes | 0 observed | Dependency tree restored from lockfile | Console duration was not captured |
| `npm.cmd run test` | 0 | Passed, 8 files and 60 tests | 5.60 s Vitest; 7.694 s wall |
| `npm.cmd run lint` | 0 | Passed, no ESLint findings | 27.230 s |
| `npm.cmd run build` | 0 | Passed | 1.49 s Vite; 18.589 s wall |
| `npm.cmd audit`, sandbox attempt | 1 | Advisory endpoint unavailable inside sandbox | 1.739 s |
| `npm.cmd audit`, network-approved retry | 1 | Completed with 10 vulnerabilities | 2.509 s |
| `npm.cmd list --depth=0 --json` | 1 | Versions returned; 5 packages reported extraneous | Not measured |

Read-only inspection also used `rg --files`, targeted `rg -n` searches, `Get-Content -Raw`, Composer lockfile JSON parsing, and bounded `php artisan route:list --json` exports. These commands inventoried source files, route declarations, middleware, policies, model relationships, migrations, tests, PWA files, CI, and deployment definitions.

## Test totals

| Suite | Files | Total | Passed | Failed | Skipped | Flaky |
|---|---:|---:|---:|---:|---:|---:|
| Laravel full suite | 34 | 220 | 220 | 0 | 0 reported | Not assessed; no retry run |
| Laravel `Academic` filter | Subset | 31 | 31 | 0 | 0 reported | Not assessed; no retry run |
| Vitest | 8 | 60 | 60 | 0 | 0 reported | Not assessed; no retry run |
| Playwright | 13 spec files inventoried | Not executed | Not executed | Not executed | Not executed | Not assessed |

The Academic-filter result is a name-filtered subset. It does not represent all academic tests because several academic files and methods do not contain the exact word `Academic` in the PHPUnit filter target.

## Build and lint baseline

- ESLint passed without warnings.
- TypeScript project build passed.
- Vite production build passed after transforming 3,297 modules.
- Largest emitted JavaScript chunk: `charts`, 399.79 kB uncompressed and 114.71 kB gzip.
- Other large chunks include `react-core` at 220.15 kB, `vendor` at 199.30 kB, and `motion` at 130.88 kB uncompressed.
- Pint failed on 38 files. The affected set includes controllers, services, models, routes, tests, and `LaunchReadinessCheck.php`.
- No PHPStan check exists.

## Dependency security baseline

`npm audit` reports 10 vulnerabilities: 6 high, 3 moderate, and 1 low.

High-severity advisory families affect:

- React Router and React Router DOM.
- Vite development server behavior.
- Undici.
- `ws` through Engine.IO client.

Moderate advisories affect `brace-expansion`, `js-yaml`, and PostCSS. A low-severity advisory affects Babel core. Applicability to production runtime has not yet been proven; Vite and some affected packages are development-time dependencies, while React Router is part of the browser bundle.

`composer audit` could not run because the Composer executable is unavailable. The locked PHP packages were inventoried, but the absence of an advisory query means PHP dependency security remains unverified.

## Existing warnings and pre-existing failures

- The repository was dirty before documentation was created.
- Pint formatting check fails on 38 files.
- `npm audit` fails its security threshold with 10 advisories.
- `npm list --depth=0` reports five extraneous optional WASM-related packages after `npm ci`: `@emnapi/core`, `@emnapi/runtime`, `@emnapi/wasi-threads`, `@napi-rs/wasm-runtime`, and `@tybys/wasm-util`.
- Git cannot read the user-level global ignore file from the sandbox.
- `public/storage` is not linked in the local backend.
- Laravel reports uncached config, events, and routes, which is normal for local development.
- Runtime `APP_DEBUG=true` is acceptable only because the environment is confirmed local.
- The application timezone is hard-coded to UTC while scheduled clinical and academic reminders use business-clock times without an explicit schedule timezone.

## Missing tools or unavailable services

- Composer CLI is unavailable, so `composer audit` is blocked.
- MariaDB is configured in CI but no local MariaDB service was exercised.
- No production Nginx, PHP-FPM, systemd, cron, SMTP, SMS gateway, TLS certificate, backup mount, or off-box storage was available.
- No browser servers or role fixtures were started in this stage.
- Playwright was not executed because the requested first-stage command list did not include it and the stage explicitly excludes expanding browser tooling.
- No k6 or equivalent performance harness is configured in the required `tests/performance` layout.

## Areas not verified in this stage

- Browser behavior, mobile behavior, accessibility scans, service-worker updates, offline mutation behavior, and logout cache isolation.
- Direct API contract coverage for every route.
- MariaDB-specific migrations, enum behavior, locking, and query plans.
- Concurrency and race conditions.
- Production scheduler timing and actual queue worker retry behavior.
- Database integrity queries against a production-like dataset.
- Performance, load, stress, soak, queue backlog, and scalability measurements.
- Backup creation, restore rehearsal, certificate renewal, firewall state, monitoring, and rollback behavior.
- Composer dependency advisories.
