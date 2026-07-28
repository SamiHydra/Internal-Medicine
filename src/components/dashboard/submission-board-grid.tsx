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
  overdue: 'bg-[#fceeee] text-[#ba1a1a]',
}

export function SubmissionBoardGrid({
  eyebrow = 'Reporting board',
  title,
  description,
  rows,
}: {
  eyebrow?: string
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
  return (
    <section className="rounded-[0.35rem] bg-white px-5 py-6 outline outline-1 outline-[#d4dde8] shadow-[0_24px_60px_-42px_rgba(0,33,71,0.28)] md:px-6 md:py-7">
      <div className="space-y-5">
        <div className="border-b border-[#eef2f6] pb-5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#005db6]">
            {eyebrow}
          </p>
          <h2 className="mt-2 font-display text-[1.4rem] font-bold tracking-[-0.02em] text-[#000a1e] md:text-[1.6rem]">
            {title}
          </h2>
          <p className="mt-1.5 max-w-2xl text-sm leading-6 text-[#74777f]">{description}</p>
        </div>

        {/* Each row is an info column + a self-labeled grid of weekly status cards.
            Cards carry their own week label, so no global week-column header is needed. */}
        <div className="hidden gap-5 px-1 text-xs font-bold uppercase tracking-[0.12em] text-[#526171] md:grid md:grid-cols-[minmax(190px,250px)_1fr]">
          <span>Department</span>
          <span>Reporting weeks · newest first</span>
        </div>
        <div className="space-y-0">
          {rows.map((row) => (
            <div
              key={row.id ?? `${row.departmentName}-${row.templateName}-${row.statuses[0]?.href ?? 'row'}`}
              className="grid gap-4 border-t border-[#eef2f6] py-5 first:border-t-0 md:grid-cols-[minmax(190px,250px)_1fr] md:gap-5"
            >
              <div className="min-w-0">
                <p className="font-semibold text-[#000a1e]">{row.departmentName}</p>
                {row.assigneeName ? (
                  <p className="text-sm text-[#74777f]">{row.assigneeName}</p>
                ) : null}
                <p className="mt-1 text-sm text-[#44474e]">{row.templateName}</p>
              </div>
              {/* Phones scroll each department's weeks sideways. Wrapping them
                  instead stacked ~150 rows of cards on a 390px screen and made
                  this section 15,000px tall on its own. */}
              <div className="-mx-1 flex snap-x snap-mandatory gap-3 overflow-x-auto px-1 pb-1 [-ms-overflow-style:none] [scrollbar-width:none] sm:mx-0 sm:grid sm:snap-none sm:grid-cols-3 sm:overflow-visible sm:px-0 sm:pb-0 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 [&::-webkit-scrollbar]:hidden">
                {row.statuses.map((status) => (
                  <Link
                    key={`${row.departmentName}-${status.label}`}
                    to={status.href}
                    className={cn(
                      'w-[8.5rem] shrink-0 snap-start rounded-[0.4rem] border border-[#e6ecf3] px-3 py-3 text-sm font-medium transition-[transform,border-color] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] hover:border-[#bcd0ea] motion-safe:active:scale-[0.98] sm:w-auto sm:shrink',
                      statusTone[status.status],
                    )}
                  >
                    <p className="mb-2 text-[11px] uppercase tracking-[0.18em] opacity-80">
                      {status.label}
                    </p>
                    <StatusBadge status={status.status} />
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
