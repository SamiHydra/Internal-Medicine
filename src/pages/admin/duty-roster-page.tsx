import { useCallback, useEffect, useMemo, useState } from 'react'
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Loader2, Save, X } from 'lucide-react'
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
import {
  SectionEmptyState,
  SectionHeader,
  panelClass,
} from '@/components/dashboard/section-panel'
import {
  fetchAcademicDutyTypes,
  fetchRosterMonth,
  saveDailyDuty,
  saveRosterMonth,
  type AcademicDutyType,
  type RosterMonth,
  type RosterPerson,
} from '@/lib/api'
import { getApiBrowserClient } from '@/lib/api/client'
import { cn } from '@/lib/utils'

const ALL = 'all'
const CLEARED = 'cleared'

const roleFilters = [
  { value: 'consultant', label: 'Consultants' },
  { value: 'resident-1', label: 'Residents Y1' },
  { value: 'resident-2', label: 'Residents Y2' },
  { value: 'resident-3', label: 'Residents Y3' },
] as const

function monthLabel(year: number, month: number) {
  return new Date(year, month - 1, 1).toLocaleDateString('en-GB', {
    month: 'long',
    year: 'numeric',
  })
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback
}

/**
 * The department's live duty roster (V2 Phase 2): every consultant's and
 * resident's monthly duty for the selected month, plus day-level duties
 * (on-call, Transition) per person. Monthly edits are staged and saved in one
 * transaction; day duties write immediately.
 */
export function DutyRosterPage() {
  const client = getApiBrowserClient()

  const today = new Date()
  const [year, setYear] = useState(today.getFullYear())
  const [month, setMonth] = useState(today.getMonth() + 1)
  const [data, setData] = useState<RosterMonth | null>(null)
  const [dutyTypes, setDutyTypes] = useState<AcademicDutyType[] | null>(null)
  const [roleFilter, setRoleFilter] = useState<(typeof roleFilters)[number]['value']>('consultant')
  const [sectionFilter, setSectionFilter] = useState(ALL)
  // Staged monthly edits: userId -> dutyTypeId (or CLEARED). Saved together.
  const [staged, setStaged] = useState<Record<string, string>>({})
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [dailyDraft, setDailyDraft] = useState({ dutyTypeId: '', date: '' })
  const [isSaving, setIsSaving] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)

  const load = useCallback(async () => {
    if (!client) {
      setLoadError(true)
      setIsLoading(false)
      return
    }

    setIsLoading(true)
    try {
      const [monthData, types] = await Promise.all([
        fetchRosterMonth(client, year, month),
        dutyTypes ? Promise.resolve(dutyTypes) : fetchAcademicDutyTypes(client),
      ])
      setData(monthData)
      setDutyTypes(types)
      setStaged({})
      setLoadError(false)
    } catch {
      setLoadError(true)
      toast.error('Unable to load the duty roster.')
    } finally {
      setIsLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, year, month])

  useEffect(() => {
    void load()
  }, [load])

  const monthlyTypes = useMemo(
    () => (dutyTypes ?? []).filter((type) => type.granularity === 'monthly' && type.active),
    [dutyTypes],
  )
  const dailyTypes = useMemo(
    () => (dutyTypes ?? []).filter((type) => type.granularity === 'daily' && type.active),
    [dutyTypes],
  )

  /** Section duties first, then department-wide, for the person's picker. */
  const optionsFor = useCallback(
    (person: RosterPerson) =>
      [...monthlyTypes].sort((a, b) => {
        const aOwn = a.sectionId === person.sectionId ? 0 : a.sectionId === null ? 1 : 2
        const bOwn = b.sectionId === person.sectionId ? 0 : b.sectionId === null ? 1 : 2
        return aOwn - bOwn || a.name.localeCompare(b.name)
      }),
    [monthlyTypes],
  )

  const people = useMemo(() => {
    if (!data) {
      return []
    }

    return data.people.filter((person) => {
      if (roleFilter === 'consultant') {
        if (person.role !== 'consultant') {
          return false
        }
        return sectionFilter === ALL || person.sectionId === sectionFilter
      }

      const yearWanted = Number(roleFilter.split('-')[1])
      return person.role === 'resident' && person.trainingYear === yearWanted
    })
  }, [data, roleFilter, sectionFilter])

  const dirtyCount = Object.keys(staged).length

  const stepMonth = (delta: number) => {
    const next = new Date(year, month - 1 + delta, 1)
    setYear(next.getFullYear())
    setMonth(next.getMonth() + 1)
    setStaged({})
    setExpandedId(null)
  }

  const saveStagedMonth = async () => {
    if (!client || dirtyCount === 0) {
      return
    }

    setIsSaving(true)
    try {
      const next = await saveRosterMonth(
        client,
        year,
        month,
        Object.entries(staged).map(([userId, dutyTypeId]) => ({
          userId,
          dutyTypeId: dutyTypeId === CLEARED ? null : dutyTypeId,
        })),
      )
      setData(next)
      setStaged({})
      toast.success('Roster month saved.')
    } catch (error) {
      toast.error(errorMessage(error, 'Unable to save the roster month.'))
    } finally {
      setIsSaving(false)
    }
  }

  const addDailyDuty = async (person: RosterPerson) => {
    if (!client || !dailyDraft.dutyTypeId || !dailyDraft.date) {
      return
    }

    try {
      await saveDailyDuty(client, {
        userId: person.id,
        dutyTypeId: dailyDraft.dutyTypeId,
        date: dailyDraft.date,
      })
      setDailyDraft((prev) => ({ ...prev, date: '' }))
      await load()
    } catch (error) {
      toast.error(errorMessage(error, 'Unable to add the day duty.'))
    }
  }

  const removeDailyDuty = async (person: RosterPerson, dutyTypeId: string, date: string) => {
    if (!client) {
      return
    }

    try {
      await saveDailyDuty(client, { userId: person.id, dutyTypeId, date, remove: true })
      await load()
    } catch (error) {
      toast.error(errorMessage(error, 'Unable to remove the day duty.'))
    }
  }

  return (
    <div className="space-y-6 px-4 py-6 md:px-8">
      <section className={panelClass}>
        <SectionHeader
          eyebrow="Duty roster"
          description="The month-by-month duty schedule for every consultant and resident. Monthly cells stage until you save; day-level duties (on call, Transition) apply immediately."
          actions={
            <Button onClick={() => void saveStagedMonth()} disabled={dirtyCount === 0 || isSaving}>
              {isSaving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Save className="mr-1.5 h-4 w-4" />}
              Save month{dirtyCount ? ` (${dirtyCount})` : ''}
            </Button>
          }
        />

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1.5">
            <Button variant="secondary" size="icon" aria-label="Previous month" onClick={() => stepMonth(-1)}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="min-w-[150px] text-center text-sm font-semibold text-[#000a1e]">
              {monthLabel(year, month)}
            </span>
            <Button variant="secondary" size="icon" aria-label="Next month" onClick={() => stepMonth(1)}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>

          <Select value={roleFilter} onValueChange={(value) => setRoleFilter(value as typeof roleFilter)}>
            <SelectTrigger className="w-[170px]" aria-label="People filter">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {roleFilters.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {roleFilter === 'consultant' ? (
            <Select value={sectionFilter} onValueChange={setSectionFilter}>
              <SelectTrigger className="w-[190px]" aria-label="Section filter">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All sections</SelectItem>
                {(data?.sections ?? []).map((section) => (
                  <SelectItem key={section.id} value={section.id}>
                    {section.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}
        </div>

        {isLoading ? (
          <div className="flex min-h-[260px] items-center justify-center text-[#74777f]">
            <Loader2 className="h-5 w-5 animate-spin" aria-label="Loading roster" />
          </div>
        ) : loadError || !data ? (
          <div className="mt-6">
            <SectionEmptyState
              icon={<CalendarDays className="h-6 w-6" />}
              title="Unable to load the roster"
              description="The roster month could not be fetched from the API. Refresh to retry."
            />
          </div>
        ) : people.length === 0 ? (
          <div className="mt-6">
            <SectionEmptyState
              icon={<CalendarDays className="h-6 w-6" />}
              title="Nobody matches this view"
              description={
                roleFilter === 'consultant'
                  ? 'No active consultants in this section.'
                  : 'No active residents carry this training year yet. Set training years in Users & Access.'
              }
            />
          </div>
        ) : (
          <div className="mt-5 max-h-[62vh] overflow-auto rounded-[0.4rem] border border-[#e6ecf3]">
            <table className="w-full border-collapse text-sm">
              <thead className="sticky top-0 z-10 bg-[#f8fafc]">
                <tr className="border-b border-[#e6ecf3] text-left text-[11px] font-semibold uppercase tracking-[0.14em] text-[#74777f]">
                  <th className="px-4 py-3">Person</th>
                  <th className="px-4 py-3">{roleFilter === 'consultant' ? 'Section' : 'Group'}</th>
                  <th className="px-4 py-3">Monthly duty</th>
                  <th className="px-4 py-3">Day duties</th>
                  <th className="w-10 px-2 py-3" aria-label="Expand" />
                </tr>
              </thead>
              <tbody>
                {people.map((person) => {
                  const currentMonthly = person.monthly[0]?.dutyTypeId ?? null
                  const stagedValue = staged[person.id]
                  const selectValue =
                    stagedValue !== undefined ? stagedValue : (currentMonthly ?? CLEARED)
                  const isEmpty = selectValue === CLEARED
                  const isExpanded = expandedId === person.id

                  return (
                    <>
                      <tr
                        key={person.id}
                        className={cn(
                          'border-b border-[#eef2f6] last:border-b-0',
                          stagedValue !== undefined && 'bg-[#f4f9ff]',
                        )}
                      >
                        <td className="px-4 py-2.5 font-semibold text-[#000a1e]">{person.fullName}</td>
                        <td className="px-4 py-2.5 text-[#74777f]">
                          {person.role === 'consultant'
                            ? (person.sectionName ?? 'No section')
                            : (person.rotationGroup ? `Group ${person.rotationGroup}` : '—')}
                        </td>
                        <td className="px-4 py-2.5">
                          <Select
                            value={selectValue}
                            onValueChange={(value) =>
                              setStaged((prev) => {
                                const original = currentMonthly ?? CLEARED
                                if (value === original) {
                                  const next = { ...prev }
                                  delete next[person.id]
                                  return next
                                }
                                return { ...prev, [person.id]: value }
                              })
                            }
                          >
                            <SelectTrigger
                              className={cn(
                                'w-[230px]',
                                isEmpty && 'border-[#f0b429] bg-[#fff8e8] text-[#8a6100]',
                              )}
                              aria-label={`Monthly duty for ${person.fullName}`}
                            >
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value={CLEARED}>No monthly duty</SelectItem>
                              {optionsFor(person).map((type) => (
                                <SelectItem key={type.id} value={type.id}>
                                  {type.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </td>
                        <td className="px-4 py-2.5">
                          {person.daily.length ? (
                            <div className="flex flex-wrap gap-1.5">
                              {person.daily.slice(0, 4).map((duty) => (
                                <Badge key={duty.id} variant="neutral">
                                  {duty.dutyTypeName} · {duty.startsOn.slice(8)}/{duty.startsOn.slice(5, 7)}
                                </Badge>
                              ))}
                              {person.daily.length > 4 ? (
                                <span className="text-xs text-[#74777f]">+{person.daily.length - 4} more</span>
                              ) : null}
                            </div>
                          ) : (
                            <span className="text-xs text-[#9aa7b8]">None</span>
                          )}
                        </td>
                        <td className="px-2 py-2.5">
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`${isExpanded ? 'Collapse' : 'Expand'} day duties for ${person.fullName}`}
                            aria-expanded={isExpanded}
                            onClick={() => {
                              setExpandedId(isExpanded ? null : person.id)
                              setDailyDraft({ dutyTypeId: dailyTypes[0]?.id ?? '', date: '' })
                            }}
                          >
                            {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                          </Button>
                        </td>
                      </tr>
                      {isExpanded ? (
                        <tr key={`${person.id}-daily`} className="border-b border-[#eef2f6] bg-[#f8fafc]">
                          <td colSpan={5} className="px-4 py-3">
                            <div className="flex flex-wrap items-center gap-2">
                              <Select
                                value={dailyDraft.dutyTypeId}
                                onValueChange={(dutyTypeId) => setDailyDraft((prev) => ({ ...prev, dutyTypeId }))}
                              >
                                <SelectTrigger className="w-[210px]" aria-label="Day duty type">
                                  <SelectValue placeholder="Day duty" />
                                </SelectTrigger>
                                <SelectContent>
                                  {dailyTypes.map((type) => (
                                    <SelectItem key={type.id} value={type.id}>
                                      {type.name}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              <Input
                                type="date"
                                className="w-[160px]"
                                value={dailyDraft.date}
                                min={data.startsOn}
                                max={data.endsOn}
                                aria-label="Day duty date"
                                onChange={(event) =>
                                  setDailyDraft((prev) => ({ ...prev, date: event.target.value }))
                                }
                              />
                              <Button
                                size="sm"
                                disabled={!dailyDraft.dutyTypeId || !dailyDraft.date}
                                onClick={() => void addDailyDuty(person)}
                              >
                                Add day duty
                              </Button>
                            </div>
                            {person.daily.length ? (
                              <div className="mt-3 flex flex-wrap gap-1.5">
                                {person.daily.map((duty) => (
                                  <span
                                    key={duty.id}
                                    className="inline-flex items-center gap-1.5 rounded-[0.25rem] border border-[#d4dde8] bg-white px-2.5 py-1 text-xs font-medium text-[#44474e]"
                                  >
                                    {duty.dutyTypeName} · {duty.startsOn}
                                    <button
                                      type="button"
                                      aria-label={`Remove ${duty.dutyTypeName} on ${duty.startsOn}`}
                                      className="text-[#ba1a1a] hover:text-[#7f1212]"
                                      onClick={() => void removeDailyDuty(person, duty.dutyTypeId, duty.startsOn)}
                                    >
                                      <X className="h-3.5 w-3.5" />
                                    </button>
                                  </span>
                                ))}
                              </div>
                            ) : null}
                          </td>
                        </tr>
                      ) : null}
                    </>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
