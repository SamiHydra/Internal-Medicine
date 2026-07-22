<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * External rotations (ICU, Emergency, the external hospitals, Dermatology,
     * Radiology, Psychiatry) send paper evaluations that an administrator types
     * in. Those rows carry the external evaluator's name and department instead
     * of an author account; `entered_by_id` records which admin entered them.
     * Phase 4 carries all three columns into the unified `evaluations` table.
     */
    public function up(): void
    {
        Schema::table('resident_evaluations', function (Blueprint $table) {
            $table->uuid('author_id')->nullable()->change();
            $table->string('external_evaluator_name')->nullable();
            $table->string('external_evaluator_department')->nullable();
            $table->foreignUuid('entered_by_id')->nullable()->constrained('users')->nullOnDelete();
        });
    }

    public function down(): void
    {
        Schema::table('resident_evaluations', function (Blueprint $table) {
            $table->dropConstrainedForeignId('entered_by_id');
            $table->dropColumn(['external_evaluator_name', 'external_evaluator_department']);
        });
    }
};
