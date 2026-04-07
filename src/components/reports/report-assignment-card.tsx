import { ArrowRight, Clock3, FileLock2 } from 'lucide-react'
import { Link } from 'react-router-dom'

import { StatusBadge } from '@/components/dashboard/status-badge'
import { Button } from '@/components/ui/button'
import { formatTimestamp } from '@/lib/dates'
import { cn } from '@/lib/utils'
import type { ReportStatus } from '@/types/domain'

const stateTone: Record<ReportStatus, string> = {
  not_started: 'border-[#d4dde8] bg-[#edf1f5] text-[#44474e]',
  draft: 'border-[#cfe0f4] bg-[#edf4fb] text-[#005db6]',
  submitted: 'border-[#cfe7d9] bg-[#edf7f0] text-[#1f6b3b]',
  edited_after_submission: 'border-[#f0d9aa] bg-[#fbf4e6] text-[#8a5a00]',
  locked: 'border-[#d4dde8] bg-[#edf1f5] text-[#1d3047]',
  overdue: 'border-[#f1d1d1] bg-[#fff1f1] text-[#9d2a2a]',
}

const stateLabel: Record<ReportStatus, string> = {
  not_started: 'Ready to start',
  draft: 'Draft saved',
  submitted: 'Submitted',
  edited_after_submission: 'Changed after submit',
  locked: 'Read only',
  overdue: 'Needs attention',
}

export function ReportAssignmentCard({
  departmentName,
  templateName,
  periodLabel,
  status,
  lastUpdatedAt,
  href,
  canEdit,
}: {
  departmentName: string
  templateName: string
  periodLabel: string
  status: ReportStatus
  lastUpdatedAt?: string
  href: string
  canEdit: boolean
}) {
  return (
    <article className="group h-full rounded-[0.35rem] border border-[#d4dde8] bg-[#ffffff] p-5 transition-colors duration-200 hover:border-[#c4d0dd] hover:bg-[#fbfcfd]">
      <div className="flex h-full flex-col gap-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 space-y-2">
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#005db6]">
              {periodLabel}
            </p>
            <p className="font-display text-[1.6rem] leading-[1.02] tracking-[-0.03em] text-[#000a1e]">
              {departmentName}
            </p>
            <p className="text-sm text-[#44474e]">{templateName}</p>
          </div>
          <StatusBadge status={status} />
        </div>

        <div className="flex flex-wrap gap-2">
          <span
            className={cn(
              'rounded-[0.25rem] border px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.18em]',
              stateTone[status],
            )}
          >
            {stateLabel[status]}
          </span>
          <span className="rounded-[0.25rem] border border-[#d4dde8] bg-[#f8fafc] px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#44474e]">
            {canEdit ? 'Editable' : 'View only'}
          </span>
        </div>

        <div className="rounded-[0.35rem] bg-[#f8fafc] px-4 py-3 outline outline-1 outline-[#d9e0e7]/75">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#005db6]">
            Last update
          </p>
          <p className="mt-2 flex items-center gap-2 text-sm text-[#44474e]">
            <Clock3 className="h-4 w-4 text-[#74777f]" />
            {lastUpdatedAt ? formatTimestamp(lastUpdatedAt) : 'Not started yet'}
          </p>
        </div>

        <div className="mt-auto flex items-center justify-between gap-4 border-t border-[#e2e7ee] pt-4">
          <div className="flex items-center gap-2 text-sm text-[#44474e]">
            {status === 'locked' ? (
              <>
                <FileLock2 className="h-4 w-4 text-[#74777f]" />
                Read only
              </>
            ) : canEdit ? (
              'Editable'
            ) : (
              'View only'
            )}
          </div>

          <Button asChild size="sm">
            <Link to={href}>
              {canEdit ? 'Open report' : 'View report'}
              <ArrowRight className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-0.5" />
            </Link>
          </Button>
        </div>
      </div>
    </article>
  )
}
