<?php

namespace App\Services\Reports;

use App\Models\ActionItem;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;

class ActionItemDashboardService
{
    public const CACHE_KEY = 'clinical-action-items:summary:v1';

    /** @return array<string, mixed> */
    public function summary(): array
    {
        return Cache::remember(self::CACHE_KEY, 30, function (): array {
            $now = now();
            $counts = ActionItem::query()->selectRaw(
                "SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) AS open_count, ".
                "SUM(CASE WHEN status = 'assigned' THEN 1 ELSE 0 END) AS assigned_count, ".
                "SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END) AS in_progress_count, ".
                "SUM(CASE WHEN status IN ('open','assigned','in_progress') THEN 1 ELSE 0 END) AS outstanding_count, ".
                "SUM(CASE WHEN status IN ('open','assigned','in_progress') AND severity = 'high' THEN 1 ELSE 0 END) AS high_count, ".
                "SUM(CASE WHEN status IN ('open','assigned','in_progress') AND due_at IS NOT NULL AND due_at < ? THEN 1 ELSE 0 END) AS overdue_count, ".
                "MIN(CASE WHEN status IN ('open','assigned','in_progress') THEN created_at ELSE NULL END) AS oldest_opened_at",
                [$now],
            )->first();

            $averageResolutionHours = ActionItem::query()
                ->whereNotNull('resolved_at')
                ->whereNotNull('created_at')
                ->selectRaw($this->averageHoursSql().' AS average_hours')
                ->value('average_hours');

            $byDepartment = ActionItem::query()
                ->leftJoin('departments', 'departments.id', '=', 'action_items.department_id')
                ->whereIn('action_items.status', ActionItem::OUTSTANDING_STATUSES)
                ->groupBy('action_items.department_id', 'departments.name', 'departments.slug')
                ->orderByDesc(DB::raw('COUNT(*)'))
                ->limit(8)
                ->get([
                    'action_items.department_id',
                    'departments.slug AS department_slug',
                    DB::raw("COALESCE(departments.name, 'Unassigned department') AS department_name"),
                    DB::raw('COUNT(*) AS total'),
                ])
                ->map(fn ($row): array => [
                    'departmentId' => $row->department_id,
                    'departmentSlug' => $row->department_slug,
                    'departmentName' => $row->department_name,
                    'total' => (int) $row->total,
                ])->values();

            return [
                'open' => (int) ($counts?->open_count ?? 0),
                'assigned' => (int) ($counts?->assigned_count ?? 0),
                'inProgress' => (int) ($counts?->in_progress_count ?? 0),
                'outstanding' => (int) ($counts?->outstanding_count ?? 0),
                'highSeverity' => (int) ($counts?->high_count ?? 0),
                'overdue' => (int) ($counts?->overdue_count ?? 0),
                'oldestOpenedAt' => $counts?->oldest_opened_at,
                'averageResolutionHours' => $averageResolutionHours === null ? null : round((float) $averageResolutionHours, 1),
                'byDepartment' => $byDepartment,
            ];
        });
    }

    public function forget(): void
    {
        Cache::forget(self::CACHE_KEY);
    }

    private function averageHoursSql(): string
    {
        return DB::connection()->getDriverName() === 'sqlite'
            ? 'AVG((julianday(resolved_at) - julianday(created_at)) * 24)'
            : 'AVG(TIMESTAMPDIFF(SECOND, created_at, resolved_at) / 3600)';
    }
}
