<?php

namespace Tests\Feature;

use App\Models\User;
use Database\Seeders\RoleSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

class CreateSuperadminTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(RoleSeeder::class);
    }

    public function test_creates_the_first_superadmin_with_supplied_password(): void
    {
        $this->artisan('app:create-superadmin', [
            '--email' => 'Boss@Example.test',
            '--username' => 'Boss',
            '--full-name' => 'Hospital Boss',
            '--password' => 'Secret123!',
        ])->assertSuccessful();

        $user = User::query()->where('role_key', 'superadmin')->firstOrFail();
        $this->assertSame('boss@example.test', $user->email);
        $this->assertSame('boss', $user->username);
        $this->assertTrue($user->active);
        $this->assertFalse($user->password_change_required);
        $this->assertNotNull($user->email_verified_at);
        $this->assertTrue(Hash::check('Secret123!', $user->password));
    }

    public function test_generated_password_forces_reset_on_first_login(): void
    {
        $this->artisan('app:create-superadmin', [
            '--email' => 'boss@example.test',
            '--username' => 'boss',
            '--full-name' => 'Hospital Boss',
        ])->assertSuccessful();

        $this->assertTrue(User::query()->where('role_key', 'superadmin')->value('password_change_required'));
    }

    public function test_refuses_when_a_superadmin_already_exists(): void
    {
        User::factory()->create(['role_key' => 'superadmin', 'username' => 'existing']);

        $this->artisan('app:create-superadmin', [
            '--email' => 'second@example.test',
            '--username' => 'second',
            '--full-name' => 'Second Boss',
            '--password' => 'Secret123!',
        ])->assertFailed();

        $this->assertSame(1, User::query()->where('role_key', 'superadmin')->count());
    }

    public function test_rejects_invalid_email(): void
    {
        $this->artisan('app:create-superadmin', [
            '--email' => 'not-an-email',
            '--username' => 'boss',
            '--full-name' => 'Hospital Boss',
            '--password' => 'Secret123!',
        ])->assertFailed();

        $this->assertDatabaseCount('users', 0);
    }
}
