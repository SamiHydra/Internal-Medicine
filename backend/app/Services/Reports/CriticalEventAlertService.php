<?php

namespace App\Services\Reports;

use App\Models\Notification;
use App\Models\Report;
use App\Models\User;
use App\Services\Admin\AppSettingsService;
use Illuminate\Support\Carbon;

/**
 * Flags clinically critical values (deaths, HAIs, pressure ulcers, ...) the moment
 * a report is submitted or edited, and pushes a notification to admin-like users -
 * something a passive spreadsheet can never do.
 *
 * The set of "critical" fields is configurable via app settings
 * (`critical_non_zero_fields`).
 */
class CriticalEventAlertService
{
    public function __construct(
        private readonly AppSettingsService $settings,
        private readonly ActionItemService $actionItems,
    ) {}

    /**
     * Critical fields whose weekly total is non-zero for this report.
     *
     * @return list<array{fieldKey: string, label: string, total: float}>
     */
    public function detect(Report $report): array
    {
        $criticalKeys = $this->settings->structured()['criticalNonZeroFields'] ?? [];

        if ($criticalKeys === []) {
            return [];
        }

        $report->loadMissing(['template.fieldDefinitions', 'fieldValues']);
        $definitionsByKey = $report->template->fieldDefinitions->keyBy('field_key');

        $triggered = [];
        foreach ($criticalKeys as $fieldKey) {
            $definition = $definitionsByKey->get($fieldKey);
            if (! $definition) {
                continue;
            }

            $total = $report->fieldValues
                ->where('field_definition_id', $definition->id)
                ->sum(fn ($value) => (float) ($value->value_number ?? 0));

            if ($total > 0) {
                $triggered[] = [
                    'fieldKey' => $fieldKey,
                    'label' => $definition->label,
                    'total' => (float) $total,
                ];
            }
        }

        return $triggered;
    }

    /**
     * Notify active admin-like users when a report contains non-zero critical values.
     * Returns the number of triggered critical fields (0 = nothing sent).
     */
    public function notify(Report $report, string $route, Carbon $now): int
    {
        $triggered = $this->detect($report);

        if ($triggered === []) {
            return 0;
        }

        $report->loadMissing('department');
        $departmentName = $report->department?->name ?? 'A department';
        $summary = collect($triggered)
            ->map(fn (array $item) => sprintf('%s (%s)', $item['label'], $this->formatTotal($item['total'])))
            ->implode(', ');

        $message = sprintf('%s reported: %s.', $departmentName, $summary);

        // Open a trackable follow-up task in addition to the passive notification.
        $this->actionItems->recordCriticalEvent($report, $triggered, $now);

        User::query()
            ->whereIn('role_key', ['superadmin', 'admin'])
            ->where('active', true)
            ->each(fn (User $admin) => Notification::query()->create([
                'recipient_id' => $admin->id,
                'type' => 'critical_value_alert',
                'title' => 'Critical values reported',
                'message' => $message,
                'related_route' => $route,
                'related_entity' => 'critical_alert',
                'related_id' => $report->id,
                'created_at' => $now,
            ]));

        return count($triggered);
    }

    private function formatTotal(float $total): string
    {
        return floor($total) === $total ? (string) (int) $total : (string) $total;
    }
}
