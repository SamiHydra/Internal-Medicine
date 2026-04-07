import {
  Activity,
  ClipboardList,
  FilePenLine,
  LayoutDashboard,
  LockKeyhole,
  Settings,
  ShieldCheck,
  Users,
} from 'lucide-react'

import type { UserRole } from '@/types/domain'

export type NavigationItem = {
  label: string
  href: string
  icon: typeof LayoutDashboard
}

export const navigationByRole: Record<UserRole, NavigationItem[]> = {
  superadmin: [
    { label: 'Dashboard', href: '/admin', icon: LayoutDashboard },
    { label: 'Submissions', href: '/admin/submissions', icon: ClipboardList },
    { label: 'Users & Access', href: '/admin/users', icon: Users },
    { label: 'Templates', href: '/admin/templates', icon: FilePenLine },
    { label: 'Audit Log', href: '/admin/audit', icon: ShieldCheck },
    { label: 'Settings', href: '/admin/settings', icon: Settings },
  ],
  admin: [
    { label: 'Dashboard', href: '/admin', icon: LayoutDashboard },
    { label: 'Submissions', href: '/admin/submissions', icon: ClipboardList },
    { label: 'Users & Access', href: '/admin/users', icon: Users },
    { label: 'Templates', href: '/admin/templates', icon: FilePenLine },
    { label: 'Audit Log', href: '/admin/audit', icon: ShieldCheck },
    { label: 'Settings', href: '/admin/settings', icon: Settings },
  ],
  doctor_admin: [
    { label: 'Dashboard', href: '/admin', icon: LayoutDashboard },
    { label: 'Submissions', href: '/admin/submissions', icon: ClipboardList },
    { label: 'Users & Access', href: '/admin/users', icon: Users },
    { label: 'Templates', href: '/admin/templates', icon: FilePenLine },
    { label: 'Audit Log', href: '/admin/audit', icon: ShieldCheck },
    { label: 'Settings', href: '/admin/settings', icon: Settings },
  ],
  nurse: [
    { label: 'Home', href: '/nurse', icon: LayoutDashboard },
    { label: 'My Reports', href: '/nurse/reports', icon: ClipboardList },
    { label: 'Access Request', href: '/register', icon: LockKeyhole },
    { label: 'Activity', href: '/nurse/activity', icon: Activity },
  ],
}
