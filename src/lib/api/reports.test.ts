import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { LaravelApiClient } from '@/lib/api/client'
import { fetchReportDetails, listReports } from '@/lib/api/reports'
import type { ReportResponse } from '@/lib/api/types'

function reportResponse(id: string): ReportResponse {
  return {
    id,
    values: {
      total_patient_days: {
        fieldId: 'total_patient_days',
        dailyValues: { monday: 1 },
      },
    },
    calculatedMetrics: {
      borPercent: null,
      btr: null,
      alos: null,
    },
  } as unknown as ReportResponse
}

describe('fetchReportDetails', () => {
  const originalFetch = globalThis.fetch
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    globalThis.fetch = fetchMock as unknown as typeof fetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('loads report details through capped batch requests', async () => {
    const reportIds = Array.from({ length: 101 }, (_, index) => `report-${index}`)
    const firstBatch = reportIds.slice(0, 100).map(reportResponse)
    const secondBatch = reportIds.slice(100).map(reportResponse)

    fetchMock
      .mockResolvedValueOnce({
        status: 200,
        ok: true,
        text: async () => JSON.stringify({ data: firstBatch }),
      })
      .mockResolvedValueOnce({
        status: 200,
        ok: true,
        text: async () => JSON.stringify({ data: secondBatch }),
      })

    const client = new LaravelApiClient('http://127.0.0.1:8000')
    const details = await fetchReportDetails(client, reportIds)

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(decodeURIComponent(String(fetchMock.mock.calls[0][0]))).toContain(
      `/api/reports/details?ids=${reportIds.slice(0, 100).join(',')}`,
    )
    expect(decodeURIComponent(String(fetchMock.mock.calls[1][0]))).toContain(
      `/api/reports/details?ids=${reportIds.slice(100).join(',')}`,
    )
    expect(details['report-100'].values.total_patient_days.dailyValues.monday).toBe(1)
  })

  it('passes the report window and pagination query to report listing', async () => {
    fetchMock.mockResolvedValueOnce({
      status: 200,
      ok: true,
      text: async () => JSON.stringify({
        data: [],
        meta: { currentPage: 2, lastPage: 4, perPage: 25, total: 100 },
      }),
    })

    const client = new LaravelApiClient('http://127.0.0.1:8000')
    const response = await listReports(client, {
      reportPeriodWindow: 'all',
      page: 2,
      perPage: 25,
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(decodeURIComponent(String(fetchMock.mock.calls[0][0]))).toContain(
      '/api/reports?reportPeriodWindow=all&page=2&perPage=25',
    )
    expect(response.meta?.total).toBe(100)
  })
})
