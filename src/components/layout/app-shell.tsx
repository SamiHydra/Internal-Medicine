import { Bell, LogOut, Menu } from 'lucide-react'
import type { PropsWithChildren } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'

import { navigationByRole } from '@/config/navigation'
import { getUnreadNotificationCount } from '@/data/selectors'
import { useAppData, useCurrentReportingPeriod } from '@/context/app-data-context'
import { formatWeekLabel } from '@/lib/dates'
import { cn } from '@/lib/utils'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet'

function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const { currentUser } = useAppData()

  if (!currentUser) {
    return null
  }

  const items = navigationByRole[currentUser.role]

  return (
    <nav className="space-y-2">
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
                'group flex items-center rounded-[1.45rem] border px-4 py-3.5 text-sm font-semibold transition-all duration-300',
                isActive
                  ? 'border-cyan-200/50 bg-[linear-gradient(135deg,#67e8f9_0%,#60a5fa_42%,#34d399_100%)] text-slate-950 shadow-[0_26px_34px_-24px_rgba(34,211,238,0.65)]'
                  : 'border-transparent text-white/90 hover:border-white/12 hover:bg-white/8 hover:text-white hover:translate-x-1',
              )
            }
          >
            {({ isActive }) => (
              <span className="flex items-center gap-3">
                <span
                  className={cn(
                    'flex h-9 w-9 items-center justify-center rounded-2xl transition-all duration-300',
                    isActive
                      ? 'bg-slate-950/14 text-slate-950 ring-1 ring-white/40'
                      : 'bg-white/12 text-cyan-50 group-hover:bg-white/16 group-hover:text-white',
                  )}
                >
                  <Icon className="h-4 w-4" />
                </span>
                <span className={cn(isActive ? 'text-slate-950' : 'text-white/92 group-hover:text-white')}>
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

  return (
    <div className="relative min-h-screen bg-[linear-gradient(180deg,#edf8ff_0%,#f6fbff_34%,#e9f2ff_100%)]">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="float-slow absolute left-[-6rem] top-[-6rem] h-80 w-80 rounded-full bg-cyan-200/60 blur-3xl" />
        <div className="absolute left-[18%] top-[10%] h-64 w-64 rounded-full bg-blue-200/35 blur-3xl" />
        <div className="float-slow absolute right-[-5rem] top-10 h-96 w-96 rounded-full bg-emerald-100/75 blur-3xl" />
        <div className="absolute bottom-[-7rem] left-1/3 h-80 w-80 rounded-full bg-sky-100/70 blur-3xl" />
      </div>

      <div className="relative mx-auto flex min-h-[calc(100vh-2rem)] max-w-[1600px] gap-6 px-4 py-4 lg:px-6">
        <aside className="relative sticky top-4 hidden w-80 shrink-0 self-start flex-col overflow-hidden rounded-[2rem] border border-white/8 bg-[linear-gradient(180deg,#07152d_0%,#0b2447_48%,#07223b_100%)] p-6 shadow-[0_30px_70px_-32px_rgba(7,21,45,0.72)] backdrop-blur lg:flex">
          <div className="pointer-events-none absolute inset-0">
            <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/50 to-transparent" />
            <div className="absolute left-[-3rem] top-[-2rem] h-32 w-32 rounded-full bg-cyan-300/16 blur-2xl" />
            <div className="absolute right-[-2rem] bottom-20 h-44 w-44 rounded-full bg-blue-400/14 blur-3xl" />
          </div>
          <div className="relative space-y-1">
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-cyan-200">
              Internal Medicine
            </p>
            <h2 className="font-display text-[1.85rem] font-semibold leading-tight text-white">
              Dashboard
            </h2>
          </div>
          <Separator className="relative my-5 bg-white/10" />
          <div className="relative">
            <SidebarNav />
          </div>
          <div className="relative mt-10 space-y-3 rounded-[1.7rem] border border-white/12 bg-[linear-gradient(145deg,rgba(255,255,255,0.14),rgba(255,255,255,0.05))] px-5 py-5 text-white shadow-[0_24px_38px_-24px_rgba(7,21,45,0.88)] backdrop-blur">
            <div className="absolute inset-x-5 top-0 h-1 rounded-full bg-[linear-gradient(90deg,#67e8f9_0%,#60a5fa_42%,#34d399_100%)]" />
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-cyan-100">
              Reporting week
            </p>
            <p className="font-display text-xl">{currentPeriod ? formatWeekLabel(currentPeriod) : '-'}</p>
          </div>
        </aside>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-5">
          <header className="sticky top-4 z-30 rounded-[2rem] border border-white/70 bg-[linear-gradient(180deg,rgba(255,255,255,0.82),rgba(243,249,255,0.7))] px-5 py-4 shadow-[0_20px_40px_-26px_rgba(15,23,42,0.22)] backdrop-blur-xl">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3 lg:hidden">
                <Sheet>
                  <SheetTrigger asChild>
                    <Button variant="secondary" size="icon">
                      <Menu className="h-4 w-4" />
                    </Button>
                  </SheetTrigger>
                  <SheetContent side="left" className="space-y-6">
                    <div className="space-y-2">
                      <p className="text-xs font-semibold uppercase tracking-[0.24em] text-cyan-200">
                        IM
                      </p>
                      <h2 className="font-display text-2xl font-semibold text-white">
                        Navigation
                      </h2>
                    </div>
                    <SidebarNav />
                  </SheetContent>
                </Sheet>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.24em] text-sky-700">
                    Current Week
                  </p>
                  <p className="text-sm font-medium text-slate-700">
                    {currentPeriod ? formatWeekLabel(currentPeriod) : '-'}
                  </p>
                </div>
              </div>

              <div className="hidden lg:block">
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-cyan-700">
                  Live reporting period
                </p>
                <p className="text-base font-semibold text-slate-900">
                  {currentPeriod ? formatWeekLabel(currentPeriod) : '-'}
                </p>
              </div>

              <div className="flex items-center gap-3">
                {isSyncing ? (
                  <div
                    aria-live="polite"
                    className="hidden items-center gap-2 rounded-full border border-cyan-200/70 bg-white/84 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.22em] text-cyan-700 shadow-[0_16px_24px_-24px_rgba(34,211,238,0.5)] backdrop-blur sm:flex"
                  >
                    <span className="relative flex h-2.5 w-2.5 items-center justify-center">
                      <span className="absolute inset-0 animate-ping rounded-full bg-cyan-400/55" />
                      <span className="relative h-2.5 w-2.5 rounded-full bg-cyan-500" />
                    </span>
                    Syncing
                  </div>
                ) : null}
                <Button
                  variant="secondary"
                  size="icon"
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
                    <span className="pulse-ring absolute ml-4 mt-[-1.15rem] flex h-5 min-w-5 items-center justify-center rounded-full bg-fuchsia-500 px-1 text-[10px] font-bold text-white">
                      {unreadCount}
                    </span>
                  ) : null}
                </Button>
                <div className="flex items-center gap-3 rounded-2xl border border-white/80 bg-[linear-gradient(180deg,rgba(255,255,255,0.96),rgba(239,246,255,0.86))] px-3 py-2 shadow-[0_18px_28px_-24px_rgba(15,23,42,0.38)]">
                  <Avatar>
                    <AvatarFallback>
                      {currentUser.fullName
                        .split(' ')
                        .map((part) => part[0])
                        .join('')
                        .slice(0, 2)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="hidden text-left sm:block">
                    <p className="text-sm font-semibold text-slate-900">
                      {currentUser.fullName}
                    </p>
                    <p className="text-xs uppercase tracking-[0.18em] text-slate-500">
                      {currentUser.title}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => {
                      void logout()
                      navigate('/login')
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
