import { CloudOff, TriangleAlert } from 'lucide-react'
import { Link } from 'react-router-dom'

import { departmentMap } from '@/config/templates'
import { useAppData } from '@/context/app-data-context'

/**
 * Lists the signed-in user's offline report saves: the ones still waiting for
 * the network and the ones the server refused (which need a decision on the
 * report page). Renders nothing when the queue is empty, so it costs nothing
 * on the common path.
 */
export function OfflineSaveBanner() {
  const { queuedReportSaves, state } = useAppData()

  if (!queuedReportSaves.length) {
    return null
  }

  const conflicts = queuedReportSaves.filter((queuedSave) => queuedSave.status === 'conflict')
  const pending = queuedReportSaves.filter((queuedSave) => queuedSave.status === 'pending')

  const describe = (assignmentId: string, reportingPeriodId: string) => {
    const assignment = state.assignments.find((entry) => entry.id === assignmentId)
    const period = state.reportingPeriods.find((entry) => entry.id === reportingPeriodId)
    const departmentName = assignment
      ? departmentMap[assignment.departmentId]?.name ?? assignment.departmentId
      : 'Report'

    return `${departmentName}${period ? ` for ${period.label}` : ''}`
  }

  return (
    <section
      role="status"
      aria-live="polite"
      data-testid="offline-save-banner"
      className="rounded-[0.35rem] border border-[#edd9b0] bg-[#fcf5e8] px-4 py-3 text-sm text-[#5b3d00]"
    >
      {conflicts.length ? (
        <div className="flex items-start gap-3">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-[#c88719]" aria-hidden="true" />
          <div className="min-w-0 space-y-1">
            <p className="font-semibold">
              {conflicts.length === 1
                ? 'One offline save needs your review'
                : `${conflicts.length} offline saves need your review`}
            </p>
            <ul className="space-y-1">
              {conflicts.map((queuedSave) => (
                <li key={queuedSave.id}>
                  <Link
                    className="font-semibold text-[#005db6] underline-offset-2 hover:underline"
                    to={`/reports/${queuedSave.payload.assignmentId}/${queuedSave.payload.reportingPeriodId}`}
                  >
                    {describe(queuedSave.payload.assignmentId, queuedSave.payload.reportingPeriodId)}
                  </Link>
                  <span className="text-[#8a5a00]"> - open it to apply or discard your changes.</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}
      {pending.length ? (
        <div className={`flex items-start gap-3 ${conflicts.length ? 'mt-3' : ''}`}>
          <CloudOff className="mt-0.5 h-4 w-4 shrink-0 text-[#c88719]" aria-hidden="true" />
          <p className="min-w-0">
            <span className="font-semibold">
              {pending.length === 1
                ? 'One report save is waiting to sync'
                : `${pending.length} report saves are waiting to sync`}
            </span>
            <span className="text-[#8a5a00]">
              {' '}
              ({pending
                .map((queuedSave) =>
                  describe(queuedSave.payload.assignmentId, queuedSave.payload.reportingPeriodId),
                )
                .join('; ')}
              ). They send automatically when the connection returns.
            </span>
          </p>
        </div>
      ) : null}
    </section>
  )
}
