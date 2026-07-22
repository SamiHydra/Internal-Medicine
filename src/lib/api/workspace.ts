import { hydrateTemplatesFromApi } from '@/config/template-registry'
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

  const payload = await client.get<WorkspacePayload>('/api/workspace', {
    query: {
      includeProfiles: options?.includeProfiles ?? false,
      includeAccessRequests: options?.includeAccessRequests ?? false,
      includeHistory: options?.includeHistory ?? false,
      reportPeriodWindow: options?.reportPeriodWindow ?? 'default',
    },
  })

  // Overlay DB template edits over the static config floor for every workspace
  // load (bootstrap, refresh, ensure*). Safe no-op when the backend omits them.
  hydrateTemplatesFromApi(payload.state.templates)

  // Every workspace load funnels through here, so this is the one place that has
  // to absorb a server old enough to omit the role registry.
  payload.state.roles = Array.isArray(payload.state.roles) ? payload.state.roles : []

  return payload
}
