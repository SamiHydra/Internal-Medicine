import type { LaravelApiClient } from '@/lib/api/client'

/**
 * V2 Phase 5 API: undergraduate teaching sessions (rep log + consultant
 * attendance), the admin student module, and student evaluations.
 */

export type TeachingActivityType = 'lecture' | 'seminar' | 'bedside' | 'teaching_round'

export type TeachingSessionRecord = {
  id: string
  batchId: string
  batchLabel: string | null
  cohort: 'C1' | 'C2' | null
  subgroup: 'A' | 'B' | null
  activityType: TeachingActivityType
  scheduledDate: string
  wardId: string | null
  wardName: string | null
  status: 'pending' | 'held' | 'not_held' | 'cancelled'
  reason: string | null
  recordedAt: string | null
}

export type RepScopeInfo = {
  batchId: string
  batchLabel: string | null
  cohort: 'C1' | 'C2' | null
  scope: 'group' | 'subgroup_a' | 'subgroup_b'
}

export async function fetchMyTeachingSessions(client: LaravelApiClient): Promise<{
  scope: RepScopeInfo | null
  data: TeachingSessionRecord[]
}> {
  return client.get('/api/teaching/my-sessions')
}

export function recordTeachingSession(
  client: LaravelApiClient,
  sessionId: string,
  payload: { status: 'held' | 'not_held'; reason?: string | null },
) {
  return client.post<TeachingSessionRecord>(`/api/teaching/sessions/${sessionId}/record`, payload)
}

export type AttendanceSession = TeachingSessionRecord & {
  roster: Array<{ id: string; fullName: string; subgroup: 'A' | 'B' | null; present: boolean | null }>
}

export async function fetchTodayTeachingSessions(
  client: LaravelApiClient,
): Promise<AttendanceSession[]> {
  const response = await client.get<{ data: AttendanceSession[] }>('/api/teaching/today')

  return response.data
}

export function saveSessionAttendance(
  client: LaravelApiClient,
  sessionId: string,
  presence: Record<string, boolean>,
) {
  return client.put<TeachingSessionRecord>(`/api/teaching/sessions/${sessionId}/attendance`, {
    presence,
  })
}

// ---- Student evaluations (consultants) ----

export type StudentOption = {
  id: string
  fullName: string
  batchLabel: string | null
  cohort: 'C1' | 'C2' | null
  subgroup: 'A' | 'B' | null
  currentWardName: string | null
}

export async function fetchStudentOptions(client: LaravelApiClient): Promise<StudentOption[]> {
  const response = await client.get<{ data: StudentOption[] }>('/api/academic/students')

  return response.data
}

export function submitStudentEvaluation(
  client: LaravelApiClient,
  payload: Record<string, unknown> & { formKey: 'student_weekly' | 'student_final'; studentId: string },
) {
  return client.post('/api/academic/student-evaluations', payload)
}

// ---- Admin: batches, students, placements, reps, sessions ----

export type StudentBatchRecord = {
  id: string
  cohort: 'C1' | 'C2'
  label: string
  startsOn: string
  endsOn: string
  active: boolean
  studentCount: number
}

export type StudentRecord = {
  id: string
  batchId: string
  batchLabel: string | null
  fullName: string
  externalId: string | null
  subgroup: 'A' | 'B' | null
  active: boolean
}

export type SubgroupPlacementRecord = {
  id: string
  batchId: string
  batchLabel: string | null
  subgroup: 'A' | 'B'
  wardId: string
  wardName: string | null
  weekStartsOn: string
  weekEndsOn: string
}

export type RepAssignmentRecord = {
  id: string
  userId: string
  userName: string | null
  batchId: string
  batchLabel: string | null
  scope: 'group' | 'subgroup_a' | 'subgroup_b'
  active: boolean
}

export type OversightSessionRecord = {
  id: string
  batchLabel: string | null
  cohort: 'C1' | 'C2' | null
  subgroup: 'A' | 'B' | null
  activityType: TeachingActivityType
  scheduledDate: string
  wardName: string | null
  status: 'pending' | 'held' | 'not_held' | 'cancelled'
  reason: string | null
  recordedByName: string | null
  attendanceCount: number
}

export async function fetchStudentBatches(client: LaravelApiClient): Promise<StudentBatchRecord[]> {
  return (await client.get<{ data: StudentBatchRecord[] }>('/api/admin/student-batches')).data
}

export function createStudentBatch(
  client: LaravelApiClient,
  payload: { cohort: 'C1' | 'C2'; label: string; startsOn: string; endsOn: string },
) {
  return client.post<StudentBatchRecord>('/api/admin/student-batches', payload)
}

export function updateStudentBatch(
  client: LaravelApiClient,
  batchId: string,
  payload: Partial<{ label: string; startsOn: string; endsOn: string; active: boolean }>,
) {
  return client.patch<StudentBatchRecord>(`/api/admin/student-batches/${batchId}`, payload)
}

export async function fetchStudents(
  client: LaravelApiClient,
  batchId?: string,
): Promise<StudentRecord[]> {
  const query = batchId ? `?batchId=${batchId}` : ''

  return (await client.get<{ data: StudentRecord[] }>(`/api/admin/students${query}`)).data
}

export function createStudent(
  client: LaravelApiClient,
  payload: { batchId: string; fullName: string; externalId?: string | null; subgroup?: 'A' | 'B' | null },
) {
  return client.post<StudentRecord>('/api/admin/students', payload)
}

export function updateStudent(
  client: LaravelApiClient,
  studentId: string,
  payload: Partial<{ fullName: string; externalId: string | null; subgroup: 'A' | 'B' | null; active: boolean }>,
) {
  return client.patch<StudentRecord>(`/api/admin/students/${studentId}`, payload)
}

export function importStudents(
  client: LaravelApiClient,
  payload: { batchId: string; csv: string },
) {
  return client.post<{ created: number; skipped: number }>('/api/admin/students/import', payload)
}

export async function fetchSubgroupPlacements(
  client: LaravelApiClient,
  batchId?: string,
): Promise<SubgroupPlacementRecord[]> {
  const query = batchId ? `?batchId=${batchId}` : ''

  return (await client.get<{ data: SubgroupPlacementRecord[] }>(`/api/admin/subgroup-placements${query}`)).data
}

export function saveSubgroupPlacement(
  client: LaravelApiClient,
  payload: { batchId: string; subgroup: 'A' | 'B'; wardId: string; weekStartsOn: string },
) {
  return client.post<SubgroupPlacementRecord>('/api/admin/subgroup-placements', payload)
}

export async function fetchRepAssignments(client: LaravelApiClient): Promise<RepAssignmentRecord[]> {
  return (await client.get<{ data: RepAssignmentRecord[] }>('/api/admin/rep-assignments')).data
}

export function createRepAssignment(
  client: LaravelApiClient,
  payload: { userId: string; batchId: string; scope: 'group' | 'subgroup_a' | 'subgroup_b' },
) {
  return client.post<RepAssignmentRecord>('/api/admin/rep-assignments', payload)
}

export function setRepAssignmentActive(client: LaravelApiClient, assignmentId: string, active: boolean) {
  return client.patch<RepAssignmentRecord>(`/api/admin/rep-assignments/${assignmentId}/active`, { active })
}

export async function fetchOversightSessions(
  client: LaravelApiClient,
  filters?: { batchId?: string; status?: string },
): Promise<OversightSessionRecord[]> {
  const params = new URLSearchParams()
  if (filters?.batchId) {
    params.set('batchId', filters.batchId)
  }
  if (filters?.status) {
    params.set('status', filters.status)
  }
  const query = params.toString() ? `?${params.toString()}` : ''

  return (await client.get<{ data: OversightSessionRecord[] }>(`/api/admin/teaching-sessions${query}`)).data
}

export function cancelTeachingSession(client: LaravelApiClient, sessionId: string, reason: string) {
  return client.post<{ id: string; status: string }>(`/api/admin/teaching-sessions/${sessionId}/cancel`, {
    reason,
  })
}

// ---- Admin: weekly teaching-activity schedule ----

export type TeachingScheduleScope = 'cohort' | 'subgroup'

export type TeachingScheduleRecord = {
  id: string
  cohort: 'C1' | 'C2'
  activityType: TeachingActivityType
  /** ISO weekday, Monday = 1 … Sunday = 7. */
  weekday: number
  scope: TeachingScheduleScope
  active: boolean
}

/** The scope is fixed by the activity: lectures/seminars run cohort-wide, bedside/rounds per subgroup. */
export function scopeForActivity(activity: TeachingActivityType): TeachingScheduleScope {
  return activity === 'lecture' || activity === 'seminar' ? 'cohort' : 'subgroup'
}

export async function fetchTeachingSchedules(
  client: LaravelApiClient,
): Promise<TeachingScheduleRecord[]> {
  return (await client.get<{ data: TeachingScheduleRecord[] }>('/api/admin/teaching-schedules')).data
}

export function createTeachingSchedule(
  client: LaravelApiClient,
  payload: { cohort: 'C1' | 'C2'; activityType: TeachingActivityType; weekday: number; scope: TeachingScheduleScope },
) {
  return client.post<TeachingScheduleRecord>('/api/admin/teaching-schedules', payload)
}

/**
 * Returns only the id and the new flag, NOT a full record: merge it into the
 * cached schedule rather than replacing, or the rest of the row is lost.
 */
export function setTeachingScheduleActive(client: LaravelApiClient, scheduleId: string, active: boolean) {
  return client.patch<{ id: string; active: boolean }>(
    `/api/admin/teaching-schedules/${scheduleId}/active`,
    { active },
  )
}

export function deleteTeachingSchedule(client: LaravelApiClient, scheduleId: string) {
  return client.delete(`/api/admin/teaching-schedules/${scheduleId}`)
}

export const ACTIVITY_LABELS: Record<TeachingActivityType, string> = {
  lecture: 'Lecture',
  seminar: 'Seminar',
  bedside: 'Bedside teaching',
  teaching_round: 'Teaching round',
}

export const REP_SCOPE_LABELS: Record<RepAssignmentRecord['scope'], string> = {
  group: 'Group rep (lectures & seminars)',
  subgroup_a: 'Subgroup A rep (bedside & rounds)',
  subgroup_b: 'Subgroup B rep (bedside & rounds)',
}
