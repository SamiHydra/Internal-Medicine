import { ApiError, type LaravelApiClient } from '@/lib/api/client'
import { resolveAssignmentReference } from '@/lib/api/helpers'
import type {
  ActionItem,
  ActionItemComment,
  ActionItemEvidence,
  ActionItemSummary,
  ActionItemStatus,
  ClinicalAlertRule,
  ClinicalAlertRuleTemplateOption,
  AdminAccessRequest,
  AdminAuditEntry,
  AdminAuditQuery,
  AdminAuditResponse,
  ApiReferenceState,
  ApiTemplateConfig,
  AssignableRole,
  CreateAdminAccountPayload,
  DepartmentReferencePayload,
  SubmitAdminAccessRequestPayload,
  SystemHealthSnapshot,
} from '@/lib/api/types'
import type { Department, ReportTemplateConfig } from '@/types/domain'
import type { AuditLogEntry, ReportAssignment } from '@/types/domain'

function fieldMetadata(field: ReportTemplateConfig['fields'][number]) {
  return {
    ...(field.options?.length ? { options: field.options } : {}),
    ...(field.unit ? { unit: field.unit } : {}),
  }
}

export async function createAdminAccount(
  client: LaravelApiClient,
  payload: CreateAdminAccountPayload,
) {
  await client.post('/api/admin/users', {
    fullName: payload.fullName,
    username: payload.username,
    email: payload.email,
    password: payload.password,
    role: payload.role,
    title: payload.title,
    passwordChangeRequired: true,
  })
}

/**
 * Corrects the role on an existing account. Mirrors the server whitelist in
 * UserController: only the admin-assignable roles, so this can fix a wrong pick
 * without becoming a back door into resident/consultant or maintenance.
 */
export async function updateUserRole(
  client: LaravelApiClient,
  userId: string,
  role: AssignableRole,
) {
  await client.patch(`/api/admin/users/${userId}`, { role })
}

export async function updateUserActiveState(
  client: LaravelApiClient,
  userId: string,
  active: boolean,
) {
  await client.patch(`/api/admin/users/${userId}/active`, { active })
}

export async function updateAssignmentActiveState(
  client: LaravelApiClient,
  assignmentId: string,
  active: boolean,
) {
  await client.patch(`/api/admin/assignments/${assignmentId}`, { active })
}

type AssignmentResponse = {
  id: string
  nurseId: string
  departmentId: string
  departmentSlug: string | null
  templateId: string
  templateSlug: string | null
  approvedAt: string
  active: boolean
}

export async function fetchReportAssignments(
  client: LaravelApiClient,
): Promise<ReportAssignment[]> {
  const assignments: ReportAssignment[] = []
  let page = 1
  let lastPage = 1

  do {
    const response = await client.get<{
      data: AssignmentResponse[]
      meta: { lastPage: number }
    }>('/api/admin/assignments', {
      query: { page, perPage: 100 },
    })
    assignments.push(...response.data.map((assignment) => ({
      id: assignment.id,
      nurseId: assignment.nurseId,
      departmentId: assignment.departmentSlug ?? assignment.departmentId,
      templateId: assignment.templateSlug ?? assignment.templateId,
      approvedAt: assignment.approvedAt,
      active: assignment.active,
    })))
    lastPage = response.meta?.lastPage ?? 1
    page += 1
  } while (page <= lastPage)

  return assignments
}

export async function fetchCellAuditLogs(
  client: LaravelApiClient,
): Promise<AuditLogEntry[]> {
  const response = await client.get<{
    data: (AuditLogEntry & {
      departmentSlug?: string | null
      templateSlug?: string | null
    })[]
  }>('/api/admin/audit-logs', {
    query: { page: 1, perPage: 100 },
  })

  // Same slug-for-id swap the assignment fetches do. The frontend department
  // and template configs are keyed by slug, so passing the server's UUID
  // through left every lookup unresolved: the audit rows printed a raw UUID
  // where the department name belongs, and the department filter matched
  // nothing at all.
  return response.data.map((entry) => ({
    ...entry,
    departmentId: entry.departmentSlug ?? entry.departmentId,
    templateId: entry.templateSlug ?? entry.templateId,
  }))
}

export async function reviewAccessRequest(
  client: LaravelApiClient,
  requestId: string,
  decision: 'approved' | 'rejected',
) {
  await client.post(`/api/admin/access-requests/${requestId}/${decision === 'approved' ? 'approve' : 'reject'}`)
}

/** Public self-signup for an admin account. Creates a pending request only. */
export async function submitAdminAccessRequest(
  client: LaravelApiClient,
  payload: SubmitAdminAccessRequestPayload,
) {
  // The reply is non-committal by design and its copy is the only thing that
  // tells an applicant who already has an account to sign in instead, so it has
  // to reach the page rather than being discarded here.
  return client.post<{ status: 'pending'; message?: string }>('/api/admin-access-requests', {
    fullName: payload.fullName,
    email: payload.email,
    password: payload.password,
    notes: payload.notes,
  })
}

export async function fetchAdminAccessRequests(
  client: LaravelApiClient,
  status?: AdminAccessRequest['status'],
): Promise<AdminAccessRequest[]> {
  const query = status ? `?status=${status}` : ''
  const response = await client.get<{ data: AdminAccessRequest[] }>(`/api/admin/admin-access-requests${query}`)

  return response.data
}

export async function reviewAdminAccessRequest(
  client: LaravelApiClient,
  requestId: string,
  decision: 'approved' | 'rejected',
  profile?: { trainingYear: number; rotationGroup?: string | null },
) {
  await client.post(
    `/api/admin/admin-access-requests/${requestId}/${decision === 'approved' ? 'approve' : 'reject'}`,
    decision === 'approved' ? profile : undefined,
  )
}

/** Follow-up action items (auto-opened by critical alerts, or created manually). */
export async function fetchActionItems(
  client: LaravelApiClient,
  options: ActionItemStatus | 'outstanding' | 'all' | {
    status?: ActionItemStatus | 'outstanding' | 'all'
    severity?: 'low' | 'medium' | 'high' | 'all'
    departmentId?: string | null
    overdue?: boolean
    search?: string
    page?: number
    perPage?: number
  } = 'outstanding',
): Promise<{
  items: ActionItem[]
  openCount: number
  summary: ActionItemSummary
  currentPage: number
  lastPage: number
  total: number
}> {
  const query = typeof options === 'string' ? { status: options } : options
  const response = await client.get<{
    data: ActionItem[]
    meta: {
      openCount?: number
      summary: ActionItemSummary
      currentPage: number
      lastPage: number
      total: number
    }
  }>('/api/admin/action-items', {
    query: {
      status: query.status ?? 'outstanding',
      severity: query.severity,
      department_id: query.departmentId,
      overdue: query.overdue ? 1 : undefined,
      search: query.search,
      page: query.page,
      perPage: query.perPage ?? 25,
    },
  })

  return {
    items: response.data,
    openCount: response.meta?.openCount ?? 0,
    summary: response.meta.summary,
    currentPage: response.meta.currentPage,
    lastPage: response.meta.lastPage,
    total: response.meta.total,
  }
}

export function fetchActionItem(client: LaravelApiClient, id: string): Promise<ActionItem> {
  return client.get<ActionItem>(`/api/admin/action-items/${id}`)
}

export async function updateActionItem(
  client: LaravelApiClient,
  id: string,
  payload: Partial<{
    status: ActionItemStatus
    resolution_note: string
    assigned_to: string | null
    severity: 'low' | 'medium' | 'high'
    due_at: string | null
  }>,
): Promise<ActionItem> {
  return client.patch<ActionItem>(`/api/admin/action-items/${id}`, payload)
}

export async function createActionItem(
  client: LaravelApiClient,
  payload: {
    title: string
    description?: string
    severity?: 'low' | 'medium' | 'high'
    department_id?: string | null
    assigned_to?: string | null
    due_at?: string
  },
): Promise<ActionItem> {
  return client.post<ActionItem>('/api/admin/action-items', payload)
}

export function addActionItemComment(
  client: LaravelApiClient,
  id: string,
  body: string,
): Promise<ActionItemComment> {
  return client.post<ActionItemComment>(`/api/admin/action-items/${id}/comments`, { body })
}

export function uploadActionItemEvidence(
  client: LaravelApiClient,
  id: string,
  file: File,
): Promise<ActionItemEvidence> {
  const body = new FormData()
  body.append('file', file)
  return client.post<ActionItemEvidence>(`/api/admin/action-items/${id}/evidence`, body)
}

export async function fetchClinicalAlertRules(client: LaravelApiClient): Promise<{
  rules: ClinicalAlertRule[]
  templates: ClinicalAlertRuleTemplateOption[]
}> {
  const response = await client.get<{
    data: ClinicalAlertRule[]
    options: ClinicalAlertRuleTemplateOption[]
  }>('/api/admin/clinical-alert-rules')
  return { rules: response.data, templates: response.options }
}

export type ClinicalAlertRulePayload = {
  template_id?: string
  field_definition_id?: string
  operator?: 'gt' | 'gte' | 'eq'
  threshold?: number
  severity?: 'low' | 'medium' | 'high'
  deadline_hours?: number
  responsible_role?: 'admin' | 'superadmin' | null
  notification_roles?: ('admin' | 'superadmin')[]
  active?: boolean
}

export function createClinicalAlertRule(
  client: LaravelApiClient,
  payload: Required<Pick<ClinicalAlertRulePayload, 'template_id' | 'field_definition_id' | 'operator' | 'threshold' | 'severity' | 'deadline_hours' | 'notification_roles'>> & ClinicalAlertRulePayload,
): Promise<ClinicalAlertRule> {
  return client.post<ClinicalAlertRule>('/api/admin/clinical-alert-rules', payload)
}

export function updateClinicalAlertRule(
  client: LaravelApiClient,
  id: string,
  payload: ClinicalAlertRulePayload,
): Promise<ClinicalAlertRule> {
  return client.patch<ClinicalAlertRule>(`/api/admin/clinical-alert-rules/${id}`, payload)
}

export type ReportImportResult = {
  imported: number
  skipped: number
  reports: number
  errors: string[]
}

/**
 * Upload a filled import template (CSV or .xlsx). A "total failure" comes back as
 * a 422 whose body is still the result; surface it as a result, not a throw, so
 * the UI can show per-row errors. Real failures (403/500/network) still throw.
 */
export async function importReports(
  client: LaravelApiClient,
  file: File,
  submit: boolean,
): Promise<ReportImportResult> {
  const form = new FormData()
  form.append('file', file)
  form.append('submit', submit ? '1' : '0')

  try {
    return await client.post<ReportImportResult>('/api/admin/reports/import', form)
  } catch (error) {
    // A "total failure" import (e.g. every row rejected) comes back as a 422 whose
    // body is still the {imported, skipped, reports, errors[]} result envelope -
    // surface that as a result so per-row errors render. A *validation* 422 (bad
    // file type, missing file) carries Laravel's {message, errors:{field:[...]}}
    // shape instead (no numeric `imported`, `errors` is an object): that must
    // re-throw so the page shows the real error message, not a false "imported"
    // summary alongside "No reports were imported".
    if (
      error instanceof ApiError &&
      error.details &&
      typeof error.details === 'object' &&
      'imported' in error.details &&
      typeof (error.details as { imported: unknown }).imported === 'number' &&
      'errors' in error.details &&
      Array.isArray((error.details as { errors: unknown }).errors)
    ) {
      return error.details as ReportImportResult
    }

    throw error
  }
}

/** Cross-cutting account & access actions (approvals, role/assignment changes) for the Audit Log. */
/** Maintenance-only operational snapshot; read-only, never cached by the browser. */
export async function fetchSystemHealth(client: LaravelApiClient): Promise<SystemHealthSnapshot> {
  return client.get<SystemHealthSnapshot>('/api/admin/system-health', { timeoutMs: 20_000 })
}

export async function fetchAdminAuditTrail(client: LaravelApiClient): Promise<AdminAuditEntry[]> {
  const response = await client.get<{ data: AdminAuditEntry[] }>('/api/admin/admin-audit-logs')

  return response.data
}

/**
 * The workspace-scoped action trail, with the filter vocabulary the server
 * derives from its audit registry. Scoping happens server-side so the client
 * never has to know which entity types belong to which workspace.
 */
export async function fetchWorkspaceAuditTrail(
  client: LaravelApiClient,
  query: AdminAuditQuery = {},
): Promise<AdminAuditResponse> {
  const params: Record<string, string> = {}

  if (query.workspace) params.workspace = query.workspace
  if (query.entityType) params.entity_type = query.entityType
  if (query.userId) params.user_id = query.userId
  if (query.action) params.action = query.action
  if (query.search) params.search = query.search
  if (query.dateFrom) params.date_from = query.dateFrom
  if (query.dateTo) params.date_to = query.dateTo
  if (query.limit) params.limit = String(query.limit)

  return client.get<AdminAuditResponse>('/api/admin/admin-audit-logs', {
    query: params,
  })
}

/** Full template definitions (incl. inactive fields + presentation metadata) for the editor. */
export async function fetchAdminTemplates(
  client: LaravelApiClient,
): Promise<ApiTemplateConfig[]> {
  const response = await client.get<{ data: ApiTemplateConfig[] }>('/api/admin/templates')

  return response.data
}

export async function updateTemplateContent(
  client: LaravelApiClient,
  slug: string,
  payload: Record<string, unknown>,
): Promise<void> {
  await client.patch(`/api/admin/templates/${slug}`, payload)
}

export async function setTemplateFieldActive(
  client: LaravelApiClient,
  slug: string,
  fieldKey: string,
  active: boolean,
): Promise<void> {
  await client.patch(`/api/admin/templates/${slug}/fields/${fieldKey}/active`, { active })
}

export async function ensureDepartmentReferenceData(
  client: LaravelApiClient,
  department: Department,
  template: ReportTemplateConfig,
): Promise<{ departmentId: string; templateId: string }> {
  const templateRow = await client.post<{ id: string }>('/api/admin/templates', {
    slug: template.id,
    family: template.family,
    name: template.name,
    description: template.description,
    activeDays: template.activeDays,
    metadata: { ui_family: template.family },
    fields: template.fields.map((field, index) => ({
      sectionKey: field.sectionId,
      fieldKey: field.id,
      label: field.label,
      fieldKind: field.kind,
      aggregateType: field.aggregate,
      displayOrder: (index + 1) * 10,
      metadata: fieldMetadata(field),
    })),
  })
  const departmentRow = await client.post<{ id: string }>('/api/admin/departments', {
    slug: department.id,
    family: department.family,
    templateId: template.id,
    name: department.name,
    description: department.description,
    accentColor: department.accent,
    bedCount: department.bedCount ?? null,
    active: true,
  })

  return {
    departmentId: departmentRow.id,
    templateId: templateRow.id,
  }
}

export async function assignUserToDepartment(
  client: LaravelApiClient,
  references: ApiReferenceState,
  userId: string,
  departmentSlug: string,
  templateSlug: string,
  approverId?: string,
) {
  void approverId

  const resolvedReference = resolveAssignmentReference(
    references,
    departmentSlug,
    templateSlug,
  )

  if (!resolvedReference) {
    throw new Error('The selected department or template is not available in the API.')
  }

  await client.post('/api/admin/assignments', {
    nurseId: userId,
    departmentId: resolvedReference.departmentId,
    templateId: resolvedReference.templateId,
    active: true,
  })
}

export type { DepartmentReferencePayload }
