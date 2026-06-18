import { Navigate, Outlet, useLocation } from 'react-router-dom'

import { AppStateScreen } from '@/components/layout/app-state-screen'
import { AppShell } from '@/components/layout/app-shell'
import { useAppData } from '@/context/app-data-context'
import { apiEnvSetupHint } from '@/lib/api/env'
import { landingPathForRole } from '@/routes/landing'
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
        title="Laravel API Configuration Required"
        description="This app now runs against the Laravel reporting API."
        detail={`Missing ${missingEnvVars.join(', ')}. ${apiEnvSetupHint}`}
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

  // A user with a temporary/new-account password must rotate it before reaching
  // any app route. The backend mirrors this with the EnsurePasswordChanged gate.
  if (currentUser.passwordChangeRequired && location.pathname !== '/change-password') {
    return <Navigate to="/change-password" replace />
  }

  if (roles && !roles.includes(currentUser.role)) {
    return <Navigate to={landingPathForRole(currentUser.role)} replace />
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
