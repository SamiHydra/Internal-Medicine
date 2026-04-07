import type { TextareaHTMLAttributes } from 'react'

import { cn } from '@/lib/utils'

export function Textarea({
  className,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(
        'min-h-28 w-full rounded-[0.5rem] border border-[#d4dde8] bg-[linear-gradient(180deg,#ffffff_0%,#f6f8fa_100%)] px-3 py-3 text-sm text-[#000a1e] shadow-[0_14px_24px_-22px_rgba(0,33,71,0.16)] outline-none transition-colors placeholder:text-[#74777f] focus:border-[#63a1ff] focus:ring-4 focus:ring-[#d9e9fb] disabled:cursor-not-allowed disabled:bg-[#f3f4f5] disabled:text-[#74777f]',
        className,
      )}
      {...props}
    />
  )
}
