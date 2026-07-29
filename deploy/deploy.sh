#!/usr/bin/env bash
#
# Atomic deployment for the department server. The checked-out repository is
# kept in /opt/imreport/source, immutable releases live under releases/, and
# /opt/imreport/current is switched atomically after a successful build.

set -Eeuo pipefail

DRY_RUN=0
if [ "${1:-}" = "--dry-run" ]; then
  DRY_RUN=1
  shift
fi

if [ "$#" -ne 0 ]; then
  echo "Usage: $0 [--dry-run]" >&2
  exit 2
fi

APP_ROOT="${APP_ROOT:-/opt/imreport}"
SOURCE_DIR="${SOURCE_DIR:-${APP_ROOT}/source}"
RELEASES_DIR="${RELEASES_DIR:-${APP_ROOT}/releases}"
SHARED_DIR="${SHARED_DIR:-${APP_ROOT}/shared}"
CURRENT_LINK="${CURRENT_LINK:-${APP_ROOT}/current}"
LOCK_FILE="${LOCK_FILE:-${APP_ROOT}/deploy.lock}"
APP_URL="${APP_URL:-https://im.hospital.internal}"
BACKUP_SCRIPT="${BACKUP_SCRIPT:-${SOURCE_DIR}/deploy/backup.sh}"
KEEP_RELEASES="${KEEP_RELEASES:-5}"

if [ "${DRY_RUN}" = "1" ]; then
  echo "Deployment dry run (no files, services, database rows, or links will change)."
  echo "Source: ${SOURCE_DIR}"
  echo "Releases: ${RELEASES_DIR}"
  echo "Shared: ${SHARED_DIR}"
  echo "Current link: ${CURRENT_LINK}"

  missing=0
  for command_name in git tar flock php composer node npm curl gunzip mysqldump; do
    if command -v "${command_name}" >/dev/null 2>&1; then
      echo "OK command: ${command_name}"
    else
      echo "MISSING command: ${command_name}" >&2
      missing=1
    fi
  done

  if command -v node >/dev/null 2>&1; then
    node_version="$(node -p "process.versions.node" 2>/dev/null || echo 0.0.0)"
    if node -e "const [major, minor] = process.versions.node.split('.').map(Number); process.exit(major > 22 || (major === 22 && minor >= 12) ? 0 : 1)"; then
      echo "OK Node.js version: ${node_version}"
    else
      echo "UNSUPPORTED Node.js version: ${node_version} (Node.js 22.12.0 or newer is required)" >&2
      missing=1
    fi
  fi

  if [ -d "${SOURCE_DIR}/.git" ]; then
    echo "OK deployment source: $(git -C "${SOURCE_DIR}" rev-parse --short=12 HEAD)"
  else
    echo "MISSING Git deployment source: ${SOURCE_DIR}" >&2
    missing=1
  fi

  if [ -f "${SHARED_DIR}/backend.env" ]; then
    echo "OK shared environment file"
    configured_db="$(sed -n 's/^[[:space:]]*DB_DATABASE=//p' "${SHARED_DIR}/backend.env" | tail -n 1)"
    configured_db="${configured_db%\"}"
    configured_db="${configured_db#\"}"
    configured_db="${configured_db%\'}"
    configured_db="${configured_db#\'}"
    if [[ "${configured_db}" =~ ^[A-Za-z0-9_]+$ ]]; then
      echo "OK backup database target matches a safe DB_DATABASE value"
    else
      echo "MISSING or unsafe DB_DATABASE in ${SHARED_DIR}/backend.env" >&2
      missing=1
    fi
  else
    echo "MISSING shared environment file: ${SHARED_DIR}/backend.env" >&2
    missing=1
  fi

  exit "${missing}"
fi

mkdir -p "${APP_ROOT}" "${RELEASES_DIR}" "${SHARED_DIR}/storage"
mkdir -p "${SHARED_DIR}/storage/app" "${SHARED_DIR}/storage/framework/cache" \
  "${SHARED_DIR}/storage/framework/sessions" "${SHARED_DIR}/storage/framework/views" \
  "${SHARED_DIR}/storage/logs"

exec 9>"${LOCK_FILE}"
if ! flock -n 9; then
  echo "Another deployment is already running." >&2
  exit 1
fi

if [ ! -f "${SHARED_DIR}/backend.env" ]; then
  echo "Missing ${SHARED_DIR}/backend.env. Install the production environment file first." >&2
  exit 1
fi

echo "==> Updating the deployment source"
cd "${SOURCE_DIR}"
git pull --ff-only

REVISION="$(git rev-parse --short=12 HEAD)"
RELEASE_ID="$(date -u +%Y%m%d%H%M%S)-${REVISION}"
RELEASE_DIR="${RELEASES_DIR}/${RELEASE_ID}"
PREVIOUS_RELEASE="$(readlink -f "${CURRENT_LINK}" 2>/dev/null || true)"
ACTIVATED=0
MAINTENANCE=0

rollback_on_error() {
  local exit_code=$?
  trap - ERR

  echo "Deployment failed. Restoring the previous application release." >&2

  if [ "${ACTIVATED}" = "1" ] && [ -n "${PREVIOUS_RELEASE}" ]; then
    ln -s "${PREVIOUS_RELEASE}" "${CURRENT_LINK}.rollback"
    mv -Tf "${CURRENT_LINK}.rollback" "${CURRENT_LINK}"
    sudo -n systemctl reload php8.3-fpm || true
    cd "${PREVIOUS_RELEASE}/backend"
    php artisan queue:restart || true
  elif [ "${ACTIVATED}" = "1" ]; then
    rm -f -- "${CURRENT_LINK}"
    sudo -n systemctl reload php8.3-fpm || true
  fi

  if [ "${MAINTENANCE}" = "1" ] && [ -n "${PREVIOUS_RELEASE}" ]; then
    cd "${PREVIOUS_RELEASE}/backend"
    php artisan up || true
  fi

  echo "Code was rolled back. Database migrations are forward-only; use the verified pre-migration backup if a migration was not backward compatible." >&2
  exit "${exit_code}"
}

trap rollback_on_error ERR

echo "==> Creating immutable release ${RELEASE_ID}"
mkdir -p "${RELEASE_DIR}"
git archive --format=tar HEAD | tar -xf - -C "${RELEASE_DIR}"
ln -s "${SHARED_DIR}/backend.env" "${RELEASE_DIR}/backend/.env"
rm -rf "${RELEASE_DIR}/backend/storage"
ln -s "${SHARED_DIR}/storage" "${RELEASE_DIR}/backend/storage"

echo "==> Installing and validating the release"
cd "${RELEASE_DIR}/backend"
composer install --no-dev --optimize-autoloader --no-interaction
php artisan config:clear
php artisan migrate --pretend --force

cd "${RELEASE_DIR}"
npm ci
VITE_API_BASE_URL="${APP_URL}" VITE_RELEASE_SHA="${REVISION}" npm run verify

echo "==> Taking the pre-migration backup"
"${BACKUP_SCRIPT}"
LATEST_BACKUP="$(find "${BACKUP_DIR:-/var/backups/imreport}" -maxdepth 1 -name '*.sql.gz' -type f -printf '%T@ %p\n' | sort -nr | head -1 | cut -d' ' -f2-)"
if [ -z "${LATEST_BACKUP}" ]; then
  echo "No database backup was produced." >&2
  exit 1
fi
gunzip -t "${LATEST_BACKUP}"

if [ -n "${PREVIOUS_RELEASE}" ]; then
  echo "==> Entering maintenance mode"
  cd "${PREVIOUS_RELEASE}/backend"
  php artisan down --retry=60
  MAINTENANCE=1
fi

echo "==> Applying database migrations"
cd "${RELEASE_DIR}/backend"
php artisan migrate --force
php artisan config:cache
php artisan route:cache
php artisan view:cache

echo "==> Activating the release"
ln -s "${RELEASE_DIR}" "${CURRENT_LINK}.next"
mv -Tf "${CURRENT_LINK}.next" "${CURRENT_LINK}"
ACTIVATED=1
sudo -n systemctl reload php8.3-fpm

echo "==> Strict readiness check while maintenance remains active"
php artisan app:launch-readiness --strict

echo "==> Leaving maintenance mode and checking the auth wall"
php artisan up
MAINTENANCE=0
STATUS="$(curl -fsSk -o /dev/null -w '%{http_code}' "${APP_URL}/api/workspace" || true)"
if [ "${STATUS}" != "401" ] && [ "${STATUS}" != "419" ]; then
  echo "Health check failed: expected 401 or 419, got ${STATUS:-no response}." >&2
  false
fi

echo "==> Restarting the queue on the verified release"
php artisan queue:restart

echo "==> Removing old releases"
find "${RELEASES_DIR}" -mindepth 1 -maxdepth 1 -type d -printf '%T@ %p\n' \
  | sort -nr \
  | tail -n "+$((KEEP_RELEASES + 1))" \
  | cut -d' ' -f2- \
  | while IFS= read -r old_release; do
      if [ -n "${old_release}" ] && [ "${old_release}" != "$(readlink -f "${CURRENT_LINK}")" ]; then
        rm -rf -- "${old_release}"
      fi
    done

trap - ERR
echo "Deploy complete: ${RELEASE_ID}."
