#!/usr/bin/env bash
#
# Deployment script for the department server (V2 guide 11.3). Run as the
# deploy user from the repository root:
#
#   sudo -u imreport /opt/imreport/deploy/deploy.sh
#
# Pulls the release, installs backend dependencies, migrates, rebuilds the
# caches and the SPA, restarts the queue worker, and health-checks the API.

set -euo pipefail

APP_DIR="${APP_DIR:-/opt/imreport}"
WEBROOT="${WEBROOT:-/var/www/imreport}"
APP_URL="${APP_URL:-https://im.hospital.internal}"

cd "${APP_DIR}"

echo "==> Pulling latest release"
git pull --ff-only

echo "==> Backend dependencies"
cd "${APP_DIR}/backend"
composer install --no-dev --optimize-autoloader --no-interaction

echo "==> Database migrations"
php artisan migrate --force

echo "==> Rebuilding caches"
php artisan config:cache
php artisan route:cache
php artisan view:cache

echo "==> Building the SPA"
cd "${APP_DIR}"
npm ci
npm run build
mkdir -p "${WEBROOT}"
rsync -a --delete dist/ "${WEBROOT}/"

echo "==> Restarting the queue worker"
cd "${APP_DIR}/backend"
php artisan queue:restart

# Health check: an unauthenticated call to a protected endpoint must return
# 401 - that proves nginx, PHP-FPM, Laravel, and the auth wall are all up.
echo "==> Health check"
STATUS="$(curl -sk -o /dev/null -w '%{http_code}' "${APP_URL}/api/workspace")"
if [ "${STATUS}" != "401" ] && [ "${STATUS}" != "419" ]; then
  echo "HEALTH CHECK FAILED: expected 401 from ${APP_URL}/api/workspace, got ${STATUS}" >&2
  exit 1
fi
echo "Healthy: ${APP_URL}/api/workspace answered ${STATUS} (auth wall up)."

echo "==> Launch readiness"
php artisan app:launch-check || true

echo "Deploy complete."
