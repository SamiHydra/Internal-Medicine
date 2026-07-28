import {
  addDays,
  addWeeks,
  differenceInDays,
  differenceInHours,
  differenceInMinutes,
  endOfWeek,
  format,
  isAfter,
  isThisYear,
  isYesterday,
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

/**
 * A short, scannable timestamp for activity feeds: recent entries read as an
 * age ("12m ago"), older ones collapse to a date. Pair it with the absolute
 * timestamp in a `title` so precision is never actually lost.
 */
export function formatRelativeTimestamp(dateString: string | null | undefined) {
  if (!dateString) {
    return '-'
  }

  const date = parseISO(dateString)
  const now = new Date()
  const minutes = differenceInMinutes(now, date)

  // Future timestamps (clock skew, or a data oddity) fall through to a date
  // rather than rendering a negative age.
  if (minutes >= 0) {
    if (minutes < 1) return 'Just now'
    if (minutes < 60) return `${minutes}m ago`

    const hours = differenceInHours(now, date)
    if (hours < 24) return `${hours}h ago`
    if (isYesterday(date)) return 'Yesterday'

    const days = differenceInDays(now, date)
    if (days < 7) return `${days}d ago`
  }

  return isThisYear(date) ? format(date, 'MMM d') : format(date, 'MMM d, yyyy')
}

/**
 * Render a value that came out of an audit payload. ISO dates arrive as raw
 * strings ("2320-02-12"), which read as machine output in a list a human is
 * scanning.
 */
/**
 * Turns a stored key into something readable: `new_pressure_ulcer` and
 * `weeklyDeadlineDay` both become sentence case. Audit rows are read by
 * administrators, not developers, so raw keys never reach the screen.
 */
export function humanizeAuditKey(key: string): string {
  const spaced = key
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .trim()

  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase()
}

export function formatAuditFieldValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '-'
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'

  if (typeof value === 'string') {
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return format(parseISO(value), 'MMM d, yyyy')
    }

    if (/^\d{4}-\d{2}-\d{2}T/.test(value)) {
      return format(parseISO(value), 'MMM d, yyyy HH:mm')
    }

    return value
  }

  // Lists read as prose rather than as a JSON array. Identifier-looking
  // strings ("new_pressure_ulcer") are humanized; anything else is left alone.
  if (Array.isArray(value)) {
    if (value.length === 0) return 'None'

    return value
      .map((item) =>
        typeof item === 'string' && /^[a-z][a-z0-9_]*$/.test(item)
          ? humanizeAuditKey(item)
          : formatAuditFieldValue(item),
      )
      .join(', ')
  }

  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
    if (entries.length === 0) return 'None'

    return entries
      .map(([key, nested]) => `${humanizeAuditKey(key)}: ${formatAuditFieldValue(nested)}`)
      .join(' · ')
  }

  return String(value)
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
