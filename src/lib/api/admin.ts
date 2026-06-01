import type { LaravelApiClient } from '@/lib/api/client'
import { resolveAssignmentReference } from '@/lib/api/helpers'
import type {
  AdminAccessRequest,
  ApiReferenceState,
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
