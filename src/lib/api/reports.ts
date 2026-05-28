import type { LaravelApiClient } from '@/lib/api/client'
import type {
  ListResponse,
  ReportDetailRecord,
  ReportResponse,
  SaveReportPayload,
} from '@/lib/api/types'

export async function fetchReportDetails(
  client: LaravelApiClient,
  reportIds: string[],
) {
  const uniqueReportIds = [...new Set(reportIds.filter(Boolean))]

  if (!uniqueReportIds.length) {
    return {} as Record<string, ReportDetailRecord>
  }

  const reports = await Promise.all(
    uniqueReportIds.map((reportId) =>
      client.get<ReportResponse>(`/api/reports/${reportId}`),
    ),
  )

  return Object.fromEntries(
    reports.map((report) => [
      report.id,
      {
        values: report.values ?? {},
        calculatedMetrics: report.calculatedMetrics ?? {},
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

export async function listReports(client: LaravelApiClient) {
  return client.get<ListResponse<ReportResponse>>('/api/reports')
}

export async function syncOverdueNotifications(client: LaravelApiClient) {
  void client

  // Laravel now runs overdue sync through the scheduler. Keep the old context hook as a no-op.
}
