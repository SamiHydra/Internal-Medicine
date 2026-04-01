import { Lightbulb } from 'lucide-react'
import { motion } from 'framer-motion'

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'

export function InsightPanel({
  title = 'What changed this week',
  description = 'Deterministic week-on-week highlights generated from reported operational data.',
  items,
}: {
  title?: string
  description?: string
  items: string[]
}) {
  return (
    <Card className="overflow-hidden border-white/10 bg-[linear-gradient(155deg,#07152d_0%,#0f4c81_44%,#0f766e_100%)] text-white shadow-[0_28px_54px_-30px_rgba(8,47,73,0.82)]">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute inset-x-6 top-0 h-1 rounded-full bg-[linear-gradient(90deg,#67e8f9_0%,#60a5fa_42%,#34d399_100%)]" />
        <div className="absolute right-[-2rem] top-10 h-28 w-28 rounded-full bg-cyan-300/10 blur-3xl" />
      </div>
      <CardHeader>
        <div className="flex items-center gap-3">
          <div className="rounded-2xl bg-white/12 p-2.5 ring-1 ring-white/10">
            <Lightbulb className="h-5 w-5 text-cyan-100" />
          </div>
          <div className="space-y-1">
            <CardTitle className="text-white">{title}</CardTitle>
            <CardDescription className="text-cyan-50/78">
              {description}
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {items.length ? (
          items.map((item, index) => (
            <motion.div
              key={`${item}-${index}`}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.04 }}
              className="rounded-2xl border border-white/10 bg-white/8 px-4 py-3 text-sm leading-6 text-slate-100 backdrop-blur-sm"
            >
              {item}
            </motion.div>
          ))
        ) : (
          <p className="text-sm text-cyan-50/78">
            No material shifts crossed the configured thresholds this week.
          </p>
        )}
      </CardContent>
    </Card>
  )
}
