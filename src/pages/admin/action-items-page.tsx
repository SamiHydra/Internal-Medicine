import { useCallback, useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { CheckCircle2, ClipboardList, Loader2, RotateCcw } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { ListSkeleton } from '@/components/layout/loading-skeletons'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { fetchActionItems, updateActionItem } from '@/lib/api/admin'
import { getApiBrowserClient } from '@/lib/api/client'
import { apiEnvSetupHint } from '@/lib/api/env'
import type { ActionItem, ActionItemStatus } from '@/lib/api/types'
import { formatTimestamp } from '@/lib/dates'
import { cn } from '@/lib/utils'

const sectionClass =
  'rounded-[0.35rem] bg-white px-5 py-6 outline outline-1 outline-[#d4dde8] shadow-[0_24px_60px_-42px_rgba(0,33,71,0.28)] md:px-6 md:py-7'

const statusStyles: Record<ActionItemStatus, string> = {
  open: 'bg-[#fdecec] text-[#ba1a1a] outline-[#f4cfcf]',
  in_progress: 'bg-[#fcf5e8] text-[#8a5a00] outline-[#edd9b0]',
  resolved: 'bg-[#edf7f0] text-[#1f6b3b] outline-[#cfe7d9]',
}

const statusLabel: Record<ActionItemStatus, string> = {
  open: 'Open',
  in_progress: 'In progress',
  resolved: 'Resolved',
}

const severityStyles: Record<string, string> = {
  high: 'bg-[#fdecec] text-[#ba1a1a]',
  medium: 'bg-[#fcf5e8] text-[#8a5a00]',
  low: 'bg-[#eef2f6] text-[#44474e]',
}

const filterOptions: { value: ActionItemStatus | 'all'; label: string }[] = [
  { value: 'open', label: 'Open' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'all', label: 'All' },
]

function Pill({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] outline outline-1 outline-transparent',
        className,
      )}
    >
      {children}
    </span>
  )
}

export function ActionItemsPage() {
  const client = getApiBrowserClient()
  const [items, setItems] = useState<ActionItem[]>([])
  const [openCount, setOpenCount] = useState(0)
  const [status, setStatus] = useState<ActionItemStatus | 'all'>('open')
  const [isLoading, setIsLoading] = useState(Boolean(client))
  const [error, setError] = useState<string | null>(
    client ? null : `The Laravel API is not configured. ${apiEnvSetupHint}`,
  )
  const [pendingId, setPendingId] = useState<string | null>(null)

  const load = useCallback(() => {
    if (!client) {
      return
    }

    setIsLoading(true)
    fetchActionItems(client, status)
      .then((result) => {
        setItems(result.items)
        setOpenCount(result.openCount)
        setError(null)
      })
      .catch((cause) => setError(cause instanceof Error ? cause.message : 'Unable to load action items.'))
      .finally(() => setIsLoading(false))
  }, [client, status])

  useEffect(() => {
    load()
  }, [load])

  const transition = async (item: ActionItem, next: ActionItemStatus) => {
    if (!client) {
      return
    }

    setPendingId(item.id)
    try {
      await updateActionItem(client, item.id, { status: next })
      toast.success(next === 'resolved' ? 'Action item resolved.' : 'Action item updated.')
      load()
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'Unable to update the action item.')
    } finally {
      setPendingId(null)
    }
  }

  return (
    <div className="space-y-6">
      <motion.section
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: 'easeOut' }}
        className={sectionClass}
      >
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span aria-hidden className="h-3 w-[3px] rounded-full bg-[#f0b429]" />
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#005db6]">Follow-up</p>
            </div>
            <p className="mt-2 max-w-xl text-sm leading-6 text-[#5b6169]">
              Critical events automatically open a tracked follow-up here. Drive each one to resolution —
              something a spreadsheet can never do.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <Pill className="bg-[#fdecec] text-[#ba1a1a]">{openCount} open</Pill>
            <Select value={status} onValueChange={(value) => setStatus(value as ActionItemStatus | 'all')}>
              <SelectTrigger className="w-[160px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {filterOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </motion.section>

      {error ? (
        <div className={cn(sectionClass, 'text-sm text-[#ba1a1a]')}>{error}</div>
      ) : isLoading ? (
        <div className={sectionClass}>
          <ListSkeleton rows={4} />
        </div>
      ) : items.length === 0 ? (
        <div className={cn(sectionClass, 'flex flex-col items-center gap-3 py-12 text-center')}>
          <CheckCircle2 className="h-8 w-8 text-[#1f6b3b]" />
          <p className="text-sm font-semibold text-[#000a1e]">Nothing outstanding</p>
          <p className="max-w-sm text-sm text-[#74777f]">
            No {status === 'all' ? '' : statusLabel[status as ActionItemStatus].toLowerCase()} action items right now.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((item) => (
            <motion.article
              key={item.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.25, ease: 'easeOut' }}
              className={cn(sectionClass, 'flex flex-col gap-4')}
            >
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Pill className={statusStyles[item.status]}>{statusLabel[item.status]}</Pill>
                    <Pill className={severityStyles[item.severity] ?? severityStyles.low}>{item.severity}</Pill>
                    {item.source === 'critical_event' ? (
                      <Pill className="bg-[#edf1f5] text-[#1d3047]">Critical event</Pill>
                    ) : (
                      <Pill className="bg-[#edf1f5] text-[#1d3047]">Manual</Pill>
                    )}
                  </div>
                  <h2 className="flex items-center gap-2 font-display text-base font-bold text-[#000a1e]">
                    <ClipboardList className="h-4 w-4 shrink-0 text-[#005db6]" />
                    {item.title}
                  </h2>
                  {item.description ? (
                    <p className="text-sm leading-6 text-[#5b6169]">{item.description}</p>
                  ) : null}
                  <p className="text-xs text-[#74777f]">
                    {item.departmentName ? `${item.departmentName} · ` : ''}
                    Opened {item.createdAt ? formatTimestamp(item.createdAt) : 'recently'}
                    {item.status === 'resolved' && item.resolvedByName
                      ? ` · Resolved by ${item.resolvedByName}`
                      : ''}
                  </p>
                </div>

                <div className="flex flex-wrap gap-2">
                  {item.status !== 'in_progress' && item.status !== 'resolved' ? (
                    <Button
                      variant="secondary"
                      disabled={pendingId === item.id}
                      onClick={() => void transition(item, 'in_progress')}
                    >
                      {pendingId === item.id ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                      Start
                    </Button>
                  ) : null}
                  {item.status !== 'resolved' ? (
                    <Button
                      disabled={pendingId === item.id}
                      onClick={() => void transition(item, 'resolved')}
                    >
                      {pendingId === item.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                      Resolve
                    </Button>
                  ) : (
                    <Button
                      variant="secondary"
                      disabled={pendingId === item.id}
                      onClick={() => void transition(item, 'open')}
                    >
                      {pendingId === item.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
                      Reopen
                    </Button>
                  )}
                </div>
              </div>
            </motion.article>
          ))}
        </div>
      )}
    </div>
  )
}
