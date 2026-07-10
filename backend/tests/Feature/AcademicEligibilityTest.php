<?php

namespace Tests\Feature;

use App\Models\ConsultantEvaluation;
use App\Models\Department;
use App\Models\DutyAssignment;
use App\Models\DutyType;
use App\Models\User;
use Database\Seeders\DepartmentSeeder;
use Database\Seeders\ReportTemplateSeeder;
use Database\Seeders\RoleSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Tests\TestCase;

/**
 * Phase 3: evaluations are scoped to who actually works together. The pairing
 * rule, snapshotting, back-dating, and external (paper) entry.
 */
class AcademicEligibilityTest extends TestCase
{
    use RefreshDatabase;

    private User $admin;

    protected function setUp(): void
    {
        parent::setUp();

        foreach ([RoleSeeder::class, ReportTemplateSeeder::class, DepartmentSeeder::class] as $seeder) {
            $this->seed($seeder);
        }

        $this->travelTo(Carbon::parse('2026-08-15 10:00:00'));
        $this->admin = User::factory()->role('admin', 'Administrator')->create();
    }

    protected function tearDown(): void
    {
        $this->travelBack();

        parent::tearDown();
    }

    private function assign(User $user, string $dutyTypeSlug, string $from, string $to): DutyAssignment
    {
        return DutyAssignment::query()->create([
            'user_id' => $user->id,
            'duty_type_id' => DutyType::query()->where('slug', $dutyTypeSlug)->firstOrFail()->id,
            'starts_on' => $from,
            'ends_on' => $to,
            'source' => 'admin',
            'created_by' => $this->admin->id,
        ]);
    }

    /**
     * A minimal valid consultant-evaluation payload (resident evaluates consultant).
     *
     * @return array<string, mixed>
     */
    private function consultantPayload(User $subject, string $date): array
    {
        return [
            'evaluationDate' => $date,
            'subjectId' => $subject->id,
            'seniorPresent' => true,
            'allPatientsReviewed' => true,
            'mgmtPlanDocumented' => true,
            'vteAssessed' => true,
            'dischargeDiscussed' => true,
            'medReviewDone' => true,
            'criticalLabsReviewed' => true,
            'roundDelayed' => false,
        ];
    }

    public function test_a_resident_cannot_evaluate_a_consultant_on_another_ward(): void
    {
        $resident = User::factory()->role('resident', 'Resident')->create();
        $consultant = User::factory()->role('consultant', 'Consultant')->create();

        $this->assign($resident, 'nephrology_ward_service', '2026-08-01', '2026-08-31');
        $this->assign($consultant, 'pulmonology_ward_service', '2026-08-01', '2026-08-31');

        $this->actingAs($resident)
            ->postJson('/api/academic/consultant-evaluations', $this->consultantPayload($consultant, '2026-08-14'))
            ->assertStatus(422)
            ->assertJsonValidationErrors(['subjectId']);

        $this->assertDatabaseCount('consultant_evaluations', 0);
    }

    public function test_an_opd_resident_can_evaluate_the_opd_consultant_with_an_opd_snapshot(): void
    {
        $resident = User::factory()->role('resident', 'Resident')->create();
        $consultant = User::factory()->role('consultant', 'Consultant')->create();

        $this->assign($resident, 'opd', '2026-08-01', '2026-08-31');
        $this->assign($consultant, 'opd', '2026-08-01', '2026-08-31');

        $this->actingAs($resident)
            ->postJson('/api/academic/consultant-evaluations', $this->consultantPayload($consultant, '2026-08-14'))
            ->assertCreated()
            ->assertJsonPath('placementType', 'opd')
            ->assertJsonPath('wardId', null);
    }

    public function test_transition_duty_pairs_only_on_shared_days_for_evaluations(): void
    {
        $resident = User::factory()->role('resident', 'Resident')->create();
        $consultant = User::factory()->role('consultant', 'Consultant')->create();

        $this->assign($resident, 'transition_ward_duty', '2026-08-14', '2026-08-14');
        $this->assign($consultant, 'transition_ward_duty', '2026-08-14', '2026-08-14');
        $this->assign($consultant, 'transition_ward_duty', '2026-08-13', '2026-08-13');

        $this->actingAs($resident)
            ->postJson('/api/academic/consultant-evaluations', $this->consultantPayload($consultant, '2026-08-13'))
            ->assertStatus(422);

        $this->actingAs($resident)
            ->postJson('/api/academic/consultant-evaluations', $this->consultantPayload($consultant, '2026-08-14'))
            ->assertCreated()
            ->assertJsonPath('placementType', 'transition');
    }

    public function test_a_consultant_on_dialysis_has_no_peers_and_the_form_says_so(): void
    {
        $consultant = User::factory()->role('consultant', 'Consultant')->create();
        $resident = User::factory()->role('resident', 'Resident')->create();

        $this->assign($consultant, 'dialysis', '2026-08-01', '2026-08-31');
        $this->assign($resident, 'nephrology_ward_service', '2026-08-01', '2026-08-31');

        $this->actingAs($consultant)
            ->getJson('/api/academic/form-options')
            ->assertOk()
            ->assertJsonCount(0, 'subjects')
            ->assertJsonPath('currentPlacement.dutyTypeName', 'Dialysis');
    }

    public function test_back_dating_returns_that_rotations_peers_not_todays(): void
    {
        $resident = User::factory()->role('resident', 'Resident')->create();
        $julyConsultant = User::factory()->role('consultant', 'Consultant')->create();
        $augustConsultant = User::factory()->role('consultant', 'Consultant')->create();

        // July: nephrology. August: pulmonology. The consultants never move.
        $this->assign($resident, 'nephrology_ward_service', '2026-07-01', '2026-07-31');
        $this->assign($resident, 'pulmonology_ward_service', '2026-08-01', '2026-08-31');
        $this->assign($julyConsultant, 'nephrology_ward_service', '2026-07-01', '2026-08-31');
        $this->assign($augustConsultant, 'pulmonology_ward_service', '2026-07-01', '2026-08-31');

        $this->actingAs($resident)
            ->getJson('/api/academic/form-options?date=2026-07-15')
            ->assertOk()
            ->assertJsonCount(1, 'subjects')
            ->assertJsonPath('subjects.0.id', $julyConsultant->id);

        $this->actingAs($resident)
            ->getJson('/api/academic/form-options')
            ->assertOk()
            ->assertJsonCount(1, 'subjects')
            ->assertJsonPath('subjects.0.id', $augustConsultant->id);

        // Future dates are rejected outright.
        $this->actingAs($resident)
            ->getJson('/api/academic/form-options?date=2026-09-01')
            ->assertStatus(422);

        // A back-dated submission pairs against the July rotation.
        $this->actingAs($resident)
            ->postJson('/api/academic/consultant-evaluations', $this->consultantPayload($julyConsultant, '2026-07-15'))
            ->assertCreated();

        // ...but the same subject is not reachable for an August date.
        $this->actingAs($resident)
            ->postJson('/api/academic/consultant-evaluations', $this->consultantPayload($julyConsultant, '2026-08-14'))
            ->assertStatus(422);
    }

    public function test_a_stored_evaluation_keeps_its_ward_after_the_author_rotates(): void
    {
        $resident = User::factory()->role('resident', 'Resident')->create();
        $consultant = User::factory()->role('consultant', 'Consultant')->create();

        $this->assign($resident, 'nephrology_ward_service', '2026-08-01', '2026-08-31');
        $this->assign($consultant, 'nephrology_ward_service', '2026-08-01', '2026-08-31');

        $nephrologyDepartment = Department::query()->where('slug', 'nephrology_inpatient')->firstOrFail();

        $evaluationId = $this->actingAs($resident)
            ->postJson('/api/academic/consultant-evaluations', $this->consultantPayload($consultant, '2026-08-14'))
            ->assertCreated()
            ->assertJsonPath('wardName', $nephrologyDepartment->name)
            ->json('id');

        // September: the resident rotates to pulmonology. The August evaluation
        // must keep displaying its original nephrology placement (snapshot,
        // never recomputed).
        $this->assign($resident, 'pulmonology_ward_service', '2026-09-01', '2026-09-30');
        $this->travelTo(Carbon::parse('2026-09-10 10:00:00'));

        $submissions = $this->actingAs($resident)
            ->getJson('/api/academic/my-submissions')
            ->assertOk()
            ->json('data');

        $stored = collect($submissions)->firstWhere('id', $evaluationId);
        $this->assertSame($nephrologyDepartment->name, $stored['wardName']);

        $evaluation = ConsultantEvaluation::query()->findOrFail($evaluationId);
        $this->assertSame('ward', $evaluation->placement_type);
        $this->assertNotNull($evaluation->ward_ref_id);
    }

    public function test_the_client_supplied_ward_is_ignored_in_favor_of_the_server_snapshot(): void
    {
        $resident = User::factory()->role('resident', 'Resident')->create();
        $consultant = User::factory()->role('consultant', 'Consultant')->create();

        $this->assign($resident, 'oncology_ward_service', '2026-08-01', '2026-08-31');
        $this->assign($consultant, 'oncology_ward_service', '2026-08-01', '2026-08-31');

        $bogusWard = Department::query()->where('slug', 'chest_inpatient')->firstOrFail();

        $response = $this->actingAs($resident)
            ->postJson('/api/academic/consultant-evaluations', [
                ...$this->consultantPayload($consultant, '2026-08-14'),
                'wardId' => $bogusWard->id,
            ])
            ->assertCreated();

        // Hematology and Oncology share one physical ward; the snapshot resolves
        // to that ward, never to the client's claim.
        $this->assertNotSame($bogusWard->id, $response->json('wardId'));
        $this->assertSame('Hematology/Oncology Ward', ConsultantEvaluation::query()->findOrFail($response->json('id'))->wardRef?->name);
    }

    // ---- External (paper) evaluations ----

    /**
     * @return array<string, mixed>
     */
    private function externalPayload(User $subject): array
    {
        return [
            'subjectId' => $subject->id,
            'evaluationDate' => '2026-08-10',
            'placement' => 'icu',
            'evaluatorName' => 'Dr. Host Physician',
            'evaluatorDepartment' => 'Critical Care',
            'onTime' => true,
            'prepared' => true,
            'presentationClear' => true,
            'clinicalReasoning' => true,
            'managementPlan' => true,
            'documentationTimely' => true,
            'communication' => true,
            'professional' => true,
            'responsiveFeedback' => true,
            'followThrough' => true,
            'overallRating' => 4,
        ];
    }

    public function test_admin_records_an_external_evaluation_with_no_author_account(): void
    {
        $resident = User::factory()->role('resident', 'Resident')->create();
        $this->assign($resident, 'icu', '2026-08-01', '2026-08-31');

        $response = $this->actingAs($this->admin)
            ->postJson('/api/admin/academic/external-evaluations', $this->externalPayload($resident))
            ->assertCreated()
            ->assertJsonPath('authorId', null)
            ->assertJsonPath('external', true)
            ->assertJsonPath('authorName', 'Dr. Host Physician')
            ->assertJsonPath('placementType', 'icu');

        $this->assertDatabaseHas('resident_evaluations', [
            'id' => $response->json('id'),
            'author_id' => null,
            'entered_by_id' => $this->admin->id,
            'placement_type' => 'icu',
        ]);

        $this->assertDatabaseHas('admin_audit_logs', [
            'entity_type' => 'resident_evaluation',
            'action' => 'create_external',
        ]);

        // The row feeds the resident's own performance like any other.
        $this->actingAs($resident)
            ->getJson('/api/academic/my-performance')
            ->assertOk()
            ->assertJsonPath('summary.evaluationCount', 1);
    }

    public function test_external_entry_requires_an_evaluator_name_and_rejects_an_author_id(): void
    {
        $resident = User::factory()->role('resident', 'Resident')->create();

        $this->actingAs($this->admin)
            ->postJson('/api/admin/academic/external-evaluations', [
                ...$this->externalPayload($resident),
                'evaluatorName' => '',
            ])
            ->assertStatus(422)
            ->assertJsonValidationErrors(['evaluatorName']);

        $this->actingAs($this->admin)
            ->postJson('/api/admin/academic/external-evaluations', [
                ...$this->externalPayload($resident),
                'authorId' => $this->admin->id,
            ])
            ->assertStatus(422)
            ->assertJsonValidationErrors(['authorId']);

        // Non-admin roles cannot reach the endpoint at all.
        $consultant = User::factory()->role('consultant', 'Consultant')->create();
        $this->actingAs($consultant)
            ->postJson('/api/admin/academic/external-evaluations', $this->externalPayload($resident))
            ->assertForbidden();

        $this->assertDatabaseCount('resident_evaluations', 0);
    }
}
