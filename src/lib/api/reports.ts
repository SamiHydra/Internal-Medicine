import type { LaravelApiClient } from '@/lib/api/client'
import type {
  ListResponse,
  ReportComment,
  ReportDetailRecord,
  ReportResponse,
  ReportSummaryResponse,
  SaveReportPayload,
} from '@/lib/api/types'
import type { ReportStatusHistoryEntry, ReportingPeriod } from '@/types/domain'

export async function fetchReportComments(
  client: LaravelApiClient,
  reportId: string,
): Promise<ReportComment[]> {
  const response = await client.get<{ data: ReportComment[] }>(`/api/reports/${reportId}/comments`)

  return response.data
}

export async function postReportComment(
  client: LaravelApiClient,
  reportId: string,
  body: string,
): Promise<ReportComment> {
  return client.post<ReportComment>(`/api/reports/${reportId}/comments`, { body })
}

export async function deleteReportComment(
  client: LaravelApiClient,
  reportId: string,
  commentId: string,
): Promise<void> {
  await client.delete(`/api/reports/${reportId}/comments/${commentId}`)
}

const reportDetailBatchSize = 100

/**
 * Batches in flight at once. Every batch is a heavy query (a hundred reports
 * with all their day cells), so releasing them all together does not make the
 * answer arrive sooner - it just queues them inside the API and pushes the last
 * ones past the client timeout. A deep range used to release thirty at once and
 * abandon most of them.
 */
const reportDetailConcurrency = 3

export async function fetchReportDetails(
  client: LaravelApiClient,
  reportIds: string[],
) {
  const uniqueReportIds = [...new Set(reportIds.filter(Boolean))]

  if (!uniqueReportIds.length) {
    return {} as Record<string, ReportDetailRecord>
  }

  const batches = Array.from(
    { length: Math.ceil(uniqueReportIds.length / reportDetailBatchSize) },
    (_, index) => uniqueReportIds.slice(
      index * reportDetailBatchSize,
      (index + 1) * reportDetailBatchSize,
    ),
  )

  const responses: ListResponse<ReportResponse>[] = []

  for (let index = 0; index < batches.length; index += reportDetailConcurrency) {
    const wave = await Promise.all(
      batches.slice(index, index + reportDetailConcurrency).map((batch) =>
        client.get<ListResponse<ReportResponse>>('/api/reports/details', {
          query: { ids: batch.join(',') },
        }),
      ),
    )

    responses.push(...wave)
  }

  const reports = responses.flatMap((response) => response.data)

  return Object.fromEntries(
    reports.map((report) => [
      report.id,
      {
        values: report.values ?? {},
        calculatedMetrics: report.calculatedMetrics ?? {},
        quality: report.quality,
      },
    ]),
  ) as Record<string, ReportDetailRecord>
}

export async function saveReport(
  client: LaravelApiClient,
  payload: SaveReportPayload,
) {
  return client.post<ReportResponse>('/api/reports', {
    assignmentId: payload.assignmentId,
    reportingPeriodId: payload.reportingPeriodId,
    values: payload.values,
    submit: payload.submit ?? false,
  })
}

export async function setReportLockState(
  client: LaravelApiClient,
  reportId: string,
  locked: boolean,
) {
  await client.post<ReportResponse>(
    locked ? `/api/reports/${reportId}/lock` : `/api/reports/${reportId}/unlock`,
  )
}

export async function listReports(
  client: LaravelApiClient,
  options?: {
    assignmentId?: string
    reportingPeriodId?: string
    periodIds?: string[]
    reportPeriodWindow?: 'default' | 'all'
    page?: number
    perPage?: number
  },
) {
  return client.get<ListResponse<ReportSummaryResponse>>('/api/reports', {
    query: {
      assignmentId: options?.assignmentId,
      reportingPeriodId: options?.reportingPeriodId,
      periodIds: options?.periodIds?.join(','),
      reportPeriodWindow: options?.reportPeriodWindow ?? 'default',
      page: options?.page,
      perPage: options?.perPage,
    },
  })
}

export async function listAllReportSummaries(
  client: LaravelApiClient,
  options?: Parameters<typeof listReports>[1],
) {
  const reports: ReportSummaryResponse[] = []
  let page = 1
  let lastPage = 1

  do {
    const response = await listReports(client, {
      ...options,
      page,
      perPage: 100,
    })
    reports.push(...response.data)
    lastPage = response.meta?.lastPage ?? 1
    page += 1
  } while (page <= lastPage)

  return reports
}

export async function fetchReportingPeriods(
  client: LaravelApiClient,
  perPage = 26,
) {
  return (
    await client.get<ListResponse<ReportingPeriod>>('/api/reporting-periods', {
      query: { page: 1, perPage },
    })
  ).data
}

export async function fetchReportStatusHistory(client: LaravelApiClient) {
  const response = await client.get<
    ListResponse<ReportStatusHistoryEntry> & { reports: ReportSummaryResponse[] }
  >('/api/reports/status-history', {
    query: { page: 1, perPage: 100 },
  })

  return { history: response.data, reports: response.reports }
}

export async function syncOverdueNotifications(client: LaravelApiClient) {
  void client

  // Laravel now runs overdue sync through the scheduler. Keep the old context hook as a no-op.
}
