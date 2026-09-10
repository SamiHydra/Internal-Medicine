# Reliability targets

**PROPOSED ENGINEERING TARGETS. REQUIRE HOSPITAL IT/OWNER APPROVAL.**

These numbers are starting points chosen from what the parity environment
measured (`docs/CAPACITY_TEST_REPORT.md`, `docs/FAILURE_RECOVERY_TEST_REPORT.md`)
and from what the department's workflow tolerates (a weekly report, an
evaluation, a morning-session record). None of them has been approved by the
hospital; they exist so that the first month of production has something
concrete to compare against, and so the alert thresholds in
`docs/OBSERVABILITY.md` are not arbitrary.

Status date: 2026-09-07. Owner of the numbers after go-live: the department
administrator with Hospital IT.

## 1. Application

| Objective | Target | How it is measured | Where it is enforced now |
|---|---|---|---|
| Standard API latency | p95 < 500 ms, p99 < 1000 ms for the routine endpoints (workspace, report detail, notifications, academic options) at the expected load (up to 100 concurrent users) | `Server-Timing` header, the load harness (`npm run load:test`), slow-request log | parity capacity run; `SLOW_REQUEST_MS=1000` logs breaches |
| Sign-in latency | p95 < 1000 ms (bcrypt cost 12 is deliberate) | load harness login phase | parity capacity run |
| Heavy admin views | dashboard analytics p95 < 1500 ms cold, < 300 ms warm; submissions board p95 < 800 ms | harness `analytics-dashboard`, `reports-window` | parity capacity run; QA-028 baseline |
| HTTP server error rate | < 0.5 % of requests over any hour; zero sustained 5xx | health counters, `laravel.log`, webhook | `ObservabilityTest`; health view |
| Availability | 99.5 % during 07:00 to 19:00 hospital time (about 1.5 h/month of unplanned downtime) | uptime probe on `/up` every minute (Hospital IT monitor) | `/up` liveness; `deploy.sh` post-switch probe |
| Deploy downtime | under 60 s in maintenance mode per deploy | `deploy.sh` timestamps | atomic release switch |

## 2. Queues

| Objective | Target | Alert |
|---|---|---|
| Normal queue wait | a queued export or delivery starts within 30 s | `queue:monitor-health` warns above `QUEUE_OLDEST_WARNING_SECONDS` (300, recommended 120) |
| Backlog | fewer than 100 waiting jobs on any queue | `QUEUE_DEPTH_WARNING` (100) |
| Failed jobs | zero per day in steady state; any failure investigated within one working day | health view `failedJobs.last24h`, webhook `failed_job` |
| Worker liveness | both worker units active at all times | `app:launch-readiness --strict` (nightly), health view |

## 3. Scheduler

| Objective | Target | Alert |
|---|---|---|
| Heartbeat age | < 2 minutes | health view warns at 5 minutes (readiness), recommended monitor at 2 |
| Reminder delivery | 08:15 and 17:00 wall-clock jobs run within 2 minutes of schedule | `schedule.log` |

## 4. Data protection (example only, not approved)

| Objective | Target | Basis |
|---|---|---|
| Recovery point objective (RPO) | 24 h or better (nightly 02:00 dump plus storage archive) | `deploy/backup.sh`; a mid-day dump before every deploy |
| Recovery time objective (RTO) | 2 h from decision to restored service (database dump 8.6 MB restores in seconds on parity; the time is in the decision and the host work) | `docs/OPERATIONS.md` "Real restore"; rehearsed on parity 2026-09-06 |
| Backup verification | monthly restore drill; strict readiness fails after 90 days without one | `BACKUP_RESTORE_VERIFIED_AT` |
| Off-box copy | every dump copied to the secondary location the same night | `backup.sh` exits non-zero without it |

## 5. Capacity

| Objective | Target | Basis |
|---|---|---|
| Concurrent users | the department's realistic peak (about 60 to 100 simultaneous users at a submission deadline) with the targets in section 1 intact | `docs/CAPACITY_TEST_REPORT.md` (parity result, not production) |
| Growth | three years of weekly reports and evaluations without index changes | `docs/LARGE_DATA_REHEARSAL.md` |
| Disk | at least `MIN_FREE_DISK_GB` (5 GB) free at all times | readiness, health view |

## 6. Review cadence

- First review after the first full month in production, comparing the
  health counters, the slow-request log and the load harness re-run on the
  real host against this table.
- Any change to a number here is a change to `docs/OBSERVABILITY.md`
  thresholds and, where relevant, to `backend.env` (`SLOW_REQUEST_MS`,
  `QUEUE_DEPTH_WARNING`, `QUEUE_OLDEST_WARNING_SECONDS`, `MIN_FREE_DISK_GB`).
