<?php

namespace Tests\Feature;

use App\Jobs\SendNotificationDelivery;
use App\Mail\NotificationMessageMail;
use App\Models\User;
use App\Services\Notifications\NotificationDeliveryService;
use App\Services\Notifications\SmsService;
use Database\Seeders\RoleSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Queue;
use Tests\TestCase;

class NotificationDeliveryTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();

        $this->seed(RoleSeeder::class);
    }

    public function test_delivery_service_queues_email_and_sms_job(): void
    {
        Queue::fake();

        $recipient = User::factory()->create([
            'email' => 'hana@example.test',
            'phone' => '+251911000111',
        ]);

        app(NotificationDeliveryService::class)->queue(
            $recipient,
            'Report reminder',
            'GI Neuro is due soon.',
            ['email', 'sms'],
            'https://app.example.test/reports/1',
        );

        Queue::assertPushed(SendNotificationDelivery::class, function (SendNotificationDelivery $job) use ($recipient): bool {
            return $job->userId === $recipient->id
                && $job->title === 'Report reminder'
                && $job->message === 'GI Neuro is due soon.'
                && $job->channels === ['email', 'sms']
                && $job->actionUrl === 'https://app.example.test/reports/1';
        });
    }

    public function test_delivery_job_sends_email_and_sms(): void
    {
        Mail::fake();
        Http::fake([
            'https://sms.example.test/send' => Http::response(['ok' => true]),
        ]);
        config()->set('services.sms.driver', 'http');
        config()->set('services.sms.from', 'StPaul');
        config()->set('services.sms.http.endpoint', 'https://sms.example.test/send');
        config()->set('services.sms.http.token', 'test-token');

        $recipient = User::factory()->create([
            'email' => 'hana@example.test',
            'phone' => '+251911000111',
        ]);

        $job = new SendNotificationDelivery(
            $recipient->id,
            'Report reminder',
            'GI Neuro is due soon.',
            ['email', 'sms'],
            'https://app.example.test/reports/1',
        );
        $job->handle(app(SmsService::class));

        Mail::assertSent(NotificationMessageMail::class, function (NotificationMessageMail $mail) use ($recipient): bool {
            return $mail->hasTo($recipient->email)
                && $mail->title === 'Report reminder'
                && $mail->body === 'GI Neuro is due soon.'
                && $mail->actionUrl === 'https://app.example.test/reports/1';
        });

        Http::assertSent(function ($request): bool {
            return $request->url() === 'https://sms.example.test/send'
                && $request->hasHeader('Authorization', 'Bearer test-token')
                && $request['to'] === '+251911000111'
                && $request['from'] === 'StPaul'
                && str_contains($request['message'], 'Report reminder')
                && str_contains($request['message'], 'https://app.example.test/reports/1');
        });
    }

    public function test_scheduler_drains_database_queue_for_shared_hosting(): void
    {
        $this->artisan('schedule:list')
            ->expectsOutputToContain('queue:work --stop-when-empty --max-time=50')
            ->assertExitCode(0);
    }
}
