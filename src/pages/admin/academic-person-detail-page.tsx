import { ArrowLeft } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import { ReportingScopePanel } from '@/components/admin/reporting-scope-panel'
import { ChartCard } from '@/components/dashboard/chart-card'
import { InsightPanel } from '@/components/dashboard/insight-panel'
import { PageHeader } from '@/components/layout/page-header'
import {
  fetchAcademicPeople,
  fetchAcademicSummary,
  fetchAcademicTrend,
  fetchAcademicWardOptions,
  listAcademicEvaluations,
  type AcademicWardOption,
} from '@/lib/api/academic'
import { getApiBrowserClient } from '@/lib/api/client'
import { apiEnvSetupHint } from '@/lib/api/env'
import {
  academicChartPalette,
  chartGridStroke,
  chartTick,
  lightTooltipItemStyle,
  lightTooltipLabelStyle,
  lightTooltipStyle,
  lineActiveDot,
  tooltipFillCursor,
  tooltipLineCursor,
} from '@/lib/chart-theme'
import { cn } from '@/lib/utils'
import type {
  AcademicDirection,
  AcademicEvaluationRecord,
  AcademicPersonStat,
  AcademicSummary,
  AcademicTrend,
} from '@/lib/api/types'

const ALL = 'all'

const directionOptions = [
  { value: 'consultant', label: 'Consultant evaluations' },
  { value: 'resident', label: 'Resident evaluations' },
] as const

const rangeOptions = [
  { value: ALL, label: 'All time' },
  { value: '30', label: 'Last 30 days' },
  { value: '90', label: 'Last 90 days' },
  { value: '180', label: 'Last 180 days' },
] as const

function rangeToDates(range: string): { dateFrom?: string; dateTo?: string } {
  if (range === ALL) {
    return {}
  }
  const days = Number(range)
  const to = new Date()
  const from = new Date()
  from.setDate(from.getDate() - days)
  return { dateFrom: from.toISOString().slice(0, 10), dateTo: to.toISOString().slice(0, 10) }
}

function recordScore(record: AcademicEvaluationRecord): number {
  return 'qualityScore' in record ? record.qualityScore : record.performanceScore
}

function toDateLabel(value: string | null): string {
  if (!value) {
    return '—'
  }
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString()
}

const toneClasses = {
  blue: 'bg-[#edf4fb] text-[#005db6] outline-[#cfe0f4]/75',
  gold: 'bg-[#fcf5e8] text-[#8a5a00] outline-[#edd9b0]/75',
  navy: 'bg-[#edf1f5] text-[#1d3047] outline-[#d4dde8]/75',
  green: 'bg-[#edf7f0] text-[#1f6b3b] outline-[#cfe7d9]/75',
} as const

function StatTile({
  label,
  value,
  tone,
}: {
  label: string
  value: string
  tone: keyof typeof toneClasses
}) {
  return (
    <div className={cn('rounded-[0.35rem] px-4 py-4 outline outline-1', toneClasses[tone])}>
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em]">{label}</p>
      <p className="mt-2 font-display text-[1.8rem] leading-none tracking-[-0.03em]">{value}</p>
    </div>
  )
}

const sectionClass = 'rounded-[0.35rem] bg-[#f1f4f7] px-5 py-6 md:px-6'
const eyebrowClass = 'text-[11px] font-semibold uppercase tracking-[0.22em] text-[#005db6]'

export function AcademicPersonDetailPage() {
  const { userId = '' } = useParams()
  const [searchParams] = useSearchParams()
  const client = getApiBrowserClient()

  const initialDirection: AcademicDirection =
    searchParams.get('direction') === 'resident' ? 'resident' : 'consultant'

  const [direction, setDirection] = useState<AcademicDirection>(initialDirection)
  const [wardId, setWardId] = useState<string>(ALL)
  const [range, setRange] = useState<string>(ALL)

  const [wards, setWards] = useState<AcademicWardOption[]>([])
  const [summary, setSummary] = useState<AcademicSummary | null>(null)
  const [trend, setTrend] = useState<AcademicTrend | null>(null)
  const [evaluations, setEvaluations] = useState<AcademicEvaluationRecord[]>([])
  const [headerStat, setHeaderStat] = useState<AcademicPersonStat | null>(null)
  const [error, setError] = useState<string | null>(() =>
    client ? null : `The Laravel API is not configured. ${apiEnvSetupHint}`,
  )
  const [isLoading, setIsLoading] = useState(() => Boolean(client))

  const dateRange = useMemo(() => rangeToDates(range), [range])

  useEffect(() => {
    if (!client) {
      return
    }
    let active = true
    fetchAcademicWardOptions(client)
      .then((fetched) => {
        if (active) {
          setWards(fetched)
        }
      })
      .catch(() => {
        // Non-blocking.
      })
    return () => {
      active = false
    }
  }, [client])

  useEffect(() => {
    if (!client || !userId) {
      return
    }
    let active = true
    const query = {
      direction,
      subjectId: userId,
      wardId: wardId === ALL ? undefined : wardId,
      dateFrom: dateRange.dateFrom,
      dateTo: dateRange.dateTo,
    }
    Promise.all([
      fetchAcademicSummary(client, query),
      fetchAcademicTrend(client, { ...query, granularity: 'weekly' }),
      listAcademicEvaluations(client, { ...query, perPage: 50 }),
      fetchAcademicPeople(client, query),
    ])
      .then(([fetchedSummary, fetchedTrend, fetchedList, fetchedPeople]) => {
        if (!active) {
          return
        }
        setSummary(fetchedSummary)
        setTrend(fetchedTrend)
        setEvaluations(fetchedList.data)
        setHeaderStat(fetchedPeople.people[0] ?? null)
        setError(null)
      })
      .catch((fetchError) => {
        if (active) {
          setError(
            fetchError instanceof Error ? fetchError.message : 'Unable to load this person.',
          )
        }
      })
      .finally(() => {
        if (active) {
          setIsLoading(false)
        }
      })
    return () => {
      active = false
    }
  }, [client, userId, direction, wardId, dateRange])

  const isResident = direction === 'resident'

  const subjectName =
    headerStat?.subjectName ?? evaluations[0]?.subjectName ?? 'Selected person'
  const homeWardName = headerStat?.homeWardName ?? null

  const wardOptions = useMemo(
    () => [{ value: ALL, label: 'All wards' }, ...wards.map((ward) => ({ value: ward.id, label: ward.name }))],
    [wards],
  )

  const scopeFields = [
    {
      label: 'Direction',
      placeholder: 'Direction',
      value: direction,
      options: directionOptions,
      onValueChange: (value: string) => setDirection(value as AcademicDirection),
    },
    {
      label: 'Ward',
      placeholder: 'All wards',
      value: wardId,
      options: wardOptions,
      onValueChange: setWardId,
    },
    {
      label: 'Time range',
      placeholder: 'All time',
      value: range,
      options: rangeOptions,
      onValueChange: setRange,
    },
  ]

  const trendData = (trend?.points ?? []).map((point) => ({
    label: point.bucket,
    score: point.averageScore,
    count: point.count,
  }))
  const indicatorData = summary?.indicatorCompliance ?? []
  const issueData = summary?.issueFrequency ?? []
  const indicatorHeight = Math.max(220, indicatorData.length * 44)

  const insights = useMemo(() => {
    if (!summary || summary.evaluationCount === 0) {
      return [] as string[]
    }
    const items: string[] = [
      `Average score ${Math.round(summary.averageScore)}% across ${summary.evaluationCount} evaluation${
        summary.evaluationCount === 1 ? '' : 's'
      }.`,
    ]
    if (isResident && summary.avgOverallRating !== undefined) {
      items.push(`Average overall rating ${summary.avgOverallRating.toFixed(1)} / 5.`)
    }
    if (!isResident && summary.seniorPresenceRate !== undefined) {
      items.push(`Senior present in ${Math.round(summary.seniorPresenceRate * 100)}% of rounds.`)
    }
    if (summary.indicatorCompliance.length) {
      const sorted = [...summary.indicatorCompliance].sort((a, b) => b.pct - a.pct)
      const strongest = sorted[0]
      const weakest = sorted[sorted.length - 1]
      items.push(`Strongest: ${strongest.label} (${Math.round(strongest.pct)}%).`)
      if (weakest && weakest.key !== strongest.key) {
        items.push(`Needs focus: ${weakest.label} (${Math.round(weakest.pct)}%).`)
      }
    }
    if (summary.issueFrequency.length) {
      const top = summary.issueFrequency[0]
      items.push(`Most flagged: ${top.label} (${top.count}).`)
    }
    return items
  }, [summary, isResident])

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow={isResident ? 'Resident' : 'Consultant'}
        title={subjectName}
        description={
          homeWardName
            ? `Home ward: ${homeWardName}. Evaluation history and indicator breakdown.`
            : 'Evaluation history and indicator breakdown.'
        }
        actions={
          <Link
            to="/admin/academic"
            className="inline-flex items-center gap-2 rounded-[0.25rem] border border-[#c8d5e6] bg-[#eef4fb] px-4 py-2 text-[11px] font-bold uppercase tracking-[0.16em] text-[#000a1e] transition hover:bg-[#e3edf8]"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to academic
          </Link>
        }
      />

      <ReportingScopePanel fields={scopeFields} />

      {error ? (
        <div className="rounded-[0.35rem] border border-[#f1d1d1] bg-[#fff1f1] px-5 py-10 text-center text-sm font-medium text-[#b42318]">
          {error}
        </div>
      ) : isLoading && !summary ? (
        <div className="rounded-[0.35rem] bg-[#f1f4f7] px-5 py-12 text-center text-sm text-[#5b6169]">
          Loading evaluation history…
        </div>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StatTile label="Evaluations" value={`${summary?.evaluationCount ?? 0}`} tone="navy" />
            <StatTile label="Average score" value={`${Math.round(summary?.averageScore ?? 0)}%`} tone="blue" />
            {isResident ? (
              <StatTile
                label="Avg overall rating"
                value={`${(summary?.avgOverallRating ?? 0).toFixed(1)} / 5`}
                tone="gold"
              />
            ) : (
              <StatTile
                label="Senior presence"
                value={`${Math.round((summary?.seniorPresenceRate ?? 0) * 100)}%`}
                tone="gold"
              />
            )}
            {isResident ? (
              <StatTile label="Concerns flagged" value={`${issueData.reduce((sum, issue) => sum + issue.count, 0)}`} tone="green" />
            ) : (
              <StatTile label="Avg patients seen" value={`${Math.round(summary?.avgPctSeen ?? 0)}%`} tone="green" />
            )}
          </div>

          <div className="grid gap-6 2xl:grid-cols-[1.35fr_1fr] 2xl:items-start">
            <ChartCard title="Score trend" description="Average score per week.">
              {trendData.length ? (
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={trendData} margin={{ top: 16, right: 20, left: 0, bottom: 8 }}>
                    <CartesianGrid strokeDasharray="3 12" stroke={chartGridStroke} vertical={false} />
                    <XAxis dataKey="label" tick={chartTick} axisLine={false} tickLine={false} tickMargin={12} />
                    <YAxis tick={chartTick} axisLine={false} tickLine={false} width={44} domain={[0, 100]} />
                    <Tooltip
                      contentStyle={lightTooltipStyle}
                      labelStyle={lightTooltipLabelStyle}
                      itemStyle={lightTooltipItemStyle}
                      cursor={tooltipLineCursor}
                    />
                    <Line
                      type="monotone"
                      dataKey="score"
                      name="Average score"
                      stroke={academicChartPalette.ink}
                      strokeWidth={3}
                      dot={false}
                      activeDot={{ ...lineActiveDot, fill: academicChartPalette.ink }}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <EmptyChart message="No evaluations in this range yet." />
              )}
            </ChartCard>

            <InsightPanel
              title="Performance signals"
              description="Deterministic highlights from this person's evaluations."
              items={insights}
            />
          </div>

          <ChartCard title="Indicator breakdown" description="Share of evaluations marking each item met.">
            {indicatorData.length ? (
              <ResponsiveContainer width="100%" height={indicatorHeight}>
                <BarChart
                  data={indicatorData}
                  layout="vertical"
                  margin={{ top: 8, right: 24, left: 8, bottom: 8 }}
                >
                  <CartesianGrid strokeDasharray="3 12" stroke={chartGridStroke} horizontal={false} />
                  <XAxis type="number" domain={[0, 100]} tick={chartTick} axisLine={false} tickLine={false} />
                  <YAxis
                    type="category"
                    dataKey="label"
                    tick={{ ...chartTick, fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                    width={168}
                  />
                  <Tooltip
                    contentStyle={lightTooltipStyle}
                    labelStyle={lightTooltipLabelStyle}
                    itemStyle={lightTooltipItemStyle}
                    cursor={tooltipFillCursor}
                  />
                  <Bar dataKey="pct" name="% met" fill={academicChartPalette.ink} radius={[0, 6, 6, 0]} maxBarSize={22} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <EmptyChart message="No indicator data yet." />
            )}
          </ChartCard>

          <section className={sectionClass}>
            <div className="space-y-1.5">
              <p className={eyebrowClass}>Recent evaluations</p>
              <h2 className="font-display text-[1.5rem] leading-tight tracking-[-0.02em] text-[#000a1e]">
                Evaluation log
              </h2>
            </div>

            {evaluations.length ? (
              <div className="mt-5 overflow-hidden rounded-[0.35rem] border border-[#d9e0e7] bg-white">
                <div className="grid grid-cols-[110px_minmax(0,1.3fr)_minmax(0,1.3fr)_80px] gap-3 border-b border-[#e4e9ef] bg-[#f6f8fa] px-4 py-2.5 text-[10px] font-bold uppercase tracking-[0.16em] text-[#74777f]">
                  <span>Date</span>
                  <span>Ward</span>
                  <span>Author</span>
                  <span className="text-right">Score</span>
                </div>
                {evaluations.map((record) => (
                  <div
                    key={record.id}
                    className="grid grid-cols-[110px_minmax(0,1.3fr)_minmax(0,1.3fr)_80px] items-center gap-3 border-b border-[#eef1f5] px-4 py-3 text-sm last:border-b-0"
                  >
                    <span className="text-[#1d3047]">{toDateLabel(record.evaluationDate)}</span>
                    <span className="truncate text-[#5b6169]">{record.wardName ?? '—'}</span>
                    <span className="truncate text-[#5b6169]">{record.authorName ?? '—'}</span>
                    <span className="text-right font-semibold text-[#005db6]">
                      {Math.round(recordScore(record))}%
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="mt-5 rounded-[0.35rem] border border-dashed border-[#cbd5e1] bg-white px-5 py-10 text-center text-sm text-[#5b6169]">
                No evaluations match the current filters.
              </div>
            )}
          </section>

          <ChartCard
            title={isResident ? 'Concerns' : 'System issues'}
            description="Most frequently flagged items."
          >
            {issueData.length ? (
              <ResponsiveContainer width="100%" height={Math.max(220, issueData.length * 40)}>
                <BarChart data={issueData} layout="vertical" margin={{ top: 8, right: 24, left: 8, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 12" stroke={chartGridStroke} horizontal={false} />
                  <XAxis type="number" tick={chartTick} axisLine={false} tickLine={false} allowDecimals={false} />
                  <YAxis
                    type="category"
                    dataKey="label"
                    tick={{ ...chartTick, fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                    width={150}
                  />
                  <Tooltip
                    contentStyle={lightTooltipStyle}
                    labelStyle={lightTooltipLabelStyle}
                    itemStyle={lightTooltipItemStyle}
                    cursor={tooltipFillCursor}
                  />
                  <Bar dataKey="count" name="Flagged" fill={academicChartPalette.mist} radius={[0, 6, 6, 0]} maxBarSize={22} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <EmptyChart message="No issues flagged in this range." />
            )}
          </ChartCard>
        </>
      )}
    </div>
  )
}

function EmptyChart({ message }: { message: string }) {
  return (
    <div className="flex h-[260px] items-center justify-center text-sm text-[#74777f]">
      {message}
    </div>
  )
}
