import type { ApiReferenceState } from '@/lib/api/types'
import type { UserRole } from '@/types/domain'

export function createEmptyReferenceState(): ApiReferenceState {
  return {
    departmentDbIdBySlug: {},
    templateDbIdBySlug: {},
    templateDbIdByDepartmentSlug: {},
  }
}

export function isAdminRole(role: UserRole) {
  return role === 'superadmin' || role === 'admin' || role === 'doctor_admin'
}

export function resolveAssignmentReference(
  references: ApiReferenceState,
  departmentSlug: string,
  templateSlug: string,
) {
  const departmentId = references.departmentDbIdBySlug[departmentSlug]
  const templateId =
    references.templateDbIdBySlug[templateSlug] ??
    references.templateDbIdByDepartmentSlug[departmentSlug]

  if (!departmentId || !templateId) {
    return null
  }

  return { departmentId, templateId }
}

export function getErrorMessage(error: unknown, fallback: string) {
  if (typeof error === 'object' && error && 'message' in error) {
    const message = error.message
    if (typeof message === 'string' && message.trim().length) {
      return message
    }
  }

  return fallback
}
