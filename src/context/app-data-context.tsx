/* eslint-disable react-refresh/only-export-components */
import {
  useCallback,
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from 'react'
import { toast } from 'sonner'

import { createEmptyAppState } from '@/lib/app-state'
import { clearAuthenticatedQueryCache } from '@/lib/query-client'
import { departmentMap, templateMap } from '@/config/templates'
import type {
  AcademicWorkspaceState,
  AccessRequestPayload,
  AdminAccessRequest,
  CreateAdminAccountPayload,
  LiveAppStateLoadOptions,
  ApiReferenceState,
  ReportDetailRecord,
  ReportResponse,
  ReportSummaryResponse,
  SaveReportPayload,
  SubmitAdminAccessRequestPayload,
} from '@/lib/api'
import {
  assignUserToDepartment as assignUserToDepartmentMutation,
  createAdminAccount as createAdminAccountMutation,
  createEmptyReferenceState,
  ensureDepartmentReferenceData,
  fetchAdminAccessRequests as fetchAdminAccessRequestsQuery,
  fetchAccessRequests,
  fetchCurrentUserProfile,
  fetchCellAuditLogs,
  fetchReportAssignments,
  fetchReportDetails,
  fetchReportStatusHistory,
  changePassword as changePasswordMutation,
  fetchLiveAppState,
  listAllReportSummaries,
  fetchProfileDirectory,
  fetchWorkspaceRevision,
  isAdminRole,
  loginWithPassword,
  reviewAccessRequest as reviewAccessRequestMutation,
  reviewAdminAccessRequest as reviewAdminAccessRequestMutation,
  submitAdminAccessRequest as submitAdminAccessRequestMutation,
  restoreNotifications as restoreNotificationsMutation,
  resolveAssignmentReference,
  saveReport as saveReportMutation,
  sessionUserId,
  setReportLockState,
  signOut as signOutMutation,
  syncOverdueNotifications as syncOverdueNotificationsMutation,
  submitAccessRequest as submitAccessRequestMutation,
  updateAppSettings as updateAppSettingsMutation,
  updateAssignmentActiveState,
  clearNotifications as clearNotificationsMutation,
  updateNotificationReadState,
  updateUserActiveState,
} from '@/lib/api'
import {
  getApiBrowserClient,
  isApiConfigured,
} from '@/lib/api/client'
import {
  apiEnvSetupHint,
  missingApiEnvKeys,
} from '@/lib/api/env'
import {
  getReportSaveQueueId,
  isBrowserOffline,
  isLikelyOfflineError,
  listQueuedReportSaves,
  MAX_QUEUED_SAVE_ATTEMPTS,
  queueReportSave,
  recordQueuedReportSaveFailure,
  removeQueuedReportSave,
} from '@/lib/offline/report-save-queue'
import {
  clearWorkspaceCache,
  readLastWorkspaceCache,
  writeWorkspaceCache,
  type WorkspaceCacheRecord,
} from '@/lib/offline/workspace-cache'
import { workspacePollDelay } from '@/lib/workspace-poll'
import {
  getCurrentPeriod,
  getCurrentUser,
} from '@/data/selectors'
import type {
  AppSettings,
  AppState,
  NotificationItem,
  ReportRecord,
  UserProfile,
  UserRole,
} from '@/types/domain'

type AppDataContextValue = {
  state: AppState
  currentUser: UserProfile | null
  /** Academic slice of the workspace bootstrap: placement, setup signals, head designations. */
  academic: AcademicWorkspaceState | null
  isBootstrapping: boolean
  isConfigured: boolean
  missingEnvVars: string[]
  error: string | null
  login: (email: string, password: string) => Promise<UserRole | null>
  logout: () => Promise<void>
  markNotificationsRead: (userId: string, notificationIds: string[]) => Promise<void>
  clearNotifications: (userId: string, notificationIds: string[]) => Promise<void>
  restoreNotifications: (notifications: NotificationItem[]) => Promise<void>
  /** Resolves to the server's own confirmation copy, or null when it failed. */
  submitAccessRequest: (payload: AccessRequestPayload) => Promise<string | null>
  /** Resolves to the server's own confirmation copy, or null when it failed. */
  submitAdminAccessRequest: (payload: SubmitAdminAccessRequestPayload) => Promise<string | null>
  createAdminAccount: (payload: CreateAdminAccountPayload) => Promise<boolean>
  approveAccessRequest: (requestId: string, reviewerId: string) => Promise<void>
  rejectAccessRequest: (requestId: string, reviewerId: string) => Promise<void>
  adminAccessRequests: AdminAccessRequest[]
  refreshAdminAccessRequests: () => Promise<void>
  approveAdminAccessRequest: (
    requestId: string,
    profile?: { trainingYear: number; rotationGroup?: string | null },
  ) => Promise<void>
  rejectAdminAccessRequest: (requestId: string) => Promise<void>
  saveReport: (payload: SaveReportPayload) => Promise<SaveReportResult>
  queuedReportSaveCount: number
  hasQueuedReportSave: (assignmentId: string, reportingPeriodId: string) => boolean
  lockReport: (reportId: string, actorId: string) => Promise<void>
  unlockReport: (reportId: string, actorId: string) => Promise<void>
  isReportDetailLoaded: (reportId: string) => boolean
  getReportDetailLoadState: (reportId: string) => ReportDetailLoadState
  updateSettings: (settings: Partial<AppSettings>) => Promise<void>
  toggleUserActive: (userId: string) => Promise<void>
  toggleAssignmentActive: (assignmentId: string) => Promise<void>
  assignUserToDepartment: (
    userId: string,
    departmentId: string,
    templateId: string,
  ) => Promise<void>
  ensureProfileDirectoryData: () => Promise<void>
  ensureAccessRequestData: () => Promise<void>
  ensureUserManagementData: () => Promise<void>
  ensureHistoryData: () => Promise<void>
  ensureReportSummaryData: (options?: EnsureReportSummaryOptions) => Promise<void>
  ensureReportDetails: (
    reportIds: string[],
    options?: EnsureReportDetailsOptions,
  ) => Promise<Record<string, ReportDetailRecord>>
  reportPeriodWindow: NonNullable<LiveAppStateLoadOptions['reportPeriodWindow']>
  resolveDepartmentSlug: (departmentIdOrSlug: string) => string | null
  refreshData: (options?: LiveAppStateLoadOptions) => Promise<void>
  changePassword: (currentPassword: string, newPassword: string) => Promise<boolean>
}

const AppDataContext = createContext<AppDataContextValue | null>(null)

// isSyncing/isDataRefreshing live in a separate context so the frequent
// background-sync flag flips (20s poll, sync indicator) do not re-render every
// useAppData() consumer - only components that actually read the sync status.
type AppSyncContextValue = {
  isSyncing: boolean
  isDataRefreshing: boolean
}

const AppSyncContext = createContext<AppSyncContextValue | null>(null)

type ReportDetailLoadState = {
  status: 'idle' | 'loading' | 'loaded' | 'error'
  error: string | null
}

type EnsureReportDetailsOptions = {
  force?: boolean
  silent?: boolean
}

type EnsureReportSummaryOptions = {
  periodIds?: string[]
  assignmentId?: string
  reportingPeriodId?: string
  force?: boolean
}

type SaveReportResult = {
  saved: boolean
  queued: boolean
}

const idleReportDetailLoadState: ReportDetailLoadState = {
  status: 'idle',
  error: null,
}

function isPublicAuthPath(pathname: string) {
  return (
    pathname === '/login' ||
    pathname === '/register' ||
    pathname === '/forgot-password' ||
    pathname.startsWith('/reset-password')
  )
}

function getMessage(error: unknown, fallback: string) {
  if (typeof error === 'object' && error && 'message' in error) {
    const message = error.message
    if (typeof message === 'string' && message.trim().length) {
      return message
    }
  }

  return fallback
}

function getLoadedReportDetailIds(state: AppState) {
  return new Set(
    state.reports
      .filter((report) => hasReportDetailData(report))
      .map((report) => report.id),
  )
}

function hasReportDetailData(report: AppState['reports'][number]) {
  return Object.values(report.values).some((fieldValue) =>
    Object.values(fieldValue.dailyValues).some(
      (value) => value !== null && value !== undefined && value !== '',
    ),
  )
}

function reportSummaryRecord(report: ReportSummaryResponse): ReportRecord {
  return {
    id: report.id,
    assignmentId: report.assignmentId,
    departmentId: report.departmentSlug ?? report.departmentId,
    templateId: report.templateSlug ?? report.templateId,
    reportingPeriodId: report.reportingPeriodId,
    createdById: report.createdById,
    updatedById: report.updatedById,
    createdAt: report.createdAt,
    updatedAt: report.updatedAt,
    submittedAt: report.submittedAt,
    lockedAt: report.lockedAt,
    status: report.status,
    values: {},
    calculatedMetrics: {
      borPercent: null,
      btr: null,
      alos: null,
    },
  }
}

function hasAssignmentReference(
  references: ApiReferenceState,
  departmentId: string,
  templateId: string,
) {
  return Boolean(resolveAssignmentReference(references, departmentId, templateId))
}

function getAdminDashboardWarmReportIds(state: AppState): string[] {
  // Intentionally empty. The admin dashboard's weekly view is served entirely by
  // /api/analytics/dashboard (server-side aggregates incl. per-week chartMetrics),
  // and monthly mode hydrates report details on demand. Eager warm-hydration here
  // was the last thing pulling per-report field values into the browser on every
  // bootstrap; the weekly charts no longer read hydrated state.
  void state

  return []
}

export function AppDataProvider({ children }: PropsWithChildren) {
  const client = getApiBrowserClient()
  const [state, setState] = useState<AppState>(() => createEmptyAppState())
  const [isBootstrapping, setIsBootstrapping] = useState(isApiConfigured)
  const [isSyncing, setIsSyncing] = useState(false)
  const [isDataRefreshing, setIsDataRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [academic, setAcademic] = useState<AcademicWorkspaceState | null>(null)
  const [adminAccessRequests, setAdminAccessRequests] = useState<AdminAccessRequest[]>([])
  const [queuedReportSaveIds, setQueuedReportSaveIds] = useState<Set<string>>(
    () => new Set(),
  )
  const [reportDetailLoadStates, setReportDetailLoadStates] = useState<
    Record<string, ReportDetailLoadState>
  >({})
  const referencesRef = useRef<ApiReferenceState>(createEmptyReferenceState())
  // Signature guard so the 60s poll only re-renders academic consumers when the
  // academic slice actually changed (it is a fresh object every response).
  const academicSignatureRef = useRef<string | null>(null)
  const loadVersionRef = useRef(0)
  const currentUserIdRef = useRef<string | null>(null)
  const currentStateRef = useRef<AppState>(createEmptyAppState())
  const suppressNextSignedInLoadRef = useRef(false)
  const pendingExplicitAuthUserIdRef = useRef<string | null>(null)
  const isSigningOutRef = useRef(false)
  const profileDirectoryLoadedRef = useRef(false)
  const accessRequestDataLoadedRef = useRef(false)
  const profileDirectoryRequestRef = useRef<Promise<void> | null>(null)
  const accessRequestDataRequestRef = useRef<Promise<void> | null>(null)
  const historyDataLoadedRef = useRef(false)
  const loadedReportPeriodIdsRef = useRef<Set<string>>(new Set())
  const reportSummaryRequestsRef = useRef<Map<string, Promise<void>>>(new Map())
  const adminAssignmentsLoadedRef = useRef(false)
  const loadedReportDetailIdsRef = useRef<Set<string>>(new Set())
  const pendingReportDetailIdsRef = useRef<Set<string>>(new Set())
  const reportPeriodWindowRef = useRef<NonNullable<LiveAppStateLoadOptions['reportPeriodWindow']>>('default')
  // Signature of the last applied background-poll payload. Lets an unchanged
  // poll skip the state replacement (and its full-tree re-render) entirely.
  const lastPolledStateSignatureRef = useRef<string | null>(null)
  const workspaceRevisionRef = useRef<string | null>(null)
  const overdueSyncInFlightRef = useRef(false)
  const lastOverdueSyncAtRef = useRef(0)
  const syncPendingCountRef = useRef(0)
  const syncIndicatorTimeoutRef = useRef<number | null>(null)
  const adminLiveRefreshTimerRef = useRef<number | null>(null)
  const adminLiveRefreshInFlightRef = useRef(false)
  const queuedReportSyncInFlightRef = useRef(false)

  const currentUser = getCurrentUser(state)
  const signedInUserId = currentUser?.id
  const signedInUserRole = currentUser?.role

  const beginBackgroundSync = useCallback(() => {
    syncPendingCountRef.current += 1
    setIsDataRefreshing(true)

    if (syncPendingCountRef.current === 1 && syncIndicatorTimeoutRef.current === null) {
      syncIndicatorTimeoutRef.current = window.setTimeout(() => {
        if (syncPendingCountRef.current > 0) {
          setIsSyncing(true)
        }

        syncIndicatorTimeoutRef.current = null
      }, 220)
    }
  }, [])

  const endBackgroundSync = useCallback(() => {
    syncPendingCountRef.current = Math.max(0, syncPendingCountRef.current - 1)

    if (syncPendingCountRef.current === 0) {
      setIsDataRefreshing(false)

      if (syncIndicatorTimeoutRef.current !== null) {
        window.clearTimeout(syncIndicatorTimeoutRef.current)
        syncIndicatorTimeoutRef.current = null
      }

      setIsSyncing(false)
    }
  }, [])

  const refreshQueuedReportSaveState = useCallback(async (userId?: string | null) => {
    if (!userId) {
      setQueuedReportSaveIds(new Set())
      return
    }

    const queuedSaves = await listQueuedReportSaves(userId)
    setQueuedReportSaveIds(new Set(queuedSaves.map((queuedSave) => queuedSave.id)))
  }, [])

  const hasQueuedReportSave = useCallback(
    (assignmentId: string, reportingPeriodId: string) => {
      const userId = currentUserIdRef.current
      if (!userId) {
        return false
      }

      return queuedReportSaveIds.has(
        getReportSaveQueueId(userId, assignmentId, reportingPeriodId),
      )
    },
    [queuedReportSaveIds],
  )

  useEffect(() => {
    currentUserIdRef.current = state.currentUserId
    currentStateRef.current = state
  }, [state])

  useEffect(() => {
    void refreshQueuedReportSaveState(signedInUserId ?? null)
  }, [refreshQueuedReportSaveState, signedInUserId])

  useEffect(
    () => () => {
      if (syncIndicatorTimeoutRef.current !== null) {
        window.clearTimeout(syncIndicatorTimeoutRef.current)
      }

      if (adminLiveRefreshTimerRef.current !== null) {
        window.clearTimeout(adminLiveRefreshTimerRef.current)
      }
    },
    [],
  )

  const scheduleOverdueSync = useCallback(() => {
    if (!client || overdueSyncInFlightRef.current) {
      return
    }

    const now = Date.now()
    if (now - lastOverdueSyncAtRef.current < 60_000) {
      return
    }

    overdueSyncInFlightRef.current = true

    void syncOverdueNotificationsMutation(client)
      .then(() => {
        lastOverdueSyncAtRef.current = Date.now()
      })
      .catch(() => {
        // Keep startup fast even if overdue notification sync fails.
      })
      .finally(() => {
        overdueSyncInFlightRef.current = false
      })
  }, [client])

  const resetDeferredDataState = useCallback(() => {
    profileDirectoryLoadedRef.current = false
    accessRequestDataLoadedRef.current = false
    profileDirectoryRequestRef.current = null
    accessRequestDataRequestRef.current = null
    historyDataLoadedRef.current = false
    loadedReportPeriodIdsRef.current = new Set()
    reportSummaryRequestsRef.current = new Map()
    adminAssignmentsLoadedRef.current = false
    loadedReportDetailIdsRef.current = new Set()
    pendingReportDetailIdsRef.current = new Set()
    reportPeriodWindowRef.current = 'default'
    setReportDetailLoadStates({})
  }, [])

  const syncReportDetailLoadStates = useCallback(
    (reportIds: string[]) => {
      setReportDetailLoadStates((currentStates) => {
        const nextStates = { ...currentStates }

        reportIds.forEach((reportId) => {
          if (pendingReportDetailIdsRef.current.has(reportId)) {
            nextStates[reportId] = { status: 'loading', error: null }
            return
          }

          if (loadedReportDetailIdsRef.current.has(reportId)) {
            nextStates[reportId] = { status: 'loaded', error: null }
            return
          }

          if (nextStates[reportId]?.status !== 'error') {
            delete nextStates[reportId]
          }
        })

        return nextStates
      })
    },
    [],
  )

  // Durable workspace cache is a warm-start optimisation, not a source of truth,
  // so the multi-MB JSON.stringify + localStorage.setItem is debounced off the
  // interaction path. Rapid bursts (a poll, then ensureReportDetails, then a
  // save) coalesce into a single write. The record is resolved at call time so
  // the flushed value matches what a synchronous write would have stored.
  const pendingWorkspaceCacheRef = useRef<WorkspaceCacheRecord | null>(null)
  const workspaceCacheTimerRef = useRef<number | null>(null)

  const flushWorkspaceCache = useCallback(() => {
    if (workspaceCacheTimerRef.current !== null) {
      window.clearTimeout(workspaceCacheTimerRef.current)
      workspaceCacheTimerRef.current = null
    }

    const record = pendingWorkspaceCacheRef.current
    pendingWorkspaceCacheRef.current = null

    if (!record) {
      return
    }

    // Guard against a deferred write resurrecting a logged-out or switched
    // user's state: currentStateRef updates synchronously on every sign-out /
    // account switch, so a stale record is simply dropped.
    if (record.userId !== currentStateRef.current.currentUserId) {
      return
    }

    writeWorkspaceCache(record)
  }, [])

  const persistWorkspaceCache = useCallback(
    (
      nextState: AppState,
      overrides?: Partial<
        Pick<
          WorkspaceCacheRecord,
          'profileDirectoryLoaded' | 'accessRequestDataLoaded' | 'historyDataLoaded'
        >
      >,
    ) => {
      if (!nextState.currentUserId) {
        pendingWorkspaceCacheRef.current = null
        if (workspaceCacheTimerRef.current !== null) {
          window.clearTimeout(workspaceCacheTimerRef.current)
          workspaceCacheTimerRef.current = null
        }
        clearWorkspaceCache()
        return
      }

      pendingWorkspaceCacheRef.current = {
        version: 4,
        userId: nextState.currentUserId,
        cachedAt: new Date().toISOString(),
        state: nextState,
        profileDirectoryLoaded:
          overrides?.profileDirectoryLoaded ?? profileDirectoryLoadedRef.current,
        accessRequestDataLoaded:
          overrides?.accessRequestDataLoaded ?? accessRequestDataLoadedRef.current,
        historyDataLoaded:
          overrides?.historyDataLoaded ?? historyDataLoadedRef.current,
      }

      if (workspaceCacheTimerRef.current === null) {
        workspaceCacheTimerRef.current = window.setTimeout(flushWorkspaceCache, 600)
      }
    },
    [flushWorkspaceCache],
  )

  // Persist any pending debounced write before the tab is hidden/closed, and
  // clear the timer on unmount so it can't fire against a torn-down component.
  useEffect(() => {
    const flushOnHide = () => {
      if (document.visibilityState === 'hidden') {
        flushWorkspaceCache()
      }
    }

    window.addEventListener('pagehide', flushWorkspaceCache)
    document.addEventListener('visibilitychange', flushOnHide)

    return () => {
      window.removeEventListener('pagehide', flushWorkspaceCache)
      document.removeEventListener('visibilitychange', flushOnHide)

      if (workspaceCacheTimerRef.current !== null) {
        window.clearTimeout(workspaceCacheTimerRef.current)
        workspaceCacheTimerRef.current = null
      }
    }
  }, [flushWorkspaceCache])

  const applyWorkspaceCache = useCallback(
    (cacheRecord: WorkspaceCacheRecord) => {
      // Records written before the role registry existed are still on disk and are
      // applied ahead of the network load, so backfill the key rather than trust it.
      const cachedState = {
        ...cacheRecord.state,
        roles: cacheRecord.state.roles ?? [],
      }
      profileDirectoryLoadedRef.current = cacheRecord.profileDirectoryLoaded
      accessRequestDataLoadedRef.current = cacheRecord.accessRequestDataLoaded
      historyDataLoadedRef.current = cacheRecord.historyDataLoaded
      loadedReportDetailIdsRef.current = getLoadedReportDetailIds(cacheRecord.state)
      pendingReportDetailIdsRef.current = new Set()
      setReportDetailLoadStates(
        Object.fromEntries(
          [...loadedReportDetailIdsRef.current].map((reportId) => [
            reportId,
            { status: 'loaded', error: null } satisfies ReportDetailLoadState,
          ]),
        ),
      )
      setState(cachedState)
      currentUserIdRef.current = cachedState.currentUserId
      currentStateRef.current = cachedState
      setError(null)
      setIsBootstrapping(false)
    },
    [],
  )

  const clearSignedOutState = useCallback(() => {
    loadVersionRef.current += 1
    pendingExplicitAuthUserIdRef.current = null
    referencesRef.current = createEmptyReferenceState()
    academicSignatureRef.current = null
    workspaceRevisionRef.current = null
    lastPolledStateSignatureRef.current = null
    currentUserIdRef.current = null
    currentStateRef.current = createEmptyAppState()
    syncPendingCountRef.current = 0
    reportPeriodWindowRef.current = 'default'
    setState(createEmptyAppState())
    setAcademic(null)
    resetDeferredDataState()
    clearWorkspaceCache()
    clearAuthenticatedQueryCache()
    setError(null)
    setIsBootstrapping(false)
    setIsSyncing(false)
    setIsDataRefreshing(false)
    setQueuedReportSaveIds(new Set())
  }, [resetDeferredDataState])

  const applyAuthenticatedProfile = useCallback(
    (profile: UserProfile) => {
      resetDeferredDataState()
      profileDirectoryLoadedRef.current = !isAdminRole(profile.role)
      setState((currentState) => {
        const nextState =
          currentState.currentUserId === profile.id ? currentState : createEmptyAppState()
        const otherProfiles = nextState.profiles.filter(
          (existingProfile) => existingProfile.id !== profile.id,
        )
        const resolvedState = {
          ...nextState,
          currentUserId: profile.id,
          profiles: [profile, ...otherProfiles],
        }

        currentUserIdRef.current = profile.id
        currentStateRef.current = resolvedState
        return resolvedState
      })
      setError(null)
      setIsBootstrapping(false)
    },
    [resetDeferredDataState],
  )

  const ensureReportSummaryData = useCallback(
    async (options: EnsureReportSummaryOptions = {}): Promise<void> => {
      if (!client || !currentUserIdRef.current) {
        return
      }

      const periodIds = [
        ...new Set(
          options.periodIds?.filter(Boolean) ??
            (options.reportingPeriodId ? [options.reportingPeriodId] : []),
        ),
      ].sort()
      const currentProfile = currentStateRef.current.profiles.find(
        ({ id }) => id === currentUserIdRef.current,
      )
      const needsAdminAssignments =
        Boolean(currentProfile && isAdminRole(currentProfile.role)) &&
        !adminAssignmentsLoadedRef.current
      const periodsAlreadyLoaded =
        periodIds.length > 0 &&
        periodIds.every((periodId) => loadedReportPeriodIdsRef.current.has(periodId))

      if (!options.force && periodsAlreadyLoaded && !needsAdminAssignments) {
        return
      }

      const requestKey = JSON.stringify({
        periodIds,
        assignmentId: options.assignmentId ?? null,
        reportingPeriodId: options.reportingPeriodId ?? null,
        assignments: needsAdminAssignments,
      })
      const existingRequest = reportSummaryRequestsRef.current.get(requestKey)

      if (existingRequest) {
        return existingRequest
      }

      beginBackgroundSync()
      const request = (async () => {
        const [summaries, assignments] = await Promise.all([
          listAllReportSummaries(client, {
            periodIds: periodIds.length ? periodIds : undefined,
            assignmentId: options.assignmentId,
            reportingPeriodId: options.reportingPeriodId,
          }),
          needsAdminAssignments ? fetchReportAssignments(client) : Promise.resolve(null),
        ])
        const incomingReports = summaries.map(reportSummaryRecord)

        setState((currentState) => {
          const reportsById = new Map(currentState.reports.map((report) => [report.id, report]))

          incomingReports.forEach((report) => {
            const existing = reportsById.get(report.id)
            reportsById.set(
              report.id,
              existing &&
                loadedReportDetailIdsRef.current.has(report.id) &&
                existing.updatedAt === report.updatedAt
                ? {
                    ...report,
                    values: existing.values,
                    calculatedMetrics: existing.calculatedMetrics,
                    quality: existing.quality,
                  }
                : report,
            )
          })

          const nextState = {
            ...currentState,
            reports: [...reportsById.values()],
            assignments: assignments ?? currentState.assignments,
          }

          currentStateRef.current = nextState
          persistWorkspaceCache(nextState)
          return nextState
        })

        periodIds.forEach((periodId) => loadedReportPeriodIdsRef.current.add(periodId))
        if (assignments) {
          adminAssignmentsLoadedRef.current = true
        }
        syncReportDetailLoadStates(incomingReports.map(({ id }) => id))
      })()
        .finally(() => {
          reportSummaryRequestsRef.current.delete(requestKey)
          endBackgroundSync()
        })

      reportSummaryRequestsRef.current.set(requestKey, request)
      return request
    },
    [
      beginBackgroundSync,
      client,
      endBackgroundSync,
      persistWorkspaceCache,
      syncReportDetailLoadStates,
    ],
  )

  const loadUserState = useCallback(
    async (
      userId: string,
      fallbackMessage: string,
      options?: { showBootstrapping?: boolean } & LiveAppStateLoadOptions,
    ) => {
      if (!client) {
        return null
      }

      const loadVersion = ++loadVersionRef.current
      const showBootstrapping = options?.showBootstrapping ?? true
      const includeProfiles = options?.includeProfiles ?? false
      const includeAccessRequests = options?.includeAccessRequests ?? false
      const includeHistory = options?.includeHistory ?? false
      const reportPeriodWindow = options?.reportPeriodWindow ?? reportPeriodWindowRef.current

      if (showBootstrapping) {
        setIsBootstrapping(true)
      } else {
        beginBackgroundSync()
      }
      setError(null)

      try {
        const result = await fetchLiveAppState(client, userId, {
          includeProfiles,
          includeAccessRequests,
          includeHistory,
          reportPeriodWindow,
        })

        if (loadVersion !== loadVersionRef.current) {
          return result
        }

        referencesRef.current = result.references
        workspaceRevisionRef.current = result.revision
        reportPeriodWindowRef.current = reportPeriodWindow

        // Applied before the poll-skip below: a placement or setup-signal change
        // must land even when the clinical state is byte-identical.
        const academicSignature = JSON.stringify(result.academic ?? null)
        if (academicSignature !== academicSignatureRef.current) {
          academicSignatureRef.current = academicSignature
          setAcademic(result.academic ?? null)
        }

        // Background polls re-fetch the full windowed workspace on a timer and
        // on every tab focus. When the server returns byte-identical data (the
        // common idle case) there is nothing to apply, so skip the state
        // replacement (a full consumer-tree re-render) and the cache write. The
        // signature is the entire fetched payload (on a poll each report
        // carries values:{} so it stays small), which makes the comparison
        // exhaustive (no rendered field can change without changing it). Only
        // pure polls qualify: refreshes that pull extra collections (profiles /
        // access requests / history) are never skipped.
        const isPollRefresh = !includeProfiles && !includeAccessRequests && !includeHistory
        const polledStateSignature = isPollRefresh ? JSON.stringify(result.state) : null

        if (
          isPollRefresh &&
          polledStateSignature === lastPolledStateSignatureRef.current &&
          currentStateRef.current.currentUserId === result.currentUser.id
        ) {
          setError(null)
          scheduleOverdueSync()
          return result
        }

        const previouslyLoadedReportDetailIds = loadedReportDetailIdsRef.current
        const existingReportsById = Object.fromEntries(
          currentStateRef.current.reports.map((report) => [report.id, report]),
        ) as Record<string, AppState['reports'][number]>
        const workspaceReports =
          result.state.reports.length > 0
            ? result.state.reports
            : currentStateRef.current.reports
        const mergedReports = workspaceReports.map((report) => {
          const existingReport = existingReportsById[report.id]
          const canReuseLoadedDetails =
            existingReport &&
            previouslyLoadedReportDetailIds.has(report.id) &&
            existingReport.updatedAt === report.updatedAt

          if (!canReuseLoadedDetails) {
            return report
          }

          return {
            ...report,
            values: existingReport.values,
            calculatedMetrics: existingReport.calculatedMetrics,
          }
        })

        loadedReportDetailIdsRef.current = new Set(
          mergedReports
            .filter(
              (report) => {
                const existingReport = existingReportsById[report.id]
                const preservedLoadedDetails =
                  existingReport &&
                  previouslyLoadedReportDetailIds.has(report.id) &&
                  existingReport.updatedAt === report.updatedAt

                return (
                  preservedLoadedDetails ||
                  hasReportDetailData(report)
                )
              },
            )
            .map((report) => report.id),
        )
        syncReportDetailLoadStates(mergedReports.map((report) => report.id))
        const mergedProfiles = includeProfiles
          ? result.state.profiles
          : [
              result.currentUser,
              ...currentStateRef.current.profiles.filter(
                (profile) => profile.id !== result.currentUser.id,
              ),
            ]

        const nextState = {
          ...result.state,
          profiles: mergedProfiles,
          roles: result.state.roles ?? currentStateRef.current.roles,
          reports: mergedReports,
          assignments:
            result.state.assignments.length > 0
              ? result.state.assignments
              : currentStateRef.current.assignments,
          accessRequests: includeAccessRequests
            ? result.state.accessRequests
            : currentStateRef.current.accessRequests,
          statusHistory: includeHistory
            ? result.state.statusHistory
            : currentStateRef.current.statusHistory,
          auditLogs: includeHistory
            ? result.state.auditLogs
            : currentStateRef.current.auditLogs,
        }

        currentUserIdRef.current = nextState.currentUserId
        currentStateRef.current = nextState
        setState(nextState)
        // Record the applied poll signature so the next identical poll can skip;
        // structural refreshes reset it (their payload shape differs from a
        // poll's) so the following poll re-establishes the baseline.
        lastPolledStateSignatureRef.current = polledStateSignature
        profileDirectoryLoadedRef.current =
          includeProfiles || !isAdminRole(result.currentUser.role)
        if (includeAccessRequests) {
          accessRequestDataLoadedRef.current = true
        }
        if (includeHistory) {
          historyDataLoadedRef.current = true
        }
        persistWorkspaceCache(nextState, {
          profileDirectoryLoaded: profileDirectoryLoadedRef.current,
          accessRequestDataLoaded: accessRequestDataLoadedRef.current,
          historyDataLoaded: historyDataLoadedRef.current,
        })
        setError(null)
        scheduleOverdueSync()
        return result
      } catch (loadError) {
        if (loadVersion === loadVersionRef.current) {
          if (isSigningOutRef.current) {
            throw loadError
          }
          if (!currentStateRef.current.currentUserId) {
            setState(createEmptyAppState())
            resetDeferredDataState()
          }
          setError(getMessage(loadError, fallbackMessage))
        }
        throw loadError
      } finally {
        if (showBootstrapping && loadVersion === loadVersionRef.current) {
          setIsBootstrapping(false)
        } else if (!showBootstrapping) {
          endBackgroundSync()
        }
      }
    },
    [
      beginBackgroundSync,
      client,
      endBackgroundSync,
      persistWorkspaceCache,
      resetDeferredDataState,
      scheduleOverdueSync,
      syncReportDetailLoadStates,
    ],
  )

  const ensureReportDetails = useCallback(
    async (reportIds: string[], options?: EnsureReportDetailsOptions) => {
      if (!client || !currentUserIdRef.current) {
        return {} as Record<string, ReportDetailRecord>
      }

      const force = options?.force ?? false
      const silent = options?.silent ?? false
      const uniqueMissingReportIds = [...new Set(reportIds.filter(Boolean))].filter(
        (reportId) =>
          (force || !loadedReportDetailIdsRef.current.has(reportId)) &&
          !pendingReportDetailIdsRef.current.has(reportId),
      )

      if (!uniqueMissingReportIds.length) {
        return {} as Record<string, ReportDetailRecord>
      }

      uniqueMissingReportIds.forEach((reportId) => {
        if (force) {
          loadedReportDetailIdsRef.current.delete(reportId)
        }
        pendingReportDetailIdsRef.current.add(reportId)
      })
      setReportDetailLoadStates((currentStates) => {
        const nextStates = { ...currentStates }

        uniqueMissingReportIds.forEach((reportId) => {
          nextStates[reportId] = { status: 'loading', error: null }
        })

        return nextStates
      })
      beginBackgroundSync()

      try {
        const reportDetailsById = await fetchReportDetails(client, uniqueMissingReportIds)

        uniqueMissingReportIds.forEach((reportId) => {
          loadedReportDetailIdsRef.current.add(reportId)
        })

        setState((currentState) => {
          const nextState = {
            ...currentState,
            reports: currentState.reports.map((report) => {
              const details = reportDetailsById[report.id]

              if (!details) {
                return report
              }

              return {
                ...report,
                values: details.values,
                calculatedMetrics: details.calculatedMetrics,
                quality: details.quality,
              }
            }),
          }

          currentStateRef.current = nextState
          persistWorkspaceCache(nextState)
          return nextState
        })

        setReportDetailLoadStates((currentStates) => {
          const nextStates = { ...currentStates }

          uniqueMissingReportIds.forEach((reportId) => {
            nextStates[reportId] = { status: 'loaded', error: null }
          })

          return nextStates
        })

        return reportDetailsById
      } catch (detailError) {
        const message = getMessage(detailError, 'Unable to load report details.')

        uniqueMissingReportIds.forEach((reportId) => {
          loadedReportDetailIdsRef.current.delete(reportId)
        })
        setReportDetailLoadStates((currentStates) => {
          const nextStates = { ...currentStates }

          uniqueMissingReportIds.forEach((reportId) => {
            nextStates[reportId] = { status: 'error', error: message }
          })

          return nextStates
        })
        if (!silent) {
          toast.error(message)
        }
        return {} as Record<string, ReportDetailRecord>
      } finally {
        uniqueMissingReportIds.forEach((reportId) => {
          pendingReportDetailIdsRef.current.delete(reportId)
        })
        endBackgroundSync()
      }
    },
    [beginBackgroundSync, client, endBackgroundSync, persistWorkspaceCache],
  )

  const warmAdminReportDetails = useCallback(
    (workspaceState: AppState) => {
      const reportIds = getAdminDashboardWarmReportIds(workspaceState)

      if (!reportIds.length) {
        return
      }

      void ensureReportDetails(reportIds, { silent: true })
    },
    [ensureReportDetails],
  )

  useEffect(() => {
    if (!client) {
      setIsBootstrapping(false)
      setIsSyncing(false)
      setIsDataRefreshing(false)
      setState(createEmptyAppState())
      resetDeferredDataState()
      setError(null)
      return
    }

    let active = true

    void (async () => {
      try {
        // /api/workspace is already authenticated and includes currentUser, so
        // asking /api/auth/me first adds a strictly sequential request to every
        // cold start. Restore the most recent cache optimistically, then let the
        // workspace request confirm the active session and authoritative user.
        const cachedWorkspace = readLastWorkspaceCache()

        if (cachedWorkspace) {
          applyWorkspaceCache(cachedWorkspace)
          void loadUserState(cachedWorkspace.userId, 'Unable to load the signed-in workspace.', {
            showBootstrapping: false,
          })
            .then((result) => {
              if (!result || !isAdminRole(result.currentUser.role)) {
                return
              }

              warmAdminReportDetails(result.state)
            })
            .catch((loadError) => {
              if (!isSigningOutRef.current && !isLikelyOfflineError(loadError)) {
                toast.error(getMessage(loadError, 'Unable to load the signed-in workspace.'))
              }
            })
          return
        }

        // Public auth screens only need the small session probe to decide
        // whether an existing session should be redirected. An anonymous login
        // visit must not issue a knowingly unauthorized workspace request.
        if (isPublicAuthPath(window.location.pathname)) {
          const {
            data: { session },
            error: sessionError,
          } = await client.auth.getSession()

          if (sessionError) {
            throw sessionError
          }

          const sessionId = sessionUserId(session)
          if (!sessionId) {
            clearSignedOutState()
            return
          }

          const result = await loadUserState(
            sessionId,
            'Unable to load the signed-in workspace.',
            { showBootstrapping: true },
          )

          if (result && isAdminRole(result.currentUser.role)) {
            warmAdminReportDetails(result.state)
          }
          return
        }

        const result = await loadUserState(
          'authenticated-session',
          'Unable to load the signed-in workspace.',
          {
            showBootstrapping: true,
          },
        )

        if (!active || !result || !isAdminRole(result.currentUser.role)) {
          return
        }

        warmAdminReportDetails(result.state)
      } catch (loadError) {
        clearSignedOutState()
        if (!isSigningOutRef.current) {
          setError(getMessage(loadError, 'Unable to load the signed-in workspace.'))
          toast.error(getMessage(loadError, 'Unable to load the signed-in workspace.'))
        }
      }
    })()

    const authListener = client.auth.onAuthStateChange((event, session) => {
      if (!active) {
        return
      }

      if (event === 'INITIAL_SESSION') {
        return
      }

      const userId = sessionUserId(session)
      if (isSigningOutRef.current) {
        if (!userId) {
          clearSignedOutState()
        }
        return
      }

      if (!userId) {
        clearSignedOutState()
        return
      }

      if (pendingExplicitAuthUserIdRef.current === userId) {
        return
      }

      if (event === 'SIGNED_IN' && suppressNextSignedInLoadRef.current) {
        suppressNextSignedInLoadRef.current = false
        return
      }

      const isSameUserSession = currentUserIdRef.current === userId
      const handleWorkspaceRefresh = () => {
        void loadUserState(userId, 'Unable to update the signed-in workspace.', {
          showBootstrapping: false,
        })
          .then((result) => {
            if (!result || !isAdminRole(result.currentUser.role)) {
              return
            }

            warmAdminReportDetails(result.state)
          })
          .catch((loadError) => {
            if (!isSigningOutRef.current) {
              toast.error(
                getMessage(loadError, 'Unable to update the signed-in workspace.'),
              )
            }
          })
      }

      if (!isSameUserSession) {
        void fetchCurrentUserProfile(client, userId)
          .then(({ currentUser: profile }) => {
            if (!active) {
              return
            }

            applyAuthenticatedProfile(profile)
            handleWorkspaceRefresh()
          })
          .catch((loadError) => {
            if (!isSigningOutRef.current) {
              toast.error(
                getMessage(loadError, 'Unable to update the signed-in workspace.'),
              )
            }
          })
        return
      }

      handleWorkspaceRefresh()
    })

    return () => {
      active = false
      authListener.data.subscription.unsubscribe()
    }
  }, [
    applyAuthenticatedProfile,
    applyWorkspaceCache,
    client,
    clearSignedOutState,
    loadUserState,
    resetDeferredDataState,
    warmAdminReportDetails,
  ])

  const refreshDataWithOptions = useCallback(async (options?: LiveAppStateLoadOptions) => {
    if (!client) {
      return
    }

    const userId = currentUserIdRef.current
    if (!userId) {
      clearSignedOutState()
      return
    }

    try {
      const result = await loadUserState(userId, 'Unable to refresh the live dashboard data.', {
        showBootstrapping: false,
        includeProfiles: options?.includeProfiles ?? profileDirectoryLoadedRef.current,
        includeAccessRequests: options?.includeAccessRequests ?? false,
        includeHistory: options?.includeHistory ?? false,
        reportPeriodWindow: options?.reportPeriodWindow ?? reportPeriodWindowRef.current,
      })

      const loadedPeriodIds = [...loadedReportPeriodIdsRef.current]
      if (result && loadedPeriodIds.length > 0) {
        await ensureReportSummaryData({
          periodIds: loadedPeriodIds,
          force: true,
        })
      }

      if (result && isAdminRole(result.currentUser.role)) {
        warmAdminReportDetails(currentStateRef.current)
      }
    } catch (refreshError) {
      if (!isSigningOutRef.current) {
        toast.error(getMessage(refreshError, 'Unable to refresh the live dashboard data.'))
      }
    }
  }, [
    client,
    clearSignedOutState,
    ensureReportSummaryData,
    loadUserState,
    warmAdminReportDetails,
  ])

  const scheduleAdminLiveRefresh = useCallback(
    (delayMs = 700) => {
      if (!client) {
        return
      }
      const activeClient = client

      if (adminLiveRefreshTimerRef.current !== null) {
        window.clearTimeout(adminLiveRefreshTimerRef.current)
      }

      adminLiveRefreshTimerRef.current = window.setTimeout(() => {
        adminLiveRefreshTimerRef.current = null

        if (adminLiveRefreshInFlightRef.current) {
          return
        }

        adminLiveRefreshInFlightRef.current = true

        void fetchWorkspaceRevision(activeClient)
          .then((revision) => {
            if (
              workspaceRevisionRef.current !== null &&
              revision === workspaceRevisionRef.current
            ) {
              return
            }

            return refreshDataWithOptions({
              // Optional admin collections stay route-scoped. The lightweight
              // revision endpoint prevents an unchanged tab from rebuilding
              // and downloading the full workspace on every focus/poll.
              includeProfiles: false,
              includeAccessRequests: false,
              includeHistory: false,
              reportPeriodWindow: reportPeriodWindowRef.current,
            })
          })
          .catch(() => {
            // A failed freshness check should not disrupt the current screen.
            // The next focus/poll retries it and explicit refreshes still fetch
            // the workspace directly.
          })
          .finally(() => {
            adminLiveRefreshInFlightRef.current = false
          })
      }, delayMs)
    },
    [client, refreshDataWithOptions],
  )

  useEffect(() => {
    if (!client || !signedInUserId || !signedInUserRole) {
      return
    }

    // Reverb is disabled on shared hosting and the data client's realtime
    // channel is a no-op shim, so live updates come from refreshing on focus /
    // tab visibility. Admin fallback polls are randomized to avoid synchronized
    // tabs and back off while hidden; focus still checks freshness immediately.
    const isAdmin = isAdminRole(signedInUserRole)
    let fallbackPollId: number | null = null

    const scheduleFallbackPoll = () => {
      if (!isAdmin) {
        return
      }

      if (fallbackPollId !== null) {
        window.clearTimeout(fallbackPollId)
      }

      fallbackPollId = window.setTimeout(() => {
        fallbackPollId = null
        if (document.visibilityState === 'visible') {
          scheduleAdminLiveRefresh(0)
        }
        scheduleFallbackPoll()
      }, workspacePollDelay(document.visibilityState))
    }

    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') {
        scheduleAdminLiveRefresh(150)
      }
      scheduleFallbackPoll()
    }

    window.addEventListener('focus', refreshWhenVisible)
    document.addEventListener('visibilitychange', refreshWhenVisible)
    scheduleFallbackPoll()

    return () => {
      window.removeEventListener('focus', refreshWhenVisible)
      document.removeEventListener('visibilitychange', refreshWhenVisible)

      if (fallbackPollId !== null) {
        window.clearTimeout(fallbackPollId)
      }

      if (adminLiveRefreshTimerRef.current !== null) {
        window.clearTimeout(adminLiveRefreshTimerRef.current)
        adminLiveRefreshTimerRef.current = null
      }
    }
  }, [
    client,
    scheduleAdminLiveRefresh,
    signedInUserId,
    signedInUserRole,
  ])

  const isReportDetailLoaded = useCallback((reportId: string) => {
    return loadedReportDetailIdsRef.current.has(reportId)
  }, [])

  const getReportDetailLoadState = useCallback(
    (reportId: string) => {
      return reportDetailLoadStates[reportId] ?? idleReportDetailLoadState
    },
    [reportDetailLoadStates],
  )

  const applySavedReportDetails = useCallback(
    (
      reportId: string,
      payload: SaveReportPayload,
      values: SaveReportPayload['values'],
      calculatedMetrics?: AppState['reports'][number]['calculatedMetrics'],
      quality?: AppState['reports'][number]['quality'],
      serverReport?: ReportResponse,
    ) => {
      loadedReportDetailIdsRef.current.add(reportId)

      setState((currentState) => {
        let matchedReport = false
        const nextReports = currentState.reports.map((report) => {
          const isSavedReport =
            report.id === reportId ||
            (report.assignmentId === payload.assignmentId &&
              report.reportingPeriodId === payload.reportingPeriodId)

          if (!isSavedReport) {
            return report
          }

          matchedReport = true
          return {
            ...report,
            ...(serverReport ?? {}),
            departmentId:
              serverReport?.departmentSlug ?? serverReport?.departmentId ?? report.departmentId,
            templateId:
              serverReport?.templateSlug ?? serverReport?.templateId ?? report.templateId,
            values,
            calculatedMetrics: calculatedMetrics ?? report.calculatedMetrics,
            quality: quality ?? report.quality,
          }
        })

        if (!matchedReport) {
          if (!serverReport) {
            return currentState
          }

          nextReports.unshift({
            ...serverReport,
            departmentId: serverReport.departmentSlug ?? serverReport.departmentId,
            templateId: serverReport.templateSlug ?? serverReport.templateId,
            values,
            calculatedMetrics: calculatedMetrics ?? serverReport.calculatedMetrics,
            quality: quality ?? serverReport.quality,
          })
        }

        const nextState = {
          ...currentState,
          reports: nextReports,
        }

        currentStateRef.current = nextState
        persistWorkspaceCache(nextState)
        return nextState
      })
    },
    [persistWorkspaceCache],
  )

  const applyServerSavedReport = useCallback(
    (payload: SaveReportPayload, savedReport: ReportResponse) => {
      historyDataLoadedRef.current = false

      applySavedReportDetails(
        savedReport.id,
        payload,
        Object.keys(savedReport.values ?? {}).length ? savedReport.values : payload.values,
        savedReport.calculatedMetrics,
        savedReport.quality,
        savedReport,
      )
    },
    [applySavedReportDetails],
  )

  // Batched variant for flushing the offline queue. The save response already
  // contains the canonical row, values, metrics, and quality, so applying it
  // directly avoids an O(N) refresh/detail-fetch cascade after reconnect.
  const applyServerSavedReports = useCallback(
    (saves: Array<{ payload: SaveReportPayload; report: ReportResponse }>) => {
      if (!saves.length) {
        return
      }

      historyDataLoadedRef.current = false

      for (const { payload, report } of saves) {
        applySavedReportDetails(
          report.id,
          payload,
          Object.keys(report.values ?? {}).length ? report.values : payload.values,
          report.calculatedMetrics,
          report.quality,
          report,
        )
      }
    },
    [applySavedReportDetails],
  )

  const flushQueuedReportSaves = useCallback(
    async (options?: { silent?: boolean }) => {
      const userId = currentUserIdRef.current

      if (
        !client ||
        !userId ||
        queuedReportSyncInFlightRef.current ||
        isBrowserOffline()
      ) {
        return
      }

      queuedReportSyncInFlightRef.current = true
      let shouldEndBackgroundSync = false
      let syncedCount = 0
      let discardedCount = 0

      try {
        const queuedSaves = await listQueuedReportSaves(userId)
        if (!queuedSaves.length) {
          setQueuedReportSaveIds(new Set())
          return
        }

        beginBackgroundSync()
        shouldEndBackgroundSync = true

        const syncedSaves: Array<{ payload: SaveReportPayload; report: ReportResponse }> = []

        for (const queuedSave of queuedSaves) {
          try {
            const report = await saveReportMutation(client, queuedSave.payload)
            await removeQueuedReportSave(queuedSave.id)
            syncedCount += 1
            syncedSaves.push({ payload: queuedSave.payload, report })
          } catch (syncError) {
            if (isLikelyOfflineError(syncError)) {
              await recordQueuedReportSaveFailure(
                queuedSave.id,
                getMessage(syncError, 'Unable to sync the queued report save.'),
              )
              break
            }

            // A non-offline failure (e.g. the report was locked or the
            // assignment removed) will never succeed on retry - count attempts
            // and dead-letter after the cap instead of retrying forever.
            const updated = await recordQueuedReportSaveFailure(
              queuedSave.id,
              getMessage(syncError, 'Unable to sync the queued report save.'),
            )

            if (updated && updated.attempts >= MAX_QUEUED_SAVE_ATTEMPTS) {
              await removeQueuedReportSave(queuedSave.id)
              discardedCount += 1
            }
          }
        }

        if (syncedSaves.length) {
          await applyServerSavedReports(syncedSaves)
        }

        await refreshQueuedReportSaveState(userId)

        if (syncedCount > 0 && !options?.silent) {
          toast.success(
            syncedCount === 1
              ? 'Offline report save synced.'
              : `${syncedCount} offline report saves synced.`,
          )
        }

        if (discardedCount > 0) {
          toast.error(
            discardedCount === 1
              ? 'A queued report save could not be synced after several attempts and was discarded. Please re-enter it.'
              : `${discardedCount} queued report saves could not be synced and were discarded. Please re-enter them.`,
          )
        }
      } finally {
        queuedReportSyncInFlightRef.current = false
        if (shouldEndBackgroundSync) {
          endBackgroundSync()
        }
      }
    },
    [
      applyServerSavedReports,
      beginBackgroundSync,
      client,
      endBackgroundSync,
      refreshQueuedReportSaveState,
    ],
  )

  useEffect(() => {
    if (!client || !signedInUserId) {
      return
    }

    const flushWithNotice = () => {
      void flushQueuedReportSaves()
    }
    const flushSilently = () => {
      void flushQueuedReportSaves({ silent: true })
    }
    const flushWhenVisible = () => {
      if (document.visibilityState === 'visible') {
        flushSilently()
      }
    }

    window.addEventListener('online', flushWithNotice)
    document.addEventListener('visibilitychange', flushWhenVisible)
    const retryIntervalId = window.setInterval(flushSilently, 30_000)

    flushSilently()

    return () => {
      window.removeEventListener('online', flushWithNotice)
      document.removeEventListener('visibilitychange', flushWhenVisible)
      window.clearInterval(retryIntervalId)
    }
  }, [client, flushQueuedReportSaves, signedInUserId])

  const login = useCallback(
    async (email: string, password: string): Promise<UserRole | null> => {
      if (!client) {
        const message = `Laravel API is not configured. ${apiEnvSetupHint}`
        setError(message)
        toast.error(message)
        return null
      }

      isSigningOutRef.current = false
      suppressNextSignedInLoadRef.current = true

      try {
        const session = await loginWithPassword(client, email, password)
        pendingExplicitAuthUserIdRef.current = session.user.id
        const result = await loadUserState(
          session.user.id,
          'Unable to load the dashboard after sign-in.',
          {
            showBootstrapping: true,
          },
        )

        if (!result) {
          throw new Error('Unable to load the dashboard after sign-in.')
        }

        if (isAdminRole(result.currentUser.role)) {
          warmAdminReportDetails(result.state)
        }

        pendingExplicitAuthUserIdRef.current = null
        return result.currentUser.role
      } catch (loginError) {
        pendingExplicitAuthUserIdRef.current = null
        suppressNextSignedInLoadRef.current = false
        const message = getMessage(loginError, 'Unable to sign in.')
        setError(message)
        toast.error(message)
        return null
      }
    },
    [client, loadUserState, warmAdminReportDetails],
  )

  const logout = useCallback(async (): Promise<void> => {
    if (!client) {
      return
    }

    try {
      isSigningOutRef.current = true
      await signOutMutation(client)
      clearSignedOutState()
    } catch (logoutError) {
      isSigningOutRef.current = false
      toast.error(getMessage(logoutError, 'Unable to sign out.'))
    }
  }, [client, clearSignedOutState])

  const changePassword = useCallback(
    async (currentPassword: string, newPassword: string): Promise<boolean> => {
      if (!client) {
        toast.error(`Laravel API is not configured. ${apiEnvSetupHint}`)
        return false
      }

      try {
        const payload = await changePasswordMutation(client, currentPassword, newPassword)
        // The returned session has passwordChangeRequired cleared; re-seat the
        // profile so the forced-change gate releases, then load the workspace
        // (now reachable again past the password-changed gate).
        applyAuthenticatedProfile(payload.user)
        await loadUserState(
          payload.user.id,
          'Unable to load the workspace after the password change.',
          { showBootstrapping: true },
        )
        toast.success('Password updated.')
        return true
      } catch (changeError) {
        toast.error(getMessage(changeError, 'Unable to change your password.'))
        return false
      }
    },
    [client, applyAuthenticatedProfile, loadUserState],
  )

  const applyNotificationUpdate = useCallback(
    (update: (notifications: NotificationItem[]) => NotificationItem[]) => {
      setState((currentState) => {
        const nextState = {
          ...currentState,
          notifications: update(currentState.notifications),
        }
        currentStateRef.current = nextState
        persistWorkspaceCache(nextState)
        return nextState
      })
    },
    [persistWorkspaceCache],
  )

  const markNotificationsRead = useCallback(
    async (userId: string, notificationIds: string[]): Promise<void> => {
      if (!client || !notificationIds.length) {
        return
      }

      try {
        const response = await updateNotificationReadState(client, userId, notificationIds)
        const updatedById = new Map(
          (response?.data ?? []).map((notification) => [notification.id, notification]),
        )
        applyNotificationUpdate((notifications) =>
          notifications.map((notification) => updatedById.get(notification.id) ?? notification),
        )
      } catch (notificationError) {
        toast.error(
          getMessage(notificationError, 'Unable to mark notifications as read.'),
        )
      }
    },
    [applyNotificationUpdate, client],
  )

  const clearNotifications = useCallback(
    async (userId: string, notificationIds: string[]): Promise<void> => {
      if (!client || !notificationIds.length) {
        return
      }

      try {
        await clearNotificationsMutation(client, userId, notificationIds)
        const removedIds = new Set(notificationIds)
        applyNotificationUpdate((notifications) =>
          notifications.filter((notification) => !removedIds.has(notification.id)),
        )
      } catch (notificationError) {
        toast.error(getMessage(notificationError, 'Unable to clear notifications.'))
      }
    },
    [applyNotificationUpdate, client],
  )

  const restoreNotifications = useCallback(
    async (notifications: NotificationItem[]): Promise<void> => {
      if (!client || !notifications.length) {
        return
      }

      try {
        const response = await restoreNotificationsMutation(client, notifications)
        const restored = response?.data ?? notifications
        applyNotificationUpdate((currentNotifications) => {
          const restoredIds = new Set(restored.map((notification) => notification.id))
          return [
            ...restored,
            ...currentNotifications.filter((notification) => !restoredIds.has(notification.id)),
          ].sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
        })
      } catch (notificationError) {
        toast.error(getMessage(notificationError, 'Unable to restore notifications.'))
      }
    },
    [applyNotificationUpdate, client],
  )

  // Both resolve to the server's own copy on success (null on failure). The
  // submission endpoints answer identically whether the request was stored or
  // silently discarded, so their message is the only guidance an applicant who
  // already has an account ever gets.
  const submitAccessRequest = useCallback(
    async (payload: AccessRequestPayload): Promise<string | null> => {
      if (!client) {
        toast.error(`Laravel API is not configured. ${apiEnvSetupHint}`)
        return null
      }

      try {
        const result = await submitAccessRequestMutation(client, payload, currentUser)
        await refreshDataWithOptions({
          includeAccessRequests: Boolean(currentUser),
        })
        return result.message ?? ''
      } catch (requestError) {
        toast.error(
          getMessage(requestError, 'Unable to submit the access request.'),
        )
        return null
      }
    },
    [client, currentUser, refreshDataWithOptions],
  )

  const submitAdminAccessRequest = useCallback(
    async (payload: SubmitAdminAccessRequestPayload): Promise<string | null> => {
      if (!client) {
        toast.error(`Laravel API is not configured. ${apiEnvSetupHint}`)
        return null
      }

      try {
        const result = await submitAdminAccessRequestMutation(client, payload)
        return result?.message ?? ''
      } catch (requestError) {
        toast.error(getMessage(requestError, 'Unable to submit the admin access request.'))
        return null
      }
    },
    [client],
  )

  const refreshAdminAccessRequests = useCallback(async (): Promise<void> => {
    if (!client || !currentUser || !isAdminRole(currentUser.role)) {
      return
    }

    try {
      setAdminAccessRequests(await fetchAdminAccessRequestsQuery(client))
    } catch {
      // A non-approver (e.g. a nurse) gets a 403 here; leave the list empty.
      setAdminAccessRequests([])
    }
  }, [client, currentUser])

  const approveAdminAccessRequest = useCallback(
    async (
      requestId: string,
      profile?: { trainingYear: number; rotationGroup?: string | null },
    ): Promise<void> => {
      if (!client) {
        return
      }

      try {
        await reviewAdminAccessRequestMutation(client, requestId, 'approved', profile)
        await refreshAdminAccessRequests()
        await refreshDataWithOptions({ includeProfiles: profileDirectoryLoadedRef.current })
        toast.success('Account request approved.')
      } catch (reviewError) {
        toast.error(getMessage(reviewError, 'Unable to approve the account request.'))
      }
    },
    [client, refreshAdminAccessRequests, refreshDataWithOptions],
  )

  const rejectAdminAccessRequest = useCallback(
    async (requestId: string): Promise<void> => {
      if (!client) {
        return
      }

      try {
        await reviewAdminAccessRequestMutation(client, requestId, 'rejected')
        await refreshAdminAccessRequests()
        toast.success('Account request rejected.')
      } catch (reviewError) {
        toast.error(getMessage(reviewError, 'Unable to reject the account request.'))
      }
    },
    [client, refreshAdminAccessRequests],
  )

  const createAdminAccount = useCallback(
    async (payload: CreateAdminAccountPayload): Promise<boolean> => {
      if (!client) {
        toast.error(`Laravel API is not configured. ${apiEnvSetupHint}`)
        return false
      }

      if (!currentUser || !isAdminRole(currentUser.role)) {
        toast.error('Only an authenticated administrator can create accounts.')
        return false
      }

      try {
        await createAdminAccountMutation(client, payload)
        await refreshDataWithOptions({
          includeProfiles: profileDirectoryLoadedRef.current,
        })
        return true
      } catch (createError) {
        toast.error(getMessage(createError, 'Unable to create the account.'))
        return false
      }
    },
    [client, currentUser, refreshDataWithOptions],
  )

  const approveAccessRequest = useCallback(
    async (requestId: string): Promise<void> => {
      if (!client) {
        return
      }

      try {
        await reviewAccessRequestMutation(client, requestId, 'approved')
        await refreshDataWithOptions({ includeAccessRequests: true })
      } catch (reviewError) {
        toast.error(
          getMessage(reviewError, 'Unable to approve the access request.'),
        )
      }
    },
    [client, refreshDataWithOptions],
  )

  const rejectAccessRequest = useCallback(
    async (requestId: string): Promise<void> => {
      if (!client) {
        return
      }

      try {
        await reviewAccessRequestMutation(client, requestId, 'rejected')
        await refreshDataWithOptions({ includeAccessRequests: true })
      } catch (reviewError) {
        toast.error(
          getMessage(reviewError, 'Unable to reject the access request.'),
        )
      }
    },
    [client, refreshDataWithOptions],
  )

  const saveReport = useCallback(
    async (payload: SaveReportPayload): Promise<SaveReportResult> => {
      if (!client) {
        return { saved: false, queued: false }
      }

      try {
        const report = await saveReportMutation(client, payload)
        const userId = currentUserIdRef.current ?? payload.actorId

        await removeQueuedReportSave(
          getReportSaveQueueId(userId, payload.assignmentId, payload.reportingPeriodId),
        )
        await refreshQueuedReportSaveState(userId)
        applyServerSavedReport(payload, report)

        return { saved: true, queued: false }
      } catch (saveError) {
        if (isLikelyOfflineError(saveError)) {
          try {
            const userId = currentUserIdRef.current ?? payload.actorId
            await queueReportSave(userId, payload)
            await refreshQueuedReportSaveState(userId)

            toast.info(
              payload.submit
                ? 'Report submission queued offline.'
                : 'Report draft queued offline.',
              {
                description: 'It will sync automatically when the connection returns.',
              },
            )

            return { saved: true, queued: true }
          } catch (queueError) {
            toast.error(
              getMessage(
                queueError,
                'Unable to save the report or store an offline copy.',
              ),
            )
            return { saved: false, queued: false }
          }
        }

        toast.error(getMessage(saveError, 'Unable to save the report.'))
        return { saved: false, queued: false }
      }
    },
    [
      applyServerSavedReport,
      client,
      refreshQueuedReportSaveState,
    ],
  )

  const lockReport = useCallback(
    async (reportId: string): Promise<void> => {
      if (!client) {
        return
      }

      try {
        await setReportLockState(client, reportId, true)
        historyDataLoadedRef.current = false
        await refreshDataWithOptions()
      } catch (lockError) {
        toast.error(getMessage(lockError, 'Unable to lock the report.'))
      }
    },
    [client, refreshDataWithOptions],
  )

  const unlockReport = useCallback(
    async (reportId: string): Promise<void> => {
      if (!client) {
        return
      }

      try {
        await setReportLockState(client, reportId, false)
        historyDataLoadedRef.current = false
        await refreshDataWithOptions()
      } catch (unlockError) {
        toast.error(getMessage(unlockError, 'Unable to unlock the report.'))
      }
    },
    [client, refreshDataWithOptions],
  )

  const updateSettings = useCallback(
    async (settings: Partial<AppSettings>): Promise<void> => {
      if (!client) {
        return
      }

      try {
        await updateAppSettingsMutation(client, settings)
        await refreshDataWithOptions()
      } catch (settingsError) {
        toast.error(getMessage(settingsError, 'Unable to save the settings.'))
      }
    },
    [client, refreshDataWithOptions],
  )

  const toggleUserActive = useCallback(
    async (userId: string): Promise<void> => {
      if (!client) {
        return
      }

      const targetUser = state.profiles.find((profile) => profile.id === userId)
      if (!targetUser) {
        return
      }

      try {
        await updateUserActiveState(client, userId, !targetUser.active)
        await refreshDataWithOptions({
          includeProfiles: profileDirectoryLoadedRef.current,
          includeAccessRequests: accessRequestDataLoadedRef.current,
        })
      } catch (profileError) {
        toast.error(getMessage(profileError, 'Unable to update the user status.'))
      }
    },
    [client, state, refreshDataWithOptions],
  )

  const toggleAssignmentActive = useCallback(
    async (assignmentId: string): Promise<void> => {
      if (!client) {
        return
      }

      const targetAssignment = state.assignments.find(
        (assignment) => assignment.id === assignmentId,
      )
      if (!targetAssignment) {
        return
      }

      try {
        await updateAssignmentActiveState(
          client,
          assignmentId,
          !targetAssignment.active,
        )
        await refreshDataWithOptions({
          includeProfiles: profileDirectoryLoadedRef.current,
          includeAccessRequests: accessRequestDataLoadedRef.current,
        })
      } catch (assignmentError) {
        toast.error(
          getMessage(assignmentError, 'Unable to update the assignment status.'),
        )
      }
    },
    [client, state, refreshDataWithOptions],
  )

  const assignUserToDepartment = useCallback(
    async (userId: string, departmentId: string, templateId: string): Promise<void> => {
      if (!client || !currentUser) {
        return
      }

      try {
        let assignmentReferences = referencesRef.current

        if (!hasAssignmentReference(referencesRef.current, departmentId, templateId)) {
          const result = await loadUserState(
            currentUser.id,
            'Unable to refresh department references before creating the assignment.',
            {
              showBootstrapping: false,
              includeProfiles: profileDirectoryLoadedRef.current,
              includeAccessRequests: accessRequestDataLoadedRef.current,
              includeHistory: historyDataLoadedRef.current,
            },
          )

          assignmentReferences = result?.references ?? referencesRef.current
        }

        if (!hasAssignmentReference(assignmentReferences, departmentId, templateId)) {
          const department = departmentMap[departmentId]
          const template = templateMap[templateId]

          if (!department || !template) {
            throw new Error('The selected department or template is not available in the Laravel API.')
          }

          const ensuredReference = await ensureDepartmentReferenceData(
            client,
            department,
            template,
          )
          assignmentReferences = {
            departmentDbIdBySlug: {
              ...assignmentReferences.departmentDbIdBySlug,
              [departmentId]: ensuredReference.departmentId,
            },
            templateDbIdBySlug: {
              ...assignmentReferences.templateDbIdBySlug,
              [templateId]: ensuredReference.templateId,
            },
            templateDbIdByDepartmentSlug: {
              ...assignmentReferences.templateDbIdByDepartmentSlug,
              [departmentId]: ensuredReference.templateId,
            },
          }
          referencesRef.current = assignmentReferences
        }

        await assignUserToDepartmentMutation(
          client,
          assignmentReferences,
          userId,
          departmentId,
          templateId,
          currentUser.id,
        )
        await refreshDataWithOptions({
          includeProfiles: profileDirectoryLoadedRef.current,
          includeAccessRequests: accessRequestDataLoadedRef.current,
        })
      } catch (assignmentError) {
        toast.error(
          getMessage(assignmentError, 'Unable to create the assignment.'),
        )
      }
    },
    [client, currentUser, loadUserState, refreshDataWithOptions],
  )

  const ensureProfileDirectoryData = useCallback(
    async (): Promise<void> => {
      if (!client || !currentUserIdRef.current || profileDirectoryLoadedRef.current) {
        return
      }

      if (profileDirectoryRequestRef.current) {
        return profileDirectoryRequestRef.current
      }

      const request = (async () => {
        try {
        // Targeted fetch: the directory only. Re-running the full workspace
        // load with includeProfiles=1 re-downloaded ~214 KB of reports, audit
        // logs, and notifications to obtain one list, which was the second
        // /api/workspace call on every admin page (INTERACTION_LATENCY_AUDIT).
        const profiles = await fetchProfileDirectory(client)

        const nextState = { ...currentStateRef.current, profiles }
        currentStateRef.current = nextState
        setState(nextState)
        profileDirectoryLoadedRef.current = true
        persistWorkspaceCache(nextState, { profileDirectoryLoaded: true })
        } catch (loadError) {
          toast.error(getMessage(loadError, 'Unable to load the user directory.'))
        }
      })().finally(() => {
        profileDirectoryRequestRef.current = null
      })
      profileDirectoryRequestRef.current = request
      return request
    },
    [client, persistWorkspaceCache],
  )

  const ensureAccessRequestData = useCallback(
    async (): Promise<void> => {
      if (!client || !currentUserIdRef.current || accessRequestDataLoadedRef.current) {
        return
      }

      if (accessRequestDataRequestRef.current) {
        return accessRequestDataRequestRef.current
      }

      const request = (async () => {
        try {
          const currentProfile = currentStateRef.current.profiles.find(
            (profile) => profile.id === currentUserIdRef.current,
          )
          const accessRequests = await fetchAccessRequests(client, {
            pendingOnly: currentProfile ? isAdminRole(currentProfile.role) : false,
          })
          const nextState = {
            ...currentStateRef.current,
            accessRequests,
          }
          currentStateRef.current = nextState
          setState(nextState)
          accessRequestDataLoadedRef.current = true
          persistWorkspaceCache(nextState, {
            accessRequestDataLoaded: true,
          })
        } catch (loadError) {
          toast.error(getMessage(loadError, 'Unable to load access requests.'))
        }
      })().finally(() => {
        accessRequestDataRequestRef.current = null
      })
      accessRequestDataRequestRef.current = request
      return request
    },
    [client, persistWorkspaceCache],
  )

  const ensureUserManagementData = useCallback(
    async (): Promise<void> => {
      if (
        !client ||
        !currentUserIdRef.current ||
        (profileDirectoryLoadedRef.current && accessRequestDataLoadedRef.current)
      ) {
        return
      }

      try {
        await Promise.all([
          ensureProfileDirectoryData(),
          ensureAccessRequestData(),
          ensureReportSummaryData({
            periodIds: currentStateRef.current.reportingPeriods
              .slice(-1)
              .map(({ id }) => id),
          }),
        ])
      } catch (loadError) {
        toast.error(getMessage(loadError, 'Unable to load users and access requests.'))
      }
    },
    [
      client,
      ensureAccessRequestData,
      ensureProfileDirectoryData,
      ensureReportSummaryData,
    ],
  )

  const ensureHistoryData = useCallback(
    async (): Promise<void> => {
      if (!client || !currentUserIdRef.current || historyDataLoadedRef.current) {
        return
      }

      beginBackgroundSync()
      try {
        const currentProfile = currentStateRef.current.profiles.find(
          ({ id }) => id === currentUserIdRef.current,
        )
        const [{ history, reports }, auditLogs] = await Promise.all([
          fetchReportStatusHistory(client),
          currentProfile && isAdminRole(currentProfile.role)
            ? fetchCellAuditLogs(client)
            : Promise.resolve([]),
        ])
        const reportRows = reports.map(reportSummaryRecord)

        setState((currentState) => {
          const reportsById = new Map(currentState.reports.map((report) => [report.id, report]))
          reportRows.forEach((report) => {
            if (!reportsById.has(report.id)) {
              reportsById.set(report.id, report)
            }
          })
          const nextState = {
            ...currentState,
            reports: [...reportsById.values()],
            statusHistory: history,
            auditLogs,
          }

          currentStateRef.current = nextState
          persistWorkspaceCache(nextState, { historyDataLoaded: true })
          return nextState
        })
        historyDataLoadedRef.current = true
      } catch (loadError) {
        toast.error(getMessage(loadError, 'Unable to load report history.'))
      } finally {
        endBackgroundSync()
      }
    },
    [beginBackgroundSync, client, endBackgroundSync, persistWorkspaceCache],
  )

  const resolveDepartmentSlug = useCallback((departmentIdOrSlug: string): string | null => {
    if (departmentMap[departmentIdOrSlug]) {
      return departmentIdOrSlug
    }

    return Object.entries(referencesRef.current.departmentDbIdBySlug).find(
      ([, databaseId]) => databaseId === departmentIdOrSlug,
    )?.[0] ?? null
  }, [])

  const value = useMemo<AppDataContextValue>(
    () => ({
      state,
      currentUser,
      academic,
      isBootstrapping,
      isConfigured: isApiConfigured,
      missingEnvVars: missingApiEnvKeys,
      error,
      login,
      logout,
      markNotificationsRead,
      clearNotifications,
      restoreNotifications,
      submitAccessRequest,
      submitAdminAccessRequest,
      createAdminAccount,
      approveAccessRequest,
      rejectAccessRequest,
      adminAccessRequests,
      refreshAdminAccessRequests,
      approveAdminAccessRequest,
      rejectAdminAccessRequest,
      saveReport,
      queuedReportSaveCount: queuedReportSaveIds.size,
      hasQueuedReportSave,
      lockReport,
      unlockReport,
      isReportDetailLoaded,
      getReportDetailLoadState,
      updateSettings,
      toggleUserActive,
      toggleAssignmentActive,
      assignUserToDepartment,
      ensureProfileDirectoryData,
      ensureAccessRequestData,
      ensureUserManagementData,
      ensureHistoryData,
      ensureReportSummaryData,
      ensureReportDetails,
      reportPeriodWindow: reportPeriodWindowRef.current,
      resolveDepartmentSlug,
      refreshData: refreshDataWithOptions,
      changePassword,
    }),
    [
      state,
      currentUser,
      academic,
      isBootstrapping,
      error,
      login,
      logout,
      changePassword,
      markNotificationsRead,
      clearNotifications,
      restoreNotifications,
      submitAccessRequest,
      submitAdminAccessRequest,
      createAdminAccount,
      approveAccessRequest,
      rejectAccessRequest,
      adminAccessRequests,
      refreshAdminAccessRequests,
      approveAdminAccessRequest,
      rejectAdminAccessRequest,
      saveReport,
      queuedReportSaveIds,
      hasQueuedReportSave,
      lockReport,
      unlockReport,
      isReportDetailLoaded,
      getReportDetailLoadState,
      updateSettings,
      toggleUserActive,
      toggleAssignmentActive,
      assignUserToDepartment,
      ensureProfileDirectoryData,
      ensureAccessRequestData,
      ensureUserManagementData,
      ensureHistoryData,
      ensureReportSummaryData,
      ensureReportDetails,
      resolveDepartmentSlug,
      refreshDataWithOptions,
    ],
  )

  const syncValue = useMemo<AppSyncContextValue>(
    () => ({ isSyncing, isDataRefreshing }),
    [isSyncing, isDataRefreshing],
  )

  return (
    <AppDataContext.Provider value={value}>
      <AppSyncContext.Provider value={syncValue}>{children}</AppSyncContext.Provider>
    </AppDataContext.Provider>
  )
}

export function useAppData() {
  const context = useContext(AppDataContext)

  if (!context) {
    throw new Error('useAppData must be used inside AppDataProvider')
  }

  return context
}

export function useAppSync() {
  const context = useContext(AppSyncContext)

  if (!context) {
    throw new Error('useAppSync must be used inside AppDataProvider')
  }

  return context
}

export function useAppState() {
  return useAppData().state
}

export function useCurrentUserProfile() {
  return useAppData().currentUser
}

export function useCurrentReportingPeriod() {
  const state = useAppState()
  return getCurrentPeriod(state)
}
