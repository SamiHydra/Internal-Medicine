import type {
  AccessRequest,
  AppSettings,
  AppState,
  Department,
  NotificationItem,
  ReportFieldValue,
  ReportRecord,
  ReportTemplateConfig,
  UserProfile,
  UserRole,
} from '@/types/domain'

export type SaveReportPayload = {
  assignmentId: string
  reportingPeriodId: string
  actorId: string
  values: Record<string, ReportFieldValue>
  submit?: boolean
}

export type AccessRequestPayload = {
  fullName: string
  email: string
  password?: string
  requestedAssignments: AccessRequest['requestedAssignments']
  notes?: string
}

export type ClaimSuperadminPayload = {
  fullName: string
  username: string
  email: string
  password: string
}

export type ClaimSuperadminResult = {
  currentEmail: string
  pendingEmail: string | null
}

export type CreateAdminAccountPayload = {
  fullName: string
  username: string
  email: string
  password: string
  role: Extract<UserRole, 'admin' | 'doctor_admin'>
  title?: string
}

export type ApiReferenceState = {
  departmentDbIdBySlug: Record<string, string>
  templateDbIdBySlug: Record<string, string>
  templateDbIdByDepartmentSlug: Record<string, string>
}

export type SupabaseReferenceState = ApiReferenceState

export type LiveAppStateLoadOptions = {
  includeProfiles?: boolean
  includeAccessRequests?: boolean
  includeHistory?: boolean
}

export type ReportDetailRecord = Pick<ReportRecord, 'values' | 'calculatedMetrics'>

export type WorkspacePayload = {
  currentUser: UserProfile
  references: ApiReferenceState
  state: AppState
}

export type SessionPayload = {
  user: UserProfile & {
    roleLabel?: string
    passwordChangeRequired?: boolean
    lastLoginAt?: string | null
  }
  assignments?: Array<{
    id: string
    nurseId: string
    departmentId: string
    departmentSlug?: string | null
    departmentName?: string | null
    departmentFamily?: string | null
    templateId: string
    templateSlug?: string | null
    templateName?: string | null
    active: boolean
    approvedAt?: string | null
  }>
  permissions?: string[]
}

export type ReportResponse = ReportRecord & {
  departmentSlug?: string | null
  templateSlug?: string | null
  calculatedMetrics: ReportRecord['calculatedMetrics'] & {
    payload?: unknown
  }
}

export type ListResponse<T> = {
  data: T[]
}

export type SettingsResponse = {
  settings: AppSettings
}

export type DepartmentReferencePayload = {
  department: Department
  template: ReportTemplateConfig
}

export type NotificationRestorePayload = {
  notifications: NotificationItem[]
}
