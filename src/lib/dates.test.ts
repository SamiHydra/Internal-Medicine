import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  formatAuditFieldValue,
  formatRelativeTimestamp,
  humanizeAuditKey,
} from '@/lib/dates'

describe('formatRelativeTimestamp', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-20T14:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('reads as an age for recent entries', () => {
    expect(formatRelativeTimestamp('2026-07-20T13:59:40Z')).toBe('Just now')
    expect(formatRelativeTimestamp('2026-07-20T13:45:00Z')).toBe('15m ago')
    expect(formatRelativeTimestamp('2026-07-20T12:00:00Z')).toBe('2h ago')
  })

  it('collapses to a date once an entry is more than a week old', () => {
    expect(formatRelativeTimestamp('2026-07-01T09:00:00Z')).toBe('Jul 1')
  })

  it('keeps the year when the entry is from a different one', () => {
    expect(formatRelativeTimestamp('2025-11-03T09:00:00Z')).toBe('Nov 3, 2025')
  })

  it('does not render a negative age for a future timestamp', () => {
    // Clock skew, or a bad date in the payload - either way "-3h ago" is worse
    // than showing the date.
    const result = formatRelativeTimestamp('2026-07-20T17:00:00Z')

    expect(result).not.toContain('-')
    expect(result).toBe('Jul 20')
  })

  it('returns a dash for a missing timestamp', () => {
    expect(formatRelativeTimestamp(null)).toBe('-')
    expect(formatRelativeTimestamp(undefined)).toBe('-')
  })
})

describe('formatAuditFieldValue', () => {
  it('renders an ISO date as something a person reads', () => {
    expect(formatAuditFieldValue('2320-02-12')).toBe('Feb 12, 2320')
    expect(formatAuditFieldValue('2026-07-20T14:35:00Z')).toMatch(/^Jul 20, 2026/)
  })

  it('leaves non-date strings alone', () => {
    expect(formatAuditFieldValue('monday')).toBe('monday')
    expect(formatAuditFieldValue('10:00')).toBe('10:00')
  })

  it('spells out booleans and empty values', () => {
    expect(formatAuditFieldValue(true)).toBe('Yes')
    expect(formatAuditFieldValue(false)).toBe('No')
    expect(formatAuditFieldValue(null)).toBe('-')
    expect(formatAuditFieldValue('')).toBe('-')
  })

  it('renders objects as readable label/value pairs, not JSON', () => {
    expect(formatAuditFieldValue({ weeklyDeadlineDay: 'monday' })).toBe(
      'Weekly deadline day: monday',
    )
    expect(formatAuditFieldValue({})).toBe('None')
  })

  it('renders lists as prose and humanizes identifier-like entries', () => {
    expect(formatAuditFieldValue(['new_deaths', 'hai_clabsi'])).toBe(
      'New deaths, Hai clabsi',
    )
    expect(formatAuditFieldValue([1, 3, 5])).toBe('1, 3, 5')
    expect(formatAuditFieldValue([])).toBe('None')
  })
})

describe('humanizeAuditKey', () => {
  it('reads snake_case and camelCase as a sentence', () => {
    expect(humanizeAuditKey('new_pressure_ulcer')).toBe('New pressure ulcer')
    expect(humanizeAuditKey('weeklyDeadlineDay')).toBe('Weekly deadline day')
    expect(humanizeAuditKey('autoLockHoursAfterDeadline')).toBe(
      'Auto lock hours after deadline',
    )
  })
})
