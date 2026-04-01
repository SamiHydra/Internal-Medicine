import { motion } from 'framer-motion'
import type { ReactNode } from 'react'

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'

export function ChartCard({
  title,
  description,
  children,
}: {
  title: string
  description: string
  children: ReactNode
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: 'easeOut' }}
      className="h-full"
    >
      <Card className="h-full bg-[linear-gradient(180deg,rgba(255,255,255,0.96),rgba(240,247,255,0.92))]">
        <div className="pointer-events-none absolute inset-x-6 top-0 h-1 rounded-full bg-[linear-gradient(90deg,#22d3ee_0%,#3b82f6_42%,#10b981_100%)]" />
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
        <CardContent>
          <div className="rounded-[1.75rem] border border-white/80 bg-[linear-gradient(180deg,rgba(255,255,255,0.72),rgba(236,245,255,0.72))] p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.8)]">
            {children}
          </div>
        </CardContent>
      </Card>
    </motion.div>
  )
}
