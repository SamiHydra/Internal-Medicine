<?php

namespace App\Console\Commands;

use Database\Seeders\DatabaseSeeder;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * First-install reference data (QA-007). A migrated database has no roles,
 * templates, departments, field definitions, settings or reporting periods,
 * and `app:create-superadmin` fails on it with a foreign-key error because
 * users.role_key references roles. deploy.sh runs this after every migration;
 * it is a no-op once roles exist, so a re-deploy never touches admin-edited
 * reference rows, and only the production-safe seeders are ever run here.
 */
class SeedReferenceData extends Command
{
    protected $signature = 'app:seed-reference-data
        {--force : Re-run the reference seeders even when reference data already exists}';

    protected $description = 'Seed the production-safe reference data (roles, templates, departments, field definitions, settings, reporting periods) on a fresh database.';

    public function handle(): int
    {
        if (! Schema::hasTable('roles')) {
            $this->error('The database is not migrated yet. Run php artisan migrate --force first.');

            return self::FAILURE;
        }

        if (self::referenceDataPresent() && ! $this->option('force')) {
            $this->info(sprintf(
                'Reference data already present (%d roles, %d templates); nothing to seed. Use --force to re-run the reference seeders.',
                (int) DB::table('roles')->count(),
                (int) DB::table('report_templates')->count(),
            ));

            return self::SUCCESS;
        }

        foreach (DatabaseSeeder::REFERENCE_SEEDERS as $seeder) {
            $this->line(sprintf('Seeding %s', class_basename($seeder)));

            $exitCode = $this->call('db:seed', ['--class' => $seeder, '--force' => true]);

            if ($exitCode !== self::SUCCESS) {
                $this->error(sprintf('%s failed (exit code %d).', class_basename($seeder), $exitCode));

                return self::FAILURE;
            }
        }

        $this->info('Reference data seeded. First install only: create the maintenance account next with php artisan app:create-superadmin.');

        return self::SUCCESS;
    }

    /**
     * "Present" means the full role catalogue plus the clinical reference
     * tables. A freshly migrated database is NOT empty: data migrations insert
     * the student_rep role row, so a bare row count would wrongly report a new
     * server as already seeded and leave it without templates or departments.
     */
    public static function referenceDataPresent(): bool
    {
        $roleKeys = DB::table('roles')->pluck('role_key')->all();

        foreach (['superadmin', 'admin', 'nurse', 'resident', 'consultant', 'student_rep'] as $required) {
            if (! in_array($required, $roleKeys, true)) {
                return false;
            }
        }

        return DB::table('report_templates')->count() > 0
            && DB::table('departments')->count() > 0
            && DB::table('report_field_definitions')->count() > 0;
    }
}
