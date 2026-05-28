import { fetchSession } from '@/lib/api/auth'
import type { LaravelApiClient } from '@/lib/api/client'
import type {
  LiveAppStateLoadOptions,
  WorkspacePayload,
} from '@/lib/api/types'

export async function fetchCurrentUserProfile(
  client: LaravelApiClient,
  userId: string,
) {
  void userId

  const payload = await fetchSession(client)

  if (!payload.user.active) {
    throw new Error('This account is inactive. Contact an administrator.')
  }

  return {
    currentUser: payload.user,
    profileRow: payload.user,
  }
}

export async function fetchLiveAppState(
  client: LaravelApiClient,
  userId: string,
  options?: LiveAppStateLoadOptions,
) {
  void userId

  return client.get<WorkspacePayload>('/api/workspace', {
    query: {
      includeProfiles: options?.includeProfiles ?? false,
      includeAccessRequests: options?.includeAccessRequests ?? false,
      includeHistory: options?.includeHistory ?? false,
    },
  })
}
