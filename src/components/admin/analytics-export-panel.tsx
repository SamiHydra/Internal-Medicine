import { format, parseISO } from 'date-fns'
import { CheckCircle2, Clock3, Download, Loader2, RefreshCw, TriangleAlert } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  fetchAnalyticsExports,
  queueFullHistoryAnalyticsExport,
  type AnalyticsExportRecord,
} from '@/lib/api/analytics'
import { getApiBrowserClient } from '@/lib/api/client'

function fileSize(bytes: number | null) {
  if (bytes === null) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function createdLabel(value: string) {
  const date = parseISO(value)
  return Number.isNaN(date.getTime()) ? '' : format(date, 'MMM d, HH:mm')
}

function statusBadge(exportRecord: AnalyticsExportRecord) {
  if (exportRecord.status === 'ready') {
    return (
      <Badge variant="success">
        <CheckCircle2 className="h-3 w-3" />
        Ready
      </Badge>
    )
  }

  if (exportRecord.status === 'failed') {
    return (
      <Badge variant="danger">
        <TriangleAlert className="h-3 w-3" />
        Failed
      </Badge>
    )
  }

  return (
    <Badge variant="warning">
      <Clock3 className="h-3 w-3" />
      {exportRecord.status === 'processing' ? 'Building' : 'Queued'}
    </Badge>
  )
}

export function AnalyticsExportPanel() {
  const client = getApiBrowserClient()
  const [exports, setExports] = useState<AnalyticsExportRecord[]>([])
  const [loading, setLoading] = useState(Boolean(client))
  const [queueing, setQueueing] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const requestedExportIdRef = useRef<string | null>(null)
  const downloadedExportIdsRef = useRef(new Set<string>())
  const exportPanelRef = useRef<HTMLDivElement>(null)
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

  useEffect(() => {
    if (!hasActiveExport) return

    const interval = window.setInterval(() => {
      void loadExports(true)
    }, 5000)

    return () => window.clearInterval(interval)
  }, [hasActiveExport, loadExports])

  useEffect(() => {
    if (!historyOpen) return

    const closeOnOutsideClick = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !exportPanelRef.current?.contains(event.target)
      ) {
        setHistoryOpen(false)
      }
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setHistoryOpen(false)
      }
    }

    document.addEventListener('pointerdown', closeOnOutsideClick)
    document.addEventListener('keydown', closeOnEscape)

    return () => {
      document.removeEventListener('pointerdown', closeOnOutsideClick)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [historyOpen])

  const downloadExport = useCallback((exportRecord: AnalyticsExportRecord) => {
    if (!client || !exportRecord.downloadUrl) return

    const link = document.createElement('a')
    link.href = new URL(exportRecord.downloadUrl, client.baseUrl).toString()
    link.download =
      exportRecord.fileName ??
      `clinical-submissions-full-history.${exportRecord.format}`
    link.hidden = true
    document.body.appendChild(link)
    link.click()
    link.remove()
  }, [client])

  useEffect(() => {
    const requestedExportId = requestedExportIdRef.current
    if (!requestedExportId) return

    const requestedExport = exports.find(({ id }) => id === requestedExportId)
    if (!requestedExport) return

    if (requestedExport.status === 'failed') {
      requestedExportIdRef.current = null
      toast.error(requestedExport.error ?? 'The Excel export failed. Please try again.')
      return
    }

    if (
      requestedExport.status !== 'ready' ||
      !requestedExport.downloadUrl ||
      downloadedExportIdsRef.current.has(requestedExport.id)
    ) {
      return
    }

    downloadedExportIdsRef.current.add(requestedExport.id)
    requestedExportIdRef.current = null
    downloadExport(requestedExport)
    toast.success('Excel export ready. Your download has started.')
  }, [downloadExport, exports])

  async function queueExport() {
    if (!client || queueing) return

    setQueueing(true)
    try {
      const queued = await queueFullHistoryAnalyticsExport(client)
      requestedExportIdRef.current = queued.id
      setExports((current) => [queued, ...current.filter(({ id }) => id !== queued.id)])
      toast.success('Full-history Excel export queued. The download will start when it is ready.')
    } catch {
      toast.error('The full-history export could not be queued.')
    } finally {
      setQueueing(false)
    }
  }

  return (
    <div ref={exportPanelRef} className="relative w-full shrink-0 sm:w-[21rem]">
      <Button
        type="button"
        variant="secondary"
        onClick={queueExport}
        disabled={!client || queueing || hasActiveExport}
        className="h-10 w-full border border-[#d7e0ea] bg-white px-4 shadow-none transition-colors hover:border-[#b8c7d8] hover:bg-[#f8fafc]"
      >
        {queueing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
        {activeExport?.status === 'processing'
          ? 'Building Excel export'
          : hasActiveExport
            ? 'Excel export queued'
            : 'Export full history to Excel'}
      </Button>
      <button
        type="button"
        className="mt-2 inline-flex min-h-8 items-center gap-1.5 text-xs font-semibold text-[#005db6] hover:text-[#00468c]"
        onClick={() => setHistoryOpen((open) => !open)}
        aria-expanded={historyOpen}
      >
        Recent exports
        {exports.length > 0 ? (
          <span className="rounded-full bg-[#edf4fb] px-1.5 py-0.5 text-[10px] text-[#005db6]">
            {exports.length}
          </span>
        ) : null}
        {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
      </button>

      {historyOpen ? (
        <div className="absolute right-0 top-full z-[80] mt-2 w-[min(24rem,calc(100vw-2rem))] overflow-hidden rounded-lg border border-[#dce3eb] bg-white text-left shadow-[0_22px_55px_-28px_rgba(0,33,71,0.45)]">
          {exports.length === 0 && !loading ? (
            <p className="px-2 py-3 text-xs text-[#64748b]">No exports have been requested yet.</p>
          ) : (
            <ul className="max-h-[22rem] space-y-1.5 overflow-y-auto bg-[#f8fafc] p-2">
              {exports.map((exportRecord) => (
                <li key={exportRecord.id} className="rounded border border-[#e3e8ef] bg-white p-2.5">
                  <div className="flex items-center justify-between gap-2">
                    {statusBadge(exportRecord)}
                    <span className="text-[11px] text-[#64748b]">{createdLabel(exportRecord.createdAt)}</span>
                  </div>
                  {exportRecord.status === 'ready' && exportRecord.downloadUrl ? (
                    <a
                      href={new URL(exportRecord.downloadUrl, client?.baseUrl ?? window.location.origin).toString()}
                      download={
                        exportRecord.fileName ??
                        `clinical-submissions-full-history.${exportRecord.format}`
                      }
                      className="mt-2 inline-flex min-h-8 items-center gap-1.5 text-xs font-semibold text-[#005db6] hover:text-[#00468c]"
                    >
                      <Download className="h-3.5 w-3.5" />
                      {exportRecord.format === 'xlsx'
                        ? 'Excel workbook'
                        : 'Raw CSV data'}
                      <span className="font-normal text-[#64748b]">
                        {exportRecord.rowCount.toLocaleString()}{' '}
                        {exportRecord.format === 'xlsx'
                          ? 'reports'
                          : 'data rows'}
                        {exportRecord.byteSize === null ? '' : ` · ${fileSize(exportRecord.byteSize)}`}
                      </span>
                    </a>
                  ) : null}
                  {exportRecord.status === 'failed' ? (
                    <p className="mt-2 text-xs text-[#9d2a2a]">
                      {exportRecord.error ?? 'The export failed. Please try again.'}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          <p className="border-t border-[#e7ecf2] bg-white px-3 py-2.5 text-[11px] leading-4 text-[#64748b]">
            Excel is ZIP-compressed. CSV is uncompressed plain text, so its
            file is much larger even though both cover the full history.
          </p>
        </div>
      ) : null}
    </div>
  )
}
