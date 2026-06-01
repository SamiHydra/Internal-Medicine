<?php

namespace App\Services\Reports;

use App\Models\Notification;
use App\Models\ReportAssignment;
use App\Models\ReportingPeriod;
use App\Models\User;
use App\Services\Admin\AppSettingsService;
use Carbon\CarbonImmutable;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

class OverdueReportService
{
    private const LIVE_REPORTING_START = '2026-03-02';

    public function __construct(
        private readonly AppSettingsService $settingsService,
    ) {}

    /**
     * @return array{deadlineEnforced: bool, overdueItems: int, notificationsCreated: int, notificationsUpdated: int, notificationsDeleted: int}
     */
    public function sync(): array
    {
        return DB::transaction(function (): array {
            if (! $this->deadlineEnforced()) {
                $deleted = Notification::query()->where('type', 'overdue_report')->delete();

                return [
                    'deadlineEnforced' => false,
                    'overdueItems' => 0,
                    'notificationsCreated' => 0,
                    'notificationsUpdated' => 0,
                    'notificationsDeleted' => $deleted,
                ];
            }

            $currentPeriod = $this->currentPeriod();

            if (! $currentPeriod) {
                $deleted = Notification::query()->where('type', 'overdue_report')->delete();

                return [
                    'deadlineEnforced' => true,
                    'overdueItems' => 0,
                    'notificationsCreated' => 0,
                    'notificationsUpdated' => 0,
                    'notificationsDeleted' => $deleted,
                ];
            }

            $adminRecipients = User::query()
                ->whereIn('role_key', ['superadmin', 'admin'])
                ->where('active', true)
                ->get();
            $activePairs = [];
            $created = 0;
            $updated = 0;
            $items = $this->overdueItems($currentPeriod);

            foreach ($items as $item) {
                $eventKey = sprintf('overdue:%s:%s', $item->assignment_id, $item->reporting_period_id);
                $route = sprintf('/reports/%s/%s', $item->assignment_id, $item->reporting_period_id);

                [$wasCreated, $wasUpdated] = $this->upsertNotification(
                    recipientId: $item->nurse_id,
                    title: 'Overdue report',
                    message: sprintf('%s is overdue and still needs submission.', $item->department_name),
                    route: $route,
                    eventKey: $eventKey,
                    reportId: $item->report_id,
                );
                $created += $wasCreated ? 1 : 0;
                $updated += $wasUpdated ? 1 : 0;
                $activePairs[] = $this->pairKey($item->nurse_id, $eventKey);

                foreach ($adminRecipients as $admin) {
                    [$wasCreated, $wasUpdated] = $this->upsertNotification(
                        recipientId: $admin->id,
                        title: 'Overdue report',
                        message: sprintf('%s missed the reporting deadline.', $item->department_name),
                        route: $route,
                        eventKey: $eventKey,
                        reportId: $item->report_id,
                    );
                    $created += $wasCreated ? 1 : 0;
                    $updated += $wasUpdated ? 1 : 0;
                    $activePairs[] = $this->pairKey($admin->id, $eventKey);
                }
            }

            $deleted = $this->deleteStaleNotifications($activePairs);

            return [
                'deadlineEnforced' => true,
                'overdueItems' => $items->count(),
                'notificationsCreated' => $created,
                'notificationsUpdated' => $updated,
                'notificationsDeleted' => $deleted,
            ];
        });
    }

    private function deadlineEnforced(): bool
    {
        return (bool) $this->settingsService->structured()['deadlineEnforced'];
    }

    private function currentPeriod(): ?ReportingPeriod
    {
        return ReportingPeriod::query()
            ->whereDate('week_start', '<=', CarbonImmutable::today('UTC')->toDateString())
            ->orderByDesc('week_start')
            ->first();
    }

    /**
     * @return Collection<int, object>
     */
    private function overdueItems(ReportingPeriod $currentPeriod): Collection
    {
        return ReportAssignment::query()
            ->join('departments', 'departments.id', '=', 'report_assignments.department_id')
            ->join('reporting_periods', function ($join) use ($currentPeriod): void {
                $join->whereDate('reporting_periods.week_start', '>=', self::LIVE_REPORTING_START)
                    ->whereDate('reporting_periods.week_start', '<=', $currentPeriod->week_start->toDateString())
                    ->where('reporting_periods.deadline_at', '<', now());
            })
            ->leftJoin('reports', function ($join): void {
                $join->on('reports.assignment_id', '=', 'report_assignments.id')
                    ->on('reports.reporting_period_id', '=', 'reporting_periods.id');
            })
            ->where('report_assignments.active', true)
            ->where(function ($query): void {
                $query->whereNull('reports.id')
                    ->orWhere(function ($draftQuery): void {
                        $draftQuery->where('reports.status', 'draft')
                            ->whereNull('reports.locked_at');
                    });
            })
            ->select([
                'report_assignments.id as assignment_id',
                'report_assignments.nurse_id',
                'departments.name as department_name',
                'reporting_periods.id as reporting_period_id',
                'reports.id as report_id',
            ])
            ->orderBy('reporting_periods.week_start')
            ->orderBy('departments.name')
            ->get();
    }

    /**
     * @return array{bool, bool}
     */
    private function upsertNotification(
        string $recipientId,
        string $title,
        string $message,
        string $route,
        string $eventKey,
        ?string $reportId,
    ): array {
        $notification = Notification::query()->firstOrNew([
            'recipient_id' => $recipientId,
            'type' => 'overdue_report',
            'related_entity' => $eventKey,
        ]);
        $wasCreated = ! $notification->exists;

        $notification->fill([
            'title' => $title,
            'message' => $message,
            'related_route' => $route,
            'related_id' => $reportId,
        ]);

        if ($wasCreated) {
            $notification->created_at = now();
        }

        $wasUpdated = ! $wasCreated && $notification->isDirty();
        $notification->save();

        return [$wasCreated, $wasUpdated];
    }

    /**
     * @param  list<string>  $activePairs
     */
    private function deleteStaleNotifications(array $activePairs): int
    {
        $activePairs = array_flip(array_unique($activePairs));
        $deleted = 0;

        Notification::query()
            ->where('type', 'overdue_report')
            ->get()
            ->each(function (Notification $notification) use ($activePairs, &$deleted): void {
                if (isset($activePairs[$this->pairKey($notification->recipient_id, (string) $notification->related_entity)])) {
                    return;
                }

                $notification->delete();
                $deleted++;
            });

        return $deleted;
    }

    private function pairKey(string $recipientId, string $eventKey): string
    {
        return $recipientId.'|'.$eventKey;
    }
}
