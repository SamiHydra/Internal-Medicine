import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  BedDouble,
  Check,
  Loader2,
  MessagesSquare,
  Presentation,
  Stethoscope,
  type LucideIcon,
} from 'lucide-react'
import { toast } from 'sonner'

import {
  ACTIVITY_LABELS,
  createTeachingSchedule,
  fetchTeachingSchedules,
  scopeForActivity,
  setTeachingScheduleActive,
  type TeachingActivityType,
  type TeachingScheduleRecord,
} from '@/lib/api/teaching'
import { getApiBrowserClient } from '@/lib/api/client'
import { getErrorMessage } from '@/lib/api/helpers'
import { cn } from '@/lib/utils'

const COHORTS: Array<'C1' | 'C2'> = ['C1', 'C2']

const ACTIVITIES: TeachingActivityType[] = [
  'lecture',
  'seminar',
  'bedside',
  'teaching_round',
]

const WEEKDAYS: Array<{ value: number; short: string; label: string }> = [
  { value: 1, short: 'Mon', label: 'Monday' },
  { value: 2, short: 'Tue', label: 'Tuesday' },
  { value: 3, short: 'Wed', label: 'Wednesday' },
  { value: 4, short: 'Thu', label: 'Thursday' },
  { value: 5, short: 'Fri', label: 'Friday' },
  { value: 6, short: 'Sat', label: 'Saturday' },
  { value: 7, short: 'Sun', label: 'Sunday' },
]

const SCOPE_LABEL = { cohort: 'Whole cohort', subgroup: 'Per subgroup' } as const

/** Each activity gets a mark of its own so the rows are scannable, not read. */
const ACTIVITY_ICONS: Record<TeachingActivityType, LucideIcon> = {
  lecture: Presentation,
  seminar: MessagesSquare,
  bedside: BedDouble,
  teaching_round: Stethoscope,
}

/** Weekends carry no teaching by default, so they read as dimmer columns. */
const isWeekend = (weekday: number) => weekday >= 6

function cellKey(activity: TeachingActivityType, weekday: number) {
  return `${activity}:${weekday}`
}

/**
 * Admin editor for the weekly teaching-activity schedule (V2 Phase 5), laid out
 * as the grid the data actually is: one row per activity, one column per
 * weekday, since the API allows exactly one entry per cohort + activity +
 * weekday. Scope is fixed by the activity (lectures/seminars cohort-wide,
 * bedside/rounds per subgroup), so it is stated once per row, not repeated on
 * every entry.
 *
 * A cell is on or off. Turning one on creates the entry (or re-activates a
 * paused one); turning it off pauses it, which is what "not scheduled" means to
 * the generator. The row is kept rather than deleted so the toggle is
 * reversible without a round trip through the add form.
 */
export function TeachingSchedulePanel() {
  const client = getApiBrowserClient()
  const [schedules, setSchedules] = useState<TeachingScheduleRecord[] | null>(null)
  const [cohort, setCohort] = useState<'C1' | 'C2'>('C1')
  const [busy, setBusy] = useState<string | null>(null)

  useEffect(() => {
    if (!client) {
      return
    }
    let active = true
    fetchTeachingSchedules(client)
      .then((data) => {
        if (active) {
          setSchedules(data)
        }
      })
      .catch((error) => {
        if (active) {
          setSchedules([])
          toast.error(getErrorMessage(error, 'Unable to load the teaching schedule.'))
        }
      })
    return () => {
      active = false
    }
  }, [client])

  const run = useCallback(
    async (key: string, action: () => Promise<void>, fallback: string) => {
      setBusy(key)
      try {
        await action()
      } catch (error) {
        toast.error(getErrorMessage(error, fallback))
      } finally {
        setBusy(null)
      }
    },
    [],
  )

  /** Every entry for the visible cohort, addressable by activity + weekday. */
  const byCell = useMemo(() => {
    const map = new Map<string, TeachingScheduleRecord>()
    for (const schedule of schedules ?? []) {
      if (schedule.cohort === cohort) {
        map.set(cellKey(schedule.activityType, schedule.weekday), schedule)
      }
    }
    return map
  }, [schedules, cohort])

  const scheduledCount = useMemo(
    () =>
      ACTIVITIES.reduce(
        (total, activity) =>
          total +
          WEEKDAYS.filter((day) => byCell.get(cellKey(activity, day.value))?.active)
            .length,
        0,
      ),
    [byCell],
  )

  const activeDays = useMemo(
    () =>
      WEEKDAYS.filter((day) =>
        ACTIVITIES.some((activity) => byCell.get(cellKey(activity, day.value))?.active),
      ).length,
    [byCell],
  )

  if (!client) {
    return null
  }

  function toggle(activity: TeachingActivityType, weekday: number) {
    const key = cellKey(activity, weekday)
    const existing = byCell.get(key)
    const dayName = WEEKDAYS.find((day) => day.value === weekday)?.label ?? ''

    void run(
      key,
      async () => {
        if (existing) {
          const updated = await setTeachingScheduleActive(
            client!,
            existing.id,
            !existing.active,
          )
          // The endpoint answers with { id, active } only, so merge the flag;
          // replacing the record would drop cohort/weekday and make the entry
          // invisible to this grid, which then tries to create a duplicate.
          setSchedules((prev) =>
            (prev ?? []).map((item) =>
              item.id === updated.id ? { ...item, active: updated.active } : item,
            ),
          )
          return
        }

        const created = await createTeachingSchedule(client!, {
          cohort,
          activityType: activity,
          weekday,
          scope: scopeForActivity(activity),
        })
        setSchedules((prev) => [...(prev ?? []), created])
        toast.success(`${ACTIVITY_LABELS[activity]} added to ${dayName}.`)
      },
      'Unable to update the schedule.',
    )
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div
          role="group"
          aria-label="Cohort"
          className="flex gap-1 rounded-[0.35rem] bg-[#eef1f5] p-1"
        >
          {COHORTS.map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={cohort === value}
              onClick={() => setCohort(value)}
              className={cn(
                'rounded-[0.25rem] px-4 py-1.5 text-[13.5px] tracking-[-0.01em] transition-colors duration-150',
                'outline-none focus-visible:ring-2 focus-visible:ring-[#005db6]/45',
                cohort === value
                  ? 'bg-[#04162f] font-bold text-white'
                  : 'font-semibold text-[#5b6169] hover:text-[#000a1e]',
              )}
            >
              {value}
            </button>
          ))}
        </div>

        <p className="text-[13px] text-[#5b6169]">
          {schedules === null ? (
            'Loading schedule'
          ) : scheduledCount === 0 ? (
            <>Nothing scheduled for {cohort} yet. Tap a cell to add an activity.</>
          ) : (
            <>
              <span className="font-semibold tabular-nums text-[#000a1e]">
                {scheduledCount}
              </span>{' '}
              {scheduledCount === 1 ? 'activity' : 'activities'} each week across{' '}
              <span className="font-semibold tabular-nums text-[#000a1e]">
                {activeDays}
              </span>{' '}
              {activeDays === 1 ? 'day' : 'days'}
            </>
          )}
        </p>
      </div>

      <div className="overflow-x-auto rounded-[0.4rem] border border-[#e1e7ee] bg-white">
        <table className="w-full min-w-[620px] border-collapse">
          <caption className="sr-only">
            Weekly teaching activities for cohort {cohort}. Each cell turns an
            activity on or off for that weekday.
          </caption>
          <thead>
            <tr>
              <th
                scope="col"
                className="sticky left-0 z-10 bg-white px-4 py-3 text-left text-[11px] font-bold uppercase tracking-[0.14em] text-[#68727f]"
              >
                Activity
              </th>
              {WEEKDAYS.map((day) => (
                <th
                  key={day.value}
                  scope="col"
                  className={cn(
                    'px-2 py-3 text-center text-[11px] font-bold uppercase tracking-[0.12em]',
                    isWeekend(day.value) ? 'text-[#b3bcc8]' : 'text-[#68727f]',
                  )}
                >
                  <span aria-hidden>{day.short}</span>
                  <span className="sr-only">{day.label}</span>
                </th>
              ))}
              <th
                scope="col"
                className="px-4 py-3 text-right text-[11px] font-bold uppercase tracking-[0.14em] text-[#68727f]"
              >
                Days
              </th>
            </tr>
          </thead>
          <tbody>
            {ACTIVITIES.map((activity) => {
              const scope = scopeForActivity(activity)
              const Icon = ACTIVITY_ICONS[activity]
              const perRow = WEEKDAYS.filter(
                (day) => byCell.get(cellKey(activity, day.value))?.active,
              ).length

              return (
                <tr key={activity} className="border-t border-[#eef2f6]">
                  <th
                    scope="row"
                    className="sticky left-0 z-10 bg-white px-4 py-3 text-left align-middle"
                  >
                    <span className="flex items-center gap-3">
                      <span
                        aria-hidden
                        className={cn(
                          'flex h-9 w-9 shrink-0 items-center justify-center rounded-[0.35rem]',
                          scope === 'subgroup'
                            ? 'bg-[#fdf3dd] text-[#8a6100]'
                            : 'bg-[#e8f0fb] text-[#005db6]',
                        )}
                      >
                        <Icon className="h-[18px] w-[18px]" strokeWidth={2} />
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-[14px] font-semibold tracking-[-0.01em] text-[#000a1e]">
                          {ACTIVITY_LABELS[activity]}
                        </span>
                        <span className="mt-1 block text-[10.5px] font-bold uppercase tracking-[0.11em] text-[#6a717b]">
                          {SCOPE_LABEL[scope]}
                        </span>
                      </span>
                    </span>
                  </th>

                  {WEEKDAYS.map((day) => {
                    const key = cellKey(activity, day.value)
                    const entry = byCell.get(key)
                    const on = Boolean(entry?.active)
                    const pending = busy === key
                    const weekend = isWeekend(day.value)

                    return (
                      <td key={day.value} className="px-1.5 py-2 text-center">
                        <button
                          type="button"
                          role="switch"
                          aria-checked={on}
                          aria-label={`${ACTIVITY_LABELS[activity]} on ${day.label}`}
                          disabled={pending || schedules === null}
                          onClick={() => toggle(activity, day.value)}
                          className={cn(
                            'inline-flex h-11 w-full min-w-[44px] items-center justify-center rounded-[0.3rem] border transition-colors duration-150',
                            'outline-none focus-visible:ring-2 focus-visible:ring-[#005db6]/50 focus-visible:ring-offset-2 focus-visible:ring-offset-white',
                            'disabled:cursor-not-allowed disabled:opacity-60',
                            on
                              ? 'border-[#04162f] bg-[#04162f] text-white hover:enabled:bg-[#0b2851]'
                              : weekend
                                ? 'border-[#eef2f6] bg-[#fbfcfd] hover:enabled:border-[#d4dde8] hover:enabled:bg-[#f2f5f8]'
                                : 'border-[#e6ebf1] bg-[#f6f8fa] hover:enabled:border-[#c9d5e3] hover:enabled:bg-[#eaeff5]',
                          )}
                        >
                          {pending ? (
                            <Loader2
                              className={cn(
                                'h-4 w-4 animate-spin',
                                on ? 'text-white' : 'text-[#68727f]',
                              )}
                            />
                          ) : on ? (
                            <Check className="h-4 w-4" strokeWidth={3} />
                          ) : null}
                        </button>
                      </td>
                    )
                  })}

                  <td className="px-4 py-2 text-right">
                    <span
                      className={cn(
                        'text-[14px] font-bold tabular-nums',
                        perRow === 0 ? 'text-[#c2cad4]' : 'text-[#000a1e]',
                      )}
                    >
                      {perRow}
                    </span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <p className="text-[12.5px] leading-5 text-[#68727f]">
        Filled cells generate sessions automatically each night. Scope is set by
        the activity: lectures and seminars run for the whole cohort, bedside
        teaching and teaching rounds run separately for subgroup A and B.
      </p>
    </div>
  )
}
