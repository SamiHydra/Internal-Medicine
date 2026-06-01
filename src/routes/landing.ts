import type { UserRole } from '@/types/domain'

/**
 * The landing route for each role. Nurses report; residents and consultants
 * submit academic evaluations; everyone else (the admin-like trio) lands on the
 * admin dashboard.
 */
export function landingPathForRole(role: UserRole): string {
  switch (role) {
    case 'nurse':
      return '/nurse'
    case 'resident':
    case 'consultant':
      return '/academic'
    default:
      return '/admin'
  }
}
