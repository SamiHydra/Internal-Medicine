<?php

namespace Tests\Feature;

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
use Tests\TestCase;

class CriticalEventAlertTest extends TestCase
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

    public function test_submitting_a_report_with_a_critical_value_alerts_admins(): void
    {
        $this->actingAs($this->nurse)->postJson('/api/reports', [
            'assignmentId' => $this->assignment->id,
            'reportingPeriodId' => $this->period->id,
            'submit' => true,
            'values' => [
                'total_patient_days' => ['fieldId' => 'total_patient_days', 'dailyValues' => ['monday' => 20]],
                'new_deaths' => ['fieldId' => 'new_deaths', 'dailyValues' => ['monday' => 2]],
            ],
        ])->assertCreated();

        $report = Report::query()->firstOrFail();

        $this->assertDatabaseHas('notifications', [
            'recipient_id' => $this->admin->id,
            'type' => 'critical_value_alert',
            'related_entity' => 'critical_alert',
            'related_id' => $report->id,
        ]);

        // One summary alert per recipient (not one per field).
        $this->assertSame(1, Notification::query()->where('type', 'critical_value_alert')->count());
        $alert = Notification::query()->where('type', 'critical_value_alert')->firstOrFail();
        $this->assertStringContainsString('(2)', $alert->message);
    }

    public function test_no_alert_when_all_critical_values_are_zero(): void
    {
        $this->actingAs($this->nurse)->postJson('/api/reports', [
            'assignmentId' => $this->assignment->id,
            'reportingPeriodId' => $this->period->id,
            'submit' => true,
            'values' => [
                'total_patient_days' => ['fieldId' => 'total_patient_days', 'dailyValues' => ['monday' => 20]],
                'new_deaths' => ['fieldId' => 'new_deaths', 'dailyValues' => ['monday' => 0]],
            ],
        ])->assertCreated();

        $this->assertSame(0, Notification::query()->where('type', 'critical_value_alert')->count());
    }

    public function test_no_alert_on_a_plain_draft_save(): void
    {
        // Drafts are still being entered; admins should not be pinged until submit.
        $this->actingAs($this->nurse)->postJson('/api/reports', [
            'assignmentId' => $this->assignment->id,
            'reportingPeriodId' => $this->period->id,
            'values' => [
                'new_deaths' => ['fieldId' => 'new_deaths', 'dailyValues' => ['monday' => 5]],
            ],
        ])->assertCreated();

        $this->assertSame(0, Notification::query()->where('type', 'critical_value_alert')->count());
    }
}
