<?php

namespace App\Support;

use Illuminate\Http\UploadedFile;

/**
 * One place for the upload contract the application promises (10 MB per file
 * for evidence and imports) and for translating PHP-level upload failures into
 * messages a user can act on. Laravel's `file` rule reports every PHP failure
 * as "The file failed to upload.", which hides the one operators most need to
 * see: the server's own upload_max_filesize / post_max_size being lower than
 * the application limit (QA-005).
 */
final class Uploads
{
    /** The application-level per-file limit, in kilobytes (Laravel `max:` units). */
    public const MAX_FILE_KILOBYTES = 10240;

    /** Minimum php.ini upload_max_filesize a host needs: the file plus multipart overhead. */
    public const REQUIRED_UPLOAD_MAX_FILESIZE_BYTES = 11 * 1024 * 1024;

    /** Minimum php.ini post_max_size: the upload plus the rest of the form body. */
    public const REQUIRED_POST_MAX_SIZE_BYTES = 12 * 1024 * 1024;

    public static function maxFileLabel(): string
    {
        return sprintf('%d MB', intdiv(self::MAX_FILE_KILOBYTES, 1024));
    }

    /**
     * A user-facing explanation for a file PHP refused before Laravel saw it,
     * or null when the upload itself succeeded.
     */
    public static function failureMessage(?UploadedFile $file): ?string
    {
        if ($file === null || $file->isValid()) {
            return null;
        }

        return match ($file->getError()) {
            UPLOAD_ERR_INI_SIZE => sprintf(
                'The file is larger than this server currently accepts (%s). Files up to %s are allowed; ask an administrator to raise upload_max_filesize in the PHP-FPM pool.',
                ini_get('upload_max_filesize') ?: 'unknown limit',
                self::maxFileLabel(),
            ),
            UPLOAD_ERR_FORM_SIZE => sprintf('The file is larger than the %s limit.', self::maxFileLabel()),
            UPLOAD_ERR_PARTIAL => 'The file was only partially uploaded. Please try again.',
            UPLOAD_ERR_NO_FILE => 'Choose a file to upload.',
            default => 'The file failed to upload. Please try again.',
        };
    }

    /** Parse a php.ini shorthand size ("12M", "20480K", "1G", "123") into bytes. */
    public static function iniSizeToBytes(string|int|null $value): int
    {
        if ($value === null) {
            return 0;
        }

        $value = trim((string) $value);

        if ($value === '' || $value === '-1') {
            return $value === '-1' ? PHP_INT_MAX : 0;
        }

        $unit = strtolower(substr($value, -1));
        $number = (float) (is_numeric($unit) ? $value : substr($value, 0, -1));

        return (int) match ($unit) {
            'g' => $number * 1024 ** 3,
            'm' => $number * 1024 ** 2,
            'k' => $number * 1024,
            default => (float) $value,
        };
    }
}
