import { ApiError } from '@/lib/api/client'
import type {
  ReportConflictResponse,
  ReportConflictSnapshot,
  SaveReportPayload,
} from '@/lib/api/types'

const dbName = 'stpaul-offline-reports'
const dbVersion = 1
const storeName = 'reportSaves'
const localStorageKey = 'stpaul:offline-report-save-queue:v1'

/**
 * After this many transient failures (timeouts, 5xx, rate limiting) a queued
 * save stops being retried automatically and is parked for the user to review.
 * It is never deleted on the user's behalf: see docs/OFFLINE_SYNC_MODEL.md.
 */
export const MAX_QUEUED_SAVE_ATTEMPTS = 5

export type QueuedReportSaveStatus = 'pending' | 'conflict'

/**
 * Why a queued save was parked instead of applied:
 * - stale:     the server copy changed after the client loaded it (409).
 * - exists:    the client believed the week had no report yet, but one exists (409).
 * - locked:    the report was locked while the save waited offline.
 * - rejected:  the server refused it for a reason a retry cannot fix
 *              (validation, authorization, the assignment disappeared).
 * - exhausted: transient failures kept happening past MAX_QUEUED_SAVE_ATTEMPTS.
 */
export type QueuedSaveConflictReason = 'stale' | 'exists' | 'locked' | 'rejected' | 'exhausted'

export type QueuedSaveConflict = {
  reason: QueuedSaveConflictReason
  message: string
  httpStatus: number | null
  detectedAt: string
  /** The server's current copy, when the server told us (409 responses). */
  serverReport: ReportConflictSnapshot | null
}

export type QueuedReportSave = {
  id: string
  userId: string
  payload: SaveReportPayload
  queuedAt: string
  updatedAt: string
  attempts: number
  lastError: string | null
  status: QueuedReportSaveStatus
  conflict: QueuedSaveConflict | null
}

type QueuePatch = Partial<
  Pick<QueuedReportSave, 'attempts' | 'lastError' | 'updatedAt' | 'status' | 'conflict' | 'payload'>
>

export type QueuedSaveFailure =
  | { kind: 'offline'; message: string }
  | { kind: 'auth'; message: string; httpStatus: number }
  | {
      kind: 'conflict'
      reason: Exclude<QueuedSaveConflictReason, 'exhausted'>
      message: string
      httpStatus: number
      serverReport: ReportConflictSnapshot | null
    }
  | { kind: 'transient'; message: string; httpStatus: number | null }

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

  // An HTTP answer, whatever its status, proves the network is up.
  if (error instanceof ApiError) {
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

function isConflictResponse(details: unknown): details is ReportConflictResponse {
  if (typeof details !== 'object' || !details) {
    return false
  }

  const candidate = details as Partial<ReportConflictResponse>
  return (
    typeof candidate.conflict === 'object' &&
    Boolean(candidate.conflict) &&
    typeof candidate.conflict.report === 'object' &&
    Boolean(candidate.conflict.report)
  )
}

/**
 * Decide what a failed replay means. Pure so the policy can be unit-tested:
 * only offline and transient failures are retried; everything else either
 * needs a new sign-in (auth) or the user's decision (conflict).
 */
export function classifyQueuedSaveFailure(error: unknown): QueuedSaveFailure {
  const message =
    error instanceof Error && error.message
      ? error.message
      : 'Unable to sync the queued report save.'

  if (isLikelyOfflineError(error)) {
    return { kind: 'offline', message }
  }

  if (!(error instanceof ApiError)) {
    return { kind: 'transient', message, httpStatus: null }
  }

  if (error.status === 401 || error.status === 419) {
    return { kind: 'auth', message, httpStatus: error.status }
  }

  if (error.status === 409) {
    const details = isConflictResponse(error.details) ? error.details : null
    const serverReport = details?.conflict.report ?? null
    const reason = serverReport?.lockedAt
      ? 'locked'
      : details?.conflict.reason === 'exists'
        ? 'exists'
        : 'stale'

    return { kind: 'conflict', reason, message, httpStatus: 409, serverReport }
  }

  if (error.status === 422 && message.toLowerCase().includes('locked')) {
    return { kind: 'conflict', reason: 'locked', message, httpStatus: 422, serverReport: null }
  }

  if ([400, 403, 404, 422].includes(error.status)) {
    return { kind: 'conflict', reason: 'rejected', message, httpStatus: error.status, serverReport: null }
  }

  return { kind: 'transient', message, httpStatus: error.status }
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

  return records
    .map(normalizeQueuedReportSave)
    .sort((left, right) => left.queuedAt.localeCompare(right.queuedAt))
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

/**
 * Record a failed replay. Only transient failures count towards the retry cap;
 * an offline failure records the message so the UI can show it but does not
 * move the save closer to being parked.
 */
export async function recordQueuedReportSaveFailure(
  id: string,
  message: string,
  options?: { countAttempt?: boolean },
) {
  const countAttempt = options?.countAttempt ?? true

  return updateQueuedReportSave(id, (record) => ({
    attempts: countAttempt ? record.attempts + 1 : record.attempts,
    lastError: message,
    updatedAt: new Date().toISOString(),
  }))
}

/** Park a save for the user's review. The payload is kept verbatim. */
export async function markQueuedReportSaveConflict(
  id: string,
  conflict: Omit<QueuedSaveConflict, 'detectedAt'> & { detectedAt?: string },
) {
  return updateQueuedReportSave(id, () => ({
    status: 'conflict',
    conflict: { ...conflict, detectedAt: conflict.detectedAt ?? new Date().toISOString() },
    lastError: conflict.message,
    updatedAt: new Date().toISOString(),
  }))
}

/**
 * Put a parked save back on the pending list, optionally re-basing it on the
 * revision the server reported so the next replay is an explicit overwrite.
 */
export async function retryQueuedReportSave(
  id: string,
  options?: { expectedUpdatedAt?: string | null },
) {
  return updateQueuedReportSave(id, (record) => ({
    status: 'pending',
    conflict: null,
    attempts: 0,
    lastError: null,
    updatedAt: new Date().toISOString(),
    payload:
      options && 'expectedUpdatedAt' in options
        ? { ...record.payload, expectedUpdatedAt: options.expectedUpdatedAt }
        : record.payload,
  }))
}

function createQueuedReportSave(
  userId: string,
  payload: SaveReportPayload,
  existing: QueuedReportSave | null,
): QueuedReportSave {
  const now = new Date().toISOString()
  const base = existing ? normalizeQueuedReportSave(existing) : null

  return {
    id: getReportSaveQueueId(userId, payload.assignmentId, payload.reportingPeriodId),
    userId,
    payload: {
      ...payload,
      submit: Boolean(payload.submit || base?.payload.submit),
      // The revision the client loaded before it went offline stays the base
      // for the whole offline session; later offline saves only refine values.
      expectedUpdatedAt:
        base && 'expectedUpdatedAt' in base.payload
          ? base.payload.expectedUpdatedAt
          : payload.expectedUpdatedAt,
    },
    queuedAt: base?.queuedAt ?? now,
    updatedAt: now,
    attempts: base?.attempts ?? 0,
    lastError: null,
    // A fresh save supersedes a parked one: the user re-entered values and
    // asked again, so it goes back on the pending list.
    status: 'pending',
    conflict: null,
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

      const normalized = normalizeQueuedReportSave(existing)
      const updated = { ...normalized, ...createPatch(normalized) }
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

        const normalized = normalizeQueuedReportSave(record)
        updated = { ...normalized, ...createPatch(normalized) }
        return updated
      })
      writeQueuedReportSavesToLocalStorage(next)
      return updated
    },
  )
}

/** Records written before the conflict state existed default to pending. */
function normalizeQueuedReportSave(record: QueuedReportSave): QueuedReportSave {
  return {
    ...record,
    status: record.status === 'conflict' ? 'conflict' : 'pending',
    conflict: record.status === 'conflict' ? record.conflict ?? null : null,
  }
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
