import {
  type ComponentType,
  type ReactElement,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from 'react'
import { format } from 'date-fns'
import { animate, motion, useReducedMotion } from 'framer-motion'
import { Activity, BedDouble, ChevronDown, Filter, Gauge, RefreshCw, Sparkles, Stethoscope } from 'lucide-react'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Line,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import { ReportingScopePanel } from '@/components/admin/reporting-scope-panel'
import { AnalyticsExportPanel } from '@/components/admin/analytics-export-panel'
import { Delta, DeltaIcon, DeltaValue } from '@/components/delta'
import { Button } from '@/components/ui/button'
import {
  fetchAndCacheDashboardAnalytics,
  getDashboardAnalyticsCacheKey,
  readCachedDashboardAnalytics,
  type AnalyticsQuery,
  type AnalyticsChartMetrics,
  type AnalyticsSummary,
  type AnalyticsWeeklyRow,
  type DashboardAnalyticsPayload,
} from '@/lib/api/analytics'
import { getApiBrowserClient } from '@/lib/api/client'
import { evaluateMetricTarget, type RagStatus } from '@/lib/performance-targets'
import { prefetchRoute } from '@/routes/route-prefetch'
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
  getOccupancyRelevantDepartmentIds,
  getInpatientMonthlyWardComparisonData,
  getInpatientWeeklyCountTrendSeries,
  getOutpatientMonthlyAvailabilityDepartmentComparisonData,
  getOutpatientMonthlyDepartmentComparisonData,
  getOutpatientWeeklyAvailabilitySeries,
  getOutpatientWeeklyTrendSeries,
  PROCEDURE_DIALYSIS_MIX_DEFINITIONS,
  PROCEDURE_ENDOSCOPY_MIX_DEFINITIONS,
  getProcedureDialysisSplitData,
  getProcedureEndoscopyMixData,
  getProcedureMonthlyServiceComparisonData,
  getProcedureTotalThroughput,
  getProcedureWeeklyTrendSeries,
  getReportForAssignmentPeriod,
  getLockDeadlineNote,
  getReportingPeriodsForRange,
  emptyReportingRangeSummary,
  getReportingRangeSummary,
  getVisibleReportingPeriods,
  OUTPATIENT_AVAILABILITY_STATUSES,
  PROCEDURE_SERVICE_DEFINITIONS,
  resolveDashboardTrendBucket,
  shouldShowInpatientOccupancyAnalytics,
  type DashboardTrendScale,
  type NumericDashboardPoint,
  type OutpatientAvailabilityPoint,
  type OutpatientMetricDefinition,
  type ProcedureMixPoint,
  type ProcedureServicePoint,
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
type DashboardAnalyticsRequestStatus = 'idle' | 'loading' | 'success' | 'error'

type TrendBucket = {
  key: string
  label: string
  periods: ReportingPeriod[]
  periodIds: Set<string>
}

const targetStatusLabel: Record<RagStatus, string> = {
  green: 'Green',
  amber: 'Amber',
  red: 'Red',
  neutral: 'No target',
}

const targetStatusClass: Record<RagStatus, string> = {
  green: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  amber: 'border-amber-200 bg-amber-50 text-amber-700',
  red: 'border-rose-200 bg-rose-50 text-rose-700',
  neutral: 'border-slate-200 bg-slate-50 text-slate-600',
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

function ChartLoadingState({
  message = 'Loading chart data...',
  tone = 'light',
}: {
  message?: string
  tone?: 'light' | 'dark'
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        'flex h-full flex-col items-center justify-center gap-3 rounded-[0.5rem] border border-dashed px-6 text-center shadow-inner',
        tone === 'dark'
          ? 'border-white/12 bg-white/6 text-[#c6d3e4]'
          : 'border-[#d4dde8]/80 bg-[linear-gradient(180deg,#ffffff_0%,#f4f7fb_100%)] text-[#64748b]',
      )}
    >
      <Activity className={cn('h-5 w-5 animate-pulse', tone === 'dark' ? 'text-[#f0b429]' : 'text-[#005db6]')} />
      <p className="max-w-xs text-sm leading-6">{message}</p>
    </div>
  )
}

function ChartFallback({
  emptyMessage,
  isLoading,
  loadingMessage,
}: {
  emptyMessage: string
  isLoading: boolean
  loadingMessage?: string
}) {
  return isLoading ? (
    <ChartLoadingState message={loadingMessage} />
  ) : (
    <ChartEmptyState message={emptyMessage} />
  )
}

function DeferredDashboardSection({
  children,
  eager = false,
  placeholderClassName,
}: {
  children: ReactNode
  eager?: boolean
  placeholderClassName: string
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [hasEnteredViewport, setHasEnteredViewport] = useState(false)

  useEffect(() => {
    if (eager || hasEnteredViewport || !containerRef.current) {
      return
    }

    let mountTimer: number | null = null
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) {
          return
        }

        observer.disconnect()
        // Leave a short input window after the shell becomes interactive. The
        // old two-frame delay started thousands of chart callbacks directly
        // under an immediate navigation click.
        mountTimer = window.setTimeout(() => {
          setHasEnteredViewport(true)
        }, 500)
      },
      { rootMargin: '0px 0px 160px' },
    )

    observer.observe(containerRef.current)

    return () => {
      observer.disconnect()
      if (mountTimer !== null) {
        window.clearTimeout(mountTimer)
      }
    }
  }, [eager, hasEnteredViewport])

  const shouldRender = eager || hasEnteredViewport

  return (
    <div
      ref={containerRef}
      className={cn(!shouldRender && placeholderClassName)}
      style={shouldRender ? { contentVisibility: 'auto' } : undefined}
    >
      {shouldRender ? children : null}
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

function formatMinutesAsTime(value: unknown) {
  if (value === null || value === undefined) {
    return '-'
  }

  const numericValue = Number(value)
  if (Number.isNaN(numericValue)) {
    return '-'
  }

  const rounded = Math.round(numericValue)
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
  const reduceMotion = useReducedMotion()

  useEffect(() => {
    // On first mount previousValueRef already equals the target, so the count-up
    // would animate value->value (a visual no-op) while still spinning a 0.9s
    // per-frame setState loop. Nine of these mount at once and block the main
    // thread right after paint. Skip when there is nothing to animate; real
    // value changes (poll/filter) still count up.
    if (reduceMotion || previousValueRef.current === safeValue) {
      previousValueRef.current = safeValue
      return
    }

    const controls = animate(previousValueRef.current, safeValue, {
      duration: 0.9,
      ease: 'easeOut',
      onUpdate: (latest) => {
        previousValueRef.current = latest
        setDisplayValue(latest)
      },
    })

    return () => controls.stop()
  }, [safeValue, reduceMotion])

  if (!hasValue) {
    return <span className={className}>-</span>
  }

  // Under reduced motion, show the exact value without the count-up animation.
  const shown = reduceMotion ? safeValue : displayValue
  return (
    <span className={className}>
      {formatAnimatedValue(shown, variant, digits)}
    </span>
  )
}

function SectionAmbient() {
  return null
}

/**
 * Bold, consistent section header: an accent icon tile, a gold-tick eyebrow, the
 * section title in display type, an optional right slot (headline metric or
 * filter), and a hairline rule that frames each section as a distinct chapter.
 */
function SectionHeading({
  icon: Icon,
  accent,
  accentTint,
  eyebrow,
  title,
  right,
}: {
  icon: ComponentType<{ className?: string }>
  accent: string
  accentTint: string
  eyebrow: string
  title: string
  right?: ReactNode
}) {
  return (
    <div className="flex flex-col gap-4 border-b border-[#eef2f6] pb-5 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-3.5">
        <span
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[0.45rem]"
          style={{ backgroundColor: accentTint, color: accent }}
        >
          <Icon className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <p
            className="text-[11px] font-semibold uppercase tracking-[0.2em]"
            style={{ color: accent }}
          >
            {eyebrow}
          </p>
          <h2 className="mt-1 font-display text-[1.5rem] font-bold tracking-[-0.03em] text-[#000a1e] md:text-[1.7rem]">
            {title}
          </h2>
        </div>
      </div>
      {right ? <div className="shrink-0">{right}</div> : null}
    </div>
  )
}

function getChartPointNumber(
  point: Record<string, string | number | null>,
  key: string,
) {
  const value = point[key]

  return typeof value === 'number' ? value : 0
}

function formatMonthlyComparisonTick(value: unknown) {
  const label = String(value)
  const wardLabel = label.includes(' / ') ? label.split(' / ').at(-1) ?? label : label

  return wardLabel.length > 12 ? `${wardLabel.slice(0, 11)}...` : wardLabel
}

function formatOutpatientMonthlyComparisonTick(value: unknown) {
  const label = String(value)
  const departmentLabel = label.includes(' / ') ? label.split(' / ').at(-1) ?? label : label

  return departmentLabel.length > 16 ? `${departmentLabel.slice(0, 15)}...` : departmentLabel
}

function formatProcedureServiceTick(value: unknown) {
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

type DashboardTooltipProps = {
  active?: boolean
  label?: unknown
  payload?: readonly unknown[]
}

function formatTooltipNumber(value: unknown) {
  return typeof value === 'number' && !Number.isNaN(value)
    ? new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(value)
    : '-'
}

function TooltipFrame({ children }: { children: ReactNode }) {
  return (
    <div className="min-w-[190px] rounded-[0.5rem] border border-[rgba(190,203,219,0.95)] bg-white/95 px-3 py-2.5 text-xs text-[#334155] shadow-[0_22px_45px_-18px_rgba(0,33,71,0.28)]">
      {children}
    </div>
  )
}

function TooltipMeta({ label, value }: { label: string; value: string }) {
  return (
    <div className="mt-1 flex items-start justify-between gap-4">
      <span className="text-[#64748b]">{label}</span>
      <span className="max-w-[220px] text-right font-semibold text-[#334155]">{value}</span>
    </div>
  )
}

function ProcedureServiceTooltip({ active, payload }: DashboardTooltipProps) {
  const point = getTooltipPoint(payload?.[0])

  if (!active || !point) {
    return null
  }

  const serviceName = typeof point.serviceName === 'string' ? point.serviceName : String(point.label ?? '')
  const monthLabel = typeof point.monthLabel === 'string' ? point.monthLabel : ''
  const metricLabel = typeof point.metricLabel === 'string' ? point.metricLabel : 'Total throughput'
  const fieldIds = typeof point.fieldIds === 'string' ? point.fieldIds : ''

  return (
    <TooltipFrame>
      <p className="font-bold text-[#002147]">{serviceName}</p>
      {monthLabel ? <TooltipMeta label="Month" value={monthLabel} /> : null}
      <TooltipMeta label="Total" value={formatTooltipNumber(point.total)} />
      <TooltipMeta label="Metric" value={metricLabel} />
      {fieldIds ? <TooltipMeta label="Fields" value={fieldIds} /> : null}
    </TooltipFrame>
  )
}

function ProcedureMixTooltip({ active, label, payload }: DashboardTooltipProps) {
  const point = getTooltipPoint(payload?.[0])

  if (!active || !point) {
    return null
  }

  const mixLabel = typeof point.label === 'string' ? point.label : String(label ?? '')
  const monthLabel = typeof point.monthLabel === 'string' ? point.monthLabel : ''
  const fieldIds = typeof point.fieldIds === 'string' ? point.fieldIds : ''

  return (
    <TooltipFrame>
      <p className="font-bold text-[#002147]">{mixLabel}</p>
      {monthLabel ? <TooltipMeta label="Month" value={monthLabel} /> : null}
      <TooltipMeta label="Total" value={formatTooltipNumber(point.value)} />
      {fieldIds ? <TooltipMeta label="Fields" value={fieldIds} /> : null}
    </TooltipFrame>
  )
}

function formatMonthlyComparisonTooltipLabel(label: unknown, payload?: readonly unknown[]) {
  const point = getTooltipPoint(payload?.[0])
  const monthLabel = typeof point?.monthLabel === 'string' ? point.monthLabel : ''
  const departmentName =
    typeof point?.departmentName === 'string' ? point.departmentName : String(label ?? '')

  return monthLabel ? `${monthLabel} / ${departmentName}` : departmentName
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

/**
 * Trend tooltips read raw series values, and any "average across wards" scope
 * divides by the ward count - which surfaced full binary floats to clinicians
 * ("Deaths : 0.5714285714285714"). Whole numbers stay whole; anything else is
 * cut to one decimal, which is all the precision a weekly ward average carries.
 */
function formatTrendTooltipValue(value: unknown, name: unknown) {
  const numeric = Number(value)

  if (value === null || value === undefined || Number.isNaN(numeric)) {
    return ['-', String(name ?? '')] as [string, string]
  }

  return [
    Number.isInteger(numeric) ? String(numeric) : numeric.toFixed(1),
    String(name ?? ''),
  ] as [string, string]
}

function dashboardDate(value: string) {
  return format(new Date(value), 'yyyy-MM-dd')
}

function getDashboardFamilySummary(
  payload: DashboardAnalyticsPayload | null,
  family: FamilyFilter,
): AnalyticsSummary | null {
  if (!payload) {
    return null
  }

  if (family === 'all') {
    return payload.overview.summary
  }

  return payload.families[family]?.summary ?? null
}

function getAnalyticsWeeklyRowForBucket(
  rows: readonly AnalyticsWeeklyRow[],
  bucket: TrendBucket,
) {
  return rows.find((row) => row.periodId && bucket.periodIds.has(row.periodId)) ?? null
}

function getMetricNumber(metrics: AnalyticsChartMetrics | undefined, key: string) {
  const value = metrics?.[key]

  return typeof value === 'number' && !Number.isNaN(value) ? value : 0
}

function getMetricNullableNumber(metrics: AnalyticsChartMetrics | undefined, key: string) {
  const value = metrics?.[key]

  return typeof value === 'number' && !Number.isNaN(value) ? value : null
}

function getScopedDepartmentMetrics(
  row: AnalyticsWeeklyRow | null,
  scope: string,
  allScope: string,
) {
  const departments = row?.departments ?? []

  if (scope === allScope) {
    return departments.map((department) => department.metrics)
  }

  const department = departments.find(
    (candidate) =>
      candidate.departmentId === scope ||
      candidate.departmentSlug === scope,
  )

  return department ? [department.metrics] : []
}

function averageMetricValue(
  metricsRows: readonly AnalyticsChartMetrics[],
  key: string,
  emptyValue: number | null,
) {
  const values = metricsRows
    .map((metrics) => getMetricNullableNumber(metrics, key))
    .filter((value): value is number => value !== null)

  return values.length
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : emptyValue
}

function getAvailabilityMetrics(metrics: AnalyticsChartMetrics | undefined) {
  const availability = metrics?.availability

  return {
    fullDay: availability?.fullDay ?? 0,
    partialDay: availability?.partialDay ?? 0,
    unavailable: availability?.unavailable ?? 0,
    total: availability?.total ?? 0,
  }
}

function buildAnalyticsInpatientWeeklySeries(
  rows: readonly AnalyticsWeeklyRow[],
  buckets: readonly TrendBucket[],
  metrics: readonly { key: string }[],
  scope: string,
): NumericDashboardPoint[] {
  return buckets.map((bucket) => {
    const row = getAnalyticsWeeklyRowForBucket(rows, bucket)
    const metricsRows = getScopedDepartmentMetrics(row, scope, ALL_INPATIENT_AVERAGE)

    return {
      label: bucket.label,
      ...Object.fromEntries(
        metrics.map((metric) => [
          metric.key,
          scope === ALL_INPATIENT_AVERAGE
            ? averageMetricValue(metricsRows, metric.key, 0)
            : getMetricNumber(metricsRows[0], metric.key),
        ]),
      ),
    }
  })
}

function buildAnalyticsOutpatientWeeklySeries(
  rows: readonly AnalyticsWeeklyRow[],
  buckets: readonly TrendBucket[],
  metrics: readonly OutpatientMetricDefinition[],
  scope: string,
): NumericDashboardPoint[] {
  return buckets.map((bucket) => {
    const row = getAnalyticsWeeklyRowForBucket(rows, bucket)
    const metricsRows = getScopedDepartmentMetrics(row, scope, ALL_OUTPATIENT_AVERAGE)

    return {
      label: bucket.label,
      ...Object.fromEntries(
        metrics.map((metric) => {
          const emptyValue = metric.valueType === 'sum' ? 0 : null

          return [
            metric.key,
            scope === ALL_OUTPATIENT_AVERAGE
              ? averageMetricValue(metricsRows, metric.key, emptyValue)
              : getMetricNullableNumber(metricsRows[0], metric.key) ?? emptyValue,
          ]
        }),
      ),
    }
  })
}

function buildAnalyticsOutpatientAvailabilitySeries(
  rows: readonly AnalyticsWeeklyRow[],
  buckets: readonly TrendBucket[],
  scope: string,
): OutpatientAvailabilityPoint[] {
  return buckets.map((bucket) => {
    const row = getAnalyticsWeeklyRowForBucket(rows, bucket)
    const metrics =
      scope === ALL_OUTPATIENT_AVERAGE
        ? row?.chartMetrics
        : getScopedDepartmentMetrics(row, scope, ALL_OUTPATIENT_AVERAGE)[0]

    return {
      label: bucket.label,
      ...getAvailabilityMetrics(metrics),
    }
  })
}

function buildAnalyticsProcedureWeeklySeries(
  rows: readonly AnalyticsWeeklyRow[],
  buckets: readonly TrendBucket[],
  scope: string,
): ProcedureServicePoint[] {
  return buckets.map((bucket) => {
    const row = getAnalyticsWeeklyRowForBucket(rows, bucket)
    const services = row?.chartMetrics?.services ?? []

    if (scope !== ALL_PROCEDURE_SERVICES_TOTAL) {
      const service = services.find((candidate) => candidate.serviceId === scope)

      return {
        key: `${bucket.key}:${scope}`,
        label: bucket.label,
        serviceId: scope,
        serviceName: service?.serviceName ?? scope,
        metricLabel: service?.metricLabel ?? 'Total throughput',
        fieldIds: service?.fieldIds ?? '',
        total: service?.total ?? 0,
      }
    }

    return {
      key: `${bucket.key}:${ALL_PROCEDURE_SERVICES_TOTAL}`,
      label: bucket.label,
      serviceId: ALL_PROCEDURE_SERVICES_TOTAL,
      serviceName: 'All procedure services total',
      metricLabel: 'Total throughput',
      fieldIds: PROCEDURE_SERVICE_DEFINITIONS.flatMap((service) => service.fieldIds).join(', '),
      total: row?.chartMetrics?.totalThroughput ?? 0,
    }
  })
}

function buildAnalyticsProcedureMixData(
  rows: readonly AnalyticsWeeklyRow[],
  mixKey: 'dialysisMix' | 'endoscopyMix',
): ProcedureMixPoint[] {
  const definitions =
    mixKey === 'dialysisMix'
      ? PROCEDURE_DIALYSIS_MIX_DEFINITIONS
      : PROCEDURE_ENDOSCOPY_MIX_DEFINITIONS

  return definitions.map((definition) => ({
    key: definition.key,
    label: definition.label,
    fieldIds: definition.fieldIds.join(', '),
    value: rows.reduce((sum, row) => {
      const mixPoints = row.chartMetrics?.[mixKey]
      const point = Array.isArray(mixPoints)
        ? mixPoints.find((candidate): candidate is ProcedureMixPoint => (
            Boolean(candidate) &&
            typeof candidate === 'object' &&
            'key' in candidate &&
            'value' in candidate &&
            (candidate as ProcedureMixPoint).key === definition.key
          ))
        : null

      return sum + (point?.value ?? 0)
    }, 0),
  }))
}

export function AdminDashboardPage() {
  const {
    state,
    ensureReportSummaryData,
    ensureReportDetails,
    getReportDetailLoadState,
    isReportDetailLoaded,
  } = useAppData()
  const reduceMotion = useReducedMotion()
  const fadeIn = {
    initial: reduceMotion ? false : { opacity: 0, y: 10 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: reduceMotion ? 0 : 0.3, ease: 'easeOut' as const },
  }
  const [familyFilter, setFamilyFilter] = useState<FamilyFilter>('all')
  const [filtersOpen, setFiltersOpen] = useState(false)
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
  // Mount charts at their final geometry. The former two-frame state flip made
  // every Recharts animation begin together and produced more than 6,000
  // animation-frame callbacks in the early-click trace.
  const chartsAnimate = false
  useEffect(() => {
    const timer = window.setTimeout(() => {
      ;[
        '/admin/submissions',
        '/admin/action-items',
        '/admin/users',
        '/admin/audit',
        '/admin/settings',
      ].forEach(prefetchRoute)
    }, 400)

    return () => {
      window.clearTimeout(timer)
    }
  }, [])
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
  const trendPeriodIdsKey = trendPeriods.map(({ id }) => id).join('|')
  useEffect(() => {
    const periodIds = trendPeriodIdsKey ? trendPeriodIdsKey.split('|') : []
    if (periodIds.length) {
      void ensureReportSummaryData({ periodIds })
    }
  }, [ensureReportSummaryData, trendPeriodIdsKey])

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

  /**
   * Report cells the MONTHLY charts actually read. They do not read the whole
   * range: each ward/clinic comparison renders one selected month, and only the
   * occupancy trend spans every month - and that reads just the wards that have
   * beds. Requesting every report in range instead fired one batch per hundred
   * reports in parallel (thirty of them over a two-year range), which stampeded
   * the API until the client gave up with "the server took too long".
   *
   * Split into two batches because they scale differently. The comparison cells
   * are one month's worth no matter how wide the range is; the occupancy cells
   * grow with it. Fetching them together meant widening the range stalled every
   * chart on screen behind ward history none of them read, which is why picking
   * "All available data" in monthly view felt like the page had frozen even
   * though the visible charts had not changed. Now they load independently and
   * only the occupancy card waits on the long one.
   *
   * Resolved here, above the loading early-return, so the effects below keep a
   * stable hook order.
   */
  const detailReportingPeriodIds = new Set(trendPeriods.map((period) => period.id))
  const comparisonPeriodIds = new Set(
    [inpatientComparisonMonthKey, outpatientComparisonMonthKey, procedureComparisonMonthKey]
      .map((monthKey) => resolveDashboardTrendBucket(monthlyTrendBuckets, monthKey))
      .flatMap((bucket) => (bucket ? [...bucket.periodIds] : [])),
  )
  const occupancyDepartmentIds = new Set(
    getOccupancyRelevantDepartmentIds(inpatientOccupancyScope),
  )
  // The month on screen - every ward/clinic/service comparison reads only these.
  const comparisonReportIds = state.reports
    .filter(
      (report) =>
        detailReportingPeriodIds.has(report.reportingPeriodId) &&
        comparisonPeriodIds.has(report.reportingPeriodId),
    )
    .map((report) => report.id)
  // Bedded wards across every month in range. Overlaps the batch above on the
  // selected month; ensureReportDetails dedupes against its own in-flight set,
  // so the shared cells are requested once by whichever effect runs first.
  const occupancyReportIds = state.reports
    .filter(
      (report) =>
        detailReportingPeriodIds.has(report.reportingPeriodId) &&
        occupancyDepartmentIds.has(report.departmentId),
    )
    .map((report) => report.id)
  const comparisonReportIdsKey = comparisonReportIds.join('|')
  const occupancyReportIdsKey = occupancyReportIds.join('|')

  // Declared first so the visible month is the batch that goes out first.
  useEffect(() => {
    if (trendScale !== 'monthly') {
      return
    }

    void ensureReportDetails(comparisonReportIdsKey ? comparisonReportIdsKey.split('|') : [])
  }, [comparisonReportIdsKey, ensureReportDetails, trendScale])

  useEffect(() => {
    if (trendScale !== 'monthly') {
      return
    }

    void ensureReportDetails(occupancyReportIdsKey ? occupancyReportIdsKey.split('|') : [])
  }, [ensureReportDetails, occupancyReportIdsKey, trendScale])

  const analyticsRangeStart = trendPeriods[0] ?? null
  const analyticsRangeEnd = trendPeriods.at(-1) ?? null
  const analyticsDateFrom =
    timeRange === 'current' || !analyticsRangeStart
      ? ''
      : dashboardDate(analyticsRangeStart.weekStart)
  const analyticsDateTo =
    timeRange === 'current' || !analyticsRangeEnd
      ? ''
      : dashboardDate(analyticsRangeEnd.weekStart)
  const dashboardQueryKey =
    timeRange === 'current'
      ? effectivePeriodId
        ? `period:${effectivePeriodId}`
        : ''
      : analyticsDateFrom && analyticsDateTo
        ? `range:${analyticsDateFrom}:${analyticsDateTo}`
        : ''
  const latestDashboardReportUpdate = state.reports.reduce(
    (latest, report) => (report.updatedAt > latest ? report.updatedAt : latest),
    '',
  )
  const dashboardDataRevision = `${state.reports.length}:${latestDashboardReportUpdate}`
  const dashboardAnalyticsQuery: AnalyticsQuery | null = dashboardQueryKey
    ? timeRange === 'current'
      ? { periodId: effectivePeriodId }
      : { dateFrom: analyticsDateFrom, dateTo: analyticsDateTo }
    : null
  const dashboardAnalyticsCacheKey = dashboardAnalyticsQuery
    ? getDashboardAnalyticsCacheKey(dashboardAnalyticsQuery)
    : ''
  const [dashboardAnalyticsState, setDashboardAnalyticsState] = useState<{
    cacheKey: string
    payload: DashboardAnalyticsPayload | null
  }>(() => ({
    cacheKey: dashboardAnalyticsCacheKey,
    payload: dashboardAnalyticsQuery
      ? readCachedDashboardAnalytics(dashboardAnalyticsQuery)
      : null,
  }))
  const [dashboardAnalyticsRequestState, setDashboardAnalyticsRequestState] = useState<{
    cacheKey: string
    status: DashboardAnalyticsRequestStatus
  }>(() => ({
    cacheKey: dashboardAnalyticsCacheKey,
    status: dashboardAnalyticsQuery
      ? dashboardAnalyticsState.payload
        ? 'success'
        : 'loading'
      : 'idle',
  }))
  const [dashboardAnalyticsRetryKey, setDashboardAnalyticsRetryKey] = useState(0)
  const dashboardAnalytics =
    dashboardAnalyticsState.cacheKey === dashboardAnalyticsCacheKey
      ? dashboardAnalyticsState.payload
      : dashboardAnalyticsQuery
        ? readCachedDashboardAnalytics(dashboardAnalyticsQuery)
        : null
  useEffect(() => {
    const client = getApiBrowserClient()

    if (!client || !dashboardQueryKey) {
      return
    }

    let cancelled = false
    const query: AnalyticsQuery =
      timeRange === 'current'
        ? { periodId: effectivePeriodId }
        : { dateFrom: analyticsDateFrom, dateTo: analyticsDateTo }
    const cacheKey = getDashboardAnalyticsCacheKey(query)

    void fetchAndCacheDashboardAnalytics(client, query)
      .then((payload) => {
        if (!cancelled) {
          setDashboardAnalyticsState({
            cacheKey,
            payload,
          })
          setDashboardAnalyticsRequestState({
            cacheKey,
            status: 'success',
          })
        }
      })
      .catch(() => {
        if (!cancelled) {
          setDashboardAnalyticsRequestState({
            cacheKey,
            status: 'error',
          })
        }
      })

    return () => {
      cancelled = true
    }
  }, [
    analyticsDateFrom,
    analyticsDateTo,
    dashboardAnalyticsCacheKey,
    dashboardQueryKey,
    dashboardAnalyticsRetryKey,
    dashboardDataRevision,
    effectivePeriodId,
    timeRange,
  ])

  const resolvedRangeSummary = getReportingRangeSummary(
    state,
    timeRange,
    effectivePeriodId,
    scopeFamily,
  )

  /**
   * Keep the page mounted while the first workspace payload lands.
   *
   * This used to `return <PageSkeleton />` whenever the summary was null, which
   * is true for the whole of that first request - so the dashboard painted, then
   * threw itself away for ~700ms, then came back, and the page height moved
   * twice on the way. Scrolling through that window looked like the page
   * breaking. Now the frame stays put and each data region shows its own
   * loading state, which they all already support.
   */
  const isRangeLoading = !resolvedRangeSummary
  const rangeSummary = resolvedRangeSummary ?? emptyReportingRangeSummary()

  const deadlineNote = getLockDeadlineNote(state, effectivePeriodId)
  const timeRangeLabels = {
    current: 'Current week',
    last4: 'Last 4 weeks',
    last8: 'Last 8 weeks',
    quarter: 'Last quarter',
    last26: 'Last 26 weeks',
    all: 'All available data',
  } as const
  const timeRangeOptions = [
    { value: 'current' as const, label: 'Current week' },
    { value: 'last4' as const, label: 'Last 4 weeks' },
    { value: 'last8' as const, label: 'Last 8 weeks' },
    { value: 'quarter' as const, label: 'Last quarter (13 weeks)' },
    { value: 'last26' as const, label: 'Last 26 weeks' },
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
  // Visible, subtle axis + tick lines so every chart reads as a proper plotted axis.
  const chartAxisLine = { stroke: 'rgba(71, 85, 105, 0.55)', strokeWidth: 1 } as const
  const chartTickLine = { stroke: 'rgba(100, 116, 139, 0.45)' } as const
  // Inset the first/last time-series points so edge tick labels (e.g. "Apr 13")
  // render fully instead of being clipped by the card edge.
  const trendXPadding = { left: 12, right: 12 } as const
  // How many x labels a trend card can physically show. A date label is ~40px
  // wide in a ~550px card, so beyond roughly a dozen they collide; at a two-year
  // weekly range (104 points) forcing every label produced an unreadable smear.
  const maxTrendXLabels = 13
  /**
   * Show every label while they fit, then thin them evenly. Returns the recharts
   * `interval` (labels to SKIP between rendered ticks), so 0 keeps the previous
   * behaviour for the short ranges this dashboard was built around.
   */
  const trendTickInterval = (pointCount: number) =>
    pointCount > maxTrendXLabels ? Math.ceil(pointCount / maxTrendXLabels) - 1 : 0
  // Distinct, accessible categorical hues. Blue stays primary; violet / teal / rose
  // add separation so multi-series lines are easy to tell apart (colorblind-safer).
  const grayscalePalette = {
    ink: '#005db6', // blue (primary)
    carbon: '#7c3aed', // violet
    slate: '#002147', // deep navy
    steel: '#0d9488', // teal
    mist: '#f0b429', // amber
    cloud: '#7c93b4', // muted slate-blue
    dialysis: '#db2777', // rose
    dialysisLight: '#f472b6', // light rose
  } as const
  const tooltipLineCursor = { stroke: 'rgba(0,93,182,0.22)', strokeWidth: 1.4, strokeDasharray: '4 5' } as const
  const tooltipFillCursor = { fill: 'rgba(0,93,182,0.06)' } as const
  const dashboardSummary = getDashboardFamilySummary(dashboardAnalytics, familyFilter)
  const totalExpected =
    dashboardSummary?.expectedReports ?? rangeSummary.metrics.totalExpected
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
  const countStatus = (status: Exclude<StatusFilter, 'all'>) => {
    if (!dashboardSummary) {
      return rangeSummary.statusCounts[status]
    }

    if (status === 'not_started') {
      return dashboardSummary.missingReports
    }

    return dashboardSummary.statusCounts[status] ?? 0
  }
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
  // Period-over-period trend chips, derived ONLY from the in-memory trend series
  // (first vs last bucket). Renders the neutral/flat state when there is <2 buckets.
  const trendDelta = (() => {
    const first = reportingTrendSeries[0]
    const last = reportingTrendSeries.at(-1)
    if (!first || !last || reportingTrendSeries.length < 2) {
      return { delivered: 0, open: 0, rate: 0 }
    }
    const pctChange = (from: number, to: number) =>
      from === 0 ? (to > 0 ? 100 : 0) : ((to - from) / from) * 100
    const firstTotal = first.delivered + first.open
    const lastTotal = last.delivered + last.open
    const firstRate = firstTotal ? (first.delivered / firstTotal) * 100 : 0
    const lastRate = lastTotal ? (last.delivered / lastTotal) * 100 : 0
    return {
      delivered: pctChange(first.delivered, last.delivered),
      open: -pctChange(first.open, last.open), // fewer open is a positive trend
      rate: lastRate - firstRate, // percentage-point change
    }
  })()
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
  const inpatientWeeklyAnalyticsRows = dashboardAnalytics?.families.inpatient.weekly ?? []
  const outpatientWeeklyAnalyticsRows = dashboardAnalytics?.families.outpatient.weekly ?? []
  const procedureWeeklyAnalyticsRows = dashboardAnalytics?.families.procedure.weekly ?? []
  const hasInpatientWeeklyAnalytics = trendScale === 'weekly' && inpatientWeeklyAnalyticsRows.length > 0
  const hasOutpatientWeeklyAnalytics = trendScale === 'weekly' && outpatientWeeklyAnalyticsRows.length > 0
  const hasProcedureWeeklyAnalytics = trendScale === 'weekly' && procedureWeeklyAnalyticsRows.length > 0
  const inpatientFlowSeries =
    trendScale === 'monthly'
      ? getInpatientMonthlyWardComparisonData(
          state,
          monthlyTrendBuckets,
          inpatientFlowMetrics,
          effectiveInpatientComparisonMonthKey,
        )
      : hasInpatientWeeklyAnalytics
        ? buildAnalyticsInpatientWeeklySeries(
            inpatientWeeklyAnalyticsRows,
            trendBuckets,
            inpatientFlowMetrics,
            inpatientTrendScope,
          )
      : getInpatientWeeklyCountTrendSeries(
          state,
          trendBuckets,
          inpatientFlowMetrics,
          inpatientTrendScope,
        )
  const inpatientAdmissionsTotal =
    dashboardAnalytics?.families.inpatient.summary.totals.totalAdmissions ??
    sumFieldTotalsForRange('inpatient', [
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
      : hasInpatientWeeklyAnalytics
        ? buildAnalyticsInpatientWeeklySeries(
            inpatientWeeklyAnalyticsRows,
            trendBuckets,
            inpatientSafetyMetrics,
            inpatientTrendScope,
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
      : hasOutpatientWeeklyAnalytics
        ? buildAnalyticsOutpatientWeeklySeries(
            outpatientWeeklyAnalyticsRows,
            trendBuckets,
            outpatientSeenMetrics,
            outpatientTrendScope,
          )
      : getOutpatientWeeklyTrendSeries(
          state,
          trendBuckets,
          outpatientSeenMetrics,
          outpatientTrendScope,
        )
  const outpatientSeenTotal =
    dashboardAnalytics?.families.outpatient.summary.totals.totalPatientsSeen ??
    dashboardAnalytics?.families.outpatient.summary.totals.totalOutpatientVisits ??
    sumFieldTotalsForRange('outpatient', ['total_patients_seen'])
  const outpatientVolumeMix =
    trendScale === 'monthly'
      ? getOutpatientMonthlyDepartmentComparisonData(
          state,
          monthlyTrendBuckets,
          outpatientVolumeMetrics,
          effectiveOutpatientComparisonMonthKey,
        )
      : hasOutpatientWeeklyAnalytics
        ? buildAnalyticsOutpatientWeeklySeries(
            outpatientWeeklyAnalyticsRows,
            trendBuckets,
            outpatientVolumeMetrics,
            outpatientTrendScope,
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
      : hasOutpatientWeeklyAnalytics
        ? buildAnalyticsOutpatientWeeklySeries(
            outpatientWeeklyAnalyticsRows,
            trendBuckets,
            outpatientFollowUpWaitMetrics,
            outpatientTrendScope,
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
      : hasOutpatientWeeklyAnalytics
        ? buildAnalyticsOutpatientWeeklySeries(
            outpatientWeeklyAnalyticsRows,
            trendBuckets,
            outpatientClinicStartMetrics,
            outpatientTrendScope,
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
      : hasOutpatientWeeklyAnalytics
        ? buildAnalyticsOutpatientAvailabilitySeries(
            outpatientWeeklyAnalyticsRows,
            trendBuckets,
            outpatientTrendScope,
          )
      : getOutpatientWeeklyAvailabilitySeries(
          state,
          trendBuckets,
          outpatientTrendScope,
        )
  const procedureTrendSeries = hasProcedureWeeklyAnalytics
    ? buildAnalyticsProcedureWeeklySeries(
        procedureWeeklyAnalyticsRows,
        trendBuckets,
        procedureTrendScope,
      )
    : getProcedureWeeklyTrendSeries(
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
  const procedureHeaderTotal =
    dashboardAnalytics?.families.procedure.procedures?.totalThroughput ??
    dashboardAnalytics?.families.procedure.summary.totals.procedureThroughput ??
    getProcedureTotalThroughput(state, trendBuckets)
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
  const resolvedDialysisMix =
    trendScale === 'weekly' && hasProcedureWeeklyAnalytics
      ? buildAnalyticsProcedureMixData(procedureWeeklyAnalyticsRows, 'dialysisMix')
      : dialysisMix
  const dialysisTotal = resolvedDialysisMix.reduce((sum, item) => sum + item.value, 0)
  const endoscopyMix = getProcedureEndoscopyMixData(
    state,
    trendScale === 'monthly' ? monthlyTrendBuckets : trendBuckets,
    procedureDetailMonthKey,
  )
  const resolvedEndoscopyMix =
    trendScale === 'weekly' && hasProcedureWeeklyAnalytics
      ? buildAnalyticsProcedureMixData(procedureWeeklyAnalyticsRows, 'endoscopyMix')
      : endoscopyMix
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
  const hasEndoscopyMixSignal = resolvedEndoscopyMix.some((item) => item.value > 0)
  const hasDialysisMixSignal = resolvedDialysisMix.some((item) => item.value > 0)
  const dashboardAnalyticsRequestStatus =
    dashboardAnalyticsRequestState.cacheKey === dashboardAnalyticsCacheKey
      ? dashboardAnalyticsRequestState.status
      : dashboardAnalytics
        ? 'success'
        : dashboardAnalyticsQuery
          ? 'loading'
          : 'idle'
  const isDashboardAnalyticsPending =
    trendScale === 'weekly' &&
    Boolean(dashboardAnalyticsQuery) &&
    !dashboardAnalytics &&
    dashboardAnalyticsRequestStatus === 'loading'
  const isDashboardAnalyticsError =
    trendScale === 'weekly' &&
    Boolean(dashboardAnalyticsQuery) &&
    !dashboardAnalytics &&
    dashboardAnalyticsRequestStatus === 'error'
  const isReportDetailBatchPending = (reportIds: readonly string[]) =>
    reportIds.some((reportId) => {
      const detailState = getReportDetailLoadState(reportId).status

      return detailState === 'loading' || (detailState === 'idle' && !isReportDetailLoaded(reportId))
    })
  const areTrendReportDetailsPending =
    trendScale === 'monthly' && isReportDetailBatchPending(comparisonReportIds)
  // Tracked separately from the batch above so a wide range only holds up the
  // occupancy card, not the comparison charts that never read those cells.
  const isOccupancyDetailPending =
    trendScale === 'monthly' && isReportDetailBatchPending(occupancyReportIds)
  // While the range itself is still arriving there is nothing to plot yet, so
  // every chart shows its loading copy rather than "no data in this view" -
  // which would otherwise read as a real, empty answer.
  const areOperationalChartsLoading =
    isRangeLoading || isDashboardAnalyticsPending || areTrendReportDetailsPending
  const isOccupancyChartLoading = areOperationalChartsLoading || isOccupancyDetailPending
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
    'rounded-[0.35rem] bg-[#ffffff] px-5 py-6 outline outline-1 outline-[#d4dde8] shadow-[0_24px_60px_-42px_rgba(0,33,71,0.28)] md:px-6 md:py-7'
  const chartPanelClass =
    'rounded-[0.35rem] bg-[#ffffff] p-5 outline outline-1 outline-[#d4dde8]/80 shadow-[0_18px_44px_-36px_rgba(0,33,71,0.3)] md:p-6'
  const chartTitleClass =
    'text-sm font-semibold uppercase tracking-[0.22em] text-[#334155]'
  // Monthly comparisons are categorical (departments/services), so they read far
  // better as horizontal bars: names sit left (no angled ticks), values cap the
  // bars, and ranking is obvious. One shared renderer keeps every monthly chart
  // consistent. Time-series trends stay vertical (handled inline elsewhere).
  const renderMonthlyComparison = ({
    data,
    series,
    valueFormatter,
    categoryFormatter,
    tooltipLabelFormatter,
    tooltipFormatter,
    tooltipContent,
    cellColorFor,
    categoryWidth = 132,
    allowDecimals = true,
  }: {
    data: Array<Record<string, unknown>>
    series: Array<{ key: string; name: string; color: string }>
    valueFormatter?: (value: unknown) => string
    categoryFormatter?: (value: unknown) => string
    tooltipLabelFormatter?: (label: unknown, payload?: readonly unknown[]) => string
    tooltipFormatter?: (value: unknown) => [string, string]
    tooltipContent?: ReactElement
    cellColorFor?: (item: Record<string, unknown>) => string
    categoryWidth?: number
    allowDecimals?: boolean
  }) => {
    const single = series.length === 1
    return (
      <BarChart
        layout="vertical"
        data={data}
        margin={{ top: 6, right: single ? 56 : 16, left: 6, bottom: 6 }}
        barCategoryGap={single ? '36%' : '26%'}
        barGap={4}
      >
        <CartesianGrid strokeDasharray="3 12" stroke={chartGridStroke} horizontal={false} />
        <XAxis
          type="number"
          tick={chartTick}
          axisLine={chartAxisLine}
          tickLine={chartTickLine}
          tickFormatter={valueFormatter}
          allowDecimals={allowDecimals}
        />
        <YAxis
          type="category"
          dataKey="label"
          tick={chartTick}
          axisLine={chartAxisLine}
          tickLine={chartTickLine}
          width={categoryWidth}
          interval={0}
          tickFormatter={categoryFormatter}
        />
        <Tooltip
          {...(tooltipContent ? { content: tooltipContent } : {})}
          contentStyle={lightTooltipStyle}
          labelStyle={lightTooltipLabelStyle}
          itemStyle={lightTooltipItemStyle}
          cursor={tooltipFillCursor}
          labelFormatter={tooltipLabelFormatter}
          formatter={tooltipFormatter}
        />
        {series.map((entry, index) => (
          <Bar
            key={entry.key}
            dataKey={entry.key}
            name={entry.name}
            fill={entry.color}
            radius={[0, 5, 5, 0]}
            maxBarSize={single ? 30 : 16}
            isAnimationActive={chartsAnimate && !reduceMotion}
            animationDuration={1000 + index * 200}
            animationEasing="ease-out"
            activeBar={{ fillOpacity: 0.85 }}
          >
            {cellColorFor
              ? data.map((item, cellIndex) => (
                  <Cell key={cellIndex} fill={cellColorFor(item)} />
                ))
              : null}
            {single ? (
              <LabelList
                dataKey={entry.key}
                position="right"
                offset={8}
                formatter={valueFormatter}
                className="fill-[#5b6169] text-[11px] font-semibold"
              />
            ) : null}
          </Bar>
        ))}
      </BarChart>
    )
  }
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
  const metricTargets = state.settings.metricTargets ?? {}
  const deliveryTargetTone = evaluateMetricTarget(deliveryRate, metricTargets.deliveryRate)

  return (
    <div className="space-y-6 px-4 py-5 text-[#000a1e] md:space-y-8 md:px-6 md:py-8">
      <motion.section
        {...fadeIn}
        className="overflow-hidden rounded-xl border border-[#dce3eb] bg-white shadow-[0_18px_50px_-42px_rgba(0,33,71,0.4)]"
      >
        <div>
          <div className="flex flex-col gap-5 px-5 py-6 md:flex-row md:items-end md:justify-between md:px-7 md:py-7">
            <div className="min-w-0">
              <p className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.24em] text-[#005db6]">
                <span className="h-1.5 w-1.5 rounded-full bg-[#f0b429]" aria-hidden="true" />
                Reporting overview
              </p>
              <h1 className="mt-3 max-w-3xl font-display text-[1.65rem] font-bold leading-[1.08] tracking-[-0.035em] text-[#000a1e] md:text-[2rem]">
                {selectedRangeTitle}
              </h1>
              <p className="mt-2 text-sm leading-6 text-[#64748b]">
                {trendScaleLabels[trendScale]}
                <span className="mx-2 text-[#c1cbd7]" aria-hidden="true">/</span>
                {familyLabels[familyFilter]}
                <span className="mx-2 text-[#c1cbd7]" aria-hidden="true">/</span>
                {selectedRangeNote}
              </p>
            </div>
            <AnalyticsExportPanel />
          </div>
          <div className="border-y border-[#e3e8ef] bg-[#f8fafc]/75">
            <button
              type="button"
              onClick={() => setFiltersOpen((value) => !value)}
              aria-expanded={filtersOpen}
              aria-controls="dashboard-scope-filters"
              className="flex min-h-12 w-full items-center justify-between gap-3 px-5 py-3 text-left transition-colors hover:bg-[#f3f6f9] sm:hidden"
            >
              <span className="flex items-center gap-2 text-[13px] font-semibold text-[#1d3047]">
                <Filter className="h-4 w-4 text-[#005db6]" />
                Filters
              </span>
              <span className="flex min-w-0 items-center gap-2">
                <span className="max-w-[10.5rem] truncate text-xs text-[#74777f]">
                  {timeRangeLabels[timeRange]} · {familyLabels[familyFilter]}
                </span>
                <ChevronDown
                  className={cn(
                    'h-4 w-4 shrink-0 text-[#74777f] transition-transform duration-200',
                    filtersOpen && 'rotate-180',
                  )}
                />
              </span>
            </button>
            <div
              id="dashboard-scope-filters"
              className={cn(
                filtersOpen ? 'grid' : 'hidden',
                'gap-5 px-5 py-5 sm:grid sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end md:px-7',
              )}
            >
              <ReportingScopePanel
                className="rounded-none bg-transparent p-0 outline-none"
                fieldsClassName="grid-cols-1 sm:grid-cols-3"
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
                ]}
              />

              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-[#74777f]">
                  View
                </p>
                <div
                  className="relative grid h-10 grid-cols-2 rounded-lg bg-[#e9eef4] p-1"
                  role="group"
                  aria-label="Trend grouping"
                >
                  {trendScaleOptions.map((option) => {
                    const isActive = trendScale === option.value

                    return (
                      <button
                        key={option.value}
                        type="button"
                        aria-pressed={isActive}
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
                          'relative min-w-[86px] rounded-md px-3 text-sm font-semibold transition-colors duration-200',
                          isActive ? 'text-[#002147]' : 'text-[#64748b] hover:text-[#1d3047]',
                        )}
                      >
                        {isActive ? (
                          <motion.span
                            layoutId="dashboard-trend-scale"
                            className="absolute inset-0 rounded-md bg-white shadow-[0_1px_3px_rgba(15,23,42,0.12)]"
                            transition={{ type: 'spring', stiffness: 420, damping: 34 }}
                          />
                        ) : null}
                        <span className="relative">{option.label}</span>
                      </button>
                    )
                  })}
                </div>
              </div>
            </div>
          </div>
          <div className="grid divide-y divide-[#e3e8ef] sm:grid-cols-3 sm:divide-x sm:divide-y-0">
            <article className="px-5 py-5 md:px-7 md:py-6">
              <div className="flex items-start justify-between gap-3">
                <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#64748b]">
                  Delivered
                </p>
                <Delta value={trendDelta.delivered} variant="badge">
                  <DeltaIcon variant="trend" />
                  <DeltaValue suffix="%" />
                </Delta>
              </div>
              <p className="mt-4 font-display text-[2rem] font-bold leading-none tracking-[-0.04em] tabular-nums text-[#000a1e]">
                <AnimatedMetric value={deliveredCount} variant="number" />
              </p>
              <p className="mt-2 text-xs text-[#7a8796]">Compared with range start</p>
            </article>

            <article className="px-5 py-5 md:px-7 md:py-6">
              <div className="flex items-start justify-between gap-3">
                <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#64748b]">
                  Still open
                </p>
                <Delta value={trendDelta.open} variant="badge">
                  <DeltaIcon variant="trend" />
                  <DeltaValue suffix="%" />
                </Delta>
              </div>
              <p className="mt-4 font-display text-[2rem] font-bold leading-none tracking-[-0.04em] tabular-nums text-[#000a1e]">
                <AnimatedMetric value={openCount} variant="number" />
              </p>
              <p className="mt-2 text-xs text-[#7a8796]">Compared with range start</p>
            </article>

            <article className="px-5 py-5 md:px-7 md:py-6">
              <div className="flex items-start justify-between gap-3">
                <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#64748b]">
                  Delivery rate
                </p>
                <span
                  className={cn(
                    'rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em]',
                    targetStatusClass[deliveryTargetTone],
                  )}
                >
                  {targetStatusLabel[deliveryTargetTone]}
                </span>
              </div>
              <div className="mt-4 flex flex-wrap items-end gap-2">
                <p className="font-display text-[2rem] font-bold leading-none tracking-[-0.04em] tabular-nums text-[#000a1e]">
                  <AnimatedMetric value={deliveryRate} variant="percent" />
                </p>
                <Delta value={trendDelta.rate} variant="badge">
                  <DeltaIcon variant="trend" />
                  <DeltaValue suffix="pts" />
                </Delta>
              </div>
              <p className="mt-2 text-xs text-[#7a8796]">Compared with range start</p>
            </article>
          </div>
        </div>
      </motion.section>

      {isDashboardAnalyticsError ? (
        <div
          role="alert"
          className="flex flex-col gap-3 rounded-[0.35rem] border border-[#d7a43a]/45 bg-[#fff9ea] px-4 py-3 text-sm text-[#5f4300] sm:flex-row sm:items-center sm:justify-between"
        >
          <p>The latest graph data could not be loaded. Your dashboard totals are still available.</p>
          <Button
            type="button"
            variant="secondary"
            className="shrink-0"
            onClick={() => {
              setDashboardAnalyticsRequestState({
                cacheKey: dashboardAnalyticsCacheKey,
                status: 'loading',
              })
              setDashboardAnalyticsRetryKey((value) => value + 1)
            }}
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Retry graphs
          </Button>
        </div>
      ) : null}

      <motion.section
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: 'easeOut' }}
        className={sectionClass}
      >
        <SectionAmbient />
        <SectionHeading
          icon={Gauge}
          accent="#315f8c"
          accentTint="#eef2f6"
          eyebrow="Reporting status"
          title="Submission pulse"
          right={
            <ReportingScopePanel
              className="w-full sm:max-w-[260px]"
              fields={[
                {
                  label: 'Submission status',
                  options: statusOptions,
                  placeholder: 'Submission status',
                  value: statusFilter,
                  onValueChange: (value) => setStatusFilter(value as StatusFilter),
                },
              ]}
            />
          }
        />

        <div className="relative mt-6 grid gap-5 xl:grid-cols-[220px_minmax(0,0.85fr)_minmax(0,1.25fr)]">
          <div className={cn('flex flex-col', chartPanelClass)}>
            <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[#74777f]">
              Distribution
            </p>
            <div className="relative mt-4 h-[176px]">
              {totalExpected ? (
                <>
                  <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 0, height: 1 }}>
                    <PieChart>
                      <Pie
                        data={statusDistribution}
                        dataKey="count"
                        innerRadius={60}
                        outerRadius={84}
                        paddingAngle={2}
                        cornerRadius={4}
                        stroke="rgba(255,255,255,0.96)"
                        strokeWidth={5}
                        isAnimationActive={chartsAnimate && !reduceMotion}
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

                  <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                    <AnimatedMetric
                      value={statusFocusValue}
                      variant="compact"
                      className="block font-display text-[2rem] font-bold leading-none tabular-nums text-[#000a1e]"
                    />
                    <p className="mt-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-[#74777f]">
                      {statusCenterLabel}
                    </p>
                  </div>
                </>
              ) : (
                <ChartFallback
                  isLoading={isRangeLoading}
                  loadingMessage="Loading reporting scope..."
                  emptyMessage="No reports were scheduled for this view."
                />
              )}
            </div>
            {totalExpected ? (
              <div className="mt-4 flex items-baseline justify-center gap-1.5 border-t border-[#eef2f6] pt-3.5">
                <span className="font-display text-lg font-bold tabular-nums text-[#005db6]">
                  {statusFocusRate}%
                </span>
                <span className="text-xs text-[#74777f]">of scope</span>
              </div>
            ) : null}
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
                <h3 className="mt-2 font-display text-2xl font-semibold tracking-[-0.02em] text-[#000a1e] md:text-3xl">
                  Delivered, open, overdue
                </h3>
              </div>
              <div className="flex items-center gap-2.5">
                <AnimatedMetric
                  value={deliveryRate}
                  variant="percent"
                  className="font-display text-[2rem] leading-none text-[#000a1e]"
                />
                <Delta value={trendDelta.rate} variant="badge">
                  <DeltaIcon variant="trend" />
                  <DeltaValue suffix="pts" />
                </Delta>
              </div>
            </div>
            <ChartLegend
              items={[
                { label: 'Delivered', color: '#005db6' },
                { label: 'Open', color: '#6c7f95' },
                { label: 'Overdue', color: '#f0b429', dash: trendScale !== 'monthly' },
              ]}
            />
            <div className="h-[210px]">
              {hasReportingTrendSignal ? (
                <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 0, height: 1 }}>
                  {trendScale === 'monthly' ? (
                    <BarChart
                      data={reportingTrendSeries}
                      margin={{ top: 12, right: 12, left: 4, bottom: 4 }}
                    >
                      <CartesianGrid strokeDasharray="3 12" stroke={chartGridStroke} vertical={false} />
                      <XAxis
                        dataKey="label"
                        tick={chartTick}
                        axisLine={chartAxisLine}
                        tickLine={chartTickLine}
                        tickMargin={12}
                        padding={trendXPadding}
                      />
                      <YAxis tick={chartTick} axisLine={chartAxisLine} tickLine={chartTickLine} width={34} />
                      <Tooltip contentStyle={lightTooltipStyle} labelStyle={lightTooltipLabelStyle} itemStyle={lightTooltipItemStyle} cursor={tooltipFillCursor} />
                      <Bar dataKey="delivered" name="Delivered" fill="#005db6" maxBarSize={34} radius={[6, 6, 0, 0]} isAnimationActive={chartsAnimate && !reduceMotion} animationDuration={1000} animationEasing="ease-out" />
                      <Bar dataKey="open" name="Open" fill="#6c7f95" maxBarSize={34} radius={[6, 6, 0, 0]} isAnimationActive={chartsAnimate && !reduceMotion} animationDuration={1200} animationEasing="ease-out" />
                      <Bar dataKey="overdue" name="Overdue" fill="#f0b429" maxBarSize={34} radius={[6, 6, 0, 0]} isAnimationActive={chartsAnimate && !reduceMotion} animationDuration={1400} animationEasing="ease-out" />
                    </BarChart>
                  ) : (
                    <AreaChart
                      data={reportingTrendSeries}
                      margin={{ top: 12, right: 12, left: 4, bottom: 4 }}
                    >
                      <CartesianGrid strokeDasharray="3 12" stroke={chartGridStroke} vertical={false} />
                      <XAxis
                        dataKey="label"
                        tick={chartTick}
                        axisLine={chartAxisLine}
                        tickLine={chartTickLine}
                        tickMargin={12}
                        padding={trendXPadding}
                      />
                      <YAxis tick={chartTick} axisLine={chartAxisLine} tickLine={chartTickLine} width={34} />
                      <Tooltip contentStyle={lightTooltipStyle} labelStyle={lightTooltipLabelStyle} itemStyle={lightTooltipItemStyle} cursor={tooltipLineCursor} formatter={formatTrendTooltipValue} />
                      <Area
                        type="linear"
                        dataKey="delivered"
                        name="Delivered"
                        stroke="#005db6"
                        fill="#005db6"
                        fillOpacity={0.18}
                        strokeWidth={3}
                        activeDot={{ ...lineActiveDot, fill: '#005db6' }}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        isAnimationActive={chartsAnimate && !reduceMotion}
                        animationDuration={1100}
                        animationEasing="ease-out"
                      />
                      <Line
                        type="linear"
                        dataKey="open"
                        name="Open"
                        stroke="#6c7f95"
                        strokeWidth={2.5}
                        dot={false}
                        activeDot={{ ...lineActiveDot, fill: '#6c7f95' }}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        isAnimationActive={chartsAnimate && !reduceMotion}
                        animationDuration={1300}
                        animationEasing="ease-out"
                      />
                      <Line
                        type="linear"
                        dataKey="overdue"
                        name="Overdue"
                        stroke="#f0b429"
                        strokeWidth={2.4}
                        strokeDasharray="5 6"
                        dot={false}
                        activeDot={{ ...lineActiveDot, fill: '#f0b429' }}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        isAnimationActive={chartsAnimate && !reduceMotion}
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
        <DeferredDashboardSection
          eager={familyFilter !== 'all'}
          placeholderClassName="min-h-[64rem]"
        >
          <motion.section
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, ease: 'easeOut' }}
            className={sectionClass}
          >
            <SectionAmbient />
            <div className="space-y-8">
            <SectionHeading
              icon={BedDouble}
              accent="#002147"
              accentTint="#e9edf3"
              eyebrow="Inpatient"
              title="Ward movement and occupancy"
              right={
                <div className="text-left sm:text-right">
                  <AnimatedMetric
                    value={inpatientAdmissionsTotal}
                    variant="compact"
                    className="block font-display text-[1.9rem] font-bold leading-none tabular-nums text-[#000a1e]"
                  />
                  <p className="mt-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-[#74777f]">
                    Admissions
                  </p>
                </div>
              }
            />

            {showInpatientOccupancyAnalytics ? null : (
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

            <div className="space-y-5">
              {showInpatientOccupancyAnalytics ? (
                <ReportingScopePanel
                  className="max-w-[360px]"
                  fields={[
                    {
                      label: 'Ward comparison month',
                      options: inpatientComparisonMonthOptions,
                      placeholder: 'Ward comparison month',
                      value: effectiveInpatientComparisonMonthKey,
                      onValueChange: setInpatientComparisonMonthKey,
                    },
                  ]}
                />
              ) : null}

            <div className="grid gap-6 xl:grid-cols-2">
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
                <div>
                  <div className={trendScale === 'monthly' ? 'h-[430px]' : 'h-[250px]'}>
                    {hasInpatientFlowSignal ? (
                      <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 0, height: 1 }}>
                      {trendScale === 'monthly' ? (
                        renderMonthlyComparison({
                          data: inpatientFlowSeries,
                          series: [
                            { key: 'newAdmissions', name: 'Newly admitted', color: grayscalePalette.ink },
                            { key: 'discharges', name: 'Discharges', color: grayscalePalette.steel },
                          ],
                          categoryFormatter: formatMonthlyComparisonTick,
                          tooltipLabelFormatter: formatMonthlyComparisonTooltipLabel,
                          allowDecimals: false,
                        })
                      ) : (
                        <AreaChart
                          data={inpatientFlowSeries}
                          margin={{ top: 12, right: 12, left: 4, bottom: 4 }}
                        >
                          <CartesianGrid strokeDasharray="3 12" stroke={chartGridStroke} vertical={false} />
                          <XAxis
                            dataKey="label"
                            tick={chartTick}
                            axisLine={chartAxisLine}
                            tickLine={chartTickLine}
                            tickMargin={12}
                            interval={trendTickInterval(inpatientFlowSeries.length)}
                            angle={-24}
                            textAnchor="end"
                            height={72}
                            padding={trendXPadding}
                          />
                          <YAxis tick={chartTick} axisLine={chartAxisLine} tickLine={chartTickLine} width={34} />
                          <Tooltip contentStyle={lightTooltipStyle} labelStyle={lightTooltipLabelStyle} itemStyle={lightTooltipItemStyle} cursor={tooltipLineCursor} formatter={formatTrendTooltipValue} />
                          <Area type="linear" dataKey="newAdmissions" name="Newly admitted" stroke="#005db6" fill="#005db6" fillOpacity={0.18} strokeWidth={3.2} dot={{ r: 2.6, strokeWidth: 0, fill: '#005db6' }} activeDot={{ ...lineActiveDot, fill: '#005db6' }} strokeLinecap="round" strokeLinejoin="round" isAnimationActive={chartsAnimate && !reduceMotion} animationDuration={1100} animationEasing="ease-out" />
                          <Line type="linear" dataKey="discharges" name="Discharges" stroke={grayscalePalette.steel} strokeWidth={2.6} dot={{ r: 2.4, strokeWidth: 0, fill: grayscalePalette.steel }} activeDot={{ ...lineActiveDot, fill: grayscalePalette.steel }} strokeLinecap="round" strokeLinejoin="round" isAnimationActive={chartsAnimate && !reduceMotion} animationDuration={1400} animationEasing="ease-out" />
                        </AreaChart>
                      )}
                      </ResponsiveContainer>
                    ) : (
                      <ChartFallback
                        isLoading={areOperationalChartsLoading}
                        loadingMessage="Loading inpatient trend data..."
                        emptyMessage="No inpatient admissions or discharges in this view."
                      />
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
                    { label: 'Pressure ulcers', color: grayscalePalette.steel },
                    { label: 'HAI', color: grayscalePalette.carbon },
                  ]}
                />
                <div>
                  <div className={trendScale === 'monthly' ? 'h-[430px]' : 'h-[250px]'}>
                    {hasInpatientSafetySignal ? (
                      <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 0, height: 1 }}>
                      {trendScale === 'monthly' ? (
                        renderMonthlyComparison({
                          data: inpatientSafetySeries,
                          series: [
                            { key: 'deaths', name: 'Deaths', color: grayscalePalette.slate },
                            { key: 'ulcers', name: 'New pressure ulcers', color: grayscalePalette.steel },
                            { key: 'hai', name: 'Total HAI', color: grayscalePalette.carbon },
                          ],
                          categoryFormatter: formatMonthlyComparisonTick,
                          tooltipLabelFormatter: formatMonthlyComparisonTooltipLabel,
                          allowDecimals: false,
                        })
                      ) : (
                        <AreaChart
                          data={inpatientSafetySeries}
                          margin={{ top: 12, right: 12, left: 4, bottom: 4 }}
                        >
                          <CartesianGrid strokeDasharray="3 12" stroke={chartGridStroke} vertical={false} />
                          <XAxis dataKey="label" tick={chartTick} axisLine={chartAxisLine} tickLine={chartTickLine} tickMargin={12} padding={trendXPadding} />
                          <YAxis tick={chartTick} axisLine={chartAxisLine} tickLine={chartTickLine} width={34} />
                          <Tooltip contentStyle={lightTooltipStyle} labelStyle={lightTooltipLabelStyle} itemStyle={lightTooltipItemStyle} cursor={tooltipLineCursor} formatter={formatTrendTooltipValue} />
                          <Area type="linear" dataKey="deaths" name="Deaths" stroke={grayscalePalette.slate} fill={grayscalePalette.slate} fillOpacity={0.18} strokeWidth={3} dot={{ r: 2.4, strokeWidth: 0, fill: grayscalePalette.slate }} activeDot={{ ...lineActiveDot, fill: grayscalePalette.slate }} strokeLinecap="round" strokeLinejoin="round" isAnimationActive={chartsAnimate && !reduceMotion} animationDuration={1000} animationEasing="ease-out" />
                          <Line type="linear" dataKey="ulcers" name="New pressure ulcers" stroke={grayscalePalette.steel} strokeWidth={2.7} dot={{ r: 2.2, strokeWidth: 0, fill: grayscalePalette.steel }} activeDot={{ ...lineActiveDot, fill: grayscalePalette.steel }} strokeLinecap="round" strokeLinejoin="round" isAnimationActive={chartsAnimate && !reduceMotion} animationDuration={1200} animationEasing="ease-out" />
                          <Line type="linear" dataKey="hai" name="Total HAI" stroke={grayscalePalette.carbon} strokeWidth={2.7} dot={{ r: 2.2, strokeWidth: 0, fill: grayscalePalette.carbon }} activeDot={{ ...lineActiveDot, fill: grayscalePalette.carbon }} strokeLinecap="round" strokeLinejoin="round" isAnimationActive={chartsAnimate && !reduceMotion} animationDuration={1400} animationEasing="ease-out" />
                        </AreaChart>
                      )}
                      </ResponsiveContainer>
                    ) : (
                      <ChartFallback
                        isLoading={areOperationalChartsLoading}
                        loadingMessage="Loading inpatient safety data..."
                        emptyMessage="No inpatient safety events in this view."
                      />
                    )}
                  </div>
                </div>
              </div>
            </div>
            </div>

            {showInpatientOccupancyAnalytics ? (
              <div className="border-t border-white/60 pt-8">
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
                        <SelectTrigger aria-label="Inpatient occupancy metric scope" className="mt-2 h-10 min-w-0 rounded-[0.25rem] border-[#d9e0e7] bg-[#ffffff] px-3.5 text-left text-[#000a1e] shadow-none focus:ring-0 hover:border-[#c9d4e2]">
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
                      { label: 'BTR', color: grayscalePalette.carbon },
                      { label: 'ALOS', color: grayscalePalette.steel },
                    ]}
                  />
                  <div className="h-[360px]">
                    {/* Ward cells stream in a month at a time, so plotting before
                        the batch settles would draw a curve that is missing its
                        earlier months and then silently redraw. Hold the loading
                        state until the whole range is in. */}
                    {hasInpatientOccupancySignal && !isOccupancyDetailPending ? (
                      <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 0, height: 1 }}>
                        <AreaChart
                          data={inpatientOccupancySeries}
                          margin={{ top: 18, right: 24, left: 0, bottom: 12 }}
                        >
                          <CartesianGrid strokeDasharray="3 12" stroke={chartGridStroke} vertical={false} />
                          <XAxis
                            dataKey="label"
                            tick={chartTick}
                            axisLine={chartAxisLine}
                            tickLine={chartTickLine}
                            tickMargin={12}
                            padding={trendXPadding}
                          />
                          <YAxis tick={chartTick} axisLine={chartAxisLine} tickLine={chartTickLine} width={44} />
                          <Tooltip
                            contentStyle={lightTooltipStyle}
                            labelStyle={lightTooltipLabelStyle}
                            itemStyle={lightTooltipItemStyle}
                            cursor={tooltipLineCursor}
                            labelFormatter={formatChartTooltipLabel}
                          />
                          <Area type="linear" dataKey="bor" name="BOR %" stroke={grayscalePalette.ink} fill={grayscalePalette.ink} fillOpacity={0.18} strokeWidth={3.2} dot={{ r: 2.4, strokeWidth: 0, fill: grayscalePalette.ink }} activeDot={{ ...lineActiveDot, fill: grayscalePalette.ink }} strokeLinecap="round" strokeLinejoin="round" isAnimationActive={chartsAnimate && !reduceMotion} animationDuration={1100} animationEasing="ease-out" />
                          <Line type="linear" dataKey="btr" name="BTR" stroke={grayscalePalette.carbon} strokeWidth={2.6} dot={{ r: 2.2, strokeWidth: 0, fill: grayscalePalette.carbon }} activeDot={{ ...lineActiveDot, fill: grayscalePalette.carbon }} strokeLinecap="round" strokeLinejoin="round" isAnimationActive={chartsAnimate && !reduceMotion} animationDuration={1300} animationEasing="ease-out" />
                          <Line type="linear" dataKey="alos" name="ALOS" stroke={grayscalePalette.steel} strokeWidth={2.6} dot={{ r: 2.2, strokeWidth: 0, fill: grayscalePalette.steel }} activeDot={{ ...lineActiveDot, fill: grayscalePalette.steel }} strokeLinecap="round" strokeLinejoin="round" isAnimationActive={chartsAnimate && !reduceMotion} animationDuration={1500} animationEasing="ease-out" />
                        </AreaChart>
                      </ResponsiveContainer>
                    ) : (
                      <ChartFallback
                        isLoading={isOccupancyChartLoading}
                        loadingMessage="Loading inpatient occupancy data..."
                        emptyMessage={occupancyEmptyMessage}
                      />
                    )}
                  </div>
                </div>
              </div>
            ) : null}
            </div>
          </motion.section>
        </DeferredDashboardSection>
      ) : null}

      {showOutpatientSection ? (
        <DeferredDashboardSection
          eager={familyFilter !== 'all'}
          placeholderClassName="min-h-[76rem]"
        >
          <motion.section
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, ease: 'easeOut' }}
            className={sectionClass}
          >
            <SectionAmbient />
            <div className="space-y-8">
            <SectionHeading
              icon={Stethoscope}
              accent="#005db6"
              accentTint="#edf4fb"
              eyebrow="Outpatient"
              title="Clinic flow and access"
              right={
                <div className="text-left sm:text-right">
                  <AnimatedMetric
                    value={outpatientSeenTotal}
                    variant="compact"
                    className="block font-display text-[1.9rem] font-bold leading-none tabular-nums text-[#000a1e]"
                  />
                  <p className="mt-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-[#74777f]">
                    Patients seen
                  </p>
                </div>
              }
            />

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

              <div className="grid gap-6 xl:grid-cols-2">
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
                <div>
                  <div className={trendScale === 'monthly' ? 'h-[460px]' : 'h-[240px]'}>
                    {hasOutpatientSeenSignal ? (
                      <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 0, height: 1 }}>
                        {trendScale === 'monthly' ? (
                          renderMonthlyComparison({
                            data: outpatientSeenSeries,
                            series: [
                              { key: 'seen', name: 'Seen', color: grayscalePalette.ink },
                              { key: 'notSeenSameDay', name: 'Not seen same day', color: grayscalePalette.steel },
                            ],
                            categoryFormatter: formatOutpatientMonthlyComparisonTick,
                            tooltipLabelFormatter: formatMonthlyComparisonTooltipLabel,
                            allowDecimals: false,
                          })
                      ) : (
                        <AreaChart data={outpatientSeenSeries} margin={{ top: 12, right: 12, left: 4, bottom: 4 }}>
                          <CartesianGrid strokeDasharray="3 12" stroke={chartGridStroke} vertical={false} />
                          <XAxis dataKey="label" tick={chartTick} axisLine={chartAxisLine} tickLine={chartTickLine} tickMargin={12} padding={trendXPadding} />
                          <YAxis tick={chartTick} axisLine={chartAxisLine} tickLine={chartTickLine} width={34} />
                          <Tooltip contentStyle={lightTooltipStyle} labelStyle={lightTooltipLabelStyle} itemStyle={lightTooltipItemStyle} cursor={tooltipLineCursor} formatter={formatTrendTooltipValue} />
                          <Area type="linear" dataKey="seen" name="Seen" stroke={grayscalePalette.ink} fill={grayscalePalette.ink} fillOpacity={0.18} strokeWidth={3} dot={{ r: 2.4, strokeWidth: 0, fill: grayscalePalette.ink }} activeDot={{ ...lineActiveDot, fill: grayscalePalette.ink }} strokeLinecap="round" strokeLinejoin="round" isAnimationActive={chartsAnimate && !reduceMotion} animationDuration={1100} animationEasing="ease-out" />
                          <Line type="linear" dataKey="notSeenSameDay" name="Not seen same day" stroke={grayscalePalette.steel} strokeWidth={2.6} dot={{ r: 2.2, strokeWidth: 0, fill: grayscalePalette.steel }} activeDot={{ ...lineActiveDot, fill: grayscalePalette.steel }} strokeLinecap="round" strokeLinejoin="round" isAnimationActive={chartsAnimate && !reduceMotion} animationDuration={1400} animationEasing="ease-out" />
                        </AreaChart>
                      )}
                      </ResponsiveContainer>
                    ) : (
                      <ChartFallback
                        isLoading={areOperationalChartsLoading}
                        loadingMessage="Loading outpatient trend data..."
                        emptyMessage="No outpatient same-day data in this view."
                      />
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
                <div>
                  <div className={trendScale === 'monthly' ? 'h-[460px]' : 'h-[240px]'}>
                    {hasOutpatientMixSignal ? (
                      <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 0, height: 1 }}>
                        {trendScale === 'monthly' ? (
                          renderMonthlyComparison({
                            data: outpatientVolumeMix,
                            series: [
                              { key: 'totalSeen', name: 'Total seen', color: grayscalePalette.carbon },
                              { key: 'newPatients', name: 'New', color: grayscalePalette.ink },
                              { key: 'followUp', name: 'Follow-up', color: grayscalePalette.cloud },
                            ],
                            categoryFormatter: formatOutpatientMonthlyComparisonTick,
                            tooltipLabelFormatter: formatMonthlyComparisonTooltipLabel,
                            allowDecimals: false,
                          })
                        ) : (
                          <AreaChart data={outpatientVolumeMix} margin={{ top: 12, right: 12, left: 4, bottom: 4 }}>
                            <CartesianGrid strokeDasharray="3 12" stroke={chartGridStroke} vertical={false} />
                            <XAxis dataKey="label" tick={chartTick} axisLine={chartAxisLine} tickLine={chartTickLine} tickMargin={12} padding={trendXPadding} />
                            <YAxis tick={chartTick} axisLine={chartAxisLine} tickLine={chartTickLine} width={34} />
                            <Tooltip contentStyle={lightTooltipStyle} labelStyle={lightTooltipLabelStyle} itemStyle={lightTooltipItemStyle} cursor={tooltipLineCursor} formatter={formatTrendTooltipValue} />
                            <Area type="linear" dataKey="totalSeen" name="Total seen" stroke={grayscalePalette.carbon} fill={grayscalePalette.carbon} fillOpacity={0.18} strokeWidth={3} dot={{ r: 2.4, strokeWidth: 0, fill: grayscalePalette.carbon }} activeDot={{ ...lineActiveDot, fill: grayscalePalette.carbon }} strokeLinecap="round" strokeLinejoin="round" isAnimationActive={chartsAnimate && !reduceMotion} animationDuration={1000} animationEasing="ease-out" />
                            <Line type="linear" dataKey="newPatients" name="New" stroke={grayscalePalette.ink} strokeWidth={2.6} dot={{ r: 2.2, strokeWidth: 0, fill: grayscalePalette.ink }} activeDot={{ ...lineActiveDot, fill: grayscalePalette.ink }} strokeLinecap="round" strokeLinejoin="round" isAnimationActive={chartsAnimate && !reduceMotion} animationDuration={1200} animationEasing="ease-out" />
                            <Line type="linear" dataKey="followUp" name="Follow-up" stroke={grayscalePalette.cloud} strokeWidth={2.6} dot={{ r: 2.2, strokeWidth: 0, fill: grayscalePalette.cloud }} activeDot={{ ...lineActiveDot, fill: grayscalePalette.cloud }} strokeLinecap="round" strokeLinejoin="round" isAnimationActive={chartsAnimate && !reduceMotion} animationDuration={1400} animationEasing="ease-out" />
                          </AreaChart>
                        )}
                      </ResponsiveContainer>
                    ) : (
                      <ChartFallback
                        isLoading={areOperationalChartsLoading}
                        loadingMessage="Loading outpatient volume data..."
                        emptyMessage="No outpatient clinic volume in this view."
                      />
                    )}
                  </div>
                </div>
              </div>
            </div>

              <div className="grid gap-6 border-t border-white/60 pt-8 xl:grid-cols-2">
              <div className={cn('space-y-5', chartPanelClass)}>
                <h3 className={chartTitleClass}>
                  {trendScale === 'monthly' ? 'Follow-up wait time by department' : 'Follow-up wait time trend'}
                </h3>
                <div>
                  <div className={trendScale === 'monthly' ? 'h-[430px]' : 'h-[230px]'}>
                    {hasFollowUpWaitSignal ? (
                      <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 0, height: 1 }}>
                        {trendScale === 'monthly' ? (
                          renderMonthlyComparison({
                            data: outpatientFollowUpWaitSeries,
                            series: [
                              { key: 'wait', name: 'Follow-up wait (months)', color: grayscalePalette.ink },
                            ],
                            categoryFormatter: formatOutpatientMonthlyComparisonTick,
                            tooltipLabelFormatter: formatMonthlyComparisonTooltipLabel,
                          })
                      ) : (
                        <AreaChart data={outpatientFollowUpWaitSeries} margin={{ top: 12, right: 12, left: 4, bottom: 4 }}>
                          <CartesianGrid strokeDasharray="3 12" stroke={chartGridStroke} vertical={false} />
                          <XAxis dataKey="label" tick={chartTick} axisLine={chartAxisLine} tickLine={chartTickLine} tickMargin={12} padding={trendXPadding} />
                          <YAxis tick={chartTick} axisLine={chartAxisLine} tickLine={chartTickLine} width={34} />
                          <Tooltip contentStyle={lightTooltipStyle} labelStyle={lightTooltipLabelStyle} itemStyle={lightTooltipItemStyle} cursor={tooltipLineCursor} formatter={formatTrendTooltipValue} />
                          <Area type="linear" dataKey="wait" name="Follow-up wait (months)" stroke={grayscalePalette.ink} fill={grayscalePalette.ink} fillOpacity={0.18} strokeWidth={3} dot={{ r: 2.6, strokeWidth: 0, fill: grayscalePalette.ink }} activeDot={{ ...lineActiveDot, fill: grayscalePalette.ink }} strokeLinecap="round" strokeLinejoin="round" isAnimationActive={chartsAnimate && !reduceMotion} animationDuration={1200} animationEasing="ease-out" />
                        </AreaChart>
                      )}
                      </ResponsiveContainer>
                    ) : (
                      <ChartFallback
                        isLoading={areOperationalChartsLoading}
                        loadingMessage="Loading outpatient wait data..."
                        emptyMessage="No follow-up wait data in this view."
                      />
                    )}
                  </div>
                </div>
              </div>

              <div className={cn('space-y-5', chartPanelClass)}>
                <h3 className={chartTitleClass}>
                  {trendScale === 'monthly' ? 'Clinic start time by department' : 'Clinic start time trend'}
                </h3>
                <div>
                  <div className={trendScale === 'monthly' ? 'h-[430px]' : 'h-[230px]'}>
                    {hasClinicStartSignal ? (
                      <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 0, height: 1 }}>
                        {trendScale === 'monthly' ? (
                          renderMonthlyComparison({
                            data: outpatientClinicStartSeries,
                            series: [
                              { key: 'startMinutes', name: 'Clinic start', color: grayscalePalette.steel },
                            ],
                            valueFormatter: formatMinutesAsTime,
                            categoryFormatter: formatOutpatientMonthlyComparisonTick,
                            tooltipLabelFormatter: formatMonthlyComparisonTooltipLabel,
                            tooltipFormatter: (value) => [formatMinutesAsTime(Number(value)), 'Start time'],
                          })
                      ) : (
                        <AreaChart data={outpatientClinicStartSeries} margin={{ top: 12, right: 12, left: 4, bottom: 4 }}>
                          <CartesianGrid strokeDasharray="3 12" stroke={chartGridStroke} vertical={false} />
                          <XAxis dataKey="label" tick={chartTick} axisLine={chartAxisLine} tickLine={chartTickLine} tickMargin={12} padding={trendXPadding} />
                          <YAxis tickFormatter={formatMinutesAsTime} tick={chartTick} axisLine={chartAxisLine} tickLine={chartTickLine} width={44} />
                          <Tooltip contentStyle={lightTooltipStyle} labelStyle={lightTooltipLabelStyle} itemStyle={lightTooltipItemStyle} cursor={tooltipLineCursor} formatter={(value) => [formatMinutesAsTime(Number(value)), 'Start time']} />
                          <Area type="linear" dataKey="startMinutes" name="Clinic start" stroke={grayscalePalette.steel} fill={grayscalePalette.steel} fillOpacity={0.18} strokeWidth={3} dot={{ r: 2.6, strokeWidth: 0, fill: grayscalePalette.steel }} activeDot={{ ...lineActiveDot, fill: grayscalePalette.steel }} strokeLinecap="round" strokeLinejoin="round" isAnimationActive={chartsAnimate && !reduceMotion} animationDuration={1200} animationEasing="ease-out" />
                        </AreaChart>
                      )}
                      </ResponsiveContainer>
                    ) : (
                      <ChartFallback
                        isLoading={areOperationalChartsLoading}
                        loadingMessage="Loading clinic start data..."
                        emptyMessage="No clinic start time data in this view."
                      />
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
              <div>
                <div className={trendScale === 'monthly' ? 'h-[430px]' : 'h-[240px]'}>
                  {hasAvailabilitySignal ? (
                    <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 0, height: 1 }}>
                      {trendScale === 'monthly' ? (
                        renderMonthlyComparison({
                          data: outpatientAvailabilitySeries,
                          series: OUTPATIENT_AVAILABILITY_STATUSES.map((status) => ({
                            key: status.key,
                            name: status.label,
                            color: outpatientAvailabilityPalette[status.key],
                          })),
                          categoryFormatter: formatOutpatientMonthlyComparisonTick,
                          tooltipLabelFormatter: formatMonthlyComparisonTooltipLabel,
                          allowDecimals: false,
                        })
                      ) : (
                        <BarChart
                          data={outpatientAvailabilitySeries}
                          margin={{ top: 14, right: 24, left: 0, bottom: 8 }}
                          barGap={5}
                          barCategoryGap="24%"
                        >
                          <CartesianGrid strokeDasharray="3 12" stroke={chartGridStroke} vertical={false} />
                          <XAxis
                            dataKey="label"
                            tick={chartTick}
                            axisLine={chartAxisLine}
                            tickLine={chartTickLine}
                            tickMargin={12}
                            interval={trendTickInterval(outpatientAvailabilitySeries.length)}
                            height={42}
                            padding={trendXPadding}
                          />
                          <YAxis tick={chartTick} axisLine={chartAxisLine} tickLine={chartTickLine} width={44} allowDecimals={false} />
                          <Tooltip
                            contentStyle={lightTooltipStyle}
                            labelStyle={lightTooltipLabelStyle}
                            itemStyle={lightTooltipItemStyle}
                            cursor={tooltipFillCursor}
                            formatter={formatAvailabilityTooltipValue}
                            labelFormatter={formatChartTooltipLabel}
                          />
                          {OUTPATIENT_AVAILABILITY_STATUSES.map((status, index) => (
                            <Bar
                              key={status.key}
                              dataKey={status.key}
                              name={status.label}
                              fill={outpatientAvailabilityPalette[status.key]}
                              radius={[7, 7, 0, 0]}
                              maxBarSize={34}
                              isAnimationActive={chartsAnimate && !reduceMotion}
                              animationDuration={1000 + index * 180}
                              animationEasing="ease-out"
                            />
                          ))}
                        </BarChart>
                      )}
                    </ResponsiveContainer>
                  ) : (
                    <ChartFallback
                      isLoading={areOperationalChartsLoading}
                      loadingMessage="Loading physician availability data..."
                      emptyMessage="No physician availability data in this view."
                    />
                  )}
                </div>
              </div>
            </div>
            </div>
          </motion.section>
        </DeferredDashboardSection>
      ) : null}

      {showProcedureSection ? (
        <DeferredDashboardSection
          eager={familyFilter !== 'all'}
          placeholderClassName="min-h-[64rem]"
        >
          <motion.section
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, ease: 'easeOut' }}
            className={sectionClass}
          >
            <SectionAmbient />
            <div className="space-y-8">
            <SectionHeading
              icon={Activity}
              accent="#0f766e"
              accentTint="#e6f4f1"
              eyebrow="Procedure"
              title="Procedure service totals"
              right={
                <div className="text-left sm:text-right">
                  <AnimatedMetric
                    value={procedureHeaderTotal}
                    variant="compact"
                    className="block font-display text-[1.9rem] font-bold leading-none tabular-nums text-[#000a1e]"
                  />
                  <p className="mt-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-[#74777f]">
                    Procedures
                  </p>
                </div>
              }
            />

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
              <div>
                <div className={trendScale === 'monthly' ? 'h-[460px]' : 'h-[250px]'}>
                  {hasProcedureSignal ? (
                    <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 0, height: 1 }}>
                      {trendScale === 'monthly' ? (
                        renderMonthlyComparison({
                          data: procedureMainSeries,
                          series: [
                            { key: 'total', name: 'Total throughput', color: grayscalePalette.ink },
                          ],
                          cellColorFor: (item) =>
                            procedureServiceColorMap[String(item.serviceId)] ?? grayscalePalette.ink,
                          tooltipContent: <ProcedureServiceTooltip />,
                          categoryFormatter: formatProcedureServiceTick,
                          categoryWidth: 152,
                          allowDecimals: false,
                        })
                      ) : (
                        <AreaChart data={procedureMainSeries} margin={{ top: 14, right: 24, left: 0, bottom: 8 }}>
                          <CartesianGrid strokeDasharray="3 12" stroke={chartGridStroke} vertical={false} />
                          <XAxis dataKey="label" tick={chartTick} axisLine={chartAxisLine} tickLine={chartTickLine} tickMargin={12} padding={trendXPadding} />
                          <YAxis tick={chartTick} axisLine={chartAxisLine} tickLine={chartTickLine} width={44} />
                          <Tooltip
                            contentStyle={lightTooltipStyle}
                            labelStyle={lightTooltipLabelStyle}
                            itemStyle={lightTooltipItemStyle}
                            cursor={tooltipLineCursor}
                            labelFormatter={formatChartTooltipLabel}
                          />
                          <Area
                            type="linear"
                            dataKey="total"
                            name="Total throughput"
                            stroke={grayscalePalette.ink}
                            fill={grayscalePalette.ink}
                            fillOpacity={0.18}
                            strokeWidth={3}
                            dot={{ r: 2.6, strokeWidth: 0, fill: grayscalePalette.ink }}
                            activeDot={{ ...lineActiveDot, fill: grayscalePalette.ink }}
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            isAnimationActive={chartsAnimate && !reduceMotion}
                            animationDuration={1100}
                            animationEasing="ease-out"
                          />
                        </AreaChart>
                      )}
                    </ResponsiveContainer>
                  ) : (
                    <ChartFallback
                      isLoading={areOperationalChartsLoading}
                      loadingMessage="Loading procedure throughput data..."
                      emptyMessage="No procedure throughput in this view."
                    />
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
                  items={resolvedDialysisMix.map((item) => ({
                    label: item.label,
                    color: procedureMixColorMap[item.key as keyof typeof procedureMixColorMap],
                  }))}
                />
                <div className="h-[300px]">
                  {hasDialysisMixSignal ? (
                    <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 0, height: 1 }}>
                      <BarChart data={resolvedDialysisMix} margin={{ top: 14, right: 24, left: 0, bottom: 8 }}>
                        <CartesianGrid strokeDasharray="3 12" stroke={chartGridStroke} vertical={false} />
                        <XAxis dataKey="label" tick={chartTick} axisLine={chartAxisLine} tickLine={chartTickLine} tickMargin={12} padding={trendXPadding} />
                        <YAxis tick={chartTick} axisLine={chartAxisLine} tickLine={chartTickLine} width={44} allowDecimals={false} />
                        <Tooltip
                          cursor={tooltipFillCursor}
                          content={<ProcedureMixTooltip />}
                        />
                        <Bar dataKey="value" name="Dialysis" maxBarSize={42} radius={[6, 6, 0, 0]} isAnimationActive={chartsAnimate && !reduceMotion} animationDuration={1200} animationEasing="ease-out">
                          {resolvedDialysisMix.map((item) => (
                            <Cell key={item.key} fill={procedureMixColorMap[item.key as keyof typeof procedureMixColorMap]} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  ) : (
                    <ChartFallback
                      isLoading={areOperationalChartsLoading}
                      loadingMessage="Loading dialysis data..."
                      emptyMessage="No dialysis data in this selected range."
                    />
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
                  items={resolvedEndoscopyMix.map((item) => ({
                    label: item.label,
                    color: procedureMixColorMap[item.key as keyof typeof procedureMixColorMap],
                  }))}
                />
                <div className="h-[300px]">
                  {hasEndoscopyMixSignal ? (
                    <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 0, height: 1 }}>
                      <BarChart data={resolvedEndoscopyMix} margin={{ top: 14, right: 24, left: 0, bottom: 8 }}>
                        <CartesianGrid strokeDasharray="3 12" stroke={chartGridStroke} vertical={false} />
                        <XAxis dataKey="label" tick={chartTick} axisLine={chartAxisLine} tickLine={chartTickLine} tickMargin={12} padding={trendXPadding} />
                        <YAxis tick={chartTick} axisLine={chartAxisLine} tickLine={chartTickLine} width={44} allowDecimals={false} />
                        <Tooltip
                          cursor={tooltipFillCursor}
                          content={<ProcedureMixTooltip />}
                        />
                        <Bar dataKey="value" name="Endoscopy" maxBarSize={42} radius={[6, 6, 0, 0]} isAnimationActive={chartsAnimate && !reduceMotion} animationDuration={1200} animationEasing="ease-out">
                          {resolvedEndoscopyMix.map((item) => (
                            <Cell key={item.key} fill={procedureMixColorMap[item.key as keyof typeof procedureMixColorMap]} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  ) : (
                    <ChartFallback
                      isLoading={areOperationalChartsLoading}
                      loadingMessage="Loading endoscopy data..."
                      emptyMessage="No endoscopy mix in this view."
                    />
                  )}
                </div>
              </div>
                ) : null}
              </div>
            ) : null}
            </div>
          </motion.section>
        </DeferredDashboardSection>
      ) : null}

    </div>
  )
}
