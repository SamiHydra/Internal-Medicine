import { ArrowRight, Clock3, FileLock2 } from 'lucide-react'
import { Link } from 'react-router-dom'

import { StatusBadge } from '@/components/dashboard/status-badge'
import { Button } from '@/components/ui/button'
import { formatTimestamp } from '@/lib/dates'
import { cn } from '@/lib/utils'
import type { ReportStatus } from '@/types/domain'

const topLineTone: Record<ReportStatus, string> = {
  not_started: 'from-slate-300 via-slate-400 to-slate-300',
  draft: 'from-cyan-400 via-sky-500 to-blue-500',
  submitted: 'from-emerald-400 via-cyan-400 to-sky-500',
  edited_after_submission: 'from-amber-400 via-rose-400 to-fuchsia-500',
  locked: 'from-indigo-300 via-slate-400 to-cyan-400',
  overdue: 'from-amber-400 via-rose-500 to-orange-500',
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
    <article className="group relative h-full overflow-hidden rounded-[2rem] border border-white/70 bg-[linear-gradient(180deg,rgba(255,255,255,0.96),rgba(242,248,255,0.84))] p-5 shadow-[0_24px_48px_-34px_rgba(15,23,42,0.22)] transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[0_28px_56px_-34px_rgba(15,23,42,0.24)]">
      <div className="pointer-events-none absolute inset-0">
        <div className="login-grid-drift absolute inset-0 opacity-10" />
        <div className="login-ambient-drift absolute right-[-10%] top-[-12%] h-36 w-36 rounded-full bg-sky-200/12 blur-3xl" />
        <div
          className={cn(
            'absolute inset-x-5 top-0 h-1 rounded-full bg-gradient-to-r',
            topLineTone[status],
          )}
        />
      </div>

      <div className="relative flex h-full flex-col gap-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 space-y-2">
            <p className="font-display text-2xl leading-tight text-slate-950">
              {departmentName}
            </p>
            <p className="text-sm text-slate-500">{templateName}</p>
          </div>
          <StatusBadge status={status} />
        </div>

        <div className="flex flex-wrap gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
          <span className="rounded-full border border-white/80 bg-white/74 px-3 py-1.5 shadow-[0_14px_24px_-20px_rgba(15,23,42,0.15)]">
            {periodLabel}
          </span>
          <span className="rounded-full border border-white/80 bg-white/74 px-3 py-1.5 shadow-[0_14px_24px_-20px_rgba(15,23,42,0.15)]">
            {stateLabel[status]}
          </span>
        </div>

        <div className="rounded-[1.45rem] border border-slate-200/80 bg-white/74 p-4 shadow-[0_14px_24px_-22px_rgba(15,23,42,0.14)]">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-sky-700">
            Last update
          </p>
          <p className="mt-2 flex items-center gap-2 text-sm text-slate-600">
            <Clock3 className="h-4 w-4 text-slate-400" />
            {lastUpdatedAt ? formatTimestamp(lastUpdatedAt) : 'Not started yet'}
          </p>
        </div>

        <div className="mt-auto flex items-center justify-between gap-4">
          <div className="flex items-center gap-2 text-sm text-slate-500">
            {status === 'locked' ? (
              <>
                <FileLock2 className="h-4 w-4 text-slate-400" />
                Read only
              </>
            ) : canEdit ? (
              'Editable'
            ) : (
              'View only'
            )}
          </div>

          <Button asChild>
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
