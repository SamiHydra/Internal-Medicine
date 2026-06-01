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

export type SubmitAdminAccessRequestPayload = {
  fullName: string
  email: string
  password: string
  notes?: string
}

export type AdminAccessRequest = {
  id: string
  fullName: string
  email: string
  requestedRole: string
  status: 'pending' | 'approved' | 'rejected'
  notes: string | null
  requestedAt: string | null
  reviewedAt: string | null
  reviewedBy: string | null
  reviewedByName: string | null
  createdUserId: string | null
}

export type CreateAdminAccountPayload = {
  fullName: string
  username: string
  email: string
  password: string
  role: Extract<UserRole, 'admin'>
  title?: string
}

export type ApiReferenceState = {
  departmentDbIdBySlug: Record<string, string>
  templateDbIdBySlug: Record<string, string>
  templateDbIdByDepartmentSlug: Record<string, string>
}

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

// ---------------------------------------------------------------------------
// Academic module — camelCase shapes mirroring the Laravel serializer exactly.
// ---------------------------------------------------------------------------

export type AcademicDirection = 'consultant' | 'resident'

export type AcademicRole = 'resident' | 'consultant'

export type AcademicGranularity = 'weekly' | 'monthly'

export type AcademicFormOptions = {
  subjects: Array<{
    id: string
    fullName: string
    homeWardId: string | null
    homeWardName: string | null
  }>
  wards: Array<{
    id: string
    name: string
    slug: string
  }>
}

export type SaveConsultantEvaluationPayload = {
  evaluationDate: string
  wardId: string
  subjectId: string
  seniorPresent: boolean
  seniorJoinedAt?: string | null
  presenceMinutes?: number | null
  allPatientsReviewed: boolean
  mgmtPlanDocumented: boolean
  vteAssessed: boolean
  dischargeDiscussed: boolean
  medReviewDone: boolean
  criticalLabsReviewed: boolean
  pctPatientsSeen?: number | null
  roundDelayed: boolean
  mdtParticipants: string[]
  systemIssues: string[]
  comment?: string | null
}

export type ConsultantEvaluationRecord = {
  id: string
  authorId: string
  authorName: string | null
  subjectId: string
  subjectName: string | null
  wardId: string
  wardName: string | null
  evaluationDate: string | null
  seniorPresent: boolean
  seniorJoinedAt: string | null
  presenceMinutes: number | null
  allPatientsReviewed: boolean
  mgmtPlanDocumented: boolean
  vteAssessed: boolean
  dischargeDiscussed: boolean
  medReviewDone: boolean
  criticalLabsReviewed: boolean
  pctPatientsSeen: number | null
  roundDelayed: boolean
  mdtParticipants: string[]
  systemIssues: string[]
  comment: string | null
  qualityScore: number
  createdAt: string | null
  updatedAt: string | null
}

export type SaveResidentEvaluationPayload = {
  evaluationDate: string
  wardId: string
  subjectId: string
  onTime: boolean
  prepared: boolean
  presentationClear: boolean
  clinicalReasoning: boolean
  managementPlan: boolean
  documentationTimely: boolean
  communication: boolean
  professional: boolean
  responsiveFeedback: boolean
  followThrough: boolean
  overallRating: number
  concerns: string[]
  comment?: string | null
}

export type ResidentEvaluationRecord = {
  id: string
  authorId: string
  authorName: string | null
  subjectId: string
  subjectName: string | null
  wardId: string
  wardName: string | null
  evaluationDate: string | null
  onTime: boolean
  prepared: boolean
  presentationClear: boolean
  clinicalReasoning: boolean
  managementPlan: boolean
  documentationTimely: boolean
  communication: boolean
  professional: boolean
  responsiveFeedback: boolean
  followThrough: boolean
  overallRating: number | null
  concerns: string[]
  comment: string | null
  performanceScore: number
  createdAt: string | null
  updatedAt: string | null
}

export type AcademicEvaluationRecord =
  | ConsultantEvaluationRecord
  | ResidentEvaluationRecord

export type AcademicIndicatorCompliance = {
  key: string
  label: string
  pct: number
}

export type AcademicIssueFrequency = {
  value: string
  label: string
  count: number
}

export type AcademicSummary = {
  direction: AcademicDirection
  evaluationCount: number
  averageScore: number
  indicatorCompliance: AcademicIndicatorCompliance[]
  issueFrequency: AcademicIssueFrequency[]
  // consultant direction only
  seniorPresenceRate?: number
  avgPctSeen?: number
  // resident direction only
  avgOverallRating?: number
}

export type AcademicTrendPoint = {
  bucket: string
  start: string
  averageScore: number
  count: number
}

export type AcademicTrend = {
  direction: AcademicDirection
  granularity: AcademicGranularity
  points: AcademicTrendPoint[]
}

export type AcademicPersonStat = {
  subjectId: string
  subjectName: string | null
  homeWardName: string | null
  evaluationCount: number
  averageScore: number
}

export type AcademicPeople = {
  direction: AcademicDirection
  people: AcademicPersonStat[]
}

export type AcademicMySubmissions =
  | { direction: 'consultant'; data: ConsultantEvaluationRecord[] }
  | { direction: 'resident'; data: ResidentEvaluationRecord[] }
  | { direction: null; data: [] }

/** A resident/consultant's own received-evaluation aggregates (no evaluator identities). */
export type AcademicPerformance =
  | { direction: AcademicDirection; summary: AcademicSummary; trend: AcademicTrend }
  | { direction: null; summary: null; trend: null }

export type AcademicEvaluationListResponse = {
  direction: AcademicDirection
  data: AcademicEvaluationRecord[]
  meta: {
    currentPage: number
    lastPage: number
    perPage: number
    total: number
  }
}

export type SubmitAcademicRegistrationPayload = {
  fullName: string
  email: string
  password: string
  role: AcademicRole
  homeWardId?: string | null
  notes?: string | null
}

export type AcademicRegistrationResult = {
  signedIn: boolean
  role: AcademicRole
}

export type AcademicAnalyticsQuery = {
  direction?: AcademicDirection
  wardId?: string
  subjectId?: string
  dateFrom?: string
  dateTo?: string
  granularity?: AcademicGranularity
}

export type AcademicListQuery = {
  direction?: AcademicDirection
  subjectId?: string
  wardId?: string
  dateFrom?: string
  dateTo?: string
  page?: number
  perPage?: number
}
