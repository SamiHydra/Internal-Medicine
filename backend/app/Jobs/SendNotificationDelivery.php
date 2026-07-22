<?php

namespace App\Jobs;

use App\Mail\NotificationMessageMail;
use App\Models\User;
use App\Services\Notifications\SmsService;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Mail;
use Throwable;

class SendNotificationDelivery implements ShouldQueue
{
    use Queueable;

    public int $tries = 3;

    public int $timeout = 30;

    /** Escalating backoff (seconds) so a flaky mail/SMS gateway is not hammered. */
    public array $backoff = [60, 300, 900];

    /**
     * @param  list<string>  $channels
     */
    public function __construct(
        public readonly string $userId,
        public readonly string $title,
        public readonly string $message,
        public readonly array $channels,
        public readonly ?string $actionUrl = null,
    ) {}

    public function handle(SmsService $sms): void
    {
        $recipient = User::query()->findOrFail($this->userId);
        $channels = collect($this->channels)
            ->map(fn (string $channel): string => strtolower(trim($channel)))
            ->unique()
            ->values();

        // Each channel is isolated so a failure in one (e.g. a down SMTP host)
        // does not block the other and does not re-send an already-delivered
        // channel on retry. The job is only re-queued when EVERY attempted
        // channel fails, which avoids duplicate sends on partial success.
        $attempted = 0;
        $failed = 0;

        if ($channels->contains('email') && $recipient->email) {
            $attempted++;
            try {
                Mail::to($recipient->email)->send(new NotificationMessageMail(
                    title: $this->title,
                    body: $this->message,
                    actionUrl: $this->actionUrl,
                ));
            } catch (Throwable $e) {
                $failed++;
                Log::warning('Notification email delivery failed', [
                    'recipient' => $this->userId,
                    'error' => $e->getMessage(),
                ]);
            }
        }

        if ($channels->contains('sms') && $recipient->phone) {
            $attempted++;
            try {
                $sms->send($recipient->phone, $this->smsMessage());
            } catch (Throwable $e) {
                $failed++;
                Log::warning('Notification SMS delivery failed', [
                    'recipient' => $this->userId,
                    'error' => $e->getMessage(),
                ]);
            }
        }

        if ($attempted > 0 && $failed === $attempted) {
            throw new \RuntimeException("All notification channels failed for user {$this->userId}");
        }
    }

    public function failed(?Throwable $e): void
    {
        Log::error('Notification delivery permanently failed', [
            'recipient' => $this->userId,
            'channels' => $this->channels,
            'error' => $e?->getMessage(),
        ]);
    }

    private function smsMessage(): string
    {
        return trim($this->actionUrl
            ? "{$this->title}\n{$this->message}\n{$this->actionUrl}"
            : "{$this->title}\n{$this->message}");
    }
}
