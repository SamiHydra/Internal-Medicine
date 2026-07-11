import { Suspense, lazy, type ReactNode } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'

import { AppStateScreen } from '@/components/layout/app-state-screen'
import { FullPageSkeleton, PageSkeleton } from '@/components/layout/loading-skeletons'
import { ScrollToTop } from '@/components/layout/scroll-to-top'
import { useAppData } from '@/context/app-data-context'
import { WorkspaceProvider } from '@/context/workspace-context'
import { apiEnvSetupHint } from '@/lib/api/env'
import { LoginPage } from '@/pages/auth/login-page'
import { landingPathForRole } from '@/routes/landing'
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
const AcademicDashboardPage = lazy(() =>
  import('@/pages/admin/academic-dashboard-page').then((module) => ({
    default: module.AcademicDashboardPage,
  })),
)
const AcademicPersonDetailPage = lazy(() =>
  import('@/pages/admin/academic-person-detail-page').then((module) => ({
    default: module.AcademicPersonDetailPage,
  })),
)
const AcademicSubmissionsPage = lazy(() =>
  import('@/pages/admin/academic-submissions-page').then((module) => ({
    default: module.AcademicSubmissionsPage,
  })),
)
const AcademicStructurePage = lazy(() =>
  import('@/pages/admin/academic-structure-page').then((module) => ({
    default: module.AcademicStructurePage,
  })),
)
const DutyRosterPage = lazy(() =>
  import('@/pages/admin/duty-roster-page').then((module) => ({
    default: module.DutyRosterPage,
  })),
)
const RotationPlannerPage = lazy(() =>
  import('@/pages/admin/rotation-planner-page').then((module) => ({
    default: module.RotationPlannerPage,
  })),
)
const EvaluationFormsPage = lazy(() =>
  import('@/pages/admin/evaluation-forms-page').then((module) => ({
    default: module.EvaluationFormsPage,
  })),
)
const StudentsPage = lazy(() =>
  import('@/pages/admin/students-page').then((module) => ({
    default: module.StudentsPage,
  })),
)
const RepLogPage = lazy(() =>
  import('@/pages/teaching/rep-log-page').then((module) => ({
    default: module.RepLogPage,
  })),
)
const TeachingAttendancePage = lazy(() =>
  import('@/pages/academic/teaching-attendance-page').then((module) => ({
    default: module.TeachingAttendancePage,
  })),
)
const AuditLogPage = lazy(() =>
  import('@/pages/admin/audit-log-page').then((module) => ({
    default: module.AuditLogPage,
  })),
)
const ActionItemsPage = lazy(() =>
  import('@/pages/admin/action-items-page').then((module) => ({
    default: module.ActionItemsPage,
  })),
)
const DataImportPage = lazy(() =>
  import('@/pages/admin/data-import-page').then((module) => ({
    default: module.DataImportPage,
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
const ForcePasswordChangePage = lazy(() =>
  import('@/pages/auth/force-password-change-page').then((module) => ({
    default: module.ForcePasswordChangePage,
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
const AcademicEvaluationFormPage = lazy(() =>
  import('@/pages/academic/evaluation-form-page').then((module) => ({
    default: module.AcademicEvaluationFormPage,
  })),
)
const AcademicHomePage = lazy(() =>
  import('@/pages/academic/academic-home-page').then((module) => ({
    default: module.AcademicHomePage,
  })),
)
const AcademicHistoryPage = lazy(() =>
  import('@/pages/academic/academic-history-page').then((module) => ({
    default: module.AcademicHistoryPage,
  })),
)

function InlineRouteFallback() {
  return <PageSkeleton />
}

function renderLazyRoute(node: ReactNode, fallback: 'page' | 'inline' = 'page') {
  return (
    <Suspense
      fallback={
        fallback === 'page' ? (
          <FullPageSkeleton label="Loading page" />
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
        title="Laravel API Configuration Required"
        description="The live product needs its Laravel API URL before it can start."
        detail={`Missing ${missingEnvVars.join(', ')}. ${apiEnvSetupHint}`}
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

  if (currentUser.passwordChangeRequired) {
    return <Navigate to="/change-password" replace />
  }

  return <Navigate to={landingPathForRole(currentUser.role)} replace />
}

function App() {
  return (
    <BrowserRouter>
      <WorkspaceProvider>
        <ScrollToTop />
        <Routes>
        <Route path="/" element={<HomeRedirect />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/forgot-password" element={renderLazyRoute(<ForgotPasswordPage />)} />
        <Route path="/reset-password" element={renderLazyRoute(<ResetPasswordPage />)} />
        <Route path="/register" element={renderLazyRoute(<AccessRequestPage />)} />

        <Route element={<ProtectedRoute />}>
          <Route
            path="/change-password"
            element={renderLazyRoute(<ForcePasswordChangePage />)}
          />
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

            <Route element={<ProtectedRoute roles={['resident', 'consultant']} />}>
              <Route path="/academic" element={renderLazyRoute(<AcademicHomePage />, 'inline')} />
              <Route
                path="/academic/submit"
                element={renderLazyRoute(<AcademicEvaluationFormPage />, 'inline')}
              />
              <Route
                path="/academic/history"
                element={renderLazyRoute(<AcademicHistoryPage />, 'inline')}
              />
            </Route>

            <Route element={<ProtectedRoute roles={['consultant']} />}>
              <Route
                path="/academic/teaching"
                element={renderLazyRoute(<TeachingAttendancePage />, 'inline')}
              />
            </Route>

            <Route element={<ProtectedRoute roles={['student_rep']} />}>
              <Route path="/teaching" element={renderLazyRoute(<RepLogPage />, 'inline')} />
            </Route>

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

            <Route element={<ProtectedRoute roles={['superadmin', 'admin']} />}>
              <Route path="/admin" element={renderLazyRoute(<AdminDashboardPage />, 'inline')} />
              <Route
                path="/admin/academic"
                element={renderLazyRoute(<AcademicDashboardPage />, 'inline')}
              />
              <Route
                path="/admin/academic/submissions"
                element={renderLazyRoute(<AcademicSubmissionsPage />, 'inline')}
              />
              <Route
                path="/admin/academic/structure"
                element={renderLazyRoute(<AcademicStructurePage />, 'inline')}
              />
              <Route
                path="/admin/academic/roster"
                element={renderLazyRoute(<DutyRosterPage />, 'inline')}
              />
              <Route
                path="/admin/academic/rotations"
                element={renderLazyRoute(<RotationPlannerPage />, 'inline')}
              />
              <Route
                path="/admin/academic/evaluation-forms"
                element={renderLazyRoute(<EvaluationFormsPage />, 'inline')}
              />
              <Route
                path="/admin/academic/students"
                element={renderLazyRoute(<StudentsPage />, 'inline')}
              />
              <Route
                path="/admin/academic/people/:userId"
                element={renderLazyRoute(<AcademicPersonDetailPage />, 'inline')}
              />
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
                path="/admin/action-items"
                element={renderLazyRoute(<ActionItemsPage />, 'inline')}
              />
              <Route
                path="/admin/import"
                element={renderLazyRoute(<DataImportPage />, 'inline')}
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
      </WorkspaceProvider>
    </BrowserRouter>
  )
}

export default App
