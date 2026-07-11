#!/usr/bin/env bash
#
# Nightly database backup (V2 guide 11.3). Install on the 02:00 cron:
#
#   0 2 * * *  /opt/imreport/deploy/backup.sh >> /var/log/imreport-backup.log 2>&1
#
# What it does: a consistent mysqldump, gzipped into $BACKUP_DIR, 30-day
# rotation, a copy to the off-box location ($SECONDARY_DIR: a second disk or a
# NAS mount), and on Sundays a gunzip -t integrity test of the newest dump.
# app:launch-check fails when the newest dump here is older than 26 hours.
#
# Rehearse a restore MONTHLY from the secondary copy (docs/OPERATIONS.md).

set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/var/backups/imreport}"
SECONDARY_DIR="${SECONDARY_DIR:-/mnt/backup/imreport}"
DB_NAME="${DB_NAME:-imreport}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"
STAMP="$(date +%Y%m%d-%H%M%S)"
DUMP="${BACKUP_DIR}/${DB_NAME}-${STAMP}.sql.gz"

mkdir -p "${BACKUP_DIR}"

# Credentials come from /etc/mysql/imreport-backup.cnf (chmod 600, root:root):
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
if [ -d "${SECONDARY_DIR}" ]; then
  cp "${DUMP}" "${SECONDARY_DIR}/"
  find "${SECONDARY_DIR}" -name "${DB_NAME}-*.sql.gz" -mtime "+${RETENTION_DAYS}" -delete
  echo "$(date -Is) copied to ${SECONDARY_DIR}"
else
  echo "$(date -Is) WARNING: secondary directory ${SECONDARY_DIR} is not mounted" >&2
fi

# Weekly integrity test: a backup that does not decompress is not a backup.
if [ "$(date +%u)" = "7" ]; then
  gunzip -t "${DUMP}"
  echo "$(date -Is) integrity test passed for ${DUMP}"
fi
