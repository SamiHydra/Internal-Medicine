import { describe, expect, it } from 'vitest'

import { buildConflictRows, conflictRowsToText } from '@/lib/reports/conflict-rows'
import type { ReportTemplateConfig } from '@/types/domain'

const template = {
  id: 'inpatient_weekly',
  family: 'inpatient',
  name: 'Inpatient weekly',
  description: '',
  activeDays: ['monday', 'tuesday'],
  sections: [],
  fields: [
    { id: 'census', label: 'Census', sectionId: 's', kind: 'integer', aggregate: 'sum' },
    { id: 'round', label: 'Round start', sectionId: 's', kind: 'time', aggregate: 'latest' },
  ],
  summaryCards: [],
  charts: [],
} as unknown as ReportTemplateConfig

describe('buildConflictRows', () => {
  it('lists only the cells where the two copies disagree', () => {
    const rows = buildConflictRows(
      template,
      {
        census: { fieldId: 'census', dailyValues: { monday: 12, tuesday: 8 } },
        round: { fieldId: 'round', dailyValues: { monday: '08:30' } },
      },
      {
        census: { fieldId: 'census', dailyValues: { monday: 40, tuesday: 8 } },
        round: { fieldId: 'round', dailyValues: { monday: '08:30' } },
      },
    )

    expect(rows).toEqual([
      { key: 'census:monday', fieldLabel: 'Census', dayLabel: 'Mon', localValue: '12', serverValue: '40' },
    ])
  })

  it('treats an empty local cell against a filled server cell as a difference', () => {
    const rows = buildConflictRows(
      template,
      { census: { fieldId: 'census', dailyValues: { monday: null } } },
      { census: { fieldId: 'census', dailyValues: { monday: 3 } } },
    )

    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ localValue: '', serverValue: '3' })
  })

  it('lists every filled local cell when the server sent no copy', () => {
    const rows = buildConflictRows(
      template,
      {
        census: { fieldId: 'census', dailyValues: { monday: 12, tuesday: null } },
        round: { fieldId: 'round', dailyValues: { tuesday: '09:00' } },
      },
      null,
    )

    expect(rows.map((row) => row.key)).toEqual(['census:monday', 'round:tuesday'])
    expect(rows[0]?.serverValue).toBeNull()
  })

  it('renders a copyable text block a nurse can paste elsewhere', () => {
    const text = conflictRowsToText([
      { key: 'a', fieldLabel: 'Census', dayLabel: 'Mon', localValue: '12', serverValue: '40' },
      { key: 'b', fieldLabel: 'Round start', dayLabel: 'Tue', localValue: '', serverValue: null },
    ])

    expect(text).toBe('Census (Mon): mine 12 / server 40\nRound start (Tue): -')
  })
})
