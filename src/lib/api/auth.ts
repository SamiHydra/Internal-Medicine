import type { ApiSession, LaravelApiClient } from '@/lib/api/client'
import type { SessionPayload } from '@/lib/api/types'

export async function loginWithPassword(
  client: LaravelApiClient,
  identifier: string,
  password: string,
) {
  const payload = await client.post<SessionPayload>('/api/auth/login', {
    identifier,
    password,
  })
  const session = { user: { id: payload.user.id } } satisfies ApiSession

  client.emitAuthStateChange('SIGNED_IN', session)

  return session
}

export async function signOut(client: LaravelApiClient) {
  await client.post<null>('/api/auth/logout')
  client.markSignedOut()
}

export async function fetchSession(client: LaravelApiClient) {
  return client.get<SessionPayload>('/api/auth/me')
}

export function sessionUserId(session: ApiSession | null) {
  return session?.user.id ?? null
}
