# syntax=docker/dockerfile:1.7

ARG PHP_VERSION=8.3
ARG NODE_VERSION=22
ARG NGINX_VERSION=1.27

FROM node:${NODE_VERSION}-bookworm-slim AS frontend
WORKDIR /build
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ARG VITE_API_BASE_URL=https://localhost:18443
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}
RUN npm run build

# The repository's existing parity base is PHP 8.3 and its composer.lock hash is
# verified by the audit runner before use. Reusing the compiled extension/vendor
# layers avoids measuring Docker mirror availability. All application source is
# removed and replaced below, so no stale application code survives.
FROM imreport-parity/app:local AS app
RUN set -eux; \
    pecl install redis; \
    docker-php-ext-enable redis

ENV COMPOSER_ALLOW_SUPERUSER=1 COMPOSER_NO_INTERACTION=1
WORKDIR /opt/imreport/current/backend
RUN find . -mindepth 1 -maxdepth 1 ! -name vendor -exec rm -rf {} +
COPY backend/ ./
RUN composer dump-autoload --optimize --no-dev --no-scripts \
    && php artisan package:discover --ansi

COPY docker/audit/php.ini /usr/local/etc/php/conf.d/zz-imreport-audit.ini
COPY docker/audit/php-fpm.conf /usr/local/etc/php-fpm.d/zz-imreport-audit.conf
COPY docker/audit/entrypoint.sh /usr/local/bin/imreport-audit-entrypoint
COPY docker/audit/scripts/ /audit/
RUN set -eux; \
    chmod +x /usr/local/bin/imreport-audit-entrypoint; \
    mkdir -p storage/app/public storage/framework/cache/data \
      storage/framework/sessions storage/framework/testing \
      storage/framework/views storage/logs bootstrap/cache /audit-output; \
    chown -R www-data:www-data storage bootstrap/cache /audit-output

EXPOSE 9000
ENTRYPOINT ["/usr/local/bin/imreport-audit-entrypoint"]
CMD ["php-fpm", "--nodaemonize"]

FROM nginx:${NGINX_VERSION}-alpine AS web
RUN apk add --no-cache curl openssl
RUN set -eux; \
    mkdir -p /etc/imreport/tls; \
    openssl req -x509 -nodes -newkey rsa:2048 -days 30 \
      -subj "/CN=localhost/O=imreport-audit" \
      -addext "subjectAltName=DNS:localhost,DNS:web,IP:127.0.0.1" \
      -keyout /etc/imreport/tls/privkey.pem \
      -out /etc/imreport/tls/fullchain.pem
COPY --from=frontend /build/dist /opt/imreport/current/dist
COPY docker/audit/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80 443
