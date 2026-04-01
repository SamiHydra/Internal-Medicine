import { AlertTriangle, CheckCircle2, Clock3, FileLock2, PencilLine } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import type { ReportStatus } from '@/types/domain'

const statusConfig: Record<
  ReportStatus,
  {
    label: string
    variant: 'neutral' | 'info' | 'success' | 'warning' | 'danger'
    icon: typeof Clock3
  }
> = {
  not_started: {
    label: 'Not Started',
    variant: 'neutral',
    icon: Clock3,
  },
  draft: {
    label: 'Draft',
    variant: 'info',
    icon: PencilLine,
  },
  submitted: {
    label: 'Submitted',
    variant: 'success',
    icon: CheckCircle2,
  },
  edited_after_submission: {
    label: 'Edited After Submission',
    variant: 'warning',
    icon: PencilLine,
  },
  locked: {
    label: 'Locked',
    variant: 'neutral',
    icon: FileLock2,
  },
  overdue: {
    label: 'Overdue',
    variant: 'danger',
    icon: AlertTriangle,
  },
}

export function StatusBadge({ status }: { status: ReportStatus }) {
  const config = statusConfig[status]
  const Icon = config.icon

  return (
    <Badge variant={config.variant}>
      <Icon className="h-3 w-3" />
      {config.label}
    </Badge>
  )
}
