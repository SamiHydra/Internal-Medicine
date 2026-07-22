import { motion } from 'framer-motion'
import type { ReactNode } from 'react'

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
          <h3 className="text-sm font-semibold uppercase tracking-[0.22em] text-[#334155]">{title}</h3>
          {actions}
        </div>
        <p className="mt-1 text-sm leading-6 text-[#74777f]">{description}</p>
        <div className="mt-4 flex-1">{children}</div>
      </div>
    </motion.div>
  )
}
