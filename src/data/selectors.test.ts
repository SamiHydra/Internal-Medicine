import { describe, expect, it } from 'vitest'

import { departments, templateMap } from '@/config/templates'
import { createEmptyAppState, defaultAppSettings } from '@/lib/app-state'
import {
  ALL_INPATIENT_AVERAGE,
  ALL_INPATIENT_POOLED,
  ALL_OUTPATIENT_AVERAGE,
  ALL_PROCEDURE_SERVICES_TOTAL,
  deriveReportStatus,
  getAssignmentCardsForPeriod,
  getDashboardSummary,
  getInpatientMonthlyOccupancySeries,
  getInpatientMonthlyWardComparisonData,
  getInpatientWeeklyCountTrendSeries,
  getLatestDashboardTrendBucketKey,
  getOutpatientMonthlyAvailabilityDepartmentComparisonData,
  getOutpatientMonthlyDepartmentComparisonData,
  getOutpatientWeeklyAvailabilitySeries,
  getOutpatientWeeklyTrendSeries,
  getProcedureDialysisSplitData,
  getProcedureEndoscopyMixData,
  getProcedureMonthlyServiceComparisonData,
  getProcedureTotalThroughput,
  getProcedureWeeklyTrendSeries,
  getReportingPeriodsForRange,
  getReportingRangeSummary,
  PROCEDURE_SERVICE_DEFINITIONS,
  shouldShowInpatientOccupancyAnalytics,
  type DashboardTrendBucketInput,
} from '@/data/selectors'
import type {
  AppState,
  ReportAssignment,
  ReportRecord,
  ReportingPeriod,
} from '@/types/domain'

function createPeriod(period: ReportingPeriod) {
  return period
}

function createAssignment(assignment: ReportAssignment) {
  return assignment
}

function createReport(report: ReportRecord) {
  return report
}

function createBucket(
  key: string,
  label: string,
  periods: ReportingPeriod[],
): DashboardTrendBucketInput {
  return {
    key,
    label,
    periods,
    periodIds: new Set(periods.map((period) => period.id)),
  }
}

function createState(overrides: Partial<AppState>): AppState {
  return {
    ...createEmptyAppState(),
    settings: defaultAppSettings,
    ...overrides,
  }
}

function valuesFor(totals: Record<string, number | string>): ReportRecord['values'] {
  return Object.fromEntries(
    Object.entries(totals).map(([fieldId, value]) => [
      fieldId,
      {
        fieldId,
        dailyValues: {
          monday: value,
        },
      },
    ]),
  )
}

function createDepartmentReport(
  id: string,
  departmentId: string,
  periodId: string,
  values: Record<string, number | string>,
  templateId = 'inpatient_weekly',
) {
  return createReport({
    id,
    assignmentId: `assignment_${id}`,
    departmentId,
    templateId,
    reportingPeriodId: periodId,
    createdById: 'nurse_analytics',
    updatedById: 'nurse_analytics',
    createdAt: '2026-04-01T08:00:00.000Z',
    updatedAt: '2026-04-01T09:00:00.000Z',
    submittedAt: null,
    lockedAt: null,
    status: 'draft',
    values: valuesFor(values),
    calculatedMetrics: {},
  })
}

describe('deriveReportStatus', () => {
  it('marks missing reports as overdue after the real deadline passes', () => {
    const period = createPeriod({
      id: 'period_overdue',
      weekStart: '2026-03-16T00:00:00.000Z',
      weekEnd: '2026-03-22T00:00:00.000Z',
      deadlineAt: '2026-03-23T10:00:00.000Z',
      label: 'Mar 16 - Mar 22, 2026',
    })

    const state = createState({
      reportingPeriods: [period],
    })

    expect(deriveReportStatus(state, period.id, null)).toBe('overdue')
  })
})

describe('getDashboardSummary', () => {
  it('counts previous-week missing and current-week submitted reports from live state', () => {
    const previousPeriod = createPeriod({
      id: 'period_previous',
      weekStart: '2026-03-23T00:00:00.000Z',
      weekEnd: '2026-03-29T00:00:00.000Z',
      deadlineAt: '2026-03-30T10:00:00.000Z',
      label: 'Mar 23 - Mar 29, 2026',
    })
    const currentPeriod = createPeriod({
      id: 'period_current',
      weekStart: '2026-03-30T00:00:00.000Z',
      weekEnd: '2026-04-05T00:00:00.000Z',
      deadlineAt: '2026-04-06T10:00:00.000Z',
      label: 'Mar 30 - Apr 5, 2026',
    })
    const assignment = createAssignment({
      id: 'assignment_gi',
      nurseId: 'nurse_1',
      departmentId: 'gi_neuro_inpatient',
      templateId: 'inpatient_weekly',
      approvedAt: '2026-03-01T08:00:00.000Z',
      active: true,
    })
    const currentReport = createReport({
      id: 'report_current',
      assignmentId: assignment.id,
      departmentId: assignment.departmentId,
      templateId: assignment.templateId,
      reportingPeriodId: currentPeriod.id,
      createdById: assignment.nurseId,
      updatedById: assignment.nurseId,
      createdAt: '2026-03-30T08:00:00.000Z',
      updatedAt: '2026-03-30T09:00:00.000Z',
      submittedAt: '2026-03-30T10:00:00.000Z',
      lockedAt: null,
      status: 'submitted',
      values: {},
      calculatedMetrics: {},
    })

    const state = createState({
      assignments: [assignment],
      reportingPeriods: [previousPeriod, currentPeriod],
      reports: [currentReport],
    })

    const summary = getDashboardSummary(state, currentPeriod.id, 'inpatient')

    expect(summary).not.toBeNull()
    expect(summary?.current.submitted).toBe(1)
    expect(summary?.previous.missing).toBe(1)
  })
})

describe('reporting time ranges', () => {
  it('limits periods by the selected anchor and summarizes statuses across the range', () => {
    const periods = [
      createPeriod({
        id: 'period_one',
        weekStart: '2026-03-02T00:00:00.000Z',
        weekEnd: '2026-03-08T00:00:00.000Z',
        deadlineAt: '2026-03-09T10:00:00.000Z',
        label: 'Mar 2 - Mar 8, 2026',
      }),
      createPeriod({
        id: 'period_two',
        weekStart: '2026-03-09T00:00:00.000Z',
        weekEnd: '2026-03-15T00:00:00.000Z',
        deadlineAt: '2026-03-16T10:00:00.000Z',
        label: 'Mar 9 - Mar 15, 2026',
      }),
      createPeriod({
        id: 'period_three',
        weekStart: '2026-03-16T00:00:00.000Z',
        weekEnd: '2026-03-22T00:00:00.000Z',
        deadlineAt: '2026-03-23T10:00:00.000Z',
        label: 'Mar 16 - Mar 22, 2026',
      }),
    ]
    const assignment = createAssignment({
      id: 'assignment_gi',
      nurseId: 'nurse_1',
      departmentId: 'gi_neuro_inpatient',
      templateId: 'inpatient_weekly',
      approvedAt: '2026-03-01T08:00:00.000Z',
      active: true,
    })
    const reports = [
      createReport({
        id: 'report_one',
        assignmentId: assignment.id,
        departmentId: assignment.departmentId,
        templateId: assignment.templateId,
        reportingPeriodId: periods[0].id,
        createdById: assignment.nurseId,
        updatedById: assignment.nurseId,
        createdAt: '2026-03-02T08:00:00.000Z',
        updatedAt: '2026-03-02T09:00:00.000Z',
        submittedAt: '2026-03-02T10:00:00.000Z',
        lockedAt: null,
        status: 'submitted',
        values: {},
        calculatedMetrics: {},
      }),
      createReport({
        id: 'report_two',
        assignmentId: assignment.id,
        departmentId: assignment.departmentId,
        templateId: assignment.templateId,
        reportingPeriodId: periods[1].id,
        createdById: assignment.nurseId,
        updatedById: assignment.nurseId,
        createdAt: '2026-03-09T08:00:00.000Z',
        updatedAt: '2026-03-09T09:00:00.000Z',
        submittedAt: null,
        lockedAt: null,
        status: 'draft',
        values: {},
        calculatedMetrics: {},
      }),
      createReport({
        id: 'report_three',
        assignmentId: assignment.id,
        departmentId: assignment.departmentId,
        templateId: assignment.templateId,
        reportingPeriodId: periods[2].id,
        createdById: assignment.nurseId,
        updatedById: assignment.nurseId,
        createdAt: '2026-03-16T08:00:00.000Z',
        updatedAt: '2026-03-16T09:00:00.000Z',
        submittedAt: '2026-03-16T10:00:00.000Z',
        lockedAt: '2026-03-17T10:00:00.000Z',
        status: 'locked',
        values: {},
        calculatedMetrics: {},
      }),
    ]
    const state = createState({
      assignments: [assignment],
      reportingPeriods: periods,
      reports,
      settings: {
        ...defaultAppSettings,
        deadlineEnforced: false,
      },
    })

    expect(getReportingPeriodsForRange(state, 'current', periods[2].id)).toEqual([periods[2]])
    expect(getReportingPeriodsForRange(state, 'all', periods[1].id)).toEqual([
      periods[0],
      periods[1],
    ])

    const summary = getReportingRangeSummary(state, 'last4', periods[2].id, 'inpatient')

    expect(summary?.metrics.totalExpected).toBe(3)
    expect(summary?.metrics.submitted).toBe(1)
    expect(summary?.metrics.draft).toBe(1)
    expect(summary?.metrics.locked).toBe(1)
  })
})

describe('inpatient dashboard analytics', () => {
  const flowMetrics = [
    { key: 'newAdmissions', fieldIds: ['new_admitted_patients'] },
    { key: 'discharges', fieldIds: ['discharged_home', 'discharged_ama'] },
  ] as const
  const safetyMetrics = [
    { key: 'deaths', fieldIds: ['new_deaths'] },
    { key: 'hai', fieldIds: ['total_hai'] },
  ] as const

  it('builds a weekly trend for a selected inpatient ward only', () => {
    const periods = [
      createPeriod({
        id: 'period_apr_6',
        weekStart: '2026-04-06T00:00:00.000Z',
        weekEnd: '2026-04-12T00:00:00.000Z',
        deadlineAt: '2026-04-13T10:00:00.000Z',
        label: 'Apr 6 - Apr 12, 2026',
      }),
      createPeriod({
        id: 'period_apr_13',
        weekStart: '2026-04-13T00:00:00.000Z',
        weekEnd: '2026-04-19T00:00:00.000Z',
        deadlineAt: '2026-04-20T10:00:00.000Z',
        label: 'Apr 13 - Apr 19, 2026',
      }),
    ]
    const state = createState({
      reportingPeriods: periods,
      reports: [
        createDepartmentReport('cardiac_week_1', 'cardiac_inpatient', periods[0].id, {
          new_admitted_patients: 5,
          discharged_home: 2,
        }),
        createDepartmentReport('nephrology_week_1', 'nephrology_inpatient', periods[0].id, {
          new_admitted_patients: 50,
          discharged_home: 20,
        }),
        createDepartmentReport('cardiac_week_2', 'cardiac_inpatient', periods[1].id, {
          new_admitted_patients: 8,
          discharged_home: 3,
          discharged_ama: 1,
        }),
      ],
    })
    const buckets = [
      createBucket('period_apr_6', 'Apr 6', [periods[0]]),
      createBucket('period_apr_13', 'Apr 13', [periods[1]]),
    ]

    const series = getInpatientWeeklyCountTrendSeries(
      state,
      buckets,
      flowMetrics,
      'cardiac_inpatient',
    )

    expect(series).toEqual([
      expect.objectContaining({ label: 'Apr 6', newAdmissions: 5, discharges: 2 }),
      expect.objectContaining({ label: 'Apr 13', newAdmissions: 8, discharges: 4 }),
    ])
  })

  it('averages weekly inpatient count metrics across wards with data', () => {
    const period = createPeriod({
      id: 'period_average',
      weekStart: '2026-04-06T00:00:00.000Z',
      weekEnd: '2026-04-12T00:00:00.000Z',
      deadlineAt: '2026-04-13T10:00:00.000Z',
      label: 'Apr 6 - Apr 12, 2026',
    })
    const state = createState({
      reportingPeriods: [period],
      reports: [
        createDepartmentReport('cardiac_average', 'cardiac_inpatient', period.id, {
          new_admitted_patients: 4,
          discharged_home: 2,
        }),
        createDepartmentReport('nephrology_average', 'nephrology_inpatient', period.id, {
          new_admitted_patients: 8,
          discharged_home: 6,
        }),
        createDepartmentReport('dialysis_average', 'dialysis_unit', period.id, {
          new_admitted_patients: 100,
          discharged_home: 100,
        }, 'dialysis_weekly'),
      ],
    })

    const series = getInpatientWeeklyCountTrendSeries(
      state,
      [createBucket('period_average', 'Apr 6', [period])],
      flowMetrics,
      ALL_INPATIENT_AVERAGE,
    )

    expect(series[0].newAdmissions).toBe(6)
    expect(series[0].discharges).toBe(4)
  })

  it('builds monthly inpatient ward comparison data and includes Transition counts', () => {
    const period = createPeriod({
      id: 'period_transition_month',
      weekStart: '2026-04-06T00:00:00.000Z',
      weekEnd: '2026-04-12T00:00:00.000Z',
      deadlineAt: '2026-04-13T10:00:00.000Z',
      label: 'Apr 6 - Apr 12, 2026',
    })
    const state = createState({
      reportingPeriods: [period],
      reports: [
        createDepartmentReport('cardiac_month', 'cardiac_inpatient', period.id, {
          new_admitted_patients: 6,
          discharged_home: 4,
        }),
        createDepartmentReport('transition_month', 'transition_inpatient', period.id, {
          new_admitted_patients: 3,
          discharged_home: 1,
        }),
        createDepartmentReport('dialysis_month', 'dialysis_unit', period.id, {
          new_admitted_patients: 99,
          discharged_home: 99,
        }, 'dialysis_weekly'),
      ],
    })

    const data = getInpatientMonthlyWardComparisonData(
      state,
      [createBucket('2026-04', 'Apr 2026', [period])],
      flowMetrics,
    )

    expect(data.map((point) => point.departmentName)).toEqual(['Cardiac', 'Transition'])
    expect(data.map((point) => point.label)).toEqual(['Cardiac', 'Transition'])
    expect(data.find((point) => point.departmentId === 'transition_inpatient')).toEqual(
      expect.objectContaining({ newAdmissions: 3, discharges: 1 }),
    )
    expect(data.some((point) => point.departmentId === 'dialysis_unit')).toBe(false)
  })

  it('builds monthly inpatient ward comparison data for the selected month only', () => {
    const periods = [
      createPeriod({
        id: 'period_mar_month',
        weekStart: '2026-03-02T00:00:00.000Z',
        weekEnd: '2026-03-08T00:00:00.000Z',
        deadlineAt: '2026-03-09T10:00:00.000Z',
        label: 'Mar 2 - Mar 8, 2026',
      }),
      createPeriod({
        id: 'period_apr_month',
        weekStart: '2026-04-06T00:00:00.000Z',
        weekEnd: '2026-04-12T00:00:00.000Z',
        deadlineAt: '2026-04-13T10:00:00.000Z',
        label: 'Apr 6 - Apr 12, 2026',
      }),
    ]
    const buckets = [
      createBucket('2026-03', 'Mar 2026', [periods[0]]),
      createBucket('2026-04', 'Apr 2026', [periods[1]]),
    ]
    const state = createState({
      reportingPeriods: periods,
      reports: [
        createDepartmentReport('cardiac_mar_month', 'cardiac_inpatient', periods[0].id, {
          new_admitted_patients: 2,
          discharged_home: 1,
        }),
        createDepartmentReport('hdu_mar_month', 'hdu_inpatient', periods[0].id, {
          new_admitted_patients: 4,
          discharged_home: 2,
        }),
        createDepartmentReport('cardiac_apr_month', 'cardiac_inpatient', periods[1].id, {
          new_admitted_patients: 7,
          discharged_home: 4,
        }),
        createDepartmentReport('transition_apr_month', 'transition_inpatient', periods[1].id, {
          new_admitted_patients: 3,
          discharged_home: 1,
        }),
        createDepartmentReport('dialysis_apr_month', 'dialysis_unit', periods[1].id, {
          new_admitted_patients: 99,
          discharged_home: 99,
        }, 'dialysis_weekly'),
      ],
    })

    const data = getInpatientMonthlyWardComparisonData(
      state,
      buckets,
      flowMetrics,
      '2026-04',
    )

    expect(data.map((point) => point.monthLabel)).toEqual(['Apr 2026', 'Apr 2026'])
    expect(data.map((point) => point.departmentId)).toEqual([
      'cardiac_inpatient',
      'transition_inpatient',
    ])
    expect(data.map((point) => point.label)).toEqual(['Cardiac', 'Transition'])
    expect(data.every((point) => !String(point.label).includes('/'))).toBe(true)
    expect(data).toEqual([
      expect.objectContaining({ newAdmissions: 7, discharges: 4 }),
      expect.objectContaining({ newAdmissions: 3, discharges: 1 }),
    ])
    expect(data.some((point) => point.departmentId === 'hdu_inpatient')).toBe(false)
    expect(data.some((point) => point.departmentId === 'dialysis_unit')).toBe(false)
  })

  it('defaults monthly inpatient ward comparison data to the latest month in range', () => {
    const periods = [
      createPeriod({
        id: 'period_default_mar',
        weekStart: '2026-03-02T00:00:00.000Z',
        weekEnd: '2026-03-08T00:00:00.000Z',
        deadlineAt: '2026-03-09T10:00:00.000Z',
        label: 'Mar 2 - Mar 8, 2026',
      }),
      createPeriod({
        id: 'period_default_apr',
        weekStart: '2026-04-06T00:00:00.000Z',
        weekEnd: '2026-04-12T00:00:00.000Z',
        deadlineAt: '2026-04-13T10:00:00.000Z',
        label: 'Apr 6 - Apr 12, 2026',
      }),
    ]
    const buckets = [
      createBucket('2026-03', 'Mar 2026', [periods[0]]),
      createBucket('2026-04', 'Apr 2026', [periods[1]]),
    ]
    const state = createState({
      reportingPeriods: periods,
      reports: [
        createDepartmentReport('cardiac_default_mar', 'cardiac_inpatient', periods[0].id, {
          new_admitted_patients: 2,
        }),
        createDepartmentReport('cardiac_default_apr', 'cardiac_inpatient', periods[1].id, {
          new_admitted_patients: 8,
        }),
      ],
    })

    const data = getInpatientMonthlyWardComparisonData(state, buckets, flowMetrics)

    expect(getLatestDashboardTrendBucketKey(buckets)).toBe('2026-04')
    expect(data).toEqual([
      expect.objectContaining({
        label: 'Cardiac',
        monthKey: '2026-04',
        monthLabel: 'Apr 2026',
        newAdmissions: 8,
      }),
    ])
  })

  it('keeps BOR, BTR, and ALOS out of weekly dashboard analytics', () => {
    expect(shouldShowInpatientOccupancyAnalytics('weekly')).toBe(false)
    expect(shouldShowInpatientOccupancyAnalytics('monthly')).toBe(true)
  })

  it('calculates monthly BOR, BTR, and ALOS for a selected ward', () => {
    const period = createPeriod({
      id: 'period_cardiac_occupancy',
      weekStart: '2026-04-06T00:00:00.000Z',
      weekEnd: '2026-04-12T00:00:00.000Z',
      deadlineAt: '2026-04-13T10:00:00.000Z',
      label: 'Apr 6 - Apr 12, 2026',
    })
    const state = createState({
      reportingPeriods: [period],
      reports: [
        createDepartmentReport('cardiac_occupancy', 'cardiac_inpatient', period.id, {
          total_patient_days: 220,
          discharged_home: 40,
          discharged_ama: 4,
        }),
        createDepartmentReport('nephrology_occupancy', 'nephrology_inpatient', period.id, {
          total_patient_days: 300,
          discharged_home: 12,
          discharged_ama: 3,
        }),
      ],
    })

    const cardiacSeries = getInpatientMonthlyOccupancySeries(
      state,
      [createBucket('2026-04', 'Apr 2026', [period])],
      'cardiac_inpatient',
    )
    const nephrologySeries = getInpatientMonthlyOccupancySeries(
      state,
      [createBucket('2026-04', 'Apr 2026', [period])],
      'nephrology_inpatient',
    )

    expect(cardiacSeries[0].bor).toBeCloseTo(33.33, 2)
    expect(cardiacSeries[0].btr).toBe(2)
    expect(cardiacSeries[0].alos).toBe(5)
    expect(nephrologySeries[0].bor).toBeCloseTo(50, 2)
    expect(nephrologySeries[0].btr).toBe(0.75)
    expect(nephrologySeries[0].alos).toBe(20)
    expect(cardiacSeries[0]).not.toEqual(nephrologySeries[0])
  })

  it('keeps monthly count/event ward comparisons separate from occupancy scope', () => {
    const period = createPeriod({
      id: 'period_scope_separation',
      weekStart: '2026-04-06T00:00:00.000Z',
      weekEnd: '2026-04-12T00:00:00.000Z',
      deadlineAt: '2026-04-13T10:00:00.000Z',
      label: 'Apr 6 - Apr 12, 2026',
    })
    const bucket = createBucket('2026-04', 'Apr 2026', [period])
    const state = createState({
      reportingPeriods: [period],
      reports: [
        createDepartmentReport('cardiac_scope_count', 'cardiac_inpatient', period.id, {
          new_admitted_patients: 6,
          discharged_home: 4,
          total_patient_days: 220,
        }),
        createDepartmentReport('nephrology_scope_count', 'nephrology_inpatient', period.id, {
          new_admitted_patients: 10,
          discharged_home: 7,
          total_patient_days: 300,
        }),
      ],
    })

    const comparisonData = getInpatientMonthlyWardComparisonData(
      state,
      [bucket],
      flowMetrics,
    )
    const cardiacOccupancy = getInpatientMonthlyOccupancySeries(
      state,
      [bucket],
      'cardiac_inpatient',
    )
    const nephrologyOccupancy = getInpatientMonthlyOccupancySeries(
      state,
      [bucket],
      'nephrology_inpatient',
    )

    expect(comparisonData.map((point) => point.departmentId)).toEqual([
      'cardiac_inpatient',
      'nephrology_inpatient',
    ])
    expect(comparisonData).toEqual([
      expect.objectContaining({
        label: 'Cardiac',
        monthLabel: 'Apr 2026',
        departmentName: 'Cardiac',
        newAdmissions: 6,
        discharges: 4,
      }),
      expect.objectContaining({
        label: 'Nephrology',
        monthLabel: 'Apr 2026',
        departmentName: 'Nephrology',
        newAdmissions: 10,
        discharges: 7,
      }),
    ])
    expect(cardiacOccupancy[0]).not.toEqual(nephrologyOccupancy[0])
  })

  it('calculates pooled monthly BOR, BTR, and ALOS using all capacity-eligible wards only', () => {
    const period = createPeriod({
      id: 'period_pooled_occupancy',
      weekStart: '2026-04-06T00:00:00.000Z',
      weekEnd: '2026-04-12T00:00:00.000Z',
      deadlineAt: '2026-04-13T10:00:00.000Z',
      label: 'Apr 6 - Apr 12, 2026',
    })
    const state = createState({
      reportingPeriods: [period],
      reports: [
        createDepartmentReport('cardiac_pooled', 'cardiac_inpatient', period.id, {
          total_patient_days: 220,
          discharged_home: 44,
        }),
        createDepartmentReport('nephrology_pooled', 'nephrology_inpatient', period.id, {
          total_patient_days: 200,
          discharged_home: 20,
        }),
        createDepartmentReport('transition_pooled', 'transition_inpatient', period.id, {
          total_patient_days: 900,
          discharged_home: 90,
        }),
        createDepartmentReport('dialysis_pooled', 'dialysis_unit', period.id, {
          total_patient_days: 900,
          discharged_home: 90,
        }, 'dialysis_weekly'),
      ],
    })

    const series = getInpatientMonthlyOccupancySeries(
      state,
      [createBucket('2026-04', 'Apr 2026', [period])],
      ALL_INPATIENT_POOLED,
    )

    expect(series[0].bor).toBeCloseTo(10.14, 2)
    expect(series[0].btr).toBeCloseTo(0.46, 2)
    expect(series[0].alos).toBeCloseTo(6.56, 2)
  })

  it('returns no occupancy data for Transition until a bed count exists', () => {
    const period = createPeriod({
      id: 'period_transition_occupancy',
      weekStart: '2026-04-06T00:00:00.000Z',
      weekEnd: '2026-04-12T00:00:00.000Z',
      deadlineAt: '2026-04-13T10:00:00.000Z',
      label: 'Apr 6 - Apr 12, 2026',
    })
    const state = createState({
      reportingPeriods: [period],
      reports: [
        createDepartmentReport('transition_occupancy', 'transition_inpatient', period.id, {
          total_patient_days: 120,
          discharged_home: 12,
        }),
      ],
    })

    const series = getInpatientMonthlyOccupancySeries(
      state,
      [createBucket('2026-04', 'Apr 2026', [period])],
      'transition_inpatient',
    )

    expect(series[0]).toEqual(
      expect.objectContaining({
        bor: null,
        btr: null,
        alos: null,
      }),
    )
  })

  it('excludes Dialysis from inpatient safety analytics', () => {
    const period = createPeriod({
      id: 'period_dialysis_exclusion',
      weekStart: '2026-04-06T00:00:00.000Z',
      weekEnd: '2026-04-12T00:00:00.000Z',
      deadlineAt: '2026-04-13T10:00:00.000Z',
      label: 'Apr 6 - Apr 12, 2026',
    })
    const state = createState({
      reportingPeriods: [period],
      reports: [
        createDepartmentReport('cardiac_safety', 'cardiac_inpatient', period.id, {
          new_deaths: 1,
          total_hai: 2,
        }),
        createDepartmentReport('dialysis_safety', 'dialysis_unit', period.id, {
          new_deaths: 20,
          total_hai: 30,
        }, 'dialysis_weekly'),
      ],
    })

    const series = getInpatientWeeklyCountTrendSeries(
      state,
      [createBucket('period_dialysis_exclusion', 'Apr 6', [period])],
      safetyMetrics,
      ALL_INPATIENT_AVERAGE,
    )

    expect(series[0].deaths).toBe(1)
    expect(series[0].hai).toBe(2)
  })
})

describe('outpatient dashboard analytics', () => {
  const outpatientDepartments = departments.filter((department) => department.family === 'outpatient')
  const primaryOutpatient = outpatientDepartments[0]
  const secondaryOutpatient = outpatientDepartments[1]
  const seenMetrics = [
    { key: 'seen', fieldId: 'total_patients_seen', valueType: 'sum' },
    { key: 'notSeenSameDay', fieldId: 'not_seen_same_day', valueType: 'sum' },
  ] as const
  const waitMetrics = [
    { key: 'wait', fieldId: 'wait_time_followup_months', valueType: 'average' },
  ] as const
  const clinicStartMetrics = [
    { key: 'startMinutes', fieldId: 'clinic_start_time', valueType: 'timeAverage' },
  ] as const

  it('builds a weekly trend for a selected outpatient department only', () => {
    const periods = [
      createPeriod({
        id: 'period_outpatient_apr_6',
        weekStart: '2026-04-06T00:00:00.000Z',
        weekEnd: '2026-04-12T00:00:00.000Z',
        deadlineAt: '2026-04-13T10:00:00.000Z',
        label: 'Apr 6 - Apr 12, 2026',
      }),
      createPeriod({
        id: 'period_outpatient_apr_13',
        weekStart: '2026-04-13T00:00:00.000Z',
        weekEnd: '2026-04-19T00:00:00.000Z',
        deadlineAt: '2026-04-20T10:00:00.000Z',
        label: 'Apr 13 - Apr 19, 2026',
      }),
    ]
    const state = createState({
      reportingPeriods: periods,
      reports: [
        createDepartmentReport('art_week_1', primaryOutpatient.id, periods[0].id, {
          total_patients_seen: 30,
          not_seen_same_day: 3,
        }, 'outpatient_weekly'),
        createDepartmentReport('gi_week_1', secondaryOutpatient.id, periods[0].id, {
          total_patients_seen: 90,
          not_seen_same_day: 9,
        }, 'outpatient_weekly'),
        createDepartmentReport('art_week_2', primaryOutpatient.id, periods[1].id, {
          total_patients_seen: 42,
          not_seen_same_day: 4,
        }, 'outpatient_weekly'),
      ],
    })
    const buckets = [
      createBucket('period_outpatient_apr_6', 'Apr 6', [periods[0]]),
      createBucket('period_outpatient_apr_13', 'Apr 13', [periods[1]]),
    ]

    const series = getOutpatientWeeklyTrendSeries(
      state,
      buckets,
      seenMetrics,
      primaryOutpatient.id,
    )

    expect(series).toEqual([
      expect.objectContaining({ label: 'Apr 6', seen: 30, notSeenSameDay: 3 }),
      expect.objectContaining({ label: 'Apr 13', seen: 42, notSeenSameDay: 4 }),
    ])
  })

  it('averages weekly outpatient metrics across departments with data', () => {
    const period = createPeriod({
      id: 'period_outpatient_average',
      weekStart: '2026-04-06T00:00:00.000Z',
      weekEnd: '2026-04-12T00:00:00.000Z',
      deadlineAt: '2026-04-13T10:00:00.000Z',
      label: 'Apr 6 - Apr 12, 2026',
    })
    const state = createState({
      reportingPeriods: [period],
      reports: [
        createDepartmentReport('art_average', primaryOutpatient.id, period.id, {
          total_patients_seen: 20,
          not_seen_same_day: 2,
          wait_time_followup_months: 2,
        }, 'outpatient_weekly'),
        createDepartmentReport('gi_average', secondaryOutpatient.id, period.id, {
          total_patients_seen: 40,
          not_seen_same_day: 4,
          wait_time_followup_months: 4,
        }, 'outpatient_weekly'),
        createDepartmentReport('inpatient_average_guard', 'cardiac_inpatient', period.id, {
          total_patients_seen: 200,
          not_seen_same_day: 20,
          wait_time_followup_months: 20,
        }),
        createDepartmentReport('dialysis_average_guard', 'dialysis_unit', period.id, {
          total_patients_seen: 200,
          not_seen_same_day: 20,
          wait_time_followup_months: 20,
        }, 'dialysis_weekly'),
      ],
    })
    const bucket = createBucket('period_outpatient_average', 'Apr 6', [period])

    const seenSeries = getOutpatientWeeklyTrendSeries(
      state,
      [bucket],
      seenMetrics,
      ALL_OUTPATIENT_AVERAGE,
    )
    const waitSeries = getOutpatientWeeklyTrendSeries(
      state,
      [bucket],
      waitMetrics,
      ALL_OUTPATIENT_AVERAGE,
    )

    expect(seenSeries[0].seen).toBe(30)
    expect(seenSeries[0].notSeenSameDay).toBe(3)
    expect(waitSeries[0].wait).toBe(3)
  })

  it('builds monthly outpatient department comparison data for the selected month only', () => {
    const periods = [
      createPeriod({
        id: 'period_outpatient_mar',
        weekStart: '2026-03-02T00:00:00.000Z',
        weekEnd: '2026-03-08T00:00:00.000Z',
        deadlineAt: '2026-03-09T10:00:00.000Z',
        label: 'Mar 2 - Mar 8, 2026',
      }),
      createPeriod({
        id: 'period_outpatient_apr',
        weekStart: '2026-04-06T00:00:00.000Z',
        weekEnd: '2026-04-12T00:00:00.000Z',
        deadlineAt: '2026-04-13T10:00:00.000Z',
        label: 'Apr 6 - Apr 12, 2026',
      }),
    ]
    const buckets = [
      createBucket('2026-03', 'Mar 2026', [periods[0]]),
      createBucket('2026-04', 'Apr 2026', [periods[1]]),
    ]
    const state = createState({
      reportingPeriods: periods,
      reports: [
        createDepartmentReport('art_mar', primaryOutpatient.id, periods[0].id, {
          total_patients_seen: 18,
          not_seen_same_day: 1,
        }, 'outpatient_weekly'),
        createDepartmentReport('art_apr', primaryOutpatient.id, periods[1].id, {
          total_patients_seen: 31,
          not_seen_same_day: 2,
        }, 'outpatient_weekly'),
        createDepartmentReport('gi_apr', secondaryOutpatient.id, periods[1].id, {
          total_patients_seen: 45,
          not_seen_same_day: 5,
        }, 'outpatient_weekly'),
        createDepartmentReport('cardiac_inpatient_apr_guard', 'cardiac_inpatient', periods[1].id, {
          total_patients_seen: 999,
          not_seen_same_day: 999,
        }),
        createDepartmentReport('dialysis_apr_guard', 'dialysis_unit', periods[1].id, {
          total_patients_seen: 999,
          not_seen_same_day: 999,
        }, 'dialysis_weekly'),
      ],
    })

    const data = getOutpatientMonthlyDepartmentComparisonData(
      state,
      buckets,
      seenMetrics,
      '2026-04',
    )

    expect(data.map((point) => point.monthLabel)).toEqual(['Apr 2026', 'Apr 2026'])
    expect(data.map((point) => point.departmentId)).toEqual([
      primaryOutpatient.id,
      secondaryOutpatient.id,
    ])
    expect(data.map((point) => point.label)).toEqual([
      primaryOutpatient.name,
      secondaryOutpatient.name,
    ])
    expect(data.every((point) => !String(point.label).includes('/'))).toBe(true)
    expect(data).toEqual([
      expect.objectContaining({ seen: 31, notSeenSameDay: 2 }),
      expect.objectContaining({ seen: 45, notSeenSameDay: 5 }),
    ])
    expect(data.some((point) => point.departmentId === 'cardiac_inpatient')).toBe(false)
    expect(data.some((point) => point.departmentId === 'dialysis_unit')).toBe(false)
  })

  it('defaults monthly outpatient comparison data to the latest month in range', () => {
    const periods = [
      createPeriod({
        id: 'period_outpatient_default_mar',
        weekStart: '2026-03-02T00:00:00.000Z',
        weekEnd: '2026-03-08T00:00:00.000Z',
        deadlineAt: '2026-03-09T10:00:00.000Z',
        label: 'Mar 2 - Mar 8, 2026',
      }),
      createPeriod({
        id: 'period_outpatient_default_apr',
        weekStart: '2026-04-06T00:00:00.000Z',
        weekEnd: '2026-04-12T00:00:00.000Z',
        deadlineAt: '2026-04-13T10:00:00.000Z',
        label: 'Apr 6 - Apr 12, 2026',
      }),
    ]
    const buckets = [
      createBucket('2026-03', 'Mar 2026', [periods[0]]),
      createBucket('2026-04', 'Apr 2026', [periods[1]]),
    ]
    const state = createState({
      reportingPeriods: periods,
      reports: [
        createDepartmentReport('art_default_mar', primaryOutpatient.id, periods[0].id, {
          total_patients_seen: 18,
        }, 'outpatient_weekly'),
        createDepartmentReport('art_default_apr', primaryOutpatient.id, periods[1].id, {
          total_patients_seen: 51,
        }, 'outpatient_weekly'),
      ],
    })

    const data = getOutpatientMonthlyDepartmentComparisonData(state, buckets, seenMetrics)

    expect(getLatestDashboardTrendBucketKey(buckets)).toBe('2026-04')
    expect(data).toEqual([
      expect.objectContaining({
        label: primaryOutpatient.name,
        monthKey: '2026-04',
        monthLabel: 'Apr 2026',
        seen: 51,
      }),
    ])
  })

  it('uses outpatient department labels for monthly clinic start comparisons', () => {
    const period = createPeriod({
      id: 'period_outpatient_start',
      weekStart: '2026-04-06T00:00:00.000Z',
      weekEnd: '2026-04-12T00:00:00.000Z',
      deadlineAt: '2026-04-13T10:00:00.000Z',
      label: 'Apr 6 - Apr 12, 2026',
    })
    const state = createState({
      reportingPeriods: [period],
      reports: [
        createDepartmentReport('art_start', primaryOutpatient.id, period.id, {
          clinic_start_time: '08:30',
        }, 'outpatient_weekly'),
        createDepartmentReport('gi_start', secondaryOutpatient.id, period.id, {
          clinic_start_time: '09:00',
        }, 'outpatient_weekly'),
      ],
    })

    const data = getOutpatientMonthlyDepartmentComparisonData(
      state,
      [createBucket('2026-04', 'Apr 2026', [period])],
      clinicStartMetrics,
    )

    expect(data.map((point) => point.label)).toEqual([
      primaryOutpatient.name,
      secondaryOutpatient.name,
    ])
    expect(data).toEqual([
      expect.objectContaining({ startMinutes: 510 }),
      expect.objectContaining({ startMinutes: 540 }),
    ])
  })

  it('builds weekly senior physician availability for a selected outpatient department', () => {
    const periods = [
      createPeriod({
        id: 'period_availability_apr_6',
        weekStart: '2026-04-06T00:00:00.000Z',
        weekEnd: '2026-04-12T00:00:00.000Z',
        deadlineAt: '2026-04-13T10:00:00.000Z',
        label: 'Apr 6 - Apr 12, 2026',
      }),
      createPeriod({
        id: 'period_availability_apr_13',
        weekStart: '2026-04-13T00:00:00.000Z',
        weekEnd: '2026-04-19T00:00:00.000Z',
        deadlineAt: '2026-04-20T10:00:00.000Z',
        label: 'Apr 13 - Apr 19, 2026',
      }),
    ]
    const state = createState({
      reportingPeriods: periods,
      reports: [
        createDepartmentReport('art_availability_week_1', primaryOutpatient.id, periods[0].id, {
          senior_physician_availability: 'Full day',
        }, 'outpatient_weekly'),
        createDepartmentReport('gi_availability_week_1', secondaryOutpatient.id, periods[0].id, {
          senior_physician_availability: 'Partial day',
        }, 'outpatient_weekly'),
        createDepartmentReport('art_availability_week_2', primaryOutpatient.id, periods[1].id, {
          senior_physician_availability: 'Unavailable',
        }, 'outpatient_weekly'),
      ],
    })
    const buckets = [
      createBucket('period_availability_apr_6', 'Apr 6', [periods[0]]),
      createBucket('period_availability_apr_13', 'Apr 13', [periods[1]]),
    ]

    const series = getOutpatientWeeklyAvailabilitySeries(
      state,
      buckets,
      primaryOutpatient.id,
    )

    expect(series).toEqual([
      expect.objectContaining({
        label: 'Apr 6',
        fullDay: 1,
        partialDay: 0,
        unavailable: 0,
        total: 1,
      }),
      expect.objectContaining({
        label: 'Apr 13',
        fullDay: 0,
        partialDay: 0,
        unavailable: 1,
        total: 1,
      }),
    ])
  })

  it('uses weekly senior physician availability category counts for all outpatient departments', () => {
    const period = createPeriod({
      id: 'period_availability_all',
      weekStart: '2026-04-06T00:00:00.000Z',
      weekEnd: '2026-04-12T00:00:00.000Z',
      deadlineAt: '2026-04-13T10:00:00.000Z',
      label: 'Apr 6 - Apr 12, 2026',
    })
    const state = createState({
      reportingPeriods: [period],
      reports: [
        createDepartmentReport('art_availability_all', primaryOutpatient.id, period.id, {
          senior_physician_availability: 'Full day',
        }, 'outpatient_weekly'),
        createDepartmentReport('gi_availability_all', secondaryOutpatient.id, period.id, {
          senior_physician_availability: 'Partial day',
        }, 'outpatient_weekly'),
        createDepartmentReport('inpatient_availability_guard', 'cardiac_inpatient', period.id, {
          senior_physician_availability: 'Unavailable',
        }),
        createDepartmentReport('dialysis_availability_guard', 'dialysis_unit', period.id, {
          senior_physician_availability: 'Unavailable',
        }, 'dialysis_weekly'),
      ],
    })

    const series = getOutpatientWeeklyAvailabilitySeries(
      state,
      [createBucket('period_availability_all', 'Apr 6', [period])],
      ALL_OUTPATIENT_AVERAGE,
    )

    expect(series[0]).toEqual(
      expect.objectContaining({
        fullDay: 1,
        partialDay: 1,
        unavailable: 0,
        total: 2,
      }),
    )
  })

  it('builds monthly senior physician availability by outpatient department for the selected month', () => {
    const periods = [
      createPeriod({
        id: 'period_availability_mar',
        weekStart: '2026-03-02T00:00:00.000Z',
        weekEnd: '2026-03-08T00:00:00.000Z',
        deadlineAt: '2026-03-09T10:00:00.000Z',
        label: 'Mar 2 - Mar 8, 2026',
      }),
      createPeriod({
        id: 'period_availability_apr_6',
        weekStart: '2026-04-06T00:00:00.000Z',
        weekEnd: '2026-04-12T00:00:00.000Z',
        deadlineAt: '2026-04-13T10:00:00.000Z',
        label: 'Apr 6 - Apr 12, 2026',
      }),
      createPeriod({
        id: 'period_availability_apr_13',
        weekStart: '2026-04-13T00:00:00.000Z',
        weekEnd: '2026-04-19T00:00:00.000Z',
        deadlineAt: '2026-04-20T10:00:00.000Z',
        label: 'Apr 13 - Apr 19, 2026',
      }),
    ]
    const buckets = [
      createBucket('2026-03', 'Mar 2026', [periods[0]]),
      createBucket('2026-04', 'Apr 2026', [periods[1], periods[2]]),
    ]
    const state = createState({
      reportingPeriods: periods,
      reports: [
        createDepartmentReport('art_availability_mar', primaryOutpatient.id, periods[0].id, {
          senior_physician_availability: 'Full day',
        }, 'outpatient_weekly'),
        createDepartmentReport('art_availability_apr_6', primaryOutpatient.id, periods[1].id, {
          senior_physician_availability: 'Partial day',
        }, 'outpatient_weekly'),
        createDepartmentReport('art_availability_apr_13', primaryOutpatient.id, periods[2].id, {
          senior_physician_availability: 'Full day',
        }, 'outpatient_weekly'),
        createDepartmentReport('gi_availability_apr', secondaryOutpatient.id, periods[1].id, {
          senior_physician_availability: 'Unavailable',
        }, 'outpatient_weekly'),
        createDepartmentReport('inpatient_availability_apr_guard', 'cardiac_inpatient', periods[1].id, {
          senior_physician_availability: 'Full day',
        }),
        createDepartmentReport('dialysis_availability_apr_guard', 'dialysis_unit', periods[1].id, {
          senior_physician_availability: 'Full day',
        }, 'dialysis_weekly'),
      ],
    })

    const data = getOutpatientMonthlyAvailabilityDepartmentComparisonData(
      state,
      buckets,
      '2026-04',
    )

    expect(data.map((point) => point.monthLabel)).toEqual(['Apr 2026', 'Apr 2026'])
    expect(data.map((point) => point.departmentId)).toEqual([
      primaryOutpatient.id,
      secondaryOutpatient.id,
    ])
    expect(data.map((point) => point.label)).toEqual([
      primaryOutpatient.name,
      secondaryOutpatient.name,
    ])
    expect(data.every((point) => !String(point.label).includes('/'))).toBe(true)
    expect(data).toEqual([
      expect.objectContaining({
        fullDay: 1,
        partialDay: 1,
        unavailable: 0,
        total: 2,
      }),
      expect.objectContaining({
        fullDay: 0,
        partialDay: 0,
        unavailable: 1,
        total: 1,
      }),
    ])
    expect(data.some((point) => point.departmentId === 'cardiac_inpatient')).toBe(false)
    expect(data.some((point) => point.departmentId === 'dialysis_unit')).toBe(false)
  })
})

describe('procedure dashboard analytics', () => {
  it('uses explicit procedure service fields that exist on the configured templates', () => {
    PROCEDURE_SERVICE_DEFINITIONS.forEach((service) => {
      const department = departments.find((item) => item.id === service.departmentId)
      const template = department ? templateMap[department.templateId] : null
      const templateFieldIds = new Set(template?.fields.map((field) => field.id) ?? [])

      expect(department?.family).toBe('procedure')
      expect(template?.family).toBe('procedure')
      expect(service.fieldIds.length).toBeGreaterThan(0)
      expect(service.fieldIds.every((fieldId) => templateFieldIds.has(fieldId))).toBe(true)
    })
  })

  it('builds a weekly trend for a selected procedure service only', () => {
    const periods = [
      createPeriod({
        id: 'period_echo_apr_6',
        weekStart: '2026-04-06T00:00:00.000Z',
        weekEnd: '2026-04-12T00:00:00.000Z',
        deadlineAt: '2026-04-13T10:00:00.000Z',
        label: 'Apr 6 - Apr 12, 2026',
      }),
      createPeriod({
        id: 'period_echo_apr_13',
        weekStart: '2026-04-13T00:00:00.000Z',
        weekEnd: '2026-04-19T00:00:00.000Z',
        deadlineAt: '2026-04-20T10:00:00.000Z',
        label: 'Apr 13 - Apr 19, 2026',
      }),
    ]
    const state = createState({
      reportingPeriods: periods,
      reports: [
        createDepartmentReport('echo_week_1', 'echocardiography_lab', periods[0].id, {
          echo_done: 10,
          ecg_done: 2,
        }, 'echocardiography_weekly'),
        createDepartmentReport('eeg_week_1_guard', 'eeg_lab', periods[0].id, {
          eeg_done: 99,
        }, 'eeg_weekly'),
        createDepartmentReport('echo_week_2', 'echocardiography_lab', periods[1].id, {
          echo_done: 5,
          ecg_done: 2,
        }, 'echocardiography_weekly'),
      ],
    })
    const buckets = [
      createBucket('period_echo_apr_6', 'Apr 6', [periods[0]]),
      createBucket('period_echo_apr_13', 'Apr 13', [periods[1]]),
    ]

    const series = getProcedureWeeklyTrendSeries(
      state,
      buckets,
      'echocardiography_lab',
    )

    expect(series).toEqual([
      expect.objectContaining({
        label: 'Apr 6',
        serviceId: 'echocardiography_lab',
        serviceName: 'Echocardiography Lab',
        metricLabel: 'Echo + ECG',
        total: 12,
      }),
      expect.objectContaining({
        label: 'Apr 13',
        total: 7,
      }),
    ])
  })

  it('builds a weekly all-procedure-services total from explicit service fields', () => {
    const period = createPeriod({
      id: 'period_all_procedure_services',
      weekStart: '2026-04-06T00:00:00.000Z',
      weekEnd: '2026-04-12T00:00:00.000Z',
      deadlineAt: '2026-04-13T10:00:00.000Z',
      label: 'Apr 6 - Apr 12, 2026',
    })
    const state = createState({
      reportingPeriods: [period],
      reports: [
        createDepartmentReport('eeg_total', 'eeg_lab', period.id, {
          eeg_done: 2,
        }, 'eeg_weekly'),
        createDepartmentReport('echo_total', 'echocardiography_lab', period.id, {
          echo_done: 10,
          ecg_done: 5,
        }, 'echocardiography_weekly'),
        createDepartmentReport('endoscopy_total', 'endoscopy_lab', period.id, {
          upper_gi_elective: 3,
          colonoscopy: 5,
          bronchoscopy: 4,
        }, 'endoscopy_weekly'),
        createDepartmentReport('hematology_total', 'hematology_procedures', period.id, {
          bone_marrow_biopsy: 6,
        }, 'hematology_procedures_weekly'),
        createDepartmentReport('bronchoscopy_total', 'bronchoscopy_lab', period.id, {
          bronchoscopy_done: 8,
        }, 'bronchoscopy_weekly'),
        createDepartmentReport('renal_total', 'renal_procedures', period.id, {
          elective_renal_biopsy: 9,
          central_venous_catheter_insertion: 1,
        }, 'renal_procedures_weekly'),
        createDepartmentReport('dialysis_total', 'dialysis_unit', period.id, {
          dialysis_acute: 11,
          dialysis_chronic: 12,
        }, 'dialysis_weekly'),
        createDepartmentReport('inpatient_procedure_guard', 'cardiac_inpatient', period.id, {
          echo_done: 500,
          dialysis_acute: 500,
        }),
      ],
    })

    const series = getProcedureWeeklyTrendSeries(
      state,
      [createBucket('period_all_procedure_services', 'Apr 6', [period])],
      ALL_PROCEDURE_SERVICES_TOTAL,
    )

    expect(series[0]).toEqual(
      expect.objectContaining({
        serviceId: ALL_PROCEDURE_SERVICES_TOTAL,
        total: 76,
      }),
    )
  })

  it('builds monthly procedure service comparison data for the selected month only', () => {
    const periods = [
      createPeriod({
        id: 'period_procedure_mar',
        weekStart: '2026-03-02T00:00:00.000Z',
        weekEnd: '2026-03-08T00:00:00.000Z',
        deadlineAt: '2026-03-09T10:00:00.000Z',
        label: 'Mar 2 - Mar 8, 2026',
      }),
      createPeriod({
        id: 'period_procedure_apr',
        weekStart: '2026-04-06T00:00:00.000Z',
        weekEnd: '2026-04-12T00:00:00.000Z',
        deadlineAt: '2026-04-13T10:00:00.000Z',
        label: 'Apr 6 - Apr 12, 2026',
      }),
    ]
    const buckets = [
      createBucket('2026-03', 'Mar 2026', [periods[0]]),
      createBucket('2026-04', 'Apr 2026', [periods[1]]),
    ]
    const state = createState({
      reportingPeriods: periods,
      reports: [
        createDepartmentReport('eeg_mar_compare', 'eeg_lab', periods[0].id, {
          eeg_done: 100,
        }, 'eeg_weekly'),
        createDepartmentReport('eeg_apr_compare', 'eeg_lab', periods[1].id, {
          eeg_done: 5,
        }, 'eeg_weekly'),
        createDepartmentReport('echo_apr_compare', 'echocardiography_lab', periods[1].id, {
          echo_done: 7,
          ecg_done: 3,
        }, 'echocardiography_weekly'),
        createDepartmentReport('dialysis_apr_compare', 'dialysis_unit', periods[1].id, {
          dialysis_acute: 1,
          dialysis_chronic: 2,
        }, 'dialysis_weekly'),
      ],
    })

    const data = getProcedureMonthlyServiceComparisonData(state, buckets, '2026-04')

    expect(data.map((point) => point.monthLabel)).toEqual(
      PROCEDURE_SERVICE_DEFINITIONS.map(() => 'Apr 2026'),
    )
    expect(data.map((point) => point.label)).toEqual(
      PROCEDURE_SERVICE_DEFINITIONS.map((service) => service.label),
    )
    expect(data.every((point) => !String(point.label).includes('/'))).toBe(true)
    expect(data.find((point) => point.serviceId === 'eeg_lab')).toEqual(
      expect.objectContaining({ total: 5 }),
    )
    expect(data.find((point) => point.serviceId === 'echocardiography_lab')).toEqual(
      expect.objectContaining({ total: 10 }),
    )
    expect(data.find((point) => point.serviceId === 'dialysis_unit')).toEqual(
      expect.objectContaining({ total: 3 }),
    )
    expect(data.map((point) => point.label)).not.toContain('Acute HD')
    expect(data.map((point) => point.label)).not.toContain('Chronic HD')
  })

  it('defaults monthly procedure comparison to the latest available month in range', () => {
    const periods = [
      createPeriod({
        id: 'period_procedure_default_mar',
        weekStart: '2026-03-02T00:00:00.000Z',
        weekEnd: '2026-03-08T00:00:00.000Z',
        deadlineAt: '2026-03-09T10:00:00.000Z',
        label: 'Mar 2 - Mar 8, 2026',
      }),
      createPeriod({
        id: 'period_procedure_default_apr',
        weekStart: '2026-04-06T00:00:00.000Z',
        weekEnd: '2026-04-12T00:00:00.000Z',
        deadlineAt: '2026-04-13T10:00:00.000Z',
        label: 'Apr 6 - Apr 12, 2026',
      }),
    ]
    const buckets = [
      createBucket('2026-03', 'Mar 2026', [periods[0]]),
      createBucket('2026-04', 'Apr 2026', [periods[1]]),
    ]
    const state = createState({
      reportingPeriods: periods,
      reports: [
        createDepartmentReport('eeg_default_mar', 'eeg_lab', periods[0].id, {
          eeg_done: 3,
        }, 'eeg_weekly'),
        createDepartmentReport('eeg_default_apr', 'eeg_lab', periods[1].id, {
          eeg_done: 9,
        }, 'eeg_weekly'),
      ],
    })

    const data = getProcedureMonthlyServiceComparisonData(state, buckets)

    expect(getLatestDashboardTrendBucketKey(buckets)).toBe('2026-04')
    expect(data.find((point) => point.serviceId === 'eeg_lab')).toEqual(
      expect.objectContaining({
        monthKey: '2026-04',
        monthLabel: 'Apr 2026',
        total: 9,
      }),
    )
  })

  it('keeps the Dialysis acute/chronic split Dialysis-specific', () => {
    const period = createPeriod({
      id: 'period_dialysis_split',
      weekStart: '2026-04-06T00:00:00.000Z',
      weekEnd: '2026-04-12T00:00:00.000Z',
      deadlineAt: '2026-04-13T10:00:00.000Z',
      label: 'Apr 6 - Apr 12, 2026',
    })
    const state = createState({
      reportingPeriods: [period],
      reports: [
        createDepartmentReport('dialysis_split', 'dialysis_unit', period.id, {
          dialysis_acute: 2,
          dialysis_chronic: 3,
        }, 'dialysis_weekly'),
        createDepartmentReport('renal_dialysis_guard', 'renal_procedures', period.id, {
          dialysis_acute: 100,
          dialysis_chronic: 100,
        }, 'renal_procedures_weekly'),
      ],
    })

    const data = getProcedureDialysisSplitData(
      state,
      [createBucket('2026-04', 'Apr 2026', [period])],
      '2026-04',
    )

    expect(data).toEqual([
      expect.objectContaining({ label: 'Acute HD', value: 2 }),
      expect.objectContaining({ label: 'Chronic HD', value: 3 }),
    ])
  })

  it('filters Dialysis and Endoscopy detail charts to the selected procedure month', () => {
    const periods = [
      createPeriod({
        id: 'period_procedure_detail_mar',
        weekStart: '2026-03-02T00:00:00.000Z',
        weekEnd: '2026-03-08T00:00:00.000Z',
        deadlineAt: '2026-03-09T10:00:00.000Z',
        label: 'Mar 2 - Mar 8, 2026',
      }),
      createPeriod({
        id: 'period_procedure_detail_apr',
        weekStart: '2026-04-06T00:00:00.000Z',
        weekEnd: '2026-04-12T00:00:00.000Z',
        deadlineAt: '2026-04-13T10:00:00.000Z',
        label: 'Apr 6 - Apr 12, 2026',
      }),
    ]
    const buckets = [
      createBucket('2026-03', 'Mar 2026', [periods[0]]),
      createBucket('2026-04', 'Apr 2026', [periods[1]]),
    ]
    const state = createState({
      reportingPeriods: periods,
      reports: [
        createDepartmentReport('dialysis_detail_mar', 'dialysis_unit', periods[0].id, {
          dialysis_acute: 20,
          dialysis_chronic: 30,
        }, 'dialysis_weekly'),
        createDepartmentReport('dialysis_detail_apr', 'dialysis_unit', periods[1].id, {
          dialysis_acute: 2,
          dialysis_chronic: 3,
        }, 'dialysis_weekly'),
        createDepartmentReport('endoscopy_detail_mar', 'endoscopy_lab', periods[0].id, {
          upper_gi_elective: 40,
          colonoscopy: 50,
        }, 'endoscopy_weekly'),
        createDepartmentReport('endoscopy_detail_apr', 'endoscopy_lab', periods[1].id, {
          upper_gi_elective: 4,
          colonoscopy: 5,
        }, 'endoscopy_weekly'),
      ],
    })

    const dialysisMix = getProcedureDialysisSplitData(state, buckets, '2026-04')
    const endoscopyMix = getProcedureEndoscopyMixData(state, buckets, '2026-04')

    expect(dialysisMix).toEqual([
      expect.objectContaining({ label: 'Acute HD', monthLabel: 'Apr 2026', value: 2 }),
      expect.objectContaining({ label: 'Chronic HD', monthLabel: 'Apr 2026', value: 3 }),
    ])
    expect(endoscopyMix.find((point) => point.label === 'UGI')).toEqual(
      expect.objectContaining({ monthLabel: 'Apr 2026', value: 4 }),
    )
    expect(endoscopyMix.find((point) => point.label === 'Colonoscopy')).toEqual(
      expect.objectContaining({ monthLabel: 'Apr 2026', value: 5 }),
    )
  })

  it('keeps Endoscopy mix Endoscopy-specific and does not double count Bronchoscopy Lab', () => {
    const period = createPeriod({
      id: 'period_endoscopy_mix',
      weekStart: '2026-04-06T00:00:00.000Z',
      weekEnd: '2026-04-12T00:00:00.000Z',
      deadlineAt: '2026-04-13T10:00:00.000Z',
      label: 'Apr 6 - Apr 12, 2026',
    })
    const state = createState({
      reportingPeriods: [period],
      reports: [
        createDepartmentReport('endoscopy_mix', 'endoscopy_lab', period.id, {
          upper_gi_elective: 2,
          bronchoscopy: 4,
        }, 'endoscopy_weekly'),
        createDepartmentReport('bronchoscopy_lab_guard', 'bronchoscopy_lab', period.id, {
          bronchoscopy_done: 50,
        }, 'bronchoscopy_weekly'),
      ],
    })

    const mixData = getProcedureEndoscopyMixData(
      state,
      [createBucket('2026-04', 'Apr 2026', [period])],
      '2026-04',
    )
    const comparisonData = getProcedureMonthlyServiceComparisonData(
      state,
      [createBucket('2026-04', 'Apr 2026', [period])],
      '2026-04',
    )

    expect(mixData.find((point) => point.label === 'Bronchoscopy')).toEqual(
      expect.objectContaining({ value: 4 }),
    )
    expect(comparisonData.find((point) => point.serviceId === 'endoscopy_lab')).toEqual(
      expect.objectContaining({ total: 6 }),
    )
    expect(comparisonData.find((point) => point.serviceId === 'bronchoscopy_lab')).toEqual(
      expect.objectContaining({ total: 50 }),
    )
  })

  it('calculates the procedure header total from all configured service definitions', () => {
    const period = createPeriod({
      id: 'period_header_total',
      weekStart: '2026-04-06T00:00:00.000Z',
      weekEnd: '2026-04-12T00:00:00.000Z',
      deadlineAt: '2026-04-13T10:00:00.000Z',
      label: 'Apr 6 - Apr 12, 2026',
    })
    const state = createState({
      reportingPeriods: [period],
      reports: [
        createDepartmentReport('hematology_header', 'hematology_procedures', period.id, {
          bone_marrow_biopsy: 6,
        }, 'hematology_procedures_weekly'),
        createDepartmentReport('bronchoscopy_header', 'bronchoscopy_lab', period.id, {
          bronchoscopy_done: 8,
        }, 'bronchoscopy_weekly'),
        createDepartmentReport('renal_header', 'renal_procedures', period.id, {
          elective_renal_biopsy: 9,
          central_venous_catheter_insertion: 1,
        }, 'renal_procedures_weekly'),
        createDepartmentReport('dialysis_header', 'dialysis_unit', period.id, {
          dialysis_acute: 11,
          dialysis_chronic: 12,
        }, 'dialysis_weekly'),
      ],
    })

    const total = getProcedureTotalThroughput(
      state,
      [createBucket('period_header_total', 'Apr 6', [period])],
    )

    expect(PROCEDURE_SERVICE_DEFINITIONS.map((service) => service.id)).toEqual([
      'eeg_lab',
      'echocardiography_lab',
      'endoscopy_lab',
      'hematology_procedures',
      'bronchoscopy_lab',
      'renal_procedures',
      'dialysis_unit',
    ])
    expect(total).toBe(47)
  })
})

describe('Dialysis assignment support', () => {
  it('keeps Dialysis as one valid procedure department with its own template', () => {
    const dialysisDepartments = departments.filter((department) => department.name === 'Dialysis')
    const dialysisDepartment = dialysisDepartments[0]
    const dialysisTemplate = templateMap.dialysis_weekly

    expect(dialysisDepartments).toHaveLength(1)
    expect(dialysisDepartment.id).toBe('dialysis_unit')
    expect(dialysisDepartment.family).toBe('procedure')
    expect(dialysisDepartment.templateId).toBe('dialysis_weekly')
    expect(dialysisTemplate.name).toBe('Dialysis')
    expect(dialysisTemplate.fields.map((field) => field.id)).toEqual(
      expect.arrayContaining(['dialysis_acute', 'dialysis_chronic', 'reporting_staff']),
    )
  })

  it('creates nurse report cards for Dialysis assignments like other departments', () => {
    const period = createPeriod({
      id: 'period_dialysis',
      weekStart: '2026-04-27T00:00:00.000Z',
      weekEnd: '2026-05-03T00:00:00.000Z',
      deadlineAt: '2026-05-04T10:00:00.000Z',
      label: 'Apr 27 - May 3, 2026',
    })
    const assignment = createAssignment({
      id: 'assignment_dialysis',
      nurseId: 'nurse_dialysis',
      departmentId: 'dialysis_unit',
      templateId: 'dialysis_weekly',
      approvedAt: '2026-04-27T08:00:00.000Z',
      active: true,
    })
    const state = createState({
      assignments: [assignment],
      reportingPeriods: [period],
      settings: {
        ...defaultAppSettings,
        deadlineEnforced: false,
      },
    })

    const cards = getAssignmentCardsForPeriod(state, assignment.nurseId, period.id)

    expect(cards).toHaveLength(1)
    expect(cards[0].department.name).toBe('Dialysis')
    expect(cards[0].department.family).toBe('procedure')
    expect(cards[0].template.name).toBe('Dialysis')
    expect(cards[0].status).toBe('not_started')
  })
})

describe('Transition assignment support', () => {
  it('keeps Transition as one valid inpatient department using the inpatient weekly template', () => {
    const transitionDepartments = departments.filter((department) => department.name === 'Transition')
    const transitionDepartment = transitionDepartments[0]
    const inpatientTemplate = templateMap.inpatient_weekly

    expect(transitionDepartments).toHaveLength(1)
    expect(transitionDepartment.id).toBe('transition_inpatient')
    expect(transitionDepartment.family).toBe('inpatient')
    expect(transitionDepartment.templateId).toBe('inpatient_weekly')
    expect(inpatientTemplate.family).toBe('inpatient')
    expect(inpatientTemplate.name).toBe('Inpatient Weekly Report')
  })

  it('creates nurse report cards for Transition assignments like other inpatient wards', () => {
    const period = createPeriod({
      id: 'period_transition',
      weekStart: '2026-04-27T00:00:00.000Z',
      weekEnd: '2026-05-03T00:00:00.000Z',
      deadlineAt: '2026-05-04T10:00:00.000Z',
      label: 'Apr 27 - May 3, 2026',
    })
    const assignment = createAssignment({
      id: 'assignment_transition',
      nurseId: 'nurse_transition',
      departmentId: 'transition_inpatient',
      templateId: 'inpatient_weekly',
      approvedAt: '2026-04-27T08:00:00.000Z',
      active: true,
    })
    const state = createState({
      assignments: [assignment],
      reportingPeriods: [period],
      settings: {
        ...defaultAppSettings,
        deadlineEnforced: false,
      },
    })

    const cards = getAssignmentCardsForPeriod(state, assignment.nurseId, period.id)

    expect(cards).toHaveLength(1)
    expect(cards[0].department.name).toBe('Transition')
    expect(cards[0].department.family).toBe('inpatient')
    expect(cards[0].template.name).toBe('Inpatient Weekly Report')
    expect(cards[0].status).toBe('not_started')
  })
})
