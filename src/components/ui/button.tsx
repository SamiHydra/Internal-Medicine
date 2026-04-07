import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import type { ButtonHTMLAttributes } from 'react'

import { cn } from '@/lib/utils'

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 rounded-[0.25rem] text-sm font-semibold transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#63a1ff]/45 focus-visible:ring-offset-2 focus-visible:ring-offset-white disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        default:
          'auth-primary-button border border-transparent !bg-[var(--brand-primary)] !text-white font-bold tracking-[0.02em] shadow-[0_16px_32px_rgba(0,93,182,0.24)] hover:!bg-[var(--brand-primary-strong)] hover:!text-white [&_svg]:!text-white',
        secondary:
          'border border-[#d4dde8] bg-[linear-gradient(180deg,#ffffff_0%,#f3f4f5_100%)] text-[#000a1e] shadow-[0_14px_24px_-22px_rgba(0,33,71,0.18)] hover:bg-[#eef3f8]',
        ghost: 'text-[#44474e] hover:bg-[#edf1f5] hover:text-[#000a1e]',
        outline:
          'border border-[#c4c6cf]/40 bg-[#ffffff] text-[#000a1e] hover:bg-[#f3f4f5]',
        destructive:
          'bg-[#ba1a1a] text-white shadow-[0_16px_28px_-22px_rgba(186,26,26,0.5)] hover:bg-[#93000a]',
      },
      size: {
        default: 'h-12 px-4',
        sm: 'h-9 rounded-[0.25rem] px-3 text-xs',
        lg: 'h-12 px-6 text-sm',
        icon: 'h-10 w-10 rounded-[0.25rem]',
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
