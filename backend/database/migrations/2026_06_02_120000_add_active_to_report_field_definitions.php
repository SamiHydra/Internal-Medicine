<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('report_field_definitions', function (Blueprint $table) {
            // Soft-disable a field instead of deleting it, so historical
            // report_field_values are never orphaned. Defaults true so all
            // existing fields stay visible.
            $table->boolean('active')->default(true)->after('display_order');
        });
    }

    public function down(): void
    {
        Schema::table('report_field_definitions', function (Blueprint $table) {
            $table->dropColumn('active');
        });
    }
};
