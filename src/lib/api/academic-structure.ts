import type { LaravelApiClient } from '@/lib/api/client'

/**
 * Admin API for the academic structure (V2 Phase 1): teaching wards, specialty
 * sections, the duty-type catalog, and rotation calendars. Mounted under
 * /api/admin/academic/* because the clinical pillar already aliases
 * /api/admin/wards to inpatient departments.
 */

export type AcademicWard = {
  id: string
  slug: string
  name: string
  active: boolean
}

export type AcademicSection = {
  id: string
  slug: string
  name: string
  headUserId: string | null
  headName: string | null
  consultantCount: number
  active: boolean
}

export type DutyTypeCategory =
  | 'ward_service'
  | 'clinical_duty'
  | 'on_call'
  | 'external'
  | 'leave'

export type DutyTypeGranularity = 'monthly' | 'daily'

export type AcademicDutyType = {
  id: string
  slug: string
  name: string
  sectionId: string | null
  sectionName: string | null
  wardId: string | null
  wardName: string | null
  category: DutyTypeCategory
  granularity: DutyTypeGranularity
  pairsForEvaluation: boolean
  pairingGroup: string | null
  countsForMorningRoster: boolean
  active: boolean
}

export type RotationBlockSummary = {
  id: string
  blockIndex: number
  startsOn: string
  endsOn: string
}

export type RotationCalendarSummary = {
  id: string
  trainingYear: number
  academicYearLabel: string
  startsOn: string
  blockKind: 'calendar_month' | 'fixed_weeks'
  blockLengthWeeks: number | null
  blocksCount: number
  active: boolean
  blocks: RotationBlockSummary[]
}

// ---- Wards ----

export async function fetchAcademicWards(client: LaravelApiClient): Promise<AcademicWard[]> {
  const response = await client.get<{ data: AcademicWard[] }>('/api/admin/academic/wards')

  return response.data
}

export async function createAcademicWard(
  client: LaravelApiClient,
  payload: { name: string; active?: boolean },
): Promise<AcademicWard> {
  return client.post<AcademicWard>('/api/admin/academic/wards', payload)
}

export async function updateAcademicWard(
  client: LaravelApiClient,
  wardId: string,
  payload: Partial<Pick<AcademicWard, 'name' | 'active'>>,
): Promise<AcademicWard> {
  return client.patch<AcademicWard>(`/api/admin/academic/wards/${wardId}`, payload)
}

export async function deleteAcademicWard(client: LaravelApiClient, wardId: string): Promise<void> {
  await client.delete(`/api/admin/academic/wards/${wardId}`)
}

// ---- Sections ----

export async function fetchAcademicSections(client: LaravelApiClient): Promise<AcademicSection[]> {
  const response = await client.get<{ data: AcademicSection[] }>('/api/admin/academic/sections')

  return response.data
}

export async function createAcademicSection(
  client: LaravelApiClient,
  payload: { name: string; headUserId?: string | null; active?: boolean },
): Promise<AcademicSection> {
  return client.post<AcademicSection>('/api/admin/academic/sections', payload)
}

export async function updateAcademicSection(
  client: LaravelApiClient,
  sectionId: string,
  payload: Partial<{ name: string; headUserId: string | null; active: boolean }>,
): Promise<AcademicSection> {
  return client.patch<AcademicSection>(`/api/admin/academic/sections/${sectionId}`, payload)
}

export async function deleteAcademicSection(
  client: LaravelApiClient,
  sectionId: string,
): Promise<void> {
  await client.delete(`/api/admin/academic/sections/${sectionId}`)
}

// ---- Duty types ----

export type SaveDutyTypePayload = {
  name: string
  sectionId?: string | null
  wardId?: string | null
  category: DutyTypeCategory
  granularity: DutyTypeGranularity
  pairsForEvaluation?: boolean
  pairingGroup?: string | null
  countsForMorningRoster?: boolean
  active?: boolean
}

export async function fetchAcademicDutyTypes(
  client: LaravelApiClient,
): Promise<AcademicDutyType[]> {
  const response = await client.get<{ data: AcademicDutyType[] }>('/api/admin/academic/duty-types')

  return response.data
}

export async function createAcademicDutyType(
  client: LaravelApiClient,
  payload: SaveDutyTypePayload,
): Promise<AcademicDutyType> {
  return client.post<AcademicDutyType>('/api/admin/academic/duty-types', payload)
}

export async function updateAcademicDutyType(
  client: LaravelApiClient,
  dutyTypeId: string,
  payload: Partial<SaveDutyTypePayload>,
): Promise<AcademicDutyType> {
  return client.patch<AcademicDutyType>(`/api/admin/academic/duty-types/${dutyTypeId}`, payload)
}

export async function deleteAcademicDutyType(
  client: LaravelApiClient,
  dutyTypeId: string,
): Promise<void> {
  await client.delete(`/api/admin/academic/duty-types/${dutyTypeId}`)
}

// ---- Rotation calendars ----

export async function fetchRotationCalendars(
  client: LaravelApiClient,
): Promise<RotationCalendarSummary[]> {
  const response = await client.get<{ data: RotationCalendarSummary[] }>(
    '/api/admin/rotations/calendars',
  )

  return response.data
}

export async function createRotationCalendar(
  client: LaravelApiClient,
  payload: {
    trainingYear: number
    academicYearLabel: string
    startsOn: string
    blockKind: 'calendar_month' | 'fixed_weeks'
    blockLengthWeeks?: number | null
    blocksCount: number
  },
): Promise<RotationCalendarSummary> {
  return client.post<RotationCalendarSummary>('/api/admin/rotations/calendars', payload)
}

export async function setRotationCalendarActive(
  client: LaravelApiClient,
  calendarId: string,
  active: boolean,
): Promise<RotationCalendarSummary> {
  return client.patch<RotationCalendarSummary>(
    `/api/admin/rotations/calendars/${calendarId}/active`,
    { active },
  )
}
