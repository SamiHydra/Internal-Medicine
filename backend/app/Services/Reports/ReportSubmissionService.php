<?php

namespace App\Services\Reports;

use App\Models\AuditLog;
use App\Models\Notification;
use App\Models\Report;
use App\Models\ReportAssignment;
use App\Models\ReportFieldDefinition;
use App\Models\ReportFieldValue;
use App\Models\ReportingPeriod;
use App\Models\ReportStatusHistory;
use App\Models\User;
use App\Services\Analytics\DashboardAnalyticsService;
use App\Support\Authorization\Permissions;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

class ReportSubmissionService
{
    private const WEEKDAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

    // Fits the decimal(14,4) value_number column (10 integer digits). Guards
    // against e.g. an imported "1e18" overflowing the DB into a raw 500.
    private const MAX_FIELD_VALUE = 9_999_999_999;

    public function __construct(
        private readonly ReportCalculationService $calculationService,
        private readonly CriticalEventAlertService $criticalEventAlertService,
        private readonly ReportTrendAlertService $trendAlertService,
        private readonly DashboardAnalyticsService $dashboardAnalytics,
        private readonly ReportQualityService $qualityService,
    ) {}

    /**
     * @param  array<string, mixed>  $values
     *
     * @throws AuthorizationException
     * @throws ValidationException
     */
    public function save(User $actor, ReportAssignment $assignment, ReportingPeriod $period, array $values, bool $submit = false, bool $invalidateAnalytics = true): Report
    {
        $report = DB::transaction(function () use ($actor, $assignment, $period, $values, $submit): Report {
            $assignment->loadMissing(['department', 'template.fieldDefinitions']);

            $this->authorizeAssignmentEdit($actor, $assignment);

            $now = now();
            $report = Report::query()
                ->where('assignment_id', $assignment->id)
                ->where('reporting_period_id', $period->id)
                ->lockForUpdate()
                ->first();

            if ($report?->locked_at !== null) {
                throw ValidationException::withMessages([
                    'report' => 'Locked reports are read-only.',
                ]);
            }

            $createdReport = false;
            $hadSubmission = $report?->submitted_at !== null;

            if (! $report) {
                $report = Report::query()->create([
                    'assignment_id' => $assignment->id,
                    'department_id' => $assignment->department_id,
                    'template_id' => $assignment->template_id,
                    'reporting_period_id' => $period->id,
                    'status' => $submit ? 'submitted' : 'draft',
                    'submitted_at' => $submit ? $now : null,
                    'created_by' => $actor->id,
                    'updated_by' => $actor->id,
                ]);
                $createdReport = true;
            }

            $report->loadMissing(['assignment', 'template', 'department']);

            $hasChanges = $this->persistValues($actor, $assignment, $report, $values, $hadSubmission, $now);
            $this->qualityService->assertValid($report->refresh());
            $nextStatus = $this->nextStatus($report, $hadSubmission, $hasChanges, $submit);

            $report->forceFill([
                'status' => $nextStatus,
                'submitted_at' => match (true) {
                    $hadSubmission => $report->submitted_at,
                    $submit => $now,
                    default => null,
                },
                'updated_by' => $actor->id,
                'updated_at' => $now,
            ])->save();

            if ($createdReport) {
                $this->recordStatus($report, 'draft', $actor, 'Draft created from the web form.', $now);
            }

            if (! $hadSubmission && $submit) {
                $this->recordStatus($report, 'submitted', $actor, 'Weekly report submitted.', $now);
                $this->notifyAdmins(
                    'new_report_submitted',
                    'New report submitted',
                    sprintf('%s submitted %s.', $assignment->department?->name ?? 'A department', $assignment->template?->name ?? 'a report'),
                    $this->relatedRoute($assignment, $period),
                    'report_submission',
                    $report->id,
                    $now,
                );
            } elseif ($hadSubmission && $hasChanges) {
                $this->recordStatus($report, 'edited_after_submission', $actor, 'Submitted report changed while still unlocked.', $now);
                $this->notifyAdmins(
                    'submitted_report_edited',
                    'Submitted report edited',
                    sprintf('%s was updated after submission by %s.', $assignment->department?->name ?? 'A department', $actor->full_name),
                    $this->relatedRoute($assignment, $period),
                    'report_edit',
                    $report->id,
                    $now,
                );
            }

            if ((! $hadSubmission && $submit) || ($hadSubmission && $hasChanges)) {
                $this->criticalEventAlertService->notify($report, $this->relatedRoute($assignment, $period), $now);
                $quality = $this->qualityService->analyze($report->refresh(), true);
                $this->trendAlertService->notify($report, $quality['warnings'] ?? [], $this->relatedRoute($assignment, $period), $now);
            }

            $this->calculationService->upsertForReport($report->refresh());

            return $report->load([
                'assignment.department',
                'assignment.template',
                'department',
                'template',
                'reportingPeriod',
                'fieldValues.fieldDefinition',
                'calculatedMetric',
            ]);
        });

        // A bulk import defers this and invalidates once after all groups, so a
        // multi-week/department import does not flush the cache N times.
        if ($invalidateAnalytics) {
            $this->dashboardAnalytics->invalidate();
        }

        return $report;
    }

    /**
     * @param  array<string, mixed>  $values
     *
     * @throws ValidationException
     */
    private function persistValues(User $actor, ReportAssignment $assignment, Report $report, array $values, bool $hadSubmission, Carbon $changedAt): bool
    {
        $hasChanges = false;
        $activeDays = $assignment->template->active_days ?? [];
        $fieldDefinitions = $assignment->template->fieldDefinitions->keyBy('field_key');

        foreach ($values as $fieldKey => $fieldPayload) {
            $fieldDefinition = $fieldDefinitions->get($fieldKey);

            if (! $fieldDefinition) {
                throw ValidationException::withMessages([
                    "values.$fieldKey" => "Unknown field key $fieldKey for this report template.",
                ]);
            }

            $dailyValues = is_array($fieldPayload) && array_key_exists('dailyValues', $fieldPayload)
                ? $fieldPayload['dailyValues']
                : [];

            if (! is_array($dailyValues)) {
                throw ValidationException::withMessages([
                    "values.$fieldKey.dailyValues" => 'Daily values must be an object.',
                ]);
            }

            foreach ($dailyValues as $dayName => $rawValue) {
                if (! in_array($dayName, self::WEEKDAYS, true) || ! in_array($dayName, $activeDays, true)) {
                    throw ValidationException::withMessages([
                        "values.$fieldKey.dailyValues.$dayName" => "Day $dayName is not valid for this template.",
                    ]);
                }

                $existingValue = ReportFieldValue::query()
                    ->where('report_id', $report->id)
                    ->where('field_definition_id', $fieldDefinition->id)
                    ->where('day_name', $dayName)
                    ->first();
                $oldValueText = $this->valueToText($existingValue);
                $coercedValue = $this->coerceValue($fieldDefinition, $rawValue, $fieldKey);
                $newValueText = $this->valueArrayToText($coercedValue);

                if ($oldValueText !== $newValueText) {
                    $hasChanges = true;

                    if ($hadSubmission) {
                        AuditLog::query()->create([
                            'report_id' => $report->id,
                            'field_definition_id' => $fieldDefinition->id,
                            'field_key' => $fieldDefinition->field_key,
                            'day_name' => $dayName,
                            'old_value' => $oldValueText,
                            'new_value' => $newValueText,
                            'changed_by' => $actor->id,
                            'changed_by_name' => $actor->full_name,
                            'changed_at' => $changedAt,
                            'department_id' => $assignment->department_id,
                            'template_id' => $assignment->template_id,
                        ]);
                    }
                }

                if ($newValueText === null) {
                    $existingValue?->delete();

                    continue;
                }

                ReportFieldValue::query()->updateOrCreate(
                    [
                        'report_id' => $report->id,
                        'field_definition_id' => $fieldDefinition->id,
                        'day_name' => $dayName,
                    ],
                    $coercedValue,
                );
            }
        }

        return $hasChanges;
    }

    /**
     * @return array{value_number: numeric-string|float|int|null, value_text: string|null, value_time: string|null, value_json: mixed}
     *
     * @throws ValidationException
     */
    private function coerceValue(ReportFieldDefinition $fieldDefinition, mixed $rawValue, string $fieldKey): array
    {
        // Normalize strings: trim whitespace and treat an empty string as a
        // cleared cell so "   " does not get stored or fail numeric coercion.
        $value = is_string($rawValue) ? trim($rawValue) : $rawValue;

        if ($value === '') {
            $value = null;
        }

        if ($value === null) {
            return [
                'value_number' => null,
                'value_text' => null,
                'value_time' => null,
                'value_json' => null,
            ];
        }

        return match ($fieldDefinition->field_kind) {
            'integer' => [
                'value_number' => $this->coerceInteger($value, $fieldKey),
                'value_text' => null,
                'value_time' => null,
                'value_json' => null,
            ],
            'decimal' => [
                'value_number' => $this->coerceDecimal($value, $fieldKey),
                'value_text' => null,
                'value_time' => null,
                'value_json' => null,
            ],
            'time' => [
                'value_number' => null,
                'value_text' => null,
                'value_time' => $this->coerceTime($value, $fieldKey),
                'value_json' => null,
            ],
            'choice' => [
                'value_number' => null,
                'value_text' => $this->coerceChoice($fieldDefinition, $value, $fieldKey),
                'value_time' => null,
                'value_json' => null,
            ],
            'text' => [
                'value_number' => null,
                'value_text' => (string) $value,
                'value_time' => null,
                'value_json' => null,
            ],
            default => throw ValidationException::withMessages([
                "values.$fieldKey" => "Unsupported field type $fieldDefinition->field_kind.",
            ]),
        };
    }

    private function coerceInteger(mixed $value, string $fieldKey): int
    {
        if (! is_numeric($value)) {
            throw ValidationException::withMessages([
                "values.$fieldKey" => "Field $fieldKey expects a non-negative whole number.",
            ]);
        }

        $number = (float) $value;

        if ($number < 0 || floor($number) !== $number) {
            throw ValidationException::withMessages([
                "values.$fieldKey" => "Field $fieldKey expects a non-negative whole number.",
            ]);
        }

        if ($number > self::MAX_FIELD_VALUE) {
            throw ValidationException::withMessages([
                "values.$fieldKey" => "Field $fieldKey value is out of range.",
            ]);
        }

        return (int) $number;
    }

    private function coerceDecimal(mixed $value, string $fieldKey): float
    {
        if (! is_numeric($value) || (float) $value < 0) {
            throw ValidationException::withMessages([
                "values.$fieldKey" => "Field $fieldKey expects a non-negative decimal value.",
            ]);
        }

        if ((float) $value > self::MAX_FIELD_VALUE) {
            throw ValidationException::withMessages([
                "values.$fieldKey" => "Field $fieldKey value is out of range.",
            ]);
        }

        return (float) $value;
    }

    private function coerceTime(mixed $value, string $fieldKey): string
    {
        $time = (string) $value;

        if (! preg_match('/^(\d{2}):(\d{2})$/', $time, $matches)) {
            throw ValidationException::withMessages([
                "values.$fieldKey" => "Field $fieldKey expects HH:MM time values.",
            ]);
        }

        if ((int) $matches[1] > 23 || (int) $matches[2] > 59) {
            throw ValidationException::withMessages([
                "values.$fieldKey" => "Field $fieldKey expects HH:MM time values.",
            ]);
        }

        return $time;
    }

    private function coerceChoice(ReportFieldDefinition $fieldDefinition, mixed $value, string $fieldKey): string
    {
        $choice = (string) $value;
        $options = $fieldDefinition->metadata['options'] ?? [];

        if (! in_array($choice, $options, true)) {
            throw ValidationException::withMessages([
                "values.$fieldKey" => "Field $fieldKey expects one of the configured choice options.",
            ]);
        }

        return $choice;
    }

    private function nextStatus(Report $report, bool $hadSubmission, bool $hasChanges, bool $submit): string
    {
        if ($hadSubmission) {
            return match (true) {
                $hasChanges => 'edited_after_submission',
                $report->status === 'edited_after_submission' => 'edited_after_submission',
                default => 'submitted',
            };
        }

        return $submit ? 'submitted' : 'draft';
    }

    private function authorizeAssignmentEdit(User $actor, ReportAssignment $assignment): void
    {
        if (! $actor->active) {
            throw new AuthorizationException('This account is inactive.');
        }

        if (Permissions::isAdminRole($actor->role_key)) {
            return;
        }

        if ($assignment->nurse_id !== $actor->id || ! $assignment->active) {
            throw new AuthorizationException('You are not allowed to edit this assignment.');
        }
    }

    private function recordStatus(Report $report, string $status, User $actor, string $note, Carbon $changedAt): void
    {
        ReportStatusHistory::query()->create([
            'report_id' => $report->id,
            'status' => $status,
            'changed_by' => $actor->id,
            'changed_by_name' => $actor->full_name,
            'note' => $note,
            'changed_at' => $changedAt,
        ]);
    }

    private function notifyAdmins(string $type, string $title, string $message, string $route, string $entity, string $reportId, Carbon $createdAt): void
    {
        $adminIds = User::query()
            ->whereIn('role_key', ['superadmin', 'admin'])
            ->where('active', true)
            ->pluck('id');

        if ($adminIds->isEmpty()) {
            return;
        }

        // Single bulk INSERT instead of one query per admin. This runs inside the
        // submit transaction (which holds a row lock), so minimizing round-trips
        // directly shortens lock-hold time during end-of-week submission spikes.
        $model = new Notification;
        $rows = $adminIds->map(fn (string $adminId): array => [
            'id' => $model->newUniqueId(),
            'recipient_id' => $adminId,
            'type' => $type,
            'title' => $title,
            'message' => $message,
            'related_route' => $route,
            'related_entity' => $entity,
            'related_id' => $reportId,
            'read_at' => null,
            'created_at' => $createdAt,
        ])->all();

        Notification::query()->insert($rows);
    }

    private function relatedRoute(ReportAssignment $assignment, ReportingPeriod $period): string
    {
        return sprintf('/reports/%s/%s', $assignment->id, $period->id);
    }

    private function valueToText(?ReportFieldValue $value): ?string
    {
        if (! $value) {
            return null;
        }

        return $this->valueArrayToText([
            'value_number' => $value->value_number,
            'value_text' => $value->value_text,
            'value_time' => $value->value_time,
            'value_json' => $value->value_json,
        ]);
    }

    /**
     * @param  array{value_number: mixed, value_text: mixed, value_time: mixed, value_json: mixed}  $value
     */
    private function valueArrayToText(array $value): ?string
    {
        if ($value['value_number'] !== null) {
            return $this->numberToText($value['value_number']);
        }

        if ($value['value_time'] !== null) {
            return substr((string) $value['value_time'], 0, 5);
        }

        if ($value['value_text'] !== null) {
            return (string) $value['value_text'];
        }

        if ($value['value_json'] !== null) {
            return json_encode($value['value_json']);
        }

        return null;
    }

    private function numberToText(mixed $number): string
    {
        $value = (float) $number;

        if (floor($value) === $value) {
            return (string) (int) $value;
        }

        return rtrim(rtrim(number_format($value, 4, '.', ''), '0'), '.');
    }
}
