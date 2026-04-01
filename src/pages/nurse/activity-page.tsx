import { motion } from 'framer-motion'
import { Clock3, History, Sparkles, UserRound } from 'lucide-react'

import { StatusBadge } from '@/components/dashboard/status-badge'
import { Badge } from '@/components/ui/badge'
import { departmentMap, templateMap } from '@/config/templates'
import { useAppData } from '@/context/app-data-context'
import { formatTimestamp } from '@/lib/dates'
import { formatCompactNumber } from '@/lib/utils'

const serviceLineLabels = {
  inpatient: 'Inpatient',
  outpatient: 'Outpatient',
  procedure: 'Procedures',
} as const

export function NurseActivityPage() {
  const { state, currentUser } = useAppData()

  if (!currentUser) {
    return null
  }

  const assignmentIds = state.assignments
    .filter((assignment) => assignment.nurseId === currentUser.id)
    .map((assignment) => assignment.id)
  const reportIds = state.reports
    .filter((report) => assignmentIds.includes(report.assignmentId))
    .map((report) => report.id)

  const reportMap = Object.fromEntries(state.reports.map((report) => [report.id, report]))
  const assignmentMap = Object.fromEntries(
    state.assignments.map((assignment) => [assignment.id, assignment]),
  )

  const activity = state.statusHistory
    .filter((entry) => reportIds.includes(entry.reportId))
    .map((entry) => {
      const report = reportMap[entry.reportId]
      const assignment = report ? assignmentMap[report.assignmentId] : null
      const department = assignment ? departmentMap[assignment.departmentId] : null
      const template = assignment ? templateMap[assignment.templateId] : null

      return {
        entry,
        department,
        template,
      }
    })
    .sort((left, right) => right.entry.changedAt.localeCompare(left.entry.changedAt))

  const submittedCount = activity.filter((item) => item.entry.status === 'submitted').length
  const editedCount = activity.filter(
    (item) => item.entry.status === 'edited_after_submission',
  ).length
  const lockedCount = activity.filter((item) => item.entry.status === 'locked').length
  const latestEntry = activity[0]?.entry ?? null

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
              Activity
            </div>

            <div className="space-y-0">
              <h1 className="font-display max-w-[8ch] text-5xl font-semibold leading-[0.9] tracking-tight text-slate-950 md:text-[5.6rem] xl:text-[6.2rem]">
                Report history
              </h1>
              <p className="pt-5 text-sm font-semibold uppercase tracking-[0.24em] text-slate-500 md:pt-6 md:text-[0.8rem]">
                Submitted / edited / locked
              </p>
            </div>

            <div className="flex flex-wrap gap-2.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
              <span className="login-chip-float rounded-full border border-white/70 bg-white/55 px-3 py-2 backdrop-blur-sm">
                {formatCompactNumber(activity.length)} changes
              </span>
              <span
                className="login-chip-float rounded-full border border-white/70 bg-white/55 px-3 py-2 backdrop-blur-sm"
                style={{ animationDelay: '700ms' }}
              >
                {latestEntry ? formatTimestamp(latestEntry.changedAt) : 'No history'}
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
                  Submitted
                </p>
                <p className="mt-2 font-display text-4xl leading-none text-slate-950">
                  {formatCompactNumber(submittedCount)}
                </p>
              </div>
              <div className="space-y-1 border-b border-white/70 pb-4 sm:border-b-0 sm:pb-0 sm:pl-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-sky-700">
                  Edited
                </p>
                <p className="mt-2 font-display text-4xl leading-none text-slate-950">
                  {formatCompactNumber(editedCount)}
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
                  Latest
                </p>
                <p className="mt-2 text-sm font-medium leading-6 text-slate-700">
                  {latestEntry ? formatTimestamp(latestEntry.changedAt) : 'No changes'}
                </p>
              </div>
            </div>
          </motion.div>
        </div>
      </section>

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
                Timeline
              </p>
              <h2 className="font-display text-3xl text-slate-950">Recent changes</h2>
              <p className="text-sm text-slate-500">Newest first.</p>
            </div>
            <div className="inline-flex items-center gap-2 rounded-full border border-white/80 bg-white/72 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-600 shadow-[0_14px_24px_-20px_rgba(15,23,42,0.15)]">
              <History className="h-4 w-4 text-sky-700" />
              {formatCompactNumber(activity.length)} entries
            </div>
          </div>

          {activity.length ? (
            <div className="overflow-hidden rounded-[1.9rem] border border-slate-200/80 bg-white/82 shadow-[0_16px_30px_-24px_rgba(15,23,42,0.18)]">
              {activity.map((item, index) => (
                <motion.div
                  key={item.entry.id}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.24, ease: 'easeOut', delay: index * 0.02 }}
                  className={`grid gap-4 px-5 py-5 lg:grid-cols-[minmax(0,1fr)_200px] lg:items-start ${
                    index === 0 ? '' : 'border-t border-slate-100/90'
                  }`}
                >
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-center gap-2">
                      {item.department ? (
                        <Badge variant="info">
                          {serviceLineLabels[item.department.family]}
                        </Badge>
                      ) : null}
                      <StatusBadge status={item.entry.status} />
                    </div>

                    <div className="space-y-1">
                      <p className="text-base font-semibold text-slate-950">
                        {item.entry.note ?? 'Status updated'}
                      </p>
                      <p className="text-sm text-slate-500">
                        {item.department?.name ?? 'Department'} / {item.template?.name ?? 'Template'}
                      </p>
                    </div>

                    <div className="flex flex-wrap gap-4 text-sm text-slate-500">
                      <span className="inline-flex items-center gap-2">
                        <UserRound className="h-4 w-4 text-slate-400" />
                        {item.entry.changedByName}
                      </span>
                    </div>
                  </div>

                  <div className="space-y-2 lg:text-right">
                    <div className="inline-flex items-center gap-2 rounded-full border border-slate-200/80 bg-slate-50/90 px-3 py-1.5 text-xs font-semibold text-slate-600 lg:ml-auto">
                      <Clock3 className="h-3.5 w-3.5 text-slate-400" />
                      {formatTimestamp(item.entry.changedAt)}
                    </div>
                    <p className="text-xs uppercase tracking-[0.18em] text-slate-400">
                      Report lifecycle
                    </p>
                  </div>
                </motion.div>
              ))}
            </div>
          ) : (
            <div className="flex min-h-[220px] flex-col items-center justify-center gap-4 rounded-[1.9rem] border border-dashed border-sky-100/90 bg-white/62 px-6 text-center text-slate-500">
              <Sparkles className="h-5 w-5 text-sky-500" />
              <div className="space-y-2">
                <p className="text-sm font-medium text-slate-700">No activity yet.</p>
                <p className="text-sm leading-6 text-slate-500">
                  Report status changes will appear here.
                </p>
              </div>
            </div>
          )}
        </div>
      </motion.section>
    </div>
  )
}
