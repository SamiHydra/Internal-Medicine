<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Tables whose mutations can change a workspace, a workspace-scoped page,
     * or the lightweight live-refresh data those pages consume.
     *
     * Keep this list frozen in the migration. A future domain table should add
     * its triggers in a new migration rather than changing historical setup.
     *
     * @var list<string>
     */
    private const TABLES = [
        'access_request_items',
        'access_requests',
        'action_items',
        'admin_access_requests',
        'admin_audit_logs',
        'analytics_exports',
        'app_settings',
        'audit_logs',
        'calculated_metrics',
        'departments',
        'duty_assignments',
        'duty_types',
        'evaluation_answers',
        'evaluation_form_fields',
        'evaluation_forms',
        'evaluations',
        'morning_attendance',
        'morning_roster_overrides',
        'morning_sessions',
        'notifications',
        'rep_assignments',
        'report_assignments',
        'report_comments',
        'report_field_definitions',
        'report_field_values',
        'report_status_history',
        'report_templates',
        'reporting_periods',
        'reports',
        'roles',
        'rotation_blocks',
        'rotation_calendars',
        'sections',
        'student_attendance',
        'student_batches',
        'students',
        'subgroup_placements',
        'teaching_activity_schedules',
        'teaching_sessions',
        'transfer_requests',
        'users',
        'wards',
    ];

    public function up(): void
    {
        Schema::create('workspace_revisions', function (Blueprint $table): void {
            $table->unsignedTinyInteger('id')->primary();
            $table->unsignedBigInteger('version')->default(0);
            $table->timestamp('updated_at')->nullable();
        });

        DB::table('workspace_revisions')->insert([
            'id' => 1,
            'version' => 0,
            'updated_at' => now(),
        ]);

        foreach (self::TABLES as $table) {
            foreach (['insert', 'update', 'delete'] as $event) {
                $this->createTrigger($table, $event);
            }
        }
    }

    public function down(): void
    {
        foreach (self::TABLES as $table) {
            foreach (['insert', 'update', 'delete'] as $event) {
                DB::unprepared(sprintf(
                    'DROP TRIGGER IF EXISTS %s',
                    $this->quote($this->triggerName($table, $event)),
                ));
            }
        }

        Schema::dropIfExists('workspace_revisions');
    }

    private function createTrigger(string $table, string $event): void
    {
        $trigger = $this->quote($this->triggerName($table, $event));
        $quotedTable = $this->quote($table);
        $eventSql = strtoupper($event);

        if (DB::connection()->getDriverName() === 'sqlite') {
            DB::unprepared(sprintf(
                'CREATE TRIGGER %s AFTER %s ON %s BEGIN '
                .'UPDATE "workspace_revisions" '
                .'SET "version" = "version" + 1, "updated_at" = CURRENT_TIMESTAMP '
                .'WHERE "id" = 1; END',
                $trigger,
                $eventSql,
                $quotedTable,
            ));

            return;
        }

        DB::unprepared(sprintf(
            'CREATE TRIGGER %s AFTER %s ON %s FOR EACH ROW '
            .'UPDATE `workspace_revisions` '
            .'SET `version` = `version` + 1, `updated_at` = CURRENT_TIMESTAMP '
            .'WHERE `id` = 1',
            $trigger,
            $eventSql,
            $quotedTable,
        ));
    }

    private function triggerName(string $table, string $event): string
    {
        return sprintf('workspace_revision_%s_%s', $table, $event);
    }

    private function quote(string $identifier): string
    {
        if (DB::connection()->getDriverName() === 'sqlite') {
            return '"'.str_replace('"', '""', $identifier).'"';
        }

        return '`'.str_replace('`', '``', $identifier).'`';
    }
};
