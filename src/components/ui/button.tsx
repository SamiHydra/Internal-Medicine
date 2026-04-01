import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import type { ButtonHTMLAttributes } from 'react'

import { cn } from '@/lib/utils'

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 rounded-xl text-sm font-semibold transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/40 disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        default:
          'bg-[linear-gradient(135deg,#0891b2_0%,#2563eb_50%,#0f766e_100%)] text-white shadow-[0_18px_30px_-18px_rgba(37,99,235,0.6)] hover:-translate-y-0.5 hover:brightness-105',
        secondary:
          'bg-[linear-gradient(180deg,rgba(255,255,255,0.96),rgba(248,251,255,0.92))] text-slate-700 ring-1 ring-white/80 shadow-[0_16px_28px_-22px_rgba(15,23,42,0.24)] hover:-translate-y-0.5 hover:bg-white',
        ghost: 'text-slate-600 hover:bg-white/70 hover:text-slate-950',
        outline:
          'border border-slate-200/80 bg-[linear-gradient(180deg,rgba(255,255,255,0.96),rgba(248,251,255,0.92))] text-slate-700 hover:border-sky-200 hover:bg-white',
        destructive:
          'bg-[linear-gradient(135deg,#ef4444_0%,#dc2626_100%)] text-white shadow-[0_18px_30px_-20px_rgba(220,38,38,0.6)] hover:-translate-y-0.5',
      },
      size: {
        default: 'h-11 px-4',
        sm: 'h-9 rounded-lg px-3 text-xs',
        lg: 'h-12 px-6 text-sm',
        icon: 'h-10 w-10 rounded-xl',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
)

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }

export function Button({
  className,
  variant,
  size,
  asChild,
  ...props
}: ButtonProps) {
  const Comp = asChild ? Slot : 'button'

  return (
    <Comp
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}
