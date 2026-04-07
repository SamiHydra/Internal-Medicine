import { format, parseISO } from 'date-fns'
import type {
  AuthError,
  Session,
  SupabaseClient,
} from '@supabase/supabase-js'

import {
  createEmptyAppState,
  defaultAppSettings,
} from '@/lib/app-state'
import { createEphemeralSupabaseClient } from '@/lib/supabase/client'
import type {
  AccessRequest,
  AppSettings,
  AppState,
  NotificationItem,
  ReportAssignment,
  ReportFieldValue,
  ReportRecord,
  UserProfile,
  UserRole,
  Weekday,
} from '@/types/domain'

type CurrentProfileRow = {
  id: string
  role_key: UserRole
  email: string
  username: string | null
  full_name: string
  title: string | null
  active: boolean
  phone: string | null
}

type LegacyCurrentProfileRow = Omit<CurrentProfileRow, 'username'>

type TemplateRow = {
  id: string
  slug: string
  family: string
  name: string
  description: string
  active_days: string[]
}

type DepartmentRow = {
  id: string
  slug: string
  template_id: string
  family: string
  name: string
  description: string
  accent_color: string | null
  bed_count: number | null
  active: boolean
}

type FieldDefinitionRow = {
  id: string
  template_id: string
  field_key: string
  label: string
  field_kind: 'integer' | 'decimal' | 'time' | 'text' | 'choice'
}

type ReportingPeriodRow = {
  id: string
  week_start: string
  week_end: string
  deadline_at: string
}

type SettingRow = {
  setting_key: string
  value_json: unknown
}

type AssignmentRow = {
  id: string
  nurse_id: string
  department_id: string
  template_id: string
  active: boolean
  approved_at: string
}

type AccessRequestRow = {
  id: string
  user_id: string
  email: string
  status: 'pending' | 'approved' | 'rejected'
  notes: string | null
  requested_at: string
  reviewed_at: string | null
}

type AccessRequestItemRow = {
  access_request_id: string
  department_id: string
  template_id: string
}

type ReportRow = {
  id: string
  assignment_id: string
  department_id: string
  template_id: string
  reporting_period_id: string
  status: 'draft' | 'submitted' | 'edited_after_submission' | 'locked'
  submitted_at: string | null
  locked_at: string | null
  created_by: string
  updated_by: string
  created_at: string
  updated_at: string
}

type ReportFieldValueRow = {
  report_id: string
  field_definition_id: string
  day_name: string
  value_number: number | null
  value_text: string | null
  value_time: string | null
  value_json: unknown | null
}

type CalculatedMetricRow = {
  report_id: string
  bor_percent: number | null
  btr: number | null
  alos: number | null
}

type StatusHistoryRow = {
  id: string
  report_id: string
  status: AppState['statusHistory'][number]['status']
  changed_by: string
  changed_by_name: string | null
  changed_at: string
  note: string | null
}

type AuditLogRow = {
  id: string
  report_id: string
  field_definition_id: string | null
  field_key: string
  day_name: string | null
  old_value: string | null
  new_value: string | null
  changed_by: string
  changed_by_name: string | null
  changed_at: string
  department_id: string
  template_id: string
}

type NotificationRow = {
  id: string
  recipient_id: string
  type: NotificationItem['type']
  title: string
  message: string
  created_at: string
  read_at: string | null
  related_route: string | null
  related_id: string | null
}

export type SaveReportPayload = {
  assignmentId: string
  reportingPeriodId: string
  actorId: string
  values: Record<string, ReportFieldValue>
  submit?: boolean
}

export type AccessRequestPayload = {
  fullName: string
  email: string
  password?: string
  requestedAssignments: AccessRequest['requestedAssignments']
  notes?: string
}

export type ClaimSuperadminPayload = {
  fullName: string
  username: string
  email: string
  password: string
}

export type ClaimSuperadminResult = {
  currentEmail: string
  pendingEmail: string | null
}

export type CreateAdminAccountPayload = {
  fullName: string
  username: string
  email: string
  password: string
  role: Extract<UserRole, 'admin' | 'doctor_admin'>
  title?: string
}

export type SupabaseReferenceState = {
  departmentDbIdBySlug: Record<string, string>
  templateDbIdBySlug: Record<string, string>
  templateDbIdByDepartmentSlug: Record<string, string>
}

export type LiveAppStateLoadOptions = {
  includeProfiles?: boolean
  includeAccessRequests?: boolean
  includeHistory?: boolean
}

export type ReportDetailRecord = Pick<ReportRecord, 'values' | 'calculatedMetrics'>

export function createEmptyReferenceState(): SupabaseReferenceState {
  return {
    departmentDbIdBySlug: {},
    templateDbIdBySlug: {},
    templateDbIdByDepartmentSlug: {},
  }
}

export function isAdminRole(role: UserRole) {
  return role === 'superadmin' || role === 'admin' || role === 'doctor_admin'
}

function hasMissingUsernameColumnError(error: unknown) {
  if (typeof error !== 'object' || !error || !('message' in error)) {
    return false
  }

  const message = error.message
  return (
    typeof message === 'string' &&
    /username/i.test(message) &&
    (/schema cache/i.test(message) || /column/i.test(message))
  )
}

async function selectProfileRows(
  client: SupabaseClient,
  options?: {
    userId?: string
    orderByName?: boolean
    single?: boolean
  },
) {
  const withUsernameColumns = 'id, role_key, email, username, full_name, title, active, phone'
  const legacyColumns = 'id, role_key, email, full_name, title, active, phone'

  const buildQuery = (columns: string) => {
    let query = client.from('profiles').select(columns)

    if (options?.userId) {
      query = query.eq('id', options.userId)
    }

    if (options?.orderByName) {
      query = query.order('full_name')
    }

    return options?.single ? query.maybeSingle() : query
  }

  const response = await buildQuery(withUsernameColumns)

  if (response.error && hasMissingUsernameColumnError(response.error)) {
    const fallbackResponse = await buildQuery(legacyColumns)

    if (fallbackResponse.error) {
      return fallbackResponse
    }

    if (options?.single) {
      const row = fallbackResponse.data as unknown as LegacyCurrentProfileRow | null
      return {
        data: row ? { ...row, username: null } : null,
        error: null,
      }
    }

    const rows = (fallbackResponse.data ?? []) as unknown as LegacyCurrentProfileRow[]

    return {
      data: rows.map((row) => ({ ...row, username: null })),
      error: null,
    }
  }

  return response
}

function toIsoDate(dateValue: string) {
  return new Date(`${dateValue}T00:00:00.000Z`).toISOString()
}

function formatPeriodLabel(weekStart: string, weekEnd: string) {
  return `${format(parseISO(toIsoDate(weekStart)), 'MMM d')} - ${format(parseISO(toIsoDate(weekEnd)), 'MMM d, yyyy')}`
}

const liveReportingStartDate = new Date('2026-03-02T00:00:00.000Z')

function getCurrentReportingPeriodId(rows: ReportingPeriodRow[]) {
  if (!rows.length) {
    return null
  }

  const referenceDate = new Date()
  const currentPeriod =
    [...rows]
      .sort(
        (left, right) =>
          new Date(left.week_start).getTime() - new Date(right.week_start).getTime(),
      )
      .filter((row) => new Date(row.week_start).getTime() <= referenceDate.getTime())
      .at(-1) ?? rows[0]

  return currentPeriod.id
}

function getVisibleReportingPeriodIds(rows: ReportingPeriodRow[]) {
  const currentPeriodId = getCurrentReportingPeriodId(rows)

  if (!currentPeriodId) {
    return new Set<string>()
  }

  const currentPeriod = rows.find((row) => row.id === currentPeriodId)
  if (!currentPeriod) {
    return new Set<string>()
  }

  const currentPeriodStart = new Date(currentPeriod.week_start).getTime()

  return new Set(
    rows
      .filter((row) => {
        const weekStart = new Date(row.week_start).getTime()
        return weekStart >= liveReportingStartDate.getTime() && weekStart <= currentPeriodStart
      })
      .map((row) => row.id),
  )
}

function getReportingPeriodIdFromRoute(route: string | null) {
  if (!route) {
    return null
  }

  const matchedRoute = route.match(/^\/reports\/[^/]+\/([^/]+)$/)
  return matchedRoute?.[1] ?? null
}

function filterVisibleNotifications(
  notifications: NotificationRow[],
  reportingPeriods: ReportingPeriodRow[],
) {
  const visiblePeriodIds = getVisibleReportingPeriodIds(reportingPeriods)

  if (!visiblePeriodIds.size) {
    return notifications
  }

  return notifications.filter((notification) => {
    if (notification.type !== 'overdue_report') {
      return true
    }

    const periodId = getReportingPeriodIdFromRoute(notification.related_route)
    return periodId ? visiblePeriodIds.has(periodId) : false
  })
}

function mapProfileRow(row: CurrentProfileRow): UserProfile {
  return {
    id: row.id,
    fullName: row.full_name,
    email: row.email,
    username: row.username ?? undefined,
    role: row.role_key,
    title:
      row.title ??
      (row.role_key === 'superadmin'
        ? 'Super Administrator'
        : row.role_key === 'admin'
        ? 'Administrator'
        : row.role_key === 'doctor_admin'
          ? 'Clinical Director'
          : 'Nurse'),
    active: row.active,
    phone: row.phone ?? undefined,
  }
}

export async function fetchCurrentUserProfile(
  client: SupabaseClient,
  userId: string,
) {
  const currentProfileResponse = await selectProfileRows(client, {
    userId,
    single: true,
  })

  if (currentProfileResponse.error) {
    throw new Error(
      getErrorMessage(
        currentProfileResponse.error,
        'Unable to load the signed-in profile.',
      ),
    )
  }

  if (!currentProfileResponse.data) {
    throw new Error(
      'No profile record exists for this auth user. Apply the migrations and create the profile row before signing in.',
    )
  }

  const currentUser = mapProfileRow(currentProfileResponse.data as CurrentProfileRow)

  if (!currentUser.active) {
    throw new Error('This account is inactive. Contact an administrator.')
  }

  return {
    currentUser,
    profileRow: currentProfileResponse.data as CurrentProfileRow,
  }
}

function coerceWeekday(value: string) {
  return value as Weekday
}

function getErrorMessage(error: unknown, fallback: string) {
  if (typeof error === 'object' && error && 'message' in error) {
    const message = error.message
    if (typeof message === 'string' && message.trim().length) {
      if (
        /column "status" is of type report_status but expression is of type text/i.test(
          message,
        )
      ) {
        return 'The report could not be saved because the database save function is using the wrong status type. Your entry is fine, but the backend needs the enum-cast fix.'
      }
      if (/invalid api key/i.test(message)) {
        return 'Supabase rejected the browser API key. Check VITE_SUPABASE_ANON_KEY in .env.local, make sure it belongs to the same project as VITE_SUPABASE_URL, then restart npm run dev.'
      }
      if (
        /could not find the table ['"]public\.profiles['"] in the schema cache/i.test(
          message,
        )
      ) {
        return 'Your Supabase project is missing the app schema. Run supabase/migrations/202603290001_initial_schema.sql, then supabase/migrations/202603300001_live_integration.sql, then supabase/seed.sql, and retry sign-in.'
      }
      return message
    }
  }

  return fallback
}

function parseSettings(rows: SettingRow[]): AppSettings {
  const nextSettings = { ...defaultAppSettings }

  rows.forEach((row) => {
    if (row.setting_key === 'weekly_deadline' && row.value_json && typeof row.value_json === 'object') {
      const value = row.value_json as { day?: Weekday; time?: string }
      nextSettings.weeklyDeadlineDay = value.day ?? nextSettings.weeklyDeadlineDay
      nextSettings.weeklyDeadlineTime = value.time ?? nextSettings.weeklyDeadlineTime
    }

    if (row.setting_key === 'workflow_controls' && row.value_json && typeof row.value_json === 'object') {
      const value = row.value_json as { deadline_enforced?: boolean }
      nextSettings.deadlineEnforced =
        value.deadline_enforced ?? nextSettings.deadlineEnforced
    }

    if (row.setting_key === 'locking_rules' && row.value_json && typeof row.value_json === 'object') {
      const value = row.value_json as { auto_lock_hours_after_deadline?: number }
      nextSettings.autoLockHoursAfterDeadline =
        value.auto_lock_hours_after_deadline ??
        nextSettings.autoLockHoursAfterDeadline
    }

    if (row.setting_key === 'insight_thresholds' && row.value_json && typeof row.value_json === 'object') {
      const value = row.value_json as { rise_percent?: number; drop_percent?: number }
      nextSettings.notableRiseThresholdPercent =
        value.rise_percent ?? nextSettings.notableRiseThresholdPercent
      nextSettings.notableDropThresholdPercent =
        value.drop_percent ?? nextSettings.notableDropThresholdPercent
    }

    if (
      row.setting_key === 'critical_non_zero_fields' &&
      Array.isArray(row.value_json)
    ) {
      nextSettings.criticalNonZeroFields = row.value_json.filter(
        (value): value is string => typeof value === 'string',
      )
    }
  })

  return nextSettings
}

function valueFromRow(row: ReportFieldValueRow) {
  if (row.value_number !== null) {
    return Number(row.value_number)
  }

  if (row.value_time) {
    return row.value_time.slice(0, 5)
  }

  if (row.value_text !== null) {
    return row.value_text
  }

  if (row.value_json !== null) {
    return JSON.stringify(row.value_json)
  }

  return null
}

async function assertNoError(
  promise: Promise<{ error: AuthError | null }>,
  fallbackMessage: string,
) {
  const { error } = await promise
  if (error) {
    throw new Error(getErrorMessage(error, fallbackMessage))
  }
}

async function resolveSignInEmail(
  client: SupabaseClient,
  identifier: string,
) {
  const normalizedIdentifier = identifier.trim().toLowerCase()

  if (!normalizedIdentifier) {
    throw new Error('Enter your email or username.')
  }

  if (normalizedIdentifier.includes('@')) {
    return normalizedIdentifier
  }

  const { data, error } = await client.rpc('resolve_sign_in_email', {
    p_identifier: normalizedIdentifier,
  })

  if (error) {
    if (
      typeof error.message === 'string' &&
      /resolve_sign_in_email/i.test(error.message) &&
      (/function/i.test(error.message) || /schema cache/i.test(error.message))
    ) {
      throw new Error(
        'Username sign-in is not ready until the latest database migration is applied. Use your email address for now.',
      )
    }
    throw new Error(getErrorMessage(error, 'Unable to resolve the sign-in account.'))
  }

  if (typeof data !== 'string' || !data.trim().length) {
    throw new Error('No account matches that username.')
  }

  return data
}

export async function fetchLiveAppState(
  client: SupabaseClient,
  userId: string,
  options?: LiveAppStateLoadOptions,
) {
  const includeProfiles = options?.includeProfiles ?? true
  const includeAccessRequests = options?.includeAccessRequests ?? true
  const includeHistory = options?.includeHistory ?? true
  const { currentUser, profileRow } = await fetchCurrentUserProfile(client, userId)

  const isAdmin = isAdminRole(currentUser.role)

  const [
    profilesResponse,
    templatesResponse,
    departmentsResponse,
    fieldDefinitionsResponse,
    periodsResponse,
    settingsResponse,
    assignmentsResponse,
    accessRequestsResponse,
    notificationsResponse,
  ] = await Promise.all([
    includeProfiles && isAdmin
      ? selectProfileRows(client, { orderByName: true })
      : Promise.resolve({
          data: [profileRow],
          error: null,
        }),
    client
      .from('report_templates')
      .select('id, slug, family, name, description, active_days')
      .order('name'),
    client
      .from('departments')
      .select(
        'id, slug, template_id, family, name, description, accent_color, bed_count, active',
      )
      .order('name'),
    includeHistory
      ? client
          .from('report_field_definitions')
          .select('id, template_id, field_key, label, field_kind')
          .order('display_order')
      : Promise.resolve({ data: [], error: null }),
    client
      .from('reporting_periods')
      .select('id, week_start, week_end, deadline_at')
      .order('week_start'),
    client.from('app_settings').select('setting_key, value_json'),
    client
      .from('report_assignments')
      .select('id, nurse_id, department_id, template_id, active, approved_at')
      .order('approved_at', { ascending: false }),
    includeAccessRequests
      ? client
          .from('access_requests')
          .select('id, user_id, email, status, notes, requested_at, reviewed_at')
          .order('requested_at', { ascending: false })
      : Promise.resolve({ data: [], error: null }),
    client
      .from('notifications')
      .select(
        'id, recipient_id, type, title, message, created_at, read_at, related_route, related_id',
      )
      .eq('recipient_id', userId)
      .order('created_at', { ascending: false }),
  ])

  const responses = [
    profilesResponse,
    templatesResponse,
    departmentsResponse,
    fieldDefinitionsResponse,
    periodsResponse,
    settingsResponse,
    assignmentsResponse,
    accessRequestsResponse,
    notificationsResponse,
  ]

  const responseError = responses.find((response) => response.error)
  if (responseError?.error) {
    throw new Error(getErrorMessage(responseError.error, 'Unable to load the live dashboard data.'))
  }

  const profileRows = (profilesResponse.data ?? []) as CurrentProfileRow[]
  const templateRows = (templatesResponse.data ?? []) as TemplateRow[]
  const departmentRows = (departmentsResponse.data ?? []) as DepartmentRow[]
  const fieldDefinitionRows = (fieldDefinitionsResponse.data ?? []) as FieldDefinitionRow[]
  const periodRows = (periodsResponse.data ?? []) as ReportingPeriodRow[]
  const settingRows = (settingsResponse.data ?? []) as SettingRow[]
  const assignmentRows = (assignmentsResponse.data ?? []) as AssignmentRow[]
  const accessRequestRows = (accessRequestsResponse.data ?? []) as AccessRequestRow[]
  const notificationRows = filterVisibleNotifications(
    (notificationsResponse.data ?? []) as NotificationRow[],
    periodRows,
  )
  const visibleReportingPeriodIds = [...getVisibleReportingPeriodIds(periodRows)]

  const reportsResponse = visibleReportingPeriodIds.length
    ? await client
        .from('reports')
        .select(
          'id, assignment_id, department_id, template_id, reporting_period_id, status, submitted_at, locked_at, created_by, updated_by, created_at, updated_at',
        )
        .in('reporting_period_id', visibleReportingPeriodIds)
        .order('updated_at', { ascending: false })
    : { data: [], error: null }

  if (reportsResponse.error) {
    throw new Error(
      getErrorMessage(reportsResponse.error, 'Unable to load the live dashboard data.'),
    )
  }

  const reportRows = (reportsResponse.data ?? []) as ReportRow[]

  const requestIds = accessRequestRows.map((row) => row.id)
  const reportIds = reportRows.map((row) => row.id)

  const [
    accessRequestItemsResponse,
    statusHistoryResponse,
    auditLogsResponse,
  ] = await Promise.all([
    includeAccessRequests && requestIds.length
      ? client
          .from('access_request_items')
          .select('access_request_id, department_id, template_id')
          .in('access_request_id', requestIds)
      : Promise.resolve({ data: [], error: null }),
    includeHistory && reportIds.length
      ? client
          .from('report_status_history')
          .select(
            'id, report_id, status, changed_by, changed_by_name, changed_at, note',
          )
          .in('report_id', reportIds)
          .order('changed_at', { ascending: false })
      : Promise.resolve({ data: [], error: null }),
    includeHistory && isAdmin && reportIds.length
      ? client
          .from('audit_logs')
          .select(
            'id, report_id, field_definition_id, field_key, day_name, old_value, new_value, changed_by, changed_by_name, changed_at, department_id, template_id',
          )
          .in('report_id', reportIds)
          .order('changed_at', { ascending: false })
      : Promise.resolve({ data: [], error: null }),
  ])

  const secondaryResponses = [
    accessRequestItemsResponse,
    statusHistoryResponse,
    auditLogsResponse,
  ]

  const secondaryError = secondaryResponses.find((response) => response.error)
  if (secondaryError?.error) {
    throw new Error(
      getErrorMessage(secondaryError.error, 'Unable to load report detail data.'),
    )
  }

  const accessRequestItemRows = (accessRequestItemsResponse.data ?? []) as AccessRequestItemRow[]
  const statusHistoryRows = (statusHistoryResponse.data ?? []) as StatusHistoryRow[]
  const auditLogRows = (auditLogsResponse.data ?? []) as AuditLogRow[]

  const profiles = profileRows.map(mapProfileRow)
  const profileNameById = Object.fromEntries(
    profiles.map((profile) => [profile.id, profile.fullName]),
  )

  const templateSlugByDbId = Object.fromEntries(
    templateRows.map((row) => [row.id, row.slug]),
  ) as Record<string, string>
  const templateDbIdBySlug = Object.fromEntries(
    templateRows.map((row) => [row.slug, row.id]),
  ) as Record<string, string>
  const departmentSlugByDbId = Object.fromEntries(
    departmentRows.map((row) => [row.id, row.slug]),
  ) as Record<string, string>
  const departmentDbIdBySlug = Object.fromEntries(
    departmentRows.map((row) => [row.slug, row.id]),
  ) as Record<string, string>
  const templateDbIdByDepartmentSlug = Object.fromEntries(
    departmentRows.map((row) => [row.slug, row.template_id]),
  ) as Record<string, string>
  const fieldDefinitionByDbId = Object.fromEntries(
    fieldDefinitionRows.map((row) => [row.id, row]),
  ) as Record<string, FieldDefinitionRow>

  const state: AppState = {
    ...createEmptyAppState(),
    currentUserId: userId,
    profiles,
    assignments: assignmentRows.map(
      (row) =>
        ({
          id: row.id,
          nurseId: row.nurse_id,
          departmentId: departmentSlugByDbId[row.department_id] ?? row.department_id,
          templateId: templateSlugByDbId[row.template_id] ?? row.template_id,
          approvedAt: row.approved_at,
          active: row.active,
        }) satisfies ReportAssignment,
    ),
    accessRequests: accessRequestRows.map((row) => ({
      id: row.id,
      userId: row.user_id,
      userName:
        profileNameById[row.user_id] ??
        (row.user_id === currentUser.id ? currentUser.fullName : row.email),
      email: row.email,
      requestedAssignments: accessRequestItemRows
        .filter((item) => item.access_request_id === row.id)
        .map((item) => ({
          departmentId:
            departmentSlugByDbId[item.department_id] ?? item.department_id,
          templateId: templateSlugByDbId[item.template_id] ?? item.template_id,
        })),
      status: row.status,
      requestedAt: row.requested_at,
      reviewedAt: row.reviewed_at ?? undefined,
      notes: row.notes ?? undefined,
    })),
    reportingPeriods: periodRows.map((row) => ({
      id: row.id,
      weekStart: toIsoDate(row.week_start),
      weekEnd: toIsoDate(row.week_end),
      deadlineAt: row.deadline_at,
      label: formatPeriodLabel(row.week_start, row.week_end),
    })),
    reports: reportRows.map(
      (row) =>
        ({
          id: row.id,
          assignmentId: row.assignment_id,
          departmentId: departmentSlugByDbId[row.department_id] ?? row.department_id,
          templateId: templateSlugByDbId[row.template_id] ?? row.template_id,
          reportingPeriodId: row.reporting_period_id,
          createdById: row.created_by,
          updatedById: row.updated_by,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
          submittedAt: row.submitted_at,
          lockedAt: row.locked_at,
          status: row.status,
          values: {},
          calculatedMetrics: {},
        }) satisfies ReportRecord,
    ),
    statusHistory: statusHistoryRows.map((row) => ({
      id: row.id,
      reportId: row.report_id,
      status: row.status,
      changedById: row.changed_by,
      changedByName:
        row.changed_by_name ?? profileNameById[row.changed_by] ?? 'Unknown user',
      changedAt: row.changed_at,
      note: row.note ?? undefined,
    })),
    auditLogs: auditLogRows.map((row) => {
      const definition = row.field_definition_id
        ? fieldDefinitionByDbId[row.field_definition_id]
        : undefined
      const fieldLabel = definition
        ? `${definition.label}${row.day_name ? ` (${row.day_name})` : ''}`
        : row.field_key

      return {
        id: row.id,
        reportId: row.report_id,
        fieldId: row.day_name ? `${row.field_key}.${row.day_name}` : row.field_key,
        fieldLabel,
        oldValue: row.old_value,
        newValue: row.new_value,
        changedById: row.changed_by,
        changedByName:
          row.changed_by_name ?? profileNameById[row.changed_by] ?? 'Unknown user',
        changedAt: row.changed_at,
        departmentId: departmentSlugByDbId[row.department_id] ?? row.department_id,
        templateId: templateSlugByDbId[row.template_id] ?? row.template_id,
      }
    }),
    notifications: notificationRows.map((row) => ({
      id: row.id,
      userId: row.recipient_id,
      type: row.type,
      title: row.title,
      message: row.message,
      createdAt: row.created_at,
      readAt: row.read_at,
      relatedRoute: row.related_route ?? '/',
      relatedReportId: row.related_id ?? undefined,
    })),
    settings: parseSettings(settingRows),
    pendingDrafts: reportRows
      .filter((row) => row.status === 'draft')
      .map((row) => ({
        reportId: row.id,
        assignmentId: row.assignment_id,
        reportingPeriodId: row.reporting_period_id,
        lastSavedAt: row.updated_at,
      }))
      .sort((left, right) => right.lastSavedAt.localeCompare(left.lastSavedAt)),
  }

  return {
    currentUser,
    references: {
      departmentDbIdBySlug,
      templateDbIdBySlug,
      templateDbIdByDepartmentSlug,
    },
    state,
  }
}

export async function fetchReportDetails(
  client: SupabaseClient,
  reportIds: string[],
) {
  const uniqueReportIds = [...new Set(reportIds.filter(Boolean))]

  if (!uniqueReportIds.length) {
    return {} as Record<string, ReportDetailRecord>
  }

  const [fieldDefinitionsResponse, reportFieldValuesResponse, calculatedMetricsResponse] =
    await Promise.all([
      client
        .from('report_field_definitions')
        .select('id, template_id, field_key, label, field_kind')
        .order('display_order'),
      client
        .from('report_field_values')
        .select(
          'report_id, field_definition_id, day_name, value_number, value_text, value_time, value_json',
        )
        .in('report_id', uniqueReportIds),
      client
        .from('calculated_metrics')
        .select('report_id, bor_percent, btr, alos')
        .in('report_id', uniqueReportIds),
    ])

  const responses = [
    fieldDefinitionsResponse,
    reportFieldValuesResponse,
    calculatedMetricsResponse,
  ]
  const responseError = responses.find((response) => response.error)

  if (responseError?.error) {
    throw new Error(
      getErrorMessage(responseError.error, 'Unable to load report detail data.'),
    )
  }

  const fieldDefinitionRows = (fieldDefinitionsResponse.data ?? []) as FieldDefinitionRow[]
  const reportFieldValueRows = (reportFieldValuesResponse.data ?? []) as ReportFieldValueRow[]
  const calculatedMetricRows = (calculatedMetricsResponse.data ?? []) as CalculatedMetricRow[]
  const fieldDefinitionByDbId = Object.fromEntries(
    fieldDefinitionRows.map((row) => [row.id, row]),
  ) as Record<string, FieldDefinitionRow>
  const fieldValuesByReportId: Record<string, Record<string, ReportFieldValue>> = {}

  reportFieldValueRows.forEach((row) => {
    const definition = fieldDefinitionByDbId[row.field_definition_id]
    if (!definition) {
      return
    }

    const reportValues = (fieldValuesByReportId[row.report_id] ??= {})
    const fieldKey = definition.field_key
    const entry =
      reportValues[fieldKey] ??
      ({
        fieldId: fieldKey,
        dailyValues: {},
      } satisfies ReportFieldValue)

    entry.dailyValues[coerceWeekday(row.day_name)] = valueFromRow(row)
    reportValues[fieldKey] = entry
  })

  const metricsByReportId = Object.fromEntries(
    calculatedMetricRows.map((row) => [
      row.report_id,
      {
        borPercent: row.bor_percent,
        btr: row.btr,
        alos: row.alos,
      },
    ]),
  ) as Record<string, Partial<ReportRecord['calculatedMetrics']>>

  return Object.fromEntries(
    uniqueReportIds.map((reportId) => [
      reportId,
      {
        values: fieldValuesByReportId[reportId] ?? {},
        calculatedMetrics: metricsByReportId[reportId] ?? {},
      },
    ]),
  ) as Record<string, ReportDetailRecord>
}

export async function loginWithPassword(
  client: SupabaseClient,
  identifier: string,
  password: string,
) {
  const email = await resolveSignInEmail(client, identifier)

  const { data, error } = await client.auth.signInWithPassword({
    email,
    password,
  })

  if (error) {
    throw new Error(getErrorMessage(error, 'Unable to sign in.'))
  }

  if (!data.session) {
    throw new Error('No active session was returned after sign-in.')
  }

  return data.session
}

export async function signOut(client: SupabaseClient) {
  await assertNoError(client.auth.signOut(), 'Unable to sign out.')
}

export async function submitAccessRequest(
  client: SupabaseClient,
  payload: AccessRequestPayload,
  currentUser: UserProfile | null,
) {
  const normalizedFullName = payload.fullName.trim().replace(/\s+/g, ' ')
  let requestUserId = currentUser?.id ?? null
  let signedIn = Boolean(currentUser)

  if (!requestUserId) {
    if (!payload.password) {
      throw new Error('A password is required to create a new nurse account.')
    }

    const { data, error } = await client.auth.signUp({
      email: payload.email.toLowerCase(),
      password: payload.password,
      options: {
        data: {
          full_name: normalizedFullName,
          role_key: 'nurse',
          title: 'Applicant Nurse',
        },
      },
    })

    if (error) {
      throw new Error(getErrorMessage(error, 'Unable to create the account request.'))
    }

    if (!data.user) {
      throw new Error('The account was not created in Supabase Auth.')
    }

    requestUserId = data.user.id
    signedIn = Boolean(data.session)
  }

  const { error } = await client.rpc('submit_access_request', {
    p_user_id: requestUserId,
    p_full_name: normalizedFullName,
    p_email: payload.email.toLowerCase(),
    p_requested_assignments: payload.requestedAssignments,
    p_notes: payload.notes ?? null,
  })

  if (error) {
    throw new Error(getErrorMessage(error, 'Unable to submit the access request.'))
  }

  return { signedIn }
}

export async function saveReport(
  client: SupabaseClient,
  payload: SaveReportPayload,
) {
  const { error } = await client.rpc('save_report', {
    p_assignment_id: payload.assignmentId,
    p_reporting_period_id: payload.reportingPeriodId,
    p_values: payload.values,
    p_submit: payload.submit ?? false,
  })

  if (error) {
    throw new Error(getErrorMessage(error, 'Unable to save the report.'))
  }
}

export async function setReportLockState(
  client: SupabaseClient,
  reportId: string,
  locked: boolean,
) {
  const { error } = await client.rpc('set_report_lock_state', {
    p_report_id: reportId,
    p_locked: locked,
  })

  if (error) {
    throw new Error(getErrorMessage(error, 'Unable to update the report lock state.'))
  }
}

export async function reviewAccessRequest(
  client: SupabaseClient,
  requestId: string,
  decision: 'approved' | 'rejected',
) {
  const { error } = await client.rpc('review_access_request', {
    p_request_id: requestId,
    p_decision: decision,
  })

  if (error) {
    throw new Error(
      getErrorMessage(error, 'Unable to review the access request.'),
    )
  }
}

export async function updateNotificationReadState(
  client: SupabaseClient,
  userId: string,
  notificationIds: string[],
) {
  if (!notificationIds.length) {
    return
  }

  const { error } = await client
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('recipient_id', userId)
    .in('id', notificationIds)

  if (error) {
    throw new Error(
      getErrorMessage(error, 'Unable to mark notifications as read.'),
    )
  }
}

export async function clearNotifications(
  client: SupabaseClient,
  userId: string,
  notificationIds: string[],
) {
  if (!notificationIds.length) {
    return
  }

  const { error } = await client
    .from('notifications')
    .delete()
    .eq('recipient_id', userId)
    .in('id', notificationIds)

  if (error) {
    throw new Error(
      getErrorMessage(error, 'Unable to clear notifications.'),
    )
  }
}

export async function restoreNotifications(
  client: SupabaseClient,
  notifications: NotificationItem[],
) {
  if (!notifications.length) {
    return
  }

  const rows = notifications.map((notification) => ({
    id: notification.id,
    recipient_id: notification.userId,
    type: notification.type,
    title: notification.title,
    message: notification.message,
    created_at: notification.createdAt,
    read_at: notification.readAt,
    related_route: notification.relatedRoute,
    related_id: notification.relatedReportId ?? null,
  }))

  const { error } = await client.from('notifications').upsert(rows, {
    onConflict: 'id',
    ignoreDuplicates: false,
  })

  if (error) {
    throw new Error(
      getErrorMessage(error, 'Unable to restore notifications.'),
    )
  }
}

export async function claimSuperadmin(
  client: SupabaseClient,
  payload: ClaimSuperadminPayload,
): Promise<ClaimSuperadminResult> {
  const normalizedFullName = payload.fullName.trim().replace(/\s+/g, ' ')
  const normalizedUsername = payload.username.trim().toLowerCase()
  const normalizedEmail = payload.email.trim().toLowerCase()

  const { data: updatedUserResponse, error: updateError } = await client.auth.updateUser({
    email: normalizedEmail,
    password: payload.password,
    data: {
      full_name: normalizedFullName,
      username: normalizedUsername,
      title: 'Super Administrator',
    },
  })

  if (updateError) {
    throw new Error(
      getErrorMessage(updateError, 'Unable to update the superadmin credentials.'),
    )
  }

  const { error } = await client.rpc('claim_superadmin', {
    p_full_name: normalizedFullName,
    p_username: normalizedUsername,
  })

  if (error) {
    throw new Error(getErrorMessage(error, 'Unable to claim the superadmin account.'))
  }

  const currentEmail = updatedUserResponse.user?.email?.trim().toLowerCase() ?? normalizedEmail
  const pendingEmail =
    updatedUserResponse.user?.new_email?.trim().toLowerCase() ?? null

  return {
    currentEmail,
    pendingEmail:
      pendingEmail && pendingEmail !== currentEmail ? pendingEmail : null,
  }
}

export async function createAdminAccount(
  client: SupabaseClient,
  payload: CreateAdminAccountPayload,
) {
  const adminClient = createEphemeralSupabaseClient()

  if (!adminClient) {
    throw new Error('Supabase is not configured for admin account setup.')
  }

  const normalizedEmail = payload.email.trim().toLowerCase()
  const normalizedUsername = payload.username.trim().toLowerCase()
  const normalizedFullName = payload.fullName.trim().replace(/\s+/g, ' ')
  const normalizedTitle = payload.title?.trim() || null

  const { data, error } = await adminClient.auth.signUp({
    email: normalizedEmail,
    password: payload.password,
    options: {
      data: {
        full_name: normalizedFullName,
        username: normalizedUsername,
        title:
          normalizedTitle ??
          (payload.role === 'doctor_admin' ? 'Clinical Director' : 'Administrator'),
      },
    },
  })

  if (error) {
    throw new Error(getErrorMessage(error, 'Unable to create the admin account.'))
  }

  if (!data.user) {
    throw new Error('The admin account was not created in Supabase Auth.')
  }

  const { error: provisionError } = await client.rpc('provision_admin_account', {
    p_email: normalizedEmail,
    p_full_name: normalizedFullName,
    p_role_key: payload.role,
    p_title: normalizedTitle,
    p_user_id: data.user.id,
    p_username: normalizedUsername,
  })

  if (provisionError) {
    throw new Error(
      getErrorMessage(provisionError, 'Unable to provision the admin profile.'),
    )
  }
}

export async function updateUserActiveState(
  client: SupabaseClient,
  userId: string,
  active: boolean,
) {
  const { error } = await client.rpc('set_profile_active_state', {
    p_active: active,
    p_user_id: userId,
  })

  if (error) {
    throw new Error(getErrorMessage(error, 'Unable to update the user status.'))
  }
}

export async function updateAssignmentActiveState(
  client: SupabaseClient,
  assignmentId: string,
  active: boolean,
) {
  const { error } = await client
    .from('report_assignments')
    .update({ active })
    .eq('id', assignmentId)

  if (error) {
    throw new Error(
      getErrorMessage(error, 'Unable to update the assignment status.'),
    )
  }
}

export async function assignUserToDepartment(
  client: SupabaseClient,
  references: SupabaseReferenceState,
  userId: string,
  departmentSlug: string,
  templateSlug: string,
  approverId: string,
) {
  const departmentId = references.departmentDbIdBySlug[departmentSlug]
  const templateId =
    references.templateDbIdBySlug[templateSlug] ??
    references.templateDbIdByDepartmentSlug[departmentSlug]

  if (!departmentId || !templateId) {
    throw new Error('The selected department or template is not available in Supabase.')
  }

  const { error } = await client.from('report_assignments').upsert(
    {
      nurse_id: userId,
      department_id: departmentId,
      template_id: templateId,
      active: true,
      approved_at: new Date().toISOString(),
      approved_by: approverId,
    },
    {
      onConflict: 'nurse_id,department_id,template_id',
      ignoreDuplicates: false,
    },
  )

  if (error) {
    throw new Error(
      getErrorMessage(error, 'Unable to create the assignment.'),
    )
  }
}

export async function updateAppSettings(
  client: SupabaseClient,
  settings: Partial<AppSettings>,
) {
  const { error } = await client.rpc('update_app_settings', {
    p_deadline_enforced: settings.deadlineEnforced ?? null,
    p_weekly_deadline_day: settings.weeklyDeadlineDay ?? null,
    p_weekly_deadline_time: settings.weeklyDeadlineTime ?? null,
    p_auto_lock_hours_after_deadline:
      settings.autoLockHoursAfterDeadline ?? null,
    p_notable_rise_threshold_percent:
      settings.notableRiseThresholdPercent ?? null,
    p_notable_drop_threshold_percent:
      settings.notableDropThresholdPercent ?? null,
    p_critical_non_zero_fields: settings.criticalNonZeroFields ?? null,
  })

  if (error) {
    throw new Error(getErrorMessage(error, 'Unable to save the app settings.'))
  }
}

export async function syncOverdueNotifications(client: SupabaseClient) {
  const { error } = await client.rpc('sync_overdue_notifications')

  if (error) {
    throw new Error(
      getErrorMessage(error, 'Unable to synchronize overdue notifications.'),
    )
  }
}

export function sessionUserId(session: Session | null) {
  return session?.user.id ?? null
}
