<?php

namespace App\Services\Academic;

use Illuminate\Support\Carbon;

class AcademicAnalyticsFilters
{
    public function __construct(
        public readonly string $direction = 'consultant',
        public readonly ?string $wardId = null,
        public readonly ?string $subjectId = null,
        public readonly ?string $dateFrom = null,
        public readonly ?string $dateTo = null,
        public readonly string $granularity = 'weekly',
    ) {}

    /**
     * @param  array<string, mixed>  $input
     */
    public static function fromArray(array $input): self
    {
        $direction = self::nullableString($input['direction'] ?? null);
        $granularity = self::nullableString($input['granularity'] ?? null);

        return new self(
            direction: in_array($direction, ['consultant', 'resident'], true) ? $direction : 'consultant',
            wardId: self::nullableString($input['ward_id'] ?? $input['wardId'] ?? null),
            subjectId: self::nullableString($input['subject_id'] ?? $input['subjectId'] ?? null),
            dateFrom: self::nullableDate($input['date_from'] ?? $input['dateFrom'] ?? null),
            dateTo: self::nullableDate($input['date_to'] ?? $input['dateTo'] ?? null),
            granularity: in_array($granularity, ['weekly', 'monthly'], true) ? $granularity : 'weekly',
        );
    }

    public function memoKey(): string
    {
        return implode('|', [
            $this->direction,
            $this->wardId ?? '',
            $this->subjectId ?? '',
            $this->dateFrom ?? '',
            $this->dateTo ?? '',
        ]);
    }

    private static function nullableString(mixed $value): ?string
    {
        if (! is_string($value) && ! is_numeric($value)) {
            return null;
        }

        $trimmed = trim((string) $value);

        return $trimmed === '' ? null : $trimmed;
    }

    private static function nullableDate(mixed $value): ?string
    {
        $string = self::nullableString($value);

        if ($string === null) {
            return null;
        }

        return Carbon::parse($string)->toDateString();
    }
}
