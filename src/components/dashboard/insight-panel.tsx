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
    <Card className="overflow-hidden border-0 bg-[#000a1e] text-white outline-none">
      <CardHeader>
        <div className="flex items-center gap-3">
          <div className="rounded-[0.25rem] bg-white/10 p-2.5">
            <Lightbulb className="h-5 w-5 text-[#f0b429]" />
          </div>
          <div className="space-y-1">
            <CardTitle className="text-white">{title}</CardTitle>
            <CardDescription className="text-[#c6d3e4]">
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
              className="rounded-[0.25rem] bg-white/6 px-4 py-3 text-sm leading-6 text-slate-100"
            >
              {item}
            </motion.div>
          ))
        ) : (
          <p className="text-sm text-[#c6d3e4]">
            No material shifts crossed the configured thresholds this week.
          </p>
        )}
      </CardContent>
    </Card>
  )
}
