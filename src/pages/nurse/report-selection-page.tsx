import { motion } from 'framer-motion'
import {
  CheckCircle2,
  ClipboardList,
  LockKeyhole,
  PencilLine,
  Rows3,
} from 'lucide-react'
import {
  useState,
} from 'react'
import { Link } from 'react-router-dom'

import { SubmissionBoardGrid } from '@/components/dashboard/submission-board-grid'
import { ReportAssignmentCard } from '@/components/reports/report-assignment-card'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  getAssignmentCardsForPeriod,
  getCurrentPeriod,
  getVisibleReportingPeriods,
  getNurseSubmissionBoard,
} from '@/data/selectors'
import { useAppData } from '@/context/app-data-context'
import { cn, formatCompactNumber } from '@/lib/utils'
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
  const [selectedPeriodId, setSelectedPeriodId] = useState<string>('')

  const currentPeriod = getCurrentPeriod(state)
  const availablePeriods = [...getVisibleReportingPeriods(state)].reverse()
  const fallbackPeriodId = currentPeriod?.id ?? availablePeriods[0]?.id ?? ''
  const effectivePeriodId = availablePeriods.some((period) => period.id === selectedPeriodId)
    ? selectedPeriodId
    : fallbackPeriodId

  if (!currentUser) {
    return null
  }

  const selectedPeriod =
    availablePeriods.find((period) => period.id === effectivePeriodId) ?? currentPeriod ?? null
  const periodCards = (effectivePeriodId
    ? getAssignmentCardsForPeriod(state, currentUser.id, effectivePeriodId)
    : []
  ).filter((card) =>
    serviceLineFilter === 'all' ? true : card.department.family === serviceLineFilter,
  )

  const boardRows = getNurseSubmissionBoard(state, currentUser.id)
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

  const editableCount = periodCards.filter((card) => card.status !== 'locked').length
  const submittedCount = periodCards.filter((card) => card.status === 'submitted').length
  const lockedCount = periodCards.filter((card) => card.status === 'locked').length
  const activeServiceLabel =
    serviceLineOptions.find((option) => option.value === serviceLineFilter)?.label ??
    'All services'
  const summaryItems = [
    {
      label: 'Assigned',
      value: formatCompactNumber(periodCards.length),
      note: selectedPeriod?.label ?? 'Selected week',
      icon: ClipboardList,
      tone: 'text-[#005db6] bg-[#edf4fb] outline-[#cfe0f4]/75',
    },
    {
      label: 'Editable',
      value: formatCompactNumber(editableCount),
      note: 'Unlocked forms',
      icon: PencilLine,
      tone: 'text-[#00468c] bg-[#edf4fb] outline-[#cfe0f4]/75',
    },
    {
      label: 'Submitted',
      value: formatCompactNumber(submittedCount),
      note: 'Sent for review',
      icon: CheckCircle2,
      tone: 'text-[#1f6b3b] bg-[#edf7f0] outline-[#cfe7d9]/75',
    },
    {
      label: 'Locked',
      value: formatCompactNumber(lockedCount),
      note: 'Read only',
      icon: LockKeyhole,
      tone: 'text-[#1d3047] bg-[#edf1f5] outline-[#d4dde8]/75',
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
              My reports
            </p>
            <h1 className="font-display text-[2rem] leading-[0.96] tracking-[-0.03em] text-[#000a1e] md:text-[2.35rem]">
              Assigned reporting
            </h1>
            <p className="text-sm text-[#44474e]">
              {selectedPeriod?.label ?? currentPeriod?.label ?? 'Current week'} / {activeServiceLabel}
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            {serviceLineOptions.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setServiceLineFilter(option.value)}
                className={cn(
                  'rounded-[0.25rem] border px-4 py-2 text-sm font-semibold transition-colors duration-200',
                  serviceLineFilter === option.value
                    ? 'border-[#000a1e] bg-[#000a1e] text-white'
                    : 'border-[#d4dde8] bg-[#ffffff] text-[#44474e] hover:border-[#c4d0dd] hover:bg-[#f8fafc] hover:text-[#000a1e]',
                )}
              >
                {option.label}
              </button>
            ))}
          </div>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {summaryItems.map((item) => {
              const Icon = item.icon

              return (
                <div
                  key={item.label}
                  className={`rounded-[0.35rem] px-3.5 py-3 outline outline-1 ${item.tone}`}
                >
                  <div className="flex items-center gap-2">
                    <Icon className="h-3.5 w-3.5" />
                    <p className="text-[11px] font-semibold uppercase tracking-[0.18em]">
                      {item.label}
                    </p>
                  </div>
                  <p className="mt-3 font-display text-[1.45rem] leading-none tracking-[-0.03em]">
                    {item.value}
                  </p>
                  <p className="mt-1 text-xs leading-5 text-current/75">{item.note}</p>
                </div>
              )
            })}
          </div>
        </div>
      </motion.section>

      <motion.section
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.28, ease: 'easeOut' }}
        className="rounded-[0.35rem] bg-[#eef2f6] px-5 py-5"
      >
        <div className="space-y-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#005db6]">
                Reporting period
              </p>
              <h2 className="font-display text-[1.85rem] text-[#000a1e]">Open a report</h2>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <div className="min-w-[220px]">
                <Select value={effectivePeriodId} onValueChange={setSelectedPeriodId}>
                  <SelectTrigger className="bg-[#ffffff]">
                    <SelectValue placeholder="Select reporting period" />
                  </SelectTrigger>
                  <SelectContent>
                    {availablePeriods.map((period) => (
                      <SelectItem key={period.id} value={period.id}>
                        {period.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="inline-flex items-center gap-2 rounded-[0.25rem] border border-[#d4dde8] bg-[#ffffff] px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#44474e]">
                <ClipboardList className="h-4 w-4 text-[#005db6]" />
                {formatCompactNumber(periodCards.length)} items
              </div>
            </div>
          </div>

          {periodCards.length ? (
            <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
              {periodCards.map((card, index) => (
                <motion.div
                  key={`${card.assignment.id}:${card.period.id}`}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.22, ease: 'easeOut', delay: index * 0.02 }}
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
            <div className="flex min-h-[200px] flex-col items-center justify-center gap-3 rounded-[0.5rem] border border-dashed border-[#d4dde8] bg-[#ffffff] px-6 text-center text-[#74777f]">
              <Rows3 className="h-5 w-5 text-[#005db6]" />
              <p className="text-sm leading-6">
                No reports in this view for the selected week. Change the reporting period or service line filter.
              </p>
            </div>
          )}
        </div>
      </motion.section>

      {boardRows.length ? (
        <SubmissionBoardGrid
          title="Current reporting track"
          description={`${activeServiceLabel} / ${formatCompactNumber(boardRows.length)} rows`}
          rows={boardRows}
        />
      ) : (
        <motion.section
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.24, ease: 'easeOut' }}
          className="rounded-[0.35rem] bg-[#eef2f6] px-5 py-6"
        >
          <div className="flex min-h-[180px] flex-col items-center justify-center gap-3 rounded-[0.5rem] border border-dashed border-[#d4dde8] bg-[#ffffff] px-6 text-center text-[#74777f]">
            <ClipboardList className="h-5 w-5 text-[#005db6]" />
            <p className="text-sm leading-6">
              Recent reporting rows will appear here after assignments start.
            </p>
          </div>
        </motion.section>
      )}

      <motion.section
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.24, ease: 'easeOut' }}
        className="rounded-[0.35rem] bg-[#eef2f6] px-5 py-5"
      >
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#005db6]">
              Assignments
            </p>
            <p className="text-sm text-[#44474e]">Need another reporting assignment?</p>
          </div>
          <Button asChild variant="secondary" className="bg-[none] bg-[#ffffff] shadow-none">
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
