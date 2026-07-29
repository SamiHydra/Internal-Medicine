<?php

namespace Tests\Feature;

use App\Models\User;
use App\Services\Workspace\WorkspaceRevisionService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use RuntimeException;
use Tests\TestCase;

class WorkspaceRevisionLedgerTest extends TestCase
{
    use RefreshDatabase;

    /** @var list<string> */
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

    public function test_every_workspace_mutating_table_has_insert_update_and_delete_triggers(): void
    {
        $actual = collect(DB::select(
            "SELECT name FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'workspace_revision_%'",
        ))->pluck('name')->sort()->values()->all();

        $expected = collect(self::TABLES)
            ->flatMap(fn (string $table): array => [
                "workspace_revision_{$table}_insert",
                "workspace_revision_{$table}_update",
                "workspace_revision_{$table}_delete",
            ])
            ->sort()
            ->values()
            ->all();

        $this->assertSame($expected, $actual);
    }

    public function test_ledger_tracks_all_write_shapes_and_rolls_back_with_the_domain_write(): void
    {
        $this->assertSame(0, $this->version());

        DB::table('roles')->insert([
            'role_key' => 'ledger_test',
            'label' => 'Ledger test',
            'description' => 'Revision trigger fixture.',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $this->assertSame(1, $this->version());

        DB::table('roles')->where('role_key', 'ledger_test')->update(['label' => 'Updated']);
        $this->assertSame(2, $this->version());

        try {
            DB::transaction(function (): void {
                DB::table('roles')->where('role_key', 'ledger_test')->update(['label' => 'Rolled back']);
                throw new RuntimeException('force rollback');
            });
        } catch (RuntimeException) {
            // Expected: the ledger update must roll back with the domain row.
        }
        $this->assertSame(2, $this->version());

        DB::table('roles')->where('role_key', 'ledger_test')->delete();
        $this->assertSame(3, $this->version());
    }

    public function test_service_reads_only_the_single_ledger_value(): void
    {
        $user = new User();
        $service = app(WorkspaceRevisionService::class);
        $before = $service->for($user);

        DB::flushQueryLog();
        DB::enableQueryLog();
        $same = $service->for($user);
        $queries = DB::getQueryLog();
        DB::disableQueryLog();

        $this->assertSame($before, $same);
        $this->assertCount(1, $queries);
        $this->assertStringContainsString('workspace_revisions', $queries[0]['query']);

        DB::table('roles')->insert([
            'role_key' => 'ledger_token',
            'label' => 'Ledger token',
            'description' => 'Opaque token fixture.',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $this->assertNotSame($before, $service->for($user));
    }

    private function version(): int
    {
        return (int) DB::table('workspace_revisions')->where('id', 1)->value('version');
    }
}
