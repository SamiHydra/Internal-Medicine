#!/usr/bin/env bash
#
# Runs the capacity stages against the Docker parity stack and collects the
# harness summary plus host telemetry for each (docs/CAPACITY_TEST_REPORT.md).
#
#   scripts/capacity/run-stages.sh [stages...]        default: 25 50 100 200 300
#
# Environment (all optional):
#   LOAD_BASE_URL          https://localhost:8443
#   LOAD_CREDENTIALS_FILE  artifacts/load-tests/parity-credentials.csv
#   STAGE_DURATION_SECONDS 90     measured seconds per stage
#   STAGE_RAMP_SECONDS     20
#   LOAD_PROFILE           mixed
#   CAPACITY_OUT           artifacts/load-tests/capacity-<timestamp>
#
# The login limiter is 10/min per IP; the parity stack trusts proxy headers
# (TRUSTED_PROXIES=*), so the harness's synthetic source addresses
# (LOAD_SYNTHETIC_SOURCE_IPS=1) give every session its own bucket, as the
# 2026-07 audit did. Never set that against a target you do not own.

set -Eeuo pipefail

STAGES=("$@")
if [ "${#STAGES[@]}" -eq 0 ]; then
  STAGES=(25 50 100 200 300)
fi

export LOAD_BASE_URL="${LOAD_BASE_URL:-https://localhost:8443}"
export LOAD_FRONTEND_ORIGIN="${LOAD_FRONTEND_ORIGIN:-https://localhost:8443}"
export LOAD_CREDENTIALS_FILE="${LOAD_CREDENTIALS_FILE:-artifacts/load-tests/parity-credentials.csv}"
export LOAD_PROFILE="${LOAD_PROFILE:-mixed}"
export LOAD_DURATION_SECONDS="${STAGE_DURATION_SECONDS:-90}"
export LOAD_RAMP_SECONDS="${STAGE_RAMP_SECONDS:-20}"
export LOAD_SYNTHETIC_SOURCE_IPS=1
export LOAD_PREPARATION_CONCURRENCY="${LOAD_PREPARATION_CONCURRENCY:-8}"
# The stack's certificate is self-signed.
export NODE_TLS_REJECT_UNAUTHORIZED=0

OUT="${CAPACITY_OUT:-artifacts/load-tests/capacity-$(date -u +%Y%m%dT%H%M%SZ)}"
mkdir -p "${OUT}"
echo "Capacity run -> ${OUT}"

for users in "${STAGES[@]}"; do
  stage_dir="${OUT}/stage-${users}"
  mkdir -p "${stage_dir}"
  echo "=== Stage: ${users} users (${LOAD_DURATION_SECONDS}s + ${LOAD_RAMP_SECONDS}s ramp) ==="

  # Let the previous stage's queue drain and the cache settle.
  sleep 10

  scripts/capacity/collect-telemetry.sh "${stage_dir}/telemetry" 5 > /dev/null 2>&1 &
  telemetry_pid=$!

  LOAD_USERS="${users}" LOAD_OUTPUT="${stage_dir}/summary.json" \
    node scripts/load-test.mjs > "${stage_dir}/harness.log" 2>&1 || echo "stage ${users}: harness exited non-zero (see harness.log)"

  kill "${telemetry_pid}" 2>/dev/null || true
  wait "${telemetry_pid}" 2>/dev/null || true

  # Application-side signals for the stage: 5xx counters, slow requests, failed jobs.
  docker compose logs --since 3m app 2>/dev/null | grep -ci "slow" > "${stage_dir}/fpm-slowlog-lines.txt" || true
  docker compose exec -T app sh -c 'tail -n 200 storage/logs/laravel.log' > "${stage_dir}/laravel-log-tail.txt" 2>/dev/null || true

  node -e '
    const fs = require("fs");
    const s = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    console.log(`users=${s.users} requests=${s.totalRequests} rps=${s.successfulRps} err=${(s.errorRate*100).toFixed(2)}% timeouts=${s.totalTimeouts} p50=${s.overall.p50Ms} p95=${s.overall.p95Ms} p99=${s.overall.p99Ms} max=${s.overall.maxMs}`);
  ' "${stage_dir}/summary.json" 2>/dev/null || true
done

echo "Done: ${OUT}"
