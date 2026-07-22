<?php

namespace Tests\Feature;

use App\Models\AdminAccessRequest;
use App\Models\User;
use Database\Seeders\RoleSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class AdminRegistrationTest extends TestCase
{
    use RefreshDatabase;

    private User $superadmin;

    private User $admin;

    private User $nurse;

    protected function setUp(): void
    {
        parent::setUp();

        $this->seed(RoleSeeder::class);

        $this->superadmin = User::factory()->role('superadmin', 'Maintenance')->create();
        $this->admin = User::factory()->role('admin', 'Administrator')->create();
        $this->nurse = User::factory()->create();
    }

    private function submitRequest(array $overrides = []): void
    {
        $this->postJson('/api/admin-access-requests', array_merge([
            'fullName' => 'Dr. Meron Tadesse',
            'email' => 'Meron.Tadesse@example.test',
            'password' => 'StPaul2026!',
            'notes' => 'Department coordinator stepping into administration.',
        ], $overrides))->assertCreated()->assertJsonPath('status', 'pending');
    }

    public function test_public_admin_signup_creates_a_pending_request_and_notifies_approvers(): void
    {
        $this->submitRequest();

        $this->assertDatabaseHas('admin_access_requests', [
            'email' => 'meron.tadesse@example.test',
            'status' => 'pending',
            'requested_role' => 'admin',
        ]);

        // No account exists yet.
        $this->assertDatabaseMissing('users', ['email' => 'meron.tadesse@example.test']);

        $requestId = AdminAccessRequest::query()->firstOrFail()->id;

        // Superadmin + Admin are notified; Nurse is not.
        $this->assertDatabaseHas('notifications', [
            'recipient_id' => $this->superadmin->id,
            'type' => 'admin_access_request',
            'related_id' => $requestId,
        ]);
        $this->assertDatabaseHas('notifications', [
            'recipient_id' => $this->admin->id,
            'type' => 'admin_access_request',
            'related_id' => $requestId,
        ]);
        $this->assertDatabaseMissing('notifications', [
            'recipient_id' => $this->nurse->id,
            'type' => 'admin_access_request',
        ]);
    }

    public function test_a_pending_admin_cannot_log_in_until_approved(): void
    {
        $this->submitRequest();

        // No account exists, so no session is issued - and the reply cannot name
        // the pending request either: the prober chose that password one request
        // ago, so recognising it would classify the address for them.
        $this->postJson('/api/auth/login', [
            'identifier' => 'meron.tadesse@example.test',
            'password' => 'StPaul2026!',
        ])->assertStatus(422);

        $this->assertGuest();
    }

    public function test_an_admin_can_approve_and_the_new_admin_can_log_in(): void
    {
        $this->submitRequest();
        $adminRequest = AdminAccessRequest::query()->firstOrFail();

        $this->actingAs($this->admin)
            ->postJson("/api/admin/admin-access-requests/{$adminRequest->id}/approve")
            ->assertOk()
            ->assertJsonPath('status', 'approved');

        $adminRequest->refresh();
        $this->assertSame('approved', $adminRequest->status);
        $this->assertNotNull($adminRequest->created_user_id);

        $created = User::query()->whereRaw('lower(email) = ?', ['meron.tadesse@example.test'])->firstOrFail();
        $this->assertSame('admin', $created->role_key);
        $this->assertTrue((bool) $created->active);
        $this->assertSame($adminRequest->created_user_id, $created->id);

        // The chosen password survived the request -> user copy (no double hashing).
        $this->postJson('/api/auth/login', [
            'identifier' => 'meron.tadesse@example.test',
            'password' => 'StPaul2026!',
        ])->assertOk()->assertJsonPath('user.role', 'admin');
    }

    public function test_the_superadmin_can_also_approve(): void
    {
        $this->submitRequest();
        $adminRequest = AdminAccessRequest::query()->firstOrFail();

        $this->actingAs($this->superadmin)
            ->postJson("/api/admin/admin-access-requests/{$adminRequest->id}/approve")
            ->assertOk()
            ->assertJsonPath('status', 'approved');
    }

    public function test_rejecting_marks_the_request_and_creates_no_account(): void
    {
        $this->submitRequest();
        $adminRequest = AdminAccessRequest::query()->firstOrFail();

        $this->actingAs($this->admin)
            ->postJson("/api/admin/admin-access-requests/{$adminRequest->id}/reject")
            ->assertOk()
            ->assertJsonPath('status', 'rejected');

        $this->assertDatabaseMissing('users', ['email' => 'meron.tadesse@example.test']);
    }

    public function test_a_nurse_cannot_approve(): void
    {
        $this->submitRequest();
        $adminRequest = AdminAccessRequest::query()->firstOrFail();

        $this->actingAs($this->nurse)
            ->postJson("/api/admin/admin-access-requests/{$adminRequest->id}/approve")
            ->assertForbidden();

        $this->assertSame('pending', $adminRequest->refresh()->status);
    }

    public function test_a_request_cannot_be_approved_twice(): void
    {
        $this->submitRequest();
        $adminRequest = AdminAccessRequest::query()->firstOrFail();

        $this->actingAs($this->admin)
            ->postJson("/api/admin/admin-access-requests/{$adminRequest->id}/approve")
            ->assertOk();

        $this->actingAs($this->superadmin)
            ->postJson("/api/admin/admin-access-requests/{$adminRequest->id}/approve")
            ->assertStatus(422);

        $this->assertSame(1, User::query()->whereRaw('lower(email) = ?', ['meron.tadesse@example.test'])->count());
    }

    public function test_duplicate_pending_email_creates_no_second_request(): void
    {
        $this->submitRequest();

        $this->postJson('/api/admin-access-requests', [
            'fullName' => 'Someone Else',
            'email' => 'meron.tadesse@example.test',
            'password' => 'StPaul2026!',
        ])->assertCreated();

        $this->assertSame(1, AdminAccessRequest::query()->count());
        $this->assertSame('Dr. Meron Tadesse', AdminAccessRequest::query()->firstOrFail()->full_name);
    }

    public function test_existing_account_email_creates_no_request(): void
    {
        User::factory()->create(['email' => 'taken@example.test']);

        $this->postJson('/api/admin-access-requests', [
            'fullName' => 'Someone',
            'email' => 'taken@example.test',
            'password' => 'StPaul2026!',
        ])->assertCreated();

        $this->assertDatabaseMissing('admin_access_requests', ['email' => 'taken@example.test']);
    }

    /**
     * C-SEC-004: the three states an anonymous prober used to be able to tell
     * apart - free address, address with an account, address with a request
     * already pending - must now be indistinguishable, the way
     * PasswordResetController@forgot already is.
     */
    public function test_the_endpoint_does_not_disclose_whether_an_address_is_known(): void
    {
        User::factory()->create(['email' => 'taken@example.test']);
        $this->submitRequest();

        $free = $this->postJson('/api/admin-access-requests', [
            'fullName' => 'Unknown Person',
            'email' => 'nobody@example.test',
            'password' => 'StPaul2026!',
        ]);
        $account = $this->postJson('/api/admin-access-requests', [
            'fullName' => 'Unknown Person',
            'email' => 'taken@example.test',
            'password' => 'StPaul2026!',
        ]);
        $pending = $this->postJson('/api/admin-access-requests', [
            'fullName' => 'Unknown Person',
            'email' => 'meron.tadesse@example.test',
            'password' => 'StPaul2026!',
        ]);

        foreach ([$account, $pending] as $probe) {
            $this->assertSame($free->getStatusCode(), $probe->getStatusCode());
            $this->assertSame($free->getContent(), $probe->getContent());
        }
    }
}
