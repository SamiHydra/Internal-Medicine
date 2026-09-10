<?php

namespace Tests\Feature;

use App\Models\ActionItem;
use App\Models\ActionItemStatusHistory;
use App\Models\ClinicalAlertRule;
use App\Models\Department;
use App\Models\Notification;
use App\Models\Report;
use App\Models\ReportAssignment;
use App\Models\ReportFieldDefinition;
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
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

class ClinicalActionGovernanceTest extends TestCase
{
    use RefreshDatabase;

    private User $nurse;

    private User $admin;

    private User $secondAdmin;

    private ReportAssignment $assignment;

    private ReportingPeriod $period;

    private ClinicalAlertRule $deathRule;

    protected function setUp(): void
    {
        parent::setUp();
        foreach ([RoleSeeder::class, ReportTemplateSeeder::class, DepartmentSeeder::class, ReportFieldDefinitionSeeder::class, AppSettingSeeder::class] as $seeder) {
            $this->seed($seeder);
        }

        $this->nurse = User::factory()->role('nurse', 'Nurse')->create(['full_name' => 'Clinical Nurse']);
        $this->admin = User::factory()->role('admin', 'Administrator')->create(['full_name' => 'Quality Lead']);
        $this->secondAdmin = User::factory()->role('admin', 'Administrator')->create(['full_name' => 'Clinical Director']);
        $template = ReportTemplate::query()->where('slug', 'inpatient_weekly')->firstOrFail();
        $department = Department::query()->where('slug', 'gi_neuro_inpatient')->firstOrFail();
        $this->assignment = ReportAssignment::query()->create([
            'nurse_id' => $this->nurse->id, 'department_id' => $department->id,
            'template_id' => $template->id, 'active' => true, 'approved_at' => now(),
        ]);
        $this->period = ReportingPeriod::query()->create([
            'week_start' => '2026-08-24', 'week_end' => '2026-08-30',
            'deadline_at' => '2026-08-31 10:00:00', 'month_label' => 'August 2026',
            'quarter_label' => 'Q3 2026', 'year_num' => 2026,
        ]);
        $this->deathRule = ClinicalAlertRule::query()->where('template_id', $template->id)->where('field_key', 'new_deaths')->firstOrFail();
    }

    private function saveDeaths(int $deaths): Report
    {
        $response = $this->actingAs($this->nurse)->postJson('/api/reports', [
            'assignmentId' => $this->assignment->id,
            'reportingPeriodId' => $this->period->id,
            'submit' => true,
            'values' => ['new_deaths' => ['fieldId' => 'new_deaths', 'dailyValues' => ['monday' => $deaths]]],
        ])->assertSuccessful();

        return Report::query()->findOrFail($response->json('id'));
    }

    private function createManual(array $overrides = []): ActionItem
    {
        return ActionItem::query()->create([
            'source' => 'manual', 'title' => 'Review a clinical variance',
            'description' => 'Investigate and record the outcome.', 'severity' => 'high',
            'status' => 'assigned', 'condition_state' => 'manual',
            'department_id' => $this->assignment->department_id,
            'assigned_to' => $this->admin->id, 'responsible_role' => 'admin',
            'due_at' => now()->addDay(), 'created_by' => $this->admin->id,
            ...$overrides,
        ]);
    }

    public function test_rule_threshold_severity_deadline_and_recipients_drive_the_action(): void
    {
        $this->deathRule->update([
            'operator' => 'gt', 'threshold' => 2, 'severity' => 'medium',
            'deadline_hours' => 12, 'notification_roles' => ['admin'],
        ]);
        $this->saveDeaths(2);
        $this->assertDatabaseCount('action_items', 0);

        $report = $this->saveDeaths(3);
        $item = ActionItem::query()->firstOrFail();
        $this->assertSame($report->id, $item->report_id);
        $this->assertSame('medium', $item->severity);
        $this->assertSame(3.0, $item->observed_value);
        $this->assertSame('gt', $item->trigger_operator);
        $this->assertSame(1, $item->rule_version);
        $this->assertEqualsWithDelta(12, $item->created_at->diffInHours($item->due_at), 0.01);
        $this->assertSame(2, Notification::query()->where('type', 'critical_value_alert')->count());
    }

    public function test_data_correction_stays_open_for_review_and_recurrence_is_recorded(): void
    {
        $report = $this->saveDeaths(2);
        $item = ActionItem::query()->firstOrFail();

        $this->actingAs($this->nurse)->putJson("/api/reports/{$report->id}", [
            'values' => ['new_deaths' => ['fieldId' => 'new_deaths', 'dailyValues' => ['monday' => 0]]],
        ])->assertOk();
        $this->assertSame('corrected_pending_review', $item->refresh()->condition_state);
        $this->assertSame('open', $item->status);

        $this->actingAs($this->nurse)->putJson("/api/reports/{$report->id}", [
            'values' => ['new_deaths' => ['fieldId' => 'new_deaths', 'dailyValues' => ['monday' => 1]]],
        ])->assertOk();
        $this->assertSame('triggered', $item->refresh()->condition_state);
        $this->assertDatabaseHas('action_item_status_history', ['action_item_id' => $item->id, 'event' => 'condition_recurred']);
        $this->assertDatabaseCount('action_items', 1);
    }

    public function test_resolution_requires_a_note_and_verified_closure_preserves_history(): void
    {
        $item = $this->createManual();
        $this->actingAs($this->admin)->patchJson("/api/admin/action-items/{$item->id}", ['status' => 'resolved'])
            ->assertUnprocessable()->assertJsonValidationErrors('resolution_note');

        $this->actingAs($this->admin)->patchJson("/api/admin/action-items/{$item->id}", [
            'status' => 'resolved', 'resolution_note' => 'Root cause reviewed and corrective control implemented.',
        ])->assertOk()->assertJsonPath('status', 'resolved');
        $resolvedAt = $item->refresh()->resolved_at;

        $this->actingAs($this->secondAdmin)->patchJson("/api/admin/action-items/{$item->id}", ['status' => 'closed'])
            ->assertOk()->assertJsonPath('verifiedByName', 'Clinical Director');
        $this->actingAs($this->admin)->patchJson("/api/admin/action-items/{$item->id}", ['status' => 'open'])
            ->assertOk()->assertJsonPath('status', 'open');

        $item->refresh();
        $this->assertTrue($resolvedAt->equalTo($item->resolved_at));
        $this->assertGreaterThanOrEqual(3, ActionItemStatusHistory::query()->where('action_item_id', $item->id)->count());
    }

    public function test_comments_private_evidence_and_complete_detail_are_secured(): void
    {
        Storage::fake('local');
        $item = $this->createManual();
        $this->actingAs($this->admin)->postJson("/api/admin/action-items/{$item->id}/comments", ['body' => 'Ward review completed.'])
            ->assertCreated()->assertJsonPath('authorName', 'Quality Lead');

        $upload = $this->actingAs($this->admin)->post("/api/admin/action-items/{$item->id}/evidence", [
            'file' => UploadedFile::fake()->create('review.pdf', 80, 'application/pdf'),
        ], ['Accept' => 'application/json'])->assertCreated();

        $this->actingAs($this->admin)->getJson("/api/admin/action-items/{$item->id}")
            ->assertOk()->assertJsonCount(1, 'comments')->assertJsonCount(1, 'evidence')->assertJsonStructure(['history']);
        $this->actingAs($this->nurse)->get($upload->json('downloadUrl'))->assertForbidden();
        $this->actingAs($this->admin)->get($upload->json('downloadUrl'))
            ->assertOk()
            ->assertHeader('X-Content-Type-Options', 'nosniff')
            ->assertDownload('review.pdf');
        $this->actingAs($this->admin)->post("/api/admin/action-items/{$item->id}/evidence", [
            'file' => UploadedFile::fake()->create('script.php', 1, 'application/x-php'),
        ], ['Accept' => 'application/json'])->assertUnprocessable();
    }

    public function test_overdue_escalation_is_deduplicated_and_summary_counts_all_outstanding_work(): void
    {
        $overdue = $this->createManual(['due_at' => now()->subHour(), 'status' => 'in_progress']);
        $this->artisan('action-items:escalate-overdue')->assertSuccessful();
        $firstCount = Notification::query()->where('type', 'action_item_overdue')->count();
        $this->assertGreaterThan(0, $firstCount);
        $this->artisan('action-items:escalate-overdue')->assertSuccessful();
        $this->assertSame($firstCount, Notification::query()->where('type', 'action_item_overdue')->count());
        $this->assertNotNull($overdue->refresh()->overdue_notified_at);

        $this->actingAs($this->admin)->getJson('/api/admin/action-items?status=outstanding&overdue=1')
            ->assertOk()->assertJsonPath('meta.summary.outstanding', 1)->assertJsonPath('meta.summary.overdue', 1)
            ->assertJsonPath('data.0.id', $overdue->id);
    }

    public function test_alert_rule_management_is_validated_audited_and_admin_only(): void
    {
        $field = ReportFieldDefinition::query()
            ->where('template_id', $this->assignment->template_id)
            ->where('field_key', 'total_pressure_ulcer')
            ->firstOrFail();
        $payload = [
            'template_id' => $this->assignment->template_id,
            'field_definition_id' => $field->id,
            'operator' => 'gte', 'threshold' => 5, 'severity' => 'medium',
            'deadline_hours' => 48, 'responsible_role' => 'admin',
            'notification_roles' => ['admin', 'superadmin'],
        ];

        $this->actingAs($this->nurse)->postJson('/api/admin/clinical-alert-rules', $payload)->assertForbidden();
        $created = $this->actingAs($this->admin)->postJson('/api/admin/clinical-alert-rules', $payload)
            ->assertCreated()->assertJsonPath('fieldKey', 'total_pressure_ulcer');
        $this->actingAs($this->admin)->patchJson('/api/admin/clinical-alert-rules/'.$created->json('id'), [
            'threshold' => 3, 'deadline_hours' => 24,
        ])->assertOk()->assertJsonPath('version', 2);
        $this->assertDatabaseHas('admin_audit_logs', ['entity_type' => 'clinical_alert_rule', 'entity_id' => $created->json('id')]);
    }

    public function test_action_ownership_rejects_non_admin_users(): void
    {
        $item = $this->createManual();
        $this->actingAs($this->admin)->patchJson("/api/admin/action-items/{$item->id}", [
            'assigned_to' => $this->nurse->id,
        ])->assertUnprocessable()->assertJsonValidationErrors('assigned_to');
    }

    public function test_department_slugs_are_resolved_for_manual_actions_and_filters(): void
    {
        $created = $this->actingAs($this->admin)->postJson('/api/admin/action-items', [
            'title' => 'Review ward safety concern',
            'description' => 'Confirm the concern with the ward lead.',
            'department_id' => 'gi_neuro_inpatient',
            'assigned_to' => $this->admin->id,
            'due_at' => now()->addDay()->toIso8601String(),
        ])->assertCreated()->assertJsonPath('departmentName', 'GI/Neurology');

        $this->assertSame($this->assignment->department_id, ActionItem::query()->findOrFail($created->json('id'))->department_id);
        $this->actingAs($this->admin)->getJson('/api/admin/action-items?status=outstanding&department_id=gi_neuro_inpatient')
            ->assertOk()
            ->assertJsonPath('data.0.id', $created->json('id'))
            ->assertJsonPath('meta.summary.byDepartment.0.departmentSlug', 'gi_neuro_inpatient');
    }

    public function test_paginated_queue_has_no_per_item_query_growth(): void
    {
        ActionItem::query()->delete();
        foreach (range(1, 50) as $number) {
            $this->createManual(['title' => "Governance item {$number}"]);
        }
        Cache::flush();
        DB::flushQueryLog();
        DB::enableQueryLog();

        $this->actingAs($this->admin)->getJson('/api/admin/action-items?status=outstanding&perPage=25')->assertOk()->assertJsonCount(25, 'data');

        $this->assertLessThanOrEqual(14, count(DB::getQueryLog()), 'The action queue should use fixed eager-loaded queries, not one query per row.');
    }
}
