import type { HTMLAttributes } from 'react'

import { cn } from '@/lib/utils'

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-[0.35rem] bg-[#ffffff] outline outline-1 outline-[#d4dde8]/65',
        className,
      )}
      {...props}
    />
  )
}

export function CardHeader({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('space-y-2 p-6 pb-0 md:p-7 md:pb-0', className)} {...props} />
}

export function CardTitle({
  className,
  ...props
}: HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3
      className={cn(
        'font-display text-lg font-semibold tracking-[-0.02em] text-[#000a1e]',
        className,
      )}
      {...props}
    />
  )
}

export function CardDescription({
  className,
  ...props
}: HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p className={cn('text-sm leading-6 text-[#44474e]', className)} {...props} />
  )
}

export function CardContent({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('p-6 md:p-7', className)} {...props} />
}

export function CardFooter({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('flex items-center gap-3 px-6 pb-6 pt-0', className)}
      {...props}
    />
  )
}
