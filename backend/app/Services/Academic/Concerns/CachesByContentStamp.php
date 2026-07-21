<?php

namespace App\Services\Academic\Concerns;

use Illuminate\Contracts\Support\Arrayable;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Facades\Cache;
use JsonSerializable;

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
        $payload = Cache::remember(
            sprintf('%s:v2:%s:%s', $prefix, $operation, md5($stamp)),
            300,
            fn (): array => $this->plainCachePayload($build()),
        );

        // Keep the service contract plain even when a custom cache store
        // returns an Arrayable or JsonSerializable implementation.
        return $this->plainCachePayload($payload);
    }

    /**
     * Cache payloads must not contain framework objects. Production stores
     * serialize values while serializable_classes is disabled; persisting a
     * Collection would therefore come back as __PHP_Incomplete_Class.
     *
     * @return array<string|int, mixed>|bool|float|int|string|null
     */
    private function plainCacheValue(mixed $value): array|bool|float|int|string|null
    {
        if ($value instanceof Arrayable) {
            return $this->plainCacheValue($value->toArray());
        }

        if ($value instanceof JsonSerializable) {
            return $this->plainCacheValue($value->jsonSerialize());
        }

        if (is_array($value)) {
            $plain = [];
            foreach ($value as $key => $item) {
                $plain[$key] = $this->plainCacheValue($item);
            }

            return $plain;
        }

        if (is_bool($value) || is_float($value) || is_int($value) || is_string($value) || $value === null) {
            return $value;
        }

        throw new \UnexpectedValueException(sprintf(
            'Academic analytics cache payload contains unsupported value of type %s.',
            get_debug_type($value),
        ));
    }

    /**
     * @param  array<string, mixed>  $payload
     * @return array<string, mixed>
     */
    private function plainCachePayload(array $payload): array
    {
        /** @var array<string, mixed> $plain */
        $plain = $this->plainCacheValue($payload);

        return $plain;
    }
}
