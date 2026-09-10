#!/usr/bin/env bash
#
# Large-data rehearsal measurements against the Docker parity stack
# (docs/LARGE_DATA_REHEARSAL.md). Run after seeding the stack with a deep
# archive, e.g.
#   docker compose exec -T -e SEED_HISTORY_WEEKS=208 -e APP_ENV=local app \
#     php artisan migrate:fresh --seed --force
#
#   scripts/large-data/measure.sh [output-dir]
#
# Produces: table sizes and index sizes, row counts, cold and warm endpoint
# timings (authenticated as the maintenance account through the real nginx),
# the slow-query log summary, EXPLAIN for the heaviest statements, and the
# backup dump size and duration plus a restore into a scratch database.

set -Eeuo pipefail

OUT="${1:-artifacts/large-data/$(date -u +%Y%m%dT%H%M%SZ)}"
mkdir -p "${OUT}"
DB_ROOT_PASSWORD="${DB_ROOT_PASSWORD:-local-parity-stack-root}"
export CHAOS_BASE_URL="${CHAOS_BASE_URL:-https://localhost:8443}"

db() { docker compose exec -T db mariadb -uroot -p"${DB_ROOT_PASSWORD}" -B -e "$1" 2>/dev/null; }
say() { printf '%s %s\n' "$(date -u +%H:%M:%S)" "$*" | tee -a "${OUT}/measure.log"; }

say "== row counts"
db "SELECT 'reports' t, COUNT(*) c FROM imreport.reports UNION ALL SELECT 'report_field_values', COUNT(*) FROM imreport.report_field_values UNION ALL SELECT 'reporting_periods', COUNT(*) FROM imreport.reporting_periods UNION ALL SELECT 'users', COUNT(*) FROM imreport.users UNION ALL SELECT 'evaluations', COUNT(*) FROM imreport.evaluations UNION ALL SELECT 'evaluation_answers', COUNT(*) FROM imreport.evaluation_answers UNION ALL SELECT 'notifications', COUNT(*) FROM imreport.notifications UNION ALL SELECT 'admin_audit_logs', COUNT(*) FROM imreport.admin_audit_logs UNION ALL SELECT 'audit_logs', COUNT(*) FROM imreport.audit_logs UNION ALL SELECT 'report_status_history', COUNT(*) FROM imreport.report_status_history UNION ALL SELECT 'action_items', COUNT(*) FROM imreport.action_items UNION ALL SELECT 'morning_attendance', COUNT(*) FROM imreport.morning_attendance UNION ALL SELECT 'student_attendance', COUNT(*) FROM imreport.student_attendance UNION ALL SELECT 'teaching_sessions', COUNT(*) FROM imreport.teaching_sessions UNION ALL SELECT 'duty_assignments', COUNT(*) FROM imreport.duty_assignments UNION ALL SELECT 'transfer_requests', COUNT(*) FROM imreport.transfer_requests UNION ALL SELECT 'subgroup_placements', COUNT(*) FROM imreport.subgroup_placements;" | tee "${OUT}/row-counts.tsv"

say "== table and index sizes (largest 15)"
db "SELECT table_name, table_rows, ROUND(data_length/1048576,1) data_mb, ROUND(index_length/1048576,1) index_mb, ROUND((data_length+index_length)/1048576,1) total_mb FROM information_schema.tables WHERE table_schema='imreport' ORDER BY (data_length+index_length) DESC LIMIT 15;" | tee "${OUT}/table-sizes.tsv"
db "SELECT ROUND(SUM(data_length+index_length)/1048576,1) total_mb, ROUND(SUM(index_length)/1048576,1) index_mb FROM information_schema.tables WHERE table_schema='imreport';" | tee "${OUT}/db-size.tsv"

say "== endpoint timings (cold = first request after a cache flush, then warm x3)"
docker compose exec -T app php artisan cache:clear >/dev/null 2>&1 || true
ENDPOINTS=(
  "/api/workspace?includeProfiles=0&includeAccessRequests=0&includeHistory=0"
  "/api/analytics/dashboard"
  "/api/analytics/dashboard?dateFrom=2022-01-01&dateTo=2026-12-31"
  "/api/analytics/overview"
  "/api/reports?perPage=300"
  "/api/reports?perPage=300&reportPeriodWindow=all"
  "/api/admin/users"
  "/api/admin/users?search=abel"
  "/api/admin/admin-audit-logs"
  "/api/admin/audit-logs"
  "/api/academic/analytics/summary"
  "/api/academic/analytics/snapshot"
  "/api/admin/academic/evaluations"
  "/api/admin/action-items"
  "/api/reports/status-history?perPage=100"
  "/api/notifications?limit=20"
)
printf 'endpoint\tcold_ms\twarm1_ms\twarm2_ms\twarm3_ms\tstatus\tbytes\n' > "${OUT}/endpoints.tsv"
# One sign-in for the whole list: the login limiter is 10/min per address.
MSYS_NO_PATHCONV=1 node scripts/large-data/measure-endpoints.mjs 4 "${ENDPOINTS[@]}" >> "${OUT}/endpoints.tsv"
tail -n +2 "${OUT}/endpoints.tsv" | while IFS=$'\t' read -r path cold w1 w2 w3 status bytes; do
  say "${path} -> cold ${cold} ms, warm ${w1}/${w2}/${w3} ms, status ${status}, ${bytes} bytes"
done

say "== export (queued XLSX of the whole archive): request to ready"
# One session for the request and the polling (the login limiter is 10/min).
export_result=$(MSYS_NO_PATHCONV=1 node scripts/chaos/probe.mjs export-wait 600 xlsx 2>/dev/null || echo "export=error")
say "export: ${export_result}"
printf '%s\n' "${export_result}" > "${OUT}/export.txt"
docker compose exec -T app sh -c 'ls -l storage/app/private/analytics-exports/*/ 2>/dev/null | tail -3' | tee -a "${OUT}/measure.log"

say "== slow query log (long_query_time=0.5s, log_queries_not_using_indexes=1)"
docker compose exec -T db sh -c 'test -f /var/lib/mysql/slow.log && grep -c "^# Time" /var/lib/mysql/slow.log || echo 0' | tee "${OUT}/slow-query-count.txt"
docker compose exec -T db sh -c 'test -f /var/lib/mysql/slow.log && grep -A6 "^# Time" /var/lib/mysql/slow.log | grep -v "^--" | tail -120' > "${OUT}/slow-query-tail.txt" 2>/dev/null || true

say "== EXPLAIN for the representative heavy statements"
{
  echo "-- reports window (submissions board)"
  db "EXPLAIN SELECT r.id FROM imreport.reports r WHERE r.reporting_period_id IN (SELECT id FROM imreport.reporting_periods ORDER BY week_start DESC LIMIT 9) ORDER BY r.updated_at DESC LIMIT 300;"
  echo "-- field values for one period window (analytics aggregation shape)"
  db "EXPLAIN SELECT fd.field_key, rfv.day_name, SUM(rfv.value_number) FROM imreport.report_field_values rfv JOIN imreport.reports r ON r.id = rfv.report_id JOIN imreport.report_field_definitions fd ON fd.id = rfv.field_definition_id WHERE r.reporting_period_id IN (SELECT id FROM imreport.reporting_periods ORDER BY week_start DESC LIMIT 9) GROUP BY fd.field_key, rfv.day_name;"
  echo "-- all-time aggregation"
  db "EXPLAIN SELECT r.reporting_period_id, SUM(rfv.value_number) FROM imreport.report_field_values rfv JOIN imreport.reports r ON r.id = rfv.report_id GROUP BY r.reporting_period_id;"
  echo "-- user search"
  db "EXPLAIN SELECT id FROM imreport.users WHERE full_name LIKE '%abel%' OR email LIKE '%abel%' ORDER BY full_name LIMIT 50;"
  echo "-- admin audit trail"
  db "EXPLAIN SELECT id FROM imreport.admin_audit_logs ORDER BY created_at DESC LIMIT 200;"
  echo "-- status history"
  db "EXPLAIN SELECT h.id FROM imreport.report_status_history h ORDER BY h.changed_at DESC LIMIT 100;"
  echo "-- evaluations listing"
  db "EXPLAIN SELECT id FROM imreport.evaluations ORDER BY evaluation_date DESC LIMIT 100;"
} > "${OUT}/explain.txt" 2>&1
grep -c "ALL" "${OUT}/explain.txt" | sed 's/^/full-scan rows in EXPLAIN output: /' | tee -a "${OUT}/measure.log"

say "== backup: dump size and duration; restore into a scratch database"
started=$(date +%s)
docker compose exec -T db sh -c "mariadb-dump -uroot -p${DB_ROOT_PASSWORD} --single-transaction --quick --routines --triggers imreport | gzip -6 > /tmp/large-data.sql.gz"
dump_seconds=$(( $(date +%s) - started ))
dump_size=$(docker compose exec -T db sh -c 'ls -l /tmp/large-data.sql.gz | awk "{print \$5}"' | tr -d '\r')
say "dump: ${dump_size} bytes in ${dump_seconds}s"
started=$(date +%s)
docker compose exec -T db sh -c "mariadb -uroot -p${DB_ROOT_PASSWORD} -e 'DROP DATABASE IF EXISTS imreport_restore; CREATE DATABASE imreport_restore;' && gunzip -c /tmp/large-data.sql.gz | mariadb -uroot -p${DB_ROOT_PASSWORD} imreport_restore"
restore_seconds=$(( $(date +%s) - started ))
restored=$(db "SELECT COUNT(*) FROM imreport_restore.reports;" | tail -1)
say "restore: ${restore_seconds}s, reports in the restored copy: ${restored}"
docker compose exec -T db sh -c "mariadb -uroot -p${DB_ROOT_PASSWORD} -e 'DROP DATABASE imreport_restore;' ; rm -f /tmp/large-data.sql.gz"
printf 'dump_bytes=%s\ndump_seconds=%s\nrestore_seconds=%s\nrestored_reports=%s\n' "${dump_size}" "${dump_seconds}" "${restore_seconds}" "${restored}" > "${OUT}/backup.txt"

say "== app container memory now"
docker stats --no-stream --format '{{.Name}} {{.MemUsage}} {{.CPUPerc}}' | grep imreport-parity | tee -a "${OUT}/measure.log"
say "done: ${OUT}"
