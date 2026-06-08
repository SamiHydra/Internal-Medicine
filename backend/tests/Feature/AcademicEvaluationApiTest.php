<?php

namespace Tests\Feature;

use App\Models\ConsultantEvaluation;
use App\Models\Department;
use App\Models\ResidentEvaluation;
use App\Models\User;
use Database\Seeders\DepartmentSeeder;
use Database\Seeders\ReportTemplateSeeder;
use Database\Seeders\RoleSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class AcademicEvaluationApiTest extends TestCase
{
    use RefreshDatabase;

    private User $resident;

    private User $consultant;

    private User $admin;

    private Department $ward;

    protected function setUp(): void
    {
        parent::setUp();

        foreach ([RoleSeeder::class, ReportTemplateSeeder::class, DepartmentSeeder::class] as $seeder) {
            $this->seed($seeder);
        }

        $this->ward = Department::query()->where('slug', 'gi_neuro_inpatient')->firstOrFail();

        $this->resident = User::factory()->role('resident', 'Resident')->create([
            'full_name' => 'Dr. R. Bekele',
            'home_ward_id' => $this->ward->id,
        ]);
        $this->consultant = User::factory()->role('consultant', 'Consultant')->create([
            'full_name' => 'Dr. C. Tesfaye',
            'home_ward_id' => $this->ward->id,
        ]);
        $this->admin = User::factory()->role('admin', 'Administrator')->create();
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
            'mdtParticipants' => ['consultant', 'residents', 'nurse'],
            'systemIssues' => ['lab_delay'],
            'comment' => null,
        ];

        $this->actingAs($this->resident)
            ->postJson('/api/academic/consultant-evaluations', $payload)
            ->assertCreated()
            ->assertJsonPath('subjectId', $this->consultant->id)
            ->assertJsonPath('authorId', $this->resident->id)
            ->assertJsonPath('wardName', $this->ward->name)
            ->assertJsonPath('seniorJoinedAt', '08:15')
            ->assertJsonPath('qualityScore', 83.3);

        $this->assertDatabaseHas('consultant_evaluations', [
            'author_id' => $this->resident->id,
            'subject_id' => $this->consultant->id,
            'ward_id' => $this->ward->id,
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

        $this->assertDatabaseCount('resident_evaluations', 1);
    }

    public function test_admin_can_read_academic_summary_but_resident_cannot(): void
    {
        ConsultantEvaluation::query()->create($this->consultantRow([
            'all_patients_reviewed' => true,
            'mgmt_plan_documented' => true,
            'vte_assessed' => true,
            'discharge_discussed' => true,
            'med_review_done' => true,
            'critical_labs_reviewed' => true,
        ]));

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

    public function test_form_options_returns_the_opposite_role_users(): void
    {
        // A resident requesting form options sees consultants as subjects.
        $this->actingAs($this->resident)
            ->getJson('/api/academic/form-options')
            ->assertOk()
            ->assertJsonPath('subjects.0.id', $this->consultant->id)
            ->assertJsonPath('subjects.0.fullName', $this->consultant->full_name)
            ->assertJsonCount(1, 'subjects')
            ->assertJsonPath('subjects.0.homeWardName', $this->ward->name);

        // A consultant sees residents as subjects.
        $this->actingAs($this->consultant)
            ->getJson('/api/academic/form-options')
            ->assertOk()
            ->assertJsonPath('subjects.0.id', $this->resident->id)
            ->assertJsonCount(1, 'subjects');
    }

    public function test_admin_can_list_academic_evaluations_paginated(): void
    {
        ConsultantEvaluation::query()->create($this->consultantRow(['vte_assessed' => true]));

        $this->actingAs($this->admin)
            ->getJson('/api/admin/academic/evaluations?direction=consultant')
            ->assertOk()
            ->assertJsonPath('direction', 'consultant')
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('meta.total', 1)
            ->assertJsonPath('data.0.subjectId', $this->consultant->id);

        $this->actingAs($this->resident)
            ->getJson('/api/admin/academic/evaluations?direction=consultant')
            ->assertForbidden();
    }

    public function test_admin_academic_audit_merges_both_directions_newest_first(): void
    {
        // Consultant evaluates the resident (resident is the subject), filed earlier.
        $this->travelTo(now()->subMinutes(5));
        ResidentEvaluation::query()->create($this->residentRow([
            'on_time' => true,
            'prepared' => true,
            'overall_rating' => 4,
        ]));
        $this->travelBack();

        // Resident evaluates the consultant (consultant is the subject), filed now.
        ConsultantEvaluation::query()->create($this->consultantRow([
            'all_patients_reviewed' => true,
            'vte_assessed' => true,
        ]));

        $this->actingAs($this->admin)
            ->getJson('/api/admin/academic/audit')
            ->assertOk()
            ->assertJsonCount(2, 'data')
            // Newest first: the consultant evaluation was filed most recently.
            ->assertJsonPath('data.0.direction', 'consultant')
            ->assertJsonPath('data.0.authorName', $this->resident->full_name)
            ->assertJsonPath('data.0.subjectName', $this->consultant->full_name)
            ->assertJsonPath('data.0.wardName', $this->ward->name)
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
        ConsultantEvaluation::query()->create($this->consultantRow([
            'all_patients_reviewed' => true,
            'vte_assessed' => true,
        ]));

        $this->actingAs($this->admin)
            ->getJson('/api/academic/analytics/people?direction=consultant')
            ->assertOk()
            ->assertJsonPath('people.0.subjectId', $this->consultant->id)
            ->assertJsonPath('people.0.evaluationCount', 1);

        $this->actingAs($this->admin)
            ->getJson('/api/academic/analytics/trend?direction=consultant&granularity=weekly')
            ->assertOk()
            ->assertJsonPath('granularity', 'weekly')
            ->assertJsonCount(1, 'points');
    }

    public function test_my_performance_returns_only_the_authenticated_users_received_scores(): void
    {
        // The consultant evaluates the resident: the resident is the SUBJECT here.
        ResidentEvaluation::query()->create($this->residentRow([
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
        ]));

        // A consultant evaluation (resident is the AUTHOR, consultant the subject)
        // must NOT leak into the resident's own performance.
        ConsultantEvaluation::query()->create($this->consultantRow(['vte_assessed' => true]));

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
     * Build a consultant_evaluations row, merging the given boolean overrides.
     *
     * @param  array<string, mixed>  $overrides
     * @return array<string, mixed>
     */
    private function consultantRow(array $overrides = []): array
    {
        return array_merge([
            'author_id' => $this->resident->id,
            'subject_id' => $this->consultant->id,
            'ward_id' => $this->ward->id,
            'evaluation_date' => now()->subDays(4)->toDateString(),
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
        ], $overrides);
    }

    /**
     * Build a resident_evaluations row (consultant evaluates resident), merging
     * the given overrides. The resident is the subject.
     *
     * @param  array<string, mixed>  $overrides
     * @return array<string, mixed>
     */
    private function residentRow(array $overrides = []): array
    {
        return array_merge([
            'author_id' => $this->consultant->id,
            'subject_id' => $this->resident->id,
            'ward_id' => $this->ward->id,
            'evaluation_date' => now()->subDays(4)->toDateString(),
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
            'concerns' => [],
        ], $overrides);
    }
}
