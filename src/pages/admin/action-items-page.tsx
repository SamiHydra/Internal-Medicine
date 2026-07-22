import { useCallback, useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { CheckCircle2, ClipboardList, Loader2, RotateCcw } from 'lucide-react'
import { toast } from 'sonner'

import { panelClass, SectionEmptyState, SectionEyebrow } from '@/components/dashboard/section-panel'
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

const severityLabel: Record<string, string> = {
  high: 'High',
  medium: 'Medium',
  low: 'Low',
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
      const message =
        next === 'resolved'
          ? 'Action item resolved.'
          : next === 'in_progress'
            ? 'Moved to In progress.'
            : 'Action item reopened.'
      toast.success(message)
      // The item just changed status, so under a status-specific filter it would
      // drop out of the list and look like it vanished. Follow it to its new
      // filter so it stays on screen (the filter change reloads via `load`);
      // otherwise just refresh the current view.
      if (status !== 'all' && status !== next) {
        setStatus(next)
      } else {
        load()
      }
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'Unable to update the action item.')
    } finally {
      setPendingId(null)
    }
  }

  const emptyDescription =
    status === 'all'
      ? 'No action items right now.'
      : `No ${statusLabel[status].toLowerCase()} action items right now.`

  return (
    <div className="space-y-6 px-4 py-5 md:px-6 md:py-8">
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: 'easeOut' }}
        className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
      >
        <div className="flex flex-wrap items-center gap-3">
          <SectionEyebrow label="Follow-up" />
          <span className="inline-flex items-center gap-2 rounded-full bg-[#f4f7fb] px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#44474e] outline outline-1 outline-[#e3e9f1]">
            <span
              aria-hidden
              className={cn('h-1.5 w-1.5 rounded-full', openCount > 0 ? 'bg-[#ba1a1a]' : 'bg-[#1f6b3b]')}
            />
            {openCount} open
          </span>
        </div>

        <Select value={status} onValueChange={(value) => setStatus(value as ActionItemStatus | 'all')}>
          <SelectTrigger className="h-10 w-full text-sm sm:w-[160px]" aria-label="Filter by status">
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
      </motion.div>

      {error ? (
        <div className={cn(panelClass, 'text-sm text-[#ba1a1a]')}>{error}</div>
      ) : isLoading ? (
        <div className={panelClass}>
          <ListSkeleton rows={4} />
        </div>
      ) : items.length === 0 ? (
        <SectionEmptyState
          icon={<CheckCircle2 className="h-7 w-7" />}
          title="Nothing outstanding"
          description={emptyDescription}
        />
      ) : (
        <div className="space-y-3">
          {items.map((item) => (
            <motion.article
              key={item.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.25, ease: 'easeOut' }}
              className={cn(panelClass, 'flex flex-col gap-4')}
            >
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Pill className={statusStyles[item.status]}>{statusLabel[item.status]}</Pill>
                    <Pill className={severityStyles[item.severity] ?? severityStyles.low}>
                      {severityLabel[item.severity] ?? item.severity}
                    </Pill>
                    <Pill className="bg-[#edf1f5] text-[#1d3047]">
                      {item.source === 'critical_event' ? 'Critical event' : 'Manual'}
                    </Pill>
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
