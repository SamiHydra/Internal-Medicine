import { Bell, LogOut, Menu, PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { useEffect, useState, type PropsWithChildren } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'

import stPaulosLogo from '@/assets/StPaulosLogoColor.jpg'
import { navigationByRole } from '@/config/navigation'
import { getUnreadNotificationCount } from '@/data/selectors'
import { useAppData, useAppSync, useCurrentReportingPeriod } from '@/context/app-data-context'
import { formatWeekLabel } from '@/lib/dates'
import { cn } from '@/lib/utils'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet'

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
  const { currentUser } = useAppData()

  if (!currentUser) {
    return null
  }

  const items = navigationByRole[currentUser.role]

  return (
    <nav className="space-y-1.5">
      {items.map((item) => {
        const Icon = item.icon

        return (
          <NavLink
            key={item.href}
            to={item.href}
            end={item.href === '/admin' || item.href === '/nurse'}
            onClick={onNavigate}
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
        )
      })}
    </nav>
  )
}

function getViewportLayout(width: number) {
  if (width < 640) {
    return 'phone'
  }

  if (width < 1024) {
    return 'tablet'
  }

  return 'desktop'
}

function ViewportDebugReadoutContent() {
  const [viewport, setViewport] = useState(() => ({
    width: typeof window === 'undefined' ? 0 : window.innerWidth,
    dpr: typeof window === 'undefined' ? 1 : window.devicePixelRatio,
  }))

  useEffect(() => {
    const updateViewport = () => {
      setViewport({
        width: window.innerWidth,
        dpr: window.devicePixelRatio,
      })
    }

    updateViewport()
    window.addEventListener('resize', updateViewport)

    return () => window.removeEventListener('resize', updateViewport)
  }, [])

  const layoutMode = getViewportLayout(viewport.width)
  const shellMode = viewport.width < 640 ? 'mobile nav' : 'desktop nav'

  return (
    <div className="fixed bottom-3 right-3 z-[80] rounded-[0.35rem] border border-[#163153]/25 bg-[#000a1e]/90 px-3 py-2 font-mono text-[11px] leading-5 text-white shadow-[0_18px_40px_-18px_rgba(0,10,30,0.6)]">
      <div>innerWidth: {viewport.width}</div>
      <div>dpr: {viewport.dpr}</div>
      <div>layout: {layoutMode}</div>
      <div>shell: {shellMode}</div>
    </div>
  )
}

function ViewportDebugReadout() {
  if (!import.meta.env.DEV) {
    return null
  }

  return <ViewportDebugReadoutContent />
}

export function AppShell({ children }: PropsWithChildren) {
  const navigate = useNavigate()
  const { currentUser, logout, state } = useAppData()
  const { isSyncing } = useAppSync()
  const currentPeriod = useCurrentReportingPeriod()
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

  return (
    <div className="min-h-screen bg-[#f8f9fa]">
      <ViewportDebugReadout />

      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-40 hidden border-r border-[#163153] bg-[linear-gradient(150deg,#000a1e_0%,#07162f_52%,#002147_100%)] transition-[width] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] sm:block',
          collapsed ? 'w-[84px]' : 'w-[292px]',
        )}
      >
        <div className={cn('flex h-full flex-col py-8', collapsed ? 'px-3' : 'px-7')}>
          <BrandLockup inverted collapsed={collapsed} />
          <Separator className="my-6 bg-white/10" />
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
          <header className="sticky top-0 z-30 border-b border-[#d9e0e7] bg-[#f8f9fa]/96 backdrop-blur-sm">
            <div className="flex items-center justify-between gap-4 px-4 py-3 md:px-6 lg:px-8">
              <div className="flex min-w-0 items-center gap-3">
                <div className="sm:hidden">
                  <Sheet>
                    <SheetTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="rounded-[0.35rem] border border-[#d9e0e7] bg-[#ffffff] text-[#000a1e] hover:bg-[#f6f8fa]"
                      >
                        <Menu className="h-4 w-4" />
                      </Button>
                    </SheetTrigger>
                    <SheetContent
                      side="left"
                      className="space-y-6 border-r border-[#163153] bg-[linear-gradient(150deg,#000a1e_0%,#07162f_52%,#002147_100%)] text-white"
                    >
                      <BrandLockup compact inverted />
                      <SidebarNav />
                    </SheetContent>
                  </Sheet>
                </div>

                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setCollapsed((value) => !value)}
                  aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                  className="hidden rounded-[0.35rem] border border-[#d9e0e7] bg-[#ffffff] text-[#000a1e] hover:bg-[#f6f8fa] sm:inline-flex"
                >
                  {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
                </Button>

                <div className="min-w-0 rounded-[0.35rem] bg-[#eef2f6] px-4 py-3">
                  <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-[#005db6]">
                    Live reporting period
                  </p>
                  <p className="mt-1 truncate font-display text-[1.15rem] leading-none tracking-[-0.03em] text-[#000a1e] md:text-[1.35rem]">
                    {currentPeriodLabel}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2.5 md:gap-3">
                {isSyncing ? (
                  <div
                    aria-live="polite"
                    className="hidden items-center gap-2 rounded-[0.35rem] bg-[#eef2f6] px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-[#00468c] sm:flex"
                  >
                    <span className="relative flex h-2.5 w-2.5 items-center justify-center">
                      <span className="absolute inset-0 animate-ping rounded-full bg-[#63a1ff]/55" />
                      <span className="relative h-2.5 w-2.5 rounded-full bg-[#005db6]" />
                    </span>
                    Syncing
                  </div>
                ) : null}
                <Button
                  variant="ghost"
                  size="icon"
                  className="relative rounded-[0.35rem] border border-[#d9e0e7] bg-[#ffffff] text-[#000a1e] hover:bg-[#f6f8fa]"
                  onClick={() =>
                    navigate(
                      currentUser.role === 'nurse'
                        ? '/notifications'
                        : '/admin/notifications',
                    )
                  }
                >
                  <Bell className="h-4 w-4" />
                  {unreadCount ? (
                    <span className="pulse-ring absolute ml-4 mt-[-1.15rem] flex h-5 min-w-5 items-center justify-center rounded-[999px] bg-[#ba1a1a] px-1 text-[10px] font-bold text-white">
                      {unreadCount}
                    </span>
                  ) : null}
                </Button>
                <div className="flex items-center gap-3 rounded-[0.35rem] border border-[#d9e0e7] bg-[#ffffff] px-3 py-2">
                  <Avatar className="h-11 w-11 rounded-[0.35rem] bg-[#edf4fb] ring-1 ring-[#d9e0e7] shadow-none">
                    <AvatarFallback className="bg-[#edf4fb] text-[#00509f]">
                      {currentUser.fullName
                        .split(' ')
                        .map((part) => part[0])
                        .join('')
                        .slice(0, 2)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="hidden text-left sm:block">
                    <p className="text-sm font-semibold tracking-[-0.01em] text-[#000a1e]">
                      {currentUser.fullName}
                    </p>
                    <p className="text-[11px] uppercase tracking-[0.2em] text-[#74777f]">
                      {currentUser.title}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9 rounded-[0.25rem] border-l border-[#e1e6ec] pl-3 text-[#44474e] hover:bg-transparent hover:text-[#000a1e]"
                    onClick={() => {
                      void logout()
                    }}
                  >
                    <LogOut className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </div>
          </header>

          <main className="min-w-0 flex-1">{children}</main>
        </div>
      </div>
    </div>
  )
}
