<?php

namespace App\Services\Workspace;

use App\Models\User;
use Illuminate\Support\Facades\Cache;

/**
 * Credential for the lightweight workspace-revision poll.
 *
 * The poll runs without the session middleware so an idle tab costs one
 * indexed read instead of a session round-trip. To stop the credential from
 * outliving the sign-in that issued it (QA-016) every token is bound to the
 * issuing session: issuing registers an HMAC of the session id in the cache
 * for the session lifetime, logout revokes that registration, and a token
 * whose registration is gone is refused even when its signature and expiry
 * are still valid. The session id itself never leaves the server.
 */
class WorkspaceRevisionToken
{
    private const VERSION = 2;

    private const LIFETIME_SECONDS = 43_200;

    private const REGISTRY_PREFIX = 'workspace-revision-session:';

    /**
     * Issue a token bound to the authenticated request's session. Requests
     * without a session (non-browser API clients) get no token, so the poll
     * simply stays off for them.
     */
    public function issue(User|string $user, ?string $sessionId): ?string
    {
        if ($sessionId === null || $sessionId === '') {
            return null;
        }

        $binding = $this->sessionBinding($sessionId);
        Cache::put(
            self::REGISTRY_PREFIX.$binding,
            true,
            now()->addMinutes(max(1, (int) config('session.lifetime', 120))),
        );

        return $this->sign([
            'v' => self::VERSION,
            'uid' => $user instanceof User ? (string) $user->getKey() : $user,
            'sid' => $binding,
        ]);
    }

    /**
     * Re-issue an already verified token with a fresh expiry. The session
     * binding is carried over, so renewal never extends a revoked sign-in.
     *
     * @param  array{uid: string, sid: string}  $claims
     */
    public function renew(array $claims): string
    {
        return $this->sign([
            'v' => self::VERSION,
            'uid' => $claims['uid'],
            'sid' => $claims['sid'],
        ]);
    }

    /** Drop the registration for a session that is being signed out. */
    public function revoke(?string $sessionId): void
    {
        if ($sessionId === null || $sessionId === '') {
            return;
        }

        Cache::forget(self::REGISTRY_PREFIX.$this->sessionBinding($sessionId));
    }

    /**
     * @return array{uid: string, sid: string}|null
     */
    public function verify(string $token): ?array
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
            || ! is_string($claims['sid'] ?? null)
            || $claims['sid'] === ''
            || ! is_int($claims['exp'] ?? null)
            || $claims['exp'] < now()->timestamp) {
            return null;
        }

        if (! Cache::has(self::REGISTRY_PREFIX.$claims['sid'])) {
            return null;
        }

        return ['uid' => $claims['uid'], 'sid' => $claims['sid']];
    }

    public function userId(string $token): ?string
    {
        return $this->verify($token)['uid'] ?? null;
    }

    /**
     * @param  array<string, mixed>  $claims
     */
    private function sign(array $claims): string
    {
        $payload = $this->encode(json_encode(
            $claims + ['exp' => now()->timestamp + self::LIFETIME_SECONDS],
            JSON_THROW_ON_ERROR,
        ));

        return $payload.'.'.$this->signature($payload);
    }

    private function sessionBinding(string $sessionId): string
    {
        return hash_hmac('sha256', $sessionId, (string) config('app.key'));
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
