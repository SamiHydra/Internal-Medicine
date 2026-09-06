import { useCallback, useEffect, useState } from 'react'
import { GraduationCap, Loader2, Save } from 'lucide-react'
import { toast } from 'sonner'

import { EvaluationFormRenderer } from '@/components/academic/evaluation-form-renderer'
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
import { fetchEvaluationForm, type EvaluationFormDefinition } from '@/lib/api/academic'
import {
  ACTIVITY_LABELS,
  fetchStudentOptions,
  fetchTodayTeachingSessions,
  saveSessionAttendance,
  submitStudentEvaluation,
  type AttendanceSession,
  type StudentOption,
} from '@/lib/api/teaching'
import { getApiBrowserClient } from '@/lib/api/client'
import { cn } from '@/lib/utils'
import { getErrorMessage } from '@/lib/api/helpers'

const todayString = new Date().toISOString().slice(0, 10)

/**
 * The consultant's undergraduate surface (V2 Phase 5): mark today's session
 * attendance student by student, and file weekly / final student evaluations
 * through the Phase 4 form engine. Students are deliberately not ward-gated:
 * any consultant may evaluate any student.
 */
export function TeachingAttendancePage() {
  const client = getApiBrowserClient()

  const [sessions, setSessions] = useState<AttendanceSession[] | null>(null)
  const [students, setStudents] = useState<StudentOption[]>([])
  const [weeklyForm, setWeeklyForm] = useState<EvaluationFormDefinition | null>(null)
  const [finalForm, setFinalForm] = useState<EvaluationFormDefinition | null>(null)
  const [openSessionId, setOpenSessionId] = useState<string | null>(null)
  // Staged presence per session id: studentId -> present.
  const [presence, setPresence] = useState<Record<string, Record<string, boolean>>>({})
  const [busyId, setBusyId] = useState<string | null>(null)
  const [formKey, setFormKey] = useState<'student_weekly' | 'student_final'>('student_weekly')
  const [evaluationDate, setEvaluationDate] = useState(todayString)

  /**
   * Sessions only. Saving attendance cannot change the student directory or
   * the evaluation form definitions, so those are fetched once on mount and
   * never again (see INTERACTION_LATENCY_AUDIT.md).
   */
  const reloadSessions = useCallback(async () => {
    if (client) {
      setSessions(await fetchTodayTeachingSessions(client))
    }
  }, [client])

  const load = useCallback(async () => {
    if (!client) {
      setSessions([])
      return
    }

    try {
      const [todaySessions, studentOptions, weekly, final] = await Promise.all([
        fetchTodayTeachingSessions(client),
        fetchStudentOptions(client),
        fetchEvaluationForm(client, 'student_weekly'),
        fetchEvaluationForm(client, 'student_final'),
      ])
      setSessions(todaySessions)
      setStudents(studentOptions)
      setWeeklyForm(weekly)
      setFinalForm(final)
    } catch {
      setSessions([])
      toast.error('Unable to load the teaching sessions.')
    }
  }, [client])

  useEffect(() => {
    void load()
  }, [load])

  const stagedFor = (session: AttendanceSession): Record<string, boolean> =>
    presence[session.id] ??
    Object.fromEntries(session.roster.map((student) => [student.id, student.present ?? true]))

  const saveAttendance = async (session: AttendanceSession) => {
    if (!client) {
      return
    }

    setBusyId(session.id)
    try {
      await saveSessionAttendance(client, session.id, stagedFor(session))
      toast.success('Attendance saved.')
      setOpenSessionId(null)
      setPresence((prev) => {
        const next = { ...prev }
        delete next[session.id]
        return next
      })
      await reloadSessions()
    } catch (error) {
      toast.error(getErrorMessage(error, 'Unable to save attendance.'))
    } finally {
      setBusyId(null)
    }
  }

  const activeForm = formKey === 'student_weekly' ? weeklyForm : finalForm

  return (
    <div className="space-y-6 px-4 py-6 md:px-6 md:py-8">
      <section className={panelClass}>
        <SectionHeader
          eyebrow="Undergraduate teaching"
          description="Record who attended today's activities, and evaluate students at the end of each ward week and at the end of the attachment."
        />

        <Tabs defaultValue="attendance" className="mt-5">
          <TabsList>
            <TabsTrigger value="attendance">Today's attendance</TabsTrigger>
            <TabsTrigger value="evaluate">Evaluate a student</TabsTrigger>
          </TabsList>

          {/* ---- Attendance ---- */}
          <TabsContent value="attendance" className="mt-5">
            {sessions === null ? (
              <div className="flex min-h-[200px] items-center justify-center text-[#74777f]">
                <Loader2 className="h-5 w-5 animate-spin" aria-label="Loading sessions" />
              </div>
            ) : sessions.length === 0 ? (
              <SectionEmptyState
                icon={<GraduationCap className="h-6 w-6" />}
                title="No sessions today"
                description="Today's scheduled undergraduate activities appear here once generated."
              />
            ) : (
              <div>
                {sessions.map((session) => {
                  const isOpen = openSessionId === session.id
                  const staged = stagedFor(session)
                  const presentCount = Object.values(staged).filter(Boolean).length

                  return (
                    <div key={session.id} className="border-b border-[#eef2f6] py-3.5 last:border-b-0">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-[#000a1e]">
                            {ACTIVITY_LABELS[session.activityType]}
                            {session.subgroup ? ` · Subgroup ${session.subgroup}` : ''}
                            <span className="font-normal text-[#74777f]"> · {session.batchLabel}</span>
                          </p>
                          <p className="mt-0.5 text-xs text-[#74777f]">
                            {session.wardName ?? 'No ward assigned'} · {session.roster.length} students
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <Badge variant={session.status === 'held' ? 'success' : 'info'}>
                            {session.status}
                          </Badge>
                          <Button
                            size="sm"
                            variant={isOpen ? 'secondary' : 'default'}
                            onClick={() => setOpenSessionId(isOpen ? null : session.id)}
                          >
                            {isOpen ? 'Close' : 'Take attendance'}
                          </Button>
                        </div>
                      </div>

                      {isOpen ? (
                        <div className="mt-3 rounded-[0.35rem] border border-[#e6ecf3] bg-[#f8fafc] p-4">
                          <div className="grid gap-2 sm:grid-cols-2">
                            {session.roster.map((student) => {
                              const isPresent = staged[student.id]
                              return (
                                <label
                                  key={student.id}
                                  className={cn(
                                    'flex cursor-pointer items-center justify-between gap-3 rounded-[0.25rem] border bg-white px-3.5 py-2.5 transition',
                                    isPresent ? 'border-[#005db6]' : 'border-[#d4dde8] opacity-70',
                                  )}
                                >
                                  <span className="text-sm font-medium text-[#000a1e]">{student.fullName}</span>
                                  <Switch
                                    checked={isPresent}
                                    aria-label={`${student.fullName} present`}
                                    onCheckedChange={(checked) =>
                                      setPresence((prev) => ({
                                        ...prev,
                                        [session.id]: { ...stagedFor(session), [student.id]: checked },
                                      }))
                                    }
                                  />
                                </label>
                              )
                            })}
                          </div>
                          <div className="mt-3 flex items-center justify-between">
                            <p className="text-xs text-[#74777f]">
                              {presentCount} of {session.roster.length} present
                            </p>
                            <Button
                              size="sm"
                              disabled={busyId === session.id}
                              onClick={() => void saveAttendance(session)}
                            >
                              {busyId === session.id ? (
                                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                              ) : (
                                <Save className="mr-1.5 h-4 w-4" />
                              )}
                              Save attendance
                            </Button>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  )
                })}
              </div>
            )}
          </TabsContent>

          {/* ---- Student evaluation ---- */}
          <TabsContent value="evaluate" className="mt-5 space-y-5">
            <div className="flex flex-wrap items-end gap-3">
              <Select value={formKey} onValueChange={(value) => setFormKey(value as typeof formKey)}>
                <SelectTrigger className="w-[260px]" aria-label="Evaluation kind">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="student_weekly">Weekly ward evaluation</SelectItem>
                  <SelectItem value="student_final">Final attachment evaluation</SelectItem>
                </SelectContent>
              </Select>
              <div className="space-y-1">
                <Input
                  type="date"
                  max={todayString}
                  value={evaluationDate}
                  aria-label="Evaluation date"
                  onChange={(event) => setEvaluationDate(event.target.value || todayString)}
                />
              </div>
            </div>

            {!client || !activeForm ? null : students.length === 0 ? (
              <SectionEmptyState
                icon={<GraduationCap className="h-6 w-6" />}
                title="No active students"
                description="Students appear here once an administrator creates a batch and its roster."
              />
            ) : (
              <EvaluationFormRenderer
                key={`${formKey}-${evaluationDate}`}
                client={client}
                form={activeForm}
                direction="resident"
                date={evaluationDate}
                subjects={students.map((student) => ({
                  id: student.id,
                  fullName: `${student.fullName} · ${student.batchLabel ?? ''}${
                    student.currentWardName ? ` · ${student.currentWardName}` : ''
                  }`,
                }))}
                subjectLabel="Student evaluated"
                onSubmitted={() => void load()}
                submit={(payload) =>
                  submitStudentEvaluation(client, {
                    ...payload,
                    formKey,
                    studentId: String(payload.subjectId ?? ''),
                  })
                }
              />
            )}
          </TabsContent>
        </Tabs>
      </section>
    </div>
  )
}
