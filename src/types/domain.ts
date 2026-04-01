export type UserRole = 'admin' | 'doctor_admin' | 'nurse'

export type ReportFamily = 'inpatient' | 'outpatient' | 'procedure'

export type ReportStatus =
  | 'not_started'
  | 'draft'
  | 'submitted'
  | 'edited_after_submission'
  | 'locked'
  | 'overdue'

export type StoredReportStatus =
  | 'draft'
  | 'submitted'
  | 'edited_after_submission'
  | 'locked'

export type AccessRequestStatus = 'pending' | 'approved' | 'rejected'

export type NotificationType =
  | 'new_report_submitted'
  | 'submitted_report_edited'
  | 'report_locked'
  | 'report_unlocked'
  | 'overdue_report'
  | 'nurse_access_request'
  | 'access_request_reviewed'

export type Weekday =
  | 'monday'
  | 'tuesday'
  | 'wednesday'
  | 'thursday'
  | 'friday'
  | 'saturday'
  | 'sunday'

export type FieldKind = 'integer' | 'decimal' | 'time' | 'text' | 'choice'

export type FieldAggregate = 'sum' | 'average' | 'latest' | 'none'

export type MetricFormat = 'integer' | 'decimal' | 'percent' | 'days' | 'months'

export interface UserProfile {
  id: string
  fullName: string
  email: string
  role: UserRole
  title: string
  active: boolean
  phone?: string
  avatar?: string
}

export interface Department {
  id: string
  name: string
  family: ReportFamily
  templateId: string
  description: string
  accent: string
  bedCount?: number
}

export interface ReportTemplateField {
  id: string
  label: string
  sectionId: string
  kind: FieldKind
  aggregate: FieldAggregate
  description?: string
  unit?: string
  readOnlyWeeklyTotal?: boolean
  highlightWhenNonZero?: boolean
  options?: string[]
}

export interface TemplateSection {
  id: string
  title: string
  description: string
}

export interface SummaryCardConfig {
  id: string
  label: string
  sourceType: 'field' | 'metric'
  sourceId: string
  format?: MetricFormat | 'time' | 'text'
}

export interface ChartSeriesConfig {
  sourceType: 'field' | 'metric'
  sourceId: string
  label: string
  color: string
}

export interface ChartMappingConfig {
  id: string
  title: string
  chartType: 'line' | 'bar' | 'stacked-bar'
  series: ChartSeriesConfig[]
}

export interface ChangeWatchRule {
  fieldId?: string
  metricId?: string
  percentThreshold: number
  messageTemplate: string
}

export interface ReportTemplateConfig {
  id: string
  family: ReportFamily
  name: string
  description: string
  activeDays: Weekday[]
  sections: TemplateSection[]
  fields: ReportTemplateField[]
  summaryCards: SummaryCardConfig[]
  chartMappings: ChartMappingConfig[]
  changeRules: ChangeWatchRule[]
}

export interface ReportAssignment {
  id: string
  nurseId: string
  departmentId: string
  templateId: string
  approvedAt: string
  active: boolean
}

export interface AccessRequest {
  id: string
  userId: string
  userName: string
  email: string
  requestedAssignments: Array<{
    departmentId: string
    templateId: string
  }>
  status: AccessRequestStatus
  requestedAt: string
  reviewedAt?: string
  notes?: string
}

export interface ReportingPeriod {
  id: string
  weekStart: string
  weekEnd: string
  label: string
  deadlineAt?: string
}

export type CellValue = number | string | null

export interface ReportFieldValue {
  fieldId: string
  dailyValues: Partial<Record<Weekday, CellValue>>
}

export interface CalculatedMetricSet {
  borPercent: number | null
  btr: number | null
  alos: number | null
}

export interface ReportRecord {
  id: string
  assignmentId: string
  departmentId: string
  templateId: string
  reportingPeriodId: string
  createdById: string
  updatedById: string
  createdAt: string
  updatedAt: string
  submittedAt: string | null
  lockedAt: string | null
  status: StoredReportStatus
  values: Record<string, ReportFieldValue>
  calculatedMetrics: Partial<CalculatedMetricSet>
}

export interface ReportStatusHistoryEntry {
  id: string
  reportId: string
  status: ReportStatus
  changedById: string
  changedByName: string
  changedAt: string
  note?: string
}

export interface AuditLogEntry {
  id: string
  reportId: string
  fieldId: string
  fieldLabel: string
  oldValue: string | number | null
  newValue: string | number | null
  changedById: string
  changedByName: string
  changedAt: string
  departmentId: string
  templateId: string
}

export interface NotificationItem {
  id: string
  userId: string
  type: NotificationType
  title: string
  message: string
  createdAt: string
  readAt: string | null
  relatedRoute: string
  relatedReportId?: string
}

export interface AppSettings {
  weeklyDeadlineDay: Weekday
  weeklyDeadlineTime: string
  autoLockHoursAfterDeadline: number
  notableRiseThresholdPercent: number
  notableDropThresholdPercent: number
  criticalNonZeroFields: string[]
}

export interface PendingDraftState {
  reportId: string
  assignmentId: string
  reportingPeriodId: string
  lastSavedAt: string
}

export interface AppState {
  currentUserId: string | null
  profiles: UserProfile[]
  assignments: ReportAssignment[]
  accessRequests: AccessRequest[]
  reportingPeriods: ReportingPeriod[]
  reports: ReportRecord[]
  statusHistory: ReportStatusHistoryEntry[]
  auditLogs: AuditLogEntry[]
  notifications: NotificationItem[]
  settings: AppSettings
  pendingDrafts: PendingDraftState[]
}
