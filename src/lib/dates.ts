import {
  addDays,
  addWeeks,
  endOfWeek,
  format,
  isAfter,
  parseISO,
  set,
  startOfWeek,
} from 'date-fns'

import type { ReportingPeriod, Weekday } from '@/types/domain'

const weekdayIndex: Record<Weekday, number> = {
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
  sunday: 0,
}

export function getWeekStart(date = new Date()) {
  return startOfWeek(date, { weekStartsOn: 1 })
}

export function createWeeklyPeriods(count: number, anchor = new Date()) {
  const currentWeekStart = getWeekStart(anchor)

  return Array.from({ length: count }, (_, index) => {
    const weekStart = addWeeks(currentWeekStart, index - (count - 1))
    const weekEnd = addDays(weekStart, 6)

    return {
      id: format(weekStart, "yyyy-'W'II"),
      weekStart: weekStart.toISOString(),
      weekEnd: weekEnd.toISOString(),
      label: `${format(weekStart, 'MMM d')} - ${format(weekEnd, 'MMM d, yyyy')}`,
    } satisfies ReportingPeriod
  })
}

export function formatWeekLabel(period: ReportingPeriod) {
  return period.label
}

export function getDeadlineForPeriod(
  period: ReportingPeriod,
  weekday: Weekday,
  time: string,
) {
  if (period.deadlineAt) {
    return parseISO(period.deadlineAt)
  }

  const weekStart = parseISO(period.weekStart)
  const [hours, minutes] = time.split(':').map(Number)
  const deadlineDay = addDays(weekStart, (weekdayIndex[weekday] + 6) % 7)

  return set(deadlineDay, {
    hours,
    minutes,
    seconds: 0,
    milliseconds: 0,
  })
}

export function isPastDeadline(
  period: ReportingPeriod,
  weekday: Weekday,
  time: string,
  currentDate = new Date(),
) {
  return isAfter(currentDate, getDeadlineForPeriod(period, weekday, time))
}

export function formatTimestamp(dateString: string | null | undefined) {
  if (!dateString) {
    return '-'
  }

  return format(parseISO(dateString), 'MMM d, yyyy HH:mm')
}

export function formatPeriodShortRange(period: ReportingPeriod) {
  return `${format(parseISO(period.weekStart), 'MMM d')} - ${format(parseISO(period.weekEnd), 'MMM d')}`
}

export function getPeriodMonth(period: ReportingPeriod) {
  return format(parseISO(period.weekStart), 'MMM yyyy')
}

export function getPeriodQuarter(period: ReportingPeriod) {
  return `Q${Math.floor(parseISO(period.weekStart).getMonth() / 3) + 1} ${parseISO(period.weekStart).getFullYear()}`
}

export function getWeekEnd(date = new Date()) {
  return endOfWeek(date, { weekStartsOn: 1 })
}
