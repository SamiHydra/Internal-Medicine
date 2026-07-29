import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  clearDashboardAnalyticsCache,
  fetchAnalyticsExports,
  fetchAndCacheDashboardAnalytics,
  fetchDashboardAnalytics,
  fetchQuarterlyAnalytics,
  queueFullHistoryAnalyticsExport,
  readCachedDashboardAnalytics,
} from '@/lib/api/analytics'
import { LaravelApiClient } from '@/lib/api/client'

describe('fetchDashboardAnalytics', () => {
  const originalFetch = globalThis.fetch
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    clearDashboardAnalyticsCache()
    fetchMock = vi.fn()
    globalThis.fetch = fetchMock as unknown as typeof fetch
  })

  afterEach(() => {
    clearDashboardAnalyticsCache()
    globalThis.fetch = originalFetch
  })

  function dashboardPayload(generatedAt = '2026-06-07T10:00:00.000000Z') {
    return {
      generatedAt,
      scope: {},
      overview: {
        scope: {},
        summary: {
          totalReports: 0,
          expectedReports: 0,
          missingReports: 0,
          statusCounts: {},
          totals: {},
          occupancy: { borPercent: null, btr: null, alos: null },
        },
        weekly: [],
        monthly: [],
      },
      families: {
        inpatient: { scope: {}, summary: {}, departments: [], weekly: [], monthly: [] },
        outpatient: { scope: {}, summary: {}, departments: [], weekly: [], monthly: [] },
        procedure: { scope: {}, summary: {}, departments: [], weekly: [], monthly: [] },
      },
    }
  }

  it('loads the cached dashboard aggregate with range filters', async () => {
    fetchMock.mockResolvedValueOnce({
      status: 200,
      ok: true,
      text: async () => JSON.stringify(dashboardPayload()),
    })

    const client = new LaravelApiClient('http://127.0.0.1:8000')
    const payload = await fetchDashboardAnalytics(client, {
      dateFrom: '2026-04-06',
      dateTo: '2026-05-25',
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(decodeURIComponent(String(fetchMock.mock.calls[0][0]))).toContain(
      '/api/analytics/dashboard?dateFrom=2026-04-06&dateTo=2026-05-25',
    )
    expect(payload.generatedAt).toBe('2026-06-07T10:00:00.000000Z')
  })

  it('dedupes in-flight dashboard aggregate fetches and exposes the cached payload', async () => {
    fetchMock.mockResolvedValueOnce({
      status: 200,
      ok: true,
      text: async () => JSON.stringify(dashboardPayload('2026-06-07T10:05:00.000000Z')),
    })

    const client = new LaravelApiClient('http://127.0.0.1:8000')
    const [firstPayload, secondPayload] = await Promise.all([
      fetchAndCacheDashboardAnalytics(client, {
        dateTo: '2026-05-25',
        dateFrom: '2026-04-06',
      }),
      fetchAndCacheDashboardAnalytics(client, {
        dateFrom: '2026-04-06',
        dateTo: '2026-05-25',
      }),
    ])

    const cachedPayload = readCachedDashboardAnalytics({
      dateFrom: '2026-04-06',
      dateTo: '2026-05-25',
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(firstPayload.generatedAt).toBe('2026-06-07T10:05:00.000000Z')
    expect(secondPayload).toBe(firstPayload)
    expect(cachedPayload).toBe(firstPayload)
  })

  it('loads quarterly rollups with year filters', async () => {
    fetchMock.mockResolvedValueOnce({
      status: 200,
      ok: true,
      text: async () => JSON.stringify({
        scope: { year: 2026, family: 'inpatient' },
        data: [
          {
            key: '2026-Q2',
            quarter: 'Q2',
            quarterLabel: 'Q2 2026',
            year: 2026,
            weekStart: '2026-04-06',
            weekEnd: '2026-06-28',
            periodIds: ['p1', 'p2'],
            periodCount: 2,
            summary: {
              totalReports: 2,
              expectedReports: 2,
              missingReports: 0,
              statusCounts: { submitted: 2 },
              totals: { totalAdmissions: 12 },
              occupancy: { borPercent: null, btr: null, alos: null },
            },
          },
        ],
      }),
    })

    const client = new LaravelApiClient('http://127.0.0.1:8000')
    const payload = await fetchQuarterlyAnalytics(client, {
      year: 2026,
      family: 'inpatient',
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(decodeURIComponent(String(fetchMock.mock.calls[0][0]))).toContain(
      '/api/analytics/quarterly?year=2026&family=inpatient',
    )
    expect(payload.data[0].quarterLabel).toBe('Q2 2026')
  })

  it('queues and lists full-history exports through the asynchronous endpoints', async () => {
    const exportRecord = {
      id: 'export-1',
      status: 'pending' as const,
      format: 'xlsx' as const,
      fileName: null,
      rowCount: 0,
      byteSize: null,
      error: null,
      createdAt: '2026-09-14T09:00:00.000000Z',
      completedAt: null,
      expiresAt: null,
      downloadUrl: null,
    }
    const client = new LaravelApiClient('http://127.0.0.1:8000')
    const post = vi.spyOn(client, 'post').mockResolvedValue({ data: exportRecord })
    const get = vi.spyOn(client, 'get').mockResolvedValue({ data: [exportRecord] })

    await expect(queueFullHistoryAnalyticsExport(client)).resolves.toEqual(exportRecord)
    await expect(fetchAnalyticsExports(client)).resolves.toEqual([exportRecord])
    expect(post).toHaveBeenCalledWith('/api/analytics/exports', { format: 'xlsx' })
    expect(get).toHaveBeenCalledWith('/api/analytics/exports')
  })
})
