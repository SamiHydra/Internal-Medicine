<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Phase 3 snapshot columns on both legacy evaluation tables: the physical
     * teaching ward (`ward_ref_id`, the new wards vocabulary) and the placement
     * kind the evaluation was written under ('ward', 'transition', 'opd',
     * 'transplant', or an external duty slug). Existing rows are backfilled
     * through the department -> ward map and marked 'ward'.
     *
     * The legacy department `ward_id` becomes nullable: OPD/transplant-paired
     * and externally-sourced evaluations have no department ward. The column
     * itself stays until Phase 4 migrates these tables wholesale.
     */
    public function up(): void
    {
        foreach (['consultant_evaluations', 'resident_evaluations'] as $table) {
            Schema::table($table, function (Blueprint $blueprint) {
                $blueprint->foreignUuid('ward_ref_id')->nullable()->constrained('wards')->nullOnDelete();
                $blueprint->string('placement_type', 32)->nullable();
            });

            Schema::table($table, function (Blueprint $blueprint) {
                $blueprint->uuid('ward_id')->nullable()->change();
            });

            DB::statement(
                "update {$table} set ward_ref_id = (select ward_id from departments where departments.id = {$table}.ward_id), placement_type = 'ward'",
            );
        }
    }

    public function down(): void
    {
        foreach (['consultant_evaluations', 'resident_evaluations'] as $table) {
            Schema::table($table, function (Blueprint $blueprint) {
                $blueprint->dropConstrainedForeignId('ward_ref_id');
                $blueprint->dropColumn('placement_type');
            });
        }
    }
};
