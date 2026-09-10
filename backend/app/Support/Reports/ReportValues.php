<?php

namespace App\Support\Reports;

use App\Models\Report;

/**
 * Serialises a report's cell values the way the API exposes them. Shared by the
 * workflow controller and the conflict response, so a client that is told its
 * copy is stale receives the server's values in exactly the shape it already
 * understands.
 */
final class ReportValues
{
    /**
     * @return array<string, array{fieldId: string, dailyValues: array<string, mixed>}>
     */
    public static function serialize(Report $report): array
    {
        $report->loadMissing('fieldValues.fieldDefinition');
        $values = [];

        foreach ($report->fieldValues as $fieldValue) {
            $fieldKey = $fieldValue->fieldDefinition?->field_key;

            if (! $fieldKey) {
                continue;
            }

            $values[$fieldKey] ??= [
                'fieldId' => $fieldKey,
                'dailyValues' => [],
            ];
            $values[$fieldKey]['dailyValues'][$fieldValue->day_name] = match (true) {
                $fieldValue->value_number !== null => self::numericValue($fieldValue->value_number),
                $fieldValue->value_time !== null => substr((string) $fieldValue->value_time, 0, 5),
                $fieldValue->value_text !== null => $fieldValue->value_text,
                default => $fieldValue->value_json,
            };
        }

        return $values;
    }

    public static function numericValue(mixed $value): int|float
    {
        $number = (float) $value;

        return floor($number) === $number ? (int) $number : $number;
    }
}
