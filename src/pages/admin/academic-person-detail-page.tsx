import { animate, motion, useReducedMotion, type Variants } from 'framer-motion'
import { ArrowLeft, ChevronRight } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'

import { PersonMorningHistory } from '@/components/admin/academic-operations-tabs'
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

import { AcademicEvaluationDetailSheet } from '@/components/admin/academic-evaluation-detail-sheet'
import { ReportingScopePanel } from '@/components/admin/reporting-scope-panel'
import { ChartCard } from '@/components/dashboard/chart-card'
import { InsightPanel } from '@/components/dashboard/insight-panel'
import { AnalyticsContentSkeleton } from '@/components/layout/loading-skeletons'
import {
  fetchAcademicSnapshot,
  fetchAcademicWardOptions,
  listAcademicEvaluations,
  type AcademicWardOption,
} from '@/lib/api/academic'
import { getApiBrowserClient } from '@/lib/api/client'
import { readBoundedCache, writeBoundedCache } from '@/lib/bounded-cache'
import { apiEnvSetupHint } from '@/lib/api/env'
import { cn } from '@/lib/utils'
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
  AcademicEvaluationRecord,
  AcademicPersonStat,
  AcademicSummary,
  AcademicTrend,
} from '@/lib/api/types'

const ALL = 'all'

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
    return '-'
  }
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

function initialsFor(fullName: string | null): string {
  return (
    (fullName ?? '')
      .split(' ')
      .map((part) => part[0])
      .filter(Boolean)
      .join('')
      .slice(0, 2)
      .toUpperCase() || '-'
  )
}

/** Color the score pill by band so a weak evaluation reads at a glance. */
function scoreTone(score: number): string {
  if (score >= 80) {
    return 'border-[#cfe7d9] bg-[#edf7f0] text-[#1f6b3b]'
  }
  if (score >= 50) {
    return 'border-[#f0d9aa] bg-[#fbf4e6] text-[#8a5a00]'
  }
  return 'border-[#f1d1d1] bg-[#fff1f1] text-[#9d2a2a]'
}

const statRowVariants: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.07, delayChildren: 0.12 } },
}

const statItemVariants: Variants = {
  hidden: { opacity: 0, y: 8 },
  show: { opacity: 1, y: 0, transition: { duration: 0.35, ease: 'easeOut' } },
}

// Smoothly counts up to the value, and re-animates when a filter changes it.
function AnimatedStat({ value, format }: { value: number; format: (value: number) => string }) {
  const reduceMotion = useReducedMotion()
  const [shown, setShown] = useState(value)
  const previous = useRef(value)

  useEffect(() => {
    if (reduceMotion) {
      return
    }

    const controls = animate(previous.current, value, {
      duration: 0.7,
      ease: 'easeOut',
      onUpdate: (latest) => {
        previous.current = latest
        setShown(latest)
      },
    })

    return () => controls.stop()
  }, [value, reduceMotion])

  return <>{format(reduceMotion ? value : shown)}</>
}

// Re-opening the same person (or returning from Clinical) should be instant: cache
// the last result per person + filter signature and revalidate in the background.
let personWardsCache: AcademicWardOption[] | null = null

type PersonData = {
  summary: AcademicSummary
  trend: AcademicTrend
  evaluations: AcademicEvaluationRecord[]
  headerStat: AcademicPersonStat | null
}

const personDataCache = new Map<string, PersonData>()
const PERSON_CACHE_MAX_ENTRIES = 12

function personKey(
  userId: string,
  direction: string,
  wardId: string | undefined,
  dateFrom: string | undefined,
  dateTo: string | undefined,
): string {
  return [userId, direction, wardId ?? '', dateFrom ?? '', dateTo ?? ''].join('|')
}

const sectionClass = 'rounded-[0.35rem] bg-[#f1f4f7] px-5 py-6 md:px-6'
const eyebrowClass = 'text-[11px] font-semibold uppercase tracking-[0.22em] text-[#005db6]'

export function AcademicPersonDetailPage() {
  const { userId = '' } = useParams()
  const [searchParams] = useSearchParams()
  const client = getApiBrowserClient()

  const initialDirection: AcademicDirection =
    searchParams.get('direction') === 'resident' ? 'resident' : 'consultant'

  // Seed from cache so re-opening the same person paints instantly, then revalidates.
  const cachedPerson = readBoundedCache(
    personDataCache,
    personKey(userId, initialDirection, undefined, undefined, undefined),
  )

  // Fixed for the lifetime of the page: it is the person's role, not a filter.
  const direction = initialDirection
  const [wardId, setWardId] = useState<string>(ALL)
  const [range, setRange] = useState<string>(ALL)

  const [wards, setWards] = useState<AcademicWardOption[]>(personWardsCache ?? [])
  const [summary, setSummary] = useState<AcademicSummary | null>(cachedPerson?.summary ?? null)
  const [trend, setTrend] = useState<AcademicTrend | null>(cachedPerson?.trend ?? null)
  const [evaluations, setEvaluations] = useState<AcademicEvaluationRecord[]>(cachedPerson?.evaluations ?? [])
  const [selectedRecord, setSelectedRecord] = useState<AcademicEvaluationRecord | null>(null)
  // The log shows either evaluations written ABOUT this person (the default) or
  // the ones they wrote about others.
  const [logView, setLogView] = useState<'received' | 'given'>('received')
  // Keyed by filter signature: an absent key means "not fetched yet", which is
  // also how the loading state is derived (no setState inside the effect).
  const [authoredByKey, setAuthoredByKey] = useState<
    Record<string, AcademicEvaluationRecord[]>
  >({})
  const [headerStat, setHeaderStat] = useState<AcademicPersonStat | null>(cachedPerson?.headerStat ?? null)
  const [error, setError] = useState<string | null>(() =>
    client ? null : `The Laravel API is not configured. ${apiEnvSetupHint}`,
  )
  const [isLoading, setIsLoading] = useState(() => Boolean(client) && !cachedPerson)

  const dateRange = useMemo(() => rangeToDates(range), [range])

  useEffect(() => {
    if (!client) {
      return
    }
    let active = true
    fetchAcademicWardOptions(client)
      .then((fetched) => {
        personWardsCache = fetched
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
    const cacheKey = personKey(userId, direction, query.wardId, query.dateFrom, query.dateTo)
    Promise.all([
      fetchAcademicSnapshot(client, { ...query, granularity: 'weekly' }),
      listAcademicEvaluations(client, { ...query, perPage: 50 }),
    ])
      .then(([fetchedSnapshot, fetchedList]) => {
        const fetchedHeaderStat =
          fetchedSnapshot.people.people.find((entry) => entry.subjectId === userId) ?? null
        writeBoundedCache(
          personDataCache,
          cacheKey,
          {
            summary: fetchedSnapshot.summary,
            trend: fetchedSnapshot.trend,
            evaluations: fetchedList.data,
            headerStat: fetchedHeaderStat,
          },
          PERSON_CACHE_MAX_ENTRIES,
        )
        if (!active) {
          return
        }
        setSummary(fetchedSnapshot.summary)
        setTrend(fetchedSnapshot.trend)
        setEvaluations(fetchedList.data)
        setHeaderStat(fetchedHeaderStat)
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

  // Evaluations this person WROTE are always the opposite form: a consultant
  // writes resident evaluations, a resident writes consultant evaluations.
  const givenDirection: AcademicDirection = isResident ? 'consultant' : 'resident'

  const givenKey = personKey(
    userId,
    givenDirection,
    wardId === ALL ? undefined : wardId,
    dateRange.dateFrom,
    dateRange.dateTo,
  )
  const authored = authoredByKey[givenKey]
  const authoredLoading = logView === 'given' && authored === undefined

  // Fetched only once the Submitted view is opened, so the default page load
  // costs exactly what it did before.
  useEffect(() => {
    if (!client || logView !== 'given' || authoredByKey[givenKey] !== undefined) {
      return
    }
    let active = true
    listAcademicEvaluations(client, {
      direction: givenDirection,
      authorId: userId,
      wardId: wardId === ALL ? undefined : wardId,
      dateFrom: dateRange.dateFrom,
      dateTo: dateRange.dateTo,
      perPage: 50,
    })
      .then((response) => {
        if (active) {
          setAuthoredByKey((prev) => ({ ...prev, [givenKey]: response.data }))
        }
      })
      .catch(() => {
        if (active) {
          setAuthoredByKey((prev) => ({ ...prev, [givenKey]: [] }))
        }
      })
    return () => {
      active = false
    }
  }, [client, logView, givenKey, givenDirection, userId, wardId, dateRange, authoredByKey])

  const logRows = logView === 'given' ? (authored ?? []) : evaluations

  const subjectName =
    headerStat?.subjectName ?? evaluations[0]?.subjectName ?? 'Selected person'
  const homeWardName = headerStat?.homeWardName ?? null

  const wardOptions = useMemo(
    () => [{ value: ALL, label: 'All wards' }, ...wards.map((ward) => ({ value: ward.id, label: ward.name }))],
    [wards],
  )

  // No Direction filter here. A person has one role, so one of its two options
  // always matched nothing, and because direction feeds the KPIs and charts as
  // well as the log, choosing it emptied the whole page with no explanation.
  // The role is fixed by the person and arrives on the URL from the leaderboard.
  const scopeFields = [
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

  const heroStats = isResident
    ? [
        { label: 'Evaluations', value: summary?.evaluationCount ?? 0, note: 'On record', format: (value: number) => String(Math.round(value)) },
        { label: 'Average score', value: summary?.averageScore ?? 0, note: 'Indicators met', format: (value: number) => `${Math.round(value)}%` },
        { label: 'Avg rating', value: summary?.avgOverallRating ?? 0, note: 'Out of 5', format: (value: number) => `${value.toFixed(1)}/5` },
        {
          label: 'Concerns flagged',
          value: issueData.reduce((sum, issue) => sum + issue.count, 0),
          note: 'Across evaluations',
          format: (value: number) => String(Math.round(value)),
        },
      ]
    : [
        { label: 'Evaluations', value: summary?.evaluationCount ?? 0, note: 'On record', format: (value: number) => String(Math.round(value)) },
        { label: 'Average score', value: summary?.averageScore ?? 0, note: 'Indicators met', format: (value: number) => `${Math.round(value)}%` },
        {
          label: 'Senior presence',
          value: (summary?.seniorPresenceRate ?? 0) * 100,
          note: 'Rounds with a senior',
          format: (value: number) => `${Math.round(value)}%`,
        },
        { label: 'Avg patients seen', value: summary?.avgPctSeen ?? 0, note: 'Average coverage', format: (value: number) => `${Math.round(value)}%` },
      ]

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
    <div className="space-y-6 px-4 py-5 md:px-6 md:py-8">
      <motion.section
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: 'easeOut' }}
        className="overflow-hidden rounded-[0.35rem] bg-[#04162f] px-5 py-6 text-white shadow-[0_26px_64px_-40px_rgba(0,12,35,0.85)] md:px-7 md:py-7"
      >
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#f0b429]">
            {isResident ? 'Resident' : 'Consultant'}
          </p>
          <h1 className="mt-2 font-display text-[1.7rem] font-bold leading-tight tracking-[-0.02em] text-white md:text-[2.1rem]">
            {subjectName}
          </h1>
          <p className="mt-2 max-w-xl text-sm leading-6 text-[#9fb0c6]">
            {homeWardName
              ? `Home ward: ${homeWardName}. Evaluation history and indicator breakdown.`
              : 'Evaluation history and indicator breakdown.'}
          </p>
          <Link
            to="/admin/academic"
            className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-[#7cb3ff] transition-colors hover:text-white"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to academic
          </Link>
        </div>

        <motion.div
          variants={statRowVariants}
          initial="hidden"
          animate="show"
          className="mt-6 grid grid-cols-2 gap-x-8 gap-y-5 border-t border-white/10 pt-5 lg:grid-cols-4"
        >
          {heroStats.map((stat) => (
            <motion.div key={stat.label} variants={statItemVariants} className="min-w-0">
              <p className="truncate text-[11px] font-semibold uppercase tracking-[0.18em] text-[#f0b429]">
                {stat.label}
              </p>
              <p className="mt-1.5 font-display text-[1.9rem] font-bold leading-none tabular-nums text-white md:text-[2.1rem]">
                <AnimatedStat value={stat.value} format={stat.format} />
              </p>
              <p className="mt-1 truncate text-xs text-[#9fb0c6]">{stat.note}</p>
            </motion.div>
          ))}
        </motion.div>
      </motion.section>

      <ReportingScopePanel fields={scopeFields} />

      {error ? (
        <div className="rounded-[0.35rem] border border-[#f1d1d1] bg-[#fff1f1] px-5 py-10 text-center text-sm font-medium text-[#b42318]">
          {error}
        </div>
      ) : isLoading && !summary ? (
        <AnalyticsContentSkeleton />
      ) : (
        <>
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, ease: 'easeOut', delay: 0.05 }}
            className="grid gap-6 2xl:grid-cols-[1.35fr_1fr] 2xl:items-start"
          >
            <ChartCard title="Score trend" description="Average score per week.">
              {trendData.length ? (
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart title="Score trend" data={trendData} margin={{ top: 16, right: 20, left: 0, bottom: 8 }}>
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
          </motion.div>

          <ChartCard title="Indicator breakdown" description="Share of evaluations marking each item met.">
            {indicatorData.length ? (
              <ResponsiveContainer width="100%" height={indicatorHeight}>
                <BarChart
                  title="Indicator breakdown"
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

          <motion.section
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, ease: 'easeOut', delay: 0.08 }}
            className={sectionClass}
          >
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="space-y-1.5">
                <p className={eyebrowClass}>Recent evaluations</p>
                <h2 className="font-display text-[1.5rem] leading-tight tracking-[-0.02em] text-[#000a1e]">
                  Evaluation log
                </h2>
                <p className="text-sm text-[#666970]">
                  {logView === 'given'
                    ? `Evaluations ${subjectName} submitted about others.`
                    : `Evaluations submitted about ${subjectName}.`}
                </p>
              </div>

              <div
                role="group"
                aria-label="Evaluation log view"
                className="flex gap-1 rounded-[0.35rem] bg-[#eef1f5] p-1"
              >
                {(
                  [
                    { value: 'received' as const, label: 'Received' },
                    { value: 'given' as const, label: 'Submitted' },
                  ]
                ).map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    aria-pressed={logView === option.value}
                    onClick={() => setLogView(option.value)}
                    className={cn(
                      'rounded-[0.25rem] px-3.5 py-1.5 text-[13px] tracking-[-0.01em] transition-colors duration-150',
                      'outline-none focus-visible:ring-2 focus-visible:ring-[#005db6]/45',
                      logView === option.value
                        ? 'bg-[#04162f] font-bold text-white'
                        : 'font-semibold text-[#5b6169] hover:text-[#000a1e]',
                    )}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

            {authoredLoading && logView === 'given' ? (
              <div className="mt-5 rounded-[0.35rem] border border-dashed border-[#cbd5e1] bg-white px-5 py-10 text-center text-sm text-[#5b6169]">
                Loading submitted evaluations...
              </div>
            ) : logRows.length ? (
              <div className="mt-5 overflow-hidden rounded-[0.4rem] border border-[#e6ecf3] bg-white">
                <div className="hidden grid-cols-[124px_minmax(0,2fr)_minmax(0,1.1fr)_104px] items-center gap-4 border-b border-[#eef2f6] bg-[#f7f9fc] px-4 py-2.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-[#666970] sm:grid">
                  <span>Date</span>
                  <span>{logView === 'given' ? 'Evaluated' : 'Author'}</span>
                  <span>Ward</span>
                  <span className="text-right">Score</span>
                </div>
                {logRows.map((record) => {
                  const score = Math.round(recordScore(record))
                  return (
                    <button
                      key={record.id}
                      type="button"
                      onClick={() => setSelectedRecord(record)}
                      className="group grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-[#eef2f6] px-4 py-2.5 text-left text-sm transition-colors last:border-b-0 hover:bg-[#f7f9fc] focus:outline-none focus-visible:bg-[#eef4fb] sm:grid-cols-[124px_minmax(0,2fr)_minmax(0,1.1fr)_104px] sm:gap-4"
                    >
                      <span className="hidden text-[13px] tabular-nums text-[#5b6169] sm:block">
                        {toDateLabel(record.evaluationDate)}
                      </span>
                      <span className="flex min-w-0 items-center gap-3">
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#04162f] text-[11px] font-bold text-[#f0b429]">
                          {initialsFor(logView === 'given' ? record.subjectName : record.authorName)}
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate font-semibold text-[#000a1e]">
                            {(logView === 'given' ? record.subjectName : record.authorName) ?? '-'}
                          </span>
                          <span className="block truncate text-xs text-[#666970] sm:hidden">
                            {toDateLabel(record.evaluationDate)} · {record.wardName ?? '-'}
                          </span>
                        </span>
                      </span>
                      <span className="hidden min-w-0 sm:block">
                        <span className="block truncate text-[13px] text-[#5b6169]">
                          {record.wardName ?? '-'}
                        </span>
                      </span>
                      <span className="flex items-center justify-end gap-2">
                        <span
                          className={cn(
                            'inline-flex min-w-[3.25rem] justify-center rounded-full border px-2.5 py-1 text-xs font-bold tabular-nums',
                            scoreTone(score),
                          )}
                        >
                          {score}%
                        </span>
                        <ChevronRight className="hidden h-4 w-4 shrink-0 text-[#c4c6cf] transition-colors group-hover:text-[#005db6] sm:block" />
                      </span>
                    </button>
                  )
                })}
              </div>
            ) : (
              <div className="mt-5 rounded-[0.35rem] border border-dashed border-[#cbd5e1] bg-white px-5 py-10 text-center text-sm text-[#5b6169]">
                No evaluations match the current filters.
              </div>
            )}
          </motion.section>

          <ChartCard
            title={isResident ? 'Concerns' : 'System issues'}
            description="Most frequently flagged items."
          >
            {issueData.length ? (
              <ResponsiveContainer width="100%" height={Math.max(220, issueData.length * 40)}>
                <BarChart title={isResident ? 'Concerns' : 'System issues'} data={issueData} layout="vertical" margin={{ top: 8, right: 24, left: 8, bottom: 8 }}>
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

      <PersonMorningHistory userId={userId} />

      <AcademicEvaluationDetailSheet
        record={selectedRecord}
        open={selectedRecord !== null}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedRecord(null)
          }
        }}
      />
    </div>
  )
}

function EmptyChart({ message }: { message: string }) {
  return (
    <div className="flex h-[260px] items-center justify-center text-sm text-[#666970]">
      {message}
    </div>
  )
}
