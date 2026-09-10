# Large-data MariaDB rehearsal

A disposable, synthetic, production-scale archive on the Docker parity stack
(MariaDB 11.4, PHP-FPM 8.3, nginx, production bundle, `APP_ENV=production`),
measured for seeding time, size, endpoint latency, export time, query plans
and backup/restore time. No real hospital data was used. Harness:
`scripts/large-data/measure.sh` (row counts, sizes, timings, slow log,
EXPLAIN, dump and restore) and `scripts/large-data/measure-endpoints.mjs`
(one sign-in, cold then warm requests). Raw artefacts:
`artifacts/large-data/measure-208w/` and `artifacts/large-data/seed-208w.log`.

Status date: 2026-09-09.

## 1. The dataset

`SEED_HISTORY_WEEKS=208` (four years of weekly reporting periods, plus the
26-week look-ahead the seeder always adds) with the development fixture's
30 nurses across 27 departments, 12 administrators, 70 residents, 70
consultants, 6 student representatives, and the academic fixture, which is
deliberately one trailing year deep (its volume does not scale with the
clinical history; the projection for three academic years is in
`docs/decisions/data-retention-policy-question.md`).

| Table | Rows |
|---|---:|
| `reports` | 5,887 |
| `report_field_values` | 501,387 |
| `reporting_periods` | 235 |
| `users` | 184 |
| `evaluations` / `evaluation_answers` | 3,720 / 35,060 |
| `morning_attendance` | 22,400 |
| `student_attendance` | 10,300 |
| `duty_assignments` | 2,100 |
| `audit_logs` (cell edits) | 1,080 |
| `notifications` | 759 |
| `teaching_sessions` | 418 |
| `subgroup_placements` | 86 |
| `action_items` | 69 |
| `admin_audit_logs` | 66 |
| `report_status_history` | 0 (the seeder writes reports directly; live use adds one row per transition) |

For comparison the go-live archive is empty and the earlier fixture (52
weeks) holds 1,443 reports; four years of the department's real weekly filing
at 30 assignments is about 6,200 reports, so this set is the right order of
magnitude for "three to five years".

## 2. Seeding and size

| Measure | Value |
|---|---|
| `migrate:fresh --seed` wall time (in the app container) | 9 min 48 s |
| of which reference data and periods | 3.3 s |
| of which `DevUserSeeder` (bcrypt cost 12, 184 accounts) | 66 s |
| of which `DevClinicalDataSeeder` (5,887 reports, 501k values) | 160 s |
| of which `DevAcademicDataSeeder` (one year) | 308 s |
| of which governance data | 5 s |
| Database size (data + indexes) | 190.2 MB |
| Index share | 116.0 MB |
| Largest table | `report_field_values`: 60.6 MB data, 94.9 MB indexes, 155.5 MB total |
| Next largest | `morning_attendance` 7.5 MB, `evaluation_answers` 7.0 MB, `student_attendance` 6.1 MB, `evaluations` 4.6 MB, `reports` 4.2 MB |

Observation: the cell-value table carries more index than data. That is the
cost of the EAV layout's three indexes (report, field definition and the
unique triple) and is what makes the aggregation queries index-only; it is
not a defect at this size (155 MB for four years) and the growth is linear.

## 3. Endpoint latency on the four-year archive

Authenticated as the Maintenance account through nginx, first request after
`cache:clear` (cold) then three warm requests, with the stack otherwise idle.

| Endpoint | Cold | Warm | Payload | Note |
|---|---:|---:|---:|---|
| Workspace bootstrap (`/api/workspace`, default window) | 152 ms | 105 to 114 ms | 97 KB | the reporting window bounds it, not the archive |
| Dashboard analytics, whole four-year range (`dateFrom=2022-01-01`) | 2,355 ms | 40 to 48 ms | 362 KB | cold build over 501k cells, then cached |
| Report listing, default window (`perPage=300`) | 94 ms | 92 to 94 ms | 157 KB | |
| Report listing, whole archive (`reportPeriodWindow=all`, capped at 104 periods) | 107 ms | 105 to 110 ms | 203 KB | the cap keeps the payload bounded |
| User search (`/api/admin/users?search=abel`) | 56 ms | 61 to 68 ms | 41 KB | |
| Status history (`perPage=100`) | 32 ms | 26 to 28 ms | 86 B | |
| Notifications | 29 ms | 29 to 30 ms | 9.6 KB | |
| Users directory (`/api/admin/users`, 184 accounts) | 68 ms | 55 to 63 ms | 41 KB | |
| Administrative audit trail | 39 ms | 37 to 42 ms | 37 KB | capped page |
| Cell edit trail (`/api/admin/audit-logs`) | 59 ms | 53 to 57 ms | 60 KB | capped page |
| Academic summary (`/api/academic/analytics/summary`) | 728 ms | 28 to 30 ms | 629 B | content-stamp cache |
| Academic snapshot | 33 ms | 31 to 33 ms | 19 KB | |
| Academic evaluations listing (admin) | 122 ms | 113 to 119 ms | 21 KB | |
| Action items | 54 ms | 47 ms | 57 KB | |
| Dashboard analytics with no date filter (whole archive) | 2,827 ms | 45 to 47 ms | 522 KB | the SPA always sends the 8-week window by default; "All" is a user choice |
| Analytics overview with no date filter (whole archive) | 2,796 ms | 2,783 to 2,866 ms | 49 KB | **not cached**; not called by the SPA (tests and the load harness only) |

Reading: every screen the users open is bounded by the reporting window or a
page cap and stays in the tens of milliseconds at four years; the whole-archive
analytics build is the one operation that grows with the archive (0.3 s at one
year in the capacity report, 2.8 s at four), and it is cached after the first
read and rebuilt in the background after writes. The uncached overview endpoint
is an API-only path (no SPA caller); it is recorded in the ledger as
accepted-monitor with the recommendation to cache it like the dashboard or
retire it.

## 4. Export

| Export | Result |
|---|---|
| Whole four-year archive, XLSX | refused by design: "That range covers 5,597 reports, over the 5,000 limit. Narrow the wards or dates." (`reports.analytics_export` ceiling; the check runs before anything is queued) |
| One year (2025-09-01 to 2026-09-09), XLSX | accepted (202), built by the analytics worker: 1,435 rows, ready about 5 s after the request |

The 5,000-report ceiling is the right safeguard for the memory of a single
export job; a department that wants a multi-year extract does it per year.

## 5. Slow query log and query plans

MariaDB on parity logs every query over 0.5 s and every query that uses no
index (`log_queries_not_using_indexes=1`, which production does not enable).
After seeding, the endpoint runs, the export and the dump:

| Measure | Value |
|---|---|
| Log entries (mostly unindexed small lookups counted by that flag) | 196,847 |
| Entries over the 0.5 s threshold | 175 |
| Slowest application query over the threshold | none: the slowest entries are `mariadb-dump`'s own full-table reads of `report_field_values` (0.8 to 0.9 s each) and this rehearsal's row-count statement (0.5 s) |
| Maximum query time in the log | 24.4 s, from the 2026-09-07 latency drill (1,000 ms of injected delay per hop), not from normal operation |

EXPLAIN on the representative statements (`artifacts/large-data/measure-208w/backup/explain.txt`):

| Statement | Plan |
|---|---|
| Submissions board window (newest 9 periods, 300 rows) | index `reports_period_updated_index`; the only `ALL` is the 9-row derived table of periods |
| Field values aggregated for a 9-period window | `report_field_values_unique` and the period index, index-only on the join |
| Whole-archive aggregation by period | index scan of `report_field_values_unique` (501k rows; this is the 2.8 s cold dashboard) |
| User search (`LIKE '%abel%'`) | full scan of `users` (184 rows); inherent to a substring search and negligible at this size |
| Administrative audit trail, status history, evaluations listing | index on the ordering column, `Using index` |
| One report's cell values | `report_field_values_unique`, index-only |

No index was added: nothing in the measurements pointed at a missing one.

## 6. Backup and restore

| Measure | Value |
|---|---|
| `mariadb-dump --single-transaction --quick` of the four-year database, gzip level 6 | 27.6 MB in 5 s |
| Restore into a scratch database (`gunzip | mariadb`) | 22 s; 5,887 reports present afterwards |

At this size the nightly dump and the restore drill in `docs/OPERATIONS.md`
stay well inside the proposed RTO; the storage archive (uploads) is measured
separately in the 2026-09-06 release validation.

## 7. Memory

The app container stayed at 42 to 176 MB across the capacity stages on the
one-year fixture; on the four-year archive the whole-archive dashboard build
completed without approaching the 256 MB `memory_limit`, and the export
ceiling keeps the one job that could grow unbounded from doing so.

## 8. Conclusions

- Four years of weekly reporting is 190 MB and every user-facing screen stays
  in the tens of milliseconds; nothing needs an index or a schema change.
- The only archive-proportional cost is the whole-archive analytics build
  (2.8 s cold, cached afterwards), already an accepted-monitor item from the
  capacity run; its trigger is the "All" range on the dashboard.
- Exports are bounded by the 5,000-report ceiling; multi-year extracts are
  done per year.
- Backup and restore of the full archive take seconds.
- Not measured: the academic tables beyond one year (fixture design); their
  growth projection is in `docs/decisions/data-retention-policy-question.md`.
