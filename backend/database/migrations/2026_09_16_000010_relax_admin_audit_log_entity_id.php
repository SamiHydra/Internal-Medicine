<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * admin_audit_logs.entity_id is an OPAQUE handle, never a uuid. The duty
     * roster keys its rows on a period ("2026-07") and the read side already
     * documents that contract (AuditLogController::adminActions validates it
     * as a plain string, not `uuid`). Declaring the column `uuid` made that
     * unreachable on MariaDB 11.4, where the native uuid type rejects the
     * period outright and the whole roster save returns a 500.
     */
    public function up(): void
    {
        Schema::table('admin_audit_logs', function (Blueprint $table) {
            // The (entity_type, entity_id, created_at) index rebuilds in place.
            $table->string('entity_id', 64)->nullable()->change();
        });
    }

    public function down(): void
    {
        // A rollback narrows the column again, so any handle that is not a
        // uuid has to go first or the ALTER fails on MariaDB. Nulling is the
        // only reversible choice: the rows themselves are audit history and
        // must not be deleted.
        DB::table('admin_audit_logs')
            ->whereNotNull('entity_id')
            ->whereRaw('length(entity_id) <> 36')
            ->update(['entity_id' => null]);

        Schema::table('admin_audit_logs', function (Blueprint $table) {
            $table->uuid('entity_id')->nullable()->change();
        });
    }
};
