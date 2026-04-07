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
      <Card className="h-full bg-[#eef2f6] shadow-none">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
        <CardContent>
          <div className="rounded-[0.35rem] bg-[#ffffff] p-3">
            {children}
          </div>
        </CardContent>
      </Card>
    </motion.div>
  )
}
