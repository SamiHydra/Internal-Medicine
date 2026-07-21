import { Bell, GraduationCap, LogOut, PanelLeftClose, PanelLeftOpen, Stethoscope } from 'lucide-react'
import { Fragment, useEffect, useState, type PropsWithChildren } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'

import stPaulosLogo from '@/assets/StPaulosLogoColor.jpg'
import { MobileTabBar } from '@/components/layout/mobile-tab-bar'
import { getNavigationItems, isSharedAdminPath, isWorkspaceRole, type Workspace } from '@/config/navigation'
import { getUnreadNotificationCount } from '@/data/selectors'
import { useAppData, useAppSync, useCurrentReportingPeriod } from '@/context/app-data-context'
import { useWorkspace } from '@/context/workspace-context'
import { formatWeekLabel } from '@/lib/dates'
import { prefetchRoute } from '@/routes/route-prefetch'
import { cn } from '@/lib/utils'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Separator } from '@/components/ui/separator'
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet'

function BrandLockup({
  compact = false,
  inverted = false,
  collapsed = false,
}: {
  compact?: boolean
  inverted?: boolean
  collapsed?: boolean
}) {
  return (
    <div className={cn('flex items-center', collapsed ? 'justify-center' : compact ? 'gap-3' : 'gap-3.5')}>
      <img
        src={stPaulosLogo}
        alt="St. Paul Hospital logo"
        className={cn(
          'shrink-0 rounded-[0.4rem] object-cover',
          compact ? 'h-10 w-10' : collapsed ? 'h-11 w-11' : 'h-12 w-12',
        )}
      />

      {!collapsed && (
        <div className="min-w-0">
          <p
            className={cn(
              'whitespace-nowrap font-bold uppercase tracking-[0.08em]',
              inverted ? 'text-[#f0b429]' : 'text-[#005db6]',
              compact ? 'text-[0.62rem]' : 'text-[0.78rem]',
            )}
          >
            St. Paul Hospital
          </p>
          <p
            className={cn(
              'whitespace-nowrap font-display leading-tight',
              inverted ? 'text-white' : 'text-[#000a1e]',
              compact ? 'text-base' : 'text-[1.15rem]',
            )}
          >
            Internal Medicine
          </p>
        </div>
      )}
    </div>
  )
}

function SidebarNav({ onNavigate, collapsed = false }: { onNavigate?: () => void; collapsed?: boolean }) {
  const { currentUser, academic } = useAppData()
  const { workspace } = useWorkspace()

  if (!currentUser) {
    return null
  }

  const items = getNavigationItems(currentUser.role, workspace, {
    isMorningRecorder: academic?.isMorningRecorder,
  })

  return (
    <nav className="space-y-1.5">
      {items.map((item) => {
        const Icon = item.icon

        return (
          <Fragment key={item.href}>
            {item.sectionLabel && !collapsed ? (
              <p className="px-4 pb-1 pt-4 text-[10px] font-bold uppercase tracking-[0.18em] text-[#647a95]">
                {item.sectionLabel}
              </p>
            ) : null}
            <NavLink
            to={item.href}
            end={item.end}
            onClick={onNavigate}
            onMouseEnter={() => prefetchRoute(item.href)}
            onFocus={() => prefetchRoute(item.href)}
            title={collapsed ? item.label : undefined}
            className={({ isActive }) =>
              cn(
                'group flex items-center border-l border-transparent text-[15px] font-medium tracking-[0.01em] transition-colors duration-200',
                collapsed ? 'justify-center px-0 py-3' : 'gap-3.5 py-3 pl-4 pr-2',
                isActive
                  ? 'border-[#f0b429] bg-white/[0.04] text-white'
                  : 'text-[#92a3ba] hover:border-[#294567] hover:bg-white/[0.03] hover:text-white',
              )
            }
            >
              {({ isActive }) => (
                <span className={cn('flex items-center', collapsed ? '' : 'gap-3.5')}>
                  <Icon
                    className={cn(
                      'h-5 w-5 shrink-0 transition-colors duration-200',
                      isActive ? 'text-[#f0b429]' : 'text-[#92a3ba] group-hover:text-white',
                    )}
                  />
                  {!collapsed && (
                    <span className={cn(isActive ? 'text-white' : 'text-[#92a3ba] group-hover:text-white')}>
                      {item.label}
                    </span>
                  )}
                </span>
              )}
            </NavLink>
          </Fragment>
        )
      })}
    </nav>
  )
}

function WorkspaceSwitcher({
  collapsed = false,
  className,
  onNavigate,
}: {
  collapsed?: boolean
  className?: string
  onNavigate?: () => void
}) {
  const { currentUser } = useAppData()
  const { workspace, setWorkspace } = useWorkspace()
  const navigate = useNavigate()
  const location = useLocation()

  if (!currentUser || !isWorkspaceRole(currentUser.role)) {
    return null
  }

  const options = [
    {
      value: 'clinical' as const,
      label: 'Clinical',
      icon: Stethoscope,
      iconClassName: collapsed ? 'h-5 w-5 shrink-0' : 'h-4 w-4 shrink-0',
    },
    {
      value: 'academic' as const,
      label: 'Academic',
      icon: GraduationCap,
      iconClassName: collapsed ? 'h-[1.35rem] w-[1.35rem] shrink-0' : 'h-6 w-6 shrink-0',
      strokeWidth: collapsed ? 2 : 2.35,
    },
  ]

  const select = (next: Workspace) => {
    onNavigate?.()
    if (next === workspace) {
      return
    }

    setWorkspace(next)
    // Shared system pages re-scope in place; domain pages jump to the chosen
    // workspace's dashboard.
    if (!isSharedAdminPath(location.pathname)) {
      navigate(next === 'academic' ? '/admin/academic' : '/admin')
    }
  }

  return (
    <div
      role="group"
      aria-label="Workspace"
      className={cn(
        collapsed
          ? 'flex flex-col items-center gap-1.5'
          : 'grid grid-cols-2 gap-1 rounded-[0.5rem] border border-white/10 bg-white/[0.04] p-1',
        className,
      )}
    >
      {options.map((option) => {
        const Icon = option.icon
        const active = workspace === option.value

        return (
          <button
            key={option.value}
            type="button"
            onClick={() => select(option.value)}
            aria-pressed={active}
            title={collapsed ? option.label : undefined}
            className={cn(
              'flex items-center justify-center font-semibold transition-colors duration-200',
              collapsed ? 'h-10 w-10 rounded-[0.4rem]' : 'gap-2 rounded-[0.35rem] px-2.5 py-2 text-[13px]',
              active
                ? 'bg-[#f0b429] text-[#04162f]'
                : 'text-[#92a3ba] hover:bg-white/[0.06] hover:text-white',
            )}
          >
            <Icon className={option.iconClassName} strokeWidth={option.strokeWidth ?? 2} />
            {!collapsed && option.label}
          </button>
        )
      })}
    </div>
  )
}

export function AppShell({ children }: PropsWithChildren) {
  const navigate = useNavigate()
  const location = useLocation()
  const { currentUser, logout, state, academic } = useAppData()
  const { workspace } = useWorkspace()
  const { isSyncing } = useAppSync()
  const currentPeriod = useCurrentReportingPeriod()
  const [menuOpen, setMenuOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window === 'undefined') {
      return false
    }

    return window.localStorage.getItem('stpaul:sidebar-collapsed') === '1'
  })

  useEffect(() => {
    window.localStorage.setItem('stpaul:sidebar-collapsed', collapsed ? '1' : '0')
  }, [collapsed])

  if (!currentUser) {
    return <>{children}</>
  }

  const unreadCount = getUnreadNotificationCount(state, currentUser.id)
  const currentPeriodLabel = currentPeriod ? formatWeekLabel(currentPeriod) : '-'

  // Derive the current page title from the role's nav (most specific match wins).
  const navItems = getNavigationItems(currentUser.role, workspace, {
    isMorningRecorder: academic?.isMorningRecorder,
  })
  const activeNavItem = [...navItems]
    .sort((left, right) => right.href.length - left.href.length)
    .find(
      (item) =>
        location.pathname === item.href || location.pathname.startsWith(`${item.href}/`),
    )
  // The Dashboard nav item (href '/admin') matches any /admin/* route via startsWith,
  // so routes without their own nav entry (e.g. notifications) would mis-title as
  // "Dashboard". Resolve those known auxiliary routes explicitly.
  const pageTitle = location.pathname.endsWith('/notifications')
    ? 'Notifications'
    : location.pathname.startsWith('/reports/') || location.pathname === '/reports'
      ? 'Weekly report'
      : activeNavItem?.label ?? 'Workspace'
  const sectionEyebrow =
    currentUser.role === 'nurse'
      ? 'Weekly reporting'
      : currentUser.role === 'resident' || currentUser.role === 'consultant'
        ? 'Academic review'
        : workspace === 'academic'
          ? 'Academic operations'
          : 'Clinical operations'
  const initials = currentUser.fullName
    .split(' ')
    .map((part) => part[0])
    .join('')
    .slice(0, 2)

  return (
    <div className="min-h-screen bg-[#f8f9fa]">
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-40 hidden border-r border-[#0c2747] bg-[#04162f] transition-[width] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] sm:block',
          collapsed ? 'w-[84px]' : 'w-[292px]',
        )}
      >
        <div className={cn('flex h-full flex-col py-8', collapsed ? 'px-3' : 'px-7')}>
          <BrandLockup inverted collapsed={collapsed} />
          <Separator className="my-6 bg-white/10" />
          <WorkspaceSwitcher collapsed={collapsed} className="mb-5" />
          <div className="flex-1 overflow-y-auto overflow-x-hidden pr-1">
            <SidebarNav collapsed={collapsed} />
          </div>
          {!collapsed && (
            <div className="mt-8 border-t border-white/10 pt-5 text-white">
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#f0b429]">
                Reporting week
              </p>
              <p className="mt-2 font-display text-[1.35rem] leading-tight text-white">
                {currentPeriod ? formatWeekLabel(currentPeriod) : '-'}
              </p>
              <p className="mt-2 text-sm text-[#9fb0c6]">Live administrative reporting window</p>
            </div>
          )}
        </div>
      </aside>

      <div
        className={cn(
          'min-h-screen transition-[padding] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]',
          collapsed ? 'sm:pl-[84px]' : 'sm:pl-[292px]',
        )}
      >
        <div className="flex min-h-screen min-w-0 flex-col">
          <header className="sticky top-0 z-30 border-b border-[#e7ecf1] bg-white">
            <div className="flex items-center justify-between gap-4 px-4 py-3 md:px-6 lg:px-8">
              <div className="flex min-w-0 items-center gap-3">
                <button
                  type="button"
                  onClick={() => setCollapsed((value) => !value)}
                  aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                  className="hidden h-10 w-10 items-center justify-center rounded-[0.4rem] border border-[#e1e6ec] bg-white text-[#44474e] transition-[transform,background-color,border-color,color] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] hover:border-[#c8d5e6] hover:bg-[#f6f8fa] hover:text-[#000a1e] active:scale-[0.95] sm:inline-flex"
                >
                  {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
                </button>

                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="h-3.5 w-[3px] rounded-full bg-[#f0b429]" />
                    <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#005db6]">
                      {sectionEyebrow}
                    </p>
                  </div>
                  <h1 className="mt-1 truncate pb-0.5 font-display text-[1.3rem] font-bold leading-tight tracking-[-0.03em] text-[#000a1e] md:text-[1.5rem]">
                    {pageTitle}
                  </h1>
                </div>
              </div>

              <div className="flex items-center gap-2.5 md:gap-3">
                <div className="hidden items-center gap-2.5 rounded-[0.4rem] border border-[#e1e6ec] bg-white px-3.5 py-2 lg:flex">
                  <span className="relative flex h-2 w-2 items-center justify-center">
                    {isSyncing ? (
                      <span className="absolute inset-0 animate-ping rounded-full bg-[#63a1ff]/55" />
                    ) : null}
                    <span className="relative h-2 w-2 rounded-full bg-[#f0b429]" />
                  </span>
                  <div className="leading-tight">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#74777f]">
                      {isSyncing ? 'Syncing' : 'Reporting period'}
                    </p>
                    <p className="font-display text-[0.92rem] font-semibold leading-none tracking-[-0.02em] text-[#000a1e]">
                      {currentPeriodLabel}
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  className="relative inline-flex h-10 w-10 items-center justify-center rounded-[0.4rem] border border-[#e1e6ec] bg-white text-[#44474e] transition-[transform,background-color,border-color,color] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] hover:border-[#c8d5e6] hover:bg-[#f6f8fa] hover:text-[#000a1e] active:scale-[0.95]"
                  aria-label="Notifications"
                  onClick={() =>
                    navigate(
                      currentUser.role === 'nurse' ? '/notifications' : '/admin/notifications',
                    )
                  }
                >
                  <Bell className="h-4 w-4" />
                  {unreadCount ? (
                    <span className="absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-[#ba1a1a] px-1 text-[10px] font-bold text-white ring-2 ring-white">
                      {unreadCount}
                    </span>
                  ) : null}
                </button>

                <div className="hidden items-center gap-2.5 rounded-[0.4rem] border border-[#e1e6ec] bg-white py-1.5 pl-2.5 pr-1.5 sm:flex">
                  <Avatar className="h-9 w-9 rounded-[0.35rem] bg-[#04162f] shadow-none">
                    <AvatarFallback className="rounded-[0.35rem] bg-[#04162f] text-[0.78rem] font-bold text-[#f0b429]">
                      {initials}
                    </AvatarFallback>
                  </Avatar>
                  <div className="text-left">
                    <p className="text-sm font-semibold leading-tight tracking-[-0.01em] text-[#000a1e]">
                      {currentUser.fullName}
                    </p>
                    <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#74777f]">
                      {currentUser.title}
                    </p>
                  </div>
                  <button
                    type="button"
                    aria-label="Sign out"
                    className="ml-0.5 inline-flex h-9 w-9 items-center justify-center rounded-[0.3rem] border-l border-[#e1e6ec] pl-2 text-[#74777f] transition-[transform,color] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] hover:text-[#ba1a1a] active:scale-[0.95]"
                    onClick={() => {
                      void logout()
                    }}
                  >
                    <LogOut className="h-4 w-4" />
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() => setMenuOpen(true)}
                  aria-label="Open account menu"
                  aria-haspopup="dialog"
                  className="inline-flex h-10 w-10 items-center justify-center rounded-[0.4rem] border border-[#e1e6ec] bg-white transition-[transform,border-color] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] hover:border-[#c8d5e6] active:scale-[0.95] sm:hidden"
                >
                  <Avatar className="h-8 w-8 rounded-[0.3rem] bg-[#04162f] shadow-none">
                    <AvatarFallback className="rounded-[0.3rem] bg-[#04162f] text-[0.7rem] font-bold text-[#f0b429]">
                      {initials}
                    </AvatarFallback>
                  </Avatar>
                </button>
              </div>
            </div>
          </header>

          <main className="min-w-0 flex-1 pb-[calc(env(safe-area-inset-bottom)+4.75rem)] sm:pb-0">
            {children}
          </main>
        </div>
      </div>

      <MobileTabBar items={navItems} onMore={() => setMenuOpen(true)} />

      <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
        <SheetContent
          side="left"
          className="flex w-full max-w-[20rem] flex-col gap-0 border-r border-[#0c2747] p-0"
        >
          <div className="flex h-full flex-col overflow-y-auto px-6 pt-6 pb-[calc(env(safe-area-inset-bottom)+1.5rem)]">
            <SheetTitle className="sr-only">Account and navigation menu</SheetTitle>
            <BrandLockup compact inverted />

            <div className="mt-6 flex items-center gap-3 rounded-[0.5rem] border border-white/10 bg-white/[0.04] p-3">
              <Avatar className="h-11 w-11 rounded-[0.4rem] bg-[#04162f] shadow-none">
                <AvatarFallback className="rounded-[0.4rem] bg-white/[0.06] text-[0.82rem] font-bold text-[#f0b429]">
                  {initials}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-white">{currentUser.fullName}</p>
                <p className="truncate text-[11px] font-semibold uppercase tracking-[0.16em] text-[#9fb0c6]">
                  {currentUser.title}
                </p>
              </div>
            </div>

            <div className="mt-3 rounded-[0.5rem] border border-white/10 bg-white/[0.03] px-3.5 py-3">
              <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[#f0b429]">
                Reporting week
              </p>
              <p className="mt-1 font-display text-[1.05rem] leading-tight text-white">
                {currentPeriodLabel}
              </p>
            </div>

            <Separator className="my-5 bg-white/10" />

            <WorkspaceSwitcher className="mb-4" onNavigate={() => setMenuOpen(false)} />

            <SidebarNav onNavigate={() => setMenuOpen(false)} />

            <div className="mt-auto pt-6">
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false)
                  void logout()
                }}
                className="flex w-full items-center justify-center gap-2 rounded-[0.45rem] border border-white/[0.12] bg-white/[0.05] py-3 text-sm font-semibold text-white transition-colors duration-200 hover:bg-white/[0.1] motion-safe:active:scale-[0.98]"
              >
                <LogOut className="h-4 w-4" />
                Sign out
              </button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  )
}
