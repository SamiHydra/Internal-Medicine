/**
 * Resolves the title the app shell shows for the current route.
 *
 * Most routes take their title from the role's navigation (the most specific
 * matching entry wins). Routes without a navigation entry need an explicit
 * title: the Dashboard entries ('/admin', '/admin/academic') match every
 * deeper admin route by prefix, so without this table the manual admin setup
 * page, department details and people profiles all read "Dashboard" (QA-026).
 */
export interface TitledNavItem {
  href: string
  label: string
}

const AUXILIARY_TITLES: ReadonlyArray<{ test: (pathname: string) => boolean; title: string }> = [
  { test: (pathname) => pathname.endsWith('/notifications'), title: 'Notifications' },
  {
    test: (pathname) => pathname === '/reports' || pathname.startsWith('/reports/'),
    title: 'Weekly report',
  },
  { test: (pathname) => pathname === '/admin/manual-admin-setup', title: 'Admin account setup' },
  { test: (pathname) => pathname.startsWith('/admin/departments/'), title: 'Department' },
  { test: (pathname) => pathname.startsWith('/admin/academic/people/'), title: 'Profile' },
]

export function resolvePageTitle(
  pathname: string,
  navItems: ReadonlyArray<TitledNavItem>,
  fallback = 'Workspace',
): string {
  const auxiliary = AUXILIARY_TITLES.find((entry) => entry.test(pathname))
  if (auxiliary) {
    return auxiliary.title
  }

  const activeNavItem = [...navItems]
    .sort((left, right) => right.href.length - left.href.length)
    .find((item) => pathname === item.href || pathname.startsWith(`${item.href}/`))

  return activeNavItem?.label ?? fallback
}
