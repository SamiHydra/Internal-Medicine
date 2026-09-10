import { motion } from 'framer-motion'
import { useEffect, useRef, useState, type ReactNode } from 'react'

function DeferredChartContent({ children }: { children: ReactNode }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [shouldRender, setShouldRender] = useState(
    () => typeof IntersectionObserver === 'undefined',
  )

  useEffect(() => {
    if (shouldRender || !containerRef.current) {
      return
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) {
          return
        }
        setShouldRender(true)
        observer.disconnect()
      },
      // Prepare chart SVG before the card reaches the viewport so scrolling
      // never exposes a skeleton-to-chart reveal.
      { rootMargin: '800px 0px' },
    )

    observer.observe(containerRef.current)
    return () => observer.disconnect()
  }, [shouldRender])

  return (
    <div ref={containerRef} className="mt-4 min-h-[260px] flex-1">
      {shouldRender ? (
        children
      ) : (
        <div
          aria-hidden="true"
          className="h-full min-h-[260px] animate-pulse rounded-[0.3rem] bg-[#edf1f5]"
        />
      )}
    </div>
  )
}

export function ChartCard({
  title,
  description,
  children,
  actions,
}: {
  title: string
  description: string
  children: ReactNode
  /** Optional controls (view toggles, scope switches) aligned with the title. */
  actions?: ReactNode
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: 'easeOut' }}
      className="h-full"
    >
      <div className="flex h-full flex-col rounded-[0.35rem] bg-white p-5 outline outline-1 outline-[#d4dde8]/80 shadow-[0_18px_44px_-36px_rgba(0,33,71,0.3)] md:p-6">
        <div className="flex items-start justify-between gap-4">
          <h2 className="text-sm font-semibold uppercase tracking-[0.22em] text-[#334155]">{title}</h2>
          {actions}
        </div>
        <p className="mt-1 text-sm leading-6 text-[#666970]">{description}</p>
        <DeferredChartContent>{children}</DeferredChartContent>
      </div>
    </motion.div>
  )
}
