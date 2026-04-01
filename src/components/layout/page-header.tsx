import { motion } from 'framer-motion'
import type { ReactNode } from 'react'

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string
  title: string
  description: string
  actions?: ReactNode
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="relative overflow-hidden rounded-[2rem] border border-white/70 bg-[linear-gradient(135deg,rgba(255,255,255,0.78),rgba(239,246,255,0.76)_40%,rgba(232,250,247,0.76)_100%)] px-6 py-7 shadow-[0_26px_54px_-30px_rgba(15,23,42,0.24)] backdrop-blur-xl lg:px-8 lg:py-8"
    >
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute left-[-2rem] top-[-2rem] h-28 w-28 rounded-full bg-cyan-200/55 blur-2xl" />
        <div className="absolute right-[12%] top-4 h-24 w-24 rounded-full bg-emerald-200/45 blur-2xl" />
        <div className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-cyan-300/80 to-transparent" />
      </div>

      <div className="relative flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
        <div className="max-w-3xl space-y-4">
        {eyebrow ? (
            <div className="inline-flex items-center gap-2 rounded-full border border-cyan-200/80 bg-white/70 px-3 py-1.5 shadow-[0_14px_24px_-18px_rgba(34,211,238,0.4)]">
              <span className="h-2 w-2 rounded-full bg-cyan-500" />
              <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-cyan-900">
                {eyebrow}
              </p>
            </div>
        ) : null}
          <div className="space-y-3">
            <h1 className="font-display text-4xl font-semibold tracking-tight text-slate-950 md:text-[3.75rem] md:leading-[1.02]">
              {title}
            </h1>
            <p className="max-w-2xl text-base leading-7 text-slate-700 md:text-lg">
              {description}
            </p>
          </div>
        </div>
        {actions ? <div className="relative flex items-center gap-3">{actions}</div> : null}
      </div>
    </motion.div>
  )
}
