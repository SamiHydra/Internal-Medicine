import type { LaravelApiClient } from '@/lib/api/client'
import type { RotationCalendarSummary } from '@/lib/api/academic-structure'

/**
 * V2 Phase 2 API: the month-by-month duty roster, the rotation planner
 * matrix, and consultant section-transfer requests.
 */

// ---- Duty roster ----

export type RosterAssignment = {
  id: string
  dutyTypeId: string
  dutyTypeName: string | null
  startsOn: string
  endsOn: string
  source: string
  note: string | null
}

export type RosterPerson = {
  id: string
  fullName: string
  role: 'resident' | 'consultant'
  sectionId: string | null
  sectionName: string | null
  trainingYear: number | null
  rotationGroup: string | null
  monthly: RosterAssignment[]
  daily: RosterAssignment[]
}

export type RosterMonth = {
  year: number
  month: number
  startsOn: string
  endsOn: string
  sections: Array<{ id: string; name: string }>
  people: RosterPerson[]
}

export async function fetchRosterMonth(
  client: LaravelApiClient,
  year: number,
  month: number,
): Promise<RosterMonth> {
  return client.get<RosterMonth>(`/api/admin/roster/${year}/${month}`)
}

export async function saveRosterMonth(
  client: LaravelApiClient,
  year: number,
  month: number,
  assignments: Array<{ userId: string; dutyTypeId: string | null }>,
): Promise<RosterMonth> {
  return client.put<RosterMonth>(`/api/admin/roster/${year}/${month}`, { assignments })
}

export async function saveDailyDuty(
  client: LaravelApiClient,
  payload: { userId: string; dutyTypeId: string; date: string; remove?: boolean },
): Promise<void> {
  await client.post('/api/admin/roster/daily', payload)
}

// ---- Rotation planner ----

export type RotationPlan = {
  calendar: RotationCalendarSummary
  residents: Array<{ id: string; fullName: string; rotationGroup: string | null }>
  dutyTypes: Array<{ id: string; name: string; category: string }>
  assignments: Array<{ userId: string; blockId: string; dutyTypeId: string }>
}

export async function fetchRotationPlan(
  client: LaravelApiClient,
  calendarId: string,
): Promise<RotationPlan> {
  return client.get<RotationPlan>(`/api/admin/rotations/${calendarId}/plan`)
}

export async function saveRotationPlan(
  client: LaravelApiClient,
  calendarId: string,
  payload: {
    assignments?: Array<{ userId: string; blockId: string; dutyTypeId: string | null }>
    groupPlan?: Array<{ rotationGroup: string; blockId: string; dutyTypeId: string }>
  },
): Promise<RotationPlan> {
  return client.post<RotationPlan>(`/api/admin/rotations/${calendarId}/plan`, payload)
}

// ---- Section transfers ----

export type TransferRequestRecord = {
  id: string
  userId: string
  userName?: string | null
  fromSectionId: string
  fromSectionName: string | null
  toSectionId: string
  toSectionName: string | null
  reason: string | null
  status: 'pending' | 'approved' | 'rejected' | 'cancelled'
  decidedByName: string | null
  decidedAt: string | null
  effectiveOn: string | null
  appliedAt: string | null
  requestedAt: string | null
}

export type TransferFormOptions = {
  currentSectionId: string | null
  currentSectionName: string | null
  sections: Array<{ id: string; name: string }>
}

export async function fetchTransferOptions(client: LaravelApiClient): Promise<TransferFormOptions> {
  return client.get<TransferFormOptions>('/api/academic/transfer-requests/options')
}

export async function createTransferRequest(
  client: LaravelApiClient,
  payload: { toSectionId: string; reason?: string | null },
): Promise<TransferRequestRecord> {
  return client.post<TransferRequestRecord>('/api/academic/transfer-requests', payload)
}

export async function fetchMyTransferRequests(
  client: LaravelApiClient,
): Promise<TransferRequestRecord[]> {
  const response = await client.get<{ data: TransferRequestRecord[] }>(
    '/api/academic/transfer-requests/mine',
  )

  return response.data
}

export async function cancelTransferRequest(
  client: LaravelApiClient,
  requestId: string,
): Promise<TransferRequestRecord> {
  return client.post<TransferRequestRecord>(`/api/academic/transfer-requests/${requestId}/cancel`)
}

export async function fetchTransferRequests(
  client: LaravelApiClient,
  status?: TransferRequestRecord['status'],
): Promise<TransferRequestRecord[]> {
  const query = status ? `?status=${status}` : ''
  const response = await client.get<{ data: TransferRequestRecord[] }>(
    `/api/admin/transfer-requests${query}`,
  )

  return response.data
}

export async function approveTransferRequest(
  client: LaravelApiClient,
  requestId: string,
  options?: { effectiveOn?: string; immediate?: boolean },
): Promise<TransferRequestRecord> {
  return client.post<TransferRequestRecord>(
    `/api/admin/transfer-requests/${requestId}/approve`,
    options ?? {},
  )
}

export async function rejectTransferRequest(
  client: LaravelApiClient,
  requestId: string,
): Promise<TransferRequestRecord> {
  return client.post<TransferRequestRecord>(`/api/admin/transfer-requests/${requestId}/reject`)
}
