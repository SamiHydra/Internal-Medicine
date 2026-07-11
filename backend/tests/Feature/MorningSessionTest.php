<?php

namespace Tests\Feature;

use App\Models\AppSetting;
use App\Models\DutyAssignment;
use App\Models\DutyType;
use App\Models\MorningRosterOverride;
use App\Models\MorningSession;
use App\Models\User;
use App\Services\Academic\MorningSessionService;
use Database\Seeders\DepartmentSeeder;
use Database\Seeders\ReportTemplateSeeder;
use Database\Seeders\RoleSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Cache;
use Tests\TestCase;

class MorningSessionTest extends TestCase
{
    use RefreshDatabase;

    private User $admin;

    private User $recorder;

    protected function setUp(): void
    {
        parent::setUp();

        foreach ([RoleSeeder::class, ReportTemplateSeeder::class, DepartmentSeeder::class] as $seeder) {
            $this->seed($seeder);
        }

        // A Monday (a default session day).
        $this->travelTo(Carbon::parse('2026-09-14 08:00:00'));

        $this->admin = User::factory()->role('admin', 'Administrator')->create();
        $this->recorder = User::factory()->role('resident', 'Resident')->create();

        $this->setMorningConfig([
            'session_days' => [1, 3, 5],
            'session_time' => '08:00',
            'recorder_ids' => [$this->recorder->id],
        ]);
    }

    protected function tearDown(): void
    {
        $this->travelBack();

        parent::tearDown();
    }

    /**
     * @param  array<string, mixed>  $config
     */
    private function setMorningConfig(array $config): void
    {
        AppSetting::query()->updateOrCreate(
            ['setting_key' => 'academic_morning'],
            ['value_json' => $config, 'updated_by' => $this->admin->id],
        );
        Cache::forget('app-settings:structured:v2');
    }

    private function assign(User $user, string $dutyTypeSlug, string $from, string $to): void
    {
        DutyAssignment::query()->create([
            'user_id' => $user->id,
            'duty_type_id' => DutyType::query()->where('slug', $dutyTypeSlug)->firstOrFail()->id,
            'starts_on' => $from,
            'ends_on' => $to,
            'source' => 'admin',
            'created_by' => $this->admin->id,
        ]);
    }

    // ---- Roster ----

    public function test_roster_includes_non_ward_duties_and_excludes_leave_and_external_plus_overrides(): void
    {
        $onDialysis = User::factory()->role('consultant', 'Consultant')->create();
        $onLeave = User::factory()->role('consultant', 'Consultant')->create();
        $external = User::factory()->role('resident', 'Resident')->create();
        $onWard = User::factory()->role('resident', 'Resident')->create();

        $this->assign($onDialysis, 'dialysis', '2026-09-01', '2026-09-30');
        $this->assign($onLeave, 'annual_leave', '2026-09-01', '2026-09-30');
        $this->assign($external, 'icu', '2026-09-01', '2026-09-30');
        $this->assign($onWard, 'nephrology_ward_service', '2026-09-01', '2026-09-30');

        $service = app(MorningSessionService::class);
        $roster = $service->roster(Carbon::parse('2026-09-14'))->pluck('id');

        // Consultants on non-ward duties still appear; leave and externals do not.
        $this->assertTrue($roster->contains($onDialysis->id));
        $this->assertTrue($roster->contains($onWard->id));
        $this->assertFalse($roster->contains($onLeave->id));
        $this->assertFalse($roster->contains($external->id));

        // An admin EXCLUDE pulls the dialysis consultant off; an INCLUDE puts
        // the person on leave back on (both date-ranged).
        MorningRosterOverride::query()->create([
            'user_id' => $onDialysis->id,
            'action' => 'exclude',
            'starts_on' => '2026-09-14',
            'ends_on' => '2026-09-14',
            'created_by' => $this->admin->id,
        ]);
        MorningRosterOverride::query()->create([
            'user_id' => $onLeave->id,
            'action' => 'include',
            'starts_on' => '2026-09-14',
            'ends_on' => null,
            'created_by' => $this->admin->id,
        ]);

        $adjusted = $service->roster(Carbon::parse('2026-09-14'))->pluck('id');
        $this->assertFalse($adjusted->contains($onDialysis->id));
        $this->assertTrue($adjusted->contains($onLeave->id));

        // The exclusion was for the 14th only; on the 16th the base roster is back.
        $later = $service->roster(Carbon::parse('2026-09-16'))->pluck('id');
        $this->assertTrue($later->contains($onDialysis->id));
    }

    public function test_open_command_creates_only_on_configured_days(): void
    {
        $this->artisan('academic:open-morning-session')->assertSuccessful();
        $this->assertDatabaseCount('morning_sessions', 1);

        // Idempotent.
        $this->artisan('academic:open-morning-session')->assertSuccessful();
        $this->assertDatabaseCount('morning_sessions', 1);

        // Tuesday is not a session day.
        $this->artisan('academic:open-morning-session', ['--date' => '2026-09-15'])->assertSuccessful();
        $this->assertDatabaseCount('morning_sessions', 1);
    }

    // ---- Recording ----

    public function test_designated_recorder_records_and_delay_is_computed_server_side(): void
    {
        $onWard = User::factory()->role('resident', 'Resident')->create();
        $this->assign($onWard, 'nephrology_ward_service', '2026-09-01', '2026-09-30');

        $today = $this->actingAs($this->recorder)
            ->getJson('/api/academic/morning-sessions/today')
            ->assertOk()
            ->assertJsonPath('isSessionDay', true)
            ->assertJsonPath('canRecord', true)
            ->json('session');

        $this->assertSame('08:00', $today['scheduledStartAt']);
        $rosterIds = array_column($today['people'], 'userId');
        $this->assertContains($onWard->id, $rosterIds);

        // The client cannot dictate the delay: it derives from the snapshotted
        // 08:00 schedule and the actual start.
        $recorded = $this->actingAs($this->recorder)
            ->postJson("/api/academic/morning-sessions/{$today['id']}/record", [
                'startedOnTime' => false,
                'actualStartAt' => '08:25',
                'presence' => [$onWard->id => true, $this->recorder->id => true],
            ])
            ->assertOk()
            ->json();

        $this->assertSame('recorded', $recorded['status']);
        $this->assertSame(25, $recorded['delayMinutes']);

        $this->assertDatabaseHas('morning_attendance', [
            'morning_session_id' => $today['id'],
            'user_id' => $onWard->id,
            'present' => true,
        ]);
    }

    public function test_off_time_requires_the_actual_start_and_non_designated_users_are_denied(): void
    {
        $session = app(MorningSessionService::class)->openFor(Carbon::parse('2026-09-14'));

        $this->actingAs($this->recorder)
            ->postJson("/api/academic/morning-sessions/{$session->id}/record", [
                'startedOnTime' => false,
                'presence' => [],
            ])
            ->assertStatus(422)
            ->assertJsonValidationErrors(['actualStartAt']);

        // A resident holding the coarse permission but not designated: 403.
        $bystander = User::factory()->role('resident', 'Resident')->create();
        $this->actingAs($bystander)
            ->postJson("/api/academic/morning-sessions/{$session->id}/record", [
                'startedOnTime' => true,
                'presence' => [],
            ])
            ->assertForbidden();

        // A nurse lacks the permission outright.
        $nurse = User::factory()->role('nurse', 'Nurse')->create();
        $this->actingAs($nurse)
            ->getJson('/api/academic/morning-sessions/today')
            ->assertForbidden();
    }

    public function test_recorded_attendance_is_a_snapshot_immune_to_later_roster_changes(): void
    {
        $onWard = User::factory()->role('resident', 'Resident')->create();
        $this->assign($onWard, 'nephrology_ward_service', '2026-09-01', '2026-09-30');

        $session = app(MorningSessionService::class)->openFor(Carbon::parse('2026-09-14'));

        $this->actingAs($this->recorder)
            ->postJson("/api/academic/morning-sessions/{$session->id}/record", [
                'startedOnTime' => true,
                'presence' => [$onWard->id => true],
            ])
            ->assertOk();

        $snapshotCount = $session->attendance()->count();

        // A NEW person joins the roster afterwards; the recorded session
        // must not grow.
        $latecomer = User::factory()->role('consultant', 'Consultant')->create();
        $this->assign($latecomer, 'pulmonology_ward_service', '2026-09-01', '2026-09-30');

        $today = $this->actingAs($this->admin)
            ->getJson('/api/academic/morning-sessions/today')
            ->assertOk()
            ->json('session');

        $this->assertCount($snapshotCount, $today['people']);
        $this->assertNotContains($latecomer->id, array_column($today['people'], 'userId'));
    }

    public function test_same_day_rule_reminder_and_admin_cancel_with_reason(): void
    {
        $session = app(MorningSessionService::class)->openFor(Carbon::parse('2026-09-14'));

        // The 08:15 nudge reaches the designated recorder while pending.
        $this->artisan('academic:remind-morning-recorder')->assertSuccessful();
        $this->assertDatabaseHas('notifications', [
            'recipient_id' => $this->recorder->id,
            'type' => 'morning_session_reminder',
        ]);

        // Two days later the recorder can no longer touch that session
        // (same-day corrections only); an admin still can.
        $this->travelTo(Carbon::parse('2026-09-16 09:00:00'));

        $this->actingAs($this->recorder)
            ->postJson("/api/academic/morning-sessions/{$session->id}/record", [
                'startedOnTime' => true,
                'presence' => [],
            ])
            ->assertForbidden();

        $this->actingAs($this->admin)
            ->postJson("/api/admin/morning-sessions/{$session->id}/cancel", [])
            ->assertStatus(422);

        $this->actingAs($this->admin)
            ->postJson("/api/admin/morning-sessions/{$session->id}/cancel", ['reason' => 'Public holiday'])
            ->assertOk()
            ->assertJsonPath('status', 'cancelled');

        $this->assertDatabaseHas('admin_audit_logs', [
            'entity_type' => 'morning_session',
            'action' => 'cancel',
        ]);

        // A cancelled session cannot be recorded over.
        $this->actingAs($this->admin)
            ->patchJson("/api/admin/morning-sessions/{$session->id}", [
                'startedOnTime' => true,
                'presence' => [],
            ])
            ->assertStatus(422);

        // The pending-session list surfaces the not-recorded signal.
        $sessions = $this->actingAs($this->admin)
            ->getJson('/api/admin/morning-sessions?status=cancelled')
            ->assertOk()
            ->json('data');
        $this->assertCount(1, $sessions);
        $this->assertSame('Public holiday', $sessions[0]['reason']);
    }

    public function test_workspace_flags_the_designated_recorder(): void
    {
        $this->assertTrue(
            $this->actingAs($this->recorder)->getJson('/api/workspace')->assertOk()->json('academic.isMorningRecorder'),
        );
        $this->assertFalse(
            (bool) $this->actingAs(User::factory()->role('resident', 'Resident')->create())
                ->getJson('/api/workspace')
                ->assertOk()
                ->json('academic.isMorningRecorder'),
        );
    }
}
