import { useEffect, useState } from 'react'
import { format } from 'date-fns'
import { AlertTriangle, CalendarDays, CheckCircle2, Lock, Rows3 } from 'lucide-react'

import { ReportingScopePanel } from '@/components/admin/reporting-scope-panel'
import { SubmissionBoardGrid } from '@/components/dashboard/submission-board-grid'
import {
  getCurrentPeriod,
  getLockDeadlineNote,
  getReportingRangeSummary,
  getVisibleReportingPeriods,
  getSubmissionBoard,
  type ReportingTimeRange,
} from '@/data/selectors'
import { useAppData } from '@/context/app-data-context'
import { formatCompactNumber } from '@/lib/utils'
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
  const { state, ensureProfileDirectoryData } = useAppData()
  const currentPeriod = getCurrentPeriod(state)
  const currentPeriodId = currentPeriod?.id ?? ''
  const [periodId, setPeriodId] = useState(currentPeriodId)
  const [timeRange, setTimeRange] = useState<ReportingTimeRange>('current')
  const [serviceLineFilter, setServiceLineFilter] =
    useState<ServiceLineFilter>('all')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')

  useEffect(() => {
    void ensureProfileDirectoryData()
  }, [ensureProfileDirectoryData])

  const visibleReportingPeriods = [...getVisibleReportingPeriods(state)].reverse()
  const reportingPeriodOptions = visibleReportingPeriods.map((period) => ({
    label: period.label,
    value: period.id,
  }))
  const effectivePeriodId = visibleReportingPeriods.some((period) => period.id === periodId)
    ? periodId
    : currentPeriodId
  const rangeSummary = getReportingRangeSummary(
    state,
    timeRange,
    effectivePeriodId,
    serviceLineFilter === 'all' ? undefined : serviceLineFilter,
  )
  const deadlineNote = getLockDeadlineNote(state, effectivePeriodId)

  if (!rangeSummary) {
    return null
  }

  const scopedBoardRows = getSubmissionBoard(
    state,
    rangeSummary.periods.length,
    effectivePeriodId,
  ).filter(
    (row) =>
      serviceLineFilter === 'all'
        ? true
        : row.department.family === serviceLineFilter,
  )

  const filteredBoardRows = scopedBoardRows.filter((row) =>
    statusFilter === 'all'
      ? true
      : row.statuses.some((status) => status.status === statusFilter),
  )

  const rows = filteredBoardRows.map((row) => ({
    id: row.assignment.id,
    departmentName: row.department.name,
    templateName: row.template.name,
    assigneeName:
      state.profiles.find((profile) => profile.id === row.assignment.nurseId)?.fullName ??
      'Assigned nurse',
    statuses: row.statuses.map((status) => ({
      label: status.period.label.split(' - ')[0],
      status: status.status,
      href: `/reports/${row.assignment.id}/${status.period.id}`,
    })),
  }))

  const scopeLabel =
    serviceLineOptions.find((option) => option.value === serviceLineFilter)?.label ??
    'All services'
  const statusLabel =
    statusOptions.find((option) => option.value === statusFilter)?.label ??
    'All statuses'
  const timeRangeOptions = [
    { value: 'current' as const, label: 'Current week' },
    { value: 'last4' as const, label: 'Last 4 weeks' },
    { value: 'last8' as const, label: 'Last 8 weeks' },
    { value: 'all' as const, label: 'All available data' },
  ] as const
  const timeRangeLabel =
    timeRangeOptions.find((option) => option.value === timeRange)?.label ??
    'Current week'
  const rangeStart = rangeSummary.periods[0]
  const rangeEnd = rangeSummary.periods.at(-1)
  const rangeNote =
    timeRange === 'current'
      ? rangeEnd?.label ?? 'Selected week'
      : rangeStart && rangeEnd
        ? `${format(new Date(rangeStart.weekStart), 'MMM d')} - ${format(
            new Date(rangeEnd.weekEnd),
            'MMM d, yyyy',
          )}`
        : 'No reporting periods'
  const deliveredCount =
    rangeSummary.metrics.submitted +
    rangeSummary.metrics.locked +
    rangeSummary.metrics.editedAfterSubmission
  const overdueCount = rangeSummary.metrics.overdue
  const summaryItems = [
    {
      label: 'Rows in view',
      value: formatCompactNumber(filteredBoardRows.length),
      note: `${scopeLabel} / ${statusLabel}`,
      icon: Rows3,
      tone: 'text-[#005db6] bg-[#edf4fb] outline-[#cfe0f4]/75',
    },
    {
      label: 'Delivered',
      value: formatCompactNumber(deliveredCount),
      note: `${rangeSummary.metrics.totalExpected ? Math.round((deliveredCount / rangeSummary.metrics.totalExpected) * 100) : 0}% of expected`,
      icon: CheckCircle2,
      tone: 'text-[#00468c] bg-[#edf4fb] outline-[#cfe0f4]/75',
    },
    {
      label: 'Overdue',
      value: formatCompactNumber(overdueCount),
      note: overdueCount ? 'Needs follow-up' : 'No late submissions',
      icon: AlertTriangle,
      tone: 'text-[#8a5a00] bg-[#fcf5e8] outline-[#edd9b0]/75',
    },
    timeRange === 'current'
      ? {
          label: 'Lock deadline',
          value: deadlineNote ? format(deadlineNote, 'EEE, MMM d') : 'Not set',
          note: deadlineNote ? format(deadlineNote, 'HH:mm') : 'No lock scheduled',
          icon: Lock,
          tone: 'text-[#1d3047] bg-[#edf1f5] outline-[#d4dde8]/75',
        }
      : {
          label: 'Range',
          value: `${formatCompactNumber(rangeSummary.periods.length)} ${
            rangeSummary.periods.length === 1 ? 'week' : 'weeks'
          }`,
          note: rangeNote,
          icon: CalendarDays,
          tone: 'text-[#1d3047] bg-[#edf1f5] outline-[#d4dde8]/75',
        },
  ] as const

  return (
    <div className="space-y-8">
      <section className="rounded-[0.35rem] bg-[#eef2f6] px-5 py-5">
        <ReportingScopePanel
          className="w-full max-w-[760px]"
          fields={[
            {
              label: 'Time range',
              options: timeRangeOptions,
              placeholder: 'Time range',
              value: timeRange,
              onValueChange: (value) => setTimeRange(value as ReportingTimeRange),
              triggerClassName: 'text-[0.95rem]',
            },
            {
              label: 'Ending period',
              options: reportingPeriodOptions,
              placeholder: 'Ending period',
              value: effectivePeriodId,
              onValueChange: setPeriodId,
              triggerClassName: 'text-[0.95rem]',
            },
            {
              label: 'Service line',
              options: serviceLineOptions,
              placeholder: 'Service line',
              value: serviceLineFilter,
              onValueChange: (value) => setServiceLineFilter(value as ServiceLineFilter),
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
        <div className="mt-4 grid gap-3 border-t border-[#d9e0e7] pt-4 sm:grid-cols-2 xl:grid-cols-4">
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
                <p className="mt-3 font-display text-[1.35rem] leading-none tracking-[-0.03em]">
                  {item.value}
                </p>
                <p className="mt-1 text-xs leading-5 text-current/75">{item.note}</p>
              </div>
            )
          })}
        </div>
      </section>

      <SubmissionBoardGrid
        title={timeRange === 'current' ? 'Current reporting board' : 'Reporting board'}
        description={`${scopeLabel} / ${statusLabel} / ${timeRangeLabel} / ${formatCompactNumber(rangeSummary.metrics.totalExpected)} expected`}
        rows={rows}
      />
    </div>
  )
}
