import { useEffect, useState } from 'react'
import { GraduationCap, Loader2, Sunrise } from 'lucide-react'
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
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import {
  SectionEmptyState,
  SectionHeader,
  panelClass,
} from '@/components/dashboard/section-panel'
import {
  fetchMorningAnalytics,
  fetchStudentAnalytics,
  fetchTeachingAnalytics,
  type MorningAnalytics,
  type StudentAnalytics,
  type TeachingAnalytics,
} from '@/lib/api/academic-operations'
import { ACTIVITY_LABELS, type TeachingActivityType } from '@/lib/api/teaching'
import { getApiBrowserClient } from '@/lib/api/client'
import {
  chartGridStroke,
  chartTick,
  lightTooltipItemStyle,
  lightTooltipLabelStyle,
  lightTooltipStyle,
} from '@/lib/chart-theme'

function StatBlock({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="min-w-0">
      <p className="truncate text-[11px] font-semibold uppercase tracking-[0.18em] text-[#74777f]">
        {label}
      </p>
      <p className="mt-1 font-display text-[1.7rem] font-bold leading-none tabular-nums text-[#000a1e]">
        {value}
      </p>
      {note ? <p className="mt-1 truncate text-xs text-[#9aa7b8]">{note}</p> : null}
    </div>
  )
}

/** Loading shell shared by the three tabs. */
function TabLoading() {
  return (
    <div className="flex min-h-[220px] items-center justify-center text-[#74777f]">
      <Loader2 className="h-5 w-5 animate-spin" aria-label="Loading analytics" />
    </div>
  )
}

// ---- Morning punctuality ----

export function MorningAnalyticsTab() {
  const client = getApiBrowserClient()
  const [data, setData] = useState<MorningAnalytics | null>(null)

  useEffect(() => {
    if (!client) {
      return
    }
    fetchMorningAnalytics(client)
      .then(setData)
      .catch(() => toast.error('Unable to load the morning analytics.'))
  }, [client])

  if (!data) {
    return <TabLoading />
  }

  const trend = data.trend
    .filter((point) => point.status === 'recorded')
    .map((point) => ({ date: point.date.slice(5), delay: point.delayMinutes ?? 0 }))

  return (
    <section className={panelClass}>
      <SectionHeader
        eyebrow="Morning punctuality"
        description="Recorded sessions measured against the scheduled start. Not-recorded sessions are shown, never hidden."
      />

      <div className="mt-5 grid grid-cols-2 gap-x-8 gap-y-5 lg:grid-cols-4">
        <StatBlock label="Recorded" value={String(data.recordedCount)} note={`${data.cancelledCount} cancelled`} />
        <StatBlock label="Not recorded" value={String(data.notRecordedCount)} note="Pending past sessions" />
        <StatBlock label="On time" value={`${Math.round(data.onTimeRate)}%`} note="Of recorded sessions" />
        <StatBlock label="Average delay" value={`${data.avgDelayMinutes} min`} note="Across recorded sessions" />
      </div>

      {trend.length >= 2 ? (
        <div className="mt-6 h-[220px]">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={trend} margin={{ top: 8, right: 12, bottom: 0, left: -18 }}>
              <CartesianGrid stroke={chartGridStroke} vertical={false} />
              <XAxis dataKey="date" tick={chartTick} tickLine={false} axisLine={false} />
              <YAxis tick={chartTick} tickLine={false} axisLine={false} />
              <Tooltip
                contentStyle={lightTooltipStyle}
                labelStyle={lightTooltipLabelStyle}
                itemStyle={lightTooltipItemStyle}
                formatter={(value) => [`${value ?? 0} min late`, 'Delay']}
              />
              <Line type="monotone" dataKey="delay" stroke="#005db6" strokeWidth={2} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      ) : null}

      <div className="mt-6">
        <p className="mb-2.5 text-xs font-semibold uppercase tracking-[0.14em] text-[#74777f]">
          Attendance by person
        </p>
        {data.people.length === 0 ? (
          <SectionEmptyState
            icon={<Sunrise className="h-6 w-6" />}
            title="No attendance recorded yet"
            description="Per-person rates appear after the first recorded session."
          />
        ) : (
          <div>
            {data.people.map((person) => (
              <div
                key={person.userId}
                className="flex items-center justify-between gap-3 border-b border-[#eef2f6] py-2 last:border-b-0"
              >
                <span className="truncate text-sm text-[#000a1e]">{person.fullName}</span>
                <span className="shrink-0 text-sm font-semibold tabular-nums text-[#005db6]">
                  {Math.round(person.attendanceRate)}%
                  <span className="ml-1.5 font-normal text-[#9aa7b8]">
                    {person.presentCount}/{person.expectedCount}
                  </span>
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}

/**
 * One person's morning-attendance history for the admin person detail page
 * (guide Phase 7): the recent session-by-session record plus their rate.
 */
export function PersonMorningHistory({ userId }: { userId: string }) {
  const client = getApiBrowserClient()
  const [data, setData] = useState<MorningAnalytics | null>(null)

  useEffect(() => {
    if (!client || !userId) {
      return
    }
    fetchMorningAnalytics(client, userId)
      .then(setData)
      .catch(() => {
        // Attendance history is supplementary on this page; fail quiet.
      })
  }, [client, userId])

  const history = data?.history ?? []
  const personRow = data?.people.find((person) => person.userId === userId)

  if (!data || history.length === 0) {
    return null
  }

  return (
    <section className={panelClass}>
      <SectionHeader
        eyebrow="Morning attendance"
        description={
          personRow
            ? `${Math.round(personRow.attendanceRate)}% attendance across ${personRow.expectedCount} recorded sessions.`
            : undefined
        }
      />
      <div className="mt-4 flex flex-wrap gap-1.5">
        {history.map((entry) => (
          <Badge key={entry.date} variant={entry.present ? 'success' : 'danger'}>
            {entry.date?.slice(5)} {entry.present ? '✓' : '✕'}
          </Badge>
        ))}
      </div>
    </section>
  )
}

// ---- Teaching occurrence ----

export function TeachingAnalyticsTab() {
  const client = getApiBrowserClient()
  const [data, setData] = useState<TeachingAnalytics | null>(null)

  useEffect(() => {
    if (!client) {
      return
    }
    fetchTeachingAnalytics(client)
      .then(setData)
      .catch(() => toast.error('Unable to load the teaching analytics.'))
  }, [client])

  if (!data) {
    return <TabLoading />
  }

  const chart = data.byActivity.map((row) => ({
    activity: ACTIVITY_LABELS[row.activityType as TeachingActivityType] ?? row.activityType,
    held: row.held,
    notHeld: row.notHeld,
  }))

  return (
    <section className={panelClass}>
      <SectionHeader
        eyebrow="Teaching activities"
        description="Held versus not held per activity and batch, the reasons things did not happen, and the backlog nobody recorded."
      />

      {data.byActivity.length === 0 ? (
        <div className="mt-5">
          <SectionEmptyState
            icon={<GraduationCap className="h-6 w-6" />}
            title="No teaching sessions yet"
            description="Occurrence rates appear once a batch is active and sessions generate."
          />
        </div>
      ) : (
        <>
          <div className="mt-5 grid grid-cols-2 gap-x-8 gap-y-5 lg:grid-cols-4">
            {data.byActivity.map((row) => (
              <StatBlock
                key={row.activityType}
                label={ACTIVITY_LABELS[row.activityType as TeachingActivityType] ?? row.activityType}
                value={row.heldRate !== null ? `${Math.round(row.heldRate)}%` : '-'}
                note={`${row.held} held · ${row.notHeld} not held`}
              />
            ))}
          </div>

          <div className="mt-6 h-[220px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chart} margin={{ top: 8, right: 12, bottom: 0, left: -18 }}>
                <CartesianGrid stroke={chartGridStroke} vertical={false} />
                <XAxis dataKey="activity" tick={chartTick} tickLine={false} axisLine={false} />
                <YAxis tick={chartTick} tickLine={false} axisLine={false} allowDecimals={false} />
                <Tooltip
                  contentStyle={lightTooltipStyle}
                  labelStyle={lightTooltipLabelStyle}
                  itemStyle={lightTooltipItemStyle}
                />
                <Bar dataKey="held" name="Held" fill="#005db6" radius={[3, 3, 0, 0]} />
                <Bar dataKey="notHeld" name="Not held" fill="#ba1a1a" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="mt-6 grid gap-6 lg:grid-cols-2">
            <div>
              <p className="mb-2.5 text-xs font-semibold uppercase tracking-[0.14em] text-[#74777f]">
                Why sessions were not held
              </p>
              {data.reasons.length === 0 ? (
                <p className="text-sm text-[#74777f]">No not-held sessions recorded.</p>
              ) : (
                data.reasons.map((reason) => (
                  <div
                    key={reason.reason}
                    className="flex items-center justify-between gap-3 border-b border-[#eef2f6] py-2 last:border-b-0"
                  >
                    <span className="truncate text-sm text-[#000a1e]">{reason.reason}</span>
                    <span className="shrink-0 text-sm font-semibold tabular-nums text-[#ba1a1a]">
                      {reason.count}
                    </span>
                  </div>
                ))
              )}
            </div>
            <div>
              <p className="mb-2.5 text-xs font-semibold uppercase tracking-[0.14em] text-[#74777f]">
                By batch
              </p>
              {data.byBatch.map((row) => (
                <div
                  key={row.batchLabel}
                  className="flex items-center justify-between gap-3 border-b border-[#eef2f6] py-2 last:border-b-0"
                >
                  <span className="truncate text-sm text-[#000a1e]">{row.batchLabel}</span>
                  <span className="shrink-0 text-sm tabular-nums text-[#44474e]">
                    {row.heldRate !== null ? `${Math.round(row.heldRate)}% held` : '-'}
                    {row.pending > 0 ? ` · ${row.pending} pending` : ''}
                  </span>
                </div>
              ))}
              {data.pendingBacklog > 0 ? (
                <p className="mt-3 text-sm font-medium text-[#8a5a00]">
                  {data.pendingBacklog} past session{data.pendingBacklog === 1 ? '' : 's'} never recorded
                  - chase the reps.
                </p>
              ) : null}
            </div>
          </div>
        </>
      )}
    </section>
  )
}

// ---- Student progress ----

export function StudentsAnalyticsTab() {
  const client = getApiBrowserClient()
  const [data, setData] = useState<StudentAnalytics | null>(null)

  useEffect(() => {
    if (!client) {
      return
    }
    fetchStudentAnalytics(client)
      .then(setData)
      .catch(() => toast.error('Unable to load the student analytics.'))
  }, [client])

  if (!data) {
    return <TabLoading />
  }

  return (
    <section className={panelClass}>
      <SectionHeader
        eyebrow="Student progress"
        description="Attendance rate, the weekly evaluation trajectory, and the final result per student, with a per-batch rollup."
      />

      {data.students.length === 0 ? (
        <div className="mt-5">
          <SectionEmptyState
            icon={<GraduationCap className="h-6 w-6" />}
            title="No students yet"
            description="Progress appears once a batch has students, attendance, and evaluations."
          />
        </div>
      ) : (
        <>
          <div className="mt-5 grid grid-cols-2 gap-x-8 gap-y-5 lg:grid-cols-4">
            {data.batches.map((batch) => (
              <StatBlock
                key={batch.batchLabel ?? '-'}
                label={batch.batchLabel ?? '-'}
                value={batch.avgAttendanceRate !== null ? `${Math.round(batch.avgAttendanceRate)}%` : '-'}
                note={`${batch.studentCount} students · ${batch.finalsRecorded} finals in`}
              />
            ))}
          </div>

          <div className="mt-6 max-h-[52vh] overflow-auto rounded-[0.4rem] border border-[#e6ecf3]">
            <table className="w-full border-collapse text-sm">
              <thead className="sticky top-0 z-10 bg-[#f8fafc]">
                <tr className="border-b border-[#e6ecf3] text-left text-[11px] font-semibold uppercase tracking-[0.14em] text-[#74777f]">
                  <th className="px-4 py-3">Student</th>
                  <th className="px-4 py-3">Batch</th>
                  <th className="px-4 py-3 text-right">Attendance</th>
                  <th className="px-4 py-3 text-right">Weekly avg</th>
                  <th className="px-4 py-3">Trajectory</th>
                  <th className="px-4 py-3 text-right">Final</th>
                </tr>
              </thead>
              <tbody>
                {data.students.map((student) => (
                  <tr key={student.id} className="border-b border-[#eef2f6] last:border-b-0">
                    <td className="px-4 py-2.5 font-medium text-[#000a1e]">{student.fullName}</td>
                    <td className="px-4 py-2.5 text-[#74777f]">
                      {student.batchLabel}
                      {student.subgroup ? ` · ${student.subgroup}` : ''}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">
                      {student.attendanceRate !== null ? `${Math.round(student.attendanceRate)}%` : '-'}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">
                      {student.weeklyAvgRating ?? '-'}
                      {student.weeklyEvaluationCount ? (
                        <span className="ml-1 text-xs text-[#9aa7b8]">({student.weeklyEvaluationCount})</span>
                      ) : null}
                    </td>
                    <td className="px-4 py-2.5">
                      <span className="flex gap-1">
                        {student.weeklyTrajectory.map((point, index) => (
                          <Badge key={index} variant="neutral">
                            {point.rating ?? '-'}
                          </Badge>
                        ))}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right font-semibold tabular-nums text-[#005db6]">
                      {student.finalRating ?? '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  )
}
