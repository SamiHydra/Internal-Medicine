import { describe, expect, it } from 'vitest'

import { describeAuditEntry } from '@/lib/audit-narrative'
import type { AdminAuditEntry } from '@/lib/api/types'

function entry(overrides: Partial<AdminAuditEntry>): AdminAuditEntry {
  return {
    id: 'audit-1',
    userId: 'user-1',
    userName: 'Dr. Alem Woldemariam',
    action: 'create',
    actionLabel: 'Created',
    entityType: 'user',
    entityLabel: 'User account',
    workspace: 'system',
    entityId: 'user-2',
    oldValues: null,
    newValues: null,
    ipAddress: null,
    userAgent: null,
    createdAt: '2026-08-30T14:00:00Z',
    ...overrides,
  }
}

/** The sentence as a reader sees it, so assertions read like the screen does. */
function sentence(source: AdminAuditEntry): string {
  const narrative = describeAuditEntry(source)

  return [narrative.actor, narrative.verb, narrative.object, narrative.name]
    .filter(Boolean)
    .join(' ')
}

describe('describeAuditEntry', () => {
  it('reads a person action as a sentence, not a column dump', () => {
    expect(
      sentence(
        entry({
          newValues: { full_name: 'Tewodros Kassa', role_key: 'nurse', active: true },
        }),
      ),
    ).toBe('Dr. Alem Woldemariam created the user account for Tewodros Kassa')
  })

  it('drops the preposition for a thing rather than a person', () => {
    expect(
      sentence(
        entry({
          action: 'update',
          actionLabel: 'Updated',
          entityType: 'department',
          entityLabel: 'Department',
          newValues: { name: 'GI/Neurology', family: 'inpatient', bed_count: 26 },
        }),
      ),
    ).toBe('Dr. Alem Woldemariam updated the department GI/Neurology')
  })

  it('lets the stored value decide which way an availability change went', () => {
    const off = entry({
      action: 'set_active',
      actionLabel: 'Availability changed',
      newValues: { full_name: 'Dr. Saba Woldu', active: false },
    })
    const on = entry({
      action: 'set_active',
      actionLabel: 'Availability changed',
      newValues: { full_name: 'Dr. Saba Woldu', active: true },
    })

    expect(describeAuditEntry(off).verb).toBe('switched off')
    expect(describeAuditEntry(off).tone).toBe('remove')
    expect(describeAuditEntry(on).verb).toBe('switched on')
  })

  it('never contradicts its own verb with a stale column', () => {
    // Real rows record `active: true` alongside a deactivation, so the column
    // is suppressed rather than printed against the verb.
    const narrative = describeAuditEntry(
      entry({
        action: 'deactivate',
        actionLabel: 'Deactivated',
        newValues: { full_name: 'Dr. Saba Woldu', role_key: 'consultant', active: true },
      }),
    )

    expect(narrative.verb).toBe('switched off')
    expect(narrative.facts.map((fact) => fact.value)).toEqual(['Consultant'])
  })

  it('names a boolean instead of labelling it yes or no', () => {
    const narrative = describeAuditEntry(
      entry({ newValues: { full_name: 'Tewodros Kassa', active: true } }),
    )

    expect(narrative.facts).toEqual([{ label: null, value: 'Active' }])
  })

  it('keeps identifiers, long free text and secrets out of the chips', () => {
    const narrative = describeAuditEntry(
      entry({
        action: 'update',
        actionLabel: 'Updated',
        entityType: 'action_item',
        entityLabel: 'Clinical action item',
        newValues: {
          title: 'Critical values in Cardiac',
          department_id: '019fa28e-8645-70f3-a47e-43a53089d9ff',
          password: 'secret',
          description: 'Chest reported a long run of measures that will not fit on one line at all',
          severity: 'high',
        },
      }),
    )

    expect(narrative.name).toBe('Critical values in Cardiac')
    expect(narrative.facts).toEqual([{ label: 'Severity', value: 'High' }])
  })

  it('falls back to the server label for an action it does not know', () => {
    const narrative = describeAuditEntry(
      entry({ action: 'quarantine', actionLabel: 'Quarantined', newValues: null }),
    )

    expect(sentence({ ...entry({}), action: 'quarantine', actionLabel: 'Quarantined' })).toBe(
      'Dr. Alem Woldemariam quarantined the user account',
    )
    expect(narrative.tone).toBe('neutral')
  })

  it('says who acted even when the row has no name for them', () => {
    expect(describeAuditEntry(entry({ userName: null })).actor).toBe('Someone')
  })
})
