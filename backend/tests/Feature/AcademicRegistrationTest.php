<?php

namespace Tests\Feature;

use App\Models\AdminAccessRequest;
use App\Models\Department;
use App\Models\User;
use Database\Seeders\DepartmentSeeder;
use Database\Seeders\ReportTemplateSeeder;
use Database\Seeders\RoleSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class AcademicRegistrationTest extends TestCase
{
    use RefreshDatabase;

    private User $admin;

    private Department $ward;

    protected function setUp(): void
    {
        parent::setUp();

        foreach ([RoleSeeder::class, ReportTemplateSeeder::class, DepartmentSeeder::class] as $seeder) {
            $this->seed($seeder);
        }

        $this->ward = Department::query()->where('slug', 'gi_neuro_inpatient')->firstOrFail();
        $this->admin = User::factory()->role('admin', 'Administrator')->create();
    }

    private function submitEnrollment(array $overrides = []): void
    {
        $this->postJson('/api/academic-access-requests', array_merge([
            'fullName' => 'Dr. Rediet Bekele',
            'email' => 'Rediet.Bekele@example.test',
            'password' => 'StPaul2026!',
            'role' => 'resident',
            'homeWardId' => $this->ward->slug,
            'notes' => 'Rotating through GI/Neuro.',
        ], $overrides))->assertCreated()->assertJsonPath('status', 'pending');
    }

    public function test_a_resident_enrollment_creates_a_pending_request_and_notifies_approvers(): void
    {
        $this->submitEnrollment();

        $this->assertDatabaseHas('admin_access_requests', [
            'email' => 'rediet.bekele@example.test',
            'status' => 'pending',
            'requested_role' => 'resident',
            'home_ward_id' => $this->ward->id,
        ]);

        // No account exists yet.
        $this->assertDatabaseMissing('users', ['email' => 'rediet.bekele@example.test']);

        $requestId = AdminAccessRequest::query()->firstOrFail()->id;

        $this->assertDatabaseHas('notifications', [
            'recipient_id' => $this->admin->id,
            'type' => 'admin_access_request',
            'related_entity' => 'admin_access_request',
            'related_id' => $requestId,
        ]);
    }

    public function test_a_pending_applicant_cannot_log_in_until_approved(): void
    {
        $this->submitEnrollment();

        $this->postJson('/api/auth/login', [
            'identifier' => 'rediet.bekele@example.test',
            'password' => 'StPaul2026!',
        ])->assertStatus(422);
    }

    public function test_approving_creates_the_resident_with_the_requested_role_title_and_ward(): void
    {
        $this->submitEnrollment();
        $enrollmentRequest = AdminAccessRequest::query()->firstOrFail();

        $this->actingAs($this->admin)
            ->postJson("/api/admin/admin-access-requests/{$enrollmentRequest->id}/approve")
            ->assertOk()
            ->assertJsonPath('status', 'approved');

        $created = User::query()->whereRaw('lower(email) = ?', ['rediet.bekele@example.test'])->firstOrFail();
        $this->assertSame('resident', $created->role_key);
        $this->assertSame('Resident', $created->title);
        $this->assertSame($this->ward->id, $created->home_ward_id);
        $this->assertTrue((bool) $created->active);
        $this->assertSame($enrollmentRequest->refresh()->created_user_id, $created->id);

        // The chosen password survived the request -> user copy (no double hashing).
        $this->postJson('/api/auth/login', [
            'identifier' => 'rediet.bekele@example.test',
            'password' => 'StPaul2026!',
        ])->assertOk()->assertJsonPath('user.role', 'resident');
    }

    public function test_a_consultant_can_enroll_with_snake_case_and_no_ward(): void
    {
        $this->postJson('/api/academic-access-requests', [
            'full_name' => 'Dr. Chaltu Tesfaye',
            'email' => 'chaltu@example.test',
            'password' => 'StPaul2026!',
            'role' => 'consultant',
        ])
            ->assertCreated()
            ->assertJsonPath('status', 'pending');

        $enrollmentRequest = AdminAccessRequest::query()->firstOrFail();
        $this->assertSame('consultant', $enrollmentRequest->requested_role);
        $this->assertNull($enrollmentRequest->home_ward_id);

        $this->actingAs($this->admin)
            ->postJson("/api/admin/admin-access-requests/{$enrollmentRequest->id}/approve")
            ->assertOk();

        $created = User::query()->whereRaw('lower(email) = ?', ['chaltu@example.test'])->firstOrFail();
        $this->assertSame('consultant', $created->role_key);
        $this->assertSame('Consultant', $created->title);
        $this->assertNull($created->home_ward_id);
    }

    public function test_rejecting_marks_the_request_and_creates_no_account(): void
    {
        $this->submitEnrollment();
        $enrollmentRequest = AdminAccessRequest::query()->firstOrFail();

        $this->actingAs($this->admin)
            ->postJson("/api/admin/admin-access-requests/{$enrollmentRequest->id}/reject")
            ->assertOk()
            ->assertJsonPath('status', 'rejected');

        $this->assertDatabaseMissing('users', ['email' => 'rediet.bekele@example.test']);
    }

    public function test_a_superadmin_request_can_never_be_approved_into_an_account(): void
    {
        // No public endpoint can produce this row; it can only arrive by tampering.
        $forged = AdminAccessRequest::query()->create([
            'full_name' => 'Not The Owner',
            'email' => 'forged@example.test',
            'username' => null,
            'password' => 'StPaul2026!',
            'requested_role' => 'superadmin',
            'status' => 'pending',
            'requested_at' => now(),
        ]);

        $this->actingAs($this->admin)
            ->postJson("/api/admin/admin-access-requests/{$forged->id}/approve")
            ->assertStatus(422);

        $this->assertDatabaseMissing('users', ['email' => 'forged@example.test']);
        $this->assertSame('pending', $forged->refresh()->status);
    }

    public function test_duplicate_email_is_rejected(): void
    {
        User::factory()->create(['email' => 'taken@example.test']);

        $this->postJson('/api/academic-access-requests', [
            'fullName' => 'Someone',
            'email' => 'taken@example.test',
            'password' => 'StPaul2026!',
            'role' => 'resident',
        ])->assertStatus(422);
    }

    public function test_duplicate_pending_email_is_rejected(): void
    {
        $this->submitEnrollment();

        $this->postJson('/api/academic-access-requests', [
            'fullName' => 'Someone Else',
            'email' => 'rediet.bekele@example.test',
            'password' => 'StPaul2026!',
            'role' => 'consultant',
        ])->assertStatus(422);

        $this->assertSame(1, AdminAccessRequest::query()->count());
    }

    public function test_invalid_role_is_rejected(): void
    {
        $this->postJson('/api/academic-access-requests', [
            'fullName' => 'Someone',
            'email' => 'someone@example.test',
            'password' => 'StPaul2026!',
            'role' => 'nurse',
        ])->assertStatus(422);

        $this->assertDatabaseMissing('users', ['email' => 'someone@example.test']);
        $this->assertDatabaseMissing('admin_access_requests', ['email' => 'someone@example.test']);
    }

    public function test_unknown_ward_is_rejected(): void
    {
        $this->postJson('/api/academic-access-requests', [
            'fullName' => 'Someone',
            'email' => 'ward@example.test',
            'password' => 'StPaul2026!',
            'role' => 'resident',
            'homeWardId' => 'no_such_ward',
        ])->assertStatus(422);

        $this->assertDatabaseMissing('admin_access_requests', ['email' => 'ward@example.test']);
    }
}
