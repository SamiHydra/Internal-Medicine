#!/usr/bin/env bash
#
# Second half of the large-data rehearsal (docs/LARGE_DATA_REHEARSAL.md):
# slow-query summary, EXPLAIN for representative statements, and a full dump
# plus restore into a scratch database on the parity MariaDB. Split out of
# measure.sh so it can be repeated on its own.
#
#   scripts/large-data/measure-backup.sh [output-dir]

set -Eeuo pipefail

OUT="${1:-artifacts/large-data/$(date -u +%Y%m%dT%H%M%SZ)-backup}"
mkdir -p "${OUT}"
DB_ROOT_PASSWORD="${DB_ROOT_PASSWORD:-local-parity-stack-root}"

db() { docker compose exec -T db mariadb -uroot -p"${DB_ROOT_PASSWORD}" -B -e "$1" 2>&1; }
say() { printf '%s %s\n' "$(date -u +%H:%M:%S)" "$*" | tee -a "${OUT}/measure.log"; }

say "== slow query log: entries over the 0.5 s threshold vs unindexed-lookup entries"
docker compose exec -T db sh -c 'test -f /var/lib/mysql/slow.log || { echo "no slow log"; exit 0; }; total=$(grep -c "^# Query_time" /var/lib/mysql/slow.log); over=$(awk "/^# Query_time/ { if (\$3 > 0.5) n++ } END { print n+0 }" /var/lib/mysql/slow.log); max=$(awk "/^# Query_time/ { if (\$3 > m) m=\$3 } END { print m+0 }" /var/lib/mysql/slow.log); echo "entries=$total over_threshold=$over max_query_time_s=$max"' | tee "${OUT}/slow-query-summary.txt"
docker compose exec -T db sh -c 'test -f /var/lib/mysql/slow.log && awk "/^# Query_time/ { t=\$3 } /^(SELECT|UPDATE|INSERT|DELETE)/ { if (t > 0.5) print t, substr(\$0, 1, 220) }" /var/lib/mysql/slow.log | sort -rn | head -10' > "${OUT}/slow-queries-over-threshold.txt" 2>/dev/null || true

say "== EXPLAIN for the representative heavy statements"
{
  echo "-- reports window (submissions board: newest 9 periods)"
  db "EXPLAIN SELECT r.id FROM imreport.reports r JOIN (SELECT id FROM imreport.reporting_periods ORDER BY week_start DESC LIMIT 9) p ON p.id = r.reporting_period_id ORDER BY r.updated_at DESC LIMIT 300;"
  echo "-- field values aggregated for a 9-period window (analytics shape)"
  db "EXPLAIN SELECT fd.field_key, rfv.day_name, SUM(rfv.value_number) FROM imreport.report_field_values rfv JOIN imreport.reports r ON r.id = rfv.report_id JOIN (SELECT id FROM imreport.reporting_periods ORDER BY week_start DESC LIMIT 9) p ON p.id = r.reporting_period_id JOIN imreport.report_field_definitions fd ON fd.id = rfv.field_definition_id GROUP BY fd.field_key, rfv.day_name;"
  echo "-- whole-archive aggregation by period"
  db "EXPLAIN SELECT r.reporting_period_id, SUM(rfv.value_number) FROM imreport.report_field_values rfv JOIN imreport.reports r ON r.id = rfv.report_id GROUP BY r.reporting_period_id;"
  echo "-- user search"
  db "EXPLAIN SELECT id FROM imreport.users WHERE full_name LIKE '%abel%' OR email LIKE '%abel%' ORDER BY full_name LIMIT 50;"
  echo "-- admin audit trail"
  db "EXPLAIN SELECT id FROM imreport.admin_audit_logs ORDER BY created_at DESC LIMIT 200;"
  echo "-- status history"
  db "EXPLAIN SELECT id FROM imreport.report_status_history ORDER BY changed_at DESC LIMIT 100;"
  echo "-- evaluations listing"
  db "EXPLAIN SELECT id FROM imreport.evaluations ORDER BY evaluation_date DESC LIMIT 100;"
  echo "-- one report's cell values (report detail)"
  db "EXPLAIN SELECT id FROM imreport.report_field_values WHERE report_id = (SELECT id FROM imreport.reports LIMIT 1);"
} > "${OUT}/explain.txt" 2>&1
say "EXPLAIN rows with a full table scan (type ALL): $(grep -c $'\tALL\t' "${OUT}/explain.txt" || true)"

say "== backup: dump size and duration; restore into a scratch database"
started=$(date +%s)
docker compose exec -T db sh -c "mariadb-dump -uroot -p${DB_ROOT_PASSWORD} --single-transaction --quick --routines --triggers imreport | gzip -6 > /tmp/large-data.sql.gz"
dump_seconds=$(( $(date +%s) - started ))
dump_size=$(docker compose exec -T db sh -c 'stat -c %s /tmp/large-data.sql.gz' | tr -d '\r')
say "dump: ${dump_size} bytes in ${dump_seconds}s"
started=$(date +%s)
docker compose exec -T db sh -c "mariadb -uroot -p${DB_ROOT_PASSWORD} -e 'DROP DATABASE IF EXISTS imreport_restore; CREATE DATABASE imreport_restore;' && gunzip -c /tmp/large-data.sql.gz | mariadb -uroot -p${DB_ROOT_PASSWORD} imreport_restore"
restore_seconds=$(( $(date +%s) - started ))
restored=$(db "SELECT COUNT(*) FROM imreport_restore.reports;" | tail -1)
say "restore: ${restore_seconds}s, reports in the restored copy: ${restored}"
docker compose exec -T db sh -c "mariadb -uroot -p${DB_ROOT_PASSWORD} -e 'DROP DATABASE imreport_restore;'; rm -f /tmp/large-data.sql.gz"
printf 'dump_bytes=%s\ndump_seconds=%s\nrestore_seconds=%s\nrestored_reports=%s\n' "${dump_size}" "${dump_seconds}" "${restore_seconds}" "${restored}" | tee "${OUT}/backup.txt"
say "done: ${OUT}"
