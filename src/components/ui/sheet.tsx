import { useRef, type ComponentProps, type MutableRefObject } from 'react'

import * as DialogPrimitive from '@radix-ui/react-dialog'
import { X } from 'lucide-react'

import { cn } from '@/lib/utils'

type Opener = { element: HTMLElement; label: string }

function describe(element: Element): string {
  return element.getAttribute('aria-label') ?? (element.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 80)
}

/**
 * Mounted only while the sheet is open, so its first render happens in the
 * same render pass as the open state change, before Radix moves focus into
 * the sheet: `document.activeElement` is still the control that opened it.
 */
function OpenerAnchor({ openerRef }: { openerRef: MutableRefObject<Opener | null> }) {
  if (!openerRef.current && typeof document !== 'undefined' && document.activeElement instanceof HTMLElement) {
    openerRef.current = { element: document.activeElement, label: describe(document.activeElement) }
  }
  return null
}

export function SheetContent({
  className,
  children,
  side = 'right',
  onCloseAutoFocus,
  ...props
}: ComponentProps<typeof DialogPrimitive.Content> & {
  side?: 'left' | 'right'
}) {
  const openerRef = useRef<Opener | null>(null)
  const handleCloseAutoFocus = (event: Event) => {
    onCloseAutoFocus?.(event)
    const opener = openerRef.current
    openerRef.current = null
    if (event.defaultPrevented || !opener) return
    // Radix (modal dialog) would otherwise prevent the default and focus its
    // own trigger ref, which is empty for a sheet opened from a plain button.
    const target =
      opener.element.isConnected && opener.element.offsetParent !== null
        ? opener.element
        : Array.from(document.querySelectorAll<HTMLElement>('button, a[href], [tabindex]')).find(
            (candidate) => candidate.offsetParent !== null && describe(candidate) === opener.label,
          )
    if (!target) return
    event.preventDefault()
    target.focus()
  }
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="sheet-overlay fixed inset-0 z-50 bg-slate-950/45 backdrop-blur-md" />
      <DialogPrimitive.Content
        data-side={side}
        className={cn(
          'sheet-content fixed z-50 h-full w-full max-w-sm bg-[linear-gradient(180deg,#07152d_0%,#0b2447_46%,#07223b_100%)] p-6 text-white shadow-2xl outline-none',
          side === 'right' ? 'right-0 top-0' : 'left-0 top-0 border-l-0 border-r',
          className,
        )}
        {...props}
        onCloseAutoFocus={handleCloseAutoFocus}
      >
        <OpenerAnchor openerRef={openerRef} />
        {children}
        <DialogPrimitive.Close
          aria-label="Close"
          className="absolute right-2 top-2 flex h-11 w-11 items-center justify-center rounded-xl text-white/70 transition-[transform,background-color,color] duration-150 ease-out hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#f0b429] active:scale-95"
        >
          <X className="h-4 w-4" aria-hidden="true" />
          <span className="sr-only">Close</span>
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  )
}

export function Sheet(props: ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root {...props} />
}

export function SheetTrigger(props: ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger {...props} />
}

export function SheetClose(props: ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close {...props} />
}

export function SheetTitle({
  className,
  ...props
}: ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      className={cn('text-lg font-semibold tracking-tight text-white', className)}
      {...props}
    />
  )
}

export function SheetDescription({
  className,
  ...props
}: ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      className={cn('text-sm text-white/70', className)}
      {...props}
    />
  )
}
