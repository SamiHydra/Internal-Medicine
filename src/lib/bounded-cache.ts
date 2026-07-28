/**
 * Insert a value into an insertion-ordered Map and evict the least-recently
 * used entry. Module caches otherwise grow for the lifetime of an admin tab as
 * users explore filter combinations.
 */
export function writeBoundedCache<K, V>(
  cache: Map<K, V>,
  key: K,
  value: V,
  maxEntries: number,
) {
  cache.delete(key)
  cache.set(key, value)

  while (cache.size > maxEntries) {
    const oldestKey = cache.keys().next().value as K | undefined
    if (oldestKey === undefined) {
      return
    }
    cache.delete(oldestKey)
  }
}

export function readBoundedCache<K, V>(cache: Map<K, V>, key: K) {
  const value = cache.get(key)
  if (value === undefined) {
    return undefined
  }

  cache.delete(key)
  cache.set(key, value)
  return value
}
