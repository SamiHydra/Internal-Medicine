# Docker production-parity stack

A local MariaDB + nginx + PHP-FPM stack that behaves like the department server,
built so a security / performance / scalability audit can measure the things the
SQLite dev lane physically cannot show:

| Only measurable here | Why the dev lane cannot show it |
|---|---|
| Write concurrency, row locks, deadlocks | SQLite is single-writer |
| Connection-pool limits, `max_connections` saturation | SQLite has no server, no connections |
| Real query plans, index effectiveness | SQLite's planner is not MariaDB's |
| Slow-query log, `performance_schema` | Not available in SQLite |
| TLS response headers, HSTS | `artisan serve` is plain HTTP |
| `Secure` / `HttpOnly` / `SameSite` cookie flags in force | `SESSION_SECURE_COOKIE` is off locally |
| nginx-added headers, cache-control on hashed assets | Vite dev server serves everything |
| OPcache-warm PHP performance | `artisan serve` runs a single un-cached process |
| `backend/tests/Feature/MariaDbConcurrencyRegressionTest.php` | It skips itself unless the driver is `mariadb` |

The stack **never touches `backend/.env`, the dev SQLite database, or ports
5173 / 8000.**

---

## Defects this stack found on its first run

Bringing the stack up surfaced three defects that the SQLite dev lane cannot
expose. Read these before trusting any "it works locally" claim.

### 1. BLOCKER - `php artisan migrate` cannot complete on MariaDB

`backend/database/migrations/2026_08_12_000010_create_undergraduate_tables.php`
declares, on table `teaching_sessions`:

```php
$table->unique(['batch_id', 'subgroup', 'activity_type', 'scheduled_date']);
```

Laravel auto-generates the index name
`teaching_sessions_batch_id_subgroup_activity_type_scheduled_date_unique` -
**71 characters**. MySQL and MariaDB cap identifiers at **64**:

```
SQLSTATE[42000]: 1059 Identifier name '...' is too long
```

SQLite has no identifier-length limit, so this passes on the dev lane and on the
default `phpunit.xml` suite, and fails **100% of the time** on the real database.
Consequences: `deploy/deploy.sh` (which runs `php artisan migrate --force`)
cannot deploy to the department server; the `backend-mariadb` CI job cannot be
green; and every `RefreshDatabase` test in the MariaDB lane dies inside
`migrate:fresh` - which is why `MariaDbConcurrencyRegressionTest` has never
actually executed anywhere.

It is the **only** such identifier in the entire migration set (all others are
under 64 or explicitly named), so the real fix is one line in the repo:

```php
$table->unique([...], 'teaching_sessions_slot_unique');
```

**Fixed upstream.** The migration now passes the explicit name, so the stack
builds with no source patching at all;
`docker/patches/apply-parity-patches.sh`, which used to rewrite the line inside
the image, has been deleted. The regression is guarded instead by
`V2OperationalConfigurationTest::test_no_schema_identifier_exceeds_the_64_character_limit_of_the_deployment_engine`,
which walks every table, index and foreign key name after migrating and fails on
anything over 64 characters. It runs on **both** lanes, including SQLite, where
an over-long identifier is otherwise completely invisible - a strictly wider net
than the deleted script's exact-string match, and one that cannot break the
image build over a harmless reformat.

Related: MariaDB has **no transactional DDL**. When this migration fails
part-way it leaves `student_batches` and friends created but the `migrations`
row unwritten, so the next attempt fails with `1050 Table already exists` and
masks the original error. Re-running a failed migration is not safe here the way
it is on SQLite; you must `docker compose down -v`.

### 2. The `backend-mariadb` CI job cannot install its dependencies

`.github/workflows/ci.yml` pins `php-version: '8.3'`, but `backend/composer.lock`
locks 17 packages (`symfony/console`, `symfony/http-kernel`, … ) whose
`require.php` is `>=8.4.1`. `composer install` from that lock file is impossible
on 8.3, independently of defect 1. This stack therefore runs **PHP 8.4**. See
gap 8 below.

### 3. `MariaDbConcurrencyRegressionTest` has a broken teardown

With defect 1 patched the test finally runs (14 assertions) and **all three
concurrency scenarios pass** - MariaDB serialisation behaviour is correct. It
then errors in its own `finally` block, at `removeCommittedFixtures()`:

```
SQLSTATE[23000]: 1451 Cannot delete or update a parent row: a foreign key
constraint fails (`mesay_test`.`admin_audit_logs`,
CONSTRAINT `admin_audit_logs_user_id_foreign` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`))
```

The workers write `admin_audit_logs` rows referencing the fixture admin, but
`removeCommittedFixtures()` never deletes them before deleting the users. Since
`$connectionsToTransact = []`, nothing rolls this back. The test needs an
`AdminAuditLog::query()->whereIn('user_id', $this->testUserIds)->delete();`
before the `User` delete. **The regression being guarded passes; the guard's
cleanup does not.** This was invisible for as long as the test skipped.

---

## Services

| Service | Image | What it is | Mirrors |
|---|---|---|---|
| `db` | `mariadb:11.4` | The application database. Slow-query log on, `long_query_time=0.5`, `log_queries_not_using_indexes`, `performance_schema=ON`. | MariaDB on the department server; version matches the `backend-mariadb` CI job |
| `app` | built, target `app` | PHP-FPM **8.4** (8.3 is impossible - see gap 8). Runs migrations, seeds, builds config/route/view caches, then serves FastCGI on 9000. | `php8.3-fpm` + the `deploy.sh` bootstrap order |
| `web` | built, target `web` | nginx. Serves the **built** SPA from `/opt/imreport/current/dist` and proxies `/api` + `/sanctum` to `app:9000` on the same origin. TLS on 443. | `deploy/nginx.conf` |
| `queue` | built, target `app` | `php artisan queue:work --tries=3 --backoff=10 --max-time=3600`, `restart: unless-stopped`. | `deploy/queue-worker.service` (`QUEUE_WORKER_MODE=daemon`) |
| `scheduler` | built, target `app` | `php artisan schedule:work`. | the `* * * * * ... schedule:run` cron line in `deploy/README.md` step 9 |
| `testdb` | `mariadb:11.4` | Throwaway MariaDB for the test lane, on tmpfs. Profile `test`. | the `mariadb` service in `.github/workflows/ci.yml` |
| `test` | built, target `test` | PHP CLI **with dev dependencies**, runs `phpunit --configuration phpunit.mariadb.xml`. Profile `test`. | the `backend-mariadb` CI job |

Startup order is enforced with healthchecks, not sleeps:
`db` healthy → `app` (migrate + seed + cache, then FPM listens) → `app` healthy →
`web`, `queue`, `scheduler`.

---

## Ports

| Host port | Goes to | Notes |
|---|---|---|
| `127.0.0.1:8080` | nginx :80 | Returns **301 → `https://localhost:8443`**, exactly like production |
| `127.0.0.1:8443` | nginx :443 | The real vhost. Self-signed certificate → use `curl -k` / accept the browser warning |
| `127.0.0.1:33306` | MariaDB :3306 | For `EXPLAIN`, `SHOW ENGINE INNODB STATUS`, slow-log inspection |

Nothing binds `5173` or `8000`. All published ports are bound to `127.0.0.1`
only, so the stack is not reachable from the LAN.

---

## Commands

Run everything from the **repo root**.

```bash
# Start (first run builds; expect several minutes for npm ci + composer install)
docker compose up -d --build

# Status / health
docker compose ps

# Logs
docker compose logs -f app
docker compose logs -f web queue scheduler

# Stop, keep the database
docker compose down

# Stop and DESTROY the stack database and storage volume (safe: it is disposable)
docker compose down -v

# Rebuild after a code change (the SPA bundle and vendor tree are baked in)
docker compose build --no-cache app web && docker compose up -d

# Full reset from scratch
docker compose down -v && docker compose up -d --build

# An artisan shell inside the containerised app
docker compose exec app php artisan about
docker compose exec app php artisan tinker

# A read-only SQL shell
docker compose exec db mariadb -uimreport -plocal-parity-stack imreport -e "SHOW TABLES;"
```

### Smoke check

```bash
curl -sI  http://localhost:8080/                       # 301 -> https://localhost:8443/
curl -skI https://localhost:8443/                      # 200, SPA shell
curl -skI https://localhost:8443/sanctum/csrf-cookie    # 204 + XSRF-TOKEN + session cookie
curl -sk  -o /dev/null -w '%{http_code}\n' https://localhost:8443/api/workspace   # 401 (auth wall)
```

### Login (same handshake the SPA performs)

The credential field is **`identifier`** (not `login`), and it accepts either the
email or the username. The password is in
`backend/database/seeders/DevUserSeeder.php`.

```bash
JAR=$(mktemp)
curl -sk -c "$JAR" -o /dev/null https://localhost:8443/sanctum/csrf-cookie
TOKEN=$(awk '/XSRF-TOKEN/{print $7}' "$JAR" | sed 's/%3D/=/g')

curl -sk -b "$JAR" -c "$JAR" \
  -H "X-XSRF-TOKEN: $TOKEN" \
  -H "Origin: https://localhost:8443" \
  -H "Content-Type: application/json" -H "Accept: application/json" \
  -d '{"identifier":"admin@stpaulos.local","password":"<see DevUserSeeder.php>"}' \
  https://localhost:8443/api/auth/login

# Every subsequent authenticated call MUST carry Origin (or Referer).
# Sanctum's EnsureFrontendRequestsAreStateful only treats a request as
# session-authenticated when it matches SANCTUM_STATEFUL_DOMAINS; without the
# header the same valid cookie yields 401. The SPA always sends it; curl does not.
TOKEN=$(awk '/XSRF-TOKEN/{print $7}' "$JAR" | sed 's/%3D/=/g')
curl -sk -b "$JAR" -H "Origin: https://localhost:8443" \
  -H "X-XSRF-TOKEN: $TOKEN" -H "Accept: application/json" \
  https://localhost:8443/api/auth/me
```

---

## Seeding and accounts

`DevUserSeeder`, `DevClinicalDataSeeder` and `DevAcademicDataSeeder` all
self-guard with `app()->environment('production', 'testing')` and would no-op
against this stack, leaving a fully production-shaped app with reference data
and **no login and no measurable data volume**.

So the entrypoint runs the **seed step only** with `APP_ENV=local`:

```bash
APP_ENV=local php artisan db:seed --force
```

The application process itself still runs as `APP_ENV=production` /
`APP_DEBUG=false`; only that one command sees `local`. Controlled by
`STACK_SEED_DEV_DATA=true` in `.env.docker`.

Set `STACK_SEED_DEV_DATA=false` for a strictly production-shaped database. In
that case provision an account the production way instead, which is what
`deploy/README.md` prescribes:

```bash
docker compose exec app php artisan app:create-superadmin \
  --email=ops@example.test --username=opsadmin --full-name="Stack Operator"
```

(omit `--password` and it prints a generated one, flagged
`password_change_required`). The entrypoint will do this automatically if you
set `STACK_SUPERADMIN_EMAIL` and `STACK_SUPERADMIN_PASSWORD` in the env file.

---

## The MariaDB test lane

`backend/tests/Feature/MariaDbConcurrencyRegressionTest.php` starts with:

```php
if (DB::connection()->getDriverName() !== 'mariadb') {
    $this->markTestSkipped('True parallel locking regression runs only in the MariaDB CI lane.');
}
```

`backend/phpunit.mariadb.xml` pins the connection with `force="true"`:
`DB_HOST=127.0.0.1`, `DB_DATABASE=mesay_test`, `DB_USERNAME=mesay`. Those cannot
be overridden from the environment, so the `test` service joins the `testdb`
container's network namespace (`network_mode: "service:testdb"`) — that makes
`127.0.0.1:3306` the MariaDB server without editing a single application file.

```bash
# Just the concurrency regression (this is the test that skips on the dev lane)
docker compose --profile test run --rm test --filter MariaDbConcurrencyRegressionTest

# The whole backend suite against MariaDB
docker compose --profile test run --rm test

# Tear the test database down
docker compose --profile test down -v
```

The suite uses `RefreshDatabase` (`migrate:fresh`), which is exactly why it gets
its own server: pointing it at `db` would drop every table in the parity
database.

### Measured outcome

`MariaDbConcurrencyRegressionTest` **runs here — it no longer skips.** That is
the headline: on the SQLite lane the suite reports `281 tests, 280 passed,
1 skipped`; here it reports **281 tests, 0 skipped**.

The full suite against MariaDB is **not green**: `Tests: 281, Assertions: 1874,
Errors: 3, Failures: 7`. Those ten are *not* stack misconfiguration — they are
real SQLite-vs-MariaDB behavioural differences the dev lane hides, and each is
worth an audit finding. The two clearest classes:

* **UUID column type strictness — 7 of the 10 failures, one root cause.**
  `admin_audit_logs.entity_id` is declared `$table->uuid('entity_id')` in
  `backend/database/migrations/2026_05_25_180140_create_admin_audit_logs_table.php:17`,
  which on MariaDB 10.7+ is a **native 16-byte UUID type**. But
  `backend/app/Http/Controllers/Api/Admin/DutyRosterController.php:198-202`
  records the audit entry with

  ```php
  $this->auditService->record($request->user(), 'save_roster_month', 'duty_roster',
      sprintf('%04d-%02d', $year, $month), ...);   // => '2026-07'
  ```

  a **month string** as the entity id. MariaDB rejects it outright:
  `SQLSTATE[22007]: 1292 Incorrect uuid value: '2026-07'`. On SQLite `uuid()` is
  just `TEXT`, so any string fits and the dev lane never notices.

  This is a **production bug, not a test bug**: saving a duty roster month
  raises a 500 on the real database. Either widen the column to a string, or
  give the roster-month audit entry a null `entity_id` and keep the period in
  `new_values`.
* **Result-ordering and test-isolation assumptions.** e.g.
  `WorkspaceApiTest` expects 3 rows and gets 6. Queries without an explicit
  `ORDER BY` return rows in whatever order the engine chooses, and SQLite's
  choice is not MariaDB's.

Treat "the suite passes locally" as meaningless for these paths until they are
re-run here.

---

## Response headers (only observable here)

`artisan serve` is plain HTTP with no nginx, so none of this is visible on the
dev lane. Captured from the running stack:

```bash
curl -sSkI https://localhost:8443/                      # SPA shell
curl -sSkI https://localhost:8443/assets/<hashed>.js    # immutable asset
curl -sSk -D - -o /dev/null https://localhost:8443/sanctum/csrf-cookie
curl -sSkI https://localhost:8443/api/workspace         # API (401)
```

**Cookie flags are correct** and can only be confirmed under real HTTPS:

```
Set-Cookie: XSRF-TOKEN=…;                    path=/; secure; samesite=lax
Set-Cookie: st-paul-reporting-api-session=…; path=/; secure; httponly; samesite=lax
```

**API responses** carry the full app-middleware set: `Strict-Transport-Security:
max-age=31536000; includeSubDomains`, a `Content-Security-Policy`
(`default-src 'self'; …; frame-ancestors 'none'; object-src 'none'`),
`Permissions-Policy`, and `Access-Control-Allow-Origin: https://localhost:8443`
with `Allow-Credentials: true`.

Three header defects fall straight out of the dump:

1. **The HTML document gets no CSP and no HSTS.** `/` and `/assets/*` are served
   by nginx directly and receive only nginx's three `add_header` lines. CSP and
   HSTS are set by Laravel middleware, so they appear **only on `/api` and
   `/sanctum` responses**. The document that actually loads and executes the
   application's scripts is unprotected by CSP, and a browser that visits the
   SPA and never calls the API is never told to pin HTTPS. Both belong in the
   nginx server block (or in a location that covers `/`).
2. **`Referrer-Policy` is emitted twice with conflicting values** on API
   responses: `strict-origin-when-cross-origin` (Laravel) and `same-origin`
   (nginx `add_header … always`). `X-Content-Type-Options` and `X-Frame-Options`
   are likewise duplicated. Duplicate security headers with different values are
   ambiguous and a real finding - `deploy/nginx.conf` and the app middleware
   both set them, unaware of each other.
3. **`Cache-Control` is emitted twice on hashed assets** - `max-age=2592000`
   from `expires 30d` plus `public, immutable` from `add_header`. Use
   `add_header Cache-Control "public, max-age=2592000, immutable"` alone.

Points 2 and 3 are inherited directly from `deploy/nginx.conf`, so they apply to
the department server as written, not just to this container.

---

## How this lane differs from real production

Be explicit about these when writing audit findings — a result from this stack is
only as good as the gap list below.

**Deliberate deviations**

1. **TLS is a self-signed certificate for `CN=localhost`**, generated at image
   build time. Production uses a Hospital IT internal-CA certificate at
   `/etc/imreport/tls`. Certificate chain, OCSP, cipher policy and renewal are
   therefore *not* audited here — only that HTTPS is on, HSTS is emitted, and
   cookies carry `Secure`.
2. **PHP-FPM listens on TCP `app:9000`**, not the unix socket
   `/run/php/php8.3-fpm.sock` used by `deploy/nginx.conf`. Containers cannot
   share that socket.
3. **No systemd.** The queue worker is a container with `restart: unless-stopped`
   instead of `Restart=always` under `imreport-queue.service`, and the scheduler
   is `schedule:work` instead of a cron tick. `app:launch-readiness` checks that
   inspect `systemctl` will fail here; that is expected, not a finding.
4. **No release directory / atomic switch.** `deploy.sh` builds an immutable
   release under `/opt/imreport/releases/` and flips a `current` symlink. Here
   the code is baked into the image, so rollback, the deploy lock, the
   pre-migration backup and the automatic restore path are **not exercised**.
5. **No backups.** `deploy/backup.sh`, the 02:00 cron, retention, the secondary
   copy and the restore drill are absent. `BACKUP_RESTORE_VERIFIED_AT` is unset,
   so the strict readiness backup checks cannot pass.
6. **No logrotate / UFW.** `deploy/logrotate.conf` and `deploy/ufw.sh` have no
   container equivalent. Logs go to container stdout.
7. **Seed step runs as `APP_ENV=local`** (see above). Production would never do
   this; a real server has no dev accounts at all.
8. **PHP 8.4, NOT the 8.3 the deploy kit specifies.** This is a deviation the
   stack was forced into, and it is an audit finding in its own right:
   `backend/composer.lock` pins `symfony/console` v8.1.1 and 17 sibling Symfony
   components whose `require.php` is `">=8.4.1"`, so `composer install` from
   that lock file **cannot run on PHP 8.3**. Everything that names 8.3 is stale:
   `deploy/README.md` step 1, `deploy/nginx.conf`
   (`fastcgi_pass unix:/run/php/php8.3-fpm.sock`), `deploy/deploy.sh`
   (`systemctl reload php8.3-fpm`), `docs/OPERATIONS.md`, and the
   `php-version: '8.3'` in all three `.github/workflows/ci.yml` PHP jobs.
   `backend/composer.json` also still declares `"php": "^8.3"`.
   Build with `--build-arg PHP_VERSION=8.3` to reproduce the failure.
9. **`VITE_API_BASE_URL` is baked at build time** as `https://localhost:8443`
   (`src/lib/api/env.ts` has no runtime fallback). Change the published port and
   you must rebuild `web` with a matching build arg *and* update
   `APP_URL` / `SANCTUM_STATEFUL_DOMAINS` / `CORS_ALLOWED_ORIGINS` in
   `.env.docker`.

**Environmental differences**

10. **Single host, single MariaDB, no LAN.** Everything is loopback-bound on one
    machine; network latency, LAN MTU, hospital DNS and the real client
    population are absent. Absolute throughput numbers are not transferable —
    *relative* numbers (with/without an index, N concurrent writers) are.
11. **Docker Desktop resource limits** (CPU, RAM, and on Windows the WSL2 VM's
    disk I/O) bound every performance measurement. The department server's disk
    is not this disk.
12. **`innodb_buffer_pool_size=256M`** here. Size it to the real server before
    quoting any cache-hit ratio.
13. **No Reverb.** `BROADCAST_CONNECTION=log`, as in `backend/.env.example`.
    WebSocket behaviour is not covered.
14. **Mail and SMS are `log` drivers.** Nothing is delivered; queue jobs
    "succeed" without touching a gateway.

---

## Files

```
compose.yaml                 the stack
.dockerignore                keeps host .env files and the dev SQLite DB out of images
docker/Dockerfile            frontend / php-base / vendor-prod / app / test / web stages
docker/nginx.conf            deploy/nginx.conf adapted for containers
docker/entrypoint.sh         wait-for-db, migrate, seed, cache, then exec
docker/run-mariadb-tests.sh  the test-lane wrapper (ENTRYPOINT, so args reach phpunit)
docker/php/php.ini           production-shaped PHP (opcache on, display_errors off)
docker/php/www.conf          FPM pool: TCP 9000, clear_env=no, slowlog at 5s
.env.docker               production-shaped env for the CONTAINERS ONLY
```

`.env.docker` is a local test file. Its `APP_KEY` and `DB_PASSWORD` are
deliberate throwaway placeholders for a disposable container database — never
reuse them anywhere that holds real data, and never copy this file to a server.
