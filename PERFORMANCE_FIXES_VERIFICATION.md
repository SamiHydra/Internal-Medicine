# Performance fixes verification

**Date:** 2026-07-29

**Verdict:** PASS

**Stack:** HTTPS Nginx → PHP 8.3 FPM → Laravel → MariaDB 11.4

**Drivers:** database cache, database sessions, database queues
**Dataset:** existing seeded Docker audit MariaDB volume

All accepted work-order items are implemented. The standard 200-VU gate and
the extra 8-CPU hardware proxy pass. Redis was not added.

## Official cold/warm re-baseline

Each post-fix result is one cache-flushed cold request followed by 20 warm
requests through Nginx/TLS/FPM/MariaDB. `clinical_all` is now the server-clamped
one-year interactive window; a true all-time aggregation is no longer
available on the interactive path.

| Endpoint | Official cold before | Cold after | Warm p95 before | Warm p95 after | Payload after |
|---|---:|---:|---:|---:|---:|
| Academic summary | 669 ms | 699.6 ms | 37 ms | 37.4 ms | 633 B |
| Academic trend | 873 ms | 683.9 ms | 35 ms | 34.0 ms | 1,020 B |
| Academic people | 658 ms | 711.2 ms | 37 ms | 38.5 ms | 17,119 B |
| Clinical all-time / clamped interactive | 2,940 ms | 1,485.6 ms | 66 ms | 52.6 ms | 520,355 B |
| Clinical 8 weeks | 250 ms | 255.0 ms | 37 ms | 37.1 ms | 80,859 B |
| Undergraduate students | 557 ms | 596.7 ms | 43 ms | 60.6 ms | 119,378 B |
| Workspace default | 212 ms | 118.6 ms | 191 ms | 125.0 ms | 58,473 B |
| Workspace all-history request | 317 ms | 116.5 ms | 329 ms | 109.1 ms | 58,473 B |

The small individual academic cold variance does not recreate the old page
fan-out. The production page now requests one aggregate snapshot:

| Academic page measure | Before | After |
|---|---:|---:|
| Cold worker builds | 3 | 1 |
| Worker-build time | 2.139 worker-seconds | 671.1 ms |
| Approximate aggregate allocation | ~90 MiB | 30 MiB |
| Cold page total | three-request fan-out | 686.4 ms |
| Warm page p95 | 35–37 ms per view | 36.3 ms |
| Snapshot query count | repeated graphs | 17, with one evaluation graph |

Evidence:
`docker/audit/evidence/post-fix/phase6-pre-phase4/http-baselines.json` and
`docker/audit/evidence/post-fix/perf-01/academic-snapshot.json`.

## Load verification

The documented pass gates are: errors below 1% with no sustained 5xx,
workspace p95 below 1,000 ms, report-detail p95 below 1,500 ms, ordinary API
p95 below 500 ms where practical, no continuously growing FPM queue, database
connections below 80% of 151, and queue age within the notification SLA.

### Standard 200-VU/10-minute peak

| Measure | Official before | Post-fix before Phase 4 | Final post-Phase-4 | 8-CPU final |
|---|---:|---:|---:|---:|
| Successful requests | 134,628 | 142,879 | 147,465 | 136,718 |
| Successful RPS | 224.38 | 238.13 | 245.78 | 227.86 |
| Errors / timeouts | 0 / 0 | 3 / 0 | 0 / 0 | 0 / 0 |
| Workspace p95 | 330 ms | 151.7 ms | 126.8 ms | 322.5 ms |
| Report details p95 | 462 ms | 191.4 ms | 170.2 ms | 421.8 ms |
| Highest ordinary API p95 | 166 ms | 70.8 ms | 56.0 ms | 203.9 ms |
| FPM listen queue max | 44, drained | 80, drained | 5, drained | 35, drained |
| Database connections max | 22 | 21 | 17 | 22 |
| Worker RSS p95 | 46.87 MiB | 43.53 MiB | 42.64 MiB | 42.64 MiB |
| Gate | PASS | PASS | PASS | PASS |

The three pre-Phase-4 HTTP 500s were isolated database-session garbage
collection deadlocks: 0.0021% of attempts, no timeouts, and no sustained 5xx.
The final signed revision-poll path removes the database-session write from
that high-frequency request, and the final repeat completed with zero errors.

The 8-CPU run had an explicit `NanoCpus=8000000000` cap. FPM reached the
20-child ceiling and CPU saturation, but queue samples repeatedly returned to
zero rather than growing continuously. The app container was recreated after
the test and restored to `NanoCpus=0`.

Evidence:

- `docker/audit/evidence/post-fix/phase6-pre-phase4/runs/database/peak-200vu-10m/`
- `docker/audit/evidence/post-fix/phase6-post-phase4/runs/database/peak-200vu-10m-final-r2/`
- `docker/audit/evidence/post-fix/phase6-post-phase4/runs/database/peak-200vu-10m-8cpu/`

The directory `peak-200vu-10m-final/` is an explicitly marked invalid sample:
the first harness attempt did not yet forward the new revision credential.
`peak-200vu-10m-final-r2/` is the authoritative rerun.

### Baseline and spike

| Scenario | Successful requests | Successful RPS | Errors | Workspace p95 | Report p95 | Other max p95 | FPM queue |
|---|---:|---:|---:|---:|---:|---:|---|
| 10 VU / 2 min | 1,485 | 12.38 | 0 | 111.6 ms | 121.2 ms | 41.5 ms | 0 |
| Original 200-VU spike | audit baseline | 143.62 | 0 | 681 ms | 795 ms | 528 ms | 74, sustained |
| Post-fix 200-VU spike | 35,347 | 196.37 | 0 | 240.1 ms | 290.8 ms | 169.0 ms | 19, drained |

Evidence:
`docker/audit/evidence/post-fix/phase6-pre-phase4/runs/database/baseline-10vu-2m/`
and
`docker/audit/evidence/post-fix/phase6-pre-phase4/runs/database/spike-200vu-3m/`.

## Acceptance criteria

| Finding | Result | Verification |
|---|---|---|
| PERF-05 attendance index | PASS | MariaDB chose `student_attendance_student_present_index`, used both key parts, reported `using_index: true`, and did not create a temp/filesort stage. The migration passed up/down/up on the retained MariaDB volume and is safe on SQLite. |
| SCALE-05 load harness | PASS | One credential/cookie jar/session per VU; 200-VU documented default; setup excluded; attempted, successful, failed, and timed-out traffic separated; standard/spike mixes documented. The 10-VU smoke passed. |
| NAV-02 login LCP | PASS | Mobile LCP improved 3,166 → 1,625 ms, FCP 2,710 → 1,456 ms, TBT 25.5 ms, CLS 0, score 88 → 99. Desktop remained score 100 with 405 ms LCP. |
| NAV-04 guardrails | PASS | Payload/page-size contracts, per-chunk and 245-KiB gzip warning budgets, Lighthouse CI budgets, and sampled authenticated Web Vitals/route-transition RUM are present and tested. |
| PERF-01 academic snapshot | PASS | One cold page build, 671.1 ms instrumented, 30 MiB allocation, 17 queries, 36.3 ms warm p95; the second view does not hydrate the graph. |
| PERF-02 bounded analytics/export | PASS | Clinical, teaching, and student routes clamp to 366 days. The queued full-history export processed the 249,554-row source in 3.675 s, produced a 59.6-MB file, had zero measured peak-memory increase above its 24-MiB starting allocation, and delivered one completion notification. |
| PERF-03 workspace payload | PASS | Default payload is 58,473 B, reports/history are absent, period window is 22 rows, warm p95 is 125.0 ms, and the former all-history option remains bounded at the same size. |
| NAV-01 early navigation | PASS | Early Submissions p95 improved 1,358 → 265 ms; settled Submissions 238 → 121 ms; Users 160 → 67 ms; Audit 155 → 169 ms and remains below the 200-ms guardrail; Settings 195 → 134 ms. |
| PERF-04 revision ledger | PASS | 42 tables, 126 transactional triggers, successful rollback/reapply, and 20 concurrent writes produced 20 ledger increments with none lost. Full HTTPS endpoint p95 is 13.6 ms. A second browser tab observed a write in 43.961 s with the jitter pinned to the 45-s minimum. |
| SCALE-03 named queues | PASS | Analytics warm/export jobs dispatch to `analytics`; delivery/mail/digest work dispatches to `notifications`; two supervised workers have disjoint analytics/notification priorities; queue depth and oldest age are monitored every minute. |
| Phase 5 decisions | PASS | Redis, FPM sizing, deadline-spike, and retention decisions/questions are recorded without adding Redis or archival code. |

Supporting evidence:

- PERF-05: `docker/audit/evidence/post-fix/perf-05/`
- SCALE-05: `docker/audit/evidence/post-fix/phase1/scale-05-10vu-smoke.json`
- NAV-02/guardrails:
  `docker/audit/evidence/post-fix/phase6-pre-phase4/lighthouse-login-mobile.json`,
  `lighthouse-login-desktop.json`, and `bundle-budget.json`
- PERF-02: `docker/audit/evidence/post-fix/perf-02/`
- PERF-03: `docker/audit/evidence/post-fix/perf-03/workspace.json`
- NAV-01: `docker/audit/evidence/post-fix/nav-01/navigation.json`
- PERF-04: `docker/audit/evidence/post-fix/perf-04/` and
  `docker/audit/evidence/post-fix/phase6-post-phase4/revision-endpoint.json`
- SCALE-03: `docker/audit/evidence/post-fix/scale-03/`

## Frontend budgets

| Check | Result |
|---|---:|
| Initial raw graph | 340,761 B / 921,600-B budget |
| Initial gzip graph | 88,746 B / 266,240-B budget |
| Initial requests | 4 / 32 budget |
| Largest JavaScript chunk | 335,711 B raw / 409,600-B budget |
| Mobile login LCP / CLS / TBT | 1,625 ms / 0 / 25.5 ms |
| Desktop performance score | 100 |

## Regression validation

- Backend: 360 tests, 359 passed, 2,512 assertions, 1 skipped.
- Frontend: 18 files and 97 tests passed.
- Load-harness contract: 4 tests passed.
- ESLint, TypeScript, Vite production build, and performance budget passed.
- Docker MariaDB migration cycles, production browser flows, and database-only
  load gates passed.

## Work-item commits

| Commit | Work item |
|---|---|
| `cb49bc0` | PERF-05 attendance covering index |
| `3b37fe9` | SCALE-05 corrected load sessions/results |
| `072cd72` | NAV-02 mobile login critical path |
| `ca9cb5a` | NAV-04 regression guardrails |
| `888a3af` | PERF-01 academic aggregate snapshot |
| `0c001be` | PERF-02 bounded analytics and queued exports |
| `05e46cd` | PERF-03 workspace bootstrap trimming |
| `397caa5` | NAV-01 responsive admin startup |
| `1052e46` | PERF-03/SCALE-05 report-detail load mix preservation |
| `b286ecf` | PERF-04 transactional revision ledger |
| `f9ba9a4` | SCALE-03 named queue isolation |
| `f7d059d` | PERF-04 stateless signed revision polling |
| `0c8bd0c` | SCALE-05 per-VU revision credential |
| `140ec93` | PERF-06/SCALE-07 production decision records |

## Remaining release condition

The Docker-on-development-host results are an early-warning proxy. The same
200-VU standard gate must still pass on the final hospital server before
go-live, as required by the original audit and work order.
