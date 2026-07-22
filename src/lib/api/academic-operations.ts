import type { LaravelApiClient } from '@/lib/api/client'
import { z } from 'zod'

/**
 * V2 Phase 7 read models: morning punctuality, teaching occurrence, and
 * student progress for the admin academic dashboard tabs. Content-stamp
 * cached server-side; fetched on demand, never polled.
 */

const morningAnalyticsSchema = z.object({
  recordedCount: z.number(),
  notRecordedCount: z.number(),
  cancelledCount: z.number(),
  onTimeRate: z.number(),
  avgDelayMinutes: z.number(),
  trend: z.array(z.object({
    date: z.string(),
    status: z.string(),
    delayMinutes: z.number().nullable(),
  })),
  people: z.array(z.object({
    userId: z.string(),
    fullName: z.string(),
    expectedCount: z.number(),
    presentCount: z.number(),
    attendanceRate: z.number(),
  })),
  history: z.array(z.object({ date: z.string(), present: z.boolean() })).optional(),
  window: z.object({
    type: z.literal('latest_sessions'),
    limit: z.number(),
    sessionCount: z.number(),
    fromDate: z.string().nullable(),
    toDate: z.string().nullable(),
  }),
})

export type MorningAnalytics = z.infer<typeof morningAnalyticsSchema>

export async function fetchMorningAnalytics(client: LaravelApiClient, userId?: string) {
  const payload = await client.get<unknown>('/api/academic/analytics/morning', {
    query: userId ? { userId } : undefined,
  })

  return morningAnalyticsSchema.parse(payload)
}

const teachingOccurrenceSchema = z.object({
  held: z.number(),
  notHeld: z.number(),
  cancelled: z.number(),
  pending: z.number(),
  heldRate: z.number().nullable(),
})

export type TeachingOccurrenceRow = z.infer<typeof teachingOccurrenceSchema>

const missedTeachingSessionSchema = z.object({
  id: z.string(),
  batchId: z.string(),
  batchLabel: z.string(),
  activityType: z.string(),
  subgroup: z.enum(['A', 'B']).nullable(),
  scheduledDate: z.string(),
  reason: z.string(),
})

const teachingBlockSchema = teachingOccurrenceSchema.extend({
  batchId: z.string(),
  batchLabel: z.string(),
  cohort: z.enum(['C1', 'C2']),
  startsOn: z.string(),
  endsOn: z.string(),
  active: z.boolean(),
  byActivity: z.array(teachingOccurrenceSchema.extend({ activityType: z.string() })),
  reasons: z.array(z.object({ reason: z.string(), count: z.number() })),
  missedSessions: z.array(missedTeachingSessionSchema),
  pendingBacklog: z.number(),
})

const teachingAnalyticsSchema = z.object({
  byActivity: z.array(teachingOccurrenceSchema.extend({ activityType: z.string() })),
  byBatch: z.array(teachingOccurrenceSchema.extend({
    batchId: z.string(),
    batchLabel: z.string(),
  })),
  blocks: z.array(teachingBlockSchema),
  reasons: z.array(z.object({ reason: z.string(), count: z.number() })),
  missedSessions: z.array(missedTeachingSessionSchema),
  pendingBacklog: z.number(),
})

export type TeachingAnalytics = z.infer<typeof teachingAnalyticsSchema>

export async function fetchTeachingAnalytics(client: LaravelApiClient) {
  return teachingAnalyticsSchema.parse(
    await client.get<unknown>('/api/academic/analytics/teaching'),
  )
}

const studentAnalyticsRowSchema = z.object({
  id: z.string(),
  fullName: z.string(),
  batchLabel: z.string().nullable(),
  cohort: z.enum(['C1', 'C2']).nullable(),
  subgroup: z.enum(['A', 'B']).nullable(),
  attendanceRate: z.number().nullable(),
  weeklyEvaluationCount: z.number(),
  weeklyAvgRating: z.number().nullable(),
  weeklyTrajectory: z.array(z.object({
    weekStartsOn: z.string().nullable(),
    rating: z.number().nullable(),
  })),
  finalRating: z.number().nullable(),
})

export type StudentAnalyticsRow = z.infer<typeof studentAnalyticsRowSchema>

const studentAnalyticsSchema = z.object({
  students: z.array(studentAnalyticsRowSchema),
  batches: z.array(z.object({
    batchLabel: z.string().nullable(),
    studentCount: z.number(),
    avgAttendanceRate: z.number().nullable(),
    avgWeeklyRating: z.number().nullable(),
    finalsRecorded: z.number(),
  })),
})

export type StudentAnalytics = z.infer<typeof studentAnalyticsSchema>

export async function fetchStudentAnalytics(client: LaravelApiClient) {
  return studentAnalyticsSchema.parse(
    await client.get<unknown>('/api/academic/analytics/students'),
  )
}
