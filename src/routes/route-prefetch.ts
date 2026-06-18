/**
 * Warm a route's lazy chunk before the user clicks it.
 *
 * Every page in `App.tsx` is `React.lazy`, so the first visit to a route pays the
 * cost of fetching (prod) or on-demand compiling (Vite dev) its chunk — which is
 * why a fresh navigation can sit on the old page for a beat. Calling the matching
 * dynamic `import()` on hover/focus resolves the *same* chunk React.lazy uses, so
 * by click time it's already in memory and the navigation is instant.
 *
 * The specifiers below mirror the lazy imports in `App.tsx`. If one drifts, the
 * prefetch simply no-ops for that route (the lazy import still works on click).
 */
const routeLoaders: Record<string, () => Promise<unknown>> = {
  // Clinical admin
  '/admin': () => import('@/pages/admin/admin-dashboard-page'),
  '/admin/submissions': () => import('@/pages/admin/submission-board-page'),
  '/admin/action-items': () => import('@/pages/admin/action-items-page'),
  '/admin/templates': () => import('@/pages/admin/template-management-page'),
  '/admin/import': () => import('@/pages/admin/data-import-page'),
  // Academic admin
  '/admin/academic': () => import('@/pages/admin/academic-dashboard-page'),
  '/admin/academic/submissions': () => import('@/pages/admin/academic-submissions-page'),
  // Shared admin system
  '/admin/users': () => import('@/pages/admin/user-management-page'),
  '/admin/audit': () => import('@/pages/admin/audit-log-page'),
  '/admin/settings': () => import('@/pages/admin/settings-page'),
  // Nurse
  '/nurse': () => import('@/pages/nurse/nurse-dashboard-page'),
  '/nurse/reports': () => import('@/pages/nurse/report-selection-page'),
  '/nurse/activity': () => import('@/pages/nurse/activity-page'),
  '/register': () => import('@/pages/auth/access-request-page'),
  // Academic roles
  '/academic': () => import('@/pages/academic/academic-home-page'),
  '/academic/submit': () => import('@/pages/academic/evaluation-form-page'),
  '/academic/history': () => import('@/pages/academic/academic-history-page'),
}

const warmed = new Set<string>()

/** Best-effort prefetch of a nav route's chunk. Safe to call repeatedly. */
export function prefetchRoute(href: string): void {
  if (warmed.has(href)) {
    return
  }

  const loader = routeLoaders[href]
  if (!loader) {
    return
  }

  warmed.add(href)
  void loader().catch(() => {
    // Network/compile hiccup — drop the flag so a real navigation can retry.
    warmed.delete(href)
  })
}
