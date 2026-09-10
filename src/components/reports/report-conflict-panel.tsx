import { AlertTriangle, ClipboardCopy, Loader2 } from 'lucide-react'
import { toast } from 'sonner'

import { panelClass, SectionEyebrow } from '@/components/dashboard/section-panel'
import { Button } from '@/components/ui/button'
import { formatTimestamp } from '@/lib/dates'
import type { ReportConflictSnapshot } from '@/lib/api/types'
import type { QueuedSaveConflictReason } from '@/lib/offline/report-save-queue'
import { buildConflictRows, conflictRowsToText } from '@/lib/reports/conflict-rows'
import type { ReportFieldValue, ReportTemplateConfig } from '@/types/domain'

function describeConflict(
  reason: QueuedSaveConflictReason,
  message: string,
  serverReport: ReportConflictSnapshot | null,
) {
  const changedBy = serverReport?.updatedByName ? ` by ${serverReport.updatedByName}` : ''
  const changedAt = serverReport?.updatedAt ? ` on ${formatTimestamp(serverReport.updatedAt)}` : ''

  switch (reason) {
    case 'locked':
      return `This report was locked${changedBy}${changedAt} while your changes were waiting. Locked reports are read only: ask an administrator to unlock it, then apply your changes.`
    case 'exists':
      return `A report for this week was created elsewhere${changedBy}${changedAt} after you opened it. Your changes were not applied.`
    case 'stale':
      return `This report was changed elsewhere${changedBy}${changedAt} after you loaded it. Your changes were not applied.`
    case 'exhausted':
      return `These changes could not be synced after several attempts (${message}). Nothing was discarded.`
    default:
      return `The server refused these changes: ${message}`
  }
}

export function ReportConflictPanel({
  template,
  reason,
  message,
  detectedAt,
  localValues,
  serverReport,
  submitIntended,
  isApplying,
  onApply,
  onKeepServer,
}: {
  template: ReportTemplateConfig
  reason: QueuedSaveConflictReason
  message: string
  detectedAt: string | null
  localValues: Record<string, ReportFieldValue>
  serverReport: ReportConflictSnapshot | null
  submitIntended: boolean
  isApplying: boolean
  onApply: () => void
  onKeepServer: () => void
}) {
  const rows = buildConflictRows(template, localValues, serverReport?.values ?? null)
  const hasServerCopy = serverReport !== null
  const isLocked = reason === 'locked' || Boolean(serverReport?.lockedAt)

  const copyValues = async () => {
    const text = conflictRowsToText(rows)

    try {
      await navigator.clipboard.writeText(text)
      toast.success('Your values were copied to the clipboard.')
    } catch {
      toast.error('Copying is not available here. The values stay listed below.')
    }
  }

  return (
    <section
      role="region"
      aria-labelledby="report-conflict-title"
      data-testid="report-conflict-panel"
      className={`${panelClass} border-l-4 border-l-[#c88719]`}
    >
      <div className="space-y-2">
        <SectionEyebrow label="Needs your review" />
        <h2
          id="report-conflict-title"
          className="flex items-center gap-2 font-display text-[1.3rem] font-bold leading-tight tracking-[-0.02em] text-[#000a1e]"
        >
          <AlertTriangle className="h-5 w-5 text-[#c88719]" aria-hidden="true" />
          Your {submitIntended ? 'submission' : 'changes'} could not be applied
        </h2>
        <p className="max-w-2xl text-sm leading-6 text-[#5b6169]">
          {describeConflict(reason, message, serverReport)}
        </p>
        {detectedAt ? (
          <p className="text-xs text-[#666970]">Detected {formatTimestamp(detectedAt)}. Nothing has been discarded.</p>
        ) : null}
      </div>

      <div className="mt-4 overflow-x-auto">
        {rows.length ? (
          <table className="w-full min-w-[420px] border-collapse text-sm">
            <caption className="sr-only">
              Cells where your values differ from the server copy
            </caption>
            <thead>
              <tr className="text-left text-[11px] font-semibold uppercase tracking-[0.14em] text-[#666970]">
                <th scope="col" className="border-b border-[#e6ecf3] py-2 pr-3">Field</th>
                <th scope="col" className="border-b border-[#e6ecf3] py-2 pr-3">Day</th>
                <th scope="col" className="border-b border-[#e6ecf3] py-2 pr-3">Your value</th>
                {hasServerCopy ? (
                  <th scope="col" className="border-b border-[#e6ecf3] py-2">Server value</th>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.key} className="text-[#000a1e]">
                  <th scope="row" className="border-b border-[#eef2f6] py-2 pr-3 text-left font-medium">
                    {row.fieldLabel}
                  </th>
                  <td className="border-b border-[#eef2f6] py-2 pr-3">{row.dayLabel}</td>
                  <td className="border-b border-[#eef2f6] py-2 pr-3 font-semibold" data-testid="conflict-local-value">
                    {row.localValue || '-'}
                  </td>
                  {hasServerCopy ? (
                    <td className="border-b border-[#eef2f6] py-2" data-testid="conflict-server-value">
                      {row.serverValue || '-'}
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="text-sm text-[#5b6169]">
            Your values match the server copy cell for cell; only the save itself was refused.
          </p>
        )}
      </div>

      <div className="mt-5 flex flex-wrap gap-3">
        <Button onClick={onApply} disabled={isApplying} data-testid="conflict-apply">
          {isApplying ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
          {isLocked
            ? 'Try again'
            : hasServerCopy
              ? 'Apply my values over the server copy'
              : 'Try again'}
        </Button>
        <Button variant="secondary" onClick={onKeepServer} disabled={isApplying} data-testid="conflict-keep-server">
          {hasServerCopy ? 'Keep the server copy' : 'Discard my changes'}
        </Button>
        <Button variant="ghost" onClick={() => void copyValues()} disabled={!rows.length} data-testid="conflict-copy">
          <ClipboardCopy className="h-4 w-4" aria-hidden="true" />
          Copy my values
        </Button>
      </div>
    </section>
  )
}
