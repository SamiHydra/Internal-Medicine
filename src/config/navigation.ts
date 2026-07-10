import {
  Activity,
  CalendarDays,
  CalendarRange,
  ClipboardCheck,
  ClipboardList,
  FilePenLine,
  LayoutDashboard,
  ListChecks,
  LockKeyhole,
  Network,
  Upload,
  Settings,
  ShieldCheck,
  Users,
} from 'lucide-react'

import type { UserRole } from '@/types/domain'

export type Workspace = 'clinical' | 'academic'

export type NavigationItem = {
  label: string
  /** Condensed label for the mobile bottom tab bar; falls back to `label`. */
  shortLabel?: string
  href: string
  icon: typeof LayoutDashboard
  /** Match the route exactly (used for dashboard/home roots so they don't stay active on sub-routes). */
  end?: boolean
}

// System items repeat in both admin workspaces; the pages themselves scope their
// content (users, audit) to the active workspace. Settings stays global.
const adminSystemNav: NavigationItem[] = [
  { label: 'Users & Access', shortLabel: 'Users', href: '/admin/users', icon: Users },
  { label: 'Audit Log', shortLabel: 'Audit', href: '/admin/audit', icon: ShieldCheck },
  { label: 'Settings', href: '/admin/settings', icon: Settings },
]

export const adminWorkspaceNav: Record<Workspace, NavigationItem[]> = {
  clinical: [
    { label: 'Dashboard', href: '/admin', icon: LayoutDashboard, end: true },
    { label: 'Submissions', href: '/admin/submissions', icon: ClipboardList },
    { label: 'Action items', shortLabel: 'Actions', href: '/admin/action-items', icon: ListChecks },
    { label: 'Templates', href: '/admin/templates', icon: FilePenLine },
    { label: 'Import', href: '/admin/import', icon: Upload },
    ...adminSystemNav,
  ],
  academic: [
    { label: 'Dashboard', href: '/admin/academic', icon: LayoutDashboard, end: true },
    { label: 'Submissions', href: '/admin/academic/submissions', icon: ClipboardCheck },
    { label: 'Duty roster', shortLabel: 'Roster', href: '/admin/academic/roster', icon: CalendarDays },
    { label: 'Rotations', href: '/admin/academic/rotations', icon: CalendarRange },
    { label: 'Structure', href: '/admin/academic/structure', icon: Network },
    ...adminSystemNav,
  ],
}

const roleNav: Record<'nurse' | 'resident' | 'consultant', NavigationItem[]> = {
  nurse: [
    { label: 'Home', href: '/nurse', icon: LayoutDashboard, end: true },
    { label: 'My Reports', shortLabel: 'Reports', href: '/nurse/reports', icon: ClipboardList },
    { label: 'Access Request', shortLabel: 'Access', href: '/register', icon: LockKeyhole },
    { label: 'Activity', href: '/nurse/activity', icon: Activity },
  ],
  resident: [
    { label: 'Home', href: '/academic', icon: LayoutDashboard, end: true },
    { label: 'Submit evaluation', shortLabel: 'Submit', href: '/academic/submit', icon: ClipboardCheck },
    { label: 'History', href: '/academic/history', icon: Activity },
  ],
  consultant: [
    { label: 'Home', href: '/academic', icon: LayoutDashboard, end: true },
    { label: 'Submit evaluation', shortLabel: 'Submit', href: '/academic/submit', icon: ClipboardCheck },
    { label: 'History', href: '/academic/history', icon: Activity },
  ],
}

/** Admin and superadmin navigate by workspace; every other role has a single fixed nav. */
export function isWorkspaceRole(role: UserRole): boolean {
  return role === 'admin' || role === 'superadmin'
}

export function getNavigationItems(role: UserRole, workspace: Workspace): NavigationItem[] {
  if (role === 'admin' || role === 'superadmin') {
    return adminWorkspaceNav[workspace]
  }

  return roleNav[role]
}

/**
 * Workspace implied by a route. Domain routes pin the workspace; shared system
 * routes (users/audit/settings/notifications) and non-admin routes return null
 * so the active workspace is left untouched.
 */
export function workspaceForPath(pathname: string): Workspace | null {
  if (pathname === '/admin/academic' || pathname.startsWith('/admin/academic/')) {
    return 'academic'
  }

  if (
    pathname === '/admin' ||
    pathname.startsWith('/admin/submissions') ||
    pathname.startsWith('/admin/action-items') ||
    pathname.startsWith('/admin/import') ||
    pathname.startsWith('/admin/templates') ||
    pathname.startsWith('/admin/departments') ||
    // Clinical weekly reports (the admin opens these from the clinical Submission
    // board) are a clinical-domain route. Pin the workspace so an admin who was
    // last in Academic doesn't see the report under an "Academic operations" shell.
    pathname === '/reports' ||
    pathname.startsWith('/reports/')
  ) {
    return 'clinical'
  }

  return null
}

/** Admin pages shared by both workspaces — switching workspace here re-scopes in place. */
export function isSharedAdminPath(pathname: string): boolean {
  return (
    pathname.startsWith('/admin/users') ||
    pathname.startsWith('/admin/audit') ||
    pathname.startsWith('/admin/settings') ||
    pathname.startsWith('/admin/notifications') ||
    pathname.startsWith('/admin/manual-admin-setup')
  )
}
