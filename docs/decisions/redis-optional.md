# Redis remains optional

## Decision

Database-backed cache, sessions, and queues are the accepted initial production
configuration for the single-server hospital deployment. Redis is an optional
headroom optimization, not a launch requirement.

## Evidence

The production-shaped database-driver audit completed the standard
200-VU/10-minute gate at 224.38 successful requests/second with zero errors.
Workspace and report-detail p95 were 330 ms and 462 ms, and the FPM queue
drained. The raw evidence is in
`docker/audit/evidence/runs/database/peak-200vu-10m-r1/`.

The post-fix repeat improved to 245.78 successful requests/second with zero
errors. Workspace and report-detail p95 were 126.8 ms and 170.2 ms. Evidence is
in
`docker/audit/evidence/post-fix/phase6-post-phase4/runs/database/peak-200vu-10m-final-r2/`.

Persistent Redis measured about 5.8% more throughput and roughly 22% lower p95
latency in the original audit. That benefit does not justify adding another
mandatory production dependency while the database configuration passes.

## Constraint if Redis is adopted

Persistent connections or equivalent connection pooling are mandatory. The
non-persistent Redis test failed at 6.62% errors because the application
container exhausted client ephemeral ports; Redis itself reported no rejected
connections. That evidence is in
`docker/audit/evidence/runs/redis/peak-200vu-10m/`.

Any future Redis change must enable the repository's persistent connection
option and repeat the standard peak and spike gates on the target hardware.
