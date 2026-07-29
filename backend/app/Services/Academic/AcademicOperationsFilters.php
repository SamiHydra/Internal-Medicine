<?php

namespace App\Services\Academic;

use Carbon\CarbonImmutable;
use Illuminate\Validation\ValidationException;

final class AcademicOperationsFilters
{
    public const MAX_INTERACTIVE_DAYS = 366;

    public function __construct(
        public readonly string $dateFrom,
        public readonly string $dateTo,
        public readonly ?string $batchId = null,
    ) {}

    /**
     * @param  array<string, mixed>  $input
     */
    public static function fromArray(array $input, ?string $today = null): self
    {
        $anchor = CarbonImmutable::parse($today ?? now()->toDateString())->startOfDay();
        $fromValue = self::nullableString($input['date_from'] ?? $input['dateFrom'] ?? null);
        $toValue = self::nullableString($input['date_to'] ?? $input['dateTo'] ?? null);
        $from = $fromValue ? CarbonImmutable::parse($fromValue) : null;
        $to = $toValue ? CarbonImmutable::parse($toValue) : null;

        if ($from && $to && $from->greaterThan($to)) {
            throw ValidationException::withMessages([
                'dateTo' => ['The end date must be on or after the start date.'],
            ]);
        }

        if (! $from && ! $to) {
            $to = $anchor;
            $from = $to->subDays(self::MAX_INTERACTIVE_DAYS - 1);
        } elseif (! $from) {
            $from = $to->subDays(self::MAX_INTERACTIVE_DAYS - 1);
        } elseif (! $to) {
            $candidate = $from->addDays(self::MAX_INTERACTIVE_DAYS - 1);
            $to = $candidate->lessThan($anchor) ? $candidate : $anchor;

            if ($from->greaterThan($to)) {
                throw ValidationException::withMessages([
                    'dateFrom' => ['The start date cannot be in the future.'],
                ]);
            }
        } elseif ($from->diffInDays($to) >= self::MAX_INTERACTIVE_DAYS) {
            $from = $to->subDays(self::MAX_INTERACTIVE_DAYS - 1);
        }

        return new self(
            dateFrom: $from->toDateString(),
            dateTo: $to->toDateString(),
            batchId: self::nullableString($input['batch_id'] ?? $input['batchId'] ?? null),
        );
    }

    public function memoKey(): string
    {
        return implode('|', [$this->dateFrom, $this->dateTo, $this->batchId ?? '']);
    }

    /**
     * @return array{fromDate: string, toDate: string, maxDays: int}
     */
    public function window(): array
    {
        return [
            'fromDate' => $this->dateFrom,
            'toDate' => $this->dateTo,
            'maxDays' => self::MAX_INTERACTIVE_DAYS,
        ];
    }

    private static function nullableString(mixed $value): ?string
    {
        if (! is_string($value) && ! is_numeric($value)) {
            return null;
        }

        $value = trim((string) $value);

        return $value === '' ? null : $value;
    }
}
