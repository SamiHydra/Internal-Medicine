<?php

namespace App\Services\Reports;

use App\Models\Department;
use App\Models\ReportAssignment;
use App\Models\ReportingPeriod;
use App\Models\User;
use Illuminate\Support\Carbon;
use Illuminate\Validation\ValidationException;

/**
 * Loads an offline-edited spreadsheet (CSV or .xlsx, in the round-trippable
 * import-template layout) back into the system — the "roll forward" half of the
 * outage-continuity loop. Every imported report goes through the same
 * ReportSubmissionService validation as a live submission, so offline edits can
 * never bypass the cross-field/quality rules.
 */
class ReportImportService
{
    private const WEEKDAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

    public function __construct(
        private readonly ReportSubmissionService $submissionService,
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

        $header = array_map(fn ($value): string => strtolower(trim((string) $value)), array_shift($cellRows));
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
        foreach (self::WEEKDAYS as $day) {
            $dayColumns[$day] = $columnFor([$day]);
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

            foreach (self::WEEKDAYS as $day) {
                $column = $dayColumns[$day];
                if ($column === null) {
                    continue;
                }

                $value = trim($row[$column] ?? '');
                if ($value === '') {
                    continue;
                }

                $groups[$key]['values'][$fieldKey]['dailyValues'][$day] = $value;
            }
        }

        $imported = 0;
        $skipped = 0;
        $errors = [];

        foreach ($groups as $group) {
            $result = $this->importGroup($group, $actor, $submit);

            if ($result === true) {
                $imported++;
            } else {
                $skipped++;
                $errors[] = $result;
            }
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
     * @return true|string  true on success, or a human error message
     */
    private function importGroup(array $group, User $actor, bool $submit): bool|string
    {
        $week = (string) $group['week'];
        $departmentSlug = (string) $group['department'];

        $period = ReportingPeriod::query()
            ->whereDate('week_start', $this->normalizeDate($week))
            ->first();
        if (! $period) {
            return "No reporting period starts the week of {$week}.";
        }

        $department = Department::query()->where('slug', $departmentSlug)->first();
        if (! $department) {
            return "Unknown department '{$departmentSlug}'.";
        }

        $assignment = ReportAssignment::query()
            ->where('department_id', $department->id)
            ->where('active', true)
            ->latest('approved_at')
            ->first();
        if (! $assignment) {
            return "No active assignment for department '{$departmentSlug}'.";
        }

        try {
            $this->submissionService->save($actor, $assignment, $period, $group['values'] ?? [], $submit);

            return true;
        } catch (ValidationException $exception) {
            $messages = collect($exception->errors())->flatten()->implode(' ');

            return "Department '{$departmentSlug}', week {$week}: {$messages}";
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
