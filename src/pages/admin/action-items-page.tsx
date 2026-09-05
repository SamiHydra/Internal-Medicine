import { useCallback, useEffect, useMemo, useState } from 'react'
import { format, parseISO } from 'date-fns'
import { AnimatePresence, motion } from 'framer-motion'
import { ArrowRight, ChevronLeft, ChevronRight, Plus, Search, ShieldCheck } from 'lucide-react'
import { useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'

import { AlertRulesPanel } from '@/components/action-items/alert-rules-panel'
import { ActionItemSheet } from '@/components/action-items/action-item-sheet'
import { SectionEmptyState } from '@/components/dashboard/section-panel'
import { ListSkeleton } from '@/components/layout/loading-skeletons'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { departments as configuredDepartments } from '@/config/templates'
import { useAppData } from '@/context/app-data-context'
import { fetchActionItem, fetchActionItems } from '@/lib/api/admin'
import { getApiBrowserClient } from '@/lib/api/client'
import type { ActionItem, ActionItemStatus, ActionItemSummary } from '@/lib/api/types'
import { cn } from '@/lib/utils'

type QueueStatus = ActionItemStatus | 'outstanding' | 'all'
type ActionTab = 'queue' | 'rules'

const emptySummary: ActionItemSummary = {
  open: 0,
  assigned: 0,
  inProgress: 0,
  outstanding: 0,
  highSeverity: 0,
  overdue: 0,
  oldestOpenedAt: null,
  averageResolutionHours: null,
  byDepartment: [],
}

const statusLabel: Record<ActionItemStatus, string> = {
  open: 'Open',
  assigned: 'Assigned',
  in_progress: 'In progress',
  resolved: 'Resolved',
  closed: 'Verified',
}

const statusDot: Record<ActionItemStatus, string> = {
  open: 'bg-[#ba1a1a]',
  assigned: 'bg-[#005db6]',
  in_progress: 'bg-[#b57600]',
  resolved: 'bg-[#1f6b3b]',
  closed: 'bg-[#657180]',
}

const statusText: Record<ActionItemStatus, string> = {
  open: 'text-[#9f1717]',
  assigned: 'text-[#005db6]',
  in_progress: 'text-[#815600]',
  resolved: 'text-[#1f6b3b]',
  closed: 'text-[#526171]',
}

const sectionClass =
  'overflow-hidden rounded-[0.35rem] bg-white outline outline-1 outline-[#d4dde8] shadow-[0_24px_60px_-42px_rgba(0,33,71,0.28)]'

function shortAge(value: string | null) {
  if (!value) return '-'
  const date = parseISO(value)
  if (Number.isNaN(date.getTime())) return '-'

  const minutes = Math.max(1, Math.floor((Date.now() - date.getTime()) / 60_000))
  if (minutes < 60) return `${minutes}m`
  if (minutes < 2_880) return `${Math.floor(minutes / 60)}h`
  return `${Math.floor(minutes / 1_440)}d`
}

function conciseContext(item: ActionItem) {
  if (item.source === 'critical_event' && item.observedValue !== null) {
    const operator = item.triggerOperator === 'gte' ? '>=' : item.triggerOperator === 'eq' ? '=' : '>'
    return item.triggerThreshold === null
      ? `Observed value: ${item.observedValue}`
      : `Observed ${item.observedValue} / alert ${operator} ${item.triggerThreshold}`
  }

  const description = item.description?.replace(/\s+/g, ' ').trim()
  if (!description) return 'No investigation context'
  return description.length > 112 ? `${description.slice(0, 109)}...` : description
}

function SummaryMetric({
  label,
  value,
  urgent = false,
  assistiveText,
}: {
  label: string
  value: string | number
  urgent?: boolean
  assistiveText?: string
}) {
  return (
    <div
      className="min-w-0 bg-white px-4 py-4 last:col-span-2 md:px-5 md:last:col-span-1"
      aria-label={`${label}: ${value}${assistiveText ? `. ${assistiveText}` : ''}`}
    >
      <p className="truncate text-[11px] font-bold uppercase tracking-[0.14em] text-[#657180]">{label}</p>
      <p className={cn('mt-1.5 font-display text-2xl font-bold tracking-[-0.03em]', urgent ? 'text-[#ba1a1a]' : 'text-[#000a1e]')}>
        {value}
      </p>
    </div>
  )
}

export function ActionItemsPage() {
  const client = getApiBrowserClient()
  const { state, ensureProfileDirectoryData } = useAppData()
  const [activeTab, setActiveTab] = useState<ActionTab>('queue')
  const [items, setItems] = useState<ActionItem[]>([])
  const [summary, setSummary] = useState<ActionItemSummary>(emptySummary)
  const [status, setStatus] = useState<QueueStatus>('outstanding')
  const [severity, setSeverity] = useState<'all' | 'low' | 'medium' | 'high'>('all')
  const [departmentId, setDepartmentId] = useState('all')
  const [overdueOnly, setOverdueOnly] = useState(false)
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [page, setPage] = useState(1)
  const [lastPage, setLastPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [isLoading, setIsLoading] = useState(Boolean(client))
  const [error, setError] = useState<string | null>(client ? null : 'The Laravel API is not configured.')
  const [selected, setSelected] = useState<ActionItem | null>(null)
  const [isSheetOpen, setIsSheetOpen] = useState(false)
  const [isCreating, setIsCreating] = useState(false)
  const [searchParams, setSearchParams] = useSearchParams()
  const deepLinkItemId = searchParams.get('item')
  const [handledDeepLink, setHandledDeepLink] = useState<string | null>(null)

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setPage(1)
      setDebouncedSearch(search.trim())
    }, 250)
    return () => window.clearTimeout(timer)
  }, [search])

  useEffect(() => {
    void ensureProfileDirectoryData()
  }, [ensureProfileDirectoryData])

  const load = useCallback(async () => {
    if (!client) return
    setIsLoading(true)
    try {
      const result = await fetchActionItems(client, {
        status,
        severity,
        departmentId: departmentId === 'all' ? null : departmentId,
        overdue: overdueOnly,
        search: debouncedSearch,
        page,
        perPage: 25,
      })
      setItems(result.items)
      setSummary(result.summary)
      setLastPage(result.lastPage)
      setTotal(result.total)
      setError(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to load clinical action items.')
    } finally {
      setIsLoading(false)
    }
  }, [client, status, severity, departmentId, overdueOnly, debouncedSearch, page])

  useEffect(() => {
    void load()
  }, [load])

  // Notifications link straight at one item (/admin/action-items?item=<id>).
  useEffect(() => {
    if (!client || !deepLinkItemId || handledDeepLink === deepLinkItemId) {
      return
    }
    setHandledDeepLink(deepLinkItemId)
    setActiveTab('queue')
    // A deep-linked item may already be resolved, which the default 'outstanding'
    // filter would hide - widen it so the row stays visible behind the sheet.
    setStatus('all')
    setIsCreating(false)
    setIsSheetOpen(true)
    void (async () => {
      try {
        setSelected(await fetchActionItem(client, deepLinkItemId))
      } catch (cause) {
        setIsSheetOpen(false)
        toast.error(cause instanceof Error ? cause.message : 'Unable to open that action item.')
      }
    })()
  }, [client, deepLinkItemId, handledDeepLink])

  const closeSheet = (open: boolean) => {
    setIsSheetOpen(open)
    if (!open && searchParams.has('item')) {
      const next = new URLSearchParams(searchParams)
      next.delete('item')
      setSearchParams(next, { replace: true })
      setHandledDeepLink(null)
    }
  }

  const openItem = async (item: ActionItem) => {
    if (!client) return
    setSelected(item)
    setIsCreating(false)
    setIsSheetOpen(true)
    try {
      setSelected(await fetchActionItem(client, item.id))
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'Unable to load the action details.')
    }
  }

  const refreshSelected = async () => {
    await load()
    if (client && selected) setSelected(await fetchActionItem(client, selected.id))
  }

  const managers = useMemo(
    () => state.profiles.filter((profile) => profile.active && (profile.role === 'admin' || profile.role === 'superadmin')),
    [state.profiles],
  )

  const departments = useMemo(
    () => [...configuredDepartments].sort((a, b) => a.name.localeCompare(b.name)),
    [],
  )

  return (
    <Tabs
      value={activeTab}
      onValueChange={(value) => setActiveTab(value as ActionTab)}
      className="space-y-4 px-4 py-5 md:px-6 md:py-8"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <TabsList aria-label="Action item sections">
          <TabsTrigger value="queue">Action queue</TabsTrigger>
          <TabsTrigger value="rules">Alert rules</TabsTrigger>
        </TabsList>
        {activeTab === 'queue' ? (
          <Button onClick={() => { setSelected(null); setIsCreating(true); setIsSheetOpen(true) }}>
            <Plus className="h-4 w-4" /> New action
          </Button>
        ) : null}
      </div>

      <TabsContent value="queue" className="mt-0">
        <motion.section
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.24, ease: 'easeOut' }}
          className={sectionClass}
        >
          <section
            className="grid grid-cols-2 gap-px border-b border-[#e5ebf2] bg-[#e5ebf2] md:grid-cols-5"
            aria-label="Action summary"
          >
            <SummaryMetric
              label="Outstanding"
              value={summary.outstanding}
              assistiveText={`${summary.open} open, ${summary.assigned} assigned, ${summary.inProgress} in progress`}
            />
            <SummaryMetric label="Overdue" value={summary.overdue} urgent={summary.overdue > 0} />
            <SummaryMetric label="High risk" value={summary.highSeverity} urgent={summary.highSeverity > 0} assistiveText="Outstanding high-priority actions" />
            <SummaryMetric label="Oldest" value={shortAge(summary.oldestOpenedAt)} assistiveText="Age of the oldest outstanding action" />
            <SummaryMetric label="Avg. close" value={summary.averageResolutionHours === null ? '-' : `${summary.averageResolutionHours}h`} assistiveText="Average resolution time" />
          </section>

          <section
            className="grid grid-cols-2 gap-3 border-b border-[#e5ebf2] bg-[#f7f9fc] px-4 py-4 md:px-5 xl:grid-cols-[minmax(240px,1fr)_160px_140px_200px_auto]"
            aria-label="Action item filters"
          >
            <label className="relative col-span-2 xl:col-span-1">
              <span className="sr-only">Search action items</span>
              <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-[#74777f]" />
              <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search actions" className="h-10 pl-9" />
            </label>
            <Select value={status} onValueChange={(value) => { setPage(1); setStatus(value as QueueStatus) }}>
              <SelectTrigger className="h-10" aria-label="Filter action status"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="outstanding">Outstanding</SelectItem>
                <SelectItem value="open">Open</SelectItem>
                <SelectItem value="assigned">Assigned</SelectItem>
                <SelectItem value="in_progress">In progress</SelectItem>
                <SelectItem value="resolved">Resolved</SelectItem>
                <SelectItem value="closed">Verified</SelectItem>
                <SelectItem value="all">All statuses</SelectItem>
              </SelectContent>
            </Select>
            <Select value={severity} onValueChange={(value) => { setPage(1); setSeverity(value as typeof severity) }}>
              <SelectTrigger className="h-10" aria-label="Filter severity"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All priority</SelectItem>
                <SelectItem value="high">High</SelectItem>
                <SelectItem value="medium">Medium</SelectItem>
                <SelectItem value="low">Low</SelectItem>
              </SelectContent>
            </Select>
            <Select value={departmentId} onValueChange={(value) => { setPage(1); setDepartmentId(value) }}>
              <SelectTrigger className="h-10" aria-label="Filter department"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All departments</SelectItem>
                {departments.map((department) => <SelectItem key={department.id} value={department.id}>{department.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button
              className="h-10 whitespace-nowrap"
              variant={overdueOnly ? 'default' : 'secondary'}
              onClick={() => { setPage(1); setOverdueOnly((value) => !value) }}
              aria-pressed={overdueOnly}
            >
              Overdue only
            </Button>
          </section>

          <div className="hidden grid-cols-[minmax(0,1fr)_180px_150px_36px] gap-4 border-b border-[#e5ebf2] bg-white px-5 py-2.5 text-[11px] font-bold uppercase tracking-[0.13em] text-[#657180] lg:grid">
            <span>Action</span>
            <span>Owner / department</span>
            <span>Due</span>
            <span />
          </div>

          {error ? (
            <div className="px-5 py-8 text-sm text-[#ba1a1a]">{error}</div>
          ) : isLoading ? (
            <div className="px-5 py-6"><ListSkeleton rows={5} /></div>
          ) : items.length === 0 ? (
            <div className="p-5">
              <SectionEmptyState icon={<ShieldCheck className="h-7 w-7" />} title="No matching actions" description="Change the filters to view other action items." />
            </div>
          ) : (
            <div className="divide-y divide-[#e5ebf2]">
              <AnimatePresence initial={false}>
                {items.map((item) => (
                  <motion.article
                    key={item.id}
                    layout
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    className="group grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-3 px-4 py-4 transition-colors hover:bg-[#f8fafc] md:px-5 lg:grid-cols-[minmax(0,1fr)_180px_150px_36px] lg:items-center"
                  >
                    <button type="button" className="col-span-2 min-w-0 text-left lg:col-span-1" onClick={() => void openItem(item)}>
                      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px] font-bold uppercase tracking-[0.1em]">
                        <span className={cn('inline-flex items-center gap-1.5', statusText[item.status])}>
                          <span className={cn('h-1.5 w-1.5 rounded-full', statusDot[item.status])} />
                          {statusLabel[item.status]}
                        </span>
                        <span className={item.severity === 'high' ? 'text-[#ba1a1a]' : 'text-[#657180]'}>{item.severity} priority</span>
                        {item.conditionState === 'corrected_pending_review' ? <span className="text-[#6b3fa0]">Review correction</span> : null}
                      </div>
                      <h2 className="mt-1.5 truncate font-display text-[15px] font-bold text-[#000a1e] transition-colors group-hover:text-[#005db6]">{item.title}</h2>
                      <p className="mt-1 truncate text-[13px] text-[#657180]">{conciseContext(item)}</p>
                    </button>
                    <div className="min-w-0 text-sm">
                      <p className="truncate font-semibold text-[#1d3047]">{item.assignedToName ?? item.responsibleRole ?? 'Unassigned'}</p>
                      <p className="mt-0.5 truncate text-xs text-[#74777f]">{item.departmentName ?? 'No department'}</p>
                    </div>
                    <div className="text-right text-sm lg:text-left">
                      <p className={cn('font-semibold', item.isOverdue ? 'text-[#ba1a1a]' : 'text-[#1d3047]')}>
                        {item.isOverdue ? 'Overdue' : item.dueAt ? format(parseISO(item.dueAt), 'MMM d, HH:mm') : 'No deadline'}
                      </p>
                      {item.isOverdue && item.dueAt ? <p className="mt-0.5 text-xs text-[#74777f]">{format(parseISO(item.dueAt), 'MMM d, HH:mm')}</p> : null}
                    </div>
                    <Button className="hidden lg:inline-flex" variant="ghost" size="icon" aria-label={`Open ${item.title}`} onClick={() => void openItem(item)}>
                      <ArrowRight className="h-4 w-4" />
                    </Button>
                  </motion.article>
                ))}
              </AnimatePresence>
            </div>
          )}

          <footer className="flex items-center justify-between gap-3 border-t border-[#e5ebf2] px-4 py-3 text-sm text-[#657180] md:px-5">
            <span>{total} action{total === 1 ? '' : 's'}</span>
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="icon" disabled={page <= 1} onClick={() => setPage((value) => value - 1)} aria-label="Previous page"><ChevronLeft className="h-4 w-4" /></Button>
              <span className="min-w-20 text-center">{page} / {lastPage}</span>
              <Button variant="ghost" size="icon" disabled={page >= lastPage} onClick={() => setPage((value) => value + 1)} aria-label="Next page"><ChevronRight className="h-4 w-4" /></Button>
            </div>
          </footer>
        </motion.section>
      </TabsContent>

      <TabsContent value="rules" className="mt-0"><AlertRulesPanel client={client} /></TabsContent>

      <ActionItemSheet
        open={isSheetOpen}
        onOpenChange={closeSheet}
        item={selected}
        creating={isCreating}
        client={client}
        managers={managers}
        departments={departments}
        onChanged={refreshSelected}
        onCreated={async () => { setIsSheetOpen(false); await load() }}
      />
    </Tabs>
  )
}
