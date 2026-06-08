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
        ]);
    }
}
