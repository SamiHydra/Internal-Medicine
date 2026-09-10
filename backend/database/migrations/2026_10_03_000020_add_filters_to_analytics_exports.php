<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Exports are built by a queued job long after the request is gone, so the ward
 * and date-range criteria have to travel with the record rather than the call.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('analytics_exports', function (Blueprint $table) {
            $table->json('filters')->nullable()->after('format');
        });
    }

    public function down(): void
    {
        Schema::table('analytics_exports', function (Blueprint $table) {
            $table->dropColumn('filters');
        });
    }
};
