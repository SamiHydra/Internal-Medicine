import { useCallback, useEffect, useMemo, useState } from 'react'
import { Plus, Sunrise, X } from 'lucide-react'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { SectionHeader, panelClass } from '@/components/dashboard/section-panel'
import { useAppData } from '@/context/app-data-context'
import {
  cancelMorningSession,
  createMorningOverride,
  deleteMorningOverride,
  fetchMorningConfig,
  fetchMorningOverrides,
  fetchMorningSessions,
  updateMorningRecorders,
  type MorningRosterOverrideRecord,
  type MorningSessionRecord,
} from '@/lib/api/morning'
import { getApiBrowserClient } from '@/lib/api/client'

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback
}

const statusVariant: Record<MorningSessionRecord['status'], 'info' | 'success' | 'neutral'> = {
  pending: 'info',
  recorded: 'success',
  cancelled: 'neutral',
}

/**
 * Admin oversight of morning sessions (V2 Phase 6): the recent log
 * (punctuality, attendance counts, not-recorded and cancelled sessions),
 * cancellation with a reason, the designated recorders, and the roster
 * include/exclude overrides.
 */
export function MorningSessionsPanel() {
  const client = getApiBrowserClient()
  const { state, ensureProfileDirectoryData } = useAppData()

  const [sessions, setSessions] = useState<MorningSessionRecord[] | null>(null)
  const [overrides, setOverrides] = useState<MorningRosterOverrideRecord[]>([])
  const [recorderIds, setRecorderIds] = useState<string[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [cancelDraft, setCancelDraft] = useState({ sessionId: '', reason: '' })
  const [overrideDraft, setOverrideDraft] = useState({
    userId: '',
    action: 'exclude' as 'include' | 'exclude',
    startsOn: '',
    endsOn: '',
  })
  const [newRecorderId, setNewRecorderId] = useState('')

  const load = useCallback(async () => {
    if (!client) {
      setSessions([])
      return
    }

    try {
      const [sessionData, overrideData, config] = await Promise.all([
        fetchMorningSessions(client),
        fetchMorningOverrides(client),
        fetchMorningConfig(client),
      ])
      setSessions(sessionData)
      setOverrides(overrideData)
      setRecorderIds(config.morningRecorderIds)
    } catch {
      setSessions([])
      toast.error('Unable to load the morning sessions.')
    }
  }, [client])

  useEffect(() => {
    void load()
    void ensureProfileDirectoryData()
  }, [load, ensureProfileDirectoryData])

  const academicPeople = useMemo(
    () =>
      state.profiles
        .filter((profile) => (profile.role === 'resident' || profile.role === 'consultant') && profile.active)
        .sort((a, b) => a.fullName.localeCompare(b.fullName)),
    [state.profiles],
  )

  const nameFor = (userId: string) =>
    state.profiles.find((profile) => profile.id === userId)?.fullName ?? userId

  const run = async (key: string, action: () => Promise<void>, failure: string) => {
    if (!client) {
      return
    }
    setBusy(key)
    try {
      await action()
    } catch (error) {
      toast.error(errorMessage(error, failure))
    } finally {
      setBusy(null)
    }
  }

  if (sessions === null) {
    return null
  }

  return (
    <section className={panelClass}>
      <SectionHeader
        eyebrow="Morning sessions"
        title="Punctuality & attendance log"
        description="One department-wide session on the configured days, measured against the fixed start. A pending past session means it was never recorded - a signal, not an error."
      />

      {/* ---- Recorders ---- */}
      <div className="mt-5 rounded-[0.4rem] border border-[#eef2f6] bg-[#f8fafc] p-4">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#74777f]">
          Designated recorders
        </p>
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          {recorderIds.length === 0 ? (
            <p className="text-sm text-[#74777f]">
              Nobody is designated yet: appoint one standing recorder below.
            </p>
          ) : (
            recorderIds.map((recorderId) => (
              <span
                key={recorderId}
                className="inline-flex items-center gap-1.5 rounded-[0.25rem] border border-[#d4dde8] bg-white px-2.5 py-1 text-xs font-medium text-[#44474e]"
              >
                {nameFor(recorderId)}
                <button
                  type="button"
                  aria-label={`Remove recorder ${nameFor(recorderId)}`}
                  className="text-[#ba1a1a] hover:text-[#7f1212]"
                  onClick={() =>
                    void run(
                      'recorders',
                      async () => {
                        const next = recorderIds.filter((id) => id !== recorderId)
                        await updateMorningRecorders(client!, next)
                        setRecorderIds(next)
                      },
                      'Unable to update the recorders.',
                    )
                  }
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </span>
            ))
          )}
          <Select value={newRecorderId} onValueChange={setNewRecorderId}>
            <SelectTrigger className="w-[220px]" aria-label="Add recorder">
              <SelectValue placeholder="Add a recorder" />
            </SelectTrigger>
            <SelectContent>
              {academicPeople
                .filter((person) => !recorderIds.includes(person.id))
                .map((person) => (
                  <SelectItem key={person.id} value={person.id}>
                    {person.fullName}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
          <Button
            size="sm"
            variant="secondary"
            disabled={!newRecorderId || busy === 'recorders'}
            onClick={() =>
              void run(
                'recorders',
                async () => {
                  const next = [...recorderIds, newRecorderId]
                  await updateMorningRecorders(client!, next)
                  setRecorderIds(next)
                  setNewRecorderId('')
                },
                'Unable to update the recorders.',
              )
            }
          >
            <Plus className="mr-1 h-4 w-4" /> Appoint
          </Button>
        </div>
      </div>

      {/* ---- Roster overrides ---- */}
      <div className="mt-4 rounded-[0.4rem] border border-[#eef2f6] bg-[#f8fafc] p-4">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#74777f]">
          Roster overrides
        </p>
        <div className="mt-2.5 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-5">
          <Select
            value={overrideDraft.userId}
            onValueChange={(userId) => setOverrideDraft((prev) => ({ ...prev, userId }))}
          >
            <SelectTrigger aria-label="Override person">
              <SelectValue placeholder="Person" />
            </SelectTrigger>
            <SelectContent>
              {academicPeople.map((person) => (
                <SelectItem key={person.id} value={person.id}>
                  {person.fullName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={overrideDraft.action}
            onValueChange={(action) =>
              setOverrideDraft((prev) => ({ ...prev, action: action as 'include' | 'exclude' }))
            }
          >
            <SelectTrigger aria-label="Override action">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="exclude">Exclude from roster</SelectItem>
              <SelectItem value="include">Include on roster</SelectItem>
            </SelectContent>
          </Select>
          <Input
            type="date"
            value={overrideDraft.startsOn}
            aria-label="Override from"
            onChange={(event) => setOverrideDraft((prev) => ({ ...prev, startsOn: event.target.value }))}
          />
          <Input
            type="date"
            value={overrideDraft.endsOn}
            aria-label="Override until (optional)"
            onChange={(event) => setOverrideDraft((prev) => ({ ...prev, endsOn: event.target.value }))}
          />
          <Button
            size="sm"
            disabled={!overrideDraft.userId || !overrideDraft.startsOn || busy === 'override-create'}
            onClick={() =>
              void run(
                'override-create',
                async () => {
                  await createMorningOverride(client!, {
                    userId: overrideDraft.userId,
                    action: overrideDraft.action,
                    startsOn: overrideDraft.startsOn,
                    endsOn: overrideDraft.endsOn || null,
                  })
                  setOverrideDraft({ userId: '', action: 'exclude', startsOn: '', endsOn: '' })
                  await load()
                },
                'Unable to save the override.',
              )
            }
          >
            <Plus className="mr-1 h-4 w-4" /> Add
          </Button>
        </div>
        {overrides.length ? (
          <div className="mt-2.5 flex flex-wrap gap-2">
            {overrides.map((override) => (
              <span
                key={override.id}
                className="inline-flex items-center gap-1.5 rounded-[0.25rem] border border-[#d4dde8] bg-white px-2.5 py-1 text-xs font-medium text-[#44474e]"
              >
                {override.action === 'exclude' ? '−' : '+'} {override.userName} · {override.startsOn}
                {override.endsOn ? ` to ${override.endsOn}` : ' onward'}
                <button
                  type="button"
                  aria-label={`Remove override for ${override.userName}`}
                  className="text-[#ba1a1a] hover:text-[#7f1212]"
                  onClick={() =>
                    void run(
                      `override-${override.id}`,
                      async () => {
                        await deleteMorningOverride(client!, override.id)
                        await load()
                      },
                      'Unable to remove the override.',
                    )
                  }
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </span>
            ))}
          </div>
        ) : null}
      </div>

      {/* ---- Session log ---- */}
      {sessions.length === 0 ? (
        <p className="mt-5 flex items-center gap-2 text-sm text-[#74777f]">
          <Sunrise className="h-4 w-4" /> No morning sessions yet: the first opens automatically on the
          next configured day.
        </p>
      ) : (
        <div className="mt-4">
          {sessions.map((session) => (
            <div key={session.id} className="border-b border-[#eef2f6] py-3 last:border-b-0">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-[#000a1e]">
                    {session.sessionDate}
                    <span className="font-normal text-[#74777f]">
                      {' '}
                      · scheduled {session.scheduledStartAt}
                      {session.status === 'recorded'
                        ? session.startedOnTime
                          ? ' · on time'
                          : ` · started ${session.actualStartAt} (${session.delayMinutes} min late)`
                        : ''}
                    </span>
                  </p>
                  <p className="text-xs text-[#74777f]">
                    {session.status === 'recorded'
                      ? `${session.presentCount} of ${session.attendanceCount} present · recorded by ${session.recordedByName ?? '-'}`
                      : session.status === 'cancelled'
                        ? (session.reason ?? 'Cancelled')
                        : 'Not recorded'}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Badge variant={statusVariant[session.status]}>{session.status}</Badge>
                  {session.status === 'pending' ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setCancelDraft({ sessionId: session.id, reason: '' })}
                    >
                      <X className="mr-1 h-4 w-4 text-[#ba1a1a]" /> Cancel
                    </Button>
                  ) : null}
                </div>
              </div>

              {cancelDraft.sessionId === session.id ? (
                <div className="mt-2.5 flex flex-wrap items-end gap-2">
                  <Textarea
                    value={cancelDraft.reason}
                    placeholder="Why is it cancelled? (holiday, ...)"
                    aria-label="Cancellation reason"
                    className="min-h-[44px] w-full max-w-md"
                    rows={1}
                    onChange={(event) => setCancelDraft((prev) => ({ ...prev, reason: event.target.value }))}
                  />
                  <Button
                    size="sm"
                    disabled={!cancelDraft.reason.trim() || busy === `cancel-${session.id}`}
                    onClick={() =>
                      void run(
                        `cancel-${session.id}`,
                        async () => {
                          await cancelMorningSession(client!, session.id, cancelDraft.reason.trim())
                          setCancelDraft({ sessionId: '', reason: '' })
                          toast.success('Session cancelled.')
                          await load()
                        },
                        'Unable to cancel the session.',
                      )
                    }
                  >
                    Confirm cancel
                  </Button>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
