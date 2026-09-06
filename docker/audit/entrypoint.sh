#!/usr/bin/env bash
set -Eeuo pipefail

cd /opt/imreport/current/backend
role="${STACK_ROLE:-app}"

mkdir -p storage/app/public storage/framework/cache/data storage/framework/sessions \
  storage/framework/testing storage/framework/views storage/logs bootstrap/cache
chown -R www-data:www-data storage bootstrap/cache /audit-output 2>/dev/null || true

until php -r '
  try {
    new PDO(
      sprintf("mysql:host=%s;port=%s;dbname=%s", getenv("DB_HOST"), getenv("DB_PORT"), getenv("DB_DATABASE")),
      getenv("DB_USERNAME"),
      getenv("DB_PASSWORD"),
      [PDO::ATTR_TIMEOUT => 3, PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]
    );
  } catch (Throwable $e) { exit(1); }
'; do
  sleep 1
done

php artisan config:clear >/dev/null

if [ "${role}" = "app" ]; then
  php artisan migrate --force
  report_count="$(php artisan tinker --execute='echo DB::table("reports")->count();' 2>/dev/null | tr -cd '0-9')"
  if [ "${STACK_SEED_DEV_DATA:-false}" = "true" ] && [ "${report_count:-0}" -lt 2000 ]; then
    APP_ENV=local php artisan db:seed --force
  fi
  php /audit/seed-audit-users.php
  php /audit/analyze-hot-tables.php
fi

php artisan config:cache
php artisan route:cache
php artisan view:cache
chown -R www-data:www-data storage bootstrap/cache /audit-output 2>/dev/null || true

exec "$@"
