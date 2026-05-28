<?php

namespace App\Services\Analytics;

use App\Models\Report;
use App\Models\ReportFieldDefinition;
use App\Models\ReportFieldValue;
use App\Models\ReportingPeriod;
use Illuminate\Support\Collection;

/**
 * Builds a tidy (long-format) CSV of submitted weekly values per department/field,
 * so leadership can pull a period's numbers without hand-compiling spreadsheets.
 *
 * Generic by design — maps cleanly onto a specific MoH/DHIS2 template later.
 */
class AnalyticsExportService
{
    private const WEEKDAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

    private const HEADER = ['Week start', 'Week end', 'Department', 'Family', 'Section', 'Field', 'Aggregate', 'Value'];

    /**
     * @param  Collection<int, ReportingPeriod>  $periods
     */
    public function csv(Collection $periods): string
    {
        $reports = Report::query()
            ->with(['department', 'template.fieldDefinitions', 'fieldValues', 'reportingPeriod'])
            ->whereIn('reporting_period_id', $periods->pluck('id')->all())
            ->whereNotNull('submitted_at')
            ->get()
            ->sortBy(fn (Report $report) => [
                $report->reportingPeriod?->week_start?->toDateString(),
                $report->department?->name,
            ])
            ->values();

        $handle = fopen('php://temp', 'r+');
        fputcsv($handle, self::HEADER);

        foreach ($reports as $report) {
            $weekStart = $report->reportingPeriod?->week_start?->toDateString() ?? '';
            $weekEnd = $report->reportingPeriod?->week_end?->toDateString() ?? '';
            $definitions = $report->template?->fieldDefinitions?->sortBy('display_order') ?? collect();

            foreach ($definitions as $definition) {
                $value = $this->aggregate($definition, $report->fieldValues);
                if ($value === null) {
                    continue;
                }

                fputcsv($handle, [
                    $weekStart,
                    $weekEnd,
                    $report->department?->name ?? '',
                    $report->department?->family ?? '',
                    $definition->section_key,
                    $definition->label,
                    $definition->aggregate_type,
                    $value,
                ]);
            }
        }

        rewind($handle);
        $csv = stream_get_contents($handle);
        fclose($handle);

        return $csv;
    }

    /**
     * @param  Collection<int, ReportFieldValue>  $values
     */
    private function aggregate(ReportFieldDefinition $definition, Collection $values): ?string
    {
        $forField = $values->where('field_definition_id', $definition->id);
        if ($forField->isEmpty()) {
            return null;
        }

        if (in_array($definition->field_kind, ['integer', 'decimal'], true)) {
            $numbers = $forField
                ->pluck('value_number')
                ->filter(fn ($value) => $value !== null)
                ->map(fn ($value) => (float) $value);

            if ($numbers->isEmpty()) {
                return null;
            }

            return match ($definition->aggregate_type) {
                'average' => $this->number(round($numbers->avg(), 4)),
                'latest' => $this->number((float) ($this->latest($forField)?->value_number ?? 0)),
                default => $this->number($numbers->sum()),
            };
        }

        return $this->nonNumeric($this->latest($forField));
    }

    /**
     * @param  Collection<int, ReportFieldValue>  $forField
     */
    private function latest(Collection $forField): ?ReportFieldValue
    {
        return $forField
            ->sortBy(fn (ReportFieldValue $value) => array_search($value->day_name, self::WEEKDAYS, true))
            ->last();
    }

    private function nonNumeric(?ReportFieldValue $value): ?string
    {
        if (! $value) {
            return null;
        }

        if ($value->value_text !== null) {
            return (string) $value->value_text;
        }

        if ($value->value_time !== null) {
            return substr((string) $value->value_time, 0, 5);
        }

        if ($value->value_json !== null) {
            return (string) json_encode($value->value_json);
        }

        return null;
    }

    private function number(float $value): string
    {
        if (floor($value) === $value) {
            return (string) (int) $value;
        }

        return rtrim(rtrim(number_format($value, 4, '.', ''), '0'), '.');
    }
}
