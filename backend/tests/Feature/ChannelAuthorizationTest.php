<?php

namespace Tests\Feature;

use App\Models\User;
use App\Support\Broadcasting\UserChannel;
use Tests\TestCase;

/**
 * Regression test for the private broadcast channel authorization
 * (routes/channels.php -> UserChannel::authorize).
 *
 * User ids are UUIDs (User uses HasUuids). The previous callback compared them
 * with (int) casts, so (int)"<uuid>" === (int)"<other-uuid>" was 0 === 0 (true)
 * for ANY user, letting one user subscribe to another's private channel. The
 * comparison is now done as strings. No DB needed: we exercise the exact
 * function the channel callback calls, with manually-assigned UUID ids.
 *
 * The callback also has to re-assert the session gates itself: Gate::before
 * does not run for Broadcast::channel callbacks and broadcasting/auth carries
 * neither the 'active' nor the 'password-changed' middleware.
 */
class ChannelAuthorizationTest extends TestCase
{
    private function userWithId(string $id): User
    {
        $user = new User;
        $user->id = $id;
        $user->active = true;
        $user->password_change_required = false;

        return $user;
    }

    public function test_a_user_can_authorize_their_own_private_channel(): void
    {
        $user = $this->userWithId('019ec0bf-68d4-7168-99e4-bbfd505a09cc');

        $this->assertTrue(UserChannel::authorize($user, $user->id));
    }

    public function test_a_user_cannot_authorize_another_users_private_channel(): void
    {
        $a = $this->userWithId('019ec0bf-68d4-7168-99e4-bbfd505a09cc');
        $b = $this->userWithId('019ec0bf-69b6-7104-9973-cc124fe58dcf');

        $this->assertFalse(UserChannel::authorize($a, $b->id));
    }

    public function test_the_historical_int_cast_would_have_collapsed_distinct_uuids(): void
    {
        $a = $this->userWithId('019ec0bf-68d4-7168-99e4-bbfd505a09cc');
        $b = $this->userWithId('019ec0bf-69b6-7104-9973-cc124fe58dcf');

        // The bug: (int) parses only the UUIDv7 leading digits, so two distinct
        // ids created close in time collapse to the same int, making (int) === (int)
        // comparison would have authorized one user onto the other's channel.
        $this->assertSame((int) $a->id, (int) $b->id);
        // String comparison (the fix) keeps them distinct.
        $this->assertNotSame((string) $a->id, (string) $b->id);
    }

    public function test_a_deactivated_user_cannot_authorize_their_own_private_channel(): void
    {
        // Admin deactivation does not flush sessions, so a revoked account can
        // still present a valid session cookie at broadcasting/auth.
        $user = $this->userWithId('019ec0bf-68d4-7168-99e4-bbfd505a09cc');
        $user->active = false;

        $this->assertFalse(UserChannel::authorize($user, $user->id));
    }

    public function test_a_user_owing_a_password_change_cannot_authorize_their_own_private_channel(): void
    {
        $user = $this->userWithId('019ec0bf-68d4-7168-99e4-bbfd505a09cc');
        $user->password_change_required = true;

        $this->assertFalse(UserChannel::authorize($user, $user->id));
    }

    public function test_a_user_with_no_active_attribute_is_denied_rather_than_defaulting_open(): void
    {
        $user = new User;
        $user->id = '019ec0bf-68d4-7168-99e4-bbfd505a09cc';

        $this->assertFalse(UserChannel::authorize($user, $user->id));
    }
}
