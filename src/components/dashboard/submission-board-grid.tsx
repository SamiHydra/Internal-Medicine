import { Link } from 'react-router-dom'

import { StatusBadge } from '@/components/dashboard/status-badge'
import { cn } from '@/lib/utils'
import type { ReportStatus } from '@/types/domain'

const statusTone: Record<ReportStatus, string> = {
  not_started: 'bg-[linear-gradient(135deg,rgba(241,245,249,0.96),rgba(226,232,240,0.92))] text-slate-600',
  draft: 'bg-[linear-gradient(135deg,rgba(207,250,254,0.9),rgba(219,234,254,0.94))] text-cyan-900',
  submitted: 'bg-[linear-gradient(135deg,rgba(209,250,229,0.95),rgba(167,243,208,0.92))] text-emerald-900',
  edited_after_submission: 'bg-[linear-gradient(135deg,rgba(254,243,199,0.95),rgba(253,230,138,0.92))] text-amber-900',
  locked: 'bg-[linear-gradient(135deg,rgba(224,231,255,0.94),rgba(203,213,225,0.9))] text-slate-700',
  overdue: 'bg-[linear-gradient(135deg,rgba(254,226,226,0.95),rgba(254,205,211,0.92))] text-rose-900',
}

export function SubmissionBoardGrid({
  title,
  description,
  rows,
}: {
  title: string
  description: string
  rows: Array<{
    departmentName: string
    templateName: string
    statuses: Array<{
      label: string
      status: ReportStatus
      href: string
    }>
  }>
}) {
  const columnHeaders = rows[0]?.statuses.map((status) => status.label) ?? []

  return (
    <section className="relative overflow-hidden rounded-[2.5rem] border border-white/70 bg-[linear-gradient(180deg,rgba(255,255,255,0.96),rgba(242,248,255,0.82))] px-5 py-6 shadow-[0_24px_54px_-36px_rgba(15,23,42,0.22)] md:px-7">
      <div className="pointer-events-none absolute inset-0">
        <div className="login-grid-drift absolute inset-0 opacity-12" />
        <div className="login-ambient-drift absolute right-[-5%] top-[-16%] h-48 w-48 rounded-full bg-sky-200/12 blur-3xl" />
        <div className="login-line-flow absolute inset-x-6 top-0 h-1 bg-gradient-to-r from-cyan-400 via-sky-500 to-emerald-400" />
      </div>

      <div className="relative space-y-5">
        <div className="space-y-2">
          <h2 className="font-display text-3xl text-slate-950">{title}</h2>
          <p className="max-w-2xl text-sm leading-7 text-slate-600 md:text-base">{description}</p>
        </div>

        <div className="hidden gap-3 text-xs font-semibold uppercase tracking-[0.18em] text-slate-700 md:grid md:grid-cols-[minmax(180px,1.2fr)_minmax(160px,1fr)_repeat(4,minmax(120px,1fr))]">
          <span>Department</span>
          <span>Template</span>
          {columnHeaders.map((header) => (
            <span key={header}>{header}</span>
          ))}
        </div>
        <div className="space-y-0">
          {rows.map((row) => (
            <div
              key={`${row.departmentName}-${row.templateName}`}
              className="grid gap-3 border-t border-slate-200/75 py-5 transition-all first:border-t-0 hover:translate-x-0.5 md:grid-cols-[minmax(180px,1.2fr)_minmax(160px,1fr)_repeat(4,minmax(120px,1fr))]"
            >
              <div>
                <p className="font-semibold text-slate-900">{row.departmentName}</p>
                <p className="text-sm text-slate-700 md:hidden">{row.templateName}</p>
              </div>
              <p className="hidden text-sm text-slate-700 md:block">{row.templateName}</p>
              {row.statuses.map((status) => (
                <Link
                  key={`${row.departmentName}-${status.label}`}
                  to={status.href}
                  className={cn(
                    'rounded-[1.45rem] border border-white/75 bg-white/70 px-3 py-3 text-sm font-medium shadow-[0_14px_24px_-22px_rgba(15,23,42,0.24)] transition-all hover:-translate-y-0.5 hover:bg-white/90 hover:shadow-[0_20px_30px_-20px_rgba(15,23,42,0.2)]',
                    statusTone[status.status],
                  )}
                >
                  <p className="mb-2 text-[11px] uppercase tracking-[0.18em]">
                    {status.label}
                  </p>
                  <StatusBadge status={status.status} />
                </Link>
              ))}
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
