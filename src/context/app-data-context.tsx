/* eslint-disable react-refresh/only-export-components */
import {
  useCallback,
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type PropsWithChildren,
} from 'react'
import { toast } from 'sonner'

import { createEmptyAppState } from '@/lib/app-state'
import type {
  AccessRequestPayload,
  ClaimSuperadminPayload,
  CreateAdminAccountPayload,
  LiveAppStateLoadOptions,
  ReportDetailRecord,
  SaveReportPayload,
  SupabaseReferenceState,
} from '@/lib/supabase/api'
import {
  assignUserToDepartment as assignUserToDepartmentMutation,
  claimSuperadmin as claimSuperadminMutation,
  createAdminAccount as createAdminAccountMutation,
  createEmptyReferenceState,
  fetchCurrentUserProfile,
  fetchReportDetails,
  fetchLiveAppState,
  isAdminRole,
  loginWithPassword,
  reviewAccessRequest as reviewAccessRequestMutation,
  restoreNotifications as restoreNotificationsMutation,
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
} from '@/lib/supabase/api'
import {
  getSupabaseBrowserClient,
  isSupabaseConfigured,
} from '@/lib/supabase/client'
import {
  missingSupabaseEnvKeys,
  supabaseEnvSetupHint,
} from '@/lib/supabase/env'
import {
  getCurrentPeriod,
  getCurrentUser,
  getVisibleReportingPeriods,
} from '@/data/selectors'
import type {
  AppSettings,
  AppState,
  NotificationItem,
  UserProfile,
  UserRole,
} from '@/types/domain'

type AppDataContextValue = {
  state: AppState
  currentUser: UserProfile | null
  isBootstrapping: boolean
  isSyncing: boolean
  isDataRefreshing: boolean
  isConfigured: boolean
  missingEnvVars: string[]
  error: string | null
  login: (email: string, password: string) => Promise<UserRole | null>
  logout: () => Promise<void>
  markNotificationsRead: (userId: string, notificationIds: string[]) => Promise<void>
  clearNotifications: (userId: string, notificationIds: string[]) => Promise<void>
  restoreNotifications: (notifications: NotificationItem[]) => Promise<void>
  submitAccessRequest: (payload: AccessRequestPayload) => Promise<boolean>
  claimSuperadmin: (payload: ClaimSuperadminPayload) => Promise<boolean>
  createAdminAccount: (payload: CreateAdminAccountPayload) => Promise<boolean>
  approveAccessRequest: (requestId: string, reviewerId: string) => Promise<void>
  rejectAccessRequest: (requestId: string, reviewerId: string) => Promise<void>
  saveReport: (payload: SaveReportPayload) => Promise<boolean>
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
  ensureHistoryData: () => Promise<void>
  ensureReportDetails: (
    reportIds: string[],
    options?: EnsureReportDetailsOptions,
  ) => Promise<Record<string, ReportDetailRecord>>
  refreshData: (options?: LiveAppStateLoadOptions) => Promise<void>
}

const AppDataContext = createContext<AppDataContextValue | null>(null)
const workspaceCacheStorageKey = 'mesay:workspace-state:v3'

type ReportDetailLoadState = {
  status: 'idle' | 'loading' | 'loaded' | 'error'
  error: string | null
}

type EnsureReportDetailsOptions = {
  force?: boolean
}

const idleReportDetailLoadState: ReportDetailLoadState = {
  status: 'idle',
  error: null,
}

type WorkspaceCacheRecord = {
  version: 3
  userId: string
  state: AppState
  profileDirectoryLoaded: boolean
  accessRequestDataLoaded: boolean
  historyDataLoaded: boolean
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

function readWorkspaceCache(userId: string) {
  if (typeof window === 'undefined') {
    return null
  }

  try {
    const rawValue = window.sessionStorage.getItem(workspaceCacheStorageKey)
    if (!rawValue) {
      return null
    }

    const parsedValue = JSON.parse(rawValue) as Partial<WorkspaceCacheRecord>

    if (
      parsedValue.version !== 3 ||
      parsedValue.userId !== userId ||
      !parsedValue.state
    ) {
      return null
    }

    return parsedValue as WorkspaceCacheRecord
  } catch {
    return null
  }
}

function writeWorkspaceCache(cacheRecord: WorkspaceCacheRecord) {
  if (typeof window === 'undefined') {
    return
  }

  try {
    window.sessionStorage.setItem(
      workspaceCacheStorageKey,
      JSON.stringify(cacheRecord),
    )
  } catch {
    // Keep the app responsive even if the session cache cannot be written.
  }
}

function clearWorkspaceCache() {
  if (typeof window === 'undefined') {
    return
  }

  try {
    window.sessionStorage.removeItem(workspaceCacheStorageKey)
  } catch {
    // Ignore session cache cleanup errors.
  }
}

function getAdminDashboardWarmReportIds(state: AppState) {
  const visibleReportingPeriods = getVisibleReportingPeriods(state)
  const dashboardPeriodIds = new Set(
    visibleReportingPeriods.slice(-8).map((period) => period.id),
  )

  return state.reports
    .filter((report) => dashboardPeriodIds.has(report.reportingPeriodId))
    .map((report) => report.id)
}

export function AppDataProvider({ children }: PropsWithChildren) {
  const client = getSupabaseBrowserClient()
  const [state, setState] = useState<AppState>(() => createEmptyAppState())
  const [isBootstrapping, setIsBootstrapping] = useState(isSupabaseConfigured)
  const [isSyncing, setIsSyncing] = useState(false)
  const [isDataRefreshing, setIsDataRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reportDetailLoadStates, setReportDetailLoadStates] = useState<
    Record<string, ReportDetailLoadState>
  >({})
  const referencesRef = useRef<SupabaseReferenceState>(createEmptyReferenceState())
  const loadVersionRef = useRef(0)
  const currentUserIdRef = useRef<string | null>(null)
  const currentStateRef = useRef<AppState>(createEmptyAppState())
  const suppressNextSignedInLoadRef = useRef(false)
  const pendingExplicitAuthUserIdRef = useRef<string | null>(null)
  const isSigningOutRef = useRef(false)
  const profileDirectoryLoadedRef = useRef(false)
  const accessRequestDataLoadedRef = useRef(false)
  const historyDataLoadedRef = useRef(false)
  const loadedReportDetailIdsRef = useRef<Set<string>>(new Set())
  const pendingReportDetailIdsRef = useRef<Set<string>>(new Set())
  const overdueSyncInFlightRef = useRef(false)
  const lastOverdueSyncAtRef = useRef(0)
  const syncPendingCountRef = useRef(0)
  const syncIndicatorTimeoutRef = useRef<number | null>(null)
  const adminLiveRefreshTimerRef = useRef<number | null>(null)
  const adminLiveRefreshInFlightRef = useRef(false)

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

  useEffect(() => {
    currentUserIdRef.current = state.currentUserId
    currentStateRef.current = state
  }, [state])

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
    historyDataLoadedRef.current = false
    loadedReportDetailIdsRef.current = new Set()
    pendingReportDetailIdsRef.current = new Set()
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
        clearWorkspaceCache()
        return
      }

      writeWorkspaceCache({
        version: 3,
        userId: nextState.currentUserId,
        state: nextState,
        profileDirectoryLoaded:
          overrides?.profileDirectoryLoaded ?? profileDirectoryLoadedRef.current,
        accessRequestDataLoaded:
          overrides?.accessRequestDataLoaded ?? accessRequestDataLoadedRef.current,
        historyDataLoaded:
          overrides?.historyDataLoaded ?? historyDataLoadedRef.current,
      })
    },
    [],
  )

  const applyWorkspaceCache = useCallback(
    (cacheRecord: WorkspaceCacheRecord) => {
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
      setState(cacheRecord.state)
      currentUserIdRef.current = cacheRecord.state.currentUserId
      currentStateRef.current = cacheRecord.state
      setError(null)
      setIsBootstrapping(false)
    },
    [],
  )

  const clearSignedOutState = useCallback(() => {
    loadVersionRef.current += 1
    pendingExplicitAuthUserIdRef.current = null
    referencesRef.current = createEmptyReferenceState()
    currentUserIdRef.current = null
    currentStateRef.current = createEmptyAppState()
    syncPendingCountRef.current = 0
    setState(createEmptyAppState())
    resetDeferredDataState()
    clearWorkspaceCache()
    setError(null)
    setIsBootstrapping(false)
    setIsSyncing(false)
    setIsDataRefreshing(false)
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
        })

        if (loadVersion !== loadVersionRef.current) {
          return result
        }

        referencesRef.current = result.references
        const previouslyLoadedReportDetailIds = loadedReportDetailIdsRef.current
        const existingReportsById = Object.fromEntries(
          currentStateRef.current.reports.map((report) => [report.id, report]),
        ) as Record<string, AppState['reports'][number]>
        const mergedReports = result.state.reports.map((report) => {
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
        syncReportDetailLoadStates(result.state.reports.map((report) => report.id))
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
          reports: mergedReports,
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

  async function refreshData() {
    await refreshDataWithOptions()
  }

  const ensureReportDetails = useCallback(
    async (reportIds: string[], options?: EnsureReportDetailsOptions) => {
      if (!client || !currentUserIdRef.current) {
        return {} as Record<string, ReportDetailRecord>
      }

      const force = options?.force ?? false
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
        toast.error(message)
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
      const {
        data: { session },
        error: sessionError,
      } = await client.auth.getSession()

      if (!active) {
        return
      }

      if (sessionError) {
        setError(getMessage(sessionError, 'Unable to read the current session.'))
        setIsBootstrapping(false)
        setIsSyncing(false)
        return
      }

      const userId = sessionUserId(session)
      if (!userId) {
        clearSignedOutState()
        return
      }

      try {
        const cachedWorkspace = readWorkspaceCache(userId)

        if (cachedWorkspace) {
          applyWorkspaceCache(cachedWorkspace)
          void loadUserState(userId, 'Unable to load the signed-in workspace.', {
            showBootstrapping: false,
          })
            .then((result) => {
              if (!result || !isAdminRole(result.currentUser.role)) {
                return
              }

              void ensureReportDetails(getAdminDashboardWarmReportIds(result.state))
            })
            .catch((loadError) => {
              if (!isSigningOutRef.current) {
                toast.error(getMessage(loadError, 'Unable to load the signed-in workspace.'))
              }
            })
          return
        }

        const result = await loadUserState(
          userId,
          'Unable to load the signed-in workspace.',
          {
            showBootstrapping: true,
          },
        )

        if (!active || !result || !isAdminRole(result.currentUser.role)) {
          return
        }

        await ensureReportDetails(getAdminDashboardWarmReportIds(result.state))
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

            void ensureReportDetails(getAdminDashboardWarmReportIds(result.state))
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
    ensureReportDetails,
    loadUserState,
    resetDeferredDataState,
  ])

  const refreshDataWithOptions = useCallback(async (options?: LiveAppStateLoadOptions) => {
    if (!client) {
      return
    }

    const {
      data: { session },
      error: sessionError,
    } = await client.auth.getSession()

    if (sessionError) {
      setError(getMessage(sessionError, 'Unable to refresh the current session.'))
      return
    }

    const userId = sessionUserId(session)
    if (!userId) {
      referencesRef.current = createEmptyReferenceState()
      setState(createEmptyAppState())
      resetDeferredDataState()
      clearWorkspaceCache()
      setError(null)
      setIsBootstrapping(false)
      setIsDataRefreshing(false)
      return
    }

    try {
      const result = await loadUserState(userId, 'Unable to refresh the live dashboard data.', {
        showBootstrapping: false,
        includeProfiles: options?.includeProfiles ?? profileDirectoryLoadedRef.current,
        includeAccessRequests: options?.includeAccessRequests ?? false,
        includeHistory: options?.includeHistory ?? false,
      })

      if (result && isAdminRole(result.currentUser.role)) {
        await ensureReportDetails(getAdminDashboardWarmReportIds(currentStateRef.current))
      }
    } catch (refreshError) {
      if (!isSigningOutRef.current) {
        toast.error(getMessage(refreshError, 'Unable to refresh the live dashboard data.'))
      }
    }
  }, [client, ensureReportDetails, loadUserState, resetDeferredDataState])

  const scheduleAdminLiveRefresh = useCallback(
    (delayMs = 700) => {
      if (adminLiveRefreshTimerRef.current !== null) {
        window.clearTimeout(adminLiveRefreshTimerRef.current)
      }

      adminLiveRefreshTimerRef.current = window.setTimeout(() => {
        adminLiveRefreshTimerRef.current = null

        if (adminLiveRefreshInFlightRef.current) {
          return
        }

        adminLiveRefreshInFlightRef.current = true

        void refreshDataWithOptions({
          includeProfiles: profileDirectoryLoadedRef.current,
          includeAccessRequests: accessRequestDataLoadedRef.current,
          includeHistory: historyDataLoadedRef.current,
        }).finally(() => {
          adminLiveRefreshInFlightRef.current = false
        })
      }, delayMs)
    },
    [refreshDataWithOptions],
  )

  useEffect(() => {
    if (!client || !signedInUserId || !signedInUserRole || !isAdminRole(signedInUserRole)) {
      return
    }

    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') {
        scheduleAdminLiveRefresh(150)
      }
    }
    const refreshFromRealtime = () => {
      scheduleAdminLiveRefresh()
    }
    const channel = client
      .channel(`admin-report-sync:${signedInUserId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'reports' },
        refreshFromRealtime,
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'report_field_values' },
        refreshFromRealtime,
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'calculated_metrics' },
        refreshFromRealtime,
      )

    void channel.subscribe()

    window.addEventListener('focus', refreshWhenVisible)
    document.addEventListener('visibilitychange', refreshWhenVisible)
    const fallbackPollId = window.setInterval(refreshWhenVisible, 20_000)

    return () => {
      window.removeEventListener('focus', refreshWhenVisible)
      document.removeEventListener('visibilitychange', refreshWhenVisible)
      window.clearInterval(fallbackPollId)

      if (adminLiveRefreshTimerRef.current !== null) {
        window.clearTimeout(adminLiveRefreshTimerRef.current)
        adminLiveRefreshTimerRef.current = null
      }

      void client.removeChannel(channel)
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
            values,
            calculatedMetrics: calculatedMetrics ?? report.calculatedMetrics,
          }
        })

        if (!matchedReport) {
          return currentState
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

  const value: AppDataContextValue = {
    state,
    currentUser,
    isBootstrapping,
    isSyncing,
    isDataRefreshing,
    isConfigured: isSupabaseConfigured,
    missingEnvVars: missingSupabaseEnvKeys,
    error,
    login: async (email, password) => {
      if (!client) {
        const message = `Supabase is not configured. ${supabaseEnvSetupHint}`
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
          await ensureReportDetails(getAdminDashboardWarmReportIds(result.state))
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
    logout: async () => {
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
    },
    markNotificationsRead: async (userId, notificationIds) => {
      if (!client || !notificationIds.length) {
        return
      }

      try {
        await updateNotificationReadState(client, userId, notificationIds)
        await refreshData()
      } catch (notificationError) {
        toast.error(
          getMessage(notificationError, 'Unable to mark notifications as read.'),
        )
      }
    },
    clearNotifications: async (userId, notificationIds) => {
      if (!client || !notificationIds.length) {
        return
      }

      try {
        await clearNotificationsMutation(client, userId, notificationIds)
        await refreshData()
      } catch (notificationError) {
        toast.error(getMessage(notificationError, 'Unable to clear notifications.'))
      }
    },
    restoreNotifications: async (notifications) => {
      if (!client || !notifications.length) {
        return
      }

      try {
        await restoreNotificationsMutation(client, notifications)
        await refreshData()
      } catch (notificationError) {
        toast.error(getMessage(notificationError, 'Unable to restore notifications.'))
      }
    },
    submitAccessRequest: async (payload) => {
      if (!client) {
        toast.error(`Supabase is not configured. ${supabaseEnvSetupHint}`)
        return false
      }

      try {
        await submitAccessRequestMutation(client, payload, currentUser)
        await refreshDataWithOptions({
          includeAccessRequests: Boolean(currentUser),
        })
        return true
      } catch (requestError) {
        toast.error(
          getMessage(requestError, 'Unable to submit the access request.'),
        )
        return false
      }
    },
    claimSuperadmin: async (payload) => {
      if (!client) {
        toast.error(`Supabase is not configured. ${supabaseEnvSetupHint}`)
        return false
      }

      try {
        const result = await claimSuperadminMutation(client, payload)
        await refreshDataWithOptions({
          includeProfiles: profileDirectoryLoadedRef.current,
        })

        if (result.pendingEmail) {
          toast.success(
            `Superadmin claimed. Email change is pending for ${result.pendingEmail}. Keep using ${result.currentEmail} until you confirm the email-change link.`,
          )
        } else {
          toast.success('Superadmin account updated.')
        }

        return true
      } catch (claimError) {
        toast.error(getMessage(claimError, 'Unable to claim the superadmin account.'))
        return false
      }
    },
    createAdminAccount: async (payload) => {
      if (!client) {
        toast.error(`Supabase is not configured. ${supabaseEnvSetupHint}`)
        return false
      }

      if (!currentUser || !isAdminRole(currentUser.role)) {
        toast.error('Only an authenticated administrator can create admin accounts.')
        return false
      }

      try {
        await createAdminAccountMutation(client, payload)
        await refreshDataWithOptions({
          includeProfiles: profileDirectoryLoadedRef.current,
        })
        return true
      } catch (createError) {
        toast.error(getMessage(createError, 'Unable to create the admin account.'))
        return false
      }
    },
    approveAccessRequest: async (requestId) => {
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
    rejectAccessRequest: async (requestId) => {
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
    saveReport: async (payload) => {
      if (!client) {
        return false
      }

      try {
        const reportId = await saveReportMutation(client, payload)
        historyDataLoadedRef.current = false
        await refreshDataWithOptions()
        const savedReport =
          (reportId
            ? currentStateRef.current.reports.find((report) => report.id === reportId)
            : null) ??
          currentStateRef.current.reports.find(
            (report) =>
              report.assignmentId === payload.assignmentId &&
              report.reportingPeriodId === payload.reportingPeriodId,
          )
        const savedReportId = reportId ?? savedReport?.id

        if (savedReportId) {
          let savedValues = payload.values
          let savedCalculatedMetrics = savedReport?.calculatedMetrics

          try {
            const reportDetailsById = await fetchReportDetails(client, [savedReportId])
            const reportDetails = reportDetailsById[savedReportId]

            if (reportDetails) {
              savedValues = Object.keys(reportDetails.values).length
                ? reportDetails.values
                : payload.values
              savedCalculatedMetrics = reportDetails.calculatedMetrics
            }
          } catch (detailError) {
            toast.error(
              getMessage(
                detailError,
                'Report saved, but the saved cell values could not be refreshed.',
              ),
            )
          }

          applySavedReportDetails(
            savedReportId,
            payload,
            savedValues,
            savedCalculatedMetrics,
          )
        }

        return true
      } catch (saveError) {
        toast.error(getMessage(saveError, 'Unable to save the report.'))
        return false
      }
    },
    lockReport: async (reportId) => {
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
    unlockReport: async (reportId) => {
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
    updateSettings: async (settings) => {
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
    toggleUserActive: async (userId) => {
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
    toggleAssignmentActive: async (assignmentId) => {
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
    assignUserToDepartment: async (userId, departmentId, templateId) => {
      if (!client || !currentUser) {
        return
      }

      try {
        await assignUserToDepartmentMutation(
          client,
          referencesRef.current,
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
    ensureProfileDirectoryData: async () => {
      if (!client || !currentUserIdRef.current || profileDirectoryLoadedRef.current) {
        return
      }

      try {
        await loadUserState(currentUserIdRef.current, 'Unable to load the user directory.', {
          showBootstrapping: false,
          includeProfiles: true,
        })
      } catch (loadError) {
        toast.error(getMessage(loadError, 'Unable to load the user directory.'))
      }
    },
    ensureAccessRequestData: async () => {
      if (!client || !currentUserIdRef.current || accessRequestDataLoadedRef.current) {
        return
      }

      try {
        await loadUserState(currentUserIdRef.current, 'Unable to load access requests.', {
          showBootstrapping: false,
          includeAccessRequests: true,
        })
      } catch (loadError) {
        toast.error(getMessage(loadError, 'Unable to load access requests.'))
      }
    },
    ensureHistoryData: async () => {
      if (!client || !currentUserIdRef.current || historyDataLoadedRef.current) {
        return
      }

      try {
        await loadUserState(currentUserIdRef.current, 'Unable to load report history.', {
          showBootstrapping: false,
          includeHistory: true,
        })
      } catch (loadError) {
        toast.error(getMessage(loadError, 'Unable to load report history.'))
      }
    },
    ensureReportDetails,
    isReportDetailLoaded,
    getReportDetailLoadState,
    refreshData: refreshDataWithOptions,
  }

  return <AppDataContext.Provider value={value}>{children}</AppDataContext.Provider>
}

export function useAppData() {
  const context = useContext(AppDataContext)

  if (!context) {
    throw new Error('useAppData must be used inside AppDataProvider')
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
