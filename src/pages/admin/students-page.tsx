import { useCallback, useEffect, useMemo, useState } from 'react'
import { GraduationCap, Loader2, Plus, Upload, X } from 'lucide-react'
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
import { Textarea } from '@/components/ui/textarea'
import {
  SectionEmptyState,
  SectionHeader,
  panelClass,
} from '@/components/dashboard/section-panel'
import { useAppData } from '@/context/app-data-context'
import {
  ACTIVITY_LABELS,
  REP_SCOPE_LABELS,
  cancelTeachingSession,
  createRepAssignment,
  createStudentBatch,
  createStudent,
  fetchOversightSessions,
  fetchRepAssignments,
  fetchStudentBatches,
  fetchStudents,
  fetchSubgroupPlacements,
  importStudents,
  saveSubgroupPlacement,
  setRepAssignmentActive,
  updateStudent,
  updateStudentBatch,
  type OversightSessionRecord,
  type RepAssignmentRecord,
  type StudentBatchRecord,
  type StudentRecord,
  type SubgroupPlacementRecord,
} from '@/lib/api/teaching'
import { fetchAcademicWards, type AcademicWard } from '@/lib/api/academic-structure'
import { getApiBrowserClient } from '@/lib/api/client'
import { getErrorMessage } from '@/lib/api/helpers'

const NONE = 'none'

const sessionStatusVariant: Record<OversightSessionRecord['status'], 'info' | 'success' | 'danger' | 'neutral'> = {
  pending: 'info',
  held: 'success',
  not_held: 'danger',
  cancelled: 'neutral',
}

/**
 * Admin management of the undergraduate module (V2 Phase 5): batches,
 * student rosters (with paste import), weekly subgroup placements, rep
 * accounts, and the teaching-session oversight board.
 */
export function StudentsPage() {
  const client = getApiBrowserClient()
  const { state, ensureProfileDirectoryData } = useAppData()

  const [batches, setBatches] = useState<StudentBatchRecord[] | null>(null)
  const [students, setStudents] = useState<StudentRecord[]>([])
  const [placements, setPlacements] = useState<SubgroupPlacementRecord[]>([])
  const [reps, setReps] = useState<RepAssignmentRecord[]>([])
  const [sessions, setSessions] = useState<OversightSessionRecord[]>([])
  const [wards, setWards] = useState<AcademicWard[]>([])
  const [busy, setBusy] = useState<string | null>(null)

  const [batchDraft, setBatchDraft] = useState({ cohort: 'C1' as 'C1' | 'C2', label: '', startsOn: '', endsOn: '' })
  const [studentDraft, setStudentDraft] = useState({ batchId: '', fullName: '', subgroup: NONE })
  const [importDraft, setImportDraft] = useState({ batchId: '', csv: '' })
  const [placementDraft, setPlacementDraft] = useState({ batchId: '', subgroup: 'A' as 'A' | 'B', wardId: '', weekStartsOn: '' })
  const [repDraft, setRepDraft] = useState({ userId: '', batchId: '', scope: 'group' as RepAssignmentRecord['scope'] })
  const [cancelDraft, setCancelDraft] = useState({ sessionId: '', reason: '' })

  const load = useCallback(async () => {
    if (!client) {
      setBatches([])
      return
    }

    try {
      const [batchData, studentData, placementData, repData, sessionData, wardData] = await Promise.all([
        fetchStudentBatches(client),
        fetchStudents(client),
        fetchSubgroupPlacements(client),
        fetchRepAssignments(client),
        fetchOversightSessions(client),
        fetchAcademicWards(client),
      ])
      setBatches(batchData)
      setStudents(studentData)
      setPlacements(placementData)
      setReps(repData)
      setSessions(sessionData)
      setWards(wardData.filter((ward) => ward.active))
    } catch {
      setBatches([])
      toast.error('Unable to load the undergraduate module.')
    }
  }, [client])

  useEffect(() => {
    void load()
    // Rep accounts come from the user directory.
    void ensureProfileDirectoryData()
  }, [load, ensureProfileDirectoryData])

  const repAccounts = useMemo(
    () =>
      state.profiles
        .filter((profile) => profile.role === 'student_rep' && profile.active)
        .sort((a, b) => a.fullName.localeCompare(b.fullName)),
    [state.profiles],
  )

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

  const activeBatches = (batches ?? []).filter((batch) => batch.active)

  if (batches === null) {
    return (
      <div className="flex min-h-[300px] items-center justify-center text-[#74777f]">
        <Loader2 className="h-5 w-5 animate-spin" aria-label="Loading students" />
      </div>
    )
  }

  return (
    <div className="space-y-6 px-4 py-6 md:px-8">
      <section className={panelClass}>
        <SectionHeader
          eyebrow="Undergraduate students"
          description="Batches, rosters, weekly ward placements, rep accounts, and the teaching-session oversight board. Reps record held / not held; consultants record attendance and evaluations."
        />

        <Tabs defaultValue="batches" className="mt-5">
          <TabsList>
            <TabsTrigger value="batches">Batches ({batches.length})</TabsTrigger>
            <TabsTrigger value="students">Students ({students.length})</TabsTrigger>
            <TabsTrigger value="placements">Placements</TabsTrigger>
            <TabsTrigger value="reps">Reps ({reps.length})</TabsTrigger>
            <TabsTrigger value="sessions">Sessions</TabsTrigger>
          </TabsList>

          {/* ---- Batches ---- */}
          <TabsContent value="batches" className="mt-5 space-y-5">
            <form
              className="grid gap-3 rounded-[0.4rem] border border-[#eef2f6] bg-[#f8fafc] p-4 sm:grid-cols-2 lg:grid-cols-5"
              onSubmit={(event) => {
                event.preventDefault()
                void run(
                  'batch-create',
                  async () => {
                    await createStudentBatch(client!, batchDraft)
                    setBatchDraft({ cohort: 'C1', label: '', startsOn: '', endsOn: '' })
                    toast.success('Batch created.')
                    await load()
                  },
                  'Unable to create the batch.',
                )
              }}
            >
              <Select
                value={batchDraft.cohort}
                onValueChange={(cohort) => setBatchDraft((prev) => ({ ...prev, cohort: cohort as 'C1' | 'C2' }))}
              >
                <SelectTrigger aria-label="Cohort">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="C1">C1 (Year 3, 12 weeks)</SelectItem>
                  <SelectItem value="C2">C2 (Year 4, 8 weeks)</SelectItem>
                </SelectContent>
              </Select>
              <Input
                value={batchDraft.label}
                placeholder="Label (e.g. C1 2026-A)"
                aria-label="Batch label"
                onChange={(event) => setBatchDraft((prev) => ({ ...prev, label: event.target.value }))}
              />
              <Input
                type="date"
                value={batchDraft.startsOn}
                aria-label="Batch start"
                onChange={(event) => setBatchDraft((prev) => ({ ...prev, startsOn: event.target.value }))}
              />
              <Input
                type="date"
                value={batchDraft.endsOn}
                aria-label="Batch end"
                onChange={(event) => setBatchDraft((prev) => ({ ...prev, endsOn: event.target.value }))}
              />
              <Button
                type="submit"
                disabled={busy === 'batch-create' || !batchDraft.label.trim() || !batchDraft.startsOn || !batchDraft.endsOn}
              >
                <Plus className="mr-1.5 h-4 w-4" /> Add batch
              </Button>
            </form>

            <div>
              {batches.map((batch) => (
                <div
                  key={batch.id}
                  className="flex flex-col gap-3 border-b border-[#eef2f6] py-3.5 last:border-b-0 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-[#000a1e]">
                      {batch.label} <span className="font-normal text-[#74777f]">· {batch.cohort}</span>
                    </p>
                    <p className="text-xs text-[#74777f]">
                      {batch.startsOn} to {batch.endsOn} · {batch.studentCount} students
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2.5">
                    {batch.active ? null : <Badge variant="neutral">Inactive</Badge>}
                    <Switch
                      checked={batch.active}
                      disabled={busy === `batch-${batch.id}`}
                      aria-label={`Toggle ${batch.label} active`}
                      onCheckedChange={(active) =>
                        void run(
                          `batch-${batch.id}`,
                          async () => {
                            await updateStudentBatch(client!, batch.id, { active })
                            await load()
                          },
                          'Unable to update the batch.',
                        )
                      }
                    />
                  </div>
                </div>
              ))}
            </div>
          </TabsContent>

          {/* ---- Students ---- */}
          <TabsContent value="students" className="mt-5 space-y-5">
            <div className="grid gap-4 lg:grid-cols-2">
              <form
                className="space-y-3 rounded-[0.4rem] border border-[#eef2f6] bg-[#f8fafc] p-4"
                onSubmit={(event) => {
                  event.preventDefault()
                  void run(
                    'student-create',
                    async () => {
                      await createStudent(client!, {
                        batchId: studentDraft.batchId,
                        fullName: studentDraft.fullName.trim(),
                        subgroup: studentDraft.subgroup === NONE ? null : (studentDraft.subgroup as 'A' | 'B'),
                      })
                      setStudentDraft((prev) => ({ ...prev, fullName: '' }))
                      toast.success('Student added.')
                      await load()
                    },
                    'Unable to add the student.',
                  )
                }}
              >
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#74777f]">Add one student</p>
                <Select
                  value={studentDraft.batchId}
                  onValueChange={(batchId) => setStudentDraft((prev) => ({ ...prev, batchId }))}
                >
                  <SelectTrigger aria-label="Batch">
                    <SelectValue placeholder="Batch" />
                  </SelectTrigger>
                  <SelectContent>
                    {activeBatches.map((batch) => (
                      <SelectItem key={batch.id} value={batch.id}>
                        {batch.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  value={studentDraft.fullName}
                  placeholder="Full name"
                  aria-label="Student full name"
                  onChange={(event) => setStudentDraft((prev) => ({ ...prev, fullName: event.target.value }))}
                />
                <Select
                  value={studentDraft.subgroup}
                  onValueChange={(subgroup) => setStudentDraft((prev) => ({ ...prev, subgroup }))}
                >
                  <SelectTrigger aria-label="Subgroup">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>No subgroup yet</SelectItem>
                    <SelectItem value="A">Subgroup A</SelectItem>
                    <SelectItem value="B">Subgroup B</SelectItem>
                  </SelectContent>
                </Select>
                <Button type="submit" disabled={busy === 'student-create' || !studentDraft.batchId || !studentDraft.fullName.trim()}>
                  <Plus className="mr-1.5 h-4 w-4" /> Add student
                </Button>
              </form>

              <form
                className="space-y-3 rounded-[0.4rem] border border-[#eef2f6] bg-[#f8fafc] p-4"
                onSubmit={(event) => {
                  event.preventDefault()
                  void run(
                    'student-import',
                    async () => {
                      const result = await importStudents(client!, importDraft)
                      setImportDraft((prev) => ({ ...prev, csv: '' }))
                      toast.success(`Imported ${result.created} students (${result.skipped} skipped).`)
                      await load()
                    },
                    'Unable to import the list.',
                  )
                }}
              >
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#74777f]">
                  Paste a list · one per line: Name[, ID][, A or B]
                </p>
                <Select
                  value={importDraft.batchId}
                  onValueChange={(batchId) => setImportDraft((prev) => ({ ...prev, batchId }))}
                >
                  <SelectTrigger aria-label="Import batch">
                    <SelectValue placeholder="Batch" />
                  </SelectTrigger>
                  <SelectContent>
                    {activeBatches.map((batch) => (
                      <SelectItem key={batch.id} value={batch.id}>
                        {batch.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Textarea
                  value={importDraft.csv}
                  placeholder={'Alem Kebede, ETS0101, A\nBirtukan Mengistu, ETS0102, B'}
                  aria-label="Student list"
                  className="min-h-24 font-mono text-xs"
                  onChange={(event) => setImportDraft((prev) => ({ ...prev, csv: event.target.value }))}
                />
                <Button type="submit" disabled={busy === 'student-import' || !importDraft.batchId || !importDraft.csv.trim()}>
                  <Upload className="mr-1.5 h-4 w-4" /> Import list
                </Button>
              </form>
            </div>

            <div>
              {students.map((student) => (
                <div
                  key={student.id}
                  className="flex items-center justify-between gap-3 border-b border-[#eef2f6] py-2.5 last:border-b-0"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-[#000a1e]">{student.fullName}</p>
                    <p className="text-xs text-[#74777f]">
                      {student.batchLabel}
                      {student.externalId ? ` · ${student.externalId}` : ''}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Select
                      value={student.subgroup ?? NONE}
                      disabled={busy === `student-${student.id}`}
                      onValueChange={(subgroup) =>
                        void run(
                          `student-${student.id}`,
                          async () => {
                            await updateStudent(client!, student.id, {
                              subgroup: subgroup === NONE ? null : (subgroup as 'A' | 'B'),
                            })
                            await load()
                          },
                          'Unable to move the student.',
                        )
                      }
                    >
                      <SelectTrigger className="w-[90px]" aria-label={`Subgroup for ${student.fullName}`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NONE}>-</SelectItem>
                        <SelectItem value="A">A</SelectItem>
                        <SelectItem value="B">B</SelectItem>
                      </SelectContent>
                    </Select>
                    <Switch
                      checked={student.active}
                      disabled={busy === `student-${student.id}`}
                      aria-label={`Toggle ${student.fullName} active`}
                      onCheckedChange={(active) =>
                        void run(
                          `student-${student.id}`,
                          async () => {
                            await updateStudent(client!, student.id, { active })
                            await load()
                          },
                          'Unable to update the student.',
                        )
                      }
                    />
                  </div>
                </div>
              ))}
            </div>
          </TabsContent>

          {/* ---- Placements ---- */}
          <TabsContent value="placements" className="mt-5 space-y-5">
            <form
              className="grid gap-3 rounded-[0.4rem] border border-[#eef2f6] bg-[#f8fafc] p-4 sm:grid-cols-2 lg:grid-cols-5"
              onSubmit={(event) => {
                event.preventDefault()
                void run(
                  'placement-create',
                  async () => {
                    await saveSubgroupPlacement(client!, placementDraft)
                    setPlacementDraft((prev) => ({ ...prev, weekStartsOn: '' }))
                    toast.success('Placement saved; the week\'s sessions were refreshed.')
                    await load()
                  },
                  'Unable to save the placement.',
                )
              }}
            >
              <Select
                value={placementDraft.batchId}
                onValueChange={(batchId) => setPlacementDraft((prev) => ({ ...prev, batchId }))}
              >
                <SelectTrigger aria-label="Placement batch">
                  <SelectValue placeholder="Batch" />
                </SelectTrigger>
                <SelectContent>
                  {activeBatches.map((batch) => (
                    <SelectItem key={batch.id} value={batch.id}>
                      {batch.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={placementDraft.subgroup}
                onValueChange={(subgroup) => setPlacementDraft((prev) => ({ ...prev, subgroup: subgroup as 'A' | 'B' }))}
              >
                <SelectTrigger aria-label="Placement subgroup">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="A">Subgroup A</SelectItem>
                  <SelectItem value="B">Subgroup B</SelectItem>
                </SelectContent>
              </Select>
              <Select
                value={placementDraft.wardId}
                onValueChange={(wardId) => setPlacementDraft((prev) => ({ ...prev, wardId }))}
              >
                <SelectTrigger aria-label="Placement ward">
                  <SelectValue placeholder="Ward" />
                </SelectTrigger>
                <SelectContent>
                  {wards.map((ward) => (
                    <SelectItem key={ward.id} value={ward.id}>
                      {ward.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                type="date"
                value={placementDraft.weekStartsOn}
                aria-label="Week starting"
                onChange={(event) => setPlacementDraft((prev) => ({ ...prev, weekStartsOn: event.target.value }))}
              />
              <Button
                type="submit"
                disabled={
                  busy === 'placement-create' ||
                  !placementDraft.batchId ||
                  !placementDraft.wardId ||
                  !placementDraft.weekStartsOn
                }
              >
                <Plus className="mr-1.5 h-4 w-4" /> Place week
              </Button>
            </form>

            {placements.length === 0 ? (
              <SectionEmptyState
                icon={<GraduationCap className="h-6 w-6" />}
                title="No placements yet"
                description="Weekly movement between wards is manual: place each subgroup on its ward week by week."
              />
            ) : (
              <div>
                {placements.map((placement) => (
                  <div
                    key={placement.id}
                    className="flex items-center justify-between gap-3 border-b border-[#eef2f6] py-2.5 last:border-b-0"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-[#000a1e]">
                        {placement.batchLabel} · Subgroup {placement.subgroup} → {placement.wardName}
                      </p>
                      <p className="text-xs text-[#74777f]">
                        Week {placement.weekStartsOn} to {placement.weekEndsOn}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </TabsContent>

          {/* ---- Reps ---- */}
          <TabsContent value="reps" className="mt-5 space-y-5">
            <form
              className="grid gap-3 rounded-[0.4rem] border border-[#eef2f6] bg-[#f8fafc] p-4 sm:grid-cols-2 lg:grid-cols-4"
              onSubmit={(event) => {
                event.preventDefault()
                void run(
                  'rep-create',
                  async () => {
                    await createRepAssignment(client!, repDraft)
                    toast.success('Rep assignment saved.')
                    await load()
                  },
                  'Unable to assign the rep.',
                )
              }}
            >
              <Select value={repDraft.userId} onValueChange={(userId) => setRepDraft((prev) => ({ ...prev, userId }))}>
                <SelectTrigger aria-label="Rep account">
                  <SelectValue placeholder="Rep account" />
                </SelectTrigger>
                <SelectContent>
                  {repAccounts.map((account) => (
                    <SelectItem key={account.id} value={account.id}>
                      {account.fullName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={repDraft.batchId} onValueChange={(batchId) => setRepDraft((prev) => ({ ...prev, batchId }))}>
                <SelectTrigger aria-label="Rep batch">
                  <SelectValue placeholder="Batch" />
                </SelectTrigger>
                <SelectContent>
                  {activeBatches.map((batch) => (
                    <SelectItem key={batch.id} value={batch.id}>
                      {batch.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={repDraft.scope}
                onValueChange={(scope) => setRepDraft((prev) => ({ ...prev, scope: scope as RepAssignmentRecord['scope'] }))}
              >
                <SelectTrigger aria-label="Rep scope">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(REP_SCOPE_LABELS).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button type="submit" disabled={busy === 'rep-create' || !repDraft.userId || !repDraft.batchId}>
                <Plus className="mr-1.5 h-4 w-4" /> Assign rep
              </Button>
              {repAccounts.length === 0 ? (
                <p className="text-xs text-[#74777f] sm:col-span-2 lg:col-span-4">
                  No rep accounts yet: create users with the Student representative role in Users &amp; Access first.
                  Reps can record held / not held only; they can never reach evaluations or scores.
                </p>
              ) : null}
            </form>

            <div>
              {reps.map((rep) => (
                <div
                  key={rep.id}
                  className="flex items-center justify-between gap-3 border-b border-[#eef2f6] py-2.5 last:border-b-0"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-[#000a1e]">{rep.userName}</p>
                    <p className="text-xs text-[#74777f]">
                      {rep.batchLabel} · {REP_SCOPE_LABELS[rep.scope]}
                    </p>
                  </div>
                  <Switch
                    checked={rep.active}
                    disabled={busy === `rep-${rep.id}`}
                    aria-label={`Toggle rep assignment for ${rep.userName}`}
                    onCheckedChange={(active) =>
                      void run(
                        `rep-${rep.id}`,
                        async () => {
                          await setRepAssignmentActive(client!, rep.id, active)
                          await load()
                        },
                        'Unable to update the rep assignment.',
                      )
                    }
                  />
                </div>
              ))}
            </div>
          </TabsContent>

          {/* ---- Sessions oversight ---- */}
          <TabsContent value="sessions" className="mt-5">
            {sessions.length === 0 ? (
              <SectionEmptyState
                icon={<GraduationCap className="h-6 w-6" />}
                title="No sessions yet"
                description="Sessions generate daily from the weekly programs once a batch is active."
              />
            ) : (
              <div>
                {sessions.map((session) => (
                  <div key={session.id} className="border-b border-[#eef2f6] py-2.5 last:border-b-0">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-[#000a1e]">
                          {ACTIVITY_LABELS[session.activityType]}
                          {session.subgroup ? ` · ${session.subgroup}` : ''}
                          <span className="font-normal text-[#74777f]"> · {session.batchLabel}</span>
                        </p>
                        <p className="text-xs text-[#74777f]">
                          {session.scheduledDate}
                          {session.wardName ? ` · ${session.wardName}` : ' · no ward'}
                          {session.reason ? ` · "${session.reason}"` : ''}
                          {session.attendanceCount ? ` · ${session.attendanceCount} attendance rows` : ''}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <Badge variant={sessionStatusVariant[session.status]}>
                          {session.status === 'not_held' ? 'Not held' : session.status}
                        </Badge>
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
                          placeholder="Why is it cancelled? (holiday, exam week, ...)"
                          aria-label="Cancellation reason"
                          className="min-h-[44px] w-full max-w-md"
                          rows={1}
                          onChange={(event) =>
                            setCancelDraft((prev) => ({ ...prev, reason: event.target.value }))
                          }
                        />
                        <Button
                          size="sm"
                          disabled={!cancelDraft.reason.trim() || busy === `cancel-${session.id}`}
                          onClick={() =>
                            void run(
                              `cancel-${session.id}`,
                              async () => {
                                await cancelTeachingSession(client!, session.id, cancelDraft.reason.trim())
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
          </TabsContent>
        </Tabs>
      </section>
    </div>
  )
}
