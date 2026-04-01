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
  SaveReportPayload,
  SupabaseReferenceState,
} from '@/lib/supabase/api'
import {
  assignUserToDepartment as assignUserToDepartmentMutation,
  createEmptyReferenceState,
  fetchLiveAppState,
  loginWithPassword,
  reviewAccessRequest as reviewAccessRequestMutation,
  restoreNotifications as restoreNotificationsMutation,
  saveReport as saveReportMutation,
  sessionUserId,
  setReportLockState,
  signOut as signOutMutation,
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
  isConfigured: boolean
  missingEnvVars: string[]
  error: string | null
  login: (email: string, password: string) => Promise<UserRole | null>
  logout: () => Promise<void>
  markNotificationsRead: (userId: string, notificationIds: string[]) => Promise<void>
  clearNotifications: (userId: string, notificationIds: string[]) => Promise<void>
  restoreNotifications: (notifications: NotificationItem[]) => Promise<void>
  submitAccessRequest: (payload: AccessRequestPayload) => Promise<boolean>
  approveAccessRequest: (requestId: string, reviewerId: string) => Promise<void>
  rejectAccessRequest: (requestId: string, reviewerId: string) => Promise<void>
  saveReport: (payload: SaveReportPayload) => Promise<boolean>
  lockReport: (reportId: string, actorId: string) => Promise<void>
  unlockReport: (reportId: string, actorId: string) => Promise<void>
  updateSettings: (settings: Partial<AppSettings>) => Promise<void>
  toggleUserActive: (userId: string) => Promise<void>
  toggleAssignmentActive: (assignmentId: string) => Promise<void>
  assignUserToDepartment: (
    userId: string,
    departmentId: string,
    templateId: string,
  ) => Promise<void>
  refreshData: () => Promise<void>
}

const AppDataContext = createContext<AppDataContextValue | null>(null)

function getMessage(error: unknown, fallback: string) {
  if (typeof error === 'object' && error && 'message' in error) {
    const message = error.message
    if (typeof message === 'string' && message.trim().length) {
      return message
    }
  }

  return fallback
}

export function AppDataProvider({ children }: PropsWithChildren) {
  const client = getSupabaseBrowserClient()
  const [state, setState] = useState<AppState>(() => createEmptyAppState())
  const [isBootstrapping, setIsBootstrapping] = useState(isSupabaseConfigured)
  const [isSyncing, setIsSyncing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const referencesRef = useRef<SupabaseReferenceState>(createEmptyReferenceState())
  const loadVersionRef = useRef(0)
  const currentUserIdRef = useRef<string | null>(null)
  const syncPendingCountRef = useRef(0)
  const syncIndicatorTimeoutRef = useRef<number | null>(null)

  const currentUser = getCurrentUser(state)

  useEffect(() => {
    currentUserIdRef.current = state.currentUserId
  }, [state.currentUserId])

  useEffect(
    () => () => {
      if (syncIndicatorTimeoutRef.current !== null) {
        window.clearTimeout(syncIndicatorTimeoutRef.current)
      }
    },
    [],
  )

  const loadUserState = useCallback(
    async (
      userId: string,
      fallbackMessage: string,
      options?: { showBootstrapping?: boolean },
    ) => {
      if (!client) {
        return null
      }

      const loadVersion = ++loadVersionRef.current
      const showBootstrapping = options?.showBootstrapping ?? true

      if (showBootstrapping) {
        setIsBootstrapping(true)
      } else {
        syncPendingCountRef.current += 1

        if (syncPendingCountRef.current === 1 && syncIndicatorTimeoutRef.current === null) {
          syncIndicatorTimeoutRef.current = window.setTimeout(() => {
            if (syncPendingCountRef.current > 0) {
              setIsSyncing(true)
            }

            syncIndicatorTimeoutRef.current = null
          }, 220)
        }
      }
      setError(null)

      try {
        const result = await fetchLiveAppState(client, userId)

        if (loadVersion !== loadVersionRef.current) {
          return result
        }

        referencesRef.current = result.references
        setState(result.state)
        setError(null)
        return result
      } catch (loadError) {
        if (loadVersion === loadVersionRef.current) {
          setState(createEmptyAppState())
          setError(getMessage(loadError, fallbackMessage))
        }
        throw loadError
      } finally {
        if (showBootstrapping && loadVersion === loadVersionRef.current) {
          setIsBootstrapping(false)
        } else if (!showBootstrapping) {
          syncPendingCountRef.current = Math.max(0, syncPendingCountRef.current - 1)

          if (syncPendingCountRef.current === 0) {
            if (syncIndicatorTimeoutRef.current !== null) {
              window.clearTimeout(syncIndicatorTimeoutRef.current)
              syncIndicatorTimeoutRef.current = null
            }

            setIsSyncing(false)
          }
        }
      }
    },
    [client],
  )

  async function refreshData() {
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
      setError(null)
      setIsBootstrapping(false)
      return
    }

    try {
      await loadUserState(userId, 'Unable to refresh the live dashboard data.', {
        showBootstrapping: false,
      })
    } catch (refreshError) {
      toast.error(getMessage(refreshError, 'Unable to refresh the live dashboard data.'))
    }
  }

  useEffect(() => {
    if (!client) {
      setIsBootstrapping(false)
      setIsSyncing(false)
      setState(createEmptyAppState())
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
        setState(createEmptyAppState())
        setIsBootstrapping(false)
        setIsSyncing(false)
        return
      }

      try {
        await loadUserState(userId, 'Unable to load the signed-in workspace.')
      } catch (loadError) {
        toast.error(getMessage(loadError, 'Unable to load the signed-in workspace.'))
      }
    })()

    const authListener = client.auth.onAuthStateChange((event, session) => {
      if (!active) {
        return
      }

      const userId = sessionUserId(session)
      if (!userId) {
        referencesRef.current = createEmptyReferenceState()
        setState(createEmptyAppState())
        setError(null)
        setIsBootstrapping(false)
        setIsSyncing(false)
        return
      }

      const isSameUserSession = currentUserIdRef.current === userId
      const shouldShowBootstrapping =
        event === 'INITIAL_SESSION' ||
        (event === 'SIGNED_IN' && !isSameUserSession && !currentUserIdRef.current)

      void loadUserState(userId, 'Unable to update the signed-in workspace.', {
        showBootstrapping: shouldShowBootstrapping,
      }).catch((loadError) => {
        toast.error(
          getMessage(loadError, 'Unable to update the signed-in workspace.'),
        )
      })
    })

    return () => {
      active = false
      authListener.data.subscription.unsubscribe()
    }
  }, [client, loadUserState])

  const value: AppDataContextValue = {
    state,
    currentUser,
    isBootstrapping,
    isSyncing,
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

      try {
        const session = await loginWithPassword(client, email, password)
        const result = await loadUserState(
          session.user.id,
          'Unable to load the dashboard after sign-in.',
        )
        return result?.currentUser.role ?? null
      } catch (loginError) {
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
        await signOutMutation(client)
        referencesRef.current = createEmptyReferenceState()
        setState(createEmptyAppState())
        setError(null)
        setIsSyncing(false)
      } catch (logoutError) {
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
        await refreshData()
        return true
      } catch (requestError) {
        toast.error(
          getMessage(requestError, 'Unable to submit the access request.'),
        )
        return false
      }
    },
    approveAccessRequest: async (requestId) => {
      if (!client) {
        return
      }

      try {
        await reviewAccessRequestMutation(client, requestId, 'approved')
        await refreshData()
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
        await refreshData()
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
        await saveReportMutation(client, payload)
        await refreshData()
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
        await refreshData()
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
        await refreshData()
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
        await refreshData()
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
        await refreshData()
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
        await refreshData()
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
        await refreshData()
      } catch (assignmentError) {
        toast.error(
          getMessage(assignmentError, 'Unable to create the assignment.'),
        )
      }
    },
    refreshData,
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
