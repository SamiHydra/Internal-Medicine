import { ArrowLeft } from 'lucide-react'
import { useNavigate, useParams } from 'react-router-dom'

import { ReportForm } from '@/components/reports/report-form'
import { useAppData } from '@/context/app-data-context'

/**
 * The report entry screen is reached from three places (the nurse dashboard,
 * the nurse report list, and the admin submission board), so the back control
 * steps through history rather than pointing at one fixed route. Opened from a
 * pasted link there is no history behind it, so it falls back to the list the
 * current role would have come from.
 */
function useBackTarget() {
  const navigate = useNavigate()
  const { currentUser } = useAppData()

  const isNurse = currentUser?.role === 'nurse'

  return {
    label: isNurse ? 'Back to my reports' : 'Back to submissions',
    goBack: () => {
      // React Router records a history index; above 0 means there is an in-app
      // entry behind this one to step back to.
      const index =
        (window.history.state as { idx?: number } | null)?.idx ?? 0

      if (index > 0) {
        navigate(-1)
        return
      }

      navigate(isNurse ? '/nurse/reports' : '/admin/submissions')
    },
  }
}

export function ReportFormPage() {
  const { assignmentId = '', periodId = '' } = useParams()
  const { label, goBack } = useBackTarget()

  return (
    <div className="space-y-6 px-4 py-6 md:px-6 md:py-8">
      <button
        type="button"
        onClick={goBack}
        className="group inline-flex items-center gap-2 rounded-[3px] text-sm font-semibold text-[#005db6] transition-colors hover:text-[#00468c] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#005db6]/45 focus-visible:ring-offset-2 focus-visible:ring-offset-[#f8f9fa]"
      >
        <ArrowLeft className="h-4 w-4 transition-transform duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] motion-safe:group-hover:-translate-x-0.5" />
        {label}
      </button>

      <ReportForm assignmentId={assignmentId} periodId={periodId} />
    </div>
  )
}
