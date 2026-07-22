<?php

namespace Tests\Feature;

use App\Models\ConsultantEvaluation;
use App\Models\Department;
use App\Models\DutyAssignment;
use App\Models\DutyType;
use App\Models\Evaluation;
use App\Models\EvaluationForm;
use App\Models\Student;
use App\Models\StudentBatch;
use App\Models\User;
use App\Services\Academic\AcademicAnalyticsFilters;
use App\Services\Academic\AcademicAnalyticsService;
use App\Services\Academic\EvaluationFormService;
use App\Services\Academic\EvaluationMigrationService;
use App\Support\Academic\EvaluationScoring;
use Database\Seeders\DepartmentSeeder;
use Database\Seeders\ReportTemplateSeeder;
use Database\Seeders\RoleSeeder;
use Illuminate\Cache\CacheManager;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;
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

    /** @return list<array<string, mixed>> */
    private function structurePayload(EvaluationForm $form): array
    {
        return $form->fields()->get()->map(fn ($field) => [
            'key' => $field->key,
            'section' => $field->section,
            'label' => $field->label,
            'helpText' => $field->help_text,
            'type' => $field->type,
            'options' => $field->options,
            'required' => $field->required,
            'sortOrder' => $field->sort_order,
            'active' => $field->active,
        ])->values()->all();
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

        // Unknown multi-select values are rejected, never silently dropped.
        $this->actingAs($this->resident)
            ->postJson('/api/academic/consultant-evaluations', [
                ...$this->validConsultantPayload(),
                'mdtParticipants' => ['consultant', 'time_traveler'],
            ])
            ->assertStatus(422)
            ->assertJsonValidationErrors(['mdt_participants.1']);
    }

    // ---- Content vs structural edits ----

    public function test_content_edit_applies_atomically_to_the_current_published_version(): void
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

        // Content editing cannot deactivate a core field or invent one.
        $this->actingAs($this->admin)
            ->patchJson("/api/admin/academic/evaluation-forms/{$form->id}/content", [
                'fields' => [['key' => 'senior_present', 'active' => false]],
            ])
            ->assertStatus(422);

        $this->actingAs($this->admin)
            ->patchJson("/api/admin/academic/evaluation-forms/{$form->id}/content", [
                'fields' => [
                    ['key' => 'vte_assessed', 'label' => 'Must roll back'],
                    ['key' => 'brand_new_field', 'label' => 'Nope'],
                ],
            ])
            ->assertStatus(422);

        $this->assertSame(
            'VTE prophylaxis assessed',
            $form->fields()->where('key', 'vte_assessed')->value('label'),
        );

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

        // A new submission (with the new field) pins v2. A different date,
        // because one author evaluates one subject once per date per form.
        $secondId = $this->actingAs($this->resident)
            ->postJson('/api/academic/consultant-evaluations', [
                ...$this->validConsultantPayload(),
                'evaluationDate' => now()->subDays(2)->toDateString(),
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
        $originalFieldCount = count($draft['fields']);

        $this->actingAs($this->superadmin)
            ->putJson("/api/admin/academic/evaluation-forms/{$draft['id']}/structure", ['fields' => $withoutCore])
            ->assertStatus(422);

        $this->assertSame($originalFieldCount, EvaluationForm::query()->findOrFail($draft['id'])->fields()->count());
        $this->assertDatabaseHas('evaluation_form_fields', [
            'form_id' => $draft['id'],
            'key' => 'senior_present',
            'type' => 'boolean',
            'active' => true,
            'is_core' => true,
        ]);

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

        $this->assertSame($originalFieldCount, EvaluationForm::query()->findOrFail($draft['id'])->fields()->count());
        $this->assertDatabaseHas('evaluation_form_fields', [
            'form_id' => $draft['id'],
            'key' => 'presence_minutes',
            'type' => 'integer',
            'active' => true,
            'is_core' => true,
        ]);
        $this->assertDatabaseMissing('admin_audit_logs', [
            'entity_type' => 'evaluation_form',
            'entity_id' => $draft['id'],
            'action' => 'update_structure',
        ]);
    }

    public function test_structure_rejects_published_versions_and_both_edit_paths_reject_archives(): void
    {
        $published = EvaluationForm::query()
            ->with('fields')
            ->where('key', 'consultant_mdt')
            ->where('status', 'published')
            ->firstOrFail();
        $structure = $this->structurePayload($published);

        $this->actingAs($this->admin)
            ->patchJson("/api/admin/academic/evaluation-forms/{$published->id}/content", [
                'fields' => [['key' => 'vte_assessed', 'label' => 'Published mutation']],
            ])
            ->assertOk();

        $this->actingAs($this->superadmin)
            ->putJson("/api/admin/academic/evaluation-forms/{$published->id}/structure", ['fields' => $structure])
            ->assertStatus(422)
            ->assertJsonValidationErrors(['form']);

        $draft = app(EvaluationFormService::class)->createDraftFrom($published);

        $this->actingAs($this->admin)
            ->patchJson("/api/admin/academic/evaluation-forms/{$draft->id}/content", [
                'fields' => [['key' => 'vte_assessed', 'label' => 'Draft mutation']],
            ])
            ->assertStatus(422)
            ->assertJsonValidationErrors(['form']);

        app(EvaluationFormService::class)->publish($draft);

        $this->actingAs($this->admin)
            ->patchJson("/api/admin/academic/evaluation-forms/{$published->id}/content", [
                'fields' => [['key' => 'vte_assessed', 'label' => 'Archived mutation']],
            ])
            ->assertStatus(422)
            ->assertJsonValidationErrors(['form']);

        $this->actingAs($this->superadmin)
            ->putJson("/api/admin/academic/evaluation-forms/{$published->id}/structure", ['fields' => $structure])
            ->assertStatus(422)
            ->assertJsonValidationErrors(['form']);

        $this->assertSame('archived', $published->refresh()->status);
        $this->assertSame('Published mutation', $published->fields()->where('key', 'vte_assessed')->value('label'));
    }

    public function test_mutations_recheck_a_stale_form_status_under_lock(): void
    {
        $service = app(EvaluationFormService::class);
        $firstPublished = EvaluationForm::query()->where('key', 'consultant_mdt')->where('status', 'published')->firstOrFail();
        $originalLabel = $firstPublished->fields()->where('key', 'vte_assessed')->value('label');
        $replacement = $service->createDraftFrom($firstPublished);
        $service->publish($replacement);

        try {
            $service->updateContent($firstPublished, [
                'fields' => [['key' => 'vte_assessed', 'label' => 'Stale mutation']],
            ]);
            $this->fail('Content editing trusted a form that was no longer current.');
        } catch (ValidationException $exception) {
            $this->assertArrayHasKey('form', $exception->errors());
        }

        $this->assertSame('archived', $firstPublished->refresh()->status);
        $this->assertSame($originalLabel, $firstPublished->fields()->where('key', 'vte_assessed')->value('label'));

        try {
            $service->updateContent($replacement->refresh(), [
                'fields' => [['key' => 'vte_assessed', 'label' => 'Current mutation']],
            ]);
            $this->addToAssertionCount(1);
        } catch (ValidationException) {
            $this->fail('Content editing rejected the new current published version.');
        }

        $secondPublished = EvaluationForm::query()->where('key', 'resident_acgme')->where('status', 'published')->firstOrFail();
        $staleStructureDraft = $service->createDraftFrom($secondPublished);
        $originalFieldCount = $staleStructureDraft->fields()->count();
        $structure = $this->structurePayload($staleStructureDraft);
        EvaluationForm::query()->whereKey($staleStructureDraft->id)->update(['status' => 'archived']);

        try {
            $service->updateStructure($staleStructureDraft, $structure);
            $this->fail('Structure editing trusted a stale draft model.');
        } catch (ValidationException $exception) {
            $this->assertArrayHasKey('form', $exception->errors());
        }

        $this->assertSame($originalFieldCount, $staleStructureDraft->fields()->count());
    }

    public function test_database_allows_only_one_draft_and_one_published_version_per_form_key(): void
    {
        $published = EvaluationForm::query()
            ->where('key', 'consultant_mdt')
            ->where('status', 'published')
            ->firstOrFail();

        $this->assertUniqueActiveStatusRejects([
            'key' => $published->key,
            'name' => 'Duplicate published form',
            'target' => $published->target,
            'version' => 998,
            'status' => 'published',
        ]);

        app(EvaluationFormService::class)->createDraftFrom($published);

        $this->assertUniqueActiveStatusRejects([
            'key' => $published->key,
            'name' => 'Duplicate draft form',
            'target' => $published->target,
            'version' => 999,
            'status' => 'draft',
        ]);

        $this->assertSame(1, EvaluationForm::query()->where('key', $published->key)->where('status', 'published')->count());
        $this->assertSame(1, EvaluationForm::query()->where('key', $published->key)->where('status', 'draft')->count());
    }

    public function test_draft_creation_and_publish_retries_are_idempotent(): void
    {
        $published = EvaluationForm::query()
            ->where('key', 'consultant_mdt')
            ->where('status', 'published')
            ->firstOrFail();
        $service = app(EvaluationFormService::class);

        $firstDraft = $service->createDraftFrom($published);
        $retriedDraft = $service->createDraftFrom($published);

        $this->assertSame($firstDraft->id, $retriedDraft->id);

        $service->publish($firstDraft);
        $service->publish($firstDraft);

        $this->assertSame(1, EvaluationForm::query()->where('key', $published->key)->where('status', 'published')->count());
        $this->assertSame(0, EvaluationForm::query()->where('key', $published->key)->where('status', 'draft')->count());
        $this->assertSame('published', $firstDraft->refresh()->status);
    }

    public function test_draft_and_publish_http_retries_emit_one_audit_event_per_transition(): void
    {
        $firstDraft = $this->actingAs($this->superadmin)
            ->postJson('/api/admin/academic/evaluation-forms/consultant_mdt/draft')
            ->assertCreated()
            ->json();

        $retriedDraft = $this->actingAs($this->superadmin)
            ->postJson('/api/admin/academic/evaluation-forms/consultant_mdt/draft')
            ->assertOk()
            ->json();

        $this->assertSame($firstDraft['id'], $retriedDraft['id']);
        $this->assertSame(1, DB::table('admin_audit_logs')
            ->where('entity_type', 'evaluation_form')
            ->where('action', 'create_draft')
            ->count());

        $this->actingAs($this->superadmin)
            ->postJson("/api/admin/academic/evaluation-forms/{$firstDraft['id']}/publish")
            ->assertOk()
            ->assertJsonPath('status', 'published');

        $this->actingAs($this->superadmin)
            ->postJson("/api/admin/academic/evaluation-forms/{$firstDraft['id']}/publish")
            ->assertOk()
            ->assertJsonPath('status', 'published');

        $this->assertSame(1, DB::table('admin_audit_logs')
            ->where('entity_type', 'evaluation_form')
            ->where('action', 'publish')
            ->count());
    }

    public function test_database_rejects_ambiguous_evaluation_subjects_and_evaluator_sources(): void
    {
        $evaluationId = $this->actingAs($this->resident)
            ->postJson('/api/academic/consultant-evaluations', $this->validConsultantPayload())
            ->assertCreated()
            ->json('id');

        $batch = StudentBatch::query()->create([
            'cohort' => 'C1',
            'label' => 'Invariant test batch',
            'starts_on' => now()->startOfMonth()->toDateString(),
            'ends_on' => now()->addMonths(3)->toDateString(),
            'active' => true,
        ]);
        $student = Student::query()->create([
            'batch_id' => $batch->id,
            'full_name' => 'Invariant Test Student',
            'subgroup' => 'A',
            'active' => true,
        ]);

        foreach ([
            ['subject_user_id' => null],
            ['subject_student_id' => $student->id],
            ['author_id' => null],
            ['external_evaluator_name' => 'External and internal at once'],
        ] as $invalidUpdate) {
            try {
                DB::table('evaluations')->where('id', $evaluationId)->update($invalidUpdate);
                $this->fail('The database accepted an evaluation with ambiguous subject or evaluator columns.');
            } catch (QueryException $exception) {
                $this->assertStringContainsString('exactly one subject', $exception->getMessage());
            }
        }

        $evaluation = Evaluation::query()->findOrFail($evaluationId);
        $this->assertSame($this->consultant->id, $evaluation->subject_user_id);
        $this->assertNull($evaluation->subject_student_id);
        $this->assertSame($this->resident->id, $evaluation->author_id);
        $this->assertNull($evaluation->external_evaluator_name);
    }

    /** @param array<string, mixed> $attributes */
    private function assertUniqueActiveStatusRejects(array $attributes): void
    {
        try {
            EvaluationForm::query()->create($attributes);
            $this->fail('The database accepted a second active form status for one key.');
        } catch (QueryException) {
            $this->addToAssertionCount(1);
        }
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

    public function test_every_evaluation_analytics_database_cache_hit_contains_only_plain_data(): void
    {
        $this->actingAs($this->resident)
            ->postJson('/api/academic/consultant-evaluations', $this->validConsultantPayload())
            ->assertCreated();

        /** @var CacheManager $cache */
        $cache = app('cache');
        $originalDriver = $cache->getDefaultDriver();
        $cache->setDefaultDriver('database');
        $cache->forgetDriver('database');

        try {
            $filters = new AcademicAnalyticsFilters(direction: 'consultant');
            $calls = [
                'summary' => fn (): array => app(AcademicAnalyticsService::class)->summary($filters),
                'trend' => fn (): array => app(AcademicAnalyticsService::class)->trend($filters),
                'people' => fn (): array => app(AcademicAnalyticsService::class)->people($filters),
            ];

            foreach ($calls as $operation => $call) {
                $first = $call();
                $second = $call();

                $this->assertSame($first, $second, "{$operation} changed on its cache hit.");
                $this->assertPlainCachePayload($second, $operation);
                $this->assertStringNotContainsString('__PHP_Incomplete_Class', serialize($second));
            }
        } finally {
            $cache->store('database')->flush();
            $cache->setDefaultDriver($originalDriver);
            $cache->forgetDriver('database');
        }
    }

    private function assertPlainCachePayload(mixed $value, string $path): void
    {
        $this->assertNotInstanceOf(\__PHP_Incomplete_Class::class, $value, "Incomplete cache object at {$path}.");

        if (is_array($value)) {
            foreach ($value as $key => $item) {
                $this->assertPlainCachePayload($item, $path.'.'.$key);
            }

            return;
        }

        $this->assertTrue(is_scalar($value) || $value === null, sprintf(
            'Cache value at %s must be plain; %s found.',
            $path,
            get_debug_type($value),
        ));
    }

    // ---- Review-pass regressions ----

    public function test_the_form_endpoint_serves_every_published_form_key(): void
    {
        // The teaching page renders the student forms for consultants through
        // this same endpoint; a peer-only whitelist here killed that page.
        foreach (EvaluationForm::KEYS as $key) {
            $this->actingAs($this->consultant)
                ->getJson("/api/academic/evaluation-forms/{$key}")
                ->assertOk()
                ->assertJsonPath('key', $key);
        }

        $this->actingAs($this->consultant)
            ->getJson('/api/academic/evaluation-forms/no_such_form')
            ->assertStatus(422);
    }

    public function test_only_contract_fields_are_core_and_scores_follow_active_indicators(): void
    {
        foreach ([
            'consultant_mdt' => ['senior_present', 'senior_joined_at', 'presence_minutes'],
            'resident_acgme' => ['overall_rating'],
        ] as $key => $expectedCore) {
            $form = EvaluationForm::query()->where('key', $key)->where('status', 'published')->firstOrFail();
            $coreKeys = $form->fields()->where('is_core', true)->pluck('key')->all();

            sort($coreKeys);
            sort($expectedCore);
            $this->assertSame($expectedCore, $coreKeys);
        }

        $form = EvaluationForm::query()->where('key', 'consultant_mdt')->where('status', 'published')->firstOrFail();

        $this->actingAs($this->admin)
            ->patchJson("/api/admin/academic/evaluation-forms/{$form->id}/content", [
                'fields' => [['key' => 'all_patients_reviewed', 'active' => false]],
            ])
            ->assertOk();

        $this->actingAs($this->admin)
            ->patchJson("/api/admin/academic/evaluation-forms/{$form->id}/content", [
                'fields' => [['key' => 'senior_present', 'active' => false]],
            ])
            ->assertStatus(422);

        $evaluationId = $this->actingAs($this->resident)
            ->postJson('/api/academic/consultant-evaluations', $this->validConsultantPayload())
            ->assertCreated()
            ->json('id');
        $evaluation = Evaluation::query()->with(['answers', 'form.fields'])->findOrFail($evaluationId);

        $this->assertNull($evaluation->answer('all_patients_reviewed'));
        $this->assertSame(100.0, EvaluationScoring::score($evaluation, 'consultant'));
    }

    public function test_structure_editor_rejects_reserved_keys_non_text_comment_and_choiceless_selects(): void
    {
        $draft = $this->actingAs($this->superadmin)
            ->postJson('/api/admin/academic/evaluation-forms/consultant_mdt/draft')
            ->assertCreated()
            ->json();

        $baseFields = collect($draft['fields'])->map(fn (array $field) => [
            'key' => $field['key'],
            'section' => $field['section'],
            'label' => $field['label'],
            'helpText' => $field['helpText'],
            'type' => $field['type'],
            'options' => $field['options'],
            'required' => $field['required'],
            'sortOrder' => $field['sortOrder'],
            'active' => $field['active'],
        ]);

        $attempt = fn (array $extra) => $this->actingAs($this->superadmin)
            ->putJson("/api/admin/academic/evaluation-forms/{$draft['id']}/structure", [
                'fields' => $baseFields->push($extra)->all(),
            ]);

        // A field named after a submit-endpoint header key would clobber the
        // controller's validation rules for it.
        $attempt([
            'key' => 'subject_id', 'section' => 'Notes', 'label' => 'Subject', 'helpText' => null,
            'type' => 'text', 'options' => null, 'required' => false, 'sortOrder' => 900, 'active' => true,
        ])->assertStatus(422);

        // 'comment' lives on the header text column: only text fits.
        $comment = $baseFields->map(
            fn (array $field) => $field['key'] === 'comment' ? [...$field, 'type' => 'multi_select', 'options' => ['choices' => [['value' => 'a', 'label' => 'A']]]] : $field,
        );
        $this->actingAs($this->superadmin)
            ->putJson("/api/admin/academic/evaluation-forms/{$draft['id']}/structure", ['fields' => $comment->all()])
            ->assertStatus(422);

        // A select field with no choices could never be answered.
        $attempt([
            'key' => 'ward_mood', 'section' => 'Notes', 'label' => 'Ward mood', 'helpText' => null,
            'type' => 'single_select', 'options' => ['choices' => []], 'required' => false, 'sortOrder' => 910, 'active' => true,
        ])->assertStatus(422);
    }

    public function test_admin_added_field_answers_surface_as_extra_answers(): void
    {
        // Publish v2 with an extra boolean, answer it, and check the admin
        // serializer exposes it (it enumerates only the v1 keys explicitly).
        $draft = $this->actingAs($this->superadmin)
            ->postJson('/api/admin/academic/evaluation-forms/consultant_mdt/draft')
            ->assertCreated()
            ->json();

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
            'key' => 'teaching_points_given', 'section' => 'Round quality', 'label' => 'Teaching points given',
            'helpText' => null, 'type' => 'boolean', 'options' => null, 'required' => false,
            'sortOrder' => 65, 'active' => true,
        ])->all();

        $this->actingAs($this->superadmin)
            ->putJson("/api/admin/academic/evaluation-forms/{$draft['id']}/structure", ['fields' => $fields])
            ->assertOk();
        $this->actingAs($this->superadmin)
            ->postJson("/api/admin/academic/evaluation-forms/{$draft['id']}/publish")
            ->assertOk();

        $created = $this->actingAs($this->resident)
            ->postJson('/api/academic/consultant-evaluations', [
                ...$this->validConsultantPayload(),
                'teachingPointsGiven' => true,
            ])
            ->assertCreated();

        $extras = collect($created->json('extraAnswers'));
        $this->assertTrue((bool) $extras->firstWhere('key', 'teaching_points_given')['value']);
        $this->assertSame('Teaching points given', $extras->firstWhere('key', 'teaching_points_given')['label']);
    }
}
