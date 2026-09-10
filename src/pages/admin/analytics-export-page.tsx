import { format as formatDate, parseISO } from 'date-fns'
import { motion } from 'framer-motion'
import { CheckCircle2, Clock3, Download, Loader2, RefreshCw, TriangleAlert } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { toast } from 'sonner'

import { SectionEmptyState } from '@/components/dashboard/section-panel'
import { ListSkeleton } from '@/components/layout/loading-skeletons'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { departments as configuredDepartments } from '@/config/templates'
import {
  fetchAnalyticsExportScope,
  fetchAnalyticsExports,
  queueAnalyticsExport,
  type AnalyticsExportRecord,
  type AnalyticsExportScope,
} from '@/lib/api/analytics'
import { getApiBrowserClient } from '@/lib/api/client'
import { cn } from '@/lib/utils'

const sectionClass =
  'overflow-hidden rounded-[0.35rem] bg-white outline outline-1 outline-[#d4dde8] shadow-[0_24px_60px_-42px_rgba(0,33,71,0.28)]'

/** Wards grouped by service line: five names appear in both families. */
const wardGroups = Object.entries(
  [...configuredDepartments]
    .sort((a, b) => a.name.localeCompare(b.name))
    .reduce<Record<string, typeof configuredDepartments>>((groups, ward) => {
      ;(groups[ward.family] ??= []).push(ward)
      return groups
    }, {}),
).sort(([a], [b]) => a.localeCompare(b))

function fileSize(bytes: number | null) {
  if (bytes === null) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function createdLabel(value: string) {
  const date = parseISO(value)
  return Number.isNaN(date.getTime()) ? '' : formatDate(date, 'MMM d, HH:mm')
}

function statusBadge(record: AnalyticsExportRecord) {
  if (record.status === 'ready') {
    return <Badge variant="success"><CheckCircle2 className="h-3 w-3" />Ready</Badge>
  }
  if (record.status === 'failed') {
    return <Badge variant="danger"><TriangleAlert className="h-3 w-3" />Failed</Badge>
  }
  return (
    <Badge variant="warning">
      <Clock3 className="h-3 w-3" />
      {record.status === 'processing' ? 'Building' : 'Queued'}
    </Badge>
  )
}

function ControlLabel({ children }: { children: ReactNode }) {
  return (
    <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-[0.13em] text-[#657180]">
      {children}
    </span>
  )
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
      <p className={cn('mt-1.5 truncate font-display text-2xl font-bold tracking-[-0.03em]', urgent ? 'text-[#ba1a1a]' : 'text-[#000a1e]')}>
        {value}
      </p>
    </div>
  )
}

export function AnalyticsExportPage() {
  const client = getApiBrowserClient()
  const [exports, setExports] = useState<AnalyticsExportRecord[]>([])
  const [scope, setScope] = useState<AnalyticsExportScope | null>(null)
  const [scopeLoading, setScopeLoading] = useState(false)
  const [loading, setLoading] = useState(Boolean(client))
  const [queueing, setQueueing] = useState(false)
  const [selectedWards, setSelectedWards] = useState<string[]>([])
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [format, setFormat] = useState<'xlsx' | 'csv'>('xlsx')
  const requestedExportIdRef = useRef<string | null>(null)
  const downloadedExportIdsRef = useRef(new Set<string>())

  const activeExport = useMemo(
    () => exports.find(({ status }) => status === 'pending' || status === 'processing') ?? null,
    [exports],
  )
  const hasActiveExport = activeExport !== null

  const loadExports = useCallback(async (silent = false) => {
    if (!client) return
    if (!silent) setLoading(true)
    try {
      setExports(await fetchAnalyticsExports(client))
    } catch {
      if (!silent) toast.error('Export history could not be loaded.')
    } finally {
      if (!silent) setLoading(false)
    }
  }, [client])

  useEffect(() => {
    void loadExports()
  }, [loadExports])

  // Poll only while something is building, so the page is quiet at rest.
  useEffect(() => {
    if (!hasActiveExport) return
    const interval = window.setInterval(() => void loadExports(true), 5000)
    return () => window.clearInterval(interval)
  }, [hasActiveExport, loadExports])

  // The selection's size, debounced: this is what makes the ceiling visible
  // before someone spends a build on a range that will be refused.
  useEffect(() => {
    if (!client) return
    let cancelled = false
    setScopeLoading(true)

    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const next = await fetchAnalyticsExportScope(client, {
            departments: selectedWards,
            dateFrom: dateFrom || null,
            dateTo: dateTo || null,
          })
          if (!cancelled) setScope(next)
        } catch {
          if (!cancelled) setScope(null)
        } finally {
          if (!cancelled) setScopeLoading(false)
        }
      })()
    }, 250)

    return () => {
      cancelled = true
      setScopeLoading(false)
      window.clearTimeout(timer)
    }
  }, [client, selectedWards, dateFrom, dateTo])

  const downloadExport = useCallback((record: AnalyticsExportRecord) => {
    if (!client || !record.downloadUrl) return
    const link = document.createElement('a')
    link.href = new URL(record.downloadUrl, client.baseUrl).toString()
    link.download = record.fileName ?? `clinical-submissions.${record.format}`
    link.hidden = true
    document.body.appendChild(link)
    link.click()
    link.remove()
  }, [client])

  useEffect(() => {
    const requestedId = requestedExportIdRef.current
    if (!requestedId) return

    const requested = exports.find(({ id }) => id === requestedId)
    if (!requested) return

    if (requested.status === 'failed') {
      requestedExportIdRef.current = null
      toast.error(requested.error ?? 'The export failed. Please try again.')
      return
    }

    if (
      requested.status !== 'ready' ||
      !requested.downloadUrl ||
      downloadedExportIdsRef.current.has(requested.id)
    ) {
      return
    }

    downloadedExportIdsRef.current.add(requested.id)
    requestedExportIdRef.current = null
    downloadExport(requested)
    toast.success('Export ready. Your download has started.')
  }, [downloadExport, exports])

  const overLimit = scope !== null && scope.reports > scope.limit
  const nothingToExport = scope !== null && scope.reports === 0

  async function build() {
    if (!client || queueing) return
    setQueueing(true)
    try {
      const queued = await queueAnalyticsExport(client, {
        format,
        departments: selectedWards,
        dateFrom: dateFrom || null,
        dateTo: dateTo || null,
      })
      requestedExportIdRef.current = queued.id
      setExports((current) => [queued, ...current.filter(({ id }) => id !== queued.id)])
      toast.success('Export queued. The download will start when it is ready.')
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'The export could not be queued.')
    } finally {
      setQueueing(false)
    }
  }

  const allWardIds = configuredDepartments.map(({ id }) => id)
  const shortDate = (value: string) => formatDate(parseISO(value), 'd MMM yyyy')
  const rangeLabel = dateFrom && dateTo
    ? `${shortDate(dateFrom)} - ${shortDate(dateTo)}`
    : dateFrom
      ? `From ${shortDate(dateFrom)}`
      : dateTo
        ? `Until ${shortDate(dateTo)}`
        : 'All time'
  const buildLabel = activeExport?.status === 'processing'
    ? 'Building'
    : hasActiveExport
      ? 'Queued'
      : 'Build export'

  return (
    <div className="space-y-4 px-4 py-5 md:px-6 md:py-8">
      <motion.section
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.24, ease: 'easeOut' }}
        className={sectionClass}
      >
        <section
          className="grid grid-cols-2 gap-px border-b border-[#e5ebf2] bg-[#e5ebf2] md:grid-cols-4"
          aria-label="Export scope"
        >
          <SummaryMetric
            label="Reports"
            value={scopeLoading || scope === null ? '-' : scope.reports.toLocaleString()}
            urgent={overLimit}
            assistiveText="Reports this selection covers"
          />
          <SummaryMetric
            label="Wards"
            value={selectedWards.length === 0 ? `All ${allWardIds.length}` : `${selectedWards.length} of ${allWardIds.length}`}
          />
          <SummaryMetric label="Range" value={rangeLabel} />
          <SummaryMetric
            label="Limit"
            value={scope === null ? '-' : scope.limit.toLocaleString()}
            assistiveText="Largest export allowed"
          />
        </section>

        <section
          className="flex flex-wrap items-end gap-3 border-b border-[#e5ebf2] bg-[#f7f9fc] px-4 py-4 md:px-5"
          aria-label="Export options"
        >
          <label className="min-w-[10rem] flex-1 sm:max-w-[13rem]">
            <ControlLabel>Format</ControlLabel>
            <Select value={format} onValueChange={(value) => setFormat(value as typeof format)}>
              <SelectTrigger className="h-10" aria-label="Export format"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="xlsx">Excel workbook</SelectItem>
                <SelectItem value="csv">CSV data</SelectItem>
              </SelectContent>
            </Select>
          </label>
          <label className="min-w-[9rem] flex-1 sm:max-w-[10.5rem]">
            <ControlLabel>From</ControlLabel>
            <Input
              type="date"
              aria-label="From"
              value={dateFrom}
              max={dateTo || undefined}
              onChange={(event) => setDateFrom(event.target.value)}
              className="h-10"
            />
          </label>
          <label className="min-w-[9rem] flex-1 sm:max-w-[10.5rem]">
            <ControlLabel>To</ControlLabel>
            <Input
              type="date"
              aria-label="To"
              value={dateTo}
              min={dateFrom || undefined}
              onChange={(event) => setDateTo(event.target.value)}
              className="h-10"
            />
          </label>
          <Button
            className="h-10 w-full whitespace-nowrap sm:ml-auto sm:w-auto"
            onClick={build}
            disabled={!client || queueing || hasActiveExport || overLimit || nothingToExport}
          >
            {queueing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            {buildLabel}
          </Button>
        </section>

        {overLimit || nothingToExport ? (
          <p
            className={cn(
              'border-b border-[#e5ebf2] px-4 py-2.5 text-sm md:px-5',
              overLimit ? 'bg-[#fceeee] text-[#9d2a2a]' : 'bg-[#fbf4e6] text-[#8a5a00]',
            )}
            role="status"
          >
            {overLimit
              ? `Over the ${scope.limit.toLocaleString()}-report limit. Narrow the wards or dates.`
              : 'Nothing was submitted in this selection.'}
          </p>
        ) : null}

        <div className="flex items-center justify-between gap-3 border-b border-[#e5ebf2] bg-white px-4 py-2.5 md:px-5">
          <span className="text-[11px] font-bold uppercase tracking-[0.13em] text-[#657180]">
            Wards
            <span className="ml-2 font-semibold tracking-normal text-[#687281]">
              {selectedWards.length || 'all'}
            </span>
          </span>
          <span className="flex gap-3">
            <button
              type="button"
              className="min-h-8 text-xs font-semibold text-[#005db6] hover:text-[#00468c]"
              onClick={() => setSelectedWards(allWardIds)}
            >
              Select all
            </button>
            <button
              type="button"
              className="min-h-8 text-xs font-semibold text-[#005db6] hover:text-[#00468c] disabled:text-[#b6bfcc]"
              onClick={() => setSelectedWards([])}
              disabled={selectedWards.length === 0}
            >
              Clear
            </button>
          </span>
        </div>

        <div className="divide-y divide-[#e5ebf2]">
          {wardGroups.map(([family, wards]) => {
            const ids = wards.map(({ id }) => id)
            const allPicked = ids.every((id) => selectedWards.includes(id))

            return (
              <section key={family} className="px-4 py-3.5 md:px-5" aria-label={`${family} wards`}>
                {/* The group action sits beside its label: floated to the far
                    right it read as unrelated to the group it acts on. */}
                <div className="flex items-center gap-2.5">
                  <span className="text-[11px] font-bold uppercase tracking-[0.13em] text-[#687281]">
                    {family}
                  </span>
                  <button
                    type="button"
                    className="min-h-8 text-xs font-semibold text-[#005db6] hover:text-[#00468c]"
                    onClick={() => setSelectedWards((current) => (
                      allPicked
                        ? current.filter((id) => !ids.includes(id))
                        : [...new Set([...current, ...ids])]
                    ))}
                  >
                    {allPicked ? 'Clear group' : 'Select group'}
                  </button>
                </div>
                {/* Chips rather than a checkbox grid: ward names are short, so
                    fixed columns left most of every row empty. */}
                <ul className="mt-2 flex flex-wrap gap-1.5">
                  {wards.map((ward) => (
                    <li key={ward.id}>
                      <label className="cursor-pointer">
                        <input
                          type="checkbox"
                          className="peer sr-only"
                          aria-label={`${ward.name} ${ward.family}`}
                          checked={selectedWards.includes(ward.id)}
                          onChange={(event) => setSelectedWards((current) => (
                            event.target.checked
                              ? [...current, ward.id]
                              : current.filter((id) => id !== ward.id)
                          ))}
                        />
                        <span className="inline-flex min-h-9 items-center rounded-[0.25rem] border border-[#d4dde8] bg-white px-3 text-sm text-[#44474e] transition-colors hover:border-[#b8c7d8] hover:bg-[#f7f9fc] peer-checked:border-[#005db6] peer-checked:bg-[#005db6] peer-checked:text-white peer-checked:hover:border-[#00468c] peer-checked:hover:bg-[#00468c] peer-focus-visible:ring-4 peer-focus-visible:ring-[#cfe1f7]">
                          {ward.name}
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              </section>
            )
          })}
        </div>
      </motion.section>

      <motion.section
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.24, ease: 'easeOut', delay: 0.05 }}
        className={sectionClass}
      >
        <div className="flex items-center justify-between gap-3 border-b border-[#e5ebf2] bg-[#f7f9fc] px-4 py-3 md:px-5">
          <span className="text-[11px] font-bold uppercase tracking-[0.13em] text-[#657180]">
            Recent exports
          </span>
          <Button variant="ghost" className="h-8" onClick={() => void loadExports()} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Refresh
          </Button>
        </div>

        {loading && exports.length === 0 ? (
          <div className="px-4 py-6 md:px-5"><ListSkeleton rows={3} /></div>
        ) : exports.length === 0 ? (
          <div className="p-4 md:p-5">
            <SectionEmptyState
              icon={<Download className="h-7 w-7" />}
              title="No exports yet"
              description="Files you build are listed here until they expire."
            />
          </div>
        ) : (
          <>
            <div className="hidden grid-cols-[120px_minmax(0,1fr)_110px_110px_110px] gap-4 border-b border-[#e5ebf2] bg-white px-5 py-2.5 text-[11px] font-bold uppercase tracking-[0.13em] text-[#657180] lg:grid">
              <span>Status</span>
              <span>Requested</span>
              <span className="text-right">Contents</span>
              <span className="text-right">Size</span>
              <span className="text-right">File</span>
            </div>
            <div className="divide-y divide-[#e5ebf2]">
              {exports.map((record) => (
                <div
                  key={record.id}
                  className="grid grid-cols-2 items-center gap-x-4 gap-y-2 px-4 py-3 md:px-5 lg:grid-cols-[120px_minmax(0,1fr)_110px_110px_110px]"
                >
                  <span>{statusBadge(record)}</span>
                  <span className="truncate text-sm text-[#1d3047]">
                    {createdLabel(record.createdAt)}
                    <span className="ml-2 text-[#666970]">{record.format === 'xlsx' ? 'Excel' : 'CSV'}</span>
                  </span>
                  <span className="text-sm tabular-nums text-[#44474e] lg:text-right">
                    {/* An Excel row is one report; a CSV row is one recorded
                        value. The same number means very different things. */}
                    {record.rowCount
                      ? `${record.rowCount.toLocaleString()} ${record.format === 'xlsx' ? 'reports' : 'values'}`
                      : '-'}
                  </span>
                  <span className="text-sm tabular-nums text-[#666970] lg:text-right">
                    {fileSize(record.byteSize) || '-'}
                  </span>
                  <span className="col-span-2 lg:col-span-1 lg:text-right">
                    {record.status === 'ready' && record.downloadUrl ? (
                      <a
                        href={new URL(record.downloadUrl, client?.baseUrl ?? window.location.origin).toString()}
                        download={record.fileName ?? `clinical-submissions.${record.format}`}
                        className="inline-flex min-h-8 items-center gap-1.5 text-sm font-semibold text-[#005db6] hover:text-[#00468c]"
                      >
                        <Download className="h-3.5 w-3.5" />
                        Download
                      </a>
                    ) : record.status === 'failed' ? (
                      <span className="text-sm text-[#ba1a1a]">{record.error ?? 'Failed'}</span>
                    ) : (
                      <span className="text-sm text-[#666970]">-</span>
                    )}
                  </span>
                </div>
              ))}
            </div>
          </>
        )}
      </motion.section>
    </div>
  )
}
