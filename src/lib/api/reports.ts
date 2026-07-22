import type { LaravelApiClient } from '@/lib/api/client'
import type {
  ListResponse,
  ReportComment,
  ReportDetailRecord,
  ReportResponse,
  SaveReportPayload,
} from '@/lib/api/types'

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
  const responses = await Promise.all(
    batches.map((batch) =>
      client.get<ListResponse<ReportResponse>>('/api/reports/details', {
        query: { ids: batch.join(',') },
      }),
    ),
  )
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
  const report = await client.post<ReportResponse>('/api/reports', {
    assignmentId: payload.assignmentId,
    reportingPeriodId: payload.reportingPeriodId,
    values: payload.values,
    submit: payload.submit ?? false,
  })

  return report.id
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
    reportPeriodWindow?: 'default' | 'all'
    page?: number
    perPage?: number
  },
) {
  return client.get<ListResponse<ReportResponse>>('/api/reports', {
    query: {
      assignmentId: options?.assignmentId,
      reportingPeriodId: options?.reportingPeriodId,
      reportPeriodWindow: options?.reportPeriodWindow ?? 'default',
      page: options?.page,
      perPage: options?.perPage,
    },
  })
}

export async function syncOverdueNotifications(client: LaravelApiClient) {
  void client

  // Laravel now runs overdue sync through the scheduler. Keep the old context hook as a no-op.
}
