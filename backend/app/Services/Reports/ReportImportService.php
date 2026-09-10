<?php

namespace App\Services\Reports;

use App\Models\Department;
use App\Models\ReportAssignment;
use App\Models\ReportFieldDefinition;
use App\Models\ReportingPeriod;
use App\Models\User;
use App\Services\Analytics\DashboardAnalyticsService;
use App\Support\Export\SpreadsheetSafe;
use Illuminate\Support\Carbon;
use Illuminate\Support\Collection;
use Illuminate\Validation\ValidationException;

/**
 * Loads an offline-edited spreadsheet (CSV or .xlsx, in the round-trippable
 * import-template layout) back into the system - the "roll forward" half of the
 * outage-continuity loop. Every imported report goes through the same
 * ReportSubmissionService validation as a live submission, so offline edits can
 * never bypass the coercion/cross-field/quality rules.
 *
 * A present-but-blank cell for an active day is treated as an intentional clear
 * (so an offline deletion round-trips), inactive fields/days are ignored, and a
 * bad group degrades to a reported skip rather than aborting the whole import.
 */
class ReportImportService
{
    private const WEEKDAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

    public function __construct(
        private readonly ReportSubmissionService $submissionService,
        private readonly DashboardAnalyticsService $dashboardAnalytics,
    ) {}

    /**
     * @param  array<int, array<int, string>>  $cellRows  parsed rows incl. the header
     * @return array{imported: int, skipped: int, reports: int, errors: list<string>}
     */
    public function import(array $cellRows, User $actor, bool $submit = false): array
    {
        $empty = ['imported' => 0, 'skipped' => 0, 'reports' => 0];

        if (count($cellRows) < 2) {
            return [...$empty, 'errors' => ['The file has no data rows.']];
        }

        // strtolower + trim + strip a leading UTF-8 BOM (Excel's "CSV UTF-8" save
        // prepends one, which would otherwise hide the first header).
        $header = array_map(
            fn ($value): string => strtolower(trim(ltrim((string) $value, "\u{FEFF}"))),
            array_shift($cellRows),
        );
        $columnFor = function (array $aliases) use ($header): ?int {
            foreach ($header as $index => $name) {
                if (in_array($name, $aliases, true)) {
                    return $index;
                }
            }

            return null;
        };

        $weekColumn = $columnFor(['week_start', 'week start']);
        $departmentColumn = $columnFor(['department_slug', 'department slug']);
        $fieldColumn = $columnFor(['field_key', 'field key']);
        $dayColumns = [];
        $presentDays = [];
        foreach (self::WEEKDAYS as $day) {
            $column = $columnFor([$day]);
            $dayColumns[$day] = $column;
            if ($column !== null) {
                $presentDays[] = $day;
            }
        }

        $missing = array_keys(array_filter([
            'week_start' => $weekColumn === null,
            'department_slug' => $departmentColumn === null,
            'field_key' => $fieldColumn === null,
        ]));

        if ($missing !== []) {
            return [...$empty, 'errors' => ['Missing required columns: '.implode(', ', $missing).'.']];
        }

        $groups = [];
        foreach ($cellRows as $row) {
            $week = trim($row[$weekColumn] ?? '');
            $departmentSlug = trim($row[$departmentColumn] ?? '');
            $fieldKey = trim($row[$fieldColumn] ?? '');

            if ($week === '' || $departmentSlug === '' || $fieldKey === '') {
                continue;
            }

            $key = $week.'|'.$departmentSlug;
            $groups[$key]['week'] = $week;
            $groups[$key]['department'] = $departmentSlug;

            // Record EVERY present day cell (including blanks) so a cleared cell
            // can be erased on import, matching the live web form.
            foreach ($presentDays as $day) {
                $groups[$key]['fields'][$fieldKey][$day] = trim($row[$dayColumns[$day]] ?? '');
            }
        }

        $imported = 0;
        $skipped = 0;
        $errors = [];

        // Resolve reference data once for the entire upload. Previously every
        // department/week group repeated the same period, department, assignment,
        // template, and definition queries before reaching the save service.
        $weeks = collect($groups)
            ->pluck('week')
            ->map(fn (string $week): string => $this->normalizeDate($week))
            ->unique()
            ->values();
        $departments = Department::query()
            ->whereIn('slug', collect($groups)->pluck('department')->unique()->values())
            ->get()
            ->keyBy('slug');
        $weekRanges = $weeks
            ->map(function (string $week): ?array {
                try {
                    $start = Carbon::parse($week)->startOfDay();

                    return [$start, $start->copy()->addDay()];
                } catch (\Throwable) {
                    return null;
                }
            })
            ->filter()
            ->values();
        $periods = ReportingPeriod::query()
            ->where(function ($query) use ($weekRanges): void {
                if ($weekRanges->isEmpty()) {
                    $query->whereRaw('1 = 0');
                }

                foreach ($weekRanges as [$start, $end]) {
                    // Works for SQLite's datetime text and MariaDB DATE/DATETIME
                    // columns while keeping week_start indexable (no whereDate()).
                    $query->orWhere(function ($range) use ($start, $end): void {
                        $range->where('week_start', '>=', $start)
                            ->where('week_start', '<', $end);
                    });
                }
            })
            ->get()
            ->keyBy(fn (ReportingPeriod $period): string => $period->week_start->toDateString());
        $assignments = ReportAssignment::query()
            ->whereIn('department_id', $departments->pluck('id'))
            ->where('active', true)
            ->with('template.fieldDefinitions')
            ->orderByDesc('approved_at')
            ->get()
            ->groupBy('department_id')
            ->map(fn (Collection $items): ReportAssignment => $items->first());

        foreach ($groups as $group) {
            $result = $this->importGroup(
                $group,
                $actor,
                $submit,
                $periods,
                $departments,
                $assignments,
            );

            if ($result === true) {
                $imported++;
            } else {
                $skipped++;
                $errors[] = $result;
            }
        }

        // Invalidate the analytics cache once for the whole import rather than
        // once per saved group (each save deferred its own invalidation).
        if ($imported > 0) {
            $this->dashboardAnalytics->invalidate();
        }

        return [
            'imported' => $imported,
            'skipped' => $skipped,
            'reports' => count($groups),
            'errors' => $errors,
        ];
    }

    /**
     * @param  array<string, mixed>  $group
     * @param  Collection<string, ReportingPeriod>  $periods
     * @param  Collection<string, Department>  $departments
     * @param  Collection<string, ReportAssignment>  $assignments
     * @return true|string true on success, or a human error message
     */
    private function importGroup(
        array $group,
        User $actor,
        bool $submit,
        Collection $periods,
        Collection $departments,
        Collection $assignments,
    ): bool|string {
        $week = (string) $group['week'];
        $departmentSlug = (string) $group['department'];

        // An Excel date serial arrives as a number; never silently coerce it.
        if (is_numeric($week)) {
            return "Week start '{$week}' is not a date - format the column as text/date in Excel.";
        }

        $period = $periods->get($this->normalizeDate($week));
        if (! $period) {
            return "No reporting period starts the week of {$week}.";
        }

        $department = $departments->get($departmentSlug);
        if (! $department) {
            return "Unknown department '{$departmentSlug}'.";
        }

        $assignment = $assignments->get($department->id);
        if (! $assignment) {
            return "No active assignment for department '{$departmentSlug}'.";
        }

        $activeDays = $assignment->template?->active_days ?? [];
        $inactiveFieldKeys = ($assignment->template?->fieldDefinitions ?? collect())
            ->reject(fn (ReportFieldDefinition $definition): bool => (bool) $definition->active)
            ->pluck('field_key')
            ->all();

        $values = [];
        foreach (($group['fields'] ?? []) as $fieldKey => $days) {
            // Never write to soft-disabled fields (the live form hides them).
            if (in_array($fieldKey, $inactiveFieldKeys, true)) {
                continue;
            }

            foreach ($days as $day => $raw) {
                // Ignore stray values in inactive-day columns instead of failing
                // the whole group on one cell.
                if (! in_array($day, $activeDays, true)) {
                    continue;
                }

                // Blank '' flows through coerceValue -> null -> delete, so a
                // cleared offline cell erases the stored value.
                $values[$fieldKey]['dailyValues'][$day] = SpreadsheetSafe::unsanitize($raw);
            }
        }

        try {
            $this->submissionService->save($actor, $assignment, $period, $values, $submit, invalidateAnalytics: false);

            return true;
        } catch (ValidationException $exception) {
            $messages = collect($exception->errors())->flatten()->implode(' ');

            return "Department '{$departmentSlug}', week {$week}: {$messages}";
        } catch (\Throwable $exception) {
            // A non-validation failure must degrade to a skip, not abort the whole
            // import (which would leave earlier groups committed and a 500).
            return "Department '{$departmentSlug}', week {$week}: {$exception->getMessage()}";
        }
    }

    private function normalizeDate(string $week): string
    {
        try {
            return Carbon::parse($week)->toDateString();
        } catch (\Throwable) {
            return $week;
        }
    }
}
