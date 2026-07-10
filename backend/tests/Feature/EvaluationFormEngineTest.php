<?php

namespace Tests\Feature;

use App\Models\ConsultantEvaluation;
use App\Models\Department;
use App\Models\DutyAssignment;
use App\Models\DutyType;
use App\Models\Evaluation;
use App\Models\EvaluationForm;
use App\Models\User;
use App\Services\Academic\AcademicAnalyticsFilters;
use App\Services\Academic\AcademicAnalyticsService;
use App\Services\Academic\EvaluationMigrationService;
use Database\Seeders\DepartmentSeeder;
use Database\Seeders\ReportTemplateSeeder;
use Database\Seeders\RoleSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * V2 Phase 4: the admin-editable form engine, the legacy-data migration
 * verifier, analytics parity, and the analytics cache.
 */
class EvaluationFormEngineTest extends TestCase
{
    use RefreshDatabase;

    private User $admin;

    private User $superadmin;

    private User $resident;

    private User $consultant;

    protected function setUp(): void
    {
        parent::setUp();

        foreach ([RoleSeeder::class, ReportTemplateSeeder::class, DepartmentSeeder::class] as $seeder) {
            $this->seed($seeder);
        }

        $this->admin = User::factory()->role('admin', 'Administrator')->create();
        $this->superadmin = User::factory()->role('superadmin', 'Maintenance')->create();
        $this->resident = User::factory()->role('resident', 'Resident')->create();
        $this->consultant = User::factory()->role('consultant', 'Consultant')->create();

        $wardService = DutyType::query()->where('slug', 'nephrology_ward_service')->firstOrFail();

        foreach ([$this->resident, $this->consultant] as $user) {
            DutyAssignment::query()->create([
                'user_id' => $user->id,
                'duty_type_id' => $wardService->id,
                'starts_on' => now()->subDays(20)->toDateString(),
                'ends_on' => now()->addDays(20)->toDateString(),
                'source' => 'admin',
                'created_by' => $this->admin->id,
            ]);
        }
    }

    /**
     * @return array<string, mixed>
     */
    private function validConsultantPayload(): array
    {
        return [
            'evaluationDate' => now()->subDays(1)->toDateString(),
            'subjectId' => $this->consultant->id,
            'seniorPresent' => true,
            'seniorJoinedAt' => '08:15',
            'presenceMinutes' => 45,
            'allPatientsReviewed' => true,
            'mgmtPlanDocumented' => true,
            'vteAssessed' => true,
            'dischargeDiscussed' => true,
            'medReviewDone' => true,
            'criticalLabsReviewed' => true,
            'pctPatientsSeen' => 80,
            'roundDelayed' => false,
            'mdtParticipants' => ['consultant', 'nurse'],
            'systemIssues' => [],
        ];
    }

    // ---- Validation from the form definition ----

    public function test_validation_rules_come_from_the_form_definition(): void
    {
        // Time format, integer bounds, percent bounds, rating bounds, and a
        // missing required boolean must each fail with the field's own key.
        $bad = [
            ['seniorJoinedAt' => 'quarter past eight', 'error' => 'senior_joined_at'],
            ['presenceMinutes' => 999, 'error' => 'presence_minutes'],
            ['pctPatientsSeen' => 250, 'error' => 'pct_patients_seen'],
        ];

        foreach ($bad as $case) {
            $errorKey = $case['error'];
            unset($case['error']);

            $this->actingAs($this->resident)
                ->postJson('/api/academic/consultant-evaluations', [...$this->validConsultantPayload(), ...$case])
                ->assertStatus(422)
                ->assertJsonValidationErrors([$errorKey]);
        }

        // A required boolean cannot be omitted.
        $payload = $this->validConsultantPayload();
        unset($payload['vteAssessed']);
        $this->actingAs($this->resident)
            ->postJson('/api/academic/consultant-evaluations', $payload)
            ->assertStatus(422)
            ->assertJsonValidationErrors(['vte_assessed']);

        // Unknown multi-select values are silently dropped, never stored.
        $response = $this->actingAs($this->resident)
            ->postJson('/api/academic/consultant-evaluations', [
                ...$this->validConsultantPayload(),
                'mdtParticipants' => ['consultant', 'time_traveler'],
            ])
            ->assertCreated();

        $this->assertSame(['consultant'], $response->json('mdtParticipants'));
    }

    // ---- Content vs structural edits ----

    public function test_content_edit_applies_in_place_without_a_new_version(): void
    {
        $form = EvaluationForm::query()->where('key', 'consultant_mdt')->where('status', 'published')->firstOrFail();

        $this->actingAs($this->admin)
            ->patchJson("/api/admin/academic/evaluation-forms/{$form->id}/content", [
                'fields' => [
                    ['key' => 'vte_assessed', 'label' => 'VTE prophylaxis assessed', 'helpText' => 'Per ward protocol'],
                ],
            ])
            ->assertOk();

        $this->assertSame(1, EvaluationForm::query()->where('key', 'consultant_mdt')->count());

        // The submit surface sees the new wording immediately.
        $this->actingAs($this->resident)
            ->getJson('/api/academic/evaluation-forms/consultant_mdt')
            ->assertOk()
            ->assertJsonPath('version', 1)
            ->assertJsonFragment(['label' => 'VTE prophylaxis assessed']);

        // ...and so do the analytics labels (no code-side label map).
        $this->actingAs($this->resident)
            ->postJson('/api/academic/consultant-evaluations', $this->validConsultantPayload())
            ->assertCreated();

        $summary = $this->actingAs($this->admin)
            ->getJson('/api/academic/analytics/summary?direction=consultant')
            ->assertOk()
            ->json('indicatorCompliance');

        $this->assertContains('VTE prophylaxis assessed', array_column($summary, 'label'));

        $this->assertDatabaseHas('admin_audit_logs', [
            'entity_type' => 'evaluation_form',
            'action' => 'update_content',
        ]);

        // Content editing cannot deactivate a core field or invent one.
        $this->actingAs($this->admin)
            ->patchJson("/api/admin/academic/evaluation-forms/{$form->id}/content", [
                'fields' => [['key' => 'senior_present', 'active' => false]],
            ])
            ->assertStatus(422);

        $this->actingAs($this->admin)
            ->patchJson("/api/admin/academic/evaluation-forms/{$form->id}/content", [
                'fields' => [['key' => 'brand_new_field', 'label' => 'Nope']],
            ])
            ->assertStatus(422);
    }

    public function test_structural_edit_creates_a_new_version_and_old_evaluations_stay_pinned(): void
    {
        // File an evaluation against v1.
        $firstId = $this->actingAs($this->resident)
            ->postJson('/api/academic/consultant-evaluations', $this->validConsultantPayload())
            ->assertCreated()
            ->json('id');

        $v1 = EvaluationForm::query()->where('key', 'consultant_mdt')->where('version', 1)->firstOrFail();

        // Admins hold editContent but NOT editStructure.
        $this->actingAs($this->admin)
            ->postJson('/api/admin/academic/evaluation-forms/consultant_mdt/draft')
            ->assertForbidden();

        // Maintenance drafts v2, adds a field, publishes.
        $draft = $this->actingAs($this->superadmin)
            ->postJson('/api/admin/academic/evaluation-forms/consultant_mdt/draft')
            ->assertCreated()
            ->json();

        $this->assertSame(2, $draft['version']);
        $this->assertSame('draft', $draft['status']);

        $fields = collect($draft['fields'])->map(fn (array $field) => [
            'key' => $field['key'],
            'section' => $field['section'],
            'label' => $field['label'],
            'helpText' => $field['helpText'],
            'type' => $field['type'],
            'options' => $field['options'],
            'required' => $field['required'],
            'sortOrder' => $field['sortOrder'],
            'active' => $field['active'],
        ])->push([
            'key' => 'teaching_points_given',
            'section' => 'Round quality',
            'label' => 'Teaching points given',
            'helpText' => null,
            'type' => 'boolean',
            'options' => null,
            'required' => false,
            'sortOrder' => 65,
            'active' => true,
        ])->all();

        $this->actingAs($this->superadmin)
            ->putJson("/api/admin/academic/evaluation-forms/{$draft['id']}/structure", ['fields' => $fields])
            ->assertOk();

        $this->actingAs($this->superadmin)
            ->postJson("/api/admin/academic/evaluation-forms/{$draft['id']}/publish")
            ->assertOk()
            ->assertJsonPath('status', 'published');

        // Exactly one published version per key; v1 archived.
        $this->assertSame('archived', $v1->refresh()->status);
        $this->actingAs($this->resident)
            ->getJson('/api/academic/evaluation-forms/consultant_mdt')
            ->assertOk()
            ->assertJsonPath('version', 2)
            ->assertJsonFragment(['label' => 'Teaching points given']);

        // The old evaluation stays pinned to the version it was answered on.
        $this->assertSame($v1->id, Evaluation::query()->findOrFail($firstId)->form_id);

        // A new submission (with the new field) pins v2.
        $secondId = $this->actingAs($this->resident)
            ->postJson('/api/academic/consultant-evaluations', [
                ...$this->validConsultantPayload(),
                'teachingPointsGiven' => true,
            ])
            ->assertCreated()
            ->json('id');

        $second = Evaluation::query()->findOrFail($secondId);
        $this->assertSame($draft['id'], $second->form_id);
        $this->assertTrue((bool) $second->answer('teaching_points_given'));
    }

    public function test_core_fields_cannot_be_removed_or_type_changed(): void
    {
        $draft = $this->actingAs($this->superadmin)
            ->postJson('/api/admin/academic/evaluation-forms/consultant_mdt/draft')
            ->assertCreated()
            ->json();

        $withoutCore = collect($draft['fields'])
            ->reject(fn (array $field) => $field['key'] === 'senior_present')
            ->map(fn (array $field) => [
                'key' => $field['key'],
                'section' => $field['section'],
                'label' => $field['label'],
                'type' => $field['type'],
                'options' => $field['options'],
                'required' => $field['required'],
            ])
            ->values()
            ->all();

        $this->actingAs($this->superadmin)
            ->putJson("/api/admin/academic/evaluation-forms/{$draft['id']}/structure", ['fields' => $withoutCore])
            ->assertStatus(422);

        $typeChanged = collect($draft['fields'])
            ->map(fn (array $field) => [
                'key' => $field['key'],
                'section' => $field['section'],
                'label' => $field['label'],
                'type' => $field['key'] === 'presence_minutes' ? 'text' : $field['type'],
                'options' => $field['options'],
                'required' => $field['required'],
            ])
            ->values()
            ->all();

        $this->actingAs($this->superadmin)
            ->putJson("/api/admin/academic/evaluation-forms/{$draft['id']}/structure", ['fields' => $typeChanged])
            ->assertStatus(422);
    }

    // ---- Legacy migration verification + analytics parity ----

    /**
     * Seed legacy rows directly (as production data would sit), re-run the
     * copy, and require the verifier to PASS and analytics to reproduce the
     * hand-computed aggregates.
     */
    public function test_verify_migration_passes_and_analytics_match_on_seeded_legacy_data(): void
    {
        $department = Department::query()->where('slug', 'nephrology_inpatient')->firstOrFail();

        foreach ([
            ['vte_assessed' => true, 'senior_present' => true, 'pct_patients_seen' => 80],
            ['vte_assessed' => false, 'senior_present' => false, 'pct_patients_seen' => 60],
        ] as $index => $overrides) {
            ConsultantEvaluation::query()->create(array_merge([
                'author_id' => $this->resident->id,
                'subject_id' => $this->consultant->id,
                'ward_id' => $department->id,
                'ward_ref_id' => $department->ward_id,
                'placement_type' => 'ward',
                'evaluation_date' => now()->subDays(3 + $index)->toDateString(),
                'senior_joined_at' => '08:15',
                'presence_minutes' => 40,
                'all_patients_reviewed' => true,
                'mgmt_plan_documented' => false,
                'discharge_discussed' => false,
                'med_review_done' => false,
                'critical_labs_reviewed' => false,
                'round_delayed' => false,
                'mdt_participants' => ['consultant', 'nurse'],
                'system_issues' => ['lab_delay'],
                'comment' => 'Legacy row '.$index,
            ], $overrides));
        }

        $copied = app(EvaluationMigrationService::class)->copy();
        $this->assertSame(2, $copied['consultant']);

        $this->artisan('academic:verify-migration')
            ->expectsOutputToContain('PASS')
            ->assertSuccessful();

        // Copying twice never duplicates.
        $second = app(EvaluationMigrationService::class)->copy();
        $this->assertSame(0, $second['consultant']);

        // Analytics parity on the fixed dataset: 2 evaluations; score items
        // true: row A = all_patients + vte (2/6), row B = all_patients (1/6)
        // => average of 33.333 and 16.667 = 25.0; VTE compliance 50%.
        $summary = app(AcademicAnalyticsService::class)->summary(new AcademicAnalyticsFilters(direction: 'consultant'));

        $this->assertSame(2, $summary['evaluationCount']);
        $this->assertSame(25.0, $summary['averageScore']);
        $this->assertSame(0.5, $summary['seniorPresenceRate']);
        $this->assertSame(70.0, $summary['avgPctSeen']);

        $vte = collect($summary['indicatorCompliance'])->firstWhere('key', 'vteAssessed');
        $this->assertSame(50.0, $vte['pct']);

        $issues = collect($summary['issueFrequency'])->firstWhere('value', 'lab_delay');
        $this->assertSame(2, $issues['count']);
    }

    // ---- The analytics cache (guide 7.3: do not defer this) ----

    public function test_analytics_results_are_cached_by_content_stamp_and_refresh_on_write(): void
    {
        $this->actingAs($this->resident)
            ->postJson('/api/academic/consultant-evaluations', $this->validConsultantPayload())
            ->assertCreated();

        $filters = new AcademicAnalyticsFilters(direction: 'consultant');

        // Cold build. A fresh service instance (no request memo) proves the
        // second read is served by the shared cache, not instance state.
        $first = app(AcademicAnalyticsService::class)->summary($filters);
        $this->assertSame(1, $first['evaluationCount']);

        DB::enableQueryLog();
        $second = app()->make(AcademicAnalyticsService::class)->summary($filters);
        $queries = collect(DB::getQueryLog())->pluck('query');
        DB::disableQueryLog();

        $this->assertSame($first, $second);
        // Only the cheap stamp query may touch the evaluation tables; the
        // row + answer folding must not re-run on a cache hit.
        $this->assertTrue($queries->contains(fn (string $sql) => str_contains($sql, 'count(*)')));
        $this->assertFalse($queries->contains(fn (string $sql) => str_contains($sql, 'evaluation_answers')));

        // A new submission changes the stamp: fresh-after-write, no manual
        // invalidation anywhere.
        $this->actingAs($this->resident)
            ->postJson('/api/academic/consultant-evaluations', [
                ...$this->validConsultantPayload(),
                'evaluationDate' => now()->toDateString(),
            ])
            ->assertCreated();

        $third = app()->make(AcademicAnalyticsService::class)->summary($filters);
        $this->assertSame(2, $third['evaluationCount']);
    }
}
