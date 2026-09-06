import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { motion } from 'framer-motion'

import { ReportingScopePanel } from '@/components/admin/reporting-scope-panel'
import { SubmissionBoardGrid } from '@/components/dashboard/submission-board-grid'
import {
  getCurrentPeriod,
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

const timeRangeValues: ReportingTimeRange[] = ['current', 'last4', 'last8', 'quarter', 'last26']

export function SubmissionBoardPage() {
  const { state, ensureProfileDirectoryData, ensureReportSummaryData } = useAppData()
  const currentPeriod = getCurrentPeriod(state)
  const currentPeriodId = currentPeriod?.id ?? ''
  // Honor deep-links from the dashboard (e.g. the Outstanding-reports card) so the
  // board opens pre-filtered to the same service line / status / window. Unknown or
  // missing params fall back to the defaults. Read once for initial state only.
  const [searchParams] = useSearchParams()
  const serviceParam = searchParams.get('service')
  const statusParam = searchParams.get('status')
  const rangeParam = searchParams.get('range')
  const initialServiceLine: ServiceLineFilter = serviceLineOptions.some(
    (option) => option.value === serviceParam,
  )
    ? (serviceParam as ServiceLineFilter)
    : 'all'
  const initialStatus: StatusFilter = statusOptions.some(
    (option) => option.value === statusParam,
  )
    ? (statusParam as StatusFilter)
    : 'all'
  const initialTimeRange: ReportingTimeRange = timeRangeValues.includes(
    rangeParam as ReportingTimeRange,
  )
    ? (rangeParam as ReportingTimeRange)
    : 'current'
  const [periodId, setPeriodId] = useState(currentPeriodId)
  const [timeRange, setTimeRange] = useState<ReportingTimeRange>(initialTimeRange)
  const [serviceLineFilter, setServiceLineFilter] =
    useState<ServiceLineFilter>(initialServiceLine)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(initialStatus)
  useEffect(() => {
    void ensureProfileDirectoryData()
  }, [ensureProfileDirectoryData])

  // All board derivations are memoized on their real inputs so a poll-driven
  // re-render (or an unrelated state change) does not rebuild the grid; only a
  // change to the data or the active filters recomputes. Every useMemo is
  // declared before the `if (!rangeSummary)` early return to satisfy the Rules
  // of Hooks (hook count must be stable across renders).
  const visibleReportingPeriods = useMemo(
    () => [...getVisibleReportingPeriods(state)].reverse(),
    [state],
  )
  const reportingPeriodOptions = useMemo(
    () =>
      visibleReportingPeriods.map((period) => ({
        label: period.label,
        value: period.id,
      })),
    [visibleReportingPeriods],
  )
  const effectivePeriodId = visibleReportingPeriods.some((period) => period.id === periodId)
    ? periodId
    : currentPeriodId
  const rangeSummary = useMemo(
    () =>
      getReportingRangeSummary(
        state,
        timeRange,
        effectivePeriodId,
        serviceLineFilter === 'all' ? undefined : serviceLineFilter,
      ),
    [state, timeRange, effectivePeriodId, serviceLineFilter],
  )
  const rangePeriodIdsKey = rangeSummary?.periods.map(({ id }) => id).join('|') ?? ''

  useEffect(() => {
    const periodIds = rangePeriodIdsKey ? rangePeriodIdsKey.split('|') : []
    if (periodIds.length) {
      void ensureReportSummaryData({ periodIds })
    }
  }, [ensureReportSummaryData, rangePeriodIdsKey])

  // Index nurse names once instead of a state.profiles.find() per board row.
  const profileNameById = useMemo(() => {
    const names = new Map<string, string>()
    state.profiles.forEach((profile) => names.set(profile.id, profile.fullName))
    return names
  }, [state.profiles])

  const rows = useMemo(() => {
    if (!rangeSummary) {
      return []
    }

    return getSubmissionBoard(state, rangeSummary.periods.length, effectivePeriodId)
      .filter((row) =>
        serviceLineFilter === 'all' ? true : row.department.family === serviceLineFilter,
      )
      .filter((row) =>
        statusFilter === 'all'
          ? true
          : row.statuses.some((status) => status.status === statusFilter),
      )
      .map((row) => ({
        id: row.assignment.id,
        departmentName: row.department.name,
        templateName: row.template.name,
        assigneeName: profileNameById.get(row.assignment.nurseId) ?? 'Assigned nurse',
        statuses: row.statuses.map((status) => ({
          label: status.period.label.split(' - ')[0],
          status: status.status,
          href: `/reports/${row.assignment.id}/${status.period.id}`,
        })),
      }))
  }, [
    rangeSummary,
    state,
    effectivePeriodId,
    serviceLineFilter,
    statusFilter,
    profileNameById,
  ])

  if (!rangeSummary) {
    return null
  }

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
    { value: 'quarter' as const, label: 'Last quarter (13 weeks)' },
    { value: 'last26' as const, label: 'Last 26 weeks' },
  ] as const
  const timeRangeLabel =
    timeRangeOptions.find((option) => option.value === timeRange)?.label ??
    'Current week'

  const sectionClass =
    'rounded-[0.35rem] bg-white px-5 py-6 outline outline-1 outline-[#d4dde8] shadow-[0_24px_60px_-42px_rgba(0,33,71,0.28)] md:px-6 md:py-7'

  return (
    <div className="space-y-6 px-4 py-5 md:px-6 md:py-8">
      <motion.section
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: 'easeOut' }}
        className={sectionClass}
      >
        <div>
          <ReportingScopePanel
            className="w-full"
            collapsibleLabel="Filters"
            summary={`${timeRangeLabel} · ${scopeLabel} · ${statusLabel}`}
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
        </div>
      </motion.section>

      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: 'easeOut', delay: 0.04 }}
      >
        <SubmissionBoardGrid
          eyebrow="Reporting status"
          title={timeRange === 'current' ? 'Current reporting board' : 'Reporting board'}
          description={`${scopeLabel} / ${statusLabel} / ${timeRangeLabel} / ${formatCompactNumber(rangeSummary.metrics.totalExpected)} expected`}
          rows={rows}
        />
      </motion.div>
    </div>
  )
}
