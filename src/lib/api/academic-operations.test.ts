import { describe, expect, it, vi } from 'vitest'

import {
  fetchMorningAnalytics,
  fetchStudentAnalytics,
  fetchTeachingAnalytics,
} from '@/lib/api/academic-operations'
import { LaravelApiClient } from '@/lib/api/client'

function clientReturning(payload: unknown) {
  const client = new LaravelApiClient('http://127.0.0.1:8000')
  vi.spyOn(client, 'get').mockResolvedValue(payload)

  return client
}

describe('academic operations response contracts', () => {
  it('accepts the documented latest-session morning window', async () => {
    const payload = await fetchMorningAnalytics(clientReturning({
      recordedCount: 2,
      notRecordedCount: 1,
      cancelledCount: 0,
      onTimeRate: 50,
      avgDelayMinutes: 10,
      trend: [{ date: '2026-09-07', status: 'recorded', delayMinutes: 0 }],
      people: [{
        userId: 'user-1',
        fullName: 'Test Resident',
        expectedCount: 2,
        presentCount: 1,
        attendanceRate: 50,
      }],
      window: {
        type: 'latest_sessions',
        limit: 60,
        sessionCount: 3,
        fromDate: '2026-09-07',
        toDate: '2026-09-11',
      },
    }))

    expect(payload.window.sessionCount).toBe(3)
    expect(payload.people[0]?.attendanceRate).toBe(50)
  })

  it('preserves block identity for teaching charts and missed activities', async () => {
    const occurrence = {
      held: 2,
      notHeld: 1,
      cancelled: 0,
      pending: 1,
      heldRate: 66.7,
    }
    const missedSession = {
      id: 'session-1',
      batchId: 'block-1',
      batchLabel: 'C1 Block 2',
      activityType: 'lecture',
      subgroup: null,
      scheduledDate: '2026-09-10',
      reason: 'Lecturer unavailable',
    }

    const payload = await fetchTeachingAnalytics(clientReturning({
      window: {
        fromDate: '2025-09-14',
        toDate: '2026-09-14',
        maxDays: 366,
      },
      byActivity: [{ activityType: 'lecture', ...occurrence }],
      byBatch: [{ batchId: 'block-1', batchLabel: 'C1 Block 2', ...occurrence }],
      blocks: [{
        batchId: 'block-1',
        batchLabel: 'C1 Block 2',
        cohort: 'C1',
        startsOn: '2026-09-01',
        endsOn: '2026-12-06',
        active: true,
        ...occurrence,
        byActivity: [{ activityType: 'lecture', ...occurrence }],
        reasons: [{ reason: 'Lecturer unavailable', count: 1 }],
        missedSessions: [missedSession],
        pendingBacklog: 1,
      }],
      reasons: [{ reason: 'Lecturer unavailable', count: 1 }],
      missedSessions: [missedSession],
      pendingBacklog: 1,
    }))

    expect(payload.window.maxDays).toBe(366)
    expect(payload.blocks[0]?.batchLabel).toBe('C1 Block 2')
    expect(payload.missedSessions[0]?.batchId).toBe('block-1')
  })

  it('rejects malformed morning, teaching, and student payloads', async () => {
    await expect(fetchMorningAnalytics(clientReturning({ trend: {} }))).rejects.toThrow()
    await expect(fetchTeachingAnalytics(clientReturning({ byActivity: 'not-an-array' }))).rejects.toThrow()
    await expect(fetchStudentAnalytics(clientReturning({ students: [], batches: [{ studentCount: 'one' }] }))).rejects.toThrow()
  })
})
