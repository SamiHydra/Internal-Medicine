#!/usr/bin/env bash
#
# MariaDB test lane.
#
# backend/phpunit.mariadb.xml pins the connection with force="true":
#     DB_CONNECTION=mariadb  DB_HOST=127.0.0.1  DB_PORT=3306
#     DB_DATABASE=mesay_test DB_USERNAME=mesay  DB_PASSWORD=secret
# Those values cannot be overridden from the environment, which is why the
# compose "test" service joins the testdb container's network namespace
# (network_mode: service:testdb) - that makes 127.0.0.1:3306 the MariaDB server
# without editing a single application or config file.
#
# Anything passed to this script is forwarded to phpunit, e.g.
#   --filter MariaDbConcurrencyRegressionTest

set -Eeuo pipefail

cd /opt/imreport/current/backend

mkdir -p storage/framework/cache/data storage/framework/sessions \
         storage/framework/testing storage/framework/views storage/logs

echo "[test-lane] waiting for MariaDB on 127.0.0.1:3306 (database mesay_test)"
attempt=1
until php -r '
    try {
        new PDO("mysql:host=127.0.0.1;port=3306;dbname=mesay_test", "mesay", "secret",
            [PDO::ATTR_TIMEOUT => 3, PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
        exit(0);
    } catch (Throwable $e) { exit(1); }
' 2>/dev/null; do
    if [ "${attempt}" -ge 60 ]; then
        echo "[test-lane] FATAL: MariaDB never became reachable" >&2
        exit 1
    fi
    attempt=$((attempt + 1))
    sleep 1
done

echo "[test-lane] MariaDB ready after ${attempt}s"
echo "[test-lane] vendor/bin/phpunit --configuration phpunit.mariadb.xml $*"

exec vendor/bin/phpunit --configuration phpunit.mariadb.xml "$@"
