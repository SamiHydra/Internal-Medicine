<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * The notifications.related_entity column is overloaded for both short type
     * tags ("report_submission") and long composite dedup keys such as
     * "reminder:{tier}:{assignmentUuid}:{periodUuid}" (up to ~90 chars). At
     * VARCHAR(64) those keys overflow: on MariaDB/MySQL in strict mode the insert
     * throws SQLSTATE 1406 (reminders/overdue never send); in non-strict mode the
     * key truncates and dedup silently breaks (duplicate spam). Widen it.
     */
    public function up(): void
    {
        Schema::table('notifications', function (Blueprint $table) {
            $table->string('related_entity', 191)->nullable()->change();
        });
    }

    public function down(): void
    {
        Schema::table('notifications', function (Blueprint $table) {
            $table->string('related_entity', 64)->nullable()->change();
        });
    }
};
