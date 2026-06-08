import { MoreHorizontal } from 'lucide-react'
import { NavLink, useLocation } from 'react-router-dom'

import type { NavigationItem } from '@/config/navigation'
import { cn } from '@/lib/utils'

// Index routes ("Home"/"Dashboard") must match exactly so they don't stay lit
// on their own subroutes (e.g. /admin should not be active on /admin/users).
const HOME_HREFS = new Set(['/admin', '/nurse', '/academic'])

const tabClass =
  'group relative flex h-[3.75rem] w-full flex-col items-center justify-center gap-1 px-1 transition-colors duration-200 outline-none focus-visible:bg-[#edf4fb] motion-safe:active:scale-[0.92]'

function ActiveTick({ active }: { active: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        'absolute top-0 h-[3px] w-9 rounded-full bg-[#f0b429] transition-opacity duration-200',
        active ? 'opacity-100' : 'opacity-0',
      )}
    />
  )
}

/**
 * Fixed bottom navigation for phones. Shows up to four primary destinations as
 * direct tabs; when a role has more, a fifth "More" slot opens the full account
 * menu. Collapsing at >4 (not >5) keeps both admin workspaces uniform: clinical
 * (6 items) and academic (5 items) both render as four tabs + More, with the
 * system pages reachable from More in either. Hidden from `sm` up.
 */
export function MobileTabBar({
  items,
  onMore,
}: {
  items: NavigationItem[]
  onMore: () => void
}) {
  const location = useLocation()
  const showMore = items.length > 4
  const visible = showMore ? items.slice(0, 4) : items
  const overflow = showMore ? items.slice(4) : []
  const moreActive = overflow.some(
    (item) =>
      location.pathname === item.href ||
      location.pathname.startsWith(`${item.href}/`),
  )

  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-[#e7ecf1] bg-white/95 pb-[env(safe-area-inset-bottom)] shadow-[0_-10px_30px_-22px_rgba(0,33,71,0.5)] backdrop-blur-md sm:hidden"
    >
      <ul className="flex items-stretch">
        {visible.map((item) => {
          const Icon = item.icon

          return (
            <li key={item.href} className="min-w-0 flex-1">
              <NavLink
                to={item.href}
                end={HOME_HREFS.has(item.href)}
                className={({ isActive }) =>
                  cn(tabClass, isActive ? 'text-[#005db6]' : 'text-[#74777f]')
                }
              >
                {({ isActive }) => (
                  <>
                    <ActiveTick active={isActive} />
                    <Icon
                      className={cn(
                        'h-[1.35rem] w-[1.35rem] shrink-0 transition-transform duration-200',
                        isActive && 'motion-safe:-translate-y-px',
                      )}
                      strokeWidth={isActive ? 2.4 : 2}
                    />
                    <span className="max-w-full truncate text-[0.625rem] font-semibold tracking-[0.01em]">
                      {item.shortLabel ?? item.label}
                    </span>
                  </>
                )}
              </NavLink>
            </li>
          )
        })}

        {showMore ? (
          <li className="min-w-0 flex-1">
            <button
              type="button"
              onClick={onMore}
              aria-haspopup="dialog"
              className={cn(tabClass, moreActive ? 'text-[#005db6]' : 'text-[#74777f]')}
            >
              <ActiveTick active={moreActive} />
              <MoreHorizontal className="h-[1.35rem] w-[1.35rem] shrink-0" strokeWidth={2} />
              <span className="text-[0.625rem] font-semibold tracking-[0.01em]">More</span>
            </button>
          </li>
        ) : null}
      </ul>
    </nav>
  )
}
