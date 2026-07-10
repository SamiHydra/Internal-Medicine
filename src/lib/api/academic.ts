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
 * Public self-enrollment for residents and consultants. Creates an active
 * academic account and notifies admins (mirrors the nurse access-request flow).
 */
export function submitAcademicRegistration(
  client: LaravelApiClient,
  payload: SubmitAcademicRegistrationPayload,
) {
  return client.post<AcademicRegistrationResult>('/api/academic-access-requests', payload)
}

export type AcademicWardOption = { id: string; name: string; slug: string }

/**
 * Ward options for the admin dashboards. Admins hold `departments.manage`, so we
 * source inpatient wards from the existing admin endpoint (they do not hold
 * `academic.submit`, so `/api/academic/form-options` is not available to them).
 */
export async function fetchAcademicWardOptions(
  client: LaravelApiClient,
): Promise<AcademicWardOption[]> {
  const response = await client.get<{
    data: Array<{ id: string; name: string; slug: string }>
  }>('/api/admin/wards')

  return response.data.map((ward) => ({
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
