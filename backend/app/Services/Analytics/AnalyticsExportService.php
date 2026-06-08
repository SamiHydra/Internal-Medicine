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
     * Returns a callback that streams the CSV directly to the output buffer.
     *
     * Reports are walked in bounded chunks via lazy() so peak memory stays flat
     * regardless of how many weeks/departments are exported (the previous
     * implementation buffered every report AND the assembled CSV string in RAM,
     * which would OOM as history accumulates). Ordering is pushed to SQL with a
     * deterministic id tiebreaker so chunk boundaries are stable.
     *
     * @param  Collection<int, ReportingPeriod>  $periods
     */
    public function streamCallback(Collection $periods): \Closure
    {
        $periodIds = $periods->pluck('id')->all();

        return function () use ($periodIds): void {
            $handle = fopen('php://output', 'w');
            fputcsv($handle, self::HEADER);

            $this->exportQuery($periodIds)
                ->lazy(500)
                ->each(fn (Report $report) => $this->writeReportRows($handle, $report));

            fclose($handle);
        };
    }

    /**
     * @return list<string>
     */
    public function header(): array
    {
        return self::HEADER;
    }

    /**
     * Long-format data rows (no header), yielded in bounded chunks so memory stays
     * flat. Shared by the CSV stream and the xlsx export.
     *
     * @param  Collection<int, ReportingPeriod>  $periods
     * @return \Generator<int, list<string>>
     */
    public function lazyRows(Collection $periods): \Generator
    {
        $periodIds = $periods->pluck('id')->all();

        foreach ($this->exportQuery($periodIds)->lazy(500) as $report) {
            yield from $this->reportRows($report);
        }
    }

    /**
     * @param  list<string>  $periodIds
     * @return \Illuminate\Database\Eloquent\Builder<Report>
     */
    private function exportQuery(array $periodIds)
    {
        return Report::query()
            ->select('reports.*')
            ->with(['department', 'template.fieldDefinitions', 'fieldValues', 'reportingPeriod'])
            ->join('reporting_periods', 'reporting_periods.id', '=', 'reports.reporting_period_id')
            ->join('departments', 'departments.id', '=', 'reports.department_id')
            ->whereIn('reports.reporting_period_id', $periodIds)
            ->whereNotNull('reports.submitted_at')
            ->orderBy('reporting_periods.week_start')
            ->orderBy('departments.name')
            ->orderBy('reports.id');
    }

    /**
     * @param  resource  $handle
     */
    private function writeReportRows($handle, Report $report): void
    {
        foreach ($this->reportRows($report) as $row) {
            fputcsv($handle, array_map($this->sanitizeCell(...), $row));
        }
    }

    /**
     * @return \Generator<int, list<string>>
     */
    private function reportRows(Report $report): \Generator
    {
        $weekStart = $report->reportingPeriod?->week_start?->toDateString() ?? '';
        $weekEnd = $report->reportingPeriod?->week_end?->toDateString() ?? '';
        $definitions = $report->template?->fieldDefinitions?->sortBy('display_order') ?? collect();

        foreach ($definitions as $definition) {
            $value = $this->aggregate($definition, $report->fieldValues);
            if ($value === null) {
                continue;
            }

            yield [
                $weekStart,
                $weekEnd,
                $report->department?->name ?? '',
                $report->department?->family ?? '',
                (string) $definition->section_key,
                (string) $definition->label,
                (string) $definition->aggregate_type,
                $value,
            ];
        }
    }

    /**
     * Neutralize CSV/spreadsheet formula injection. A cell beginning with
     * =, +, @, or a control char can execute when opened in Excel/Sheets, and
     * report values include nurse-entered free text. Negative numbers are left
     * intact so the export stays numerically usable.
     */
    private function sanitizeCell(mixed $value): string
    {
        $value = (string) $value;

        if ($value === '') {
            return $value;
        }

        $first = $value[0];
        $dangerous = in_array($first, ['=', '+', '@', "\t", "\r"], true)
            || ($first === '-' && ! is_numeric($value));

        return $dangerous ? "'".$value : $value;
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
