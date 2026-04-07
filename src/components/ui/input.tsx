import type { InputHTMLAttributes } from 'react'

import { cn } from '@/lib/utils'

export function Input({
  className,
  type = 'text',
  ...props
}: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      type={type}
      className={cn(
        'flex h-11 w-full rounded-[0.25rem] border border-[#d4dde8] bg-[linear-gradient(180deg,#ffffff_0%,#f6f8fa_100%)] px-3 text-sm text-[#000a1e] shadow-[0_14px_24px_-24px_rgba(0,33,71,0.18)] outline-none transition-colors placeholder:text-[#74777f] focus:border-[#005db6] focus:ring-4 focus:ring-[#d6e3ff]/70 disabled:cursor-not-allowed disabled:bg-[#edeeef]',
        className,
      )}
      {...props}
    />
  )
}
