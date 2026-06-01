<?php

namespace Tests\Feature;

use App\Models\Department;
use App\Models\ReportAssignment;
use App\Models\ReportTemplate;
use App\Models\User;
use Database\Seeders\DepartmentSeeder;
use Database\Seeders\ReportTemplateSeeder;
use Database\Seeders\RoleSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

class AuthApiTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();

        foreach ([RoleSeeder::class, ReportTemplateSeeder::class, DepartmentSeeder::class] as $seeder) {
            $this->seed($seeder);
        }
    }

    public function test_login_accepts_username_and_returns_sanitized_session_payload(): void
    {
        $user = User::factory()->role('admin', 'Administrator')->create([
            'full_name' => 'Abel Gemechu',
            'email' => 'abel@example.test',
            'username' => 'Abel.Admin',
            'password' => Hash::make('StPaul2026!'),
        ]);

        $response = $this->postJson('/api/auth/login', [
            'identifier' => ' Abel.Admin ',
            'password' => 'StPaul2026!',
        ]);

        $response
            ->assertOk()
            ->assertJsonPath('user.id', $user->id)
            ->assertJsonPath('user.fullName', 'Abel Gemechu')
            ->assertJsonPath('user.email', 'abel@example.test')
            ->assertJsonPath('user.username', 'abel.admin')
            ->assertJsonPath('user.role', 'admin')
            ->assertJsonPath('user.active', true)
            ->assertJsonMissingPath('user.password')
            ->assertJsonMissingPath('user.remember_token');

        $this->assertContains('reports.viewAny', $response->json('permissions'));
        $this->assertAuthenticatedAs($user);
        $this->assertNotNull($user->fresh()->last_login_at);
    }

    public function test_login_accepts_email_case_insensitively(): void
    {
        $user = User::factory()->create([
            'email' => 'hana.abera@example.test',
            'username' => 'hana.abera',
            'password' => Hash::make('StPaul2026!'),
        ]);

        $response = $this->postJson('/api/auth/login', [
            'identifier' => 'HANA.ABERA@EXAMPLE.TEST',
            'password' => 'StPaul2026!',
        ]);

        $response
            ->assertOk()
            ->assertJsonPath('user.id', $user->id)
            ->assertJsonPath('user.role', 'nurse');

        $this->assertAuthenticatedAs($user);
    }

    public function test_login_rejects_inactive_users(): void
    {
        $user = User::factory()->inactive()->create([
            'email' => 'inactive@example.test',
            'username' => 'inactive.nurse',
            'password' => Hash::make('StPaul2026!'),
        ]);

        $response = $this->postJson('/api/auth/login', [
            'identifier' => $user->username,
            'password' => 'StPaul2026!',
        ]);

        $response
            ->assertForbidden()
            ->assertJsonPath('message', 'This account is inactive.');

        $this->assertGuest();
    }

    public function test_me_returns_current_user_assignments_and_permissions(): void
    {
        $user = User::factory()->create([
            'full_name' => 'Hana Abera',
            'email' => 'hana@example.test',
            'username' => 'hana.abera',
            'password' => Hash::make('StPaul2026!'),
        ]);
        $template = ReportTemplate::query()->where('slug', 'inpatient_weekly')->firstOrFail();
        $department = Department::query()->where('slug', 'gi_neuro_inpatient')->firstOrFail();

        $assignment = ReportAssignment::query()->create([
            'nurse_id' => $user->id,
            'department_id' => $department->id,
            'template_id' => $template->id,
            'active' => true,
            'approved_at' => now(),
        ]);

        ReportAssignment::query()->create([
            'nurse_id' => $user->id,
            'department_id' => Department::query()->where('slug', 'cardiac_inpatient')->firstOrFail()->id,
            'template_id' => $template->id,
            'active' => false,
            'approved_at' => now(),
        ]);

        $response = $this->actingAs($user)->getJson('/api/auth/me');

        $response
            ->assertOk()
            ->assertJsonPath('user.id', $user->id)
            ->assertJsonPath('user.fullName', 'Hana Abera')
            ->assertJsonPath('assignments.0.id', $assignment->id)
            ->assertJsonPath('assignments.0.departmentSlug', 'gi_neuro_inpatient')
            ->assertJsonPath('assignments.0.departmentName', 'GI/Neurology')
            ->assertJsonPath('assignments.0.templateSlug', 'inpatient_weekly')
            ->assertJsonPath('assignments.0.templateName', 'Inpatient Weekly Report')
            ->assertJsonCount(1, 'assignments')
            ->assertJsonMissingPath('user.password')
            ->assertJsonMissingPath('user.remember_token');

        $this->assertContains('reports.viewAssigned', $response->json('permissions'));
    }

    public function test_me_requires_authentication(): void
    {
        $this->getJson('/api/auth/me')->assertUnauthorized();
    }

    public function test_logout_clears_authenticated_session(): void
    {
        User::factory()->create([
            'email' => 'logout@example.test',
            'username' => 'logout.user',
            'password' => Hash::make('StPaul2026!'),
        ]);

        $this->withHeader('Origin', 'http://localhost:5173')->postJson('/api/auth/login', [
            'identifier' => 'logout.user',
            'password' => 'StPaul2026!',
        ])->assertOk();

        $this->withHeader('Origin', 'http://localhost:5173')->postJson('/api/auth/logout')
            ->assertNoContent();

        $this->withHeader('Origin', 'http://localhost:5173')->getJson('/api/auth/me')->assertUnauthorized();
        $this->assertGuest();
    }
}
