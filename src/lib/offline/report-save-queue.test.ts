import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { SaveReportPayload } from '@/lib/api/types'
import {
  countQueuedReportSaves,
  getReportSaveQueueId,
  isLikelyOfflineError,
  listQueuedReportSaves,
  queueReportSave,
  recordQueuedReportSaveFailure,
  removeQueuedReportSave,
} from '@/lib/offline/report-save-queue'

const originalIndexedDb = globalThis.indexedDB

function setIndexedDb(value: IDBFactory | undefined) {
  Object.defineProperty(globalThis, 'indexedDB', {
    configurable: true,
    value,
  })
}

function createPayload(
  overrides: Partial<SaveReportPayload> = {},
): SaveReportPayload {
  return {
    assignmentId: 'assignment-1',
    reportingPeriodId: 'period-1',
    actorId: 'user-1',
    submit: false,
    values: {
      census: {
        fieldId: 'census',
        dailyValues: {
          monday: 12,
        },
      },
    },
    ...overrides,
  }
}

describe('offline report save queue', () => {
  beforeEach(() => {
    setIndexedDb(undefined)
    window.localStorage.clear()
  })

  afterEach(() => {
    setIndexedDb(originalIndexedDb)
    window.localStorage.clear()
  })

  it('stores queued report saves in fallback storage by user and report key', async () => {
    const payload = createPayload()
    const queued = await queueReportSave('user-1', payload)

    expect(queued.id).toBe(getReportSaveQueueId('user-1', 'assignment-1', 'period-1'))
    expect(await countQueuedReportSaves('user-1')).toBe(1)
    expect(await countQueuedReportSaves('another-user')).toBe(0)

    const [stored] = await listQueuedReportSaves('user-1')
    expect(stored?.payload.values.census.dailyValues.monday).toBe(12)
  })

  it('coalesces repeated saves for the same report and preserves submit intent', async () => {
    const first = await queueReportSave('user-1', createPayload({ submit: true }))

    await queueReportSave(
      'user-1',
      createPayload({
        submit: false,
        values: {
          census: {
            fieldId: 'census',
            dailyValues: {
              monday: 18,
            },
          },
        },
      }),
    )

    const queuedSaves = await listQueuedReportSaves('user-1')

    expect(queuedSaves).toHaveLength(1)
    expect(queuedSaves[0]?.queuedAt).toBe(first.queuedAt)
    expect(queuedSaves[0]?.payload.submit).toBe(true)
    expect(queuedSaves[0]?.payload.values.census.dailyValues.monday).toBe(18)
  })

  it('tracks retry failures and removes synced saves', async () => {
    const queued = await queueReportSave('user-1', createPayload())

    await recordQueuedReportSaveFailure(queued.id, 'Network request failed')
    const [failed] = await listQueuedReportSaves('user-1')

    expect(failed?.attempts).toBe(1)
    expect(failed?.lastError).toBe('Network request failed')

    await removeQueuedReportSave(queued.id)

    expect(await listQueuedReportSaves('user-1')).toEqual([])
  })

  it('detects fetch-style network failures without treating validation errors as offline', () => {
    expect(isLikelyOfflineError(new TypeError('Failed to fetch'))).toBe(true)
    expect(isLikelyOfflineError(new Error('Validation failed'))).toBe(false)
  })
})
