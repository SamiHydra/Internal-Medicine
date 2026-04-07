import { Suspense, lazy, type ReactNode } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'

import { AppStateScreen } from '@/components/layout/app-state-screen'
import { useAppData } from '@/context/app-data-context'
import { supabaseEnvSetupHint } from '@/lib/supabase/env'
import { LoginPage } from '@/pages/auth/login-page'
import { ProtectedRoute, ProtectedShell } from '@/routes/route-guards'

const DepartmentDetailPage = lazy(() =>
  import('@/pages/admin/department-detail-page').then((module) => ({
    default: module.DepartmentDetailPage,
  })),
)
const AdminDashboardPage = lazy(() =>
  import('@/pages/admin/admin-dashboard-page').then((module) => ({
    default: module.AdminDashboardPage,
  })),
)
const AuditLogPage = lazy(() =>
  import('@/pages/admin/audit-log-page').then((module) => ({
    default: module.AuditLogPage,
  })),
)
const SettingsPage = lazy(() =>
  import('@/pages/admin/settings-page').then((module) => ({
    default: module.SettingsPage,
  })),
)
const SubmissionBoardPage = lazy(() =>
  import('@/pages/admin/submission-board-page').then((module) => ({
    default: module.SubmissionBoardPage,
  })),
)
const TemplateManagementPage = lazy(() =>
  import('@/pages/admin/template-management-page').then((module) => ({
    default: module.TemplateManagementPage,
  })),
)
const UserManagementPage = lazy(() =>
  import('@/pages/admin/user-management-page').then((module) => ({
    default: module.UserManagementPage,
  })),
)
const ManualAdminSetupPage = lazy(() =>
  import('@/pages/admin/manual-admin-setup-page').then((module) => ({
    default: module.ManualAdminSetupPage,
  })),
)
const AccessRequestPage = lazy(() =>
  import('@/pages/auth/access-request-page').then((module) => ({
    default: module.AccessRequestPage,
  })),
)
const ForgotPasswordPage = lazy(() =>
  import('@/pages/auth/forgot-password-page').then((module) => ({
    default: module.ForgotPasswordPage,
  })),
)
const ResetPasswordPage = lazy(() =>
  import('@/pages/auth/reset-password-page').then((module) => ({
    default: module.ResetPasswordPage,
  })),
)
const NotFoundPage = lazy(() =>
  import('@/pages/not-found-page').then((module) => ({
    default: module.NotFoundPage,
  })),
)
const NotificationsPage = lazy(() =>
  import('@/pages/notifications-page').then((module) => ({
    default: module.NotificationsPage,
  })),
)
const NurseActivityPage = lazy(() =>
  import('@/pages/nurse/activity-page').then((module) => ({
    default: module.NurseActivityPage,
  })),
)
const NurseDashboardPage = lazy(() =>
  import('@/pages/nurse/nurse-dashboard-page').then((module) => ({
    default: module.NurseDashboardPage,
  })),
)
const ReportSelectionPage = lazy(() =>
  import('@/pages/nurse/report-selection-page').then((module) => ({
    default: module.ReportSelectionPage,
  })),
)
const ReportFormPage = lazy(() =>
  import('@/pages/report-form-page').then((module) => ({
    default: module.ReportFormPage,
  })),
)

function InlineRouteFallback() {
  return (
    <section className="rounded-[0.35rem] border border-[#d9e0e7] bg-[linear-gradient(180deg,#ffffff_0%,#f1f5fa_100%)] px-5 py-10 shadow-[0_18px_36px_rgba(0,33,71,0.06)]">
      <div className="space-y-3">
        <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#005db6]">
          Loading view
        </p>
        <h1 className="font-display text-[2rem] leading-[0.98] tracking-[-0.04em] text-[#000a1e]">
          Opening page
        </h1>
        <p className="text-sm leading-7 text-[#5b6169]">
          Preparing the selected dashboard screen.
        </p>
      </div>
    </section>
  )
}

function renderLazyRoute(node: ReactNode, fallback: 'page' | 'inline' = 'page') {
  return (
    <Suspense
      fallback={
        fallback === 'page' ? (
          <AppStateScreen
            title="Loading Page"
            description="Preparing the selected workspace view."
          />
        ) : (
          <InlineRouteFallback />
        )
      }
    >
      {node}
    </Suspense>
  )
}

function HomeRedirect() {
  const {
    currentUser,
    error,
    isBootstrapping,
    isConfigured,
    missingEnvVars,
  } = useAppData()

  if (!isConfigured) {
    return (
      <AppStateScreen
        title="Supabase Configuration Required"
        description="The live product needs its Supabase project values before it can start."
        detail={`Missing ${missingEnvVars.join(', ')}. ${supabaseEnvSetupHint}`}
      />
    )
  }

  if (isBootstrapping) {
    return (
      <AppStateScreen
        title="Loading Workspace"
        description="Connecting your session to the live reporting workspace."
      />
    )
  }

  if (error && !currentUser) {
    return (
      <AppStateScreen
        title="Unable To Load The App"
        description="The app could not restore the current live session."
        detail={error}
      />
    )
  }

  if (!currentUser) {
    return <Navigate to="/login" replace />
  }

  return <Navigate to={currentUser.role === 'nurse' ? '/nurse' : '/admin'} replace />
}

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<HomeRedirect />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/forgot-password" element={renderLazyRoute(<ForgotPasswordPage />)} />
        <Route path="/reset-password" element={renderLazyRoute(<ResetPasswordPage />)} />
        <Route path="/register" element={renderLazyRoute(<AccessRequestPage />)} />

        <Route element={<ProtectedRoute />}>
          <Route element={<ProtectedShell />}>
            <Route
              path="/notifications"
              element={renderLazyRoute(<NotificationsPage />, 'inline')}
            />
            <Route
              path="/admin/notifications"
              element={renderLazyRoute(<NotificationsPage />, 'inline')}
            />
            <Route
              path="/reports/:assignmentId/:periodId"
              element={renderLazyRoute(<ReportFormPage />, 'inline')}
            />

            <Route element={<ProtectedRoute roles={['nurse']} />}>
              <Route path="/nurse" element={renderLazyRoute(<NurseDashboardPage />, 'inline')} />
              <Route
                path="/nurse/reports"
                element={renderLazyRoute(<ReportSelectionPage />, 'inline')}
              />
              <Route
                path="/nurse/activity"
                element={renderLazyRoute(<NurseActivityPage />, 'inline')}
              />
            </Route>

            <Route element={<ProtectedRoute roles={['superadmin', 'admin', 'doctor_admin']} />}>
              <Route path="/admin" element={renderLazyRoute(<AdminDashboardPage />, 'inline')} />
              <Route
                path="/admin/departments/:departmentId"
                element={renderLazyRoute(<DepartmentDetailPage />, 'inline')}
              />
              <Route
                path="/admin/submissions"
                element={renderLazyRoute(<SubmissionBoardPage />, 'inline')}
              />
              <Route
                path="/admin/users"
                element={renderLazyRoute(<UserManagementPage />, 'inline')}
              />
              <Route
                path="/admin/manual-admin-setup"
                element={renderLazyRoute(<ManualAdminSetupPage />, 'inline')}
              />
              <Route
                path="/admin/templates"
                element={renderLazyRoute(<TemplateManagementPage />, 'inline')}
              />
              <Route
                path="/admin/audit"
                element={renderLazyRoute(<AuditLogPage />, 'inline')}
              />
              <Route
                path="/admin/settings"
                element={renderLazyRoute(<SettingsPage />, 'inline')}
              />
            </Route>
          </Route>
        </Route>

        <Route path="*" element={renderLazyRoute(<NotFoundPage />)} />
      </Routes>
    </BrowserRouter>
  )
}

export default App
