<?php

namespace Tests\Feature;

use App\Models\User;
use Database\Seeders\RoleSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Route;
use Tests\TestCase;

/**
 * The authenticated /api/auth/* routes carried no throttle at all, so a single
 * session could burst /auth/change-password without limit - and every call
 * there is a bcrypt verify (plus a re-hash on success) at BCRYPT_ROUNDS=12,
 * which turns one client into a CPU amplifier.
 */
class AuthThrottleTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();

        $this->seed(RoleSeeder::class);
    }

    public function test_change_password_is_throttled_after_six_attempts_per_minute(): void
    {
        $user = User::factory()->create([
            'password' => Hash::make('StPaul2026!'),
        ]);

        // Wrong current password: the bcrypt verify runs, nothing mutates.
        for ($attempt = 1; $attempt <= 6; $attempt++) {
            $this->actingAs($user)
                ->postJson('/api/auth/change-password', [
                    'current_password' => 'DefinitelyWrong1!',
                    'password' => 'BrandNew2026!',
                    'password_confirmation' => 'BrandNew2026!',
                ])
                ->assertStatus(422);
        }

        $this->actingAs($user)
            ->postJson('/api/auth/change-password', [
                'current_password' => 'DefinitelyWrong1!',
                'password' => 'BrandNew2026!',
                'password_confirmation' => 'BrandNew2026!',
            ])
            ->assertStatus(429);
    }

    public function test_the_change_password_limiter_does_not_consume_the_api_wide_ceiling(): void
    {
        $user = User::factory()->create([
            'password' => Hash::make('StPaul2026!'),
        ]);

        for ($attempt = 1; $attempt <= 7; $attempt++) {
            $this->actingAs($user)->postJson('/api/auth/change-password', [
                'current_password' => 'DefinitelyWrong1!',
                'password' => 'BrandNew2026!',
                'password_confirmation' => 'BrandNew2026!',
            ]);
        }

        // The 6/min limiter is key-prefixed, so exhausting it must not lock the
        // user out of the rest of the API (which shares the 300/min counter).
        $this->actingAs($user)->getJson('/api/auth/me')->assertOk();
        $this->actingAs($user)->getJson('/api/notifications')->assertOk();
    }

    public function test_the_remaining_authenticated_auth_routes_carry_the_api_wide_ceiling(): void
    {
        $this->assertContains('throttle:300,1', $this->middlewareFor('GET', 'api/auth/me'));
        $this->assertContains('throttle:300,1', $this->middlewareFor('POST', 'api/auth/logout'));

        // change-password keeps its own, stricter, separately-keyed limiter.
        $changePassword = $this->middlewareFor('POST', 'api/auth/change-password');
        $this->assertContains('throttle:6,1,change-password', $changePassword);
        $this->assertNotContains('throttle:300,1', $changePassword);
    }

    /**
     * @return list<string>
     */
    private function middlewareFor(string $method, string $uri): array
    {
        foreach (Route::getRoutes()->getRoutes() as $route) {
            if ($route->uri() === $uri && in_array($method, $route->methods(), true)) {
                return array_values($route->middleware());
            }
        }

        $this->fail("Route $method /$uri is not registered.");
    }
}
