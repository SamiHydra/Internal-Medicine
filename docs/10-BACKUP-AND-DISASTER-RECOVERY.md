# 10. Backup and disaster recovery

What is backed up, how it is verified, how to restore, and what the platform
promises about data loss and recovery time.

## 1. What is backed up, and when

`deploy/backup.sh` runs from cron at 02:00 every night as `imreport`:

1. A consistent database dump (`mysqldump --single-transaction`) using the
   dump-only account in `/etc/mysql/imreport-backup.cnf`, compressed to
   `imreport-<stamp>.sql.gz`.
2. An archive of `shared/storage/app` (action-item evidence and import files)
   as `imreport-storage-<stamp>.tar.gz`. Analytics export files are excluded
   because the application rebuilds them on demand.
3. Integrity checks: the dump is decompressed with `gunzip -t`, the archive
   listed with `tar -tzf`.
4. A copy of both files to `SECONDARY_BACKUP_DIR` (the second disk or mount).
   The script exits non-zero if the secondary location is missing, so a
   silent single-copy backup cannot happen.
5. Rotation: 30 days kept in both locations.

The script reads `DB_DATABASE`, `BACKUP_DIR` and `SECONDARY_BACKUP_DIR` from
`backend.env` without executing it, and refuses an unsafe or mismatched
database name.

`deploy.sh` also takes and verifies a dump immediately before every
migration, so every deployment has its own restore point.

## 2. Verifying that backups exist

```bash
ls -lh /var/backups/imreport | tail
ls -lh /mnt/backup/imreport | tail
tail -20 /var/log/imreport-backup.log
php artisan app:launch-readiness --strict     # from /opt/imreport/current/backend
```

Readiness fails when the dump, the storage archive or the off-box copy is
older than 26 hours, and when the last restore drill is older than 90 days.

## 3. The monthly restore drill (about 10 minutes)

Restore last night's dump into a scratch database and prove it loads. This is
the only thing that makes a backup real.

```bash
mysql -e "DROP DATABASE IF EXISTS imreport_drill; CREATE DATABASE imreport_drill;"
gunzip -c /var/backups/imreport/$(ls -t /var/backups/imreport | grep '\.sql\.gz$' | head -1) | mysql imreport_drill
mysql -e "SELECT COUNT(*) AS reports FROM imreport_drill.reports;"
mysql -e "SELECT MAX(submitted_at) AS latest FROM imreport_drill.reports;"
mysql -e "DROP DATABASE imreport_drill;"
```

If the counts look right, record the drill:

```bash
# in /opt/imreport/shared/backend.env
BACKUP_RESTORE_VERIFIED_AT=2026-09-10T12:00:00+03:00
cd /opt/imreport/current/backend && php artisan config:cache
```

Also spot-check the files archive once a quarter:
`tar -tzf /var/backups/imreport/imreport-storage-<stamp>.tar.gz | head`.

## 4. Recovery objectives

Proposed engineering targets pending Hospital IT approval
(`docs/RELIABILITY_TARGETS.md`):

| Objective | Target | Basis |
|---|---|---|
| Recovery point (RPO) | 24 hours or better; nightly 02:00 dump plus a dump before every deploy | `backup.sh`, `deploy.sh` |
| Recovery time (RTO) | 2 hours from decision to restored service | the dump restores in seconds on parity; the time is the decision and host work |
| Backup verification | monthly drill; readiness fails after 90 days without one | `BACKUP_RESTORE_VERIFIED_AT` |
| Off-box copy | every night, same run | `backup.sh` exits non-zero without it |

## 5. Real restore (data loss only, with Hospital IT on the phone)

This overwrites the live database with the backup; everything entered after
the backup was taken is lost. Decide and record who approved it first.

```bash
cd /opt/imreport/current/backend
php artisan down                                   # stop users
sudo systemctl stop imreport-queue imreport-queue-notifications

# 1. Database
gunzip -c /var/backups/imreport/imreport-<stamp>.sql.gz | mysql imreport

# 2. Files from the SAME run, otherwise evidence links point at missing files
sudo -u imreport tar -xzf /var/backups/imreport/imreport-storage-<stamp>.tar.gz -C /opt/imreport/shared/storage

# 3. Bring it back
php artisan config:cache
sudo systemctl start imreport-queue imreport-queue-notifications
php artisan up
php artisan app:launch-readiness --strict
```

The archive unpacks as `app/...` under `shared/storage`, matching the live
layout; same-named files are overwritten. Afterwards tell the department which
period of entries must be re-filed; the audit trails restored with the dump
show what existed at backup time.

## 6. Scenarios

| Scenario | What to do |
|---|---|
| A deploy failed after migrating | `deploy.sh` restored the previous code release automatically. If the migration changed the schema in a way the previous code cannot use, restore the pre-migration dump it took (section 5), then fix and redeploy. See [15-RELEASE-AND-ROLLBACK](15-RELEASE-AND-ROLLBACK.md). |
| A migration failed half way on MariaDB | MariaDB has no transactional DDL; tables may be half-created. Restore the pre-migration dump. |
| Accidental data change by a user | Nothing is hard-deleted through the application; use the audit trails (cell edits, admin actions, status history) to identify and re-enter values. A full restore is a last resort. |
| Disk full | Prune old backups or logs, or grow the disk with Hospital IT; then rerun `backup.sh` by hand. |
| Server lost | Rebuild the host per [07-INSTALLATION-AND-DEPLOYMENT](07-INSTALLATION-AND-DEPLOYMENT.md) section 5, restore the latest dump and storage archive from the secondary location before the first deploy's migration, then deploy. |
| Secondary location unavailable | `backup.sh` exits non-zero and readiness flags it; fix the mount the same day. Local copies still exist. |
| Certificate expired | Users see a browser warning; the service worker stops registering. Renew per [09-OPERATIONS-MANUAL](09-OPERATIONS-MANUAL.md) section 6. |

## 7. What is not backed up, and why

- Analytics export files: regenerable; expire after 7 days; pruned after 30.
- Sessions, cache, queue tables: transient; a restore signs everyone out,
  which is correct.
- Browser-side data (workspace cache, offline queue): lives on each device;
  the offline queue replays after sign-in if the server row still matches or
  presents a conflict for review.

## 8. Retention

Nothing clinical, academic or audit-related is deleted by default. The
department must decide retention periods in writing
(`docs/DATA_RETENTION_POLICY_TEMPLATE.md`), then set the `*_RETENTION_DAYS`
variables and confirm with `app:prune-operational-data --dry-run` before the
nightly run applies them. Backups are kept 30 days; consider a monthly
long-term copy under Hospital IT policy.
