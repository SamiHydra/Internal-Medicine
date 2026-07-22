import type { LaravelApiClient } from '@/lib/api/client'

/**
 * V2 Phase 6 API: the department-wide morning session. The recorder surface
 * (today + record) and the admin oversight surface (list, correction,
 * cancellation, roster overrides).
 */

export type MorningPerson = {
  userId: string
  fullName: string | null
  role: string | null
  /** Null while the session is unrecorded (the auto-generated roster). */
  present: boolean | null
}

export type MorningSessionRecord = {
  id: string
  sessionDate: string
  scheduledStartAt: string
  actualStartAt: string | null
  startedOnTime: boolean | null
  status: 'pending' | 'recorded' | 'cancelled'
  reason: string | null
  delayMinutes: number | null
  recordedByName: string | null
  recordedAt: string | null
  attendanceCount: number
  presentCount: number
  people?: MorningPerson[]
}

export async function fetchTodayMorningSession(client: LaravelApiClient): Promise<{
  session: MorningSessionRecord | null
  isSessionDay: boolean
  canRecord: boolean
}> {
  return client.get('/api/academic/morning-sessions/today')
}

export function recordMorningSession(
  client: LaravelApiClient,
  sessionId: string,
  payload: { startedOnTime: boolean; actualStartAt?: string | null; presence: Record<string, boolean> },
) {
  return client.post<MorningSessionRecord>(`/api/academic/morning-sessions/${sessionId}/record`, payload)
}

export function cancelOwnMorningSession(client: LaravelApiClient, sessionId: string, reason: string) {
  return client.post<MorningSessionRecord>(`/api/academic/morning-sessions/${sessionId}/cancel`, {
    reason,
  })
}

export async function fetchMorningSessions(
  client: LaravelApiClient,
  status?: MorningSessionRecord['status'],
): Promise<MorningSessionRecord[]> {
  const query = status ? `?status=${status}` : ''
  const response = await client.get<{ data: MorningSessionRecord[] }>(
    `/api/admin/morning-sessions${query}`,
  )

  return response.data
}

export function cancelMorningSession(client: LaravelApiClient, sessionId: string, reason: string) {
  return client.post<MorningSessionRecord>(`/api/admin/morning-sessions/${sessionId}/cancel`, {
    reason,
  })
}

export type MorningRosterOverrideRecord = {
  id: string
  userId: string
  userName: string | null
  action: 'include' | 'exclude'
  startsOn: string
  endsOn: string | null
}

export async function fetchMorningOverrides(
  client: LaravelApiClient,
): Promise<MorningRosterOverrideRecord[]> {
  const response = await client.get<{ data: MorningRosterOverrideRecord[] }>(
    '/api/admin/morning-roster-overrides',
  )

  return response.data
}

export function createMorningOverride(
  client: LaravelApiClient,
  payload: { userId: string; action: 'include' | 'exclude'; startsOn: string; endsOn?: string | null },
) {
  return client.post<{ id: string }>('/api/admin/morning-roster-overrides', payload)
}

export async function deleteMorningOverride(client: LaravelApiClient, overrideId: string) {
  await client.delete(`/api/admin/morning-roster-overrides/${overrideId}`)
}

/** Update the designated recorders through the global settings endpoint. */
export function updateMorningRecorders(client: LaravelApiClient, recorderIds: string[]) {
  return client.patch('/api/admin/settings', { morningRecorderIds: recorderIds })
}

/** Update the scheduled start used when future morning sessions are opened. */
export function updateMorningSessionTime(client: LaravelApiClient, sessionTime: string) {
  return client.patch('/api/admin/settings', { morningSessionTime: sessionTime })
}

export type MorningConfig = {
  morningSessionDays: number[]
  morningSessionTime: string
  morningRecorderIds: string[]
}

export async function fetchMorningConfig(client: LaravelApiClient): Promise<MorningConfig> {
  const response = await client.get<{ settings: { academic?: MorningConfig } }>(
    '/api/admin/settings',
  )

  return (
    response.settings.academic ?? {
      morningSessionDays: [1, 3, 5],
      morningSessionTime: '08:00',
      morningRecorderIds: [],
    }
  )
}
