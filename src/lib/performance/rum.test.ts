import { describe, expect, it } from 'vitest'

import {
  deviceClassForWidth,
  routeNameFromPath,
  rumSampleRate,
} from './rum'

describe('performance RUM metadata', () => {
  it('normalizes dynamic routes without retaining entity identifiers or query data', () => {
    expect(routeNameFromPath('/reports/report-123/period-456?patient=hidden')).toBe(
      '/reports/:assignmentId/:periodId',
    )
    expect(routeNameFromPath('/admin/departments/cardiac_inpatient')).toBe(
      '/admin/departments/:departmentId',
    )
    expect(routeNameFromPath('/admin/academic/people/user-123')).toBe(
      '/admin/academic/people/:userId',
    )
    expect(routeNameFromPath('/unsafe route/private')).toBe('/unknown')
  })

  it('uses bounded sampling and stable device classes', () => {
    expect(rumSampleRate(undefined, true)).toBe(0.1)
    expect(rumSampleRate(undefined, false)).toBe(0)
    expect(rumSampleRate('2', true)).toBe(1)
    expect(rumSampleRate('-1', true)).toBe(0)
    expect(rumSampleRate('invalid', true)).toBe(0)
    expect(deviceClassForWidth(390)).toBe('mobile')
    expect(deviceClassForWidth(820)).toBe('tablet')
    expect(deviceClassForWidth(1280)).toBe('desktop')
  })
})
