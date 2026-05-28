<?php

namespace Tests\Feature;

use App\Models\Department;
use App\Models\ReportAssignment;
use App\Models\ReportingPeriod;
use App\Models\User;
use Database\Seeders\DepartmentSeeder;
use Database\Seeders\ReportFieldDefinitionSeeder;
use Database\Seeders\ReportTemplateSeeder;
use Database\Seeders\RoleSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class AnalyticsTest extends TestCase
{
    use RefreshDatabase;

    private User $admin;

    private User $nurse;

    private ReportingPeriod $period;

    protected function setUp(): void
    {
        parent::setUp();

        foreach ([RoleSeeder::class, ReportTemplateSeeder::class, DepartmentSeeder::class, ReportFieldDefinitionSeeder::class] as $seeder) {
            $this->seed($seeder);
        }

        $this->admin = User::factory()->role('admin', 'Administrator')->create();
        $this->nurse = User::factory()->create();
        $this->period = ReportingPeriod::query()->create([
            'week_start' => '2026-05-25',
            'week_end' => '2026-05-31',
            'deadline_at' => '2026-06-01 10:00:00',
            'month_label' => 'May 2026',
            'quarter_label' => 'Q2 2026',
            'year_num' => 2026,
        ]);
    }

    public function test_admin_can_read_overview_analytics_and_trends(): void
    {
        $this->createSampleReports();

        $response = $this->actingAs($this->admin)
            ->getJson("/api/analytics/overview?period_id={$this->period->id}");

        $response
            ->assertOk()
            ->assertJsonPath('summary.totalReports', 3)
            ->assertJsonPath('summary.expectedReports', 3)
            ->assertJsonPath('summary.missingReports', 0)
            ->assertJsonPath('summary.statusCounts.submitted', 3)
            ->assertJsonPath('summary.totals.totalAdmissions', 12)
            ->assertJsonPath('summary.totals.totalDischarges', 3)
            ->assertJsonPath('summary.totals.totalOutpatientVisits', 40)
            ->assertJsonPath('summary.totals.noShowCount', 3)
            ->assertJsonPath('summary.totals.haiCount', 2)
            ->assertJsonPath('summary.totals.procedureThroughput', 10);

        $response->assertJsonCount(1, 'weekly');
        $response->assertJsonCount(1, 'monthly');
    }

    public function test_nurses_cannot_read_analytics(): void
    {
        $this->actingAs($this->nurse)
            ->getJson('/api/analytics/overview')
            ->assertForbidden();
    }

    public function test_inpatient_analytics_can_scope_occupancy_to_a_ward(): void
    {
        $this->createSampleReports();

        $response = $this->actingAs($this->admin)
            ->getJson("/api/analytics/inpatient?period_id={$this->period->id}&department=gi_neuro_inpatient")
            ->assertOk()
            ->assertJsonPath('scope.family', 'inpatient')
            ->assertJsonPath('summary.expectedReports', 1)
            ->assertJsonPath('summary.totals.totalPatientDays', 30);

        $data = $response->json();

        $this->assertEqualsWithDelta(3.846, $data['summary']['occupancy']['borPercent'], 0.001);
        $this->assertEqualsWithDelta(0.115, $data['summary']['occupancy']['btr'], 0.001);
        $this->assertEqualsWithDelta(10, $data['summary']['occupancy']['alos'], 0.001);
    }

    public function test_outpatient_analytics_include_access_and_availability_metrics(): void
    {
        $this->createSampleReports();

        $response = $this->actingAs($this->admin)
            ->getJson("/api/analytics/outpatient?period_id={$this->period->id}")
            ->assertOk()
            ->assertJsonPath('scope.family', 'outpatient')
            ->assertJsonPath('summary.totals.totalPatientsSeen', 40)
            ->assertJsonPath('summary.totals.followUpPatients', 30)
            ->assertJsonPath('summary.totals.newPatientsSeen', 10)
            ->assertJsonPath('outpatient.seniorPhysicianAvailability.fullDay', 1)
            ->assertJsonPath('outpatient.seniorPhysicianAvailability.total', 1);

        $data = $response->json();

        $this->assertEqualsWithDelta(5, $data['outpatient']['averages']['waitTimeNewDays'], 0.001);
        $this->assertEqualsWithDelta(510, $data['outpatient']['averages']['clinicStartMinutes'], 0.001);
    }

    public function test_procedure_analytics_include_service_totals_and_mix(): void
    {
        $this->createSampleReports();

        $response = $this->actingAs($this->admin)
            ->getJson("/api/analytics/procedures?period_id={$this->period->id}&procedure_category=dialysis")
            ->assertOk()
            ->assertJsonPath('scope.family', 'procedure')
            ->assertJsonPath('scope.procedureCategory', 'dialysis')
            ->assertJsonPath('summary.totals.procedureThroughput', 10)
            ->assertJsonPath('procedures.totalThroughput', 10)
            ->assertJsonPath('procedures.dialysisMix.acuteHd', 4)
            ->assertJsonPath('procedures.dialysisMix.chronicHd', 6);

        $services = collect($response->json('procedures.services'));
        $dialysis = $services->firstWhere('serviceId', 'dialysis_unit');

        $this->assertSame(10, $dialysis['total']);
    }

    public function test_department_ward_weekly_and_monthly_endpoints_return_grouped_rows(): void
    {
        $this->createSampleReports();

        $departments = $this->actingAs($this->admin)
            ->getJson("/api/analytics/departments?period_id={$this->period->id}")
            ->assertOk()
            ->assertJsonCount(3, 'data')
            ->json('data');

        $this->assertContains('gi_neuro_inpatient', array_column($departments, 'departmentSlug'));
        $this->assertContains('outpatient_main', array_column($departments, 'departmentSlug'));
        $this->assertContains('dialysis_unit', array_column($departments, 'departmentSlug'));

        $this->actingAs($this->admin)
            ->getJson("/api/analytics/wards?period_id={$this->period->id}")
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.departmentSlug', 'gi_neuro_inpatient');

        $this->actingAs($this->admin)
            ->getJson('/api/analytics/weekly?family=procedure&week=2026-05-25')
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.summary.totals.procedureThroughput', 10);

        $this->actingAs($this->admin)
            ->getJson('/api/analytics/monthly?family=outpatient&month=2026-05')
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.summary.totals.totalPatientsSeen', 40);
    }

    /**
     * @return array<string, ReportAssignment>
     */
    private function createSampleReports(): array
    {
        return [
            'inpatient' => $this->submitReport('gi_neuro_inpatient', [
                'total_admitted_patients' => $this->dailyValue('total_admitted_patients', 5),
                'new_admitted_patients' => $this->dailyValue('new_admitted_patients', 7),
                'discharged_home' => $this->dailyValue('discharged_home', 2),
                'discharged_ama' => $this->dailyValue('discharged_ama', 1),
                'total_hai' => $this->dailyValue('total_hai', 2),
                'total_patient_days' => $this->dailyValue('total_patient_days', 30),
            ]),
            'outpatient' => $this->submitReport('outpatient_main', [
                'total_patients_seen' => $this->dailyValue('total_patients_seen', 40),
                'follow_up_patients' => $this->dailyValue('follow_up_patients', 30),
                'new_patients_seen' => $this->dailyValue('new_patients_seen', 10),
                'not_seen_same_day' => $this->dailyValue('not_seen_same_day', 2),
                'wait_time_new_days' => $this->dailyValues('wait_time_new_days', ['monday' => 4, 'tuesday' => 6]),
                'wait_time_followup_months' => $this->dailyValue('wait_time_followup_months', 2),
                'failed_to_come' => $this->dailyValue('failed_to_come', 3),
                'not_seen_appointment' => $this->dailyValue('not_seen_appointment', 1),
                'clinic_start_time' => $this->dailyValue('clinic_start_time', '08:30'),
                'senior_physician_availability' => $this->dailyValue('senior_physician_availability', 'Full day'),
            ]),
            'procedure' => $this->submitReport('dialysis_unit', [
                'dialysis_acute' => $this->dailyValue('dialysis_acute', 4),
                'dialysis_chronic' => $this->dailyValue('dialysis_chronic', 6),
            ]),
        ];
    }

    /**
     * @param  array<string, array{fieldId: string, dailyValues: array<string, mixed>}>  $values
     */
    private function submitReport(string $departmentSlug, array $values): ReportAssignment
    {
        $department = Department::query()->where('slug', $departmentSlug)->firstOrFail();
        $assignment = ReportAssignment::query()->create([
            'nurse_id' => $this->nurse->id,
            'department_id' => $department->id,
            'template_id' => $department->template_id,
            'active' => true,
            'approved_at' => now(),
        ]);

        $this->actingAs($this->nurse)
            ->postJson('/api/reports', [
                'assignmentId' => $assignment->id,
                'reportingPeriodId' => $this->period->id,
                'submit' => true,
                'values' => $values,
            ])
            ->assertCreated();

        return $assignment;
    }

    /**
     * @return array{fieldId: string, dailyValues: array<string, mixed>}
     */
    private function dailyValue(string $fieldKey, mixed $value): array
    {
        return $this->dailyValues($fieldKey, ['monday' => $value]);
    }

    /**
     * @param  array<string, mixed>  $values
     * @return array{fieldId: string, dailyValues: array<string, mixed>}
     */
    private function dailyValues(string $fieldKey, array $values): array
    {
        return [
            'fieldId' => $fieldKey,
            'dailyValues' => $values,
        ];
    }
}
