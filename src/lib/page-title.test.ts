import { describe, expect, it } from 'vitest'

import { resolvePageTitle } from './page-title'

const adminNav = [
  { label: 'Dashboard', href: '/admin' },
  { label: 'Submissions', href: '/admin/submissions' },
  { label: 'Users & Access', href: '/admin/users' },
  { label: 'Settings', href: '/admin/settings' },
]

const academicNav = [
  { label: 'Dashboard', href: '/admin/academic' },
  { label: 'Submissions', href: '/admin/academic/submissions' },
  { label: 'Students', href: '/admin/academic/students' },
]

describe('resolvePageTitle', () => {
  it('uses the most specific navigation entry', () => {
    expect(resolvePageTitle('/admin', adminNav)).toBe('Dashboard')
    expect(resolvePageTitle('/admin/submissions', adminNav)).toBe('Submissions')
    expect(resolvePageTitle('/admin/users', adminNav)).toBe('Users & Access')
    expect(resolvePageTitle('/admin/academic/students', academicNav)).toBe('Students')
  })

  it('titles the routes that have no navigation entry instead of falling back to Dashboard', () => {
    expect(resolvePageTitle('/admin/manual-admin-setup', adminNav)).toBe('Admin account setup')
    expect(resolvePageTitle('/admin/departments/abc-123', adminNav)).toBe('Department')
    expect(resolvePageTitle('/admin/academic/people/user-1', academicNav)).toBe('Profile')
    expect(resolvePageTitle('/admin/notifications', adminNav)).toBe('Notifications')
    expect(resolvePageTitle('/notifications', [])).toBe('Notifications')
  })

  it('titles the nurse report editor', () => {
    expect(resolvePageTitle('/reports', [])).toBe('Weekly report')
    expect(resolvePageTitle('/reports/assignment-1/period-1', [])).toBe('Weekly report')
  })

  it('falls back to Workspace for unknown routes', () => {
    expect(resolvePageTitle('/somewhere-else', adminNav)).toBe('Workspace')
    expect(resolvePageTitle('/somewhere-else', adminNav, 'Portal')).toBe('Portal')
  })
})
