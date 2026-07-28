<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Database\Query\Builder;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

class PruneOperationalData extends Command
{
    protected $signature = 'app:prune-operational-data {--dry-run : Count eligible rows without deleting them}';

    protected $description = 'Prune expired operational rows and explicitly configured audit/history retention.';

    public function handle(): int
    {
        $dryRun = (bool) $this->option('dry-run');
        $total = 0;

        $total += $this->prune(
            'sessions',
            fn (Builder $query): Builder => $query->where(
                'last_activity',
                '<',
                now()->subMinutes(max(1, (int) config('session.lifetime', 120)))->timestamp,
            ),
            'expired sessions',
            $dryRun,
        );
        $total += $this->prune(
            'cache',
            fn (Builder $query): Builder => $query->where('expiration', '<', now()->timestamp),
            'expired cache entries',
            $dryRun,
        );
        $total += $this->prune(
            'cache_locks',
            fn (Builder $query): Builder => $query->where('expiration', '<', now()->timestamp),
            'expired cache locks',
            $dryRun,
        );

        $total += $this->pruneByRetention(
            'audit_logs',
            'changed_at',
            (int) config('reports.retention.audit_log_days', 0),
            'report audit rows',
            $dryRun,
        );
        $total += $this->pruneByRetention(
            'admin_audit_logs',
            'created_at',
            (int) config('reports.retention.admin_audit_log_days', 0),
            'admin audit rows',
            $dryRun,
        );
        $total += $this->pruneByRetention(
            'report_status_history',
            'changed_at',
            (int) config('reports.retention.status_history_days', 0),
            'report status-history rows',
            $dryRun,
        );

        $verb = $dryRun ? 'eligible' : 'pruned';
        $this->info("{$total} row(s) {$verb} in total.");

        return self::SUCCESS;
    }

    private function pruneByRetention(
        string $table,
        string $column,
        int $days,
        string $label,
        bool $dryRun,
    ): int {
        if ($days <= 0) {
            $this->line("Skipped {$label}; retention is disabled.");

            return 0;
        }

        return $this->prune(
            $table,
            fn (Builder $query): Builder => $query->where($column, '<', now()->subDays($days)),
            "{$label} older than {$days} days",
            $dryRun,
        );
    }

    /**
     * @param  callable(Builder): Builder  $scope
     */
    private function prune(
        string $table,
        callable $scope,
        string $label,
        bool $dryRun,
    ): int {
        if (! Schema::hasTable($table)) {
            return 0;
        }

        $query = $scope(DB::table($table));
        $count = $dryRun ? $query->count() : $query->delete();
        $verb = $dryRun ? 'eligible' : 'pruned';
        $this->line("{$count} {$label} {$verb}.");

        return $count;
    }
}
