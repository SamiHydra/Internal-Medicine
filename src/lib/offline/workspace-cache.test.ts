import { beforeEach, describe, expect, it } from 'vitest'

import type { AppState } from '@/types/domain'
import {
  clearWorkspaceCache,
  readLastWorkspaceCache,
  readWorkspaceCache,
  writeWorkspaceCache,
  type WorkspaceCacheRecord,
} from './workspace-cache'

function createState(userId: string) {
  return {
    currentUserId: userId,
    reports: [],
  } as unknown as AppState
}

function createRecord(userId: string): WorkspaceCacheRecord {
  return {
    version: 4,
    userId,
    cachedAt: '2026-06-08T00:00:00.000Z',
    state: createState(userId),
    profileDirectoryLoaded: true,
    accessRequestDataLoaded: false,
    historyDataLoaded: true,
  }
}

describe('workspace-cache', () => {
  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
  })

  it('persists and reads a durable snapshot for the matching user', () => {
    const cacheRecord = createRecord('user-1')

    writeWorkspaceCache(cacheRecord)

    expect(readWorkspaceCache('user-1')).toEqual(cacheRecord)
    expect(readWorkspaceCache('user-2')).toBeNull()
  })

  it('tracks the most recent workspace for offline cold starts', () => {
    const firstRecord = createRecord('user-1')
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
})
