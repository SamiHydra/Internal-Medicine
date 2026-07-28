<?php

namespace Tests\Feature;

use App\Jobs\WarmDashboardAnalytics;
use App\Models\Department;
use App\Models\Report;
use App\Models\ReportAssignment;
use App\Models\ReportingPeriod;
use App\Models\User;
use App\Services\Analytics\AnalyticsFilters;
use App\Services\Analytics\DashboardAnalyticsService;
use Database\Seeders\DepartmentSeeder;
use Database\Seeders\ReportFieldDefinitionSeeder;
use Database\Seeders\ReportTemplateSeeder;
use Database\Seeders\RoleSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
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

    public function test_admin_can_read_cached_dashboard_analytics_and_cache_invalidates_on_report_update(): void
    {
        $this->createSampleReports();

        $this->actingAs($this->admin)
            ->getJson("/api/analytics/dashboard?period_id={$this->period->id}")
            ->assertOk()
            ->assertJsonPath('overview.summary.totalReports', 3)
            ->assertJsonPath('overview.summary.totals.totalAdmissions', 12)
            ->assertJsonPath('families.inpatient.summary.totals.totalAdmissions', 12)
            ->assertJsonPath('families.outpatient.outpatient.seniorPhysicianAvailability.fullDay', 1)
            ->assertJsonPath('families.procedure.procedures.totalThroughput', 10);

        try {
            Carbon::setTestNow(now()->addSecond());

            $report = Report::query()
                ->whereHas('department', fn ($query) => $query->where('slug', 'gi_neuro_inpatient'))
                ->firstOrFail();

            $this->actingAs($this->nurse)
                ->putJson("/api/reports/{$report->id}", [
                    'values' => [
                        'total_admitted_patients' => $this->dailyValue('total_admitted_patients', 10),
                    ],
                ])
                ->assertOk()
                ->assertJsonPath('values.total_admitted_patients.dailyValues.monday', 10);

            $this->actingAs($this->admin)
                ->getJson("/api/analytics/dashboard?period_id={$this->period->id}")
                ->assertOk()
                ->assertJsonPath('overview.summary.totals.totalAdmissions', 17);
        } finally {
            Carbon::setTestNow();
        }
    }

    public function test_warm_rebuilds_recently_requested_dashboard_with_fresh_data(): void
    {
        $this->createSampleReports();
        $service = app(DashboardAnalyticsService::class);
        $filters = new AnalyticsFilters(periodId: $this->period->id);

        // A viewer requests this dashboard, registering it as "recently viewed".
        $this->assertEquals(
            12,
            $service->summary($filters)['overview']['summary']['totals']['totalAdmissions'],
        );

        // A write rotates the version, so the slice is now a cold miss again.
        $report = Report::query()
            ->whereHas('department', fn ($query) => $query->where('slug', 'gi_neuro_inpatient'))
            ->firstOrFail();
        $this->actingAs($this->nurse)
            ->putJson("/api/reports/{$report->id}", [
                'values' => [
                    'total_admitted_patients' => $this->dailyValue('total_admitted_patients', 10),
                ],
            ])
            ->assertOk();

        // warm() (what the after-response hook calls) rebuilds the slice ahead of
        // the next viewer, and it must reflect the post-write data, never stale.
        $service->warm();

        $sourceQueries = [];
        DB::listen(function ($query) use (&$sourceQueries): void {
            $sql = strtolower($query->sql);

            if (
                str_contains($sql, 'from "reports"')
                || str_contains($sql, 'from "report_field_values"')
                || str_contains($sql, 'from "report_assignments"')
            ) {
                $sourceQueries[] = $sql;
            }
        });

        $warmed = $service->summary($filters);

        $this->assertSame([], $sourceQueries, 'After warm(), the next viewer must hit a warm cache, not rescan source tables.');
        $this->assertEquals(17, $warmed['overview']['summary']['totals']['totalAdmissions']);
    }

    public function test_cached_dashboard_does_not_rescan_source_tables(): void
    {
        $this->createSampleReports();
        $service = app(DashboardAnalyticsService::class);
        $filters = new AnalyticsFilters(periodId: $this->period->id);

        $service->invalidate();
        $service->summary($filters);

        $sourceQueries = [];
        DB::listen(function ($query) use (&$sourceQueries): void {
            $sql = strtolower($query->sql);

            if (
                str_contains($sql, 'from "reports"')
                || str_contains($sql, 'from "report_field_values"')
                || str_contains($sql, 'from "report_assignments"')
            ) {
                $sourceQueries[] = $sql;
            }
        });

        $service->summary($filters);

        $this->assertSame([], $sourceQueries, 'A dashboard cache hit must not fingerprint source tables.');
    }

    public function test_invalidation_queues_one_unique_warm_instead_of_running_it_in_the_request(): void
    {
        config()->set('queue.default', 'database');
        Queue::fake();

        $service = app(DashboardAnalyticsService::class);
        $service->invalidate();
        $service->invalidate();

        Queue::assertPushed(WarmDashboardAnalytics::class, 1);
    }

    public function test_assignment_changes_invalidate_cached_dashboard_expectations(): void
    {
        $assignments = $this->createSampleReports();

        $this->actingAs($this->admin)
            ->getJson("/api/analytics/dashboard?period_id={$this->period->id}")
            ->assertOk()
            ->assertJsonPath('overview.summary.expectedReports', 3);

        $this->actingAs($this->admin)
            ->patchJson("/api/admin/assignments/{$assignments['inpatient']->id}", [
                'active' => false,
            ])
            ->assertOk();

        $this->actingAs($this->admin)
            ->getJson("/api/analytics/dashboard?period_id={$this->period->id}")
            ->assertOk()
            ->assertJsonPath('overview.summary.expectedReports', 2)
            ->assertJsonPath('families.inpatient.summary.expectedReports', 0);
    }

    public function test_dashboard_weekly_rows_include_chart_metrics_for_client_charts(): void
    {
        $this->createSampleReports();

        $response = $this->actingAs($this->admin)
            ->getJson("/api/analytics/dashboard?period_id={$this->period->id}")
            ->assertOk()
            ->assertJsonPath('families.inpatient.summary.totals.newAdmissions', 7)
            ->assertJsonPath('families.inpatient.summary.totals.deaths', 1)
            ->assertJsonPath('families.inpatient.summary.totals.newPressureUlcers', 2)
            ->assertJsonPath('families.inpatient.weekly.0.chartMetrics.newAdmissions', 7)
            ->assertJsonPath('families.inpatient.weekly.0.chartMetrics.deaths', 1)
            ->assertJsonPath('families.inpatient.weekly.0.chartMetrics.ulcers', 2)
            ->assertJsonPath('families.inpatient.weekly.0.departments.0.metrics.newAdmissions', 7)
            ->assertJsonPath('families.outpatient.weekly.0.chartMetrics.seen', 40)
            ->assertJsonPath('families.outpatient.weekly.0.chartMetrics.notSeenSameDay', 2)
            ->assertJsonPath('families.outpatient.weekly.0.chartMetrics.wait', 2)
            ->assertJsonPath('families.outpatient.weekly.0.chartMetrics.startMinutes', 510)
            ->assertJsonPath('families.outpatient.weekly.0.chartMetrics.availability.fullDay', 1)
            ->assertJsonPath('families.outpatient.weekly.0.departments.0.metrics.availability.total', 1)
            ->assertJsonPath('families.procedure.weekly.0.chartMetrics.totalThroughput', 10);

        $procedureServices = collect($response->json('families.procedure.weekly.0.chartMetrics.services'));
        $dialysis = $procedureServices->firstWhere('serviceId', 'dialysis_unit');

        $this->assertEquals(10, $dialysis['total']);

        $dialysisMix = collect($response->json('families.procedure.weekly.0.chartMetrics.dialysisMix'));

        $this->assertEquals(4, $dialysisMix->firstWhere('key', 'acuteHd')['value']);
        $this->assertEquals(6, $dialysisMix->firstWhere('key', 'chronicHd')['value']);
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

    public function test_quarterly_and_yearly_rollups_aggregate_weekly_reports(): void
    {
        $assignment = $this->assignmentForDepartment('gi_neuro_inpatient');
        $q2SecondPeriod = $this->createReportingPeriod('2026-06-01');
        $q3Period = $this->createReportingPeriod('2026-07-06');

        $this->submitReportForAssignment($assignment, $this->period, [
            'total_admitted_patients' => $this->dailyValue('total_admitted_patients', 5),
            'discharged_home' => $this->dailyValue('discharged_home', 3),
            'total_patient_days' => $this->dailyValue('total_patient_days', 30),
        ]);
        $this->submitReportForAssignment($assignment, $q2SecondPeriod, [
            'total_admitted_patients' => $this->dailyValue('total_admitted_patients', 7),
            'discharged_home' => $this->dailyValue('discharged_home', 4),
            'total_patient_days' => $this->dailyValue('total_patient_days', 40),
        ]);
        $this->submitReportForAssignment($assignment, $q3Period, [
            'total_admitted_patients' => $this->dailyValue('total_admitted_patients', 11),
            'discharged_home' => $this->dailyValue('discharged_home', 5),
            'total_patient_days' => $this->dailyValue('total_patient_days', 55),
        ]);

        $quarterly = $this->actingAs($this->admin)
            ->getJson('/api/analytics/quarterly?year=2026&family=inpatient')
            ->assertOk()
            ->assertJsonCount(2, 'data')
            ->assertJsonPath('data.0.quarter', 'Q2')
            ->assertJsonPath('data.0.quarterLabel', 'Q2 2026')
            ->assertJsonPath('data.0.periodCount', 2)
            ->assertJsonPath('data.0.summary.totalReports', 2)
            ->assertJsonPath('data.0.summary.expectedReports', 2)
            ->assertJsonPath('data.0.summary.totals.totalAdmissions', 12)
            ->assertJsonPath('data.0.summary.totals.totalDischarges', 7)
            ->assertJsonPath('data.0.summary.totals.totalPatientDays', 70)
            ->assertJsonPath('data.1.quarter', 'Q3')
            ->assertJsonPath('data.1.summary.totals.totalAdmissions', 11);

        $this->assertEqualsWithDelta(10, $quarterly->json('data.0.summary.occupancy.alos'), 0.001);

        $this->actingAs($this->admin)
            ->getJson('/api/analytics/yearly?year=2026&family=inpatient')
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.year', 2026)
            ->assertJsonPath('data.0.periodCount', 3)
            ->assertJsonPath('data.0.summary.totalReports', 3)
            ->assertJsonPath('data.0.summary.expectedReports', 3)
            ->assertJsonPath('data.0.summary.totals.totalAdmissions', 23)
            ->assertJsonPath('data.0.summary.totals.totalDischarges', 12)
            ->assertJsonPath('data.0.summary.totals.totalPatientDays', 125);
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
                'new_deaths' => $this->dailyValue('new_deaths', 1),
                'new_pressure_ulcer' => $this->dailyValue('new_pressure_ulcer', 2),
                'total_pressure_ulcer' => $this->dailyValue('total_pressure_ulcer', 3),
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
        $assignment = $this->assignmentForDepartment($departmentSlug);

        $this->submitReportForAssignment($assignment, $this->period, $values);

        return $assignment;
    }

    private function assignmentForDepartment(string $departmentSlug): ReportAssignment
    {
        $department = Department::query()->where('slug', $departmentSlug)->firstOrFail();

        return ReportAssignment::query()->create([
            'nurse_id' => $this->nurse->id,
            'department_id' => $department->id,
            'template_id' => $department->template_id,
            'active' => true,
            'approved_at' => now(),
        ]);
    }

    /**
     * @param  array<string, array{fieldId: string, dailyValues: array<string, mixed>}>  $values
     */
    private function submitReportForAssignment(ReportAssignment $assignment, ReportingPeriod $period, array $values): void
    {
        $this->actingAs($this->nurse)
            ->postJson('/api/reports', [
                'assignmentId' => $assignment->id,
                'reportingPeriodId' => $period->id,
                'submit' => true,
                'values' => $values,
            ])
            ->assertCreated();
    }

    private function createReportingPeriod(string $weekStart): ReportingPeriod
    {
        $start = Carbon::parse($weekStart);

        return ReportingPeriod::query()->create([
            'week_start' => $start->toDateString(),
            'week_end' => $start->copy()->addDays(6)->toDateString(),
            'deadline_at' => $start->copy()->addWeek()->setTime(10, 0),
            'month_label' => $start->format('M Y'),
            'quarter_label' => sprintf('Q%d %d', $start->quarter, $start->year),
            'year_num' => $start->year,
        ]);
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
