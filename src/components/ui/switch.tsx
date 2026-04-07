import type { ComponentProps } from 'react'

import * as SwitchPrimitive from '@radix-ui/react-switch'

import { cn } from '@/lib/utils'

export function Switch({
  className,
  ...props
}: ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      className={cn(
        'peer inline-flex h-6 w-11 items-center rounded-full border border-[#c9d2de] bg-[#e6ebf2] transition-colors data-[state=checked]:border-[#005db6] data-[state=checked]:bg-[#005db6]',
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb className="block h-5 w-5 translate-x-0.5 rounded-full bg-white shadow-[0_10px_18px_-12px_rgba(0,33,71,0.28)] transition-transform data-[state=checked]:translate-x-[1.35rem]" />
    </SwitchPrimitive.Root>
  )
}
