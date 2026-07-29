<?php

namespace App\Services\Workspace;

use App\Models\User;

class WorkspaceRevisionToken
{
    private const VERSION = 1;

    private const LIFETIME_SECONDS = 43_200;

    public function issue(User|string $user): string
    {
        $userId = $user instanceof User ? (string) $user->getKey() : $user;
        $payload = $this->encode(json_encode([
            'v' => self::VERSION,
            'uid' => $userId,
            'exp' => now()->timestamp + self::LIFETIME_SECONDS,
        ], JSON_THROW_ON_ERROR));

        return $payload.'.'.$this->signature($payload);
    }

    public function userId(string $token): ?string
    {
        [$payload, $providedSignature] = array_pad(explode('.', $token, 2), 2, null);

        if (! is_string($payload)
            || ! is_string($providedSignature)
            || ! hash_equals($this->signature($payload), $providedSignature)) {
            return null;
        }

        $decoded = $this->decode($payload);
        if ($decoded === null) {
            return null;
        }

        try {
            $claims = json_decode($decoded, true, flags: JSON_THROW_ON_ERROR);
        } catch (\JsonException) {
            return null;
        }

        if (! is_array($claims)
            || ($claims['v'] ?? null) !== self::VERSION
            || ! is_string($claims['uid'] ?? null)
            || $claims['uid'] === ''
            || ! is_int($claims['exp'] ?? null)
            || $claims['exp'] < now()->timestamp) {
            return null;
        }

        return $claims['uid'];
    }

    private function signature(string $payload): string
    {
        return $this->encode(hash_hmac(
            'sha256',
            $payload,
            (string) config('app.key'),
            true,
        ));
    }

    private function encode(string $value): string
    {
        return rtrim(strtr(base64_encode($value), '+/', '-_'), '=');
    }

    private function decode(string $value): ?string
    {
        $padding = strlen($value) % 4;
        if ($padding !== 0) {
            $value .= str_repeat('=', 4 - $padding);
        }

        $decoded = base64_decode(strtr($value, '-_', '+/'), true);

        return $decoded === false ? null : $decoded;
    }
}
