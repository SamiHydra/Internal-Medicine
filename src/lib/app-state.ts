import type { AppSettings, AppState } from '@/types/domain'

export const defaultAppSettings: AppSettings = {
  weeklyDeadlineDay: 'monday',
  weeklyDeadlineTime: '10:00',
  autoLockHoursAfterDeadline: 36,
  notableRiseThresholdPercent: 10,
  notableDropThresholdPercent: 10,
  criticalNonZeroFields: [
    'new_deaths',
    'new_pressure_ulcer',
    'total_hai',
    'hai_clabsi',
    'hai_cauti',
    'hai_vap',
  ],
}

export function createEmptyAppState(): AppState {
  return {
    currentUserId: null,
    profiles: [],
    assignments: [],
    accessRequests: [],
    reportingPeriods: [],
    reports: [],
    statusHistory: [],
    auditLogs: [],
    notifications: [],
    settings: defaultAppSettings,
    pendingDrafts: [],
  }
}
