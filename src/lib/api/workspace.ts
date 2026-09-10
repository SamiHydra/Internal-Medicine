import { hydrateTemplatesFromApi } from '@/config/template-registry'
import { fetchSession } from '@/lib/api/auth'
import type { LaravelApiClient } from '@/lib/api/client'
import type {
  ListResponse,
  LiveAppStateLoadOptions,
  WorkspacePayload,
} from '@/lib/api/types'
import type { UserProfile } from '@/types/domain'

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

/**
 * The profile directory alone (GET /api/workspace/profiles).
 *
 * Rows are serialized by the same backend method as `state.profiles`, so the
 * result can replace that slice directly. Prefer this over re-fetching the
 * whole workspace with includeProfiles=1, which pulls ~214 KB of reports,
 * audit logs, and notifications that the caller does not want.
 */
export async function fetchProfileDirectory(
  client: LaravelApiClient,
): Promise<UserProfile[]> {
  const firstPage = await client.get<ListResponse<UserProfile>>('/api/workspace/profiles', {
    query: { page: 1, perPage: 100 },
  })
  const lastPage = firstPage.meta?.lastPage ?? 1

  if (lastPage === 1) {
    return firstPage.data
  }

  // Each response remains capped at 100 rows, while the directory route avoids
  // a serial nine-request waterfall at the audited roster size.
  const remainingPages = await Promise.all(
    Array.from({ length: lastPage - 1 }, (_, index) =>
      client.get<ListResponse<UserProfile>>('/api/workspace/profiles', {
        query: { page: index + 2, perPage: 100 },
      }),
    ),
  )

  return [firstPage, ...remainingPages].flatMap((response) => response.data)
}

export async function fetchWorkspaceRevision(
  client: LaravelApiClient,
  token: string,
): Promise<{ revision: string; revisionToken: string }> {
  return client.get<{ revision: string; revisionToken: string }>(
    '/api/workspace/revision',
    {
      headers: { 'X-Workspace-Revision-Token': token },
    },
  )
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
