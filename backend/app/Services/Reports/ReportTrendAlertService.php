<?php

namespace App\Services\Reports;

use App\Models\Notification;
use App\Models\Report;
use App\Models\User;
use Illuminate\Support\Carbon;

class ReportTrendAlertService
{
    /**
     * @param  list<array<string, mixed>>  $warnings
     */
    public function notify(Report $report, array $warnings, string $route, Carbon $now): int
    {
        $outliers = collect($warnings)
            ->filter(fn (array $warning): bool => str_starts_with((string) ($warning['key'] ?? ''), 'outlier:'))
            ->values();

        if ($outliers->isEmpty()) {
            return 0;
        }

        $report->loadMissing('department');
        $departmentName = $report->department?->name ?? 'A department';
        $summary = $outliers
            ->take(3)
            ->map(fn (array $warning): string => (string) ($warning['message'] ?? 'A metric moved outside its recent baseline.'))
            ->implode(' ');
        $extraCount = max($outliers->count() - 3, 0);
        $message = trim(sprintf(
            '%s triggered %d trend alert%s. %s%s',
            $departmentName,
            $outliers->count(),
            $outliers->count() === 1 ? '' : 's',
            $summary,
            $extraCount > 0 ? sprintf(' Plus %d more.', $extraCount) : '',
        ));

        User::query()
            ->whereIn('role_key', ['superadmin', 'admin'])
            ->where('active', true)
            ->each(fn (User $admin) => Notification::query()->updateOrCreate(
                [
                    'recipient_id' => $admin->id,
                    'type' => 'trend_alert',
                    'related_entity' => 'trend_alert',
                    'related_id' => $report->id,
                ],
                [
                    'title' => 'Trend alert',
                    'message' => $message,
                    'related_route' => $route,
                    'read_at' => null,
                    'created_at' => $now,
                ],
            ));

        return $outliers->count();
    }
}
