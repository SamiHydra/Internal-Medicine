import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'

import { AppStateScreen } from '@/components/layout/app-state-screen'
import { useAppData } from '@/context/app-data-context'
import { supabaseEnvSetupHint } from '@/lib/supabase/env'
import { DepartmentDetailPage } from '@/pages/admin/department-detail-page'
import { AdminDashboardPage } from '@/pages/admin/admin-dashboard-page'
import { AuditLogPage } from '@/pages/admin/audit-log-page'
import { SettingsPage } from '@/pages/admin/settings-page'
import { SubmissionBoardPage } from '@/pages/admin/submission-board-page'
import { TemplateManagementPage } from '@/pages/admin/template-management-page'
import { UserManagementPage } from '@/pages/admin/user-management-page'
import { AccessRequestPage } from '@/pages/auth/access-request-page'
import { LoginPage } from '@/pages/auth/login-page'
import { NotFoundPage } from '@/pages/not-found-page'
import { NotificationsPage } from '@/pages/notifications-page'
import { NurseActivityPage } from '@/pages/nurse/activity-page'
import { NurseDashboardPage } from '@/pages/nurse/nurse-dashboard-page'
import { ReportSelectionPage } from '@/pages/nurse/report-selection-page'
import { ReportFormPage } from '@/pages/report-form-page'
import { ProtectedRoute, ProtectedShell } from '@/routes/route-guards'

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
        <Route path="/register" element={<AccessRequestPage />} />

        <Route element={<ProtectedRoute />}>
          <Route element={<ProtectedShell />}>
            <Route path="/notifications" element={<NotificationsPage />} />
            <Route path="/admin/notifications" element={<NotificationsPage />} />
            <Route path="/reports/:assignmentId/:periodId" element={<ReportFormPage />} />

            <Route element={<ProtectedRoute roles={['nurse']} />}>
              <Route path="/nurse" element={<NurseDashboardPage />} />
              <Route path="/nurse/reports" element={<ReportSelectionPage />} />
              <Route path="/nurse/activity" element={<NurseActivityPage />} />
            </Route>

            <Route element={<ProtectedRoute roles={['admin', 'doctor_admin']} />}>
              <Route path="/admin" element={<AdminDashboardPage />} />
              <Route path="/admin/departments/:departmentId" element={<DepartmentDetailPage />} />
              <Route path="/admin/submissions" element={<SubmissionBoardPage />} />
              <Route path="/admin/users" element={<UserManagementPage />} />
              <Route path="/admin/templates" element={<TemplateManagementPage />} />
              <Route path="/admin/audit" element={<AuditLogPage />} />
              <Route path="/admin/settings" element={<SettingsPage />} />
            </Route>
          </Route>
        </Route>

        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App
