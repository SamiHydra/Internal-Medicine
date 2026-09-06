# Production-shaped Docker performance follow-up

**Audit revision:** `3c9a41214d5667d2ebf424b21fd50ef792dc46e3`  
**Evidence captured:** 2026-07-28 to 2026-07-29  
**Scope:** PERF-01, PERF-02, PERF-04, PERF-05, PERF-06, SCALE-01, SCALE-05, SCALE-07 only  
**Path under test:** HTTPS/HTTP/2 Nginx → PHP 8.3 FPM → Laravel → MariaDB 11.4, with database and Redis driver variants

This is the production-shaped follow-up to `PERFORMANCE_AUDIT.md`. It does not repeat frontend, bundle, payload, navigation, Lighthouse, or other settled work. Application source, committed migrations, and committed deployment configuration were not changed. The candidate index exists only in the isolated audit database.

## Environment and limitations

| Item | Value |
|---|---|
| Host | Hasee HBE6S, Intel Core i9-14900HX, 24 cores / 32 logical processors, 31.8 GiB RAM |
| Host OS | Windows 11 Pro 10.0.26200 |
| Docker | Docker Desktop 29.6.1, WSL2 kernel 6.18.33.2 |
| Docker allocation | 32 CPUs, 15.51 GiB RAM |
| Container limits | None: `Memory=0`, `NanoCpus=0`, no CPU quota/cpuset, no PID limit |
| Nginx | 1.27.5, TLS, HTTP/2, gzip level 5, immutable static cache headers |
| PHP/Laravel | PHP 8.3.32 FPM, Laravel 13.20.0 |
| FPM | dynamic, `max_children=20`, start 4, spare 2–6, recycle at 500 requests, 3 s slowlog, 120 s terminate timeout, 256 MiB PHP limit |
| OPcache | enabled; CLI disabled; 192 MiB; 16 MiB interned strings; 20,000 files; timestamps disabled; comments enabled; JIT disabled |
| MariaDB | 11.4.12, named Docker volume, 512 MiB buffer pool, 151 connections, Performance Schema on |
| Slow log | enabled to `mysql.slow_log`, 50 ms threshold |
| Redis | 7.4.10, persistence disabled for the isolated test |
| Queue worker | `php artisan queue:work --tries=3 --backoff=10 --max-time=3600` |

The PHP image reuses the repository's existing PHP 8.3 parity base for its compiled extensions/vendor layer, then deletes and replaces all application source. The audited service source hash was checked against the host revision. MariaDB data uses the named `imreport-audit_mariadb-data` volume, not a Windows bind mount.

These results validate architecture and degradation behavior on Docker-on-dev-laptop. They are not a substitute for the final release gate on hardware comparable to the hospital server.

## Seed and validation

The full chain served authenticated audit-user API requests before measurement. `ANALYZE TABLE` was run on 19 hot tables after seeding.

| Table | Docker rows | Prior-audit target |
|---|---:|---:|
| reporting_periods | 131 | 131 |
| reports | 2,939 | 2,939 |
| report_field_values | 249,554 | 249,554 |
| evaluations | 3,720 | 3,720 |
| evaluation_answers | 35,060 | 35,060 |
| teaching_sessions | 416 | 413 |
| student_attendance | 10,000 | 9,925 |
| morning_sessions | 168 | 167 |
| morning_attendance | 23,520 | 23,380 |
| duty_assignments | 2,100 | 2,100 |
| rotation_blocks | 30 | 30 |

Eight hundred audit-only identities were eventually staged so stress could continue past 500 VUs. Every VU used its own account, cookie jar, and synthetic trusted-proxy source address. The measured standard mix makes roughly 60–90 requests per user per minute, below the API's 300 requests/minute per-user limit. Setup/login/prime traffic is excluded from measured results. The audit harness default is 200 VUs and reports successful RPS separately; the repository harness remains unchanged.

## Delta summary

| ID | Production-shaped result | Disposition |
|---|---|---|
| PERF-01 | Academic cold requests improve to 658–873 ms individually, but three concurrent misses still consume 2.139 FPM worker-seconds and three workers. | **Confirmed, baseline revised.** Consolidate the shared academic graph/snapshot. |
| PERF-02 | All-time clinical cold HTTP rises to 2.94 s while the bounded eight-week slice is about 250 ms. MariaDB uses the existing field-value range index; no missing index explains the gap. | **Confirmed more strongly.** Bound interactive dates and move all-time work off the request path. |
| PERF-04 | MariaDB executes the current revision union in 11.18 ms, slightly faster than SQLite's 15.8 ms, but its fact branches remain linear. | **Revised, not refuted.** Healthy now; keep the revision-ledger replacement as a medium-term scale fix. |
| PERF-05 | MariaDB chooses `(student_id,present)` and improves the warmed aggregate median 47.51%. | **Confirmed.** Ship the tested index. |
| PERF-06 | Database cache/session/queue pass the standard 200-VU gate. Non-persistent Redis fails at 6.62% because the app container exhausts ephemeral ports; the application's existing persistent option removes that failure in follow-up testing. | **Hard Redis requirement refuted.** Redis is optional; persistent connections are required if it is selected for this traffic level. |
| SCALE-01 | The production-shaped database stack sustains 200 VUs for ten minutes at 224.38 successful RPS with zero errors and all endpoint gates passing. | **Revised.** Architecture validated on the dev laptop; hospital-like hardware still needs the final release gate. |
| SCALE-05 | The shared-session/default mismatch is real. Audit-only setup uses one account/session/source IP per VU, a 200-VU default, and successful RPS. | **Confirmed.** Port the audit harness corrections into the repository harness separately. |
| SCALE-07 | Standard 200-VU p95 worker RSS is about 47 MiB, not 256 MiB. The 20-child pool reaches its ceiling but passes the standard gate; PHP CPU/worker capacity, not DB connections or memory, is the observed limit. | **Revised.** Use measured RSS plus safety and DB/CPU caps; do not size from 256 MiB alone. |

## Three decisions

1. **Ship exactly one index migration:** `student_attendance_student_present_index (student_id, present)`. Do not add an all-time field-value index or a second evaluation-answer index; MariaDB evidence does not support either.
2. **Redis is optional, not required, for 200 users on this stack.** Database-backed drivers pass all standard 200-VU gates. If Redis is deployed, set `REDIS_PERSISTENT=true` (or otherwise provide connection reuse/pooling) and validate it; the documented non-persistent shape fails from ephemeral-port exhaustion despite Redis itself remaining healthy.
3. **Keep 20 children as the evidence-backed initial value on a comparable 32-thread host, then calculate per target host.** Use `min(floor(PHP_RAM_budget / (p95_RSS × 1.25)), DB_connection_budget, CPU/load-tested_cap)`. At a 4 GiB PHP budget, the committed 256 MiB assumption yields 16 children; measured 47 MiB RSS with 25% safety yields 69. The DB cap is at most 110 here after reserving 10 connections below the 80%-of-151 gate, but the present CPU/load-tested cap is 20—not 69.

## MariaDB query plans

MariaDB calls its executed JSON plan `ANALYZE FORMAT=JSON`; it is the MariaDB equivalent used here for `EXPLAIN ANALYZE`. Exact SQL, bindings, ordinary `EXPLAIN`, and executed JSON plans are in `docker/audit/evidence/query-plans.json` and `query-plans-raw.txt`.

### PERF-05 — student attendance aggregate

Exact query:

```sql
SELECT student_id,
       COUNT(*) AS expected,
       SUM(CASE WHEN present THEN 1 ELSE 0 END) AS present
FROM student_attendance
GROUP BY student_id;
```

| Evidence | Before candidate | After candidate |
|---|---:|---:|
| Access | full table scan | covering index scan |
| Key | none | `student_attendance_student_present_index` |
| Extra | `Using temporary; Using filesort` | `Using index` |
| Actual rows | 10,000 | 10,000 |
| Pages accessed | 84 | 25 |
| Executed-plan time | 5.19 ms | 2.60 ms |
| 16-sample warmed median | 5.407 ms | 2.838 ms |
| p95 | 9.618 ms | 4.061 ms |

MariaDB chooses the index and the repeat capture shows a 47.51% median improvement. Ship:

```sql
ALTER TABLE student_attendance
  ADD INDEX student_attendance_student_present_index (student_id, present);
```

The index also satisfies the existing `student_id` foreign-key indexing requirement. A migration should account for MariaDB replacing the redundant single-column foreign-key index.

### Query-plan verdict table

| Query | SQLite conclusion | MariaDB plan/evidence | Verdict | Action |
|---|---|---|---|---|
| Student attendance `GROUP BY student_id` | covering session/student index scan plus temporary B-tree | chose new `(student_id,present)` covering index; no temp/filesort; median 5.407 → 2.838 ms | Confirmed missing covering order | Ship the DDL above |
| All-time field-value chunks | bounded-range issue, not proven missing index | range access on `report_field_values_unique`; about 42,400 candidate rows for the slowest chunk; `Using index condition; Using temporary; Using filesort`; 115.51 ms executed plan; 8 chunks; service 2,642 ms but captured warmed DB time 128 ms | Bounded-range/application-work problem, not a missing-index problem | Bound interactive dates; queue/stream all-time export; consider weekly rollups |
| Workspace revision union | 130-step SQLite plan, 15.8 ms now, linear scans | full union 11.18 ms service / 10.63 ms DB; largest branch medians are morning attendance 5.6 ms, student attendance 2.8 ms, reports 1.3 ms | Acceptable now, still linear and multiplied by every polling tab | Keep revision-ledger replacement; it is an efficiency/scaling fix, not an emergency query-index fix |
| Student evaluations `IN` filter | existing index appeared appropriate | range access using `evaluations_form_key_evaluation_date_index`; 1,900 rows; 2.89 ms executed plan | Existing index confirmed | No migration |
| Evaluation answers eager load | existing composite index appeared appropriate | optimizer deliberately scans 35,060 rows because the request selects 32.5% of the table; natural median 42.104 ms; forcing `evaluation_answers_evaluation_id_field_key_unique` is slower at 45.196 ms | Existing index is available but correctly not chosen at this selectivity | No new index; bound the academic time range instead |

### Revision-union growth estimate

Current per-branch warmed medians (ms) are: reports 1.311, assignments 0.480, periods 0.805, notifications 0.355, report templates 0.448, fields 0.563, settings 0.424, current user 0.314, duty assignments 0.991, calendars 0.522, blocks 0.413, transfers 0.282, representatives 0.434, teaching schedules 0.281, teaching sessions 0.618, student attendance 2.777, morning sessions 0.420, morning attendance 5.609, overrides 0.331.

Using the prior audit's annual increments, the scan-dominated fact branches grow roughly 1.8–2.0× after one additional year and 3.5–4.0× after three. A reasoned planning range is therefore about 20–25 ms per poll after one year and 40–50 ms after three, before multiplying by every open admin tab. MariaDB handles the union acceptably at current rows; a single transactional revision row remains the correct long-term shape.

## Official cold/warm baselines

Each cold HTTP sample followed a relevant cache flush through Nginx/TLS/FPM/MariaDB. Warm values are 20-sample percentiles. Query and memory figures come from a separate cold instrumented execution so the ordinary HTTP timing does not include listener serialization overhead.

| Endpoint | Prior SQLite cold | Docker cold total | Warm p50 / p95 | Cold query evidence | Allocation / payload | Interpretation |
|---|---:|---:|---:|---|---|---|
| Academic summary | 881 ms | 669 ms | 30 / 37 ms | 18 queries, 81 ms DB | 30 MiB / 633 B | Faster platform, duplicate graph build remains |
| Academic trend | 1,323 ms | 873 ms | 31 / 35 ms | 12 queries, 96 ms DB | 30 MiB / 1,020 B | Faster but still repeats the academic graph |
| Academic people | 981 ms | 658 ms | 32 / 37 ms | 12 queries, 66 ms DB | 30 MiB / 17,119 B | Faster but same fan-out issue |
| Clinical all-time | 2,192 ms / 895 ms DB | 2,940 ms | 55 / 66 ms | 36 queries, 1,741 ms DB in cold instrumentation | 16 MiB / 1,038,420 B | Slower on cold MariaDB; bounded interactive dates remain required |
| Clinical 8 weeks | 189 ms | 250 ms | 30 / 37 ms | 22 queries, 160 ms DB | 2 MiB peak delta / 80,859 B | Healthy relative to all-time; official scoped baseline is ~250 ms |
| Undergraduate students | 828 ms | 557 ms | 39 / 43 ms | 11 queries, 78 ms DB | 30 MiB / 119,307 B | Improved; time-range/selectivity work still scales linearly |
| Workspace default | 286 ms | 212 ms | 179 / 191 ms | 28 queries, 42 ms DB | <1 MiB net / 224,109 B | Passes current latency gate |
| Workspace all-history | 1,107 ms | 317 ms | 307 / 329 ms | 34 queries, 64 ms DB | 2 MiB / 543,333 B | MariaDB/FPM much faster, but still grows with retained history |

These are the official production-shaped baselines for measuring the later PERF-01 aggregate-consolidation change.

Three simultaneous cold academic HTTP calls completed in 907.5 ms wall time and summed to 2.416 request-seconds. The instrumented repeat measured 2.139 worker-seconds, 36 MiB aggregate net allocator growth, and about 96 MiB summed per-process peak. Consolidation remains worthwhile because one page cache miss occupies three workers even though the individual requests improved.

## Load testing

### Protocol and gates

The standard measured mix is revision 45%, workspace 15%, report details 22%, notifications 10%, auth 8%. The spike mix is revision 15%, workspace 35%, report details 40%, notifications 5%, auth 5%. Think time is 250–1,200 ms. Every run resets transient state, primes sessions before the timer, and samples containers, FPM, MariaDB, queue, and Redis (when enabled) at an effective 10–15 second cadence.

Pass gates: errors under 1% with no sustained 5xx; workspace p95 under 1,000 ms; report details p95 under 1,500 ms; other API p95 under 500 ms where practical; no continuously growing FPM queue; DB connections below 80% of 151; queue oldest age inside notification SLA.

### Scenario summary

| Scenario | Database drivers | Persistent Redis | Gate result |
|---|---|---|---|
| Baseline, 10 VU / 2 min | 11.75 RPS; 0% errors; workspace/report p95 206/254 ms; FPM queue 0 | 11.66 RPS; 0% errors; workspace/report p95 190/225 ms; FPM queue 0 | Both pass |
| Peak, 200 VU / 10 min | 224.38 RPS; 0% errors; workspace/report p95 330/462 ms; other max p95 166 ms; FPM queue max 44, drains | 237.41 RPS; 0% errors; workspace/report p95 256/357 ms; other max p95 69 ms; FPM queue max 13, drains | Both pass |
| First stress gate failure, 300 VU / 3 min | 194.46 RPS; 0% errors; workspace/report p95 658/806 ms; other max p95 534 ms; FPM queue 102 and growing | 217.29 RPS; 0% errors; workspace/report p95 475/601 ms; other max p95 328 ms; FPM queue 76 and growing | Both fail queue; database also fails ordinary-API gate |
| Formal stress break | **600 VU:** 222.79 RPS; 0% errors; report p95 2,029 ms; FPM queue 396 | **700 VU:** 258.27 RPS; 0% errors; report p95 2,054 ms; FPM queue 456 | Defined >2 s threshold |
| Spike, 0→200 in 60 s / 3 min | 143.62 RPS; 0% errors; workspace/report p95 681/795 ms; other max p95 528 ms; FPM queue 74 and sustained | 157.41 RPS; 0% errors; workspace/report p95 552/662 ms; other max p95 395 ms; FPM queue 62 and sustained | Database fails ordinary-API and queue gates; Redis fails queue gate |

The initial non-persistent Redis peak is a separate, intentionally retained failure: 130,722 of 139,986 requests succeeded (217.87 successful RPS), 9,264 returned HTTP 500, and error rate was 6.62%. FPM logs repeatedly show `RedisException: Cannot assign requested address`; Redis reported zero rejected connections. With `REDIS_PERSISTENT=true`, the repeated ten-minute run completes 142,445/142,445 requests and contains no matching error log.

### Database-driver endpoint results

| Scenario | Endpoint | Count | p50 | p95 | p99 | Failures |
|---|---|---:|---:|---:|---:|---:|
| 10 VU / 2 min | workspace | 395 | 81 | 206 | 231 | 0 |
| 10 VU / 2 min | report details | 122 | 198 | 254 | 285 | 0 |
| 200 VU / 10 min | workspace | 40,595 | 140 | 330 | 415 | 0 |
| 200 VU / 10 min | report details | 9,429 | 316 | 462 | 548 | 0 |
| 200 VU / 10 min | revision | 60,415 | 61 | 166 | 239 | 0 |
| 200 VU / 10 min | notifications | 13,514 | 56 | 160 | 237 | 0 |
| 200 VU / 10 min | auth | 10,675 | 57 | 162 | 239 | 0 |
| 300 VU stress | workspace | 10,503 | 390 | 658 | 769 | 0 |
| 300 VU stress | report details | 2,424 | 548 | 806 | 905 | 0 |
| 400 VU stress | workspace | 11,298 | 701 | 1,092 | 1,211 | 0 |
| 400 VU stress | report details | 2,702 | 864 | 1,242 | 1,334 | 0 |
| 500 VU stress | workspace | 11,537 | 1,024 | 1,488 | 1,611 | 0 |
| 500 VU stress | report details | 2,755 | 1,169 | 1,639 | 1,746 | 0 |
| 600 VU stress | workspace | 11,955 | 1,390 | 1,875 | 1,988 | 0 |
| 600 VU stress | report details | 2,849 | 1,547 | **2,029** | 2,141 | 0 |
| 200 VU spike | workspace | 16,177 | 480 | 681 | 759 | 0 |
| 200 VU spike | report details | 3,214 | 637 | 795 | 866 | 0 |

Database-backed drivers pass every standard 200-VU gate: 134,628/134,628 requests succeeded at 224.38 RPS, workspace p95 was 330 ms, report-details p95 462 ms, other endpoints 160–166 ms, DB connections peaked at 22/151, and the FPM queue oscillated and drained rather than growing continuously.

At 300 VUs the ordinary endpoints exceed 500 ms and the FPM queue grows to 102, so 300 is the first release-gate failure. At 600 VUs report-details p95 reaches 2.029 s at 222.79 successful RPS, the formal stress breaking point. The 200-VU spike has zero errors and workspace/report latency inside their gates, but ordinary endpoints reach 526–528 ms and the FPM queue stays elevated at 50–74, so the spike fails the full gate.

### Redis-driver endpoint results

| Scenario | Endpoint | Count | p50 | p95 | p99 | Failures |
|---|---|---:|---:|---:|---:|---:|
| 10 VU / 2 min, persistent | workspace | 407 | 69 | 190 | 206 | 0 |
| 10 VU / 2 min, persistent | report details | 104 | 186 | 225 | 260 | 0 |
| 10 VU / 2 min, persistent | revision | 613 | 21 | 32 | 37 | 0 |
| 10 VU / 2 min, persistent | notifications | 146 | 19 | 27 | 34 | 0 |
| 10 VU / 2 min, persistent | auth | 129 | 19 | 26 | 28 | 0 |
| 200 VU / 10 min, persistent | workspace | 42,704 | 90 | 256 | 303 | 0 |
| 200 VU / 10 min, persistent | report details | 9,824 | 259 | 357 | 412 | 0 |
| 200 VU / 10 min, persistent | revision | 64,396 | 27 | 69 | 107 | 0 |
| 200 VU / 10 min, persistent | notifications | 14,235 | 22 | 62 | 100 | 0 |
| 200 VU / 10 min, persistent | auth | 11,286 | 23 | 63 | 103 | 0 |
| 300 VU stress, persistent | workspace | 11,659 | 253 | 475 | 555 | 0 |
| 300 VU stress, persistent | report details | 2,723 | 403 | 601 | 666 | 0 |
| 300 VU stress, persistent | revision | 17,584 | 166 | 328 | 373 | 0 |
| 300 VU stress, persistent | notifications | 3,914 | 160 | 328 | 371 | 0 |
| 300 VU stress, persistent | auth | 3,232 | 156 | 322 | 370 | 0 |
| 600 VU stress, persistent | workspace | 13,617 | 1,063 | 1,572 | 1,683 | 0 |
| 600 VU stress, persistent | report details | 3,245 | 1,236 | 1,715 | 1,800 | 0 |
| 700 VU stress, persistent | workspace | 14,127 | 1,350 | 1,900 | 2,016 | 0 |
| 700 VU stress, persistent | report details | 3,251 | 1,505 | **2,054** | 2,144 | 0 |
| 200 VU spike, persistent | workspace | 17,726 | 355 | 552 | 625 | 0 |
| 200 VU spike, persistent | report details | 3,585 | 516 | 662 | 717 | 0 |
| 200 VU spike, persistent | revision | 4,205 | 276 | 395 | 433 | 0 |
| 200 VU spike, persistent | notifications | 1,395 | 275 | 388 | 433 | 0 |
| 200 VU spike, persistent | auth | 1,422 | 276 | 393 | 439 | 0 |

At standard 200-VU load, persistent Redis raises successful throughput by 5.8% (224.38 → 237.41 RPS) and reduces workspace/report p95 by 22%/23%. That is a useful optimization, not a requirement, because the database configuration already clears every gate.

## FPM sizing (SCALE-07)

Telemetry samples only `php-fpm: pool www` processes, excluding the master. Standard 200-VU worker RSS is:

| Driver mode | p95 worker RSS | Max worker RSS | FPM active max | Listen queue max | New max-children events | DB connections max |
|---|---:|---:|---:|---:|---:|---:|
| Database | 46.87 MiB | 48.22 MiB | 20 | 44 | 30 | 22 |
| Persistent Redis | 46.50 MiB | 47.99 MiB | 20 | 13 | 48 | 21 |

The event count records brief attempts to dispatch while all children were busy; queue time-series determine health. In both standard peak runs the queue repeatedly returns to zero. During stress/spike it becomes sustained and grows.

Use:

```text
memory_cap = floor(PHP_RAM_budget_MiB / (p95_worker_RSS_MiB × 1.25))
db_cap     = floor(max_connections × 0.80) - reserved_non_FPM_connections
max_children = min(memory_cap, db_cap, CPU/load-tested cap)
```

With a 4,096 MiB PHP budget:

- committed 256 MiB/worker assumption: `floor(4096 / 256) = 16`;
- measured database p95 with 25% safety: `floor(4096 / (46.87 × 1.25)) = 69`;
- DB cap with 151 maximum connections and 10 reserved: `floor(151 × 0.8) - 10 = 110`;
- observed CPU/load-tested cap: **20** for this configuration.

The 256 MiB figure is a PHP allocation limit, not observed RSS, and is too conservative for memory sizing. Conversely, 69 would be unsafe to adopt from memory math alone: at the standard database peak the app container reaches about 1,501% CPU while MariaDB reaches about 386%, and higher VUs create a PHP listen queue without using more than 22 DB connections. Start at 20 on comparable hardware. On the actual hospital host, reserve RAM for MariaDB/Redis/Nginx/OS, recalculate from p95 RSS, and validate any child increase with the same spike profile.

## Updated findings register

| ID | Pillar | Severity | Evidence | User-facing impact | Concrete fix | Effort |
|---|---|---|---|---|---|---:|
| PERF-01 | Backend | High | Docker cold summary/trend/people are 669/873/658 ms; concurrent cold fan-out consumes 2.139 worker-seconds and three workers. | A synchronized miss still occupies multiple FPM slots and competes with ordinary traffic. | Build one cached aggregate snapshot per filter set and serve all three views from it; warm after evaluation writes. | M |
| PERF-02 | Backend | High | All-time clinical cold is 2.94 s and 1.04 MB; eight weeks is ~250 ms and 81 KB. MariaDB already range-scans the current unique index. | Archive views hold a worker for seconds; growth is a range/processing issue, not an index lookup issue. | Require bounded interactive dates; queue/stream all-time export; add weekly rollups if archive access is frequent. | M |
| PERF-04 | Database | Medium | Revision union is 11.18 ms now; morning/student attendance branches dominate and scan cost grows with retained facts. | Many polling tabs multiply otherwise-small linear scans. | Maintain one transactional workspace revision row or cached global version; add polling jitter/backoff. | M |
| PERF-05 | Database | Medium | Candidate covering index is selected; temp/filesort disappears; median improves 5.407 → 2.838 ms (47.51%). | Student analytics avoids growing grouping/sort overhead. | Ship `INDEX student_attendance_student_present_index (student_id, present)`. | S |
| PERF-06 | Caching | Low | Database drivers pass 200 VUs. Non-persistent Redis fails at 6.62% from client-side ephemeral-port exhaustion; persistent Redis is the supported corrected variant. | Redis is not needed for capacity here, and a careless Redis rollout can be less reliable than database drivers. | Keep DB drivers as a valid small-install choice. If using Redis, enable/review persistence/pooling and rerun the release gate. | S |
| SCALE-01 | Load/capacity | Medium | Database-backed 200 VUs sustain 224.38 RPS for 10 minutes, zero errors, workspace/report p95 330/462 ms. First release-gate failure is 300 VUs; formal >2 s break is 600 VUs. | The architecture clears the requested concurrency on this laptop, but target-host headroom remains hardware-dependent. | Repeat the exact 200-VU gate on hospital-comparable hardware before release; retain telemetry/slow-log alerts. | M |
| SCALE-05 | Test tooling | Medium | Audit harness uses one of 800 identities per VU, distinct cookies/IPs, 200 default, setup excluded, successful RPS reported. The repository harness/docs mismatch remains untouched. | Shared identities can still invalidate future capacity claims if the corrected setup is not ported. | Apply the audit harness identity/default/summary changes to `scripts/load-test.mjs` and its docs in a separate source change. | S |
| SCALE-07 | FPM sizing | Medium | Database 200-VU p95 worker RSS is 46.87 MiB; peak DB connections are 22; 20 children pass standard load but saturate under the spike/stress profiles. | A fixed memory-only child count misses the observed PHP CPU/queue ceiling. | Size with measured RSS × 1.25, DB reserve, and a CPU/load-tested cap; start at 20 on comparable hardware and retest any increase. | S |

## Raw evidence appendix

### Stack and configuration

- `docker/audit/docker-compose.yml`
- `docker/audit/Dockerfile`
- `docker/audit/php.ini`
- `docker/audit/php-fpm.conf`
- `docker/audit/nginx.conf`
- `docker/audit/mariadb.cnf`
- `docker/audit/evidence/environment.json`
- `docker/audit/evidence/source-parity.json`
- `docker/audit/evidence/php-runtime.txt`
- `docker/audit/evidence/fpm-pool.txt`
- `docker/audit/evidence/mariadb-variables.tsv`
- `docker/audit/evidence/seed-row-counts.json`
- `docker/audit/evidence/analyze-tables.json`
- `docker/audit/evidence/load-account-model.json`
- `docker/audit/evidence/driver-redis.json`

### Plans and scoped baselines

- `docker/audit/evidence/query-plans.json` — structured SQL, bindings, ordinary and executed plans
- `docker/audit/evidence/query-plans-raw.txt` — verbatim plan appendix
- `docker/audit/evidence/http-baselines.json` — cold and 20-sample warm HTTP results plus query logs
- `docker/audit/evidence/clinical-8w-query-metrics.json` — corrected eight-week instrumented run after OPcache restart

### Load runs

Every run directory contains `load.json`, `telemetry.jsonl`, DB status before/after, `slow-log.tsv`, service logs, and completion metadata.

Official database-driver runs:

- `docker/audit/evidence/runs/database/baseline-10vu-2m/`
- `docker/audit/evidence/runs/database/peak-200vu-10m-r1/`
- `docker/audit/evidence/runs/database/stress-300vu-3m/`
- `docker/audit/evidence/runs/database/stress-400vu-3m/`
- `docker/audit/evidence/runs/database/stress-500vu-3m/`
- `docker/audit/evidence/runs/database/stress-600vu-3m/`
- `docker/audit/evidence/runs/database/spike-200vu-3m/`

Official persistent-Redis runs:

- `docker/audit/evidence/runs/redis/baseline-10vu-2m-persistent/`
- `docker/audit/evidence/runs/redis/peak-200vu-10m-persistent/`
- `docker/audit/evidence/runs/redis/stress-300vu-3m-persistent/`
- `docker/audit/evidence/runs/redis/stress-600vu-3m-persistent/`
- `docker/audit/evidence/runs/redis/stress-700vu-3m-persistent/`
- `docker/audit/evidence/runs/redis/spike-200vu-3m-persistent/`

Retained diagnostic runs:

- `docker/audit/evidence/runs/redis/peak-200vu-10m/` — non-persistent Redis failure and full exception log
- `docker/audit/evidence/runs/redis/baseline-10vu-2m-r1/` — corrected latency probe before persistence change
- `docker/audit/evidence/runs/database/peak-200vu-10m/` — setup timeout before retry hardening; no measured load

`docker/audit/evidence/run-summary.json` is the generated cross-run summary. `docker/audit/summarize-runs.ps1` regenerates it from raw run artifacts.
