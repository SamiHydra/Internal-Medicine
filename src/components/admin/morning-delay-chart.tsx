import { format, parseISO } from 'date-fns'
import { useMemo, useState } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import { ChartCard } from '@/components/dashboard/chart-card'
import {
  chartGridStroke,
  chartTick,
  delayBandPalette,
  lightTooltipStyle,
} from '@/lib/chart-theme'
import type { MorningAnalytics } from '@/lib/api/academic-operations'

type Band = 'onTime' | 'late'

type DelayPoint = {
  date: string
  label: string
  longLabel: string
  delay: number
  band: Band
}

const BAND_LABEL: Record<Band, string> = {
  onTime: 'On time',
  late: 'Started late',
}

const BAND_ORDER: Band[] = ['onTime', 'late']

function DelayTooltip({
  active,
  payload,
}: {
  active?: boolean
  payload?: Array<{ payload: DelayPoint }>
}) {
  const point = active ? payload?.[0]?.payload : undefined
  if (!point) return null

  return (
    <div style={lightTooltipStyle}>
      <p className="text-xs font-bold text-[#002147]">{point.longLabel}</p>
      <p className="mt-1.5 flex items-center gap-2 text-[13px] font-semibold text-[#334155]">
        <span
          aria-hidden
          className="h-2.5 w-2.5 rounded-[2px]"
          style={{ backgroundColor: delayBandPalette[point.band] }}
        />
        {point.delay === 0
          ? 'Started on time'
          : `${point.delay} min after the scheduled start`}
      </p>
    </div>
  )
}

/**
 * Delay per recorded morning session.
 *
 * Deliberately columns rather than a line: each morning is an independent
 * event and the overwhelming majority start exactly on time, so a connected
 * (and previously smoothed) line invented a gradual rise and fall between days
 * that never happened. Columns grow from a shared zero baseline, which lets the
 * on-time majority recede into a quiet baseline tick and leaves the handful of
 * late mornings - the only thing anyone acts on - carrying the ink.
 */
export function MorningDelayChart({ trend }: { trend: MorningAnalytics['trend'] }) {
  const [view, setView] = useState<'chart' | 'table'>('chart')

  const points = useMemo<DelayPoint[]>(
    () =>
      trend
        .filter((point) => point.status === 'recorded')
        .map((point) => {
          const delay = point.delayMinutes ?? 0
          const parsed = parseISO(point.date)
          return {
            date: point.date,
            label: format(parsed, 'MMM d'),
            longLabel: format(parsed, 'EEEE, MMM d yyyy'),
            delay,
            band: delay > 0 ? 'late' : 'onTime',
          }
        }),
    [trend],
  )

  const counts = useMemo(() => {
    const tally: Record<Band, number> = { onTime: 0, late: 0 }
    points.forEach((point) => {
      tally[point.band] += 1
    })
    return tally
  }, [points])

  const worstIndex = useMemo(
    () =>
      points.reduce(
        (best, point, index) =>
          point.delay > 0 && (best < 0 || point.delay > points[best].delay)
            ? index
            : best,
        -1,
      ),
    [points],
  )
  const worst = worstIndex >= 0 ? points[worstIndex] : null

  // Roughly eight readable date ticks regardless of how long the window is.
  const tickInterval = Math.max(0, Math.ceil(points.length / 8) - 1)

  // Label the single worst morning on its cap, so the number the reader cares
  // about is legible without hovering. Everything else stays to the axis,
  // the tooltip and the table - a value on every column would go unread.
  const renderWorstLabel = (props: {
    x?: number | string
    y?: number | string
    width?: number | string
    index?: number
  }) => {
    if (props.index !== worstIndex || !worst) return null
    return (
      <text
        x={Number(props.x) + Number(props.width) / 2}
        y={Number(props.y) - 8}
        textAnchor="middle"
        fill="#334155"
        fontSize={12}
        fontWeight={700}
      >
        {worst.delay} min
      </text>
    )
  }

  return (
    <ChartCard
      title="Delay trend"
      description="Minutes after the scheduled start for each recorded morning session."
      actions={
        points.length > 0 ? (
          <div
            role="group"
            aria-label="Delay trend view"
            className="flex shrink-0 gap-1 rounded-[0.35rem] bg-white p-1 outline outline-1 outline-[#d4dde8]"
          >
            {(['chart', 'table'] as const).map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={view === option}
                onClick={() => setView(option)}
                className={`rounded-[0.25rem] px-2.5 py-1 text-xs font-semibold capitalize transition-colors ${
                  view === option
                    ? 'bg-[#04162f] text-white'
                    : 'text-[#44474e] hover:bg-[#eef2f6]'
                }`}
              >
                {option}
              </button>
            ))}
          </div>
        ) : null
      }
    >
      {points.length === 0 ? (
        <div className="flex h-[260px] items-center justify-center text-sm text-[#74777f]">
          A trend appears once a session is recorded.
        </div>
      ) : (
        <>
          {/* The legend doubles as the count summary, so identity never rests
              on colour alone and the two numbers need no separate caption. */}
          <ul className="mb-5 flex flex-wrap items-center gap-x-6 gap-y-2">
            {BAND_ORDER.map((band) => (
              <li
                key={band}
                className="flex items-center gap-2 text-[13px] text-[#52606d]"
              >
                <span
                  aria-hidden
                  className="h-2.5 w-2.5 rounded-[2px]"
                  style={{ backgroundColor: delayBandPalette[band] }}
                />
                <span className="font-medium">{BAND_LABEL[band]}</span>
                <span className="font-semibold tabular-nums text-[#334155]">
                  {counts[band]}
                </span>
              </li>
            ))}
          </ul>

          {view === 'chart' ? (
            <ResponsiveContainer
              width="100%"
              height={260}
              initialDimension={{ width: 1, height: 260 }}
            >
              <BarChart
                data={points}
                margin={{ top: 24, right: 12, bottom: 8, left: -16 }}
                barCategoryGap="18%"
                role="img"
                aria-label={`Delay per recorded morning session. ${counts.late} of ${points.length} started late.`}
              >
                <CartesianGrid stroke={chartGridStroke} vertical={false} />
                <XAxis
                  dataKey="label"
                  tick={chartTick}
                  tickLine={false}
                  axisLine={false}
                  tickMargin={12}
                  interval={tickInterval}
                />
                <YAxis
                  tick={chartTick}
                  tickLine={false}
                  axisLine={false}
                  allowDecimals={false}
                  width={44}
                />
                <Tooltip
                  cursor={{ fill: 'rgba(0,93,182,0.06)' }}
                  content={<DelayTooltip />}
                />
                <Bar
                  dataKey="delay"
                  minPointSize={2}
                  maxBarSize={14}
                  radius={[4, 4, 0, 0]}
                  isAnimationActive={false}
                  label={renderWorstLabel}
                >
                  {points.map((point) => (
                    <Cell key={point.date} fill={delayBandPalette[point.band]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="max-h-[260px] overflow-y-auto rounded-[0.4rem] border border-[#e6ecf3]">
              <table className="w-full border-collapse text-sm">
                <caption className="sr-only">
                  Delay in minutes for each recorded morning session
                </caption>
                <thead className="sticky top-0 z-10 bg-[#f7f9fc]">
                  <tr className="border-b border-[#e6ecf3] text-left text-xs font-bold uppercase tracking-[0.1em] text-[#526171]">
                    <th scope="col" className="px-4 py-2.5">
                      Session
                    </th>
                    <th scope="col" className="px-4 py-2.5 text-right">
                      Delay
                    </th>
                    <th scope="col" className="px-4 py-2.5">
                      Status
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {points.map((point) => (
                    <tr
                      key={point.date}
                      className="border-b border-[#eef2f6] last:border-b-0"
                    >
                      <td className="px-4 py-2 text-[#1d3047]">
                        {point.longLabel}
                      </td>
                      <td className="px-4 py-2 text-right font-medium tabular-nums text-[#1d3047]">
                        {point.delay} min
                      </td>
                      <td className="px-4 py-2 text-[#52606d]">
                        {BAND_LABEL[point.band]}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </ChartCard>
  )
}
