<?php

namespace Tests\Feature;

use App\Models\AnalyticsExport;
use App\Models\User;
use Database\Seeders\RoleSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
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

    public function test_expired_analytics_exports_are_pruned_with_their_files_but_only_when_configured(): void
    {
        $this->seed(RoleSeeder::class);
        Storage::fake('local');
        $user = User::factory()->create();

        $old = AnalyticsExport::query()->create([
            'user_id' => $user->id,
            'status' => AnalyticsExport::STATUS_READY,
            'format' => 'csv',
            'filters' => [],
            'file_path' => "analytics-exports/{$user->id}/old.csv",
            'file_name' => 'old.csv',
            'row_count' => 1,
            'byte_size' => 4,
            'completed_at' => now()->subDays(40),
            'expires_at' => now()->subDays(33),
        ]);
        $old->forceFill(['created_at' => now()->subDays(40)])->save();

        $recent = AnalyticsExport::query()->create([
            'user_id' => $user->id,
            'status' => AnalyticsExport::STATUS_READY,
            'format' => 'csv',
            'filters' => [],
            'file_path' => "analytics-exports/{$user->id}/recent.csv",
            'file_name' => 'recent.csv',
            'row_count' => 1,
            'byte_size' => 4,
            'completed_at' => now()->subDay(),
            'expires_at' => now()->addDays(6),
        ]);

        Storage::disk('local')->put($old->file_path, 'rows');
        Storage::disk('local')->put($recent->file_path, 'rows');

        // Disabled by default for the audit trails, but exports default to 30
        // days; 0 must keep everything.
        config(['reports.retention.export_days' => 0]);
        $this->artisan('app:prune-operational-data')->assertSuccessful();
        $this->assertSame(2, AnalyticsExport::query()->count());

        config(['reports.retention.export_days' => 30]);
        $this->artisan('app:prune-operational-data --dry-run')->assertSuccessful();
        $this->assertSame(2, AnalyticsExport::query()->count(), 'a dry run must delete nothing');
        Storage::disk('local')->assertExists($old->file_path);

        $this->artisan('app:prune-operational-data')->assertSuccessful();

        $this->assertNull(AnalyticsExport::query()->find($old->id));
        $this->assertNotNull(AnalyticsExport::query()->find($recent->id));
        Storage::disk('local')->assertMissing($old->file_path);
        Storage::disk('local')->assertExists($recent->file_path);
    }

    public function test_export_pruning_never_touches_a_path_outside_the_export_directory(): void
    {
        $this->seed(RoleSeeder::class);
        Storage::fake('local');
        $user = User::factory()->create();

        // A stray path (a bug, or a hand-edited row) must not widen the prune
        // into the evidence directory: only the row goes.
        $stray = AnalyticsExport::query()->create([
            'user_id' => $user->id,
            'status' => AnalyticsExport::STATUS_READY,
            'format' => 'csv',
            'filters' => [],
            'file_path' => 'action-item-evidence/keep-me.pdf',
            'file_name' => 'keep-me.pdf',
            'row_count' => 1,
            'byte_size' => 4,
            'completed_at' => now()->subDays(40),
            'expires_at' => now()->subDays(33),
        ]);
        $stray->forceFill(['created_at' => now()->subDays(40)])->save();
        Storage::disk('local')->put('action-item-evidence/keep-me.pdf', 'evidence');

        config(['reports.retention.export_days' => 30]);
        $this->artisan('app:prune-operational-data')->assertSuccessful();

        $this->assertNull(AnalyticsExport::query()->find($stray->id));
        Storage::disk('local')->assertExists('action-item-evidence/keep-me.pdf');
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
