<?php

namespace Tests\Feature;

use App\Models\Department;
use App\Models\EvaluationForm;
use App\Support\Academic\EvaluationScoring;
use Database\Seeders\DepartmentSeeder;
use Database\Seeders\ReportTemplateSeeder;
use Database\Seeders\RoleSeeder;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * Guards on the schema itself rather than on any one endpoint: the two enum
 * columns whose SQLite CHECK a table rebuild silently dropped, and the
 * rollback that has to be a real inverse of its own up().
 */
class SchemaConstraintTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();

        foreach ([RoleSeeder::class, ReportTemplateSeeder::class, DepartmentSeeder::class] as $seeder) {
            $this->seed($seeder);
        }
    }

    /**
     * The test suite runs on SQLite and the deployment runs on MariaDB, so an
     * enum that only one of them enforces is a regression the suite cannot
     * see. Both writes must fail on both engines.
     */
    public function test_an_out_of_range_department_family_is_rejected(): void
    {
        $department = Department::query()->firstOrFail();

        $this->assertWriteIsRejected(
            fn () => DB::table('departments')->where('id', $department->id)->update(['family' => 'bogus_value']),
            'departments.family accepted a value outside its enum.',
        );

        $this->assertWriteIsRejected(
            fn () => DB::table('departments')->insert([
                'id' => (string) Str::uuid(),
                'slug' => 'bogus-family-probe',
                'family' => 'bogus_value',
                'template_id' => $department->template_id,
                'name' => 'Bogus Family Probe',
                'description' => 'Schema guard probe.',
                'active' => true,
                'created_at' => now(),
                'updated_at' => now(),
            ]),
            'departments.family accepted an insert outside its enum.',
        );

        $this->assertSame('inpatient', DB::table('departments')->where('id', $department->id)->value('family'));
    }

    public function test_an_out_of_range_admin_access_request_status_is_rejected(): void
    {
        $this->assertWriteIsRejected(
            fn () => DB::table('admin_access_requests')->insert([
                'id' => (string) Str::uuid(),
                'full_name' => 'Status Probe',
                'email' => 'status.probe@example.test',
                'password' => 'hashed',
                'requested_role' => 'admin',
                'status' => 'bogus_value',
                'requested_at' => now(),
                'created_at' => now(),
                'updated_at' => now(),
            ]),
            'admin_access_requests.status accepted a value outside its enum.',
        );

        $this->assertDatabaseCount('admin_access_requests', 0);
    }

    /**
     * The rollback restores core status and NOTHING else. Force-setting
     * `active` re-enabled retired score items and silently moved the
     * denominator of every computed score (EvaluationScoring::activeItems).
     */
    public function test_rolling_back_the_core_field_contract_leaves_the_active_flags_alone(): void
    {
        $consultantForm = EvaluationForm::query()
            ->where('key', 'consultant_mdt')
            ->where('status', 'published')
            ->firstOrFail();

        $retired = 'vte_assessed';
        DB::table('evaluation_form_fields')
            ->where('form_id', $consultantForm->id)
            ->where('key', $retired)
            ->update(['active' => false, 'updated_at' => now()]);

        $accountability = ['presence_minutes', 'senior_joined_at', 'senior_present'];
        $this->assertSame($accountability, $this->coreKeys($consultantForm->id, $accountability));

        $migration = require database_path('migrations/2026_08_30_000040_restore_evaluation_core_field_contract.php');
        $migration->down();

        $this->assertFalse(
            (bool) DB::table('evaluation_form_fields')
                ->where('form_id', $consultantForm->id)
                ->where('key', $retired)
                ->value('active'),
            'A rollback must not re-enable a field an admin deliberately retired.',
        );

        // The pre-migration core set is restored, and only that set: the four
        // accountability fields are cleared so the result is a state an up()
        // actually produces rather than the union of both.
        $expected = EvaluationScoring::CONSULTANT_SCORE_ITEMS;
        sort($expected);
        $this->assertSame($expected, $this->coreKeys($consultantForm->id));

        $migration->up();

        $this->assertSame($accountability, $this->coreKeys($consultantForm->id, $accountability));
        $this->assertSame([], $this->coreKeys($consultantForm->id, EvaluationScoring::CONSULTANT_SCORE_ITEMS));
    }

    /**
     * @param  list<string>|null  $limitTo
     * @return list<string>
     */
    private function coreKeys(string $formId, ?array $limitTo = null): array
    {
        $keys = DB::table('evaluation_form_fields')
            ->where('form_id', $formId)
            ->where('is_core', true)
            ->when($limitTo !== null, fn ($query) => $query->whereIn('key', $limitTo))
            ->pluck('key')
            ->all();

        sort($keys);

        return $keys;
    }

    private function assertWriteIsRejected(callable $write, string $message): void
    {
        try {
            $write();
        } catch (QueryException) {
            return;
        }

        $this->fail($message);
    }
}
