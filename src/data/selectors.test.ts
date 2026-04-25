import { describe, expect, it } from 'vitest'

import { createEmptyAppState, defaultAppSettings } from '@/lib/app-state'
import {
  deriveReportStatus,
  getDashboardSummary,
  getReportingPeriodsForRange,
  getReportingRangeSummary,
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

function createState(overrides: Partial<AppState>): AppState {
  return {
    ...createEmptyAppState(),
    settings: defaultAppSettings,
    ...overrides,
  }
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
