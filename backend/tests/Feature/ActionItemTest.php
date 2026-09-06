<?php

namespace Tests\Feature;

use App\Models\ActionItem;
use App\Models\Department;
use App\Models\Notification;
use App\Models\Report;
use App\Models\ReportAssignment;
use App\Models\ReportingPeriod;
use App\Models\ReportTemplate;
use App\Models\User;
use Database\Seeders\AppSettingSeeder;
use Database\Seeders\DepartmentSeeder;
use Database\Seeders\ReportFieldDefinitionSeeder;
use Database\Seeders\ReportTemplateSeeder;
use Database\Seeders\RoleSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Tests\TestCase;

class ActionItemTest extends TestCase
{
    use RefreshDatabase;

    private User $nurse;

    private User $admin;

    private ReportAssignment $assignment;

    private ReportingPeriod $period;

    protected function setUp(): void
    {
        parent::setUp();

        foreach ([RoleSeeder::class, ReportTemplateSeeder::class, DepartmentSeeder::class, ReportFieldDefinitionSeeder::class, AppSettingSeeder::class] as $seeder) {
            $this->seed($seeder);
        }

        $this->nurse = User::factory()->create(['full_name' => 'Hana Abera', 'username' => 'hana.abera']);
        $this->admin = User::factory()->role('admin', 'Administrator')->create(['full_name' => 'Admin One']);

        $template = ReportTemplate::query()->where('slug', 'inpatient_weekly')->firstOrFail();
        $department = Department::query()->where('slug', 'gi_neuro_inpatient')->firstOrFail();

        $this->assignment = ReportAssignment::query()->create([
            'nurse_id' => $this->nurse->id,
            'department_id' => $department->id,
            'template_id' => $template->id,
            'active' => true,
            'approved_at' => now(),
        ]);
        $this->period = ReportingPeriod::query()->create([
            'week_start' => '2026-05-25',
            'week_end' => '2026-05-31',
            'deadline_at' => '2026-06-01 10:00:00',
            'month_label' => 'May 2026',
            'quarter_label' => 'Q2 2026',
            'year_num' => 2026,
        ]);
    }

    /**
     * QA-005: when PHP itself refuses a file (upload_max_filesize below the
     * 10 MB the application allows) the user must learn what happened and who
     * can fix it, instead of the validator's bare "The file failed to upload."
     */
    public function test_evidence_refused_by_the_php_upload_limit_gets_an_actionable_message(): void
    {
        $this->submitCriticalReport();
        $item = ActionItem::query()->firstOrFail();

        $temporaryPath = tempnam(sys_get_temp_dir(), 'qa');
        file_put_contents($temporaryPath, 'not really uploaded');
        $refusedByPhp = new UploadedFile($temporaryPath, 'evidence.pdf', 'application/pdf', UPLOAD_ERR_INI_SIZE, true);

        $response = $this->actingAs($this->admin)
            ->post("/api/admin/action-items/{$item->id}/evidence", ['file' => $refusedByPhp], ['Accept' => 'application/json'])
            ->assertStatus(422);

        $message = (string) $response->json('errors.file.0');
        $this->assertStringContainsString('larger than this server currently accepts', $message);
        $this->assertStringContainsString('upload_max_filesize', $message);
        $this->assertStringContainsString('10 MB', $message);
        $this->assertDatabaseCount('action_item_evidence', 0);

        @unlink($temporaryPath);
    }

    private function submitCriticalReport(int $deaths = 2): Report
    {
        $this->actingAs($this->nurse)->postJson('/api/reports', [
            'assignmentId' => $this->assignment->id,
            'reportingPeriodId' => $this->period->id,
            'submit' => true,
            'values' => [
                'new_deaths' => ['fieldId' => 'new_deaths', 'dailyValues' => ['monday' => $deaths]],
            ],
        ])->assertCreated();

        return Report::query()->firstOrFail();
    }

    public function test_submitting_a_report_with_a_critical_value_opens_an_action_item(): void
    {
        $report = $this->submitCriticalReport();

        $this->assertSame(1, ActionItem::query()->count());
        $this->assertDatabaseHas('action_items', [
            'report_id' => $report->id,
            'source' => 'critical_event',
            'source_key' => $report->id,
            'status' => 'open',
            'severity' => 'high',
        ]);
    }

    public function test_critical_action_item_is_not_duplicated_when_the_report_is_edited(): void
    {
        $report = $this->submitCriticalReport(2);

        // Edit the submitted report (changes re-fire the critical alert).
        $this->actingAs($this->nurse)->putJson("/api/reports/{$report->id}", [
            'values' => [
                'new_deaths' => ['fieldId' => 'new_deaths', 'dailyValues' => ['monday' => 3]],
            ],
        ])->assertOk();

        $this->assertSame(1, ActionItem::query()->count());
    }

    public function test_admin_can_list_open_action_items(): void
    {
        $this->submitCriticalReport();

        $this->actingAs($this->admin)
            ->getJson('/api/admin/action-items')
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.status', 'open')
            ->assertJsonPath('data.0.source', 'critical_event')
            ->assertJsonPath('meta.perPage', 50)
            ->assertJsonPath('meta.openCount', 1);

        $this->actingAs($this->admin)
            ->getJson('/api/admin/action-items?perPage=101')
            ->assertUnprocessable()
            ->assertJsonValidationErrors('perPage');
    }

    public function test_admin_can_resolve_an_action_item(): void
    {
        $this->submitCriticalReport();
        $item = ActionItem::query()->firstOrFail();

        $this->actingAs($this->admin)
            ->patchJson("/api/admin/action-items/{$item->id}", [
                'status' => 'resolved',
                'resolution_note' => 'Reviewed with the ward team; root cause documented.',
            ])
            ->assertOk()
            ->assertJsonPath('status', 'resolved')
            ->assertJsonPath('resolvedByName', 'Admin One');

        $item->refresh();
        $this->assertSame('resolved', $item->status);
        $this->assertNotNull($item->resolved_at);
        $this->assertSame($this->admin->id, $item->resolved_by);

        // A later critical edit is a new occurrence. The previous resolution
        // remains immutable instead of being silently reopened or overwritten.
        $this->submitCriticalReport(4);
        $this->assertSame('resolved', $item->refresh()->status);
        $this->assertSame(2, ActionItem::query()->count());
        $this->assertSame(1, ActionItem::query()->where('status', 'open')->count());
    }

    /**
     * Every notification about an action must open that action. Pointing at the
     * bare queue left the recipient on a list of every open item with no way to
     * tell which one they had just been told about.
     */
    public function test_action_item_notifications_deep_link_to_the_item(): void
    {
        $this->submitCriticalReport();
        $item = ActionItem::query()->firstOrFail();
        $expectedRoute = "/admin/action-items?item={$item->id}";

        // Raised by the alert rule, before anyone touches it.
        $this->assertSame(
            $expectedRoute,
            Notification::query()->where('type', 'critical_value_alert')->value('related_route'),
        );

        $owner = User::factory()->role('admin', 'Administrator')->create([
            'full_name' => 'Almaz Sahle',
            'username' => 'almaz.sahle',
        ]);

        $this->actingAs($this->admin)
            ->patchJson("/api/admin/action-items/{$item->id}", ['assigned_to' => $owner->id])
            ->assertOk()
            ->assertJsonPath('status', 'assigned');

        $assignment = Notification::query()
            ->where('type', 'action_item_assigned')
            ->where('recipient_id', $owner->id)
            ->firstOrFail();
        $this->assertSame($expectedRoute, $assignment->related_route);
        $this->assertSame($item->id, $assignment->related_id);

        // And the overdue escalation, which reaches people who never opened it.
        $item->forceFill(['due_at' => now()->subDay(), 'overdue_notified_at' => null])->save();
        $this->artisan('action-items:escalate-overdue')->assertExitCode(0);

        $overdue = Notification::query()->where('type', 'action_item_overdue')->get();
        $this->assertNotEmpty($overdue);
        foreach ($overdue as $notification) {
            $this->assertSame($expectedRoute, $notification->related_route);
        }
    }

    public function test_admin_can_create_a_manual_action_item(): void
    {
        $this->actingAs($this->admin)
            ->postJson('/api/admin/action-items', [
                'title' => 'Follow up on missing weekend reports',
                'description' => 'Three wards have not submitted for two weeks.',
                'severity' => 'medium',
            ])
            ->assertCreated()
            ->assertJsonPath('source', 'manual')
            ->assertJsonPath('status', 'assigned')
            ->assertJsonPath('createdByName', 'Admin One');

        $this->assertSame(1, ActionItem::query()->where('source', 'manual')->count());
    }

    public function test_nurses_cannot_access_action_items(): void
    {
        $this->submitCriticalReport();

        $this->actingAs($this->nurse)
            ->getJson('/api/admin/action-items')
            ->assertForbidden();

        $item = ActionItem::query()->firstOrFail();
        $this->actingAs($this->nurse)
            ->patchJson("/api/admin/action-items/{$item->id}", ['status' => 'resolved'])
            ->assertForbidden();
    }
}
