<?php

namespace Tests\Feature;

use App\Jobs\BuildAnalyticsExport;
use App\Jobs\SendNotificationDelivery;
use App\Jobs\WarmAcademicAnalytics;
use App\Jobs\WarmDashboardAnalytics;
use App\Mail\LeadershipDigestMail;
use App\Mail\PasswordResetMail;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Queue;
use Tests\TestCase;

class QueueRoutingProbe implements ShouldQueue
{
    use Queueable;

    public function __construct(public readonly string $marker) {}

    public function handle(): void
    {
        Cache::put("queue-routing-probe:{$this->marker}", true, 60);
    }
}

class QueueRoutingTest extends TestCase
{
    use RefreshDatabase;

    public function test_each_job_class_targets_its_named_queue(): void
    {
        $this->assertSame('analytics', (new WarmDashboardAnalytics)->queue);
        $this->assertSame('analytics', (new WarmAcademicAnalytics)->queue);
        $this->assertSame('analytics', (new BuildAnalyticsExport('export-id'))->queue);

        $notification = new SendNotificationDelivery(
            'user-id',
            'Title',
            'Message',
            ['email'],
        );
        $this->assertSame('notifications', $notification->queue);
        $this->assertSame('notifications', (new PasswordResetMail('https://example.test/reset'))->queue);
        $this->assertSame('notifications', (new LeadershipDigestMail(['hasData' => true]))->queue);
    }

    public function test_analytics_worker_does_not_wait_behind_notification_work(): void
    {
        config()->set('queue.default', 'database');

        Queue::connection('database')->pushOn(
            'notifications',
            new QueueRoutingProbe('notification'),
        );
        Queue::connection('database')->pushOn(
            'analytics',
            new QueueRoutingProbe('analytics'),
        );

        $this->artisan('queue:work', [
            'connection' => 'database',
            '--queue' => 'analytics,default',
            '--once' => true,
            '--sleep' => 0,
        ])->assertExitCode(0);

        $this->assertTrue((bool) Cache::get('queue-routing-probe:analytics'));
        $this->assertFalse((bool) Cache::get('queue-routing-probe:notification'));
        $this->assertDatabaseHas('jobs', ['queue' => 'notifications']);
        $this->assertDatabaseMissing('jobs', ['queue' => 'analytics']);
    }

    public function test_queue_monitor_reports_depth_and_oldest_age_breaches(): void
    {
        config()->set('queue.default', 'database');
        config()->set('operations.queue_depth_warning', 1);
        config()->set('operations.queue_oldest_warning_seconds', 30);

        DB::table('jobs')->insert([
            [
                'queue' => 'analytics',
                'payload' => '{}',
                'attempts' => 0,
                'reserved_at' => null,
                'available_at' => now()->timestamp,
                'created_at' => now()->subMinutes(2)->timestamp,
            ],
            [
                'queue' => 'analytics',
                'payload' => '{}',
                'attempts' => 0,
                'reserved_at' => null,
                'available_at' => now()->timestamp,
                'created_at' => now()->timestamp,
            ],
        ]);

        Log::shouldReceive('warning')
            ->once()
            ->with('Queue health threshold exceeded', \Mockery::on(
                fn (array $context): bool => $context['queues'][0]['queue'] === 'analytics'
                    && $context['queues'][0]['depth'] === 2
                    && $context['queues'][0]['oldestJobAgeSeconds'] >= 120,
            ));

        $this->artisan('queue:monitor-health --json')
            ->expectsOutputToContain('"queue":"analytics","depth":2')
            ->assertExitCode(1);
    }

    public function test_scheduler_registers_named_queue_drain_and_monitoring(): void
    {
        $this->artisan('schedule:list')
            ->expectsOutputToContain('queue:work --stop-when-empty --max-time=50 --queue=analytics,notifications,default')
            ->expectsOutputToContain('queue:monitor-health --json')
            ->assertExitCode(0);
    }

    public function test_systemd_workers_keep_notification_and_analytics_consumers_disjoint(): void
    {
        $analytics = file_get_contents(base_path('../deploy/queue-worker.service'));
        $notifications = file_get_contents(base_path('../deploy/queue-notifications-worker.service'));

        $this->assertStringContainsString('--queue=analytics,default', $analytics);
        $this->assertStringNotContainsString('notifications', $this->execStart($analytics));
        $this->assertStringContainsString('--queue=notifications,default', $notifications);
        $this->assertStringNotContainsString('analytics', $this->execStart($notifications));
    }

    private function execStart(string $unit): string
    {
        preg_match('/^ExecStart=(.+)$/m', $unit, $matches);

        return $matches[1] ?? '';
    }
}
