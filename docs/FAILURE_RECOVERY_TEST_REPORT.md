# Failure and recovery test report

Controlled failures injected into the Docker parity stack (Linux, nginx,
PHP-FPM 8.3, MariaDB 11.4, two queue workers, scheduler, production bundle,
`APP_ENV=production`) with disposable seeded data. No real data was involved.
Harness: `scripts/chaos/run-failure-drills.sh` (Docker orchestration) and
`scripts/chaos/probe.mjs` (authenticated HTTP checks with the CSRF and
cookie handling curl under Git Bash gets wrong). Evidence:
`artifacts/chaos/drills*/` (logs, `results.txt`, response bodies).

Status date: 2026-09-09 (drills run 2026-09-07 and 2026-09-09). Rollback is
a separate rehearsal: `docs/ROLLBACK_REHEARSAL.md`.

Legend: **VERIFIED** observed as expected; **PARTIALLY VERIFIED** observed
with a caveat; **DEFECT FOUND** a change was required (its status is given).

## Summary

| Failure | Expected | Actual | Recovery time | Data integrity | User-visible result | Change required | Status |
|---|---|---|---|---|---|---|---|
| A. Queue worker killed | export stays pending, completes after restart | export `pending` with depth 1 while both workers were stopped; `ready` 3 s after restart; 0 failed jobs | 3 s | no corruption; queue row consumed exactly once | "pending" in the export list, then the download appears | none | VERIFIED |
| B. MariaDB stopped under traffic | honest failures, no false success, self-recovery | reads and writes answered **500** (no false 201/200); `/up` stayed 200; after restart `/up` 200 in 1 s; first successful authenticated read after **188 s** (run 1) / 24 s (run 2); report count identical before and after; queue recovered, 0 failed jobs | 24 to 188 s | intact (5,819 reports before and after) | a red "Unable to load the signed-in workspace" toast, then normal service | connect timeout bounded (`DB_CONNECT_TIMEOUT`, default 5 s); `/up` documented as liveness only | DEFECT FOUND, fixed, re-run VERIFIED (36 s recovery, see addendum) |
| C. PHP-FPM stopped | nginx reports unhealthy; `/up` unhealthy; recovers | `/up` **504**, `/api/workspace` 504, the SPA shell still 200 (static); recovered in 139 s on parity (the container re-runs migrations and the seed on start; on the host an FPM restart is about a second) | 139 s (parity artefact) | n/a | "Connection issue" screen; retries succeed after recovery | none (parity-only: nginx needed a restart to pick up the container's new address, documented in `docs/PARITY_ENVIRONMENT.md`) | VERIFIED |
| D. Whole stack restarted | services return, database and queue and uploads intact, healthy automatically | all six services back, `/up` 200 in 143 s, reports 5,819 before and after, 0 queued jobs lost, 116 of 116 uploaded files present, authenticated read 200, no operator action | 143 s (dominated by the parity entrypoint's reseed) | intact | users see the connection screen during the restart, then normal service | none | VERIFIED |
| E. Storage unavailable during an evidence upload | upload fails loudly, no metadata row, no orphan file | **201 with a metadata row and no file on disk** (run 1: rows 0 to 1, files 0); the download link pointed at a file that did not exist | n/a | orphan metadata produced | a success response for a lost file | evidence upload now refuses (500 with a plain message) before any row is written when the disk reports a failed write; regression test added | DEFECT FOUND, fixed, re-run VERIFIED (`ActionItemTest::test_evidence_upload_refuses_and_records_nothing_when_storage_cannot_write`; addendum) |
| F. Disk pressure | readiness detects low disk | with the threshold raised above the free space (920 GB free, threshold 1,020 GB): `app:launch-readiness` **FAIL** on "Free disk above threshold", the health snapshot **fail** and overall `unhealthy` | immediate | n/a | health page shows the failing check | none | VERIFIED (simulated by threshold; the disk was not filled) |
| G. Network latency 100 / 300 / 1000 ms on the app container | critical workflows still complete | with 100 ms: workspace 2.3 s (run 1) / 9.0 s (run 2), report list 0.3 / 4.9 s, `/up` 0.2 / 0.4 s; 300 ms: workspace 24 s, report list 14 s; 1000 ms: workspace 80 to 84 s, report list 46 to 52 s, `/up` 2.2 s; every request completed with 200 | n/a | n/a | the app works but the bootstrap becomes a long wait; the client's 15 s read timeout would abandon the workspace request at 300 ms and above | none for the host (see the note); finding recorded | PARTIALLY VERIFIED |

Post-drill state after every run: stack healthy, 0 failed jobs.

## A. Queue worker

Both worker containers were stopped, an administrator requested a CSV export
(`POST /api/analytics/exports` answered 201 with the export id), the export
row stayed `pending` and the `jobs` table held one row for the 20 s the
workers were down. After `docker compose start` the job ran and the export
was `ready` 3 s later; `failed_jobs` stayed empty. Nothing was duplicated: one
job, one file.

## B. MariaDB restart

The database container was stopped for about two minutes while the probe
kept reading and writing. Every authenticated read and write answered 500
with the generic "Server Error" body (the SPA renders "Unable to load the
signed-in workspace"); no request claimed success. `/up` stayed 200
throughout, which is by design: Laravel's `/up` proves the framework boots and
is the deploy and process-monitor probe; database health is reported by the
maintenance snapshot and `app:launch-readiness`. The runbooks now say so.

After the restart `/up` was 200 within a second, but the first successful
authenticated read took 188 s in one run and 24 s in the other. The
difference is explained by how the failure presents: a stopped container's
address drops packets rather than refusing connections, so PHP workers that
were mid-connect hung until the operating system's TCP timeout, the pool of
20 children filled with hung workers, and healthy requests queued behind
them. On the real host MariaDB is local, so a stopped service refuses
immediately and this path is not taken; a hung (not stopped) database would
behave like the parity case. Change: `config/database.php` now sets
`PDO::ATTR_TIMEOUT` from `DB_CONNECT_TIMEOUT` (default 5 s) so a worker
blocked on connect is released in seconds. Runtime re-check after rebuilding
the image: see the addendum at the end of this document.

Data: 5,819 reports before, 5,819 after; sessions (database-backed) were lost
with the restart, so users signed in again; the queue resumed with 0 failed
jobs.

## C. PHP-FPM stop

With the `app` container stopped, nginx answered **504** for `/up` and for
the API, and 200 for the static SPA shell (which then shows the connection
screen). This is the correct unhealthy signal for a process monitor and for
`deploy.sh`. Recovery on parity took 139 s because the container's entrypoint
re-runs migrations, the seed and the cache build on every start; on the host
`systemctl restart php8.3-fpm` takes about a second and `deploy/nginx.conf`
talks to a unix socket, so the parity-only nginx restart (the container got a
new address) does not apply.

## D. Whole-stack restart

`docker compose restart` of all six services. Healthy in 143 s with no
operator action; reports, queued jobs and 116 uploaded files unchanged;
authenticated reads worked once the sessions were re-established.

## E. Storage unavailable (defect)

The evidence directory was made read-only (`chmod 500` on the item directory
and its parent inside the container). An upload then answered **201** with an
evidence row whose `downloadUrl` pointed at a file that did not exist (run 1:
rows 0 to 1, files in the directory 0). Root cause: the `local` disk is
configured with `throw => false`, so `putFileAs` returns `false` on failure,
and `ActionItemEvidenceController::store` ignored the return value and
inserted the row.

Fix: the controller now throws `StorageWriteFailedException` when the disk
reports a failed write, before any row, history entry or audit row is
written. It renders as 500 with: "The evidence file could not be written to
the server's storage, so nothing was saved. Ask an administrator to check the
storage disk and its permissions, then try again." The exception is
reportable, so it is logged, counted and forwarded like any other server
error (`docs/OBSERVABILITY.md`). Regression test: the disk is mocked to
return `false`; the response is 500 with that message, the evidence table
stays empty and no `upload_evidence` audit row exists. The second drill run
(files present, rows added) shows the read-only bit did not always take on
the shared volume; the fixed path no longer depends on it.

## F. Disk pressure

Filling the workstation's disk was not attempted. Instead `MIN_FREE_DISK_GB`
was raised above the free space: readiness reported `FAIL 920.1 GB free
(threshold 1020 GB)` and the health snapshot reported the check as `fail`
with overall status `unhealthy`. Both detection paths work; the host value
stays at 5 GB.

## G. Network latency

`tc netem` added 100, 300 and 1000 ms of delay to the app container's
interface, which affects every hop the app makes (nginx to FPM and FPM to
MariaDB). All requests still completed with 200, but the workspace bootstrap
grew to 2 to 9 s at 100 ms, 24 s at 300 ms and 80 to 84 s at 1000 ms, while
`/up` scaled linearly (0.2, 0.8, 2.2 s). The workspace request therefore
issues on the order of 80 database round trips, each paying the injected
delay twice. On the department server the database is local (sub-millisecond
round trips), so this does not affect the real deployment; it would matter
only if the database were ever moved to another machine, in which case the
bootstrap should be re-measured against the 15 s client timeout for reads.
Recorded as an accepted, monitored finding.

## Not applicable on parity

- Systemd unit restarts and the cron scheduler exist only on the host; the
  parity stack runs the same commands as containers (`docs/PARITY_ENVIRONMENT.md`).
- Real disk exhaustion and a real backup destination outage need the host.

## Addendum: re-run after the fixes (2026-09-09)

Parity images rebuilt from the fixed tree (`RELEASE_SHA` stamped
`-hardening2`), then `scripts/chaos/run-failure-drills.sh artifacts/chaos/drills-refix storage mariadb`:

| Drill | Before the fix | After the fix |
|---|---|---|
| E. Storage unavailable | 201, evidence row written, no file on disk | **500** with "The evidence file could not be written to the server's storage, so nothing was saved. Ask an administrator to check the storage disk and its permissions, then try again."; rows 0 to 0, no file; after the directory was restored the same upload answered 201 (rows 1) |
| B. MariaDB stopped under traffic | reads/writes 500, `/up` 200; first successful authenticated read 188 s (run 1) / 24 s (run 2) after restart | reads/writes 500, `/up` 200; `/up` 200 immediately and the first successful authenticated read **36 s** after restart (bounded by the 5 s connect timeout plus the session re-login); 1,443 reports before and after; 0 failed jobs; stack healthy at the end |

Both rows of the summary table are therefore VERIFIED with the changes in place.
