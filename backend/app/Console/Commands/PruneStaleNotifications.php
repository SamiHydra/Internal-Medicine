<?php

namespace App\Console\Commands;

use App\Models\Notification;
use Illuminate\Console\Command;

/**
 * Notifications accrue one row per event and are never otherwise removed, so the
 * table grows without bound. Read notifications older than the retention window
 * carry no value, so this prunes them (unread and clinical audit logs are left
 * untouched). Scheduled weekly from routes/console.php.
 */
class PruneStaleNotifications extends Command
{
    protected $signature = 'reports:prune-notifications';

    protected $description = 'Delete read notifications older than the configured retention window.';

    public function handle(): int
    {
        $days = max(1, (int) config('reports.notifications.read_retention_days', 90));
        $cutoff = now()->subDays($days);

        $deleted = Notification::query()
            ->whereNotNull('read_at')
            ->where('read_at', '<', $cutoff)
            ->delete();

        $this->info("Pruned {$deleted} read notification(s) older than {$days} days.");

        return self::SUCCESS;
    }
}
