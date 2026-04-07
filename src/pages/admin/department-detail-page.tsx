import { useEffect } from 'react'
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
import { getDepartmentDetail } from '@/data/selectors'
import { getNumericTotal } from '@/lib/metrics'
import { formatTimestamp } from '@/lib/dates'

export function DepartmentDetailPage() {
  const { departmentId = '' } = useParams()
  const { state, ensureHistoryData, ensureReportDetails } = useAppData()
  const departmentReportIds = state.reports
    .filter((report) => report.departmentId === departmentId)
    .map((report) => report.id)

  useEffect(() => {
    void ensureHistoryData()
  }, [ensureHistoryData])

  useEffect(() => {
    void ensureReportDetails(departmentReportIds)
  }, [departmentId, departmentReportIds, ensureReportDetails])

  const detail = getDepartmentDetail(state, departmentId)

  if (!detail) {
    return null
  }

  const summaryCards = detail.template.summaryCards.map((card) => {
    const currentValue =
      card.sourceType === 'metric'
        ? detail.currentReport?.calculatedMetrics[
            card.sourceId as keyof typeof detail.currentReport.calculatedMetrics
          ] ?? null
        : detail.currentReport
          ? getNumericTotal(detail.currentReport.values[card.sourceId]?.dailyValues ?? {})
          : null

    return {
      label: card.label,
      value: currentValue,
    }
  })

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow={detail.department.family}
        title={detail.department.name}
        description={detail.department.description}
      />

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {summaryCards.map((card) => (
          <Card key={card.label}>
            <CardContent className="space-y-2 p-5">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#005db6]">
                {card.label}
              </p>
              <p className="font-display text-4xl text-[#000a1e]">
                {card.value ?? '-'}
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
