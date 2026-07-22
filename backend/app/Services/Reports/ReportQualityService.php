<?php

namespace App\Services\Reports;

use App\Models\Report;
use App\Models\ReportFieldDefinition;
use App\Models\ReportFieldValue;
use Illuminate\Support\Collection;
use Illuminate\Validation\ValidationException;

class ReportQualityService
{
    /**
     * @return array<string, mixed>
     */
    public function analyze(Report $report, bool $withTrends = true): array
    {
        $this->loadForAnalysis($report);

        $completeness = $this->completeness($report);
        $violations = $this->ruleViolations($report);

        $warnings = $violations
            ->where('severity', 'warning')
            ->values();

        // Outlier (trend) warnings require a few extra queries to build the
        // baseline, so they are only computed for single-report contexts
        // (form load, save response) - never for the 100-report details batch.
        if ($withTrends) {
            $warnings = $warnings->merge($this->outlierWarnings($report));
        }

        return [
            'completeness' => $completeness,
            'errors' => $violations
                ->where('severity', 'error')
                ->values()
                ->all(),
            'warnings' => $warnings->values()->all(),
        ];
    }

    /**
     * Blocking validation only - the cheap path used inside the submit
     * transaction. Never runs the historical outlier queries.
     */
    public function assertValid(Report $report): void
    {
        $this->loadForAnalysis($report);

        $errors = $this->ruleViolations($report)->where('severity', 'error');

        if ($errors->isEmpty()) {
            return;
        }

        throw ValidationException::withMessages([
            'values' => $errors->pluck('message')->all(),
        ]);
    }

    private function loadForAnalysis(Report $report): void
    {
        $report->loadMissing(['template.fieldDefinitions', 'fieldValues.fieldDefinition']);
    }

    /**
     * @return array{expectedCells: int, filledCells: int, missingCells: int, percent: int}
     */
    private function completeness(Report $report): array
    {
        // Free-text fields (notes/names) are optional and not expected daily, so
        // they are excluded from the completeness denominator - otherwise a report
        // could never reach 100% on templates that carry a comment field.
        $fieldDefinitions = $report->template?->fieldDefinitions
            ->filter(fn (ReportFieldDefinition $field): bool => (bool) $field->active && $field->field_kind !== 'text')
            ->values() ?? collect();
        $expectedFieldIds = $fieldDefinitions->pluck('id')->all();
        $activeDays = $report->template?->active_days ?? [];
        $expectedCells = $fieldDefinitions->count() * count($activeDays);
        $filledCells = $report->fieldValues
            ->filter(fn ($value): bool => in_array($value->field_definition_id, $expectedFieldIds, true) && $this->hasValue($value))
            ->count();

        return [
            'expectedCells' => $expectedCells,
            'filledCells' => min($filledCells, $expectedCells),
            'missingCells' => max($expectedCells - $filledCells, 0),
            'percent' => $expectedCells > 0
                ? (int) round((min($filledCells, $expectedCells) / $expectedCells) * 100)
                : 100,
        ];
    }

    /**
     * @return Collection<int, array<string, mixed>>
     */
    private function ruleViolations(Report $report): Collection
    {
        $rules = $report->template?->metadata['validation_rules']
            ?? $report->template?->metadata['validationRules']
            ?? [];

        if (! is_array($rules) || empty($rules)) {
            return collect();
        }

        return collect($rules)
            ->filter(fn (mixed $rule): bool => is_array($rule))
            ->map(fn (array $rule): ?array => $this->evaluateRule($report, $rule))
            ->filter()
            ->values();
    }

    /**
     * @param  array<string, mixed>  $rule
     * @return array<string, mixed>|null
     */
    private function evaluateRule(Report $report, array $rule): ?array
    {
        if (($rule['type'] ?? null) !== 'sum_lte') {
            return null;
        }

        $left = $this->sumFields($report, $this->fieldList($rule['left'] ?? []));
        $right = $this->sumFields($report, $this->fieldList($rule['right'] ?? []));

        if ($left <= $right) {
            return null;
        }

        return [
            'key' => (string) ($rule['key'] ?? 'validation_rule'),
            'severity' => (string) ($rule['severity'] ?? 'error'),
            'message' => (string) ($rule['message'] ?? 'One or more report totals are inconsistent.'),
            'leftValue' => $left,
            'rightValue' => $right,
        ];
    }

    /**
     * Flag weekly totals that deviate sharply from the assignment's recent
     * baseline. These are soft (warning) signals - "confirm this is right?" -
     * not blocking errors.
     *
     * @return Collection<int, array<string, mixed>>
     */
    private function outlierWarnings(Report $report): Collection
    {
        if (! $report->assignment_id) {
            return collect();
        }

        $config = (array) config('reports.quality.outlier', []);
        $factor = max(1.0, (float) ($config['factor'] ?? 3));
        $minPeriods = max(1, (int) ($config['min_periods'] ?? 3));
        $lookback = max($minPeriods, (int) ($config['lookback'] ?? 6));
        $minBaseline = max(0.0, (float) ($config['min_baseline'] ?? 5));

        $numericFields = ($report->template?->fieldDefinitions ?? collect())
            ->filter(fn (ReportFieldDefinition $field): bool => in_array($field->field_kind, ['integer', 'decimal'], true))
            ->keyBy('id');

        if ($numericFields->isEmpty()) {
            return collect();
        }

        $current = $report->fieldValues
            ->filter(fn ($value): bool => $value->value_number !== null && $numericFields->has($value->field_definition_id))
            ->groupBy('field_definition_id')
            ->map(fn ($values): float => (float) $values->sum(fn ($value): float => (float) $value->value_number));

        if ($current->isEmpty()) {
            return collect();
        }

        // Order by the reporting period's chronology (not reports.updated_at) so a
        // late edit to an old report cannot reorder which weeks form the baseline.
        $historyIds = Report::query()
            ->where('reports.assignment_id', $report->assignment_id)
            ->where('reports.id', '!=', $report->id)
            ->whereNotNull('reports.submitted_at')
            ->join('reporting_periods', 'reporting_periods.id', '=', 'reports.reporting_period_id')
            ->orderByDesc('reporting_periods.week_start')
            ->limit($lookback)
            ->pluck('reports.id');

        if ($historyIds->count() < $minPeriods) {
            return collect();
        }

        $rows = ReportFieldValue::query()
            ->whereIn('report_id', $historyIds->all())
            ->whereIn('field_definition_id', $numericFields->keys()->all())
            ->whereNotNull('value_number')
            ->get(['report_id', 'field_definition_id', 'value_number']);

        $baseline = $rows->groupBy('field_definition_id')->map(function ($group): ?float {
            $periods = $group->pluck('report_id')->unique()->count();
            $sum = (float) $group->sum(fn ($row): float => (float) $row->value_number);

            return $periods > 0 ? $sum / $periods : null;
        });

        $warnings = collect();

        foreach ($current as $fieldId => $value) {
            $avg = $baseline[$fieldId] ?? null;
            if ($avg === null || $avg < $minBaseline) {
                continue;
            }

            $high = $value > $avg * $factor;
            $low = $value > 0 && $value * $factor < $avg;
            if (! $high && ! $low) {
                continue;
            }

            $field = $numericFields->get($fieldId);
            $multiple = $avg > 0 ? round($value / $avg, 1) : null;

            $warnings->push([
                'key' => 'outlier:'.$field->field_key,
                'severity' => 'warning',
                'message' => sprintf(
                    '%s this week (%s) is %s the recent %d-week average of %s%s. Please double-check.',
                    $field->label,
                    $this->numberLabel($value),
                    $high ? 'well above' : 'well below',
                    $historyIds->count(),
                    $this->numberLabel($avg),
                    $multiple !== null ? sprintf(' (%sx)', $multiple) : '',
                ),
                'leftValue' => $value,
                'rightValue' => round($avg, 2),
            ]);
        }

        return $warnings;
    }

    /**
     * @return list<string>
     */
    private function fieldList(mixed $value): array
    {
        if (is_string($value)) {
            return [$value];
        }

        if (! is_array($value)) {
            return [];
        }

        return array_values(array_filter($value, fn (mixed $field): bool => is_string($field) && $field !== ''));
    }

    /**
     * @param  list<string>  $fieldKeys
     */
    private function sumFields(Report $report, array $fieldKeys): float
    {
        return (float) $report->fieldValues
            ->filter(fn ($value): bool => in_array($value->fieldDefinition?->field_key, $fieldKeys, true))
            ->sum(fn ($value): float => (float) ($value->value_number ?? 0));
    }

    private function numberLabel(float $value): string
    {
        return floor($value) === $value ? (string) (int) $value : (string) round($value, 1);
    }

    private function hasValue(mixed $fieldValue): bool
    {
        return $fieldValue->value_number !== null
            || $fieldValue->value_time !== null
            || ($fieldValue->value_text !== null && trim((string) $fieldValue->value_text) !== '')
            || $fieldValue->value_json !== null;
    }
}
