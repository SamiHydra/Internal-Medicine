<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Hot-path indexes for the fastest-growing tables, plus removal of one
     * redundant index. Identified by a scalability audit of the live query
     * patterns (cron sync, report listing, audit filtering).
     */
    public function up(): void
    {
        Schema::table('notifications', function (Blueprint $table): void {
            // OverdueReportService (reports:sync-overdue) runs every minute and
            // filters notifications by `type`. With no index on `type` this is a
            // full-table scan 1,440x/day on a table that grows with every event.
            $table->index(['type', 'recipient_id'], 'notifications_type_recipient_index');
        });

        Schema::table('reports', function (Blueprint $table): void {
            // The primary report listing filters by assignment_id and sorts by
            // updated_at (ReportWorkflowController::index -> latest('updated_at')).
            // Without this the sort is a filesort over a growing table.
            $table->index(['assignment_id', 'updated_at'], 'reports_assignment_updated_index');
        });

        Schema::table('audit_logs', function (Blueprint $table): void {
            // "Edits by user X" (AuditLogController::cellEdits) filters changed_by
            // and orders by changed_at; existing indexes all lead with a different
            // column. audit_logs is the fastest-growing audit table.
            $table->index(['changed_by', 'changed_at'], 'audit_logs_changed_by_index');
        });

        Schema::table('report_field_values', function (Blueprint $table): void {
            // Redundant: a strict prefix of the unique
            // (report_id, field_definition_id, day_name) index, so it adds only
            // write cost on the highest-volume table with zero read benefit.
            $table->dropIndex(['report_id', 'field_definition_id']);
        });
    }

    public function down(): void
    {
        Schema::table('notifications', function (Blueprint $table): void {
            $table->dropIndex('notifications_type_recipient_index');
        });

        Schema::table('reports', function (Blueprint $table): void {
            $table->dropIndex('reports_assignment_updated_index');
        });

        Schema::table('audit_logs', function (Blueprint $table): void {
            $table->dropIndex('audit_logs_changed_by_index');
        });

        Schema::table('report_field_values', function (Blueprint $table): void {
            $table->index(['report_id', 'field_definition_id']);
        });
    }
};
