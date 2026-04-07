import { animate, motion, useMotionValue, useTransform } from 'framer-motion'
import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react'
import { useEffect } from 'react'

import { Sparkline } from '@/components/dashboard/sparkline'
import { cn, formatCompactNumber, formatPercent } from '@/lib/utils'

function AnimatedMetric({
  value,
  format = 'number',
}: {
  value: number | null
  format?: 'number' | 'percent'
}) {
  const motionValue = useMotionValue(0)
  const rounded = useTransform(() =>
    format === 'percent'
      ? formatPercent(motionValue.get(), 1)
      : formatCompactNumber(motionValue.get()),
  )

  useEffect(() => {
    const controls = animate(motionValue, value ?? 0, {
      duration: 0.8,
      ease: 'easeOut',
    })

    return () => controls.stop()
  }, [motionValue, value])

  if (value === null) {
    return <span>-</span>
  }

  return <motion.span>{rounded}</motion.span>
}

export function KpiCard({
  label,
  value,
  previousValue,
  delta,
  sparkline,
  format = 'number',
}: {
  label: string
  value: number | null
  previousValue?: number | null
  delta?: number | null
  sparkline?: Array<{ value: number | null }>
  format?: 'number' | 'percent'
}) {
  const themes = [
    {
      accent: 'bg-[#005db6]',
      spark: '#005db6',
    },
    {
      accent: 'bg-[#002147]',
      spark: '#002147',
    },
    {
      accent: 'bg-[#f0b429]',
      spark: '#f0b429',
    },
    {
      accent: 'bg-[#74777f]',
      spark: '#44474e',
    },
  ]
  const themeIndex = label.split('').reduce((sum, char) => sum + char.charCodeAt(0), 0) % themes.length
  const theme = themes[themeIndex]
  const DeltaIcon = delta === null || delta === undefined ? Minus : delta >= 0 ? ArrowUpRight : ArrowDownRight

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: 'easeOut' }}
    >
      <div className="rounded-[0.35rem] bg-[#ffffff] p-5 outline outline-1 outline-[#d4dde8]/65">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className={cn('h-2.5 w-2.5 rounded-[2px]', theme.accent)} />
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#74777f]">
                {label}
              </p>
            </div>
            <p className="font-display text-[1.85rem] font-semibold text-[#000a1e]">
              <AnimatedMetric value={value} format={format} />
            </p>
          </div>
          <div
            className={cn(
              'inline-flex items-center gap-1 rounded-[0.2rem] px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.16em]',
              delta === null || delta === undefined
                ? 'bg-[#edf1f5] text-[#44474e]'
                : delta >= 0
                  ? 'bg-[#edf4fb] text-[#00468c]'
                  : 'bg-[#fff1f1] text-[#9d2a2a]',
            )}
          >
            <DeltaIcon className="h-3.5 w-3.5" />
            {delta === null || delta === undefined ? 'No prior data' : `${Math.abs(delta).toFixed(0)}%`}
          </div>
        </div>
        {sparkline ? <Sparkline data={sparkline} color={theme.spark} /> : null}
        {previousValue !== undefined ? (
          <p className="text-sm text-[#44474e]">
            Previous week:{' '}
            <span className="font-medium text-[#000a1e]">
              {format === 'percent'
                ? formatPercent(previousValue)
                : formatCompactNumber(previousValue)}
            </span>
          </p>
        ) : null}
      </div>
    </motion.div>
  )
}
