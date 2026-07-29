import { format, parseISO } from 'date-fns'
import { CheckCircle2, Clock3, Download, Loader2, RefreshCw, TriangleAlert } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
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
  const hasActiveExport = useMemo(
    () => exports.some(({ status }) => status === 'pending' || status === 'processing'),
    [exports],
  )

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

  async function queueExport() {
    if (!client || queueing) return

    setQueueing(true)
    try {
      const queued = await queueFullHistoryAnalyticsExport(client)
      setExports((current) => [queued, ...current.filter(({ id }) => id !== queued.id)])
      setHistoryOpen(true)
      toast.success('Full-history CSV queued. You can leave this page while it builds.')
    } catch {
      toast.error('The full-history export could not be queued.')
    } finally {
      setQueueing(false)
    }
  }

  return (
    <div className="w-full shrink-0 sm:w-[21rem]">
      <Button
        type="button"
        variant="secondary"
        onClick={queueExport}
        disabled={!client || queueing || hasActiveExport}
        className="h-10 w-full border border-[#d7e0ea] bg-white px-4 shadow-none transition-colors hover:border-[#b8c7d8] hover:bg-[#f8fafc]"
      >
        {queueing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
        {hasActiveExport ? 'Full-history export queued' : 'Export full history'}
      </Button>
      <button
        type="button"
        className="mt-2 inline-flex min-h-8 items-center gap-1.5 text-xs font-semibold text-[#005db6] hover:text-[#00468c]"
        onClick={() => setHistoryOpen((open) => !open)}
        aria-expanded={historyOpen}
      >
        Export history
        {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
      </button>

      {historyOpen ? (
        <div className="mt-2 max-h-64 overflow-y-auto rounded-md border border-[#dce3eb] bg-[#f8fafc] p-2 text-left">
          {exports.length === 0 && !loading ? (
            <p className="px-2 py-3 text-xs text-[#64748b]">No exports have been requested yet.</p>
          ) : (
            <ul className="space-y-1.5">
              {exports.map((exportRecord) => (
                <li key={exportRecord.id} className="rounded border border-[#e3e8ef] bg-white p-2.5">
                  <div className="flex items-center justify-between gap-2">
                    {statusBadge(exportRecord)}
                    <span className="text-[11px] text-[#64748b]">{createdLabel(exportRecord.createdAt)}</span>
                  </div>
                  {exportRecord.status === 'ready' && exportRecord.downloadUrl ? (
                    <a
                      href={`${client?.baseUrl ?? ''}${exportRecord.downloadUrl}`}
                      className="mt-2 inline-flex min-h-8 items-center gap-1.5 text-xs font-semibold text-[#005db6] hover:text-[#00468c]"
                    >
                      <Download className="h-3.5 w-3.5" />
                      Download CSV
                      <span className="font-normal text-[#64748b]">
                        {exportRecord.rowCount.toLocaleString()} rows
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
        </div>
      ) : null}
    </div>
  )
}
