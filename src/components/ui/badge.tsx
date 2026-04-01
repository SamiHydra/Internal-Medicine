import { cva, type VariantProps } from 'class-variance-authority'
import type { HTMLAttributes } from 'react'

import { cn } from '@/lib/utils'

const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] shadow-[0_12px_22px_-18px_rgba(15,23,42,0.35)]',
  {
    variants: {
      variant: {
        neutral: 'border-slate-200 bg-slate-100/95 text-slate-700',
        info: 'border-cyan-200 bg-cyan-100/90 text-cyan-800',
        success: 'border-emerald-200 bg-emerald-100/90 text-emerald-800',
        warning: 'border-amber-200 bg-amber-100/90 text-amber-800',
        danger: 'border-rose-200 bg-rose-100/90 text-rose-800',
      },
    },
    defaultVariants: {
      variant: 'neutral',
    },
  },
)

type BadgeProps = HTMLAttributes<HTMLSpanElement> &
  VariantProps<typeof badgeVariants>

export function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ variant, className }))} {...props} />
  )
}
