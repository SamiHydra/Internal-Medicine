<?php

namespace App\Console\Commands;

use App\Models\ActionItem;
use App\Models\Notification;
use App\Models\User;
use App\Services\Reports\ActionItemDashboardService;
use App\Services\Reports\ActionItemService;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

class EscalateOverdueActionItems extends Command
{
    protected $signature = 'action-items:escalate-overdue';

    protected $description = 'Notify owners and clinical administrators about newly overdue action items.';

    public function handle(ActionItemService $service, ActionItemDashboardService $dashboard): int
    {
        $sent = 0;
        ActionItem::query()
            ->whereIn('status', ActionItem::OUTSTANDING_STATUSES)
            ->whereNotNull('due_at')
            ->where('due_at', '<', now())
            ->whereNull('overdue_notified_at')
            ->with('alertRule')
            ->orderBy('due_at')
            ->chunkById(100, function ($items) use ($service, &$sent): void {
                foreach ($items as $candidate) {
                    $sent += DB::transaction(function () use ($candidate, $service): int {
                        $item = ActionItem::query()->lockForUpdate()->findOrFail($candidate->id);
                        if ($item->overdue_notified_at !== null || ! $item->isOverdue()) {
                            return 0;
                        }

                        $roles = $item->alertRule?->notification_roles ?? ['admin', 'superadmin'];
                        $recipientIds = User::query()
                            ->where('active', true)
                            ->whereIn('role_key', $roles)
                            ->pluck('id');
                        if ($item->assigned_to) {
                            $recipientIds->push($item->assigned_to);
                        }
                        $recipientIds = $recipientIds->unique()->values();

                        foreach ($recipientIds as $recipientId) {
                            Notification::query()->create([
                                'recipient_id' => $recipientId,
                                'type' => 'action_item_overdue',
                                'title' => 'Clinical action item overdue',
                                'message' => $item->title,
                                'related_route' => $item->notificationRoute(),
                                'related_entity' => 'action_item',
                                'related_id' => $item->id,
                                'created_at' => now(),
                            ]);
                        }

                        $item->forceFill(['overdue_notified_at' => now()])->save();
                        $service->history($item, 'overdue', $item->status, $item->status, 'The follow-up deadline passed and escalation notifications were sent.', null);

                        return $recipientIds->count();
                    });
                }
            });

        $dashboard->forget();
        $this->info("Queued {$sent} overdue action-item notification(s).");

        return self::SUCCESS;
    }
}
