import { Bell, LogOut, Menu } from 'lucide-react'
import type { PropsWithChildren } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'

import stPaulosLogo from '@/assets/StPaulosLogoColor.jpg'
import { navigationByRole } from '@/config/navigation'
import { getUnreadNotificationCount } from '@/data/selectors'
import { useAppData, useCurrentReportingPeriod } from '@/context/app-data-context'
import { formatWeekLabel } from '@/lib/dates'
import { cn } from '@/lib/utils'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet'

function BrandLockup({
  compact = false,
  inverted = false,
}: {
  compact?: boolean
  inverted?: boolean
}) {
  return (
    <div className={cn('flex items-center', compact ? 'gap-3' : 'gap-4')}>
      <img
        src={stPaulosLogo}
        alt="St. Paulos Hospital logo"
        className={cn(
          'shrink-0 rounded-[0.35rem] object-cover',
          compact ? 'h-10 w-10' : 'h-12 w-12',
        )}
      />

      <div className="min-w-0 space-y-1">
        <p
          className={cn(
            'font-semibold uppercase tracking-[0.28em]',
            inverted ? 'text-[#f0b429]' : 'text-[#005db6]',
            compact ? 'text-[0.58rem]' : 'text-[0.6rem]',
          )}
        >
          St. Paulos Hospital
        </p>
        <p
          className={cn(
            'font-display leading-tight',
            inverted ? 'text-white' : 'text-[#000a1e]',
            compact ? 'text-base' : 'text-[1.15rem]',
          )}
        >
          Internal Medicine
        </p>
      </div>
    </div>
  )
}

function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
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
            className={({ isActive }) =>
              cn(
                'group flex items-center gap-3 border-l border-transparent py-2.5 pl-4 pr-2 text-[13px] font-medium tracking-[0.01em] transition-colors duration-200',
                isActive
                  ? 'border-[#f0b429] bg-white/[0.04] text-white'
                  : 'text-[#92a3ba] hover:border-[#294567] hover:bg-white/[0.03] hover:text-white',
              )
            }
          >
            {({ isActive }) => (
              <span className="flex items-center gap-3">
                <Icon
                  className={cn(
                    'h-4 w-4 transition-colors duration-200',
                    isActive ? 'text-[#f0b429]' : 'text-[#92a3ba] group-hover:text-white',
                  )}
                />
                <span className={cn(isActive ? 'text-white' : 'text-[#92a3ba] group-hover:text-white')}>
                  {item.label}
                </span>
              </span>
            )}
          </NavLink>
        )
      })}
    </nav>
  )
}

export function AppShell({ children }: PropsWithChildren) {
  const navigate = useNavigate()
  const { currentUser, isSyncing, logout, state } = useAppData()
  const currentPeriod = useCurrentReportingPeriod()

  if (!currentUser) {
    return <>{children}</>
  }

  const unreadCount = getUnreadNotificationCount(state, currentUser.id)
  const currentPeriodLabel = currentPeriod ? formatWeekLabel(currentPeriod) : '-'

  return (
    <div className="min-h-screen bg-[#f8f9fa]">
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-[292px] border-r border-[#163153] bg-[linear-gradient(150deg,#000a1e_0%,#07162f_52%,#002147_100%)] lg:block">
        <div className="flex h-full flex-col px-7 py-8">
          <BrandLockup inverted />
          <Separator className="my-6 bg-white/10" />
          <div className="flex-1 overflow-y-auto pr-2">
            <SidebarNav />
          </div>
          <div className="mt-8 border-t border-white/10 pt-5 text-white">
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#f0b429]">
              Reporting week
            </p>
            <p className="mt-2 font-display text-[1.35rem] leading-tight text-white">
              {currentPeriod ? formatWeekLabel(currentPeriod) : '-'}
            </p>
            <p className="mt-2 text-sm text-[#9fb0c6]">Live administrative reporting window</p>
          </div>
        </div>
      </aside>

      <div className="min-h-screen lg:pl-[292px]">
        <div className="flex min-h-screen min-w-0 flex-col">
          <header className="sticky top-0 z-30 border-b border-[#d9e0e7] bg-[#f8f9fa]/96 backdrop-blur-sm">
            <div className="flex items-center justify-between gap-4 px-4 py-3 md:px-6 lg:px-8">
              <div className="flex min-w-0 items-center gap-3">
                <div className="lg:hidden">
                  <Sheet>
                    <SheetTrigger asChild>
                      <Button
                        variant="secondary"
                        size="icon"
                        className="border-[#d9e0e7] bg-[#ffffff] shadow-none hover:bg-[#f6f8fa]"
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
