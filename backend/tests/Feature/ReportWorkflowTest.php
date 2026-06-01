<?php

namespace Tests\Feature;

use App\Models\AuditLog;
use App\Models\CalculatedMetric;
use App\Models\Department;
use App\Models\Notification;
use App\Models\Report;
use App\Models\ReportAssignment;
use App\Models\ReportingPeriod;
use App\Models\ReportStatusHistory;
use App\Models\ReportTemplate;
use App\Models\User;
use Database\Seeders\DepartmentSeeder;
use Database\Seeders\ReportFieldDefinitionSeeder;
use Database\Seeders\ReportTemplateSeeder;
use Database\Seeders\RoleSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class ReportWorkflowTest extends TestCase
{
    use RefreshDatabase;

    private User $nurse;

    private User $admin;

    private User $superadmin;

    private ReportAssignment $assignment;

    private ReportingPeriod $period;

    protected function setUp(): void
    {
        parent::setUp();

        foreach ([RoleSeeder::class, ReportTemplateSeeder::class, DepartmentSeeder::class, ReportFieldDefinitionSeeder::class] as $seeder) {
            $this->seed($seeder);
        }

        $this->nurse = User::factory()->create([
            'full_name' => 'Hana Abera',
            'email' => 'hana@example.test',
            'username' => 'hana.abera',
        ]);
        $this->admin = User::factory()->role('admin', 'Administrator')->create([
            'full_name' => 'Admin One',
        ]);
        $this->superadmin = User::factory()->role('superadmin', 'Superadmin')->create([
            'full_name' => 'Protected Admin',
        ]);
        User::factory()->inactive()->role('admin', 'Administrator')->create();

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

    public function test_nurse_can_save_draft_values_and_metrics_are_recalculated(): void
    {
        $response = $this->actingAs($this->nurse)->postJson('/api/reports', [
            'assignmentId' => $this->assignment->id,
            'reportingPeriodId' => $this->period->id,
            'values' => $this->inpatientValues(totalPatientDays: 30, dischargedHome: 2, dischargedAma: 1),
        ]);

        $response
            ->assertCreated()
            ->assertJsonPath('status', 'draft')
            ->assertJsonPath('values.total_patient_days.dailyValues.monday', 30)
            ->assertJsonPath('values.discharged_home.dailyValues.monday', 2)
            ->assertJsonPath('calculatedMetrics.payload.total_patient_days', 30);

        $report = Report::query()->firstOrFail();

        $this->assertDatabaseHas('report_status_history', [
            'report_id' => $report->id,
            'status' => 'draft',
            'note' => 'Draft created from the web form.',
        ]);
        $this->assertDatabaseHas('calculated_metrics', [
            'report_id' => $report->id,
        ]);
        $this->assertEqualsWithDelta(3.846, (float) CalculatedMetric::query()->firstOrFail()->bor_percent, 0.001);
        $this->assertEquals(0, AuditLog::query()->count());
    }

    public function test_submit_creates_history_and_admin_notifications(): void
    {
        $response = $this->actingAs($this->nurse)->postJson('/api/reports', [
            'assignment_id' => $this->assignment->id,
            'reporting_period_id' => $this->period->id,
            'submit' => true,
            'values' => $this->inpatientValues(totalPatientDays: 20, dischargedHome: 2, dischargedAma: 0),
        ]);

        $response
            ->assertCreated()
            ->assertJsonPath('status', 'submitted')
            ->assertJsonMissingPath('values.free_beds');

        $report = Report::query()->firstOrFail();

        $this->assertNotNull($report->submitted_at);
        $this->assertSame(['draft', 'submitted'], ReportStatusHistory::query()->orderBy('changed_at')->pluck('status')->all());
        $this->assertDatabaseHas('notifications', [
            'recipient_id' => $this->admin->id,
            'type' => 'new_report_submitted',
            'related_entity' => 'report_submission',
            'related_id' => $report->id,
        ]);
        $this->assertDatabaseHas('notifications', [
            'recipient_id' => $this->superadmin->id,
            'type' => 'new_report_submitted',
        ]);
        $this->assertSame(2, Notification::query()->where('type', 'new_report_submitted')->count());
    }

    public function test_editing_submitted_report_writes_cell_audit_and_moves_status(): void
    {
        $report = $this->submitReport();

        $response = $this->actingAs($this->admin)->putJson("/api/reports/{$report->id}", [
            'values' => $this->inpatientValues(totalPatientDays: 35, dischargedHome: 4, dischargedAma: 1),
        ]);

        $response
            ->assertOk()
            ->assertJsonPath('status', 'edited_after_submission')
            ->assertJsonPath('values.total_patient_days.dailyValues.monday', 35);

        $this->assertDatabaseHas('report_status_history', [
            'report_id' => $report->id,
            'status' => 'edited_after_submission',
            'note' => 'Submitted report changed while still unlocked.',
        ]);
        $this->assertDatabaseHas('audit_logs', [
            'report_id' => $report->id,
            'field_key' => 'total_patient_days',
            'day_name' => 'monday',
            'old_value' => '30',
            'new_value' => '35',
            'changed_by' => $this->admin->id,
        ]);
        $this->assertDatabaseHas('notifications', [
            'type' => 'submitted_report_edited',
            'related_entity' => 'report_edit',
            'related_id' => $report->id,
        ]);
    }

    public function test_lock_and_unlock_write_history_and_nurse_notifications(): void
    {
        $report = $this->submitReport();
        $this->actingAs($this->admin)->putJson("/api/reports/{$report->id}", [
            'values' => $this->inpatientValues(totalPatientDays: 31, dischargedHome: 2, dischargedAma: 1),
        ])->assertOk();

        $this->actingAs($this->admin)
            ->postJson("/api/reports/{$report->id}/lock")
            ->assertOk()
            ->assertJsonPath('status', 'locked')
            ->assertJsonMissingPath('values.free_beds');

        $this->assertDatabaseHas('report_status_history', [
            'report_id' => $report->id,
            'status' => 'locked',
            'note' => 'Report locked after review.',
        ]);
        $this->assertDatabaseHas('notifications', [
            'recipient_id' => $this->nurse->id,
            'type' => 'report_locked',
            'related_entity' => 'report_lock',
            'related_id' => $report->id,
        ]);

        $this->actingAs($this->admin)
            ->postJson("/api/reports/{$report->id}/unlock")
            ->assertOk()
            ->assertJsonPath('status', 'edited_after_submission')
            ->assertJsonPath('lockedAt', null);

        $this->assertDatabaseHas('notifications', [
            'recipient_id' => $this->nurse->id,
            'type' => 'report_unlocked',
            'related_entity' => 'report_unlock',
            'related_id' => $report->id,
        ]);
    }

    public function test_locked_reports_reject_save_attempts(): void
    {
        $report = $this->submitReport();
        $this->actingAs($this->admin)->postJson("/api/reports/{$report->id}/lock")->assertOk();

        $this->actingAs($this->admin)
            ->putJson("/api/reports/{$report->id}", [
                'values' => $this->inpatientValues(totalPatientDays: 99, dischargedHome: 2, dischargedAma: 1),
            ])
            ->assertUnprocessable()
            ->assertJsonValidationErrors('report');
    }

    public function test_other_nurses_cannot_save_for_unassigned_reports(): void
    {
        $otherNurse = User::factory()->create();

        $this->actingAs($otherNurse)
            ->postJson('/api/reports', [
                'assignmentId' => $this->assignment->id,
                'reportingPeriodId' => $this->period->id,
                'values' => $this->inpatientValues(),
            ])
            ->assertForbidden();
    }

    public function test_report_index_and_show_are_scoped_to_active_assignments(): void
    {
        $ownReport = $this->submitReport();
        $otherNurse = User::factory()->create();
        $otherAssignment = ReportAssignment::query()->create([
            'nurse_id' => $otherNurse->id,
            'department_id' => $this->assignment->department_id,
            'template_id' => $this->assignment->template_id,
            'active' => true,
            'approved_at' => now(),
        ]);
        $otherReport = Report::query()->create([
            'assignment_id' => $otherAssignment->id,
            'department_id' => $otherAssignment->department_id,
            'template_id' => $otherAssignment->template_id,
            'reporting_period_id' => $this->period->id,
            'status' => 'draft',
            'created_by' => $otherNurse->id,
            'updated_by' => $otherNurse->id,
        ]);

        $this->actingAs($this->nurse)
            ->getJson('/api/reports')
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.id', $ownReport->id);

        $this->actingAs($this->nurse)
            ->getJson("/api/reports/{$ownReport->id}")
            ->assertOk()
            ->assertJsonPath('id', $ownReport->id);

        $this->actingAs($this->nurse)
            ->getJson("/api/reports/{$otherReport->id}")
            ->assertForbidden();

        $this->actingAs($this->admin)
            ->getJson('/api/reports')
            ->assertOk()
            ->assertJsonCount(2, 'data');
    }

    public function test_invalid_fields_days_and_values_are_rejected(): void
    {
        $this->actingAs($this->nurse)
            ->postJson('/api/reports', [
                'assignmentId' => $this->assignment->id,
                'reportingPeriodId' => $this->period->id,
                'values' => [
                    'total_patient_days' => [
                        'fieldId' => 'total_patient_days',
                        'dailyValues' => ['monday' => -1],
                    ],
                ],
            ])
            ->assertUnprocessable()
            ->assertJsonValidationErrors('values.total_patient_days');

        $this->actingAs($this->nurse)
            ->postJson('/api/reports', [
                'assignmentId' => $this->assignment->id,
                'reportingPeriodId' => $this->period->id,
                'values' => [
                    'total_patient_days' => [
                        'fieldId' => 'total_patient_days',
                        'dailyValues' => ['nonday' => 1],
                    ],
                ],
            ])
            ->assertUnprocessable()
            ->assertJsonValidationErrors('values.total_patient_days.dailyValues.nonday');

        $this->actingAs($this->nurse)
            ->postJson('/api/reports', [
                'assignmentId' => $this->assignment->id,
                'reportingPeriodId' => $this->period->id,
                'values' => [
                    'not_a_real_field' => [
                        'fieldId' => 'not_a_real_field',
                        'dailyValues' => ['monday' => 1],
                    ],
                ],
            ])
            ->assertUnprocessable()
            ->assertJsonValidationErrors('values.not_a_real_field');
    }

    private function submitReport(): Report
    {
        $this->actingAs($this->nurse)->postJson('/api/reports', [
            'assignmentId' => $this->assignment->id,
            'reportingPeriodId' => $this->period->id,
            'submit' => true,
            'values' => $this->inpatientValues(totalPatientDays: 30, dischargedHome: 2, dischargedAma: 1),
        ])->assertCreated();

        return Report::query()->firstOrFail();
    }

    /**
     * @return array<string, array{fieldId: string, dailyValues: array<string, mixed>}>
     */
    private function inpatientValues(int $totalPatientDays = 30, int $dischargedHome = 2, int $dischargedAma = 1): array
    {
        return [
            'total_patient_days' => [
                'fieldId' => 'total_patient_days',
                'dailyValues' => ['monday' => $totalPatientDays],
            ],
            'discharged_home' => [
                'fieldId' => 'discharged_home',
                'dailyValues' => ['monday' => $dischargedHome],
            ],
            'discharged_ama' => [
                'fieldId' => 'discharged_ama',
                'dailyValues' => ['monday' => $dischargedAma],
            ],
            'mdt_round_start_day' => [
                'fieldId' => 'mdt_round_start_day',
                'dailyValues' => ['monday' => '08:30'],
            ],
        ];
    }
}
