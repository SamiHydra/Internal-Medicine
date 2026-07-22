import type { AppState } from '@/types/domain'

const workspaceCacheStorageKey = 'stpaul:workspace-state:v4'
const legacySessionStorageKey = 'stpaul:workspace-state:v3'

export type WorkspaceCacheRecord = {
  version: 4
  userId: string
  cachedAt: string
  state: AppState
  profileDirectoryLoaded: boolean
  accessRequestDataLoaded: boolean
  historyDataLoaded: boolean
}

type WorkspaceCacheEnvelope = {
  version: 4
  lastUserId: string | null
  recordsByUserId: Record<string, WorkspaceCacheRecord>
}

export function readWorkspaceCache(userId: string) {
  const envelope = readWorkspaceCacheEnvelope()
  const cacheRecord = envelope?.recordsByUserId[userId]

  return isValidWorkspaceCacheRecord(cacheRecord, userId) ? cacheRecord : null
}

export function readLastWorkspaceCache() {
  const envelope = readWorkspaceCacheEnvelope()
  if (!envelope?.lastUserId) {
    return null
  }

  const cacheRecord = envelope.recordsByUserId[envelope.lastUserId]
  return isValidWorkspaceCacheRecord(cacheRecord, envelope.lastUserId)
    ? cacheRecord
    : null
}

export function writeWorkspaceCache(cacheRecord: WorkspaceCacheRecord) {
  if (!isValidWorkspaceCacheRecord(cacheRecord, cacheRecord.userId)) {
    return
  }

  const storage = getLocalStorage()
  if (!storage) {
    return
  }

  try {
    const envelope = readWorkspaceCacheEnvelope() ?? createEmptyWorkspaceCacheEnvelope()
    const nextEnvelope: WorkspaceCacheEnvelope = {
      version: 4,
      lastUserId: cacheRecord.userId,
      recordsByUserId: {
        ...envelope.recordsByUserId,
        [cacheRecord.userId]: cacheRecord,
      },
    }

    storage.setItem(workspaceCacheStorageKey, JSON.stringify(nextEnvelope))
    clearLegacySessionWorkspaceCache()
  } catch {
    // Keep the app responsive even if durable storage is unavailable.
  }
}

export function clearWorkspaceCache(userId?: string) {
  const storage = getLocalStorage()
  if (!storage) {
    clearLegacySessionWorkspaceCache()
    return
  }

  try {
    if (!userId) {
      storage.removeItem(workspaceCacheStorageKey)
      clearLegacySessionWorkspaceCache()
      return
    }

    const envelope = readWorkspaceCacheEnvelope()
    if (!envelope) {
      clearLegacySessionWorkspaceCache()
      return
    }

    const recordsByUserId = { ...envelope.recordsByUserId }
    delete recordsByUserId[userId]
    const remainingUserIds = Object.keys(recordsByUserId)

    if (!remainingUserIds.length) {
      storage.removeItem(workspaceCacheStorageKey)
      clearLegacySessionWorkspaceCache()
      return
    }

    storage.setItem(
      workspaceCacheStorageKey,
      JSON.stringify({
        version: 4,
        lastUserId: envelope.lastUserId === userId
          ? remainingUserIds[0]
          : envelope.lastUserId,
        recordsByUserId,
      } satisfies WorkspaceCacheEnvelope),
    )
    clearLegacySessionWorkspaceCache()
  } catch {
    // Ignore cache cleanup errors.
  }
}

function readWorkspaceCacheEnvelope() {
  const storage = getLocalStorage()
  if (!storage) {
    return null
  }

  try {
    const rawValue = storage.getItem(workspaceCacheStorageKey)
    if (!rawValue) {
      return null
    }

    const parsedValue = JSON.parse(rawValue) as Partial<WorkspaceCacheEnvelope>
    if (
      parsedValue.version !== 4 ||
      !parsedValue.recordsByUserId ||
      typeof parsedValue.recordsByUserId !== 'object'
    ) {
      return null
    }

    return parsedValue as WorkspaceCacheEnvelope
  } catch {
    return null
  }
}

function createEmptyWorkspaceCacheEnvelope(): WorkspaceCacheEnvelope {
  return {
    version: 4,
    lastUserId: null,
    recordsByUserId: {},
  }
}

function isValidWorkspaceCacheRecord(
  cacheRecord: WorkspaceCacheRecord | undefined,
  userId: string,
) {
  return Boolean(
    cacheRecord &&
      cacheRecord.version === 4 &&
      cacheRecord.userId === userId &&
      cacheRecord.state &&
      cacheRecord.state.currentUserId === userId,
  )
}

function getLocalStorage() {
  if (typeof window === 'undefined') {
    return null
  }

  try {
    return window.localStorage
  } catch {
    return null
  }
}

function clearLegacySessionWorkspaceCache() {
  if (typeof window === 'undefined') {
    return
  }

  try {
    window.sessionStorage.removeItem(legacySessionStorageKey)
  } catch {
    // Ignore legacy cache cleanup errors.
  }
}
