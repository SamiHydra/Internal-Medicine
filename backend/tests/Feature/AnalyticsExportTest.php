<?php

namespace Tests\Feature;

use App\Models\Department;
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

class AnalyticsExportTest extends TestCase
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

        $this->actingAs($this->nurse)->postJson('/api/reports', [
            'assignmentId' => $this->assignment->id,
            'reportingPeriodId' => $this->period->id,
            'submit' => true,
            'values' => [
                'total_patient_days' => ['fieldId' => 'total_patient_days', 'dailyValues' => ['monday' => 20]],
                'new_deaths' => ['fieldId' => 'new_deaths', 'dailyValues' => ['monday' => 2]],
            ],
        ])->assertCreated();
    }

    public function test_admin_can_export_a_period_as_csv(): void
    {
        $response = $this->actingAs($this->admin)
            ->get('/api/analytics/export?period='.$this->period->id);

        $response->assertOk();
        $response->assertHeader('Content-Type', 'text/csv; charset=UTF-8');
        $this->assertStringContainsString('attachment', $response->headers->get('Content-Disposition'));

        $csv = $response->streamedContent();
        $this->assertStringContainsString('Week start', $csv);   // header row
        $this->assertStringContainsString('2026-05-25', $csv);   // the week
        $this->assertStringContainsString('inpatient', $csv);    // family column
        $this->assertStringContainsString('20', $csv);           // total_patient_days weekly sum
    }

    public function test_admin_can_export_a_period_as_xlsx(): void
    {
        $response = $this->actingAs($this->admin)
            ->get('/api/analytics/export?format=xlsx&period='.$this->period->id);

        $response->assertOk();
        $response->assertHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        $disposition = (string) $response->headers->get('Content-Disposition');
        $this->assertStringContainsString('attachment', $disposition);
        $this->assertStringContainsString('.xlsx', $disposition);

        // The body is a genuine .xlsx (zip) carrying the period's data.
        $file = $response->baseResponse->getFile()->getPathname();
        $this->assertTrue(is_file($file));

        $zip = new \ZipArchive();
        $this->assertTrue($zip->open($file) === true);
        $sheet = (string) $zip->getFromName('xl/worksheets/sheet1.xml');
        $zip->close();

        $this->assertStringContainsString('Week start', $sheet);
        $this->assertStringContainsString('2026-05-25', $sheet);
        $this->assertStringContainsString('<v>20</v>', $sheet);
    }

    public function test_nurses_cannot_export(): void
    {
        $this->actingAs($this->nurse)
            ->get('/api/analytics/export?period='.$this->period->id)
            ->assertForbidden();

        $this->actingAs($this->nurse)
            ->get('/api/analytics/export?format=xlsx&period='.$this->period->id)
            ->assertForbidden();
    }
}
