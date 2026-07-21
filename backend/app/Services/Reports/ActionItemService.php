<?php

namespace App\Services\Reports;

use App\Models\ActionItem;
use App\Models\Report;
use Illuminate\Support\Carbon;

/**
 * Turns a fired critical-event alert into a trackable follow-up task so a bad
 * outcome (death, HAI, pressure ulcer, ...) is not just recorded but driven to
 * resolution - something a spreadsheet cannot do.
 */
class ActionItemService
{
    /**
     * Open (or refresh) the action item for a report's critical event. Idempotent
     * per report via the (source, source_key) unique key, and never reopens an
     * already-resolved item.
     *
     * @param  list<array{fieldKey: string, label: string, total: float}>  $triggered
     */
    public function recordCriticalEvent(Report $report, array $triggered, Carbon $now): ?ActionItem
    {
        if ($triggered === []) {
            return null;
        }

        $report->loadMissing('department');
        $departmentName = $report->department?->name ?? 'A department';
        $summary = collect($triggered)
            ->map(fn (array $item): string => sprintf('%s (%s)', $item['label'], $this->formatTotal($item['total'])))
            ->implode(', ');

        $item = ActionItem::query()->firstOrNew([
            'source' => 'critical_event',
            'source_key' => $report->id,
        ]);

        // A clinician already closed this out - leave it resolved.
        if ($item->exists && $item->status === 'resolved') {
            return $item;
        }

        $item->fill([
            'report_id' => $report->id,
            'department_id' => $report->department_id,
            'title' => sprintf('Critical values in %s', $departmentName),
            'description' => sprintf('%s reported: %s. Investigate and document the follow-up.', $departmentName, $summary),
            'severity' => 'high',
        ]);

        if (! $item->exists) {
            $item->status = 'open';
            $item->created_at = $now;
        }

        $item->save();

        return $item;
    }

    private function formatTotal(float $total): string
    {
        return floor($total) === $total ? (string) (int) $total : (string) $total;
    }
}
