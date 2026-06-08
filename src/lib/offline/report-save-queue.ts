import type { SaveReportPayload } from '@/lib/api/types'

const dbName = 'stpaul-offline-reports'
const dbVersion = 1
const storeName = 'reportSaves'
const localStorageKey = 'stpaul:offline-report-save-queue:v1'

/**
 * After this many non-offline failures (e.g. the report was locked or the
 * assignment was removed server-side), a queued save is dead-lettered instead
 * of being retried forever.
 */
export const MAX_QUEUED_SAVE_ATTEMPTS = 5

export type QueuedReportSave = {
  id: string
  userId: string
  payload: SaveReportPayload
  queuedAt: string
  updatedAt: string
  attempts: number
  lastError: string | null
}

type QueuePatch = Partial<Pick<QueuedReportSave, 'attempts' | 'lastError' | 'updatedAt'>>

export function getReportSaveQueueId(
  userId: string,
  assignmentId: string,
  reportingPeriodId: string,
) {
  return [userId, assignmentId, reportingPeriodId]
    .map((part) => encodeURIComponent(part))
    .join(':')
}

export function isBrowserOffline() {
  return typeof navigator !== 'undefined' && navigator.onLine === false
}

export function isLikelyOfflineError(error: unknown) {
  if (isBrowserOffline()) {
    return true
  }

  if (!(error instanceof Error)) {
    return false
  }

  const haystack = `${error.name} ${error.message}`.toLowerCase()
  return [
    'failed to fetch',
    'fetch failed',
    'load failed',
    'networkerror',
    'network request failed',
    'internet connection',
    'connection refused',
    'connection reset',
    'connection timed out',
    'offline',
  ].some((needle) => haystack.includes(needle))
}

export async function queueReportSave(
  userId: string,
  payload: SaveReportPayload,
) {
  const id = getReportSaveQueueId(
    userId,
    payload.assignmentId,
    payload.reportingPeriodId,
  )

  return withStorageFallback(
    async () => {
      const existing = await readQueuedReportSaveFromIndexedDb(id)
      const record = createQueuedReportSave(userId, payload, existing)
      await writeQueuedReportSaveToIndexedDb(record)
      return record
    },
    () => {
      const records = readQueuedReportSavesFromLocalStorage()
      const existing = records.find((record) => record.id === id) ?? null
      const record = createQueuedReportSave(userId, payload, existing)
      writeQueuedReportSavesToLocalStorage([
        record,
        ...records.filter((currentRecord) => currentRecord.id !== id),
      ])
      return record
    },
  )
}

export async function listQueuedReportSaves(userId?: string) {
  const records = await withStorageFallback(
    () => listQueuedReportSavesFromIndexedDb(userId),
    () => readQueuedReportSavesFromLocalStorage()
      .filter((record) => !userId || record.userId === userId),
  )

  return records.sort((left, right) => left.queuedAt.localeCompare(right.queuedAt))
}

export async function countQueuedReportSaves(userId?: string) {
  return (await listQueuedReportSaves(userId)).length
}

export async function removeQueuedReportSave(id: string) {
  await withStorageFallback(
    () => deleteQueuedReportSaveFromIndexedDb(id),
    () => {
      writeQueuedReportSavesToLocalStorage(
        readQueuedReportSavesFromLocalStorage().filter((record) => record.id !== id),
      )
    },
  )
}

export async function recordQueuedReportSaveFailure(id: string, message: string) {
  return updateQueuedReportSave(id, (record) => ({
    attempts: record.attempts + 1,
    lastError: message,
    updatedAt: new Date().toISOString(),
  }))
}

function createQueuedReportSave(
  userId: string,
  payload: SaveReportPayload,
  existing: QueuedReportSave | null,
): QueuedReportSave {
  const now = new Date().toISOString()

  return {
    id: getReportSaveQueueId(userId, payload.assignmentId, payload.reportingPeriodId),
    userId,
    payload: {
      ...payload,
      submit: Boolean(payload.submit || existing?.payload.submit),
    },
    queuedAt: existing?.queuedAt ?? now,
    updatedAt: now,
    attempts: existing?.attempts ?? 0,
    lastError: null,
  }
}

async function updateQueuedReportSave(
  id: string,
  createPatch: (record: QueuedReportSave) => QueuePatch,
): Promise<QueuedReportSave | null> {
  return withStorageFallback(
    async () => {
      const existing = await readQueuedReportSaveFromIndexedDb(id)
      if (!existing) {
        return null
      }

      const updated = { ...existing, ...createPatch(existing) }
      await writeQueuedReportSaveToIndexedDb(updated)
      return updated
    },
    () => {
      const records = readQueuedReportSavesFromLocalStorage()
      let updated: QueuedReportSave | null = null
      const next = records.map((record) => {
        if (record.id !== id) {
          return record
        }

        updated = { ...record, ...createPatch(record) }
        return updated
      })
      writeQueuedReportSavesToLocalStorage(next)
      return updated
    },
  )
}

async function withStorageFallback<T>(
  indexedDbOperation: () => Promise<T>,
  localStorageOperation: () => T,
) {
  if (canUseIndexedDb()) {
    try {
      return await indexedDbOperation()
    } catch {
      // Keep report entry useful even if IndexedDB is unavailable or blocked.
    }
  }

  return localStorageOperation()
}

function canUseIndexedDb() {
  return typeof indexedDB !== 'undefined'
}

function openQueueDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(dbName, dbVersion)

    request.onupgradeneeded = () => {
      const database = request.result
      const store = database.objectStoreNames.contains(storeName)
        ? request.transaction?.objectStore(storeName)
        : database.createObjectStore(storeName, { keyPath: 'id' })

      if (store && !store.indexNames.contains('userId')) {
        store.createIndex('userId', 'userId', { unique: false })
      }
    }

    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('Unable to open offline report queue.'))
  })
}

async function readQueuedReportSaveFromIndexedDb(id: string) {
  const database = await openQueueDatabase()

  try {
    const transaction = database.transaction(storeName, 'readonly')
    const request = transaction.objectStore(storeName).get(id)
    return await requestToPromise<QueuedReportSave | undefined>(request) ?? null
  } finally {
    database.close()
  }
}

async function listQueuedReportSavesFromIndexedDb(userId?: string) {
  const database = await openQueueDatabase()

  try {
    const transaction = database.transaction(storeName, 'readonly')
    const store = transaction.objectStore(storeName)
    const request = userId
      ? store.index('userId').getAll(IDBKeyRange.only(userId))
      : store.getAll()

    return await requestToPromise<QueuedReportSave[]>(request)
  } finally {
    database.close()
  }
}

async function writeQueuedReportSaveToIndexedDb(record: QueuedReportSave) {
  const database = await openQueueDatabase()

  try {
    const transaction = database.transaction(storeName, 'readwrite')
    const request = transaction.objectStore(storeName).put(record)
    await requestToPromise<IDBValidKey>(request)
    await transactionComplete(transaction)
  } finally {
    database.close()
  }
}

async function deleteQueuedReportSaveFromIndexedDb(id: string) {
  const database = await openQueueDatabase()

  try {
    const transaction = database.transaction(storeName, 'readwrite')
    const request = transaction.objectStore(storeName).delete(id)
    await requestToPromise<undefined>(request)
    await transactionComplete(transaction)
  } finally {
    database.close()
  }
}

function requestToPromise<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('Offline queue request failed.'))
  })
}

function transactionComplete(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error ?? new Error('Offline queue transaction failed.'))
    transaction.onabort = () => reject(transaction.error ?? new Error('Offline queue transaction aborted.'))
  })
}

function readQueuedReportSavesFromLocalStorage() {
  if (typeof window === 'undefined') {
    return [] as QueuedReportSave[]
  }

  try {
    const rawValue = window.localStorage.getItem(localStorageKey)
    if (!rawValue) {
      return []
    }

    const parsedValue = JSON.parse(rawValue)
    if (!Array.isArray(parsedValue)) {
      return []
    }

    return parsedValue.filter(isQueuedReportSave)
  } catch {
    return []
  }
}

function writeQueuedReportSavesToLocalStorage(records: QueuedReportSave[]) {
  if (typeof window === 'undefined') {
    return
  }

  try {
    window.localStorage.setItem(localStorageKey, JSON.stringify(records))
  } catch {
    // If localStorage is full or blocked, the caller will surface the save failure.
  }
}

function isQueuedReportSave(record: unknown): record is QueuedReportSave {
  if (typeof record !== 'object' || !record) {
    return false
  }

  const candidate = record as Partial<QueuedReportSave>
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.userId === 'string' &&
    typeof candidate.queuedAt === 'string' &&
    typeof candidate.updatedAt === 'string' &&
    typeof candidate.attempts === 'number' &&
    typeof candidate.payload === 'object' &&
    Boolean(candidate.payload)
  )
}
