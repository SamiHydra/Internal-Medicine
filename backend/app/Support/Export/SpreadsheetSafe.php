<?php

namespace App\Support\Export;

/**
 * CSV/spreadsheet formula-injection guard (CWE-1236). Report cells include
 * nurse-entered free text; a cell beginning with =, +, @, or a control char can
 * execute when the file is opened in Excel/Sheets. Applied on EXPORT only.
 */
class SpreadsheetSafe
{
    public static function sanitize(string $value): string
    {
        if ($value === '') {
            return $value;
        }

        $first = $value[0];
        $dangerous = in_array($first, ['=', '+', '@', "\t", "\r"], true)
            || ($first === '-' && ! is_numeric($value));

        return $dangerous ? "'".$value : $value;
    }

    /**
     * Reverse {@see sanitize()} on a round-trip IMPORT so a guard apostrophe added
     * on export does not get stored. Only strips a leading "'" that directly
     * precedes a formula character, which a legitimate clinical value never has.
     */
    public static function unsanitize(string $value): string
    {
        if (strlen($value) >= 2 && $value[0] === "'") {
            $next = $value[1];
            if (in_array($next, ['=', '+', '@', '-', "\t", "\r"], true)) {
                return substr($value, 1);
            }
        }

        return $value;
    }
}
