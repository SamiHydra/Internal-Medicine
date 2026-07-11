import type { UserRole } from '@/types/domain'

/**
 * The landing route for each role. Nurses report; residents and consultants
 * submit academic evaluations; student reps land on their activity log (their
 * ONLY page); everyone else (the admin-like trio) lands on the admin dashboard.
 */
export function landingPathForRole(role: UserRole): string {
  switch (role) {
    case 'nurse':
      return '/nurse'
    case 'resident':
    case 'consultant':
      return '/academic'
    case 'student_rep':
      return '/teaching'
    default:
      return '/admin'
  }
}
