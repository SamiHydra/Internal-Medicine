import { ChevronDown, Minus, TrendingDown, TrendingUp } from 'lucide-react'
import type { ReactNode } from 'react'

import type { StudentAnalytics } from '@/lib/api/academic-operations'

type StudentRow = StudentAnalytics['students'][number]
type TrajectoryPoint = StudentRow['weeklyTrajectory'][number]

/** The rating scale both student forms are built on (seeded as min 1 / max 5). */
const RATING_MAX = 5

function ratedPoints(points: TrajectoryPoint[]) {
  return points.filter(
    (point): point is TrajectoryPoint & { rating: number } => point.rating !== null,
  )
}

function batchLine(student: StudentRow) {
  return [student.batchLabel, student.subgroup ? `Subgroup ${student.subgroup}` : null]
    .filter(Boolean)
    .join(' · ')
}

/**
 * The final mark as a compact colour-banded pill — the single signal shown in
 * the collapsed row, so the cohort scans on outcome alone.
 */
function FinalPill({ rating }: { rating: number | null }) {
  if (rating === null) {
    return (
      <span className="inline-flex items-center rounded-full bg-[#f2f5f8] px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.08em] text-[#8a93a0]">
        Pending
      </span>
    )
  }

  const band =
    rating >= 4
      ? { bg: '#e7f6ec', fg: '#0f7b3f' }
      : rating === 3
        ? { bg: '#fdf3e0', fg: '#a9761a' }
        : { bg: '#fdeceb', fg: '#b3261e' }

  return (
    <span
      className="inline-flex items-baseline gap-0.5 rounded-full px-2.5 py-1 text-[13px] font-bold tabular-nums"
      style={{ backgroundColor: band.bg, color: band.fg }}
    >
      {rating}
      <span className="text-[10px] font-semibold opacity-70">/{RATING_MAX}</span>
    </span>
  )
}

/** One labelled fact inside the expanded detail. */
function DetailFact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <p className="text-[10px] font-bold uppercase tracking-[0.11em] text-[#68727f]">{label}</p>
      <div className="mt-1 leading-none">{children}</div>
    </div>
  )
}

/** Direction of travel across the recorded weeks; muted until two weeks exist. */
function Trend({ points }: { points: TrajectoryPoint[] }) {
  const rated = ratedPoints(points)

  if (rated.length < 2) {
    return <span className="text-[13px] text-[#aab4c0]">Not enough weeks</span>
  }

  const delta = rated[rated.length - 1].rating - rated[0].rating
  const { Icon, color, label } =
    delta > 0
      ? { Icon: TrendingUp, color: '#1f6b3b', label: `Up ${delta}` }
      : delta < 0
        ? { Icon: TrendingDown, color: '#b3261e', label: `Down ${Math.abs(delta)}` }
        : { Icon: Minus, color: '#74777f', label: 'Steady' }

  return (
    <span className="inline-flex items-center gap-1.5 text-[13px]">
      <Icon className="h-3.5 w-3.5 shrink-0" style={{ color }} strokeWidth={2.5} />
      <span className="font-semibold" style={{ color }}>
        {label}
      </span>
      <span className="text-[#9aa6b5]">/ {rated.length} wks</span>
    </span>
  )
}

function StudentRowItem({ student }: { student: StudentRow }) {
  return (
    <details className="group overflow-hidden rounded-[0.6rem] border border-[#e9eef4] bg-white transition-colors duration-150 open:border-[#cfe0f4] hover:border-[#cfe0f4]">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 hover:bg-[#fbfcfe] [&::-webkit-details-marker]:hidden">
        <div className="min-w-0">
          <p className="truncate text-[15px] font-semibold leading-5 text-[#000a1e]">
            {student.fullName}
          </p>
          <p className="mt-0.5 truncate text-[12.5px] text-[#68727f]">{batchLine(student)}</p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <FinalPill rating={student.finalRating} />
          <ChevronDown className="h-4 w-4 text-[#b6c1cf] transition-transform duration-200 ease-out group-open:rotate-180" />
        </div>
      </summary>

      <div className="grid grid-cols-3 gap-3 border-t border-[#eef2f6] bg-[#fbfcfe] px-4 py-3.5">
        <DetailFact label="Attendance">
          {student.attendanceRate === null ? (
            <span className="text-[14px] font-medium text-[#9aa6b5]">Not recorded</span>
          ) : (
            <span className="text-[16px] font-bold tabular-nums text-[#1d3047]">
              {Math.round(student.attendanceRate)}%
            </span>
          )}
        </DetailFact>
        <DetailFact label="Weekly avg">
          <span className="inline-flex items-baseline gap-0.5">
            <span className="text-[16px] font-bold tabular-nums text-[#1d3047]">
              {student.weeklyAvgRating ?? '—'}
            </span>
            {student.weeklyAvgRating !== null ? (
              <span className="text-[11px] font-medium text-[#9aa6b5]">/{RATING_MAX}</span>
            ) : null}
          </span>
        </DetailFact>
        <DetailFact label="Trend">
          <Trend points={student.weeklyTrajectory} />
        </DetailFact>
      </div>
    </details>
  )
}

/**
 * Progress by student.
 *
 * A calm, scannable list: each row shows only the student and their colour-banded
 * final grade, so the whole cohort reads at a glance without a wall of numbers.
 * Attendance, the weekly average, and the trend expand on demand (native
 * details/summary — no JavaScript, keyboard-accessible).
 */
export function StudentProgressTable({ students }: { students: StudentRow[] }) {
  return (
    <div
      className="mt-6 max-h-[56vh] space-y-2 overflow-y-auto overscroll-contain pr-1"
      role="region"
      aria-label="Student progress"
      tabIndex={0}
    >
      {students.map((student) => (
        <StudentRowItem key={student.id} student={student} />
      ))}
    </div>
  )
}
