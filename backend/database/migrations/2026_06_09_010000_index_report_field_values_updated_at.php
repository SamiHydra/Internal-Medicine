<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * report_field_values is the fastest-growing table, and the analytics dashboard
 * fingerprint runs MAX(updated_at) over it on every request. Without an index
 * that is a full scan that degrades linearly with history; this makes it O(1).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('report_field_values', function (Blueprint $table): void {
            $table->index('updated_at', 'report_field_values_updated_at_index');
        });
    }

    public function down(): void
    {
        Schema::table('report_field_values', function (Blueprint $table): void {
            $table->dropIndex('report_field_values_updated_at_index');
        });
    }
};
