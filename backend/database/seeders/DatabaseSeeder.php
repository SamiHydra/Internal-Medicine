<?php

namespace Database\Seeders;

use Illuminate\Database\Console\Seeds\WithoutModelEvents;
use Illuminate\Database\Seeder;

class DatabaseSeeder extends Seeder
{
    use WithoutModelEvents;

    /**
     * Seed the application's database.
     */
    public function run(): void
    {
        $this->call([
            RoleSeeder::class,
            ReportTemplateSeeder::class,
            DepartmentSeeder::class,
            ReportFieldDefinitionSeeder::class,
            // Enrich template/field rows with the presentation metadata that
            // previously lived only in the frontend config. Idempotent + edit-safe.
            BackfillTemplatePresentationSeeder::class,
            AppSettingSeeder::class,
            ReportingPeriodSeeder::class,
            // Local-dev login accounts. Self-guards against production/testing.
            DevUserSeeder::class,
            // Realistic, validation-consistent clinical data for every ward/clinic/
            // procedure unit so the dashboards render with believable shape.
            // Self-guards against production/testing.
            DevClinicalDataSeeder::class,
            // Operational demo rows for the V2 academic module (roster, rotations,
            // morning session, undergraduate) so those surfaces are explorable
            // instead of empty. Self-guards against production/testing.
            DevAcademicDataSeeder::class,
            // Audit trails and the approval queues, which depend on the users,
            // reports and sections all three seeders above create.
            // Self-guards against production/testing.
            DevGovernanceDataSeeder::class,
        ]);
    }
}
