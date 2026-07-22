<?php

namespace Tests\Feature;

use App\Models\Notification;
use App\Models\User;
use App\Support\Authorization\Permissions;
use Database\Seeders\RoleSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * Residents and consultants are addressed by the notification pipeline
 * (morning-session reminders, transfer decisions) and the SPA renders the bell
 * for them, but they were missing notifications.view - so every /api/notifications
 * route 403'd and an unread badge could never be cleared. These tests pin the
 * grant, and pin that it stays scoped to the caller's own rows.
 */
class NotificationRoleAccessTest extends TestCase
{
    use RefreshDatabase;

    /**
     * Every role the notification pipeline actually addresses.
     *
     * @var array<string, string>
     */
    private const NOTIFIED_ROLES = [
        'resident' => 'Resident',
        'consultant' => 'Consultant',
        'nurse' => 'Nurse',
        'student_rep' => 'Student representative',
    ];

    protected function setUp(): void
    {
        parent::setUp();

        $this->seed(RoleSeeder::class);
    }

    public function test_every_notified_role_can_work_its_own_notification_queue(): void
    {
        $stranger = User::factory()->role('admin', 'Administrator')->create();

        foreach (self::NOTIFIED_ROLES as $roleKey => $title) {
            $this->assertTrue(
                Permissions::roleHas($roleKey, Permissions::NOTIFICATIONS_VIEW),
                "$roleKey should hold notifications.view",
            );

            $user = User::factory()->role($roleKey, $title)->create();
            $first = $this->createNotification($user, 'First');
            $second = $this->createNotification($user, 'Second');
            $foreign = $this->createNotification($stranger, 'Not yours');

            // index - own rows only, never the stranger's.
            $listed = $this->actingAs($user)
                ->getJson('/api/notifications')
                ->assertOk()
                ->assertJsonCount(2, 'data')
                ->json('data.*.id');
            $this->assertEqualsCanonicalizing([$first->id, $second->id], $listed);
            $this->assertNotContains($foreign->id, $listed);

            // markRead - the foreign id is skipped, not applied.
            $this->actingAs($user)
                ->patchJson('/api/notifications/read', ['ids' => [$first->id, $foreign->id]])
                ->assertOk()
                ->assertJsonPath('updated', 1);
            $this->assertNotNull($first->refresh()->read_at);
            $this->assertNull($foreign->refresh()->read_at);

            // markAllRead - clears the badge, and only the caller's rows.
            $this->actingAs($user)
                ->patchJson('/api/notifications/read-all')
                ->assertOk()
                ->assertJsonPath('updated', 1);
            $this->assertNotNull($second->refresh()->read_at);
            $this->assertNull($foreign->refresh()->read_at);

            // destroy - same scoping.
            $this->actingAs($user)
                ->deleteJson('/api/notifications', ['ids' => [$first->id, $foreign->id]])
                ->assertOk()
                ->assertJsonPath('deleted', 1);
            $this->assertDatabaseMissing('notifications', ['id' => $first->id]);
            $this->assertDatabaseHas('notifications', ['id' => $foreign->id]);

            // restore - a non-admin can never restore onto someone else's account.
            $restoredId = (string) Str::uuid();
            $this->actingAs($user)
                ->postJson('/api/notifications/restore', [
                    'notifications' => [[
                        'id' => $restoredId,
                        'userId' => $stranger->id,
                        'type' => 'report_locked',
                        'title' => 'Restored',
                        'message' => 'Restored message',
                    ]],
                ])
                ->assertOk()
                ->assertJsonPath('restored', 0);
            $this->assertDatabaseMissing('notifications', ['id' => $restoredId]);

            $second->delete();
            $foreign->delete();
        }
    }

    public function test_an_inactive_resident_still_cannot_reach_the_notification_routes(): void
    {
        $resident = User::factory()->inactive()->role('resident', 'Resident')->create();

        $this->actingAs($resident)->getJson('/api/notifications')->assertForbidden();
        $this->actingAs($resident)->patchJson('/api/notifications/read-all')->assertForbidden();
    }

    public function test_the_unread_filter_accepts_a_query_string_boolean(): void
    {
        $resident = User::factory()->role('resident', 'Resident')->create();
        $unread = $this->createNotification($resident, 'Unread');
        $read = $this->createNotification($resident, 'Read');
        $read->forceFill(['read_at' => now()])->save();

        // ?unread=true is the canonical query-string boolean; the plain boolean
        // rule used to 422 on the string "true".
        $this->actingAs($resident)
            ->getJson('/api/notifications?unread=true')
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.id', $unread->id);

        $this->actingAs($resident)
            ->getJson('/api/notifications?unread=false')
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.id', $read->id);

        // Genuine junk is still rejected.
        $this->actingAs($resident)
            ->getJson('/api/notifications?unread=maybe')
            ->assertStatus(422);
    }

    public function test_restore_recreates_a_cleared_notification_under_its_original_id(): void
    {
        $resident = User::factory()->role('resident', 'Resident')->create();
        $id = (string) Str::uuid();

        $payload = ['notifications' => [[
            'id' => $id,
            'userId' => $resident->id,
            'type' => 'report_locked',
            'title' => 'Restored',
            'message' => 'Restored message',
        ]]];

        // The restored row must keep the caller-supplied id (HasUuids used to mint
        // a fresh one because id was not fillable), so the undo-clear flow can find
        // it and a repeat restore is idempotent rather than duplicating.
        $this->actingAs($resident)->postJson('/api/notifications/restore', $payload)
            ->assertOk()
            ->assertJsonPath('restored', 1)
            ->assertJsonPath('data.0.id', $id);
        $this->assertDatabaseHas('notifications', ['id' => $id, 'recipient_id' => $resident->id]);

        $this->actingAs($resident)->postJson('/api/notifications/restore', $payload)->assertOk();
        $this->assertSame(1, Notification::query()->where('id', $id)->count());
    }

    private function createNotification(User $recipient, string $title): Notification
    {
        return Notification::query()->create([
            'recipient_id' => $recipient->id,
            'type' => 'morning_session_reminder',
            'title' => $title,
            'message' => "$title message",
            'related_route' => '/notifications',
            'related_entity' => 'test',
            'created_at' => now(),
        ]);
    }
}
