<?php

namespace App\Services\Notifications;

use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use RuntimeException;

class SmsService
{
    public function send(string $phone, string $message): bool
    {
        $phone = trim($phone);
        $message = trim($message);

        if ($phone === '' || $message === '') {
            return false;
        }

        return match (config('services.sms.driver', 'log')) {
            'http' => $this->sendHttp($phone, $message),
            'log' => $this->sendLog($phone, $message),
            default => throw new RuntimeException('Unsupported SMS driver configured.'),
        };
    }

    private function sendHttp(string $phone, string $message): bool
    {
        $endpoint = (string) config('services.sms.http.endpoint', '');

        if ($endpoint === '') {
            throw new RuntimeException('SMS_HTTP_ENDPOINT must be set when SMS_DRIVER=http.');
        }

        $payload = [
            (string) config('services.sms.http.to_field', 'to') => $phone,
            (string) config('services.sms.http.message_field', 'message') => $message,
        ];
        $from = (string) config('services.sms.from', '');

        if ($from !== '') {
            $payload[(string) config('services.sms.http.from_field', 'from')] = $from;
        }

        $request = Http::timeout((int) config('services.sms.http.timeout', 10))
            ->acceptJson();
        $token = (string) config('services.sms.http.token', '');

        if ($token !== '') {
            $request = $request->withToken($token);
        }

        $request->post($endpoint, $payload)->throw();

        return true;
    }

    private function sendLog(string $phone, string $message): bool
    {
        Log::channel(config('services.sms.log_channel') ?: config('logging.default', 'stack'))
            ->info('SMS notification', [
                'to' => $phone,
                'message' => $message,
            ]);

        return true;
    }
}
