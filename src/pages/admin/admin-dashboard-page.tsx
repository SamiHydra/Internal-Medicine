import { useEffect, useRef, useState } from 'react'
import { format } from 'date-fns'
import { animate, motion } from 'framer-motion'
import { Filter, Sparkles } from 'lucide-react'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import { ReportingScopePanel } from '@/components/admin/reporting-scope-panel'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  ALL_INPATIENT_AVERAGE,
  ALL_INPATIENT_POOLED,
  ALL_OUTPATIENT_AVERAGE,
  ALL_PROCEDURE_SERVICES_TOTAL,
  deriveReportStatus,
  getCurrentPeriod,
  getInpatientMonthlyOccupancySeries,
  getInpatientMonthlyWardComparisonData,
  getInpatientWeeklyCountTrendSeries,
  getOutpatientMonthlyAvailabilityDepartmentComparisonData,
  getOutpatientMonthlyDepartmentComparisonData,
  getOutpatientWeeklyAvailabilitySeries,
  getOutpatientWeeklyTrendSeries,
  getProcedureDialysisSplitData,
  getProcedureEndoscopyMixData,
  getProcedureMonthlyServiceComparisonData,
  getProcedureTotalThroughput,
  getProcedureWeeklyTrendSeries,
  getReportForAssignmentPeriod,
  getLockDeadlineNote,
  getReportingPeriodsForRange,
  getReportingRangeSummary,
  getVisibleReportingPeriods,
  OUTPATIENT_AVAILABILITY_STATUSES,
  PROCEDURE_SERVICE_DEFINITIONS,
  resolveDashboardTrendBucket,
  shouldShowInpatientOccupancyAnalytics,
  type DashboardTrendScale,
  type ReportingTimeRange,
} from '@/data/selectors'
import { useAppData } from '@/context/app-data-context'
import { departments, departmentMap, templateMap } from '@/config/templates'
import { computeWeeklyValue } from '@/lib/metrics'
import { cn, formatCompactNumber } from '@/lib/utils'
import type { ReportFamily, ReportRecord, ReportingPeriod } from '@/types/domain'

type FamilyFilter = 'all' | 'inpatient' | 'outpatient' | 'procedure'
type StatusFilter =
  | 'all'
  | 'draft'
  | 'submitted'
  | 'edited_after_submission'
  | 'locked'
  | 'not_started'
  | 'overdue'
type TrendScale = DashboardTrendScale

type TrendBucket = {
  key: string
  label: string
  periods: ReportingPeriod[]
  periodIds: Set<string>
}

function ChartEmptyState({
  message,
  tone = 'light',
}: {
  message: string
  tone?: 'light' | 'dark'
}) {
  return (
    <div
      className={cn(
        'flex h-full flex-col items-center justify-center gap-3 rounded-[0.5rem] border border-dashed px-6 text-center shadow-inner',
        tone === 'dark'
          ? 'border-white/12 bg-white/6 text-[#c6d3e4]'
          : 'border-[#d4dde8]/80 bg-[linear-gradient(180deg,#ffffff_0%,#f4f7fb_100%)] text-[#64748b]',
      )}
    >
      <Sparkles className={cn('h-5 w-5', tone === 'dark' ? 'text-[#f0b429]' : 'text-[#005db6]')} />
      <p className="max-w-xs text-sm leading-6">{message}</p>
    </div>
  )
}

function ChartLegend({
  items,
  className,
}: {
  items: readonly { label: string; color: string; dash?: boolean }[]
  className?: string
}) {
  return (
    <div className={cn('flex flex-wrap items-center gap-x-4 gap-y-2', className)}>
      {items.map((item) => (
        <div key={item.label} className="inline-flex items-center gap-2 text-xs font-medium text-[#475569]">
          <span
            className={cn('h-2 rounded-full', item.dash ? 'w-5' : 'w-2.5')}
            style={{
              backgroundColor: item.dash ? 'transparent' : item.color,
              borderTop: item.dash ? `2px dashed ${item.color}` : undefined,
            }}
          />
          <span>{item.label}</span>
        </div>
      ))}
    </div>
  )
}

function formatShare(count: number, total: number) {
  if (!total) {
    return 0
  }

  return Math.round((count / total) * 100)
}

function formatMinutesAsTime(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return '-'
  }

  const rounded = Math.round(value)
  const hours = Math.floor(rounded / 60)
  const minutes = rounded % 60

  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
}

function getReportWeeklyFieldValue(report: ReportRecord, fieldId: string) {
  const field = templateMap[report.templateId]?.fields.find((item) => item.id === fieldId)

  if (!field) {
    return null
  }

  return computeWeeklyValue(field, report.values[fieldId]?.dailyValues ?? {})
}

function formatAnimatedValue(
  value: number,
  variant: 'compact' | 'number' | 'percent' | 'decimal',
  digits: number,
) {
  if (variant === 'compact') {
    return formatCompactNumber(value)
  }

  if (variant === 'percent') {
    return `${value.toFixed(digits)}%`
  }

  if (variant === 'decimal') {
    return value.toFixed(digits)
  }

  return new Intl.NumberFormat('en-US', {
    maximumFractionDigits: digits,
  }).format(value)
}

function AnimatedMetric({
  value,
  variant = 'compact',
  digits = 0,
  className,
}: {
  value: number | null | undefined
  variant?: 'compact' | 'number' | 'percent' | 'decimal'
  digits?: number
  className?: string
}) {
  const hasValue = value !== null && value !== undefined && !Number.isNaN(value)
  const safeValue = hasValue ? value : 0
  const [displayValue, setDisplayValue] = useState(safeValue)
  const previousValueRef = useRef(safeValue)

  useEffect(() => {
    const controls = animate(previousValueRef.current, safeValue, {
      duration: 0.9,
      ease: 'easeOut',
      onUpdate: (latest) => {
        previousValueRef.current = latest
        setDisplayValue(latest)
      },
    })

    return () => controls.stop()
  }, [safeValue])

  if (!hasValue) {
    return <span className={className}>-</span>
  }

  return (
    <span className={className}>
      {formatAnimatedValue(displayValue, variant, digits)}
    </span>
  )
}

function SectionAmbient() {
  return null
}

function getChartPointNumber(
  point: Record<string, string | number | null>,
  key: string,
) {
  const value = point[key]

  return typeof value === 'number' ? value : 0
}

function getMonthlyComparisonChartMinWidth(pointCount: number, barCount: number) {
  return Math.max(760, pointCount * (barCount >= 3 ? 96 : 84))
}

function getOutpatientMonthlyComparisonChartMinWidth(pointCount: number, barCount: number) {
  const pointWidth = barCount >= 3 ? 96 : barCount === 2 ? 88 : 78

  return pointCount * pointWidth
}

function formatMonthlyComparisonTick(value: string | number) {
  const label = String(value)
  const wardLabel = label.includes(' / ') ? label.split(' / ').at(-1) ?? label : label

  return wardLabel.length > 12 ? `${wardLabel.slice(0, 11)}...` : wardLabel
}

function formatOutpatientMonthlyComparisonTick(value: string | number) {
  const label = String(value)
  const departmentLabel = label.includes(' / ') ? label.split(' / ').at(-1) ?? label : label

  return departmentLabel.length > 16 ? `${departmentLabel.slice(0, 15)}...` : departmentLabel
}

function formatProcedureServiceTick(value: string | number) {
  const label = String(value)

  return label.length > 18 ? `${label.slice(0, 17)}...` : label
}

function getTooltipPoint(payload: unknown) {
  if (!payload || typeof payload !== 'object' || !('payload' in payload)) {
    return null
  }

  const point = payload.payload

  return point && typeof point === 'object'
    ? point as Record<string, string | number | null>
    : null
}

function formatMonthlyComparisonTooltipLabel(label: unknown, payload?: readonly unknown[]) {
  const point = getTooltipPoint(payload?.[0])
  const monthLabel = typeof point?.monthLabel === 'string' ? point.monthLabel : ''
  const departmentName =
    typeof point?.departmentName === 'string' ? point.departmentName : String(label ?? '')

  return monthLabel ? `${monthLabel} / ${departmentName}` : departmentName
}

function formatProcedureServiceTooltipLabel(label: unknown, payload?: readonly unknown[]) {
  const point = getTooltipPoint(payload?.[0])
  const monthLabel = typeof point?.monthLabel === 'string' ? point.monthLabel : ''
  const serviceName =
    typeof point?.serviceName === 'string' ? point.serviceName : String(label ?? '')

  return monthLabel ? `${monthLabel} / ${serviceName}` : serviceName
}

function formatProcedureMixTooltipLabel(label: unknown, payload?: readonly unknown[]) {
  const point = getTooltipPoint(payload?.[0])
  const monthLabel = typeof point?.monthLabel === 'string' ? point.monthLabel : ''

  return monthLabel ? `${monthLabel} / ${String(label ?? '')}` : String(label ?? '')
}

function formatAvailabilityTooltipValue(value: unknown, name: unknown, payload?: unknown) {
  const count = Number(value)
  const point = getTooltipPoint(payload)
  const total = typeof point?.total === 'number' ? point.total : 0
  const percent = total ? Math.round((count / total) * 100) : 0

  return [`${count} (${percent}%)`, String(name ?? '')]
}

function formatChartTooltipLabel(label: unknown) {
  return String(label ?? '')
}

export function AdminDashboardPage() {
  const { state, ensureReportDetails, isSyncing } = useAppData()
  const [familyFilter, setFamilyFilter] = useState<FamilyFilter>('all')
  const currentPeriod = getCurrentPeriod(state)
  const currentPeriodId = currentPeriod?.id ?? ''
  const [periodId, setPeriodId] = useState(currentPeriodId)
  const [timeRange, setTimeRange] = useState<ReportingTimeRange>('last8')
  const [trendScale, setTrendScale] = useState<TrendScale>('weekly')
  const [inpatientTrendScope, setInpatientTrendScope] = useState(ALL_INPATIENT_AVERAGE)
  const [inpatientOccupancyScope, setInpatientOccupancyScope] =
    useState(ALL_INPATIENT_POOLED)
  const [inpatientComparisonMonthKey, setInpatientComparisonMonthKey] = useState('')
  const [outpatientTrendScope, setOutpatientTrendScope] = useState(ALL_OUTPATIENT_AVERAGE)
  const [outpatientComparisonMonthKey, setOutpatientComparisonMonthKey] = useState('')
  const [procedureTrendScope, setProcedureTrendScope] = useState(ALL_PROCEDURE_SERVICES_TOTAL)
  const [procedureComparisonMonthKey, setProcedureComparisonMonthKey] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const availablePeriods = getVisibleReportingPeriods(state)
  const visibleReportingPeriods = [...availablePeriods].reverse()
  const reportingPeriodOptions = visibleReportingPeriods.map((period) => ({
    label: period.label,
    value: period.id,
  }))
  const effectivePeriodId = availablePeriods.some((period) => period.id === periodId)
    ? periodId
    : currentPeriodId
  const scopeFamily = familyFilter === 'all' ? undefined : familyFilter
  const trendPeriods = getReportingPeriodsForRange(state, timeRange, effectivePeriodId)
  const trendBuckets: TrendBucket[] =
    trendScale === 'monthly'
      ? trendPeriods.reduce<TrendBucket[]>((buckets, period) => {
          const key = format(new Date(period.weekStart), 'yyyy-MM')
          const existingBucket = buckets.find((bucket) => bucket.key === key)

          if (existingBucket) {
            existingBucket.periods.push(period)
            existingBucket.periodIds.add(period.id)
            return buckets
          }

          return [
            ...buckets,
            {
              key,
              label: format(new Date(period.weekStart), 'MMM yyyy'),
              periods: [period],
              periodIds: new Set([period.id]),
            },
          ]
        }, [])
      : trendPeriods.map((period) => ({
          key: period.id,
          label: format(new Date(period.weekStart), 'MMM d'),
          periods: [period],
          periodIds: new Set([period.id]),
        }))
  const monthlyTrendBuckets = trendPeriods.reduce<TrendBucket[]>((buckets, period) => {
    const key = format(new Date(period.weekStart), 'yyyy-MM')
    const existingBucket = buckets.find((bucket) => bucket.key === key)

    if (existingBucket) {
      existingBucket.periods.push(period)
      existingBucket.periodIds.add(period.id)
      return buckets
    }

    return [
      ...buckets,
      {
        key,
        label: format(new Date(period.weekStart), 'MMM yyyy'),
        periods: [period],
        periodIds: new Set([period.id]),
      },
    ]
  }, [])
  const detailReportingPeriodIds = new Set(trendPeriods.map((period) => period.id))
  const detailReportIds = state.reports
    .filter((report) => detailReportingPeriodIds.has(report.reportingPeriodId))
    .map((report) => report.id)

  useEffect(() => {
    void ensureReportDetails(detailReportIds)
  }, [detailReportIds, ensureReportDetails])

  const rangeSummary = getReportingRangeSummary(
    state,
    timeRange,
    effectivePeriodId,
    scopeFamily,
  )

  if (!rangeSummary) {
    return (
      <section className="rounded-[0.35rem] bg-[#eef2f6] px-5 py-10 md:px-6">
        <div className="space-y-3">
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#005db6]">
            Reporting dashboard
          </p>
          <h1 className="font-display text-[2rem] leading-[0.98] tracking-[-0.04em] text-[#000a1e]">
            {isSyncing ? 'Syncing dashboard data' : 'Preparing dashboard'}
          </h1>
          <p className="max-w-[34rem] text-sm leading-7 text-[#5b6169]">
            Loading the reporting periods, assignments, and current service-line summary.
          </p>
        </div>
      </section>
    )
  }

  const deadlineNote = getLockDeadlineNote(state, effectivePeriodId)
  const timeRangeLabels = {
    current: 'Current week',
    last4: 'Last 4 weeks',
    last8: 'Last 8 weeks',
    all: 'All available data',
  } as const
  const timeRangeOptions = [
    { value: 'current' as const, label: 'Current week' },
    { value: 'last4' as const, label: 'Last 4 weeks' },
    { value: 'last8' as const, label: 'Last 8 weeks' },
    { value: 'all' as const, label: 'All available data' },
  ] as const
  const trendScaleLabels = {
    weekly: 'Weekly trends',
    monthly: 'Monthly trends',
  } as const
  const trendScaleOptions = [
    { value: 'weekly' as const, label: 'Weekly' },
    { value: 'monthly' as const, label: 'Monthly' },
  ] as const
  const familyLabels = {
    all: 'All services',
    inpatient: 'Inpatient',
    outpatient: 'Outpatient',
    procedure: 'Procedures',
  } as const
  const statusLabels = {
    all: 'All statuses',
    draft: 'Draft',
    submitted: 'Submitted',
    edited_after_submission: 'Edited',
    locked: 'Locked',
    not_started: 'Not started',
    overdue: 'Overdue',
  } as const
  const serviceLineOptions = [
    { value: 'all' as const, label: 'All services' },
    { value: 'inpatient' as const, label: 'Inpatient' },
    { value: 'outpatient' as const, label: 'Outpatient' },
    { value: 'procedure' as const, label: 'Procedures' },
  ] as const
  const inpatientWardOptions = departments
    .filter((department) => department.family === 'inpatient')
    .map((department) => ({
      value: department.id,
      label: department.name,
    }))
  const outpatientDepartmentOptions = departments
    .filter((department) => department.family === 'outpatient')
    .map((department) => ({
      value: department.id,
      label: department.name,
    }))
  const inpatientTrendScopeOptions = [
    { value: ALL_INPATIENT_AVERAGE, label: 'All inpatient average' },
    ...inpatientWardOptions,
  ]
  const outpatientTrendScopeOptions = [
    { value: ALL_OUTPATIENT_AVERAGE, label: 'All outpatient average' },
    ...outpatientDepartmentOptions,
  ]
  const procedureTrendScopeOptions = [
    { value: ALL_PROCEDURE_SERVICES_TOTAL, label: 'All procedure services total' },
    ...PROCEDURE_SERVICE_DEFINITIONS.map((service) => ({
      value: service.id,
      label: service.label,
    })),
  ]
  const inpatientOccupancyScopeOptions = [
    { value: ALL_INPATIENT_POOLED, label: 'All inpatient pooled' },
    ...inpatientWardOptions,
  ]
  const inpatientComparisonMonthOptions = monthlyTrendBuckets.map((bucket) => ({
    value: bucket.key,
    label: bucket.label,
  }))
  const outpatientComparisonMonthOptions = monthlyTrendBuckets.map((bucket) => ({
    value: bucket.key,
    label: bucket.label,
  }))
  const procedureComparisonMonthOptions = monthlyTrendBuckets.map((bucket) => ({
    value: bucket.key,
    label: bucket.label,
  }))
  const statusOptions = [
    { value: 'all' as const, label: 'All statuses' },
    { value: 'not_started' as const, label: 'Not started' },
    { value: 'draft' as const, label: 'Draft' },
    { value: 'submitted' as const, label: 'Submitted' },
    { value: 'edited_after_submission' as const, label: 'Edited' },
    { value: 'locked' as const, label: 'Locked' },
    { value: 'overdue' as const, label: 'Overdue' },
  ] as const
  const chartGridStroke = 'rgba(148, 163, 184, 0.28)'
  const chartTick = { fill: '#64748b', fontSize: 12, fontWeight: 500 }
  const grayscalePalette = {
    ink: '#005db6',
    carbon: '#315f8c',
    slate: '#002147',
    steel: '#6c7f95',
    mist: '#f0b429',
    cloud: '#95abc4',
    dialysis: '#0f766e',
    dialysisLight: '#5bb8a4',
  } as const
  const tooltipLineCursor = { stroke: 'rgba(0,93,182,0.22)', strokeWidth: 1.4, strokeDasharray: '4 5' } as const
  const tooltipFillCursor = { fill: 'rgba(0,93,182,0.06)' } as const
  const totalExpected = rangeSummary.metrics.totalExpected
  const deliveredStatuses = new Set<Exclude<StatusFilter, 'all'>>([
    'submitted',
    'edited_after_submission',
    'locked',
  ])
  const selectedPeriod =
    availablePeriods.find((period) => period.id === effectivePeriodId) ??
    currentPeriod ??
    null
  const rangeStart = trendPeriods[0] ?? selectedPeriod
  const rangeEnd = trendPeriods.at(-1) ?? selectedPeriod
  const trendBucketLabel =
    trendScale === 'monthly'
      ? `${trendBuckets.length} ${trendBuckets.length === 1 ? 'month' : 'months'}`
      : `${trendPeriods.length} reporting ${trendPeriods.length === 1 ? 'week' : 'weeks'}`
  const selectedRangeTitle =
    timeRange === 'current'
      ? selectedPeriod?.label ?? 'Current reporting period'
      : `${timeRangeLabels[timeRange]} through ${
          rangeEnd ? format(new Date(rangeEnd.weekEnd), 'MMM d, yyyy') : 'selected period'
        }`
  const selectedRangeNote =
    timeRange === 'current'
      ? deadlineNote
        ? `Deadline ${format(deadlineNote, 'EEE, MMM d')} at ${format(deadlineNote, 'HH:mm')}`
        : 'No deadline set'
      : rangeStart && rangeEnd
        ? `${format(new Date(rangeStart.weekStart), 'MMM d')} - ${format(
          new Date(rangeEnd.weekEnd),
          'MMM d, yyyy',
          )} / ${trendBucketLabel}`
        : 'No reporting periods in range'
  const scopedAssignments = state.assignments.filter((assignment) =>
    assignment.active &&
    (familyFilter === 'all' ? true : departmentMap[assignment.departmentId].family === familyFilter),
  )
  const selectedPeriodIds = new Set(trendPeriods.map((period) => period.id))
  const getReportsForPeriodIds = (periodIds: Set<string>, family: ReportFamily) =>
    state.reports.filter(
      (report) =>
        periodIds.has(report.reportingPeriodId) &&
        departmentMap[report.departmentId].family === family,
    )
  const getRangeReports = (family: ReportFamily) =>
    getReportsForPeriodIds(selectedPeriodIds, family)
  const sumReportFieldTotals = (reports: ReportRecord[], fieldIds: readonly string[]) =>
    reports.reduce((total, report) => {
      const reportTotal = fieldIds.reduce((fieldTotal, fieldId) => {
        const value = getReportWeeklyFieldValue(report, fieldId)
        return fieldTotal + (typeof value === 'number' ? value : 0)
      }, 0)

      return total + reportTotal
    }, 0)
  const sumFieldTotalsForRange = (family: ReportFamily, fieldIds: readonly string[]) =>
    sumReportFieldTotals(getRangeReports(family), fieldIds)
  const countStatus = (status: Exclude<StatusFilter, 'all'>) =>
    rangeSummary.statusCounts[status]
  const statusDistribution = [
    { key: 'submitted' as const, label: 'Submitted', count: countStatus('submitted'), fill: grayscalePalette.ink },
    {
      key: 'edited_after_submission' as const,
      label: 'Edited',
      count: countStatus('edited_after_submission'),
      fill: grayscalePalette.carbon,
    },
    { key: 'locked' as const, label: 'Locked', count: countStatus('locked'), fill: grayscalePalette.slate },
    { key: 'draft' as const, label: 'Draft', count: countStatus('draft'), fill: grayscalePalette.steel },
    { key: 'overdue' as const, label: 'Overdue', count: countStatus('overdue'), fill: grayscalePalette.mist },
    {
      key: 'not_started' as const,
      label: 'Not started',
      count: countStatus('not_started'),
      fill: grayscalePalette.cloud,
    },
  ]
  const deliveredCount = statusDistribution
    .filter((item) => deliveredStatuses.has(item.key))
    .reduce((sum, item) => sum + item.count, 0)
  const openCount = Math.max(totalExpected - deliveredCount, 0)
  const deliveryRate = formatShare(deliveredCount, totalExpected)
  const statusFocusValue =
    statusFilter === 'all'
      ? deliveredCount
      : statusDistribution.find((item) => item.key === statusFilter)?.count ?? 0
  const statusFocusRate = formatShare(statusFocusValue, totalExpected)
  const statusCenterLabel = statusFilter === 'all' ? 'Delivered' : statusLabels[statusFilter]
  const reportingTrendSeries = trendBuckets.map((bucket) => {
    const statuses = bucket.periods.flatMap((period) =>
      scopedAssignments.map((assignment) =>
        deriveReportStatus(
          state,
          period.id,
          getReportForAssignmentPeriod(state, assignment.id, period.id),
        ),
      ),
    )
    const delivered = statuses.filter((value) => deliveredStatuses.has(value)).length
    const overdue = statuses.filter((value) => value === 'overdue').length

    return {
      label: bucket.label,
      delivered,
      open: Math.max(statuses.length - delivered, 0),
      overdue,
    }
  })
  const showInpatientSection = familyFilter === 'all' || familyFilter === 'inpatient'
  const showOutpatientSection = familyFilter === 'all' || familyFilter === 'outpatient'
  const showProcedureSection = familyFilter === 'all' || familyFilter === 'procedure'
  const showInpatientOccupancyAnalytics = shouldShowInpatientOccupancyAnalytics(trendScale)
  const selectedInpatientComparisonMonth = resolveDashboardTrendBucket(
    monthlyTrendBuckets,
    inpatientComparisonMonthKey,
  )
  const effectiveInpatientComparisonMonthKey =
    selectedInpatientComparisonMonth?.key ?? ''
  const selectedOutpatientComparisonMonth = resolveDashboardTrendBucket(
    monthlyTrendBuckets,
    outpatientComparisonMonthKey,
  )
  const effectiveOutpatientComparisonMonthKey =
    selectedOutpatientComparisonMonth?.key ?? ''
  const selectedProcedureComparisonMonth = resolveDashboardTrendBucket(
    monthlyTrendBuckets,
    procedureComparisonMonthKey,
  )
  const effectiveProcedureComparisonMonthKey =
    selectedProcedureComparisonMonth?.key ?? ''
  const inpatientFlowMetrics = [
    { key: 'newAdmissions', fieldIds: ['new_admitted_patients'] },
    { key: 'discharges', fieldIds: ['discharged_home', 'discharged_ama'] },
  ] as const
  const inpatientSafetyMetrics = [
    { key: 'deaths', fieldIds: ['new_deaths'] },
    { key: 'ulcers', fieldIds: ['new_pressure_ulcer'] },
    { key: 'hai', fieldIds: ['total_hai'] },
  ] as const
  const inpatientFlowSeries =
    trendScale === 'monthly'
      ? getInpatientMonthlyWardComparisonData(
          state,
          monthlyTrendBuckets,
          inpatientFlowMetrics,
          effectiveInpatientComparisonMonthKey,
        )
      : getInpatientWeeklyCountTrendSeries(
          state,
          trendBuckets,
          inpatientFlowMetrics,
          inpatientTrendScope,
        )
  const inpatientAdmissionsTotal = sumFieldTotalsForRange('inpatient', [
    'total_admitted_patients',
    'new_admitted_patients',
  ])
  const inpatientSafetySeries =
    trendScale === 'monthly'
      ? getInpatientMonthlyWardComparisonData(
          state,
          monthlyTrendBuckets,
          inpatientSafetyMetrics,
          effectiveInpatientComparisonMonthKey,
        )
      : getInpatientWeeklyCountTrendSeries(
          state,
          trendBuckets,
          inpatientSafetyMetrics,
          inpatientTrendScope,
        )
  const inpatientOccupancySeries = showInpatientOccupancyAnalytics
    ? getInpatientMonthlyOccupancySeries(state, trendBuckets, inpatientOccupancyScope)
    : []
  const outpatientSeenMetrics = [
    { key: 'seen', fieldId: 'total_patients_seen', valueType: 'sum' },
    { key: 'notSeenSameDay', fieldId: 'not_seen_same_day', valueType: 'sum' },
  ] as const
  const outpatientVolumeMetrics = [
    { key: 'totalSeen', fieldId: 'total_patients_seen', valueType: 'sum' },
    { key: 'newPatients', fieldId: 'new_patients_seen', valueType: 'sum' },
    { key: 'followUp', fieldId: 'follow_up_patients', valueType: 'sum' },
  ] as const
  const outpatientFollowUpWaitMetrics = [
    { key: 'wait', fieldId: 'wait_time_followup_months', valueType: 'average' },
  ] as const
  const outpatientClinicStartMetrics = [
    { key: 'startMinutes', fieldId: 'clinic_start_time', valueType: 'timeAverage' },
  ] as const
  const outpatientSeenSeries =
    trendScale === 'monthly'
      ? getOutpatientMonthlyDepartmentComparisonData(
          state,
          monthlyTrendBuckets,
          outpatientSeenMetrics,
          effectiveOutpatientComparisonMonthKey,
        )
      : getOutpatientWeeklyTrendSeries(
          state,
          trendBuckets,
          outpatientSeenMetrics,
          outpatientTrendScope,
        )
  const outpatientSeenTotal = sumFieldTotalsForRange('outpatient', ['total_patients_seen'])
  const outpatientVolumeMix =
    trendScale === 'monthly'
      ? getOutpatientMonthlyDepartmentComparisonData(
          state,
          monthlyTrendBuckets,
          outpatientVolumeMetrics,
          effectiveOutpatientComparisonMonthKey,
        )
      : getOutpatientWeeklyTrendSeries(
          state,
          trendBuckets,
          outpatientVolumeMetrics,
          outpatientTrendScope,
        )
  const outpatientFollowUpWaitSeries =
    trendScale === 'monthly'
      ? getOutpatientMonthlyDepartmentComparisonData(
          state,
          monthlyTrendBuckets,
          outpatientFollowUpWaitMetrics,
          effectiveOutpatientComparisonMonthKey,
        )
      : getOutpatientWeeklyTrendSeries(
          state,
          trendBuckets,
          outpatientFollowUpWaitMetrics,
          outpatientTrendScope,
        )
  const outpatientClinicStartSeries =
    trendScale === 'monthly'
      ? getOutpatientMonthlyDepartmentComparisonData(
          state,
          monthlyTrendBuckets,
          outpatientClinicStartMetrics,
          effectiveOutpatientComparisonMonthKey,
        )
      : getOutpatientWeeklyTrendSeries(
          state,
          trendBuckets,
          outpatientClinicStartMetrics,
          outpatientTrendScope,
        )
  const outpatientAvailabilitySeries =
    trendScale === 'monthly'
      ? getOutpatientMonthlyAvailabilityDepartmentComparisonData(
          state,
          monthlyTrendBuckets,
          effectiveOutpatientComparisonMonthKey,
        )
      : getOutpatientWeeklyAvailabilitySeries(
          state,
          trendBuckets,
          outpatientTrendScope,
        )
  const procedureTrendSeries = getProcedureWeeklyTrendSeries(
    state,
    trendBuckets,
    procedureTrendScope,
  )
  const procedureComparisonSeries = getProcedureMonthlyServiceComparisonData(
    state,
    monthlyTrendBuckets,
    effectiveProcedureComparisonMonthKey,
  )
  const procedureMainSeries =
    trendScale === 'monthly' ? procedureComparisonSeries : procedureTrendSeries
  const procedureHeaderTotal = getProcedureTotalThroughput(state, trendBuckets)
  const procedureDetailMonthKey =
    trendScale === 'monthly' ? effectiveProcedureComparisonMonthKey : undefined
  const showDialysisDetail =
    trendScale === 'monthly' || procedureTrendScope === 'dialysis_unit'
  const showEndoscopyDetail =
    trendScale === 'monthly' || procedureTrendScope === 'endoscopy_lab'
  const dialysisMix = getProcedureDialysisSplitData(
    state,
    trendScale === 'monthly' ? monthlyTrendBuckets : trendBuckets,
    procedureDetailMonthKey,
  )
  const dialysisTotal = dialysisMix.reduce((sum, item) => sum + item.value, 0)
  const endoscopyMix = getProcedureEndoscopyMixData(
    state,
    trendScale === 'monthly' ? monthlyTrendBuckets : trendBuckets,
    procedureDetailMonthKey,
  )
  const hasReportingTrendSignal = reportingTrendSeries.some(
    (point) => point.delivered > 0 || point.open > 0 || point.overdue > 0,
  )
  const hasInpatientFlowSignal = inpatientFlowSeries.some(
    (point) =>
      getChartPointNumber(point, 'newAdmissions') > 0 ||
      getChartPointNumber(point, 'discharges') > 0,
  )
  const hasInpatientSafetySignal = inpatientSafetySeries.some(
    (point) =>
      getChartPointNumber(point, 'deaths') > 0 ||
      getChartPointNumber(point, 'ulcers') > 0 ||
      getChartPointNumber(point, 'hai') > 0,
  )
  const hasInpatientOccupancySignal = inpatientOccupancySeries.some(
    (point) =>
      point.bor != null ||
      point.btr != null ||
      point.alos != null,
  )
  const hasOutpatientSeenSignal = outpatientSeenSeries.some(
    (point) =>
      getChartPointNumber(point, 'seen') > 0 ||
      getChartPointNumber(point, 'notSeenSameDay') > 0,
  )
  const hasFollowUpWaitSignal = outpatientFollowUpWaitSeries.some((point) => point.wait !== null)
  const hasClinicStartSignal = outpatientClinicStartSeries.some((point) => point.startMinutes !== null)
  const hasAvailabilitySignal = outpatientAvailabilitySeries.some((point) => point.total > 0)
  const hasOutpatientMixSignal = outpatientVolumeMix.some(
    (item) => getChartPointNumber(item, 'totalSeen') > 0,
  )
  const hasProcedureSignal = procedureMainSeries.some((item) => item.total > 0)
  const hasEndoscopyMixSignal = endoscopyMix.some((item) => item.value > 0)
  const hasDialysisMixSignal = dialysisMix.some((item) => item.value > 0)
  const occupancyScopeDepartment =
    inpatientOccupancyScope === ALL_INPATIENT_POOLED
      ? null
      : departmentMap[inpatientOccupancyScope]
  const occupancyEmptyMessage =
    occupancyScopeDepartment && !occupancyScopeDepartment.bedCount
      ? `${occupancyScopeDepartment.name} needs a bed count before BOR, BTR, or ALOS can be calculated.`
      : 'No BOR, BTR, or ALOS data in this monthly view.'
  const lightTooltipStyle = {
    borderRadius: '8px',
    border: '1px solid rgba(190, 203, 219, 0.95)',
    backgroundColor: 'rgba(255,255,255,0.98)',
    boxShadow: '0 22px 45px -18px rgba(0,33,71,0.28)',
    color: '#000a1e',
    padding: '10px 12px',
  }
  const lightTooltipLabelStyle = {
    color: '#002147',
    fontSize: 12,
    fontWeight: 700,
    marginBottom: 6,
  }
  const lightTooltipItemStyle = {
    color: '#334155',
    fontSize: 12,
    fontWeight: 600,
    paddingTop: 3,
    paddingBottom: 3,
  }
  const lineActiveDot = { r: 5.5, stroke: '#ffffff', strokeWidth: 2.5 }
  const sectionClass =
    'rounded-[0.35rem] bg-[#f1f4f7] px-5 py-6 md:px-6 md:py-7'
  const chartPanelClass =
    'rounded-[0.5rem] bg-[linear-gradient(180deg,#ffffff_0%,#f8fafc_100%)] p-5 shadow-[0_24px_60px_-42px_rgba(0,33,71,0.45)] outline outline-1 outline-[#d4dde8]/80 transition-shadow duration-300 hover:shadow-[0_28px_70px_-44px_rgba(0,33,71,0.55)] md:p-6'
  const chartTitleClass =
    'text-sm font-semibold uppercase tracking-[0.22em] text-[#334155]'
  const outpatientMonthlyScrollClass =
    'overflow-x-auto overscroll-x-contain pb-2 [scrollbar-width:thin]'
  const outpatientAvailabilityPalette = {
    fullDay: grayscalePalette.ink,
    partialDay: grayscalePalette.steel,
    unavailable: grayscalePalette.cloud,
  } as const
  const outpatientAvailabilityLegend = OUTPATIENT_AVAILABILITY_STATUSES.map((status) => ({
    label: status.label,
    color: outpatientAvailabilityPalette[status.key],
  }))
  const procedureServicePalette = [
    grayscalePalette.ink,
    grayscalePalette.carbon,
    grayscalePalette.mist,
    grayscalePalette.slate,
    grayscalePalette.steel,
    grayscalePalette.cloud,
    grayscalePalette.dialysis,
  ]
  const procedureServiceColorMap = Object.fromEntries(
    PROCEDURE_SERVICE_DEFINITIONS.map((service, index) => [
      service.id,
      procedureServicePalette[index % procedureServicePalette.length],
    ]),
  )
  const procedureMixColorMap = {
    acuteHd: grayscalePalette.dialysis,
    chronicHd: grayscalePalette.ink,
    ugi: grayscalePalette.ink,
    ercp: grayscalePalette.carbon,
    colonoscopy: grayscalePalette.slate,
    bronchoscopy: grayscalePalette.steel,
    ligation: grayscalePalette.cloud,
  } as const

  return (
    <div className="space-y-8 px-4 py-6 text-[#000a1e] md:px-6 md:py-8">
      <motion.section
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.28, ease: 'easeOut' }}
        className="rounded-[0.35rem] bg-[#f1f4f7] px-5 py-5 md:px-6 md:py-5"
      >
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1.08fr)_minmax(0,0.92fr)] xl:items-start">
          <div className="space-y-4">
            <div className="space-y-4">
              <div className="inline-flex items-center gap-2 bg-[#edf4fb] px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.22em] text-[#00468c]">
                <Filter className="h-3.5 w-3.5" />
                Reporting dashboard
              </div>
              <div className="space-y-2.5">
                <h1 className="max-w-4xl font-display text-[2.2rem] leading-[0.95] tracking-[-0.03em] text-[#000a1e] md:text-[2.7rem] xl:text-[3.05rem]">
                  {selectedRangeTitle}
                </h1>
                <div className="flex flex-wrap items-center gap-3 text-sm text-[#44474e] md:text-[15px]">
                  <span>{trendScaleLabels[trendScale]}</span>
                  <span className="text-[#f0b429]">/</span>
                  <span>{familyLabels[familyFilter]}</span>
                  <span className="text-[#f0b429]">/</span>
                  <span>{statusLabels[statusFilter]}</span>
                  <span className="text-[#f0b429]">/</span>
                  <span>{selectedRangeNote}</span>
                </div>
              </div>
            </div>
            <div className="flex flex-wrap gap-3">
              <div className="inline-flex items-center gap-3 bg-[#edf4fb] px-3.5 py-1.5 text-sm text-[#00468c] outline outline-1 outline-[#cfe0f4]/75">
                <span className="h-2.5 w-2.5 rounded-[999px] bg-[#005db6]" />
                <span className="font-medium">{deliveredCount} delivered</span>
              </div>
              <div className="inline-flex items-center gap-3 bg-[#fcf5e8] px-3.5 py-1.5 text-sm text-[#8a5a00] outline outline-1 outline-[#edd9b0]/75">
                <span className="h-2.5 w-2.5 rounded-[999px] bg-[#f0b429]" />
                <span className="font-medium">{openCount} still open</span>
              </div>
              <div className="inline-flex items-center gap-3 bg-[#edf1f5] px-3.5 py-1.5 text-sm text-[#1d3047] outline outline-1 outline-[#d4dde8]/75">
                <span className="h-2.5 w-2.5 rounded-[999px] bg-[#002147]" />
                <span className="font-medium">{deliveryRate}% delivery rate</span>
              </div>
            </div>
          </div>

          <div className="self-start w-full max-w-[760px] space-y-3 xl:justify-self-end">
            <ReportingScopePanel
              fields={[
                {
                  label: 'Time range',
                  options: timeRangeOptions,
                  placeholder: 'Time range',
                  value: timeRange,
                  onValueChange: (value) => {
                    setTimeRange(value as ReportingTimeRange)
                    setInpatientComparisonMonthKey('')
                    setOutpatientComparisonMonthKey('')
                    setProcedureComparisonMonthKey('')
                  },
                  triggerClassName: 'text-[0.95rem]',
                },
                {
                  label: 'Ending period',
                  options: reportingPeriodOptions,
                  placeholder: 'Ending period',
                  value: effectivePeriodId,
                  onValueChange: (value) => {
                    setPeriodId(value)
                    setInpatientComparisonMonthKey('')
                    setOutpatientComparisonMonthKey('')
                    setProcedureComparisonMonthKey('')
                  },
                  triggerClassName: 'text-[0.95rem]',
                },
                {
                  label: 'Service line',
                  options: serviceLineOptions,
                  placeholder: 'Service line',
                  value: familyFilter,
                  onValueChange: (value) => setFamilyFilter(value as FamilyFilter),
                  triggerClassName: 'text-[0.95rem]',
                },
                {
                  label: 'Status',
                  options: statusOptions,
                  placeholder: 'Status',
                  value: statusFilter,
                  onValueChange: (value) => setStatusFilter(value as StatusFilter),
                  triggerClassName: 'text-[0.95rem]',
                },
              ]}
            />

            <div className="rounded-[0.35rem] bg-[#f8fafc] p-4 outline outline-1 outline-[#d9e0e7]/75">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-end">
                <div
                  className="inline-flex rounded-[0.25rem] bg-[#edf1f5] p-1 outline outline-1 outline-[#d4dde8]/75"
                  role="group"
                  aria-label="Trend grouping"
                >
                  {trendScaleOptions.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      aria-pressed={trendScale === option.value}
                      onClick={() => {
                        setTrendScale(option.value)

                        if (option.value === 'monthly') {
                          setInpatientComparisonMonthKey('')
                          setOutpatientComparisonMonthKey('')
                          setProcedureComparisonMonthKey('')
                        }

                        if (timeRange === 'current') {
                          setTimeRange('last8')
                          setInpatientComparisonMonthKey('')
                          setOutpatientComparisonMonthKey('')
                          setProcedureComparisonMonthKey('')
                        }
                      }}
                      className={cn(
                        'h-9 min-w-[96px] rounded-[0.2rem] px-4 text-sm font-semibold transition-colors',
                        trendScale === option.value
                          ? 'bg-[#000a1e] text-white'
                          : 'text-[#44474e] hover:bg-white hover:text-[#000a1e]',
                      )}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </motion.section>

      <motion.section
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: 'easeOut' }}
        className={sectionClass}
      >
        <SectionAmbient />
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[#74777f]">
              Reporting status
            </p>
            <h2 className="mt-2 font-display text-[2rem] text-[#000a1e] md:text-[2.35rem]">
              Submission pulse
            </h2>
          </div>
          <p className="text-sm uppercase tracking-[0.24em] text-[#74777f]">
            {familyLabels[familyFilter]} / {statusLabels[statusFilter]}
          </p>
        </div>

        <div className="relative mt-8 grid gap-6 xl:grid-cols-[280px_280px_minmax(0,1fr)]">
          <div className={cn('space-y-4', chartPanelClass)}>
            <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[#74777f]">
              Distribution
            </p>
            <div className="relative h-[280px]">
              {totalExpected ? (
                <>
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={statusDistribution}
                        dataKey="count"
                        innerRadius={74}
                        outerRadius={108}
                        paddingAngle={2}
                        cornerRadius={4}
                        stroke="rgba(255,255,255,0.96)"
                        strokeWidth={5}
                        isAnimationActive
                        animationDuration={1200}
                        animationEasing="ease-out"
                      >
                        {statusDistribution.map((item) => (
                          <Cell
                            key={item.key}
                            fill={item.fill}
                            fillOpacity={statusFilter === 'all' || statusFilter === item.key ? 1 : 0.2}
                          />
                        ))}
                      </Pie>
                    </PieChart>
                  </ResponsiveContainer>

                  <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
                <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#64748b]">
                  {statusCenterLabel}
                </p>
                    <AnimatedMetric
                      value={statusFocusValue}
                      variant="compact"
                      className="mt-2 block font-display text-[2.6rem] leading-none text-[#000a1e]"
                    />
                <p className="mt-2 text-xs uppercase tracking-[0.22em] text-[#64748b]">
                  {statusFocusRate}% of scope
                </p>
                  </div>
                </>
              ) : (
                <ChartEmptyState message="No reports were scheduled for this view." />
              )}
            </div>
          </div>

          <div className={cn('space-y-3', chartPanelClass)}>
            <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[#74777f]">
              Status ledger
            </p>
            {statusDistribution.map((item, index) => {
              const share = formatShare(item.count, totalExpected)

              return (
                <motion.div
                  key={item.key}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.22, ease: 'easeOut', delay: index * 0.04 }}
                  className={cn(
                    'grid grid-cols-[auto_minmax(0,1fr)_auto_auto] items-center gap-4 border-b border-[#d4dde8] py-3 last:border-b-0 last:pb-0',
                    statusFilter !== 'all' && statusFilter !== item.key && 'opacity-35',
                  )}
                >
                  <span className="h-3 w-3 rounded-full" style={{ backgroundColor: item.fill }} />
                  <span className="text-sm font-medium text-[#44474e]">{item.label}</span>
                  <span className="text-sm text-[#74777f]">{share}%</span>
                  <AnimatedMetric
                    value={item.count}
                    variant="compact"
                    className="text-lg font-semibold text-[#000a1e]"
                  />
                </motion.div>
              )
            })}
          </div>

          <div className={cn('space-y-5', chartPanelClass)}>
            <div className="flex items-end justify-between gap-4">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[#74777f]">
                  {trendScale === 'monthly' ? 'Monthly trend' : 'Weekly trend'}
                </p>
                <h3 className="mt-2 text-2xl font-semibold text-[#000a1e] md:text-3xl">
                  Delivered, open, overdue
                </h3>
              </div>
              <AnimatedMetric
                value={deliveryRate}
                variant="percent"
                className="font-display text-[2rem] leading-none text-[#000a1e]"
              />
            </div>
            <ChartLegend
              items={[
                { label: 'Delivered', color: grayscalePalette.ink },
                { label: 'Open', color: grayscalePalette.steel },
                { label: 'Overdue', color: grayscalePalette.mist, dash: trendScale !== 'monthly' },
              ]}
            />
            <div className="h-[300px]">
              {hasReportingTrendSignal ? (
                <ResponsiveContainer width="100%" height="100%">
                  {trendScale === 'monthly' ? (
                    <BarChart
                      data={reportingTrendSeries}
                      margin={{ top: 12, right: 8, left: -12, bottom: 4 }}
                    >
                      <CartesianGrid strokeDasharray="3 12" stroke={chartGridStroke} vertical={false} />
                      <XAxis
                        dataKey="label"
                        tick={chartTick}
                        axisLine={false}
                        tickLine={false}
                        tickMargin={12}
                      />
                      <YAxis tick={chartTick} axisLine={false} tickLine={false} width={34} />
                      <Tooltip contentStyle={lightTooltipStyle} labelStyle={lightTooltipLabelStyle} itemStyle={lightTooltipItemStyle} cursor={tooltipFillCursor} />
                      <Bar dataKey="delivered" name="Delivered" fill={grayscalePalette.ink} radius={[7, 7, 0, 0]} maxBarSize={34} isAnimationActive animationDuration={1000} animationEasing="ease-out" />
                      <Bar dataKey="open" name="Open" fill={grayscalePalette.steel} radius={[7, 7, 0, 0]} maxBarSize={34} isAnimationActive animationDuration={1200} animationEasing="ease-out" />
                      <Bar dataKey="overdue" name="Overdue" fill={grayscalePalette.mist} radius={[7, 7, 0, 0]} maxBarSize={34} isAnimationActive animationDuration={1400} animationEasing="ease-out" />
                    </BarChart>
                  ) : (
                    <AreaChart
                      data={reportingTrendSeries}
                      margin={{ top: 12, right: 8, left: -12, bottom: 4 }}
                    >
                      <defs>
                        <linearGradient id="reportingDeliveredFill" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#005db6" stopOpacity={0.2} />
                          <stop offset="100%" stopColor="#005db6" stopOpacity={0.02} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 12" stroke={chartGridStroke} vertical={false} />
                      <XAxis
                        dataKey="label"
                        tick={chartTick}
                        axisLine={false}
                        tickLine={false}
                        tickMargin={12}
                      />
                      <YAxis tick={chartTick} axisLine={false} tickLine={false} width={34} />
                      <Tooltip contentStyle={lightTooltipStyle} labelStyle={lightTooltipLabelStyle} itemStyle={lightTooltipItemStyle} cursor={tooltipLineCursor} />
                      <Area
                        type="monotone"
                        dataKey="delivered"
                        name="Delivered"
                        stroke={grayscalePalette.ink}
                        fill="url(#reportingDeliveredFill)"
                        strokeWidth={3}
                        activeDot={{ ...lineActiveDot, fill: grayscalePalette.ink }}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        isAnimationActive
                        animationDuration={1100}
                        animationEasing="ease-out"
                      />
                      <Line
                        type="monotone"
                        dataKey="open"
                        name="Open"
                        stroke={grayscalePalette.steel}
                        strokeWidth={2.5}
                        dot={false}
                        activeDot={{ ...lineActiveDot, fill: grayscalePalette.steel }}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        isAnimationActive
                        animationDuration={1300}
                        animationEasing="ease-out"
                      />
                      <Line
                        type="monotone"
                        dataKey="overdue"
                        name="Overdue"
                        stroke={grayscalePalette.mist}
                        strokeWidth={2.4}
                        strokeDasharray="5 6"
                        dot={false}
                        activeDot={{ ...lineActiveDot, fill: grayscalePalette.mist }}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        isAnimationActive
                        animationDuration={1500}
                        animationEasing="ease-out"
                      />
                    </AreaChart>
                  )}
                </ResponsiveContainer>
              ) : (
                <ChartEmptyState message="No reporting activity has been recorded yet." />
              )}
            </div>
          </div>
        </div>
      </motion.section>

      {showInpatientSection ? (
        <motion.section
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, ease: 'easeOut' }}
          className={sectionClass}
        >
          <SectionAmbient />
          <div className="space-y-8">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">
                  Inpatient
                </p>
                <h2 className="mt-2 font-display text-[2rem] text-slate-950 md:text-[2.35rem]">
                  Ward movement and occupancy
                </h2>
              </div>
              <AnimatedMetric
                value={inpatientAdmissionsTotal}
                variant="compact"
                className="font-display text-[2rem] leading-none text-slate-950"
              />
            </div>

            {showInpatientOccupancyAnalytics ? (
              <ReportingScopePanel
                className="max-w-[360px]"
                fields={[
                  {
                    label: 'Month',
                    options: inpatientComparisonMonthOptions,
                    placeholder: 'Month',
                    value: effectiveInpatientComparisonMonthKey,
                    onValueChange: setInpatientComparisonMonthKey,
                  },
                ]}
              />
            ) : (
              <ReportingScopePanel
                className="max-w-[760px]"
                fields={[
                  {
                    label: 'Ward trend',
                    options: inpatientTrendScopeOptions,
                    placeholder: 'Ward trend',
                    value: inpatientTrendScope,
                    onValueChange: setInpatientTrendScope,
                  },
                ]}
              />
            )}

            <div
              className={cn(
                'grid gap-6',
                showInpatientOccupancyAnalytics ? 'grid-cols-1' : 'xl:grid-cols-2',
              )}
            >
              <div className={cn('space-y-5', chartPanelClass)}>
                <h3 className={chartTitleClass}>
                  Newly admitted vs discharges
                </h3>
                <ChartLegend
                  items={[
                    { label: 'Newly admitted', color: grayscalePalette.ink },
                    { label: 'Discharges', color: grayscalePalette.steel },
                  ]}
                />
                <div className={trendScale === 'monthly' ? 'overflow-x-auto pb-2' : ''}>
                  <div
                    className={trendScale === 'monthly' ? 'h-[430px]' : 'h-[320px]'}
                    style={
                      trendScale === 'monthly'
                        ? {
                            minWidth: getMonthlyComparisonChartMinWidth(
                              inpatientFlowSeries.length,
                              2,
                            ),
                          }
                        : undefined
                    }
                  >
                    {hasInpatientFlowSignal ? (
                      <ResponsiveContainer width="100%" height="100%">
                      {trendScale === 'monthly' ? (
                        <BarChart
                          data={inpatientFlowSeries}
                          margin={{ top: 22, right: 24, left: 0, bottom: 18 }}
                          barGap={5}
                          barCategoryGap="30%"
                        >
                          <CartesianGrid strokeDasharray="3 12" stroke={chartGridStroke} vertical={false} />
                          <XAxis
                            dataKey="label"
                            tick={chartTick}
                            axisLine={false}
                            tickLine={false}
                            tickMargin={16}
                            interval={0}
                            angle={-34}
                            textAnchor="end"
                            height={104}
                            tickFormatter={formatMonthlyComparisonTick}
                          />
                          <YAxis tick={chartTick} axisLine={false} tickLine={false} width={44} />
                          <Tooltip
                            contentStyle={lightTooltipStyle}
                            labelStyle={lightTooltipLabelStyle}
                            itemStyle={lightTooltipItemStyle}
                            cursor={tooltipFillCursor}
                            labelFormatter={formatMonthlyComparisonTooltipLabel}
                          />
                          <Bar dataKey="newAdmissions" name="Newly admitted" fill={grayscalePalette.ink} radius={[7, 7, 0, 0]} maxBarSize={36} isAnimationActive animationDuration={1100} animationEasing="ease-out" />
                          <Bar dataKey="discharges" name="Discharges" fill={grayscalePalette.steel} radius={[7, 7, 0, 0]} maxBarSize={36} isAnimationActive animationDuration={1400} animationEasing="ease-out" />
                        </BarChart>
                      ) : (
                        <LineChart
                          data={inpatientFlowSeries}
                          margin={{ top: 12, right: 8, left: -12, bottom: 4 }}
                        >
                          <CartesianGrid strokeDasharray="3 12" stroke={chartGridStroke} vertical={false} />
                          <XAxis
                            dataKey="label"
                            tick={chartTick}
                            axisLine={false}
                            tickLine={false}
                            tickMargin={12}
                            interval={0}
                            angle={-24}
                            textAnchor="end"
                            height={72}
                          />
                          <YAxis tick={chartTick} axisLine={false} tickLine={false} width={34} />
                          <Tooltip contentStyle={lightTooltipStyle} labelStyle={lightTooltipLabelStyle} itemStyle={lightTooltipItemStyle} cursor={tooltipLineCursor} />
                          <Line type="monotone" dataKey="newAdmissions" name="Newly admitted" stroke={grayscalePalette.ink} strokeWidth={3.4} dot={false} activeDot={{ ...lineActiveDot, fill: grayscalePalette.ink }} strokeLinecap="round" strokeLinejoin="round" isAnimationActive animationDuration={1100} animationEasing="ease-out" />
                          <Line type="monotone" dataKey="discharges" name="Discharges" stroke={grayscalePalette.steel} strokeWidth={2.8} dot={false} activeDot={{ ...lineActiveDot, fill: grayscalePalette.steel }} strokeLinecap="round" strokeLinejoin="round" isAnimationActive animationDuration={1400} animationEasing="ease-out" />
                        </LineChart>
                      )}
                      </ResponsiveContainer>
                    ) : (
                      <ChartEmptyState message="No inpatient admissions or discharges in this view." />
                    )}
                  </div>
                </div>
              </div>

              <div className={cn('space-y-5', chartPanelClass)}>
                <h3 className={chartTitleClass}>
                  Deaths, pressure ulcers, HAI
                </h3>
                <ChartLegend
                  items={[
                    { label: 'Deaths', color: grayscalePalette.slate },
                    { label: 'Pressure ulcers', color: grayscalePalette.ink },
                    { label: 'HAI', color: grayscalePalette.carbon },
                  ]}
                />
                <div className={trendScale === 'monthly' ? 'overflow-x-auto pb-2' : ''}>
                  <div
                    className={trendScale === 'monthly' ? 'h-[430px]' : 'h-[320px]'}
                    style={
                      trendScale === 'monthly'
                        ? {
                            minWidth: getMonthlyComparisonChartMinWidth(
                              inpatientSafetySeries.length,
                              3,
                            ),
                          }
                        : undefined
                    }
                  >
                    {hasInpatientSafetySignal ? (
                      <ResponsiveContainer width="100%" height="100%">
                      {trendScale === 'monthly' ? (
                        <BarChart
                          data={inpatientSafetySeries}
                          margin={{ top: 22, right: 24, left: 0, bottom: 18 }}
                          barGap={5}
                          barCategoryGap="28%"
                        >
                          <CartesianGrid strokeDasharray="3 12" stroke={chartGridStroke} vertical={false} />
                          <XAxis
                            dataKey="label"
                            tick={chartTick}
                            axisLine={false}
                            tickLine={false}
                            tickMargin={16}
                            interval={0}
                            angle={-34}
                            textAnchor="end"
                            height={104}
                            tickFormatter={formatMonthlyComparisonTick}
                          />
                          <YAxis tick={chartTick} axisLine={false} tickLine={false} width={44} />
                          <Tooltip
                            contentStyle={lightTooltipStyle}
                            labelStyle={lightTooltipLabelStyle}
                            itemStyle={lightTooltipItemStyle}
                            cursor={tooltipFillCursor}
                            labelFormatter={formatMonthlyComparisonTooltipLabel}
                          />
                          <Bar dataKey="deaths" name="Deaths" fill={grayscalePalette.slate} radius={[7, 7, 0, 0]} maxBarSize={32} isAnimationActive animationDuration={1000} animationEasing="ease-out" />
                          <Bar dataKey="ulcers" name="New pressure ulcers" fill={grayscalePalette.ink} radius={[7, 7, 0, 0]} maxBarSize={32} isAnimationActive animationDuration={1200} animationEasing="ease-out" />
                          <Bar dataKey="hai" name="Total HAI" fill={grayscalePalette.carbon} radius={[7, 7, 0, 0]} maxBarSize={32} isAnimationActive animationDuration={1400} animationEasing="ease-out" />
                        </BarChart>
                      ) : (
                        <LineChart
                          data={inpatientSafetySeries}
                          margin={{ top: 12, right: 8, left: -12, bottom: 4 }}
                        >
                          <CartesianGrid strokeDasharray="3 12" stroke={chartGridStroke} vertical={false} />
                          <XAxis dataKey="label" tick={chartTick} axisLine={false} tickLine={false} tickMargin={12} />
                          <YAxis tick={chartTick} axisLine={false} tickLine={false} width={34} />
                          <Tooltip contentStyle={lightTooltipStyle} labelStyle={lightTooltipLabelStyle} itemStyle={lightTooltipItemStyle} cursor={tooltipLineCursor} />
                          <Line type="monotone" dataKey="deaths" name="Deaths" stroke={grayscalePalette.slate} strokeWidth={3} dot={false} activeDot={{ ...lineActiveDot, fill: grayscalePalette.slate }} strokeLinecap="round" strokeLinejoin="round" isAnimationActive animationDuration={1000} animationEasing="ease-out" />
                          <Line type="monotone" dataKey="ulcers" name="New pressure ulcers" stroke={grayscalePalette.ink} strokeWidth={2.7} dot={false} activeDot={{ ...lineActiveDot, fill: grayscalePalette.ink }} strokeLinecap="round" strokeLinejoin="round" isAnimationActive animationDuration={1200} animationEasing="ease-out" />
                          <Line type="monotone" dataKey="hai" name="Total HAI" stroke={grayscalePalette.carbon} strokeWidth={2.7} dot={false} activeDot={{ ...lineActiveDot, fill: grayscalePalette.carbon }} strokeLinecap="round" strokeLinejoin="round" isAnimationActive animationDuration={1400} animationEasing="ease-out" />
                        </LineChart>
                      )}
                      </ResponsiveContainer>
                    ) : (
                      <ChartEmptyState message="No inpatient safety events in this view." />
                    )}
                  </div>
                </div>
              </div>
            </div>

            {showInpatientOccupancyAnalytics ? (
                <div className={cn('space-y-5', chartPanelClass)}>
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <h3 className={chartTitleClass}>
                      BOR / BTR / ALOS
                    </h3>
                    <div className="w-full min-w-0 sm:max-w-[280px]">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#74777f]">
                        BOR/BTR/ALOS scope
                      </p>
                      <Select
                        value={inpatientOccupancyScope}
                        onValueChange={setInpatientOccupancyScope}
                      >
                        <SelectTrigger className="mt-2 h-10 min-w-0 rounded-[0.25rem] border-[#d9e0e7] bg-[#ffffff] px-3.5 text-left text-[#000a1e] shadow-none focus:ring-0 hover:border-[#c9d4e2]">
                          <SelectValue
                            placeholder="BOR/BTR/ALOS scope"
                            className="block min-w-0 overflow-hidden text-ellipsis whitespace-nowrap"
                          />
                        </SelectTrigger>
                        <SelectContent side="bottom" align="end" sideOffset={10}>
                          {inpatientOccupancyScopeOptions.map((option) => (
                            <SelectItem key={option.value} value={option.value}>
                              {option.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <ChartLegend
                    items={[
                      { label: 'BOR %', color: grayscalePalette.ink },
                      { label: 'BTR', color: grayscalePalette.slate },
                      { label: 'ALOS', color: grayscalePalette.cloud },
                    ]}
                  />
                  <div className="h-[360px]">
                    {hasInpatientOccupancySignal ? (
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart
                          data={inpatientOccupancySeries}
                          margin={{ top: 18, right: 24, left: 0, bottom: 12 }}
                        >
                          <CartesianGrid strokeDasharray="3 12" stroke={chartGridStroke} vertical={false} />
                          <XAxis
                            dataKey="label"
                            tick={chartTick}
                            axisLine={false}
                            tickLine={false}
                            tickMargin={12}
                          />
                          <YAxis tick={chartTick} axisLine={false} tickLine={false} width={44} />
                          <Tooltip
                            contentStyle={lightTooltipStyle}
                            labelStyle={lightTooltipLabelStyle}
                            itemStyle={lightTooltipItemStyle}
                            cursor={tooltipLineCursor}
                            labelFormatter={formatChartTooltipLabel}
                          />
                          <Line type="monotone" dataKey="bor" name="BOR %" stroke={grayscalePalette.ink} strokeWidth={3.2} dot={false} activeDot={{ ...lineActiveDot, fill: grayscalePalette.ink }} strokeLinecap="round" strokeLinejoin="round" isAnimationActive animationDuration={1100} animationEasing="ease-out" />
                          <Line type="monotone" dataKey="btr" name="BTR" stroke={grayscalePalette.slate} strokeWidth={2.6} dot={false} activeDot={{ ...lineActiveDot, fill: grayscalePalette.slate }} strokeLinecap="round" strokeLinejoin="round" isAnimationActive animationDuration={1300} animationEasing="ease-out" />
                          <Line type="monotone" dataKey="alos" name="ALOS" stroke={grayscalePalette.cloud} strokeWidth={2.6} dot={false} activeDot={{ ...lineActiveDot, fill: grayscalePalette.cloud }} strokeLinecap="round" strokeLinejoin="round" isAnimationActive animationDuration={1500} animationEasing="ease-out" />
                        </LineChart>
                      </ResponsiveContainer>
                    ) : (
                      <ChartEmptyState message={occupancyEmptyMessage} />
                    )}
                  </div>
                </div>
            ) : null}
          </div>
        </motion.section>
      ) : null}

      {showOutpatientSection ? (
        <motion.section
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, ease: 'easeOut' }}
          className={sectionClass}
        >
          <SectionAmbient />
          <div className="space-y-8">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">
                  Outpatient
                </p>
                <h2 className="mt-2 font-display text-[2rem] text-slate-950 md:text-[2.35rem]">
                  Clinic flow and access
                </h2>
              </div>
              <AnimatedMetric
                value={outpatientSeenTotal}
                variant="compact"
                className="font-display text-[2rem] leading-none text-slate-950"
              />
            </div>

            <div className="space-y-6">
              {trendScale === 'monthly' ? (
                <ReportingScopePanel
                  className="max-w-[360px]"
                  fields={[
                    {
                      label: 'Month',
                      options: outpatientComparisonMonthOptions,
                      placeholder: 'Month',
                      value: effectiveOutpatientComparisonMonthKey,
                      onValueChange: setOutpatientComparisonMonthKey,
                    },
                  ]}
                />
              ) : (
                <ReportingScopePanel
                  className="max-w-[420px]"
                  fields={[
                    {
                      label: 'Outpatient trend',
                      options: outpatientTrendScopeOptions,
                      placeholder: 'Outpatient trend',
                      value: outpatientTrendScope,
                      onValueChange: setOutpatientTrendScope,
                    },
                  ]}
                />
              )}

              <div
                className={cn(
                  'grid gap-6',
                  trendScale === 'monthly' ? 'grid-cols-1' : 'xl:grid-cols-2',
                )}
              >
              <div className={cn('space-y-5', chartPanelClass)}>
                <h3 className={chartTitleClass}>
                  Seen vs not seen same day
                </h3>
                <ChartLegend
                  items={[
                    { label: 'Seen', color: grayscalePalette.ink },
                    { label: 'Not seen same day', color: grayscalePalette.steel },
                  ]}
                />
                <div className={trendScale === 'monthly' ? outpatientMonthlyScrollClass : ''}>
                  <div
                    className={trendScale === 'monthly' ? 'h-[460px]' : 'h-[300px]'}
                    style={
                      trendScale === 'monthly'
                        ? {
                            minWidth: getOutpatientMonthlyComparisonChartMinWidth(
                              outpatientSeenSeries.length,
                              2,
                            ),
                          }
                        : undefined
                    }
                  >
                    {hasOutpatientSeenSignal ? (
                      <ResponsiveContainer width="100%" height="100%">
                        {trendScale === 'monthly' ? (
                          <BarChart
                            data={outpatientSeenSeries}
                            margin={{ top: 24, right: 28, left: 0, bottom: 26 }}
                            barGap={5}
                            barCategoryGap="30%"
                          >
                          <CartesianGrid strokeDasharray="3 12" stroke={chartGridStroke} vertical={false} />
                          <XAxis
                            dataKey="label"
                            tick={chartTick}
                            axisLine={false}
                            tickLine={false}
                            tickMargin={16}
                            interval={0}
                            angle={-28}
                            textAnchor="end"
                            height={116}
                            tickFormatter={formatOutpatientMonthlyComparisonTick}
                          />
                          <YAxis tick={chartTick} axisLine={false} tickLine={false} width={44} />
                          <Tooltip
                            contentStyle={lightTooltipStyle}
                            labelStyle={lightTooltipLabelStyle}
                            itemStyle={lightTooltipItemStyle}
                            cursor={tooltipFillCursor}
                            labelFormatter={formatMonthlyComparisonTooltipLabel}
                          />
                          <Bar dataKey="seen" name="Seen" fill={grayscalePalette.ink} radius={[7, 7, 0, 0]} maxBarSize={36} isAnimationActive animationDuration={1100} animationEasing="ease-out" />
                          <Bar dataKey="notSeenSameDay" name="Not seen same day" fill={grayscalePalette.steel} radius={[7, 7, 0, 0]} maxBarSize={36} isAnimationActive animationDuration={1400} animationEasing="ease-out" />
                        </BarChart>
                      ) : (
                        <AreaChart data={outpatientSeenSeries} margin={{ top: 12, right: 8, left: -12, bottom: 4 }}>
                          <defs>
                            <linearGradient id="outpatientSeenFill" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="0%" stopColor="#005db6" stopOpacity={0.18} />
                              <stop offset="100%" stopColor="#005db6" stopOpacity={0.02} />
                            </linearGradient>
                          </defs>
                          <CartesianGrid strokeDasharray="3 12" stroke={chartGridStroke} vertical={false} />
                          <XAxis dataKey="label" tick={chartTick} axisLine={false} tickLine={false} tickMargin={12} />
                          <YAxis tick={chartTick} axisLine={false} tickLine={false} width={34} />
                          <Tooltip contentStyle={lightTooltipStyle} labelStyle={lightTooltipLabelStyle} itemStyle={lightTooltipItemStyle} cursor={tooltipLineCursor} />
                          <Area type="monotone" dataKey="seen" name="Seen" stroke={grayscalePalette.ink} fill="url(#outpatientSeenFill)" strokeWidth={3} activeDot={{ ...lineActiveDot, fill: grayscalePalette.ink }} strokeLinecap="round" strokeLinejoin="round" isAnimationActive animationDuration={1100} animationEasing="ease-out" />
                          <Line type="monotone" dataKey="notSeenSameDay" name="Not seen same day" stroke={grayscalePalette.steel} strokeWidth={2.6} dot={false} activeDot={{ ...lineActiveDot, fill: grayscalePalette.steel }} strokeLinecap="round" strokeLinejoin="round" isAnimationActive animationDuration={1400} animationEasing="ease-out" />
                        </AreaChart>
                      )}
                      </ResponsiveContainer>
                    ) : (
                      <ChartEmptyState message="No outpatient same-day data in this view." />
                    )}
                  </div>
                </div>
              </div>

              <div className={cn('space-y-5', chartPanelClass)}>
                <h3 className={chartTitleClass}>
                  Total seen, new vs follow-up
                </h3>
                <ChartLegend
                  items={[
                    { label: 'Total seen', color: grayscalePalette.carbon },
                    { label: 'New', color: grayscalePalette.ink },
                    { label: 'Follow-up', color: grayscalePalette.cloud },
                  ]}
                />
                <div className={trendScale === 'monthly' ? outpatientMonthlyScrollClass : ''}>
                  <div
                    className={trendScale === 'monthly' ? 'h-[460px]' : 'h-[300px]'}
                    style={
                      trendScale === 'monthly'
                        ? {
                            minWidth: getOutpatientMonthlyComparisonChartMinWidth(
                              outpatientVolumeMix.length,
                              3,
                            ),
                          }
                        : undefined
                    }
                  >
                    {hasOutpatientMixSignal ? (
                      <ResponsiveContainer width="100%" height="100%">
                        {trendScale === 'monthly' ? (
                          <BarChart
                            data={outpatientVolumeMix}
                            margin={{ top: 24, right: 28, left: 0, bottom: 26 }}
                            barGap={5}
                            barCategoryGap="28%"
                          >
                            <CartesianGrid strokeDasharray="3 12" stroke={chartGridStroke} vertical={false} />
                            <XAxis
                              dataKey="label"
                              tick={chartTick}
                              axisLine={false}
                              tickLine={false}
                              tickMargin={16}
                              interval={0}
                              angle={-28}
                              textAnchor="end"
                              height={116}
                              tickFormatter={formatOutpatientMonthlyComparisonTick}
                            />
                            <YAxis tick={chartTick} axisLine={false} tickLine={false} width={44} />
                            <Tooltip
                              contentStyle={lightTooltipStyle}
                              labelStyle={lightTooltipLabelStyle}
                              itemStyle={lightTooltipItemStyle}
                              cursor={tooltipFillCursor}
                              labelFormatter={formatMonthlyComparisonTooltipLabel}
                            />
                            <Bar dataKey="totalSeen" name="Total seen" fill={grayscalePalette.carbon} radius={[7, 7, 0, 0]} maxBarSize={32} isAnimationActive animationDuration={1000} animationEasing="ease-out" />
                            <Bar dataKey="newPatients" name="New" fill={grayscalePalette.ink} radius={[7, 7, 0, 0]} maxBarSize={32} isAnimationActive animationDuration={1200} animationEasing="ease-out" />
                            <Bar dataKey="followUp" name="Follow-up" fill={grayscalePalette.cloud} radius={[7, 7, 0, 0]} maxBarSize={32} isAnimationActive animationDuration={1400} animationEasing="ease-out" />
                          </BarChart>
                        ) : (
                          <AreaChart data={outpatientVolumeMix} margin={{ top: 12, right: 8, left: -12, bottom: 4 }}>
                            <defs>
                              <linearGradient id="outpatientVolumeFill" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor="#315f8c" stopOpacity={0.16} />
                                <stop offset="100%" stopColor="#315f8c" stopOpacity={0.02} />
                              </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 12" stroke={chartGridStroke} vertical={false} />
                            <XAxis dataKey="label" tick={chartTick} axisLine={false} tickLine={false} tickMargin={12} />
                            <YAxis tick={chartTick} axisLine={false} tickLine={false} width={34} />
                            <Tooltip contentStyle={lightTooltipStyle} labelStyle={lightTooltipLabelStyle} itemStyle={lightTooltipItemStyle} cursor={tooltipLineCursor} />
                            <Area type="monotone" dataKey="totalSeen" name="Total seen" stroke={grayscalePalette.carbon} fill="url(#outpatientVolumeFill)" strokeWidth={3} activeDot={{ ...lineActiveDot, fill: grayscalePalette.carbon }} strokeLinecap="round" strokeLinejoin="round" isAnimationActive animationDuration={1000} animationEasing="ease-out" />
                            <Line type="monotone" dataKey="newPatients" name="New" stroke={grayscalePalette.ink} strokeWidth={2.6} dot={false} activeDot={{ ...lineActiveDot, fill: grayscalePalette.ink }} strokeLinecap="round" strokeLinejoin="round" isAnimationActive animationDuration={1200} animationEasing="ease-out" />
                            <Line type="monotone" dataKey="followUp" name="Follow-up" stroke={grayscalePalette.cloud} strokeWidth={2.6} dot={false} activeDot={{ ...lineActiveDot, fill: grayscalePalette.cloud }} strokeLinecap="round" strokeLinejoin="round" isAnimationActive animationDuration={1400} animationEasing="ease-out" />
                          </AreaChart>
                        )}
                      </ResponsiveContainer>
                    ) : (
                      <ChartEmptyState message="No outpatient clinic volume in this view." />
                    )}
                  </div>
                </div>
              </div>
            </div>

              <div
                className={cn(
                  'grid gap-6 border-t border-white/60 pt-8',
                  trendScale === 'monthly' ? 'grid-cols-1' : 'xl:grid-cols-2',
                )}
              >
              <div className={cn('space-y-5', chartPanelClass)}>
                <h3 className={chartTitleClass}>
                  {trendScale === 'monthly' ? 'Follow-up wait time by department' : 'Follow-up wait time trend'}
                </h3>
                <div className={trendScale === 'monthly' ? outpatientMonthlyScrollClass : ''}>
                  <div
                    className={trendScale === 'monthly' ? 'h-[430px]' : 'h-[260px]'}
                    style={
                      trendScale === 'monthly'
                        ? {
                            minWidth: getOutpatientMonthlyComparisonChartMinWidth(
                              outpatientFollowUpWaitSeries.length,
                              1,
                            ),
                          }
                        : undefined
                    }
                  >
                    {hasFollowUpWaitSignal ? (
                      <ResponsiveContainer width="100%" height="100%">
                        {trendScale === 'monthly' ? (
                          <BarChart
                            data={outpatientFollowUpWaitSeries}
                            margin={{ top: 24, right: 28, left: 0, bottom: 26 }}
                            barCategoryGap="34%"
                          >
                          <CartesianGrid strokeDasharray="3 12" stroke={chartGridStroke} vertical={false} />
                          <XAxis
                            dataKey="label"
                            tick={chartTick}
                            axisLine={false}
                            tickLine={false}
                            tickMargin={16}
                            interval={0}
                            angle={-28}
                            textAnchor="end"
                            height={116}
                            tickFormatter={formatOutpatientMonthlyComparisonTick}
                          />
                          <YAxis tick={chartTick} axisLine={false} tickLine={false} width={44} />
                          <Tooltip
                            contentStyle={lightTooltipStyle}
                            labelStyle={lightTooltipLabelStyle}
                            itemStyle={lightTooltipItemStyle}
                            cursor={tooltipFillCursor}
                            labelFormatter={formatMonthlyComparisonTooltipLabel}
                          />
                          <Bar dataKey="wait" name="Follow-up wait (months)" fill={grayscalePalette.ink} radius={[7, 7, 0, 0]} maxBarSize={38} isAnimationActive animationDuration={1200} animationEasing="ease-out" />
                        </BarChart>
                      ) : (
                        <LineChart data={outpatientFollowUpWaitSeries} margin={{ top: 12, right: 8, left: -12, bottom: 4 }}>
                          <CartesianGrid strokeDasharray="3 12" stroke={chartGridStroke} vertical={false} />
                          <XAxis dataKey="label" tick={chartTick} axisLine={false} tickLine={false} tickMargin={12} />
                          <YAxis tick={chartTick} axisLine={false} tickLine={false} width={34} />
                          <Tooltip contentStyle={lightTooltipStyle} labelStyle={lightTooltipLabelStyle} itemStyle={lightTooltipItemStyle} cursor={tooltipLineCursor} />
                          <Line type="monotone" dataKey="wait" name="Follow-up wait (months)" stroke={grayscalePalette.ink} strokeWidth={3} dot={false} activeDot={{ ...lineActiveDot, fill: grayscalePalette.ink }} strokeLinecap="round" strokeLinejoin="round" isAnimationActive animationDuration={1200} animationEasing="ease-out" />
                        </LineChart>
                      )}
                      </ResponsiveContainer>
                    ) : (
                      <ChartEmptyState message="No follow-up wait data in this view." />
                    )}
                  </div>
                </div>
              </div>

              <div className={cn('space-y-5', chartPanelClass)}>
                <h3 className={chartTitleClass}>
                  {trendScale === 'monthly' ? 'Clinic start time by department' : 'Clinic start time trend'}
                </h3>
                <div className={trendScale === 'monthly' ? outpatientMonthlyScrollClass : ''}>
                  <div
                    className={trendScale === 'monthly' ? 'h-[430px]' : 'h-[260px]'}
                    style={
                      trendScale === 'monthly'
                        ? {
                            minWidth: getOutpatientMonthlyComparisonChartMinWidth(
                              outpatientClinicStartSeries.length,
                              1,
                            ),
                          }
                        : undefined
                    }
                  >
                    {hasClinicStartSignal ? (
                      <ResponsiveContainer width="100%" height="100%">
                        {trendScale === 'monthly' ? (
                          <BarChart
                            data={outpatientClinicStartSeries}
                            margin={{ top: 24, right: 28, left: 0, bottom: 26 }}
                            barCategoryGap="34%"
                          >
                          <CartesianGrid strokeDasharray="3 12" stroke={chartGridStroke} vertical={false} />
                          <XAxis
                            dataKey="label"
                            tick={chartTick}
                            axisLine={false}
                            tickLine={false}
                            tickMargin={16}
                            interval={0}
                            angle={-28}
                            textAnchor="end"
                            height={116}
                            tickFormatter={formatOutpatientMonthlyComparisonTick}
                          />
                          <YAxis tickFormatter={formatMinutesAsTime} tick={chartTick} axisLine={false} tickLine={false} width={44} />
                          <Tooltip
                            contentStyle={lightTooltipStyle}
                            labelStyle={lightTooltipLabelStyle}
                            itemStyle={lightTooltipItemStyle}
                            cursor={tooltipFillCursor}
                            formatter={(value) => [formatMinutesAsTime(Number(value)), 'Start time']}
                            labelFormatter={formatMonthlyComparisonTooltipLabel}
                          />
                          <Bar dataKey="startMinutes" name="Clinic start" fill={grayscalePalette.steel} radius={[7, 7, 0, 0]} maxBarSize={38} isAnimationActive animationDuration={1200} animationEasing="ease-out" />
                        </BarChart>
                      ) : (
                        <LineChart data={outpatientClinicStartSeries} margin={{ top: 12, right: 8, left: -12, bottom: 4 }}>
                          <CartesianGrid strokeDasharray="3 12" stroke={chartGridStroke} vertical={false} />
                          <XAxis dataKey="label" tick={chartTick} axisLine={false} tickLine={false} tickMargin={12} />
                          <YAxis tickFormatter={formatMinutesAsTime} tick={chartTick} axisLine={false} tickLine={false} width={44} />
                          <Tooltip contentStyle={lightTooltipStyle} labelStyle={lightTooltipLabelStyle} itemStyle={lightTooltipItemStyle} cursor={tooltipLineCursor} formatter={(value) => [formatMinutesAsTime(Number(value)), 'Start time']} />
                          <Line type="monotone" dataKey="startMinutes" name="Clinic start" stroke={grayscalePalette.steel} strokeWidth={3} dot={false} activeDot={{ ...lineActiveDot, fill: grayscalePalette.steel }} strokeLinecap="round" strokeLinejoin="round" isAnimationActive animationDuration={1200} animationEasing="ease-out" />
                        </LineChart>
                      )}
                      </ResponsiveContainer>
                    ) : (
                      <ChartEmptyState message="No clinic start time data in this view." />
                    )}
                  </div>
                </div>
              </div>

              </div>
            </div>

            <div className={cn('space-y-5', chartPanelClass)}>
              <h3 className={chartTitleClass}>
                {trendScale === 'monthly'
                  ? 'Senior physician availability by department'
                  : 'Senior physician availability trend'}
              </h3>
              <ChartLegend items={outpatientAvailabilityLegend} />
              <div className={trendScale === 'monthly' ? outpatientMonthlyScrollClass : ''}>
                <div
                  className={trendScale === 'monthly' ? 'h-[430px]' : 'h-[300px]'}
                  style={
                    trendScale === 'monthly'
                      ? {
                          minWidth: getOutpatientMonthlyComparisonChartMinWidth(
                            outpatientAvailabilitySeries.length,
                            3,
                          ),
                        }
                      : undefined
                  }
                >
                  {hasAvailabilitySignal ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart
                        data={outpatientAvailabilitySeries}
                        margin={
                          trendScale === 'monthly'
                            ? { top: 24, right: 28, left: 0, bottom: 26 }
                            : { top: 14, right: 24, left: 0, bottom: 8 }
                        }
                        barGap={5}
                        barCategoryGap={trendScale === 'monthly' ? '28%' : '24%'}
                      >
                        <CartesianGrid strokeDasharray="3 12" stroke={chartGridStroke} vertical={false} />
                        <XAxis
                          dataKey="label"
                          tick={chartTick}
                          axisLine={false}
                          tickLine={false}
                          tickMargin={trendScale === 'monthly' ? 16 : 12}
                          interval={0}
                          angle={trendScale === 'monthly' ? -28 : 0}
                          textAnchor={trendScale === 'monthly' ? 'end' : 'middle'}
                          height={trendScale === 'monthly' ? 116 : 42}
                          tickFormatter={
                            trendScale === 'monthly'
                              ? formatOutpatientMonthlyComparisonTick
                              : undefined
                          }
                        />
                        <YAxis
                          tick={chartTick}
                          axisLine={false}
                          tickLine={false}
                          width={44}
                          allowDecimals={false}
                        />
                        <Tooltip
                          contentStyle={lightTooltipStyle}
                          labelStyle={lightTooltipLabelStyle}
                          itemStyle={lightTooltipItemStyle}
                          cursor={tooltipFillCursor}
                          formatter={formatAvailabilityTooltipValue}
                          labelFormatter={
                            trendScale === 'monthly'
                              ? formatMonthlyComparisonTooltipLabel
                              : formatChartTooltipLabel
                          }
                        />
                        {OUTPATIENT_AVAILABILITY_STATUSES.map((status, index) => (
                          <Bar
                            key={status.key}
                            dataKey={status.key}
                            name={status.label}
                            fill={outpatientAvailabilityPalette[status.key]}
                            radius={[7, 7, 0, 0]}
                            maxBarSize={34}
                            isAnimationActive
                            animationDuration={1000 + index * 180}
                            animationEasing="ease-out"
                          />
                        ))}
                      </BarChart>
                    </ResponsiveContainer>
                  ) : (
                    <ChartEmptyState message="No physician availability data in this view." />
                  )}
                </div>
              </div>
            </div>
          </div>
        </motion.section>
      ) : null}

      {showProcedureSection ? (
        <motion.section
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, ease: 'easeOut' }}
          className={sectionClass}
        >
          <SectionAmbient />
          <div className="space-y-8">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">
                  Procedure
                </p>
                <h2 className="mt-2 font-display text-[2rem] text-slate-950 md:text-[2.35rem]">
                  Lab and endoscopy totals
                </h2>
              </div>
              <AnimatedMetric
                value={procedureHeaderTotal}
                variant="compact"
                className="font-display text-[2rem] leading-none text-slate-950"
              />
            </div>

            {trendScale === 'monthly' ? (
              <ReportingScopePanel
                className="max-w-[360px]"
                fields={[
                  {
                    label: 'Month',
                    options: procedureComparisonMonthOptions,
                    placeholder: 'Month',
                    value: effectiveProcedureComparisonMonthKey,
                    onValueChange: setProcedureComparisonMonthKey,
                  },
                ]}
              />
            ) : (
              <ReportingScopePanel
                className="max-w-[460px]"
                fields={[
                  {
                    label: 'Procedure trend',
                    options: procedureTrendScopeOptions,
                    placeholder: 'Procedure trend',
                    value: procedureTrendScope,
                    onValueChange: setProcedureTrendScope,
                  },
                ]}
              />
            )}

            <div className={cn('space-y-5', chartPanelClass)}>
              <h3 className={chartTitleClass}>
                {trendScale === 'monthly'
                  ? 'Procedure throughput by service'
                  : 'Procedure throughput trend'}
              </h3>
              {trendScale === 'monthly' ? (
                <ChartLegend
                  items={PROCEDURE_SERVICE_DEFINITIONS.map((service) => ({
                    label: service.label,
                    color: procedureServiceColorMap[service.id],
                  }))}
                />
              ) : null}
              <div className={trendScale === 'monthly' ? outpatientMonthlyScrollClass : ''}>
                <div
                  className={trendScale === 'monthly' ? 'h-[460px]' : 'h-[320px]'}
                  style={
                    trendScale === 'monthly'
                      ? {
                          minWidth: getOutpatientMonthlyComparisonChartMinWidth(
                            procedureMainSeries.length,
                            1,
                          ),
                        }
                      : undefined
                  }
                >
                  {hasProcedureSignal ? (
                    <ResponsiveContainer width="100%" height="100%">
                      {trendScale === 'monthly' ? (
                        <BarChart
                          data={procedureMainSeries}
                          margin={{ top: 24, right: 28, left: 0, bottom: 26 }}
                          barCategoryGap="34%"
                        >
                          <CartesianGrid strokeDasharray="3 12" stroke={chartGridStroke} vertical={false} />
                          <XAxis
                            dataKey="label"
                            tick={chartTick}
                            axisLine={false}
                            tickLine={false}
                            tickMargin={16}
                            interval={0}
                            angle={-28}
                            textAnchor="end"
                            height={116}
                            tickFormatter={formatProcedureServiceTick}
                          />
                          <YAxis tick={chartTick} axisLine={false} tickLine={false} width={44} />
                          <Tooltip
                            contentStyle={lightTooltipStyle}
                            labelStyle={lightTooltipLabelStyle}
                            itemStyle={lightTooltipItemStyle}
                            cursor={tooltipFillCursor}
                            labelFormatter={formatProcedureServiceTooltipLabel}
                          />
                          <Bar dataKey="total" name="Total throughput" radius={[7, 7, 0, 0]} maxBarSize={42} isAnimationActive animationDuration={1200} animationEasing="ease-out">
                            {procedureMainSeries.map((item) => (
                              <Cell key={item.serviceId} fill={procedureServiceColorMap[item.serviceId]} />
                            ))}
                          </Bar>
                        </BarChart>
                      ) : (
                        <AreaChart data={procedureMainSeries} margin={{ top: 14, right: 24, left: 0, bottom: 8 }}>
                          <defs>
                            <linearGradient id="procedureThroughputFill" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="0%" stopColor="#005db6" stopOpacity={0.18} />
                              <stop offset="100%" stopColor="#005db6" stopOpacity={0.02} />
                            </linearGradient>
                          </defs>
                          <CartesianGrid strokeDasharray="3 12" stroke={chartGridStroke} vertical={false} />
                          <XAxis dataKey="label" tick={chartTick} axisLine={false} tickLine={false} tickMargin={12} />
                          <YAxis tick={chartTick} axisLine={false} tickLine={false} width={44} />
                          <Tooltip
                            contentStyle={lightTooltipStyle}
                            labelStyle={lightTooltipLabelStyle}
                            itemStyle={lightTooltipItemStyle}
                            cursor={tooltipLineCursor}
                            labelFormatter={formatChartTooltipLabel}
                          />
                          <Area
                            type="monotone"
                            dataKey="total"
                            name="Total throughput"
                            stroke={grayscalePalette.ink}
                            fill="url(#procedureThroughputFill)"
                            strokeWidth={3}
                            activeDot={{ ...lineActiveDot, fill: grayscalePalette.ink }}
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            isAnimationActive
                            animationDuration={1100}
                            animationEasing="ease-out"
                          />
                        </AreaChart>
                      )}
                    </ResponsiveContainer>
                  ) : (
                    <ChartEmptyState message="No procedure throughput in this view." />
                  )}
                </div>
              </div>
            </div>

            {showDialysisDetail || showEndoscopyDetail ? (
              <div className="grid gap-6 border-t border-white/60 pt-8 xl:grid-cols-2">
                {showDialysisDetail ? (
              <div className={cn('space-y-5', chartPanelClass)}>
                <div className="flex items-start justify-between gap-4">
                  <h3 className={chartTitleClass}>
                    Dialysis acute/chronic split
                  </h3>
                  <AnimatedMetric
                    value={dialysisTotal}
                    variant="compact"
                    className="font-display text-[2rem] leading-none text-slate-950"
                  />
                </div>
                <ChartLegend
                  items={dialysisMix.map((item) => ({
                    label: item.label,
                    color: procedureMixColorMap[item.key as keyof typeof procedureMixColorMap],
                  }))}
                />
                <div className="h-[300px]">
                  {hasDialysisMixSignal ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={dialysisMix} margin={{ top: 14, right: 24, left: 0, bottom: 8 }}>
                        <CartesianGrid strokeDasharray="3 12" stroke={chartGridStroke} vertical={false} />
                        <XAxis dataKey="label" tick={chartTick} axisLine={false} tickLine={false} tickMargin={12} />
                        <YAxis tick={chartTick} axisLine={false} tickLine={false} width={44} allowDecimals={false} />
                        <Tooltip
                          contentStyle={lightTooltipStyle}
                          labelStyle={lightTooltipLabelStyle}
                          itemStyle={lightTooltipItemStyle}
                          cursor={tooltipFillCursor}
                          labelFormatter={formatProcedureMixTooltipLabel}
                        />
                        <Bar dataKey="value" name="Dialysis" radius={[7, 7, 0, 0]} maxBarSize={42} isAnimationActive animationDuration={1200} animationEasing="ease-out">
                          {dialysisMix.map((item) => (
                            <Cell key={item.key} fill={procedureMixColorMap[item.key as keyof typeof procedureMixColorMap]} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  ) : (
                    <ChartEmptyState message="No dialysis data in this selected range." />
                  )}
                </div>
              </div>
                ) : null}

                {showEndoscopyDetail ? (
              <div className={cn('space-y-5', chartPanelClass)}>
                <h3 className={chartTitleClass}>
                  Endoscopy procedure mix
                </h3>
                <ChartLegend
                  items={endoscopyMix.map((item) => ({
                    label: item.label,
                    color: procedureMixColorMap[item.key as keyof typeof procedureMixColorMap],
                  }))}
                />
                <div className="h-[300px]">
                  {hasEndoscopyMixSignal ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={endoscopyMix} margin={{ top: 14, right: 24, left: 0, bottom: 8 }}>
                        <CartesianGrid strokeDasharray="3 12" stroke={chartGridStroke} vertical={false} />
                        <XAxis dataKey="label" tick={chartTick} axisLine={false} tickLine={false} tickMargin={12} />
                        <YAxis tick={chartTick} axisLine={false} tickLine={false} width={44} allowDecimals={false} />
                        <Tooltip
                          contentStyle={lightTooltipStyle}
                          labelStyle={lightTooltipLabelStyle}
                          itemStyle={lightTooltipItemStyle}
                          cursor={tooltipFillCursor}
                          labelFormatter={formatProcedureMixTooltipLabel}
                        />
                        <Bar dataKey="value" name="Endoscopy" radius={[7, 7, 0, 0]} maxBarSize={42} isAnimationActive animationDuration={1200} animationEasing="ease-out">
                          {endoscopyMix.map((item) => (
                            <Cell key={item.key} fill={procedureMixColorMap[item.key as keyof typeof procedureMixColorMap]} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  ) : (
                    <ChartEmptyState message="No endoscopy mix in this view." />
                  )}
                </div>
              </div>
                ) : null}
              </div>
            ) : null}
          </div>
        </motion.section>
      ) : null}

    </div>
  )
}
