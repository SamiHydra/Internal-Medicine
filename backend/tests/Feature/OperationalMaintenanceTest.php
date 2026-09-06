<?php

namespace Tests\Feature;

use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\TestCase;

class OperationalMaintenanceTest extends TestCase
{
    use RefreshDatabase;

    public function test_operational_prune_removes_only_expired_session_and_cache_rows(): void
    {
        DB::table('sessions')->insert([
            [
                'id' => 'expired-session',
                'user_id' => null,
                'ip_address' => null,
                'user_agent' => null,
                'payload' => '',
                'last_activity' => now()->subHours(3)->timestamp,
            ],
            [
                'id' => 'active-session',
                'user_id' => null,
                'ip_address' => null,
                'user_agent' => null,
                'payload' => '',
                'last_activity' => now()->timestamp,
            ],
        ]);
        DB::table('cache')->insert([
            ['key' => 'expired', 'value' => 'x', 'expiration' => now()->subMinute()->timestamp],
            ['key' => 'active', 'value' => 'x', 'expiration' => now()->addHour()->timestamp],
        ]);
        DB::table('cache_locks')->insert([
            ['key' => 'expired-lock', 'owner' => 'test', 'expiration' => now()->subMinute()->timestamp],
            ['key' => 'active-lock', 'owner' => 'test', 'expiration' => now()->addHour()->timestamp],
        ]);
        DB::table('performance_metrics')->insert([
            [
                'user_id' => null,
                'metric' => 'LCP',
                'value' => 1800,
                'route_name' => '/admin',
                'device_class' => 'desktop',
                'release_sha' => 'old',
                'created_at' => now()->subDays(91),
            ],
            [
                'user_id' => null,
                'metric' => 'CLS',
                'value' => 0.01,
                'route_name' => '/admin',
                'device_class' => 'mobile',
                'release_sha' => 'current',
                'created_at' => now()->subDays(2),
            ],
        ]);

        $this->artisan('app:prune-operational-data')
            ->expectsOutputToContain('1 expired sessions pruned.')
            ->expectsOutputToContain('1 real-user performance metrics older than 90 days pruned.')
            ->expectsOutputToContain('Skipped report audit rows; retention is disabled.')
            ->assertExitCode(0);

        $this->assertDatabaseMissing('sessions', ['id' => 'expired-session']);
        $this->assertDatabaseHas('sessions', ['id' => 'active-session']);
        $this->assertDatabaseMissing('cache', ['key' => 'expired']);
        $this->assertDatabaseHas('cache', ['key' => 'active']);
        $this->assertDatabaseMissing('cache_locks', ['key' => 'expired-lock']);
        $this->assertDatabaseHas('cache_locks', ['key' => 'active-lock']);
        $this->assertDatabaseMissing('performance_metrics', ['release_sha' => 'old']);
        $this->assertDatabaseHas('performance_metrics', ['release_sha' => 'current']);
    }

    public function test_transient_retry_leaves_unapproved_failed_job_types_untouched(): void
    {
        $uuid = (string) Str::uuid();
        DB::table('failed_jobs')->insert([
            'uuid' => $uuid,
            'connection' => 'sync',
            'queue' => 'default',
            'payload' => json_encode(['displayName' => 'App\\Jobs\\UnsafeBusinessMutation']),
            'exception' => 'Connection timed out',
            'failed_at' => now(),
        ]);

        $this->artisan('queue:retry-transient')
            ->expectsOutput('Retried 0 recent transient failed job(s).')
            ->assertExitCode(0);

        $this->assertDatabaseHas('failed_jobs', ['uuid' => $uuid]);
    }
}
