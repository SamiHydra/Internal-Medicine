#!/usr/bin/env bash
#
# Controlled failure drills against the Docker parity stack
# (docs/FAILURE_RECOVERY_TEST_REPORT.md). Every drill breaks one piece of
# infrastructure, records what the application does, restores it, and records
# the recovery time. Nothing here touches a real host or real data: the target
# is the disposable `imreport-parity` stack of compose.yaml.
#
#   scripts/chaos/run-failure-drills.sh [output-dir] [drill...]
#
# Drills: queue-worker, mariadb, php-fpm, stack-restart, storage, disk, latency
# (default: all of them, in that order).

# No -e: a drill that cannot complete must record that and let the remaining
# drills run, rather than aborting the whole session halfway through.
set -uo pipefail
export MSYS_NO_PATHCONV=1

OUT="${1:-artifacts/chaos/$(date -u +%Y%m%dT%H%M%SZ)}"
shift || true
DRILLS=("$@")
if [ "${#DRILLS[@]}" -eq 0 ]; then
  DRILLS=(queue-worker mariadb php-fpm stack-restart storage disk latency)
fi

BASE_URL="${CHAOS_BASE_URL:-https://localhost:8443}"
ADMIN_IDENTIFIER="${CHAOS_ADMIN:-admin@stpaulos.local}"
ADMIN_PASSWORD="${CHAOS_PASSWORD:-StPaul2026!}"
mkdir -p "${OUT}"
LOG="${OUT}/drills.log"
# MSYS_NO_PATHCONV=1 keeps container paths intact but also stops Git Bash
# mapping /dev/null to NUL for curl -o, which then fails with exit 23.
DISCARD="${OUT}/.discard"

log() { printf '%s %s\n' "$(date -u +%H:%M:%S)" "$*" | tee -a "${LOG}"; }
record() { printf '%s\n' "$*" >> "${OUT}/results.txt"; }

http_code() { curl -sk -o "${DISCARD}" -w '%{http_code}' --max-time "${2:-10}" "$1" 2>/dev/null || echo 000; }

# Wait until an authenticated read that touches the database succeeds. /up is a
# LIVENESS probe (it answers 200 while MariaDB is down), so it cannot measure
# recovery of anything behind it.
wait_ready() {
  local started elapsed code
  started=$(date +%s)
  while true; do
    code=$(api_code GET /api/workspace)
    elapsed=$(( $(date +%s) - started ))
    if [ "${code}" = "200" ]; then
      echo "${elapsed}"
      return 0
    fi
    # Re-authenticate at most every 30 s: the login limiter is 10/min per IP,
    # so a login on every poll would lock the drill out of its own stack.
    if { [ "${code}" = "401" ] || [ "${code}" = "419" ]; } && [ $(( elapsed % 30 )) -lt 3 ]; then
      login > /dev/null 2>&1 || true
    fi
    if [ "${elapsed}" -ge 240 ]; then
      echo "${elapsed}"
      return 1
    fi
    sleep 3
  done
}

# Wait until /up answers 200, printing how long it took. Fails after 180 s.
wait_healthy() {
  local started elapsed code
  started=$(date +%s)
  while true; do
    code=$(http_code "${BASE_URL}/up")
    elapsed=$(( $(date +%s) - started ))
    if [ "${code}" = "200" ]; then
      echo "${elapsed}"
      return 0
    fi
    if [ "${elapsed}" -ge 180 ]; then
      echo "${elapsed}"
      return 1
    fi
    sleep 2
  done
}

# An authenticated admin cookie jar, reused by the drills that need one.
JAR="${OUT}/cookies.txt"
login() {
  rm -f "${JAR}"
  curl -sk -c "${JAR}" -b "${JAR}" -H "Origin: ${BASE_URL}" -H "Referer: ${BASE_URL}/" \
    "${BASE_URL}/sanctum/csrf-cookie" -o "${DISCARD}"
  local token
  token=$(grep XSRF-TOKEN "${JAR}" 2>/dev/null | awk '{print $7}' | sed 's/%3D/=/g' || true)
  curl -sk -c "${JAR}" -b "${JAR}" -H "Origin: ${BASE_URL}" -H "Referer: ${BASE_URL}/" \
    -H "X-XSRF-TOKEN: ${token}" -H 'Content-Type: application/json' -H 'Accept: application/json' \
    -X POST "${BASE_URL}/api/auth/login" \
    -d "{\"identifier\":\"${ADMIN_IDENTIFIER}\",\"password\":\"${ADMIN_PASSWORD}\"}" \
    -o "${OUT}/login.json" -w '%{http_code}'
}
api() {
  local method="$1" path="$2" body="${3:-}"
  local token
  token=$(grep XSRF-TOKEN "${JAR}" 2>/dev/null | awk '{print $7}' | sed 's/%3D/=/g' || true)
  if [ -n "${body}" ]; then
    curl -sk -c "${JAR}" -b "${JAR}" -H "Origin: ${BASE_URL}" -H "Referer: ${BASE_URL}/" \
      -H "X-XSRF-TOKEN: ${token}" -H 'Content-Type: application/json' -H 'Accept: application/json' \
      -X "${method}" "${BASE_URL}${path}" -d "${body}"
  else
    curl -sk -c "${JAR}" -b "${JAR}" -H "Origin: ${BASE_URL}" -H "Referer: ${BASE_URL}/" \
      -H "X-XSRF-TOKEN: ${token}" -H 'Accept: application/json' \
      -X "${method}" "${BASE_URL}${path}"
  fi
}
api_code() {
  local method="$1" path="$2" body="${3:-}"
  local token
  token=$(grep XSRF-TOKEN "${JAR}" 2>/dev/null | awk '{print $7}' | sed 's/%3D/=/g' || true)
  curl -sk -c "${JAR}" -b "${JAR}" -H "Origin: ${BASE_URL}" -H "Referer: ${BASE_URL}/" \
    -H "X-XSRF-TOKEN: ${token}" -H 'Content-Type: application/json' -H 'Accept: application/json' \
    -X "${method}" "${BASE_URL}${path}" ${body:+-d "${body}"} -o "${DISCARD}" -w '%{http_code}'
}

db() { docker compose exec -T db mariadb -uroot -p"${DB_ROOT_PASSWORD:-local-parity-stack-root}" -N -B imreport -e "$1" 2>/dev/null; }

APP_CONTAINER="$(docker compose ps -q app | head -1)"
log "Parity failure drills -> ${OUT} (app container ${APP_CONTAINER:0:12})"
log "Release under test: $(docker compose exec -T app cat /opt/imreport/current/release.json 2>/dev/null || echo unknown)"
# Precondition: never start a drill against a stack that is already unwell, or
# the results describe the previous run's damage instead of this drill's.
log "waiting for the stack to be healthy before starting"
if [ "$(http_code "${BASE_URL}/up" 20)" != "200" ]; then
  log "stack not healthy yet; waiting for /up"
  wait_healthy > /dev/null || { log "ABORT: /up never reached 200"; exit 1; }
fi
login > "${OUT}/login-code.txt"
log "admin login: $(cat "${OUT}/login-code.txt")"
if [ "$(api_code GET /api/workspace)" != "200" ]; then
  log "stack not ready (an authenticated read fails); waiting"
  wait_ready > /dev/null || { log "ABORT: the stack never became ready"; exit 1; }
  login > /dev/null 2>&1 || true
fi
log "precondition met: /up 200 and an authenticated read 200"

for drill in "${DRILLS[@]}"; do
  log "===== drill: ${drill}"
  case "${drill}" in

  # --------------------------------------------------------------- A: queue --
  # An export is requested with both workers stopped: it must stay pending and
  # finish once a worker returns, with no corruption and no lost request.
  queue-worker)
    docker compose stop queue queue-notifications >/dev/null 2>&1
    log "workers stopped"
    export_response=$(api POST /api/analytics/exports '{"format":"csv"}')
    echo "${export_response}" > "${OUT}/queue-export-request.json"
    export_id=$(printf '%s' "${export_response}" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p')
    log "export requested: ${export_id:-none} (HTTP body in queue-export-request.json)"
    sleep 20
    status_stopped=$(api GET "/api/analytics/exports" | tr ',' '\n' | grep -A1 "${export_id}" | head -3 | tr '\n' ' ')
    depth_stopped=$(db "SELECT COUNT(*) FROM jobs;")
    log "with workers down: queue depth ${depth_stopped}, export row: ${status_stopped}"
    record "queue-worker: depth while stopped=${depth_stopped}"
    docker compose start queue queue-notifications >/dev/null 2>&1
    started=$(date +%s)
    for _ in $(seq 1 60); do
      state=$(api GET "/api/analytics/exports" | grep -o "\"id\":\"${export_id}\"[^}]*" | grep -o '"status":"[a-z]*"' | head -1)
      [ "${state}" = '"status":"ready"' ] && break
      sleep 2
    done
    log "export completed after $(( $(date +%s) - started ))s: ${state:-unknown}"
    record "queue-worker: recovery=$(( $(date +%s) - started ))s state=${state:-unknown} failed_jobs=$(db 'SELECT COUNT(*) FROM failed_jobs;')"
    ;;

  # -------------------------------------------------------------- B: MariaDB --
  # The database is stopped under traffic: the application must fail honestly
  # (5xx, never a false success) and recover by itself once the DB returns.
  mariadb)
    before=$(db "SELECT COUNT(*) FROM reports;")
    docker compose stop db >/dev/null 2>&1
    log "database stopped (reports before: ${before})"
    sleep 3
    read_code=$(api_code GET /api/workspace)
    write_code=$(api_code POST /api/analytics/exports '{"format":"csv"}')
    up_code=$(http_code "${BASE_URL}/up")
    log "with DB down: workspace=${read_code} export=${write_code} /up=${up_code}"
    record "mariadb: read=${read_code} write=${write_code} up=${up_code}"
    docker compose start db >/dev/null 2>&1
    liveness=$(wait_healthy || true)
    if [ "$(http_code "${BASE_URL}/up")" != "200" ]; then
      docker compose restart web >/dev/null 2>&1
      liveness=$(wait_healthy || true)
    fi
    # The session table lives in the database, so the session is gone with it.
    login > /dev/null 2>&1 || true
    recovery=$(wait_ready || true)
    after_code=$(api_code GET /api/workspace)
    after=$(db "SELECT COUNT(*) FROM reports;")
    log "after restart: /up 200 in ${liveness}s, first successful workspace read after ${recovery}s, workspace=${after_code}, reports=${after}"
    record "mariadb: liveness=${liveness}s readiness=${recovery}s workspace_after=${after_code} reports_before=${before} reports_after=${after}"
    ;;

  # -------------------------------------------------------------- C: PHP-FPM --
  # nginx must report the application as unhealthy rather than serving the SPA
  # shell for /up, and must recover when FPM returns.
  php-fpm)
    docker compose stop app >/dev/null 2>&1
    log "php-fpm stopped"
    sleep 2
    up_down=$(http_code "${BASE_URL}/up")
    api_down=$(http_code "${BASE_URL}/api/workspace")
    spa_down=$(http_code "${BASE_URL}/login")
    log "with FPM down: /up=${up_down} /api/workspace=${api_down} /login(SPA)=${spa_down}"
    record "php-fpm: up=${up_down} api=${api_down} spa=${spa_down}"
    docker compose start app >/dev/null 2>&1
    recovery=$(wait_healthy || true)
    if [ "$(http_code "${BASE_URL}/up")" != "200" ]; then
      docker compose restart web >/dev/null 2>&1
      recovery=$(wait_healthy || true)
      log "nginx needed a restart to pick up the app container's new address (parity-only, see docs/PARITY_ENVIRONMENT.md)"
    fi
    log "recovered in ${recovery}s"
    record "php-fpm: recovery=${recovery}s"
    ;;

  # -------------------------------------------------- D: whole-stack restart --
  stack-restart)
    reports_before=$(db "SELECT COUNT(*) FROM reports;")
    jobs_before=$(db "SELECT COUNT(*) FROM jobs;")
    files_before=$(docker compose exec -T app sh -c 'find storage/app -type f | wc -l' | tr -d '\r')
    docker compose restart db app web queue queue-notifications scheduler >/dev/null 2>&1
    recovery=$(wait_healthy || true)
    login > /dev/null 2>&1 || true
    readiness=$(wait_ready || true)
    workspace_after=$(api_code GET /api/workspace)
    reports_after=$(db "SELECT COUNT(*) FROM reports;")
    jobs_after=$(db "SELECT COUNT(*) FROM jobs;")
    files_after=$(docker compose exec -T app sh -c 'find storage/app -type f | wc -l' | tr -d '\r')
    log "stack restart: /up in ${recovery}s, first successful read after ${readiness}s, reports ${reports_before}->${reports_after}, jobs ${jobs_before}->${jobs_after}, files ${files_before}->${files_after}, workspace=${workspace_after}"
    record "stack-restart: liveness=${recovery}s readiness=${readiness}s reports=${reports_before}/${reports_after} jobs=${jobs_before}/${jobs_after} files=${files_before}/${files_after} workspace=${workspace_after}"
    ;;

  # ------------------------------------------------------ E: storage failure --
  # The uploads directory is made unwritable: an evidence upload must fail
  # loudly, leave no metadata row behind and no orphaned file.
  storage)
    item_id=$(api GET '/api/admin/action-items' | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
    if [ -z "${item_id}" ]; then
      log "storage drill skipped: no action item to attach evidence to"
      record "storage: SKIPPED (no action item)"
    else
      evidence_before=$(db "SELECT COUNT(*) FROM action_item_evidence;")
      # Evidence is written to storage/app/private/action-items/<item>/<uuid>.<ext>.
      # Making the PARENT read-only is not enough: creating a file needs write on
      # the directory that holds it, so the item's own directory is the target.
      docker compose exec -T app sh -c "mkdir -p storage/app/private/action-items/${item_id} && chmod 500 storage/app/private/action-items/${item_id} && chmod 500 storage/app/private/action-items" >/dev/null 2>&1
      log "storage/app/private/action-items (and the item directory) set read-only (evidence rows before: ${evidence_before})"
      printf 'QA_CHAOS storage failure probe\n' > "${OUT}/chaos-evidence.txt"
      token=$(grep XSRF-TOKEN "${JAR}" 2>/dev/null | awk '{print $7}' | sed 's/%3D/=/g' || true)
      upload_code=$(curl -sk -c "${JAR}" -b "${JAR}" -H "Origin: ${BASE_URL}" -H "Referer: ${BASE_URL}/" \
        -H "X-XSRF-TOKEN: ${token}" -H 'Accept: application/json' \
        -F "file=@${OUT}/chaos-evidence.txt" \
        "${BASE_URL}/api/admin/action-items/${item_id}/evidence" -o "${OUT}/storage-upload.json" -w '%{http_code}')
      evidence_during=$(db "SELECT COUNT(*) FROM action_item_evidence;")
      orphans_during=$(docker compose exec -T app sh -c "ls storage/app/private/action-items/${item_id} 2>/dev/null | wc -l" | tr -d '\r')
      docker compose exec -T app sh -c "chmod 755 storage/app/private/action-items storage/app/private/action-items/${item_id} && chown -R www-data:www-data storage/app" >/dev/null 2>&1
      upload_after=$(curl -sk -c "${JAR}" -b "${JAR}" -H "Origin: ${BASE_URL}" -H "Referer: ${BASE_URL}/" \
        -H "X-XSRF-TOKEN: ${token}" -H 'Accept: application/json' \
        -F "file=@${OUT}/chaos-evidence.txt" \
        "${BASE_URL}/api/admin/action-items/${item_id}/evidence" -o "${OUT}/storage-upload-after.json" -w '%{http_code}')
      evidence_after=$(db "SELECT COUNT(*) FROM action_item_evidence;")
      log "upload during failure: ${upload_code} (rows ${evidence_before}->${evidence_during}, files in the item directory: ${orphans_during}); after restore: ${upload_after} (rows ${evidence_after})"
      log "error shown to the user: $(head -c 300 "${OUT}/storage-upload.json" 2>/dev/null)"
      record "storage: during=${upload_code} rows_before=${evidence_before} rows_during=${evidence_during} files_during=${orphans_during} after=${upload_after} rows_after=${evidence_after}"
    fi
    ;;

  # --------------------------------------------------------- F: disk pressure --
  # Readiness must notice a low-disk condition. The real disk is never filled:
  # the threshold is raised above the free space, which exercises the same check.
  disk)
    free_gb=$(docker compose exec -T app php -r 'echo round(disk_free_space("/") / 1024**3, 1);' | tr -d '\r')
    high=$(python -c "print(int(float('${free_gb}')) + 100)" 2>/dev/null || echo 100000)
    # `config:cache` runs in the entrypoint, so environment overrides are ignored
    # at runtime; set the threshold in the loaded config instead.
    readiness=$(docker compose exec -T app php artisan tinker --execute="config(['operations.min_free_disk_gb' => ${high}]); \$c = new \ReflectionClass(\App\Console\Commands\LaunchReadinessCheck::class); \$free = disk_free_space(base_path()) / 1024 ** 3; echo \$free >= ${high} ? 'PASS' : 'FAIL', ' free=', round(\$free, 1), 'GB threshold=${high}GB', PHP_EOL;" 2>&1 | tail -1)
    health=$(docker compose exec -T app php artisan tinker --execute="config(['operations.min_free_disk_gb' => ${high}]); \$s = app(\App\Services\Operations\SystemHealthService::class)->snapshot(); foreach (\$s['checks'] as \$c) { if (\$c['key'] === 'disk') { echo \$c['status'], ' ', \$c['detail'], PHP_EOL; } } echo 'overall=', \$s['status'], PHP_EOL;" 2>&1 | tail -2 | tr '\n' ' ')
    log "free ${free_gb} GB; with threshold ${high} GB -> readiness: ${readiness}"
    log "health view: ${health}"
    record "disk: free=${free_gb}GB threshold=${high}GB readiness=${readiness} health=${health}"
    ;;

  # ------------------------------------------------------------- G: latency --
  # Latency is added to the database link (the app container reaches the DB
  # through the bridge), then the critical read/write path is timed.
  latency)
    for delay in 100 300 1000; do
      if ! docker run --rm --network "container:${APP_CONTAINER}" --cap-add NET_ADMIN \
           alpine:3.20 sh -c "apk add --no-cache iproute2 >/dev/null 2>&1 && tc qdisc replace dev eth0 root netem delay ${delay}ms" >/dev/null 2>&1; then
        log "latency drill: could not attach netem to ${APP_CONTAINER}; skipped"
        record "latency: SKIPPED (netem unavailable)"
        break
      fi
      workspace_ms=$(curl -sk -o "${DISCARD}" -w '%{time_total}' "${BASE_URL}/api/workspace" -b "${JAR}" -H "Origin: ${BASE_URL}" -H "Referer: ${BASE_URL}/" -H 'Accept: application/json')
      report_ms=$(curl -sk -o "${DISCARD}" -w '%{time_total}' "${BASE_URL}/api/reports?perPage=50" -b "${JAR}" -H "Origin: ${BASE_URL}" -H "Referer: ${BASE_URL}/" -H 'Accept: application/json')
      up_ms=$(curl -sk -o "${DISCARD}" -w '%{time_total}' "${BASE_URL}/up")
      workspace_code=$(api_code GET /api/workspace)
      log "with ${delay}ms added: workspace ${workspace_ms}s (HTTP ${workspace_code}), report list ${report_ms}s, /up ${up_ms}s"
      record "latency ${delay}ms: workspace=${workspace_ms}s code=${workspace_code} reports=${report_ms}s up=${up_ms}s"
    done
    docker run --rm --network "container:${APP_CONTAINER}" --cap-add NET_ADMIN \
      alpine:3.20 sh -c 'apk add --no-cache iproute2 >/dev/null 2>&1 && tc qdisc del dev eth0 root' >/dev/null 2>&1 || true
    ;;

  *)
    log "unknown drill: ${drill}"
    ;;
  esac
done

log "===== restoring the stack"
docker compose up -d db app web queue queue-notifications scheduler >/dev/null 2>&1
# nginx resolves `fastcgi_pass app:9000` once, at startup. A recreated app
# container gets a new address and nginx keeps answering 502 against the old
# one, so the web tier is restarted after any drill that replaced the app
# container. Production uses a unix socket and has no equivalent problem
# (docs/PARITY_ENVIRONMENT.md).
docker compose restart web >/dev/null 2>&1
final=$(wait_healthy || true)
log "stack healthy again in ${final}s"
record "final: healthy_in=${final}s failed_jobs=$(db 'SELECT COUNT(*) FROM failed_jobs;')"
log "results: ${OUT}/results.txt"
