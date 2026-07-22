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
