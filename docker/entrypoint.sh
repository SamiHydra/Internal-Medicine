#!/usr/bin/env bash
#
# Container bootstrap for the production-parity stack.
#
# Mirrors the ordering deploy/deploy.sh uses on the department server:
#   config:clear -> migrate --force -> config:cache -> route:cache -> view:cache
# and only then starts serving.
#
# STACK_ROLE=app    : owns migrations/seeding, then runs php-fpm.
# STACK_ROLE=worker : queue worker / scheduler. Waits for the app, builds its own
#                     config cache, never touches the schema.

set -Eeuo pipefail

ROLE="${STACK_ROLE:-app}"
APP_DIR="/opt/imreport/current/backend"

cd "${APP_DIR}"

log() { printf '[entrypoint:%s] %s\n' "${ROLE}" "$*"; }

# --------------------------------------------------------------------------
# Storage skeleton. The storage/ directory is a shared named volume, which
# masks whatever the image baked in, so recreate the tree every start.
# --------------------------------------------------------------------------
mkdir -p storage/app/public \
         storage/framework/cache/data \
         storage/framework/sessions \
         storage/framework/testing \
         storage/framework/views \
         storage/logs
chown -R www-data:www-data storage bootstrap/cache 2>/dev/null || true

# --------------------------------------------------------------------------
# Wait for MariaDB. compose already gates on the db healthcheck, but a healthy
# server can still be a few connections short of accepting ours, and a
# deterministic retry beats a sleep.
# --------------------------------------------------------------------------
wait_for_database() {
    local attempt=1
    local max_attempts="${STACK_DB_WAIT_ATTEMPTS:-60}"

    while [ "${attempt}" -le "${max_attempts}" ]; do
        if php -r '
            $dsn = sprintf("mysql:host=%s;port=%s;dbname=%s",
                getenv("DB_HOST"), getenv("DB_PORT") ?: "3306", getenv("DB_DATABASE"));
            try {
                new PDO($dsn, getenv("DB_USERNAME"), getenv("DB_PASSWORD"),
                    [PDO::ATTR_TIMEOUT => 3, PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
                exit(0);
            } catch (Throwable $e) {
                fwrite(STDERR, $e->getMessage() . PHP_EOL);
                exit(1);
            }
        ' 2>/dev/null; then
            log "database reachable at ${DB_HOST}:${DB_PORT:-3306}/${DB_DATABASE} (attempt ${attempt})"
            return 0
        fi

        attempt=$((attempt + 1))
        sleep 1
    done

    log "FATAL: database never became reachable at ${DB_HOST}:${DB_PORT:-3306}"
    return 1
}

build_caches() {
    log "building config/route/view caches (deploy.sh parity)"
    php artisan config:cache
    php artisan route:cache
    php artisan view:cache
}

wait_for_database

if [ "${ROLE}" = "app" ]; then
    log "clearing stale caches"
    php artisan config:clear >/dev/null

    log "running migrations (forward-only, --force)"
    php artisan migrate --force

    if [ "${STACK_SEED_DEV_DATA:-false}" = "true" ]; then
        # DevUserSeeder / DevClinicalDataSeeder / DevAcademicDataSeeder are
        # deliberately no-ops under APP_ENV=production (see DevUserSeeder), so a
        # production-shaped stack would come up with reference data and zero
        # rows to measure. The SEEDING STEP ONLY is run with APP_ENV=local to
        # obtain realistic volume and a known login. The application itself
        # keeps running as APP_ENV=production - see docker/README.md.
        log "seeding reference + dev data (seed step forced to APP_ENV=local)"
        APP_ENV=local php artisan db:seed --force
    else
        log "seeding reference data only (STACK_SEED_DEV_DATA is not true)"
        php artisan db:seed --force
    fi

    if [ -n "${STACK_SUPERADMIN_EMAIL:-}" ]; then
        # Production path per deploy/README.md. Fails harmlessly when a
        # superadmin already exists.
        log "ensuring a superadmin exists (app:create-superadmin)"
        php artisan app:create-superadmin \
            --email="${STACK_SUPERADMIN_EMAIL}" \
            --username="${STACK_SUPERADMIN_USERNAME:-opsadmin}" \
            --full-name="${STACK_SUPERADMIN_NAME:-Stack Operator}" \
            --password="${STACK_SUPERADMIN_PASSWORD:?STACK_SUPERADMIN_PASSWORD is required when STACK_SUPERADMIN_EMAIL is set}" \
            || log "app:create-superadmin declined (a superadmin already exists)"
    fi

    build_caches
    log "bootstrap complete; starting: $*"
else
    build_caches
    log "worker ready; starting: $*"
fi

# The bootstrap above runs as root, so anything it created in the shared storage
# volume (notably storage/logs/laravel.log) would be root-owned and unwritable
# by the www-data FPM workers. Hand it back before serving.
chown -R www-data:www-data storage bootstrap/cache 2>/dev/null || true

exec "$@"
