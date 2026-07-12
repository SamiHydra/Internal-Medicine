import { useCallback, useEffect, useMemo, useState } from 'react'
import { CalendarRange, Loader2, Save, Users } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import {
  SectionEmptyState,
  SectionHeader,
  panelClass,
} from '@/components/dashboard/section-panel'
import {
  fetchRotationCalendars,
  fetchRotationPlan,
  saveRotationPlan,
  type RotationCalendarSummary,
  type RotationPlan,
} from '@/lib/api'
import { getApiBrowserClient } from '@/lib/api/client'
import { cn } from '@/lib/utils'
import { getErrorMessage } from '@/lib/api/helpers'

const CLEARED = 'cleared'

function blockLabel(block: RotationCalendarSummary['blocks'][number]) {
  const start = new Date(block.startsOn)
  const end = new Date(block.endsOn)
  const fmt = (date: Date) => date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
  return `${fmt(start)} – ${fmt(end)}`
}

/**
 * The rotation planner matrix (V2 Phase 2): residents of the selected
 * calendar's training year down one axis, its blocks across the other. Year 3
 * offers a group mode that plans whole rotation groups; the server expands
 * groups to members. Cells stage locally and save in one transaction.
 */
export function RotationPlannerPage() {
  const client = getApiBrowserClient()

  const [calendars, setCalendars] = useState<RotationCalendarSummary[] | null>(null)
  const [calendarId, setCalendarId] = useState<string | null>(null)
  const [plan, setPlan] = useState<RotationPlan | null>(null)
  // Staged cells: `${rowKey}:${blockId}` -> dutyTypeId | CLEARED. Row key is a
  // resident id in individual mode, a rotation group letter in group mode.
  const [staged, setStaged] = useState<Record<string, string>>({})
  const [groupMode, setGroupMode] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [loadError, setLoadError] = useState(false)

  useEffect(() => {
    if (!client) {
      setLoadError(true)
      setIsLoading(false)
      return
    }

    fetchRotationCalendars(client)
      .then((data) => {
        setCalendars(data)
        const preferred = data.find((calendar) => calendar.active) ?? data[0]
        setCalendarId((current) => current ?? preferred?.id ?? null)
        if (!data.length) {
          setIsLoading(false)
        }
      })
      .catch(() => {
        setLoadError(true)
        setIsLoading(false)
        toast.error('Unable to load rotation calendars.')
      })
  }, [client])

  const loadPlan = useCallback(async () => {
    if (!client || !calendarId) {
      return
    }

    setIsLoading(true)
    try {
      const data = await fetchRotationPlan(client, calendarId)
      setPlan(data)
      setStaged({})
      setGroupMode(false)
      setLoadError(false)
    } catch {
      setLoadError(true)
      toast.error('Unable to load the rotation plan.')
    } finally {
      setIsLoading(false)
    }
  }, [client, calendarId])

  useEffect(() => {
    void loadPlan()
  }, [loadPlan])

  const cellByUserBlock = useMemo(() => {
    const map: Record<string, string> = {}
    for (const cell of plan?.assignments ?? []) {
      map[`${cell.userId}:${cell.blockId}`] = cell.dutyTypeId
    }
    return map
  }, [plan])

  const groups = useMemo(() => {
    const letters = new Set(
      (plan?.residents ?? [])
        .map((resident) => resident.rotationGroup)
        .filter((group): group is string => Boolean(group)),
    )
    return [...letters].sort()
  }, [plan])

  const isYearThree = plan?.calendar.trainingYear === 3
  const dirtyCount = Object.keys(staged).length

  const stageCell = (rowKey: string, blockId: string, value: string, original: string) => {
    setStaged((prev) => {
      const key = `${rowKey}:${blockId}`
      if (value === original) {
        const next = { ...prev }
        delete next[key]
        return next
      }
      return { ...prev, [key]: value }
    })
  }

  const savePlan = async () => {
    if (!client || !calendarId || dirtyCount === 0) {
      return
    }

    setIsSaving(true)
    try {
      const assignments: Array<{ userId: string; blockId: string; dutyTypeId: string | null }> = []
      const groupPlan: Array<{ rotationGroup: string; blockId: string; dutyTypeId: string }> = []

      for (const [key, value] of Object.entries(staged)) {
        const [rowKey, blockId] = key.split(':')

        if (groupMode) {
          if (value !== CLEARED) {
            groupPlan.push({ rotationGroup: rowKey, blockId, dutyTypeId: value })
          }
          continue
        }

        assignments.push({
          userId: rowKey,
          blockId,
          dutyTypeId: value === CLEARED ? null : value,
        })
      }

      const next = await saveRotationPlan(client, calendarId, {
        ...(assignments.length ? { assignments } : {}),
        ...(groupPlan.length ? { groupPlan } : {}),
      })
      setPlan(next)
      setStaged({})
      toast.success('Rotation plan saved.')
    } catch (error) {
      toast.error(getErrorMessage(error, 'Unable to save the rotation plan.'))
    } finally {
      setIsSaving(false)
    }
  }

  const rows: Array<{ key: string; label: string; sublabel?: string }> = groupMode
    ? groups.map((group) => ({
        key: group,
        label: `Group ${group}`,
        sublabel: `${(plan?.residents ?? []).filter((r) => r.rotationGroup === group).length} residents`,
      }))
    : (plan?.residents ?? []).map((resident) => ({
        key: resident.id,
        label: resident.fullName,
        sublabel: resident.rotationGroup ? `Group ${resident.rotationGroup}` : undefined,
      }))

  return (
    <div className="space-y-6 px-4 py-6 md:px-8">
      <section className={panelClass}>
        <SectionHeader
          eyebrow="Rotation planner"
          description="Plan a training year block by block. Cells stage locally and save together; re-planning a cell replaces the previous rotation."
          actions={
            <Button onClick={() => void savePlan()} disabled={dirtyCount === 0 || isSaving}>
              {isSaving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Save className="mr-1.5 h-4 w-4" />}
              Save plan{dirtyCount ? ` (${dirtyCount})` : ''}
            </Button>
          }
        />

        <div className="mt-5 flex flex-wrap items-center gap-4">
          <Select value={calendarId ?? ''} onValueChange={(value) => setCalendarId(value)}>
            <SelectTrigger className="w-[280px]" aria-label="Rotation calendar">
              <SelectValue placeholder="Pick a rotation calendar" />
            </SelectTrigger>
            <SelectContent>
              {(calendars ?? []).map((calendar) => (
                <SelectItem key={calendar.id} value={calendar.id}>
                  Year {calendar.trainingYear} · {calendar.academicYearLabel}
                  {calendar.active ? '' : ' (inactive)'}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {isYearThree && groups.length ? (
            <div className="flex items-center gap-2">
              <Switch
                checked={groupMode}
                aria-label="Plan by rotation group"
                onCheckedChange={(checked) => {
                  setGroupMode(checked)
                  setStaged({})
                }}
              />
              <span className="text-sm font-medium text-[#44474e]">
                Plan by group ({groups.join(', ')})
              </span>
            </div>
          ) : null}
        </div>

        {isLoading ? (
          <div className="flex min-h-[260px] items-center justify-center text-[#74777f]">
            <Loader2 className="h-5 w-5 animate-spin" aria-label="Loading plan" />
          </div>
        ) : loadError ? (
          <div className="mt-6">
            <SectionEmptyState
              icon={<CalendarRange className="h-6 w-6" />}
              title="Unable to load the planner"
              description="The rotation plan could not be fetched from the API. Refresh to retry."
            />
          </div>
        ) : !calendars?.length ? (
          <div className="mt-6">
            <SectionEmptyState
              icon={<CalendarRange className="h-6 w-6" />}
              title="No rotation calendars yet"
              description="Create the academic year calendars on the Structure page first."
            />
          </div>
        ) : !plan || rows.length === 0 ? (
          <div className="mt-6">
            <SectionEmptyState
              icon={<Users className="h-6 w-6" />}
              title="No residents in this training year"
              description="Assign residents a training year (and Year 3 residents a rotation group) in Users & Access, then plan their rotations here."
            />
          </div>
        ) : (
          <div className="mt-5 max-h-[62vh] overflow-auto rounded-[0.4rem] border border-[#e6ecf3]">
            <table className="w-full border-collapse text-sm">
              <thead className="sticky top-0 z-10 bg-[#f8fafc]">
                <tr className="border-b border-[#e6ecf3] text-left text-[11px] font-semibold uppercase tracking-[0.14em] text-[#74777f]">
                  <th className="sticky left-0 z-20 bg-[#f8fafc] px-4 py-3">
                    {groupMode ? 'Group' : 'Resident'}
                  </th>
                  {plan.calendar.blocks.map((block) => (
                    <th key={block.id} className="min-w-[190px] px-3 py-3">
                      <span className="block">Block {block.blockIndex}</span>
                      <span className="block font-medium normal-case tracking-normal text-[#9aa7b8]">
                        {blockLabel(block)}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.key} className="border-b border-[#eef2f6] last:border-b-0">
                    <td className="sticky left-0 z-10 bg-white px-4 py-2.5">
                      <p className="font-semibold text-[#000a1e]">{row.label}</p>
                      {row.sublabel ? <p className="text-xs text-[#74777f]">{row.sublabel}</p> : null}
                    </td>
                    {plan.calendar.blocks.map((block) => {
                      // In group mode a cell has no single source value: show
                      // the staged value or the empty placeholder.
                      const original = groupMode
                        ? CLEARED
                        : (cellByUserBlock[`${row.key}:${block.id}`] ?? CLEARED)
                      const stagedValue = staged[`${row.key}:${block.id}`]
                      const value = stagedValue !== undefined ? stagedValue : original

                      return (
                        <td key={block.id} className="px-3 py-2">
                          <Select
                            value={value}
                            onValueChange={(next) => stageCell(row.key, block.id, next, original)}
                          >
                            <SelectTrigger
                              className={cn(
                                'w-full',
                                stagedValue !== undefined && 'border-[#005db6] bg-[#f4f9ff]',
                                value === CLEARED && stagedValue === undefined && 'text-[#9aa7b8]',
                              )}
                              aria-label={`${row.label}, block ${block.blockIndex}`}
                            >
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value={CLEARED}>
                                {groupMode ? 'Leave unchanged' : 'No rotation'}
                              </SelectItem>
                              {plan.dutyTypes.map((type) => (
                                <SelectItem key={type.id} value={type.id}>
                                  {type.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
