<?php

namespace App\Services\Analytics;

use Illuminate\Support\Carbon;

class AnalyticsFilters
{
    public function __construct(
        public readonly ?string $periodId = null,
        public readonly ?string $weekStart = null,
        public readonly ?string $month = null,
        public readonly ?int $year = null,
        public readonly ?string $dateFrom = null,
        public readonly ?string $dateTo = null,
        public readonly ?string $department = null,
        public readonly ?string $ward = null,
        public readonly ?string $family = null,
        public readonly ?string $reportType = null,
        public readonly ?string $procedureCategory = null,
    ) {}

    /**
     * @param  array<string, mixed>  $input
     */
    public static function fromArray(array $input): self
    {
        return new self(
            periodId: self::nullableString($input['period_id'] ?? $input['periodId'] ?? null),
            weekStart: self::nullableDate($input['week_start'] ?? $input['week'] ?? null),
            month: self::nullableMonth($input['month'] ?? null),
            year: isset($input['year']) ? (int) $input['year'] : null,
            dateFrom: self::nullableDate($input['date_from'] ?? $input['dateFrom'] ?? null),
            dateTo: self::nullableDate($input['date_to'] ?? $input['dateTo'] ?? null),
            department: self::nullableString($input['department_id'] ?? $input['department'] ?? null),
            ward: self::nullableString($input['ward_id'] ?? $input['ward'] ?? null),
            family: self::nullableString($input['family'] ?? null),
            reportType: self::nullableString($input['report_type'] ?? $input['reportType'] ?? null),
            procedureCategory: self::nullableString($input['procedure_category'] ?? $input['procedureCategory'] ?? null),
        );
    }

    public function hasTemporalFilter(): bool
    {
        return $this->periodId !== null
            || $this->weekStart !== null
            || $this->month !== null
            || $this->year !== null
            || $this->dateFrom !== null
            || $this->dateTo !== null;
    }

    public function departmentFilter(): ?string
    {
        return $this->department ?? $this->ward;
    }

    public function withDepartment(string $department): self
    {
        return new self(
            periodId: $this->periodId,
            weekStart: $this->weekStart,
            month: $this->month,
            year: $this->year,
            dateFrom: $this->dateFrom,
            dateTo: $this->dateTo,
            department: $department,
            ward: null,
            family: $this->family,
            reportType: $this->reportType,
            procedureCategory: $this->procedureCategory,
        );
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

    private static function nullableMonth(mixed $value): ?string
    {
        $string = self::nullableString($value);

        if ($string === null) {
            return null;
        }

        return Carbon::parse($string.'-01')->format('Y-m');
    }
}
