import { Link } from 'react-router-dom'

import { StatusBadge } from '@/components/dashboard/status-badge'
import { cn } from '@/lib/utils'
import type { ReportStatus } from '@/types/domain'

const statusTone: Record<ReportStatus, string> = {
  not_started: 'bg-[#edf1f5] text-[#44474e]',
  draft: 'bg-[#edf4fb] text-[#00468c]',
  submitted: 'bg-[#edf7f0] text-[#1f6b3b]',
  edited_after_submission: 'bg-[#fbf4e6] text-[#8a5a00]',
  locked: 'bg-[#e7edf6] text-[#244261]',
  overdue: 'bg-[#fff1f1] text-[#9d2a2a]',
}

export function SubmissionBoardGrid({
  title,
  description,
  rows,
}: {
  title: string
  description: string
  rows: Array<{
    id?: string
    departmentName: string
    templateName: string
    assigneeName?: string
    statuses: Array<{
      label: string
      status: ReportStatus
      href: string
    }>
  }>
}) {
  const columnHeaders = rows[0]?.statuses.map((status) => status.label) ?? []

  return (
    <section className="rounded-[0.35rem] bg-[#eef2f6] px-5 py-6 md:px-7">
      <div className="space-y-5">
        <div className="space-y-2">
          <h2 className="font-display text-[1.9rem] text-[#000a1e]">{title}</h2>
          <p className="max-w-2xl text-sm leading-7 text-[#44474e] md:text-base">{description}</p>
        </div>

        <div className="hidden gap-3 bg-[#ffffff] px-4 py-3 text-[11px] font-bold uppercase tracking-[0.18em] text-[#000a1e] md:grid md:grid-cols-[minmax(180px,1.2fr)_minmax(160px,1fr)_repeat(4,minmax(120px,1fr))]">
          <span>Department</span>
          <span>Template</span>
          {columnHeaders.map((header) => (
            <span key={header}>{header}</span>
          ))}
        </div>
        <div className="space-y-0">
          {rows.map((row) => (
            <div
              key={row.id ?? `${row.departmentName}-${row.templateName}-${row.statuses[0]?.href ?? 'row'}`}
              className="grid gap-3 border-t border-[#d4dde8] py-5 transition-all first:border-t-0 md:grid-cols-[minmax(180px,1.2fr)_minmax(160px,1fr)_repeat(4,minmax(120px,1fr))]"
            >
              <div>
                <p className="font-semibold text-[#000a1e]">{row.departmentName}</p>
                {row.assigneeName ? (
                  <p className="text-sm text-[#74777f]">{row.assigneeName}</p>
                ) : null}
                <p className="text-sm text-[#44474e] md:hidden">{row.templateName}</p>
              </div>
              <p className="hidden text-sm text-[#44474e] md:block">{row.templateName}</p>
              {row.statuses.map((status) => (
                <Link
                  key={`${row.departmentName}-${status.label}`}
                  to={status.href}
                  className={cn(
                    'rounded-[0.35rem] border border-[#d4dde8] bg-[#ffffff] px-3 py-3 text-sm font-medium transition-colors hover:bg-[#f6f8fa]',
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
