import { cva, type VariantProps } from 'class-variance-authority'
import type { HTMLAttributes } from 'react'

import { cn } from '@/lib/utils'

const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-[0.25rem] border px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.16em]',
  {
    variants: {
      variant: {
        neutral: 'border-[#d4dde8] bg-[#edf1f5] text-[#44474e]',
        info: 'border-[#c7d8f2] bg-[#edf4fb] text-[#00468c]',
        success: 'border-[#cfe7d9] bg-[#edf7f0] text-[#1f6b3b]',
        warning: 'border-[#f0d9aa] bg-[#fbf4e6] text-[#8a5a00]',
        danger: 'border-[#f1d1d1] bg-[#fff1f1] text-[#9d2a2a]',
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
