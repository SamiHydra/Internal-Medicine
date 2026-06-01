import { ArrowUpRight } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import { AdminPageHero } from '@/components/admin/admin-page-hero'
import { ReportingScopePanel } from '@/components/admin/reporting-scope-panel'
import { ChartCard } from '@/components/dashboard/chart-card'
import {
  fetchAcademicPeople,
  fetchAcademicSummary,
  fetchAcademicTrend,
  fetchAcademicWardOptions,
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
  AcademicGranularity,
  AcademicPeople,
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

const granularityOptions = [
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
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

const toneClasses = {
  blue: 'bg-[#edf4fb] text-[#005db6] outline-[#cfe0f4]/75',
  gold: 'bg-[#fcf5e8] text-[#8a5a00] outline-[#edd9b0]/75',
  navy: 'bg-[#edf1f5] text-[#1d3047] outline-[#d4dde8]/75',
  green: 'bg-[#edf7f0] text-[#1f6b3b] outline-[#cfe7d9]/75',
} as const

function KpiTile({
  label,
  value,
  note,
  tone,
}: {
  label: string
  value: string
  note?: string
  tone: keyof typeof toneClasses
}) {
  return (
    <div className={cn('rounded-[0.35rem] px-4 py-4 outline outline-1', toneClasses[tone])}>
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em]">{label}</p>
      <p className="mt-2 font-display text-[1.9rem] leading-none tracking-[-0.03em]">{value}</p>
      {note ? <p className="mt-1.5 text-xs leading-5 text-current/75">{note}</p> : null}
    </div>
  )
}

const eyebrowClass = 'text-[11px] font-semibold uppercase tracking-[0.22em] text-[#005db6]'
const sectionClass = 'rounded-[0.35rem] bg-[#f1f4f7] px-5 py-6 md:px-6'

export function AcademicDashboardPage() {
  const client = getApiBrowserClient()

  const [direction, setDirection] = useState<AcademicDirection>('consultant')
  const [wardId, setWardId] = useState<string>(ALL)
  const [person, setPerson] = useState<string>(ALL)
  const [range, setRange] = useState<string>(ALL)
  const [granularity, setGranularity] = useState<AcademicGranularity>('weekly')

  const [wards, setWards] = useState<AcademicWardOption[]>([])
  const [summary, setSummary] = useState<AcademicSummary | null>(null)
  const [trend, setTrend] = useState<AcademicTrend | null>(null)
  const [people, setPeople] = useState<AcademicPeople | null>(null)
  const [error, setError] = useState<string | null>(() =>
    client ? null : `The Laravel API is not configured. ${apiEnvSetupHint}`,
  )
  const [isLoading, setIsLoading] = useState(() => Boolean(client))

  const dateRange = useMemo(() => rangeToDates(range), [range])

  // Ward options load once.
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
        // Ward filter is a convenience; failing to load it should not break the page.
      })
    return () => {
      active = false
    }
  }, [client])

  // Summary + trend react to the full filter set (including the selected person).
  useEffect(() => {
    if (!client) {
      return
    }
    let active = true
    const query = {
      direction,
      wardId: wardId === ALL ? undefined : wardId,
      subjectId: person === ALL ? undefined : person,
      dateFrom: dateRange.dateFrom,
      dateTo: dateRange.dateTo,
    }
    Promise.all([
      fetchAcademicSummary(client, query),
      fetchAcademicTrend(client, { ...query, granularity }),
    ])
      .then(([fetchedSummary, fetchedTrend]) => {
        if (!active) {
          return
        }
        setSummary(fetchedSummary)
        setTrend(fetchedTrend)
        setError(null)
      })
      .catch((fetchError) => {
        if (active) {
          setError(
            fetchError instanceof Error ? fetchError.message : 'Unable to load academic analytics.',
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
  }, [client, direction, wardId, person, dateRange, granularity])

  // The leaderboard is independent of the selected person so it never collapses.
  useEffect(() => {
    if (!client) {
      return
    }
    let active = true
    fetchAcademicPeople(client, {
      direction,
      wardId: wardId === ALL ? undefined : wardId,
      dateFrom: dateRange.dateFrom,
      dateTo: dateRange.dateTo,
    })
      .then((fetched) => {
        if (active) {
          setPeople(fetched)
        }
      })
      .catch(() => {
        if (active) {
          setPeople({ direction, people: [] })
        }
      })
    return () => {
      active = false
    }
  }, [client, direction, wardId, dateRange])

  const personOptions = useMemo(
    () => [
      { value: ALL, label: 'All people' },
      ...(people?.people ?? []).map((entry) => ({
        value: entry.subjectId,
        label: entry.subjectName ?? 'Unknown',
      })),
    ],
    [people],
  )

  const wardOptions = useMemo(
    () => [{ value: ALL, label: 'All wards' }, ...wards.map((ward) => ({ value: ward.id, label: ward.name }))],
    [wards],
  )

  const isResident = direction === 'resident'

  const scopeFields = [
    {
      label: 'Direction',
      placeholder: 'Direction',
      value: direction,
      options: directionOptions,
      onValueChange: (value: string) => {
        setDirection(value as AcademicDirection)
        setPerson(ALL)
      },
    },
    {
      label: 'Ward',
      placeholder: 'All wards',
      value: wardId,
      options: wardOptions,
      onValueChange: setWardId,
    },
    {
      label: 'Person',
      placeholder: 'All people',
      value: person,
      options: personOptions,
      onValueChange: setPerson,
    },
    {
      label: 'Time range',
      placeholder: 'All time',
      value: range,
      options: rangeOptions,
      onValueChange: setRange,
    },
    {
      label: 'Cadence',
      placeholder: 'Weekly',
      value: granularity,
      options: granularityOptions,
      onValueChange: (value: string) => setGranularity(value as AcademicGranularity),
    },
  ]

  const trendData = (trend?.points ?? []).map((point) => ({
    label: point.bucket,
    score: point.averageScore,
    count: point.count,
  }))
  const indicatorData = summary?.indicatorCompliance ?? []
  const issueData = summary?.issueFrequency ?? []
  const leaderboard = people?.people ?? []

  const indicatorHeight = Math.max(220, indicatorData.length * 46)

  return (
    <div className="space-y-8">
      <AdminPageHero
        eyebrow="Academic"
        title={isResident ? 'Resident performance trends' : 'Consultant round quality'}
        description={
          isResident
            ? 'Performance evaluations of residents filed by consultants after MDT rounds.'
            : 'MDT daily round evaluations of consultants filed by residents.'
        }
        meta={[
          `${summary?.evaluationCount ?? 0} evaluations`,
          `${leaderboard.length} people`,
        ]}
      />

      <ReportingScopePanel fields={scopeFields} />

      {error ? (
        <div className="rounded-[0.35rem] border border-[#f1d1d1] bg-[#fff1f1] px-5 py-10 text-center text-sm font-medium text-[#b42318]">
          {error}
        </div>
      ) : isLoading && !summary ? (
        <div className="rounded-[0.35rem] bg-[#f1f4f7] px-5 py-12 text-center text-sm text-[#5b6169]">
          Loading academic analytics…
        </div>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <KpiTile label="Evaluations" value={`${summary?.evaluationCount ?? 0}`} tone="navy" />
            <KpiTile
              label="Average score"
              value={`${Math.round(summary?.averageScore ?? 0)}%`}
              note="% of yes/no items met"
              tone="blue"
            />
            {isResident ? (
              <KpiTile
                label="Avg overall rating"
                value={`${(summary?.avgOverallRating ?? 0).toFixed(1)} / 5`}
                tone="gold"
              />
            ) : (
              <KpiTile
                label="Senior presence"
                value={`${Math.round((summary?.seniorPresenceRate ?? 0) * 100)}%`}
                tone="gold"
              />
            )}
            {isResident ? (
              <KpiTile label="People evaluated" value={`${leaderboard.length}`} tone="green" />
            ) : (
              <KpiTile
                label="Avg patients seen"
                value={`${Math.round(summary?.avgPctSeen ?? 0)}%`}
                tone="green"
              />
            )}
          </div>

          <ChartCard
            title="Score trend"
            description={`Average ${isResident ? 'performance' : 'round-quality'} score per ${
              granularity === 'monthly' ? 'month' : 'week'
            }.`}
          >
            {trendData.length ? (
              <ResponsiveContainer width="100%" height={300}>
                <AreaChart data={trendData} margin={{ top: 16, right: 20, left: 0, bottom: 8 }}>
                  <defs>
                    <linearGradient id="academicScoreFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={academicChartPalette.ink} stopOpacity={0.18} />
                      <stop offset="100%" stopColor={academicChartPalette.ink} stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 12" stroke={chartGridStroke} vertical={false} />
                  <XAxis dataKey="label" tick={chartTick} axisLine={false} tickLine={false} tickMargin={12} />
                  <YAxis tick={chartTick} axisLine={false} tickLine={false} width={44} domain={[0, 100]} />
                  <Tooltip
                    contentStyle={lightTooltipStyle}
                    labelStyle={lightTooltipLabelStyle}
                    itemStyle={lightTooltipItemStyle}
                    cursor={tooltipLineCursor}
                  />
                  <Area
                    type="monotone"
                    dataKey="score"
                    name="Average score"
                    stroke={academicChartPalette.ink}
                    fill="url(#academicScoreFill)"
                    strokeWidth={3}
                    activeDot={{ ...lineActiveDot, fill: academicChartPalette.ink }}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <EmptyChart message="No evaluations in this range yet." />
            )}
          </ChartCard>

          <div className="grid gap-6 2xl:grid-cols-2">
            <ChartCard
              title="Indicator compliance"
              description="Share of evaluations marking each item met."
            >
              {indicatorData.length ? (
                <ResponsiveContainer width="100%" height={indicatorHeight}>
                  <BarChart
                    data={indicatorData}
                    layout="vertical"
                    margin={{ top: 8, right: 24, left: 8, bottom: 8 }}
                  >
                    <CartesianGrid strokeDasharray="3 12" stroke={chartGridStroke} horizontal={false} />
                    <XAxis
                      type="number"
                      domain={[0, 100]}
                      tick={chartTick}
                      axisLine={false}
                      tickLine={false}
                    />
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
                    <Bar
                      dataKey="pct"
                      name="% met"
                      fill={academicChartPalette.ink}
                      radius={[0, 6, 6, 0]}
                      maxBarSize={22}
                    />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <EmptyChart message="No indicator data yet." />
              )}
            </ChartCard>

            <ChartCard
              title={isResident ? 'Concerns' : 'System issues'}
              description="Most frequently flagged items (Pareto)."
            >
              {issueData.length ? (
                <ResponsiveContainer width="100%" height={Math.max(220, indicatorHeight)}>
                  <BarChart data={issueData} margin={{ top: 16, right: 20, left: 0, bottom: 64 }}>
                    <CartesianGrid strokeDasharray="3 12" stroke={chartGridStroke} vertical={false} />
                    <XAxis
                      dataKey="label"
                      tick={{ ...chartTick, fontSize: 11 }}
                      axisLine={false}
                      tickLine={false}
                      interval={0}
                      angle={-32}
                      textAnchor="end"
                      height={72}
                    />
                    <YAxis tick={chartTick} axisLine={false} tickLine={false} width={36} allowDecimals={false} />
                    <Tooltip
                      contentStyle={lightTooltipStyle}
                      labelStyle={lightTooltipLabelStyle}
                      itemStyle={lightTooltipItemStyle}
                      cursor={tooltipFillCursor}
                    />
                    <Bar
                      dataKey="count"
                      name="Flagged"
                      fill={academicChartPalette.mist}
                      radius={[6, 6, 0, 0]}
                      maxBarSize={44}
                    />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <EmptyChart message="No issues flagged in this range." />
              )}
            </ChartCard>
          </div>

          <section className={sectionClass}>
            <div className="space-y-1.5">
              <p className={eyebrowClass}>Leaderboard</p>
              <h2 className="font-display text-[1.5rem] leading-tight tracking-[-0.02em] text-[#000a1e]">
                {isResident ? 'Residents' : 'Consultants'} by average score
              </h2>
              <p className="text-sm leading-6 text-[#5b6169]">
                Select a person to open their evaluation history.
              </p>
            </div>

            {leaderboard.length ? (
              <div className="mt-5 overflow-hidden rounded-[0.35rem] border border-[#d9e0e7] bg-white">
                <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,1.4fr)_90px_90px_44px] gap-3 border-b border-[#e4e9ef] bg-[#f6f8fa] px-4 py-2.5 text-[10px] font-bold uppercase tracking-[0.16em] text-[#74777f]">
                  <span>Name</span>
                  <span>Home ward</span>
                  <span className="text-right">Evals</span>
                  <span className="text-right">Score</span>
                  <span />
                </div>
                {leaderboard.map((entry) => (
                  <Link
                    key={entry.subjectId}
                    to={`/admin/academic/people/${entry.subjectId}?direction=${direction}`}
                    className="grid grid-cols-[minmax(0,2fr)_minmax(0,1.4fr)_90px_90px_44px] items-center gap-3 border-b border-[#eef1f5] px-4 py-3 text-sm transition last:border-b-0 hover:bg-[#f6f9fc]"
                  >
                    <span className="truncate font-semibold text-[#000a1e]">
                      {entry.subjectName ?? 'Unknown'}
                    </span>
                    <span className="truncate text-[#5b6169]">{entry.homeWardName ?? '—'}</span>
                    <span className="text-right font-semibold text-[#1d3047]">
                      {entry.evaluationCount}
                    </span>
                    <span className="text-right font-semibold text-[#005db6]">
                      {Math.round(entry.averageScore)}%
                    </span>
                    <span className="flex justify-end text-[#94a3b8]">
                      <ArrowUpRight className="h-4 w-4" />
                    </span>
                  </Link>
                ))}
              </div>
            ) : (
              <div className="mt-5 rounded-[0.35rem] border border-dashed border-[#cbd5e1] bg-white px-5 py-10 text-center text-sm text-[#5b6169]">
                No evaluations match the current filters.
              </div>
            )}
          </section>
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
