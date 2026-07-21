import { describe, expect, it } from 'vitest'

import { visibleRoleKeysForWorkspace } from '@/lib/role-registry'
import type { RoleDefinition } from '@/types/domain'

const roleRegistry: RoleDefinition[] = [
  { key: 'admin', label: 'Admin', workspace: 'both' },
  { key: 'consultant', label: 'Consultant', workspace: 'academic' },
  { key: 'superadmin', label: 'Maintenance', workspace: 'both' },
  { key: 'nurse', label: 'Nurse', workspace: 'clinical' },
  { key: 'resident', label: 'Resident', workspace: 'academic' },
  { key: 'student_rep', label: 'Student representative', workspace: 'academic' },
]

describe('visibleRoleKeysForWorkspace', () => {
  it('keeps the workspace roles plus the ones marked as both', () => {
    expect([...visibleRoleKeysForWorkspace(roleRegistry, 'clinical')].sort()).toEqual([
      'admin',
      'nurse',
      'superadmin',
    ])
  })

  it('surfaces student reps in the academic workspace', () => {
    expect([...visibleRoleKeysForWorkspace(roleRegistry, 'academic')].sort()).toEqual([
      'admin',
      'consultant',
      'resident',
      'student_rep',
      'superadmin',
    ])
  })

  it('returns an empty set when the registry is missing so callers can show everyone', () => {
    expect(visibleRoleKeysForWorkspace([], 'academic').size).toBe(0)
  })
})
