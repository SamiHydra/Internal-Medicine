<?php

namespace App\Console\Commands;

use App\Models\AnalyticsExport;
use Illuminate\Console\Command;
use Illuminate\Database\Query\Builder;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\Storage;

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
        $total += $this->pruneByRetention(
            'performance_metrics',
            'created_at',
            (int) config('operations.performance_metric_retention_days', 90),
            'real-user performance metrics',
            $dryRun,
        );
        $total += $this->pruneExpiredExports($dryRun);

        $verb = $dryRun ? 'eligible' : 'pruned';
        $this->info("{$total} row(s) {$verb} in total.");

        return self::SUCCESS;
    }

    /**
     * Generated analytics exports: the file first, then the row. The download
     * already 410s past expires_at, so nothing a user can still fetch is
     * removed. Files are deleted individually (never a directory sweep) so a
     * stray path in the column can never widen this into a storage wipe.
     */
    private function pruneExpiredExports(bool $dryRun): int
    {
        $days = (int) config('reports.retention.export_days', 0);

        if ($days <= 0) {
            $this->line('Skipped generated analytics exports; retention is disabled.');

            return 0;
        }

        if (! Schema::hasTable('analytics_exports')) {
            return 0;
        }

        $cutoff = now()->subDays($days);
        $exports = AnalyticsExport::query()
            ->where('created_at', '<', $cutoff)
            ->get(['id', 'file_path']);

        if ($exports->isEmpty()) {
            $this->line("0 generated analytics exports older than {$days} days pruned.");

            return 0;
        }

        if ($dryRun) {
            $this->line("{$exports->count()} generated analytics exports older than {$days} days eligible.");

            return $exports->count();
        }

        $disk = Storage::disk('local');
        $filesRemoved = 0;

        foreach ($exports as $export) {
            $path = (string) $export->file_path;

            if ($path !== '' && str_starts_with($path, 'analytics-exports/') && $disk->exists($path)) {
                $disk->delete($path);
                $filesRemoved++;
            }
        }

        $removed = AnalyticsExport::query()->whereKey($exports->pluck('id'))->delete();
        $this->line("{$removed} generated analytics exports older than {$days} days pruned ({$filesRemoved} file(s) removed).");

        return $removed;
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
