<?php

namespace Tests\Feature;

use App\Jobs\BuildAnalyticsExport;
use App\Models\AnalyticsExport;
use App\Models\Department;
use App\Models\ReportAssignment;
use App\Models\ReportingPeriod;
use App\Models\ReportTemplate;
use App\Models\User;
use App\Services\Analytics\AnalyticsExportService;
use App\Support\Export\XlsxWriter;
use Database\Seeders\AppSettingSeeder;
use Database\Seeders\DepartmentSeeder;
use Database\Seeders\ReportFieldDefinitionSeeder;
use Database\Seeders\ReportTemplateSeeder;
use Database\Seeders\RoleSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\Storage;
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
                'total_admitted_patients' => [
                    'fieldId' => 'total_admitted_patients',
                    'dailyValues' => ['monday' => 10],
                ],
                'new_admitted_patients' => [
                    'fieldId' => 'new_admitted_patients',
                    'dailyValues' => ['monday' => 2],
                ],
                'total_patient_days' => [
                    'fieldId' => 'total_patient_days',
                    'dailyValues' => ['monday' => 20, 'tuesday' => 5],
                ],
                'new_deaths' => ['fieldId' => 'new_deaths', 'dailyValues' => ['monday' => 2]],
            ],
        ])->assertCreated();
    }

    public function test_admin_csv_contains_exact_daily_values_from_all_historical_submissions(): void
    {
        $historicalPeriod = ReportingPeriod::query()->create([
            'week_start' => '2026-05-18',
            'week_end' => '2026-05-24',
            'deadline_at' => '2026-05-25 10:00:00',
            'month_label' => 'May 2026',
            'quarter_label' => 'Q2 2026',
            'year_num' => 2026,
        ]);
        $this->actingAs($this->nurse)->postJson('/api/reports', [
            'assignmentId' => $this->assignment->id,
            'reportingPeriodId' => $historicalPeriod->id,
            'submit' => true,
            'values' => [
                'new_deaths' => ['fieldId' => 'new_deaths', 'dailyValues' => ['friday' => 7]],
            ],
        ])->assertCreated();

        $draftPeriod = ReportingPeriod::query()->create([
            'week_start' => '2026-05-11',
            'week_end' => '2026-05-17',
            'deadline_at' => '2026-05-18 10:00:00',
            'month_label' => 'May 2026',
            'quarter_label' => 'Q2 2026',
            'year_num' => 2026,
        ]);
        $this->actingAs($this->nurse)->postJson('/api/reports', [
            'assignmentId' => $this->assignment->id,
            'reportingPeriodId' => $draftPeriod->id,
            'submit' => false,
            'values' => [
                'new_deaths' => ['fieldId' => 'new_deaths', 'dailyValues' => ['monday' => 987654]],
            ],
        ])->assertCreated();

        $handle = fopen('php://temp', 'w+b');
        $rowCount = app(AnalyticsExportService::class)->writeCsv($handle);
        rewind($handle);
        $csv = stream_get_contents($handle);
        fclose($handle);

        $lines = preg_split('/\r\n|\r|\n/', trim($csv));
        $rows = array_map('str_getcsv', $lines ?: []);
        $header = array_shift($rows);

        $this->assertSame(count($rows), $rowCount);
        $this->assertContains('Assigned nurse', $header);
        $this->assertContains('Day', $header);
        $this->assertContains('Field key', $header);
        $this->assertNotContains('Aggregate', $header);

        $dayIndex = array_search('Day', $header, true);
        $fieldIndex = array_search('Field key', $header, true);
        $valueIndex = array_search('Value', $header, true);
        $weekIndex = array_search('Week start', $header, true);
        $nurseIndex = array_search('Assigned nurse', $header, true);

        $patientDayRows = collect($rows)->filter(
            fn (array $row): bool => ($row[$fieldIndex] ?? null) === 'total_patient_days',
        );

        $this->assertSame(['Monday', 'Tuesday'], $patientDayRows->pluck($dayIndex)->values()->all());
        $this->assertSame(['20', '5'], $patientDayRows->pluck($valueIndex)->values()->all());
        $this->assertContains('2026-05-18', collect($rows)->pluck($weekIndex)->all());
        $this->assertContains('Hana Abera', collect($rows)->pluck($nurseIndex)->all());
        $this->assertStringNotContainsString('987654', $csv);
    }

    public function test_admin_excel_matches_the_weekly_form_and_contains_all_historical_submissions(): void
    {
        $historicalPeriod = ReportingPeriod::query()->create([
            'week_start' => '2026-05-18',
            'week_end' => '2026-05-24',
            'deadline_at' => '2026-05-25 10:00:00',
            'month_label' => 'May 2026',
            'quarter_label' => 'Q2 2026',
            'year_num' => 2026,
        ]);
        $this->actingAs($this->nurse)->postJson('/api/reports', [
            'assignmentId' => $this->assignment->id,
            'reportingPeriodId' => $historicalPeriod->id,
            'submit' => true,
            'values' => [
                'new_deaths' => [
                    'fieldId' => 'new_deaths',
                    'dailyValues' => ['monday' => 7],
                ],
            ],
        ])->assertCreated();

        $report = $this->assignment->reports()
            ->where('reporting_period_id', $this->period->id)
            ->firstOrFail();

        $this->actingAs($this->nurse)->putJson("/api/reports/{$report->id}", [
            'values' => [
                'total_patient_days' => [
                    'fieldId' => 'total_patient_days',
                    'dailyValues' => ['monday' => 25],
                ],
            ],
        ])->assertOk();

        $file = (new XlsxWriter)->toMultiSheetTempFile(
            app(AnalyticsExportService::class)->workbookSheets(),
        );
        $this->assertTrue(is_file($file));

        $zip = new \ZipArchive;
        $this->assertTrue($zip->open($file) === true);
        $workbook = (string) $zip->getFromName('xl/workbook.xml');
        $submissions = (string) $zip->getFromName('xl/worksheets/sheet1.xml');
        $summary = (string) $zip->getFromName('xl/worksheets/sheet2.xml');
        $form = (string) $zip->getFromName('xl/worksheets/sheet3.xml');
        $historicalForm = (string) $zip->getFromName('xl/worksheets/sheet4.xml');
        $editHistory = (string) $zip->getFromName('xl/worksheets/sheet5.xml');
        $styles = (string) $zip->getFromName('xl/styles.xml');
        $zip->close();

        foreach ([
            'Submission Index',
            'Inpatient Weekly Report',
            '2026-05-25 GI Neurology',
            '2026-05-18 GI Neurology',
            'Edit History',
        ] as $sheetName) {
            $this->assertStringContainsString($sheetName, $workbook);
        }
        $this->assertSame(5, substr_count($workbook, '<sheet '));

        // The wide sheet: one row per ward/week, the form's own fields as
        // columns, and weekly values identical to the form sheet's totals.
        $this->assertStringContainsString('Department', $summary);
        $this->assertStringContainsString('Week start', $summary);
        $this->assertStringContainsString('Total Patient Days', $summary);
        $this->assertStringContainsString('<v>30</v>', $summary);
        $this->assertStringContainsString('<v>7</v>', $summary);

        $this->assertStringContainsString('Hana Abera', $submissions);
        $this->assertStringContainsString('Submitted cell count', $submissions);
        $this->assertStringContainsString('2026-05-25 GI Neurology', $submissions);
        $this->assertStringContainsString('2026-05-18 GI Neurology', $submissions);
        $this->assertStringContainsString('Patient Flow', $form);
        $this->assertStringContainsString('Metric', $form);
        $this->assertStringContainsString('Mon', $form);
        $this->assertStringContainsString('Tue', $form);
        $this->assertStringContainsString('Weekly total', $form);
        $this->assertStringContainsString('Total Patient Days', $form);
        $this->assertStringContainsString('<v>25</v>', $form);
        $this->assertStringContainsString('<v>30</v>', $form);
        $this->assertMatchesRegularExpression(
            '/<row[^>]*>.*Total Number of Admitted Patients.*<v>10<\/v>.*<v>12<\/v>.*<\/row>/s',
            $form,
        );
        $this->assertStringContainsString('<mergeCells', $form);
        $this->assertStringContainsString('Number of New Deaths', $historicalForm);
        $this->assertStringContainsString('<v>7</v>', $historicalForm);
        $this->assertStringContainsString('<styleSheet', $styles);
        $this->assertStringContainsString('FF001B36', $styles);
        $this->assertStringContainsString('Old value', $editHistory);
        $this->assertStringContainsString('<v>20</v>', $editHistory);
        $this->assertStringContainsString('<v>25</v>', $editHistory);

        unlink($file);
    }

    public function test_ward_and_date_filters_narrow_the_export(): void
    {
        $other = Department::query()->where('slug', 'cardiac_inpatient')->firstOrFail();
        $otherNurse = User::factory()->create(['full_name' => 'Abel Gemechu', 'username' => 'abel.gemechu']);
        $otherAssignment = ReportAssignment::query()->create([
            'nurse_id' => $otherNurse->id,
            'department_id' => $other->id,
            'template_id' => $this->assignment->template_id,
            'active' => true,
            'approved_at' => now(),
        ]);

        $this->actingAs($otherNurse)->postJson('/api/reports', [
            'assignmentId' => $otherAssignment->id,
            'reportingPeriodId' => $this->period->id,
            'submit' => true,
            'values' => [
                'new_deaths' => ['fieldId' => 'new_deaths', 'dailyValues' => ['monday' => 4]],
            ],
        ])->assertCreated();

        $service = app(AnalyticsExportService::class);
        $this->assertSame(2, $service->reportCount());

        $narrowed = app(AnalyticsExportService::class)
            ->withFilters(['departmentIds' => [$other->id]]);
        $this->assertSame(1, $narrowed->reportCount());

        // The narrowed workbook holds only the one ward: index, its summary
        // sheet, its single form sheet, and edit history.
        $file = (new XlsxWriter)->toMultiSheetTempFile($narrowed->workbookSheets());
        $zip = new \ZipArchive;
        $this->assertTrue($zip->open($file) === true);
        $workbook = (string) $zip->getFromName('xl/workbook.xml');
        $zip->close();
        unlink($file);

        $this->assertSame(4, substr_count($workbook, '<sheet '));
        $this->assertStringContainsString('Cardiac', $workbook);
        $this->assertStringNotContainsString('GI Neurology', $workbook);

        // A range that excludes every week returns nothing at all.
        $this->assertSame(0, app(AnalyticsExportService::class)
            ->withFilters(['dateFrom' => '2020-01-01', 'dateTo' => '2020-12-31'])
            ->reportCount());
    }

    public function test_the_scope_endpoint_reports_the_size_of_a_selection(): void
    {
        $this->actingAs($this->admin)
            ->getJson('/api/analytics/exports/scope')
            ->assertOk()
            ->assertJsonPath('data.reports', 1)
            ->assertJsonPath('data.limit', AnalyticsExportService::maxReports());

        // The same criteria the queue call takes, so the number someone sees is
        // the number the ceiling is applied to.
        $this->actingAs($this->admin)
            ->getJson('/api/analytics/exports/scope?departments[]=cardiac_inpatient')
            ->assertOk()
            ->assertJsonPath('data.reports', 0);

        $this->actingAs($this->admin)
            ->getJson('/api/analytics/exports/scope?dateFrom=2020-01-01&dateTo=2020-12-31')
            ->assertOk()
            ->assertJsonPath('data.reports', 0);

        $this->actingAs($this->admin)
            ->getJson('/api/analytics/exports/scope?departments[]=not_a_ward')
            ->assertJsonValidationErrors('departments.0');
    }

    public function test_queueing_an_export_stores_the_requested_scope(): void
    {
        Queue::fake();

        $this->actingAs($this->admin)
            ->postJson('/api/analytics/exports', [
                'format' => 'csv',
                'departments' => ['gi_neuro_inpatient'],
                'dateFrom' => '2026-05-01',
                'dateTo' => '2026-05-31',
            ])
            ->assertAccepted();

        $export = AnalyticsExport::query()->latest()->firstOrFail();
        $department = Department::query()->where('slug', 'gi_neuro_inpatient')->firstOrFail();

        // Slugs in, ids stored: a later rename cannot change what this covered.
        $this->assertSame([$department->id], $export->filters['departmentIds']);
        $this->assertSame('2026-05-01', $export->filters['dateFrom']);
        $this->assertSame('2026-05-31', $export->filters['dateTo']);
    }

    public function test_a_request_over_the_ceiling_is_refused_before_anything_is_queued(): void
    {
        Queue::fake();

        // Two reports on record, ceiling of one: the request is over by one.
        $second = ReportingPeriod::query()->create([
            'week_start' => '2026-05-18',
            'week_end' => '2026-05-24',
            'deadline_at' => '2026-05-25 10:00:00',
            'month_label' => 'May 2026',
            'quarter_label' => 'Q2 2026',
            'year_num' => 2026,
        ]);
        $this->actingAs($this->nurse)->postJson('/api/reports', [
            'assignmentId' => $this->assignment->id,
            'reportingPeriodId' => $second->id,
            'submit' => true,
            'values' => [
                'new_deaths' => ['fieldId' => 'new_deaths', 'dailyValues' => ['monday' => 1]],
            ],
        ])->assertCreated();

        config(['reports.export.max_reports' => 1]);

        $this->actingAs($this->admin)
            ->postJson('/api/analytics/exports', ['format' => 'xlsx'])
            ->assertJsonValidationErrors('dateFrom');

        Queue::assertNothingPushed();
        $this->assertSame(0, AnalyticsExport::query()->count());

        // Back under the ceiling the same request goes through untouched.
        config(['reports.export.max_reports' => 5000]);

        $this->actingAs($this->admin)
            ->postJson('/api/analytics/exports', ['format' => 'xlsx'])
            ->assertAccepted();

        Queue::assertPushed(BuildAnalyticsExport::class);
    }

    public function test_an_unknown_ward_is_rejected(): void
    {
        Queue::fake();

        $this->actingAs($this->admin)
            ->postJson('/api/analytics/exports', ['departments' => ['not_a_ward']])
            ->assertJsonValidationErrors('departments.0');

        Queue::assertNothingPushed();
    }

    public function test_admin_can_queue_and_list_a_full_history_export(): void
    {
        Queue::fake();

        $response = $this->actingAs($this->admin)
            ->postJson('/api/analytics/exports', ['format' => 'xlsx'])
            ->assertAccepted()
            ->assertJsonPath('data.status', AnalyticsExport::STATUS_PENDING)
            ->assertJsonPath('data.format', 'xlsx');

        $exportId = $response->json('data.id');

        Queue::assertPushed(
            BuildAnalyticsExport::class,
            fn (BuildAnalyticsExport $job): bool => $job->exportId === $exportId,
        );

        $this->actingAs($this->admin)
            ->getJson('/api/analytics/exports')
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.id', $exportId);
    }

    public function test_export_job_builds_excel_and_notifies_the_requesting_user(): void
    {
        Storage::fake('local');
        $export = AnalyticsExport::query()->create([
            'user_id' => $this->admin->id,
            'status' => AnalyticsExport::STATUS_PENDING,
            'format' => 'xlsx',
        ]);

        (new BuildAnalyticsExport($export->id))->handle(app(AnalyticsExportService::class));

        $export->refresh();
        $this->assertSame(AnalyticsExport::STATUS_READY, $export->status);
        $this->assertGreaterThan(0, $export->row_count);
        $this->assertGreaterThan(0, $export->byte_size);
        $this->assertNotNull($export->expires_at);
        $this->assertStringEndsWith('.xlsx', $export->file_name);
        Storage::disk('local')->assertExists($export->file_path);
        $this->assertDatabaseHas('notifications', [
            'recipient_id' => $this->admin->id,
            'type' => 'analytics_export_ready',
            'related_id' => $export->id,
        ]);
    }

    public function test_only_export_owner_can_download_a_ready_file(): void
    {
        Storage::fake('local');
        $path = "analytics-exports/{$this->admin->id}/ready.csv";
        Storage::disk('local')->put($path, "Header\nValue\n");
        $export = AnalyticsExport::query()->create([
            'user_id' => $this->admin->id,
            'status' => AnalyticsExport::STATUS_READY,
            'format' => 'csv',
            'file_path' => $path,
            'file_name' => 'ready.csv',
            'completed_at' => now(),
            'expires_at' => now()->addDay(),
        ]);
        $otherAdmin = User::factory()->role('admin', 'Other admin')->create();

        $this->actingAs($otherAdmin)
            ->get("/api/analytics/exports/{$export->id}/download")
            ->assertForbidden();

        $this->actingAs($this->admin)
            ->get("/api/analytics/exports/{$export->id}/download")
            ->assertOk()
            ->assertDownload('ready.csv');
    }

    public function test_nurses_cannot_queue_or_list_exports(): void
    {
        $this->actingAs($this->nurse)
            ->postJson('/api/analytics/exports')
            ->assertForbidden();

        $this->actingAs($this->nurse)
            ->getJson('/api/analytics/exports')
            ->assertForbidden();
    }
}
