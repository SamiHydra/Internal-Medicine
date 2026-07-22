<?php

namespace App\Services\Notifications;

use App\Jobs\SendNotificationDelivery;
use App\Models\User;

class NotificationDeliveryService
{
    /**
     * @param  list<string>  $channels
     */
    public function queue(User $recipient, string $title, string $message, array $channels = ['email', 'sms'], ?string $actionUrl = null): void
    {
        $channels = collect($channels)
            ->map(fn (string $channel): string => strtolower(trim($channel)))
            ->filter(fn (string $channel): bool => in_array($channel, ['email', 'sms'], true))
            ->unique()
            ->values()
            ->all();

        if ($channels === []) {
            return;
        }

        SendNotificationDelivery::dispatch(
            $recipient->id,
            $title,
            $message,
            $channels,
            $actionUrl,
        )->afterCommit();
    }
}
