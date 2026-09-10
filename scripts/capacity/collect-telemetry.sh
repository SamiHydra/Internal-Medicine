#!/usr/bin/env bash
#
# Samples container CPU/memory, MariaDB connection/lock counters, PHP-FPM pool
# state and queue depth every N seconds while a load stage runs, into one CSV
# per sample kind (docs/CAPACITY_TEST_REPORT.md). Host-side: needs the docker
# CLI and the parity stack of compose.yaml.
#
#   scripts/capacity/collect-telemetry.sh <output-dir> [interval-seconds]
#   ... kill the process (or its PID file) to stop.

set -Eeuo pipefail

OUT="${1:?output directory}"
INTERVAL="${2:-5}"
mkdir -p "${OUT}"

DB_ROOT_PASSWORD="${DB_ROOT_PASSWORD:-local-parity-stack-root}"

echo "timestamp,container,cpu_percent,mem_usage,mem_percent,net_io,block_io,pids" > "${OUT}/docker-stats.csv"
echo "timestamp,variable,value" > "${OUT}/mariadb-status.csv"
echo "timestamp,pool,processes,active,idle,listen_queue,max_listen_queue,max_children_reached,slow_requests" > "${OUT}/php-fpm.csv"
echo "timestamp,queue,depth,oldest_age_seconds,failed_jobs" > "${OUT}/queue.csv"

echo $$ > "${OUT}/telemetry.pid"

while true; do
  ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

  docker stats --no-stream --format '{{.Name}},{{.CPUPerc}},{{.MemUsage}},{{.MemPerc}},{{.NetIO}},{{.BlockIO}},{{.PIDs}}' \
    2>/dev/null | grep '^imreport-parity-' | sed "s/^/${ts},/" >> "${OUT}/docker-stats.csv" || true

  docker compose exec -T db mariadb -uroot -p"${DB_ROOT_PASSWORD}" -N -B -e \
    "SHOW GLOBAL STATUS WHERE Variable_name IN ('Threads_connected','Threads_running','Max_used_connections','Innodb_row_lock_waits','Innodb_row_lock_time','Innodb_deadlocks','Slow_queries','Queries','Aborted_connects','Connection_errors_max_connections');" \
    2>/dev/null | awk -v ts="${ts}" -F'\t' '{print ts","$1","$2}' >> "${OUT}/mariadb-status.csv" || true

  # PHP-FPM status page, reached from inside the nginx container (localhost only).
  docker compose exec -T web curl -sk https://127.0.0.1/fpm-status 2>/dev/null \
    | awk -v ts="${ts}" -F': *' '
        /^pool:/ {pool=$2}
        /^total processes:/ {total=$2}
        /^active processes:/ {active=$2}
        /^idle processes:/ {idle=$2}
        /^listen queue:/ {lq=$2}
        /^max listen queue:/ {mlq=$2}
        /^max children reached:/ {mcr=$2}
        /^slow requests:/ {slow=$2}
        END {if (pool != "") print ts","pool","total","active","idle","lq","mlq","mcr","slow}' \
    >> "${OUT}/php-fpm.csv" || true

  docker compose exec -T db mariadb -uroot -p"${DB_ROOT_PASSWORD}" -N -B -e \
    "SELECT q.queue, q.depth, q.oldest, (SELECT COUNT(*) FROM imreport.failed_jobs) FROM (SELECT queue, COUNT(*) depth, COALESCE(UNIX_TIMESTAMP() - MIN(created_at), 0) oldest FROM imreport.jobs GROUP BY queue UNION ALL SELECT 'all', COUNT(*), COALESCE(UNIX_TIMESTAMP() - MIN(created_at), 0) FROM imreport.jobs) q;" \
    2>/dev/null | awk -v ts="${ts}" -F'\t' '{print ts","$1","$2","$3","$4}' >> "${OUT}/queue.csv" || true

  sleep "${INTERVAL}"
done
