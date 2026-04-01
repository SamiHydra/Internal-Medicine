import { useParams } from 'react-router-dom'

import { ReportForm } from '@/components/reports/report-form'

export function ReportFormPage() {
  const { assignmentId = '', periodId = '' } = useParams()

  return (
    <div className="space-y-8">
      <ReportForm assignmentId={assignmentId} periodId={periodId} />
    </div>
  )
}
