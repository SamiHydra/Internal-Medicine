<?php

namespace Tests\Feature;

use App\Models\AppSetting;
use App\Models\MorningSession;
use App\Models\User;
use App\Services\Academic\MorningSessionService;
use App\Support\Audit\AuditRegistry;
use Database\Seeders\DepartmentSeeder;
use Database\Seeders\ReportTemplateSeeder;
use Database\Seeders\RoleSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * The academic audit trail: the surfaces that used to write nothing, and the
 * registry that lets the trail be scoped to a workspace without a `workspace`
 * column on admin_audit_logs.
 */
class AcademicAuditTrailTest extends TestCase
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

        AppSetting::query()->updateOrCreate(
            ['setting_key' => 'academic_morning'],
            ['value_json' => [
                'session_days' => [1, 3, 5],
                'session_time' => '08:00',
                'recorder_ids' => [$this->recorder->id],
            ], 'updated_by' => $this->admin->id],
        );
        Cache::forget('app-settings:structured:v2');
    }

    protected function tearDown(): void
    {
        $this->travelBack();

        parent::tearDown();
    }

    public function test_recording_a_morning_session_writes_an_audit_row_with_the_delay(): void
    {
        $session = app(MorningSessionService::class)->openFor(Carbon::parse('2026-09-14'));

        $this->actingAs($this->recorder)
            ->postJson("/api/academic/morning-sessions/{$session->id}/record", [
                'startedOnTime' => false,
                'actualStartAt' => '08:25',
                'presence' => [$this->recorder->id => true],
            ])
            ->assertOk();

        $row = DB::table('admin_audit_logs')
            ->where('entity_type', 'morning_session')
            ->where('action', 'record')
            ->where('entity_id', $session->id)
            ->first();

        $this->assertNotNull($row, 'Recording a morning session wrote no audit row.');
        $this->assertSame($this->recorder->id, $row->user_id);

        $values = json_decode($row->new_values, true);
        // The delay is the audited fact, and it is the server's number.
        $this->assertSame(25, $values['delayMinutes']);
        $this->assertFalse($values['startedOnTime']);
        $this->assertSame(1, $values['presentCount']);
        $this->assertSame(1, $values['expectedCount']);
    }

    public function test_workspace_filter_separates_academic_from_clinical_entities(): void
    {
        // One row on each side of the divide, plus a system row.
        $session = MorningSession::query()->create([
            'session_date' => '2026-09-14',
            'scheduled_start_at' => '08:00',
            'status' => 'pending',
        ]);

        foreach ([
            ['ward', 'create'],
            ['morning_session', 'record'],
            ['report_template', 'update'],
            ['user', 'update'],
        ] as [$entityType, $action]) {
            DB::table('admin_audit_logs')->insert([
                'id' => (string) Str::uuid(),
                'user_id' => $this->admin->id,
                'user_name' => $this->admin->full_name,
                'action' => $action,
                'entity_type' => $entityType,
                'entity_id' => $session->id,
                'created_at' => now(),
            ]);
        }

        $academic = $this->actingAs($this->admin)
            ->getJson('/api/admin/admin-audit-logs?workspace=academic')
            ->assertOk()
            ->json('data');

        $types = array_column($academic, 'entityType');
        sort($types);
        // Academic entities plus the shared system one; never the clinical one.
        $this->assertSame(['morning_session', 'user', 'ward'], $types);

        $clinical = $this->actingAs($this->admin)
            ->getJson('/api/admin/admin-audit-logs?workspace=clinical')
            ->assertOk()
            ->json('data');

        $clinicalTypes = array_column($clinical, 'entityType');
        sort($clinicalTypes);
        $this->assertSame(['report_template', 'user'], $clinicalTypes);
    }

    public function test_entries_carry_readable_labels_and_a_workspace(): void
    {
        DB::table('admin_audit_logs')->insert([
            'id' => (string) Str::uuid(),
            'user_id' => $this->admin->id,
            'user_name' => $this->admin->full_name,
            'action' => 'save_roster_month',
            'entity_type' => 'duty_roster',
            'entity_id' => '2026-09',
            'created_at' => now(),
        ]);

        $entry = $this->actingAs($this->admin)
            ->getJson('/api/admin/admin-audit-logs?workspace=academic')
            ->assertOk()
            ->json('data.0');

        // Previously the SPA rendered this as "Save_roster_month".
        $this->assertSame('Roster month saved', $entry['actionLabel']);
        $this->assertSame('Duty roster', $entry['entityLabel']);
        $this->assertSame('academic', $entry['workspace']);
        // A non-uuid entity id must survive the filter validation.
        $this->assertSame('2026-09', $entry['entityId']);
    }

    public function test_an_unregistered_entity_type_stays_visible_rather_than_vanishing(): void
    {
        DB::table('admin_audit_logs')->insert([
            'id' => (string) Str::uuid(),
            'user_id' => $this->admin->id,
            'user_name' => $this->admin->full_name,
            'action' => 'invent',
            'entity_type' => 'not_yet_registered',
            'entity_id' => null,
            'created_at' => now(),
        ]);

        // Falls back to SYSTEM, so it appears in BOTH workspaces. A surface
        // someone forgot to register must not silently drop out of the trail.
        $this->assertSame(AuditRegistry::WORKSPACE_SYSTEM, AuditRegistry::workspaceFor('not_yet_registered'));

        foreach (['academic', 'clinical'] as $workspace) {
            $types = array_column(
                $this->actingAs($this->admin)
                    ->getJson("/api/admin/admin-audit-logs?workspace={$workspace}")
                    ->assertOk()
                    ->json('data'),
                'entityType',
            );

            $this->assertContains('not_yet_registered', $types);
        }
    }

    public function test_the_filter_metadata_lists_actors_and_entity_types(): void
    {
        DB::table('admin_audit_logs')->insert([
            'id' => (string) Str::uuid(),
            'user_id' => $this->recorder->id,
            'user_name' => $this->recorder->full_name,
            'action' => 'record',
            'entity_type' => 'morning_session',
            'entity_id' => null,
            'created_at' => now(),
        ]);

        $meta = $this->actingAs($this->admin)
            ->getJson('/api/admin/admin-audit-logs?workspace=academic')
            ->assertOk()
            ->json('meta');

        $this->assertSame(
            [['id' => $this->recorder->id, 'name' => $this->recorder->full_name]],
            $meta['actors'],
        );

        $offered = array_column($meta['entityTypes'], 'value');
        $this->assertContains('morning_session', $offered);
        $this->assertContains('user', $offered, 'System types belong in the academic picker.');
        $this->assertNotContains('report_template', $offered, 'Clinical-only types must not be offered.');
    }

    public function test_non_admins_cannot_read_the_trail(): void
    {
        $this->actingAs($this->recorder)
            ->getJson('/api/admin/admin-audit-logs?workspace=academic')
            ->assertForbidden();
    }
}
