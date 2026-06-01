<?php

namespace Tests\Feature;

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

    public function test_a_resident_can_self_enroll_and_admins_are_notified(): void
    {
        $this->postJson('/api/academic-access-requests', [
            'fullName' => 'Dr. Rediet Bekele',
            'email' => 'Rediet.Bekele@example.test',
            'password' => 'StPaul2026!',
            'role' => 'resident',
            'homeWardId' => $this->ward->slug,
            'notes' => 'Rotating through GI/Neuro.',
        ])
            ->assertCreated()
            ->assertJsonPath('signedIn', false)
            ->assertJsonPath('role', 'resident');

        $user = User::query()->whereRaw('lower(email) = ?', ['rediet.bekele@example.test'])->firstOrFail();
        $this->assertSame('resident', $user->role_key);
        $this->assertTrue((bool) $user->active);
        $this->assertSame($this->ward->id, $user->home_ward_id);
        $this->assertNotNull($user->email_verified_at);

        $this->assertDatabaseHas('notifications', [
            'recipient_id' => $this->admin->id,
            'related_entity' => 'academic_enrollment',
            'related_id' => $user->id,
        ]);
    }

    public function test_a_consultant_can_self_enroll_with_snake_case_and_no_ward(): void
    {
        $this->postJson('/api/academic-access-requests', [
            'full_name' => 'Dr. Chaltu Tesfaye',
            'email' => 'chaltu@example.test',
            'password' => 'StPaul2026!',
            'role' => 'consultant',
        ])
            ->assertCreated()
            ->assertJsonPath('role', 'consultant');

        $user = User::query()->whereRaw('lower(email) = ?', ['chaltu@example.test'])->firstOrFail();
        $this->assertSame('consultant', $user->role_key);
        $this->assertNull($user->home_ward_id);
        $this->assertSame('Consultant', $user->title);
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

    public function test_invalid_role_is_rejected(): void
    {
        $this->postJson('/api/academic-access-requests', [
            'fullName' => 'Someone',
            'email' => 'someone@example.test',
            'password' => 'StPaul2026!',
            'role' => 'nurse',
        ])->assertStatus(422);

        $this->assertDatabaseMissing('users', ['email' => 'someone@example.test']);
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
    }
}
