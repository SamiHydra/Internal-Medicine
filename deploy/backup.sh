#!/usr/bin/env bash
#
# Nightly database backup (V2 guide 11.3). Install on the 02:00 cron:
#
#   0 2 * * *  /opt/imreport/deploy/backup.sh >> /var/log/imreport-backup.log 2>&1
#
# What it does: a consistent mysqldump gzipped into $BACKUP_DIR, a tar.gz of
# the uploaded files under shared/storage/app (action-item evidence, import
# files; regenerable analytics exports are skipped), 30-day rotation, a copy of
# both to the off-box location ($SECONDARY_DIR: a second disk or a NAS mount),
# and on Sundays an integrity test of the newest dump and archive.
# app:launch-readiness fails when the newest dump or archive here is older
# than 26 hours.
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
# Uploaded files live next to backend.env: /opt/imreport/shared/storage/app.
STORAGE_DIR="${STORAGE_DIR:-$(dirname "${BACKUP_ENV_FILE}")/storage}"
STORAGE_ARCHIVE="${BACKUP_DIR}/${DB_NAME}-storage-${STAMP}.tar.gz"

mkdir -p "${BACKUP_DIR}"

# Credentials come from /etc/mysql/imreport-backup.cnf (0640, root:imreport):
#   [client]
#   user=imreport_backup
#   password=...
mysqldump --defaults-extra-file=/etc/mysql/imreport-backup.cnf \
  --single-transaction --quick --routines --triggers "${DB_NAME}" \
  | gzip > "${DUMP}"

echo "$(date -Is) wrote ${DUMP} ($(du -h "${DUMP}" | cut -f1))"

# Files outside the database (QA-015): evidence uploads and import files are
# irreplaceable, so they travel with every dump. analytics-exports/ is rebuilt
# on demand and can be large, so it is left out.
if [ ! -d "${STORAGE_DIR}/app" ]; then
  echo "$(date -Is) ERROR: storage directory ${STORAGE_DIR}/app not found (set STORAGE_DIR)" >&2
  exit 1
fi
# The local disk root is storage/app/private on this Laravel version; the
# older storage/app layout is excluded too so a moved root never silently
# re-includes the regenerable export files.
tar --exclude='app/private/analytics-exports' --exclude='app/analytics-exports'   -czf "${STORAGE_ARCHIVE}" -C "${STORAGE_DIR}" app
echo "$(date -Is) wrote ${STORAGE_ARCHIVE} ($(du -h "${STORAGE_ARCHIVE}" | cut -f1))"

# 30-day rotation on the primary directory.
find "${BACKUP_DIR}" -name "${DB_NAME}-*.sql.gz" -mtime "+${RETENTION_DAYS}" -delete
find "${BACKUP_DIR}" -name "${DB_NAME}-storage-*.tar.gz" -mtime "+${RETENTION_DAYS}" -delete

# Off-box copy: an internet outage must never cost more than one day of data.
if [ ! -d "${SECONDARY_DIR}" ]; then
  echo "$(date -Is) ERROR: secondary directory ${SECONDARY_DIR} is not mounted" >&2
  exit 1
fi

SECONDARY_DUMP="${SECONDARY_DIR}/$(basename "${DUMP}")"
cp "${DUMP}" "${SECONDARY_DUMP}"
gunzip -t "${SECONDARY_DUMP}"
SECONDARY_ARCHIVE="${SECONDARY_DIR}/$(basename "${STORAGE_ARCHIVE}")"
cp "${STORAGE_ARCHIVE}" "${SECONDARY_ARCHIVE}"
gunzip -t "${SECONDARY_ARCHIVE}"
find "${SECONDARY_DIR}" -name "${DB_NAME}-*.sql.gz" -mtime "+${RETENTION_DAYS}" -delete
find "${SECONDARY_DIR}" -name "${DB_NAME}-storage-*.tar.gz" -mtime "+${RETENTION_DAYS}" -delete
echo "$(date -Is) copied and verified ${SECONDARY_DUMP} and ${SECONDARY_ARCHIVE}"

# Weekly integrity test: a backup that does not decompress is not a backup.
if [ "$(date +%u)" = "7" ]; then
  gunzip -t "${DUMP}"
  tar -tzf "${STORAGE_ARCHIVE}" > /dev/null
  echo "$(date -Is) integrity test passed for ${DUMP} and ${STORAGE_ARCHIVE}"
fi
