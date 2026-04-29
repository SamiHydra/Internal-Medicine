import { parseISO } from 'date-fns'

import { departments, departmentMap, reportTemplates, templateMap } from '@/config/templates'
import { getDeadlineForPeriod, isPastDeadline } from '@/lib/dates'
import { computeWeeklyValue, getNumericTotal } from '@/lib/metrics'
import { formatDelta } from '@/lib/utils'
import type {
  AppState,
  Department,
  ReportFamily,
  ReportRecord,
  ReportStatus,
  ReportingPeriod,
} from '@/types/domain'

const liveReportingStartDate = parseISO('2026-03-02T00:00:00.000Z')

export type ReportingTimeRange = 'current' | 'last4' | 'last8' | 'all'
export type DashboardTrendScale = 'weekly' | 'monthly'

export const ALL_INPATIENT_AVERAGE = 'all_inpatient_average'
export const ALL_INPATIENT_POOLED = 'all_inpatient_pooled'
export const ALL_OUTPATIENT_AVERAGE = 'all_outpatient_average'
export const ALL_PROCEDURE_SERVICES_TOTAL = 'all_procedure_services_total'
export const OUTPATIENT_AVAILABILITY_STATUSES = [
  { key: 'fullDay', label: 'Full day' },
  { key: 'partialDay', label: 'Partial day' },
  { key: 'unavailable', label: 'Unavailable' },
] as const
export const PROCEDURE_SERVICE_DEFINITIONS = [
  {
    id: 'eeg_lab',
    label: 'EEG Lab',
    departmentId: 'eeg_lab',
    metricLabel: 'EEG done',
    fieldIds: ['eeg_done'],
  },
  {
    id: 'echocardiography_lab',
    label: 'Echocardiography Lab',
    departmentId: 'echocardiography_lab',
    metricLabel: 'Echo + ECG',
    fieldIds: ['echo_done', 'ecg_done'],
  },
  {
    id: 'endoscopy_lab',
    label: 'Endoscopy Lab',
    departmentId: 'endoscopy_lab',
    metricLabel: 'Endoscopy total',
    fieldIds: [
      'upper_gi_elective',
      'upper_gi_emergency',
      'ercp',
      'colonoscopy',
      'proctoscopy',
      'bronchoscopy',
      'therapeutic_upper_gi',
      'esophageal_dilation',
      'variceal_ligation',
      'stenting',
      'liver_biopsy',
    ],
  },
  {
    id: 'hematology_procedures',
    label: 'Hematology Procedures',
    departmentId: 'hematology_procedures',
    metricLabel: 'Bone marrow biopsy',
    fieldIds: ['bone_marrow_biopsy'],
  },
  {
    id: 'bronchoscopy_lab',
    label: 'Bronchoscopy Lab',
    departmentId: 'bronchoscopy_lab',
    metricLabel: 'Bronchoscopy done',
    fieldIds: ['bronchoscopy_done'],
  },
  {
    id: 'renal_procedures',
    label: 'Renal Procedures',
    departmentId: 'renal_procedures',
    metricLabel: 'Renal procedure total',
    fieldIds: ['elective_renal_biopsy', 'central_venous_catheter_insertion'],
  },
  {
    id: 'dialysis_unit',
    label: 'Dialysis',
    departmentId: 'dialysis_unit',
    metricLabel: 'Acute + chronic HD',
    fieldIds: ['dialysis_acute', 'dialysis_chronic'],
  },
] as const
export const PROCEDURE_DIALYSIS_MIX_DEFINITIONS = [
  { key: 'acuteHd', label: 'Acute HD', fieldIds: ['dialysis_acute'] },
  { key: 'chronicHd', label: 'Chronic HD', fieldIds: ['dialysis_chronic'] },
] as const
export const PROCEDURE_ENDOSCOPY_MIX_DEFINITIONS = [
  { key: 'ugi', label: 'UGI', fieldIds: ['upper_gi_elective', 'upper_gi_emergency'] },
  { key: 'ercp', label: 'ERCP', fieldIds: ['ercp'] },
  { key: 'colonoscopy', label: 'Colonoscopy', fieldIds: ['colonoscopy'] },
  { key: 'bronchoscopy', label: 'Bronchoscopy', fieldIds: ['bronchoscopy'] },
  { key: 'ligation', label: 'Ligation', fieldIds: ['variceal_ligation'] },
] as const

export type DashboardTrendBucketInput = {
  key: string
  label: string
  periods: ReportingPeriod[]
  periodIds: Set<string>
}

export type InpatientCountMetricDefinition = {
  key: string
  fieldIds: readonly string[]
}

export type OutpatientMetricDefinition = {
  key: string
  fieldId: string
  valueType: 'sum' | 'average' | 'timeAverage'
}

export type OutpatientAvailabilityStatusKey =
  (typeof OUTPATIENT_AVAILABILITY_STATUSES)[number]['key']

export type OutpatientAvailabilityPoint = {
  key?: string
  label: string
  monthKey?: string
  monthLabel?: string
  departmentId?: string
  departmentName?: string
  total: number
} & Record<OutpatientAvailabilityStatusKey, number>

export type ProcedureServiceDefinition = (typeof PROCEDURE_SERVICE_DEFINITIONS)[number]

export type ProcedureServicePoint = {
  key?: string
  label: string
  monthKey?: string
  monthLabel?: string
  serviceId: string
  serviceName: string
  metricLabel: string
  fieldIds: string
  total: number
}

export type ProcedureMixPoint = {
  key: string
  label: string
  value: number
  fieldIds: string
  monthKey?: string
  monthLabel?: string
}

export type NumericDashboardPoint = {
  label: string
  [key: string]: string | number | null
}

export function getSortedReportingPeriods(state: AppState) {
  return [...state.reportingPeriods]
    .filter(
      (period) => parseISO(period.weekStart).getTime() >= liveReportingStartDate.getTime(),
    )
    .sort(
      (left, right) =>
        parseISO(left.weekStart).getTime() - parseISO(right.weekStart).getTime(),
    )
}

export function getCurrentUser(state: AppState) {
  return state.profiles.find((profile) => profile.id === state.currentUserId) ?? null
}

export function getCurrentPeriod(state: AppState) {
  const reportingPeriods = getSortedReportingPeriods(state)

  if (!reportingPeriods.length) {
    return null
  }

  const referenceDate = new Date()
  const currentPeriod =
    reportingPeriods
      .filter((period) => parseISO(period.weekStart).getTime() <= referenceDate.getTime())
      .at(-1) ?? reportingPeriods[0]

  return currentPeriod
}

export function getVisibleReportingPeriods(state: AppState) {
  const currentPeriod = getCurrentPeriod(state)
  const reportingPeriods = getSortedReportingPeriods(state)

  if (!currentPeriod) {
    return []
  }

  const currentPeriodStart = parseISO(currentPeriod.weekStart).getTime()

  return reportingPeriods.filter(
    (period) => parseISO(period.weekStart).getTime() <= currentPeriodStart,
  )
}

export function getPreviousPeriod(state: AppState) {
  const currentPeriod = getCurrentPeriod(state)
  const reportingPeriods = getVisibleReportingPeriods(state)

  if (!currentPeriod) {
    return null
  }

  const currentPeriodIndex = reportingPeriods.findIndex(
    (period) => period.id === currentPeriod.id,
  )

  return currentPeriodIndex > 0 ? reportingPeriods[currentPeriodIndex - 1] : null
}

export function getCurrentAndPreviousPeriods(state: AppState) {
  return getReportingPeriodsBackwards(state, 2)
}

export function getReportingPeriodsBackwards(
  state: AppState,
  periodCount = 4,
  startPeriodId = getCurrentPeriod(state)?.id,
) {
  const reportingPeriods = getVisibleReportingPeriods(state)
  const startIndex = startPeriodId
    ? reportingPeriods.findIndex((period) => period.id === startPeriodId)
    : -1

  if (startIndex >= 0) {
    const startSlice = Math.max(0, startIndex - periodCount + 1)
    return reportingPeriods.slice(startSlice, startIndex + 1).reverse()
  }

  return reportingPeriods.slice(-periodCount).reverse()
}

export function getReportingPeriodsForRange(
  state: AppState,
  range: ReportingTimeRange,
  anchorPeriodId = getCurrentPeriod(state)?.id,
) {
  const reportingPeriods = getVisibleReportingPeriods(state)

  if (!reportingPeriods.length) {
    return []
  }

  const anchorIndex = anchorPeriodId
    ? reportingPeriods.findIndex((period) => period.id === anchorPeriodId)
    : -1
  const boundedAnchorIndex = anchorIndex >= 0 ? anchorIndex : reportingPeriods.length - 1
  const periodsThroughAnchor = reportingPeriods.slice(0, boundedAnchorIndex + 1)

  if (range === 'all') {
    return periodsThroughAnchor
  }

  const periodCount = range === 'last8' ? 8 : range === 'last4' ? 4 : 1
  return periodsThroughAnchor.slice(-periodCount)
}

export function getProfileById(state: AppState, userId: string) {
  return state.profiles.find((profile) => profile.id === userId) ?? null
}

export function getReportForAssignmentPeriod(
  state: AppState,
  assignmentId: string,
  reportingPeriodId: string,
) {
  return (
    state.reports.find(
      (report) =>
        report.assignmentId === assignmentId &&
        report.reportingPeriodId === reportingPeriodId,
    ) ?? null
  )
}

function deriveReportStatusForPeriod(
  period: AppState['reportingPeriods'][number] | null,
  state: Pick<AppState, 'settings'>,
  report: ReportRecord | null,
) {
  if (!period) {
    return 'not_started' as ReportStatus
  }

  const deadlinePassed = state.settings.deadlineEnforced
    ? isPastDeadline(
        period,
        state.settings.weeklyDeadlineDay,
        state.settings.weeklyDeadlineTime,
      )
    : false

  if (!report) {
    return deadlinePassed ? 'overdue' : 'not_started'
  }

  if (report.lockedAt || report.status === 'locked') {
    return 'locked'
  }

  if (report.status === 'draft' && deadlinePassed) {
    return 'overdue'
  }

  return report.status
}

function isMissingSummaryStatus(status: ReportStatus) {
  return status === 'not_started' || status === 'overdue'
}

const emptyStatusCounts: Record<ReportStatus, number> = {
  not_started: 0,
  draft: 0,
  submitted: 0,
  edited_after_submission: 0,
  locked: 0,
  overdue: 0,
}

function getScopedAssignments(state: AppState, family?: ReportFamily) {
  const scopedDepartments = departments.filter((department) =>
    family ? department.family === family : true,
  )
  const scopedDepartmentIds = new Set(scopedDepartments.map((department) => department.id))

  return state.assignments.filter(
    (assignment) => assignment.active && scopedDepartmentIds.has(assignment.departmentId),
  )
}

function createReportLookup(reports: ReportRecord[]) {
  const reportsByAssignmentPeriod = new Map<string, ReportRecord>()

  reports.forEach((report) => {
    reportsByAssignmentPeriod.set(`${report.assignmentId}:${report.reportingPeriodId}`, report)
  })

  return reportsByAssignmentPeriod
}

function getRangeStatusEntries(
  state: AppState,
  periods: ReportingPeriod[],
  family?: ReportFamily,
) {
  const scopedAssignments = getScopedAssignments(state, family)
  const reportsByAssignmentPeriod = createReportLookup(state.reports)

  return scopedAssignments.flatMap((assignment) =>
    periods.map((period) => {
      const report = reportsByAssignmentPeriod.get(`${assignment.id}:${period.id}`) ?? null

      return {
        assignment,
        period,
        report,
        status: deriveReportStatusForPeriod(period, state, report),
      }
    }),
  )
}

export function getReportingRangeSummary(
  state: AppState,
  range: ReportingTimeRange,
  anchorPeriodId = getCurrentPeriod(state)?.id,
  family?: ReportFamily,
) {
  const periods = getReportingPeriodsForRange(state, range, anchorPeriodId)

  if (!periods.length) {
    return null
  }

  const statusEntries = getRangeStatusEntries(state, periods, family)
  const statusCounts = statusEntries.reduce<Record<ReportStatus, number>>(
    (counts, entry) => ({
      ...counts,
      [entry.status]: counts[entry.status] + 1,
    }),
    { ...emptyStatusCounts },
  )

  return {
    periods,
    entries: statusEntries,
    statusCounts,
    metrics: {
      totalExpected: statusEntries.length,
      submitted: statusCounts.submitted,
      missing: statusCounts.not_started + statusCounts.overdue,
      editedAfterSubmission: statusCounts.edited_after_submission,
      locked: statusCounts.locked,
      unlocked: statusEntries.filter((entry) => entry.report && entry.status !== 'locked').length,
      draft: statusCounts.draft,
      notStarted: statusCounts.not_started,
      overdue: statusCounts.overdue,
    },
  }
}

export function deriveReportStatus(
  state: AppState,
  periodId: string,
  report: ReportRecord | null,
) {
  const period = state.reportingPeriods.find((candidate) => candidate.id === periodId)
  return deriveReportStatusForPeriod(period ?? null, state, report)
}

export function getAssignmentsForUser(state: AppState, userId: string) {
  return state.assignments.filter(
    (assignment) => assignment.nurseId === userId && assignment.active,
  )
}

export function getAssignmentCardsForPeriod(
  state: AppState,
  userId: string,
  periodId: string,
) {
  const period = getSortedReportingPeriods(state).find((candidate) => candidate.id === periodId)

  if (!period) {
    return []
  }

  return getAssignmentsForUser(state, userId)
    .map((assignment) => {
      const report = getReportForAssignmentPeriod(state, assignment.id, period.id)
      const department = departmentMap[assignment.departmentId]
      const template = templateMap[assignment.templateId]

      return {
        assignment,
        department,
        template,
        period,
        report,
        status: deriveReportStatus(state, period.id, report),
        updatedAt: report?.updatedAt ?? period.weekStart,
      }
    })
    .sort((left, right) => left.department.name.localeCompare(right.department.name))
}

export function getCurrentWeekAssignmentCards(state: AppState, userId: string) {
  const currentPeriod = getCurrentPeriod(state)

  if (!currentPeriod) {
    return []
  }

  return getAssignmentCardsForPeriod(state, userId, currentPeriod.id)
}

function sumField(report: ReportRecord, fieldId: string) {
  return getNumericTotal(report.values[fieldId]?.dailyValues ?? {})
}

function sumReportFieldTotals(reports: ReportRecord[], fieldIds: readonly string[]) {
  return reports.reduce(
    (total, report) =>
      total + fieldIds.reduce((fieldTotal, fieldId) => fieldTotal + sumField(report, fieldId), 0),
    0,
  )
}

function getReportWeeklyFieldValue(report: ReportRecord, fieldId: string) {
  const field = templateMap[report.templateId]?.fields.find((item) => item.id === fieldId)

  if (!field) {
    return null
  }

  return computeWeeklyValue(field, report.values[fieldId]?.dailyValues ?? {})
}

function parseTimeToMinutes(value: string | null | undefined) {
  if (!value) {
    return null
  }

  const match = value.match(/^(\d{1,2}):(\d{2})/)
  if (!match) {
    return null
  }

  const hours = Number(match[1])
  const minutes = Number(match[2])

  if (Number.isNaN(hours) || Number.isNaN(minutes)) {
    return null
  }

  return hours * 60 + minutes
}

function getInpatientDepartments() {
  return departments.filter((department) => department.family === 'inpatient')
}

function getOutpatientDepartments() {
  return departments.filter((department) => department.family === 'outpatient')
}

function getProcedureDepartments() {
  return departments.filter((department) => department.family === 'procedure')
}

function getBucketDepartmentReports(
  state: AppState,
  bucket: DashboardTrendBucketInput,
  departmentId: string,
) {
  return state.reports.filter(
    (report) =>
      bucket.periodIds.has(report.reportingPeriodId) &&
      report.departmentId === departmentId &&
      departmentMap[report.departmentId]?.family === 'inpatient',
  )
}

function getBucketOutpatientDepartmentReports(
  state: AppState,
  bucket: DashboardTrendBucketInput,
  departmentId: string,
) {
  return state.reports.filter(
    (report) =>
      bucket.periodIds.has(report.reportingPeriodId) &&
      report.departmentId === departmentId &&
      departmentMap[report.departmentId]?.family === 'outpatient',
  )
}

function getBucketProcedureDepartmentReports(
  state: AppState,
  bucket: DashboardTrendBucketInput,
  departmentId: string,
) {
  return state.reports.filter(
    (report) =>
      bucket.periodIds.has(report.reportingPeriodId) &&
      report.departmentId === departmentId &&
      departmentMap[report.departmentId]?.family === 'procedure',
  )
}

function getProcedureServiceDefinition(serviceId: string) {
  return PROCEDURE_SERVICE_DEFINITIONS.find((service) => service.id === serviceId) ?? null
}

function getDepartmentsWithInpatientReports(
  state: AppState,
  buckets: readonly DashboardTrendBucketInput[],
) {
  const selectedPeriodIds = new Set(buckets.flatMap((bucket) => [...bucket.periodIds]))

  return getInpatientDepartments().filter((department) =>
    state.reports.some(
      (report) =>
        selectedPeriodIds.has(report.reportingPeriodId) &&
        report.departmentId === department.id,
    ),
  )
}

function getDepartmentsWithOutpatientReports(
  state: AppState,
  buckets: readonly DashboardTrendBucketInput[],
) {
  const selectedPeriodIds = new Set(buckets.flatMap((bucket) => [...bucket.periodIds]))

  return getOutpatientDepartments().filter((department) =>
    state.reports.some(
      (report) =>
        selectedPeriodIds.has(report.reportingPeriodId) &&
        report.departmentId === department.id,
    ),
  )
}

function getMonthDayCount(bucket: DashboardTrendBucketInput) {
  const [year, month] = bucket.key.split('-').map(Number)

  if (Number.isInteger(year) && Number.isInteger(month) && month >= 1 && month <= 12) {
    return new Date(year, month, 0).getDate()
  }

  return Math.max(bucket.periods.length * 7, 1)
}

export function getLatestDashboardTrendBucketKey(
  buckets: readonly DashboardTrendBucketInput[],
) {
  return buckets.at(-1)?.key ?? ''
}

export function resolveDashboardTrendBucket(
  buckets: readonly DashboardTrendBucketInput[],
  selectedBucketKey: string,
) {
  return (
    buckets.find((bucket) => bucket.key === selectedBucketKey) ??
    buckets.at(-1) ??
    null
  )
}

function getTotalDischarges(reports: ReportRecord[]) {
  return sumReportFieldTotals(reports, ['discharged_home', 'discharged_ama'])
}

function getTotalPatientDays(reports: ReportRecord[]) {
  return sumReportFieldTotals(reports, ['total_patient_days'])
}

function buildInpatientCountPoint(
  state: AppState,
  bucket: DashboardTrendBucketInput,
  metrics: readonly InpatientCountMetricDefinition[],
  departmentId: string,
) {
  const reports = getBucketDepartmentReports(state, bucket, departmentId)

  return Object.fromEntries(
    metrics.map((metric) => [metric.key, sumReportFieldTotals(reports, metric.fieldIds)]),
  ) as Record<string, number>
}

function averageValues(values: readonly number[]) {
  if (!values.length) {
    return null
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function getOutpatientMetricValue(
  reports: ReportRecord[],
  metric: OutpatientMetricDefinition,
) {
  if (metric.valueType === 'sum') {
    return reports.reduce((sum, report) => {
      const value = getReportWeeklyFieldValue(report, metric.fieldId)

      return sum + (typeof value === 'number' && !Number.isNaN(value) ? value : 0)
    }, 0)
  }

  const values = reports
    .map((report) => {
      const value = getReportWeeklyFieldValue(report, metric.fieldId)

      if (metric.valueType === 'timeAverage') {
        return parseTimeToMinutes(value as string | null)
      }

      return typeof value === 'number' && !Number.isNaN(value) ? value : null
    })
    .filter((value): value is number => value !== null)

  return averageValues(values)
}

function buildOutpatientMetricPoint(
  state: AppState,
  bucket: DashboardTrendBucketInput,
  metrics: readonly OutpatientMetricDefinition[],
  departmentId: string,
) {
  const reports = getBucketOutpatientDepartmentReports(state, bucket, departmentId)

  return Object.fromEntries(
    metrics.map((metric) => [metric.key, getOutpatientMetricValue(reports, metric)]),
  ) as Record<string, number | null>
}

function getEmptyOutpatientAvailabilityCounts() {
  return Object.fromEntries(
    OUTPATIENT_AVAILABILITY_STATUSES.map((status) => [status.key, 0]),
  ) as Record<OutpatientAvailabilityStatusKey, number>
}

function getOutpatientAvailabilityCounts(reports: ReportRecord[]) {
  return reports.reduce(
    (counts, report) => {
      const value = getReportWeeklyFieldValue(report, 'senior_physician_availability')
      const status = OUTPATIENT_AVAILABILITY_STATUSES.find((item) => item.label === value)

      if (!status) {
        return counts
      }

      return {
        ...counts,
        [status.key]: counts[status.key] + 1,
        total: counts.total + 1,
      }
    },
    {
      ...getEmptyOutpatientAvailabilityCounts(),
      total: 0,
    },
  )
}

function getBucketOutpatientReports(
  state: AppState,
  bucket: DashboardTrendBucketInput,
  outpatientDepartments: readonly Department[],
) {
  return outpatientDepartments.flatMap((department) =>
    getBucketOutpatientDepartmentReports(state, bucket, department.id),
  )
}

export function getOutpatientWeeklyAvailabilitySeries(
  state: AppState,
  buckets: readonly DashboardTrendBucketInput[],
  scope: string,
): OutpatientAvailabilityPoint[] {
  const outpatientDepartments = getOutpatientDepartments()

  return buckets.map((bucket) => {
    const reports =
      scope === ALL_OUTPATIENT_AVERAGE
        ? getBucketOutpatientReports(state, bucket, outpatientDepartments)
        : getBucketOutpatientDepartmentReports(state, bucket, scope)

    return {
      label: bucket.label,
      ...getOutpatientAvailabilityCounts(reports),
    }
  })
}

function getConfiguredProcedureServices() {
  const procedureDepartmentIds = new Set(getProcedureDepartments().map((department) => department.id))

  return PROCEDURE_SERVICE_DEFINITIONS.filter((service) =>
    procedureDepartmentIds.has(service.departmentId),
  )
}

function getProcedureServiceTotal(
  state: AppState,
  bucket: DashboardTrendBucketInput,
  service: ProcedureServiceDefinition,
) {
  return sumReportFieldTotals(
    getBucketProcedureDepartmentReports(state, bucket, service.departmentId),
    service.fieldIds,
  )
}

function buildProcedureServicePoint(
  state: AppState,
  bucket: DashboardTrendBucketInput,
  service: ProcedureServiceDefinition,
): ProcedureServicePoint {
  return {
    key: `${bucket.key}:${service.id}`,
    label: bucket.label,
    serviceId: service.id,
    serviceName: service.label,
    metricLabel: service.metricLabel,
    fieldIds: service.fieldIds.join(', '),
    total: getProcedureServiceTotal(state, bucket, service),
  }
}

function buildProcedureMonthlyServicePoint(
  state: AppState,
  bucket: DashboardTrendBucketInput,
  service: ProcedureServiceDefinition,
): ProcedureServicePoint {
  return {
    key: `${bucket.key}:${service.id}`,
    label: service.label,
    monthKey: bucket.key,
    monthLabel: bucket.label,
    serviceId: service.id,
    serviceName: service.label,
    metricLabel: service.metricLabel,
    fieldIds: service.fieldIds.join(', '),
    total: getProcedureServiceTotal(state, bucket, service),
  }
}

function getProcedureBucketsTotal(
  state: AppState,
  buckets: readonly DashboardTrendBucketInput[],
) {
  const services = getConfiguredProcedureServices()

  return buckets.reduce(
    (sum, bucket) =>
      sum + services.reduce(
        (serviceSum, service) => serviceSum + getProcedureServiceTotal(state, bucket, service),
        0,
      ),
    0,
  )
}

export function getProcedureWeeklyTrendSeries(
  state: AppState,
  buckets: readonly DashboardTrendBucketInput[],
  scope: string,
): ProcedureServicePoint[] {
  const selectedService = getProcedureServiceDefinition(scope)

  if (selectedService) {
    return buckets.map((bucket) => buildProcedureServicePoint(state, bucket, selectedService))
  }

  return buckets.map((bucket) => ({
    key: `${bucket.key}:${ALL_PROCEDURE_SERVICES_TOTAL}`,
    label: bucket.label,
    serviceId: ALL_PROCEDURE_SERVICES_TOTAL,
    serviceName: 'All procedure services total',
    metricLabel: 'Total throughput',
    fieldIds: getConfiguredProcedureServices()
      .flatMap((service) => service.fieldIds)
      .join(', '),
    total: getProcedureBucketsTotal(state, [bucket]),
  }))
}

export function getProcedureMonthlyServiceComparisonData(
  state: AppState,
  buckets: readonly DashboardTrendBucketInput[],
  selectedMonthKey = getLatestDashboardTrendBucketKey(buckets),
): ProcedureServicePoint[] {
  const selectedBucket = resolveDashboardTrendBucket(buckets, selectedMonthKey)

  if (!selectedBucket) {
    return []
  }

  return getConfiguredProcedureServices().map((service) =>
    buildProcedureMonthlyServicePoint(state, selectedBucket, service),
  )
}

export function getProcedureTotalThroughput(
  state: AppState,
  buckets: readonly DashboardTrendBucketInput[],
) {
  return getProcedureBucketsTotal(state, buckets)
}

function getProcedureServiceBuckets(
  buckets: readonly DashboardTrendBucketInput[],
  selectedMonthKey?: string,
) {
  if (!selectedMonthKey) {
    return buckets
  }

  const selectedBucket = resolveDashboardTrendBucket(buckets, selectedMonthKey)

  return selectedBucket ? [selectedBucket] : []
}

function buildProcedureMixData(
  state: AppState,
  buckets: readonly DashboardTrendBucketInput[],
  departmentId: string,
  definitions: readonly { key: string; label: string; fieldIds: readonly string[] }[],
  selectedMonthKey?: string,
): ProcedureMixPoint[] {
  const scopedBuckets = getProcedureServiceBuckets(buckets, selectedMonthKey)
  const selectedBucket = selectedMonthKey
    ? resolveDashboardTrendBucket(buckets, selectedMonthKey)
    : null

  return definitions.map((definition) => ({
    key: definition.key,
    label: definition.label,
    value: scopedBuckets.reduce(
      (sum, bucket) =>
        sum +
        sumReportFieldTotals(
          getBucketProcedureDepartmentReports(state, bucket, departmentId),
          definition.fieldIds,
        ),
      0,
    ),
    fieldIds: definition.fieldIds.join(', '),
    monthKey: selectedBucket?.key,
    monthLabel: selectedBucket?.label,
  }))
}

export function getProcedureDialysisSplitData(
  state: AppState,
  buckets: readonly DashboardTrendBucketInput[],
  selectedMonthKey?: string,
) {
  return buildProcedureMixData(
    state,
    buckets,
    'dialysis_unit',
    PROCEDURE_DIALYSIS_MIX_DEFINITIONS,
    selectedMonthKey,
  )
}

export function getProcedureEndoscopyMixData(
  state: AppState,
  buckets: readonly DashboardTrendBucketInput[],
  selectedMonthKey?: string,
) {
  return buildProcedureMixData(
    state,
    buckets,
    'endoscopy_lab',
    PROCEDURE_ENDOSCOPY_MIX_DEFINITIONS,
    selectedMonthKey,
  )
}

export function getInpatientWeeklyCountTrendSeries(
  state: AppState,
  buckets: readonly DashboardTrendBucketInput[],
  metrics: readonly InpatientCountMetricDefinition[],
  scope: string,
): NumericDashboardPoint[] {
  const inpatientDepartments = getInpatientDepartments()

  return buckets.map((bucket) => {
    if (scope !== ALL_INPATIENT_AVERAGE) {
      return {
        label: bucket.label,
        ...buildInpatientCountPoint(state, bucket, metrics, scope),
      }
    }

    const eligibleDepartments = inpatientDepartments.filter(
      (department) => getBucketDepartmentReports(state, bucket, department.id).length > 0,
    )

    return {
      label: bucket.label,
      ...Object.fromEntries(
        metrics.map((metric) => {
          if (!eligibleDepartments.length) {
            return [metric.key, 0]
          }

          const total = eligibleDepartments.reduce(
            (sum, department) =>
              sum +
              sumReportFieldTotals(
                getBucketDepartmentReports(state, bucket, department.id),
                metric.fieldIds,
              ),
            0,
          )

          return [metric.key, total / eligibleDepartments.length]
        }),
      ),
    }
  })
}

export function getOutpatientWeeklyTrendSeries(
  state: AppState,
  buckets: readonly DashboardTrendBucketInput[],
  metrics: readonly OutpatientMetricDefinition[],
  scope: string,
): NumericDashboardPoint[] {
  const outpatientDepartments = getOutpatientDepartments()

  return buckets.map((bucket) => {
    if (scope !== ALL_OUTPATIENT_AVERAGE) {
      return {
        label: bucket.label,
        ...buildOutpatientMetricPoint(state, bucket, metrics, scope),
      }
    }

    const eligibleDepartments = outpatientDepartments.filter(
      (department) =>
        getBucketOutpatientDepartmentReports(state, bucket, department.id).length > 0,
    )

    return {
      label: bucket.label,
      ...Object.fromEntries(
        metrics.map((metric) => {
          if (!eligibleDepartments.length) {
            return [metric.key, metric.valueType === 'sum' ? 0 : null]
          }

          const values = eligibleDepartments
            .map((department) =>
              getOutpatientMetricValue(
                getBucketOutpatientDepartmentReports(state, bucket, department.id),
                metric,
              ),
            )
            .filter((value): value is number => typeof value === 'number')

          return [
            metric.key,
            values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null,
          ]
        }),
      ),
    }
  })
}

export function getInpatientMonthlyWardComparisonData(
  state: AppState,
  buckets: readonly DashboardTrendBucketInput[],
  metrics: readonly InpatientCountMetricDefinition[],
  selectedMonthKey = getLatestDashboardTrendBucketKey(buckets),
): NumericDashboardPoint[] {
  const selectedBucket = resolveDashboardTrendBucket(buckets, selectedMonthKey)

  if (!selectedBucket) {
    return []
  }

  const departmentsWithData = getDepartmentsWithInpatientReports(state, [selectedBucket])

  return departmentsWithData.map((department) => ({
    key: `${selectedBucket.key}:${department.id}`,
    label: department.name,
    monthKey: selectedBucket.key,
    monthLabel: selectedBucket.label,
    departmentId: department.id,
    departmentName: department.name,
    ...buildInpatientCountPoint(state, selectedBucket, metrics, department.id),
  }))
}

export function getOutpatientMonthlyDepartmentComparisonData(
  state: AppState,
  buckets: readonly DashboardTrendBucketInput[],
  metrics: readonly OutpatientMetricDefinition[],
  selectedMonthKey = getLatestDashboardTrendBucketKey(buckets),
): NumericDashboardPoint[] {
  const selectedBucket = resolveDashboardTrendBucket(buckets, selectedMonthKey)

  if (!selectedBucket) {
    return []
  }

  const departmentsWithData = getDepartmentsWithOutpatientReports(state, [selectedBucket])

  return departmentsWithData.map((department) => ({
    key: `${selectedBucket.key}:${department.id}`,
    label: department.name,
    monthKey: selectedBucket.key,
    monthLabel: selectedBucket.label,
    departmentId: department.id,
    departmentName: department.name,
    ...buildOutpatientMetricPoint(state, selectedBucket, metrics, department.id),
  }))
}

export function getOutpatientMonthlyAvailabilityDepartmentComparisonData(
  state: AppState,
  buckets: readonly DashboardTrendBucketInput[],
  selectedMonthKey = getLatestDashboardTrendBucketKey(buckets),
): OutpatientAvailabilityPoint[] {
  const selectedBucket = resolveDashboardTrendBucket(buckets, selectedMonthKey)

  if (!selectedBucket) {
    return []
  }

  const departmentsWithData = getDepartmentsWithOutpatientReports(state, [selectedBucket])

  return departmentsWithData.map((department) => ({
    key: `${selectedBucket.key}:${department.id}`,
    label: department.name,
    monthKey: selectedBucket.key,
    monthLabel: selectedBucket.label,
    departmentId: department.id,
    departmentName: department.name,
    ...getOutpatientAvailabilityCounts(
      getBucketOutpatientDepartmentReports(state, selectedBucket, department.id),
    ),
  }))
}

// Capacity metrics intentionally exclude inpatient departments without a usable bed count.
// Transition currently has no bedCount, so it can contribute to count/event charts but not
// to BOR/BTR denominator math until capacity data exists.
function getCapacityEligibleInpatientDepartments() {
  return getInpatientDepartments().filter(
    (department) => typeof department.bedCount === 'number' && department.bedCount > 0,
  )
}

function calculateInpatientOccupancyPoint(
  label: string,
  reports: ReportRecord[],
  totalBeds: number,
  coveredDays: number,
): NumericDashboardPoint {
  const totalPatientDays = getTotalPatientDays(reports)
  const totalDischarges = getTotalDischarges(reports)

  return {
    label,
    bor: totalBeds ? (totalPatientDays / (totalBeds * coveredDays)) * 100 : null,
    btr: totalBeds ? totalDischarges / totalBeds : null,
    alos: totalDischarges ? totalPatientDays / totalDischarges : null,
  }
}

export function getInpatientMonthlyOccupancySeries(
  state: AppState,
  buckets: readonly DashboardTrendBucketInput[],
  scope: string,
): NumericDashboardPoint[] {
  return buckets.map((bucket) => {
    const coveredDays = getMonthDayCount(bucket)

    if (scope !== ALL_INPATIENT_POOLED) {
      const department = departmentMap[scope]
      const bedCount = department?.family === 'inpatient' ? department.bedCount ?? 0 : 0

      if (!bedCount) {
        return {
          label: bucket.label,
          bor: null,
          btr: null,
          alos: null,
        }
      }

      return calculateInpatientOccupancyPoint(
        bucket.label,
        getBucketDepartmentReports(state, bucket, scope),
        bedCount,
        coveredDays,
      )
    }

    const eligibleDepartments = getCapacityEligibleInpatientDepartments()
    const eligibleDepartmentIds = new Set(eligibleDepartments.map((department) => department.id))
    const totalBeds = eligibleDepartments.reduce(
      (sum, department) => sum + (department.bedCount ?? 0),
      0,
    )
    const reports = state.reports.filter(
      (report) =>
        bucket.periodIds.has(report.reportingPeriodId) &&
        eligibleDepartmentIds.has(report.departmentId),
    )

    return calculateInpatientOccupancyPoint(bucket.label, reports, totalBeds, coveredDays)
  })
}

export function shouldShowInpatientOccupancyAnalytics(trendScale: DashboardTrendScale) {
  return trendScale === 'monthly'
}

function aggregateInpatientMetrics(reports: ReportRecord[], departmentsList: Department[]) {
  const totalPatientDays = reports.reduce(
    (sum, report) => sum + sumField(report, 'total_patient_days'),
    0,
  )
  const totalDischarges = reports.reduce(
    (sum, report) => sum + sumField(report, 'discharged_home') + sumField(report, 'discharged_ama'),
    0,
  )
  const totalBeds = departmentsList.reduce((sum, department) => sum + (department.bedCount ?? 0), 0)

  return {
    borPercent: totalBeds ? (totalPatientDays / (totalBeds * 30)) * 100 : null,
    btr: totalBeds ? totalDischarges / totalBeds : null,
    alos: totalDischarges ? totalPatientDays / totalDischarges : null,
  }
}

export function getDashboardSummary(
  state: AppState,
  periodId = getCurrentPeriod(state)?.id,
  family?: ReportFamily,
) {
  if (!periodId) {
    return null
  }

  const reportingPeriods = getSortedReportingPeriods(state)
  const period = reportingPeriods.find((candidate) => candidate.id === periodId)
  const previousPeriodIndex = reportingPeriods.findIndex(
    (candidate) => candidate.id === periodId,
  ) - 1
  const previousPeriod =
    previousPeriodIndex >= 0 ? reportingPeriods[previousPeriodIndex] : null

  if (!period) {
    return null
  }

  const scopedDepartments = departments.filter((department) =>
    family ? department.family === family : true,
  )
  const scopedDepartmentIds = new Set(scopedDepartments.map((department) => department.id))
  const scopedAssignments = state.assignments.filter((assignment) =>
    assignment.active && scopedDepartmentIds.has(assignment.departmentId),
  )
  const reportsByAssignmentPeriod = new Map<string, ReportRecord>()

  state.reports.forEach((report) => {
    reportsByAssignmentPeriod.set(`${report.assignmentId}:${report.reportingPeriodId}`, report)
  })

  const reportEntries = scopedAssignments.map((assignment) => {
    const report = reportsByAssignmentPeriod.get(`${assignment.id}:${period.id}`) ?? null
    return {
      assignment,
      report,
      status: deriveReportStatusForPeriod(period, state, report),
    }
  })

  const previousReports = previousPeriod
    ? scopedAssignments.map((assignment) => {
        const report =
          reportsByAssignmentPeriod.get(`${assignment.id}:${previousPeriod.id}`) ?? null
        return {
          assignment,
          report,
          status: deriveReportStatusForPeriod(previousPeriod, state, report),
        }
      })
    : []

  const currentReports = reportEntries
    .map((entry) => entry.report)
    .filter((report): report is ReportRecord => Boolean(report))
  const previousReportRecords = previousReports
    .map((entry) => entry.report)
    .filter((report): report is ReportRecord => Boolean(report))

  const currentInpatientDepartments = scopedDepartments.filter(
    (department) => department.family === 'inpatient',
  )
  const inpatientReports = currentReports.filter(
    (report) => departmentMap[report.departmentId].family === 'inpatient',
  )
  const previousInpatientReports = previousReports.filter(
    (entry) =>
      entry.report &&
      departmentMap[entry.report.departmentId].family === 'inpatient',
  )
    .map((entry) => entry.report)
    .filter((report): report is ReportRecord => Boolean(report))

  const inpatientMetrics = aggregateInpatientMetrics(
    inpatientReports,
    currentInpatientDepartments,
  )
  const previousInpatientMetrics = aggregateInpatientMetrics(
    previousInpatientReports,
    currentInpatientDepartments,
  )

  const metrics = {
    totalExpected: reportEntries.length,
    submitted: reportEntries.filter((entry) => entry.status === 'submitted').length,
    missing: reportEntries.filter((entry) => isMissingSummaryStatus(entry.status)).length,
    editedAfterSubmission: reportEntries.filter(
      (entry) => entry.status === 'edited_after_submission',
    ).length,
    locked: reportEntries.filter((entry) => entry.status === 'locked').length,
    unlocked: reportEntries.filter((entry) => entry.report && entry.status !== 'locked').length,
    borPercent: inpatientMetrics.borPercent,
    btr: inpatientMetrics.btr,
    alos: inpatientMetrics.alos,
    totalAdmissions: currentReports.reduce(
      (sum, report) =>
        sum +
        sumField(report, 'total_admitted_patients') +
        sumField(report, 'new_admitted_patients'),
      0,
    ),
    totalDischarges: currentReports.reduce(
      (sum, report) =>
        sum + sumField(report, 'discharged_home') + sumField(report, 'discharged_ama'),
      0,
    ),
    totalOutpatientVisits: currentReports.reduce(
      (sum, report) => sum + sumField(report, 'total_patients_seen'),
      0,
    ),
    noShowCount: currentReports.reduce(
      (sum, report) => sum + sumField(report, 'failed_to_come'),
      0,
    ),
    haiCount: currentReports.reduce((sum, report) => sum + sumField(report, 'total_hai'), 0),
  }

  const previousMetrics = {
    totalExpected: previousReports.length,
    submitted: previousReports.filter((entry) => entry.status === 'submitted').length,
    missing: previousReports.filter((entry) => isMissingSummaryStatus(entry.status)).length,
    editedAfterSubmission: previousReports.filter(
      (entry) => entry.status === 'edited_after_submission',
    ).length,
    locked: previousReports.filter((entry) => entry.status === 'locked').length,
    unlocked: previousReports.filter(
      (entry) => entry.report && entry.status !== 'locked',
    ).length,
    borPercent: previousInpatientMetrics.borPercent,
    btr: previousInpatientMetrics.btr,
    alos: previousInpatientMetrics.alos,
    totalAdmissions: previousReportRecords.reduce(
      (sum, report) =>
        sum +
        sumField(report, 'total_admitted_patients') +
        sumField(report, 'new_admitted_patients'),
      0,
    ),
    totalDischarges: previousReportRecords.reduce(
      (sum, report) =>
        sum + sumField(report, 'discharged_home') + sumField(report, 'discharged_ama'),
      0,
    ),
    totalOutpatientVisits: previousReportRecords.reduce(
      (sum, report) => sum + sumField(report, 'total_patients_seen'),
      0,
    ),
    noShowCount: previousReportRecords.reduce(
      (sum, report) => sum + sumField(report, 'failed_to_come'),
      0,
    ),
    haiCount: previousReportRecords.reduce(
      (sum, report) => sum + sumField(report, 'total_hai'),
      0,
    ),
  }

  return {
    period,
    current: metrics,
    previous: previousMetrics,
    deltas: {
      totalExpected: formatDelta(metrics.totalExpected, previousMetrics.totalExpected),
      submitted: formatDelta(metrics.submitted, previousMetrics.submitted),
      missing: formatDelta(metrics.missing, previousMetrics.missing),
      editedAfterSubmission: formatDelta(
        metrics.editedAfterSubmission,
        previousMetrics.editedAfterSubmission,
      ),
      locked: formatDelta(metrics.locked, previousMetrics.locked),
      unlocked: formatDelta(metrics.unlocked, previousMetrics.unlocked),
      borPercent: formatDelta(metrics.borPercent, previousMetrics.borPercent),
      btr: formatDelta(metrics.btr, previousMetrics.btr),
      alos: formatDelta(metrics.alos, previousMetrics.alos),
      totalAdmissions: formatDelta(metrics.totalAdmissions, previousMetrics.totalAdmissions),
      totalDischarges: formatDelta(metrics.totalDischarges, previousMetrics.totalDischarges),
      totalOutpatientVisits: formatDelta(
        metrics.totalOutpatientVisits,
        previousMetrics.totalOutpatientVisits,
      ),
      noShowCount: formatDelta(metrics.noShowCount, previousMetrics.noShowCount),
      haiCount: formatDelta(metrics.haiCount, previousMetrics.haiCount),
    },
  }
}

export function getTrendSeries(
  state: AppState,
  fieldId: string,
  family?: ReportFamily,
  departmentId?: string,
  options?: {
    anchorPeriodId?: string
    periodCount?: number
  },
) {
  const anchorPeriodId = options?.anchorPeriodId ?? getCurrentPeriod(state)?.id
  const periodCount = options?.periodCount ?? 8
  const reportingPeriods = getSortedReportingPeriods(state)
  const anchorIndex = anchorPeriodId
    ? reportingPeriods.findIndex((period) => period.id === anchorPeriodId)
    : -1
  const periods =
    anchorIndex >= 0
      ? reportingPeriods.slice(
          Math.max(0, anchorIndex - periodCount + 1),
          anchorIndex + 1,
        )
      : reportingPeriods.slice(-periodCount)

  return periods.map((period) => {
    const reports = state.reports.filter((report) => {
      if (report.reportingPeriodId !== period.id) {
        return false
      }
      if (family && departmentMap[report.departmentId].family !== family) {
        return false
      }
      if (departmentId && report.departmentId !== departmentId) {
        return false
      }
      return true
    })

    return {
      label: period.label,
      shortLabel: `${parseISO(period.weekStart).getMonth() + 1}/${parseISO(period.weekStart).getDate()}`,
      value: reports.reduce((sum, report) => sum + sumField(report, fieldId), 0),
    }
  })
}

export function getDepartmentComparisonData(
  state: AppState,
  family: ReportFamily,
  periodId = getCurrentPeriod(state)?.id,
) {
  if (!periodId) {
    return []
  }

  return departments
    .filter((department) => department.family === family)
    .map((department) => {
      const report = state.reports.find(
        (candidate) =>
          candidate.departmentId === department.id &&
          candidate.reportingPeriodId === periodId,
      )

      return {
        id: department.id,
        name: department.name,
        accent: department.accent,
        admissions: report
          ? sumField(report, 'total_admitted_patients') +
            sumField(report, 'new_admitted_patients')
          : 0,
        visits: report ? sumField(report, 'total_patients_seen') : 0,
        hai: report ? sumField(report, 'total_hai') : 0,
        noShow: report ? sumField(report, 'failed_to_come') : 0,
        borPercent: report?.calculatedMetrics.borPercent ?? 0,
      }
    })
}

export function getSubmissionBoard(
  state: AppState,
  periodCount = 4,
  startPeriodId = getCurrentPeriod(state)?.id,
) {
  const periods = getReportingPeriodsBackwards(state, periodCount, startPeriodId)

  return state.assignments
    .filter((assignment) => assignment.active)
    .map((assignment) => ({
      assignment,
      department: departmentMap[assignment.departmentId],
      template: templateMap[assignment.templateId],
      statuses: periods.map((period) => {
        const report = getReportForAssignmentPeriod(state, assignment.id, period.id)
      return {
        period,
        report,
          status: deriveReportStatus(state, period.id, report),
        }
      }),
    }))
}

export function getNurseSubmissionBoard(state: AppState, userId: string) {
  const visiblePeriods = getVisibleReportingPeriods(state)
  const periods = getReportingPeriodsBackwards(state, visiblePeriods.length)

  if (!periods.length) {
    return []
  }

  return getAssignmentsForUser(state, userId).map((assignment) => ({
    assignment,
    department: departmentMap[assignment.departmentId],
    template: templateMap[assignment.templateId],
    statuses: periods.map((period) => {
      const report = getReportForAssignmentPeriod(state, assignment.id, period.id)

      return {
        period,
        report,
        status: deriveReportStatus(state, period.id, report),
      }
    }),
  }))
}

export function getRecentNotifications(state: AppState, userId: string, count = 6) {
  return state.notifications
    .filter((notification) => notification.userId === userId)
    .slice(0, count)
}

export function getUnreadNotificationCount(state: AppState, userId: string) {
  return state.notifications.filter(
    (notification) => notification.userId === userId && !notification.readAt,
  ).length
}

export function getWhatChangedThisWeek(
  state: AppState,
  family?: ReportFamily,
  departmentId?: string,
) {
  const currentPeriod = getCurrentPeriod(state)
  const previousPeriod = getPreviousPeriod(state)

  if (!currentPeriod || !previousPeriod) {
    return []
  }

  const insights: string[] = []

  state.assignments.forEach((assignment) => {
    if (departmentId && assignment.departmentId !== departmentId) {
      return
    }
    if (family && departmentMap[assignment.departmentId].family !== family) {
      return
    }

    const department = departmentMap[assignment.departmentId]
    const template = templateMap[assignment.templateId]
    const currentReport = getReportForAssignmentPeriod(state, assignment.id, currentPeriod.id)
    const previousReport = getReportForAssignmentPeriod(state, assignment.id, previousPeriod.id)

    template.changeRules.forEach((rule) => {
      if (!rule.fieldId || !currentReport || !previousReport) {
        return
      }

      const currentValue = sumField(currentReport, rule.fieldId)
      const previousValue = sumField(previousReport, rule.fieldId)
      const delta = formatDelta(currentValue, previousValue)

      if (delta !== null && Math.abs(delta) >= rule.percentThreshold) {
        insights.push(
          rule.messageTemplate
            .replace('{department}', department.name)
            .replace('{deltaPercent}', Math.round(delta).toString())
            .replace('{currentValue}', String(currentValue))
            .replace('{previousValue}', String(previousValue)),
        )
      }

      if (
        state.settings.criticalNonZeroFields.includes(rule.fieldId) &&
        currentValue > 0 &&
        previousValue === 0
      ) {
        insights.push(`${department.name} reported a new non-zero critical event for ${rule.fieldId.replaceAll('_', ' ')}.`)
      }
    })

    const currentStatus = deriveReportStatus(state, currentPeriod.id, currentReport)
    if (currentStatus === 'edited_after_submission') {
      const historyEntry = state.statusHistory.find(
        (entry) =>
          entry.reportId === currentReport?.id &&
          entry.status === 'edited_after_submission',
      )
      if (historyEntry) {
        insights.push(
          `${department.name} was edited after submission by ${historyEntry.changedByName} at ${historyEntry.changedAt.slice(11, 16)}.`,
        )
      }
    }
  })

  return insights.slice(0, 8)
}

export function getDepartmentDetail(
  state: AppState,
  departmentId: string,
  options?: {
    range?: ReportingTimeRange
    anchorPeriodId?: string
  },
) {
  const department = departmentMap[departmentId]
  const reportingPeriods = getVisibleReportingPeriods(state)
  const fallbackPeriod = getCurrentPeriod(state)
  const period =
    reportingPeriods.find((candidate) => candidate.id === options?.anchorPeriodId) ??
    fallbackPeriod
  const periodIndex = period
    ? reportingPeriods.findIndex((candidate) => candidate.id === period.id)
    : -1
  const previousPeriod = periodIndex > 0 ? reportingPeriods[periodIndex - 1] : null
  const rangePeriods = getReportingPeriodsForRange(
    state,
    options?.range ?? 'last8',
    period?.id,
  )
  const assignment = state.assignments.find(
    (candidate) => candidate.departmentId === departmentId,
  )

  if (!department || !period || !assignment) {
    return null
  }

  const currentReport = getReportForAssignmentPeriod(state, assignment.id, period.id)
  const previousReport = previousPeriod
    ? getReportForAssignmentPeriod(state, assignment.id, previousPeriod.id)
    : null
  const rangeReports = rangePeriods
    .map((rangePeriod) => getReportForAssignmentPeriod(state, assignment.id, rangePeriod.id))
    .filter((report): report is ReportRecord => Boolean(report))
  const activitySourceId =
    department.family === 'inpatient'
      ? 'total_admitted_patients'
      : department.family === 'outpatient'
        ? 'total_patients_seen'
        : templateMap[department.templateId].summaryCards[0]?.sourceId ?? ''

  return {
    department,
    template: templateMap[department.templateId],
    assignment,
    period,
    rangePeriods,
    rangeReports,
    currentReport,
    previousReport,
    currentStatus: deriveReportStatus(state, period.id, currentReport),
    trends: {
      activity: rangePeriods.map((rangePeriod) => {
        const report = getReportForAssignmentPeriod(state, assignment.id, rangePeriod.id)

        return {
          label: rangePeriod.label,
          shortLabel: `${parseISO(rangePeriod.weekStart).getMonth() + 1}/${parseISO(rangePeriod.weekStart).getDate()}`,
          value: report ? sumField(report, activitySourceId) : 0,
        }
      }),
    },
    insights: getWhatChangedThisWeek(state, department.family, department.id),
    auditHighlights: state.auditLogs.filter((log) => log.departmentId === departmentId).slice(0, 6),
  }
}

export function getAllTemplatesByFamily() {
  return reportTemplates.reduce<Record<ReportFamily, typeof reportTemplates>>(
    (accumulator, template) => {
      accumulator[template.family] = [
        ...(accumulator[template.family] ?? []),
        template,
      ]
      return accumulator
    },
    {
      inpatient: [],
      outpatient: [],
      procedure: [],
    },
  )
}

export function getLockDeadlineNote(state: AppState, periodId: string) {
  if (!state.settings.deadlineEnforced) {
    return null
  }

  const period = state.reportingPeriods.find((candidate) => candidate.id === periodId)

  if (!period) {
    return null
  }

  return getDeadlineForPeriod(
    period,
    state.settings.weeklyDeadlineDay,
    state.settings.weeklyDeadlineTime,
  )
}
