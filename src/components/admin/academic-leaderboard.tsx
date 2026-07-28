import { ArrowUpRight, Crown, Star } from 'lucide-react'
import { Link } from 'react-router-dom'

import type { AcademicDirection, AcademicPersonStat } from '@/lib/api/types'
import { cn } from '@/lib/utils'

type RankTheme = {
  /** Medallion background (solid). */
  medalBg: string
  /** Medallion glyph colour. */
  medalText: string
  /** Left accent strip; null for non-podium rows. */
  accent: string | null
  /** Faint solid row tint for the podium; null otherwise. */
  tint: string | null
}

/** Gold / silver / bronze for the top three, a calm neutral for the rest. */
function rankTheme(index: number): RankTheme {
  switch (index) {
    case 0:
      return { medalBg: '#f0b429', medalText: '#3f2d00', accent: '#e0a416', tint: '#fffdf4' }
    case 1:
      return { medalBg: '#9aa7b8', medalText: '#ffffff', accent: '#9aa7b8', tint: '#fafbfc' }
    case 2:
      return { medalBg: '#c17d3f', medalText: '#ffffff', accent: '#c17d3f', tint: '#fdf9f4' }
    default:
      return { medalBg: '#eef2f7', medalText: '#5b6b80', accent: null, tint: null }
  }
}

type Props = {
  entries: AcademicPersonStat[]
  direction: AcademicDirection
  minEvaluationsForRank: number
}

export function AcademicLeaderboard({ entries, direction, minEvaluationsForRank }: Props) {
  return (
    <ul className="mt-6 flex flex-col gap-2">
      {/* Column legend — hidden on mobile, where each row carries its own subtext. */}
      <li
        aria-hidden
        className="hidden grid-cols-[52px_minmax(0,1fr)_64px_64px_64px_24px] items-center gap-5 px-4 pb-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#9aa7b8] sm:grid"
      >
        <span className="text-center">Rank</span>
        <span>Name</span>
        <span className="text-right">Rating</span>
        <span className="text-right">Score</span>
        <span className="text-right">Combined</span>
        <span />
      </li>

      {entries.map((entry, index) => {
        const theme = rankTheme(index)
        const combined = Math.max(0, Math.min(100, entry.combinedScore))

        return (
          <li key={entry.subjectId}>
            <Link
              to={`/admin/academic/people/${entry.subjectId}?direction=${direction}`}
              style={theme.tint ? { backgroundColor: theme.tint } : undefined}
              className={cn(
                'group relative grid grid-cols-[44px_minmax(0,1fr)_auto] items-center gap-5 overflow-hidden rounded-[0.7rem] border border-[#e9eef4] bg-white px-3 py-3 transition-colors duration-150 ease-out hover:border-[#cfe0f4] hover:bg-[#f8fafc] sm:grid-cols-[52px_minmax(0,1fr)_64px_64px_64px_24px] sm:px-4',
                theme.accent && 'border-[#eadfc6]',
              )}
            >
              {/* Podium rows are marked by the tinted background, the warmer
                  border, and the medallion; no accent strip. */}

              {/* Medallion */}
              <span className="flex justify-center">
                <span
                  className="flex h-9 w-9 items-center justify-center rounded-full text-sm font-extrabold tabular-nums"
                  style={{ background: theme.medalBg, color: theme.medalText }}
                >
                  {index === 0 ? <Crown className="h-4 w-4" strokeWidth={2.5} /> : index + 1}
                </span>
              </span>

              {/* Name + meta */}
              <span className="min-w-0">
                <span className="flex items-center gap-1.5">
                  <span className="truncate font-semibold text-[#000a1e]">
                    {entry.subjectName ?? 'Unknown'}
                  </span>
                  {entry.provisional ? (
                    <span
                      title={`Fewer than ${minEvaluationsForRank} evaluations — provisional`}
                      className="shrink-0 rounded-full bg-[#fff4e0] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-[#8a6100]"
                    >
                      Provisional
                    </span>
                  ) : null}
                </span>
                <span className="mt-0.5 block truncate text-[12.5px] text-[#8794a5]">
                  <span className="sm:hidden">
                    {entry.homeWardName ?? 'Unassigned ward'} · {entry.evaluationCount} evals ·{' '}
                    {entry.ratingAverage !== null ? `★ ${entry.ratingAverage.toFixed(1)}` : 'no rating'} ·{' '}
                    {Math.round(entry.averageScore)}% score · {Math.round(combined)}% combined
                  </span>
                  <span className="hidden sm:inline">
                    {entry.homeWardName ?? 'Unassigned ward'} · {entry.evaluationCount} evals
                  </span>
                </span>
              </span>

              {/* Rating chip */}
              <span className="hidden justify-end sm:flex">
                {entry.ratingAverage !== null ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-[#fef6e6] px-2 py-1 text-[13px] font-semibold tabular-nums text-[#a9761a]">
                    <Star className="h-3 w-3 fill-current" strokeWidth={0} />
                    {entry.ratingAverage.toFixed(1)}
                  </span>
                ) : (
                  <span
                    title="No 1–5 rating captured yet"
                    className="inline-flex items-center rounded-full bg-[#f2f5f8] px-2 py-1 text-[13px] font-medium text-[#aab4c0]"
                  >
                    —
                  </span>
                )}
              </span>

              {/* Indicator score */}
              <span className="hidden text-right text-[14px] font-semibold tabular-nums text-[#5b6169] sm:block">
                {Math.round(entry.averageScore)}%
              </span>

              {/* Combined — the headline number */}
              <span className="hidden text-right text-[16px] font-bold tabular-nums text-[#004a92] sm:block">
                {Math.round(combined)}%
              </span>

              {/* Affordance */}
              <span className="flex justify-end text-[#b6c1cf] transition-colors duration-150 ease-out group-hover:text-[#005db6]">
                <ArrowUpRight className="h-4 w-4" />
              </span>
            </Link>
          </li>
        )
      })}
    </ul>
  )
}
