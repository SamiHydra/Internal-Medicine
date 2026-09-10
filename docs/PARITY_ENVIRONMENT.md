# Parity environment

One documented procedure that produces a production-shaped environment on any
developer machine, and an honest list of where it still differs from the
hospital host. Everything in `docs/CAPACITY_TEST_REPORT.md`,
`docs/FAILURE_RECOVERY_TEST_REPORT.md` and `docs/LARGE_DATA_REHEARSAL.md` was
measured here.

Status date: 2026-09-07. Definition: `compose.yaml`, `docker/Dockerfile`,
`docker/nginx.conf`, `docker/php/*`, `docker/entrypoint.sh`, `.env.docker`.
Background and the defects this lane has already caught: `docker/README.md`.

## 1. What it gives you

| Piece | Parity stack | Hospital host (`deploy/`) | Same? |
|---|---|---|---|
| Operating system | Debian bookworm containers on Linux (WSL2 or native) | Ubuntu Server | Same family, same libc |
| Web server | nginx 1.27, TLS 1.2/1.3, HTTP/2, HSTS, CSP, the security-header map | nginx, `deploy/nginx.conf` | Same configuration shape; the header block and cache map are byte-identical by design |
| Application runtime | PHP-FPM 8.3.33, OPcache on (`validate_timestamps=0`), `memory_limit=256M`, `pm=dynamic` 4 to 20 children, slow log | PHP-FPM 8.3, `deploy/php-fpm.conf` | Same version and process manager |
| Database | MariaDB 11.4, utf8mb4, `max_connections=151`, `innodb_buffer_pool_size=256M`, slow-query log on | MariaDB 11.4 | Same major version and charset |
| Frontend | the production bundle (`npm run build`) served as static files | the same bundle built by `deploy.sh` | Same |
| Laravel config | `APP_ENV=production`, `APP_DEBUG=false`, config/route/view caches built before serving | same | Same |
| Sessions, cache, queue | all on the database (no Redis) | same | Same |
| Workers | `queue --queue=analytics,default` and `queue-notifications --queue=notifications,default`, both as `www-data`, restart on failure | the two systemd units | Same queues, same user, container restart instead of systemd |
| Scheduler | `php artisan schedule:work` | `schedule:run` from cron every minute | Same commands, same minute cadence |
| Storage | a named volume mounted at `backend/storage` | `shared/storage` bind-mounted into each release | Same layout, same ownership |
| Health | `/up` routed to Laravel through nginx | same | Same |
| Release identity | `release.json` baked at image build (`RELEASE_SHA` build argument) | `release.json` written by `deploy.sh` | Same file, same reader |

## 2. Deliberate differences

None of these invalidate a measurement, but each one is a reason a number here
is not a production number.

| Difference | Why | What it affects |
|---|---|---|
| FastCGI over TCP `app:9000` instead of the unix socket `/run/php/php8.3-fpm.sock` | containers cannot share a unix socket across service boundaries | a small constant latency, nothing structural |
| Self-signed certificate for `CN=localhost` | there is no Hospital IT internal CA here | the browser shows a warning, and the service worker refuses to register (it demands a trusted certificate). Four navigation specs report that console error against this stack by design |
| `/fpm-status` and `/fpm-ping` are exposed to the container's loopback only | the capacity and chaos telemetry read the pool state | not present in `deploy/nginx.conf`; do not add it there without an access rule |
| Workers and the scheduler are containers with `restart: unless-stopped` | there is no systemd inside | `app:launch-readiness --strict` cannot check `systemctl is-active` and reports those two checks as warnings |
| The seed step runs as `APP_ENV=local` (`STACK_SEED_DEV_DATA=true`) while the app runs as production | `Dev*Seeder` refuses to run in production, and an empty database measures nothing | the data is the development fixture, not hospital data |
| `MIN_FREE_DISK_GB=1`, backups never taken | the container has no backup cron | the backup and disk readiness checks warn here; they are real on the host |
| Mail and SMS are the `log` driver | no hospital SMTP or SMS credentials | delivery is proven by rendering the message in the worker log, not by a received e-mail |
| No `cron`, no `logrotate`, no `ufw` | provided by the host image | `deploy/logrotate.conf` and `deploy/ufw.sh` are reviewed, not exercised |
| Restarting a container re-runs the entrypoint (migrate, seed, cache build) | that is how the image boots | container "restart" takes 2 to 3 minutes here; `systemctl restart php8.3-fpm` on the host takes seconds. Recovery times in the failure report carry that caveat |
| Ports are published on `127.0.0.1:8443` / `:8080` | keeps the stack off the LAN | if those ports are reserved on your machine, publish others with an override file (see below) |
| One machine hosts nginx, PHP-FPM, MariaDB, both workers and the scheduler | it is one Docker engine | at high load they compete for the same CPUs, which the hospital's single server also does |
| nginx resolves `fastcgi_pass app:9000` once, at startup | container DNS, not a configuration choice | **recreating the `app` container gives it a new address and nginx keeps answering 502 against the old one: restart `web` after any `docker compose up --build` or restart of `app`.** Production reaches PHP-FPM over a unix socket and has no equivalent problem |

## 3. Bringing it up

```bash
# From the repository root. RELEASE_SHA stamps the images so the health view,
# the logs and the SPA all name the build under test.
RELEASE_SHA=$(git rev-parse --short=12 HEAD) docker compose up -d --build

# Wait for health, then check it end to end
curl -sk -o /dev/null -w '%{http_code}\n' https://localhost:8443/up          # 200
curl -sk -o /dev/null -w '%{http_code}\n' https://localhost:8443/api/workspace # 401
docker compose exec app php artisan app:launch-readiness

# Sign in at https://localhost:8443 (accept the self-signed certificate):
#   admin@stpaulos.local / StPaul2026!   (Maintenance)
#   abel.gemechu@stpaulhospital.demo     (nurse)
#   rediet.bekele@stpaulhospital.demo    (resident)
#   chaltu.tesfaye@stpaulhospital.demo   (consultant)
#   student.rep.group@stpaulos.local     (student representative)
```

The MariaDB test lane is a separate, throwaway server so the suite's
`migrate:fresh` never touches the parity database:

```bash
docker compose --profile test run --build --rm test          # the whole suite
docker compose --profile test run --build --rm test --filter ReportWorkflowTest
```

Pass `--build`, always: without it `compose run` reuses whatever image is
cached and you test old code.

If the stack answers 502 after a rebuild, restart the web tier
(`docker compose restart web`): see the nginx row in the table above.

Tear down, keeping the data: `docker compose down`. Start again from nothing:
`docker compose down -v` (MariaDB has no transactional DDL, so a migration
that fails half way is only recoverable this way).

### If ports 8443 or 8080 are taken

Some Windows machines reserve them. Write `compose.override.yaml`:

```yaml
services:
  web:
    ports: !override
      - "127.0.0.1:9080:80"
      - "127.0.0.1:9443:443"
    build:
      args:
        VITE_API_BASE_URL: "https://localhost:9443"
  app:
    environment:
      APP_URL: "https://localhost:9443"
      FRONTEND_URL: "https://localhost:9443"
      SANCTUM_STATEFUL_DOMAINS: "localhost:9443,127.0.0.1:9443"
      CORS_ALLOWED_ORIGINS: "https://localhost:9443"
```

`ports:` needs `!override` or compose merges the two lists and publishes both.
The API origin is baked into the bundle at build time, so a port change needs
`--build`.

## 4. Running the gates against it

| Gate | Command |
|---|---|
| Full browser suite on the production bundle | `E2E_BASE_URL=https://localhost:8443 npx playwright test --config playwright.external.config.ts` |
| Capacity stages | `scripts/capacity/run-stages.sh 25 50 100 200 300` (see `docs/CAPACITY_TEST_REPORT.md` for the account setup) |
| Failure drills | `scripts/chaos/run-failure-drills.sh` |
| Rollback rehearsal | `scripts/chaos/rollback-rehearsal.sh` (its own throwaway container) |
| Production smoke suite | `SMOKE_BASE_URL=https://localhost:8443 npm run test:smoke` |
| Backup and restore drill | `docs/OPERATIONS.md`, executed inside the `app` container |

Known, expected failures when the full browser suite runs against this stack
rather than the isolated gate: the registration specs hit the real 10/min
limiter (the isolated gate resets it through a local-only endpoint that does
not exist in production), and four navigation specs record the service-worker
console error caused by the self-signed certificate. Both are environment
differences, not defects.

## 5. Keeping parity honest

When `deploy/` changes, change the parity stack in the same commit:

| If you change | Also change |
|---|---|
| `deploy/nginx.conf` header, cache or location blocks | `docker/nginx.conf` (the header block and cache map are meant to be identical) |
| `deploy/php-fpm.conf` limits | `docker/php/php.ini` and `docker/php/www.conf` |
| `deploy/queue-worker.service` queues or flags | the `queue` and `queue-notifications` commands in `compose.yaml` |
| the cron lines in `deploy/README.md` | the `scheduler` service command |
| `deploy/deploy.sh` ordering | `docker/entrypoint.sh`, and re-run `scripts/chaos/rollback-rehearsal.sh` |
| the PHP or MariaDB version anywhere | `docker/Dockerfile` build args, `compose.yaml` images, and `.github/workflows/ci.yml` |

`V2OperationalConfigurationTest` already asserts the deployment script's
ordering and that no schema identifier exceeds MariaDB's 64-character limit, on
both database lanes.
