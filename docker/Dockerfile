# syntax=docker/dockerfile:1.7
#
# Production-parity image set for the St Paul IM reporting app.
#
# Mirrors deploy/README.md + deploy/deploy.sh + deploy/nginx.conf:
#   * the SPA is BUILT (npm run build) and served as static files by nginx,
#   * Laravel runs under PHP-FPM behind the same origin,
#   * composer install --no-dev --optimize-autoloader,
#   * config/route/view caches are built before the app serves traffic,
#   * the on-disk layout is /opt/imreport/current/{backend,dist}.
#
# Targets:
#   frontend  - node build of the SPA (intermediate)
#   app       - PHP-FPM runtime (also used by the queue + scheduler services)
#   test      - PHP CLI runtime WITH dev dependencies, for the MariaDB test lane
#   web       - nginx serving dist/ and proxying /api + /sanctum to app:9000

# PHP 8.4, NOT the 8.3 named all over deploy/ and .github/workflows/ci.yml.
# backend/composer.lock pins symfony/console v8.1.1 (and 17 other symfony
# components) whose "require.php" is ">=8.4.1", so `composer install` from that
# lock file is IMPOSSIBLE on PHP 8.3. See docker/README.md.
# Must match the department server, which runs PHP-FPM 8.3 (deploy/README.md:31).
# A parity lane on a different runtime than production is not a parity lane.
ARG PHP_VERSION=8.3
ARG NODE_VERSION=22
ARG NGINX_VERSION=1.27

# --------------------------------------------------------------------------
# 1. SPA build (production bundle, exactly like deploy.sh's `npm ci && build`)
# --------------------------------------------------------------------------
FROM node:${NODE_VERSION}-bookworm-slim AS frontend

WORKDIR /build

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# src/lib/api/env.ts requires VITE_API_BASE_URL at BUILD time; there is no
# runtime fallback. It is baked into the bundle, so the published origin of the
# stack has to be known when the image is built.
ARG VITE_API_BASE_URL=https://localhost:8443
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}

RUN npm run build


# --------------------------------------------------------------------------
# 2. Shared PHP base
# --------------------------------------------------------------------------
FROM php:${PHP_VERSION}-fpm-bookworm AS php-base

# pdo_mysql : the mariadb connection (config/database.php)
# zip       : app/Support/Export/XlsxWriter.php + Import/XlsxReader.php (ZipArchive)
# bcmath    : Laravel/framework arbitrary precision helpers
# pcntl     : queue:work signal handling (graceful restart / --max-time)
# opcache   : production parity - without it every request recompiles PHP and
#             any performance measurement is meaningless
RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends libzip-dev; \
    docker-php-ext-install -j"$(nproc)" pdo_mysql zip bcmath pcntl opcache; \
    rm -rf /var/lib/apt/lists/*

COPY --from=composer:2 /usr/bin/composer /usr/bin/composer

ENV COMPOSER_ALLOW_SUPERUSER=1 \
    COMPOSER_NO_INTERACTION=1

WORKDIR /opt/imreport/current/backend


# --------------------------------------------------------------------------
# 3. Production vendor tree (--no-dev, like deploy.sh)
# --------------------------------------------------------------------------
FROM php-base AS vendor-prod

COPY backend/composer.json backend/composer.lock ./
RUN composer install --no-dev --prefer-dist --no-scripts --no-autoloader

COPY backend/ ./

# Container-only fix for a defect that makes `artisan migrate` impossible on
# MariaDB (over-long index identifier). The repo working tree is untouched;
# see docker/patches/apply-parity-patches.sh - it is an audit finding.
COPY docker/patches/apply-parity-patches.sh /tmp/apply-parity-patches.sh
RUN chmod +x /tmp/apply-parity-patches.sh && /tmp/apply-parity-patches.sh

RUN composer dump-autoload --optimize --no-dev --no-scripts \
    && php artisan package:discover --ansi


# --------------------------------------------------------------------------
# 4. PHP-FPM runtime (app, queue, scheduler)
# --------------------------------------------------------------------------
FROM php-base AS app

COPY --from=vendor-prod /opt/imreport/current/backend /opt/imreport/current/backend

COPY docker/php/php.ini /usr/local/etc/php/conf.d/zz-imreport.ini
COPY docker/php/www.conf /usr/local/etc/php-fpm.d/zz-imreport.conf
COPY docker/entrypoint.sh /usr/local/bin/imreport-entrypoint

RUN set -eux; \
    chmod +x /usr/local/bin/imreport-entrypoint; \
    mkdir -p storage/framework/cache/data storage/framework/sessions \
             storage/framework/views storage/framework/testing storage/app/public \
             storage/logs bootstrap/cache; \
    chown -R www-data:www-data /opt/imreport/current/backend/storage \
                               /opt/imreport/current/backend/bootstrap/cache

EXPOSE 9000
ENTRYPOINT ["/usr/local/bin/imreport-entrypoint"]
CMD ["php-fpm", "--nodaemonize"]


# --------------------------------------------------------------------------
# 5. Test runner (dev dependencies present, so phpunit exists)
# --------------------------------------------------------------------------
FROM php-base AS test

COPY backend/composer.json backend/composer.lock ./
RUN composer install --prefer-dist --no-scripts --no-autoloader

COPY backend/ ./

# Same container-only migration fix as the app stage; without it every
# RefreshDatabase test dies inside migrate:fresh and the MariaDB lane cannot run.
COPY docker/patches/apply-parity-patches.sh /tmp/apply-parity-patches.sh
RUN chmod +x /tmp/apply-parity-patches.sh && /tmp/apply-parity-patches.sh

RUN composer dump-autoload --no-scripts \
    && php artisan package:discover --ansi \
    && mkdir -p storage/framework/cache/data storage/framework/sessions \
                storage/framework/views storage/framework/testing storage/logs

COPY docker/php/php.ini /usr/local/etc/php/conf.d/zz-imreport.ini
COPY docker/run-mariadb-tests.sh /usr/local/bin/run-mariadb-tests
RUN chmod +x /usr/local/bin/run-mariadb-tests

# ENTRYPOINT, not CMD: the php base image ships `docker-php-entrypoint`, which
# would otherwise exec php-fpm with any arguments passed to `compose run test`.
# As an ENTRYPOINT, extra arguments are forwarded straight to phpunit, so
#   docker compose --profile test run --rm test --filter Foo
# does what it looks like.
ENTRYPOINT ["/usr/local/bin/run-mariadb-tests"]
CMD []


# --------------------------------------------------------------------------
# 6. nginx (deploy/nginx.conf, adapted for containers)
# --------------------------------------------------------------------------
FROM nginx:${NGINX_VERSION}-alpine AS web

RUN apk add --no-cache openssl curl

# Production terminates TLS with a Hospital IT internal-CA certificate at
# /etc/imreport/tls. There is no such CA here, so the image bakes a throwaway
# self-signed certificate for CN=localhost. It exists so the audit can observe
# HSTS, Secure cookies and the real TLS vhost - it is NOT a production cert.
RUN set -eux; \
    mkdir -p /etc/imreport/tls; \
    openssl req -x509 -nodes -newkey rsa:2048 -days 825 \
        -subj "/CN=localhost/O=imreport-local-parity-stack" \
        -addext "subjectAltName=DNS:localhost,DNS:web,IP:127.0.0.1" \
        -keyout /etc/imreport/tls/privkey.pem \
        -out /etc/imreport/tls/fullchain.pem; \
    chmod 600 /etc/imreport/tls/privkey.pem

COPY --from=frontend /build/dist /opt/imreport/current/dist
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80 443
