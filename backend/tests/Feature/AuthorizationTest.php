<?php

namespace Tests\Feature;

use App\Models\AccessRequest;
use App\Models\Department;
use App\Models\Notification;
use App\Models\Report;
use App\Models\ReportAssignment;
use App\Models\ReportingPeriod;
use App\Models\ReportTemplate;
use App\Models\User;
use App\Support\Authorization\Permissions;
use Database\Seeders\DepartmentSeeder;
use Database\Seeders\ReportTemplateSeeder;
use Database\Seeders\RoleSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Facades\Route;
use Tests\TestCase;

class AuthorizationTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();

        foreach ([RoleSeeder::class, ReportTemplateSeeder::class, DepartmentSeeder::class] as $seeder) {
            $this->seed($seeder);
        }
    }

    public function test_permission_gates_follow_role_map_and_reject_inactive_users(): void
    {
        $admin = User::factory()->role('admin', 'Administrator')->create();
        $nurse = User::factory()->create();
        $inactiveAdmin = User::factory()->inactive()->role('admin', 'Administrator')->create();

        $this->assertTrue(Gate::forUser($admin)->allows(Permissions::USERS_MANAGE));
        $this->assertTrue(Gate::forUser($admin)->allows(Permissions::REPORTS_VIEW_ANY));
        $this->assertFalse(Gate::forUser($nurse)->allows(Permissions::USERS_MANAGE));
        $this->assertTrue(Gate::forUser($nurse)->allows(Permissions::REPORTS_VIEW_ASSIGNED));
        $this->assertFalse(Gate::forUser($inactiveAdmin)->allows(Permissions::REPORTS_VIEW_ANY));
    }

    public function test_role_and_permission_middleware_enforce_server_side_access(): void
    {
        Route::middleware(['auth:sanctum', 'role:admin'])
            ->get('/_test/role-admin', fn () => response()->json(['ok' => true]));
        Route::middleware(['auth:sanctum', 'permission:users.manage'])
            ->get('/_test/permission-users-manage', fn () => response()->json(['ok' => true]));

        $admin = User::factory()->role('admin', 'Administrator')->create();
        $nurse = User::factory()->create();

        $this->actingAs($admin)->getJson('/_test/role-admin')->assertOk();
        $this->actingAs($nurse)->getJson('/_test/role-admin')->assertForbidden();

        $this->actingAs($admin)->getJson('/_test/permission-users-manage')->assertOk();
        $this->actingAs($nurse)->getJson('/_test/permission-users-manage')->assertForbidden();
    }

    public function test_active_middleware_blocks_deactivated_sessions(): void
    {
        $inactiveUser = User::factory()->inactive()->create();

        $this->actingAs($inactiveUser)
            ->getJson('/api/auth/me')
            ->assertForbidden()
            ->assertJsonPath('message', 'This account is inactive.');
    }

    public function test_user_policy_protects_admin_account_management(): void
    {
        $superadmin = User::factory()->role('superadmin', 'Superadmin')->create();
        $admin = User::factory()->role('admin', 'Administrator')->create();
        $nurse = User::factory()->create();

        $this->assertTrue(Gate::forUser($admin)->allows('setActive', $nurse));
        $this->assertFalse(Gate::forUser($admin)->allows('setActive', $superadmin));
        $this->assertFalse(Gate::forUser($admin)->allows('setActive', $admin));
        $this->assertTrue(Gate::forUser($superadmin)->allows('setActive', $admin));
        $this->assertFalse(Gate::forUser($superadmin)->allows('setActive', $superadmin));
    }

    public function test_report_policy_scopes_nurses_to_active_unlocked_assignments(): void
    {
        $nurse = User::factory()->create();
        $otherNurse = User::factory()->create();
        $admin = User::factory()->role('admin', 'Administrator')->create();
        $template = ReportTemplate::query()->where('slug', 'inpatient_weekly')->firstOrFail();
        $department = Department::query()->where('slug', 'gi_neuro_inpatient')->firstOrFail();
        $period = ReportingPeriod::query()->create([
            'week_start' => '2026-05-25',
            'week_end' => '2026-05-31',
            'deadline_at' => '2026-06-01 10:00:00',
            'month_label' => 'May 2026',
            'quarter_label' => 'Q2 2026',
            'year_num' => 2026,
        ]);
        $assignment = ReportAssignment::query()->create([
            'nurse_id' => $nurse->id,
            'department_id' => $department->id,
            'template_id' => $template->id,
            'active' => true,
            'approved_at' => now(),
        ]);
        $report = Report::query()->create([
            'assignment_id' => $assignment->id,
            'department_id' => $department->id,
            'template_id' => $template->id,
            'reporting_period_id' => $period->id,
            'status' => 'draft',
            'created_by' => $nurse->id,
            'updated_by' => $nurse->id,
        ]);

        $this->assertTrue(Gate::forUser($nurse)->allows('view', $report));
        $this->assertTrue(Gate::forUser($nurse)->allows('update', $report));
        $this->assertFalse(Gate::forUser($otherNurse)->allows('view', $report));
        $this->assertFalse(Gate::forUser($otherNurse)->allows('update', $report));

        $report->forceFill(['locked_at' => now()])->save();

        $this->assertFalse(Gate::forUser($nurse)->allows('update', $report->refresh()));
        $this->assertTrue(Gate::forUser($admin)->allows('update', $report));
        $this->assertTrue(Gate::forUser($admin)->allows('lock', $report));
        $this->assertFalse(Gate::forUser($nurse)->allows('lock', $report));
    }

    public function test_request_and_notification_policies_preserve_owner_or_admin_visibility(): void
    {
        $owner = User::factory()->create();
        $otherNurse = User::factory()->create();
        $admin = User::factory()->role('admin', 'Administrator')->create();

        $accessRequest = AccessRequest::query()->create([
            'user_id' => $owner->id,
            'email' => $owner->email,
            'status' => 'pending',
        ]);
        $notification = Notification::query()->create([
            'recipient_id' => $owner->id,
            'type' => 'access_request_reviewed',
            'title' => 'Access request reviewed',
            'message' => 'Your request was reviewed.',
        ]);

        $this->assertTrue(Gate::forUser($owner)->allows('view', $accessRequest));
        $this->assertFalse(Gate::forUser($otherNurse)->allows('view', $accessRequest));
        $this->assertTrue(Gate::forUser($admin)->allows('view', $accessRequest));
        $this->assertTrue(Gate::forUser($admin)->allows('review', $accessRequest));
        $this->assertFalse(Gate::forUser($owner)->allows('review', $accessRequest));

        $this->assertTrue(Gate::forUser($owner)->allows('view', $notification));
        $this->assertTrue(Gate::forUser($owner)->allows('update', $notification));
        $this->assertFalse(Gate::forUser($otherNurse)->allows('view', $notification));
        $this->assertTrue(Gate::forUser($admin)->allows('view', $notification));
    }
}
