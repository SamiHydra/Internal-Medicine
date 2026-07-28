<?php

namespace App\Services\Analytics;

use Illuminate\Database\Query\Builder;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Exports every historically submitted clinical report.
 *
 * CSV is the lossless, long-format data set: one row per nurse-entered daily
 * cell. Excel is the human-facing record: an index followed by one worksheet for
 * every submitted ward/week report, rendered in the same metric-by-weekday
 * matrix used by the nurse input screen. A final audit sheet retains
 * post-submission edits.
 *
 * Every sheet uses a cursor over scalar database rows. This avoids hydrating
 * tens of thousands of Eloquent models and keeps both time and memory bounded as
 * historical submissions grow.
 */
class AnalyticsExportService
{
    /** @var array<string, list<string>> */
    private array $formDaysCache = [];

    /** @var array<string, list<object>> */
    private array $formFieldsCache = [];

    private const WEEKDAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

    private const DAY_LABELS = [
        'monday' => 'Mon',
        'tuesday' => 'Tue',
        'wednesday' => 'Wed',
        'thursday' => 'Thu',
        'friday' => 'Fri',
        'saturday' => 'Sat',
        'sunday' => 'Sun',
    ];

    /**
     * Backend fallbacks for the presentation metadata used by the React form.
     * Admin-defined presentation.sections metadata takes precedence.
     *
     * @var array<string, list<array{id: string, title: string, description: string}>>
     */
    private const FORM_SECTIONS = [
        'inpatient_weekly' => [
            ['id' => 'patient_flow', 'title' => 'Patient Flow', 'description' => 'Admissions, transfers, discharges, and capacity movement.'],
            ['id' => 'quality_safety', 'title' => 'Quality & Safety', 'description' => 'Events, infections, and quality indicators that need oversight.'],
            ['id' => 'capacity', 'title' => 'Capacity & Stay', 'description' => 'Bed usage, length of stay, and occupancy-related indicators.'],
            ['id' => 'staffing', 'title' => 'Rounds & Staffing', 'description' => 'Operational coverage fields that are best reviewed alongside clinical flow.'],
        ],
        'outpatient_weekly' => [
            ['id' => 'activity', 'title' => 'Clinic Activity', 'description' => 'Volume, mix, and same-day service delivery.'],
            ['id' => 'access', 'title' => 'Access & Delay', 'description' => 'Wait time and appointment performance signals.'],
            ['id' => 'staffing', 'title' => 'Staffing & Coverage', 'description' => 'Clinic start and leadership presence.'],
        ],
        'procedure' => [
            ['id' => 'throughput', 'title' => 'Service Throughput', 'description' => 'Core service delivery volume by day.'],
            ['id' => 'turnaround', 'title' => 'Turnaround & Waiting', 'description' => 'Waiting time and reporting turnaround indicators.'],
            ['id' => 'staffing', 'title' => 'Reporting Staff', 'description' => 'Named operational accountability for the reporting week.'],
        ],
    ];

    private const SUBMISSIONS_HEADER = [
        'Report ID',
        'Form sheet',
        'Week start',
        'Week end',
        'Department',
        'Family',
        'Template',
        'Assigned nurse',
        'Nurse username',
        'Nurse email',
        'Status',
        'Submitted at',
        'Last updated at',
        'Locked at',
        'Submitted by',
        'Last updated by',
        'Submitted cell count',
    ];

    private const DATA_HEADER = [
        'Report ID',
        'Week start',
        'Week end',
        'Department',
        'Family',
        'Template',
        'Assigned nurse',
        'Nurse username',
        'Status',
        'Submitted at',
        'Day',
        'Section',
        'Field key',
        'Field',
        'Field type',
        'Value',
    ];

    private const SUMMARY_HEADER = [
        'Report ID',
        'Week start',
        'Week end',
        'Department',
        'Family',
        'Template',
        'Assigned nurse',
        'Status',
        'Submitted at',
        'Section',
        'Field key',
        'Field',
        'Aggregate',
        'Value',
    ];

    private const EDIT_HISTORY_HEADER = [
        'Report ID',
        'Week start',
        'Week end',
        'Department',
        'Family',
        'Template',
        'Field key',
        'Field',
        'Day',
        'Old value',
        'New value',
        'Changed by',
        'Changed at',
    ];

    /**
     * Stream all exact submitted cells to CSV without buffering the export.
     */
    public function streamCallback(): \Closure
    {
        return function (): void {
            $handle = fopen('php://output', 'w');
            fputcsv($handle, self::DATA_HEADER);

            foreach ($this->submittedDataRows() as $row) {
                fputcsv($handle, array_map($this->sanitizeCell(...), $row));
            }

            fclose($handle);
        };
    }

    /**
     * Sheet definitions consumed lazily by XlsxWriter.
     *
     * @return list<array{name: string, header: list<string>, rows: iterable<int, list<string>>}>
     */
    public function workbookSheets(): array
    {
        $reports = $this->submittedReportsForWorkbook();
        $usedSheetNames = ['Submission Index', 'Edit History'];
        $sheetNamesByReport = [];

        foreach ($reports as $report) {
            $sheetNamesByReport[(string) $report->report_id] = $this->reportSheetName(
                $report,
                $usedSheetNames,
            );
        }

        $sheets = [
            [
                'name' => 'Submission Index',
                'header' => self::SUBMISSIONS_HEADER,
                'rows' => $this->submissionRows($sheetNamesByReport),
                'columns' => [38, 28, 13, 13, 30, 14, 28, 26, 22, 30, 18, 21, 21, 21, 24, 24, 20],
                'freezeRows' => 1,
                'autoFilter' => true,
            ],
        ];

        foreach ($reports as $report) {
            $sheets[] = [
                'name' => $sheetNamesByReport[(string) $report->report_id],
                'rows' => $this->formRowsForReport($report),
                'columns' => [
                    48,
                    ...array_fill(0, count($this->formDays($report)), 14),
                    17,
                ],
                'showGridlines' => false,
            ];
        }

        $sheets[] = [
            'name' => 'Edit History',
            'header' => self::EDIT_HISTORY_HEADER,
            'rows' => $this->editHistoryRows(),
            'columns' => [38, 13, 13, 30, 14, 28, 24, 42, 12, 18, 18, 24, 21],
            'freezeRows' => 1,
            'autoFilter' => true,
        ];

        return $sheets;
    }

    /**
     * @return \Generator<int, list<string>>
     */
    public function submissionRows(array $sheetNamesByReport = []): \Generator
    {
        $submittedBy = DB::table('report_status_history as submission_history')
            ->select('submission_history.changed_by_name')
            ->whereColumn('submission_history.report_id', 'reports.id')
            ->where('submission_history.status', 'submitted')
            ->orderBy('submission_history.changed_at')
            ->limit(1);
        $cellCount = DB::table('report_field_values as counted_values')
            ->selectRaw('COUNT(*)')
            ->whereColumn('counted_values.report_id', 'reports.id');

        $query = $this->submittedReportsBaseQuery()
            ->leftJoin('users as creators', 'creators.id', '=', 'reports.created_by')
            ->leftJoin('users as updaters', 'updaters.id', '=', 'reports.updated_by')
            ->select([
                'reports.id as report_id',
                'templates.slug as template_slug',
                'periods.week_start',
                'periods.week_end',
                'departments.name as department_name',
                'departments.family',
                'templates.name as template_name',
                'nurses.full_name as nurse_name',
                'nurses.username as nurse_username',
                'nurses.email as nurse_email',
                'reports.status',
                'reports.submitted_at',
                'reports.updated_at',
                'reports.locked_at',
                'creators.full_name as creator_name',
                'updaters.full_name as updater_name',
            ])
            ->selectSub($submittedBy, 'submitted_by')
            ->selectSub($cellCount, 'cell_count');

        foreach ($query->cursor() as $row) {
            yield [
                (string) $row->report_id,
                $sheetNamesByReport[(string) $row->report_id]
                    ?? $this->reportSheetBaseName($row),
                $this->dateValue($row->week_start),
                $this->dateValue($row->week_end),
                (string) $row->department_name,
                (string) $row->family,
                (string) $row->template_name,
                (string) $row->nurse_name,
                (string) $row->nurse_username,
                (string) $row->nurse_email,
                (string) $row->status,
                (string) $row->submitted_at,
                (string) $row->updated_at,
                (string) ($row->locked_at ?? ''),
                (string) ($row->submitted_by ?? $row->creator_name ?? ''),
                (string) ($row->updater_name ?? ''),
                (string) $row->cell_count,
            ];
        }
    }

    /**
     * Every submitted ward/week report becomes exactly one worksheet.
     *
     * @return Collection<int, object>
     */
    private function submittedReportsForWorkbook(): Collection
    {
        return DB::table('reports')
            ->join('reporting_periods as periods', 'periods.id', '=', 'reports.reporting_period_id')
            ->join('departments', 'departments.id', '=', 'reports.department_id')
            ->join('report_templates as templates', 'templates.id', '=', 'reports.template_id')
            ->join('report_assignments as assignments', 'assignments.id', '=', 'reports.assignment_id')
            ->join('users as nurses', 'nurses.id', '=', 'assignments.nurse_id')
            ->whereNotNull('reports.submitted_at')
            ->select([
                'reports.id as report_id',
                'reports.status',
                'reports.submitted_at',
                'reports.updated_at',
                'reports.locked_at',
                'periods.week_start',
                'periods.week_end',
                'departments.name as department_name',
                'departments.family',
                'templates.id as template_id',
                'templates.slug',
                'templates.name as template_name',
                'templates.description as template_description',
                'templates.active_days',
                'templates.metadata',
                'nurses.full_name as nurse_name',
                'nurses.username as nurse_username',
            ])
            ->orderByDesc('periods.week_start')
            ->orderBy('departments.name')
            ->orderBy('reports.id')
            ->get();
    }

    /**
     * Current template days plus any weekday which still owns historical cells.
     * This prevents an admin day-setting change from silently hiding old data.
     *
     * @return list<string>
     */
    private function formDays(object $template): array
    {
        $templateId = (string) $template->template_id;

        if (isset($this->formDaysCache[$templateId])) {
            return $this->formDaysCache[$templateId];
        }

        $configured = $this->arrayValue($template->active_days);
        $historical = DB::table('report_field_values as values')
            ->join('reports', 'reports.id', '=', 'values.report_id')
            ->where('reports.template_id', $templateId)
            ->whereNotNull('reports.submitted_at')
            ->distinct()
            ->pluck('values.day_name')
            ->all();
        $included = array_fill_keys([...$configured, ...$historical], true);

        return $this->formDaysCache[$templateId] = array_values(array_filter(
            self::WEEKDAYS,
            fn (string $day): bool => isset($included[$day]),
        ));
    }

    /**
     * Render one submitted report into its own website-shaped worksheet.
     *
     * @return \Generator<int, array<string, mixed>>
     */
    private function formRowsForReport(object $report): \Generator
    {
        $fields = $this->formFields((string) $report->template_id);
        $sections = $this->formSections($report, $fields);
        $cells = [];

        $query = DB::table('report_field_values')
            ->where('report_id', $report->report_id)
            ->select([
                'field_definition_id',
                'day_name',
                'value_number',
                'value_text',
                'value_time',
                'value_json',
            ])
            ->selectRaw($this->dayOrderSql('report_field_values').' as day_order')
            ->orderBy('field_definition_id')
            ->orderBy('day_order')
            ->orderBy('id');

        foreach ($query->cursor() as $row) {
            $cells[(string) $row->field_definition_id][(string) $row->day_name] = $this->storedDatabaseValue($row);
        }

        yield from $this->renderFormBlock(
            $report,
            $fields,
            $sections,
            $this->formDays($report),
            $cells,
        );
    }

    /**
     * @return list<object>
     */
    private function formFields(string $templateId): array
    {
        if (isset($this->formFieldsCache[$templateId])) {
            return $this->formFieldsCache[$templateId];
        }

        $fields = DB::table('report_field_definitions')
            ->where('template_id', $templateId)
            ->select([
                'id',
                'section_key',
                'field_key',
                'label',
                'field_kind',
                'aggregate_type',
                'display_order',
                'active',
                'metadata',
            ])
            ->orderBy('display_order')
            ->orderBy('id')
            ->get()
            ->all();

        return $this->formFieldsCache[$templateId] = $fields;
    }

    /**
     * @param  list<object>  $fields
     * @param  list<array{id: string, title: string, description: string}>  $sections
     * @param  list<string>  $days
     * @param  array<string, array<string, string>>  $cells
     * @return \Generator<int, array<string, mixed>>
     */
    private function renderFormBlock(
        object $report,
        array $fields,
        array $sections,
        array $days,
        array $cells,
    ): \Generator {
        $columnCount = count($days) + 2;
        $title = (string) $report->department_name.' weekly report';
        $subtitle = (string) $report->template_name.' · '
            .$this->dateValue($report->week_start).' – '.$this->dateValue($report->week_end);

        yield [
            'cells' => [$title],
            'style' => 'report_title',
            'height' => 34,
            'mergeAcross' => $columnCount,
        ];
        yield [
            'cells' => [$subtitle],
            'style' => 'report_subtitle',
            'height' => 23,
            'mergeAcross' => $columnCount,
        ];
        yield $this->metadataRow(
            'Week',
            $this->dateValue($report->week_start).' – '.$this->dateValue($report->week_end),
            'Status',
            Str::headline((string) $report->status),
            $columnCount,
        );
        yield $this->metadataRow(
            'Department',
            (string) $report->department_name,
            'Assigned nurse',
            (string) $report->nurse_name,
            $columnCount,
        );
        yield $this->metadataRow(
            'Submitted at',
            (string) $report->submitted_at,
            'Report ID',
            (string) $report->report_id,
            $columnCount,
        );
        yield ['cells' => [''], 'height' => 8];

        $fieldsBySection = [];
        $valuesByKey = [];

        foreach ($fields as $field) {
            $hasStoredValues = isset($cells[(string) $field->id]);
            if (! (bool) $field->active && ! $hasStoredValues) {
                continue;
            }

            $fieldsBySection[(string) $field->section_key][] = $field;
            $valuesByKey[(string) $field->field_key] = $cells[(string) $field->id] ?? [];
        }

        foreach ($sections as $section) {
            $sectionFields = $fieldsBySection[$section['id']] ?? [];

            yield [
                'cells' => [$section['title']],
                'style' => 'section_title',
                'height' => 28,
                'mergeAcross' => $columnCount,
            ];
            yield [
                'cells' => [$section['description']],
                'style' => 'section_description',
                'height' => 22,
                'mergeAcross' => $columnCount,
            ];
            yield [
                'cells' => [
                    'Metric',
                    ...array_map(fn (string $day): string => self::DAY_LABELS[$day], $days),
                    'Weekly total',
                ],
                'style' => 'table_header',
                'height' => 24,
            ];

            foreach ($sectionFields as $field) {
                $fieldValues = $cells[(string) $field->id] ?? [];
                $fieldMetadata = $this->arrayValue($field->metadata);
                $entryHint = isset($fieldMetadata['unit']) && $fieldMetadata['unit'] !== ''
                    ? 'Unit: '.(string) $fieldMetadata['unit']
                    : 'Daily entry';
                $daily = array_map(
                    fn (string $day): string => $fieldValues[$day] ?? '',
                    $days,
                );

                yield [
                    'cells' => [
                        (string) $field->label."\n".$entryHint,
                        ...$daily,
                        $this->formWeeklyValue($field, $fieldValues, $valuesByKey),
                    ],
                    'styles' => [
                        'metric',
                        ...array_fill(0, count($days), 'value'),
                        'weekly_total',
                    ],
                    'height' => 42,
                ];
            }

            yield ['cells' => [''], 'height' => 8];
        }

        // A strong visual break keeps adjacent historical submissions from
        // reading as one continuous form.
        yield ['cells' => [''], 'height' => 18];
    }

    /**
     * @return array<string, mixed>
     */
    private function metadataRow(
        string $firstLabel,
        string $firstValue,
        string $secondLabel,
        string $secondValue,
        int $columnCount,
    ): array {
        $secondLabelColumn = intdiv($columnCount, 2);
        $cells = array_fill(0, $columnCount, '');
        $styles = array_fill(0, $columnCount, 'meta_value');
        $cells[0] = $firstLabel;
        $cells[1] = $firstValue;
        $cells[$secondLabelColumn] = $secondLabel;
        $cells[$secondLabelColumn + 1] = $secondValue;
        $styles[0] = 'meta_label';
        $styles[$secondLabelColumn] = 'meta_label';

        return [
            'cells' => $cells,
            'styles' => $styles,
            'height' => 25,
            'mergeRanges' => [
                [1, $secondLabelColumn - 1],
                [$secondLabelColumn + 1, $columnCount - 1],
            ],
        ];
    }

    /**
     * @param  list<object>  $fields
     * @return list<array{id: string, title: string, description: string}>
     */
    private function formSections(object $template, array $fields): array
    {
        $metadata = $this->arrayValue($template->metadata);
        $configured = $metadata['presentation']['sections'] ?? null;
        $fallbackKey = (string) $template->slug === 'inpatient_weekly'
            ? 'inpatient_weekly'
            : ((string) $template->slug === 'outpatient_weekly' ? 'outpatient_weekly' : 'procedure');
        $source = is_array($configured) && $configured !== []
            ? $configured
            : self::FORM_SECTIONS[$fallbackKey];
        $sections = [];

        foreach ($source as $section) {
            if (! is_array($section)) {
                continue;
            }

            $id = (string) ($section['id'] ?? '');
            if ($id === '') {
                continue;
            }

            $sections[] = [
                'id' => $id,
                'title' => (string) ($section['title'] ?? Str::headline($id)),
                'description' => (string) ($section['description'] ?? ''),
            ];
        }

        $known = array_fill_keys(array_column($sections, 'id'), true);
        foreach ($fields as $field) {
            $sectionKey = (string) $field->section_key;
            if (isset($known[$sectionKey])) {
                continue;
            }

            $sections[] = [
                'id' => $sectionKey,
                'title' => Str::headline($sectionKey),
                'description' => '',
            ];
            $known[$sectionKey] = true;
        }

        return $sections;
    }

    /**
     * Match the weekly-total behavior shown by report-form.tsx.
     *
     * @param  array<string, string>  $values
     * @param  array<string, array<string, string>>  $allValuesByKey
     */
    private function formWeeklyValue(object $field, array $values, array $allValuesByKey): string
    {
        if ((string) $field->field_key === 'total_admitted_patients') {
            $total = $this->numericSum($values)
                + $this->numericSum($allValuesByKey['new_admitted_patients'] ?? []);

            return $this->formatFormNumber($total, (string) $field->field_kind);
        }

        if ((string) $field->aggregate_type === 'sum') {
            return $this->formatFormNumber($this->numericSum($values), (string) $field->field_kind);
        }

        if ((string) $field->aggregate_type === 'average') {
            $numbers = $this->numericValues($values);

            return $numbers === []
                ? '-'
                : $this->formatFormNumber(array_sum($numbers) / count($numbers), (string) $field->field_kind);
        }

        if ((string) $field->aggregate_type === 'latest') {
            foreach (array_reverse(self::WEEKDAYS) as $day) {
                if (isset($values[$day]) && $values[$day] !== '') {
                    return $values[$day];
                }
            }
        }

        return '-';
    }

    /**
     * @param  array<string, string>  $values
     */
    private function numericSum(array $values): float
    {
        return array_sum($this->numericValues($values));
    }

    /**
     * @param  array<string, string>  $values
     * @return list<float>
     */
    private function numericValues(array $values): array
    {
        return array_values(array_map(
            fn (string $value): float => (float) $value,
            array_filter($values, fn (string $value): bool => $value !== '' && is_numeric($value)),
        ));
    }

    private function formatFormNumber(float $value, string $fieldKind): string
    {
        if ($fieldKind === 'decimal') {
            return number_format($value, 1, '.', '');
        }

        return $this->number($value);
    }

    /**
     * @return array<mixed>
     */
    private function arrayValue(mixed $value): array
    {
        if (is_array($value)) {
            return $value;
        }

        if (! is_string($value) || $value === '') {
            return [];
        }

        $decoded = json_decode($value, true);

        return is_array($decoded) ? $decoded : [];
    }

    private function reportSheetBaseName(object $report): string
    {
        $week = $this->dateValue($report->week_start);
        $ward = trim((string) preg_replace('/[\[\]:*?\/\\\\]/', ' ', (string) $report->department_name));

        return trim($week.' '.$ward);
    }

    /**
     * Excel limits worksheet names to 31 characters. Keep the ward and week
     * visible, then add a deterministic numeric suffix only when truncation
     * causes two submissions to collide.
     *
     * @param  list<string>  $usedNames
     */
    private function reportSheetName(object $report, array &$usedNames): string
    {
        $base = mb_substr($this->reportSheetBaseName($report), 0, 31);
        $name = $base !== '' ? $base : 'Clinical submission';
        $suffix = 2;
        $normalized = array_map('mb_strtolower', $usedNames);

        while (in_array(mb_strtolower($name), $normalized, true)) {
            $tail = ' '.$suffix++;
            $name = mb_substr($base, 0, 31 - mb_strlen($tail)).$tail;
        }

        $usedNames[] = $name;

        return $name;
    }

    /**
     * Lossless long-format rows: every stored nurse-entered day/field value.
     *
     * @return \Generator<int, list<string>>
     */
    public function submittedDataRows(): \Generator
    {
        foreach ($this->submittedCellQuery()->cursor() as $row) {
            yield $this->dataRow($row);
        }
    }

    /**
     * Existing weekly sums/averages/latest values, retained as a separate
     * management summary instead of replacing the raw nurse-entered cells.
     *
     * @return \Generator<int, list<string>>
     */
    public function weeklySummaryRows(): \Generator
    {
        $group = [];
        $groupKey = null;

        foreach ($this->submittedCellQuery()->cursor() as $row) {
            $nextKey = $row->report_id.'|'.$row->field_definition_id;

            if ($groupKey !== null && $nextKey !== $groupKey) {
                yield $this->summaryRow($group);
                $group = [];
            }

            $groupKey = $nextKey;
            $group[] = $row;
        }

        if ($group !== []) {
            yield $this->summaryRow($group);
        }
    }

    /**
     * Every audit entry here was recorded after a report had already been
     * submitted, so this sheet is the complete post-submission cell edit trail.
     *
     * @return \Generator<int, list<string>>
     */
    public function editHistoryRows(): \Generator
    {
        $query = DB::table('audit_logs as audit')
            ->join('reports', 'reports.id', '=', 'audit.report_id')
            ->join('reporting_periods as periods', 'periods.id', '=', 'reports.reporting_period_id')
            ->join('departments', 'departments.id', '=', 'audit.department_id')
            ->join('report_templates as templates', 'templates.id', '=', 'audit.template_id')
            ->leftJoin('report_field_definitions as definitions', 'definitions.id', '=', 'audit.field_definition_id')
            ->whereNotNull('reports.submitted_at')
            ->select([
                'audit.report_id',
                'periods.week_start',
                'periods.week_end',
                'departments.name as department_name',
                'departments.family',
                'templates.name as template_name',
                'audit.field_key',
                'definitions.label as field_label',
                'audit.day_name',
                'audit.old_value',
                'audit.new_value',
                'audit.changed_by_name',
                'audit.changed_at',
            ])
            ->orderBy('audit.changed_at')
            ->orderBy('audit.id');

        foreach ($query->cursor() as $row) {
            yield [
                (string) $row->report_id,
                $this->dateValue($row->week_start),
                $this->dateValue($row->week_end),
                (string) $row->department_name,
                (string) $row->family,
                (string) $row->template_name,
                (string) $row->field_key,
                (string) ($row->field_label ?? ''),
                ucfirst((string) ($row->day_name ?? '')),
                (string) ($row->old_value ?? ''),
                (string) ($row->new_value ?? ''),
                (string) ($row->changed_by_name ?? ''),
                (string) $row->changed_at,
            ];
        }
    }

    private function submittedReportsBaseQuery(): Builder
    {
        return DB::table('reports')
            ->join('reporting_periods as periods', 'periods.id', '=', 'reports.reporting_period_id')
            ->join('departments', 'departments.id', '=', 'reports.department_id')
            ->join('report_templates as templates', 'templates.id', '=', 'reports.template_id')
            ->join('report_assignments as assignments', 'assignments.id', '=', 'reports.assignment_id')
            ->join('users as nurses', 'nurses.id', '=', 'assignments.nurse_id')
            ->whereNotNull('reports.submitted_at')
            ->orderByDesc('periods.week_start')
            ->orderBy('departments.name')
            ->orderBy('reports.id');
    }

    private function submittedCellQuery(): Builder
    {
        return DB::table('report_field_values as field_values')
            ->join('reports', 'reports.id', '=', 'field_values.report_id')
            ->join('reporting_periods as periods', 'periods.id', '=', 'reports.reporting_period_id')
            ->join('departments', 'departments.id', '=', 'reports.department_id')
            ->join('report_templates as templates', 'templates.id', '=', 'reports.template_id')
            ->join('report_assignments as assignments', 'assignments.id', '=', 'reports.assignment_id')
            ->join('users as nurses', 'nurses.id', '=', 'assignments.nurse_id')
            ->join('report_field_definitions as definitions', 'definitions.id', '=', 'field_values.field_definition_id')
            ->whereNotNull('reports.submitted_at')
            ->select([
                'reports.id as report_id',
                'reports.status',
                'reports.submitted_at',
                'periods.week_start',
                'periods.week_end',
                'departments.name as department_name',
                'departments.family',
                'templates.name as template_name',
                'nurses.full_name as nurse_name',
                'nurses.username as nurse_username',
                'field_values.field_definition_id',
                'field_values.day_name',
                'field_values.value_number',
                'field_values.value_text',
                'field_values.value_time',
                'field_values.value_json',
                'definitions.section_key',
                'definitions.field_key',
                'definitions.label as field_label',
                'definitions.field_kind',
                'definitions.aggregate_type',
                'definitions.display_order',
            ])
            ->selectRaw($this->dayOrderSql().' as day_order')
            ->orderByDesc('periods.week_start')
            ->orderBy('departments.name')
            ->orderBy('reports.id')
            ->orderBy('definitions.display_order')
            ->orderBy('field_values.field_definition_id')
            ->orderBy('day_order')
            ->orderBy('field_values.id');
    }

    /**
     * @return list<string>
     */
    private function dataRow(object $row): array
    {
        return [
            (string) $row->report_id,
            $this->dateValue($row->week_start),
            $this->dateValue($row->week_end),
            (string) $row->department_name,
            (string) $row->family,
            (string) $row->template_name,
            (string) $row->nurse_name,
            (string) $row->nurse_username,
            (string) $row->status,
            (string) $row->submitted_at,
            ucfirst((string) $row->day_name),
            (string) $row->section_key,
            (string) $row->field_key,
            (string) $row->field_label,
            (string) $row->field_kind,
            $this->storedDatabaseValue($row),
        ];
    }

    /**
     * @param  list<object>  $rows
     * @return list<string>
     */
    private function summaryRow(array $rows): array
    {
        $first = $rows[0];
        $value = $this->aggregateDatabaseRows($rows);

        return [
            (string) $first->report_id,
            $this->dateValue($first->week_start),
            $this->dateValue($first->week_end),
            (string) $first->department_name,
            (string) $first->family,
            (string) $first->template_name,
            (string) $first->nurse_name,
            (string) $first->status,
            (string) $first->submitted_at,
            (string) $first->section_key,
            (string) $first->field_key,
            (string) $first->field_label,
            (string) $first->aggregate_type,
            $value,
        ];
    }

    /**
     * @param  list<object>  $rows
     */
    private function aggregateDatabaseRows(array $rows): string
    {
        $first = $rows[0];

        if (in_array($first->field_kind, ['integer', 'decimal'], true)) {
            $numbers = array_values(array_map(
                fn (object $row): float => (float) $row->value_number,
                array_filter($rows, fn (object $row): bool => $row->value_number !== null),
            ));

            if ($numbers === []) {
                return '';
            }

            return match ($first->aggregate_type) {
                'average' => $this->number(round(array_sum($numbers) / count($numbers), 4)),
                'latest' => $this->number((float) end($numbers)),
                default => $this->number(array_sum($numbers)),
            };
        }

        return $this->storedDatabaseValue($rows[array_key_last($rows)]);
    }

    private function storedDatabaseValue(object $row): string
    {
        if ($row->value_number !== null) {
            return $this->number((float) $row->value_number);
        }

        if ($row->value_time !== null) {
            return substr((string) $row->value_time, 0, 5);
        }

        if ($row->value_text !== null) {
            return (string) $row->value_text;
        }

        if ($row->value_json === null) {
            return '';
        }

        if (is_string($row->value_json)) {
            return $row->value_json;
        }

        return (string) json_encode($row->value_json, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    }

    /**
     * Neutralize CSV/spreadsheet formula injection. Negative numbers remain
     * numeric; non-numeric formula-like values are prefixed with an apostrophe.
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

    private function dayOrderSql(string $table = 'field_values'): string
    {
        $cases = collect(self::WEEKDAYS)
            ->map(fn (string $day, int $index): string => "WHEN '{$day}' THEN {$index}")
            ->implode(' ');

        return "CASE {$table}.day_name {$cases} ELSE 99 END";
    }

    private function dateValue(mixed $value): string
    {
        return substr((string) $value, 0, 10);
    }

    private function number(float $value): string
    {
        if (floor($value) === $value) {
            return (string) (int) $value;
        }

        return rtrim(rtrim(number_format($value, 4, '.', ''), '0'), '.');
    }
}
