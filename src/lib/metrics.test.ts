import { describe, expect, it } from 'vitest'

import { calculateInpatientMetrics } from '@/lib/metrics'
import type { ReportRecord } from '@/types/domain'

const baseReport: ReportRecord = {
  id: 'report_test',
  assignmentId: 'assignment_test',
  departmentId: 'cardiac_inpatient',
  templateId: 'inpatient_weekly',
  reportingPeriodId: 'period_test',
  createdById: 'nurse_test',
  updatedById: 'nurse_test',
  createdAt: '2026-03-01T08:00:00.000Z',
  updatedAt: '2026-03-01T09:00:00.000Z',
  submittedAt: '2026-03-01T10:00:00.000Z',
  lockedAt: null,
  status: 'submitted',
  values: {
    total_patient_days: {
      fieldId: 'total_patient_days',
      dailyValues: {
        monday: 18,
        tuesday: 19,
        wednesday: 18,
        thursday: 20,
        friday: 19,
        saturday: 17,
        sunday: 19,
      },
    },
    discharged_home: {
      fieldId: 'discharged_home',
      dailyValues: {
        monday: 2,
        tuesday: 3,
        wednesday: 2,
        thursday: 3,
        friday: 2,
        saturday: 2,
        sunday: 3,
      },
    },
    discharged_ama: {
      fieldId: 'discharged_ama',
      dailyValues: {
        monday: 0,
        tuesday: 0,
        wednesday: 0,
        thursday: 1,
        friday: 0,
        saturday: 0,
        sunday: 0,
      },
    },
  },
  calculatedMetrics: {},
}

describe('calculateInpatientMetrics', () => {
  it('computes BOR, BTR, and ALOS from stored report values', () => {
    const metrics = calculateInpatientMetrics(baseReport, 20)

    expect(metrics.borPercent).toBeCloseTo(21.67, 1)
    expect(metrics.btr).toBeCloseTo(0.9, 2)
    expect(metrics.alos).toBeCloseTo(7.22, 2)
  })

  it('returns null-safe values when divide-by-zero would happen', () => {
    const metrics = calculateInpatientMetrics(
      {
        ...baseReport,
        values: {
          ...baseReport.values,
          discharged_home: {
            fieldId: 'discharged_home',
            dailyValues: {},
          },
          discharged_ama: {
            fieldId: 'discharged_ama',
            dailyValues: {},
          },
        },
      },
      0,
    )

    expect(metrics.borPercent).toBeNull()
    expect(metrics.btr).toBeNull()
    expect(metrics.alos).toBeNull()
  })
})
