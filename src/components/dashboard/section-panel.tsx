import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

/**
 * The canonical "new aesthetic" surface: a white panel with a hairline outline and
 * a soft lifted shadow. Matches the admin dashboards so every role shares one look.
 */
export const panelClass =
  'rounded-[0.35rem] bg-white px-5 py-6 outline outline-1 outline-[#d4dde8] shadow-[0_24px_60px_-42px_rgba(0,33,71,0.28)] md:px-6 md:py-7'

/** Gold tick + blue uppercase label used to head every section. */
export function SectionEyebrow({ label }: { label: string }) {
  return (
    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#005db6]">{label}</p>
  )
}

/**
 * Standard panel header: eyebrow + title + description on the left, optional actions
 * on the right, separated from the body by a hairline divider.
 */
export function SectionHeader({
  eyebrow,
  title,
  description,
  actions,
  className,
}: {
  eyebrow: string
  title?: string
  description?: ReactNode
  actions?: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        'flex flex-col gap-4 border-b border-[#eef2f6] pb-5 sm:flex-row sm:items-start sm:justify-between',
        className,
      )}
    >
      <div className="min-w-0">
        <SectionEyebrow label={eyebrow} />
        {title ? (
          <h2 className="mt-1.5 font-display text-[1.4rem] font-bold leading-tight tracking-[-0.02em] text-[#000a1e] md:text-[1.6rem]">
            {title}
          </h2>
        ) : null}
        {description ? (
          <p className="mt-1.5 max-w-2xl text-[15px] leading-6 text-[#74777f]">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2.5">{actions}</div> : null}
    </div>
  )
}

/** Small uppercase count/label chip used in panel headers. */
export function HeaderChip({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-[0.25rem] border border-[#d4dde8] bg-[#f8fafc] px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-[#44474e]">
      {children}
    </span>
  )
}

/** Consistent dashed empty state for sections with no data yet. */
export function SectionEmptyState({
  icon,
  title,
  description,
}: {
  icon: ReactNode
  title: string
  description: string
}) {
  return (
    <div className="flex min-h-[200px] flex-col items-center justify-center gap-3 rounded-[0.4rem] border border-dashed border-[#d4dde8] bg-[#f8fafc] px-6 text-center">
      <span className="text-[#005db6]">{icon}</span>
      <div className="space-y-1">
        <p className="text-[15px] font-semibold text-[#1d3047]">{title}</p>
        <p className="max-w-sm text-sm leading-6 text-[#74777f]">{description}</p>
      </div>
    </div>
  )
}
