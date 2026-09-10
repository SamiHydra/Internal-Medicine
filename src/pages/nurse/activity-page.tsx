import { useEffect } from 'react'
import { motion } from 'framer-motion'
import { Clock3, History, Sparkles, UserRound } from 'lucide-react'

import {
  HeaderChip,
  SectionEmptyState,
  SectionHeader,
  panelClass,
} from '@/components/dashboard/section-panel'
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

  const latestEntry = activity[0]?.entry ?? null

  return (
    <div className="space-y-6 px-4 py-6 md:px-6 md:py-8">
      <motion.section
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: 'easeOut' }}
        className={panelClass}
      >
        <SectionHeader
          eyebrow="Overview"
          title="Report history"
          description="Submitted, edited and locked reports across your assignments."
        />
      </motion.section>

      <motion.section
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: 'easeOut', delay: 0.04 }}
        className={panelClass}
      >
        <SectionHeader
          eyebrow="Timeline"
          title="Recent changes"
          description={
            latestEntry ? `Last updated ${formatTimestamp(latestEntry.changedAt)}` : undefined
          }
          actions={
            <HeaderChip>
              <History className="h-3.5 w-3.5 text-[#005db6]" />
              {formatCompactNumber(activity.length)} entries
            </HeaderChip>
          }
        />

        {activity.length ? (
          <div className="mt-5 overflow-hidden rounded-[0.4rem] border border-[#e6ecf3]">
            {activity.map((item, index) => (
              <motion.div
                key={item.entry.id}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.22, ease: 'easeOut', delay: index * 0.02 }}
                className={`grid gap-4 px-5 py-5 lg:grid-cols-[minmax(0,1fr)_220px] lg:items-start ${
                  index === 0 ? '' : 'border-t border-[#eef2f6]'
                }`}
              >
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    {item.department ? (
                      <Badge variant="info">{serviceLineLabels[item.department.family]}</Badge>
                    ) : null}
                    <StatusBadge status={item.entry.status} />
                  </div>

                  <div className="space-y-1">
                    <p className="text-base font-semibold text-[#000a1e]">
                      {item.entry.note ?? 'Status updated'}
                    </p>
                    <p className="text-sm text-[#5b6169]">
                      {item.department?.name ?? 'Department'} / {item.template?.name ?? 'Template'}
                    </p>
                  </div>

                  <div className="flex flex-wrap gap-4 text-sm text-[#5b6169]">
                    <span className="inline-flex items-center gap-2">
                      <UserRound className="h-4 w-4 text-[#69727d]" />
                      {item.entry.changedByName}
                    </span>
                  </div>
                </div>

                <div className="space-y-2 lg:text-right">
                  <div className="inline-flex items-center gap-2 rounded-[0.25rem] border border-[#d4dde8] bg-[#f8fafc] px-3 py-1.5 text-xs font-semibold text-[#44474e] lg:ml-auto">
                    <Clock3 className="h-3.5 w-3.5 text-[#69727d]" />
                    {formatTimestamp(item.entry.changedAt)}
                  </div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#69727d]">
                    Report lifecycle
                  </p>
                </div>
              </motion.div>
            ))}
          </div>
        ) : (
          <div className="mt-5">
            <SectionEmptyState
              icon={<Sparkles className="h-5 w-5" />}
              title="No activity yet"
              description="Report status changes will appear here."
            />
          </div>
        )}
      </motion.section>
    </div>
  )
}
