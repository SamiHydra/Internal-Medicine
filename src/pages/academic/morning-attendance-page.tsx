import { useCallback, useEffect, useState } from 'react'
import { Loader2, Save, Sunrise } from 'lucide-react'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import {
  SectionEmptyState,
  SectionHeader,
  panelClass,
} from '@/components/dashboard/section-panel'
import {
  fetchTodayMorningSession,
  recordMorningSession,
  type MorningSessionRecord,
} from '@/lib/api/morning'
import { getApiBrowserClient } from '@/lib/api/client'
import { cn } from '@/lib/utils'
import { getErrorMessage } from '@/lib/api/helpers'

/**
 * The designated recorder's morning-session page (V2 Phase 6): the roster is
 * already built from current rotations and duty assignments; one on-time
 * toggle (the actual start appears when off), one present toggle per person.
 * Designed to be recorded in under a minute at 08:00.
 */
export function MorningAttendancePage() {
  const client = getApiBrowserClient()

  const [session, setSession] = useState<MorningSessionRecord | null>(null)
  const [isSessionDay, setIsSessionDay] = useState(true)
  const [canRecord, setCanRecord] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)

  const [onTime, setOnTime] = useState(true)
  const [actualStart, setActualStart] = useState('')
  const [presence, setPresence] = useState<Record<string, boolean>>({})

  const load = useCallback(async () => {
    if (!client) {
      setIsLoading(false)
      return
    }

    try {
      const response = await fetchTodayMorningSession(client)
      setSession(response.session)
      setIsSessionDay(response.isSessionDay)
      setCanRecord(response.canRecord)

      if (response.session?.people) {
        setPresence(
          Object.fromEntries(
            response.session.people.map((person) => [person.userId, person.present ?? true]),
          ),
        )
        setOnTime(response.session.startedOnTime ?? true)
        setActualStart(response.session.actualStartAt ?? '')
      }
    } catch {
      toast.error("Unable to load today's morning session.")
    } finally {
      setIsLoading(false)
    }
  }, [client])

  useEffect(() => {
    void load()
  }, [load])

  const save = async () => {
    if (!client || !session) {
      return
    }

    setIsSaving(true)
    try {
      await recordMorningSession(client, session.id, {
        startedOnTime: onTime,
        actualStartAt: onTime ? null : actualStart,
        presence,
      })
      toast.success('Morning session recorded.')
      await load()
    } catch (error) {
      toast.error(getErrorMessage(error, 'Unable to record the session.'))
    } finally {
      setIsSaving(false)
    }
  }

  const presentCount = Object.values(presence).filter(Boolean).length

  return (
    <div className="space-y-6 px-4 py-6 md:px-6 md:py-8">
      <section className={panelClass}>
        <SectionHeader
          eyebrow="Morning session"
          title={session ? `Scheduled ${session.scheduledStartAt}` : 'Morning session'}
          description="One department-wide session. Flip the on-time toggle, mark who is present, save."
          actions={
            session && session.status !== 'cancelled' && canRecord ? (
              <Button onClick={() => void save()} disabled={isSaving || (!onTime && !actualStart)}>
                {isSaving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Save className="mr-1.5 h-4 w-4" />}
                {session.status === 'recorded' ? 'Save correction' : 'Record session'}
              </Button>
            ) : undefined
          }
        />

        {isLoading ? (
          <div className="flex min-h-[220px] items-center justify-center text-[#74777f]">
            <Loader2 className="h-5 w-5 animate-spin" aria-label="Loading session" />
          </div>
        ) : !isSessionDay || !session ? (
          <div className="mt-5">
            <SectionEmptyState
              icon={<Sunrise className="h-6 w-6" />}
              title="No morning session today"
              description="Sessions run on the configured days (Monday, Wednesday, Friday by default)."
            />
          </div>
        ) : session.status === 'cancelled' ? (
          <div className="mt-5">
            <SectionEmptyState
              icon={<Sunrise className="h-6 w-6" />}
              title="Today's session is cancelled"
              description={session.reason ?? 'Cancelled by an administrator.'}
            />
          </div>
        ) : !canRecord ? (
          <div className="mt-5">
            <SectionEmptyState
              icon={<Sunrise className="h-6 w-6" />}
              title="Recording is assigned to the designated recorder"
              description="Contact an administrator if you should be recording the morning sessions."
            />
          </div>
        ) : (
          <div className="mt-5 space-y-5">
            {session.status === 'recorded' ? (
              <Badge variant="success">
                Recorded{session.delayMinutes ? ` · started ${session.delayMinutes} min late` : ' · on time'}
              </Badge>
            ) : null}

            <div className="flex flex-wrap items-center gap-4 rounded-[0.4rem] border border-[#eef2f6] bg-[#f8fafc] px-4 py-3.5">
              <label className="flex cursor-pointer items-center gap-3">
                <Switch checked={onTime} onCheckedChange={setOnTime} aria-label="Started on time" />
                <span className="text-sm font-medium text-[#000a1e]">
                  Started on time ({session.scheduledStartAt})
                </span>
              </label>
              {!onTime ? (
                <div className="flex items-center gap-2">
                  <span className="text-sm text-[#74777f]">Actual start</span>
                  <Input
                    type="time"
                    className="w-[130px]"
                    value={actualStart}
                    aria-label="Actual start time"
                    onChange={(event) => setActualStart(event.target.value)}
                  />
                </div>
              ) : null}
            </div>

            <div>
              <p className="mb-2.5 text-xs font-semibold uppercase tracking-[0.14em] text-[#74777f]">
                Expected attendees · {presentCount} of {session.people?.length ?? 0} present
              </p>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {(session.people ?? []).map((person) => {
                  const isPresent = presence[person.userId] ?? false
                  return (
                    <label
                      key={person.userId}
                      className={cn(
                        'flex cursor-pointer items-center justify-between gap-3 rounded-[0.25rem] border bg-white px-3.5 py-2.5 transition',
                        isPresent ? 'border-[#005db6]' : 'border-[#d4dde8] opacity-70',
                      )}
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium text-[#000a1e]">
                          {person.fullName}
                        </span>
                        <span className="block text-[11px] uppercase tracking-[0.1em] text-[#9aa7b8]">
                          {person.role}
                        </span>
                      </span>
                      <Switch
                        checked={isPresent}
                        aria-label={`${person.fullName} present`}
                        onCheckedChange={(checked) =>
                          setPresence((prev) => ({ ...prev, [person.userId]: checked }))
                        }
                      />
                    </label>
                  )
                })}
              </div>
            </div>
          </div>
        )}
      </section>
    </div>
  )
}
