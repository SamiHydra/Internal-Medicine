<?php

namespace Database\Seeders;

use Illuminate\Database\Console\Seeds\WithoutModelEvents;
use Illuminate\Database\Seeder;

class DatabaseSeeder extends Seeder
{
    use WithoutModelEvents;

    /**
     * Production-safe reference data. Every seeder here is idempotent and
     * edit-safe, and `php artisan app:seed-reference-data` runs exactly this
     * list on the department server (deploy.sh calls it after every migration;
     * it no-ops once roles exist). Keep the order: later seeders depend on the
     * rows of earlier ones.
     *
     * @var list<class-string<Seeder>>
     */
    public const REFERENCE_SEEDERS = [
        RoleSeeder::class,
        ReportTemplateSeeder::class,
        DepartmentSeeder::class,
        ReportFieldDefinitionSeeder::class,
        // Enrich template/field rows with the presentation metadata that
        // previously lived only in the frontend config. Idempotent + edit-safe.
        BackfillTemplatePresentationSeeder::class,
        AppSettingSeeder::class,
        ReportingPeriodSeeder::class,
    ];

    /**
     * Local fixture only. Every class self-guards against the production and
     * testing environments, so `db:seed` on the server stops after the
     * reference list above.
     *
     * @var list<class-string<Seeder>>
     */
    public const DEVELOPMENT_SEEDERS = [
        // Local-dev login accounts.
        DevUserSeeder::class,
        // Realistic, validation-consistent clinical data for every ward/clinic/
        // procedure unit so the dashboards render with believable shape.
        DevClinicalDataSeeder::class,
        // Operational demo rows for the V2 academic module (roster, rotations,
        // morning session, undergraduate) so those surfaces are explorable
        // instead of empty.
        DevAcademicDataSeeder::class,
        // The academic seeder builds its year of history once and then
        // guards it, so a fixture seeded months ago stops dead at that
        // date. This carries the operational rows forward to today for
        // every section. Gap-driven, so it is a no-op when nothing is
        // missing.
        DevAcademicGapSeeder::class,
        // Audit trails and the approval queues, which depend on the users,
        // reports and sections all three seeders above create.
        DevGovernanceDataSeeder::class,
    ];

    /**
     * Seed the application's database.
     */
    public function run(): void
    {
        $this->call([
            ...self::REFERENCE_SEEDERS,
            ...self::DEVELOPMENT_SEEDERS,
        ]);
    }
}
