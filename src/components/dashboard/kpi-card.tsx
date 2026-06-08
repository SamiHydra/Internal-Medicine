import type { ReactNode } from 'react'

import { Delta, DeltaIcon, DeltaValue } from '@/components/delta'
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import type { RagStatus } from '@/lib/performance-targets'

type Accent = 'navy' | 'gold' | 'steel'

const accentBarClass: Record<Accent, string> = {
  navy: 'bg-[#002147]',
  gold: 'bg-[#f0b429]',
  steel: 'bg-[#6c7f95]',
}

const ragStatusClass: Record<RagStatus, string> = {
  green: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  amber: 'border-amber-200 bg-amber-50 text-amber-800',
  red: 'border-rose-200 bg-rose-50 text-rose-800',
  neutral: 'border-slate-200 bg-slate-50 text-slate-600',
}

/**
 * Hairline KPI cluster (efferd technique): cards butt together with a 1px divider
 * created by `gap-px` over a border-coloured bed, reading as one instrument cluster.
 */
export function KpiGrid({
  children,
  className,
  columns = 3,
}: {
  children: ReactNode
  className?: string
  columns?: 2 | 3 | 4
}) {
  const cols =
    columns === 2 ? 'sm:grid-cols-2' : columns === 4 ? 'sm:grid-cols-2 lg:grid-cols-4' : 'sm:grid-cols-3'
  return (
    <div
      className={cn(
        'grid grid-cols-1 gap-px overflow-hidden rounded-[0.35rem] bg-[#d4dde8]/70 p-px',
        cols,
        className,
      )}
    >
      {children}
    </div>
  )
}

export function KpiCard({
  label,
  value,
  delta,
  deltaSuffix = '%',
  hint,
  accent = 'navy',
  status,
}: {
  label: string
  value: ReactNode
  /** Period-over-period trend; omit for no chip, 0 renders the neutral flat state. */
  delta?: number
  deltaSuffix?: string
  hint?: string
  accent?: Accent
  status?: {
    tone: RagStatus
    label: string
  }
}) {
  return (
    <Card className="gap-0 rounded-none border-0 pl-1 outline-none">
      <span
        aria-hidden="true"
        className={cn('absolute inset-y-0 left-0 w-[3px]', accentBarClass[accent])}
      />
      <CardHeader className="p-4 pb-0 md:p-5 md:pb-0">
        <CardTitle className="font-sans text-[10px] font-semibold uppercase tracking-[0.18em] text-[#44474e] md:text-[11px] md:tracking-[0.2em]">
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-4 pb-0 pt-2 md:p-5 md:pb-0 md:pt-2.5">
        <p className="font-display text-[1.45rem] font-bold leading-none tracking-[-0.03em] tabular-nums text-[#000a1e] md:text-[1.7rem]">
          {value}
        </p>
      </CardContent>
      {delta !== undefined || hint || status ? (
        <CardFooter className="flex-wrap gap-1.5 p-4 pt-2.5 text-xs md:p-5 md:pt-3">
          {status ? (
            <span className={cn('inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.12em]', ragStatusClass[status.tone])}>
              {status.label}
            </span>
          ) : null}
          {delta !== undefined ? (
            <Delta value={delta} variant="badge">
              <DeltaIcon variant="trend" />
              <DeltaValue suffix={deltaSuffix} />
            </Delta>
          ) : null}
          {hint ? <span className="hidden text-[#6c7f95] sm:inline">{hint}</span> : null}
        </CardFooter>
      ) : null}
    </Card>
  )
}
