import type { ComponentProps } from 'react'

import { cn } from '@/lib/utils'

export function Skeleton({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      aria-hidden="true"
      className={cn('skeleton-shimmer rounded-[0.3rem] bg-[#e8eef5]', className)}
      {...props}
    />
  )
}
