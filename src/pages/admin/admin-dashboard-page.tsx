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
  deriveReportStatus,
  getCurrentPeriod,
  getDashboardSummary,
  getReportForAssignmentPeriod,
  getLockDeadlineNote,
  getVisibleReportingPeriods,
} from '@/data/selectors'
import { useAppData } from '@/context/app-data-context'
import { departments, departmentMap, templateMap } from '@/config/templates'
import { computeWeeklyValue } from '@/lib/metrics'
import { cn, formatCompactNumber } from '@/lib/utils'
import type { ReportFamily, ReportRecord } from '@/types/domain'

type FamilyFilter = 'all' | 'inpatient' | 'outpatient' | 'procedure'
type StatusFilter =
  | 'all'
  | 'draft'
  | 'submitted'
  | 'edited_after_submission'
  | 'locked'
  | 'not_started'
  | 'overdue'

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
        'flex h-full flex-col items-center justify-center gap-3 rounded-[0.5rem] border border-dashed px-6 text-center',
        tone === 'dark'
          ? 'border-white/12 bg-white/6 text-[#c6d3e4]'
          : 'border-[#d9e0e7] bg-[#f8fafc] text-[#6c7078]',
      )}
    >
      <Sparkles className={cn('h-5 w-5', tone === 'dark' ? 'text-[#f0b429]' : 'text-[#005db6]')} />
      <p className="max-w-xs text-sm leading-6">{message}</p>
    </div>
  )
}

function formatShare(count: number, total: number) {
  if (!total) {
    return 0
  }

  return Math.round((count / total) * 100)
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

export function AdminDashboardPage() {
  const { state, ensureReportDetails, isSyncing } = useAppData()
  const [familyFilter, setFamilyFilter] = useState<FamilyFilter>('all')
  const currentPeriod = getCurrentPeriod(state)
  const currentPeriodId = currentPeriod?.id ?? ''
  const [periodId, setPeriodId] = useState(currentPeriodId)
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
  const effectivePeriodIndex = availablePeriods.findIndex((period) => period.id === effectivePeriodId)
  const trendPeriods =
    effectivePeriodIndex >= 0
      ? availablePeriods.slice(0, effectivePeriodIndex + 1).slice(-8)
      : availablePeriods.slice(-8)
  const detailReportingPeriodIds = new Set(trendPeriods.map((period) => period.id))
  const detailReportIds = state.reports
    .filter((report) => detailReportingPeriodIds.has(report.reportingPeriodId))
    .map((report) => report.id)

  useEffect(() => {
    void ensureReportDetails(detailReportIds)
  }, [detailReportIds, ensureReportDetails])

  const summary = getDashboardSummary(state, effectivePeriodId, scopeFamily)

  if (!summary) {
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
  const statusOptions = [
    { value: 'all' as const, label: 'All statuses' },
    { value: 'not_started' as const, label: 'Not started' },
    { value: 'draft' as const, label: 'Draft' },
    { value: 'submitted' as const, label: 'Submitted' },
    { value: 'edited_after_submission' as const, label: 'Edited' },
    { value: 'locked' as const, label: 'Locked' },
    { value: 'overdue' as const, label: 'Overdue' },
  ] as const
  const chartGridStroke = '#d4dde8'
  const chartTick = { fill: '#6c7078', fontSize: 12 }
  const grayscalePalette = {
    ink: '#005db6',
    carbon: '#446b95',
    slate: '#002147',
    steel: '#67778a',
    mist: '#f0b429',
    cloud: '#9bb2ca',
  } as const
  const tooltipLineCursor = { stroke: 'rgba(0,93,182,0.22)', strokeWidth: 1.2 } as const
  const tooltipFillCursor = { fill: 'rgba(0,33,71,0.045)' } as const
  const totalExpected = summary.current.totalExpected
  const deliveredStatuses = new Set<Exclude<StatusFilter, 'all'>>([
    'submitted',
    'edited_after_submission',
    'locked',
  ])
  const selectedPeriodLabel =
    availablePeriods.find((period) => period.id === effectivePeriodId)?.label ??
    currentPeriod?.label ??
    'Current reporting period'
  const scopedAssignments = state.assignments.filter((assignment) =>
    familyFilter === 'all' ? true : departmentMap[assignment.departmentId].family === familyFilter,
  )
  const getPeriodReports = (periodId: string, family: ReportFamily) =>
    state.reports.filter(
      (report) =>
        report.reportingPeriodId === periodId &&
        departmentMap[report.departmentId].family === family,
    )
  const sumFieldTotals = (periodId: string, family: ReportFamily, fieldIds: string[]) =>
    getPeriodReports(periodId, family).reduce((total, report) => {
      const reportTotal = fieldIds.reduce((fieldTotal, fieldId) => {
        const value = getReportWeeklyFieldValue(report, fieldId)
        return fieldTotal + (typeof value === 'number' ? value : 0)
      }, 0)

      return total + reportTotal
    }, 0)
  const averageFieldValue = (periodId: string, family: ReportFamily, fieldId: string) => {
    const values = getPeriodReports(periodId, family)
      .map((report) => getReportWeeklyFieldValue(report, fieldId))
      .filter((value): value is number => typeof value === 'number' && !Number.isNaN(value))

    if (!values.length) {
      return null
    }

    return values.reduce((sum, value) => sum + value, 0) / values.length
  }
  const averageTimeValue = (periodId: string, family: ReportFamily, fieldId: string) => {
    const values = getPeriodReports(periodId, family)
      .map((report) => parseTimeToMinutes(getReportWeeklyFieldValue(report, fieldId) as string | null))
      .filter((value): value is number => value !== null)

    if (!values.length) {
      return null
    }

    return values.reduce((sum, value) => sum + value, 0) / values.length
  }
  const scopedStatuses = scopedAssignments.map((assignment) =>
      deriveReportStatus(
        state,
        effectivePeriodId,
        getReportForAssignmentPeriod(state, assignment.id, effectivePeriodId),
      ),
    )
  const countStatus = (status: Exclude<StatusFilter, 'all'>) =>
    scopedStatuses.filter((value) => value === status).length
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
  const reportingTrendSeries = trendPeriods.map((period) => {
    const statuses = scopedAssignments.map((assignment) =>
      deriveReportStatus(state, period.id, getReportForAssignmentPeriod(state, assignment.id, period.id)),
    )
    const delivered = statuses.filter((value) => deliveredStatuses.has(value)).length
    const overdue = statuses.filter((value) => value === 'overdue').length

    return {
      label: format(new Date(period.weekStart), 'MMM d'),
      delivered,
      open: Math.max(statuses.length - delivered, 0),
      overdue,
    }
  })
  const showInpatientSection = familyFilter === 'all' || familyFilter === 'inpatient'
  const showOutpatientSection = familyFilter === 'all' || familyFilter === 'outpatient'
  const showProcedureSection = familyFilter === 'all' || familyFilter === 'procedure'
  const inpatientFlowSeries = trendPeriods.map((period) => ({
    label: format(new Date(period.weekStart), 'MMM d'),
    admissions: sumFieldTotals(period.id, 'inpatient', ['total_admitted_patients']),
    discharges: sumFieldTotals(period.id, 'inpatient', ['discharged_home', 'discharged_ama']),
  }))
  const inpatientSafetySeries = trendPeriods.map((period) => ({
    label: format(new Date(period.weekStart), 'MMM d'),
    deaths: sumFieldTotals(period.id, 'inpatient', ['new_deaths']),
    ulcers: sumFieldTotals(period.id, 'inpatient', ['new_pressure_ulcer']),
    hai: sumFieldTotals(period.id, 'inpatient', ['total_hai']),
  }))
  const inpatientOccupancySeries = trendPeriods.map((period) => {
    const periodSummary = getDashboardSummary(state, period.id, 'inpatient')

    return {
      label: format(new Date(period.weekStart), 'MMM d'),
      bor: periodSummary?.current.borPercent ?? null,
      btr: periodSummary?.current.btr ?? null,
      alos: periodSummary?.current.alos ?? null,
    }
  })
  const outpatientSeenSeries = trendPeriods.map((period) => ({
    label: format(new Date(period.weekStart), 'MMM d'),
    seen: sumFieldTotals(period.id, 'outpatient', ['total_patients_seen']),
    notSeenSameDay: sumFieldTotals(period.id, 'outpatient', ['not_seen_same_day']),
  }))
  const outpatientFollowUpWaitSeries = trendPeriods.map((period) => ({
    label: format(new Date(period.weekStart), 'MMM d'),
    wait: averageFieldValue(period.id, 'outpatient', 'wait_time_followup_months'),
  }))
  const outpatientClinicStartSeries = trendPeriods.map((period) => ({
    label: format(new Date(period.weekStart), 'MMM d'),
    startMinutes: averageTimeValue(period.id, 'outpatient', 'clinic_start_time'),
  }))
  const currentOutpatientReports = getPeriodReports(effectivePeriodId, 'outpatient')
  const availabilityOptions = ['Full day', 'Partial day', 'Unavailable'] as const
  const outpatientAvailability = availabilityOptions.map((label) => ({
    label,
    value: currentOutpatientReports.filter(
      (report) => getReportWeeklyFieldValue(report, 'senior_physician_availability') === label,
    ).length,
    fill:
      label === 'Full day'
        ? grayscalePalette.ink
        : label === 'Partial day'
          ? grayscalePalette.steel
          : grayscalePalette.cloud,
  }))
  const outpatientVolumeMix = departments
    .filter((department) => department.family === 'outpatient')
    .map((department) => {
      const report = state.reports.find(
        (item) =>
          item.reportingPeriodId === effectivePeriodId && item.departmentId === department.id,
      )
      const totalSeen = report
        ? (getReportWeeklyFieldValue(report, 'total_patients_seen') as number | null) ?? 0
        : 0
      const newPatients = report
        ? (getReportWeeklyFieldValue(report, 'new_patients_seen') as number | null) ?? 0
        : 0
      const followUp = report
        ? (getReportWeeklyFieldValue(report, 'follow_up_patients') as number | null) ?? 0
        : 0

      return {
        id: department.id,
        name: department.name,
        totalSeen,
        newPatients,
        followUp,
        accent: department.accent,
      }
    })
    .filter((department) => department.totalSeen > 0)
    .sort((left, right) => right.totalSeen - left.totalSeen)
    .slice(0, 8)
  const procedureTotals = [
    { label: 'Echo', value: sumFieldTotals(effectivePeriodId, 'procedure', ['echo_done']), fill: grayscalePalette.ink },
    { label: 'ECG', value: sumFieldTotals(effectivePeriodId, 'procedure', ['ecg_done']), fill: grayscalePalette.carbon },
    { label: 'EEG', value: sumFieldTotals(effectivePeriodId, 'procedure', ['eeg_done']), fill: grayscalePalette.steel },
    {
      label: 'Endoscopy',
      value: sumFieldTotals(effectivePeriodId, 'procedure', [
        'upper_gi_elective',
        'upper_gi_emergency',
        'ercp',
        'therapeutic_upper_gi',
        'esophageal_dilation',
        'variceal_ligation',
        'stenting',
      ]),
      fill: grayscalePalette.mist,
    },
  ]
  const endoscopyMix = [
    {
      label: 'UGI',
      value: sumFieldTotals(effectivePeriodId, 'procedure', ['upper_gi_elective', 'upper_gi_emergency']),
      fill: grayscalePalette.ink,
    },
    { label: 'Colonoscopy', value: sumFieldTotals(effectivePeriodId, 'procedure', ['colonoscopy']), fill: grayscalePalette.slate },
    { label: 'Bronchoscopy', value: sumFieldTotals(effectivePeriodId, 'procedure', ['bronchoscopy']), fill: grayscalePalette.steel },
    { label: 'Ligation', value: sumFieldTotals(effectivePeriodId, 'procedure', ['variceal_ligation']), fill: grayscalePalette.cloud },
  ]
  const hasReportingTrendSignal = reportingTrendSeries.some(
    (point) => point.delivered > 0 || point.open > 0 || point.overdue > 0,
  )
  const hasInpatientFlowSignal = inpatientFlowSeries.some(
    (point) => point.admissions > 0 || point.discharges > 0,
  )
  const hasInpatientSafetySignal = inpatientSafetySeries.some(
    (point) => point.deaths > 0 || point.ulcers > 0 || point.hai > 0,
  )
  const hasInpatientOccupancySignal = inpatientOccupancySeries.some(
    (point) =>
      point.bor !== null ||
      point.btr !== null ||
      point.alos !== null,
  )
  const hasOutpatientSeenSignal = outpatientSeenSeries.some(
    (point) => point.seen > 0 || point.notSeenSameDay > 0,
  )
  const hasFollowUpWaitSignal = outpatientFollowUpWaitSeries.some((point) => point.wait !== null)
  const hasClinicStartSignal = outpatientClinicStartSeries.some((point) => point.startMinutes !== null)
  const hasAvailabilitySignal = outpatientAvailability.some((item) => item.value > 0)
  const hasOutpatientMixSignal = outpatientVolumeMix.some((item) => item.totalSeen > 0)
  const hasProcedureSignal = procedureTotals.some((item) => item.value > 0)
  const hasEndoscopyMixSignal = endoscopyMix.some((item) => item.value > 0)
  const lightTooltipStyle = {
    borderRadius: '8px',
    border: '1px solid rgba(212, 221, 232, 0.95)',
    backgroundColor: 'rgba(255,255,255,0.98)',
    boxShadow: '0 20px 40px rgba(0,33,71,0.08)',
  }
  const sectionClass =
    'rounded-[0.35rem] bg-[#f1f4f7] px-5 py-6 md:px-6 md:py-7'
  const chartPanelClass =
    'rounded-[0.35rem] bg-[#f8fafc] p-5 outline outline-1 outline-[#d9e0e7]/75 md:p-5'

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
                  {selectedPeriodLabel}
                </h1>
                <div className="flex flex-wrap items-center gap-3 text-sm text-[#44474e] md:text-[15px]">
                  <span>{familyLabels[familyFilter]}</span>
                  <span className="text-[#f0b429]">/</span>
                  <span>{statusLabels[statusFilter]}</span>
                  <span className="text-[#f0b429]">/</span>
                  <span>
                    {deadlineNote
                      ? `Deadline ${format(deadlineNote, 'EEE, MMM d')} at ${format(deadlineNote, 'HH:mm')}`
                      : 'No deadline set'}
                  </span>
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

          <ReportingScopePanel
            className="self-start w-full max-w-[760px] xl:justify-self-end"
            fields={[
              {
                label: 'Reporting period',
                options: reportingPeriodOptions,
                placeholder: 'Reporting period',
                value: effectivePeriodId,
                onValueChange: setPeriodId,
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
                    <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#74777f]">
                      {statusCenterLabel}
                    </p>
                    <AnimatedMetric
                      value={statusFocusValue}
                      variant="compact"
                      className="mt-2 block font-display text-[2.6rem] leading-none text-[#000a1e]"
                    />
                    <p className="mt-2 text-xs uppercase tracking-[0.22em] text-[#74777f]">
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

          <div className={cn('space-y-4', chartPanelClass)}>
            <div className="flex items-end justify-between gap-4">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[#74777f]">
                  Weekly curve
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
            <div className="h-[300px]">
              {hasReportingTrendSignal ? (
                <ResponsiveContainer width="100%" height="100%">
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
                    <CartesianGrid strokeDasharray="4 10" stroke={chartGridStroke} vertical={false} />
                    <XAxis
                      dataKey="label"
                      tick={chartTick}
                      axisLine={false}
                      tickLine={false}
                      tickMargin={12}
                    />
                    <YAxis tick={chartTick} axisLine={false} tickLine={false} width={34} />
                    <Tooltip contentStyle={lightTooltipStyle} cursor={tooltipLineCursor} />
                    <Area
                      type="monotone"
                      dataKey="delivered"
                      name="Delivered"
                      stroke={grayscalePalette.ink}
                      fill="url(#reportingDeliveredFill)"
                      strokeWidth={3}
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
                      isAnimationActive
                      animationDuration={1500}
                      animationEasing="ease-out"
                    />
                  </AreaChart>
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
                value={inpatientFlowSeries.at(-1)?.admissions ?? 0}
                variant="compact"
                className="font-display text-[2rem] leading-none text-slate-950"
              />
            </div>

            <div className="grid gap-6 xl:grid-cols-3">
              <div className={cn('space-y-4', chartPanelClass)}>
                <h3 className="text-sm font-semibold uppercase tracking-[0.24em] text-slate-500">
                  Admissions vs discharges
                </h3>
                <div className="h-[320px]">
                  {hasInpatientFlowSignal ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart
                        data={inpatientFlowSeries}
                        margin={{ top: 12, right: 8, left: -12, bottom: 4 }}
                      >
                        <CartesianGrid strokeDasharray="4 10" stroke={chartGridStroke} vertical={false} />
                        <XAxis dataKey="label" tick={chartTick} axisLine={false} tickLine={false} tickMargin={12} />
                        <YAxis tick={chartTick} axisLine={false} tickLine={false} width={34} />
                        <Tooltip contentStyle={lightTooltipStyle} cursor={tooltipLineCursor} />
                        <Line type="monotone" dataKey="admissions" name="Admissions" stroke={grayscalePalette.ink} strokeWidth={3.4} dot={false} activeDot={{ r: 5, fill: grayscalePalette.ink, strokeWidth: 0 }} isAnimationActive animationDuration={1100} animationEasing="ease-out" />
                        <Line type="monotone" dataKey="discharges" name="Discharges" stroke={grayscalePalette.steel} strokeWidth={2.8} dot={false} activeDot={{ r: 5, fill: grayscalePalette.steel, strokeWidth: 0 }} isAnimationActive animationDuration={1400} animationEasing="ease-out" />
                      </LineChart>
                    </ResponsiveContainer>
                  ) : (
                    <ChartEmptyState message="No inpatient admissions or discharges in this view." />
                  )}
                </div>
              </div>

              <div className={cn('space-y-4', chartPanelClass)}>
                <h3 className="text-sm font-semibold uppercase tracking-[0.24em] text-slate-500">
                  Deaths, pressure ulcers, HAI
                </h3>
                <div className="h-[320px]">
                  {hasInpatientSafetySignal ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart
                        data={inpatientSafetySeries}
                        margin={{ top: 12, right: 8, left: -12, bottom: 4 }}
                      >
                        <CartesianGrid strokeDasharray="4 10" stroke={chartGridStroke} vertical={false} />
                        <XAxis dataKey="label" tick={chartTick} axisLine={false} tickLine={false} tickMargin={12} />
                        <YAxis tick={chartTick} axisLine={false} tickLine={false} width={34} />
                        <Tooltip contentStyle={lightTooltipStyle} cursor={tooltipLineCursor} />
                        <Line type="monotone" dataKey="deaths" name="Deaths" stroke={grayscalePalette.slate} strokeWidth={3} dot={false} activeDot={{ r: 5, fill: grayscalePalette.slate, strokeWidth: 0 }} isAnimationActive animationDuration={1000} animationEasing="ease-out" />
                        <Line type="monotone" dataKey="ulcers" name="New pressure ulcers" stroke={grayscalePalette.ink} strokeWidth={2.7} dot={false} activeDot={{ r: 5, fill: grayscalePalette.ink, strokeWidth: 0 }} isAnimationActive animationDuration={1200} animationEasing="ease-out" />
                        <Line type="monotone" dataKey="hai" name="Total HAI" stroke={grayscalePalette.carbon} strokeWidth={2.7} dot={false} activeDot={{ r: 5, fill: grayscalePalette.carbon, strokeWidth: 0 }} isAnimationActive animationDuration={1400} animationEasing="ease-out" />
                      </LineChart>
                    </ResponsiveContainer>
                  ) : (
                    <ChartEmptyState message="No inpatient safety events in this view." />
                  )}
                </div>
              </div>

              <div className={cn('space-y-4', chartPanelClass)}>
                <h3 className="text-sm font-semibold uppercase tracking-[0.24em] text-slate-500">
                  BOR / BTR / ALOS
                </h3>
                <div className="h-[320px]">
                  {hasInpatientOccupancySignal ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart
                        data={inpatientOccupancySeries}
                        margin={{ top: 12, right: 8, left: -12, bottom: 4 }}
                      >
                        <CartesianGrid strokeDasharray="4 10" stroke={chartGridStroke} vertical={false} />
                        <XAxis dataKey="label" tick={chartTick} axisLine={false} tickLine={false} tickMargin={12} />
                        <YAxis tick={chartTick} axisLine={false} tickLine={false} width={38} />
                        <Tooltip contentStyle={lightTooltipStyle} cursor={tooltipLineCursor} />
                        <Line type="monotone" dataKey="bor" name="BOR %" stroke={grayscalePalette.ink} strokeWidth={3.2} dot={false} isAnimationActive animationDuration={1100} animationEasing="ease-out" />
                        <Line type="monotone" dataKey="btr" name="BTR" stroke={grayscalePalette.slate} strokeWidth={2.6} dot={false} isAnimationActive animationDuration={1300} animationEasing="ease-out" />
                        <Line type="monotone" dataKey="alos" name="ALOS" stroke={grayscalePalette.cloud} strokeWidth={2.6} dot={false} isAnimationActive animationDuration={1500} animationEasing="ease-out" />
                      </LineChart>
                    </ResponsiveContainer>
                  ) : (
                    <ChartEmptyState message="No BOR, BTR, or ALOS data in this view." />
                  )}
                </div>
              </div>
            </div>
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
                value={outpatientSeenSeries.at(-1)?.seen ?? 0}
                variant="compact"
                className="font-display text-[2rem] leading-none text-slate-950"
              />
            </div>

            <div className="grid gap-6 xl:grid-cols-2">
              <div className={cn('space-y-4', chartPanelClass)}>
                <h3 className="text-sm font-semibold uppercase tracking-[0.24em] text-slate-500">
                  Seen vs not seen same day
                </h3>
                <div className="h-[300px]">
                  {hasOutpatientSeenSignal ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={outpatientSeenSeries} margin={{ top: 12, right: 8, left: -12, bottom: 4 }}>
                        <defs>
                          <linearGradient id="outpatientSeenFill" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#005db6" stopOpacity={0.18} />
                            <stop offset="100%" stopColor="#005db6" stopOpacity={0.02} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="4 10" stroke={chartGridStroke} vertical={false} />
                        <XAxis dataKey="label" tick={chartTick} axisLine={false} tickLine={false} tickMargin={12} />
                        <YAxis tick={chartTick} axisLine={false} tickLine={false} width={34} />
                        <Tooltip contentStyle={lightTooltipStyle} cursor={tooltipLineCursor} />
                        <Area type="monotone" dataKey="seen" name="Seen" stroke={grayscalePalette.ink} fill="url(#outpatientSeenFill)" strokeWidth={3} isAnimationActive animationDuration={1100} animationEasing="ease-out" />
                        <Line type="monotone" dataKey="notSeenSameDay" name="Not seen same day" stroke={grayscalePalette.steel} strokeWidth={2.6} dot={false} isAnimationActive animationDuration={1400} animationEasing="ease-out" />
                      </AreaChart>
                    </ResponsiveContainer>
                  ) : (
                    <ChartEmptyState message="No outpatient same-day data in this view." />
                  )}
                </div>
              </div>

              <div className={cn('space-y-4', chartPanelClass)}>
                <h3 className="text-sm font-semibold uppercase tracking-[0.24em] text-slate-500">
                  Total seen, new vs follow-up
                </h3>
                <div className="h-[300px]">
                  {hasOutpatientMixSignal ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart layout="vertical" data={outpatientVolumeMix} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
                        <CartesianGrid strokeDasharray="4 10" stroke={chartGridStroke} horizontal={false} />
                        <XAxis type="number" tick={chartTick} axisLine={false} tickLine={false} />
                        <YAxis dataKey="name" type="category" width={110} tick={{ fill: '#475569', fontSize: 12 }} axisLine={false} tickLine={false} />
                        <Tooltip contentStyle={lightTooltipStyle} cursor={tooltipFillCursor} />
                        <Bar dataKey="newPatients" name="New" stackId="outpatientMix" fill={grayscalePalette.ink} radius={[0, 0, 0, 0]} isAnimationActive animationDuration={1100} animationEasing="ease-out" />
                        <Bar dataKey="followUp" name="Follow-up" stackId="outpatientMix" fill={grayscalePalette.cloud} radius={[0, 10, 10, 0]} isAnimationActive animationDuration={1400} animationEasing="ease-out" />
                      </BarChart>
                    </ResponsiveContainer>
                  ) : (
                    <ChartEmptyState message="No outpatient clinic volume in this view." />
                  )}
                </div>
              </div>
            </div>

            <div className="grid gap-6 border-t border-white/60 pt-8 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_280px]">
              <div className={cn('space-y-4', chartPanelClass)}>
                <h3 className="text-sm font-semibold uppercase tracking-[0.24em] text-slate-500">
                  Follow-up wait time trend
                </h3>
                <div className="h-[260px]">
                  {hasFollowUpWaitSignal ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={outpatientFollowUpWaitSeries} margin={{ top: 12, right: 8, left: -12, bottom: 4 }}>
                        <CartesianGrid strokeDasharray="4 10" stroke={chartGridStroke} vertical={false} />
                        <XAxis dataKey="label" tick={chartTick} axisLine={false} tickLine={false} tickMargin={12} />
                        <YAxis tick={chartTick} axisLine={false} tickLine={false} width={34} />
                        <Tooltip contentStyle={lightTooltipStyle} cursor={tooltipLineCursor} />
                        <Line type="monotone" dataKey="wait" name="Follow-up wait (months)" stroke={grayscalePalette.ink} strokeWidth={3} dot={false} activeDot={{ r: 5, fill: grayscalePalette.ink, strokeWidth: 0 }} isAnimationActive animationDuration={1200} animationEasing="ease-out" />
                      </LineChart>
                    </ResponsiveContainer>
                  ) : (
                    <ChartEmptyState message="No follow-up wait data in this view." />
                  )}
                </div>
              </div>

              <div className={cn('space-y-4', chartPanelClass)}>
                <h3 className="text-sm font-semibold uppercase tracking-[0.24em] text-slate-500">
                  Clinic start time trend
                </h3>
                <div className="h-[260px]">
                  {hasClinicStartSignal ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={outpatientClinicStartSeries} margin={{ top: 12, right: 8, left: -12, bottom: 4 }}>
                        <CartesianGrid strokeDasharray="4 10" stroke={chartGridStroke} vertical={false} />
                        <XAxis dataKey="label" tick={chartTick} axisLine={false} tickLine={false} tickMargin={12} />
                        <YAxis tickFormatter={formatMinutesAsTime} tick={chartTick} axisLine={false} tickLine={false} width={44} />
                        <Tooltip contentStyle={lightTooltipStyle} cursor={tooltipLineCursor} formatter={(value) => [formatMinutesAsTime(Number(value)), 'Start time']} />
                        <Line type="monotone" dataKey="startMinutes" name="Clinic start" stroke={grayscalePalette.steel} strokeWidth={3} dot={false} activeDot={{ r: 5, fill: grayscalePalette.steel, strokeWidth: 0 }} isAnimationActive animationDuration={1200} animationEasing="ease-out" />
                      </LineChart>
                    </ResponsiveContainer>
                  ) : (
                    <ChartEmptyState message="No clinic start time data in this view." />
                  )}
                </div>
              </div>

              <div className={cn('space-y-4', chartPanelClass)}>
                <h3 className="text-sm font-semibold uppercase tracking-[0.24em] text-slate-500">
                  Senior physician availability
                </h3>
                <div className="h-[260px]">
                  {hasAvailabilitySignal ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={outpatientAvailability} margin={{ top: 8, right: 8, left: -12, bottom: 8 }}>
                        <CartesianGrid strokeDasharray="4 10" stroke={chartGridStroke} vertical={false} />
                        <XAxis dataKey="label" tick={chartTick} axisLine={false} tickLine={false} interval={0} tickMargin={12} />
                        <YAxis tick={chartTick} axisLine={false} tickLine={false} width={28} />
                        <Tooltip contentStyle={lightTooltipStyle} cursor={tooltipFillCursor} />
                        <Bar dataKey="value" radius={[10, 10, 0, 0]} isAnimationActive animationDuration={1200} animationEasing="ease-out">
                          {outpatientAvailability.map((item) => (
                            <Cell key={item.label} fill={item.fill} />
                          ))}
                        </Bar>
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
                value={procedureTotals.reduce((sum, item) => sum + item.value, 0)}
                variant="compact"
                className="font-display text-[2rem] leading-none text-slate-950"
              />
            </div>

            <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)]">
              <div className={cn('space-y-4', chartPanelClass)}>
                <h3 className="text-sm font-semibold uppercase tracking-[0.24em] text-slate-500">
                  Echo, ECG, EEG, endoscopy
                </h3>
                <div className="h-[300px]">
                  {hasProcedureSignal ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={procedureTotals} margin={{ top: 12, right: 8, left: -12, bottom: 4 }}>
                        <CartesianGrid strokeDasharray="4 10" stroke={chartGridStroke} vertical={false} />
                        <XAxis dataKey="label" tick={chartTick} axisLine={false} tickLine={false} tickMargin={12} />
                        <YAxis tick={chartTick} axisLine={false} tickLine={false} width={34} />
                        <Tooltip contentStyle={lightTooltipStyle} cursor={tooltipFillCursor} />
                        <Bar dataKey="value" radius={[10, 10, 0, 0]} isAnimationActive animationDuration={1200} animationEasing="ease-out">
                          {procedureTotals.map((item) => (
                            <Cell key={item.label} fill={item.fill} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  ) : (
                    <ChartEmptyState message="No procedure totals in this view." />
                  )}
                </div>
              </div>

              <div className={cn('space-y-4', chartPanelClass)}>
                <h3 className="text-sm font-semibold uppercase tracking-[0.24em] text-slate-500">
                  UGI, colonoscopy, bronchoscopy, ligation
                </h3>
                <div className="h-[300px]">
                  {hasEndoscopyMixSignal ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={endoscopyMix} margin={{ top: 12, right: 8, left: -12, bottom: 4 }}>
                        <CartesianGrid strokeDasharray="4 10" stroke={chartGridStroke} vertical={false} />
                        <XAxis dataKey="label" tick={chartTick} axisLine={false} tickLine={false} tickMargin={12} />
                        <YAxis tick={chartTick} axisLine={false} tickLine={false} width={34} />
                        <Tooltip contentStyle={lightTooltipStyle} cursor={tooltipFillCursor} />
                        <Bar dataKey="value" radius={[10, 10, 0, 0]} isAnimationActive animationDuration={1200} animationEasing="ease-out">
                          {endoscopyMix.map((item) => (
                            <Cell key={item.label} fill={item.fill} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  ) : (
                    <ChartEmptyState message="No endoscopy mix in this view." />
                  )}
                </div>
              </div>
            </div>
          </div>
        </motion.section>
      ) : null}

    </div>
  )
}
