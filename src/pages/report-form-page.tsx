import { useParams } from 'react-router-dom'

import { ReportForm } from '@/components/reports/report-form'

export function ReportFormPage() {
  const { assignmentId = '', periodId = '' } = useParams()

  return (
    <div className="space-y-6 px-4 py-6 md:px-6 md:py-8">
      <ReportForm assignmentId={assignmentId} periodId={periodId} />
    </div>
  )
}
