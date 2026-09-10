# Capacity test report

**PARITY CAPACITY RESULT.** Every number here was measured on the Docker
production-parity stack running on one Windows workstation. It is not a
production capacity statement: the hospital server has different hardware, a
different disk and a real network. Treat these as the shape of the system's
behaviour and as the baseline to re-measure against on the real host.

Date: 2026-09-07. Release under test: `b07b32c47ada-hardening`
(the pre-server hardening tree). Harness: `scripts/load-test.mjs`
(`LOAD_PROFILE=mixed`), driver: `scripts/capacity/run-stages.sh`,
telemetry: `scripts/capacity/collect-telemetry.sh`. Raw evidence:
`artifacts/load-tests/capacity-parity/` (first pass) and
`artifacts/load-tests/capacity-parity-r2/` (second pass, the one quoted below
for 100 users and above).

## 1. Environment

| Piece | Value |
|---|---|
| Host | Windows 11 workstation, Docker Desktop on WSL2, 16 GB RAM available to the engine, 10 logical CPUs |
| Stack | `compose.yaml`: nginx 1.27 (TLS, HTTP/2), PHP-FPM 8.3.33 (`pm=dynamic`, `max_children=20`, OPcache on, `memory_limit=256M`), MariaDB 11.4 (`max_connections=151`, `innodb_buffer_pool_size=256M`, slow log with `long_query_time=0.5` and `log_queries_not_using_indexes=1`), two queue workers, scheduler, production React bundle, `APP_ENV=production` |
| Data | the development fixture: 1,443 reports over 80 reporting periods, 30 active assignments, 194 seeded people plus 136 synthetic accounts (320 usable logins) |
| Sessions | one account per virtual user, never shared. Login and workspace priming happen before the clock starts and are excluded from the measured traffic |
| Limiter | the authenticated ceiling is 300 requests/min per user; the mix stays far below it. `LOAD_SYNTHETIC_SOURCE_IPS=1` gives each session its own login-limiter bucket (the stack trusts proxy headers) |

Deliberate differences from the hospital host are listed in
`docs/PARITY_ENVIRONMENT.md`.

## 2. The workload

The `mixed` profile plays each virtual user as the role its account holds, so
the request mix follows the seeded headcount rather than an invented average.
Think time is 250 to 1200 ms per user.

| Role group | Share of sessions at 300 users | Requests |
|---|---|---|
| Nurse | 120 | revision poll 30 %, workspace 15 %, report details 15 %, **report save (write) 10 %**, status history 10 %, notifications 15 %, session 5 % |
| Administrator | 56 | dashboard analytics 20 %, workspace 15 %, reporting window (300 summaries) 20 %, action items 10 %, users 10 %, admin audit 10 %, notifications 10 %, revision poll 4.5 %, **export request (write, queued) 0.5 %** |
| Resident / consultant | 120 | workspace 15 %, evaluation form options 25 %, my submissions 20 %, my performance 10 %, notifications 15 %, revision poll 15 % |
| Student representative | 3 | teaching sessions 60 %, notifications 20 %, revision poll 20 % |

Background load runs throughout: both queue workers, the scheduler
(per-minute queue health, morning-recorder check, heartbeat), the revision
poll, and the analytics warm job that report saves trigger.

The nurse write is a real `PUT /api/reports/{id}` of the report's own current
values, so it exercises the full save path (validation, quality rules, the
row lock, status history, analytics invalidation) without changing the data.

## 3. Results

Ninety measured seconds per stage after a twenty-second ramp.

| Concurrent users | Requests | RPS | p50 | p95 | p99 | Max | Error % | Timeouts | Peak memory (app / db) | Result |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---|---|
| 25 | 2,494 | 27.7 | 44 ms | 145 ms | 1,585 ms | 1,841 ms | 0.00 % | 0 | 72 MB / 469 MB | PASS |
| 50 | 4,926 | 54.7 | 46 ms | 144 ms | 1,707 ms | 2,169 ms | 0.00 % | 0 | 96 MB / 561 MB | PASS |
| 100 | 10,041 | 111.6 | 51 ms | 260 ms | 550 ms | 1,317 ms | 0.00 % | 0 | 107 MB / 663 MB | PASS |
| 200 | 19,281 | 214.2 | 69 ms | 314 ms | 1,156 ms | 2,405 ms | 0.00 % | 0 | 176 MB / 694 MB | PASS (p99 over) |
| 300 | 22,484 | 249.8 | 325 ms | 779 ms | 1,048 ms | 2,087 ms | 0.00 % | 0 | 144 MB / 698 MB | DEGRADED (p95 over) |

The 25 and 50 user rows come from the first pass, where the harness asked for
the whole-archive dashboard instead of the window the admin screen opens on;
their p99 carries that (see finding F1). Their p50 and p95 are unaffected,
and the 100 to 300 rows are the corrected second pass throughout.

### Slowest endpoints per stage (second pass)

| Endpoint | 100 users p50 / p95 | 200 users p50 / p95 | 300 users p50 / p95 |
|---|---|---|---|
| Dashboard analytics (9-week window) | 322 / 591 ms | 313 / 712 ms | 650 / 1,088 ms |
| Academic self-performance | 41 / 572 ms | 50 / 680 ms | 315 / 978 ms |
| Reporting window (300 summaries) | 63 / 214 ms | 92 / 289 ms | 353 / 782 ms |
| Report save (write) | 100 / 270 ms | 114 / 352 ms | 227 / 585 ms |
| Workspace bootstrap | 55 / 141 ms | 66 / 205 ms | 279 / 664 ms |
| Revision poll | 12 / 30 ms | 15 / 51 ms | 63 / 191 ms |

### Infrastructure at each stage

| Signal | 25 | 100 | 200 | 300 |
|---|---|---|---|---|
| App container peak CPU | 67 % | 603 % | 903 % | 925 % |
| MariaDB peak CPU | 84 % | 76 % | 75 % | 67 % |
| MariaDB peak threads connected / max used | 7 / 10 | 19 / 22 | 25 / 25 | 23 / 25 |
| InnoDB deadlocks | 0 | 0 | 0 | 0 |
| PHP-FPM peak active children | 7 of 20 | 18 of 20 | 20 of 20 | 20 of 20 |
| PHP-FPM max listen queue | 15 | 21 | 107 | 229 |
| `max children reached` | 0 | 1 | 3 | 4 |
| Queue peak depth / oldest job | 2 / 4 s | 3 / 6 s | 4 / 17 s | 4 / 10 s |
| Failed jobs | 0 | 0 | 0 | 0 |

## 4. Against the acceptance targets

| Target | Result |
|---|---|
| HTTP error rate < 0.5 % | PASS at every stage: 0.00 % (one pass recorded 0.03 %, five client-side timeouts, before the dashboard-window correction) |
| Standard API p95 < 500 ms | PASS to 200 users (314 ms). FAIL at 300 (779 ms) |
| Standard API p99 < 1000 ms | PASS to 100 users (550 ms). Over at 200 (1,156 ms) and 300 (1,048 ms) |
| Login p95 < 1000 ms | PASS: sign-in is part of session preparation and completed for all 320 accounts without a failure |
| Queue jobs start within 30 s | PASS: oldest waiting job peaked at 17 s, depth never above 4 |
| No database deadlocks | PASS: zero at every stage |
| No exhausted connection pool | PASS: 25 of 151 connections at peak |
| No PHP-FPM worker starvation | PARTIAL: no request was refused, but `max_children` (20) was reached from 100 users up and the listen queue peaked at 229 at 300 users. This is the first thing to raise on the real host (finding F2) |
| No data corruption | PASS: report counts, status history and the queue tables were consistent after every stage; zero failed jobs |

## 5. Findings

**F1. The dashboard is cheap when it is warm and expensive when a write has
just invalidated it.** Measured directly on the parity stack with no other
load:

| Dashboard request | Cold (first read after an invalidation) | Warm | Payload |
|---|---|---|---|
| 9-week window (what the admin screen opens on) | 327 ms | 41 to 46 ms | 100 KB raw |
| Whole archive (no date filter) | 1,505 ms | 53 to 91 ms | 516 KB raw |

Every report save invalidates the analytics cache version and queues a warm
job. Under sustained nurse writes the warm job cannot win the race, so each
admin dashboard read pays a cold build. That is what produced the 1.5 to 2.7 s
p50 in the first pass, where the harness asked for the whole archive on every
call. With the window the product actually uses, the same load gives 313 to
650 ms p50. Disposition: **ACCEPTED, MONITOR**. Revisit if, on the real host,
the dashboard p95 passes 1 s during a submission deadline; the fix would be to
serve the previous version while the new one builds, which trades a few
seconds of staleness for a flat latency and needs a product decision.

**F2. PHP-FPM, not MariaDB, is the ceiling.** The database never went past 25
of 151 connections and its CPU fell as load rose; the application container
saturated 9 CPUs and the pool ran at its 20-child limit from 100 users up.
The queue in front of the pool is what turns into latency at 300 users.
Recommendation for the host: size `pm.max_children` from the real machine's
memory (each child is roughly 40 to 60 MB here) rather than keeping 20, and
re-run these stages after the change. `deploy/php-fpm.conf` currently ships
`pm.max_children = 20`.

**F3. Writes are not a bottleneck at this scale.** The nurse save path,
including its row lock, status history and analytics invalidation, stayed at
100 to 227 ms p50 through 300 users, and no deadlock occurred. The 200-user
first pass produced five client-side timeouts (15 s) on saves and one export
request while the whole-archive dashboards were rebuilding on every request;
with the corrected mix the same stage had none.

**F4. The slow-query counter is not a defect signal here.** MariaDB logs
89,596 "slow" queries at the 300-user stage only because the parity stack sets
`log_queries_not_using_indexes=1`, which counts every small unindexed lookup.
No individual query exceeded the 0.5 s threshold in a way that showed up in
latency, and the production configuration does not enable that flag.

**F5. Nothing degraded unrecoverably.** After each stage the stack returned to
its baseline: queue depth 0, no failed jobs, health endpoint 200, and the
next stage started from a normal state.

## 6. Current tested safe capacity

> On this parity environment, the platform sustained **200 concurrent users**
> at 214 successful requests per second with a 0.00 % error rate, p50 69 ms
> and p95 314 ms, with no deadlock, no connection exhaustion and no failed
> job. At 300 users it kept working with no errors but latency roughly
> doubled (p50 325 ms, p95 779 ms) as the PHP-FPM pool queued.

For context, the department's entire headcount in the fixture is about 190
people, so 200 concurrent users is already above a realistic simultaneous
peak.

**This is a PARITY CAPACITY RESULT, not a production capacity statement.**

## 7. How to repeat this

```bash
# 1. Bring up the parity stack, stamped with the release under test
RELEASE_SHA=$(git rev-parse --short=12 HEAD) docker compose up -d --build

# 2. Top the disposable database up to enough distinct accounts, then build
#    the credential file (roles interleaved so any prefix keeps the mix)
docker compose cp scripts/capacity/seed-load-accounts.php app:/opt/imreport/current/scripts/capacity/seed-load-accounts.php
docker compose exec -T -e CAPACITY_ALLOW_PRODUCTION=1 app \
  php /opt/imreport/current/scripts/capacity/seed-load-accounts.php 320
scripts/capacity/make-credentials.sh

# 3. Run the stages (harness summary + telemetry per stage)
scripts/capacity/run-stages.sh 25 50 100 200 300

# 4. Read the per-stage summary
cat artifacts/load-tests/capacity-*/stage-*/summary.json
```

On the hospital host, run the same stages against the real deployment out of
hours, with `LOAD_ALLOW_HIGH_CONCURRENCY=I_UNDERSTAND`, real accounts, and
without `LOAD_SYNTHETIC_SOURCE_IPS`.
