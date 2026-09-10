<?php

namespace App\Support\Observability;

/**
 * Strips credentials and personal identifiers from anything that leaves the
 * application as an error report (docs/OBSERVABILITY.md, "Sensitive-data
 * rules"). Applied to exception messages, job payload summaries and every
 * client-submitted field before logging or forwarding. Request bodies, report
 * values, evaluation content and uploaded documents are never collected in the
 * first place; this is the second line, for values that ride along in messages.
 */
final class Redactor
{
    public const REDACTED = '[redacted]';

    private const SENSITIVE_KEY = '/pass(word|wd)?|secret|token|cookie|authorization|session|xsrf|csrf|api[_-]?key|private[_-]?key|credential|signature|otp|pin\b/i';

    /** How deep nested arrays are walked before being summarised. */
    private const MAX_DEPTH = 4;

    /**
     * @param  array<mixed>  $data
     * @return array<mixed>
     */
    public static function scrubArray(array $data, int $depth = 0): array
    {
        if ($depth >= self::MAX_DEPTH) {
            return ['[truncated]'];
        }

        $clean = [];

        foreach ($data as $key => $value) {
            if (is_string($key) && preg_match(self::SENSITIVE_KEY, $key)) {
                $clean[$key] = self::REDACTED;

                continue;
            }

            $clean[$key] = match (true) {
                is_array($value) => self::scrubArray($value, $depth + 1),
                is_string($value) => self::scrubString($value),
                is_scalar($value), $value === null => $value,
                default => '['.get_debug_type($value).']',
            };
        }

        return $clean;
    }

    /**
     * Masks credential-looking fragments and e-mail addresses, then caps the
     * length so a runaway message cannot become a payload of its own.
     */
    public static function scrubString(string $value, int $maxLength = 500): string
    {
        $patterns = [
            // key=value pairs in query strings, DSNs and messages.
            '/\b(pass(?:word|wd)?|secret|token|api[_-]?key|signature|otp)(\s*[=:]\s*)[^&\s,;\'"]+/i' => '$1$2'.self::REDACTED,
            // Bearer / Basic authorization values.
            '/\b(bearer|basic)\s+[A-Za-z0-9._~+\/=-]{8,}/i' => '$1 '.self::REDACTED,
            // Laravel encrypted cookies / session ids / sanctum tokens (long base64-ish runs).
            '/\b[A-Za-z0-9+\/]{40,}={0,2}\b/' => self::REDACTED,
            // E-mail addresses: keep the domain so support can still route the report.
            '/\b([A-Za-z0-9._%+-])[A-Za-z0-9._%+-]*@([A-Za-z0-9.-]+\.[A-Za-z]{2,})\b/' => '$1***@$2',
        ];

        $scrubbed = (string) preg_replace(array_keys($patterns), array_values($patterns), $value);

        if (mb_strlen($scrubbed) > $maxLength) {
            $scrubbed = mb_substr($scrubbed, 0, $maxLength).'…';
        }

        return $scrubbed;
    }

    /** Keeps a path relative to the application root so hostnames and users never leak. */
    public static function relativePath(?string $path): ?string
    {
        if ($path === null || $path === '') {
            return null;
        }

        $base = rtrim(str_replace('\\', '/', base_path()), '/');
        $normalized = str_replace('\\', '/', $path);

        if ($base !== '' && str_starts_with($normalized, $base)) {
            return ltrim(substr($normalized, strlen($base)), '/');
        }

        return basename($normalized);
    }
}
