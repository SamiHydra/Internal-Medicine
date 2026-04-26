import { useEffect, useState } from 'react'
import { format } from 'date-fns'
import { useParams } from 'react-router-dom'
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import { ReportingScopePanel } from '@/components/admin/reporting-scope-panel'
import { InsightPanel } from '@/components/dashboard/insight-panel'
import { StatusBadge } from '@/components/dashboard/status-badge'
import { PageHeader } from '@/components/layout/page-header'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { useAppData } from '@/context/app-data-context'
import {
  getCurrentPeriod,
  getDepartmentDetail,
  getVisibleReportingPeriods,
  type ReportingTimeRange,
} from '@/data/selectors'
import { computeWeeklyValue } from '@/lib/metrics'
import { formatTimestamp } from '@/lib/dates'

export function DepartmentDetailPage() {
  const { departmentId = '' } = useParams()
  const { state, ensureHistoryData, ensureReportDetails } = useAppData()
  const [timeRange, setTimeRange] = useState<ReportingTimeRange>('last8')
  const [selectedPeriodId, setSelectedPeriodId] = useState('')
  const currentPeriod = getCurrentPeriod(state)
  const availablePeriods = [...getVisibleReportingPeriods(state)].reverse()
  const fallbackPeriodId = currentPeriod?.id ?? availablePeriods[0]?.id ?? ''
  const effectivePeriodId = availablePeriods.some((period) => period.id === selectedPeriodId)
    ? selectedPeriodId
    : fallbackPeriodId
  const departmentReportIds = state.reports
    .filter((report) => report.departmentId === departmentId)
    .map((report) => report.id)

  useEffect(() => {
    void ensureHistoryData()
  }, [ensureHistoryData])

  useEffect(() => {
    void ensureReportDetails(departmentReportIds)
  }, [departmentId, departmentReportIds, ensureReportDetails])

  const detail = getDepartmentDetail(state, departmentId, {
    anchorPeriodId: effectivePeriodId,
    range: timeRange,
  })

  if (!detail) {
    return null
  }

  const timeRangeOptions = [
    { value: 'current' as const, label: 'Current week' },
    { value: 'last4' as const, label: 'Last 4 weeks' },
    { value: 'last8' as const, label: 'Last 8 weeks' },
    { value: 'all' as const, label: 'All available data' },
  ] as const
  const reportingPeriodOptions = availablePeriods.map((period) => ({
    label: period.label,
    value: period.id,
  }))
  const rangeStart = detail.rangePeriods[0]
  const rangeEnd = detail.rangePeriods.at(-1)
  const rangeNote =
    rangeStart && rangeEnd
      ? `${format(new Date(rangeStart.weekStart), 'MMM d')} - ${format(
          new Date(rangeEnd.weekEnd),
          'MMM d, yyyy',
        )}`
      : 'No reporting periods'
  const summaryCards = detail.template.summaryCards.map((card) => {
    const field = detail.template.fields.find((candidate) => candidate.id === card.sourceId)
    const values = detail.rangeReports
      .map((report) => {
        if (card.sourceType === 'metric') {
          return report.calculatedMetrics[
            card.sourceId as keyof typeof report.calculatedMetrics
          ] ?? null
        }

        return field
          ? computeWeeklyValue(field, report.values[card.sourceId]?.dailyValues ?? {})
          : null
      })
      .filter((value): value is number => typeof value === 'number' && !Number.isNaN(value))
    const shouldAverage =
      card.sourceType === 'metric' ||
      field?.aggregate === 'average' ||
      card.format === 'percent' ||
      card.format === 'days' ||
      card.format === 'months' ||
      card.format === 'decimal'
    const currentValue = values.length
      ? shouldAverage
        ? values.reduce((sum, value) => sum + value, 0) / values.length
        : values.reduce((sum, value) => sum + value, 0)
      : null
    const formattedValue =
      currentValue === null
        ? '-'
        : card.format === 'percent'
          ? `${currentValue.toFixed(1)}%`
          : card.format === 'decimal' || card.format === 'days' || card.format === 'months'
            ? currentValue.toFixed(1)
            : new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(currentValue)

    return {
      label: card.label,
      value: formattedValue,
    }
  })

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow={detail.department.family}
        title={detail.department.name}
        description={detail.department.description}
      />

      <ReportingScopePanel
        className="max-w-[760px]"
        fields={[
          {
            label: 'Time range',
            options: timeRangeOptions,
            placeholder: 'Time range',
            value: timeRange,
            onValueChange: (value) => setTimeRange(value as ReportingTimeRange),
          },
          {
            label: 'Ending period',
            options: reportingPeriodOptions,
            placeholder: 'Ending period',
            value: effectivePeriodId,
            onValueChange: setSelectedPeriodId,
          },
        ]}
        metrics={[
          {
            label: 'Range',
            value: `${detail.rangePeriods.length} ${
              detail.rangePeriods.length === 1 ? 'week' : 'weeks'
            }`,
            note: rangeNote,
            tone: 'navy',
          },
        ]}
      />

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {summaryCards.map((card) => (
          <Card key={card.label}>
            <CardContent className="space-y-2 p-5">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#005db6]">
                {card.label}
              </p>
              <p className="font-display text-4xl text-[#000a1e]">
                {card.value}
              </p>
            </CardContent>
          </Card>
        ))}
      </section>

      <section className="grid gap-6 2xl:grid-cols-[1.35fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>Historical trend</CardTitle>
            <CardDescription>
              Primary throughput trend across recent weeks for this specific service area.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={detail.trends.activity}>
                  <CartesianGrid strokeDasharray="3 8" stroke="#d4dde8" vertical={false} />
                  <XAxis dataKey="shortLabel" />
                  <YAxis />
                  <Tooltip />
                  <Line type="monotone" dataKey="value" stroke="#005db6" strokeWidth={3} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <InsightPanel items={detail.insights} />
      </section>

      <section className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Current report state</CardTitle>
            <CardDescription>
              Lock and review context for the most recent reporting period.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between rounded-[0.5rem] border border-[#d4dde8] bg-[#f3f4f5] px-4 py-4">
              <div>
                <p className="font-semibold text-[#000a1e]">Latest status</p>
                <p className="text-sm text-[#44474e]">
                  Updated {formatTimestamp(detail.currentReport?.updatedAt)}
                </p>
              </div>
              <StatusBadge status={detail.currentStatus} />
            </div>
            {detail.department.bedCount ? (
              <p className="text-sm text-[#44474e]">
                Bed count used for BOR/BTR calculations: <span className="font-semibold text-[#000a1e]">{detail.department.bedCount}</span>
              </p>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Audit highlights</CardTitle>
            <CardDescription>
              Most recent field-level changes linked to this department.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {detail.auditHighlights.map((audit) => (
              <div key={audit.id} className="rounded-[0.5rem] border border-[#d4dde8] bg-[#f3f4f5] px-4 py-4">
                <p className="text-sm font-semibold text-[#000a1e]">{audit.fieldLabel}</p>
                <p className="mt-1 text-sm text-[#44474e]">
                  {String(audit.oldValue ?? '-')} → {String(audit.newValue ?? '-')}
                </p>
                <p className="mt-2 text-xs text-[#74777f]">
                  {audit.changedByName} at {formatTimestamp(audit.changedAt)}
                </p>
              </div>
            ))}
          </CardContent>
        </Card>
      </section>
    </div>
  )
}
