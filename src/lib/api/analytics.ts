import type { LaravelApiClient } from '@/lib/api/client'
import { readBoundedCache, writeBoundedCache } from '@/lib/bounded-cache'
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
    newAdmissions?: number
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
    deaths?: number
    newPressureUlcers?: number
    procedureThroughput?: number
  }
  occupancy: {
    borPercent: number | null
    btr: number | null
    alos: number | null
  }
}

export type AnalyticsAvailabilityCounts = {
  fullDay: number
  partialDay: number
  unavailable: number
  total: number
}

export type AnalyticsProcedureServicePoint = {
  serviceId: string
  serviceName: string
  departmentSlug: string
  metricLabel: string
  fieldIds: string
  total: number
}

export type AnalyticsProcedureMixPoint = {
  key: string
  label: string
  value: number
  fieldIds: string
}

export type AnalyticsChartMetrics = Record<string, number | null | unknown> & {
  availability?: AnalyticsAvailabilityCounts
  totalThroughput?: number
  services?: AnalyticsProcedureServicePoint[]
  dialysisMix?: AnalyticsProcedureMixPoint[]
  endoscopyMix?: AnalyticsProcedureMixPoint[]
}

export type AnalyticsWeeklyDepartment = {
  departmentId: string
  departmentSlug: string | null
  departmentName: string | null
  family: ReportFamily | null
  metrics: AnalyticsChartMetrics
}

export type AnalyticsWeeklyRow = {
  periodId: string
  weekStart: string | null
  weekEnd: string | null
  label: string | null
  summary: AnalyticsSummary
  chartMetrics?: AnalyticsChartMetrics
  departments?: AnalyticsWeeklyDepartment[]
}

export type AnalyticsOverviewPayload = {
  scope: Record<string, unknown>
  summary: AnalyticsSummary
  weekly: AnalyticsWeeklyRow[]
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

export type AnalyticsExportStatus = 'pending' | 'processing' | 'ready' | 'failed'

export type AnalyticsExportRecord = {
  id: string
  status: AnalyticsExportStatus
  format: 'csv'
  fileName: string | null
  rowCount: number
  byteSize: number | null
  error: string | null
  createdAt: string
  completedAt: string | null
  expiresAt: string | null
  downloadUrl: string | null
}

const DASHBOARD_ANALYTICS_CACHE_TTL_MS = 5 * 60 * 1000
const DASHBOARD_ANALYTICS_CACHE_MAX_ENTRIES = 12

type DashboardAnalyticsCacheEntry = {
  payload: DashboardAnalyticsPayload
  cachedAt: number
}

const dashboardAnalyticsCache = new Map<string, DashboardAnalyticsCacheEntry>()
const dashboardAnalyticsRequests = new Map<string, Promise<DashboardAnalyticsPayload>>()

function normalizedQueryEntries(query?: AnalyticsQuery) {
  return Object.entries(query ?? {})
    .filter(([, value]) => value !== null && value !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
}

export function getDashboardAnalyticsCacheKey(query?: AnalyticsQuery) {
  return `dashboard:${JSON.stringify(normalizedQueryEntries(query))}`
}

export function readCachedDashboardAnalytics(query?: AnalyticsQuery) {
  const cacheKey = getDashboardAnalyticsCacheKey(query)
  const cachedEntry = readBoundedCache(dashboardAnalyticsCache, cacheKey)

  if (!cachedEntry) {
    return null
  }

  if (Date.now() - cachedEntry.cachedAt > DASHBOARD_ANALYTICS_CACHE_TTL_MS) {
    dashboardAnalyticsCache.delete(cacheKey)
    return null
  }

  return cachedEntry.payload
}

function writeDashboardAnalyticsCache(query: AnalyticsQuery | undefined, payload: DashboardAnalyticsPayload) {
  writeBoundedCache(
    dashboardAnalyticsCache,
    getDashboardAnalyticsCacheKey(query),
    { payload, cachedAt: Date.now() },
    DASHBOARD_ANALYTICS_CACHE_MAX_ENTRIES,
  )
}

export function clearDashboardAnalyticsCache() {
  dashboardAnalyticsCache.clear()
  dashboardAnalyticsRequests.clear()
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

export function fetchAndCacheDashboardAnalytics(
  client: LaravelApiClient,
  query?: AnalyticsQuery,
) {
  const cacheKey = getDashboardAnalyticsCacheKey(query)
  const inFlightRequest = dashboardAnalyticsRequests.get(cacheKey)

  if (inFlightRequest) {
    return inFlightRequest
  }

  const request = fetchDashboardAnalytics(client, query)
    .then((payload) => {
      writeDashboardAnalyticsCache(query, payload)
      return payload
    })
    .finally(() => {
      dashboardAnalyticsRequests.delete(cacheKey)
    })

  dashboardAnalyticsRequests.set(cacheKey, request)
  return request
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

export async function queueFullHistoryAnalyticsExport(client: LaravelApiClient) {
  const payload = await client.post<{ data: AnalyticsExportRecord }>(
    '/api/analytics/exports',
    { format: 'csv' },
  )

  return payload.data
}

export async function fetchAnalyticsExports(client: LaravelApiClient) {
  const payload = await client.get<{ data: AnalyticsExportRecord[] }>(
    '/api/analytics/exports',
  )

  return payload.data
}
