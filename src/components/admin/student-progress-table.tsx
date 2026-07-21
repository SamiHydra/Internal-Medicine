import { format, parseISO } from 'date-fns'

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

/**
 * A rating as five steps, the filled ones carrying the value.
 *
 * The earlier attempts drew the weeks themselves - a dot, then a bar - and
 * both failed for the same reason: with a single recorded week there is
 * nothing on screen to measure the mark against, so it reads as a stray
 * stripe rather than a score. Showing the whole scale fixes that: the unfilled
 * steps ARE the reference, so "3" and "5" are distinguishable at a glance
 * however many weeks exist.
 */
function RatingMeter({
  value,
  tone = 'accent',
  title,
}: {
  value: number
  tone?: 'accent' | 'muted'
  title?: string
}) {
  const filled = Math.min(RATING_MAX, Math.max(0, Math.round(value)))

  return (
    <span
      title={title}
      role="img"
      aria-label={`${value} out of ${RATING_MAX}`}
      className="flex shrink-0 items-center gap-[3px]"
    >
      {Array.from({ length: RATING_MAX }, (_, index) => (
        <span
          key={index}
          className={`rating-step block h-[18px] w-[5px] rounded-[2px] ${
            index < filled
              ? tone === 'accent'
                ? 'bg-[#005db6]'
                : 'bg-[#8ea3bb]'
              : 'bg-[#e6ecf3]'
          }`}
          // Left-to-right stagger, well inside the 30-80ms guidance so the
          // whole meter settles in ~380ms.
          style={{ animationDelay: `${index * 40}ms` }}
        />
      ))}
    </span>
  )
}

/** Weekly ratings, hover text listing the week behind each one. */
function WeeklyMeter({
  average,
  points,
}: {
  average: number | null
  points: TrajectoryPoint[]
}) {
  const rated = ratedPoints(points)

  if (average === null || rated.length === 0) {
    return (
      <span className="text-[15px] text-[#9aa6b5]" aria-label="No weekly ratings">
        &mdash;
      </span>
    )
  }

  // The week behind each rating has nowhere to live in a one-line cell, so it
  // becomes hover text rather than being discarded.
  const detail = rated
    .map((point) =>
      point.weekStartsOn
        ? `Week of ${format(parseISO(point.weekStartsOn), 'MMM d')}: ${point.rating}/${RATING_MAX}`
        : `${point.rating}/${RATING_MAX}`,
    )
    .join('\n')

  return <RatingMeter value={average} title={detail} />
}

/**
 * Direction of travel. Rendered only when two weeks exist to compare - with a
 * single week there is no trend, and saying so would be noise.
 */
function TrendNote({ points }: { points: TrajectoryPoint[] }) {
  const rated = ratedPoints(points)

  if (rated.length < 2) {
    return null
  }

  const delta = rated[rated.length - 1].rating - rated[0].rating

  if (delta === 0) {
    return (
      <span className="text-[13px] text-[#74777f]">Steady over {rated.length} weeks</span>
    )
  }

  return (
    <span
      className={`text-[13px] font-semibold ${
        delta > 0 ? 'text-[#1f6b3b]' : 'text-[#9d2a2a]'
      }`}
    >
      {delta > 0 ? `Up ${delta}` : `Down ${Math.abs(delta)}`} over {rated.length} weeks
    </span>
  )
}

/** Attendance as a share of a whole, so rows compare at a glance. */
function AttendanceMeter({ rate }: { rate: number | null }) {
  if (rate === null) {
    return <span className="text-[15px] text-[#9aa6b5]">Not recorded</span>
  }

  const value = Math.round(rate)

  return (
    <span className="flex items-center gap-2.5">
      <span
        aria-hidden
        className="h-2 w-20 shrink-0 overflow-hidden rounded-full bg-[#e6ecf3]"
      >
        <span
          className="block h-full rounded-full bg-[#005db6]"
          style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
        />
      </span>
      <span className="text-[15px] font-semibold tabular-nums text-[#1d3047]">
        {value}%
      </span>
    </span>
  )
}

/**
 * The final mark. Carrying the "/5" removes the guesswork about the scale,
 * which a bare "3" never answered.
 */
function FinalMark({ rating }: { rating: number | null }) {
  if (rating === null) {
    return (
      <span className="inline-flex items-center rounded-[0.25rem] bg-[#f4f7fb] px-2.5 py-1 text-[12px] font-semibold uppercase tracking-[0.1em] text-[#74777f]">
        Pending
      </span>
    )
  }

  return (
    <span className="inline-flex items-center gap-2.5">
      <span className="inline-flex items-baseline gap-0.5">
        <span className="text-[18px] font-bold tabular-nums text-[#005db6]">
          {rating}
        </span>
        <span className="text-[12px] font-medium text-[#9aa6b5]">/{RATING_MAX}</span>
      </span>
      <RatingMeter value={rating} />
    </span>
  )
}

function batchLine(student: StudentRow) {
  return [student.batchLabel, student.subgroup ? `Subgroup ${student.subgroup}` : null]
    .filter(Boolean)
    .join(' · ')
}

/**
 * Progress by student.
 *
 * Reworked from a six-column grid of bare digits. Student and batch merge into
 * one identity cell; weekly average and trajectory merge into one progress
 * cell, because an average without its shape and a shape without its average
 * each tell half the story. Every number now carries the thing that makes it
 * legible: attendance a track, the final mark its scale, the trajectory a
 * fixed 1-5 axis and the weeks it was measured over.
 */
export function StudentProgressTable({ students }: { students: StudentRow[] }) {
  return (
    <>
      {/* Mobile: the same four facts, stacked. */}
      <div
        className="mt-5 max-h-[52vh] overflow-y-auto overscroll-contain rounded-[0.4rem] border border-[#e6ecf3] sm:hidden"
        role="region"
        aria-label="Student progress list"
        tabIndex={0}
      >
        {students.map((student) => (
          <article
            key={student.id}
            className="border-b border-[#eef2f6] p-4 last:border-b-0"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-[15px] font-semibold text-[#000a1e]">
                  {student.fullName}
                </p>
                <p className="mt-0.5 truncate text-[13.5px] text-[#74777f]">
                  {batchLine(student)}
                </p>
              </div>
              <FinalMark rating={student.finalRating} />
            </div>

            <div className="mt-3.5 flex items-center justify-between gap-4 border-t border-[#eef2f6] pt-3.5">
              <div>
                <p className="text-[12px] font-bold uppercase tracking-[0.1em] text-[#526171]">
                  Attendance
                </p>
                <div className="mt-1.5">
                  <AttendanceMeter rate={student.attendanceRate} />
                </div>
              </div>
              <div className="text-right">
                <p className="text-[12px] font-bold uppercase tracking-[0.1em] text-[#526171]">
                  Weekly
                </p>
                <div className="mt-1 flex items-center justify-end gap-2.5">
                  <span className="inline-flex items-baseline gap-0.5">
                    <span className="text-[18px] font-bold tabular-nums text-[#1d3047]">
                      {student.weeklyAvgRating ?? '-'}
                    </span>
                    <span className="text-[12px] font-medium text-[#9aa6b5]">
                      /{RATING_MAX}
                    </span>
                  </span>
                  <WeeklyMeter
                    average={student.weeklyAvgRating}
                    points={student.weeklyTrajectory}
                  />
                </div>
                <div className="mt-1 flex justify-end">
                  <TrendNote points={student.weeklyTrajectory} />
                </div>
              </div>
            </div>
          </article>
        ))}
      </div>

      <div className="mt-5 hidden max-h-[52vh] overflow-auto rounded-[0.4rem] border border-[#e6ecf3] sm:block">
        <table className="w-full min-w-[680px] border-collapse text-sm">
          <thead className="sticky top-0 z-10 bg-[#f7f9fc]">
            <tr className="border-b border-[#e6ecf3] text-left text-[12px] font-bold uppercase tracking-[0.12em] text-[#526171]">
              <th scope="col" className="px-4 py-3.5">
                Student
              </th>
              <th scope="col" className="px-4 py-3.5">
                Attendance
              </th>
              <th scope="col" className="px-4 py-3.5">
                Weekly progress
              </th>
              <th scope="col" className="px-4 py-3.5 text-right">
                Final
              </th>
            </tr>
          </thead>
          <tbody>
            {students.map((student) => (
              <tr
                key={student.id}
                className="border-b border-[#eef2f6] transition-colors last:border-b-0 hover:bg-[#f9fbfd]"
              >
                <td className="px-4 py-3.5">
                  <p className="text-[15px] font-semibold leading-5 text-[#000a1e]">
                    {student.fullName}
                  </p>
                  <p className="mt-1 text-[13.5px] leading-4 text-[#74777f]">
                    {batchLine(student)}
                  </p>
                </td>
                <td className="px-4 py-3.5">
                  <AttendanceMeter rate={student.attendanceRate} />
                </td>
                <td className="px-4 py-3.5">
                  <div>
                    <div className="flex items-center gap-2.5">
                      <span className="inline-flex items-baseline gap-0.5">
                        <span className="text-[18px] font-bold leading-5 tabular-nums text-[#1d3047]">
                          {student.weeklyAvgRating ?? '-'}
                        </span>
                        <span className="text-[12px] font-medium text-[#9aa6b5]">
                          /{RATING_MAX}
                        </span>
                      </span>
                      <WeeklyMeter
                        average={student.weeklyAvgRating}
                        points={student.weeklyTrajectory}
                      />
                    </div>
                    <TrendNote points={student.weeklyTrajectory} />
                  </div>
                </td>
                <td className="px-4 py-3.5 text-right">
                  <FinalMark rating={student.finalRating} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}
