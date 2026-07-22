import type { ComponentProps } from 'react'

import * as TabsPrimitive from '@radix-ui/react-tabs'

import { cn } from '@/lib/utils'

export function Tabs(props: ComponentProps<typeof TabsPrimitive.Root>) {
  return <TabsPrimitive.Root {...props} />
}

// The app's one tab-bar look: a white track with a hairline outline, and the
// active tab as a solid navy pill. Kept here rather than at each call site so
// every tab row on every page stays identical.
export function TabsList({
  className,
  ...props
}: ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      className={cn(
        'inline-flex h-auto w-fit max-w-full flex-wrap gap-1.5 rounded-[0.35rem] bg-white p-1.5 outline outline-1 outline-[#d4dde8]',
        className,
      )}
      {...props}
    />
  )
}

export function TabsTrigger({
  className,
  ...props
}: ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        'inline-flex items-center justify-center rounded-[0.25rem] px-3.5 py-2 text-sm font-semibold text-[#44474e] transition-colors outline-none focus-visible:ring-2 focus-visible:ring-[#005db6] focus-visible:ring-offset-2 data-[state=inactive]:hover:bg-[#eef2f6] data-[state=active]:bg-[#04162f] data-[state=active]:text-white',
        className,
      )}
      {...props}
    />
  )
}

export function TabsContent({
  className,
  ...props
}: ComponentProps<typeof TabsPrimitive.Content>) {
  return <TabsPrimitive.Content className={cn('mt-6', className)} {...props} />
}
