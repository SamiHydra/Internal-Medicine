<?php

namespace App\Services\Academic\Concerns;

use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Facades\Cache;

/**
 * The content-stamp cache both academic analytics services share (guide 7.3):
 * the cache key carries a stamp of the source window (row count + newest
 * updated_at), so a write is visible on the very next read while unchanged
 * data never re-folds. The TTL is only a backstop against unreachable stale
 * keys; there is no manual invalidation anywhere.
 */
trait CachesByContentStamp
{
    /** Stamp of a source window: row count + newest updated_at. */
    private function contentStamp(Builder $query): string
    {
        $row = (clone $query)->selectRaw('count(*) as row_count, max(updated_at) as latest')->first();

        return ($row->row_count ?? 0).'|'.($row->latest ?? '');
    }

    /**
     * @param  callable(): array<string, mixed>  $build
     * @return array<string, mixed>
     */
    private function rememberByStamp(string $prefix, string $operation, string $stamp, callable $build): array
    {
        return Cache::remember(
            sprintf('%s:%s:%s', $prefix, $operation, md5($stamp)),
            300,
            $build,
        );
    }
}
