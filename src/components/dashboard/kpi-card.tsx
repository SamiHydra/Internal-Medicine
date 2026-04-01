import { animate, motion, useMotionValue, useTransform } from 'framer-motion'
import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react'
import { useEffect } from 'react'

import { Card, CardContent } from '@/components/ui/card'
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
      bar: 'from-cyan-400 via-sky-500 to-blue-500',
      glow: 'bg-cyan-300/20',
      spark: '#06b6d4',
    },
    {
      bar: 'from-emerald-400 via-teal-500 to-cyan-500',
      glow: 'bg-emerald-300/20',
      spark: '#10b981',
    },
    {
      bar: 'from-fuchsia-400 via-violet-500 to-sky-500',
      glow: 'bg-fuchsia-300/16',
      spark: '#8b5cf6',
    },
    {
      bar: 'from-amber-300 via-orange-400 to-rose-500',
      glow: 'bg-amber-300/18',
      spark: '#f59e0b',
    },
  ]
  const themeIndex = label.split('').reduce((sum, char) => sum + char.charCodeAt(0), 0) % themes.length
  const theme = themes[themeIndex]
  const DeltaIcon = delta === null || delta === undefined ? Minus : delta >= 0 ? ArrowUpRight : ArrowDownRight

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ y: -6 }}
      transition={{ duration: 0.3, ease: 'easeOut' }}
    >
      <Card className="overflow-hidden border-white/80 bg-[linear-gradient(180deg,rgba(255,255,255,1),rgba(246,250,255,0.95))]">
        <CardContent className="relative space-y-4 p-5 pt-6">
          <div className={cn('pointer-events-none absolute -right-7 top-8 h-20 w-20 rounded-full blur-2xl', theme.glow)} />
          <div className={cn('pointer-events-none absolute inset-x-5 top-0 h-1 rounded-full bg-gradient-to-r', theme.bar)} />
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-700">
              {label}
            </p>
            <p className="font-display text-3xl font-semibold text-slate-950">
              <AnimatedMetric value={value} format={format} />
            </p>
          </div>
          <div
            className={cn(
              'inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold',
              delta === null || delta === undefined
                ? 'bg-slate-100 text-slate-700'
                : delta >= 0
                  ? 'bg-emerald-100/90 text-emerald-800'
                  : 'bg-rose-100 text-rose-800',
            )}
          >
            <DeltaIcon className="h-3.5 w-3.5" />
            {delta === null || delta === undefined ? 'No prior data' : `${Math.abs(delta).toFixed(0)}%`}
          </div>
        </div>
          {sparkline ? <Sparkline data={sparkline} color={theme.spark} /> : null}
        {previousValue !== undefined ? (
          <p className="text-sm text-slate-600">
            Previous week:{' '}
            <span className="font-medium text-slate-800">
              {format === 'percent'
                ? formatPercent(previousValue)
                : formatCompactNumber(previousValue)}
            </span>
          </p>
        ) : null}
        </CardContent>
      </Card>
    </motion.div>
  )
}
