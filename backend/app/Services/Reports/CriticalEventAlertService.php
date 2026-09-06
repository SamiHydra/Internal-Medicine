<?php

namespace App\Services\Reports;

use App\Models\ClinicalAlertRule;
use App\Models\Notification;
use App\Models\Report;
use App\Models\User;
use App\Services\Admin\AppSettingsService;
use Illuminate\Support\Carbon;
use Illuminate\Support\Collection;

/** Evaluates governed clinical rules and opens durable follow-up work. */
class CriticalEventAlertService
{
    public function __construct(
        private readonly AppSettingsService $settings,
        private readonly ActionItemService $actionItems,
    ) {}

    /** @return list<array{fieldKey: string, label: string, total: float}> */
    public function detect(Report $report): array
    {
        return collect($this->evaluate($report))->where('triggered', true)->map(fn (array $item): array => [
            'fieldKey' => $item['fieldKey'],
            'label' => $item['label'],
            'total' => $item['total'],
        ])->values()->all();
    }

    /**
     * @return list<array{rule: ClinicalAlertRule|null, fieldKey: string, label: string, total: float, threshold: float, triggered: bool, severity: string, deadlineHours: int, responsibleRole: string|null, notificationRoles: list<string>}>
     */
    public function evaluate(Report $report): array
    {
        $report->loadMissing(['template.fieldDefinitions', 'fieldValues']);
        $definitions = $report->template->fieldDefinitions->keyBy('field_key');
        $hasConfiguredRules = ClinicalAlertRule::query()->where('template_id', $report->template_id)->exists();
        $rules = ClinicalAlertRule::query()
            ->where('active', true)
            ->where('template_id', $report->template_id)
            ->where(fn ($query) => $query->whereNull('effective_from')->orWhere('effective_from', '<=', now()))
            ->where(fn ($query) => $query->whereNull('effective_until')->orWhere('effective_until', '>=', now()))
            ->orderBy('field_key')
            ->get();

        if ($rules->isEmpty() && ! $hasConfiguredRules) {
            $rules = $this->legacyRules($report, $definitions);
        }

        return $rules->map(function (ClinicalAlertRule $rule) use ($report, $definitions): ?array {
            $definition = $definitions->get($rule->field_key);
            if (! $definition || ! $definition->active) {
                return null;
            }

            $total = (float) $report->fieldValues
                ->where('field_definition_id', $definition->id)
                ->sum(fn ($value) => (float) ($value->value_number ?? 0));

            return [
                'rule' => $rule->exists ? $rule : null,
                'fieldKey' => $rule->field_key,
                'label' => $definition->label,
                'total' => $total,
                'threshold' => (float) $rule->threshold,
                'triggered' => $rule->matches($total),
                'severity' => $rule->severity,
                'deadlineHours' => $rule->deadline_hours,
                'responsibleRole' => $rule->responsible_role,
                'notificationRoles' => array_values($rule->notification_roles ?? ['superadmin', 'admin']),
            ];
        })->filter()->values()->all();
    }

    /** Returns the number of newly raised or materially changed alerts. */
    public function notify(Report $report, Carbon $now): int
    {
        $events = $this->actionItems->recordEvaluations($report, $this->evaluate($report), $now);

        foreach ($events as $event) {
            $evaluation = $event['evaluation'];
            $item = $event['item'];
            $roles = $evaluation['notificationRoles'] ?: ['superadmin', 'admin'];
            $message = match ($event['type']) {
                'corrected' => sprintf('%s was corrected below its alert threshold and requires verification.', $item->title),
                'recurred' => sprintf('%s meets its alert rule again and requires attention.', $item->title),
                default => sprintf('%s (%s) met its alert threshold of %s.', $item->title, $this->formatTotal($evaluation['total']), $this->formatTotal($evaluation['threshold'])),
            };

            User::query()->whereIn('role_key', $roles)->where('active', true)->each(fn (User $recipient) => Notification::query()->create([
                'recipient_id' => $recipient->id,
                'type' => $event['type'] === 'corrected' ? 'critical_value_corrected' : 'critical_value_alert',
                'title' => $event['type'] === 'corrected' ? 'Critical value corrected' : 'Clinical alert requires follow-up',
                'message' => $message,
                // Point at the durable action item, not the source report: the
                // report view carries no acknowledge/assign/resolve control, while
                // the action sheet already links back to the report it came from.
                'related_route' => $item->notificationRoute(),
                'related_entity' => 'action_item',
                'related_id' => $item->id,
                'created_at' => $now,
            ]));
        }

        return count($events);
    }

    /** @param Collection<string, mixed> $definitions */
    private function legacyRules(Report $report, Collection $definitions): Collection
    {
        return collect($this->settings->structured()['criticalNonZeroFields'] ?? [])
            ->filter(fn (string $key): bool => $definitions->has($key))
            ->map(function (string $key) use ($report, $definitions): ClinicalAlertRule {
                $definition = $definitions->get($key);
                $rule = new ClinicalAlertRule([
                    'template_id' => $report->template_id,
                    'field_definition_id' => $definition->id,
                    'field_key' => $key,
                    'name' => $definition->label,
                    'operator' => 'gt',
                    'threshold' => 0,
                    'severity' => 'high',
                    'deadline_hours' => 24,
                    'responsible_role' => 'admin',
                    'notification_roles' => ['superadmin', 'admin'],
                    'active' => true,
                ]);
                $rule->exists = false;

                return $rule;
            });
    }

    private function formatTotal(float $total): string
    {
        return floor($total) === $total ? (string) (int) $total : (string) $total;
    }
}
