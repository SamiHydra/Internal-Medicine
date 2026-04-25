import { parseISO } from 'date-fns'

import { departments, departmentMap, reportTemplates, templateMap } from '@/config/templates'
import { getDeadlineForPeriod, isPastDeadline } from '@/lib/dates'
import { getNumericTotal } from '@/lib/metrics'
import { formatDelta } from '@/lib/utils'
import type {
  AppState,
  Department,
  ReportFamily,
  ReportRecord,
  ReportStatus,
  ReportingPeriod,
} from '@/types/domain'

const liveReportingStartDate = parseISO('2026-03-02T00:00:00.000Z')

export type ReportingTimeRange = 'current' | 'last4' | 'last8' | 'all'

export function getSortedReportingPeriods(state: AppState) {
  return [...state.reportingPeriods]
    .filter(
      (period) => parseISO(period.weekStart).getTime() >= liveReportingStartDate.getTime(),
    )
    .sort(
      (left, right) =>
        parseISO(left.weekStart).getTime() - parseISO(right.weekStart).getTime(),
    )
}

export function getCurrentUser(state: AppState) {
  return state.profiles.find((profile) => profile.id === state.currentUserId) ?? null
}

export function getCurrentPeriod(state: AppState) {
  const reportingPeriods = getSortedReportingPeriods(state)

  if (!reportingPeriods.length) {
    return null
  }

  const referenceDate = new Date()
  const currentPeriod =
    reportingPeriods
      .filter((period) => parseISO(period.weekStart).getTime() <= referenceDate.getTime())
      .at(-1) ?? reportingPeriods[0]

  return currentPeriod
}

export function getVisibleReportingPeriods(state: AppState) {
  const currentPeriod = getCurrentPeriod(state)
  const reportingPeriods = getSortedReportingPeriods(state)

  if (!currentPeriod) {
    return []
  }

  const currentPeriodStart = parseISO(currentPeriod.weekStart).getTime()

  return reportingPeriods.filter(
    (period) => parseISO(period.weekStart).getTime() <= currentPeriodStart,
  )
}

export function getPreviousPeriod(state: AppState) {
  const currentPeriod = getCurrentPeriod(state)
  const reportingPeriods = getVisibleReportingPeriods(state)

  if (!currentPeriod) {
    return null
  }

  const currentPeriodIndex = reportingPeriods.findIndex(
    (period) => period.id === currentPeriod.id,
  )

  return currentPeriodIndex > 0 ? reportingPeriods[currentPeriodIndex - 1] : null
}

export function getCurrentAndPreviousPeriods(state: AppState) {
  return getReportingPeriodsBackwards(state, 2)
}

export function getReportingPeriodsBackwards(
  state: AppState,
  periodCount = 4,
  startPeriodId = getCurrentPeriod(state)?.id,
) {
  const reportingPeriods = getVisibleReportingPeriods(state)
  const startIndex = startPeriodId
    ? reportingPeriods.findIndex((period) => period.id === startPeriodId)
    : -1

  if (startIndex >= 0) {
    const startSlice = Math.max(0, startIndex - periodCount + 1)
    return reportingPeriods.slice(startSlice, startIndex + 1).reverse()
  }

  return reportingPeriods.slice(-periodCount).reverse()
}

export function getReportingPeriodsForRange(
  state: AppState,
  range: ReportingTimeRange,
  anchorPeriodId = getCurrentPeriod(state)?.id,
) {
  const reportingPeriods = getVisibleReportingPeriods(state)

  if (!reportingPeriods.length) {
    return []
  }

  const anchorIndex = anchorPeriodId
    ? reportingPeriods.findIndex((period) => period.id === anchorPeriodId)
    : -1
  const boundedAnchorIndex = anchorIndex >= 0 ? anchorIndex : reportingPeriods.length - 1
  const periodsThroughAnchor = reportingPeriods.slice(0, boundedAnchorIndex + 1)

  if (range === 'all') {
    return periodsThroughAnchor
  }

  const periodCount = range === 'last8' ? 8 : range === 'last4' ? 4 : 1
  return periodsThroughAnchor.slice(-periodCount)
}

export function getProfileById(state: AppState, userId: string) {
  return state.profiles.find((profile) => profile.id === userId) ?? null
}

export function getReportForAssignmentPeriod(
  state: AppState,
  assignmentId: string,
  reportingPeriodId: string,
) {
  return (
    state.reports.find(
      (report) =>
        report.assignmentId === assignmentId &&
        report.reportingPeriodId === reportingPeriodId,
    ) ?? null
  )
}

function deriveReportStatusForPeriod(
  period: AppState['reportingPeriods'][number] | null,
  state: Pick<AppState, 'settings'>,
  report: ReportRecord | null,
) {
  if (!period) {
    return 'not_started' as ReportStatus
  }

  const deadlinePassed = state.settings.deadlineEnforced
    ? isPastDeadline(
        period,
        state.settings.weeklyDeadlineDay,
        state.settings.weeklyDeadlineTime,
      )
    : false

  if (!report) {
    return deadlinePassed ? 'overdue' : 'not_started'
  }

  if (report.lockedAt || report.status === 'locked') {
    return 'locked'
  }

  if (report.status === 'draft' && deadlinePassed) {
    return 'overdue'
  }

  return report.status
}

function isMissingSummaryStatus(status: ReportStatus) {
  return status === 'not_started' || status === 'overdue'
}

const emptyStatusCounts: Record<ReportStatus, number> = {
  not_started: 0,
  draft: 0,
  submitted: 0,
  edited_after_submission: 0,
  locked: 0,
  overdue: 0,
}

function getScopedAssignments(state: AppState, family?: ReportFamily) {
  const scopedDepartments = departments.filter((department) =>
    family ? department.family === family : true,
  )
  const scopedDepartmentIds = new Set(scopedDepartments.map((department) => department.id))

  return state.assignments.filter(
    (assignment) => assignment.active && scopedDepartmentIds.has(assignment.departmentId),
  )
}

function createReportLookup(reports: ReportRecord[]) {
  const reportsByAssignmentPeriod = new Map<string, ReportRecord>()

  reports.forEach((report) => {
    reportsByAssignmentPeriod.set(`${report.assignmentId}:${report.reportingPeriodId}`, report)
  })

  return reportsByAssignmentPeriod
}

function getRangeStatusEntries(
  state: AppState,
  periods: ReportingPeriod[],
  family?: ReportFamily,
) {
  const scopedAssignments = getScopedAssignments(state, family)
  const reportsByAssignmentPeriod = createReportLookup(state.reports)

  return scopedAssignments.flatMap((assignment) =>
    periods.map((period) => {
      const report = reportsByAssignmentPeriod.get(`${assignment.id}:${period.id}`) ?? null

      return {
        assignment,
        period,
        report,
        status: deriveReportStatusForPeriod(period, state, report),
      }
    }),
  )
}

export function getReportingRangeSummary(
  state: AppState,
  range: ReportingTimeRange,
  anchorPeriodId = getCurrentPeriod(state)?.id,
  family?: ReportFamily,
) {
  const periods = getReportingPeriodsForRange(state, range, anchorPeriodId)

  if (!periods.length) {
    return null
  }

  const statusEntries = getRangeStatusEntries(state, periods, family)
  const statusCounts = statusEntries.reduce<Record<ReportStatus, number>>(
    (counts, entry) => ({
      ...counts,
      [entry.status]: counts[entry.status] + 1,
    }),
    { ...emptyStatusCounts },
  )

  return {
    periods,
    entries: statusEntries,
    statusCounts,
    metrics: {
      totalExpected: statusEntries.length,
      submitted: statusCounts.submitted,
      missing: statusCounts.not_started + statusCounts.overdue,
      editedAfterSubmission: statusCounts.edited_after_submission,
      locked: statusCounts.locked,
      unlocked: statusEntries.filter((entry) => entry.report && entry.status !== 'locked').length,
      draft: statusCounts.draft,
      notStarted: statusCounts.not_started,
      overdue: statusCounts.overdue,
    },
  }
}

export function deriveReportStatus(
  state: AppState,
  periodId: string,
  report: ReportRecord | null,
) {
  const period = state.reportingPeriods.find((candidate) => candidate.id === periodId)
  return deriveReportStatusForPeriod(period ?? null, state, report)
}

export function getAssignmentsForUser(state: AppState, userId: string) {
  return state.assignments.filter(
    (assignment) => assignment.nurseId === userId && assignment.active,
  )
}

export function getAssignmentCardsForPeriod(
  state: AppState,
  userId: string,
  periodId: string,
) {
  const period = getSortedReportingPeriods(state).find((candidate) => candidate.id === periodId)

  if (!period) {
    return []
  }

  return getAssignmentsForUser(state, userId)
    .map((assignment) => {
      const report = getReportForAssignmentPeriod(state, assignment.id, period.id)
      const department = departmentMap[assignment.departmentId]
      const template = templateMap[assignment.templateId]

      return {
        assignment,
        department,
        template,
        period,
        report,
        status: deriveReportStatus(state, period.id, report),
        updatedAt: report?.updatedAt ?? period.weekStart,
      }
    })
    .sort((left, right) => left.department.name.localeCompare(right.department.name))
}

export function getCurrentWeekAssignmentCards(state: AppState, userId: string) {
  const currentPeriod = getCurrentPeriod(state)

  if (!currentPeriod) {
    return []
  }

  return getAssignmentCardsForPeriod(state, userId, currentPeriod.id)
}

function sumField(report: ReportRecord, fieldId: string) {
  return getNumericTotal(report.values[fieldId]?.dailyValues ?? {})
}

function aggregateInpatientMetrics(reports: ReportRecord[], departmentsList: Department[]) {
  const totalPatientDays = reports.reduce(
    (sum, report) => sum + sumField(report, 'total_patient_days'),
    0,
  )
  const totalDischarges = reports.reduce(
    (sum, report) => sum + sumField(report, 'discharged_home') + sumField(report, 'discharged_ama'),
    0,
  )
  const totalBeds = departmentsList.reduce((sum, department) => sum + (department.bedCount ?? 0), 0)

  return {
    borPercent: totalBeds ? (totalPatientDays / (totalBeds * 30)) * 100 : null,
    btr: totalBeds ? totalDischarges / totalBeds : null,
    alos: totalDischarges ? totalPatientDays / totalDischarges : null,
  }
}

export function getDashboardSummary(
  state: AppState,
  periodId = getCurrentPeriod(state)?.id,
  family?: ReportFamily,
) {
  if (!periodId) {
    return null
  }

  const reportingPeriods = getSortedReportingPeriods(state)
  const period = reportingPeriods.find((candidate) => candidate.id === periodId)
  const previousPeriodIndex = reportingPeriods.findIndex(
    (candidate) => candidate.id === periodId,
  ) - 1
  const previousPeriod =
    previousPeriodIndex >= 0 ? reportingPeriods[previousPeriodIndex] : null

  if (!period) {
    return null
  }

  const scopedDepartments = departments.filter((department) =>
    family ? department.family === family : true,
  )
  const scopedDepartmentIds = new Set(scopedDepartments.map((department) => department.id))
  const scopedAssignments = state.assignments.filter((assignment) =>
    assignment.active && scopedDepartmentIds.has(assignment.departmentId),
  )
  const reportsByAssignmentPeriod = new Map<string, ReportRecord>()

  state.reports.forEach((report) => {
    reportsByAssignmentPeriod.set(`${report.assignmentId}:${report.reportingPeriodId}`, report)
  })

  const reportEntries = scopedAssignments.map((assignment) => {
    const report = reportsByAssignmentPeriod.get(`${assignment.id}:${period.id}`) ?? null
    return {
      assignment,
      report,
      status: deriveReportStatusForPeriod(period, state, report),
    }
  })

  const previousReports = previousPeriod
    ? scopedAssignments.map((assignment) => {
        const report =
          reportsByAssignmentPeriod.get(`${assignment.id}:${previousPeriod.id}`) ?? null
        return {
          assignment,
          report,
          status: deriveReportStatusForPeriod(previousPeriod, state, report),
        }
      })
    : []

  const currentReports = reportEntries
    .map((entry) => entry.report)
    .filter((report): report is ReportRecord => Boolean(report))
  const previousReportRecords = previousReports
    .map((entry) => entry.report)
    .filter((report): report is ReportRecord => Boolean(report))

  const currentInpatientDepartments = scopedDepartments.filter(
    (department) => department.family === 'inpatient',
  )
  const inpatientReports = currentReports.filter(
    (report) => departmentMap[report.departmentId].family === 'inpatient',
  )
  const previousInpatientReports = previousReports.filter(
    (entry) =>
      entry.report &&
      departmentMap[entry.report.departmentId].family === 'inpatient',
  )
    .map((entry) => entry.report)
    .filter((report): report is ReportRecord => Boolean(report))

  const inpatientMetrics = aggregateInpatientMetrics(
    inpatientReports,
    currentInpatientDepartments,
  )
  const previousInpatientMetrics = aggregateInpatientMetrics(
    previousInpatientReports,
    currentInpatientDepartments,
  )

  const metrics = {
    totalExpected: reportEntries.length,
    submitted: reportEntries.filter((entry) => entry.status === 'submitted').length,
    missing: reportEntries.filter((entry) => isMissingSummaryStatus(entry.status)).length,
    editedAfterSubmission: reportEntries.filter(
      (entry) => entry.status === 'edited_after_submission',
    ).length,
    locked: reportEntries.filter((entry) => entry.status === 'locked').length,
    unlocked: reportEntries.filter((entry) => entry.report && entry.status !== 'locked').length,
    borPercent: inpatientMetrics.borPercent,
    btr: inpatientMetrics.btr,
    alos: inpatientMetrics.alos,
    totalAdmissions: currentReports.reduce(
      (sum, report) =>
        sum +
        sumField(report, 'total_admitted_patients') +
        sumField(report, 'new_admitted_patients'),
      0,
    ),
    totalDischarges: currentReports.reduce(
      (sum, report) =>
        sum + sumField(report, 'discharged_home') + sumField(report, 'discharged_ama'),
      0,
    ),
    totalOutpatientVisits: currentReports.reduce(
      (sum, report) => sum + sumField(report, 'total_patients_seen'),
      0,
    ),
    noShowCount: currentReports.reduce(
      (sum, report) => sum + sumField(report, 'failed_to_come'),
      0,
    ),
    haiCount: currentReports.reduce((sum, report) => sum + sumField(report, 'total_hai'), 0),
  }

  const previousMetrics = {
    totalExpected: previousReports.length,
    submitted: previousReports.filter((entry) => entry.status === 'submitted').length,
    missing: previousReports.filter((entry) => isMissingSummaryStatus(entry.status)).length,
    editedAfterSubmission: previousReports.filter(
      (entry) => entry.status === 'edited_after_submission',
    ).length,
    locked: previousReports.filter((entry) => entry.status === 'locked').length,
    unlocked: previousReports.filter(
      (entry) => entry.report && entry.status !== 'locked',
    ).length,
    borPercent: previousInpatientMetrics.borPercent,
    btr: previousInpatientMetrics.btr,
    alos: previousInpatientMetrics.alos,
    totalAdmissions: previousReportRecords.reduce(
      (sum, report) =>
        sum +
        sumField(report, 'total_admitted_patients') +
        sumField(report, 'new_admitted_patients'),
      0,
    ),
    totalDischarges: previousReportRecords.reduce(
      (sum, report) =>
        sum + sumField(report, 'discharged_home') + sumField(report, 'discharged_ama'),
      0,
    ),
    totalOutpatientVisits: previousReportRecords.reduce(
      (sum, report) => sum + sumField(report, 'total_patients_seen'),
      0,
    ),
    noShowCount: previousReportRecords.reduce(
      (sum, report) => sum + sumField(report, 'failed_to_come'),
      0,
    ),
    haiCount: previousReportRecords.reduce(
      (sum, report) => sum + sumField(report, 'total_hai'),
      0,
    ),
  }

  return {
    period,
    current: metrics,
    previous: previousMetrics,
    deltas: {
      totalExpected: formatDelta(metrics.totalExpected, previousMetrics.totalExpected),
      submitted: formatDelta(metrics.submitted, previousMetrics.submitted),
      missing: formatDelta(metrics.missing, previousMetrics.missing),
      editedAfterSubmission: formatDelta(
        metrics.editedAfterSubmission,
        previousMetrics.editedAfterSubmission,
      ),
      locked: formatDelta(metrics.locked, previousMetrics.locked),
      unlocked: formatDelta(metrics.unlocked, previousMetrics.unlocked),
      borPercent: formatDelta(metrics.borPercent, previousMetrics.borPercent),
      btr: formatDelta(metrics.btr, previousMetrics.btr),
      alos: formatDelta(metrics.alos, previousMetrics.alos),
      totalAdmissions: formatDelta(metrics.totalAdmissions, previousMetrics.totalAdmissions),
      totalDischarges: formatDelta(metrics.totalDischarges, previousMetrics.totalDischarges),
      totalOutpatientVisits: formatDelta(
        metrics.totalOutpatientVisits,
        previousMetrics.totalOutpatientVisits,
      ),
      noShowCount: formatDelta(metrics.noShowCount, previousMetrics.noShowCount),
      haiCount: formatDelta(metrics.haiCount, previousMetrics.haiCount),
    },
  }
}

export function getTrendSeries(
  state: AppState,
  fieldId: string,
  family?: ReportFamily,
  departmentId?: string,
  options?: {
    anchorPeriodId?: string
    periodCount?: number
  },
) {
  const anchorPeriodId = options?.anchorPeriodId ?? getCurrentPeriod(state)?.id
  const periodCount = options?.periodCount ?? 8
  const reportingPeriods = getSortedReportingPeriods(state)
  const anchorIndex = anchorPeriodId
    ? reportingPeriods.findIndex((period) => period.id === anchorPeriodId)
    : -1
  const periods =
    anchorIndex >= 0
      ? reportingPeriods.slice(
          Math.max(0, anchorIndex - periodCount + 1),
          anchorIndex + 1,
        )
      : reportingPeriods.slice(-periodCount)

  return periods.map((period) => {
    const reports = state.reports.filter((report) => {
      if (report.reportingPeriodId !== period.id) {
        return false
      }
      if (family && departmentMap[report.departmentId].family !== family) {
        return false
      }
      if (departmentId && report.departmentId !== departmentId) {
        return false
      }
      return true
    })

    return {
      label: period.label,
      shortLabel: `${parseISO(period.weekStart).getMonth() + 1}/${parseISO(period.weekStart).getDate()}`,
      value: reports.reduce((sum, report) => sum + sumField(report, fieldId), 0),
    }
  })
}

export function getDepartmentComparisonData(
  state: AppState,
  family: ReportFamily,
  periodId = getCurrentPeriod(state)?.id,
) {
  if (!periodId) {
    return []
  }

  return departments
    .filter((department) => department.family === family)
    .map((department) => {
      const report = state.reports.find(
        (candidate) =>
          candidate.departmentId === department.id &&
          candidate.reportingPeriodId === periodId,
      )

      return {
        id: department.id,
        name: department.name,
        accent: department.accent,
        admissions: report
          ? sumField(report, 'total_admitted_patients') +
            sumField(report, 'new_admitted_patients')
          : 0,
        visits: report ? sumField(report, 'total_patients_seen') : 0,
        hai: report ? sumField(report, 'total_hai') : 0,
        noShow: report ? sumField(report, 'failed_to_come') : 0,
        borPercent: report?.calculatedMetrics.borPercent ?? 0,
      }
    })
}

export function getSubmissionBoard(
  state: AppState,
  periodCount = 4,
  startPeriodId = getCurrentPeriod(state)?.id,
) {
  const periods = getReportingPeriodsBackwards(state, periodCount, startPeriodId)

  return state.assignments
    .filter((assignment) => assignment.active)
    .map((assignment) => ({
      assignment,
      department: departmentMap[assignment.departmentId],
      template: templateMap[assignment.templateId],
      statuses: periods.map((period) => {
        const report = getReportForAssignmentPeriod(state, assignment.id, period.id)
      return {
        period,
        report,
          status: deriveReportStatus(state, period.id, report),
        }
      }),
    }))
}

export function getNurseSubmissionBoard(state: AppState, userId: string) {
  const visiblePeriods = getVisibleReportingPeriods(state)
  const periods = getReportingPeriodsBackwards(state, visiblePeriods.length)

  if (!periods.length) {
    return []
  }

  return getAssignmentsForUser(state, userId).map((assignment) => ({
    assignment,
    department: departmentMap[assignment.departmentId],
    template: templateMap[assignment.templateId],
    statuses: periods.map((period) => {
      const report = getReportForAssignmentPeriod(state, assignment.id, period.id)

      return {
        period,
        report,
        status: deriveReportStatus(state, period.id, report),
      }
    }),
  }))
}

export function getRecentNotifications(state: AppState, userId: string, count = 6) {
  return state.notifications
    .filter((notification) => notification.userId === userId)
    .slice(0, count)
}

export function getUnreadNotificationCount(state: AppState, userId: string) {
  return state.notifications.filter(
    (notification) => notification.userId === userId && !notification.readAt,
  ).length
}

export function getWhatChangedThisWeek(
  state: AppState,
  family?: ReportFamily,
  departmentId?: string,
) {
  const currentPeriod = getCurrentPeriod(state)
  const previousPeriod = getPreviousPeriod(state)

  if (!currentPeriod || !previousPeriod) {
    return []
  }

  const insights: string[] = []

  state.assignments.forEach((assignment) => {
    if (departmentId && assignment.departmentId !== departmentId) {
      return
    }
    if (family && departmentMap[assignment.departmentId].family !== family) {
      return
    }

    const department = departmentMap[assignment.departmentId]
    const template = templateMap[assignment.templateId]
    const currentReport = getReportForAssignmentPeriod(state, assignment.id, currentPeriod.id)
    const previousReport = getReportForAssignmentPeriod(state, assignment.id, previousPeriod.id)

    template.changeRules.forEach((rule) => {
      if (!rule.fieldId || !currentReport || !previousReport) {
        return
      }

      const currentValue = sumField(currentReport, rule.fieldId)
      const previousValue = sumField(previousReport, rule.fieldId)
      const delta = formatDelta(currentValue, previousValue)

      if (delta !== null && Math.abs(delta) >= rule.percentThreshold) {
        insights.push(
          rule.messageTemplate
            .replace('{department}', department.name)
            .replace('{deltaPercent}', Math.round(delta).toString())
            .replace('{currentValue}', String(currentValue))
            .replace('{previousValue}', String(previousValue)),
        )
      }

      if (
        state.settings.criticalNonZeroFields.includes(rule.fieldId) &&
        currentValue > 0 &&
        previousValue === 0
      ) {
        insights.push(`${department.name} reported a new non-zero critical event for ${rule.fieldId.replaceAll('_', ' ')}.`)
      }
    })

    const currentStatus = deriveReportStatus(state, currentPeriod.id, currentReport)
    if (currentStatus === 'edited_after_submission') {
      const historyEntry = state.statusHistory.find(
        (entry) =>
          entry.reportId === currentReport?.id &&
          entry.status === 'edited_after_submission',
      )
      if (historyEntry) {
        insights.push(
          `${department.name} was edited after submission by ${historyEntry.changedByName} at ${historyEntry.changedAt.slice(11, 16)}.`,
        )
      }
    }
  })

  return insights.slice(0, 8)
}

export function getDepartmentDetail(
  state: AppState,
  departmentId: string,
  options?: {
    range?: ReportingTimeRange
    anchorPeriodId?: string
  },
) {
  const department = departmentMap[departmentId]
  const reportingPeriods = getVisibleReportingPeriods(state)
  const fallbackPeriod = getCurrentPeriod(state)
  const period =
    reportingPeriods.find((candidate) => candidate.id === options?.anchorPeriodId) ??
    fallbackPeriod
  const periodIndex = period
    ? reportingPeriods.findIndex((candidate) => candidate.id === period.id)
    : -1
  const previousPeriod = periodIndex > 0 ? reportingPeriods[periodIndex - 1] : null
  const rangePeriods = getReportingPeriodsForRange(
    state,
    options?.range ?? 'last8',
    period?.id,
  )
  const assignment = state.assignments.find(
    (candidate) => candidate.departmentId === departmentId,
  )

  if (!department || !period || !assignment) {
    return null
  }

  const currentReport = getReportForAssignmentPeriod(state, assignment.id, period.id)
  const previousReport = previousPeriod
    ? getReportForAssignmentPeriod(state, assignment.id, previousPeriod.id)
    : null
  const rangeReports = rangePeriods
    .map((rangePeriod) => getReportForAssignmentPeriod(state, assignment.id, rangePeriod.id))
    .filter((report): report is ReportRecord => Boolean(report))
  const activitySourceId =
    department.family === 'inpatient'
      ? 'total_admitted_patients'
      : department.family === 'outpatient'
        ? 'total_patients_seen'
        : templateMap[department.templateId].summaryCards[0]?.sourceId ?? ''

  return {
    department,
    template: templateMap[department.templateId],
    assignment,
    period,
    rangePeriods,
    rangeReports,
    currentReport,
    previousReport,
    currentStatus: deriveReportStatus(state, period.id, currentReport),
    trends: {
      activity: rangePeriods.map((rangePeriod) => {
        const report = getReportForAssignmentPeriod(state, assignment.id, rangePeriod.id)

        return {
          label: rangePeriod.label,
          shortLabel: `${parseISO(rangePeriod.weekStart).getMonth() + 1}/${parseISO(rangePeriod.weekStart).getDate()}`,
          value: report ? sumField(report, activitySourceId) : 0,
        }
      }),
    },
    insights: getWhatChangedThisWeek(state, department.family, department.id),
    auditHighlights: state.auditLogs.filter((log) => log.departmentId === departmentId).slice(0, 6),
  }
}

export function getAllTemplatesByFamily() {
  return reportTemplates.reduce<Record<ReportFamily, typeof reportTemplates>>(
    (accumulator, template) => {
      accumulator[template.family] = [
        ...(accumulator[template.family] ?? []),
        template,
      ]
      return accumulator
    },
    {
      inpatient: [],
      outpatient: [],
      procedure: [],
    },
  )
}

export function getLockDeadlineNote(state: AppState, periodId: string) {
  if (!state.settings.deadlineEnforced) {
    return null
  }

  const period = state.reportingPeriods.find((candidate) => candidate.id === periodId)

  if (!period) {
    return null
  }

  return getDeadlineForPeriod(
    period,
    state.settings.weeklyDeadlineDay,
    state.settings.weeklyDeadlineTime,
  )
}
