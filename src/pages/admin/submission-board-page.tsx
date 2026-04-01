import { useState } from 'react'
import { format } from 'date-fns'
import { motion } from 'framer-motion'
import { Filter } from 'lucide-react'

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
  getVisibleReportingPeriods,
  getSubmissionBoard,
} from '@/data/selectors'
import { useAppData } from '@/context/app-data-context'
import { cn, formatCompactNumber } from '@/lib/utils'
import type { ReportStatus } from '@/types/domain'

type ServiceLineFilter = 'all' | 'inpatient' | 'outpatient' | 'procedure'
type StatusFilter = 'all' | ReportStatus

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

export function SubmissionBoardPage() {
  const { state } = useAppData()
  const currentPeriod = getCurrentPeriod(state)
  const currentPeriodId = currentPeriod?.id ?? ''
  const [periodId, setPeriodId] = useState(currentPeriodId)
  const [serviceLineFilter, setServiceLineFilter] =
    useState<ServiceLineFilter>('all')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')

  const visibleReportingPeriods = [...getVisibleReportingPeriods(state)].reverse()
  const effectivePeriodId = visibleReportingPeriods.some((period) => period.id === periodId)
    ? periodId
    : currentPeriodId
  const selectedPeriod =
    visibleReportingPeriods.find((period) => period.id === effectivePeriodId) ?? currentPeriod
  const summary = getDashboardSummary(
    state,
    effectivePeriodId,
    serviceLineFilter === 'all' ? undefined : serviceLineFilter,
  )

  if (!summary) {
    return null
  }

  const scopedBoardRows = getSubmissionBoard(
    state,
    visibleReportingPeriods.length,
    effectivePeriodId,
  ).filter(
    (row) =>
      serviceLineFilter === 'all'
        ? true
        : row.department.family === serviceLineFilter,
  )

  const filteredBoardRows = scopedBoardRows.filter((row) =>
    statusFilter === 'all' ? true : row.statuses[0]?.status === statusFilter,
  )

  const rows = filteredBoardRows.map((row) => ({
    departmentName: row.department.name,
    templateName: row.template.name,
    statuses: row.statuses.map((status) => ({
      label: status.period.label.split(' - ')[0],
      status: status.status,
      href: `/reports/${row.assignment.id}/${status.period.id}`,
    })),
  }))

  const statusCounts = {
    submitted: scopedBoardRows.filter((row) => row.statuses[0]?.status === 'submitted')
      .length,
    missing: scopedBoardRows.filter((row) => row.statuses[0]?.status === 'not_started')
      .length,
    draft: scopedBoardRows.filter((row) => row.statuses[0]?.status === 'draft').length,
    edited: scopedBoardRows.filter(
      (row) => row.statuses[0]?.status === 'edited_after_submission',
    ).length,
    locked: scopedBoardRows.filter((row) => row.statuses[0]?.status === 'locked').length,
    overdue: scopedBoardRows.filter((row) => row.statuses[0]?.status === 'overdue').length,
  }

  const deliveredCount =
    summary.current.submitted +
    summary.current.locked +
    summary.current.editedAfterSubmission
  const deliveryRate = summary.current.totalExpected
    ? Math.round((deliveredCount / summary.current.totalExpected) * 100)
    : 0
  const scopeLabel =
    serviceLineOptions.find((option) => option.value === serviceLineFilter)?.label ??
    'All services'
  const statusLabel =
    statusOptions.find((option) => option.value === statusFilter)?.label ??
    'All statuses'
  const inlineSummaryItems = [
    {
      label: 'Rows',
      value: filteredBoardRows.length,
      tone: 'border-slate-200/80 bg-white/78 text-slate-700',
    },
    {
      label: 'Missing',
      value: statusCounts.missing,
      tone: 'border-amber-200/80 bg-amber-50/90 text-amber-800',
    },
    {
      label: 'Submitted',
      value: statusCounts.submitted,
      tone: 'border-cyan-200/80 bg-cyan-50/90 text-cyan-800',
    },
    {
      label: 'Overdue',
      value: statusCounts.overdue,
      tone: 'border-rose-200/80 bg-rose-50/90 text-rose-800',
    },
  ] as const

  return (
    <div className="space-y-8">
      <section className="relative overflow-hidden px-2 py-4 md:px-4">
        <div className="pointer-events-none absolute inset-0">
          <div className="login-grid-drift absolute inset-0 opacity-45" />
          <div className="login-ambient-drift absolute left-[-4%] top-[6%] h-44 w-44 rounded-full bg-white/56 blur-3xl md:h-56 md:w-56" />
          <div className="login-ambient-drift-reverse absolute right-[10%] top-[8%] h-60 w-60 rounded-full bg-sky-200/26 blur-3xl" />
          <div className="login-ambient-drift absolute bottom-[4%] left-[22%] h-52 w-52 rounded-full bg-teal-200/18 blur-3xl" />
          <div className="login-ring-orbit absolute right-[16%] top-[20%] h-24 w-24 rounded-full border border-sky-200/40" />
        </div>

        <div className="relative grid gap-8 xl:grid-cols-[minmax(0,1fr)_320px] xl:items-end">
          <motion.div
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            className="max-w-[760px] space-y-4"
          >
            <div className="inline-flex items-center gap-2 rounded-full bg-white/72 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-sky-700 shadow-[0_14px_30px_-24px_rgba(14,165,233,0.55)] backdrop-blur-sm">
              <span className="h-2 w-2 rounded-full bg-sky-500" />
              Submissions
            </div>

            <div className="space-y-0">
              <h1 className="font-display max-w-[8ch] text-5xl font-semibold leading-[0.9] tracking-tight text-slate-950 md:text-[5.4rem] xl:text-[6rem]">
                Submission runway
              </h1>
              <p className="pt-5 text-sm font-semibold uppercase tracking-[0.24em] text-slate-500 md:pt-6 md:text-[0.8rem]">
                {selectedPeriod?.label ?? format(new Date(), 'MMMM d, yyyy')}
              </p>
            </div>

            <div className="flex flex-wrap gap-2.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
              <span className="login-chip-float rounded-full border border-white/70 bg-white/55 px-3 py-2 backdrop-blur-sm">
                {scopeLabel}
              </span>
              <span
                className="login-chip-float rounded-full border border-white/70 bg-white/55 px-3 py-2 backdrop-blur-sm"
                style={{ animationDelay: '700ms' }}
              >
                {statusLabel}
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
                  Delivered
                </p>
                <p className="mt-2 font-display text-4xl leading-none text-slate-950">
                  {deliveryRate}%
                </p>
              </div>
              <div className="space-y-1 border-b border-white/70 pb-4 sm:border-b-0 sm:pb-0 sm:pl-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-sky-700">
                  In view
                </p>
                <p className="mt-2 text-lg font-semibold text-slate-950">
                  {formatCompactNumber(scopedBoardRows.length)} rows
                </p>
                <p className="text-xs text-slate-500">{scopeLabel}</p>
              </div>
            </div>
            <div className="border-t border-white/70 pt-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-sky-700">
                Window
              </p>
              <p className="mt-2 text-lg font-semibold text-slate-950">
                {selectedPeriod?.label ?? '-'}
              </p>
              <p className="text-xs text-slate-500">Current week first</p>
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
                  Rows
                </p>
                <p className="mt-2 font-display text-4xl leading-none text-slate-950">
                  {formatCompactNumber(filteredBoardRows.length)}
                </p>
              </div>
              <div className="text-right text-sm">
                <p className="font-semibold text-slate-700">{scopeLabel}</p>
                <p className="text-slate-500">{statusLabel}</p>
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
                    const isActive = serviceLineFilter === option.value

                    return (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => setServiceLineFilter(option.value)}
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
                            isActive
                              ? 'bg-gradient-to-r from-cyan-400 to-emerald-400'
                              : 'bg-slate-300',
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

      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.24, ease: 'easeOut' }}
        className="flex flex-wrap items-center gap-3 px-2"
      >
        <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">
          Live counts
        </p>
        {inlineSummaryItems.map((item) => (
          <div
            key={item.label}
            className={cn(
              'inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm shadow-[0_14px_24px_-20px_rgba(15,23,42,0.12)] backdrop-blur-sm',
              item.tone,
            )}
          >
            <span className="text-[11px] font-semibold uppercase tracking-[0.18em]">
              {item.label}
            </span>
            <span className="font-semibold">{formatCompactNumber(item.value)}</span>
          </div>
        ))}
      </motion.div>

      <SubmissionBoardGrid
        title="Current reporting board"
        description={`${scopeLabel} / ${statusLabel} / ${formatCompactNumber(summary.current.totalExpected)} expected`}
        rows={rows}
      />
    </div>
  )
}
