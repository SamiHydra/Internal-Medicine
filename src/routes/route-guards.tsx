import { Navigate, Outlet, useLocation } from 'react-router-dom'

import { AppStateScreen } from '@/components/layout/app-state-screen'
import { AppShell } from '@/components/layout/app-shell'
import { useAppData } from '@/context/app-data-context'
import { supabaseEnvSetupHint } from '@/lib/supabase/env'
import type { UserRole } from '@/types/domain'

export function ProtectedRoute({ roles }: { roles?: UserRole[] }) {
  const {
    currentUser,
    error,
    isBootstrapping,
    isConfigured,
    missingEnvVars,
  } = useAppData()
  const location = useLocation()

  if (!isConfigured) {
    return (
      <AppStateScreen
        title="Supabase Configuration Required"
        description="This app now runs only against the live Supabase backend."
        detail={`Missing ${missingEnvVars.join(', ')}. ${supabaseEnvSetupHint}`}
      />
    )
  }

  if (isBootstrapping) {
    return (
      <AppStateScreen
        title="Loading Workspace"
        description="Signing you in and loading the current hospital reporting data."
      />
    )
  }

  if (error && !currentUser) {
    return (
      <AppStateScreen
        title="Unable To Load The App"
        description="The authenticated session could not be connected to the live workspace."
        detail={error}
      />
    )
  }

  if (!currentUser) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />
  }

  if (roles && !roles.includes(currentUser.role)) {
    return (
      <Navigate
        to={currentUser.role === 'nurse' ? '/nurse' : '/admin'}
        replace
      />
    )
  }

  return <Outlet />
}

export function ProtectedShell() {
  return (
    <AppShell>
      <Outlet />
    </AppShell>
  )
}
