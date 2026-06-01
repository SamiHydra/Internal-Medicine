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
            AppSettingSeeder::class,
            ReportingPeriodSeeder::class,
            // Local-dev login accounts. Self-guards against production/testing.
            DevUserSeeder::class,
        ]);
    }
}
