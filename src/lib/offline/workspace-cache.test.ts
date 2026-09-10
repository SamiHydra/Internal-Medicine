import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { AppState } from '@/types/domain'
import {
  clearWorkspaceCache,
  readLastWorkspaceCache,
  readWorkspaceCache,
  writeWorkspaceCache,
  type WorkspaceCacheRecord,
} from './workspace-cache'

/**
 * Every timestamp in this file is derived from ONE frozen clock. A snapshot
 * expires 90 days after it was cached, so an absolute fixture date would start
 * failing on its own once the calendar moved past that boundary (QA-001).
 */
const FROZEN_NOW = new Date('2030-01-15T12:00:00.000Z')
const DAY_MS = 24 * 60 * 60 * 1000
const MAX_CACHE_AGE_MS = 90 * DAY_MS

function createState(userId: string) {
  return {
    currentUserId: userId,
    reports: [],
  } as unknown as AppState
}

function createRecord(userId: string, ageMs = 0): WorkspaceCacheRecord {
  return {
    version: 4,
    userId,
    cachedAt: new Date(FROZEN_NOW.getTime() - ageMs).toISOString(),
    state: createState(userId),
    profileDirectoryLoaded: true,
    accessRequestDataLoaded: false,
    historyDataLoaded: true,
  }
}

describe('workspace-cache', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(FROZEN_NOW)
    localStorage.clear()
    sessionStorage.clear()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('persists and reads a durable snapshot for the matching user', () => {
    const cacheRecord = createRecord('user-1')

    writeWorkspaceCache(cacheRecord)

    expect(readWorkspaceCache('user-1')).toEqual(cacheRecord)
    expect(readWorkspaceCache('user-2')).toBeNull()
  })

  it('tracks the most recent workspace for offline cold starts', () => {
    const firstRecord = createRecord('user-1', DAY_MS)
    const secondRecord = createRecord('user-2')

    writeWorkspaceCache(firstRecord)
    writeWorkspaceCache(secondRecord)

    expect(readLastWorkspaceCache()).toEqual(secondRecord)
    expect(readWorkspaceCache('user-1')).toEqual(firstRecord)
  })

  it('rejects snapshots whose state belongs to another user', () => {
    writeWorkspaceCache({
      ...createRecord('user-1'),
      state: createState('user-2'),
    })

    expect(readWorkspaceCache('user-1')).toBeNull()
    expect(readLastWorkspaceCache()).toBeNull()
  })

  it('clears either one cached user or all cached users', () => {
    writeWorkspaceCache(createRecord('user-1'))
    writeWorkspaceCache(createRecord('user-2'))

    clearWorkspaceCache('user-2')

    expect(readLastWorkspaceCache()).toEqual(createRecord('user-1'))
    expect(readWorkspaceCache('user-2')).toBeNull()

    clearWorkspaceCache()

    expect(readWorkspaceCache('user-1')).toBeNull()
    expect(readLastWorkspaceCache()).toBeNull()
  })

  describe('expiry', () => {
    it('accepts a fresh snapshot', () => {
      const record = createRecord('user-1')

      writeWorkspaceCache(record)

      expect(readWorkspaceCache('user-1')).toEqual(record)
    })

    it('accepts a snapshot one millisecond inside the 90-day window', () => {
      const record = createRecord('user-1', MAX_CACHE_AGE_MS - 1)

      writeWorkspaceCache(record)

      expect(readWorkspaceCache('user-1')).toEqual(record)
    })

    it('still accepts a snapshot that is exactly 90 days old (the boundary is inclusive)', () => {
      const record = createRecord('user-1', MAX_CACHE_AGE_MS)

      writeWorkspaceCache(record)

      expect(readWorkspaceCache('user-1')).toEqual(record)
      expect(readLastWorkspaceCache()).toEqual(record)
    })

    it('rejects a snapshot one millisecond past 90 days on read', () => {
      const record = createRecord('user-1', MAX_CACHE_AGE_MS + 1)

      writeWorkspaceCache(record)

      expect(readWorkspaceCache('user-1')).toBeNull()
      expect(readLastWorkspaceCache()).toBeNull()
    })

    it('expires a snapshot that was valid when written once the clock moves past 90 days', () => {
      const record = createRecord('user-1')
      writeWorkspaceCache(record)
      expect(readWorkspaceCache('user-1')).toEqual(record)

      vi.setSystemTime(new Date(FROZEN_NOW.getTime() + MAX_CACHE_AGE_MS + 1))

      expect(readWorkspaceCache('user-1')).toBeNull()
      expect(readLastWorkspaceCache()).toBeNull()
    })

    it('drops expired siblings when a newer snapshot is written', () => {
      writeWorkspaceCache(createRecord('user-1', MAX_CACHE_AGE_MS + DAY_MS))
      const fresh = createRecord('user-2')

      writeWorkspaceCache(fresh)

      expect(readWorkspaceCache('user-1')).toBeNull()
      expect(readWorkspaceCache('user-2')).toEqual(fresh)
      expect(readLastWorkspaceCache()).toEqual(fresh)
    })

    it('treats an unparseable timestamp as expired', () => {
      writeWorkspaceCache({ ...createRecord('user-1'), cachedAt: 'not-a-date' })

      expect(readWorkspaceCache('user-1')).toBeNull()
    })
  })
})
