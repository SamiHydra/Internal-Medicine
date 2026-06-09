<?php

namespace Tests\Feature;

use App\Models\Department;
use App\Models\Report;
use App\Models\ReportAssignment;
use App\Models\ReportFieldValue;
use App\Models\ReportingPeriod;
use App\Models\ReportTemplate;
use App\Models\User;
use App\Services\Reports\ReportImportService;
use App\Services\Reports\ReportImportTemplateService;
use Database\Seeders\AppSettingSeeder;
use Database\Seeders\DepartmentSeeder;
use Database\Seeders\ReportFieldDefinitionSeeder;
use Database\Seeders\ReportTemplateSeeder;
use Database\Seeders\RoleSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Tests\TestCase;

class ReportImportTest extends TestCase
{
    use RefreshDatabase;

    private User $admin;

    private User $nurse;

    private ReportAssignment $assignment;

    private ReportingPeriod $period;

    private string $departmentSlug = 'gi_neuro_inpatient';

    protected function setUp(): void
    {
        parent::setUp();

        foreach ([RoleSeeder::class, ReportTemplateSeeder::class, DepartmentSeeder::class, ReportFieldDefinitionSeeder::class, AppSettingSeeder::class] as $seeder) {
            $this->seed($seeder);
        }

        $this->admin = User::factory()->role('admin', 'Administrator')->create(['full_name' => 'Admin One']);
        $this->nurse = User::factory()->create(['username' => 'hana.abera']);

        $template = ReportTemplate::query()->where('slug', 'inpatient_weekly')->firstOrFail();
        $department = Department::query()->where('slug', $this->departmentSlug)->firstOrFail();

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

    /**
     * @param  list<array<int, string>>  $rows
     */
    private function csvContent(array $rows): string
    {
        $handle = fopen('php://temp', 'r+');
        fputcsv($handle, ReportImportTemplateService::HEADER);
        foreach ($rows as $row) {
            fputcsv($handle, $row);
        }
        rewind($handle);
        $content = stream_get_contents($handle);
        fclose($handle);

        return $content;
    }

    /**
     * @param  list<array<int, string>>  $rows
     */
    private function csvFile(array $rows): UploadedFile
    {
        return UploadedFile::fake()->createWithContent('import.csv', $this->csvContent($rows));
    }

    /**
     * A full template row with explicit day values; blanks where not given.
     *
     * @param  array<string, string>  $days
     */
    private function fieldRow(string $section, string $fieldKey, array $days = []): array
    {
        $row = ['2026-05-25', 'GI/Neurology', $this->departmentSlug, $section, $fieldKey, $fieldKey];
        foreach (['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] as $day) {
            $row[] = $days[$day] ?? '';
        }

        return $row;
    }

    /**
     * Build a template data row: [week, dept, slug, section, field label, field key, mon..sun].
     */
    private function row(string $fieldKey, int $monday): array
    {
        return ['2026-05-25', 'GI/Neurology', $this->departmentSlug, 'patient_flow', $fieldKey, $fieldKey, (string) $monday, '', '', '', '', '', ''];
    }

    public function test_admin_can_import_a_csv_and_values_are_persisted(): void
    {
        $file = $this->csvFile([
            $this->row('total_admitted_patients', 6),
            $this->row('new_admitted_patients', 3),
        ]);

        $this->actingAs($this->admin)
            ->post('/api/admin/reports/import', ['file' => $file])
            ->assertOk()
            ->assertJsonPath('imported', 1)
            ->assertJsonPath('reports', 1)
            ->assertJsonPath('errors', []);

        $report = Report::query()->where('reporting_period_id', $this->period->id)->firstOrFail();
        $this->assertSame('draft', $report->status);
        $this->assertDatabaseHas('report_field_values', [
            'report_id' => $report->id,
            'day_name' => 'monday',
            'value_number' => 6,
        ]);
    }

    public function test_import_rejects_rows_that_violate_quality_rules(): void
    {
        // hai subtype (2) exceeds total_hai (1) — a blocking cross-field rule.
        $file = $this->csvFile([
            ['2026-05-25', 'GI/Neurology', $this->departmentSlug, 'quality_safety', 'total_hai', 'total_hai', '1', '', '', '', '', '', ''],
            ['2026-05-25', 'GI/Neurology', $this->departmentSlug, 'quality_safety', 'hai_clabsi', 'hai_clabsi', '2', '', '', '', '', '', ''],
        ]);

        $this->actingAs($this->admin)
            ->post('/api/admin/reports/import', ['file' => $file])
            ->assertStatus(422)
            ->assertJsonPath('imported', 0)
            ->assertJsonPath('skipped', 1);

        // The whole group rolled back — nothing persisted.
        $this->assertSame(0, Report::query()->count());
    }

    public function test_import_reports_unknown_department(): void
    {
        $file = $this->csvFile([
            ['2026-05-25', 'Nowhere', 'no_such_department', 'patient_flow', 'total_admitted_patients', 'total_admitted_patients', '4', '', '', '', '', '', ''],
        ]);

        $this->actingAs($this->admin)
            ->post('/api/admin/reports/import', ['file' => $file])
            ->assertStatus(422)
            ->assertJsonPath('imported', 0);
    }

    public function test_template_export_round_trips_through_import(): void
    {
        // Seed a value, export the template (pre-filled), then re-import it.
        ReportFieldValue::query();
        $this->actingAs($this->admin)->post('/api/admin/reports/import', [
            'file' => $this->csvFile([$this->row('total_patient_days', 9)]),
        ])->assertOk();

        $built = app(ReportImportTemplateService::class)->build($this->period);
        $cellRows = array_merge([$built['header']], $built['rows']);

        $result = app(ReportImportService::class)->import($cellRows, $this->admin, false);

        $this->assertGreaterThanOrEqual(1, $result['imported']);
        $this->assertDatabaseHas('report_field_values', [
            'day_name' => 'monday',
            'value_number' => 9,
        ]);
    }

    public function test_admin_can_import_an_xlsx_file(): void
    {
        $path = (new \App\Support\Export\XlsxWriter())->toTempFile(
            ReportImportTemplateService::HEADER,
            [$this->row('total_admitted_patients', 8)],
        );
        $file = new UploadedFile($path, 'import.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', null, true);

        $this->actingAs($this->admin)
            ->post('/api/admin/reports/import', ['file' => $file])
            ->assertOk()
            ->assertJsonPath('imported', 1);

        $this->assertDatabaseHas('report_field_values', ['day_name' => 'monday', 'value_number' => 8]);
    }

    public function test_admin_can_download_the_import_template(): void
    {
        $response = $this->actingAs($this->admin)
            ->get('/api/admin/reports/import-template?format=xlsx&period='.$this->period->id);

        $response->assertOk();
        $response->assertHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');

        $zip = new \ZipArchive();
        $zip->open($response->baseResponse->getFile()->getPathname());
        $sheet = (string) $zip->getFromName('xl/worksheets/sheet1.xml');
        $zip->close();
        $this->assertStringContainsString('total_admitted_patients', $sheet);
    }

    public function test_import_clears_a_value_when_the_cell_is_blanked(): void
    {
        // Seed Monday = 5, then re-import the same field row with Monday blank.
        $this->actingAs($this->admin)->post('/api/admin/reports/import', [
            'file' => $this->csvFile([$this->fieldRow('patient_flow', 'total_admitted_patients', ['monday' => '5'])]),
        ])->assertOk();
        $this->assertDatabaseHas('report_field_values', ['day_name' => 'monday', 'value_number' => 5]);

        $this->actingAs($this->admin)->post('/api/admin/reports/import', [
            'file' => $this->csvFile([$this->fieldRow('patient_flow', 'total_admitted_patients', [])]),
        ])->assertOk();

        // The cleared offline cell erased the stored value (parity with the web form).
        $this->assertDatabaseMissing('report_field_values', ['day_name' => 'monday', 'value_number' => 5]);
    }

    public function test_import_rejects_an_out_of_range_value_without_a_500(): void
    {
        $this->actingAs($this->admin)
            ->post('/api/admin/reports/import', [
                'file' => $this->csvFile([$this->fieldRow('patient_flow', 'total_admitted_patients', ['monday' => '99999999999'])]),
            ])
            ->assertStatus(422)
            ->assertJsonPath('imported', 0);

        $this->assertSame(0, \App\Models\ReportFieldValue::query()->count());
    }

    public function test_import_handles_a_utf8_bom_csv(): void
    {
        $content = "\xEF\xBB\xBF".$this->csvContent([$this->fieldRow('patient_flow', 'total_admitted_patients', ['monday' => '4'])]);
        $file = UploadedFile::fake()->createWithContent('import.csv', $content);

        $this->actingAs($this->admin)
            ->post('/api/admin/reports/import', ['file' => $file])
            ->assertOk()
            ->assertJsonPath('imported', 1);
    }

    public function test_template_export_neutralizes_formula_injection(): void
    {
        // A nurse-entered text value starting with '=' must not execute in Excel.
        $this->actingAs($this->admin)->post('/api/admin/reports/import', [
            'file' => $this->csvFile([$this->fieldRow('staffing', 'nurse_in_charge', ['monday' => '=HACK()'])]),
        ])->assertOk();

        $csv = $this->actingAs($this->admin)
            ->get('/api/admin/reports/import-template?format=csv&period='.$this->period->id)
            ->streamedContent();

        $this->assertStringContainsString("'=HACK()", $csv);
    }

    public function test_import_unsanitizes_a_guarded_formula_value_on_round_trip(): void
    {
        // A downloaded template carries the guard apostrophe; import must strip it.
        $this->actingAs($this->admin)->post('/api/admin/reports/import', [
            'file' => $this->csvFile([$this->fieldRow('staffing', 'nurse_in_charge', ['monday' => "'=HACK()"])]),
        ])->assertOk();

        $this->assertDatabaseHas('report_field_values', ['day_name' => 'monday', 'value_text' => '=HACK()']);
    }

    public function test_nurses_cannot_import_or_download_templates(): void
    {
        $this->actingAs($this->nurse)
            ->post('/api/admin/reports/import', ['file' => $this->csvFile([$this->row('total_admitted_patients', 1)])])
            ->assertForbidden();

        $this->actingAs($this->nurse)
            ->get('/api/admin/reports/import-template?period='.$this->period->id)
            ->assertForbidden();
    }
}
