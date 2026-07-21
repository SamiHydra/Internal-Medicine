#!/usr/bin/env bash
#
# CONTAINER-ONLY source patches for the production-parity stack.
#
# ============================ READ THIS FIRST ============================
# Nothing here is a "docker workaround". Each patch below exists because the
# application source contains a defect that makes it IMPOSSIBLE to run on
# MariaDB. The repository working tree is deliberately left untouched (the
# audit brief forbids editing application source), so the fix is applied to the
# copy INSIDE the image only.
#
# Every patch here is a standing AUDIT FINDING. When the underlying defect is
# fixed in the repo, this script detects the fixed form and skips - and the
# patch should then be deleted from this file.
# ========================================================================
#
# Runs after `COPY backend/ ./` in the vendor-prod and test stages.

set -Eeuo pipefail

cd /opt/imreport/current/backend

patched=0
skipped=0

note() { printf '[parity-patch] %s\n' "$*"; }

# --------------------------------------------------------------------------
# PATCH 1 - FINDING: undergraduate migration cannot run on MariaDB at all.
#
# backend/database/migrations/2026_08_12_000010_create_undergraduate_tables.php
#
#     $table->unique(['batch_id', 'subgroup', 'activity_type', 'scheduled_date']);
#
# on table `teaching_sessions` makes Laravel auto-generate the index name
#
#     teaching_sessions_batch_id_subgroup_activity_type_scheduled_date_unique
#
# which is 71 characters. MySQL and MariaDB cap identifiers at 64:
#     SQLSTATE[42000]: 1059 Identifier name '...' is too long
#
# SQLite imposes no identifier length limit, so this migration passes on the
# dev lane and on the default phpunit.xml suite, and fails 100% of the time on
# the real database. `php artisan migrate` therefore cannot complete against
# MariaDB, which means:
#   * the department server cannot be deployed to (deploy/deploy.sh runs
#     `php artisan migrate --force`),
#   * the `backend-mariadb` CI job cannot be green,
#   * every RefreshDatabase test in the MariaDB lane dies in migrate:fresh,
#     which is why MariaDbConcurrencyRegressionTest has never actually run.
#
# Real fix (one line, belongs in the repo): give the index an explicit short
# name, as the migration already does nowhere else:
#     $table->unique([...], 'teaching_sessions_slot_unique');
# --------------------------------------------------------------------------
MIGRATION='database/migrations/2026_08_12_000010_create_undergraduate_tables.php'
BROKEN="\$table->unique(['batch_id', 'subgroup', 'activity_type', 'scheduled_date']);"
FIXED="\$table->unique(['batch_id', 'subgroup', 'activity_type', 'scheduled_date'], 'teaching_sessions_slot_unique');"

if [ ! -f "${MIGRATION}" ]; then
    note "FATAL: ${MIGRATION} not found - the patch set is stale."
    exit 1
fi

if grep -qF "${FIXED}" "${MIGRATION}"; then
    note "PATCH 1 skipped: migration already carries an explicit index name (defect fixed upstream - delete this patch)."
    skipped=$((skipped + 1))
elif grep -qF "${BROKEN}" "${MIGRATION}"; then
    php -r '
        $file = $argv[1];
        $broken = $argv[2];
        $fixed = $argv[3];
        $src = file_get_contents($file);
        $count = 0;
        $src = str_replace($broken, $fixed, $src, $count);
        if ($count !== 1) {
            fwrite(STDERR, "expected exactly 1 replacement, made {$count}\n");
            exit(1);
        }
        file_put_contents($file, $src);
    ' "${MIGRATION}" "${BROKEN}" "${FIXED}"
    note "PATCH 1 applied: teaching_sessions unique index renamed to 'teaching_sessions_slot_unique' (71 chars -> 29)."
    patched=$((patched + 1))
else
    note "FATAL: ${MIGRATION} matches neither the broken nor the fixed form."
    note "The migration changed; re-derive this patch before trusting the stack."
    exit 1
fi

note "done: ${patched} applied, ${skipped} skipped."
