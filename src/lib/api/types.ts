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
  trainingYear: number | null
  rotationGroup: string | null
  status: 'pending' | 'approved' | 'rejected'
  notes: string | null
  requestedAt: string | null
  reviewedAt: string | null
  reviewedBy: string | null
  reviewedByName: string | null
  createdUserId: string | null
}

// Admin-created accounts. Every other role reaches the system through public
// signup plus an approval queue; these two cannot. `admin` predates that flow,
// and `student_rep` is appointed rather than self-declared, so it has no public
// registration path at all and an administrator is the only way to mint one.
export type CreateAdminAccountPayload = {
  fullName: string
  username: string
  email: string
  password: string
  role: Extract<UserRole, 'admin' | 'student_rep'>
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
  reportPeriodWindow?: 'default' | 'all'
}

export type ReportDetailRecord = Pick<ReportRecord, 'values' | 'calculatedMetrics' | 'quality'>

/** A field definition as serialized by the backend (serializeFieldDefinition). */
export type ApiTemplateField = {
  id: string
  templateId: string
  sectionKey: string
  fieldKey: string
  label: string
  fieldKind: 'integer' | 'decimal' | 'time' | 'text' | 'choice'
  aggregateType: 'sum' | 'average' | 'latest' | 'none'
  displayOrder: number
  active?: boolean
  metadata?: {
    unit?: string
    highlightWhenNonZero?: boolean
    readOnlyWeeklyTotal?: boolean
    options?: string[]
    description?: string
  } | null
}

/** A template as serialized by the backend (serializeTemplate), incl. presentation metadata. */
export type ApiTemplateConfig = {
  id: string
  slug: string
  family: 'inpatient' | 'outpatient' | 'procedure'
  name: string
  description: string
  activeDays: string[]
  active?: boolean
  metadata?: {
    presentation?: {
      sections?: ReportTemplateConfig['sections']
      summaryCards?: ReportTemplateConfig['summaryCards']
      chartMappings?: ReportTemplateConfig['chartMappings']
      changeRules?: ReportTemplateConfig['changeRules']
    }
  } | null
  fields: ApiTemplateField[]
}

/** The academic slice of the workspace bootstrap (V2 guide 3.7). */
export type AcademicWorkspaceState = {
  currentPlacement: {
    dutyTypeName: string | null
    wardId: string | null
    wardName: string | null
    endsOn: string | null
  } | null
  isMorningRecorder: boolean
  headsSections: string[]
  repScope: { batchId: string; cohort: string; scope: string } | null
  pendingTransferCount: number
  academicSetup: {
    calendarsMissing: boolean
    consultantsWithoutSection: number
    peopleWithoutAssignment: number
    mixedRotationCells: number
    rotationCellsNeedingReview: number
    activeRotationOverrides: number
  } | null
}

export type WorkspacePayload = {
  revision: string
  revisionToken: string
  currentUser: UserProfile
  academic?: AcademicWorkspaceState
  references: ApiReferenceState
  // The backend embeds hydrated template definitions under state.templates; the
  // SPA overlays these (DB edits) over the static config floor at parse time.
  state: AppState & { templates?: ApiTemplateConfig[] }
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

export type ReportSummaryResponse = Omit<ReportResponse, 'values' | 'calculatedMetrics' | 'quality'>

export type ListResponse<T> = {
  data: T[]
  meta?: {
    currentPage: number
    lastPage: number
    perPage: number
    total: number
  }
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
// Academic module - camelCase shapes mirroring the Laravel serializer exactly.
// ---------------------------------------------------------------------------

export type AcademicDirection = 'consultant' | 'resident'

export type AcademicRole = 'resident' | 'consultant'

export type AcademicGranularity = 'weekly' | 'monthly'

export type AcademicFormOptions = {
  /** The date the eligibility was resolved for (defaults to today). */
  date: string
  // Only the people the author shares a ward or paired duty with on `date`
  // (V2 Phase 3): the server never returns anyone else, and the client never
  // filters.
  subjects: Array<{
    id: string
    fullName: string
  }>
  wards: Array<{
    id: string
    name: string
    slug: string
  }>
  currentPlacement: {
    dutyTypeName: string | null
    wardId: string | null
    wardName: string | null
    endsOn: string | null
  } | null
}

export type SaveConsultantEvaluationPayload = {
  evaluationDate: string
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

/** An answer to an admin-added form field the fixed record shape does not know about. */
export type ExtraEvaluationAnswer = {
  key: string
  label: string
  value: unknown
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
  overallRating: number | null
  comment: string | null
  qualityScore: number
  extraAnswers?: ExtraEvaluationAnswer[]
  createdAt: string | null
  updatedAt: string | null
}

export type SaveResidentEvaluationPayload = {
  evaluationDate: string
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
  extraAnswers?: ExtraEvaluationAnswer[]
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
  /** Mean 1-to-5 overall rating; null when none of the evaluations carry one. */
  ratingAverage: number | null
  /** The rating normalised to 0-100 (rating / 5 * 100); null when unrated. */
  ratingScore: number | null
  /** How many of the evaluations carried a rating (rest are legacy/unrated). */
  ratedCount: number
  /** Equal-weight blend of ratingScore and averageScore; the rank value. */
  combinedScore: number
  /** True when evaluationCount is below the confidence threshold. */
  provisional: boolean
}

export type AcademicPeople = {
  direction: AcademicDirection
  /** Weight given to the rating half of the combined score (0-1). */
  ratingWeight: number
  /** Below this evaluation count a person is flagged provisional. */
  minEvaluationsForRank: number
  people: AcademicPersonStat[]
}

export type AcademicAnalyticsSnapshot = {
  summary: AcademicSummary
  trend: AcademicTrend
  people: AcademicPeople
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

export type AcademicAuditEntry = {
  id: string
  direction: AcademicDirection
  authorId: string
  authorName: string | null
  subjectId: string
  subjectName: string | null
  wardId: string
  wardName: string | null
  evaluationDate: string | null
  createdAt: string | null
  overallRating: number | null
  indicatorsMet: number
  indicatorsTotal: number
}

export type AcademicAuditResponse = {
  data: AcademicAuditEntry[]
}

export type AuditWorkspace = 'clinical' | 'academic' | 'system'

export type AdminAuditEntry = {
  id: string
  userId: string | null
  userName: string | null
  action: string
  /** Server-rendered from the audit registry - never humanized client-side. */
  actionLabel: string
  entityType: string
  entityLabel: string
  workspace: AuditWorkspace
  entityId: string | null
  oldValues: Record<string, unknown> | null
  newValues: Record<string, unknown> | null
  ipAddress: string | null
  userAgent: string | null
  createdAt: string | null
}

export type AdminAuditEntityOption = {
  value: string
  label: string
  workspace: AuditWorkspace
}

export type AdminAuditResponse = {
  data: AdminAuditEntry[]
  meta: {
    entityTypes: AdminAuditEntityOption[]
    actors: Array<{ id: string; name: string }>
  }
}

export type AdminAuditQuery = {
  workspace?: 'clinical' | 'academic'
  entityType?: string
  userId?: string
  action?: string
  search?: string
  dateFrom?: string
  dateTo?: string
  limit?: number
}

export type ActionItemStatus = 'open' | 'in_progress' | 'resolved'

export type ActionItem = {
  id: string
  reportId: string | null
  departmentId: string | null
  departmentName: string | null
  source: string
  title: string
  description: string | null
  severity: 'low' | 'medium' | 'high'
  status: ActionItemStatus
  assignedTo: string | null
  assignedToName: string | null
  createdBy: string | null
  createdByName: string | null
  resolvedBy: string | null
  resolvedByName: string | null
  resolutionNote: string | null
  resolvedAt: string | null
  createdAt: string | null
  updatedAt: string | null
}

export type ReportComment = {
  id: string
  reportId: string
  parentId: string | null
  authorId: string
  authorName: string
  authorRole: string | null
  body: string
  createdAt: string | null
  updatedAt: string | null
}

export type SubmitAcademicRegistrationPayload = {
  fullName: string
  email: string
  password: string
  role: AcademicRole
  trainingYear?: number | null
  homeWardId?: string | null
  notes?: string | null
}

export type AcademicRegistrationResult = {
  status: 'pending'
  message: string
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
  /** Evaluations written ABOUT this person. */
  subjectId?: string
  /** Evaluations written BY this person; the mirror of subjectId. */
  authorId?: string
  wardId?: string
  dateFrom?: string
  dateTo?: string
  page?: number
  perPage?: number
}
