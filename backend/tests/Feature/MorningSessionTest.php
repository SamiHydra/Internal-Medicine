<?php

namespace Tests\Feature;

use App\Models\AppSetting;
use App\Models\DutyAssignment;
use App\Models\DutyType;
use App\Models\MorningRosterOverride;
use App\Models\MorningSession;
use App\Models\User;
use App\Services\Academic\MorningSessionService;
use App\Services\Admin\AdminAuditService;
use Database\Seeders\DepartmentSeeder;
use Database\Seeders\ReportTemplateSeeder;
use Database\Seeders\RoleSeeder;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;
use Mockery\MockInterface;
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

    public function test_admin_can_change_the_start_time_for_future_sessions(): void
    {
        $existing = app(MorningSessionService::class)->openFor(Carbon::parse('2026-09-14'));
        $this->assertSame('08:00', substr((string) $existing->scheduled_start_at, 0, 5));

        $this->actingAs($this->admin)
            ->patchJson('/api/admin/settings', ['morningSessionTime' => '07:30'])
            ->assertOk()
            ->assertJsonPath('settings.academic.morningSessionTime', '07:30');

        $this->assertSame('07:30', AppSetting::query()
            ->where('setting_key', 'academic_morning')
            ->firstOrFail()
            ->value_json['session_time']);

        // Existing rows are historical snapshots; the next configured day uses
        // the newly saved admin setting.
        $this->assertSame('08:00', substr((string) $existing->refresh()->scheduled_start_at, 0, 5));
        $next = app(MorningSessionService::class)->openFor(Carbon::parse('2026-09-16'));
        $this->assertSame('07:30', substr((string) $next->scheduled_start_at, 0, 5));

        $this->actingAs($this->admin)
            ->patchJson('/api/admin/settings', ['morningSessionTime' => '25:99'])
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['morningSessionTime']);
    }

    public function test_reminder_follows_the_session_start_and_is_not_duplicated(): void
    {
        $session = app(MorningSessionService::class)->openFor(Carbon::parse('2026-09-14'));
        $service = app(MorningSessionService::class);
        $date = Carbon::parse('2026-09-14', 'Africa/Nairobi');

        $this->assertSame(0, $service->remindRecorders(
            $date,
            Carbon::parse('2026-09-14 08:14', 'Africa/Nairobi'),
        ));
        $this->assertDatabaseMissing('notifications', [
            'type' => 'morning_session_reminder',
            'related_id' => $session->id,
        ]);

        $this->assertSame(1, $service->remindRecorders(
            $date,
            Carbon::parse('2026-09-14 08:15', 'Africa/Nairobi'),
        ));
        $this->assertSame(0, $service->remindRecorders(
            $date,
            Carbon::parse('2026-09-14 08:16', 'Africa/Nairobi'),
        ));
        $this->assertSame(1, DB::table('notifications')
            ->where('type', 'morning_session_reminder')
            ->where('related_id', $session->id)
            ->count());
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

        // The shared academic page may show the safe session summary to a
        // non-recorder, but must not expose the expected-person roster.
        $this->actingAs($bystander)
            ->getJson('/api/academic/morning-sessions/today')
            ->assertOk()
            ->assertJsonPath('isSessionDay', true)
            ->assertJsonPath('canRecord', false)
            ->assertJsonMissingPath('session.people');

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

        // An administrator retry is idempotent: it returns the committed
        // state without rewriting its reason or emitting another audit.
        $this->actingAs($this->admin)
            ->postJson("/api/admin/morning-sessions/{$session->id}/cancel", ['reason' => 'Retry reason'])
            ->assertOk()
            ->assertJsonPath('status', 'cancelled')
            ->assertJsonPath('reason', 'Public holiday');

        $this->assertSame(1, DB::table('admin_audit_logs')
            ->where('entity_type', 'morning_session')
            ->where('entity_id', $session->id)
            ->where('action', 'cancel')
            ->count());

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

    public function test_designated_recorder_can_cancel_only_todays_pending_session(): void
    {
        $session = app(MorningSessionService::class)->openFor(Carbon::parse('2026-09-14'));
        $bystander = User::factory()->role('resident', 'Resident')->create();

        $this->actingAs($bystander)
            ->postJson("/api/academic/morning-sessions/{$session->id}/cancel", ['reason' => 'Not authorized'])
            ->assertForbidden();

        $this->travelTo(Carbon::parse('2026-09-15 08:00:00'));
        $this->actingAs($this->recorder)
            ->postJson("/api/academic/morning-sessions/{$session->id}/cancel", ['reason' => 'Too late'])
            ->assertForbidden();

        $this->travelTo(Carbon::parse('2026-09-14 08:05:00'));
        $this->actingAs($this->recorder)
            ->postJson("/api/academic/morning-sessions/{$session->id}/cancel", [])
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['reason']);

        $this->actingAs($this->recorder)
            ->postJson("/api/academic/morning-sessions/{$session->id}/cancel", ['reason' => 'Department event'])
            ->assertOk()
            ->assertJsonPath('status', 'cancelled')
            ->assertJsonPath('reason', 'Department event');

        $this->assertDatabaseHas('admin_audit_logs', [
            'user_id' => $this->recorder->id,
            'entity_type' => 'morning_session',
            'action' => 'cancel',
        ]);
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

    public function test_record_and_cancel_recheck_stale_session_state_under_the_lock(): void
    {
        $service = app(MorningSessionService::class);
        $cancelWins = $service->openFor(Carbon::parse('2026-09-14'));
        $staleRecordAttempt = $cancelWins->fresh();

        $cancelled = $service->cancel($cancelWins, 'Department event', $this->admin);
        $this->assertTrue($cancelled['transitioned']);

        try {
            $service->record($staleRecordAttempt, true, null, [], $this->admin);
            $this->fail('A stale record attempt overwrote a committed cancellation.');
        } catch (ValidationException $exception) {
            $this->assertArrayHasKey('session', $exception->errors());
        }

        $this->assertSame('cancelled', $cancelWins->refresh()->status);
        $this->assertSame(0, $cancelWins->attendance()->count());

        // The schema intentionally permits one session per calendar date;
        // remove the completed fixture before exercising the opposite race.
        $cancelWins->delete();

        $recordWins = MorningSession::query()->create([
            'session_date' => '2026-09-14',
            'scheduled_start_at' => '09:00',
        ]);
        $staleCancelAttempt = $recordWins->fresh();

        $service->record($recordWins, true, null, [], $this->recorder);

        try {
            $service->cancel($staleCancelAttempt, 'Stale cancellation', $this->recorder);
            $this->fail('A designated recorder cancelled a session after it was recorded.');
        } catch (AuthorizationException) {
            $this->assertTrue(true);
        }

        $this->assertSame('recorded', $recordWins->refresh()->status);
    }

    public function test_cancel_state_and_audit_roll_back_together(): void
    {
        $session = app(MorningSessionService::class)->openFor(Carbon::parse('2026-09-14'));

        $this->mock(AdminAuditService::class, function (MockInterface $mock): void {
            $mock->shouldReceive('record')->once()->andThrow(new \RuntimeException('Simulated audit failure.'));
        });
        $this->withoutExceptionHandling();

        try {
            $this->actingAs($this->admin)
                ->postJson("/api/admin/morning-sessions/{$session->id}/cancel", ['reason' => 'Public holiday']);
            $this->fail('The simulated audit failure should abort the cancellation transaction.');
        } catch (\RuntimeException $exception) {
            $this->assertSame('Simulated audit failure.', $exception->getMessage());
        }

        $this->assertSame('pending', $session->refresh()->status);
        $this->assertSame(0, DB::table('admin_audit_logs')
            ->where('entity_type', 'morning_session')
            ->where('entity_id', $session->id)
            ->where('action', 'cancel')
            ->count());
    }

    // ---- Review-pass regression: corrections edit the snapshot ----

    public function test_correction_updates_the_recorded_snapshot_not_a_recomputed_roster(): void
    {
        $onWard = User::factory()->role('resident', 'Resident')->create();
        $this->assign($onWard, 'nephrology_ward_service', '2026-09-01', '2026-09-30');

        $session = app(MorningSessionService::class)->openFor(Carbon::parse('2026-09-14'));

        $this->actingAs($this->recorder)
            ->postJson("/api/academic/morning-sessions/{$session->id}/record", [
                'startedOnTime' => true,
                'presence' => [$onWard->id => false],
            ])
            ->assertOk();

        // The person leaves the roster AFTER recording (assignment deleted).
        DutyAssignment::query()->where('user_id', $onWard->id)->delete();

        // Correcting the session must still honour their presence flag: the
        // snapshot rows are the roster now, not a recomputation.
        $this->actingAs($this->recorder)
            ->postJson("/api/academic/morning-sessions/{$session->id}/record", [
                'startedOnTime' => true,
                'presence' => [$onWard->id => true],
            ])
            ->assertOk();

        $this->assertDatabaseHas('morning_attendance', [
            'morning_session_id' => $session->id,
            'user_id' => $onWard->id,
            'present' => true,
        ]);

        // An attendee omitted from a correction keeps their recorded flag
        // instead of being reset to absent.
        $this->actingAs($this->recorder)
            ->postJson("/api/academic/morning-sessions/{$session->id}/record", [
                'startedOnTime' => false,
                'actualStartAt' => '08:20',
                'presence' => [],
            ])
            ->assertOk();

        $this->assertDatabaseHas('morning_attendance', [
            'morning_session_id' => $session->id,
            'user_id' => $onWard->id,
            'present' => true,
        ]);
    }
}
