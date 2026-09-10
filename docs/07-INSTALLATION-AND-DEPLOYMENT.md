# 07. Installation and deployment

Four ways to run the platform, from a developer laptop to the hospital server.

## 1. Requirements

| Component | Version |
|---|---|
| PHP | 8.3 (CLI and FPM) with `pdo_sqlite` or `pdo_mysql`, `mbstring`, `dom`, `fileinfo`, OPcache |
| Composer | bundled as `backend/composer.phar`; a system Composer also works |
| Node.js | 22.12 or newer (`package.json` `engines`), npm 10+ |
| Database | SQLite (bundled with PHP) locally; MariaDB 11.4 in production |
| Optional | Docker Desktop or Engine for the parity stack and the MariaDB test lane |

## 2. Local development

```bash
# Backend
cd backend
cp .env.example .env
php artisan key:generate
php artisan migrate                 # SQLite file is created automatically
php artisan db:seed                 # reference data plus the development fixture
php artisan serve                   # http://127.0.0.1:8000

# Queue worker (second terminal; exports and mail need it)
cd backend
php artisan queue:work --queue=analytics,notifications,default --tries=3 --timeout=300

# Frontend (third terminal, repository root)
npm install
cp .env.local.example .env.local    # VITE_API_BASE_URL=http://localhost:5173
npm run dev                         # http://localhost:5173
```

Open `http://localhost:5173`, never `127.0.0.1:5173` (see the same-origin
note in [03-ARCHITECTURE](03-ARCHITECTURE.md)). Development accounts, all
with password `StPaul2026!`:

| Account | Role |
|---|---|
| `admin@stpaulos.local` (username `admin1`) | Maintenance |
| `admin.alem.woldemariam@stpaulos.local` | Administrator |
| `abel.gemechu@stpaulhospital.demo`, `hana.abera@stpaulhospital.demo` | Nurses |
| `rediet.bekele@stpaulhospital.demo` | Resident |
| `chaltu.tesfaye@stpaulhospital.demo` | Consultant |
| `student.rep.group@stpaulos.local` (and `.a`, `.b`) | Student representatives |

The fixture fills `SEED_HISTORY_WEEKS` (104) of clinical history and a
trailing year of academic operations; a full `migrate:fresh --seed` takes
about a minute. `DevAcademicGapSeeder` tops up the gap between the fixture's
build date and today. These seeders refuse to run when `APP_ENV=production`.

Validate a checkout with `npm run verify` and `cd backend && php artisan test`.

## 3. The isolated browser gate

`npm run test:e2e` starts its own backend on a fresh `backend/database/e2e.sqlite`,
seeds it, starts Vite, runs every Playwright spec, and deletes the database
afterwards. It binds ports 8000 and 5173 and refuses to reuse existing servers,
so stop the dev stack first. Details in [12-TESTING-AND-QA](12-TESTING-AND-QA.md).

## 4. The Docker parity stack

A production-shaped environment on any machine: nginx with TLS, PHP-FPM 8.3
with OPcache, MariaDB 11.4, both workers, the scheduler, the production
bundle, `APP_ENV=production`.

```bash
RELEASE_SHA=$(git rev-parse --short=12 HEAD) docker compose up -d --build
curl -sk -o /dev/null -w '%{http_code}\n' https://localhost:8443/up      # 200
docker compose exec app php artisan app:launch-readiness
docker compose down                     # keep data; add -v to start from nothing
```

Sign in at `https://localhost:8443` (self-signed certificate) with the
development accounts above. The MariaDB test lane is separate:
`docker compose --profile test run --build --rm test` (always pass `--build`).
If the stack answers 502 after a rebuild, `docker compose restart web`. If
ports 8443 or 8080 are reserved on the machine, use the override in
`docs/PARITY_ENVIRONMENT.md`. Docker is never the production path.

## 5. First production installation

Production is one Ubuntu LTS server on the hospital LAN with this layout:

```text
/opt/imreport/
  source/                 the git checkout used to deploy
  releases/<id>/          immutable releases
  shared/backend.env      the production environment file
  shared/storage/         uploads, framework data, logs
  current -> releases/... the active release (atomic symlink)
```

Steps (the authoritative version, with exact commands, is `deploy/README.md`):

1. Install nginx, PHP-FPM 8.3, MariaDB 11.4, Composer, Node.js 22 from the
   NodeSource repository, git, `flock`, UFW, unattended security updates.
2. Create the non-login `imreport` account in group `www-data`; create
   `/opt/imreport`, `/var/backups/imreport` and mount the secondary backup
   location, owned `imreport:www-data`, mode 2775.
3. Clone the repository to `/opt/imreport/source` as `imreport`.
4. Write `/opt/imreport/shared/backend.env` (mode 640) with the production
   values in [08-CONFIGURATION-GUIDE](08-CONFIGURATION-GUIDE.md).
5. Create the dump-only database account and `/etc/mysql/imreport-backup.cnf`
   (`root:imreport`, mode 640).
6. Grant `imreport` passwordless sudo for `/usr/bin/systemctl reload php8.3-fpm`
   only.
7. Install the host files from `deploy/`: nginx vhost, PHP-FPM pool, both
   queue units, logrotate, firewall; validate with `php-fpm8.3 -t` and
   `nginx -t`; enable and start both queue services.
8. Install `/etc/cron.d/imreport`:
   ```cron
   * * * * * imreport cd /opt/imreport/current/backend && php artisan schedule:run >> /opt/imreport/shared/storage/logs/schedule.log 2>&1
   0 2 * * * imreport /opt/imreport/source/deploy/backup.sh >> /var/log/imreport-backup.log 2>&1
   ```
9. Provision TLS: the Hospital IT internal CA certificate and key under
   `/etc/imreport/tls`, and the CA root installed on client devices.
10. `sudo -u imreport /opt/imreport/source/deploy/deploy.sh --dry-run` until
    it reports no missing prerequisite.
11. `sudo -u imreport /opt/imreport/source/deploy/deploy.sh`. On an empty
    database it migrates and seeds the reference data (never demo accounts).
12. First install only: create the Maintenance account and store the printed
    password:
    ```bash
    cd /opt/imreport/current/backend
    php artisan app:create-superadmin --email=<email> --username=<username> --full-name="<name>"
    ```
13. `php artisan app:launch-readiness --strict` must be green. Run
    `backup.sh` once by hand, then the restore drill, and set
    `BACKUP_RESTORE_VERIFIED_AT`.
14. Run the post-deployment smoke suite ([15-RELEASE-AND-ROLLBACK](15-RELEASE-AND-ROLLBACK.md)).

Before real users file reports, walk `docs/PRODUCTION_LAUNCH_CHECKLIST.md`
and the root `DEPLOYMENT_CHECKLIST.md`.

## 6. What `deploy.sh` does

1. Takes an exclusive lock so two deploys cannot interleave.
2. Fast-forwards the source checkout; derives the release id
   `<UTC timestamp>-<git revision>`.
3. Builds an immutable release directory with `git archive`; symlinks
   `backend.env` and `shared/storage` into it.
4. Installs Composer dependencies without dev packages; dry-runs the
   migrations.
5. Runs the full frontend verification (lint, unit tests, build, bundle
   budget) with `VITE_API_BASE_URL=APP_URL` and `VITE_RELEASE_SHA` set.
6. Takes a database backup and verifies the archive decompresses.
7. Enters maintenance mode, runs `migrate --force`, seeds reference data on a
   fresh database, builds config, route and view caches.
8. Switches `current` atomically and reloads PHP-FPM.
9. Leaves maintenance mode; checks the auth wall (401), `/up` (200) and
   `app:launch-readiness --strict`; restarts the queue workers.
10. Keeps the last five releases; any failure after the switch restores the
    previous release automatically and exits non-zero.

Users see at most a minute of maintenance mode. Database migrations are
forward-only; see [15-RELEASE-AND-ROLLBACK](15-RELEASE-AND-ROLLBACK.md).

## 7. Updating a running server

```bash
sudo -u imreport /opt/imreport/source/deploy/deploy.sh
cd /opt/imreport/current/backend && php artisan app:launch-readiness --strict
```

Then run the smoke suite. Nothing else is needed: caches are rebuilt, workers
restarted, and the service-worker shell is replaced on the users' next visit.

## 8. Continuous integration

`.github/workflows/ci.yml` runs on pull requests and pushes to `main`:
Frontend (lint, unit tests, build, budget), Backend SQLite (composer audit,
pint, tests), Backend MariaDB (the same suite against MariaDB 11.4), Mobile
Lighthouse budgets, Deployment shell scripts (ShellCheck), and the Isolated
Playwright gate. Branch protection on `main` requires the five blocking jobs.
There is no automatic deploy job; a red pipeline cannot deploy anything.
