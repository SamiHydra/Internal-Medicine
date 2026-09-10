<?php

namespace Tests\Feature;

use App\Models\User;
use App\Support\Observability\ErrorReporter;
use App\Support\Observability\Redactor;
use App\Support\Observability\Release;
use Database\Seeders\RoleSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Queue\Events\JobFailed;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Route;
use Tests\TestCase;

class ObservabilityTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();

        $this->seed(RoleSeeder::class);
        Release::forget();
    }

    public function test_client_errors_are_accepted_logged_and_forwarded_without_secrets(): void
    {
        config(['observability.webhook_url' => 'https://collector.example.test/ingest']);
        Http::fake();
        Log::spy();

        $this->postJson('/api/client-errors', [
            'kind' => 'unhandledrejection',
            'message' => 'TypeError: fetch failed for /reset-password?token=abcdef123456&email=nurse@example.org',
            'stack' => "at submit (app.js:1)\nAuthorization: Bearer abcdefghijklmnopqrstuvwxyz0123456789",
            'routeName' => '/reports/:assignmentId/:periodId',
            'status' => 500,
            'releaseSha' => 'b07b32c',
            'userAgent' => 'Mozilla/5.0 test',
        ])->assertStatus(202);

        Http::assertSent(function ($request): bool {
            $body = json_encode($request->data());

            return $request->url() === 'https://collector.example.test/ingest'
                && $request['kind'] === 'client_unhandledrejection'
                && $request['route'] === '/reports/:assignmentId/:periodId'
                && $request['clientRelease'] === 'b07b32c'
                && ! str_contains($body, 'abcdef123456')
                && ! str_contains($body, 'nurse@example.org')
                && ! str_contains($body, 'abcdefghijklmnopqrstuvwxyz0123456789')
                && str_contains($body, '[redacted]');
        });

        Log::shouldHaveReceived('warning')
            ->withArgs(fn (string $message, array $context): bool => $message === 'Client error'
                && ! str_contains(json_encode($context), 'abcdef123456'))
            ->once();

        $this->assertSame(1, ErrorReporter::counters()[ErrorReporter::SIGNAL_CLIENT_ERRORS]['lastHour']);
    }

    public function test_client_error_payloads_are_strictly_validated_and_rate_limited(): void
    {
        $this->postJson('/api/client-errors', [
            'kind' => 'anything',
            'message' => 'x',
            'routeName' => '/admin',
        ])->assertStatus(422);

        $this->postJson('/api/client-errors', [
            'kind' => 'error',
            'message' => str_repeat('a', 501),
            'routeName' => '/admin',
        ])->assertStatus(422);

        $this->postJson('/api/client-errors', [
            'kind' => 'error',
            'message' => 'boom',
            'routeName' => 'javascript:alert(1)',
        ])->assertStatus(422);

        config(['observability.client_errors.enabled' => false]);
        $this->postJson('/api/client-errors', [
            'kind' => 'error',
            'message' => 'boom',
            'routeName' => '/admin',
        ])->assertStatus(204);
    }

    public function test_client_error_endpoint_is_throttled_per_ip(): void
    {
        $limit = (int) config('observability.client_errors.per_minute', 20);

        for ($attempt = 0; $attempt < $limit; $attempt++) {
            $this->postJson('/api/client-errors', [
                'kind' => 'error',
                'message' => "boom {$attempt}",
                'routeName' => '/admin',
            ])->assertStatus(202);
        }

        $this->postJson('/api/client-errors', [
            'kind' => 'error',
            'message' => 'one too many',
            'routeName' => '/admin',
        ])->assertStatus(429);
    }

    public function test_unhandled_exceptions_are_counted_and_forwarded_with_request_context_only(): void
    {
        config(['observability.webhook_url' => 'https://collector.example.test/ingest']);
        Http::fake();

        Route::middleware('api')->get('/api/testing/observability-explode', function () {
            throw new \RuntimeException('Boom with password=hunter2 inside');
        });

        $this->getJson('/api/testing/observability-explode?token=secret-value-123')->assertStatus(500);

        Http::assertSent(function ($request): bool {
            $body = json_encode($request->data());

            return $request['kind'] === 'exception'
                && $request['class'] === \RuntimeException::class
                && $request['path'] === '/api/testing/observability-explode'
                && $request['status'] === 500
                && ! str_contains($body, 'hunter2')
                && ! str_contains($body, 'secret-value-123')
                && ! array_key_exists('body', $request->data())
                && ! array_key_exists('headers', $request->data());
        });

        $counters = ErrorReporter::counters();
        $this->assertSame(1, $counters[ErrorReporter::SIGNAL_EXCEPTIONS]['lastHour']);
        $this->assertSame(1, $counters[ErrorReporter::SIGNAL_SERVER_ERRORS]['lastHour']);
    }

    public function test_slow_requests_are_logged_with_duration_and_counted(): void
    {
        // Every request takes at least a millisecond; 0 would mean "disabled".
        config(['observability.slow_request_ms' => 1]);
        Log::spy();

        $this->getJson('/api/workspace')->assertStatus(401);

        Log::shouldHaveReceived('warning')
            ->withArgs(fn (string $message, array $context): bool => $message === 'Slow request'
                && $context['path'] === '/api/workspace'
                && array_key_exists('durationMs', $context)
                && ! array_key_exists('body', $context))
            ->atLeast()->once();

        $this->assertGreaterThanOrEqual(1, ErrorReporter::counters()[ErrorReporter::SIGNAL_SLOW_REQUESTS]['lastHour']);
    }

    public function test_responses_carry_server_timing_and_slow_logging_can_be_disabled(): void
    {
        config(['observability.slow_request_ms' => 1]);
        $response = $this->getJson('/api/workspace');
        $this->assertMatchesRegularExpression('/^app;dur=\d+$/', (string) $response->headers->get('Server-Timing'));

        config(['observability.slow_request_ms' => 0]);
        Log::spy();
        $this->getJson('/api/workspace');
        Log::shouldNotHaveReceived('warning');
    }

    public function test_failed_queue_jobs_are_counted_and_forwarded(): void
    {
        config(['observability.webhook_url' => 'https://collector.example.test/ingest']);
        Http::fake();

        $job = new class
        {
            public function resolveName(): string
            {
                return 'App\\Jobs\\BuildAnalyticsExport';
            }

            public function getQueue(): string
            {
                return 'analytics';
            }

            public function attempts(): int
            {
                return 3;
            }
        };

        event(new JobFailed('database', $job, new \RuntimeException('disk full while writing token=abc123def456')));

        Http::assertSent(fn ($request): bool => $request['kind'] === 'failed_job'
            && $request['job'] === 'App\\Jobs\\BuildAnalyticsExport'
            && $request['queue'] === 'analytics'
            && ! str_contains(json_encode($request->data()), 'abc123def456'));

        $this->assertSame(1, ErrorReporter::counters()[ErrorReporter::SIGNAL_FAILED_JOBS]['lastHour']);
    }

    public function test_webhook_failures_never_surface_and_nothing_is_sent_without_a_url(): void
    {
        config(['observability.webhook_url' => 'https://collector.example.test/ingest']);
        Http::fake(fn () => throw new \RuntimeException('connection refused'));

        $this->postJson('/api/client-errors', [
            'kind' => 'error',
            'message' => 'boom',
            'routeName' => '/admin',
        ])->assertStatus(202);

        config(['observability.webhook_url' => null]);
        Http::fake();
        $this->postJson('/api/client-errors', [
            'kind' => 'error',
            'message' => 'boom again',
            'routeName' => '/admin',
        ])->assertStatus(202);
        Http::assertNothingSent();
    }

    public function test_redactor_masks_credentials_and_addresses_but_keeps_the_message_readable(): void
    {
        $scrubbed = Redactor::scrubString('Login failed for nurse.abel@stpaulos.local with password=Secret123! token: abc, Bearer AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');

        $this->assertStringContainsString('n***@stpaulos.local', $scrubbed);
        $this->assertStringContainsString('password=[redacted]', $scrubbed);
        $this->assertStringNotContainsString('Secret123', $scrubbed);
        $this->assertStringNotContainsString('AAAAAAAAAAAAAAAAAAAA', $scrubbed);
        $this->assertStringContainsString('Login failed', $scrubbed);

        $array = Redactor::scrubArray([
            'password' => 'x',
            'nested' => ['api_key' => 'y', 'ok' => 'value'],
            'cookie' => 'z',
        ]);
        $this->assertSame('[redacted]', $array['password']);
        $this->assertSame('[redacted]', $array['nested']['api_key']);
        $this->assertSame('value', $array['nested']['ok']);
        $this->assertSame('[redacted]', $array['cookie']);
    }

    public function test_release_identification_prefers_environment_then_release_file(): void
    {
        config(['observability.release.sha' => 'abc123def', 'observability.release.built_at' => '2026-09-07T10:00:00Z']);
        Release::forget();
        $this->assertSame('abc123def', Release::sha());
        $this->assertSame('environment', Release::describe()['source']);

        $file = tempnam(sys_get_temp_dir(), 'release');
        file_put_contents($file, json_encode(['sha' => 'file999sha', 'builtAt' => '2026-09-06T00:00:00Z']));
        config(['observability.release.sha' => null, 'observability.release.built_at' => null, 'observability.release.file' => $file]);
        Release::forget();
        $this->assertSame('file999sha', Release::sha());
        $this->assertSame('release.json', Release::describe()['source']);
        unlink($file);

        config(['observability.release.file' => '/nonexistent/release.json']);
        Release::forget();
        $this->assertSame('unknown', Release::sha());
        Release::forget();
    }

    public function test_system_health_is_maintenance_only_and_never_leaks_secrets(): void
    {
        $nurse = User::factory()->create();
        $admin = User::factory()->role('admin', 'Administrator')->create();
        $superadmin = User::factory()->role('superadmin', 'Maintenance')->create();

        $this->getJson('/api/admin/system-health')->assertStatus(401);
        $this->actingAs($nurse)->getJson('/api/admin/system-health')->assertForbidden();
        $this->actingAs($admin)->getJson('/api/admin/system-health')->assertForbidden();

        Cache::put('scheduler:heartbeat', now()->subSeconds(30)->toIso8601String(), 3600);
        DB::table('jobs')->insert([
            'queue' => 'analytics',
            'payload' => '{}',
            'attempts' => 0,
            'reserved_at' => null,
            'available_at' => now()->timestamp,
            'created_at' => now()->subSeconds(20)->timestamp,
        ]);

        $response = $this->actingAs($superadmin)->getJson('/api/admin/system-health')
            ->assertOk()
            ->assertHeader('Cache-Control', 'no-store, private')
            ->assertJsonStructure([
                'status', 'checkedAt',
                'release' => ['sha', 'builtAt', 'source'],
                'application' => ['environment', 'debug', 'phpVersion', 'opcache', 'configCached', 'routesCached'],
                'database' => ['driver', 'connected', 'latencyMs', 'pendingMigrations'],
                'queue' => ['driver', 'workerMode', 'queues', 'failedJobs'],
                'scheduler' => ['lastTick', 'ageSeconds', 'fresh'],
                'backups' => ['latestDump', 'latestStorageArchive', 'restoreDrillVerifiedAt'],
                'storage' => ['writable', 'freeDiskGb'],
                'transports' => ['mail', 'sms'],
                'observability' => ['webhookConfigured', 'counters'],
                'checks',
            ])
            ->assertJsonPath('database.connected', true)
            ->assertJsonPath('database.pendingMigrations', 0)
            ->assertJsonPath('scheduler.fresh', true)
            ->assertJsonPath('queue.queues.0.name', 'analytics')
            ->assertJsonPath('queue.queues.0.depth', 1);

        $body = $response->getContent();
        foreach ([config('app.key'), env('DB_PASSWORD'), env('APP_KEY')] as $secret) {
            if (is_string($secret) && $secret !== '') {
                $this->assertStringNotContainsString($secret, $body);
            }
        }
        $this->assertStringNotContainsString('DB_PASSWORD', $body);
        $this->assertStringNotContainsString('APP_KEY', $body);
        $this->assertStringNotContainsString('base64:', $body);
    }

    public function test_every_log_line_names_the_release(): void
    {
        $this->assertArrayHasKey('release', Log::sharedContext());
    }
}
