<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('notifications', function (Blueprint $table): void {
            $table->index(['recipient_id', 'created_at'], 'notifications_recipient_created_index');
        });

        Schema::table('reports', function (Blueprint $table): void {
            $table->index(['reporting_period_id', 'updated_at'], 'reports_period_updated_index');
        });
    }

    public function down(): void
    {
        Schema::table('notifications', function (Blueprint $table): void {
            $table->dropIndex('notifications_recipient_created_index');
        });

        Schema::table('reports', function (Blueprint $table): void {
            $table->dropIndex('reports_period_updated_index');
        });
    }
};
