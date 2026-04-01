import { motion } from 'framer-motion'
import { ClipboardList, LockKeyhole, Rows3 } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'

import { SubmissionBoardGrid } from '@/components/dashboard/submission-board-grid'
import { ReportAssignmentCard } from '@/components/reports/report-assignment-card'
import { Button } from '@/components/ui/button'
import { getCurrentPeriod, getCurrentWeekAssignmentCards, getSubmissionBoard } from '@/data/selectors'
import { useAppData } from '@/context/app-data-context'
import { formatCompactNumber } from '@/lib/utils'
import { cn } from '@/lib/utils'
import type { ReportFamily } from '@/types/domain'

const serviceLineOptions = [
  { value: 'all' as const, label: 'All services' },
  { value: 'inpatient' as const, label: 'Inpatient' },
  { value: 'outpatient' as const, label: 'Outpatient' },
  { value: 'procedure' as const, label: 'Procedures' },
] as const

export function ReportSelectionPage() {
  const { state, currentUser } = useAppData()
  const [serviceLineFilter, setServiceLineFilter] =
    useState<'all' | ReportFamily>('all')

  if (!currentUser) {
    return null
  }

  const currentPeriod = getCurrentPeriod(state)
  const currentCards = getCurrentWeekAssignmentCards(state, currentUser.id).filter((card) =>
    serviceLineFilter === 'all' ? true : card.department.family === serviceLineFilter,
  )
  const boardRows = getSubmissionBoard(state)
    .filter((row) => row.assignment.nurseId === currentUser.id)
    .filter((row) =>
      serviceLineFilter === 'all' ? true : row.department.family === serviceLineFilter,
    )
    .map((row) => ({
      departmentName: row.department.name,
      templateName: row.template.name,
      statuses: row.statuses.map((status) => ({
        label: status.period.label.split(' - ')[0],
        status: status.status,
        href: `/reports/${row.assignment.id}/${status.period.id}`,
      })),
    }))

  const editableCount = currentCards.filter((card) => card.status !== 'locked').length
  const submittedCount = currentCards.filter((card) => card.status === 'submitted').length
  const lockedCount = currentCards.filter((card) => card.status === 'locked').length
  const activeServiceLabel =
    serviceLineOptions.find((option) => option.value === serviceLineFilter)?.label ??
    'All services'

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
              My reports
            </div>

            <div className="space-y-0">
              <h1 className="font-display max-w-[8ch] text-5xl font-semibold leading-[0.9] tracking-tight text-slate-950 md:text-[5.6rem] xl:text-[6.2rem]">
                Assigned reporting
              </h1>
              <p className="pt-5 text-sm font-semibold uppercase tracking-[0.24em] text-slate-500 md:pt-6 md:text-[0.8rem]">
                {currentPeriod?.label ?? 'Current week'} / {activeServiceLabel}
              </p>
            </div>

            <div className="flex flex-wrap gap-2.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
              <span className="login-chip-float rounded-full border border-white/70 bg-white/55 px-3 py-2 backdrop-blur-sm">
                {formatCompactNumber(currentCards.length)} current week
              </span>
              <span
                className="login-chip-float rounded-full border border-white/70 bg-white/55 px-3 py-2 backdrop-blur-sm"
                style={{ animationDelay: '700ms' }}
              >
                {formatCompactNumber(boardRows.length)} tracked
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
                  Editable
                </p>
                <p className="mt-2 font-display text-4xl leading-none text-slate-950">
                  {formatCompactNumber(editableCount)}
                </p>
              </div>
              <div className="space-y-1 border-b border-white/70 pb-4 sm:border-b-0 sm:pb-0 sm:pl-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-sky-700">
                  Submitted
                </p>
                <p className="mt-2 font-display text-4xl leading-none text-slate-950">
                  {formatCompactNumber(submittedCount)}
                </p>
              </div>
            </div>

            <div className="grid gap-4 border-t border-white/70 pt-4 sm:grid-cols-2">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-sky-700">
                  Locked
                </p>
                <p className="mt-2 text-lg font-semibold text-slate-950">
                  {formatCompactNumber(lockedCount)}
                </p>
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-sky-700">
                  Service line
                </p>
                <p className="mt-2 text-sm font-semibold text-slate-950">
                  {activeServiceLabel}
                </p>
              </div>
            </div>
          </motion.div>
        </div>
      </section>

      <motion.section
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.28, ease: 'easeOut' }}
        className="relative overflow-hidden rounded-[2rem] border border-white/70 bg-[linear-gradient(135deg,rgba(255,255,255,0.82),rgba(244,249,255,0.76),rgba(235,253,248,0.62))] px-5 py-5 shadow-[0_20px_42px_-34px_rgba(15,23,42,0.18)] backdrop-blur-md"
      >
        <div className="pointer-events-none absolute inset-0">
          <div className="login-ambient-drift absolute right-[12%] top-[-24%] h-32 w-32 rounded-full bg-sky-200/18 blur-3xl" />
          <div className="login-line-flow absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-sky-300/70 to-transparent" />
        </div>

        <div className="relative grid gap-6 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-center">
          <div className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-sky-700">
              Service line
            </p>
            <div className="flex flex-wrap gap-2 rounded-[1.7rem] bg-white/66 p-1.5 shadow-[0_18px_30px_-24px_rgba(15,23,42,0.18)]">
              {serviceLineOptions.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setServiceLineFilter(option.value)}
                  className={cn(
                    'rounded-[1.2rem] px-4 py-2.5 text-sm font-semibold transition-all duration-300',
                    serviceLineFilter === option.value
                      ? 'bg-slate-950 text-white shadow-[0_16px_26px_-20px_rgba(15,23,42,0.45)]'
                      : 'text-slate-600 hover:bg-white/82 hover:text-slate-950',
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-3 xl:min-w-[420px]">
            <div className="border-l border-white/65 pl-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-sky-700">
                View
              </p>
              <p className="mt-2 text-sm font-semibold text-slate-950">{activeServiceLabel}</p>
              <p className="text-sm text-slate-500">Current week first</p>
            </div>
            <div className="border-l border-white/65 pl-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-sky-700">
                Forms
              </p>
              <p className="mt-2 text-sm font-semibold text-slate-950">
                {formatCompactNumber(currentCards.length)}
              </p>
            </div>
            <div className="border-l border-white/65 pl-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-sky-700">
                Board rows
              </p>
              <p className="mt-2 text-sm font-semibold text-slate-950">
                {formatCompactNumber(boardRows.length)}
              </p>
            </div>
          </div>
        </div>
      </motion.section>

      <motion.section
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: 'easeOut' }}
        className="relative overflow-hidden rounded-[2.4rem] border border-white/70 bg-[linear-gradient(180deg,rgba(255,255,255,0.96),rgba(242,248,255,0.84))] px-5 py-6 shadow-[0_24px_54px_-36px_rgba(15,23,42,0.22)]"
      >
        <div className="pointer-events-none absolute inset-0">
          <div className="login-grid-drift absolute inset-0 opacity-12" />
          <div className="login-ambient-drift absolute right-[-4%] top-[-12%] h-44 w-44 rounded-full bg-sky-200/12 blur-3xl" />
          <div className="login-line-flow absolute inset-x-6 top-0 h-1 bg-gradient-to-r from-cyan-400 via-sky-500 to-emerald-400" />
        </div>

        <div className="relative space-y-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-sky-700">
                Current week
              </p>
              <h2 className="font-display text-3xl text-slate-950">Open a report</h2>
              <p className="text-sm text-slate-500">Your assigned forms.</p>
            </div>
            <div className="inline-flex items-center gap-2 rounded-full border border-white/80 bg-white/72 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-600 shadow-[0_14px_24px_-20px_rgba(15,23,42,0.15)]">
              <ClipboardList className="h-4 w-4 text-sky-700" />
              {formatCompactNumber(currentCards.length)} items
            </div>
          </div>

          {currentCards.length ? (
            <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
              {currentCards.map((card, index) => (
                <motion.div
                  key={card.assignment.id}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.24, ease: 'easeOut', delay: index * 0.02 }}
                >
                  <ReportAssignmentCard
                    departmentName={card.department.name}
                    templateName={card.template.name}
                    periodLabel={card.period.label}
                    status={card.status}
                    lastUpdatedAt={card.updatedAt}
                    href={`/reports/${card.assignment.id}/${card.period.id}`}
                    canEdit={card.status !== 'locked'}
                  />
                </motion.div>
              ))}
            </div>
          ) : (
            <div className="flex min-h-[220px] flex-col items-center justify-center gap-4 rounded-[1.9rem] border border-dashed border-sky-100/90 bg-white/62 px-6 text-center text-slate-500">
              <Rows3 className="h-5 w-5 text-sky-500" />
              <div className="space-y-2">
                <p className="text-sm font-medium text-slate-700">No reports in this view.</p>
                <p className="text-sm leading-6 text-slate-500">
                  Change the service line filter.
                </p>
              </div>
            </div>
          )}
        </div>
      </motion.section>

      {boardRows.length ? (
        <SubmissionBoardGrid
          title="Recent reporting track"
          description="Current and recent weeks."
          rows={boardRows}
        />
      ) : (
        <motion.section
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.28, ease: 'easeOut' }}
          className="relative overflow-hidden rounded-[2.4rem] border border-white/70 bg-[linear-gradient(180deg,rgba(255,255,255,0.96),rgba(242,248,255,0.84))] px-5 py-6 shadow-[0_24px_54px_-36px_rgba(15,23,42,0.22)]"
        >
          <div className="pointer-events-none absolute inset-0">
            <div className="login-grid-drift absolute inset-0 opacity-12" />
            <div className="login-ambient-drift absolute right-[-4%] top-[-12%] h-44 w-44 rounded-full bg-sky-200/12 blur-3xl" />
            <div className="login-line-flow absolute inset-x-6 top-0 h-1 bg-gradient-to-r from-cyan-400 via-sky-500 to-emerald-400" />
          </div>
          <div className="relative flex min-h-[200px] flex-col items-center justify-center gap-4 rounded-[1.9rem] border border-dashed border-sky-100/90 bg-white/62 px-6 text-center text-slate-500">
            <ClipboardList className="h-5 w-5 text-sky-500" />
            <div className="space-y-2">
              <p className="text-sm font-medium text-slate-700">No recent board rows.</p>
              <p className="text-sm leading-6 text-slate-500">
                Once reports are assigned, the recent track shows up here.
              </p>
            </div>
          </div>
        </motion.section>
      )}

      <motion.section
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.28, ease: 'easeOut' }}
        className="relative overflow-hidden rounded-[2rem] border border-white/70 bg-[linear-gradient(135deg,rgba(255,255,255,0.82),rgba(244,249,255,0.76),rgba(235,253,248,0.62))] px-5 py-5 shadow-[0_20px_42px_-34px_rgba(15,23,42,0.18)] backdrop-blur-md"
      >
        <div className="pointer-events-none absolute inset-0">
          <div className="login-ambient-drift absolute right-[12%] top-[-24%] h-32 w-32 rounded-full bg-sky-200/18 blur-3xl" />
          <div className="login-line-flow absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-sky-300/70 to-transparent" />
        </div>

        <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-2">
            <p className="text-sm font-medium text-slate-700">Need another assignment?</p>
            <p className="text-sm text-slate-500">Use the same approval request flow.</p>
          </div>
          <Button asChild variant="secondary">
            <Link to="/register">
              Request access
              <LockKeyhole className="h-4 w-4" />
            </Link>
          </Button>
        </div>
      </motion.section>
    </div>
  )
}
