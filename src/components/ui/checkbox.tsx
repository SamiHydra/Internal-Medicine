import type { ComponentProps } from 'react'

import * as CheckboxPrimitive from '@radix-ui/react-checkbox'
import { Check } from 'lucide-react'

import { cn } from '@/lib/utils'

export function Checkbox({
  className,
  ...props
}: ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      className={cn(
        'peer h-5 w-5 shrink-0 rounded-[0.25rem] border border-[#c9d2de] bg-[#ffffff] shadow-[0_10px_18px_-14px_rgba(0,33,71,0.18)] outline-none transition-colors focus-visible:ring-4 focus-visible:ring-[#cfe1f7] data-[state=checked]:border-[#005db6] data-[state=checked]:bg-[#005db6]',
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator className="flex items-center justify-center text-white">
        <Check className="h-4 w-4 stroke-[3]" />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  )
}
