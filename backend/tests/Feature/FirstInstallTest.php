<?php

namespace Tests\Feature;

use App\Models\AppSetting;
use App\Models\Department;
use App\Models\ReportFieldDefinition;
use App\Models\ReportingPeriod;
use App\Models\ReportTemplate;
use App\Models\Role;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

/**
 * QA-007: the documented first install migrated the database but never seeded
 * reference data, and creating the maintenance account then failed on the
 * users.role_key foreign key. This pins the sequence deploy.sh now runs
 * (migrate, app:seed-reference-data) followed by app:create-superadmin, and
 * proves the seeding step is idempotent and never runs the dev fixture.
 */
class FirstInstallTest extends TestCase
{
    use RefreshDatabase;

    public function test_a_freshly_migrated_database_needs_reference_data_before_the_maintenance_account(): void
    {
        // A freshly migrated database is not quite empty: a data migration
        // inserts the student_rep role row. Everything else is missing.
        $this->assertLessThan(5, Role::query()->count(), 'RefreshDatabase gives a migrated but unseeded database');
        $this->assertSame(0, ReportTemplate::query()->count());
        $this->assertSame(0, Department::query()->count());

        // The maintenance account cannot exist yet: users.role_key references roles.
        $this->artisan('app:create-superadmin', [
            '--email' => 'too.early@hospital.internal',
            '--username' => 'too.early',
            '--full-name' => 'Too Early',
            '--password' => 'FirstInstall2026!',
        ])
            ->expectsOutputToContain('app:seed-reference-data')
            ->assertExitCode(1);
        $this->assertSame(0, User::query()->count());

        Artisan::call('app:launch-readiness');
        $this->assertMatchesRegularExpression('/FAIL\s*\|\s*Reference data seeded/', Artisan::output());

        $this->artisan('app:seed-reference-data')
            ->expectsOutputToContain('Reference data seeded')
            ->assertExitCode(0);

        $this->assertGreaterThanOrEqual(5, Role::query()->count());
        $this->assertGreaterThan(0, ReportTemplate::query()->count());
        $this->assertGreaterThan(0, Department::query()->count());
        $this->assertGreaterThan(0, ReportFieldDefinition::query()->count());
        $this->assertGreaterThan(0, AppSetting::query()->count());
        $this->assertGreaterThan(0, ReportingPeriod::query()->count());
        $this->assertSame(0, User::query()->count(), 'reference seeding must never create the dev fixture accounts');

        Artisan::call('app:launch-readiness');
        $this->assertMatchesRegularExpression('/PASS\s*\|\s*Reference data seeded/', Artisan::output());

        $this->artisan('app:create-superadmin', [
            '--email' => 'maintenance@hospital.internal',
            '--username' => 'maintenance',
            '--full-name' => 'Maintenance Owner',
            '--password' => 'FirstInstall2026!',
        ])->assertExitCode(0);

        $this->assertSame('superadmin', User::query()->where('email', 'maintenance@hospital.internal')->value('role_key'));
        $this->assertSame(1, User::query()->count());
    }

    public function test_reference_seeding_is_idempotent_and_skips_once_roles_exist(): void
    {
        $this->artisan('app:seed-reference-data')->assertExitCode(0);
        $counts = $this->referenceCounts();

        // A template edited by an administrator after go-live must survive a re-deploy.
        $template = ReportTemplate::query()->firstOrFail();
        $template->forceFill(['name' => 'Renamed by the department'])->save();

        $this->artisan('app:seed-reference-data')
            ->expectsOutputToContain('already present')
            ->assertExitCode(0);

        $this->assertSame($counts, $this->referenceCounts());
        $this->assertSame('Renamed by the department', $template->fresh()->name);
    }

    public function test_reference_seeding_refuses_an_unmigrated_database(): void
    {
        // An empty in-memory connection stands in for a database that was
        // never migrated. No DDL on the test database: MariaDB refuses to drop
        // a table other tables reference, and a drop would outlive the test's
        // transaction there.
        config(['database.connections.unmigrated' => [
            'driver' => 'sqlite',
            'database' => ':memory:',
            'prefix' => '',
            'foreign_key_constraints' => true,
        ]]);
        $previous = DB::getDefaultConnection();
        DB::setDefaultConnection('unmigrated');

        try {
            $this->assertFalse(Schema::hasTable('roles'));

            $this->artisan('app:seed-reference-data')
                ->expectsOutputToContain('not migrated')
                ->assertExitCode(1);
        } finally {
            DB::setDefaultConnection($previous);
            DB::purge('unmigrated');
        }
    }

    /**
     * @return array<string, int>
     */
    private function referenceCounts(): array
    {
        return collect(['roles', 'report_templates', 'departments', 'report_field_definitions', 'app_settings', 'reporting_periods'])
            ->mapWithKeys(fn (string $table) => [$table => (int) DB::table($table)->count()])
            ->all();
    }
}
