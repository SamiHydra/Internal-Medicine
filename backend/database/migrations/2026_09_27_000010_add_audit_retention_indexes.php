<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('audit_logs', function (Blueprint $table): void {
            $table->index('changed_at', 'audit_logs_changed_at_index');
        });
        Schema::table('admin_audit_logs', function (Blueprint $table): void {
            $table->index('created_at', 'admin_audit_logs_created_at_index');
        });
        Schema::table('report_status_history', function (Blueprint $table): void {
            $table->index('changed_at', 'report_status_history_changed_at_index');
        });
        Schema::table('notifications', function (Blueprint $table): void {
            $table->index('read_at', 'notifications_read_at_index');
        });
    }

    public function down(): void
    {
        Schema::table('audit_logs', function (Blueprint $table): void {
            $table->dropIndex('audit_logs_changed_at_index');
        });
        Schema::table('admin_audit_logs', function (Blueprint $table): void {
            $table->dropIndex('admin_audit_logs_created_at_index');
        });
        Schema::table('report_status_history', function (Blueprint $table): void {
            $table->dropIndex('report_status_history_changed_at_index');
        });
        Schema::table('notifications', function (Blueprint $table): void {
            $table->dropIndex('notifications_read_at_index');
        });
    }
};
