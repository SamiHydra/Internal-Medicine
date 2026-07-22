<?php

namespace Tests\Feature;

use App\Models\AccessRequest;
use App\Models\AdminAccessRequest;
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
        // last_login_at is what separates a deactivated member of staff (named
        // outright) from a never-activated applicant row (silenced below).
        $user = User::factory()->inactive()->create([
            'email' => 'inactive@example.test',
            'username' => 'inactive.nurse',
            'password' => Hash::make('StPaul2026!'),
            'last_login_at' => now()->subDay(),
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

    public function test_self_submitted_access_request_user_is_inactive_until_approved(): void
    {
        $department = Department::query()->where('slug', 'gi_neuro_inpatient')->firstOrFail();
        $template = ReportTemplate::query()->whereKey($department->template_id)->firstOrFail();

        $this->postJson('/api/access-requests', [
            'fullName' => 'Pending Applicant',
            'email' => 'pending@example.test',
            'password' => 'StPaul2026!',
            'requestedAssignments' => [
                ['departmentId' => $department->slug, 'templateId' => $template->slug],
            ],
        ])->assertCreated();

        // The anonymous branch answers non-committally (no serialized request),
        // so the id comes from the row itself.
        $submittedRequestId = AccessRequest::query()->firstOrFail()->id;

        // The applicant account exists but is inactive, so it cannot authenticate
        // yet - and login must not say so, or the anonymous caller who just chose
        // that password learns the address was free (see the enumeration tests).
        $this->assertDatabaseHas('users', ['email' => 'pending@example.test', 'active' => false]);
        $this->postJson('/api/auth/login', [
            'identifier' => 'pending@example.test',
            'password' => 'StPaul2026!',
        ])->assertStatus(422);

        // After an admin approves, the applicant is activated and can sign in.
        $admin = User::factory()->role('admin', 'Administrator')->create();
        $this->actingAs($admin)
            ->postJson("/api/admin/access-requests/{$submittedRequestId}/approve")
            ->assertOk()
            ->assertJsonPath('status', 'approved');

        $this->assertDatabaseHas('users', ['email' => 'pending@example.test', 'active' => true]);
        $this->postJson('/api/auth/login', [
            'identifier' => 'pending@example.test',
            'password' => 'StPaul2026!',
        ])->assertOk()->assertJsonPath('user.active', true);
    }

    public function test_password_change_required_gates_the_app_until_changed(): void
    {
        $user = User::factory()->create([
            'email' => 'temp@example.test',
            'username' => 'temp.user',
            'password' => Hash::make('Temp2026!'),
            'password_change_required' => true,
        ]);

        // Workspace bootstrap stays reachable so the SPA can render the gate...
        $this->actingAs($user)->getJson('/api/workspace')->assertOk();
        // ...but every other data route is blocked until the password is changed.
        $this->actingAs($user)->getJson('/api/reports')
            ->assertForbidden()
            ->assertJsonPath('passwordChangeRequired', true);

        // Changing the password clears the flag and releases the gate.
        $this->actingAs($user)->postJson('/api/auth/change-password', [
            'current_password' => 'Temp2026!',
            'password' => 'BrandNew2026!',
            'password_confirmation' => 'BrandNew2026!',
        ])->assertOk()->assertJsonPath('user.passwordChangeRequired', false);

        $this->assertFalse($user->fresh()->password_change_required);
        $this->assertTrue(Hash::check('BrandNew2026!', $user->fresh()->password));
        $this->actingAs($user->fresh())->getJson('/api/reports')->assertOk();
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

    /**
     * The registration endpoints answer non-committally but still store the
     * password the ANONYMOUS caller chose, so any reply that recognises that
     * password hands the enumeration bit straight back: submit (address,
     * password), then sign in with the same pair and read "free" off one status
     * code and "taken" off the other. Login must answer identically either way.
     */
    public function test_submitting_a_request_then_signing_in_cannot_classify_an_address(): void
    {
        User::factory()->create(['email' => 'taken@example.test']);

        foreach (['taken@example.test', 'free@example.test'] as $email) {
            $this->postJson('/api/academic-access-requests', [
                'fullName' => 'Dr. Rediet Bekele',
                'email' => $email,
                'password' => 'AttackerChosen!2026',
                'role' => 'resident',
                'trainingYear' => 2,
            ])->assertCreated();
        }

        $taken = $this->postJson('/api/auth/login', [
            'identifier' => 'taken@example.test',
            'password' => 'AttackerChosen!2026',
        ]);
        $free = $this->postJson('/api/auth/login', [
            'identifier' => 'free@example.test',
            'password' => 'AttackerChosen!2026',
        ]);

        $taken->assertStatus(422);
        $this->assertSame($taken->getStatusCode(), $free->getStatusCode());
        $this->assertSame($taken->getContent(), $free->getContent());
    }

    /**
     * The nurse track is the same probe against the one endpoint that really
     * does create an inactive users row holding the caller-supplied password.
     */
    public function test_a_never_activated_applicant_account_is_indistinguishable_from_an_unknown_address(): void
    {
        $applicant = User::factory()->inactive()->create([
            'email' => 'applicant@example.test',
            'username' => null,
            'title' => 'Applicant Nurse',
            'password' => Hash::make('AttackerChosen!2026'),
            'last_login_at' => null,
        ]);

        $applicantLogin = $this->postJson('/api/auth/login', [
            'identifier' => $applicant->email,
            'password' => 'AttackerChosen!2026',
        ]);
        $unknownAddress = $this->postJson('/api/auth/login', [
            'identifier' => 'nobody.at.all@example.test',
            'password' => 'AttackerChosen!2026',
        ]);

        $applicantLogin->assertStatus(422);
        $this->assertSame($unknownAddress->getStatusCode(), $applicantLogin->getStatusCode());
        $this->assertSame($unknownAddress->getContent(), $applicantLogin->getContent());
        $this->assertGuest();
    }

    /**
     * A pending applicant must be byte-identical to an address nobody has ever
     * heard of, whatever password is typed.
     */
    public function test_a_wrong_password_never_reveals_a_pending_applicant(): void
    {
        $this->postJson('/api/academic-access-requests', [
            'fullName' => 'Dr. Rediet Bekele',
            'email' => 'rediet.bekele@example.test',
            'password' => 'StPaul2026!',
            'role' => 'resident',
            'trainingYear' => 2,
        ])->assertCreated();

        $wrongPassword = $this->postJson('/api/auth/login', [
            'identifier' => 'rediet.bekele@example.test',
            'password' => 'TotallyWrong999!',
        ]);
        $unknownAddress = $this->postJson('/api/auth/login', [
            'identifier' => 'nobody.at.all@example.test',
            'password' => 'TotallyWrong999!',
        ]);

        $wrongPassword->assertStatus(422);
        $this->assertSame($unknownAddress->getStatusCode(), $wrongPassword->getStatusCode());
        $this->assertSame($unknownAddress->getContent(), $wrongPassword->getContent());

        // A rejected request is not "pending", so it stays silent for the right
        // password too.
        AdminAccessRequest::query()->firstOrFail()->forceFill(['status' => 'rejected'])->save();

        $rejected = $this->postJson('/api/auth/login', [
            'identifier' => 'rediet.bekele@example.test',
            'password' => 'StPaul2026!',
        ]);
        $this->assertSame($unknownAddress->getStatusCode(), $rejected->getStatusCode());
        $this->assertSame($unknownAddress->getContent(), $rejected->getContent());
    }

    /**
     * PRE-4: users.title is nullable and three private defaultTitle() copies
     * disagreed, so a student rep with no title was rendered "Nurse" by both
     * /api/auth/me and /api/workspace while the same payload reported roleLabel
     * "Student representative".
     */
    public function test_a_null_title_falls_back_to_the_role_title_on_every_endpoint(): void
    {
        $expected = [
            'student_rep' => 'Student representative',
            'resident' => 'Resident',
            'consultant' => 'Consultant',
            'admin' => 'Administrator',
            'superadmin' => 'Maintenance',
            'nurse' => 'Nurse',
        ];

        foreach ($expected as $roleKey => $title) {
            $user = User::factory()->role($roleKey)->create();
            $this->assertNull($user->title);

            $this->actingAs($user)->getJson('/api/auth/me')
                ->assertOk()
                ->assertJsonPath('user.title', $title);

            $this->actingAs($user)->getJson('/api/workspace')
                ->assertOk()
                ->assertJsonPath('currentUser.title', $title);
        }
    }
}
