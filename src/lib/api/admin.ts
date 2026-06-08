import type { LaravelApiClient } from '@/lib/api/client'
import { resolveAssignmentReference } from '@/lib/api/helpers'
import type {
  ActionItem,
  ActionItemStatus,
  AdminAccessRequest,
  AdminAuditEntry,
  ApiReferenceState,
  ApiTemplateConfig,
  CreateAdminAccountPayload,
  DepartmentReferencePayload,
  SubmitAdminAccessRequestPayload,
} from '@/lib/api/types'
import type { Department, ReportTemplateConfig } from '@/types/domain'

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
  await client.post('/api/admin-access-requests', {
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
) {
  await client.post(`/api/admin/admin-access-requests/${requestId}/${decision === 'approved' ? 'approve' : 'reject'}`)
}

/** Follow-up action items (auto-opened by critical alerts, or created manually). */
export async function fetchActionItems(
  client: LaravelApiClient,
  status: ActionItemStatus | 'all' = 'open',
): Promise<{ items: ActionItem[]; openCount: number }> {
  const response = await client.get<{ data: ActionItem[]; meta: { openCount?: number } }>(
    `/api/admin/action-items?status=${status}`,
  )

  return { items: response.data, openCount: response.meta?.openCount ?? 0 }
}

export async function updateActionItem(
  client: LaravelApiClient,
  id: string,
  payload: Partial<{
    status: ActionItemStatus
    resolution_note: string
    assigned_to: string | null
    severity: 'low' | 'medium' | 'high'
  }>,
): Promise<ActionItem> {
  return client.patch<ActionItem>(`/api/admin/action-items/${id}`, payload)
}

export async function createActionItem(
  client: LaravelApiClient,
  payload: { title: string; description?: string; severity?: 'low' | 'medium' | 'high' },
): Promise<ActionItem> {
  return client.post<ActionItem>('/api/admin/action-items', payload)
}

/** Cross-cutting account & access actions (approvals, role/assignment changes) for the Audit Log. */
export async function fetchAdminAuditTrail(client: LaravelApiClient): Promise<AdminAuditEntry[]> {
  const response = await client.get<{ data: AdminAuditEntry[] }>('/api/admin/admin-audit-logs')

  return response.data
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
