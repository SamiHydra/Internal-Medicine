<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // Collapse exact historical duplicates first. The newest active row
        // is retained so the pre-migration effective assignment is preserved.
        $duplicates = DB::table('rep_assignments')
            ->select(['user_id', 'batch_id', 'scope'])
            ->selectRaw('count(*) as row_count')
            ->groupBy('user_id', 'batch_id', 'scope')
            ->havingRaw('count(*) > 1')
            ->get();

        foreach ($duplicates as $duplicate) {
            $ids = DB::table('rep_assignments')
                ->where('user_id', $duplicate->user_id)
                ->where('batch_id', $duplicate->batch_id)
                ->where('scope', $duplicate->scope)
                ->orderByDesc('active')
                ->orderByDesc('updated_at')
                ->pluck('id');

            DB::table('rep_assignments')->whereIn('id', $ids->slice(1))->delete();
        }

        // The public workspace contract exposes one singular repScope. Keep
        // the newest active assignment for each user and retain older rows as
        // inactive history before enforcing that contract in the database.
        $activeUserDuplicates = DB::table('rep_assignments')
            ->select('user_id')
            ->selectRaw('count(*) as row_count')
            ->where('active', true)
            ->groupBy('user_id')
            ->havingRaw('count(*) > 1')
            ->get();

        foreach ($activeUserDuplicates as $duplicate) {
            $ids = DB::table('rep_assignments')
                ->where('user_id', $duplicate->user_id)
                ->where('active', true)
                ->orderByDesc('updated_at')
                ->orderByDesc('created_at')
                ->orderByDesc('id')
                ->pluck('id');

            DB::table('rep_assignments')
                ->whereIn('id', $ids->slice(1))
                ->update(['active' => false, 'updated_at' => now()]);
        }

        // Older builds allowed different users to be active for the same
        // batch/scope. Preserve the most recently maintained row and
        // deactivate, rather than delete, the remaining historical rows.
        $activeScopeDuplicates = DB::table('rep_assignments')
            ->select(['batch_id', 'scope'])
            ->selectRaw('count(*) as row_count')
            ->where('active', true)
            ->groupBy('batch_id', 'scope')
            ->havingRaw('count(*) > 1')
            ->get();

        foreach ($activeScopeDuplicates as $duplicate) {
            $ids = DB::table('rep_assignments')
                ->where('batch_id', $duplicate->batch_id)
                ->where('scope', $duplicate->scope)
                ->where('active', true)
                ->orderByDesc('updated_at')
                ->orderByDesc('created_at')
                ->orderByDesc('id')
                ->pluck('id');

            DB::table('rep_assignments')
                ->whereIn('id', $ids->slice(1))
                ->update(['active' => false, 'updated_at' => now()]);
        }

        Schema::table('rep_assignments', function (Blueprint $table) {
            $table->unique(['user_id', 'batch_id', 'scope'], 'rep_assignments_user_batch_scope_unique');

            // Both MariaDB and SQLite permit multiple NULL values in a unique
            // index. Inactive rows therefore retain their history, while the
            // generated scope key makes one active row per batch/scope a hard
            // database invariant even for writers outside this application.
            $table->string('active_scope_key', 32)
                ->nullable()
                ->virtualAs('CASE WHEN active = 1 THEN scope ELSE NULL END');
            $table->unique(['batch_id', 'active_scope_key'], 'rep_assignments_active_batch_scope_unique');

            $table->string('active_user_key', 36)
                ->nullable()
                ->virtualAs('CASE WHEN active = 1 THEN user_id ELSE NULL END');
            $table->unique('active_user_key', 'rep_assignments_active_user_unique');
        });
    }

    public function down(): void
    {
        Schema::table('rep_assignments', function (Blueprint $table) {
            $table->dropUnique('rep_assignments_active_user_unique');
            $table->dropColumn('active_user_key');
            $table->dropUnique('rep_assignments_active_batch_scope_unique');
            $table->dropColumn('active_scope_key');
            $table->dropUnique('rep_assignments_user_batch_scope_unique');
        });
    }
};
