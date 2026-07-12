import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { CalendarRange, Loader2, Network, Plus, Trash2 } from 'lucide-react'
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
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  SectionEmptyState,
  SectionHeader,
  panelClass,
} from '@/components/dashboard/section-panel'
import { useAppData } from '@/context/app-data-context'
import {
  createAcademicDutyType,
  createAcademicSection,
  createAcademicWard,
  createRotationCalendar,
  deleteAcademicDutyType,
  deleteAcademicSection,
  deleteAcademicWard,
  fetchAcademicDutyTypes,
  fetchAcademicSections,
  fetchAcademicWards,
  fetchRotationCalendars,
  setRotationCalendarActive,
  updateAcademicDutyType,
  updateAcademicSection,
  updateAcademicWard,
  type AcademicDutyType,
  type AcademicSection,
  type AcademicWard,
  type DutyTypeCategory,
  type DutyTypeGranularity,
  type RotationCalendarSummary,
} from '@/lib/api'
import { getApiBrowserClient } from '@/lib/api/client'
import { getErrorMessage } from '@/lib/api/helpers'

const NONE = 'none'

const categoryOptions: Array<{ value: DutyTypeCategory; label: string }> = [
  { value: 'ward_service', label: 'Ward service' },
  { value: 'clinical_duty', label: 'Clinical duty' },
  { value: 'on_call', label: 'On call' },
  { value: 'external', label: 'External rotation' },
  { value: 'leave', label: 'Leave' },
]

const granularityOptions: Array<{ value: DutyTypeGranularity; label: string }> = [
  { value: 'monthly', label: 'Monthly' },
  { value: 'daily', label: 'Daily' },
]

/** Row shell shared by every tab: content left, controls right, hairline divider. */
function StructureRow({ children, controls }: { children: ReactNode; controls: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 border-b border-[#eef2f6] py-3.5 last:border-b-0 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">{children}</div>
      <div className="flex shrink-0 items-center gap-3">{controls}</div>
    </div>
  )
}

function InactiveBadge({ active }: { active: boolean }) {
  if (active) {
    return null
  }

  return <Badge variant="neutral">Inactive</Badge>
}

export function AcademicStructurePage() {
  const client = getApiBrowserClient()
  const { state, ensureProfileDirectoryData } = useAppData()

  const [wards, setWards] = useState<AcademicWard[] | null>(null)
  const [sections, setSections] = useState<AcademicSection[] | null>(null)
  const [dutyTypes, setDutyTypes] = useState<AcademicDutyType[] | null>(null)
  const [calendars, setCalendars] = useState<RotationCalendarSummary[] | null>(null)
  const [loadError, setLoadError] = useState(false)

  // Create-form state, one small draft per tab.
  const [wardName, setWardName] = useState('')
  const [sectionName, setSectionName] = useState('')
  const [dutyDraft, setDutyDraft] = useState({
    name: '',
    category: 'clinical_duty' as DutyTypeCategory,
    granularity: 'monthly' as DutyTypeGranularity,
    sectionId: NONE,
    wardId: NONE,
    pairsForEvaluation: false,
    pairingGroup: '',
    countsForMorningRoster: true,
  })
  const [calendarDraft, setCalendarDraft] = useState({
    trainingYear: '1',
    academicYearLabel: '',
    startsOn: '',
    blockKind: 'calendar_month' as RotationCalendarSummary['blockKind'],
    blockLengthWeeks: '8',
    blocksCount: '12',
  })
  const [busy, setBusy] = useState<string | null>(null)

  const consultants = useMemo(
    () =>
      state.profiles
        .filter((profile) => profile.role === 'consultant' && profile.active)
        .sort((a, b) => a.fullName.localeCompare(b.fullName)),
    [state.profiles],
  )

  const loadAll = useCallback(async () => {
    if (!client) {
      setLoadError(true)
      return
    }

    try {
      const [wardData, sectionData, dutyTypeData, calendarData] = await Promise.all([
        fetchAcademicWards(client),
        fetchAcademicSections(client),
        fetchAcademicDutyTypes(client),
        fetchRotationCalendars(client),
      ])
      setWards(wardData)
      setSections(sectionData)
      setDutyTypes(dutyTypeData)
      setCalendars(calendarData)
      setLoadError(false)
    } catch {
      setLoadError(true)
      toast.error('Unable to load the academic structure.')
    }
  }, [client])

  useEffect(() => {
    void loadAll()
    // The section head picker needs the full user directory.
    void ensureProfileDirectoryData()
  }, [loadAll, ensureProfileDirectoryData])

  const run = async (key: string, action: () => Promise<void>, failure: string) => {
    if (!client) {
      return
    }

    setBusy(key)
    try {
      await action()
    } catch (error) {
      toast.error(getErrorMessage(error, failure))
    } finally {
      setBusy(null)
    }
  }

  if (!client || loadError) {
    return (
      <div className="px-4 py-6 md:px-8">
        <section className={panelClass}>
          <SectionEmptyState
            icon={<Network className="h-6 w-6" />}
            title="Unable to load the academic structure"
            description="The structure lists could not be fetched from the API. Refresh the page to retry."
          />
        </section>
      </div>
    )
  }

  const loading = wards === null || sections === null || dutyTypes === null || calendars === null

  return (
    <div className="space-y-6 px-4 py-6 md:px-8">
      <section className={panelClass}>
        <SectionHeader
          eyebrow="Academic structure"
          description="Teaching wards, specialty sections, the duty catalog, and rotation calendars. Everything here is reference data the department can extend without a developer."
        />

        {loading ? (
          <div className="flex min-h-[240px] items-center justify-center text-[#74777f]">
            <Loader2 className="h-5 w-5 animate-spin" aria-label="Loading structure" />
          </div>
        ) : (
          <Tabs defaultValue="wards" className="mt-5">
            <TabsList>
              <TabsTrigger value="wards">Wards ({wards.length})</TabsTrigger>
              <TabsTrigger value="sections">Sections ({sections.length})</TabsTrigger>
              <TabsTrigger value="duty-types">Duty types ({dutyTypes.length})</TabsTrigger>
              <TabsTrigger value="calendars">Rotation calendars ({calendars.length})</TabsTrigger>
            </TabsList>

            {/* ---- Wards ---- */}
            <TabsContent value="wards" className="mt-5 space-y-5">
              <form
                className="flex flex-wrap items-end gap-3"
                onSubmit={(event) => {
                  event.preventDefault()
                  const name = wardName.trim()
                  if (!name) {
                    return
                  }
                  void run(
                    'ward-create',
                    async () => {
                      const created = await createAcademicWard(client, { name })
                      setWards((prev) => (prev ? [...prev, created] : [created]))
                      setWardName('')
                      toast.success(`Ward "${created.name}" created.`)
                    },
                    'Unable to create the ward.',
                  )
                }}
              >
                <div className="w-full max-w-xs">
                  <Input
                    value={wardName}
                    onChange={(event) => setWardName(event.target.value)}
                    placeholder="New ward name"
                    aria-label="New ward name"
                  />
                </div>
                <Button type="submit" disabled={busy === 'ward-create' || !wardName.trim()}>
                  <Plus className="mr-1.5 h-4 w-4" /> Add ward
                </Button>
              </form>

              <div>
                {wards.map((ward) => (
                  <StructureRow
                    key={ward.id}
                    controls={
                      <>
                        <InactiveBadge active={ward.active} />
                        <Switch
                          checked={ward.active}
                          disabled={busy === `ward-${ward.id}`}
                          aria-label={`Toggle ${ward.name} active`}
                          onCheckedChange={(active) =>
                            void run(
                              `ward-${ward.id}`,
                              async () => {
                                const updated = await updateAcademicWard(client, ward.id, { active })
                                setWards((prev) =>
                                  prev ? prev.map((item) => (item.id === ward.id ? updated : item)) : prev,
                                )
                              },
                              'Unable to update the ward.',
                            )
                          }
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          disabled={busy === `ward-${ward.id}`}
                          aria-label={`Delete ${ward.name}`}
                          onClick={() =>
                            void run(
                              `ward-${ward.id}`,
                              async () => {
                                await deleteAcademicWard(client, ward.id)
                                setWards((prev) => (prev ? prev.filter((item) => item.id !== ward.id) : prev))
                                toast.success(`Ward "${ward.name}" deleted.`)
                              },
                              'This ward is referenced by duty types or departments. Deactivate it instead.',
                            )
                          }
                        >
                          <Trash2 className="h-4 w-4 text-[#ba1a1a]" />
                        </Button>
                      </>
                    }
                  >
                    <p className="text-sm font-semibold text-[#000a1e]">{ward.name}</p>
                    <p className="text-xs text-[#74777f]">{ward.slug}</p>
                  </StructureRow>
                ))}
              </div>
            </TabsContent>

            {/* ---- Sections ---- */}
            <TabsContent value="sections" className="mt-5 space-y-5">
              <form
                className="flex flex-wrap items-end gap-3"
                onSubmit={(event) => {
                  event.preventDefault()
                  const name = sectionName.trim()
                  if (!name) {
                    return
                  }
                  void run(
                    'section-create',
                    async () => {
                      const created = await createAcademicSection(client, { name })
                      setSections((prev) => (prev ? [...prev, created] : [created]))
                      setSectionName('')
                      toast.success(`Section "${created.name}" created.`)
                    },
                    'Unable to create the section.',
                  )
                }}
              >
                <div className="w-full max-w-xs">
                  <Input
                    value={sectionName}
                    onChange={(event) => setSectionName(event.target.value)}
                    placeholder="New section name"
                    aria-label="New section name"
                  />
                </div>
                <Button type="submit" disabled={busy === 'section-create' || !sectionName.trim()}>
                  <Plus className="mr-1.5 h-4 w-4" /> Add section
                </Button>
              </form>

              <div>
                {sections.map((section) => (
                  <StructureRow
                    key={section.id}
                    controls={
                      <>
                        <Select
                          value={section.headUserId ?? NONE}
                          disabled={busy === `section-${section.id}`}
                          onValueChange={(value) =>
                            void run(
                              `section-${section.id}`,
                              async () => {
                                const updated = await updateAcademicSection(client, section.id, {
                                  headUserId: value === NONE ? null : value,
                                })
                                setSections((prev) =>
                                  prev
                                    ? prev.map((item) => (item.id === section.id ? updated : item))
                                    : prev,
                                )
                              },
                              'Unable to set the section head.',
                            )
                          }
                        >
                          <SelectTrigger
                            className="w-[190px]"
                            aria-label={`Head of ${section.name}`}
                          >
                            <SelectValue placeholder="Section head" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value={NONE}>No head assigned</SelectItem>
                            {consultants.map((consultant) => (
                              <SelectItem key={consultant.id} value={consultant.id}>
                                {consultant.fullName}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <InactiveBadge active={section.active} />
                        <Switch
                          checked={section.active}
                          disabled={busy === `section-${section.id}`}
                          aria-label={`Toggle ${section.name} active`}
                          onCheckedChange={(active) =>
                            void run(
                              `section-${section.id}`,
                              async () => {
                                const updated = await updateAcademicSection(client, section.id, { active })
                                setSections((prev) =>
                                  prev
                                    ? prev.map((item) => (item.id === section.id ? updated : item))
                                    : prev,
                                )
                              },
                              'Unable to update the section.',
                            )
                          }
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          disabled={busy === `section-${section.id}`}
                          aria-label={`Delete ${section.name}`}
                          onClick={() =>
                            void run(
                              `section-${section.id}`,
                              async () => {
                                await deleteAcademicSection(client, section.id)
                                setSections((prev) =>
                                  prev ? prev.filter((item) => item.id !== section.id) : prev,
                                )
                                toast.success(`Section "${section.name}" deleted.`)
                              },
                              'This section is referenced by duty types or consultants. Deactivate it instead.',
                            )
                          }
                        >
                          <Trash2 className="h-4 w-4 text-[#ba1a1a]" />
                        </Button>
                      </>
                    }
                  >
                    <p className="text-sm font-semibold text-[#000a1e]">{section.name}</p>
                    <p className="text-xs text-[#74777f]">
                      {section.headName ? `Head: ${section.headName}` : 'No head assigned'}
                      {' · '}
                      {section.consultantCount} consultant{section.consultantCount === 1 ? '' : 's'}
                    </p>
                  </StructureRow>
                ))}
              </div>
            </TabsContent>

            {/* ---- Duty types ---- */}
            <TabsContent value="duty-types" className="mt-5 space-y-5">
              <form
                className="grid gap-3 rounded-[0.4rem] border border-[#eef2f6] bg-[#f8fafc] p-4 sm:grid-cols-2 lg:grid-cols-4"
                onSubmit={(event) => {
                  event.preventDefault()
                  const name = dutyDraft.name.trim()
                  if (!name) {
                    return
                  }
                  void run(
                    'duty-create',
                    async () => {
                      const created = await createAcademicDutyType(client, {
                        name,
                        category: dutyDraft.category,
                        granularity: dutyDraft.granularity,
                        sectionId: dutyDraft.sectionId === NONE ? null : dutyDraft.sectionId,
                        wardId: dutyDraft.wardId === NONE ? null : dutyDraft.wardId,
                        pairsForEvaluation: dutyDraft.pairsForEvaluation,
                        pairingGroup: dutyDraft.pairingGroup.trim() || null,
                        countsForMorningRoster: dutyDraft.countsForMorningRoster,
                      })
                      setDutyTypes((prev) => (prev ? [...prev, created] : [created]))
                      setDutyDraft((prev) => ({ ...prev, name: '', pairingGroup: '' }))
                      toast.success(`Duty type "${created.name}" created.`)
                    },
                    'Unable to create the duty type.',
                  )
                }}
              >
                <Input
                  value={dutyDraft.name}
                  onChange={(event) => setDutyDraft((prev) => ({ ...prev, name: event.target.value }))}
                  placeholder="Duty name"
                  aria-label="New duty type name"
                  className="lg:col-span-2"
                />
                <Select
                  value={dutyDraft.category}
                  onValueChange={(value) =>
                    setDutyDraft((prev) => ({ ...prev, category: value as DutyTypeCategory }))
                  }
                >
                  <SelectTrigger aria-label="Duty category">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {categoryOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  value={dutyDraft.granularity}
                  onValueChange={(value) =>
                    setDutyDraft((prev) => ({ ...prev, granularity: value as DutyTypeGranularity }))
                  }
                >
                  <SelectTrigger aria-label="Duty granularity">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {granularityOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  value={dutyDraft.sectionId}
                  onValueChange={(value) => setDutyDraft((prev) => ({ ...prev, sectionId: value }))}
                >
                  <SelectTrigger aria-label="Owning section">
                    <SelectValue placeholder="Section" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>Department-wide</SelectItem>
                    {sections.map((section) => (
                      <SelectItem key={section.id} value={section.id}>
                        {section.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  value={dutyDraft.wardId}
                  onValueChange={(value) => setDutyDraft((prev) => ({ ...prev, wardId: value }))}
                >
                  <SelectTrigger aria-label="Ward">
                    <SelectValue placeholder="Ward" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>No ward</SelectItem>
                    {wards.map((ward) => (
                      <SelectItem key={ward.id} value={ward.id}>
                        {ward.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  value={dutyDraft.pairingGroup}
                  onChange={(event) =>
                    setDutyDraft((prev) => ({ ...prev, pairingGroup: event.target.value }))
                  }
                  placeholder="Pairing group (e.g. opd)"
                  aria-label="Pairing group"
                />
                <div className="flex items-center gap-2">
                  <Switch
                    checked={dutyDraft.pairsForEvaluation}
                    aria-label="Pairs for evaluation"
                    onCheckedChange={(pairsForEvaluation) =>
                      setDutyDraft((prev) => ({ ...prev, pairsForEvaluation }))
                    }
                  />
                  <span className="text-xs font-medium text-[#44474e]">Pairs for evaluation</span>
                </div>
                <div className="flex items-center gap-2">
                  <Switch
                    checked={dutyDraft.countsForMorningRoster}
                    aria-label="Counts for the morning roster"
                    onCheckedChange={(countsForMorningRoster) =>
                      setDutyDraft((prev) => ({ ...prev, countsForMorningRoster }))
                    }
                  />
                  <span className="text-xs font-medium text-[#44474e]">Morning roster</span>
                </div>
                <Button
                  type="submit"
                  className="lg:col-start-4"
                  disabled={busy === 'duty-create' || !dutyDraft.name.trim()}
                >
                  <Plus className="mr-1.5 h-4 w-4" /> Add duty type
                </Button>
              </form>

              <div>
                {dutyTypes.map((dutyType) => (
                  <StructureRow
                    key={dutyType.id}
                    controls={
                      <>
                        <InactiveBadge active={dutyType.active} />
                        <Switch
                          checked={dutyType.active}
                          disabled={busy === `duty-${dutyType.id}`}
                          aria-label={`Toggle ${dutyType.name} active`}
                          onCheckedChange={(active) =>
                            void run(
                              `duty-${dutyType.id}`,
                              async () => {
                                const updated = await updateAcademicDutyType(client, dutyType.id, {
                                  active,
                                })
                                setDutyTypes((prev) =>
                                  prev
                                    ? prev.map((item) => (item.id === dutyType.id ? updated : item))
                                    : prev,
                                )
                              },
                              'Unable to update the duty type.',
                            )
                          }
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          disabled={busy === `duty-${dutyType.id}`}
                          aria-label={`Delete ${dutyType.name}`}
                          onClick={() =>
                            void run(
                              `duty-${dutyType.id}`,
                              async () => {
                                await deleteAcademicDutyType(client, dutyType.id)
                                setDutyTypes((prev) =>
                                  prev ? prev.filter((item) => item.id !== dutyType.id) : prev,
                                )
                                toast.success(`Duty type "${dutyType.name}" deleted.`)
                              },
                              'This duty type has assignments on the roster. Deactivate it instead.',
                            )
                          }
                        >
                          <Trash2 className="h-4 w-4 text-[#ba1a1a]" />
                        </Button>
                      </>
                    }
                  >
                    <p className="text-sm font-semibold text-[#000a1e]">{dutyType.name}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-[#74777f]">
                      <Badge variant="neutral">
                        {categoryOptions.find((option) => option.value === dutyType.category)?.label ??
                          dutyType.category}
                      </Badge>
                      <Badge variant="neutral">
                        {dutyType.granularity === 'monthly' ? 'Monthly' : 'Daily'}
                      </Badge>
                      {dutyType.sectionName ? <span>{dutyType.sectionName}</span> : <span>Department-wide</span>}
                      {dutyType.wardName ? <span>· {dutyType.wardName}</span> : null}
                      {dutyType.pairsForEvaluation ? (
                        <span>· pairs{dutyType.pairingGroup ? ` (${dutyType.pairingGroup})` : ''}</span>
                      ) : null}
                      {dutyType.countsForMorningRoster ? null : <span>· off morning roster</span>}
                    </div>
                  </StructureRow>
                ))}
              </div>
            </TabsContent>

            {/* ---- Rotation calendars ---- */}
            <TabsContent value="calendars" className="mt-5 space-y-5">
              <form
                className="grid gap-3 rounded-[0.4rem] border border-[#eef2f6] bg-[#f8fafc] p-4 sm:grid-cols-2 lg:grid-cols-3"
                onSubmit={(event) => {
                  event.preventDefault()
                  if (!calendarDraft.academicYearLabel.trim() || !calendarDraft.startsOn) {
                    return
                  }
                  void run(
                    'calendar-create',
                    async () => {
                      const created = await createRotationCalendar(client, {
                        trainingYear: Number(calendarDraft.trainingYear),
                        academicYearLabel: calendarDraft.academicYearLabel.trim(),
                        startsOn: calendarDraft.startsOn,
                        blockKind: calendarDraft.blockKind,
                        blockLengthWeeks:
                          calendarDraft.blockKind === 'fixed_weeks'
                            ? Number(calendarDraft.blockLengthWeeks)
                            : null,
                        blocksCount: Number(calendarDraft.blocksCount),
                      })
                      setCalendars((prev) => (prev ? [created, ...prev] : [created]))
                      toast.success(
                        `Year ${created.trainingYear} calendar ${created.academicYearLabel} created with ${created.blocks.length} blocks.`,
                      )
                    },
                    'Unable to create the rotation calendar.',
                  )
                }}
              >
                <Select
                  value={calendarDraft.trainingYear}
                  onValueChange={(value) =>
                    setCalendarDraft((prev) => ({
                      ...prev,
                      trainingYear: value,
                      // Year 3 runs continuous 8-week blocks by program design.
                      blockKind: value === '3' ? 'fixed_weeks' : 'calendar_month',
                    }))
                  }
                >
                  <SelectTrigger aria-label="Training year">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1">Year 1</SelectItem>
                    <SelectItem value="2">Year 2</SelectItem>
                    <SelectItem value="3">Year 3</SelectItem>
                  </SelectContent>
                </Select>
                <Input
                  value={calendarDraft.academicYearLabel}
                  onChange={(event) =>
                    setCalendarDraft((prev) => ({ ...prev, academicYearLabel: event.target.value }))
                  }
                  placeholder="Academic year (e.g. 2026/27)"
                  aria-label="Academic year label"
                />
                <Input
                  type="date"
                  value={calendarDraft.startsOn}
                  onChange={(event) =>
                    setCalendarDraft((prev) => ({ ...prev, startsOn: event.target.value }))
                  }
                  aria-label="Calendar start date"
                />
                <Select
                  value={calendarDraft.blockKind}
                  onValueChange={(value) =>
                    setCalendarDraft((prev) => ({
                      ...prev,
                      blockKind: value as RotationCalendarSummary['blockKind'],
                    }))
                  }
                >
                  <SelectTrigger aria-label="Block kind">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="calendar_month">Calendar months</SelectItem>
                    <SelectItem value="fixed_weeks">Fixed-week blocks</SelectItem>
                  </SelectContent>
                </Select>
                {calendarDraft.blockKind === 'fixed_weeks' ? (
                  <Input
                    type="number"
                    min={1}
                    max={52}
                    value={calendarDraft.blockLengthWeeks}
                    onChange={(event) =>
                      setCalendarDraft((prev) => ({ ...prev, blockLengthWeeks: event.target.value }))
                    }
                    aria-label="Block length in weeks"
                  />
                ) : null}
                <Input
                  type="number"
                  min={1}
                  max={24}
                  value={calendarDraft.blocksCount}
                  onChange={(event) =>
                    setCalendarDraft((prev) => ({ ...prev, blocksCount: event.target.value }))
                  }
                  aria-label="Number of blocks"
                />
                <Button
                  type="submit"
                  disabled={
                    busy === 'calendar-create' ||
                    !calendarDraft.academicYearLabel.trim() ||
                    !calendarDraft.startsOn
                  }
                >
                  <Plus className="mr-1.5 h-4 w-4" /> Create calendar
                </Button>
              </form>

              {calendars.length === 0 ? (
                <SectionEmptyState
                  icon={<CalendarRange className="h-6 w-6" />}
                  title="No rotation calendars yet"
                  description="Create one calendar per training year. The academic year start date moves every year, so nothing is assumed."
                />
              ) : (
                <div>
                  {calendars.map((calendar) => (
                    <StructureRow
                      key={calendar.id}
                      controls={
                        <>
                          <InactiveBadge active={calendar.active} />
                          <Switch
                            checked={calendar.active}
                            disabled={busy === `calendar-${calendar.id}`}
                            aria-label={`Toggle calendar ${calendar.academicYearLabel} active`}
                            onCheckedChange={(active) =>
                              void run(
                                `calendar-${calendar.id}`,
                                async () => {
                                  const updated = await setRotationCalendarActive(
                                    client,
                                    calendar.id,
                                    active,
                                  )
                                  setCalendars((prev) =>
                                    prev
                                      ? prev.map((item) => (item.id === calendar.id ? updated : item))
                                      : prev,
                                  )
                                },
                                'Unable to update the calendar.',
                              )
                            }
                          />
                        </>
                      }
                    >
                      <p className="text-sm font-semibold text-[#000a1e]">
                        Year {calendar.trainingYear} · {calendar.academicYearLabel}
                      </p>
                      <p className="text-xs text-[#74777f]">
                        {calendar.blocks.length} blocks ·{' '}
                        {calendar.blockKind === 'fixed_weeks'
                          ? `${calendar.blockLengthWeeks} weeks each`
                          : 'calendar months'}{' '}
                        · {calendar.blocks[0]?.startsOn} to{' '}
                        {calendar.blocks[calendar.blocks.length - 1]?.endsOn}
                      </p>
                    </StructureRow>
                  ))}
                </div>
              )}
            </TabsContent>
          </Tabs>
        )}
      </section>
    </div>
  )
}
