<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // `home_ward_id` stays untouched until a cleanup migration one release
        // after the dated `duty_assignments` fully replace it.
        Schema::table('users', function (Blueprint $table) {
            $table->unsignedTinyInteger('training_year')->nullable();
            $table->string('rotation_group', 8)->nullable();
            $table->foreignUuid('section_id')->nullable()->constrained('sections')->nullOnDelete();
        });
    }

    public function down(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->dropConstrainedForeignId('section_id');
            $table->dropColumn(['training_year', 'rotation_group']);
        });
    }
};
