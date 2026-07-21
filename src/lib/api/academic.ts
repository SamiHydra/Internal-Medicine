import type { LaravelApiClient } from '@/lib/api/client'
import type {
  AcademicAnalyticsQuery,
  AcademicAuditResponse,
  AcademicEvaluationListResponse,
  AcademicFormOptions,
  AcademicListQuery,
  AcademicMySubmissions,
  AcademicPeople,
  AcademicPerformance,
  AcademicRegistrationResult,
  AcademicSummary,
  AcademicTrend,
  ConsultantEvaluationRecord,
  ResidentEvaluationRecord,
  SaveConsultantEvaluationPayload,
  SaveResidentEvaluationPayload,
  SubmitAcademicRegistrationPayload,
} from '@/lib/api/types'

export function fetchAcademicFormOptions(client: LaravelApiClient, date?: string) {
  return client.get<AcademicFormOptions>('/api/academic/form-options', {
    query: date ? { date } : undefined,
  })
}

export function submitConsultantEvaluation(
  client: LaravelApiClient,
  payload: SaveConsultantEvaluationPayload,
) {
  return client.post<ConsultantEvaluationRecord>(
    '/api/academic/consultant-evaluations',
    payload,
  )
}

export function submitResidentEvaluation(
  client: LaravelApiClient,
  payload: SaveResidentEvaluationPayload,
) {
  return client.post<ResidentEvaluationRecord>(
    '/api/academic/resident-evaluations',
    payload,
  )
}

export function fetchMySubmissions(client: LaravelApiClient) {
  return client.get<AcademicMySubmissions>('/api/academic/my-submissions')
}

/** The authenticated resident/consultant's own received-evaluation aggregates. */
export function fetchMyAcademicPerformance(client: LaravelApiClient) {
  return client.get<AcademicPerformance>('/api/academic/my-performance')
}

/**
 * Public self-enrollment for residents and consultants. Creates a pending
 * request only, on the same queue as admin signups; no account exists until an
 * approver approves it.
 */
export function submitAcademicRegistration(
  client: LaravelApiClient,
  payload: SubmitAcademicRegistrationPayload,
) {
  return client.post<AcademicRegistrationResult>('/api/academic-access-requests', payload)
}

export type AcademicWardOption = { id: string; name: string; slug: string }

/**
 * Ward options for the admin dashboards. Since Phase 4 evaluations snapshot
 * the PHYSICAL teaching ward (the `wards` vocabulary), the filters list those
 * rather than inpatient reporting departments.
 */
export async function fetchAcademicWardOptions(
  client: LaravelApiClient,
): Promise<AcademicWardOption[]> {
  const response = await client.get<{
    data: Array<{ id: string; name: string; slug: string; active?: boolean }>
  }>('/api/admin/academic/wards')

  return response.data
    .filter((ward) => ward.active !== false)
    .map((ward) => ({
      id: ward.id,
      name: ward.name,
      slug: ward.slug,
    }))
}

export function fetchAcademicSummary(
  client: LaravelApiClient,
  query: AcademicAnalyticsQuery = {},
) {
  return client.get<AcademicSummary>('/api/academic/analytics/summary', { query })
}

export function fetchAcademicTrend(
  client: LaravelApiClient,
  query: AcademicAnalyticsQuery = {},
) {
  return client.get<AcademicTrend>('/api/academic/analytics/trend', { query })
}

export function fetchAcademicPeople(
  client: LaravelApiClient,
  query: AcademicAnalyticsQuery = {},
) {
  return client.get<AcademicPeople>('/api/academic/analytics/people', { query })
}

export function listAcademicEvaluations(
  client: LaravelApiClient,
  query: AcademicListQuery = {},
) {
  return client.get<AcademicEvaluationListResponse>(
    '/api/admin/academic/evaluations',
    { query },
  )
}

/** Chronological evaluation-activity feed for the admin Audit Log (academic workspace). */
export function fetchAcademicAuditTrail(client: LaravelApiClient) {
  return client.get<AcademicAuditResponse>('/api/admin/academic/audit')
}

// ---- The evaluation form engine (V2 Phase 4) ----

export type EvaluationFieldType =
  | 'boolean'
  | 'rating'
  | 'percent'
  | 'integer'
  | 'time'
  | 'text'
  | 'single_select'
  | 'multi_select'

export type EvaluationFormField = {
  id: string
  section: string
  key: string
  label: string
  helpText: string | null
  type: EvaluationFieldType
  options: {
    min?: number
    max?: number
    choices?: Array<{ value: string; label: string }>
  } | null
  required: boolean
  sortOrder: number
  active: boolean
  isCore: boolean
}

export type EvaluationFormDefinition = {
  id: string
  key: string
  name: string
  target: 'consultant' | 'resident' | 'student'
  version: number
  status: 'draft' | 'published' | 'archived'
  publishedAt: string | null
  fields: EvaluationFormField[]
}

/** The published definition the submit UI renders from. */
export function fetchEvaluationForm(client: LaravelApiClient, key: string) {
  return client.get<EvaluationFormDefinition>(`/api/academic/evaluation-forms/${key}`)
}

/** Every form version, for the admin editor (published, drafts, archive). */
export async function fetchEvaluationForms(
  client: LaravelApiClient,
): Promise<EvaluationFormDefinition[]> {
  const response = await client.get<{ data: EvaluationFormDefinition[] }>(
    '/api/admin/academic/evaluation-forms',
  )

  return response.data
}

export type EvaluationFormContentPayload = {
  name?: string
  fields?: Array<{
    key: string
    label?: string
    helpText?: string | null
    section?: string
    sortOrder?: number
    options?: EvaluationFormField['options']
    active?: boolean
  }>
}

export function updateEvaluationFormContent(
  client: LaravelApiClient,
  formId: string,
  payload: EvaluationFormContentPayload,
) {
  return client.patch<EvaluationFormDefinition>(
    `/api/admin/academic/evaluation-forms/${formId}/content`,
    payload,
  )
}

export function createEvaluationFormDraft(client: LaravelApiClient, key: string) {
  return client.post<EvaluationFormDefinition>(`/api/admin/academic/evaluation-forms/${key}/draft`)
}

export type EvaluationFormStructurePayload = {
  fields: Array<{
    key: string
    section: string
    label: string
    helpText?: string | null
    type: EvaluationFieldType
    options?: EvaluationFormField['options']
    required?: boolean
    sortOrder?: number
    active?: boolean
  }>
}

export function updateEvaluationFormStructure(
  client: LaravelApiClient,
  formId: string,
  payload: EvaluationFormStructurePayload,
) {
  return client.put<EvaluationFormDefinition>(
    `/api/admin/academic/evaluation-forms/${formId}/structure`,
    payload,
  )
}

export function publishEvaluationForm(client: LaravelApiClient, formId: string) {
  return client.post<EvaluationFormDefinition>(
    `/api/admin/academic/evaluation-forms/${formId}/publish`,
  )
}

/** Submit an evaluation as field-key answers plus the date and subject. */
export function submitEvaluationAnswers(
  client: LaravelApiClient,
  direction: 'consultant' | 'resident',
  payload: Record<string, unknown>,
) {
  const endpoint =
    direction === 'consultant'
      ? '/api/academic/consultant-evaluations'
      : '/api/academic/resident-evaluations'

  return client.post<ConsultantEvaluationRecord | ResidentEvaluationRecord>(endpoint, payload)
}

/** The external duties whose host departments send paper evaluations (V2 Phase 3). */
export const EXTERNAL_PLACEMENT_OPTIONS = [
  { value: 'icu', label: 'ICU' },
  { value: 'emergency', label: 'Emergency' },
  { value: 'dermatology', label: 'Dermatology' },
  { value: 'radiology', label: 'Radiology' },
  { value: 'psychiatry', label: 'Psychiatry' },
  { value: 'zewditu', label: 'Zewditu Memorial Hospital' },
  { value: 'saint_peter', label: 'Saint Peter Specialized Hospital' },
] as const

export type SubmitExternalEvaluationPayload = {
  subjectId: string
  evaluationDate: string
  placement: string
  evaluatorName: string
  evaluatorDepartment?: string | null
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
  comment?: string | null
}

/**
 * Admin entry of an externally-sourced paper evaluation. The row carries the
 * external evaluator's name instead of an author account.
 */
export function submitExternalEvaluation(
  client: LaravelApiClient,
  payload: SubmitExternalEvaluationPayload,
) {
  return client.post<ResidentEvaluationRecord>(
    '/api/admin/academic/external-evaluations',
    payload,
  )
}
