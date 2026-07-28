import type { LaravelApiClient } from '@/lib/api/client'
import type { AccessRequestPayload } from '@/lib/api/types'
import type { AccessRequest, UserProfile } from '@/types/domain'

export async function fetchAccessRequests(
  client: LaravelApiClient,
  options?: { pendingOnly?: boolean },
): Promise<AccessRequest[]> {
  type AccessRequestApi = Omit<AccessRequest, 'requestedAssignments'> & {
    requestedAssignments: Array<{
      departmentId: string
      departmentSlug?: string | null
      templateId: string
      templateSlug?: string | null
    }>
  }

  const response = await client.get<{
    data: AccessRequestApi[]
  }>('/api/workspace/access-requests', {
    query: { status: options?.pendingOnly ? 'pending' : undefined },
  })

  return response.data.map((request) => ({
    ...request,
    requestedAssignments: request.requestedAssignments.map((assignment) => ({
      departmentId: assignment.departmentSlug ?? assignment.departmentId,
      templateId: assignment.templateSlug ?? assignment.templateId,
    })),
  }))
}

export async function submitAccessRequest(
  client: LaravelApiClient,
  payload: AccessRequestPayload,
  currentUser: UserProfile | null,
) {
  const response = await client.post<{ signedIn: boolean; message?: string }>('/api/access-requests', {
    fullName: payload.fullName,
    email: payload.email,
    password: payload.password,
    requestedAssignments: payload.requestedAssignments,
    notes: payload.notes ?? null,
  })

  return {
    signedIn: response.signedIn || Boolean(currentUser),
    // The anonymous branch answers the same way whether the request was stored
    // or silently discarded, and only its copy tells an applicant who already
    // has an account to sign in instead. Dropping it here left the page
    // promising a review that was never queued.
    message: response.message ?? null,
  }
}
