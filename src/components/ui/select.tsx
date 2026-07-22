import type { ComponentProps } from 'react'

import * as SelectPrimitive from '@radix-ui/react-select'
import { Check, ChevronDown, ChevronUp } from 'lucide-react'

import { cn } from '@/lib/utils'

export function Select(props: ComponentProps<typeof SelectPrimitive.Root>) {
  return <SelectPrimitive.Root {...props} />
}

export function SelectValue(props: ComponentProps<typeof SelectPrimitive.Value>) {
  return <SelectPrimitive.Value {...props} />
}

export function SelectTrigger({
  className,
  children,
  ...props
}: ComponentProps<typeof SelectPrimitive.Trigger>) {
  return (
    <SelectPrimitive.Trigger
      className={cn(
        'group flex h-11 w-full min-w-0 items-center justify-between gap-2 overflow-hidden rounded-[0.4rem] border border-[#d4dde8] bg-white px-4 text-sm font-medium text-[#000a1e] outline-none transition-[border-color,box-shadow] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] hover:border-[#b8c7d8] focus:border-[#005db6] focus:ring-2 focus:ring-[#005db6]/25 data-[placeholder]:text-[#74777f] data-[state=open]:border-[#005db6] data-[state=open]:ring-2 data-[state=open]:ring-[#005db6]/15 [&>*:first-child]:min-w-0 [&>*:first-child]:flex-1 [&>*:first-child]:truncate [&>*:first-child]:whitespace-nowrap',
        className,
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon className="shrink-0">
        <ChevronDown className="h-4 w-4 text-[#74777f] transition-transform duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] group-data-[state=open]:rotate-180 group-data-[state=open]:text-[#005db6]" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  )
}

export function SelectContent({
  className,
  children,
  position = 'popper',
  ...props
}: ComponentProps<typeof SelectPrimitive.Content>) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        position={position}
        className={cn(
          'z-[100] max-h-[min(var(--radix-select-content-available-height,20rem),20rem)] min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-[0.45rem] border border-[#e1e6ec] bg-white p-1.5 shadow-[0_24px_50px_-20px_rgba(0,33,71,0.28)]',
          className,
        )}
        {...props}
      >
        <SelectPrimitive.ScrollUpButton className="flex h-8 items-center justify-center text-slate-500">
          <ChevronUp className="h-4 w-4" />
        </SelectPrimitive.ScrollUpButton>
        <SelectPrimitive.Viewport className="min-h-0 overscroll-contain p-1">
          {children}
        </SelectPrimitive.Viewport>
        <SelectPrimitive.ScrollDownButton className="flex h-8 items-center justify-center text-slate-500">
          <ChevronDown className="h-4 w-4" />
        </SelectPrimitive.ScrollDownButton>
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  )
}

export function SelectItem({
  className,
  children,
  ...props
}: ComponentProps<typeof SelectPrimitive.Item>) {
  return (
    <SelectPrimitive.Item
      className={cn(
        'relative flex cursor-default select-none items-center rounded-[0.25rem] py-2.5 pl-8 pr-3 text-sm text-[#44474e] outline-none data-[disabled]:pointer-events-none data-[highlighted]:bg-[#edf4fb] data-[highlighted]:text-[#000a1e] data-[disabled]:opacity-50',
        className,
      )}
      {...props}
    >
      <span className="absolute left-3 flex h-3.5 w-3.5 items-center justify-center">
        <SelectPrimitive.ItemIndicator>
          <Check className="h-4 w-4 text-[#005db6]" />
        </SelectPrimitive.ItemIndicator>
      </span>
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  )
}
