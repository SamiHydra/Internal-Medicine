import type { LaravelApiClient } from '@/lib/api/client'
import type { ReportFamily, ReportStatus } from '@/types/domain'

export type AnalyticsQuery = Record<string, string | number | boolean | null | undefined>

type AnalyticsStatusCounts = Partial<Record<Exclude<ReportStatus, 'not_started'>, number>>

export type AnalyticsSummary = {
  totalReports: number
  expectedReports: number
  missingReports: number
  statusCounts: AnalyticsStatusCounts
  totals: {
    totalAdmissions?: number
    totalDischarges?: number
    totalPatientDays?: number
    totalOutpatientVisits?: number
    totalPatientsSeen?: number
    followUpPatients?: number
    newPatientsSeen?: number
    notSeenSameDay?: number
    failedToCome?: number
    noShowCount?: number
    notSeenAppointment?: number
    haiCount?: number
    procedureThroughput?: number
  }
  occupancy: {
    borPercent: number | null
    btr: number | null
    alos: number | null
  }
}

export type AnalyticsOverviewPayload = {
  scope: Record<string, unknown>
  summary: AnalyticsSummary
  weekly: unknown[]
  monthly: unknown[]
}

export type AnalyticsFamilyPayload = AnalyticsOverviewPayload & {
  departments: unknown[]
  outpatient?: {
    averages: Record<string, number | null>
    seniorPhysicianAvailability: Record<string, number>
  }
  procedures?: {
    totalThroughput: number
    services: unknown[]
    dialysisMix: Record<string, number>
    endoscopyMix: Record<string, number>
  }
}

export type DashboardAnalyticsPayload = {
  generatedAt: string
  scope: Record<string, unknown>
  overview: AnalyticsOverviewPayload
  families: Record<ReportFamily, AnalyticsFamilyPayload>
}

export type AnalyticsRollupRow = {
  key?: string
  quarter?: string | null
  quarterLabel?: string
  year: number
  label?: string
  weekStart: string | null
  weekEnd: string | null
  periodIds: string[]
  periodCount: number
  summary: AnalyticsSummary
}

export type AnalyticsRollupPayload = {
  scope: Record<string, unknown>
  data: AnalyticsRollupRow[]
}

export function fetchAnalytics<T>(
  client: LaravelApiClient,
  endpoint:
    | 'dashboard'
    | 'overview'
    | 'inpatient'
    | 'outpatient'
    | 'procedures'
    | 'weekly'
    | 'monthly'
    | 'quarterly'
    | 'yearly'
    | 'departments'
    | 'wards',
  query?: AnalyticsQuery,
) {
  return client.get<T>(`/api/analytics/${endpoint}`, { query })
}

export function fetchDashboardAnalytics(
  client: LaravelApiClient,
  query?: AnalyticsQuery,
) {
  return fetchAnalytics<DashboardAnalyticsPayload>(client, 'dashboard', query)
}

export function fetchQuarterlyAnalytics(
  client: LaravelApiClient,
  query?: AnalyticsQuery,
) {
  return fetchAnalytics<AnalyticsRollupPayload>(client, 'quarterly', query)
}

export function fetchYearlyAnalytics(
  client: LaravelApiClient,
  query?: AnalyticsQuery,
) {
  return fetchAnalytics<AnalyticsRollupPayload>(client, 'yearly', query)
}
