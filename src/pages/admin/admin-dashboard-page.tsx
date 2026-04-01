import { useState } from 'react'
import { format } from 'date-fns'
import { motion } from 'framer-motion'
import {
  Activity,
  CircleAlert,
  ClipboardCheck,
  Filter,
  LockKeyhole,
  ShieldAlert,
  Sparkles,
  Waves,
} from 'lucide-react'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import { SubmissionBoardGrid } from '@/components/dashboard/submission-board-grid'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  getCurrentPeriod,
  getDashboardSummary,
  getDepartmentComparisonData,
  getLockDeadlineNote,
  getSubmissionBoard,
  getSortedReportingPeriods,
  getTrendSeries,
  getWhatChangedThisWeek,
} from '@/data/selectors'
import { useAppData } from '@/context/app-data-context'
import { cn, formatCompactNumber, formatPercent } from '@/lib/utils'

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
        'flex h-full flex-col items-center justify-center gap-3 rounded-[1.9rem] border border-dashed px-6 text-center',
        tone === 'dark'
          ? 'border-white/12 bg-white/6 text-cyan-50/78'
          : 'border-sky-100/90 bg-white/62 text-slate-500',
      )}
    >
      <Sparkles className={cn('h-5 w-5', tone === 'dark' ? 'text-cyan-200' : 'text-sky-500')} />
      <p className="max-w-xs text-sm leading-6">{message}</p>
    </div>
  )
}

function formatDeltaNote(delta: number | null | undefined) {
  if (delta === null || delta === undefined) {
    return 'No prior week'
  }

  return `${delta >= 0 ? '+' : '-'}${Math.abs(delta).toFixed(0)}% vs last week`
}

function formatShare(count: number, total: number) {
  if (!total) {
    return 0
  }

  return Math.round((count / total) * 100)
}

export function AdminDashboardPage() {
  const { state } = useAppData()
  const [familyFilter, setFamilyFilter] = useState<FamilyFilter>('all')
  const sortedReportingPeriods = getSortedReportingPeriods(state)
  const currentPeriodId = getCurrentPeriod(state)?.id ?? ''
  const [periodId, setPeriodId] = useState(currentPeriodId)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const currentPeriodIndex = currentPeriodId
    ? sortedReportingPeriods.findIndex((period) => period.id === currentPeriodId)
    : -1
  const visibleReportingPeriods =
    currentPeriodIndex >= 0
      ? sortedReportingPeriods.slice(currentPeriodIndex)
      : sortedReportingPeriods
  const effectivePeriodId = sortedReportingPeriods.some((period) => period.id === periodId)
    ? periodId
    : currentPeriodId

  const summary = getDashboardSummary(
    state,
    effectivePeriodId,
    familyFilter === 'all' ? undefined : familyFilter,
  )
  const admissionsTrend = getTrendSeries(
    state,
    'total_admitted_patients',
    familyFilter === 'all' ? undefined : familyFilter,
    undefined,
    { anchorPeriodId: effectivePeriodId, periodCount: 8 },
  )
  const dischargesTrend = getTrendSeries(
    state,
    'discharged_home',
    familyFilter === 'all' ? undefined : familyFilter,
    undefined,
    { anchorPeriodId: effectivePeriodId, periodCount: 8 },
  )
  const noShowTrend = getTrendSeries(
    state,
    'failed_to_come',
    familyFilter === 'all' ? undefined : familyFilter,
    undefined,
    { anchorPeriodId: effectivePeriodId, periodCount: 8 },
  )
  const haiTrend = getTrendSeries(
    state,
    'total_hai',
    familyFilter === 'all' ? undefined : familyFilter,
    undefined,
    { anchorPeriodId: effectivePeriodId, periodCount: 8 },
  )
  const departmentComparison = getDepartmentComparisonData(
    state,
    familyFilter === 'all' ? 'inpatient' : familyFilter,
    effectivePeriodId,
  )
  const insightItems = getWhatChangedThisWeek(
    state,
    familyFilter === 'all' ? undefined : familyFilter,
  )
  const boardRows = getSubmissionBoard(state, 4, effectivePeriodId)
    .filter((row) =>
      familyFilter === 'all' ? true : row.department.family === familyFilter,
    )
    .filter((row) =>
      statusFilter === 'all'
        ? true
        : row.statuses.at(-1)?.status === statusFilter,
    )
    .slice(0, 8)
    .map((row) => ({
      departmentName: row.department.name,
      templateName: row.template.name,
      statuses: row.statuses.map((status) => ({
        label: status.period.label.split(' - ')[0],
        status: status.status,
        href: `/reports/${row.assignment.id}/${status.period.id}`,
      })),
    }))

  if (!summary) {
    return null
  }

  const selectedPeriod = sortedReportingPeriods.find((period) => period.id === effectivePeriodId)
  const deadlineNote = getLockDeadlineNote(state, effectivePeriodId)
  const today = new Date()
  const deliveredCount =
    summary.current.submitted +
    summary.current.locked +
    summary.current.editedAfterSubmission
  const deliveryRate = formatShare(deliveredCount, summary.current.totalExpected)
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
  const admissionsSeries = admissionsTrend.map((point, index) => ({
    ...point,
    admissions: point.value,
    discharges: dischargesTrend[index]?.value ?? 0,
  }))
  const riskSeries = haiTrend.map((point, index) => ({
    ...point,
    hai: point.value,
    noShows: noShowTrend[index]?.value ?? 0,
  }))
  const activityMetricKey =
    familyFilter === 'outpatient' || familyFilter === 'procedure' ? 'visits' : 'admissions'
  const activityMetricLabel =
    familyFilter === 'procedure'
      ? 'Service volume'
      : familyFilter === 'outpatient'
        ? 'Visits'
        : 'Admissions'
  const departmentSeries = departmentComparison
    .map((department) => ({
      ...department,
      value:
        activityMetricKey === 'visits' ? department.visits : department.admissions,
    }))
    .sort((left, right) => right.value - left.value)
    .slice(0, 7)
  const latestAdmissionsPoint = admissionsSeries.at(-1)
  const latestRiskPoint = riskSeries.at(-1)
  const peakFlowPoint = admissionsSeries.reduce<(typeof admissionsSeries)[number] | null>(
    (peak, point) => {
      if (!peak || point.admissions > peak.admissions) {
        return point
      }

      return peak
    },
    null,
  )
  const busiestDepartment = departmentSeries[0]
  const currentFlowBalance =
    (latestAdmissionsPoint?.admissions ?? 0) - (latestAdmissionsPoint?.discharges ?? 0)
  const hasFlowSignal = admissionsSeries.some(
    (point) => point.admissions > 0 || point.discharges > 0,
  )
  const hasRiskSignal = riskSeries.some(
    (point) => point.hai > 0 || point.noShows > 0,
  )
  const hasDepartmentSignal = departmentSeries.some((department) => department.value > 0)
  const lightTooltipStyle = {
    borderRadius: '18px',
    border: '1px solid rgba(191,219,254,0.85)',
    backgroundColor: 'rgba(255,255,255,0.96)',
    boxShadow: '0 18px 30px -22px rgba(15,23,42,0.35)',
  }
  const darkTooltipStyle = {
    borderRadius: '18px',
    border: '1px solid rgba(125,211,252,0.16)',
    backgroundColor: 'rgba(5,23,41,0.92)',
    color: '#e0f2fe',
    boxShadow: '0 18px 30px -22px rgba(2,6,23,0.75)',
  }
  const workflowStats = [
    {
      label: 'Submitted',
      count: summary.current.submitted,
      delta: summary.deltas.submitted,
      Icon: ClipboardCheck,
      accent: 'from-cyan-400 via-sky-500 to-blue-500',
    },
    {
      label: 'Missing',
      count: summary.current.missing,
      delta: summary.deltas.missing,
      Icon: CircleAlert,
      accent: 'from-amber-400 via-orange-400 to-rose-500',
    },
    {
      label: 'Locked',
      count: summary.current.locked,
      delta: summary.deltas.locked,
      Icon: LockKeyhole,
      accent: 'from-blue-500 via-indigo-500 to-cyan-400',
    },
    {
      label: 'Edited',
      count: summary.current.editedAfterSubmission,
      delta: summary.deltas.editedAfterSubmission,
      Icon: Activity,
      accent: 'from-emerald-400 via-teal-500 to-cyan-500',
    },
  ] as const
  const pulseStats = [
    {
      label: 'Coverage',
      value: `${deliveryRate}%`,
    },
    {
      label: 'Admissions',
      value: formatCompactNumber(summary.current.totalAdmissions),
    },
    {
      label: 'Visits',
      value: formatCompactNumber(summary.current.totalOutpatientVisits),
    },
    {
      label: 'BOR',
      value: formatPercent(summary.current.borPercent, 1),
    },
    {
      label: 'HAI',
      value: formatCompactNumber(summary.current.haiCount),
    },
    {
      label: 'No-shows',
      value: formatCompactNumber(summary.current.noShowCount),
    },
  ] as const

  return (
    <div className="space-y-8">
      <section className="relative overflow-hidden px-2 py-4 md:px-4">
        <div className="pointer-events-none absolute inset-0">
          <div className="login-grid-drift absolute inset-0 opacity-50" />
          <div className="login-ambient-drift absolute left-[-4%] top-[8%] h-44 w-44 rounded-full bg-white/56 blur-3xl md:h-56 md:w-56" />
          <div className="login-ambient-drift-reverse absolute right-[6%] top-[8%] h-64 w-64 rounded-full bg-sky-200/32 blur-3xl" />
          <div className="login-ambient-drift absolute bottom-[8%] left-[18%] h-56 w-56 rounded-full bg-teal-200/18 blur-3xl" />
          <div className="login-ring-orbit absolute right-[12%] top-[18%] h-24 w-24 rounded-full border border-sky-200/40" />
          <div className="login-line-flow absolute bottom-[18%] right-[10%] h-px w-32 bg-gradient-to-r from-transparent via-sky-300/65 to-transparent" />
        </div>

        <div className="relative grid gap-8 xl:grid-cols-[minmax(0,1fr)_320px] xl:items-end">
          <motion.div
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            className="max-w-[760px] space-y-4"
          >
            <div className="inline-flex items-center gap-2 rounded-full bg-white/72 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-sky-700 shadow-[0_14px_30px_-24px_rgba(14,165,233,0.55)] backdrop-blur-sm">
              <span className="h-2 w-2 rounded-full bg-sky-500" />
              IM dashboard
            </div>

            <div className="space-y-0">
              <h1 className="font-display max-w-[8ch] text-5xl font-semibold leading-[0.9] tracking-tight text-slate-950 md:text-[5.6rem] xl:text-[6.4rem]">
                Weekly operations
              </h1>
              <p className="pt-5 text-sm font-semibold uppercase tracking-[0.24em] text-slate-500 md:pt-6 md:text-[0.8rem]">
                {selectedPeriod?.label ?? format(today, 'MMMM d, yyyy')}
              </p>
            </div>

            <div className="flex flex-wrap gap-2.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
              <span
                className="login-chip-float rounded-full border border-white/70 bg-white/55 px-3 py-2 backdrop-blur-sm"
                style={{ animationDelay: '700ms' }}
              >
                {familyLabels[familyFilter]}
              </span>
              <span
                className="login-chip-float rounded-full border border-white/70 bg-white/55 px-3 py-2 backdrop-blur-sm"
                style={{ animationDelay: '1400ms' }}
              >
                {statusLabels[statusFilter]}
              </span>
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 22 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.08 }}
            className="grid gap-4 rounded-[2rem] border border-white/65 bg-white/44 p-5 shadow-[0_24px_55px_-34px_rgba(15,23,42,0.2)] backdrop-blur-md xl:justify-self-end"
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1 border-b border-white/70 pb-4 sm:border-b-0 sm:border-r sm:pb-0 sm:pr-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-sky-700">
                  Coverage
                </p>
                <p className="mt-2 font-display text-4xl leading-none text-slate-950">
                  {deliveryRate}%
                </p>
              </div>
              <div className="space-y-1 border-b border-white/70 pb-4 text-left sm:border-b-0 sm:pb-0 sm:pl-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-sky-700">
                  Deadline
                </p>
                <p className="mt-2 text-lg font-semibold text-slate-950">
                  {deadlineNote ? format(deadlineNote, 'EEE, MMM d') : '-'}
                </p>
                <p className="text-xs text-slate-500">
                  {deadlineNote ? format(deadlineNote, 'HH:mm') : 'No deadline'}
                </p>
              </div>
            </div>
            <div className="border-t border-white/70 pt-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-sky-700">
                Today
              </p>
              <p className="mt-2 text-lg font-semibold text-slate-950">
                {format(today, 'EEE, MMM d')}
              </p>
              <p className="text-xs text-slate-500">{format(today, 'yyyy')}</p>
            </div>
          </motion.div>
        </div>
      </section>

      <motion.section
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.28, ease: 'easeOut' }}
        className="relative overflow-hidden rounded-[2rem] border border-white/70 bg-[linear-gradient(135deg,rgba(255,255,255,0.82),rgba(244,249,255,0.76),rgba(235,253,248,0.62))] px-5 py-5 shadow-[0_20px_42px_-34px_rgba(15,23,42,0.18)] backdrop-blur-md"
      >
        <div className="pointer-events-none absolute inset-0">
          <div className="login-ambient-drift absolute right-[12%] top-[-24%] h-32 w-32 rounded-full bg-sky-200/18 blur-3xl" />
          <div className="login-line-flow absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-sky-300/70 to-transparent" />
        </div>

        <div className="relative grid gap-6 xl:grid-cols-[280px_minmax(0,1fr)] xl:gap-8">
          <div className="min-w-0 xl:border-r xl:border-slate-200/75 xl:pr-6">
            <div className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-sky-700">
              <Filter className="h-4 w-4" />
              Reporting window
            </div>
            <Select value={effectivePeriodId} onValueChange={setPeriodId}>
              <SelectTrigger className="mt-3 h-auto rounded-none border-0 border-b border-slate-200/85 bg-transparent px-0 py-2.5 text-left shadow-none focus:ring-0">
                <SelectValue placeholder="Reporting window" />
              </SelectTrigger>
              <SelectContent side="bottom" align="start" sideOffset={10}>
                {visibleReportingPeriods.map((period) => (
                  <SelectItem key={period.id} value={period.id}>
                    {period.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="mt-5 flex items-end justify-between gap-4">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                  Coverage
                </p>
                <p className="mt-2 font-display text-4xl leading-none text-slate-950">
                  {deliveryRate}%
                </p>
              </div>
              <div className="text-right text-sm">
                <p className="font-semibold text-slate-700">{familyLabels[familyFilter]}</p>
                <p className="text-slate-500">{statusLabels[statusFilter]}</p>
              </div>
            </div>
          </div>

          <div className="min-w-0">
            <div className="grid gap-5 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-700">
                  Service line
                </p>
                <div className="flex flex-wrap gap-x-3 gap-y-2">
                  {serviceLineOptions.map((option) => {
                    const isActive = familyFilter === option.value

                    return (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => setFamilyFilter(option.value)}
                        className={cn(
                          'inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-medium transition-all duration-300',
                          isActive
                            ? 'bg-white/88 text-slate-950 shadow-[0_14px_24px_-20px_rgba(14,165,233,0.28)]'
                            : 'text-slate-500 hover:bg-white/45 hover:text-slate-900',
                        )}
                      >
                        <span
                          className={cn(
                            'h-2.5 w-2.5 rounded-full transition-all duration-300',
                            isActive ? 'bg-gradient-to-r from-cyan-400 to-emerald-400' : 'bg-slate-300',
                          )}
                        />
                        {option.label}
                      </button>
                    )
                  })}
                </div>
              </div>

              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-700">
                  Status
                </p>
                <div className="flex flex-wrap gap-x-3 gap-y-2">
                  {statusOptions.map((option) => {
                    const isActive = statusFilter === option.value

                    return (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => setStatusFilter(option.value)}
                        className={cn(
                          'rounded-full px-3 py-1.5 text-sm font-medium transition-all duration-300',
                          isActive
                            ? 'bg-slate-950 text-white shadow-[0_14px_22px_-20px_rgba(15,23,42,0.42)]'
                            : 'text-slate-500 hover:bg-white/45 hover:text-slate-900',
                        )}
                      >
                        {option.label}
                      </button>
                    )
                  })}
                </div>
              </div>
            </div>
          </div>
        </div>
      </motion.section>

      <section className="grid gap-6 2xl:grid-cols-[1.35fr_0.95fr]">
        <motion.section
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, ease: 'easeOut' }}
          className="relative overflow-hidden rounded-[2.6rem] border border-white/70 bg-[linear-gradient(140deg,rgba(255,255,255,0.92),rgba(243,249,255,0.84),rgba(236,253,248,0.72))] px-6 py-6 shadow-[0_26px_54px_-34px_rgba(15,23,42,0.22)]"
        >
          <div className="pointer-events-none absolute inset-0">
            <div className="login-grid-drift absolute inset-0 opacity-25" />
            <div className="login-ambient-drift absolute bottom-[-16%] left-[-4%] h-52 w-52 rounded-full bg-sky-200/20 blur-3xl" />
            <div className="login-line-flow absolute inset-x-6 top-0 h-1 bg-gradient-to-r from-cyan-400 via-sky-500 to-emerald-400" />
          </div>

          <div className="relative">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-sky-700">
                  Delivery
                </p>
                <h2 className="font-display text-3xl text-slate-950 md:text-4xl">Reporting flow</h2>
              </div>

              <div className="text-right">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-sky-700">
                  Delivered
                </p>
                <p className="mt-2 font-display text-4xl text-slate-950">{deliveryRate}%</p>
                <p className="text-xs text-slate-500">
                  {formatCompactNumber(deliveredCount)} of {formatCompactNumber(summary.current.totalExpected)}
                </p>
              </div>
            </div>

            <div className="mt-8 grid gap-6 lg:grid-cols-4">
              {workflowStats.map((stat, index) => {
                const Icon = stat.Icon
                const share = formatShare(stat.count, summary.current.totalExpected)

                return (
                  <motion.div
                    key={stat.label}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.24, ease: 'easeOut', delay: index * 0.04 }}
                    className="relative"
                  >
                    {index < workflowStats.length - 1 ? (
                      <div className="absolute right-[-1rem] top-2 hidden h-[calc(100%-0.5rem)] w-px bg-gradient-to-b from-transparent via-sky-100 to-transparent lg:block" />
                    ) : null}

                    <div className={cn('inline-flex items-center gap-2 rounded-full bg-gradient-to-r px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-white shadow-[0_12px_24px_-18px_rgba(14,165,233,0.55)]', stat.accent)}>
                      <Icon className="h-3.5 w-3.5" />
                      {stat.label}
                    </div>

                    <div className="mt-5 flex items-end justify-between gap-3">
                      <p className="font-display text-5xl leading-none text-slate-950">
                        {formatCompactNumber(stat.count)}
                      </p>
                      <p className="pb-1 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                        {share}% of view
                      </p>
                    </div>

                    <div className="mt-4 h-2 rounded-full bg-slate-200/75">
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${Math.max(share, stat.count ? 10 : 4)}%` }}
                        transition={{ duration: 0.7, ease: 'easeOut', delay: 0.12 + index * 0.04 }}
                        className={cn('login-line-flow h-full rounded-full bg-gradient-to-r', stat.accent)}
                      />
                    </div>

                    <p className="mt-4 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                      {formatDeltaNote(stat.delta)}
                    </p>
                  </motion.div>
                )
              })}
            </div>
          </div>
        </motion.section>

        <motion.section
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, ease: 'easeOut' }}
          className="relative overflow-hidden rounded-[2.6rem] border border-white/10 bg-[linear-gradient(160deg,#071a33_0%,#0b3156_42%,#0f4c81_74%,#0f766e_100%)] px-6 py-6 text-white shadow-[0_30px_58px_-30px_rgba(8,47,73,0.76)]"
        >
          <div className="pointer-events-none absolute inset-0">
            <div className="login-grid-drift absolute inset-0 opacity-18" />
            <div className="login-ambient-drift absolute right-[-6%] top-[-10%] h-56 w-56 rounded-full bg-cyan-300/12 blur-3xl" />
            <div className="login-line-flow absolute inset-x-6 top-0 h-1 bg-gradient-to-r from-cyan-300 via-sky-400 to-emerald-300" />
          </div>

          <div className="relative">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-100">
                  Operational pulse
                </p>
                <h2 className="font-display text-3xl text-white">Core movement</h2>
              </div>

              <div className="rounded-full border border-white/12 bg-white/8 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-100 backdrop-blur-sm">
                {selectedPeriod?.label ?? '-'}
              </div>
            </div>

            <div className="mt-6 flex flex-wrap gap-3">
              {pulseStats.map((stat) => (
                <div
                  key={stat.label}
                  className="rounded-full border border-white/12 bg-white/8 px-4 py-2.5 backdrop-blur-sm"
                >
                  <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-100/65">
                    {stat.label}
                  </p>
                  <p className="mt-1 text-lg font-semibold text-white">{stat.value}</p>
                </div>
              ))}
            </div>

            <div className="mt-8 border-t border-white/10 pt-5">
              <div className="mb-4 flex items-center justify-between gap-4">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-100">
                  Flow pulse
                </p>
                <div className="flex items-center gap-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-cyan-100/72">
                  <span className="inline-flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-cyan-300" />
                    Admissions
                  </span>
                  <span className="inline-flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-emerald-300" />
                    Discharges
                  </span>
                </div>
              </div>

              <div className="h-36">
                {hasFlowSignal ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={admissionsSeries}>
                      <defs>
                        <linearGradient id="dashboardPulseAdmissions" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#67e8f9" stopOpacity={0.46} />
                          <stop offset="100%" stopColor="#67e8f9" stopOpacity={0.02} />
                        </linearGradient>
                        <linearGradient id="dashboardPulseDischarges" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#34d399" stopOpacity={0.32} />
                          <stop offset="100%" stopColor="#34d399" stopOpacity={0.02} />
                        </linearGradient>
                      </defs>
                      <Tooltip
                        contentStyle={darkTooltipStyle}
                        cursor={{ stroke: 'rgba(103,232,249,0.16)', strokeWidth: 1.5 }}
                      />
                      <XAxis hide dataKey="shortLabel" />
                      <YAxis hide />
                      <Area
                        type="monotone"
                        dataKey="admissions"
                        stroke="#67e8f9"
                        fill="url(#dashboardPulseAdmissions)"
                        strokeWidth={2.8}
                        isAnimationActive
                        animationDuration={1100}
                        animationEasing="ease-out"
                      />
                      <Area
                        type="monotone"
                        dataKey="discharges"
                        stroke="#34d399"
                        fill="url(#dashboardPulseDischarges)"
                        strokeWidth={2.2}
                        isAnimationActive
                        animationDuration={1450}
                        animationEasing="ease-out"
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                ) : (
                  <ChartEmptyState
                    message="No recorded flow movement for this view yet."
                    tone="dark"
                  />
                )}
              </div>
            </div>
          </div>
        </motion.section>
      </section>

      <section className="grid gap-6 2xl:grid-cols-[1.35fr_0.95fr]">
        <motion.section
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, ease: 'easeOut' }}
          className="relative overflow-hidden rounded-[2.6rem] border border-white/70 bg-[linear-gradient(160deg,rgba(255,255,255,0.94),rgba(244,249,255,0.84),rgba(237,253,249,0.72))] px-6 py-6 shadow-[0_24px_54px_-36px_rgba(15,23,42,0.22)]"
        >
          <div className="pointer-events-none absolute inset-0">
            <div className="login-ambient-drift absolute left-[-8%] top-[-12%] h-52 w-52 rounded-full bg-sky-200/16 blur-3xl" />
            <div className="login-grid-drift absolute inset-0 opacity-20" />
            <div className="login-line-flow absolute inset-x-6 top-0 h-1 bg-gradient-to-r from-cyan-400 via-sky-500 to-blue-500" />
          </div>

          <div className="relative space-y-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-sky-700">
                  Care flow
                </p>
                <h2 className="font-display text-3xl text-slate-950 md:text-4xl">
                  Admissions and discharges
                </h2>
              </div>

              <div className="flex flex-wrap gap-3">
                <span className="inline-flex items-center gap-2 rounded-full bg-sky-50/90 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-sky-700">
                  <span className="h-2.5 w-2.5 rounded-full bg-sky-500 shadow-[0_0_0_4px_rgba(14,165,233,0.12)]" />
                  Admissions {formatCompactNumber(latestAdmissionsPoint?.admissions ?? 0)}
                </span>
                <span className="inline-flex items-center gap-2 rounded-full bg-blue-50/90 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-blue-700">
                  <span className="h-2.5 w-2.5 rounded-full bg-blue-500 shadow-[0_0_0_4px_rgba(59,130,246,0.12)]" />
                  Discharges {formatCompactNumber(latestAdmissionsPoint?.discharges ?? 0)}
                </span>
                <span className="inline-flex items-center gap-2 rounded-full bg-white/78 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-600 shadow-[0_14px_24px_-20px_rgba(15,23,42,0.15)]">
                  Balance {currentFlowBalance >= 0 ? '+' : '-'}
                  {formatCompactNumber(Math.abs(currentFlowBalance))}
                </span>
                <span className="inline-flex items-center gap-2 rounded-full bg-white/78 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-600 shadow-[0_14px_24px_-20px_rgba(15,23,42,0.15)]">
                  Peak {peakFlowPoint?.shortLabel ?? '-'}
                </span>
              </div>
            </div>

            <div className="h-[340px]">
              {hasFlowSignal ? (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={admissionsSeries} margin={{ top: 12, right: 8, left: -12, bottom: 4 }}>
                    <defs>
                      <linearGradient id="dashboardAdmissionsStroke" x1="0" y1="0" x2="1" y2="0">
                        <stop offset="0%" stopColor="#06b6d4" />
                        <stop offset="55%" stopColor="#3b82f6" />
                        <stop offset="100%" stopColor="#2563eb" />
                      </linearGradient>
                      <linearGradient id="dashboardDischargesStroke" x1="0" y1="0" x2="1" y2="0">
                        <stop offset="0%" stopColor="#38bdf8" />
                        <stop offset="55%" stopColor="#60a5fa" />
                        <stop offset="100%" stopColor="#34d399" />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="4 10" stroke="#d7e6f6" vertical={false} />
                    <XAxis
                      dataKey="shortLabel"
                      tick={{ fill: '#6b7d96', fontSize: 12 }}
                      axisLine={false}
                      tickLine={false}
                      tickMargin={12}
                    />
                    <YAxis
                      tick={{ fill: '#6b7d96', fontSize: 12 }}
                      axisLine={false}
                      tickLine={false}
                      width={36}
                    />
                    <Tooltip
                      contentStyle={lightTooltipStyle}
                      cursor={{ stroke: 'rgba(59,130,246,0.12)', strokeWidth: 1.5 }}
                    />
                    <Line
                      type="monotone"
                      dataKey="admissions"
                      name="Admissions"
                      stroke="url(#dashboardAdmissionsStroke)"
                      strokeWidth={4}
                      dot={false}
                      activeDot={{ r: 6, fill: '#0ea5e9', strokeWidth: 0 }}
                      isAnimationActive
                      animationDuration={1100}
                      animationEasing="ease-out"
                    />
                    <Line
                      type="monotone"
                      dataKey="discharges"
                      name="Discharges"
                      stroke="url(#dashboardDischargesStroke)"
                      strokeWidth={3.4}
                      dot={false}
                      activeDot={{ r: 5, fill: '#34d399', strokeWidth: 0 }}
                      isAnimationActive
                      animationDuration={1450}
                      animationEasing="ease-out"
                    />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <ChartEmptyState message="No admissions or discharges were reported in this filtered view." />
              )}
            </div>
          </div>
        </motion.section>

        <motion.section
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, ease: 'easeOut' }}
          className="relative overflow-hidden rounded-[2.6rem] border border-white/10 bg-[linear-gradient(160deg,#051729_0%,#082f49_36%,#0f4c81_74%,#115e59_100%)] px-6 py-6 text-white shadow-[0_30px_58px_-32px_rgba(2,6,23,0.72)]"
        >
          <div className="pointer-events-none absolute inset-0">
            <div className="login-grid-drift absolute inset-0 opacity-18" />
            <div className="login-ambient-drift absolute left-[-10%] top-[6%] h-52 w-52 rounded-full bg-fuchsia-400/10 blur-3xl" />
            <div className="login-ambient-drift-reverse absolute right-[-8%] bottom-[-12%] h-52 w-52 rounded-full bg-cyan-300/10 blur-3xl" />
            <div className="login-line-flow absolute inset-x-6 top-0 h-1 bg-gradient-to-r from-rose-400 via-amber-300 to-cyan-300" />
          </div>

          <div className="relative space-y-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-100">
                  Risk
                </p>
                <h2 className="font-display text-3xl text-white">Safety and no-shows</h2>
              </div>

              <div className="flex flex-wrap gap-3">
                <span className="rounded-full border border-white/12 bg-white/8 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-cyan-100 backdrop-blur-sm">
                  {familyLabels[familyFilter]}
                </span>
                <span className="inline-flex items-center gap-2 rounded-full bg-white/8 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-cyan-100/80">
                  <span className="h-2.5 w-2.5 rounded-full bg-rose-400 shadow-[0_0_0_4px_rgba(244,63,94,0.12)]" />
                  HAI {formatCompactNumber(latestRiskPoint?.hai ?? 0)}
                </span>
                <span className="inline-flex items-center gap-2 rounded-full bg-white/8 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-cyan-100/80">
                  <span className="h-2.5 w-2.5 rounded-full bg-amber-300 shadow-[0_0_0_4px_rgba(245,158,11,0.12)]" />
                  No-shows {formatCompactNumber(latestRiskPoint?.noShows ?? 0)}
                </span>
              </div>
            </div>

            <div className="h-[340px]">
              {hasRiskSignal ? (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={riskSeries} margin={{ top: 12, right: 8, left: -12, bottom: 4 }}>
                    <defs>
                      <linearGradient id="dashboardHaiArea" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#fb7185" stopOpacity={0.42} />
                        <stop offset="100%" stopColor="#fb7185" stopOpacity={0.02} />
                      </linearGradient>
                      <linearGradient id="dashboardNoShowArea" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#fbbf24" stopOpacity={0.34} />
                        <stop offset="100%" stopColor="#fbbf24" stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="4 10" stroke="rgba(186,230,253,0.12)" vertical={false} />
                    <XAxis
                      dataKey="shortLabel"
                      tick={{ fill: 'rgba(224,242,254,0.72)', fontSize: 12 }}
                      axisLine={false}
                      tickLine={false}
                      tickMargin={12}
                    />
                    <YAxis
                      tick={{ fill: 'rgba(224,242,254,0.72)', fontSize: 12 }}
                      axisLine={false}
                      tickLine={false}
                      width={32}
                    />
                    <Tooltip
                      contentStyle={darkTooltipStyle}
                      cursor={{ stroke: 'rgba(251,191,36,0.16)', strokeWidth: 1.5 }}
                    />
                    <Area
                      type="monotone"
                      dataKey="hai"
                      name="HAI"
                      stroke="#fb7185"
                      fill="url(#dashboardHaiArea)"
                      strokeWidth={3}
                      isAnimationActive
                      animationDuration={1150}
                      animationEasing="ease-out"
                    />
                    <Area
                      type="monotone"
                      dataKey="noShows"
                      name="No-shows"
                      stroke="#fbbf24"
                      fill="url(#dashboardNoShowArea)"
                      strokeWidth={3}
                      isAnimationActive
                      animationDuration={1500}
                      animationEasing="ease-out"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <ChartEmptyState
                  message="No safety or no-show spikes have been reported in this filtered view."
                  tone="dark"
                />
              )}
            </div>
          </div>
        </motion.section>
      </section>

      <section className="grid gap-6 2xl:grid-cols-[1.05fr_0.95fr]">
        <motion.section
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, ease: 'easeOut' }}
          className="relative overflow-hidden rounded-[2.6rem] border border-white/70 bg-[linear-gradient(160deg,rgba(255,255,255,0.94),rgba(244,249,255,0.84),rgba(240,252,252,0.72))] px-6 py-6 shadow-[0_24px_54px_-36px_rgba(15,23,42,0.22)]"
        >
          <div className="pointer-events-none absolute inset-0">
            <div className="login-grid-drift absolute inset-0 opacity-18" />
            <div className="login-line-flow absolute inset-x-6 top-0 h-1 bg-gradient-to-r from-cyan-400 via-sky-500 to-emerald-400" />
          </div>

          <div className="relative space-y-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-sky-700">
                  Department ranking
                </p>
                <h2 className="font-display text-3xl text-slate-950">Activity by service</h2>
              </div>

              <div className="text-right">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                  Leading service
                </p>
                <p className="mt-2 text-lg font-semibold text-slate-950">
                  {busiestDepartment?.name ?? 'No data'}
                </p>
                <p className="text-sm text-slate-500">
                  {busiestDepartment
                    ? `${formatCompactNumber(busiestDepartment.value)} ${activityMetricLabel.toLowerCase()}`
                    : 'No activity yet'}
                </p>
              </div>
            </div>

            <div className="h-[340px]">
              {hasDepartmentSignal ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    layout="vertical"
                    data={departmentSeries}
                    margin={{ top: 8, right: 10, left: 4, bottom: 8 }}
                  >
                    <CartesianGrid strokeDasharray="4 10" stroke="#d7e6f6" horizontal={false} />
                    <XAxis
                      type="number"
                      tick={{ fill: '#6b7d96', fontSize: 12 }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis
                      dataKey="name"
                      type="category"
                      width={118}
                      tick={{ fill: '#475569', fontSize: 12 }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <Tooltip contentStyle={lightTooltipStyle} cursor={{ fill: 'rgba(14,165,233,0.06)' }} />
                    <Bar
                      dataKey="value"
                      name={activityMetricLabel}
                      radius={[0, 12, 12, 0]}
                      barSize={22}
                      isAnimationActive
                      animationDuration={1250}
                      animationEasing="ease-out"
                    >
                      {departmentSeries.map((department) => (
                        <Cell key={department.id} fill={department.accent} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <ChartEmptyState message="No department activity has landed in this view yet." />
              )}
            </div>
          </div>
        </motion.section>

        <motion.section
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, ease: 'easeOut' }}
          className="relative overflow-hidden rounded-[2.6rem] border border-white/10 bg-[linear-gradient(160deg,#07152d_0%,#0b3156_42%,#0f4c81_72%,#0f766e_100%)] px-6 py-6 text-white shadow-[0_30px_58px_-32px_rgba(8,47,73,0.76)]"
        >
          <div className="pointer-events-none absolute inset-0">
            <div className="login-grid-drift absolute inset-0 opacity-18" />
            <div className="login-ambient-drift absolute right-[-8%] top-[-10%] h-52 w-52 rounded-full bg-cyan-300/12 blur-3xl" />
            <div className="login-line-flow absolute inset-x-6 top-0 h-1 bg-gradient-to-r from-cyan-300 via-sky-400 to-emerald-300" />
          </div>

          <div className="relative">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="flex items-start gap-4">
                <div className="rounded-[1.4rem] border border-white/12 bg-white/8 p-3 backdrop-blur-sm">
                  <Waves className="h-5 w-5 text-cyan-100" />
                </div>
                <div className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-100">
                    Attention
                  </p>
                  <h2 className="font-display text-3xl text-white">Live change signals</h2>
                </div>
              </div>

              <div className="rounded-full border border-white/12 bg-white/8 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-100 backdrop-blur-sm">
                {deliveryRate}% delivered
              </div>
            </div>

            <div className="mt-8 grid gap-4 sm:grid-cols-3">
              <div className="border-t border-white/12 pt-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-100/72">
                  Missing
                </p>
                <p className="mt-2 text-3xl font-semibold text-white">
                  {formatCompactNumber(summary.current.missing)}
                </p>
              </div>
              <div className="border-t border-white/12 pt-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-100/72">
                  Locked
                </p>
                <p className="mt-2 text-3xl font-semibold text-white">
                  {formatCompactNumber(summary.current.locked)}
                </p>
              </div>
              <div className="border-t border-white/12 pt-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-100/72">
                  Edited
                </p>
                <p className="mt-2 text-3xl font-semibold text-white">
                  {formatCompactNumber(summary.current.editedAfterSubmission)}
                </p>
              </div>
            </div>

            <div className="mt-8 border-t border-white/10 pt-5">
              <div className="mb-4 flex items-center gap-3">
                <ShieldAlert className="h-5 w-5 text-cyan-100" />
                <p className="text-sm font-semibold text-white">Signals</p>
              </div>

              <div className="space-y-4">
                {insightItems.length ? (
                  insightItems.map((item, index) => (
                    <motion.div
                      key={`${item}-${index}`}
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.22, ease: 'easeOut', delay: index * 0.03 }}
                      className="border-t border-white/10 pt-4 first:border-t-0 first:pt-0"
                    >
                      <div className="flex gap-3 text-sm leading-7 text-cyan-50/88">
                        <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-cyan-300 login-dot-blink" />
                        <span>{item}</span>
                      </div>
                    </motion.div>
                  ))
                ) : (
                  <p className="text-sm leading-7 text-cyan-50/78">
                    No material shifts crossed the configured thresholds this week.
                  </p>
                )}
              </div>
            </div>
          </div>
        </motion.section>
      </section>

      <SubmissionBoardGrid
        title="Reporting runway"
        description="Current week forward."
        rows={boardRows}
      />
    </div>
  )
}
