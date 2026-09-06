<?php

namespace Tests\Feature;

use App\Models\ActionItem;
use App\Models\Notification;
use App\Models\Report;
use App\Models\User;
use Database\Seeders\AppSettingSeeder;
use Database\Seeders\BackfillTemplatePresentationSeeder;
use Database\Seeders\DepartmentSeeder;
use Database\Seeders\DevClinicalDataSeeder;
use Database\Seeders\DevUserSeeder;
use Database\Seeders\ReportFieldDefinitionSeeder;
use Database\Seeders\ReportingPeriodSeeder;
use Database\Seeders\ReportTemplateSeeder;
use Database\Seeders\RoleSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * QA-002: the local fixture is the foundation of the Playwright gate, the
 * Lighthouse job and every developer or staging setup, yet nothing exercised
 * it in the suite. A refactor of CriticalEventAlertService::notify() changed
 * its signature and `db:seed` threw a TypeError for weeks without any test
 * noticing. This runs the clinical fixture (two weeks deep, so it stays fast)
 * through the same seeder classes `db:seed` uses.
 */
class DevSeederSmokeTest extends TestCase
{
    use RefreshDatabase;

    public function test_the_local_clinical_fixture_seeds_through_the_live_alert_service(): void
    {
        // The dev seeders self-guard against the testing environment; impersonate
        // the local environment for this test only (the container is rebuilt per test).
        $this->app['env'] = 'local';
        config(['reports.dev_seed.history_weeks' => 2]);

        foreach ([
            RoleSeeder::class,
            ReportTemplateSeeder::class,
            DepartmentSeeder::class,
            ReportFieldDefinitionSeeder::class,
            BackfillTemplatePresentationSeeder::class,
            AppSettingSeeder::class,
            ReportingPeriodSeeder::class,
            DevUserSeeder::class,
            DevClinicalDataSeeder::class,
        ] as $seeder) {
            $this->seed($seeder);
        }

        $this->assertTrue(User::query()->where('username', 'admin1')->exists(), 'DevUserSeeder must create the dev admin');
        $this->assertGreaterThan(0, Report::query()->count(), 'the clinical fixture must create reports');
        $this->assertGreaterThan(0, Report::query()->whereNotNull('submitted_at')->count());

        // The alert pass is what broke: it must raise action items and
        // notifications through CriticalEventAlertService::notify().
        $this->assertGreaterThan(0, ActionItem::query()->where('source', 'critical_event')->count());

        $alerts = Notification::query()->where('type', 'critical_value_alert')->get();
        $this->assertGreaterThan(0, $alerts->count());
        foreach ($alerts as $alert) {
            $this->assertMatchesRegularExpression('#^/admin/action-items\?item=[0-9a-f-]{36}$#', (string) $alert->related_route);
            $this->assertSame('action_item', $alert->related_entity);
        }
    }
}
