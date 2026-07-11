import { motion } from 'framer-motion'
import { ArrowUpRight } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import { AcademicSetupBanner } from '@/components/admin/academic-setup-banner'
import { MorningSessionsPanel } from '@/components/admin/morning-sessions-panel'
import { TransferReviewPanel } from '@/components/academic/transfer-review-panel'
import { ReportingScopePanel } from '@/components/admin/reporting-scope-panel'
import { ChartCard } from '@/components/dashboard/chart-card'
import { AnalyticsContentSkeleton } from '@/components/layout/loading-skeletons'
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
import type {
  AcademicDirection,
  AcademicGranularity,
  AcademicPeople,
  AcademicSummary,
  AcademicTrend,
} from '@/lib/api/types'
import { cn } from '@/lib/utils'

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

// Toggling Clinical↔Academic remounts this page (with default filters), so the last
// result is cached per filter signature: a re-toggle paints from cache instantly and
// revalidates in the background, instead of blocking on the serialized dev API.
let wardsCache: AcademicWardOption[] | null = null
const analyticsCache = new Map<string, { summary: AcademicSummary; trend: AcademicTrend }>()
const peopleCache = new Map<string, AcademicPeople>()

function analyticsKey(
  direction: string,
  wardId: string | undefined,
  subjectId: string | undefined,
  dateFrom: string | undefined,
  dateTo: string | undefined,
  granularity: string,
): string {
  return [direction, wardId ?? '', subjectId ?? '', dateFrom ?? '', dateTo ?? '', granularity].join('|')
}

function peopleKey(
  direction: string,
  wardId: string | undefined,
  dateFrom: string | undefined,
  dateTo: string | undefined,
): string {
  return [direction, wardId ?? '', dateFrom ?? '', dateTo ?? ''].join('|')
}

const sectionClass =
  'rounded-[0.35rem] bg-white px-5 py-6 outline outline-1 outline-[#d4dde8] shadow-[0_24px_60px_-42px_rgba(0,33,71,0.28)] md:px-6 md:py-7'

function SectionEyebrow({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2">
      <span aria-hidden="true" className="h-3 w-[3px] rounded-full bg-[#f0b429]" />
      <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#005db6]">{label}</p>
    </div>
  )
}

function DirectionToggle({
  value,
  onChange,
}: {
  value: AcademicDirection
  onChange: (next: AcademicDirection) => void
}) {
  return (
    <div
      role="tablist"
      aria-label="Evaluation direction"
      className="inline-flex shrink-0 items-center gap-1 rounded-[0.3rem] bg-white/[0.08] p-1 outline outline-1 outline-white/10"
    >
      {directionOptions.map((option) => {
        const active = value === option.value
        return (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(option.value)}
            className={cn(
              'relative rounded-[0.22rem] px-4 py-1.5 text-sm font-semibold transition-colors duration-200',
              active ? 'text-[#04162f]' : 'text-[#9fb0c6] hover:text-white',
            )}
          >
            {active ? (
              <motion.span
                layoutId="academic-direction-pill"
                transition={{ type: 'spring', duration: 0.4, bounce: 0 }}
                className="absolute inset-0 rounded-[0.22rem] bg-[#f0b429]"
              />
            ) : null}
            <span className="relative z-10">
              {option.value === 'resident' ? 'Residents' : 'Consultants'}
            </span>
          </button>
        )
      })}
    </div>
  )
}

// Single-line category-axis tick shared by the two horizontal bar charts. Recharts'
// default tick wraps long labels onto multiple cramped lines; this renders one line and
// truncates on a word boundary with the full label preserved as a hover <title>.
function CategoryTick({
  x,
  y,
  payload,
}: {
  x?: string | number
  y?: string | number
  payload?: { value?: unknown }
}) {
  const full = String(payload?.value ?? '')
  const MAX = 28
  let shown = full
  if (full.length > MAX) {
    const cut = full.lastIndexOf(' ', MAX)
    shown = `${cut > 12 ? full.slice(0, cut) : full.slice(0, MAX)}…`
  }
  return (
    <g transform={`translate(${x ?? 0},${y ?? 0})`}>
      <title>{full}</title>
      <text dx={-4} dy={4} textAnchor="end" fontSize={11} fontWeight={500} fill="#5b6169">
        {shown}
      </text>
    </g>
  )
}

export function AcademicDashboardPage() {
  const client = getApiBrowserClient()

  // Default filters on mount; seed from the module cache so a Clinical→Academic
  // re-toggle paints instantly while fresh data revalidates in the background.
  const cachedAnalytics = analyticsCache.get(
    analyticsKey('consultant', undefined, undefined, undefined, undefined, 'weekly'),
  )
  const cachedPeople = peopleCache.get(peopleKey('consultant', undefined, undefined, undefined)) ?? null

  const [direction, setDirection] = useState<AcademicDirection>('consultant')
  const [wardId, setWardId] = useState<string>(ALL)
  const [person, setPerson] = useState<string>(ALL)
  const [range, setRange] = useState<string>(ALL)
  const [granularity, setGranularity] = useState<AcademicGranularity>('weekly')

  const [wards, setWards] = useState<AcademicWardOption[]>(wardsCache ?? [])
  const [summary, setSummary] = useState<AcademicSummary | null>(cachedAnalytics?.summary ?? null)
  const [trend, setTrend] = useState<AcademicTrend | null>(cachedAnalytics?.trend ?? null)
  const [people, setPeople] = useState<AcademicPeople | null>(cachedPeople)
  const [error, setError] = useState<string | null>(() =>
    client ? null : `The Laravel API is not configured. ${apiEnvSetupHint}`,
  )
  const [isLoading, setIsLoading] = useState(() => Boolean(client) && !cachedAnalytics)

  const dateRange = useMemo(() => rangeToDates(range), [range])

  // Ward options load once.
  useEffect(() => {
    if (!client) {
      return
    }
    let active = true
    fetchAcademicWardOptions(client)
      .then((fetched) => {
        wardsCache = fetched
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
    const cacheKey = analyticsKey(
      query.direction,
      query.wardId,
      query.subjectId,
      query.dateFrom,
      query.dateTo,
      granularity,
    )
    Promise.all([
      fetchAcademicSummary(client, query),
      fetchAcademicTrend(client, { ...query, granularity }),
    ])
      .then(([fetchedSummary, fetchedTrend]) => {
        analyticsCache.set(cacheKey, { summary: fetchedSummary, trend: fetchedTrend })
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
    const peopleCacheKey = peopleKey(
      direction,
      wardId === ALL ? undefined : wardId,
      dateRange.dateFrom,
      dateRange.dateTo,
    )
    fetchAcademicPeople(client, {
      direction,
      wardId: wardId === ALL ? undefined : wardId,
      dateFrom: dateRange.dateFrom,
      dateTo: dateRange.dateTo,
    })
      .then((fetched) => {
        peopleCache.set(peopleCacheKey, fetched)
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

  // Guarantee a descending (ranked) order even if the backend changes its sort.
  const sortedIssueData = [...issueData].sort((a, b) => b.count - a.count)
  // One shared height keeps the side-by-side cards bottom-aligned regardless of counts.
  const sharedChartHeight = Math.max(220, Math.max(indicatorData.length, issueData.length) * 46)

  // Direction-aware academic posture (consultant rounds vs resident performance);
  // reacts to the active filters, surfaced as the stat row in the command hero.
  const summaryMetrics = isResident
    ? [
        { label: 'Evaluations', value: String(summary?.evaluationCount ?? 0), note: 'Filed in range' },
        {
          label: 'Avg performance',
          value: summary ? `${Math.round(summary.averageScore)}%` : '—',
          note: 'Indicators met',
        },
        {
          label: 'Avg rating',
          value: summary?.avgOverallRating != null ? `${summary.avgOverallRating.toFixed(1)}/5` : '—',
          note: 'Overall, out of 5',
        },
        { label: 'Residents', value: String(leaderboard.length), note: 'With evaluations' },
      ]
    : [
        { label: 'Evaluations', value: String(summary?.evaluationCount ?? 0), note: 'Filed in range' },
        {
          label: 'Avg round quality',
          value: summary ? `${Math.round(summary.averageScore)}%` : '—',
          note: 'Indicators met',
        },
        {
          label: 'Senior presence',
          value: summary?.seniorPresenceRate != null ? `${Math.round(summary.seniorPresenceRate * 100)}%` : '—',
          note: 'Rounds with a senior',
        },
        {
          label: 'Patients seen',
          value: summary?.avgPctSeen != null ? `${Math.round(summary.avgPctSeen)}%` : '—',
          note: 'Average coverage',
        },
      ]

  return (
    <div className="space-y-6 px-4 py-5 md:px-6 md:py-8">
      <AcademicSetupBanner />
      <motion.section
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: 'easeOut' }}
        className="overflow-hidden rounded-[0.35rem] bg-[#04162f] px-5 py-6 text-white shadow-[0_26px_64px_-40px_rgba(0,12,35,0.85)] md:px-7 md:py-7"
      >
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span aria-hidden="true" className="h-3 w-[3px] rounded-full bg-[#f0b429]" />
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#f0b429]">
                Academic review
              </p>
            </div>
            <h1 className="mt-2 font-display text-[1.6rem] font-bold leading-tight tracking-[-0.02em] text-white md:text-[1.95rem]">
              {isResident ? 'Resident performance trends' : 'Consultant round quality'}
            </h1>
            <p className="mt-2 max-w-xl text-sm leading-6 text-[#9fb0c6]">
              {isResident
                ? 'Performance evaluations of residents filed by consultants after MDT rounds.'
                : 'MDT daily round evaluations of consultants filed by residents.'}
            </p>
            <Link
              to="/admin/academic/submissions"
              className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-[#7cb3ff] transition-colors hover:text-white"
            >
              Browse all submissions
              <ArrowUpRight className="h-4 w-4" />
            </Link>
          </div>
          <DirectionToggle
            value={direction}
            onChange={(next) => {
              setDirection(next)
              setPerson(ALL)
            }}
          />
        </div>

        <div className="mt-6 grid grid-cols-2 gap-x-8 gap-y-5 border-t border-white/10 pt-5 lg:grid-cols-4">
          {summaryMetrics.map((metric) => (
            <div key={metric.label} className="min-w-0">
              <p className="truncate text-[11px] font-semibold uppercase tracking-[0.18em] text-[#f0b429]">
                {metric.label}
              </p>
              <p className="mt-1.5 font-display text-[1.9rem] font-bold leading-none tabular-nums text-white md:text-[2.1rem]">
                {metric.value}
              </p>
              <p className="mt-1 truncate text-xs text-[#9fb0c6]">{metric.note}</p>
            </div>
          ))}
        </div>
      </motion.section>

      <ReportingScopePanel
        fields={scopeFields}
        fieldsClassName="grid-cols-1 sm:grid-cols-2 lg:grid-cols-4"
        collapsibleLabel="Filters"
        summary={`${rangeOptions.find((option) => option.value === range)?.label ?? 'All time'} · ${
          granularity === 'monthly' ? 'Monthly' : 'Weekly'
        }`}
      />

      {error ? (
        <div className="rounded-[0.35rem] border border-[#f3cccc] bg-[#fceeee] px-5 py-10 text-center text-sm font-medium text-[#ba1a1a]">
          {error}
        </div>
      ) : isLoading && !summary ? (
        <AnalyticsContentSkeleton />
      ) : (
        <>
          <ChartCard
            title="Score trend"
            description={`Average ${isResident ? 'performance' : 'round-quality'} score per ${
              granularity === 'monthly' ? 'month' : 'week'
            }.`}
          >
            {trendData.length ? (
              <ResponsiveContainer width="100%" height={260}>
                <AreaChart data={trendData} margin={{ top: 16, right: 20, left: 0, bottom: 8 }}>
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
                    fill={academicChartPalette.ink}
                    fillOpacity={0.08}
                    strokeWidth={3}
                    dot={{ r: 2.6, strokeWidth: 0, fill: academicChartPalette.ink }}
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

          <div className="grid gap-6 lg:grid-cols-2">
            <ChartCard
              title="Indicator compliance"
              description="Share of evaluations marking each item met."
            >
              {indicatorData.length ? (
                <ResponsiveContainer width="100%" height={sharedChartHeight}>
                  <BarChart
                    data={indicatorData}
                    layout="vertical"
                    margin={{ top: 8, right: 64, left: 8, bottom: 8 }}
                  >
                    <CartesianGrid strokeDasharray="3 12" stroke={chartGridStroke} horizontal={false} />
                    <XAxis type="number" domain={[0, 100]} hide allowDecimals={false} />
                    <YAxis
                      type="category"
                      dataKey="label"
                      tick={CategoryTick}
                      axisLine={false}
                      tickLine={false}
                      width={172}
                      interval={0}
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
                    >
                      <LabelList
                        dataKey="pct"
                        position="right"
                        formatter={(value: unknown) => `${Math.round(Number(value) || 0)}%`}
                        fill="#1d3047"
                        fontSize={11}
                        fontWeight={600}
                      />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <EmptyChart message="No indicator data yet." />
              )}
            </ChartCard>

            <ChartCard
              title={isResident ? 'Concerns' : 'System issues'}
              description="Most frequently flagged items."
            >
              {sortedIssueData.length ? (
                <ResponsiveContainer width="100%" height={sharedChartHeight}>
                  <BarChart
                    data={sortedIssueData}
                    layout="vertical"
                    margin={{ top: 8, right: 64, left: 8, bottom: 8 }}
                  >
                    <CartesianGrid strokeDasharray="3 12" stroke={chartGridStroke} horizontal={false} />
                    <XAxis type="number" hide allowDecimals={false} domain={[0, 'dataMax']} />
                    <YAxis
                      type="category"
                      dataKey="label"
                      tick={CategoryTick}
                      axisLine={false}
                      tickLine={false}
                      width={172}
                      interval={0}
                    />
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
                      radius={[0, 6, 6, 0]}
                      maxBarSize={22}
                    >
                      <LabelList
                        dataKey="count"
                        position="right"
                        formatter={(value: unknown) => String(value ?? '')}
                        fill="#1d3047"
                        fontSize={11}
                        fontWeight={600}
                      />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <EmptyChart message="No issues flagged in this range." />
              )}
            </ChartCard>
          </div>

          <motion.section
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, ease: 'easeOut' }}
            className={sectionClass}
          >
            <div className="border-b border-[#eef2f6] pb-5">
              <SectionEyebrow label="Leaderboard" />
              <h2 className="mt-1 font-display text-[1.4rem] font-bold tracking-[-0.02em] text-[#000a1e] md:text-[1.6rem]">
                {isResident ? 'Residents' : 'Consultants'} by average score
              </h2>
              <p className="mt-1 text-sm text-[#74777f]">
                Select a person to open their evaluation history.
              </p>
            </div>

            {leaderboard.length ? (
              <div className="mt-5 overflow-hidden rounded-[0.4rem] border border-[#e6ecf3]">
                <div className="hidden grid-cols-[minmax(0,2fr)_minmax(0,1.4fr)_90px_90px_44px] gap-3 border-b border-[#eef2f6] bg-[#f7f9fc] px-4 py-2.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-[#74777f] sm:grid">
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
                    className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-[#eef2f6] px-4 py-2.5 text-sm transition-colors duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] last:border-b-0 hover:bg-[#f7f9fc] sm:grid-cols-[minmax(0,2fr)_minmax(0,1.4fr)_90px_90px_44px]"
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-semibold text-[#000a1e]">
                        {entry.subjectName ?? 'Unknown'}
                      </span>
                      <span className="block truncate text-xs text-[#74777f] sm:hidden">
                        {entry.homeWardName ?? '—'} · {entry.evaluationCount} evals · {Math.round(entry.averageScore)}%
                      </span>
                    </span>
                    <span className="hidden min-w-0 truncate text-[#5b6169] sm:block">
                      {entry.homeWardName ?? '—'}
                    </span>
                    <span className="hidden text-right font-semibold tabular-nums text-[#1d3047] sm:block">
                      {entry.evaluationCount}
                    </span>
                    <span className="hidden text-right font-semibold tabular-nums text-[#005db6] sm:block">
                      {Math.round(entry.averageScore)}%
                    </span>
                    <span className="flex justify-end text-[#9aa7b8]">
                      <ArrowUpRight className="h-4 w-4" />
                    </span>
                  </Link>
                ))}
              </div>
            ) : (
              <div className="mt-5 rounded-[0.4rem] border border-dashed border-[#d4dde8] bg-[#f7f9fc] px-5 py-10 text-center text-sm text-[#74777f]">
                No evaluations match the current filters.
              </div>
            )}
          </motion.section>
        </>
      )}

      <TransferReviewPanel allowImmediate />
      <MorningSessionsPanel />
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
