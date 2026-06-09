<?php

namespace App\Services\Reports;

use App\Models\Department;
use App\Models\Report;
use App\Models\ReportFieldDefinition;
use App\Models\ReportFieldValue;
use App\Models\ReportingPeriod;

/**
 * Produces the round-trippable import template — a per-day grid keyed by
 * department slug + field key, pre-filled with the period's current values. Staff
 * fill it offline during an outage; {@see ReportImportService} reads it back
 * losslessly.
 */
class ReportImportTemplateService
{
    public const HEADER = [
        'Week start', 'Department', 'Department slug', 'Section', 'Field', 'Field key',
        'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday',
    ];

    private const WEEKDAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

    /**
     * @return array{header: list<string>, rows: list<list<string>>}
     */
    public function build(ReportingPeriod $period, ?string $departmentSlug = null): array
    {
        $departments = Department::query()
            ->where('active', true)
            ->with(['template.fieldDefinitions'])
            ->when($departmentSlug, fn ($query) => $query->where('slug', $departmentSlug))
            ->orderBy('name')
            ->get();

        $reportsByDepartment = Report::query()
            ->where('reporting_period_id', $period->id)
            ->whereIn('department_id', $departments->pluck('id'))
            ->with(['fieldValues.fieldDefinition'])
            ->get()
            ->keyBy('department_id');

        $weekStart = $period->week_start?->toDateString() ?? '';
        $rows = [];

        foreach ($departments as $department) {
            $template = $department->template;
            if (! $template) {
                continue;
            }

            $activeDays = $template->active_days ?? [];
            $report = $reportsByDepartment->get($department->id);
            $valueMap = $this->valueMap($report);

            foreach ($template->fieldDefinitions->sortBy('display_order') as $definition) {
                $row = [
                    $weekStart,
                    $department->name,
                    $department->slug,
                    (string) $definition->section_key,
                    (string) $definition->label,
                    (string) $definition->field_key,
                ];

                foreach (self::WEEKDAYS as $day) {
                    $row[] = in_array($day, $activeDays, true)
                        ? (string) ($valueMap[$definition->field_key][$day] ?? '')
                        : '';
                }

                $rows[] = $row;
            }
        }

        return ['header' => self::HEADER, 'rows' => $rows];
    }

    /**
     * @return array<string, array<string, string>>  [fieldKey][day] => value
     */
    private function valueMap(?Report $report): array
    {
        if (! $report) {
            return [];
        }

        $map = [];
        foreach ($report->fieldValues as $value) {
            $key = $value->fieldDefinition?->field_key;
            if (! $key) {
                continue;
            }

            $map[$key][$value->day_name] = $this->scalar($value);
        }

        return $map;
    }

    private function scalar(ReportFieldValue $value): string
    {
        if ($value->value_number !== null) {
            $number = (float) $value->value_number;

            return floor($number) === $number ? (string) (int) $number : (string) $number;
        }

        if ($value->value_time !== null) {
            return substr((string) $value->value_time, 0, 5);
        }

        return (string) ($value->value_text ?? '');
    }
}
