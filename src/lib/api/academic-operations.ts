import type { LaravelApiClient } from '@/lib/api/client'

/**
 * V2 Phase 7 read models: morning punctuality, teaching occurrence, and
 * student progress for the admin academic dashboard tabs. Content-stamp
 * cached server-side; fetched on demand, never polled.
 */

export type MorningAnalytics = {
  recordedCount: number
  notRecordedCount: number
  cancelledCount: number
  onTimeRate: number
  avgDelayMinutes: number
  trend: Array<{ date: string; status: string; delayMinutes: number | null }>
  people: Array<{
    userId: string
    fullName: string
    expectedCount: number
    presentCount: number
    attendanceRate: number
  }>
  history?: Array<{ date: string; present: boolean }>
}

export function fetchMorningAnalytics(client: LaravelApiClient, userId?: string) {
  return client.get<MorningAnalytics>('/api/academic/analytics/morning', {
    query: userId ? { userId } : undefined,
  })
}

export type TeachingOccurrenceRow = {
  held: number
  notHeld: number
  cancelled: number
  pending: number
  heldRate: number | null
}

export type TeachingAnalytics = {
  byActivity: Array<TeachingOccurrenceRow & { activityType: string }>
  byBatch: Array<TeachingOccurrenceRow & { batchLabel: string }>
  reasons: Array<{ reason: string; count: number }>
  pendingBacklog: number
}

export function fetchTeachingAnalytics(client: LaravelApiClient) {
  return client.get<TeachingAnalytics>('/api/academic/analytics/teaching')
}

export type StudentAnalyticsRow = {
  id: string
  fullName: string
  batchLabel: string | null
  cohort: 'C1' | 'C2' | null
  subgroup: 'A' | 'B' | null
  attendanceRate: number | null
  weeklyEvaluationCount: number
  weeklyAvgRating: number | null
  weeklyTrajectory: Array<{ weekStartsOn: string | null; rating: number | null }>
  finalRating: number | null
}

export type StudentAnalytics = {
  students: StudentAnalyticsRow[]
  batches: Array<{
    batchLabel: string | null
    studentCount: number
    avgAttendanceRate: number | null
    avgWeeklyRating: number | null
    finalsRecorded: number
  }>
}

export function fetchStudentAnalytics(client: LaravelApiClient) {
  return client.get<StudentAnalytics>('/api/academic/analytics/students')
}
