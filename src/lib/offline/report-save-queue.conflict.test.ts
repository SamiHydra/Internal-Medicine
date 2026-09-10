import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { ApiError } from '@/lib/api/client'
import type { SaveReportPayload } from '@/lib/api/types'
import {
  classifyQueuedSaveFailure,
  listQueuedReportSaves,
  markQueuedReportSaveConflict,
  MAX_QUEUED_SAVE_ATTEMPTS,
  queueReportSave,
  recordQueuedReportSaveFailure,
  retryQueuedReportSave,
} from '@/lib/offline/report-save-queue'

const originalIndexedDb = globalThis.indexedDB

function setIndexedDb(value: IDBFactory | undefined) {
  Object.defineProperty(globalThis, 'indexedDB', {
    configurable: true,
    value,
  })
}

function createPayload(overrides: Partial<SaveReportPayload> = {}): SaveReportPayload {
  return {
    assignmentId: 'assignment-1',
    reportingPeriodId: 'period-1',
    actorId: 'user-1',
    submit: false,
    expectedUpdatedAt: '2026-09-01T08:00:00.000000Z',
    values: {
      census: { fieldId: 'census', dailyValues: { monday: 12 } },
    },
    ...overrides,
  }
}

const conflictBody = {
  message: 'This report was changed elsewhere after you loaded it.',
  conflict: {
    reason: 'stale' as const,
    report: {
      id: 'report-1',
      assignmentId: 'assignment-1',
      reportingPeriodId: 'period-1',
      status: 'draft',
      submittedAt: null,
      lockedAt: null,
      updatedAt: '2026-09-01T09:00:00.000000Z',
      updatedById: 'admin-1',
      updatedByName: 'Admin One',
      values: { census: { fieldId: 'census', dailyValues: { monday: 40 } } },
    },
  },
}

describe('offline report save queue: conflict state', () => {
  beforeEach(() => {
    setIndexedDb(undefined)
    window.localStorage.clear()
  })

  afterEach(() => {
    setIndexedDb(originalIndexedDb)
    window.localStorage.clear()
  })

  it('new records are pending and keep the revision loaded before going offline', async () => {
    const first = await queueReportSave('user-1', createPayload())
    expect(first.status).toBe('pending')
    expect(first.conflict).toBeNull()

    // A later offline save refines the values but must not move the base revision.
    await queueReportSave(
      'user-1',
      createPayload({
        expectedUpdatedAt: '2026-09-02T00:00:00.000000Z',
        values: { census: { fieldId: 'census', dailyValues: { monday: 13 } } },
      }),
    )

    const [record] = await listQueuedReportSaves('user-1')
    expect(record?.payload.expectedUpdatedAt).toBe('2026-09-01T08:00:00.000000Z')
    expect(record?.payload.values.census.dailyValues.monday).toBe(13)
  })

  it('parks a refused save with the server copy instead of deleting it', async () => {
    const queued = await queueReportSave('user-1', createPayload())

    const parked = await markQueuedReportSaveConflict(queued.id, {
      reason: 'stale',
      message: conflictBody.message,
      httpStatus: 409,
      serverReport: conflictBody.conflict.report,
    })

    expect(parked?.status).toBe('conflict')
    expect(parked?.conflict?.reason).toBe('stale')
    expect(parked?.conflict?.serverReport?.values.census.dailyValues.monday).toBe(40)
    expect(parked?.conflict?.detectedAt).toEqual(expect.any(String))

    // Still on the device, with the user's values intact.
    const records = await listQueuedReportSaves('user-1')
    expect(records).toHaveLength(1)
    expect(records[0]?.payload.values.census.dailyValues.monday).toBe(12)
  })

  it('retrying a parked save re-bases it on the revision the server reported', async () => {
    const queued = await queueReportSave('user-1', createPayload())
    await markQueuedReportSaveConflict(queued.id, {
      reason: 'stale',
      message: 'stale',
      httpStatus: 409,
      serverReport: conflictBody.conflict.report,
    })

    const retried = await retryQueuedReportSave(queued.id, {
      expectedUpdatedAt: conflictBody.conflict.report.updatedAt,
    })

    expect(retried?.status).toBe('pending')
    expect(retried?.conflict).toBeNull()
    expect(retried?.attempts).toBe(0)
    expect(retried?.payload.expectedUpdatedAt).toBe('2026-09-01T09:00:00.000000Z')

    // Without options the base revision is left as it was.
    await markQueuedReportSaveConflict(queued.id, {
      reason: 'exhausted',
      message: 'timeout',
      httpStatus: 504,
      serverReport: null,
    })
    const retriedAgain = await retryQueuedReportSave(queued.id)
    expect(retriedAgain?.payload.expectedUpdatedAt).toBe('2026-09-01T09:00:00.000000Z')
  })

  it('a fresh save for a parked report supersedes the parked copy', async () => {
    const queued = await queueReportSave('user-1', createPayload())
    await markQueuedReportSaveConflict(queued.id, {
      reason: 'locked',
      message: 'Locked reports are read-only.',
      httpStatus: 422,
      serverReport: null,
    })

    const again = await queueReportSave('user-1', createPayload({ submit: true }))
    expect(again.status).toBe('pending')
    expect(again.conflict).toBeNull()
    expect(again.payload.submit).toBe(true)
  })

  it('offline failures record the message without counting towards the cap', async () => {
    const queued = await queueReportSave('user-1', createPayload())

    const afterOffline = await recordQueuedReportSaveFailure(queued.id, 'Failed to fetch', {
      countAttempt: false,
    })
    expect(afterOffline?.attempts).toBe(0)
    expect(afterOffline?.lastError).toBe('Failed to fetch')

    let updated = afterOffline
    for (let attempt = 1; attempt <= MAX_QUEUED_SAVE_ATTEMPTS; attempt += 1) {
      updated = await recordQueuedReportSaveFailure(queued.id, `gateway ${attempt}`)
    }
    expect(updated?.attempts).toBe(MAX_QUEUED_SAVE_ATTEMPTS)
  })

  it('records written before the conflict state existed read back as pending', async () => {
    window.localStorage.setItem(
      'stpaul:offline-report-save-queue:v1',
      JSON.stringify([
        {
          id: 'user-1:assignment-1:period-1',
          userId: 'user-1',
          payload: createPayload(),
          queuedAt: '2026-09-01T08:00:00.000Z',
          updatedAt: '2026-09-01T08:00:00.000Z',
          attempts: 2,
          lastError: null,
        },
      ]),
    )

    const [record] = await listQueuedReportSaves('user-1')
    expect(record?.status).toBe('pending')
    expect(record?.conflict).toBeNull()
    expect(record?.attempts).toBe(2)
  })
})

describe('classifyQueuedSaveFailure', () => {
  beforeEach(() => {
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: true })
  })

  it('treats fetch failures and an offline browser as offline', () => {
    expect(classifyQueuedSaveFailure(new TypeError('Failed to fetch')).kind).toBe('offline')

    Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: false })
    expect(classifyQueuedSaveFailure(new Error('anything')).kind).toBe('offline')
  })

  it('never treats an HTTP answer as offline, even when the browser flag says so', () => {
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: true })
    expect(classifyQueuedSaveFailure(new ApiError('Server Error', 500)).kind).toBe('transient')
  })

  it('stops the replay on an expired session without counting against the save', () => {
    expect(classifyQueuedSaveFailure(new ApiError('Unauthenticated.', 401))).toEqual({
      kind: 'auth',
      message: 'Unauthenticated.',
      httpStatus: 401,
    })
    expect(classifyQueuedSaveFailure(new ApiError('CSRF token mismatch.', 419)).kind).toBe('auth')
  })

  it('turns a 409 into a stale conflict carrying the server copy', () => {
    const failure = classifyQueuedSaveFailure(new ApiError(conflictBody.message, 409, conflictBody))

    expect(failure.kind).toBe('conflict')
    if (failure.kind !== 'conflict') return
    expect(failure.reason).toBe('stale')
    expect(failure.serverReport?.updatedByName).toBe('Admin One')
  })

  it('reports a lock when the 409 copy is locked or the 422 says so', () => {
    const lockedBody = {
      ...conflictBody,
      conflict: {
        ...conflictBody.conflict,
        report: { ...conflictBody.conflict.report, status: 'locked', lockedAt: '2026-09-01T09:00:00.000000Z' },
      },
    }
    const viaConflict = classifyQueuedSaveFailure(new ApiError('changed', 409, lockedBody))
    expect(viaConflict.kind === 'conflict' && viaConflict.reason).toBe('locked')

    const viaValidation = classifyQueuedSaveFailure(new ApiError('Locked reports are read-only.', 422))
    expect(viaValidation.kind === 'conflict' && viaValidation.reason).toBe('locked')
  })

  it('classifies validation, authorization and missing targets as rejected, the rest as transient', () => {
    expect(classifyQueuedSaveFailure(new ApiError('Unknown field', 422)).kind).toBe('conflict')
    const forbidden = classifyQueuedSaveFailure(new ApiError('Forbidden', 403))
    expect(forbidden.kind === 'conflict' && forbidden.reason).toBe('rejected')
    const missing = classifyQueuedSaveFailure(new ApiError('Not found', 404))
    expect(missing.kind === 'conflict' && missing.reason).toBe('rejected')

    expect(classifyQueuedSaveFailure(new ApiError('Too Many Attempts.', 429)).kind).toBe('transient')
    expect(classifyQueuedSaveFailure(new ApiError('took too long', 408)).kind).toBe('transient')
    expect(classifyQueuedSaveFailure(new ApiError('Bad Gateway', 502)).kind).toBe('transient')
    expect(classifyQueuedSaveFailure(new Error('weird')).kind).toBe('transient')
  })
})
