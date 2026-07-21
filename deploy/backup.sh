#!/usr/bin/env bash
#
# Nightly database backup (V2 guide 11.3). Install on the 02:00 cron:
#
#   0 2 * * *  /opt/imreport/deploy/backup.sh >> /var/log/imreport-backup.log 2>&1
#
# What it does: a consistent mysqldump, gzipped into $BACKUP_DIR, 30-day
# rotation, a copy to the off-box location ($SECONDARY_DIR: a second disk or a
# NAS mount), and on Sundays a gunzip -t integrity test of the newest dump.
# app:launch-readiness fails when the newest dump here is older than 26 hours.
#
# Rehearse a restore MONTHLY from the secondary copy (docs/OPERATIONS.md).

set -euo pipefail

BACKUP_ENV_FILE="${BACKUP_ENV_FILE:-/opt/imreport/shared/backend.env}"

read_env_value() {
  local key="$1"
  local value=""

  if [ -f "${BACKUP_ENV_FILE}" ]; then
    value="$(sed -n "s/^[[:space:]]*${key}=//p" "${BACKUP_ENV_FILE}" | tail -n 1)"
    value="${value%\"}"
    value="${value#\"}"
    value="${value%\'}"
    value="${value#\'}"
  fi

  printf '%s' "${value}"
}

CONFIGURED_DB_NAME="$(read_env_value DB_DATABASE)"
DB_NAME="${BACKUP_DB_NAME:-${CONFIGURED_DB_NAME}}"
BACKUP_DIR="${BACKUP_DIR:-$(read_env_value BACKUP_DIR)}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/imreport}"
SECONDARY_DIR="${SECONDARY_BACKUP_DIR:-${SECONDARY_DIR:-$(read_env_value SECONDARY_BACKUP_DIR)}}"
SECONDARY_DIR="${SECONDARY_DIR:-/mnt/backup/imreport}"

if [[ ! "${DB_NAME}" =~ ^[A-Za-z0-9_]+$ ]]; then
  echo "Invalid or missing backup database name. Set DB_DATABASE in ${BACKUP_ENV_FILE}." >&2
  exit 1
fi

if [ -n "${CONFIGURED_DB_NAME}" ] && [ "${DB_NAME}" != "${CONFIGURED_DB_NAME}" ]; then
  echo "Refusing backup: ${DB_NAME} does not match Laravel DB_DATABASE=${CONFIGURED_DB_NAME}." >&2
  exit 1
fi
RETENTION_DAYS="${RETENTION_DAYS:-30}"
STAMP="$(date +%Y%m%d-%H%M%S)"
DUMP="${BACKUP_DIR}/${DB_NAME}-${STAMP}.sql.gz"

mkdir -p "${BACKUP_DIR}"

# Credentials come from /etc/mysql/imreport-backup.cnf (0640, root:imreport):
#   [client]
#   user=imreport_backup
#   password=...
mysqldump --defaults-extra-file=/etc/mysql/imreport-backup.cnf \
  --single-transaction --quick --routines --triggers "${DB_NAME}" \
  | gzip > "${DUMP}"

echo "$(date -Is) wrote ${DUMP} ($(du -h "${DUMP}" | cut -f1))"

# 30-day rotation on the primary directory.
find "${BACKUP_DIR}" -name "${DB_NAME}-*.sql.gz" -mtime "+${RETENTION_DAYS}" -delete

# Off-box copy: an internet outage must never cost more than one day of data.
if [ ! -d "${SECONDARY_DIR}" ]; then
  echo "$(date -Is) ERROR: secondary directory ${SECONDARY_DIR} is not mounted" >&2
  exit 1
fi

SECONDARY_DUMP="${SECONDARY_DIR}/$(basename "${DUMP}")"
cp "${DUMP}" "${SECONDARY_DUMP}"
gunzip -t "${SECONDARY_DUMP}"
find "${SECONDARY_DIR}" -name "${DB_NAME}-*.sql.gz" -mtime "+${RETENTION_DAYS}" -delete
echo "$(date -Is) copied and verified ${SECONDARY_DUMP}"

# Weekly integrity test: a backup that does not decompress is not a backup.
if [ "$(date +%u)" = "7" ]; then
  gunzip -t "${DUMP}"
  echo "$(date -Is) integrity test passed for ${DUMP}"
fi
