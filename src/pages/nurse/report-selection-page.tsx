import { motion } from 'framer-motion'
import { ClipboardList, LockKeyhole, Rows3 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

import {
  HeaderChip,
  SectionEmptyState,
  SectionEyebrow,
  SectionHeader,
  panelClass,
} from '@/components/dashboard/section-panel'
import { ReportingScopePanel } from '@/components/admin/reporting-scope-panel'
import { SubmissionBoardGrid } from '@/components/dashboard/submission-board-grid'
import { OfflineSaveBanner } from '@/components/reports/offline-save-banner'
import { ReportAssignmentCard } from '@/components/reports/report-assignment-card'
import { Button } from '@/components/ui/button'
import {
  getAssignmentCardsForPeriod,
  getCurrentPeriod,
  getVisibleReportingPeriods,
  getNurseSubmissionBoard,
} from '@/data/selectors'
import { useAppData } from '@/context/app-data-context'
import { formatCompactNumber } from '@/lib/utils'
import type { ReportFamily } from '@/types/domain'

const serviceLineOptions = [
  { value: 'all', label: 'All services' },
  { value: 'inpatient', label: 'Inpatient' },
  { value: 'outpatient', label: 'Outpatient' },
  { value: 'procedure', label: 'Procedures' },
] as const

export function ReportSelectionPage() {
  const { state, currentUser, ensureReportSummaryData } = useAppData()
  const [serviceLineFilter, setServiceLineFilter] = useState<'all' | ReportFamily>('all')
  const [selectedPeriodId, setSelectedPeriodId] = useState<string>('')

  const currentPeriod = getCurrentPeriod(state)
  const availablePeriods = [...getVisibleReportingPeriods(state)].reverse()
  const fallbackPeriodId = currentPeriod?.id ?? availablePeriods[0]?.id ?? ''
  const effectivePeriodId = availablePeriods.some((period) => period.id === selectedPeriodId)
    ? selectedPeriodId
    : fallbackPeriodId
  const reportingPeriodIdsKey = state.reportingPeriods.map(({ id }) => id).join('|')

  useEffect(() => {
    const periodIds = reportingPeriodIdsKey ? reportingPeriodIdsKey.split('|') : []
    if (periodIds.length) {
      void ensureReportSummaryData({ periodIds })
    }
  }, [ensureReportSummaryData, reportingPeriodIdsKey])

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

  const activeServiceLabel =
    serviceLineOptions.find((option) => option.value === serviceLineFilter)?.label ?? 'All services'
  const periodLabel = selectedPeriod?.label ?? currentPeriod?.label ?? 'Current week'

  return (
    <div className="space-y-6 px-4 py-6 md:px-6 md:py-8">
      <OfflineSaveBanner />
      <motion.section
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: 'easeOut' }}
        className={panelClass}
      >
        <ReportingScopePanel
          fields={[
            {
              label: 'Service line',
              placeholder: 'All services',
              value: serviceLineFilter,
              options: serviceLineOptions,
              onValueChange: (value) => setServiceLineFilter(value as 'all' | ReportFamily),
            },
            {
              label: 'Reporting period',
              placeholder: 'Select period',
              value: effectivePeriodId,
              options: availablePeriods.map((period) => ({ label: period.label, value: period.id })),
              onValueChange: setSelectedPeriodId,
            },
          ]}
          fieldsClassName="grid-cols-1 sm:grid-cols-2"
        />
      </motion.section>

      <motion.section
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: 'easeOut', delay: 0.04 }}
        className={panelClass}
      >
        <SectionHeader
          eyebrow="Reporting period"
          title="Open a report"
          description={`${periodLabel} · ${activeServiceLabel}`}
          actions={<HeaderChip>{formatCompactNumber(periodCards.length)} items</HeaderChip>}
        />
        {periodCards.length ? (
          <div className="mt-5 grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-2 xl:grid-cols-3">
            {periodCards.map((card, index) => (
              <motion.div
                key={`${card.assignment.id}:${card.period.id}`}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.22, ease: 'easeOut', delay: index * 0.02 }}
                className="min-w-0"
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
          <div className="mt-5">
            <SectionEmptyState
              icon={<Rows3 className="h-5 w-5" />}
              title="No reports in this view"
              description="Change the reporting period or service line filter to see more."
            />
          </div>
        )}
      </motion.section>

      {boardRows.length ? (
        <SubmissionBoardGrid
          eyebrow="Reporting status"
          title="Current reporting track"
          description={`${activeServiceLabel} / ${formatCompactNumber(boardRows.length)} rows`}
          rows={boardRows}
        />
      ) : (
        <motion.section
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, ease: 'easeOut', delay: 0.08 }}
          className={panelClass}
        >
          <SectionHeader eyebrow="Reporting status" title="Current reporting track" />
          <div className="mt-5">
            <SectionEmptyState
              icon={<ClipboardList className="h-5 w-5" />}
              title="No reporting rows yet"
              description="Recent reporting rows will appear here after assignments start."
            />
          </div>
        </motion.section>
      )}

      <motion.section
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: 'easeOut', delay: 0.12 }}
        className={panelClass}
      >
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1.5">
            <SectionEyebrow label="Assignments" />
            <p className="text-sm text-[#5b6169]">Need another reporting assignment?</p>
          </div>
          <Button asChild size="sm" variant="secondary">
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
