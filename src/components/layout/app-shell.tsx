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

function BrandLockup({ compact = false }: { compact?: boolean }) {
  return (
    <div className={cn('flex items-center', compact ? 'gap-3' : 'gap-4')}>
      <img
        src={stPaulosLogo}
        alt="St. Paulos Hospital logo"
        className={cn(
          'shrink-0 object-cover drop-shadow-[0_16px_22px_rgba(30,58,138,0.16)]',
          compact ? 'h-12 w-12 rounded-xl' : 'h-14 w-14 rounded-[1.1rem]',
        )}
      />

      <div className="min-w-0 space-y-1">
        <p
          className={cn(
            'font-semibold uppercase tracking-[0.28em] text-[#1d4ed8]',
            compact ? 'text-[0.6rem]' : 'text-[0.64rem]',
          )}
        >
          St. Paulos Hospital
        </p>
        <p
          className={cn(
            'font-display leading-tight text-slate-950',
            compact ? 'text-lg' : 'text-[1.55rem]',
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
                  ? 'border-white/80 bg-[linear-gradient(135deg,rgba(29,78,216,0.18),rgba(56,189,248,0.18),rgba(251,191,36,0.14))] text-slate-950 shadow-[0_26px_34px_-24px_rgba(30,58,138,0.24)]'
                  : 'border-transparent text-slate-700 hover:border-white/80 hover:bg-white/58 hover:text-slate-950 hover:translate-x-1',
              )
            }
          >
            {({ isActive }) => (
              <span className="flex items-center gap-3">
                <span
                  className={cn(
                    'flex h-9 w-9 items-center justify-center rounded-2xl transition-all duration-300',
                    isActive
                      ? 'bg-white/72 text-slate-950 ring-1 ring-white/55'
                      : 'bg-white/52 text-slate-600 group-hover:bg-white/72 group-hover:text-slate-900',
                  )}
                >
                  <Icon className="h-4 w-4" />
                </span>
                <span className={cn(isActive ? 'text-slate-950' : 'text-slate-700 group-hover:text-slate-950')}>
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
    <div className="relative min-h-screen bg-[radial-gradient(circle_at_14%_18%,rgba(29,78,216,0.12),transparent_24%),radial-gradient(circle_at_76%_22%,rgba(56,189,248,0.12),transparent_22%),radial-gradient(circle_at_28%_78%,rgba(245,158,11,0.08),transparent_20%),linear-gradient(180deg,#f6fbff_0%,#edf6ff_42%,#eef8ff_100%)]">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="float-slow absolute left-[-6rem] top-[-6rem] h-80 w-80 rounded-full bg-blue-200/48 blur-3xl" />
        <div className="absolute left-[18%] top-[10%] h-64 w-64 rounded-full bg-sky-200/32 blur-3xl" />
        <div className="float-slow absolute right-[-5rem] top-10 h-96 w-96 rounded-full bg-cyan-100/78 blur-3xl" />
        <div className="absolute bottom-[-7rem] left-1/3 h-80 w-80 rounded-full bg-amber-100/26 blur-3xl" />
        <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.16)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.16)_1px,transparent_1px)] bg-[size:84px_84px] opacity-20 [mask-image:radial-gradient(circle_at_34%_28%,black_16%,transparent_72%)]" />
      </div>

      <div className="relative mx-auto flex min-h-[calc(100vh-2rem)] max-w-[1600px] gap-6 px-4 py-4 lg:px-6">
        <aside className="relative sticky top-4 hidden w-80 shrink-0 self-start flex-col overflow-hidden rounded-[2.4rem] border border-white/75 bg-[linear-gradient(180deg,rgba(255,255,255,0.78),rgba(239,246,255,0.72),rgba(255,251,238,0.5))] p-6 shadow-[0_30px_70px_-34px_rgba(30,58,138,0.24)] backdrop-blur-xl lg:flex">
          <div className="pointer-events-none absolute inset-0">
            <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-[#1d4ed8] via-[#38bdf8] to-[#fbbf24]" />
            <div className="absolute left-[-3rem] top-[-2rem] h-32 w-32 rounded-full bg-[#1d4ed8]/10 blur-2xl" />
            <div className="absolute right-[-2rem] bottom-20 h-44 w-44 rounded-full bg-[#38bdf8]/10 blur-3xl" />
            <div className="absolute bottom-8 left-10 h-28 w-28 rounded-full bg-[#fbbf24]/10 blur-3xl" />
          </div>
          <div className="relative">
            <BrandLockup />
          </div>
          <Separator className="relative my-5 bg-sky-100/80" />
          <div className="relative">
            <SidebarNav />
          </div>
          <div className="relative mt-10 space-y-3 rounded-[1.9rem] border border-white/80 bg-[linear-gradient(180deg,rgba(255,255,255,0.76),rgba(239,246,255,0.66),rgba(255,251,238,0.48))] px-5 py-5 text-slate-900 shadow-[0_24px_38px_-26px_rgba(30,58,138,0.18)] backdrop-blur">
            <div className="absolute inset-x-5 top-0 h-1 rounded-full bg-[linear-gradient(90deg,#1d4ed8_0%,#38bdf8_48%,#fbbf24_100%)]" />
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-sky-700">
              Reporting week
            </p>
            <p className="font-display text-xl text-slate-950">{currentPeriod ? formatWeekLabel(currentPeriod) : '-'}</p>
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
                  <SheetContent
                    side="left"
                    className="space-y-6 bg-[linear-gradient(180deg,rgba(255,255,255,0.96),rgba(239,246,255,0.92),rgba(255,251,238,0.86))] text-slate-950"
                  >
                    <BrandLockup compact />
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
