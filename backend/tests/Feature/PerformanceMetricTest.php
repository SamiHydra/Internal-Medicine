<?php

namespace Tests\Feature;

use App\Models\User;
use Database\Seeders\RoleSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

class PerformanceMetricTest extends TestCase
{
    use RefreshDatabase;

    public function test_authenticated_client_can_store_content_free_performance_metric(): void
    {
        $this->seed(RoleSeeder::class);
        $user = User::factory()->role('admin', 'Administrator')->create();

        $this->actingAs($user)
            ->postJson('/api/performance/rum', [
                'metric' => 'route-transition',
                'value' => 187.4567,
                'routeName' => '/admin/departments/:departmentId',
                'deviceClass' => 'desktop',
                'releaseSha' => '072cd72',
                // Unknown content is discarded; the storage schema has no
                // patient, report, URL-query, or arbitrary-content columns.
                'reportContent' => 'must-not-be-stored',
            ])
            ->assertStatus(202)
            ->assertContent('');

        $this->assertDatabaseHas('performance_metrics', [
            'user_id' => $user->id,
            'metric' => 'route-transition',
            'value' => 187.457,
            'route_name' => '/admin/departments/:departmentId',
            'device_class' => 'desktop',
            'release_sha' => '072cd72',
        ]);
        $this->assertEqualsCanonicalizing([
            'id',
            'user_id',
            'metric',
            'value',
            'route_name',
            'device_class',
            'release_sha',
            'created_at',
        ], Schema::getColumnListing('performance_metrics'));
    }

    public function test_performance_metric_endpoint_requires_authentication_and_bounded_metadata(): void
    {
        $payload = [
            'metric' => 'LCP',
            'value' => 1200,
            'routeName' => '/admin',
            'deviceClass' => 'mobile',
            'releaseSha' => 'test',
        ];

        $this->postJson('/api/performance/rum', $payload)->assertUnauthorized();

        $this->seed(RoleSeeder::class);
        $user = User::factory()->role('admin', 'Administrator')->create();

        $this->actingAs($user)
            ->postJson('/api/performance/rum', [
                ...$payload,
                'routeName' => '/reports/patient name?diagnosis=private',
            ])
            ->assertUnprocessable()
            ->assertJsonValidationErrors('routeName');
    }
}
