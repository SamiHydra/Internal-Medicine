import { useEffect } from 'react'
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
  const { state, currentUser, ensureHistoryData } = useAppData()

  useEffect(() => {
    void ensureHistoryData()
  }, [ensureHistoryData])

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
  const summaryItems = [
    {
      label: 'Submitted',
      value: formatCompactNumber(submittedCount),
      note: 'Reports sent for review',
      tone: 'text-[#1f6b3b] bg-[#edf7f0] outline-[#cfe7d9]/75',
    },
    {
      label: 'Edited',
      value: formatCompactNumber(editedCount),
      note: 'Changed after submit',
      tone: 'text-[#8a5a00] bg-[#fbf4e6] outline-[#f0d9aa]/75',
    },
    {
      label: 'Locked',
      value: formatCompactNumber(lockedCount),
      note: 'Read only periods',
      tone: 'text-[#1d3047] bg-[#edf1f5] outline-[#d4dde8]/75',
    },
    {
      label: 'Latest',
      value: latestEntry ? formatTimestamp(latestEntry.changedAt) : 'No changes',
      note: 'Newest first',
      tone: 'text-[#005db6] bg-[#edf4fb] outline-[#cfe0f4]/75',
    },
  ] as const

  return (
    <div className="space-y-8">
      <motion.section
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.26, ease: 'easeOut' }}
        className="rounded-[0.35rem] bg-[#eef2f6] px-5 py-5 md:px-6"
      >
        <div className="space-y-5">
          <div className="space-y-2">
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#005db6]">
              Activity
            </p>
            <h1 className="font-display text-[2rem] leading-[0.96] tracking-[-0.03em] text-[#000a1e] md:text-[2.35rem]">
              Report history
            </h1>
            <p className="text-sm text-[#44474e]">Submitted / edited / locked</p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {summaryItems.map((item) => (
              <div
                key={item.label}
                className={`rounded-[0.35rem] px-3.5 py-3 outline outline-1 ${item.tone}`}
              >
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em]">
                  {item.label}
                </p>
                <p className="mt-3 break-words font-display text-[1.35rem] leading-[1.08] tracking-[-0.03em]">
                  {item.value}
                </p>
                <p className="mt-1 text-xs leading-5 text-current/75">{item.note}</p>
              </div>
            ))}
          </div>
        </div>
      </motion.section>

      <motion.section
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.28, ease: 'easeOut' }}
        className="rounded-[0.35rem] bg-[#eef2f6] px-5 py-6"
      >
        <div className="space-y-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#005db6]">
                Timeline
              </p>
              <h2 className="font-display text-[1.85rem] text-[#000a1e]">Recent changes</h2>
            </div>
            <div className="inline-flex items-center gap-2 rounded-[0.25rem] border border-[#d4dde8] bg-[#ffffff] px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#44474e]">
              <History className="h-4 w-4 text-[#005db6]" />
              {formatCompactNumber(activity.length)} entries
            </div>
          </div>

          {activity.length ? (
            <div className="overflow-hidden rounded-[0.35rem] border border-[#d4dde8] bg-[#ffffff]">
              {activity.map((item, index) => (
                <motion.div
                  key={item.entry.id}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.22, ease: 'easeOut', delay: index * 0.02 }}
                  className={`grid gap-4 px-5 py-5 lg:grid-cols-[minmax(0,1fr)_220px] lg:items-start ${
                    index === 0 ? '' : 'border-t border-[#e2e7ee]'
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
                      <p className="text-base font-semibold text-[#000a1e]">
                        {item.entry.note ?? 'Status updated'}
                      </p>
                      <p className="text-sm text-[#44474e]">
                        {item.department?.name ?? 'Department'} / {item.template?.name ?? 'Template'}
                      </p>
                    </div>

                    <div className="flex flex-wrap gap-4 text-sm text-[#44474e]">
                      <span className="inline-flex items-center gap-2">
                        <UserRound className="h-4 w-4 text-[#74777f]" />
                        {item.entry.changedByName}
                      </span>
                    </div>
                  </div>

                  <div className="space-y-2 lg:text-right">
                    <div className="inline-flex items-center gap-2 rounded-[0.25rem] border border-[#d4dde8] bg-[#f8fafc] px-3 py-1.5 text-xs font-semibold text-[#44474e] lg:ml-auto">
                      <Clock3 className="h-3.5 w-3.5 text-[#74777f]" />
                      {formatTimestamp(item.entry.changedAt)}
                    </div>
                    <p className="text-xs uppercase tracking-[0.18em] text-[#74777f]">
                      Report lifecycle
                    </p>
                  </div>
                </motion.div>
              ))}
            </div>
          ) : (
            <div className="flex min-h-[220px] flex-col items-center justify-center gap-4 rounded-[0.5rem] border border-dashed border-[#d4dde8] bg-[#ffffff] px-6 text-center text-[#74777f]">
              <Sparkles className="h-5 w-5 text-[#005db6]" />
              <div className="space-y-2">
                <p className="text-sm font-medium text-[#1d3047]">No activity yet.</p>
                <p className="text-sm leading-6 text-[#74777f]">
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
