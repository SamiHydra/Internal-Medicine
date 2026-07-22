# PERFORMANCE AND SCALABILITY AUDIT

**System:** St Paul IM hospital reporting + academic platform (Laravel + Sanctum backend, React SPA)
**Audit date:** 2026-07-21
**Report compiled:** 2026-07-22
**Branch / commit-ish:** `feat/excel-import`, discovery baseline taken at `d82edb3`; remediation committed at `43bbccc`
**Source of truth for issues:** `AUDIT_FINDINGS.md`
**Companion documents:** `DATABASE_REVIEW.md`, `SECURITY_AUDIT.md`, `PLAYWRIGHT_TEST_REPORT.md` (produced separately)

---

## 0. How to read this document

This audit was performed against two lanes:

| Lane | Engine | What it can measure |
|---|---|---|
| Dev lane | SQLite (WAL), single file, Vite :5173 + Laravel :8000 | Functional behaviour only. Single-writer. Cannot measure real concurrency, connection limits, or production query plans. |
| Production-parity lane | Docker: MariaDB 11.4 + nginx + PHP-FPM 8.3 + queue/scheduler workers, serving the built SPA over HTTPS | Write concurrency, real engine behaviour, TLS/header/cookie behaviour, and the MariaDB regression suite. Not a production host: see the boundary in section 3. |

Every claim below is tagged:

- **VERIFIED** - executed or reproduced, with a cited artifact. A measured fact.
- **PREDICTED** - reasoned from schema and query patterns, never measured at the stated scale. A model, not a measurement.
- **UNVERIFIED** - a code-level observation whose runtime behaviour was not exercised.

The single most important honesty statement in this report: **no empirical load test was run at 1,000, 10,000, or 100,000 users, or under sustained multi-user concurrency.** Section 8 states exactly why. Every number in section 6 is a projection carrying the PREDICTED tag.

---

## 1. Headline conclusion

The platform's correctness on the production database engine is now **VERIFIED green** (MariaDB parity suite: 314 tests, 2,188 assertions, 0 failures - `artifacts/audit-2026-07-21/evidence/mariadb-suite-postfix.txt:23`), and the two deployment blockers that made the department server un-deployable are fixed and verified (`AUD-DB-001`, `AUD-DEPLOY-007`).

The platform's **scalability is not yet demonstrated and does not need to be for its intended envelope**, but it carries three structural risks that will bite as data accumulates rather than as users are added:

1. **Unbounded audit and attendance tables with no retention policy** (VERIFIED as a code/schema fact; growth is PREDICTED). The table the schema itself calls "the fastest-growing in the system" has no prune job at all.
2. **Session, cache, and queue all share the primary datastore.** On the dev lane that is the same SQLite file as clinical data (VERIFIED); on the parity/production lane they are MariaDB tables that add write and connection pressure to the same instance (VERIFIED as a config fact; contention is PREDICTED).
3. **Unthrottled CPU-expensive endpoints.** A single authenticated session can drive the app tier to ~5.8 cores of bcrypt work with an unthrottled endpoint (VERIFIED by measurement on the parity lane, section 4.4).

None of these is a functional defect today. All three are scaling-time liabilities and are listed as scalability release blockers in section 7.

For the system's actual deployment envelope - a single internal medicine department on a hospital LAN, on the order of tens to low-hundreds of staff accounts - the dominant scaling axis is **accumulated data volume over years**, not concurrent user count. The 1k/10k/100k user projections requested by the brief are provided in section 6 as a stress model, with an explicit note that they exceed the realistic deployment by one to three orders of magnitude.

---

## 2. What was actually MEASURED (VERIFIED)

### 2.1 Seeded data volume (the scale this audit observed)

Read read-only from the live dev SQLite database via PRAGMAs, cross-checked against the parity MariaDB seed.
Evidence: `artifacts/audit-2026-07-21/discovery/01-database-schema.md:76-102`; parity seed counts `AUDIT_COMMAND_LOG.md:107`.

| Table | Rows (dev SQLite) | Notes |
|---|---:|---|
| `report_field_values` | **61,001** | Highest-volume table. ~88 rows per report. Single bulk seed. |
| `evaluation_answers` | 8,804 | Highest-growth academic table (EAV, ~12 answers/evaluation). |
| `morning_attendance` | 6,440 | Roster size x one session per weekday. |
| `student_attendance` | 900 | Batch size x sessions/week. |
| `evaluations` | 732 | |
| `reports` | 695 | |
| `duty_assignments` | 523 | |
| `morning_sessions` | 162 | |
| `teaching_sessions` | 98 | |
| **Total, all 53 tables** | **80,025** | DB file ~28.5 MB (29,872,128 bytes), page_size 4096. |

**VERIFIED coverage boundary - this constrains every conclusion below.** 20 of the 53 tables are completely empty in the seeded database, including every table on the clinical audit path (`audit_logs`, `report_status_history`), the entire notification path (`notifications`), and the entire access-request path (`access_requests`, `admin_access_requests`), plus `action_items`, `report_comments`, and `calculated_metrics`. Real volume exists in only four tables (`report_field_values`, `evaluation_answers`, `morning_attendance`, `student_attendance`). **No performance claim may be made about the empty paths from this dataset.** Evidence: `AUDIT_FINDINGS.md:309-317`, `discovery/01-database-schema.md:104-109`. The parity lane used the same seeders and inherits the same empty-path gap.

**VERIFIED data-realism caveat.** All 61,001 `report_field_values` rows share one `updated_at` (`2026-07-12 15:14:37`) because they were bulk-seeded in a single write. Any query plan that depends on `updated_at` selectivity behaves unrealistically on this dataset. Evidence: `discovery/01-database-schema.md:111-114`.

### 2.2 Production-parity suite timing (VERIFIED)

The MariaDB parity suite is the only executed timing measurement in this audit. It is a correctness-and-regression run, not a representative user-load benchmark.

| Run | Engine | Result | Wall time | Memory | Evidence |
|---|---|---|---|---|---|
| Pre-fix | MariaDB 11.4.12, PHP 8.4 | 281 tests, **7 failures, 3 errors** | not recorded | not recorded | `mariadb-failure-triage.md:4`; `mariadb-suite-full.txt` |
| Pre-fix | SQLite | 281 tests, 280 passed, **1 skipped** | ~40.3 s | not recorded | `AUDIT_PROGRESS.md:214` |
| Post-fix | MariaDB 11.4.12, **PHP 8.3.32** | **314 tests, 2,188 assertions, OK (0 failures)** | **46.96 s** | **85.00 MB** | `mariadb-suite-postfix.txt:12,21-23` |
| Post-fix | SQLite | 313 passed, 1 skipped | not recorded | `AUDIT_FINDINGS.md` ground truth |

Interpretation: the suite of 314 tests completes in ~47 s of wall time in ~85 MB on a tmpfs MariaDB. This measures test-harness throughput on a warm local container, **not** end-user request latency and **not** behaviour under concurrent traffic. It is cited here only to establish that the production engine executes the full suite cleanly after the fixes.

### 2.3 The MariaDB concurrency test now executes and passes (VERIFIED)

This is the single most valuable performance-relevant fact the audit produced, because it converts a previously-unexecutable check into evidence.

- `backend/tests/Feature/MariaDbConcurrencyRegressionTest.php` self-skips on SQLite ("True parallel locking regression runs only in the MariaDB CI lane"). It had **never actually run anywhere** before this audit, because the CI lane that should run it could not install dependencies (`AUD-INFRA-003` / `AUD-DEPLOY-007`).
- On the parity lane it now executes: **14 assertions, all three concurrency scenarios PASS**. Evidence: `AUDIT_PROGRESS.md:259-262`, `AUDIT_COMMAND_LOG.md:115,122-124`, `mariadb-failure-triage.md:134-135`.
- The three scenarios exercise MariaDB serialising the first roster / transfer / draft writes under forked workers on independent connections (`MariaDbConcurrencyRegressionTest::test_mariadb_serializes_first_roster_transfer_and_draft_writes`).

**Honest limit on what this proves (VERIFIED weakness).** The test's start barrier polls `is_file()` every 10 ms (`tests/Support/MariaDbConcurrencyWorker.php:29-38`), so two workers can begin up to ~10 ms apart while the critical section is a couple of locked SELECTs plus an INSERT on a tmpfs MariaDB. A fully serial execution satisfies all 14 assertions. The test **cannot produce false failures**, so it is safe-but-weak: it proves the locking path does not deadlock or corrupt, not that it was genuinely contended. Evidence: `mariadb-failure-triage.md:224-230` (triage item H5). To make contention provable, each worker should record `microtime(true)` at lock acquisition and commit and assert the intervals intersect.

### 2.4 Resource-under-burst measurement: unthrottled bcrypt endpoint (VERIFIED)

A CPU-exhaustion probe was run on the parity lane against `POST /api/auth/change-password`, which is one of three authenticated routes with **no throttle** and which performs a bcrypt verify plus a bcrypt re-hash per call (`api.php` auth group; `AuthController.php:66,74-77`; throttle analysis `discovery/00-DISCOVERY-BASELINE.md:388`).

| Measurement | Value | Evidence |
|---|---|---|
| App container CPU, idle baseline | **0.01%** | `evidence/cpu-before.txt:4` |
| App container CPU, during a 60-request burst | **576.36%** (~5.8 cores) | `evidence/cpu-during.txt:4` |
| Per-request latency under burst | 0.68 s to 1.40 s, 60/60 returned HTTP 422 | `evidence/burst.txt` (60 lines) |
| DB container CPU during the same burst | 4.02% | `evidence/cpu-during.txt:5` |

This is VERIFIED, measured behaviour: a **single** authenticated session, issuing failed password-change attempts an unthrottled endpoint accepts, drove the application tier from idle to ~5.8 cores while the database stayed near-idle. The cost is entirely bcrypt in the PHP tier, and it is available at unlimited rate to any logged-in account. This is catalogued as security candidate `C-SEC-005` (DoS primitive) and is carried in `SECURITY_AUDIT.md`; it is reproduced here because it is a measured resource fact directly relevant to how the system behaves under adversarial or accidental load. Reproduction scripts: `evidence/req.sh`, `evidence/cj.txt`, `evidence/one.sh`.

### 2.5 What was NOT measured (stated plainly)

- **No EXPLAIN / query-plan capture was performed on either lane.** The index-coverage analysis in section 5 is structural (read from `pragma index_list` / `index_info`), not derived from executed query plans. Where the discovery notes say "capture EXPLAIN ...", that is a pending verification instruction, not evidence that it was done. Evidence: `AUDIT_FINDINGS.md:304` (C-PERF-014 "Verify by ... EXPLAIN"), and no EXPLAIN output exists anywhere under `artifacts/`.
- **No page-load, dashboard-render, or API-latency benchmark was run** as a user journey. The `/api/auth/me` and `/api/workspace` capture configs under `evidence/` (`urls-me.txt`, `urls-ws.txt`) are repeated-request curl config files; no aggregated latency result was persisted.
- **No representative multi-user load test was run** (see section 8). `scripts/load-test.mjs` exists but was not executed against a safe target.
- **No production hardware** was available at any point in the audit; the only "production-shaped" environment is the local Docker parity stack.

---

## 3. Boundary of the parity lane (what its green does and does not cover)

The parity stack is the strongest evidence in this audit, so its limits must be explicit. `docker/README.md` enumerates 14 ways this lane still differs from real production (`AUDIT_PROGRESS.md:258`). The performance-relevant ones:

- **The MariaDB data directory is tmpfs (RAM-backed).** Disk I/O, fsync latency, and buffer-pool eviction under a real data directory are therefore not represented. Query timings on this lane are optimistic.
- **Single host, no network.** App, DB, and web share one machine; there is no LAN round-trip, no separate DB host, no connection latency.
- **Synthetic single-write seed**, with the empty-path and single-`updated_at` caveats of section 2.1.
- **PHP was realigned to 8.3** (matching the department server) only after `AUD-DEPLOY-007`; the pre-fix suite ran on 8.4. Post-fix timings are on 8.3.32 (`mariadb-suite-postfix.txt:12`).

The lane proves engine correctness and locking soundness. It does not, and was never intended to, produce a load or latency benchmark.

---

## 4. VERIFIED: dev-lane single-writer limitation

On the dev lane, `DB_CONNECTION=sqlite` with `journal_mode=wal`, `synchronous=NORMAL` (`discovery/01-database-schema.md:69-73`; `backend/config/database.php:48-49`). WAL removes reader/writer contention but **not writer/writer contention**: SQLite still serialises all writers against a single write lock. Evidence and config comment: `discovery/01-database-schema.md:1626-1630`, `backend/config/database.php:41-46`.

Consequence, VERIFIED as an architectural fact: every concurrent report submission, session write, cache write, and queued job write on the dev lane serialises against the same lock. This makes the dev lane structurally unable to measure the concurrency questions this audit cares about, which is precisely why the parity lane exists. It is **not** a production risk, because production uses MariaDB; it is a statement about the limits of the dev lane as a measurement instrument.

---

## 5. Structural risks from schema + query patterns

These are VERIFIED as code/schema facts (each cites file:line). Their runtime impact at scale is PREDICTED and labelled as such. Full schema detail is in `DATABASE_REVIEW.md`; only the performance-bearing items are summarised here.

### 5.1 Database-backed session / cache / queue contention (VERIFIED config, PREDICTED impact)

`SESSION_DRIVER`, `CACHE_STORE`, and `QUEUE_CONNECTION` are all `database` (`discovery/01-database-schema.md:73`; `backend/.env:31,50,52`). No Redis is used or planned (`V2_IMPLEMENTATION_GUIDE.md`, per memory index).

- **VERIFIED:** on the dev lane, `sessions`, `cache`, `cache_locks`, `jobs`, `job_batches`, `failed_jobs` share the same SQLite file as clinical data, so every session and cache write contends with report-submission writes for the single write lock (`discovery/01-database-schema.md:1626-1630`).
- **VERIFIED:** on the parity/production lane these are MariaDB tables. Contention moves from a single file lock to row/table locks and connection pressure on the same MariaDB instance that serves clinical and academic reads and writes.
- **PREDICTED:** as concurrent sessions rise, every request performs a session read and (frequently) a session write; database-backed sessions turn each authenticated request into at least one extra write against the primary datastore. With cache also in the database, cache warming (section 5.4) adds further writes. At tens of concurrent users this is negligible; at the hypothetical thousands of section 6 it becomes a measurable share of DB write throughput. This has **not** been measured.

### 5.2 Unbounded table growth with no retention (VERIFIED absence of retention, PREDICTED growth)

Retention is essentially unmanaged. Evidence: `discovery/01-database-schema.md:1602-1624`; `AUDIT_FINDINGS.md:303` (C-DB-013).

| Table | Grows with | Pruned? | Evidence |
|---|---|---|---|
| `audit_logs` | one row per edited report cell; the migration itself calls it the fastest-growing table | **No retention at all** | `2026_05_29_000000_add_performance_indexes.php:32-33`; 0 rows seeded, so entirely unexercised |
| `admin_audit_logs` | one row per admin mutation, with full old/new JSON | **No** | 17 rows |
| `report_status_history` | one row per report status transition | **No** | 0 rows seeded |
| `report_field_values` | every report cell x 7 weekdays, forever | **No** | 61,001 rows already |
| `evaluation_answers` | every evaluation x ~12 fields, forever | **No** | 8,804 rows |
| `morning_attendance` / `student_attendance` | roster/batch x sessions, forever | **No** | 6,440 / 900 rows |
| `notifications` | one row per event per recipient | **Partial** | `reports:prune-notifications` deletes only **read** notifications older than 90 days; **unread are never pruned** (`PruneStaleNotifications.php:22-28`, `console.php:51`) |
| `sessions` | one row per browser session | Lottery GC only | `SESSION_DRIVER=database`, probabilistic GC, no scheduled sweep |
| `cache` | one row per key | Lazy only | expired rows deleted on read, never swept; `sanctum:prune-expired` not scheduled |

**PREDICTED consequence.** The highest-risk table, `audit_logs`, is both the fastest-growing by design and completely unexercised in the seed, so its production growth rate is **unmeasured and unmodelled from real data**. Every cell edit writes one audit row; a department editing reports across 27 departments weekly will accumulate audit rows at a multiple of the `report_field_values` rate, with no ceiling and no prune. This is a slow-motion capacity problem, not a today problem, and it is the top scalability release blocker (section 7).

### 5.3 Index coverage on the largest table (VERIFIED structural gap, PREDICTED cost, NOT EXPLAIN-confirmed)

Evidence: `discovery/01-database-schema.md:1510-1588`; `AUDIT_FINDINGS.md:304` (C-PERF-014). All of the following are structural observations from the resolved index list. None was confirmed with an executed query plan.

- **`report_field_values.field_definition_id` (61,001 rows) has no index leading with it.** It was indexed at creation `(report_id, field_definition_id)` and the composite was deliberately dropped as "a strict prefix of the unique index" (`2026_05_29_000000_add_performance_indexes.php:41`). Correct for lookup-by-report; but any "all values for field X across all reports" aggregation, and any DELETE of a field definition, is **PREDICTED** to be a 61k-row scan on the system's largest table. On MariaDB/InnoDB an FK index is auto-created, which mitigates the DELETE-refusal case but not necessarily an aggregation that filters on `field_definition_id` alone.
- **`student_attendance.student_id` has no index**, while the analogous `morning_attendance.user_id` does (`2026_08_19_000010:43`). "This student's attendance history" is PREDICTED to scan; reads as an oversight, not a decision.
- **`evaluations.form_id` is unindexed** (only `form_key` is), and every render of a historical evaluation joins to the pinned form version.
- **`reports` carries 6 indexes** at 695 rows, with `(assignment_id, updated_at)` overlapping the unique's leading column. That is write amplification for little read benefit and is a candidate for pruning, not a defect (`discovery/01-database-schema.md:1677-1681`).

Because no EXPLAIN was captured, these are ranked by table size and by whether a known query touches them, not by an observed plan. Treat them as PREDICTED until a query-plan pass runs on the parity lane.

### 5.4 Input-driven work on read paths (VERIFIED code, PREDICTED impact)

- **State-mutating GET on analytics.** `GET /api/analytics/*` writes cache entries and registers an after-response `app()->terminating()` warm keyed on client-supplied filters (`discovery/00-DISCOVERY-BASELINE.md:394`; `DashboardAnalyticsService.php`). A read endpoint performing input-driven cache writes is a cache-amplification and cache-pollution surface: distinct filter combinations each create cache rows in the database-backed cache. **PREDICTED** to grow the `cache` table under varied query traffic; not measured.
- **`GET /api/academic/morning-sessions/today` INSERTs a row** when none exists (`MorningSessionController.php:41-50`). The only state-mutating GET in the API; any prefetcher or crawler can create the day's session. Correctness/idempotency concern more than a throughput one, noted for completeness.
- **Shared throttle bucket.** Every authenticated route inherits one `throttle:300,1` bucket with no per-endpoint cost weighting (`discovery/00-DISCOVERY-BASELINE.md:387,389`). Expensive routes share that budget with trivial reads: `POST /api/admin/reports/import` (10 MB x 300/min = up to ~3 GB/min per session), `GET /api/analytics/export` (streams all periods, materialises a temp XLSX), and `GET /api/workspace` (loads all templates, fields, departments, periods, and for admins **every user row**). **PREDICTED** to be the load-amplification hotspots; the change-password measurement in section 2.4 is the one member of this class that was actually measured.

### 5.5 Dev/prod divergence class (VERIFIED, correctness rather than throughput)

29 `->enum()` declarations resolve to unvalidated `varchar` on SQLite but strict `ENUM` on MariaDB (`AUDIT_FINDINGS.md:301`, C-DB-011; `discovery/01-database-schema.md:1642`). This is the same divergence class that produced the confirmed deployment blocker `AUD-DB-001` (a 71-char index name legal on SQLite, rejected by MariaDB). It is a correctness risk, listed here only because it is the reason the dev lane cannot be trusted as a proxy for production behaviour, which is the whole justification for the parity lane and for treating dev-lane performance numbers as non-transferable.

---

## 6. PREDICTED behaviour at 1,000 / 10,000 / 100,000 users and high concurrency

**Every figure in this section is PREDICTED. None was measured.** The projections are a stress model built from the seeded per-unit growth rates (section 2.1) and the structural risks (section 5), extrapolated linearly. Linear extrapolation is itself an assumption: index degradation, lock contention, and buffer-pool pressure are typically super-linear, so these projections are optimistic where they are wrong.

### 6.0 Deployment-envelope reality check (stated before the numbers)

The system's documented target is an on-prem hospital LAN deployment for a single internal medicine department (`V2_IMPLEMENTATION_GUIDE.md`, no Redis, LAN-only, per memory index). The realistic account population is on the order of **tens to low hundreds** of staff (52 users seeded; `discovery/01-database-schema.md:82`), with concurrent active users lower still. **1,000 users exceeds the realistic deployment by roughly an order of magnitude; 100,000 by roughly three.** The projections below are provided because the brief requires them as a stress test, not because the system is expected to reach these populations. The honest scaling axis for this product is **years of accumulated data**, modelled in 6.2.

### 6.1 PREDICTED by user count

Assumptions: user growth drives proportional report, evaluation, attendance, session, notification, and audit volume. Baseline is the seeded 52 users producing 80,025 total rows, of which 61,001 are `report_field_values`.

| Scale | Users | PREDICTED dominant-table volume | PREDICTED primary risk |
|---|---:|---|---|
| Baseline (measured) | 52 | 61,001 field values; 80,025 total rows; 28.5 MB | None observed. Correct and fast at this scale. |
| 1,000 users | ~19x | ~1.2M field values; low-single-digit-million total rows | Comfortably within MariaDB's capacity **if** the section 5.3 indexes are added and retention (5.2) exists. `sessions`/`cache` write share becomes non-trivial. |
| 10,000 users | ~190x | ~12M field values; tens of millions of rows | `audit_logs` (unbounded, unpruned) and `report_field_values` dominate. The unindexed `field_definition_id` aggregation (5.3) becomes a real cost. Database-backed session/cache write pressure (5.1) is now a measurable fraction of DB writes. |
| 100,000 users | ~1,900x | ~120M field values; hundreds of millions of rows | Retention becomes mandatory, not optional. Single-instance database-backed session + cache + queue (no Redis) is the likely first bottleneck. Full-scan paths from 5.3 are PREDICTED to degrade super-linearly. |

These are order-of-magnitude estimates. They are **not** validated against index behaviour, lock contention, or connection limits, because no load test was run.

### 6.2 PREDICTED by accumulated data (the realistic axis)

More useful than user count for this product. From the seeded rates:

- `report_field_values`: ~88 rows/report. A department producing weekly reports across 27 departments is on the order of 27 x 52 = ~1,400 reports/year, or roughly **120,000 field-value rows/year**, growing without bound (no retention).
- `morning_attendance`: ~40 rows/session x ~250 working days = **~10,000 rows/year**, unbounded.
- `audit_logs`: one row per edited cell, **PREDICTED to exceed the field-value rate** if cells are revised, and **completely unpruned and unmeasured** (0 rows seeded).

PREDICTED conclusion: over a 5-year horizon the primary datastore reaches single-digit-million clinical rows plus an unbounded and unmodelled `audit_logs`. MariaDB handles single-digit millions comfortably **with correct indexing**; the exposure is the unpruned audit trail plus the missing `field_definition_id` index, not the clinical row count itself.

### 6.3 PREDICTED under high concurrency

- **VERIFIED foundation:** the MariaDB locking path is sound for the first roster/transfer/draft writes (section 2.3), so the engine serialises correctly rather than corrupting. This is the one concurrency fact that is measured, and it is reassuring as far as it goes.
- **PREDICTED gap:** that test is safe-but-weak (10 ms barrier, section 2.3), so genuine contention was not demonstrated. Concurrent monthly duty-roster saves are enforced only in `RosterService` inside a transaction, with **no database uniqueness constraint** on `duty_assignments` (`AUDIT_FINDINGS.md:306`, C-DB-016; `discovery/01-database-schema.md:1598`). Under real concurrent writers this is PREDICTED to be the highest-risk integrity path, and it is exactly where the concurrency test's weakness leaves a blind spot.
- **PREDICTED bottleneck ordering:** for a no-Redis, single-MariaDB deployment, the first resource to saturate under concurrency is PREDICTED to be database write throughput (sessions + cache + queue + clinical writes on one instance), followed by the PHP app tier on any unthrottled bcrypt path (the one measured saturation, section 2.4).

---

## 7. Scalability release blockers

Items that must be resolved or explicitly accepted before scaling this system beyond its current single-department envelope. Severity reflects scaling risk, not present-day breakage; nothing here is a functional defect at current volume.

| # | Blocker | Status | Evidence | Required before scaling |
|---|---|---|---|---|
| SB-1 | **No retention on unbounded audit/attendance/status-history tables.** `audit_logs` (fastest-growing by design) has no prune at all; unread `notifications` are never pruned; `sessions`/`cache` have only lottery/lazy GC. | VERIFIED (absence of retention); growth PREDICTED | `AUDIT_FINDINGS.md:303`; `discovery/01-database-schema.md:1602-1624` | Add scheduled retention/archival for `audit_logs`, `admin_audit_logs`, `report_status_history`, unread `notifications`; schedule `sanctum:prune-expired` and a `cache`/`sessions` sweep. |
| SB-2 | **Session + cache + queue share the primary datastore (no Redis).** Every authenticated request adds a session write; cache warming adds input-driven writes. | VERIFIED (config); contention PREDICTED | `backend/.env:31,50,52`; `discovery/01-database-schema.md:1626-1630` | Load-test the DB write path at target concurrency, or move sessions/cache/queue off the clinical datastore, before exceeding low-hundreds of concurrent users. |
| SB-3 | **Unthrottled CPU-expensive endpoints.** `change-password` (bcrypt x2), `me`, `logout` have no throttle; measured 0.01% -> 576% app CPU from one session. | **VERIFIED by measurement** | section 2.4; `evidence/cpu-during.txt:4`; `AUDIT_FINDINGS.md:285` (C-SEC-005) | Add per-endpoint throttles with cost weighting; do not share one 300/min bucket across bcrypt and trivial reads. |
| SB-4 | **Missing index on the largest table's aggregation key.** `report_field_values.field_definition_id` has no leading index; per-field aggregation is PREDICTED to full-scan 61k+ rows. | VERIFIED (structural); cost PREDICTED, not EXPLAIN-confirmed | `discovery/01-database-schema.md:1566-1572`; `AUDIT_FINDINGS.md:304` | Capture EXPLAIN on the parity lane for the per-field aggregation, add the index if confirmed. Also `student_attendance.student_id`, `evaluations.form_id`. |
| SB-5 | **No database uniqueness on `duty_assignments`; concurrency test is safe-but-weak.** Overlap prevention is application-only; genuine write contention unproven. | VERIFIED (schema + test weakness); integrity risk PREDICTED | `AUDIT_FINDINGS.md:306`; `mariadb-failure-triage.md:224-230` | Strengthen the concurrency test (timestamp intervals) and add a DB-level guard or accept the transaction-only guarantee explicitly. |

The two **deployment** blockers found by this audit (`AUD-DB-001` index name, `AUD-DEPLOY-007` composer/PHP 8.3) are already **FIXED and VERIFIED** and are release blockers rather than scalability blockers; they are recorded in `AUDIT_FINDINGS.md` and `FIX_VERIFICATION_REPORT.md`, not repeated here.

---

## 8. Why empirical 1k / 10k / 100k load testing was NOT performed

The brief requires this to be stated explicitly. It was not performed for four concrete reasons, in order of weight:

1. **No production or production-representative hardware existed at any point.** The only production-shaped environment was the local Docker parity stack, whose MariaDB data directory is tmpfs (RAM-backed) and whose app, DB, and web tiers share one host (section 3). A load test there would measure the developer's laptop, not a hospital LAN server, and would produce numbers that are misleading rather than merely incomplete.
2. **The seed does not exercise the paths that matter under load.** 20 of 53 tables are empty, including every audit, notification, and access-request path (section 2.1). A load test against this dataset would report healthy numbers for paths that have never held a row, which is worse than no number, because it implies coverage that does not exist. Generating a realistic multi-year dataset first was out of scope for the audit window.
3. **The one load harness present is unsafe to run as-is.** `scripts/load-test.mjs` defaults `LOAD_BASE_URL` to `http://127.0.0.1:8000`, the **live dev backend**, and performs real logins (`discovery/00-DISCOVERY-BASELINE.md:516`). Running it without repointing would have generated load and test data against the working development database, violating the audit's read-only-on-source constraint. Repointing and validating it against a disposable, realistically-seeded target was not completed within the audit.
4. **Audit prioritisation.** Finite audit time was spent where the highest-value findings actually came from: the production-parity lane (which surfaced both deployment blockers and the roster-500) and code/schema inspection. Every confirmed critical finding came from those, not from synthetic load. Browser-based role testing and load generation were explicitly deferred, and this report does not claim otherwise (`AUDIT_PROGRESS.md:356-360`).

**Consequence, stated honestly:** this document's scalability conclusions are a **model, not a measurement**. The only measured resource behaviours are the parity-suite timing (2.2), the concurrency-test pass (2.3), and the change-password CPU burst (2.4). Section 6 must be read as PREDICTED throughout.

---

## 9. Recommendations (prioritised)

1. **Before any scale-up, add retention (SB-1).** This is the one liability that grows silently and unbounded with zero present-day symptom. Start with `audit_logs`, since it is the fastest-growing and entirely unexercised.
2. **Run a real load test on representative hardware with a realistically-seeded dataset (closes the section 8 gap).** Repoint `scripts/load-test.mjs` to a disposable target first. Seed the empty audit/notification paths before measuring. Capture p50/p95/p99 per endpoint and DB write throughput.
3. **Capture EXPLAIN on the parity lane for the section 5.3 hot paths (SB-4)** and add the confirmed indexes. This is cheap and converts three PREDICTED risks into decided ones.
4. **Add per-endpoint throttles with cost weighting (SB-3).** The bcrypt CPU exposure is the one measured saturation and it is a single-session denial of service.
5. **Decide on session/cache/queue placement (SB-2)** before exceeding low-hundreds of concurrent users; a no-Redis single-MariaDB design is fine for the current envelope but should be load-validated before that assumption is stretched.
6. **Strengthen the concurrency regression test (SB-5)** so the one measured concurrency guarantee actually demonstrates contention rather than tolerating serial execution.

---

## 10. Evidence index

| Claim | Artifact |
|---|---|
| Seeded volume, row counts, DB size | `artifacts/audit-2026-07-21/discovery/01-database-schema.md:58-114` |
| 20/53 empty tables caveat | `AUDIT_FINDINGS.md:309-317`; `discovery/01-database-schema.md:104-109` |
| Post-fix MariaDB suite timing (314 tests, 46.96 s, 85 MB, PHP 8.3.32) | `artifacts/audit-2026-07-21/evidence/mariadb-suite-postfix.txt:12,21-23` |
| Pre-fix MariaDB failures (7 fail / 3 err) and triage | `artifacts/audit-2026-07-21/evidence/mariadb-failure-triage.md`; `mariadb-suite-full.txt` |
| Concurrency test executes and passes (14 assertions, 3 scenarios) | `AUDIT_PROGRESS.md:259-262`; `AUDIT_COMMAND_LOG.md:115,122-124` |
| Concurrency test safe-but-weak (10 ms barrier) | `mariadb-failure-triage.md:224-230`; `tests/Support/MariaDbConcurrencyWorker.php:29-38` |
| CPU burst 0.01% -> 576.36% on change-password | `evidence/cpu-before.txt`, `evidence/cpu-during.txt`, `evidence/burst.txt`; scripts `evidence/req.sh`, `evidence/cj.txt`, `evidence/one.sh` |
| Unbounded tables / no retention | `discovery/01-database-schema.md:1602-1624`; `AUDIT_FINDINGS.md:303`; `PruneStaleNotifications.php:22-28` |
| DB-backed session/cache/queue | `backend/.env:31,50,52`; `discovery/01-database-schema.md:73,1626-1630` |
| Index gaps (structural, not EXPLAIN) | `discovery/01-database-schema.md:1510-1588`; `AUDIT_FINDINGS.md:304` |
| Shared throttle / expensive endpoints | `discovery/00-DISCOVERY-BASELINE.md:387-389` |
| State-mutating GET analytics cache warm | `discovery/00-DISCOVERY-BASELINE.md:394` |
| SQLite single-writer + WAL | `discovery/01-database-schema.md:69-73,1626-1630`; `backend/config/database.php:41-49` |
| Parity lane divergences (14) | `AUDIT_PROGRESS.md:258`; `docker/README.md` |
| No EXPLAIN captured anywhere | absence across `artifacts/audit-2026-07-21/` (verified by search) |
| Load harness unsafe default | `discovery/00-DISCOVERY-BASELINE.md:516` |
| e2e results (separate) | `PLAYWRIGHT_TEST_REPORT.md` (produced separately) |

---

*Prepared as part of the St Paul IM platform full-system audit, 2026-07. VERIFIED facts are executed and cited; PREDICTED figures are models and are labelled at every use. No empirical load test at 1k/10k/100k users or under sustained concurrency was performed; section 8 states why. This report states its boundaries deliberately, because it is destined for a hospital LAN and an audit that implies coverage it does not have would be worse than one that does not.*
