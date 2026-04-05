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

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
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
        'flex h-full flex-col items-center justify-center gap-3 rounded-[1.75rem] border border-dashed px-6 text-center backdrop-blur-sm',
        tone === 'dark'
          ? 'border-white/12 bg-white/6 text-cyan-50/82'
          : 'border-sky-100/80 bg-[linear-gradient(180deg,rgba(255,255,255,0.8),rgba(244,249,255,0.62))] text-slate-500',
      )}
    >
      <Sparkles className={cn('h-5 w-5', tone === 'dark' ? 'text-cyan-200' : 'text-sky-500')} />
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
  return (
    <div className="pointer-events-none absolute inset-0">
      <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-[#1d4ed8] via-[#38bdf8] to-[#14b8a6]" />
      <div className="absolute -left-10 top-10 h-40 w-40 rounded-full bg-[#1d4ed8]/10 blur-3xl" />
      <div className="absolute right-10 top-14 h-48 w-48 rounded-full bg-[#38bdf8]/10 blur-3xl" />
      <div className="absolute bottom-8 left-[22%] h-36 w-36 rounded-full bg-[#f59e0b]/8 blur-3xl" />
      <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.12)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.12)_1px,transparent_1px)] bg-[size:88px_88px] opacity-20 [mask-image:radial-gradient(circle_at_24%_20%,black_14%,transparent_74%)]" />
    </div>
  )
}

export function AdminDashboardPage() {
  const { state } = useAppData()
  const [familyFilter, setFamilyFilter] = useState<FamilyFilter>('all')
  const currentPeriod = getCurrentPeriod(state)
  const currentPeriodId = currentPeriod?.id ?? ''
  const [periodId, setPeriodId] = useState(currentPeriodId)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const availablePeriods = getVisibleReportingPeriods(state)
  const visibleReportingPeriods = [...availablePeriods].reverse()
  const effectivePeriodId = availablePeriods.some((period) => period.id === periodId)
    ? periodId
    : currentPeriodId
  const scopeFamily = familyFilter === 'all' ? undefined : familyFilter

  const summary = getDashboardSummary(state, effectivePeriodId, scopeFamily)

  if (!summary) {
    return null
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
  const chartGridStroke = '#d9e7f5'
  const chartTick = { fill: '#64748b', fontSize: 12 }
  const grayscalePalette = {
    ink: '#1d4ed8',
    carbon: '#0ea5e9',
    slate: '#14b8a6',
    steel: '#64748b',
    mist: '#f59e0b',
    cloud: '#bfdbfe',
  } as const
  const totalExpected = summary.current.totalExpected
  const deliveredStatuses = new Set<Exclude<StatusFilter, 'all'>>([
    'submitted',
    'edited_after_submission',
    'locked',
  ])
  const effectivePeriodIndex = availablePeriods.findIndex((period) => period.id === effectivePeriodId)
  const trendPeriods =
    effectivePeriodIndex >= 0
      ? availablePeriods.slice(0, effectivePeriodIndex + 1).slice(-8)
      : availablePeriods.slice(-8)
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
    borderRadius: '16px',
    border: '1px solid rgba(191,219,254,0.95)',
    backgroundColor: 'rgba(255,255,255,0.96)',
    boxShadow: '0 20px 40px -32px rgba(30,58,138,0.22)',
  }
  const sectionClass =
    'relative overflow-hidden rounded-[3rem] border border-white/75 bg-[linear-gradient(135deg,rgba(255,255,255,0.94),rgba(242,248,255,0.86),rgba(236,253,245,0.72),rgba(255,248,228,0.6))] px-6 py-8 shadow-[0_34px_72px_-48px_rgba(30,58,138,0.2)] backdrop-blur-md md:px-8 md:py-9'
  const chartPanelClass =
    'relative overflow-hidden rounded-[2.15rem] border border-white/75 bg-[linear-gradient(180deg,rgba(255,255,255,0.82),rgba(243,248,255,0.74),rgba(255,255,255,0.66))] p-5 shadow-[0_28px_46px_-34px_rgba(30,58,138,0.18)] backdrop-blur-sm md:p-6'
  const statCardClass =
    'rounded-[1.8rem] border border-white/70 bg-[linear-gradient(180deg,rgba(255,255,255,0.8),rgba(238,246,255,0.66))] px-4 py-4 shadow-[0_22px_34px_-30px_rgba(30,58,138,0.18)] backdrop-blur-sm'

  return (
    <div className="space-y-8 bg-[radial-gradient(circle_at_12%_16%,rgba(29,78,216,0.16),transparent_22%),radial-gradient(circle_at_86%_18%,rgba(56,189,248,0.14),transparent_20%),radial-gradient(circle_at_24%_80%,rgba(245,158,11,0.08),transparent_16%),linear-gradient(180deg,#f7fbff_0%,#edf6ff_42%,#eef8ff_100%)] px-4 py-6 text-slate-950 md:px-6 md:py-8">
      <motion.section
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.28, ease: 'easeOut' }}
        className="relative overflow-hidden rounded-[3.2rem] border border-white/75 bg-[linear-gradient(135deg,rgba(255,255,255,0.92),rgba(241,248,255,0.86),rgba(236,253,245,0.72),rgba(255,248,230,0.64))] px-5 py-6 shadow-[0_36px_72px_-48px_rgba(30,58,138,0.18)] backdrop-blur-md md:px-8 md:py-9"
      >
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-[#1d4ed8] via-[#38bdf8] to-[#14b8a6]" />
          <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.18)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.18)_1px,transparent_1px)] bg-[size:76px_76px] opacity-25 [mask-image:radial-gradient(circle_at_34%_36%,black_18%,transparent_76%)]" />
          <div className="absolute left-[-4%] top-[8%] h-52 w-52 rounded-full bg-white/48 blur-3xl md:h-64 md:w-64" />
          <div className="absolute right-[4%] top-[8%] h-72 w-72 rounded-full bg-sky-200/24 blur-3xl" />
          <div className="absolute bottom-[4%] left-[18%] h-52 w-52 rounded-full bg-amber-100/18 blur-3xl" />
        </div>

        <div className="relative grid gap-8 xl:grid-cols-[minmax(0,1.08fr)_minmax(420px,0.92fr)] xl:items-stretch">
          <div className="flex min-h-full flex-col justify-between gap-8">
            <div className="space-y-6">
              <div className="inline-flex items-center gap-2 rounded-full border border-white/70 bg-white/55 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.28em] text-sky-700 shadow-[0_16px_28px_-22px_rgba(30,58,138,0.16)] backdrop-blur-md">
                <Filter className="h-3.5 w-3.5" />
                Reporting dashboard
              </div>
              <div className="space-y-4">
                <h1 className="max-w-4xl font-display text-5xl leading-[0.94] tracking-tight text-slate-950 md:text-6xl xl:text-[5.4rem]">
                  {selectedPeriodLabel}
                </h1>
                <div className="flex flex-wrap items-center gap-3 text-sm text-slate-600 md:text-[15px]">
                  <span>{familyLabels[familyFilter]}</span>
                  <span className="text-sky-300">/</span>
                  <span>{statusLabels[statusFilter]}</span>
                  <span className="text-sky-300">/</span>
                  <span>
                    {deadlineNote
                      ? `Deadline ${format(deadlineNote, 'EEE, MMM d')} at ${format(deadlineNote, 'HH:mm')}`
                      : 'No deadline set'}
                  </span>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap gap-3">
              <div className="inline-flex items-center gap-3 rounded-full border border-white/75 bg-white/58 px-4 py-2 text-sm text-slate-600 shadow-[0_16px_28px_-24px_rgba(30,58,138,0.16)] backdrop-blur-md">
                <span className="h-2.5 w-2.5 rounded-full bg-gradient-to-r from-[#1d4ed8] via-[#38bdf8] to-[#14b8a6]" />
                <span className="font-medium">{deliveredCount} delivered</span>
              </div>
              <div className="inline-flex items-center gap-3 rounded-full border border-white/75 bg-white/58 px-4 py-2 text-sm text-slate-600 shadow-[0_16px_28px_-24px_rgba(30,58,138,0.16)] backdrop-blur-md">
                <span className="h-2.5 w-2.5 rounded-full bg-[#f59e0b]" />
                <span className="font-medium">{openCount} still open</span>
              </div>
              <div className="inline-flex items-center gap-3 rounded-full border border-white/75 bg-white/58 px-4 py-2 text-sm text-slate-600 shadow-[0_16px_28px_-24px_rgba(30,58,138,0.16)] backdrop-blur-md">
                <span className="h-2.5 w-2.5 rounded-full bg-[#14b8a6]" />
                <span className="font-medium">{deliveryRate}% delivery rate</span>
              </div>
            </div>
          </div>

          <div className="rounded-[2.4rem] border border-white/75 bg-[linear-gradient(180deg,rgba(255,255,255,0.76),rgba(240,246,255,0.68),rgba(255,255,255,0.5))] p-5 shadow-[0_28px_46px_-32px_rgba(30,58,138,0.18)] backdrop-blur-md md:p-6">
            <div className="grid gap-4 md:grid-cols-3">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">
                  Reporting period
                </p>
                <Select value={effectivePeriodId} onValueChange={setPeriodId}>
                  <SelectTrigger className="mt-3 h-14 rounded-[1.1rem] border-white/70 bg-[linear-gradient(180deg,rgba(255,255,255,0.86),rgba(236,245,255,0.74))] px-4 text-left text-slate-950 shadow-[0_18px_28px_-24px_rgba(30,58,138,0.16)] focus:ring-0">
                    <SelectValue placeholder="Reporting period" />
                  </SelectTrigger>
                  <SelectContent side="bottom" align="start" sideOffset={10}>
                    {visibleReportingPeriods.map((period) => (
                      <SelectItem key={period.id} value={period.id}>
                        {period.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">
                  Service line
                </p>
                <Select
                  value={familyFilter}
                  onValueChange={(value) => setFamilyFilter(value as FamilyFilter)}
                >
                  <SelectTrigger className="mt-3 h-14 rounded-[1.1rem] border-white/70 bg-[linear-gradient(180deg,rgba(255,255,255,0.86),rgba(236,245,255,0.74))] px-4 text-left text-slate-950 shadow-[0_18px_28px_-24px_rgba(30,58,138,0.16)] focus:ring-0">
                    <SelectValue placeholder="Service line" />
                  </SelectTrigger>
                  <SelectContent side="bottom" align="start" sideOffset={10}>
                    {serviceLineOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">
                  Status
                </p>
                <Select
                  value={statusFilter}
                  onValueChange={(value) => setStatusFilter(value as StatusFilter)}
                >
                  <SelectTrigger className="mt-3 h-14 rounded-[1.1rem] border-white/70 bg-[linear-gradient(180deg,rgba(255,255,255,0.86),rgba(236,245,255,0.74))] px-4 text-left text-slate-950 shadow-[0_18px_28px_-24px_rgba(30,58,138,0.16)] focus:ring-0">
                    <SelectValue placeholder="Status" />
                  </SelectTrigger>
                  <SelectContent side="bottom" align="start" sideOffset={10}>
                    {statusOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="mt-5 grid gap-4 border-t border-white/60 pt-5 md:grid-cols-2">
              <div className={statCardClass}>
                <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">
                  In scope
                </p>
                <AnimatedMetric
                  value={totalExpected}
                  variant="compact"
                  className="mt-2 block font-display text-4xl leading-none text-slate-950"
                />
              </div>
              <div className={statCardClass}>
                <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">
                  Delivered
                </p>
                <AnimatedMetric
                  value={deliveredCount}
                  variant="compact"
                  className="mt-2 block font-display text-4xl leading-none text-slate-950"
                />
              </div>
              <div className={statCardClass}>
                <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">
                  Open
                </p>
                <AnimatedMetric
                  value={openCount}
                  variant="compact"
                  className="mt-2 block font-display text-4xl leading-none text-slate-950"
                />
              </div>
              <div className={statCardClass}>
                <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">
                  Delivery rate
                </p>
                <AnimatedMetric
                  value={deliveryRate}
                  variant="percent"
                  className="mt-2 block font-display text-4xl leading-none text-slate-950"
                />
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
            <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">
              Reporting status
            </p>
            <h2 className="mt-2 font-display text-3xl text-slate-950 md:text-5xl">
              Submission pulse
            </h2>
          </div>
          <p className="text-sm uppercase tracking-[0.24em] text-slate-400">
            {familyLabels[familyFilter]} / {statusLabels[statusFilter]}
          </p>
        </div>

        <div className="relative mt-8 grid gap-6 xl:grid-cols-[280px_280px_minmax(0,1fr)]">
          <div className={cn('space-y-4', chartPanelClass)}>
            <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">
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
                    <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">
                      {statusCenterLabel}
                    </p>
                    <AnimatedMetric
                      value={statusFocusValue}
                      variant="compact"
                      className="mt-2 block font-display text-5xl leading-none text-slate-950"
                    />
                    <p className="mt-2 text-xs uppercase tracking-[0.22em] text-slate-400">
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
            <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">
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
                    'grid grid-cols-[auto_minmax(0,1fr)_auto_auto] items-center gap-4 border-b border-sky-100/80 py-3 last:border-b-0 last:pb-0',
                    statusFilter !== 'all' && statusFilter !== item.key && 'opacity-35',
                  )}
                >
                  <span className="h-3 w-3 rounded-full" style={{ backgroundColor: item.fill }} />
                  <span className="text-sm font-medium text-slate-700">{item.label}</span>
                  <span className="text-sm text-slate-400">{share}%</span>
                  <AnimatedMetric
                    value={item.count}
                    variant="compact"
                    className="text-lg font-semibold text-slate-950"
                  />
                </motion.div>
              )
            })}
          </div>

          <div className={cn('space-y-4', chartPanelClass)}>
            <div className="flex items-end justify-between gap-4">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">
                  Weekly curve
                </p>
                <h3 className="mt-2 text-2xl font-semibold text-slate-950 md:text-3xl">
                  Delivered, open, overdue
                </h3>
              </div>
              <AnimatedMetric
                value={deliveryRate}
                variant="percent"
                className="font-display text-4xl leading-none text-slate-950"
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
                        <stop offset="0%" stopColor="#1d4ed8" stopOpacity={0.2} />
                        <stop offset="100%" stopColor="#1d4ed8" stopOpacity={0.02} />
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
                    <Tooltip
                      contentStyle={lightTooltipStyle}
                      cursor={{ stroke: 'rgba(56,189,248,0.32)', strokeWidth: 1.2 }}
                    />
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
                      stroke={grayscalePalette.cloud}
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
                <h2 className="mt-2 font-display text-3xl text-slate-950 md:text-5xl">
                  Ward movement and occupancy
                </h2>
              </div>
              <AnimatedMetric
                value={inpatientFlowSeries.at(-1)?.admissions ?? 0}
                variant="compact"
                className="font-display text-4xl leading-none text-slate-950"
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
                        <Tooltip contentStyle={lightTooltipStyle} cursor={{ stroke: 'rgba(56,189,248,0.32)', strokeWidth: 1.2 }} />
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
                      <BarChart
                        data={inpatientSafetySeries}
                        margin={{ top: 12, right: 8, left: -12, bottom: 4 }}
                      >
                        <CartesianGrid strokeDasharray="4 10" stroke={chartGridStroke} vertical={false} />
                        <XAxis dataKey="label" tick={chartTick} axisLine={false} tickLine={false} tickMargin={12} />
                        <YAxis tick={chartTick} axisLine={false} tickLine={false} width={34} />
                        <Tooltip contentStyle={lightTooltipStyle} cursor={{ fill: 'rgba(14,165,233,0.06)' }} />
                        <Bar dataKey="deaths" name="Deaths" fill={grayscalePalette.ink} radius={[8, 8, 0, 0]} isAnimationActive animationDuration={1000} animationEasing="ease-out" />
                        <Bar dataKey="ulcers" name="New pressure ulcers" fill={grayscalePalette.steel} radius={[8, 8, 0, 0]} isAnimationActive animationDuration={1200} animationEasing="ease-out" />
                        <Bar dataKey="hai" name="Total HAI" fill={grayscalePalette.cloud} radius={[8, 8, 0, 0]} isAnimationActive animationDuration={1400} animationEasing="ease-out" />
                      </BarChart>
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
                        <Tooltip contentStyle={lightTooltipStyle} cursor={{ stroke: 'rgba(56,189,248,0.32)', strokeWidth: 1.2 }} />
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
                <h2 className="mt-2 font-display text-3xl text-slate-950 md:text-5xl">
                  Clinic flow and access
                </h2>
              </div>
              <AnimatedMetric
                value={outpatientSeenSeries.at(-1)?.seen ?? 0}
                variant="compact"
                className="font-display text-4xl leading-none text-slate-950"
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
                            <stop offset="0%" stopColor="#0ea5e9" stopOpacity={0.2} />
                            <stop offset="100%" stopColor="#0ea5e9" stopOpacity={0.02} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="4 10" stroke={chartGridStroke} vertical={false} />
                        <XAxis dataKey="label" tick={chartTick} axisLine={false} tickLine={false} tickMargin={12} />
                        <YAxis tick={chartTick} axisLine={false} tickLine={false} width={34} />
                        <Tooltip contentStyle={lightTooltipStyle} cursor={{ stroke: 'rgba(56,189,248,0.32)', strokeWidth: 1.2 }} />
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
                        <Tooltip contentStyle={lightTooltipStyle} cursor={{ fill: 'rgba(14,165,233,0.06)' }} />
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
                        <Tooltip contentStyle={lightTooltipStyle} cursor={{ stroke: 'rgba(56,189,248,0.32)', strokeWidth: 1.2 }} />
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
                        <Tooltip contentStyle={lightTooltipStyle} cursor={{ stroke: 'rgba(56,189,248,0.32)', strokeWidth: 1.2 }} formatter={(value) => [formatMinutesAsTime(Number(value)), 'Start time']} />
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
                        <Tooltip contentStyle={lightTooltipStyle} cursor={{ fill: 'rgba(14,165,233,0.06)' }} />
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
                <h2 className="mt-2 font-display text-3xl text-slate-950 md:text-5xl">
                  Lab and endoscopy totals
                </h2>
              </div>
              <AnimatedMetric
                value={procedureTotals.reduce((sum, item) => sum + item.value, 0)}
                variant="compact"
                className="font-display text-4xl leading-none text-slate-950"
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
                        <Tooltip contentStyle={lightTooltipStyle} cursor={{ fill: 'rgba(14,165,233,0.06)' }} />
                        <Bar dataKey="value" radius={[12, 12, 0, 0]} isAnimationActive animationDuration={1200} animationEasing="ease-out">
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
                        <Tooltip contentStyle={lightTooltipStyle} cursor={{ fill: 'rgba(14,165,233,0.06)' }} />
                        <Bar dataKey="value" radius={[12, 12, 0, 0]} isAnimationActive animationDuration={1200} animationEasing="ease-out">
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
