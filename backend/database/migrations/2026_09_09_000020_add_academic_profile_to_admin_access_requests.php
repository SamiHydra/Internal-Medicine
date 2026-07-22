<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('admin_access_requests', function (Blueprint $table) {
            // Preserve the resident's proposed scheduling profile while the
            // account is pending. Both remain nullable so pre-existing requests
            // can still be reviewed; approval enforces the final requirements.
            $table->unsignedTinyInteger('training_year')->nullable();
            $table->string('rotation_group', 8)->nullable();
        });
    }

    public function down(): void
    {
        Schema::table('admin_access_requests', function (Blueprint $table) {
            $table->dropColumn(['training_year', 'rotation_group']);
        });
    }
};
