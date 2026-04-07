import { motion } from 'framer-motion'
import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

type HeroStat = {
  label: string
  value: string
  note?: string
}

export function AdminPageHero({
  eyebrow,
  title,
  description,
  meta = [],
  stats = [],
  actions,
  className,
}: {
  eyebrow: string
  title: string
  description: string
  meta?: readonly string[]
  stats?: readonly HeroStat[]
  actions?: ReactNode
  className?: string
}) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: 'easeOut' }}
      className={cn(
        'rounded-[0.35rem] bg-[#eef2f6] px-5 py-6 md:px-6 md:py-6',
        className,
      )}
    >
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px] xl:items-start">
        <div className="space-y-5">
          <div className="space-y-3">
            <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-[#005db6]">
              {eyebrow}
            </p>
            <h1 className="max-w-[14ch] font-display text-[2.1rem] leading-[0.95] tracking-[-0.035em] text-[#000a1e] md:text-[2.75rem]">
              {title}
            </h1>
            <p className="max-w-3xl text-sm leading-7 text-[#44474e] md:text-base">
              {description}
            </p>
          </div>

          {meta.length ? (
            <div className="flex flex-wrap gap-x-5 gap-y-2 text-[11px] font-bold uppercase tracking-[0.18em] text-[#74777f]">
              {meta.map((item) => (
                <span key={item}>{item}</span>
              ))}
            </div>
          ) : null}

          {actions ? <div className="flex flex-wrap items-center gap-3">{actions}</div> : null}
        </div>

        {stats.length ? (
          <div className="rounded-[0.35rem] bg-[#000a1e] px-5 py-5 text-white md:px-6">
            <div className="space-y-4">
              <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#f0b429]">
                Weekly posture
              </p>

              <div className={cn('grid gap-4', stats.length > 1 ? 'sm:grid-cols-2' : 'grid-cols-1')}>
                {stats.map((stat) => (
                  <div key={stat.label} className="space-y-2">
                    <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#f0b429]">
                      {stat.label}
                    </p>
                    <p className="font-display text-[1.6rem] leading-none tracking-[-0.03em] text-white">
                      {stat.value}
                    </p>
                    {stat.note ? (
                      <p className="text-sm leading-6 text-[#c6d3e4]">{stat.note}</p>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </motion.section>
  )
}
