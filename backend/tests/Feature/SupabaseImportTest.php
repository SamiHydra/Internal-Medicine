<?php

namespace Tests\Feature;

use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\File;
use Tests\TestCase;

class SupabaseImportTest extends TestCase
{
    use RefreshDatabase;

    private const ADMIN_ID = 'aaaaaaaa-0000-4000-8000-000000000001';

    private const NURSE_ID = 'aaaaaaaa-0000-4000-8000-000000000002';

    private const TEMPLATE_ID = 'bbbbbbbb-0000-4000-8000-000000000001';

    private const DEPARTMENT_ID = 'cccccccc-0000-4000-8000-000000000001';

    private const FIELD_ID = 'dddddddd-0000-4000-8000-000000000001';

    private const PERIOD_ID = 'eeeeeeee-0000-4000-8000-000000000001';

    private const ASSIGNMENT_ID = 'ffffffff-0000-4000-8000-000000000001';

    private const REPORT_ID = '99999999-0000-4000-8000-000000000001';

    private string $importPath;

    protected function setUp(): void
    {
        parent::setUp();

        $this->importPath = sys_get_temp_dir().DIRECTORY_SEPARATOR.'supabase-import-test-'.uniqid();
        File::ensureDirectoryExists($this->importPath);
        config(['supabase.import_path' => $this->importPath]);

        $this->writeFixtures();
    }

    protected function tearDown(): void
    {
        File::deleteDirectory($this->importPath);

        parent::tearDown();
    }

    public function test_imports_full_snapshot_preserving_ids_and_forcing_password_reset(): void
    {
        $this->artisan('supabase:import')->assertSuccessful();

        // Primary keys are preserved 1:1 so foreign keys stay valid.
        $this->assertDatabaseCount('users', 2);
        $this->assertDatabaseHas('users', ['id' => self::NURSE_ID, 'email' => 'hana.nurse@example.test']);
        $this->assertDatabaseHas('reports', ['id' => self::REPORT_ID, 'status' => 'submitted']);

        // Passwords cannot migrate: every user is forced to reset and gets a real hash.
        $nurse = DB::table('users')->where('id', self::NURSE_ID)->first();
        $this->assertSame(1, (int) $nurse->password_change_required);
        $this->assertNotEmpty($nurse->password);
        $this->assertStringStartsWith('$2y$', $nurse->password);
        $this->assertNotNull($nurse->email_verified_at);

        // `active` is a Laravel-only template column with no source value.
        $this->assertSame(1, (int) DB::table('report_templates')->where('id', self::TEMPLATE_ID)->value('active'));

        // JSON, datetime and numeric coercion land correctly.
        $value = DB::table('report_field_values')->where('report_id', self::REPORT_ID)->first();
        $this->assertSame('monday', $value->day_name);
        $this->assertSame(5.0, (float) $value->value_number);

        $metrics = DB::table('calculated_metrics')->where('report_id', self::REPORT_ID)->first();
        $this->assertIsArray(json_decode($metrics->metric_payload, true));

        $this->assertDatabaseHas('notifications', ['recipient_id' => self::ADMIN_ID, 'type' => 'new_report_submitted']);
        $this->assertDatabaseHas('app_settings', ['setting_key' => 'workflow_controls']);
    }

    public function test_dry_run_writes_nothing(): void
    {
        $this->artisan('supabase:import', ['--dry-run' => true])
            ->expectsOutputToContain('DRY RUN')
            ->assertSuccessful();

        $this->assertDatabaseCount('users', 0);
        $this->assertDatabaseCount('reports', 0);
    }

    public function test_rerun_does_not_reset_existing_user_passwords(): void
    {
        $this->artisan('supabase:import')->assertSuccessful();

        // Simulate a user who has since logged in and chosen a new password.
        DB::table('users')->where('id', self::NURSE_ID)->update([
            'password' => 'already-changed-hash',
            'password_change_required' => false,
        ]);

        $this->artisan('supabase:import')->assertSuccessful();

        $nurse = DB::table('users')->where('id', self::NURSE_ID)->first();
        $this->assertSame('already-changed-hash', $nurse->password);
        $this->assertSame(0, (int) $nurse->password_change_required);
    }

    private function writeFixtures(): void
    {
        $now = '2026-03-02T08:00:00+00:00';

        $this->putFixture('roles', [
            ['role_key' => 'admin', 'label' => 'Administrator', 'description' => 'Admin role'],
            ['role_key' => 'nurse', 'label' => 'Nurse', 'description' => 'Nurse role'],
        ]);

        $this->putFixture('profiles', [
            [
                'id' => self::ADMIN_ID, 'role_key' => 'admin', 'email' => 'admin@example.test',
                'username' => 'admin1', 'full_name' => 'Admin User', 'title' => 'Administrator',
                'active' => true, 'phone' => null, 'created_at' => $now, 'updated_at' => $now,
            ],
            [
                'id' => self::NURSE_ID, 'role_key' => 'nurse', 'email' => 'hana.nurse@example.test',
                'username' => 'hana.nurse', 'full_name' => 'Hana Nurse', 'title' => 'Head Nurse',
                'active' => true, 'phone' => '+251900000000', 'created_at' => $now, 'updated_at' => $now,
            ],
        ]);

        $this->putFixture('report_templates', [
            [
                'id' => self::TEMPLATE_ID, 'slug' => 'inpatient_weekly', 'family' => 'inpatient',
                'name' => 'Inpatient Weekly', 'description' => 'Inpatient form',
                'active_days' => ['monday', 'tuesday'], 'metadata' => ['ui_family' => 'inpatient'],
                'created_at' => $now, 'updated_at' => $now,
            ],
        ]);

        $this->putFixture('departments', [
            [
                'id' => self::DEPARTMENT_ID, 'slug' => 'gi_neuro_inpatient', 'family' => 'inpatient',
                'template_id' => self::TEMPLATE_ID, 'name' => 'GI/Neuro Inpatient', 'description' => 'Ward',
                'accent_color' => '#3366ff', 'bed_count' => 30, 'active' => true,
                'created_at' => $now, 'updated_at' => $now,
            ],
        ]);

        $this->putFixture('report_field_definitions', [
            [
                'id' => self::FIELD_ID, 'template_id' => self::TEMPLATE_ID, 'section_key' => 'patient_flow',
                'field_key' => 'total_patient_days', 'label' => 'Total Patient Days', 'field_kind' => 'integer',
                'aggregate_type' => 'sum', 'display_order' => 1, 'metadata' => [],
                'created_at' => $now, 'updated_at' => $now,
            ],
        ]);

        $this->putFixture('reporting_periods', [
            [
                'id' => self::PERIOD_ID, 'week_start' => '2026-03-02', 'week_end' => '2026-03-08',
                'deadline_at' => '2026-03-09T10:00:00+00:00', 'month_label' => 'March 2026',
                'quarter_label' => 'Q1 2026', 'year_num' => 2026, 'created_at' => $now,
            ],
        ]);

        $this->putFixture('report_assignments', [
            [
                'id' => self::ASSIGNMENT_ID, 'nurse_id' => self::NURSE_ID, 'department_id' => self::DEPARTMENT_ID,
                'template_id' => self::TEMPLATE_ID, 'active' => true, 'approved_at' => $now,
                'approved_by' => self::ADMIN_ID, 'created_at' => $now, 'updated_at' => $now,
            ],
        ]);

        $this->putFixture('access_requests', [
            [
                'id' => 'a1a1a1a1-0000-4000-8000-000000000001', 'user_id' => self::NURSE_ID,
                'email' => 'hana.nurse@example.test', 'status' => 'approved', 'notes' => null,
                'requested_at' => $now, 'reviewed_at' => $now, 'reviewed_by' => self::ADMIN_ID,
                'created_at' => $now, 'updated_at' => $now,
            ],
        ]);

        $this->putFixture('access_request_items', [
            [
                'id' => 'a2a2a2a2-0000-4000-8000-000000000001',
                'access_request_id' => 'a1a1a1a1-0000-4000-8000-000000000001',
                'department_id' => self::DEPARTMENT_ID, 'template_id' => self::TEMPLATE_ID, 'created_at' => $now,
            ],
        ]);

        $this->putFixture('reports', [
            [
                'id' => self::REPORT_ID, 'assignment_id' => self::ASSIGNMENT_ID, 'department_id' => self::DEPARTMENT_ID,
                'template_id' => self::TEMPLATE_ID, 'reporting_period_id' => self::PERIOD_ID, 'status' => 'submitted',
                'submitted_at' => $now, 'locked_at' => null, 'created_by' => self::NURSE_ID,
                'updated_by' => self::NURSE_ID, 'created_at' => $now, 'updated_at' => $now,
            ],
        ]);

        $this->putFixture('report_field_values', [
            [
                'id' => 'b1b1b1b1-0000-4000-8000-000000000001', 'report_id' => self::REPORT_ID,
                'field_definition_id' => self::FIELD_ID, 'day_name' => 'monday', 'value_number' => 5,
                'value_text' => null, 'value_time' => null, 'value_json' => null,
                'created_at' => $now, 'updated_at' => $now,
            ],
        ]);

        $this->putFixture('calculated_metrics', [
            [
                'id' => 'b2b2b2b2-0000-4000-8000-000000000001', 'report_id' => self::REPORT_ID,
                'bor_percent' => 55.5, 'btr' => 1.2, 'alos' => 4.3,
                'metric_payload' => ['total_patient_days' => 5, 'total_discharge' => 2],
                'created_at' => $now, 'updated_at' => $now,
            ],
        ]);

        $this->putFixture('report_status_history', [
            [
                'id' => 'b3b3b3b3-0000-4000-8000-000000000001', 'report_id' => self::REPORT_ID,
                'status' => 'submitted', 'changed_by' => self::NURSE_ID, 'changed_by_name' => 'Hana Nurse',
                'note' => null, 'changed_at' => $now,
            ],
        ]);

        $this->putFixture('audit_logs', [
            [
                'id' => 'b4b4b4b4-0000-4000-8000-000000000001', 'report_id' => self::REPORT_ID,
                'field_definition_id' => self::FIELD_ID, 'field_key' => 'total_patient_days', 'day_name' => 'monday',
                'old_value' => '4', 'new_value' => '5', 'changed_by' => self::ADMIN_ID,
                'changed_by_name' => 'Admin User', 'changed_at' => $now,
                'department_id' => self::DEPARTMENT_ID, 'template_id' => self::TEMPLATE_ID,
            ],
        ]);

        $this->putFixture('notifications', [
            [
                'id' => 'b5b5b5b5-0000-4000-8000-000000000001', 'recipient_id' => self::ADMIN_ID,
                'type' => 'new_report_submitted', 'title' => 'New report', 'message' => 'A report was submitted',
                'related_route' => '/admin', 'related_entity' => 'report', 'related_id' => self::REPORT_ID,
                'read_at' => null, 'created_at' => $now,
            ],
        ]);

        $this->putFixture('app_settings', [
            [
                'setting_key' => 'workflow_controls', 'value_json' => ['deadline_enforced' => true],
                'updated_by' => self::ADMIN_ID, 'updated_at' => $now,
            ],
        ]);
    }

    private function putFixture(string $table, array $rows): void
    {
        File::put(
            $this->importPath.DIRECTORY_SEPARATOR.$table.'.json',
            json_encode($rows, JSON_UNESCAPED_SLASHES),
        );
    }
}
