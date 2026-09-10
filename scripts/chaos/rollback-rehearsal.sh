#!/usr/bin/env bash
#
# Rollback rehearsal for deploy/deploy.sh (docs/ROLLBACK_REHEARSAL.md).
#
# What this proves: the deployment script's failure path. A known-good release
# is deployed, then a second deployment is made to fail at the post-switch
# health probe (exactly the "the new release boots but does not answer" case),
# and the script's ERR trap must put `current` back on the previous release,
# reload PHP-FPM, leave maintenance mode and exit non-zero, with the shared
# database and storage untouched.
#
# How it is isolated: everything runs inside a throwaway Linux container on a
# scratch APP_ROOT. The repository is real (git archive of HEAD) and deploy.sh
# is the real file, unmodified. The toolchain deploy.sh shells out to (php,
# composer, npm, curl, sudo/systemctl, gunzip, the backup script) is replaced
# by stubs that record what was called and return the outcome the scenario
# needs; migrations are never run and no database is touched. This rehearses
# the script's control flow and rollback, NOT a full application deployment:
# the real thing still has to be run once on the hospital host.
#
#   scripts/chaos/rollback-rehearsal.sh [output-dir]

set -Eeuo pipefail
export MSYS_NO_PATHCONV=1

OUT="${1:-artifacts/chaos/rollback-$(date -u +%Y%m%dT%H%M%SZ)}"
mkdir -p "${OUT}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

cat > "${OUT}/rehearsal.sh" <<'INNER'
#!/usr/bin/env bash
# Runs INSIDE the container. /repo is the read-only checkout, /work the scratch root.
set -Eeuo pipefail

export APP_ROOT=/work
export SOURCE_DIR=/work/source
export RELEASES_DIR=/work/releases
export SHARED_DIR=/work/shared
export CURRENT_LINK=/work/current
export LOCK_FILE=/work/deploy.lock
export APP_URL=https://im.test.internal
export BACKUP_DIR=/work/backups
export BACKUP_SCRIPT=/work/stubs/backup.sh
export KEEP_RELEASES=5
export PATH=/work/stubs:$PATH

mkdir -p /work/stubs /work/backups /work/shared/storage /work/state

# ---------------------------------------------------------------- stubs ----
# Each stub logs its invocation so the transcript shows the exact order the
# real deploy would follow, and reads /work/state to decide success/failure.
stub() {
  local name="$1" body="$2"
  { echo '#!/usr/bin/env bash'; echo 'echo "[stub] '"${name}"' $*" >> /work/state/calls.log'; echo "${body}"; } > "/work/stubs/${name}"
  chmod +x "/work/stubs/${name}"
}

stub php 'case "$*" in
  *"artisan down"*) touch /work/state/maintenance; exit 0;;
  *"artisan up"*) rm -f /work/state/maintenance; exit 0;;
  *"artisan migrate --pretend"*) echo "would run 0 migrations"; exit 0;;
  *"artisan migrate --force"*) echo "migrated" >> /work/state/migrations.log; exit 0;;
  *"app:launch-readiness"*) exit 0;;
  *"artisan queue:restart"*) exit 0;;
  *) exit 0;;
esac'
stub composer 'exit 0'
stub npm 'exit 0'
stub node 'exit 0'
stub sudo 'exit 0'
stub systemctl 'exit 0'
stub gunzip 'exit 0'
# curl: the auth-wall probe always answers 401. /up answers 200 for a healthy
# release and 503 while /work/state/unhealthy exists (the injected failure).
stub curl 'url="${@: -1}"
case "$url" in
  */up) if [ -f /work/state/unhealthy ]; then printf 503; exit 0; else printf 200; exit 0; fi;;
  */api/workspace) printf 401; exit 0;;
  *) printf 200; exit 0;;
esac'
cat > /work/stubs/backup.sh <<'EOS'
#!/usr/bin/env bash
echo "[stub] backup.sh" >> /work/state/calls.log
stamp="$(date -u +%Y%m%d%H%M%S)"
printf 'dump' | gzip > "/work/backups/imreport-${stamp}.sql.gz" 2>/dev/null || printf 'dump' > "/work/backups/imreport-${stamp}.sql.gz"
EOS
chmod +x /work/stubs/backup.sh

# ------------------------------------------------------------- fixtures ----
git config --global --add safe.directory '*'
git clone --quiet /repo "${SOURCE_DIR}"
# The clone carries the committed HEAD; this rehearsal must exercise the
# deployment script as it stands in the working tree, so overlay deploy/ and
# commit it inside the scratch clone (the real repository is mounted read-only).
cp -r /repo/deploy/. "${SOURCE_DIR}/deploy/"
git -C "${SOURCE_DIR}" config user.email rehearsal@test.local
git -C "${SOURCE_DIR}" config user.name Rehearsal
git -C "${SOURCE_DIR}" add deploy
git -C "${SOURCE_DIR}" commit --quiet -m 'rehearsal: deployment scripts from the working tree' || true
printf 'APP_ENV=production\nDB_DATABASE=imreport\n' > "${SHARED_DIR}/backend.env"
# Marker files that stand in for live data: they must survive the failed deploy.
printf 'evidence-file\n' > "${SHARED_DIR}/storage/marker-evidence.txt"
printf 'row-count=1443\n' > "${SHARED_DIR}/database-marker.txt"

report() { printf '%s\n' "$*" | tee -a /work/state/report.txt; }

report "=== Rehearsal on $(uname -srm), git $(git -C "${SOURCE_DIR}" rev-parse --short=12 HEAD)"

# --------------------------------------------- 1. known-good deployment ----
report "--- deploy 1 (known good)"
if bash "${SOURCE_DIR}/deploy/deploy.sh" > /work/state/deploy-1.log 2>&1; then
  report "deploy 1: SUCCEEDED"
else
  report "deploy 1: FAILED (unexpected) exit=$?"
  tail -20 /work/state/deploy-1.log | sed 's/^/    /'
fi
GOOD_RELEASE="$(readlink -f "${CURRENT_LINK}" || true)"
report "release after deploy 1: $(basename "${GOOD_RELEASE:-none}")"
report "/up after deploy 1: $(curl -fsSk -o /dev/null -w '%{http_code}' "${APP_URL}/up")"

# ------------------------------- 2. a second, deliberately unhealthy one ----
# The controlled failure: a new commit exists (so a new release directory is
# built), and the post-switch /up probe answers 503. Nothing is corrupted; the
# health check simply refuses the release, which is what deploy.sh reacts to.
# RELEASE_ID is "<UTC seconds>-<revision>"; the stubs make a whole deploy take
# milliseconds, so without this the three rehearsal deploys of one revision
# would collide on the same release directory. Real deploys are minutes apart.
sleep 1
report "--- deploy 2 (post-switch health check fails)"
git -C "${SOURCE_DIR}" config user.email rehearsal@test.local
git -C "${SOURCE_DIR}" config user.name Rehearsal
printf 'rehearsal marker\n' > "${SOURCE_DIR}/REHEARSAL_MARKER"
git -C "${SOURCE_DIR}" add REHEARSAL_MARKER
git -C "${SOURCE_DIR}" commit --quiet -m 'rehearsal: unhealthy release'
# deploy.sh pulls from origin; point origin at the working copy itself.
git -C "${SOURCE_DIR}" remote set-url origin "${SOURCE_DIR}"
git -C "${SOURCE_DIR}" branch --set-upstream-to=origin/$(git -C "${SOURCE_DIR}" rev-parse --abbrev-ref HEAD) 2>/dev/null || true
touch /work/state/unhealthy

started=$(date +%s%3N)
if bash "${SOURCE_DIR}/deploy/deploy.sh" > /work/state/deploy-2.log 2>&1; then
  report "deploy 2: SUCCEEDED (rehearsal FAILED: an unhealthy release was accepted)"
else
  code=$?
  report "deploy 2: exited ${code} (expected non-zero)"
fi
rollback_ms=$(( $(date +%s%3N) - started ))

# ---------------------------------------------------------- 3. verdict ----
AFTER_RELEASE="$(readlink -f "${CURRENT_LINK}" || true)"
rm -f /work/state/unhealthy
report "release after deploy 2: $(basename "${AFTER_RELEASE:-none}")"
report "rollback trigger: $(grep -m1 -iE 'health check failed|liveness check failed' /work/state/deploy-2.log || echo 'not found')"
report "rollback message: $(grep -m1 'Restoring the previous application release' /work/state/deploy-2.log || echo 'not found')"
report "deploy 2 wall time (build + failure + rollback): ${rollback_ms} ms"
report "previous release restored: $([ -n "${GOOD_RELEASE}" ] && [ "${AFTER_RELEASE}" = "${GOOD_RELEASE}" ] && echo YES || echo NO)"
report "restored release contains the rehearsal marker (it must NOT): $([ -f "${AFTER_RELEASE}/REHEARSAL_MARKER" ] && echo YES || echo NO)"
report "maintenance mode left: $([ -f /work/state/maintenance ] && echo 'NO (still down)' || echo YES)"
report "/up after rollback: $(curl -fsSk -o /dev/null -w '%{http_code}' "${APP_URL}/up")"
report "auth wall after rollback: $(curl -fsSk -o /dev/null -w '%{http_code}' "${APP_URL}/api/workspace")"
report "shared database marker intact: $(cat "${SHARED_DIR}/database-marker.txt" 2>/dev/null || echo MISSING)"
report "shared storage marker intact: $(cat "${SHARED_DIR}/storage/marker-evidence.txt" 2>/dev/null || echo MISSING)"
report "unhealthy release still on disk (not deleted): $(ls "${RELEASES_DIR}" | wc -l) release directories"
report "pre-migration backups taken: $(ls "${BACKUP_DIR}" | wc -l)"
report "php-fpm reloads recorded: $(grep -c 'systemctl reload' /work/state/calls.log || true)"
report "queue restarts recorded: $(grep -c 'queue:restart' /work/state/calls.log || true)"

# ------------------------------------------- 4. the release still works ----
# A third deployment with the health probe healthy again must succeed, proving
# the failed attempt left the system deployable.
sleep 1
report "--- deploy 3 (healthy again)"
if bash "${SOURCE_DIR}/deploy/deploy.sh" > /work/state/deploy-3.log 2>&1; then
  report "deploy 3: SUCCEEDED; release $(basename "$(readlink -f "${CURRENT_LINK}")")"
else
  report "deploy 3: FAILED exit=$? (see deploy-3.log)"
fi
report "/up after deploy 3: $(curl -fsSk -o /dev/null -w '%{http_code}' "${APP_URL}/up")"

cp -r /work/state /out/state
INNER

chmod +x "${OUT}/rehearsal.sh"

docker run --rm \
  -v "${REPO_ROOT}:/repo:ro" \
  -v "$(cd "${OUT}" && pwd):/out" \
  -w /work \
  debian:bookworm-slim \
  bash -c 'apt-get update -qq >/dev/null && apt-get install -y -qq git ca-certificates >/dev/null && mkdir -p /work && cp /out/rehearsal.sh /work/rehearsal.sh && bash /work/rehearsal.sh' \
  2>&1 | tee "${OUT}/console.log"

echo
echo "Rehearsal artifacts: ${OUT}"
