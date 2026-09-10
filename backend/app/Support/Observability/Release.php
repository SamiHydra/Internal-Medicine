<?php

namespace App\Support\Observability;

/**
 * Identifies the running release for logs, health diagnostics and the
 * maintenance page. Reads, in order: APP_RELEASE_SHA / APP_RELEASE_BUILT_AT,
 * then the release.json the deploy writes next to backend/, then "unknown".
 * Cached per process; nothing here touches the database.
 */
final class Release
{
    /** @var array{sha: string, builtAt: string|null, source: string}|null */
    private static ?array $cached = null;

    public static function sha(): string
    {
        return self::describe()['sha'];
    }

    public static function builtAt(): ?string
    {
        return self::describe()['builtAt'];
    }

    /** Short, log-friendly form such as "b07b32c" or "unknown". */
    public static function short(): string
    {
        return substr(self::sha(), 0, 12);
    }

    /**
     * @return array{sha: string, builtAt: string|null, source: string}
     */
    public static function describe(): array
    {
        if (self::$cached !== null) {
            return self::$cached;
        }

        $sha = trim((string) config('observability.release.sha'));
        $builtAt = trim((string) config('observability.release.built_at')) ?: null;

        if ($sha !== '') {
            return self::$cached = ['sha' => self::clean($sha), 'builtAt' => $builtAt, 'source' => 'environment'];
        }

        $file = (string) config('observability.release.file');

        if ($file !== '' && is_readable($file)) {
            $decoded = json_decode((string) file_get_contents($file), true);

            if (is_array($decoded) && isset($decoded['sha']) && is_string($decoded['sha']) && trim($decoded['sha']) !== '') {
                return self::$cached = [
                    'sha' => self::clean($decoded['sha']),
                    'builtAt' => isset($decoded['builtAt']) && is_string($decoded['builtAt']) ? $decoded['builtAt'] : null,
                    'source' => 'release.json',
                ];
            }
        }

        return self::$cached = ['sha' => 'unknown', 'builtAt' => null, 'source' => 'none'];
    }

    /** Test seam. */
    public static function forget(): void
    {
        self::$cached = null;
    }

    private static function clean(string $sha): string
    {
        $safe = preg_replace('/[^A-Za-z0-9._-]/', '', $sha) ?? '';

        return $safe === '' ? 'unknown' : substr($safe, 0, 64);
    }
}
