import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronUp,
  Minus,
  TrendingDown,
  TrendingUp,
} from 'lucide-react'
import * as React from 'react'

import { cn } from '@/lib/utils'

/**
 * Navy/gold trend indicator (ported from the efferd dashboard pattern, re-skinned
 * to the clinical palette). Compound component: <Delta value={n}><DeltaIcon/><DeltaValue/></Delta>.
 * In this clinical palette navy (#005db6) reads as the positive/"good" direction,
 * #ba1a1a as negative, steel (#6c7f95) as flat. Pass a className to override (e.g.
 * a gold premium accent) on a per-call basis.
 */

type DeltaIconVariant = 'default' | 'trend' | 'arrow'
type DeltaVariant = 'default' | 'badge'

const DeltaContext = React.createContext<{ value: number } | null>(null)

function useDeltaValue() {
  const context = React.useContext(DeltaContext)
  if (!context) {
    throw new Error('DeltaIcon and DeltaValue must be used inside a `Delta` component.')
  }
  return context.value
}

function Delta({
  className,
  value,
  variant = 'default',
  ...props
}: React.ComponentProps<'div'> & { value: number; variant?: DeltaVariant }) {
  const positive = value > 0
  const negative = value < 0
  const flat = !value || value === 0
  return (
    <DeltaContext.Provider value={{ value }}>
      <div
        data-slot="delta"
        className={cn(
          'inline-flex items-center gap-1 tabular-nums [&_svg]:shrink-0',
          variant === 'badge'
            ? 'rounded-[0.25rem] px-2 py-0.5 text-[11px] font-semibold [&_svg]:size-3.5'
            : 'text-xs font-medium [&_svg]:size-3',
          positive && (variant === 'badge' ? 'bg-[#005db6]/10 text-[#005db6]' : 'text-[#005db6]'),
          negative && (variant === 'badge' ? 'bg-[#ba1a1a]/10 text-[#ba1a1a]' : 'text-[#ba1a1a]'),
          flat && (variant === 'badge' ? 'bg-[#6c7f95]/12 text-[#6c7f95]' : 'text-[#6c7f95]'),
          className,
        )}
        {...props}
      />
    </DeltaContext.Provider>
  )
}

function FilledShell({ value, children }: { value: number; children: React.ReactNode }) {
  return (
    <span
      data-slot="delta-icon"
      className={cn(
        'inline-flex size-3.5 shrink-0 items-center justify-center rounded-full [&_svg]:size-2.5 [&_svg]:shrink-0 [&_svg]:text-white',
        value > 0 && 'bg-[#005db6]',
        value < 0 && 'bg-[#ba1a1a]',
        (!value || value === 0) && 'bg-[#6c7f95]',
      )}
    >
      {children}
    </span>
  )
}

function DeltaIcon({
  variant = 'default',
  filled = false,
  className,
}: {
  variant?: DeltaIconVariant
  filled?: boolean
  className?: string
}) {
  const value = useDeltaValue()
  const Up = variant === 'trend' ? TrendingUp : variant === 'arrow' ? ArrowUp : ChevronUp
  const Down = variant === 'trend' ? TrendingDown : variant === 'arrow' ? ArrowDown : ChevronDown
  const Icon = !value || value === 0 ? Minus : value > 0 ? Up : Down
  const node = <Icon aria-hidden="true" className={cn(className)} />
  return filled ? <FilledShell value={value}>{node}</FilledShell> : node
}

function DeltaValue({
  className,
  precision = 1,
  suffix = '%',
  absolute = true,
  ...props
}: React.ComponentProps<'span'> & {
  precision?: number
  suffix?: string
  absolute?: boolean
}) {
  const value = useDeltaValue()
  const formatted = (absolute ? Math.abs(value) : value).toFixed(precision)
  return (
    <span className={cn('tabular-nums', className)} data-slot="delta-value" {...props}>
      {formatted}
      {suffix}
    </span>
  )
}

export { Delta, DeltaIcon, DeltaValue }
