<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // Reconcile any rows produced by a pre-fix race before creating the
        // unique key. The newest version remains active; older duplicates are
        // still retained as archived history.
        foreach (['draft', 'published'] as $status) {
            $duplicates = DB::table('evaluation_forms')
                ->select('key')
                ->where('status', $status)
                ->groupBy('key')
                ->havingRaw('COUNT(*) > 1')
                ->pluck('key');

            foreach ($duplicates as $key) {
                $keepId = DB::table('evaluation_forms')
                    ->where('key', $key)
                    ->where('status', $status)
                    ->orderByDesc('version')
                    ->value('id');

                DB::table('evaluation_forms')
                    ->where('key', $key)
                    ->where('status', $status)
                    ->where('id', '!=', $keepId)
                    ->update(['status' => 'archived']);
            }
        }

        Schema::table('evaluation_forms', function (Blueprint $table) {
            // MariaDB and SQLite both allow many NULL values in a unique key.
            // Archived rows map to NULL; active rows map to their status, so a
            // key can own at most one draft and one published version.
            $table->string('active_status', 20)
                ->virtualAs("CASE WHEN status IN ('draft', 'published') THEN status ELSE NULL END");
            $table->unique(['key', 'active_status'], 'evaluation_forms_one_active_status_per_key');
        });
    }

    public function down(): void
    {
        Schema::table('evaluation_forms', function (Blueprint $table) {
            $table->dropUnique('evaluation_forms_one_active_status_per_key');
            $table->dropColumn('active_status');
        });
    }
};
