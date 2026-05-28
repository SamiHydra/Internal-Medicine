import type { LaravelApiClient } from '@/lib/api/client'
import type { AccessRequestPayload } from '@/lib/api/types'
import type { UserProfile } from '@/types/domain'

export async function submitAccessRequest(
  client: LaravelApiClient,
  payload: AccessRequestPayload,
  currentUser: UserProfile | null,
) {
  const response = await client.post<{ signedIn: boolean }>('/api/access-requests', {
    fullName: payload.fullName,
    email: payload.email,
    password: payload.password,
    requestedAssignments: payload.requestedAssignments,
    notes: payload.notes ?? null,
  })

  return {
    signedIn: response.signedIn || Boolean(currentUser),
  }
}
