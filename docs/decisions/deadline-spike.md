# Submission-deadline spike

## Observation

The original database-driver 0-to-200-VU ramp over 60 seconds completed with
zero errors, but PHP-FPM listen queue stayed elevated at roughly 50–74. That
made the burst an operational capacity warning even though requests did not
fail.

After the analytics, payload, navigation, and revision-poll fixes, the same
200-VU spike completed 35,347/35,347 requests at 196.37 successful
requests/second with zero errors. Workspace and report-detail p95 fell to
240.1 ms and 290.8 ms, and the FPM queue peaked at 19 and repeatedly drained to
zero. Evidence is in
`docker/audit/evidence/post-fix/phase6-pre-phase4/runs/database/spike-200vu-3m/`.

## Operational action

Keep the Phase 2/3 application fixes and monitor FPM listen queue during real
submission deadlines. The final release gate must still run on
hospital-comparable hardware.

## Department decision required

Can submission deadlines be staggered by department, service line, or cohort
instead of making every user submit in the same minute? The department should
answer this in writing before go-live. Staggering is operational headroom, not
a substitute for the release load test.
