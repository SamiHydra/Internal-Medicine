<?php

namespace Tests\Feature;

use App\Models\AccessRequest;
use App\Models\AccessRequestItem;
use App\Models\AdminAuditLog;
use App\Models\AuditLog;
use App\Models\Department;
use App\Models\Report;
use App\Models\ReportAssignment;
use App\Models\ReportFieldDefinition;
use App\Models\ReportingPeriod;
use App\Models\ReportTemplate;
use App\Models\User;
use Database\Seeders\AppSettingSeeder;
use Database\Seeders\DepartmentSeeder;
use Database\Seeders\ReportFieldDefinitionSeeder;
use Database\Seeders\ReportingPeriodSeeder;
use Database\Seeders\ReportTemplateSeeder;
use Database\Seeders\RoleSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

class AdminApiTest extends TestCase
{
    use RefreshDatabase;

    private User $superadmin;

    private User $admin;

    private User $nurse;

    protected function setUp(): void
    {
        parent::setUp();

        foreach ([RoleSeeder::class, ReportTemplateSeeder::class, DepartmentSeeder::class, ReportFieldDefinitionSeeder::class, AppSettingSeeder::class, ReportingPeriodSeeder::class] as $seeder) {
            $this->seed($seeder);
        }

        $this->superadmin = User::factory()->role('superadmin', 'Super Administrator')->create([
            'full_name' => 'Root Admin',
        ]);
        $this->admin = User::factory()->role('admin', 'Administrator')->create([
            'full_name' => 'Ward Admin',
        ]);
        $this->nurse = User::factory()->create([
            'full_name' => 'Hana Nurse',
            'email' => 'hana.nurse@example.test',
            'username' => 'hana.nurse',
        ]);
    }

    public function test_admin_user_endpoints_enforce_role_rules_and_audit_changes(): void
    {
        $this->actingAs($this->nurse)
            ->getJson('/api/admin/users')
            ->assertForbidden();

        $this->actingAs($this->admin)
            ->postJson('/api/admin/users', [
                'full_name' => 'Second Admin',
                'email' => 'second.admin@example.test',
                'username' => 'second.admin',
                'password' => 'Password123!',
                'role_key' => 'admin',
            ])
            ->assertForbidden();

        $secondAdminId = $this->actingAs($this->superadmin)
            ->postJson('/api/admin/users', [
                'full_name' => 'Second Admin',
                'email' => 'second.admin@example.test',
                'username' => 'second.admin',
                'password' => 'Password123!',
                'role_key' => 'admin',
            ])
            ->assertCreated()
            ->assertJsonPath('role', 'admin')
            ->json('id');

        $managedNurseId = $this->actingAs($this->admin)
            ->postJson('/api/admin/users', [
                'full_name' => 'Managed Nurse',
                'email' => 'managed.nurse@example.test',
                'username' => 'managed.nurse',
                'password' => 'Password123!',
                'role_key' => 'nurse',
                'password_change_required' => false,
            ])
            ->assertCreated()
            ->assertJsonPath('role', 'nurse')
            ->json('id');

        $this->actingAs($this->admin)
            ->patchJson("/api/admin/users/{$secondAdminId}/active", ['active' => false])
            ->assertForbidden();

        $this->actingAs($this->superadmin)
            ->patchJson("/api/admin/users/{$secondAdminId}/active", ['active' => false])
            ->assertOk()
            ->assertJsonPath('active', false);

        $this->actingAs($this->admin)
            ->patchJson("/api/admin/users/{$managedNurseId}/active", ['active' => false])
            ->assertOk()
            ->assertJsonPath('active', false);

        $this->actingAs($this->admin)
            ->postJson("/api/admin/users/{$managedNurseId}/reset-password", [
                'password' => 'NewPassword123!',
            ])
            ->assertOk()
            ->assertJsonPath('passwordChangeRequired', true);

        $managedNurse = User::query()->findOrFail($managedNurseId);

        $this->assertTrue(Hash::check('NewPassword123!', $managedNurse->password));
        $this->assertTrue((bool) $managedNurse->password_change_required);
        $this->assertGreaterThanOrEqual(4, AdminAuditLog::query()->where('entity_type', 'user')->count());
    }

    public function test_user_directory_query_count_does_not_grow_per_assignment(): void
    {
        $department = Department::query()->where('slug', 'gi_neuro_inpatient')->firstOrFail();

        foreach (range(1, 8) as $index) {
            $nurse = User::factory()->create([
                'email' => "directory.nurse{$index}@example.test",
                'username' => "directory.nurse{$index}",
            ]);

            ReportAssignment::query()->create([
                'nurse_id' => $nurse->id,
                'department_id' => $department->id,
                'template_id' => $department->template_id,
                'active' => true,
                'approved_at' => now(),
                'approved_by' => $this->admin->id,
            ]);
        }

        DB::flushQueryLog();
        DB::enableQueryLog();

        $this->actingAs($this->admin)
            ->getJson('/api/admin/users')
            ->assertOk()
            ->assertJsonCount(11, 'data');

        $queryCount = count(DB::getQueryLog());
        DB::disableQueryLog();

        $this->assertLessThanOrEqual(10, $queryCount, "User directory executed {$queryCount} queries.");
    }

    public function test_access_request_review_and_assignment_admin_endpoints(): void
    {
        $request = $this->createAccessRequest($this->nurse, 'gi_neuro_inpatient');

        $this->actingAs($this->admin)
            ->getJson('/api/admin/access-requests?status=pending')
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.id', $request->id)
            ->assertJsonPath('data.0.requestedAssignments.0.departmentSlug', 'gi_neuro_inpatient');

        $this->actingAs($this->admin)
            ->postJson("/api/admin/access-requests/{$request->id}/approve")
            ->assertOk()
            ->assertJsonPath('status', 'approved')
            ->assertJsonPath('reviewedBy', $this->admin->id);

        $this->assertDatabaseHas('report_assignments', [
            'nurse_id' => $this->nurse->id,
            'active' => true,
        ]);
        $this->assertDatabaseHas('notifications', [
            'recipient_id' => $this->nurse->id,
            'type' => 'access_request_reviewed',
            'related_entity' => 'access_request',
            'related_id' => $request->id,
        ]);
        $this->assertDatabaseHas('admin_audit_logs', [
            'action' => 'review',
            'entity_type' => 'access_request',
            'entity_id' => $request->id,
        ]);

        $department = Department::query()->where('slug', 'cardiac_inpatient')->firstOrFail();

        $assignmentId = $this->actingAs($this->admin)
            ->postJson('/api/admin/assignments', [
                'nurse_id' => $this->nurse->id,
                'department_id' => $department->slug,
                'template_id' => 'inpatient_weekly',
            ])
            ->assertCreated()
            ->assertJsonPath('departmentSlug', 'cardiac_inpatient')
            ->json('id');

        $this->actingAs($this->admin)
            ->patchJson("/api/admin/assignments/{$assignmentId}", ['active' => false])
            ->assertOk()
            ->assertJsonPath('active', false);
    }

    public function test_reference_data_endpoints_create_update_and_delete_only_when_safe(): void
    {
        $templateId = $this->actingAs($this->admin)
            ->postJson('/api/admin/templates', [
                'slug' => 'test_weekly',
                'family' => 'outpatient',
                'name' => 'Test Weekly',
                'description' => 'A temporary outpatient template.',
                'active_days' => ['monday', 'tuesday'],
                'metadata' => ['ui_family' => 'outpatient'],
            ])
            ->assertCreated()
            ->assertJsonPath('slug', 'test_weekly')
            ->json('id');

        $departmentId = $this->actingAs($this->admin)
            ->postJson('/api/admin/departments', [
                'slug' => 'test_outpatient',
                'family' => 'outpatient',
                'template_id' => 'test_weekly',
                'name' => 'Test OPD',
                'description' => 'Temporary outpatient department.',
                'accent_color' => '#123456',
            ])
            ->assertCreated()
            ->assertJsonPath('templateSlug', 'test_weekly')
            ->json('id');

        $this->actingAs($this->admin)
            ->patchJson("/api/admin/departments/{$departmentId}/active", ['active' => false])
            ->assertOk()
            ->assertJsonPath('active', false);

        $unsafeDepartment = Department::query()->where('slug', 'gi_neuro_inpatient')->firstOrFail();
        ReportAssignment::query()->create([
            'nurse_id' => $this->nurse->id,
            'department_id' => $unsafeDepartment->id,
            'template_id' => $unsafeDepartment->template_id,
            'active' => true,
            'approved_at' => now(),
            'approved_by' => $this->admin->id,
        ]);

        $this->actingAs($this->admin)
            ->deleteJson("/api/admin/departments/{$unsafeDepartment->id}")
            ->assertUnprocessable()
            ->assertJsonValidationErrors('department');

        $this->actingAs($this->admin)
            ->deleteJson("/api/admin/departments/{$departmentId}")
            ->assertNoContent();

        $this->actingAs($this->admin)
            ->deleteJson("/api/admin/templates/{$templateId}")
            ->assertNoContent();

        $this->assertDatabaseMissing('departments', ['id' => $departmentId]);
        $this->assertDatabaseMissing('report_templates', ['id' => $templateId]);
    }

    public function test_settings_update_recalculates_deadlines_and_audit_logs_are_queryable(): void
    {
        $period = ReportingPeriod::query()->orderBy('week_start')->firstOrFail();

        $this->actingAs($this->admin)
            ->patchJson('/api/admin/settings', [
                'deadlineEnforced' => false,
                'weeklyDeadlineDay' => 'tuesday',
                'weeklyDeadlineTime' => '09:15',
                'autoLockHoursAfterDeadline' => 48,
                'notableRiseThresholdPercent' => 15,
                'notableDropThresholdPercent' => 12,
                'criticalNonZeroFields' => ['new_deaths', 'total_hai'],
                'metricTargets' => [
                    'deliveryRate' => [
                        'enabled' => true,
                        'direction' => 'atLeast',
                        'amber' => 80,
                        'green' => 95,
                    ],
                    'inpatientSafetyEvents' => [
                        'enabled' => true,
                        'direction' => 'atMost',
                        'amber' => 2,
                        'green' => 0,
                    ],
                ],
            ])
            ->assertOk()
            ->assertJsonPath('settings.deadlineEnforced', false)
            ->assertJsonPath('settings.weeklyDeadlineDay', 'tuesday')
            ->assertJsonPath('settings.autoLockHoursAfterDeadline', 48)
            ->assertJsonPath('settings.metricTargets.deliveryRate.green', 95)
            ->assertJsonPath('settings.metricTargets.inpatientSafetyEvents.direction', 'atMost')
            ->assertJsonPath('settings.metricTargets.procedureThroughput.green', 100);

        $expectedDeadline = Carbon::parse($period->week_start)->addDay()->setTime(9, 15);

        $this->assertSame(
            $expectedDeadline->toDateTimeString(),
            $period->refresh()->deadline_at->toDateTimeString(),
        );
        $this->assertDatabaseHas('app_settings', [
            'setting_key' => 'workflow_controls',
            'updated_by' => $this->admin->id,
        ]);
        $this->assertDatabaseHas('app_settings', [
            'setting_key' => 'metric_targets',
            'updated_by' => $this->admin->id,
        ]);

        $report = $this->createSubmittedReport();
        $fieldDefinition = ReportFieldDefinition::query()
            ->where('template_id', $report->template_id)
            ->where('field_key', 'total_patient_days')
            ->firstOrFail();

        AuditLog::query()->create([
            'report_id' => $report->id,
            'field_definition_id' => $fieldDefinition->id,
            'field_key' => 'total_patient_days',
            'day_name' => 'monday',
            'old_value' => '10',
            'new_value' => '12',
            'changed_by' => $this->admin->id,
            'changed_by_name' => $this->admin->full_name,
            'changed_at' => now(),
            'department_id' => $report->department_id,
            'template_id' => $report->template_id,
        ]);

        $this->actingAs($this->admin)
            ->getJson('/api/admin/audit-logs?department_id=gi_neuro_inpatient')
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.fieldKey', 'total_patient_days')
            ->assertJsonPath('data.0.departmentSlug', 'gi_neuro_inpatient');

        $this->actingAs($this->admin)
            ->getJson('/api/admin/admin-audit-logs?entity_type=app_settings')
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.action', 'update');
    }

    public function test_settings_save_without_deadline_change_does_not_recalculate_deadlines(): void
    {
        $period = ReportingPeriod::query()->orderBy('week_start')->firstOrFail();
        // A deadline that does NOT match the week_start+offset formula, so any
        // recalculation would visibly change it.
        $sentinel = Carbon::parse($period->week_start)->addDays(3)->setTime(15, 30);
        $period->forceFill(['deadline_at' => $sentinel])->save();

        // Save settings WITHOUT touching the deadline day/time (only an unrelated
        // insight threshold). The deadline must be left exactly as-is.
        $this->actingAs($this->admin)
            ->patchJson('/api/admin/settings', ['notableRiseThresholdPercent' => 20])
            ->assertOk();

        $this->assertSame(
            $sentinel->toDateTimeString(),
            $period->fresh()->deadline_at->toDateTimeString(),
        );
    }

    public function test_template_content_update_preserves_sibling_metadata(): void
    {
        $template = ReportTemplate::query()->where('slug', 'inpatient_weekly')->firstOrFail();
        $this->assertArrayHasKey('validation_rules', $template->metadata ?? []);
        $this->assertArrayHasKey('ui_family', $template->metadata ?? []);

        // A plain content save only sends metadata.presentation. The sibling keys
        // (validation_rules drives quality scoring; ui_family drives grouping) must
        // survive rather than being wiped by a full-column overwrite.
        $this->actingAs($this->admin)
            ->patchJson("/api/admin/templates/{$template->slug}", [
                'metadata' => ['presentation' => ['accent' => 'blue']],
            ])
            ->assertOk();

        $fresh = $template->fresh();
        $this->assertSame(['accent' => 'blue'], $fresh->metadata['presentation']);
        $this->assertArrayHasKey('validation_rules', $fresh->metadata);
        $this->assertArrayHasKey('ui_family', $fresh->metadata);
    }

    private function createAccessRequest(User $user, string $departmentSlug): AccessRequest
    {
        $department = Department::query()->where('slug', $departmentSlug)->firstOrFail();
        $accessRequest = AccessRequest::query()->create([
            'user_id' => $user->id,
            'email' => $user->email,
            'status' => 'pending',
            'notes' => 'Please add reporting access.',
            'requested_at' => now(),
        ]);

        AccessRequestItem::query()->create([
            'access_request_id' => $accessRequest->id,
            'department_id' => $department->id,
            'template_id' => $department->template_id,
        ]);

        return $accessRequest;
    }

    private function createSubmittedReport(): Report
    {
        $department = Department::query()->where('slug', 'gi_neuro_inpatient')->firstOrFail();
        $period = ReportingPeriod::query()->orderBy('week_start')->firstOrFail();
        $assignment = ReportAssignment::query()->updateOrCreate(
            [
                'nurse_id' => $this->nurse->id,
                'department_id' => $department->id,
                'template_id' => $department->template_id,
            ],
            [
                'active' => true,
                'approved_at' => now(),
                'approved_by' => $this->admin->id,
            ],
        );

        return Report::query()->create([
            'assignment_id' => $assignment->id,
            'department_id' => $department->id,
            'template_id' => $department->template_id,
            'reporting_period_id' => $period->id,
            'status' => 'submitted',
            'submitted_at' => now(),
            'created_by' => $this->nurse->id,
            'updated_by' => $this->nurse->id,
        ]);
    }
}
