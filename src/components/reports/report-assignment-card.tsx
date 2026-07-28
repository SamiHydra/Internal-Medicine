import { ArrowRight, Clock3 } from 'lucide-react'
import { Link } from 'react-router-dom'

import { StatusBadge } from '@/components/dashboard/status-badge'
import { Button } from '@/components/ui/button'
import { formatTimestamp } from '@/lib/dates'
import type { ReportStatus } from '@/types/domain'

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
  // Hover moves one property, the border. The card previously lifted, grew its
  // shadow, and slid its arrow at the same time, which reads as noise across a
  // grid of fourteen.
  return (
    <article className="flex h-full flex-col rounded-[0.4rem] border border-[#e3e9f1] bg-white p-4 shadow-[0_12px_30px_-26px_rgba(0,33,71,0.4)] transition-colors duration-150 hover:border-[#bcd0ea]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3
            title={departmentName}
            className="font-display text-[1.15rem] font-bold leading-[1.15] tracking-[-0.01em] text-[#000a1e] line-clamp-2 [overflow-wrap:anywhere]"
          >
            {departmentName}
          </h3>
          <p className="mt-1 truncate text-sm leading-5 text-[#45566a]">{templateName}</p>
        </div>
        <StatusBadge status={status} />
      </div>

      <p className="mt-2.5 text-[13px] font-medium leading-5 text-[#657180]">{periodLabel}</p>

      <div className="mt-auto flex items-center justify-between gap-3 border-t border-[#eef2f6] pt-3.5">
        <span className="inline-flex min-w-0 items-center gap-1.5 text-[13px] font-medium text-[#5f6d7c]">
          <Clock3 className="h-3.5 w-3.5 shrink-0 text-[#738194]" />
          <span className="truncate">
            {lastUpdatedAt ? formatTimestamp(lastUpdatedAt) : 'Not started'}
          </span>
        </span>
        <Button asChild size="sm" variant={canEdit ? 'default' : 'secondary'}>
          <Link to={href}>
            {canEdit ? 'Open' : 'View'}
            <ArrowRight className="h-4 w-4" />
          </Link>
        </Button>
      </div>
    </article>
  )
}
