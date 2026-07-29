import { useCallback, useEffect, useState } from 'react'
import { Check, ClipboardCheck, Loader2, X } from 'lucide-react'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import {
  SectionEmptyState,
  SectionHeader,
  panelClass,
} from '@/components/dashboard/section-panel'
import {
  ACTIVITY_LABELS,
  REP_SCOPE_LABELS,
  fetchMyTeachingSessions,
  recordTeachingSession,
  type RepScopeInfo,
  type TeachingSessionRecord,
} from '@/lib/api/teaching'
import { ApiError, getApiBrowserClient } from '@/lib/api/client'
import { cn } from '@/lib/utils'
import { getErrorMessage } from '@/lib/api/helpers'

function dateLabel(value: string) {
  return new Date(value).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
}

const statusVariant: Record<TeachingSessionRecord['status'], 'info' | 'success' | 'danger' | 'neutral'> = {
  pending: 'info',
  held: 'success',
  not_held: 'danger',
  cancelled: 'neutral',
}

/**
 * The student representative's ONLY page (V2 Phase 5): this week's scheduled
 * activities in their recording scope, one tap held / not held, a reason
 * required when not held. Deliberately nothing else here: reps have no
 * access to any evaluation, assessment, or score.
 */
export function RepLogPage() {
  const client = getApiBrowserClient()

  const [scope, setScope] = useState<RepScopeInfo | null>(null)
  const [sessions, setSessions] = useState<TeachingSessionRecord[] | null>(null)
  const [loadError, setLoadError] = useState<'unassigned' | 'generic' | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  // The session currently collecting a not-held reason.
  const [reasonFor, setReasonFor] = useState<string | null>(null)
  const [reason, setReason] = useState('')

  const load = useCallback(async () => {
    if (!client) {
      setSessions([])
      return
    }

    try {
      const response = await fetchMyTeachingSessions(client)
      setScope(response.scope)
      setSessions(response.data)
      setLoadError(null)
    } catch (error) {
      setScope(null)
      setSessions([])
      if (error instanceof ApiError && error.status === 403) {
        setLoadError('unassigned')
      } else {
        setLoadError('generic')
        toast.error('Unable to load your activity log.')
      }
    }
  }, [client])

  useEffect(() => {
    void load()
  }, [load])

  const record = async (session: TeachingSessionRecord, status: 'held' | 'not_held') => {
    if (!client) {
      return
    }

    if (status === 'not_held' && reasonFor !== session.id) {
      setReasonFor(session.id)
      setReason('')
      return
    }

    if (status === 'not_held' && !reason.trim()) {
      toast.error('A reason is required when the activity was not held.')
      return
    }

    setBusyId(session.id)
    try {
      await recordTeachingSession(client, session.id, {
        status,
        reason: status === 'not_held' ? reason.trim() : null,
      })
      setReasonFor(null)
      setReason('')
      await load()
    } catch (error) {
      toast.error(getErrorMessage(error, 'Unable to record the session.'))
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="space-y-6 px-4 py-6 md:px-6 md:py-8">
      <section className={panelClass}>
        <SectionHeader
          eyebrow="Teaching activity log"
          title="Was it held?"
          description={
            scope
              ? `${scope.batchLabel ?? 'Your batch'} · ${REP_SCOPE_LABELS[scope.scope]}. Record whether each scheduled activity actually happened; a reason is required when it did not.`
              : 'Record whether each scheduled activity actually happened.'
          }
        />

        {sessions === null ? (
          <div className="flex min-h-[200px] items-center justify-center text-[#74777f]">
            <Loader2 className="h-5 w-5 animate-spin" aria-label="Loading sessions" />
          </div>
        ) : loadError ? (
          <div className="mt-5">
            <SectionEmptyState
              icon={<ClipboardCheck className="h-6 w-6" />}
              title={loadError === 'unassigned' ? 'Representative assignment needed' : 'Activity log unavailable'}
              description={
                loadError === 'unassigned'
                  ? 'Your account is active, but an administrator still needs to assign your batch and representative scope.'
                  : 'The activity log could not be loaded. Refresh the page or try again shortly.'
              }
            />
          </div>
        ) : sessions.length === 0 ? (
          <div className="mt-5">
            <SectionEmptyState
              icon={<ClipboardCheck className="h-6 w-6" />}
              title="Nothing scheduled this week"
              description="Sessions appear here on the days your batch has scheduled activities. Contact your administrator if something is missing."
            />
          </div>
        ) : (
          <div className="mt-4">
            {sessions.map((session) => {
              const isToday = session.scheduledDate === new Date().toISOString().slice(0, 10)
              const decided = session.status !== 'pending'

              return (
                <div key={session.id} className="border-b border-[#eef2f6] py-3.5 last:border-b-0">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <p className={cn('text-sm font-semibold text-[#000a1e]', isToday && 'text-[#005db6]')}>
                        {ACTIVITY_LABELS[session.activityType]}
                        {session.subgroup ? ` · Subgroup ${session.subgroup}` : ''}
                      </p>
                      <p className="mt-0.5 text-[13px] leading-5 text-[#5f6670]">
                        {dateLabel(session.scheduledDate)}
                        {session.wardName ? ` · ${session.wardName}` : ''}
                        {session.status === 'not_held' && session.reason ? ` · "${session.reason}"` : ''}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {decided ? (
                        <Badge variant={statusVariant[session.status]}>
                          {session.status === 'not_held' ? 'Not held' : session.status}
                        </Badge>
                      ) : (
                        <>
                          <Button
                            size="sm"
                            disabled={busyId === session.id}
                            onClick={() => void record(session, 'held')}
                          >
                            <Check className="mr-1 h-4 w-4" /> Held
                          </Button>
                          <Button
                            size="sm"
                            variant="secondary"
                            disabled={busyId === session.id}
                            onClick={() => void record(session, 'not_held')}
                          >
                            <X className="mr-1 h-4 w-4" /> Not held
                          </Button>
                        </>
                      )}
                    </div>
                  </div>

                  {reasonFor === session.id && !decided ? (
                    <div className="mt-3 flex flex-wrap items-end gap-2">
                      <Textarea
                        value={reason}
                        onChange={(event) => setReason(event.target.value)}
                        placeholder="Why was it not held? (required)"
                        aria-label="Reason not held"
                        className="min-h-[44px] w-full max-w-md"
                        rows={1}
                      />
                      <Button
                        size="sm"
                        disabled={!reason.trim() || busyId === session.id}
                        onClick={() => void record(session, 'not_held')}
                      >
                        Save
                      </Button>
                    </div>
                  ) : null}
                </div>
              )
            })}
          </div>
        )}
      </section>
    </div>
  )
}
