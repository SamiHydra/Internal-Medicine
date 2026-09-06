<?php

namespace Tests\Feature;

use App\Models\Department;
use App\Models\DutyAssignment;
use App\Models\DutyType;
use App\Models\Evaluation;
use App\Models\User;
use App\Models\Ward;
use App\Services\Academic\EvaluationFormService;
use Database\Seeders\DepartmentSeeder;
use Database\Seeders\ReportTemplateSeeder;
use Database\Seeders\RoleSeeder;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class AcademicEvaluationApiTest extends TestCase
{
    use RefreshDatabase;

    private User $resident;

    private User $consultant;

    private User $admin;

    private Department $ward;

    private Ward $teachingWard;

    protected function setUp(): void
    {
        parent::setUp();

        foreach ([RoleSeeder::class, ReportTemplateSeeder::class, DepartmentSeeder::class] as $seeder) {
            $this->seed($seeder);
        }

        $this->ward = Department::query()->where('slug', 'gi_neuro_inpatient')->firstOrFail();
        $this->teachingWard = Ward::query()->where('slug', 'gastro_neurology_ward')->firstOrFail();

        $this->resident = User::factory()->role('resident', 'Resident')->create([
            'full_name' => 'Dr. R. Bekele',
        ]);
        $this->consultant = User::factory()->role('consultant', 'Consultant')->create([
            'full_name' => 'Dr. C. Tesfaye',
        ]);
        $this->admin = User::factory()->role('admin', 'Administrator')->create();

        // Phase 3 eligibility: evaluations are gated by shared duty placement,
        // not by a static home ward. Put both actors on the GI/Neurology ward
        // service across the dates the tests submit for.
        $wardService = DutyType::query()->where('slug', 'gastroenterology_ward_service')->firstOrFail();

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

    public function test_resident_can_submit_a_consultant_evaluation_and_score_is_computed(): void
    {
        $payload = [
            'evaluationDate' => now()->subDays(3)->toDateString(),
            'wardId' => $this->ward->id,
            'subjectId' => $this->consultant->id,
            'seniorPresent' => true,
            'seniorJoinedAt' => '08:15',
            'presenceMinutes' => 45,
            'allPatientsReviewed' => true,
            'mgmtPlanDocumented' => true,
            'vteAssessed' => true,
            'dischargeDiscussed' => false,
            'medReviewDone' => true,
            'criticalLabsReviewed' => true,
            'pctPatientsSeen' => 80,
            'roundDelayed' => false,
            'overallRating' => 4,
            'mdtParticipants' => ['consultant', 'residents', 'nurse'],
            'systemIssues' => ['lab_delay'],
            'comment' => null,
        ];

        $this->actingAs($this->resident)
            ->postJson('/api/academic/consultant-evaluations', $payload)
            ->assertCreated()
            ->assertJsonPath('subjectId', $this->consultant->id)
            ->assertJsonPath('authorId', $this->resident->id)
            ->assertJsonPath('wardName', $this->teachingWard->name)
            ->assertJsonPath('seniorJoinedAt', '08:15')
            ->assertJsonPath('qualityScore', 83.3);

        $this->assertDatabaseHas('evaluations', [
            'form_key' => 'consultant_mdt',
            'author_id' => $this->resident->id,
            'subject_user_id' => $this->consultant->id,
            'ward_id' => $this->teachingWard->id,
        ]);
    }

    public function test_one_author_evaluates_one_subject_once_per_date_and_form(): void
    {
        $payload = [
            'evaluationDate' => now()->subDays(3)->toDateString(),
            'subjectId' => $this->consultant->id,
            'seniorPresent' => true,
            'presenceMinutes' => 45,
            'allPatientsReviewed' => true,
            'mgmtPlanDocumented' => true,
            'vteAssessed' => true,
            'dischargeDiscussed' => true,
            'medReviewDone' => true,
            'criticalLabsReviewed' => true,
            'pctPatientsSeen' => 80,
            'roundDelayed' => false,
            'overallRating' => 4,
        ];

        $this->actingAs($this->resident)
            ->postJson('/api/academic/consultant-evaluations', $payload)
            ->assertCreated();

        // Every analytics aggregate is a per-row mean, so a repeat is an
        // extra vote on this consultant's record, not a harmless duplicate.
        $this->actingAs($this->resident)
            ->postJson('/api/academic/consultant-evaluations', $payload)
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['subjectId']);

        $this->assertSame(1, Evaluation::query()
            ->where('author_id', $this->resident->id)
            ->where('subject_user_id', $this->consultant->id)
            ->count());

        $this->actingAs($this->admin)
            ->getJson('/api/academic/analytics/summary?direction=consultant&subjectId='.$this->consultant->id)
            ->assertOk()
            ->assertJsonPath('evaluationCount', 1);

        // Another date is a different round and stays legal.
        $this->actingAs($this->resident)
            ->postJson('/api/academic/consultant-evaluations', [
                ...$payload,
                'evaluationDate' => now()->subDays(4)->toDateString(),
            ])
            ->assertCreated();
    }

    public function test_the_database_refuses_a_duplicate_evaluation_even_without_the_controller(): void
    {
        $first = $this->createConsultantEvaluation();

        $this->expectException(QueryException::class);

        Evaluation::query()->create([
            'form_id' => $first->form_id,
            'form_key' => $first->form_key,
            'author_id' => $first->author_id,
            'subject_user_id' => $first->subject_user_id,
            'evaluation_date' => $first->evaluation_date,
            'ward_id' => $first->ward_id,
            'placement_type' => $first->placement_type,
        ]);
    }

    public function test_consultant_cannot_submit_a_consultant_evaluation_wrong_direction(): void
    {
        $payload = [
            'evaluationDate' => now()->subDays(1)->toDateString(),
            'wardId' => $this->ward->id,
            'subjectId' => $this->consultant->id,
            'seniorPresent' => true,
            'allPatientsReviewed' => true,
            'mgmtPlanDocumented' => true,
            'vteAssessed' => true,
            'dischargeDiscussed' => true,
            'medReviewDone' => true,
            'criticalLabsReviewed' => true,
            'roundDelayed' => false,
        ];

        $this->actingAs($this->consultant)
            ->postJson('/api/academic/consultant-evaluations', $payload)
            ->assertStatus(422);

        $this->assertDatabaseCount('consultant_evaluations', 0);
    }

    public function test_consultant_can_submit_a_resident_evaluation_but_resident_cannot(): void
    {
        $payload = [
            'evaluation_date' => now()->subDays(2)->toDateString(),
            'ward_id' => $this->ward->id,
            'subject_id' => $this->resident->id,
            'on_time' => true,
            'prepared' => true,
            'presentation_clear' => true,
            'clinical_reasoning' => true,
            'management_plan' => true,
            'documentation_timely' => true,
            'communication' => true,
            'professional' => true,
            'responsive_feedback' => false,
            'follow_through' => false,
            'overall_rating' => 4,
            'concerns' => ['documentation', 'time_management'],
            'comment' => 'Strong week overall.',
        ];

        $this->actingAs($this->consultant)
            ->postJson('/api/academic/resident-evaluations', $payload)
            ->assertCreated()
            ->assertJsonPath('subjectId', $this->resident->id)
            ->assertJsonPath('overallRating', 4)
            // 8 of 10 items true; whole-number scores serialize as a JSON integer.
            ->assertJsonPath('performanceScore', 80);

        // The resident is not allowed to file a resident evaluation.
        $this->actingAs($this->resident)
            ->postJson('/api/academic/resident-evaluations', $payload)
            ->assertStatus(422);

        $this->assertSame(1, Evaluation::query()->forKey('resident_acgme')->count());
    }

    public function test_admin_can_read_academic_summary_but_resident_cannot(): void
    {
        $this->createConsultantEvaluation([
            'all_patients_reviewed' => true,
            'mgmt_plan_documented' => true,
            'vte_assessed' => true,
            'discharge_discussed' => true,
            'med_review_done' => true,
            'critical_labs_reviewed' => true,
        ]);

        $this->actingAs($this->admin)
            ->getJson('/api/academic/analytics/summary?direction=consultant')
            ->assertOk()
            ->assertJsonPath('direction', 'consultant')
            ->assertJsonPath('evaluationCount', 1)
            ->assertJsonPath('averageScore', 100);

        $this->actingAs($this->resident)
            ->getJson('/api/academic/analytics/summary?direction=consultant')
            ->assertForbidden();
    }

    public function test_form_options_returns_only_paired_opposite_role_users(): void
    {
        // A consultant on a DIFFERENT ward must not appear as a subject.
        $elsewhere = User::factory()->role('consultant', 'Consultant')->create();
        DutyAssignment::query()->create([
            'user_id' => $elsewhere->id,
            'duty_type_id' => DutyType::query()->where('slug', 'pulmonology_ward_service')->firstOrFail()->id,
            'starts_on' => now()->subDays(20)->toDateString(),
            'ends_on' => now()->addDays(20)->toDateString(),
            'source' => 'admin',
            'created_by' => $this->admin->id,
        ]);

        // A resident requesting form options sees only the ward-mates, plus
        // their own current placement as form context.
        $this->actingAs($this->resident)
            ->getJson('/api/academic/form-options')
            ->assertOk()
            ->assertJsonPath('subjects.0.id', $this->consultant->id)
            ->assertJsonPath('subjects.0.fullName', $this->consultant->full_name)
            ->assertJsonCount(1, 'subjects')
            ->assertJsonPath('currentPlacement.dutyTypeName', 'Gastroenterology Ward Service')
            ->assertJsonPath('currentPlacement.wardName', 'Gastroenterology/Neurology Ward');

        // A consultant sees residents as subjects.
        $this->actingAs($this->consultant)
            ->getJson('/api/academic/form-options')
            ->assertOk()
            ->assertJsonPath('subjects.0.id', $this->resident->id)
            ->assertJsonCount(1, 'subjects');
    }

    public function test_admin_can_list_academic_evaluations_paginated(): void
    {
        $this->createConsultantEvaluation(['vte_assessed' => true]);

        $this->actingAs($this->admin)
            ->getJson('/api/admin/academic/evaluations?direction=consultant')
            ->assertOk()
            ->assertJsonPath('direction', 'consultant')
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('meta.total', 1)
            ->assertJsonPath('meta.perPage', 25)
            ->assertJsonPath('data.0.subjectId', $this->consultant->id);

        $this->actingAs($this->admin)
            ->getJson('/api/admin/academic/evaluations?perPage=101')
            ->assertUnprocessable()
            ->assertJsonValidationErrors('perPage');

        $this->actingAs($this->resident)
            ->getJson('/api/admin/academic/evaluations?direction=consultant')
            ->assertForbidden();
    }

    public function test_admin_academic_audit_merges_both_directions_newest_first(): void
    {
        // Consultant evaluates the resident (resident is the subject), filed earlier.
        $this->travelTo(now()->subMinutes(5));
        $this->createResidentEvaluation([
            'on_time' => true,
            'prepared' => true,
            'overall_rating' => 4,
        ]);
        $this->travelBack();

        // Resident evaluates the consultant (consultant is the subject), filed now.
        $this->createConsultantEvaluation([
            'all_patients_reviewed' => true,
            'vte_assessed' => true,
        ]);

        $this->actingAs($this->admin)
            ->getJson('/api/admin/academic/audit')
            ->assertOk()
            ->assertJsonCount(2, 'data')
            // Newest first: the consultant evaluation was filed most recently.
            ->assertJsonPath('data.0.direction', 'consultant')
            ->assertJsonPath('data.0.authorName', $this->resident->full_name)
            ->assertJsonPath('data.0.subjectName', $this->consultant->full_name)
            ->assertJsonPath('data.0.wardName', $this->teachingWard->name)
            ->assertJsonPath('data.0.overallRating', null)
            ->assertJsonPath('data.1.direction', 'resident')
            ->assertJsonPath('data.1.overallRating', 4);

        // The direction filter narrows to a single table.
        $this->actingAs($this->admin)
            ->getJson('/api/admin/academic/audit?direction=resident')
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.direction', 'resident');

        // Non-admins cannot read the academic audit trail.
        $this->actingAs($this->resident)
            ->getJson('/api/admin/academic/audit')
            ->assertForbidden();
    }

    public function test_people_and_trend_endpoints_return_aggregates(): void
    {
        $this->createConsultantEvaluation([
            'all_patients_reviewed' => true,
            'vte_assessed' => true,
        ]);

        $this->actingAs($this->admin)
            ->getJson('/api/academic/analytics/people?direction=consultant')
            ->assertOk()
            ->assertJsonPath('ratingWeight', 0.5)
            ->assertJsonPath('people.0.subjectId', $this->consultant->id)
            ->assertJsonPath('people.0.evaluationCount', 1)
            // This row is a legacy-style, unrated evaluation (2 of 6 items
            // true): the combined rank degrades to the score, not a phantom 0,
            // and the single evaluation is flagged provisional.
            ->assertJsonPath('people.0.averageScore', 33.3)
            ->assertJsonPath('people.0.ratingAverage', null)
            ->assertJsonPath('people.0.ratedCount', 0)
            ->assertJsonPath('people.0.combinedScore', 33.3)
            ->assertJsonPath('people.0.provisional', true);

        $this->actingAs($this->admin)
            ->getJson('/api/academic/analytics/trend?direction=consultant&granularity=weekly')
            ->assertOk()
            ->assertJsonPath('granularity', 'weekly')
            ->assertJsonCount(1, 'points');
    }

    public function test_snapshot_endpoint_returns_all_dashboard_views_and_preserves_authorization(): void
    {
        $this->createConsultantEvaluation([
            'all_patients_reviewed' => true,
            'vte_assessed' => true,
        ]);

        $this->actingAs($this->admin)
            ->getJson('/api/academic/analytics/snapshot?direction=consultant&granularity=weekly')
            ->assertOk()
            ->assertJsonPath('summary.evaluationCount', 1)
            ->assertJsonPath('trend.granularity', 'weekly')
            ->assertJsonCount(1, 'trend.points')
            ->assertJsonPath('people.people.0.subjectId', $this->consultant->id);

        $this->actingAs($this->resident)
            ->getJson('/api/academic/analytics/snapshot?direction=consultant')
            ->assertForbidden();
    }

    public function test_people_endpoint_blends_rating_and_score_into_combined_rank(): void
    {
        // All six indicators true -> score 100%. A 1-to-5 rating of 3
        // normalises to 60% (3 / 5 * 100). Equal weight -> combined 80%.
        $this->createConsultantEvaluation([
            'all_patients_reviewed' => true,
            'mgmt_plan_documented' => true,
            'vte_assessed' => true,
            'discharge_discussed' => true,
            'med_review_done' => true,
            'critical_labs_reviewed' => true,
            'overall_rating' => 3,
        ]);

        $this->actingAs($this->admin)
            ->getJson('/api/academic/analytics/people?direction=consultant')
            ->assertOk()
            ->assertJsonPath('people.0.averageScore', 100)
            ->assertJsonPath('people.0.ratingAverage', 3)
            ->assertJsonPath('people.0.ratingScore', 60)
            ->assertJsonPath('people.0.ratedCount', 1)
            ->assertJsonPath('people.0.combinedScore', 80);
    }

    public function test_my_performance_returns_only_the_authenticated_users_received_scores(): void
    {
        // The consultant evaluates the resident: the resident is the SUBJECT here.
        $this->createResidentEvaluation([
            'on_time' => true,
            'prepared' => true,
            'presentation_clear' => true,
            'clinical_reasoning' => true,
            'management_plan' => true,
            'documentation_timely' => true,
            'communication' => true,
            'professional' => true,
            'responsive_feedback' => true,
            'follow_through' => true,
            'overall_rating' => 5,
        ]);

        // A consultant evaluation (resident is the AUTHOR, consultant the subject)
        // must NOT leak into the resident's own performance.
        $this->createConsultantEvaluation(['vte_assessed' => true]);

        $this->actingAs($this->resident)
            ->getJson('/api/academic/my-performance')
            ->assertOk()
            ->assertJsonPath('direction', 'resident')
            ->assertJsonPath('summary.evaluationCount', 1)
            ->assertJsonPath('summary.averageScore', 100)
            ->assertJsonPath('summary.avgOverallRating', 5);

        // The consultant sees their own received (ConsultantEvaluation) scores.
        $this->actingAs($this->consultant)
            ->getJson('/api/academic/my-performance')
            ->assertOk()
            ->assertJsonPath('direction', 'consultant')
            ->assertJsonPath('summary.evaluationCount', 1);

        // An admin has no academic.submit permission, so the self endpoint is closed.
        $this->actingAs($this->admin)
            ->getJson('/api/academic/my-performance')
            ->assertForbidden();
    }

    /**
     * Store a consultant_mdt evaluation through the form engine (resident
     * evaluates consultant), merging the given answer overrides.
     *
     * @param  array<string, mixed>  $overrides
     */
    private function createConsultantEvaluation(array $overrides = []): Evaluation
    {
        $forms = app(EvaluationFormService::class);

        return $forms->store($forms->published('consultant_mdt'), array_merge([
            'senior_present' => true,
            'presence_minutes' => 40,
            'all_patients_reviewed' => false,
            'mgmt_plan_documented' => false,
            'vte_assessed' => false,
            'discharge_discussed' => false,
            'med_review_done' => false,
            'critical_labs_reviewed' => false,
            'pct_patients_seen' => 75,
            'round_delayed' => false,
            'mdt_participants' => ['consultant'],
            'system_issues' => ['lab_delay'],
        ], $overrides), [
            'author_id' => $this->resident->id,
            'subject_user_id' => $this->consultant->id,
            'evaluation_date' => now()->subDays(4)->toDateString(),
            'ward_id' => $this->teachingWard->id,
            'placement_type' => 'ward',
        ]);
    }

    /**
     * Store a resident_acgme evaluation through the form engine (consultant
     * evaluates resident), merging the given answer overrides.
     *
     * @param  array<string, mixed>  $overrides
     */
    private function createResidentEvaluation(array $overrides = []): Evaluation
    {
        $forms = app(EvaluationFormService::class);

        return $forms->store($forms->published('resident_acgme'), array_merge([
            'on_time' => false,
            'prepared' => false,
            'presentation_clear' => false,
            'clinical_reasoning' => false,
            'management_plan' => false,
            'documentation_timely' => false,
            'communication' => false,
            'professional' => false,
            'responsive_feedback' => false,
            'follow_through' => false,
            'overall_rating' => 3,
        ], $overrides), [
            'author_id' => $this->consultant->id,
            'subject_user_id' => $this->resident->id,
            'evaluation_date' => now()->subDays(4)->toDateString(),
            'ward_id' => $this->teachingWard->id,
            'placement_type' => 'ward',
        ]);
    }
}
