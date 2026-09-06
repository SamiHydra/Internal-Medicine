import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  differenceInCalendarWeeks,
  endOfWeek,
  format,
  isAfter,
  isBefore,
  isValid,
  parseISO,
  startOfDay,
  startOfWeek,
} from 'date-fns';
import { GraduationCap, Loader2, Plus, Upload, X } from 'lucide-react';
import { toast } from 'sonner';

import { CreateStudentRepForm } from '@/components/admin/create-student-rep-form';
import { TeachingSchedulePanel } from '@/components/admin/teaching-schedule-panel';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { AcademicWorkspaceHero } from '@/components/admin/academic-workspace-hero';
import {
  SectionEmptyState,
  panelClass,
} from '@/components/dashboard/section-panel';
import { useAppData } from '@/context/app-data-context';
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
} from '@/lib/api/teaching';
import {
  fetchAcademicWards,
  type AcademicWard,
} from '@/lib/api/academic-structure';
import { getApiBrowserClient } from '@/lib/api/client';
import { getErrorMessage } from '@/lib/api/helpers';
import { cn } from '@/lib/utils';

const NONE = 'none';
const ANY_BATCH = 'any';

const sessionStatusVariant: Record<
  OversightSessionRecord['status'],
  'info' | 'success' | 'danger' | 'neutral'
> = {
  pending: 'info',
  held: 'success',
  not_held: 'danger',
  cancelled: 'neutral',
};

/**
 * The week a picked date actually lands on. The API snaps whatever day is sent
 * to that week's Monday (Carbon's startOfWeek), so the form shows the resolved
 * Monday-to-Sunday span rather than leaving the admin to infer it.
 */
function resolveWeekLabel(picked: string): string | null {
  if (!picked) {
    return null;
  }

  const date = parseISO(picked);

  if (!isValid(date)) {
    return null;
  }

  const start = startOfWeek(date, { weekStartsOn: 1 });
  const end = endOfWeek(date, { weekStartsOn: 1 });

  return `${format(start, 'EEE d MMM')} to ${format(end, 'EEE d MMM yyyy')}`;
}

const fieldCaptionClass =
  'text-[11px] font-bold uppercase tracking-[0.1em] text-[#8794a5]';

/**
 * Where a batch sits against today: the block's own dates decide, independently
 * of the active flag (a finished block can still be active, and pausing a
 * running one does not rewind it).
 */
function describeBatch(startsOn: string, endsOn: string) {
  const start = parseISO(startsOn);
  const end = parseISO(endsOn);

  if (!isValid(start) || !isValid(end)) {
    return null;
  }

  const today = startOfDay(new Date());
  const weekOptions = { weekStartsOn: 1 } as const;
  const totalWeeks = Math.max(
    1,
    differenceInCalendarWeeks(end, start, weekOptions) + 1,
  );
  const currentWeek = Math.min(
    totalWeeks,
    Math.max(1, differenceInCalendarWeeks(today, start, weekOptions) + 1),
  );

  return {
    phase: isBefore(today, start)
      ? ('upcoming' as const)
      : isAfter(today, end)
        ? ('finished' as const)
        : ('running' as const),
    totalWeeks,
    currentWeek,
    range: `${format(start, 'd MMM')} to ${format(end, 'd MMM yyyy')}`,
    startLabel: format(start, 'd MMM yyyy'),
  };
}

/**
 * Admin management of the undergraduate module (V2 Phase 5): batches,
 * student rosters (with paste import), weekly subgroup placements, rep
 * accounts, and the teaching-session oversight board.
 */
export function StudentsPage() {
  const client = getApiBrowserClient();
  const { state, ensureProfileDirectoryData } = useAppData();

  const [batches, setBatches] = useState<StudentBatchRecord[] | null>(null);
  const [students, setStudents] = useState<StudentRecord[]>([]);
  const [placements, setPlacements] = useState<SubgroupPlacementRecord[]>([]);
  const [reps, setReps] = useState<RepAssignmentRecord[]>([]);
  const [sessions, setSessions] = useState<OversightSessionRecord[]>([]);
  const [wards, setWards] = useState<AcademicWard[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const [batchDraft, setBatchDraft] = useState({
    cohort: 'C1' as 'C1' | 'C2',
    label: '',
    startsOn: '',
    endsOn: '',
  });
  const [studentDraft, setStudentDraft] = useState({
    batchId: '',
    fullName: '',
    subgroup: NONE,
  });
  const [importDraft, setImportDraft] = useState({ batchId: '', csv: '' });
  const [studentQuery, setStudentQuery] = useState('');
  const [studentBatchFilter, setStudentBatchFilter] = useState(ANY_BATCH);
  const [placementDraft, setPlacementDraft] = useState({
    batchId: '',
    subgroup: 'A' as 'A' | 'B',
    wardId: '',
    weekStartsOn: '',
  });
  const [repDraft, setRepDraft] = useState({
    userId: '',
    batchId: '',
    scope: 'group' as RepAssignmentRecord['scope'],
  });
  const [cancelDraft, setCancelDraft] = useState({ sessionId: '', reason: '' });

  // Per-collection loaders. Mutations refresh only what the server could have
  // changed; most update state straight from the mutation response and fetch
  // nothing. Reloading all six after every edit was the main source of the
  // multi-second toggle latency (see INTERACTION_LATENCY_AUDIT.md).
  const loadBatches = useCallback(async () => {
    if (client) setBatches(await fetchStudentBatches(client));
  }, [client]);

  const loadStudents = useCallback(async () => {
    if (client) setStudents(await fetchStudents(client));
  }, [client]);

  const loadReps = useCallback(async () => {
    if (client) setReps(await fetchRepAssignments(client));
  }, [client]);

  const loadSessions = useCallback(async () => {
    if (client) setSessions(await fetchOversightSessions(client));
  }, [client]);

  /** Full fetch: first mount only. */
  const load = useCallback(async () => {
    if (!client) {
      setBatches([]);
      return;
    }

    try {
      const [
        batchData,
        studentData,
        placementData,
        repData,
        sessionData,
        wardData,
      ] = await Promise.all([
        fetchStudentBatches(client),
        fetchStudents(client),
        fetchSubgroupPlacements(client),
        fetchRepAssignments(client),
        fetchOversightSessions(client),
        fetchAcademicWards(client),
      ]);
      setBatches(batchData);
      setStudents(studentData);
      setPlacements(placementData);
      setReps(repData);
      setSessions(sessionData);
      setWards(wardData.filter((ward) => ward.active));
    } catch {
      setBatches([]);
      toast.error('Unable to load the undergraduate module.');
    }
  }, [client]);

  useEffect(() => {
    void load();
    // Rep accounts come from the user directory.
    void ensureProfileDirectoryData();
  }, [load, ensureProfileDirectoryData]);

  const repAccounts = useMemo(
    () =>
      state.profiles
        .filter((profile) => profile.role === 'student_rep' && profile.active)
        .sort((a, b) => a.fullName.localeCompare(b.fullName)),
    [state.profiles],
  );

  const run = async (
    key: string,
    action: () => Promise<void>,
    failure: string,
  ) => {
    if (!client) {
      return;
    }
    setBusy(key);
    try {
      await action();
    } catch (error) {
      toast.error(getErrorMessage(error, failure));
    } finally {
      setBusy(null);
    }
  };

  const activeBatches = (batches ?? []).filter((batch) => batch.active);
  const placementWeekLabel = resolveWeekLabel(placementDraft.weekStartsOn);

  const query = studentQuery.trim().toLowerCase();
  const visibleStudents = students.filter(
    (student) =>
      (studentBatchFilter === ANY_BATCH ||
        student.batchId === studentBatchFilter) &&
      (query === '' ||
        student.fullName.toLowerCase().includes(query) ||
        (student.externalId ?? '').toLowerCase().includes(query)),
  );
  // Students with no subgroup never appear on bedside or teaching-round
  // rosters, so the count is surfaced rather than left to be discovered.
  const unassignedCount = students.filter(
    (student) => student.subgroup === null,
  ).length;

  if (batches === null) {
    return (
      <div className="flex min-h-[300px] items-center justify-center text-[#74777f]">
        <Loader2
          className="h-5 w-5 animate-spin"
          aria-label="Loading students"
        />
      </div>
    );
  }

  return (
    <div className="space-y-5 px-4 py-6 md:px-8">
      <AcademicWorkspaceHero
        eyebrow="Undergraduate students"
        title="Undergraduate programme"
        description="Manage active batches, student rosters, weekly placements, representatives, and teaching-session oversight."
        metrics={[
          {
            label: 'Students',
            value: String(students.length),
            note: 'Across all batches',
          },
          {
            label: 'Batches',
            value: String(batches.length),
            note: `${activeBatches.length} active`,
          },
          {
            label: 'Representatives',
            value: String(reps.length),
            note: 'Assigned accounts',
          },
          { label: 'Work areas', value: '5', note: 'Programme workflows' },
        ]}
      />

      <section className={panelClass}>
        <Tabs defaultValue="batches">
          <TabsList className="max-w-full justify-start overflow-x-auto [&>button]:shrink-0 [&>button]:whitespace-nowrap">
            <TabsTrigger value="batches">
              Batches ({batches.length})
            </TabsTrigger>
            <TabsTrigger value="students">
              Students ({students.length})
            </TabsTrigger>
            <TabsTrigger value="placements">Placements</TabsTrigger>
            <TabsTrigger value="reps">Reps ({reps.length})</TabsTrigger>
            <TabsTrigger value="schedule">Schedule</TabsTrigger>
            <TabsTrigger value="sessions">Sessions</TabsTrigger>
          </TabsList>

          {/* ---- Weekly teaching schedule ---- */}
          <TabsContent value="schedule" className="mt-5">
            <TeachingSchedulePanel />
          </TabsContent>

          {/* ---- Batches ---- */}
          <TabsContent value="batches" className="mt-5 space-y-5">
            <form
              className="grid gap-3 rounded-[0.4rem] border border-[#eef2f6] bg-[#f8fafc] p-4 sm:grid-cols-2 lg:grid-cols-5"
              onSubmit={(event) => {
                event.preventDefault();
                void run(
                  'batch-create',
                  async () => {
                    await createStudentBatch(client!, batchDraft);
                    setBatchDraft({
                      cohort: 'C1',
                      label: '',
                      startsOn: '',
                      endsOn: '',
                    });
                    toast.success('Batch created.');
                    // Server orders by start date, so re-read the one list.
                    await loadBatches();
                  },
                  'Unable to create the batch.',
                );
              }}
            >
              <label className="flex flex-col gap-1.5">
                <span className={fieldCaptionClass}>Cohort</span>
                <Select
                  value={batchDraft.cohort}
                  onValueChange={(cohort) =>
                    setBatchDraft((prev) => ({
                      ...prev,
                      cohort: cohort as 'C1' | 'C2',
                    }))
                  }
                >
                  <SelectTrigger aria-label="Cohort">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="C1">C1 (Year 3, 12 weeks)</SelectItem>
                    <SelectItem value="C2">C2 (Year 4, 8 weeks)</SelectItem>
                  </SelectContent>
                </Select>
              </label>
              <label className="flex flex-col gap-1.5">
                <span className={fieldCaptionClass}>Label</span>
                <Input
                  value={batchDraft.label}
                  placeholder="e.g. C1 2026-A"
                  aria-label="Batch label"
                  onChange={(event) =>
                    setBatchDraft((prev) => ({
                      ...prev,
                      label: event.target.value,
                    }))
                  }
                />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className={fieldCaptionClass}>Starts</span>
                <Input
                  type="date"
                  value={batchDraft.startsOn}
                  aria-label="Batch start"
                  onChange={(event) =>
                    setBatchDraft((prev) => ({
                      ...prev,
                      startsOn: event.target.value,
                    }))
                  }
                />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className={fieldCaptionClass}>Ends</span>
                <Input
                  type="date"
                  value={batchDraft.endsOn}
                  aria-label="Batch end"
                  onChange={(event) =>
                    setBatchDraft((prev) => ({
                      ...prev,
                      endsOn: event.target.value,
                    }))
                  }
                />
              </label>
              <Button
                type="submit"
                className="self-end"
                disabled={
                  busy === 'batch-create' ||
                  !batchDraft.label.trim() ||
                  !batchDraft.startsOn ||
                  !batchDraft.endsOn
                }
              >
                <Plus className="mr-1.5 h-4 w-4" /> Add batch
              </Button>
            </form>

            <div className="overflow-hidden rounded-[0.4rem] border border-[#e1e7ee] bg-white">
              {batches.map((batch) => {
                const meta = describeBatch(batch.startsOn, batch.endsOn);

                return (
                <div
                  key={batch.id}
                  className="grid gap-3 border-t border-[#eef2f6] px-4 py-3.5 first:border-t-0 sm:grid-cols-[auto_minmax(0,1fr)_180px_76px_auto] sm:items-center sm:gap-4"
                >
                  <span
                    aria-hidden
                    className={cn(
                      'flex h-10 w-10 shrink-0 items-center justify-center rounded-[0.35rem] text-[12px] font-bold tracking-[0.02em]',
                      batch.cohort === 'C2'
                        ? 'bg-[#fdf3dd] text-[#8a6100]'
                        : 'bg-[#e8f0fb] text-[#005db6]',
                    )}
                  >
                    {batch.cohort}
                  </span>

                  <div className="min-w-0">
                    <p className="truncate text-[15px] font-semibold tracking-[-0.01em] text-[#000a1e]">
                      {batch.label}
                    </p>
                    <p className="mt-0.5 text-[13px] leading-5 text-[#74777f]">
                      {meta
                        ? `${meta.range} · ${meta.totalWeeks} weeks`
                        : `${batch.startsOn} to ${batch.endsOn}`}
                    </p>
                  </div>

                  <div className="min-w-0">
                    {meta?.phase === 'running' ? (
                      <>
                        <p className="text-[12px] font-bold uppercase tracking-[0.1em] text-[#000a1e]">
                          Week {meta.currentWeek} of {meta.totalWeeks}
                        </p>
                        <span
                          aria-hidden
                          className="mt-1.5 block h-[3px] w-full overflow-hidden rounded-full bg-[#eef2f6]"
                        >
                          <span
                            className="block h-full rounded-full bg-[#04162f]"
                            style={{
                              width: `${(meta.currentWeek / meta.totalWeeks) * 100}%`,
                            }}
                          />
                        </span>
                      </>
                    ) : (
                      <p className="text-[12px] font-bold uppercase tracking-[0.1em] text-[#97a2b0]">
                        {meta?.phase === 'upcoming'
                          ? `Starts ${meta.startLabel}`
                          : 'Finished'}
                      </p>
                    )}
                  </div>

                  <div className="sm:text-right">
                    <p className="text-[15px] font-bold tabular-nums text-[#000a1e]">
                      {batch.studentCount}
                    </p>
                    <p className="text-[10.5px] font-bold uppercase tracking-[0.11em] text-[#97a2b0]">
                      Students
                    </p>
                  </div>

                  <div className="flex shrink-0 items-center gap-2.5">
                    <span
                      className={cn(
                        'text-[12px] font-bold uppercase tracking-[0.1em]',
                        batch.active ? 'text-[#000a1e]' : 'text-[#97a2b0]',
                      )}
                    >
                      {batch.active ? 'Active' : 'Paused'}
                    </span>
                    <Switch
                      checked={batch.active}
                      disabled={busy === `batch-${batch.id}`}
                      aria-label={`Toggle ${batch.label} active`}
                      onCheckedChange={(active) =>
                        void run(
                          `batch-${batch.id}`,
                          async () => {
                            const updated = await updateStudentBatch(
                              client!,
                              batch.id,
                              { active },
                            );
                            setBatches((prev) =>
                              (prev ?? []).map((item) =>
                                item.id === updated.id ? updated : item,
                              ),
                            );
                            // Deactivating a batch also deactivates its rep
                            // assignments server-side, so that list is stale.
                            if (!active) {
                              await loadReps();
                            }
                          },
                          'Unable to update the batch.',
                        )
                      }
                    />
                  </div>
                </div>
                );
              })}
            </div>
          </TabsContent>

          {/* ---- Students ---- */}
          <TabsContent value="students" className="mt-5 space-y-5">
            <div className="grid gap-4 lg:grid-cols-2">
              <form
                className="space-y-3 rounded-[0.4rem] border border-[#eef2f6] bg-[#f8fafc] p-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  void run(
                    'student-create',
                    async () => {
                      await createStudent(client!, {
                        batchId: studentDraft.batchId,
                        fullName: studentDraft.fullName.trim(),
                        subgroup:
                          studentDraft.subgroup === NONE
                            ? null
                            : (studentDraft.subgroup as 'A' | 'B'),
                      });
                      setStudentDraft((prev) => ({ ...prev, fullName: '' }));
                      toast.success('Student added.');
                      // Adding a student changes that batch's studentCount too.
                      await Promise.all([loadStudents(), loadBatches()]);
                    },
                    'Unable to add the student.',
                  );
                }}
              >
                <p className="text-[15px] font-semibold tracking-[-0.01em] text-[#000a1e]">
                  Add one student
                </p>
                <label className="flex flex-col gap-1.5">
                  <span className={fieldCaptionClass}>Batch</span>
                  <Select
                    value={studentDraft.batchId}
                    onValueChange={(batchId) =>
                      setStudentDraft((prev) => ({ ...prev, batchId }))
                    }
                  >
                    <SelectTrigger aria-label="Batch">
                      <SelectValue placeholder="Choose a batch" />
                    </SelectTrigger>
                    <SelectContent>
                      {activeBatches.map((batch) => (
                        <SelectItem key={batch.id} value={batch.id}>
                          {batch.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </label>
                <label className="flex flex-col gap-1.5">
                  <span className={fieldCaptionClass}>Full name</span>
                  <Input
                    value={studentDraft.fullName}
                    placeholder="e.g. Abel Bekele"
                    aria-label="Student full name"
                    onChange={(event) =>
                      setStudentDraft((prev) => ({
                        ...prev,
                        fullName: event.target.value,
                      }))
                    }
                  />
                </label>
                <label className="flex flex-col gap-1.5">
                  <span className={fieldCaptionClass}>Subgroup</span>
                  <Select
                    value={studentDraft.subgroup}
                    onValueChange={(subgroup) =>
                      setStudentDraft((prev) => ({ ...prev, subgroup }))
                    }
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
                </label>
                <Button
                  type="submit"
                  disabled={
                    busy === 'student-create' ||
                    !studentDraft.batchId ||
                    !studentDraft.fullName.trim()
                  }
                >
                  <Plus className="mr-1.5 h-4 w-4" /> Add student
                </Button>
              </form>

              <form
                className="space-y-3 rounded-[0.4rem] border border-[#eef2f6] bg-[#f8fafc] p-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  void run(
                    'student-import',
                    async () => {
                      const result = await importStudents(client!, importDraft);
                      setImportDraft((prev) => ({ ...prev, csv: '' }));
                      toast.success(
                        `Imported ${result.created} students (${result.skipped} skipped).`,
                      );
                      await Promise.all([loadStudents(), loadBatches()]);
                    },
                    'Unable to import the list.',
                  );
                }}
              >
                <div>
                  <p className="text-[15px] font-semibold tracking-[-0.01em] text-[#000a1e]">
                    Paste a list
                  </p>
                  <p className="mt-1 text-[13px] leading-5 text-[#74777f]">
                    One student per line: name first, then an optional ID and an
                    optional subgroup, separated by commas.
                  </p>
                </div>
                <label className="flex flex-col gap-1.5">
                  <span className={fieldCaptionClass}>Batch</span>
                  <Select
                    value={importDraft.batchId}
                    onValueChange={(batchId) =>
                      setImportDraft((prev) => ({ ...prev, batchId }))
                    }
                  >
                    <SelectTrigger aria-label="Import batch">
                      <SelectValue placeholder="Choose a batch" />
                    </SelectTrigger>
                    <SelectContent>
                      {activeBatches.map((batch) => (
                        <SelectItem key={batch.id} value={batch.id}>
                          {batch.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </label>
                <label className="flex flex-col gap-1.5">
                  <span className={fieldCaptionClass}>Students</span>
                  <Textarea
                    value={importDraft.csv}
                    placeholder={
                      'Alem Kebede, ETS0101, A\nBirtukan Mengistu, ETS0102, B'
                    }
                    aria-label="Student list"
                    className="min-h-24 font-mono text-[13px]"
                    onChange={(event) =>
                      setImportDraft((prev) => ({
                        ...prev,
                        csv: event.target.value,
                      }))
                    }
                  />
                </label>
                <Button
                  type="submit"
                  disabled={
                    busy === 'student-import' ||
                    !importDraft.batchId ||
                    !importDraft.csv.trim()
                  }
                >
                  <Upload className="mr-1.5 h-4 w-4" /> Import list
                </Button>
              </form>
            </div>

            <div className="flex flex-wrap items-end justify-between gap-3">
              <div className="flex flex-wrap items-end gap-3">
                <label className="flex flex-col gap-1.5">
                  <span className={fieldCaptionClass}>Find</span>
                  <Input
                    value={studentQuery}
                    placeholder="Name or ID"
                    aria-label="Search students"
                    className="w-[220px]"
                    onChange={(event) => setStudentQuery(event.target.value)}
                  />
                </label>
                <label className="flex flex-col gap-1.5">
                  <span className={fieldCaptionClass}>Batch</span>
                  <Select
                    value={studentBatchFilter}
                    onValueChange={setStudentBatchFilter}
                  >
                    <SelectTrigger
                      className="w-[190px]"
                      aria-label="Filter by batch"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={ANY_BATCH}>All batches</SelectItem>
                      {(batches ?? []).map((batch) => (
                        <SelectItem key={batch.id} value={batch.id}>
                          {batch.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </label>
              </div>

              <p className="pb-2.5 text-[13px] text-[#5b6169]">
                <span className="font-semibold tabular-nums text-[#000a1e]">
                  {visibleStudents.length}
                </span>{' '}
                shown
                {unassignedCount > 0 ? (
                  <>
                    {' · '}
                    <span className="font-semibold tabular-nums text-[#8a6100]">
                      {unassignedCount}
                    </span>{' '}
                    without a subgroup
                  </>
                ) : null}
              </p>
            </div>

            <div className="overflow-x-auto rounded-[0.4rem] border border-[#e1e7ee] bg-white">
              <table className="w-full min-w-[560px] border-collapse">
                <caption className="sr-only">
                  Student roster: batch, ID, subgroup, and whether the record is
                  active.
                </caption>
                <thead>
                  <tr className="border-b border-[#eef2f6]">
                    <th
                      scope="col"
                      className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-[0.14em] text-[#8794a5]"
                    >
                      Student
                    </th>
                    <th
                      scope="col"
                      className="hidden px-4 py-3 text-left text-[11px] font-bold uppercase tracking-[0.14em] text-[#8794a5] md:table-cell"
                    >
                      Batch
                    </th>
                    <th
                      scope="col"
                      className="hidden px-4 py-3 text-left text-[11px] font-bold uppercase tracking-[0.14em] text-[#8794a5] lg:table-cell"
                    >
                      ID
                    </th>
                    <th
                      scope="col"
                      className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-[0.14em] text-[#8794a5]"
                    >
                      Subgroup
                    </th>
                    <th
                      scope="col"
                      className="px-4 py-3 text-right text-[11px] font-bold uppercase tracking-[0.14em] text-[#8794a5]"
                    >
                      Active
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {visibleStudents.length === 0 ? (
                    <tr>
                      <td
                        colSpan={5}
                        className="px-4 py-10 text-center text-[13.5px] text-[#74777f]"
                      >
                        No students match this search.
                      </td>
                    </tr>
                  ) : null}
                  {visibleStudents.map((student) => (
                    <tr
                      key={student.id}
                      className="border-t border-[#eef2f6] first:border-t-0"
                    >
                      <th
                        scope="row"
                        className="max-w-0 px-4 py-2.5 text-left align-middle"
                      >
                        <span className="block truncate text-[15px] font-semibold tracking-[-0.01em] text-[#000a1e]">
                          {student.fullName}
                        </span>
                        {/* The columns these repeat are hidden on narrow
                            screens, so they fall back under the name. */}
                        <span className="mt-0.5 block truncate text-[13px] leading-5 text-[#74777f] md:hidden">
                          {student.batchLabel}
                          {student.externalId ? ` · ${student.externalId}` : ''}
                        </span>
                      </th>

                      <td className="hidden whitespace-nowrap px-4 py-2.5 text-[13.5px] text-[#5b6169] md:table-cell">
                        {student.batchLabel ?? '-'}
                      </td>

                      <td className="hidden whitespace-nowrap px-4 py-2.5 text-[13.5px] tabular-nums text-[#74777f] lg:table-cell">
                        {student.externalId ?? '-'}
                      </td>

                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2.5">
                          <Select
                            value={student.subgroup ?? NONE}
                            disabled={busy === `student-${student.id}`}
                            onValueChange={(subgroup) =>
                              void run(
                                `student-${student.id}`,
                                async () => {
                                  const updated = await updateStudent(
                                    client!,
                                    student.id,
                                    {
                                      subgroup:
                                        subgroup === NONE
                                          ? null
                                          : (subgroup as 'A' | 'B'),
                                    },
                                  );
                                  setStudents((prev) =>
                                    prev.map((item) =>
                                      item.id === updated.id ? updated : item,
                                    ),
                                  );
                                },
                                'Unable to move the student.',
                              )
                            }
                          >
                            <SelectTrigger
                              className="w-[84px]"
                              aria-label={`Subgroup for ${student.fullName}`}
                            >
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value={NONE}>-</SelectItem>
                              <SelectItem value="A">A</SelectItem>
                              <SelectItem value="B">B</SelectItem>
                            </SelectContent>
                          </Select>
                          {student.subgroup === null ? (
                            <span className="hidden whitespace-nowrap rounded-[0.25rem] bg-[#fdf3dd] px-2 py-1 text-[10.5px] font-bold uppercase tracking-[0.1em] text-[#8a6100] sm:inline">
                              Not placed
                            </span>
                          ) : null}
                        </div>
                      </td>

                      <td className="px-4 py-2.5">
                        <div className="flex items-center justify-end gap-2.5">
                          <span
                            className={cn(
                              'hidden text-[12px] font-bold uppercase tracking-[0.1em] sm:inline',
                              student.active
                                ? 'text-[#000a1e]'
                                : 'text-[#97a2b0]',
                            )}
                          >
                            {student.active ? 'Active' : 'Paused'}
                          </span>
                          <Switch
                            checked={student.active}
                            disabled={busy === `student-${student.id}`}
                            aria-label={`Toggle ${student.fullName} active`}
                            onCheckedChange={(active) =>
                              void run(
                                `student-${student.id}`,
                                async () => {
                                  const updated = await updateStudent(
                                    client!,
                                    student.id,
                                    { active },
                                  );
                                  setStudents((prev) =>
                                    prev.map((item) =>
                                      item.id === updated.id ? updated : item,
                                    ),
                                  );
                                },
                                'Unable to update the student.',
                              )
                            }
                          />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </TabsContent>

          {/* ---- Placements ---- */}
          <TabsContent value="placements" className="mt-5 space-y-5">
            <form
              className="grid gap-3 rounded-[0.4rem] border border-[#eef2f6] bg-[#f8fafc] p-4 sm:grid-cols-2 lg:grid-cols-5"
              onSubmit={(event) => {
                event.preventDefault();
                void run(
                  'placement-create',
                  async () => {
                    const saved = await saveSubgroupPlacement(
                      client!,
                      placementDraft,
                    );
                    setPlacementDraft((prev) => ({
                      ...prev,
                      weekStartsOn: '',
                    }));
                    toast.success(
                      "Placement saved; the week's sessions were refreshed.",
                    );
                    // Saving a week re-points an existing placement when one
                    // already covers it, so replace by id or prepend.
                    setPlacements((prev) =>
                      prev.some((item) => item.id === saved.id)
                        ? prev.map((item) =>
                            item.id === saved.id ? saved : item,
                          )
                        : [saved, ...prev],
                    );
                    // The server regenerates that week's pending sessions.
                    await loadSessions();
                  },
                  'Unable to save the placement.',
                );
              }}
            >
              <Select
                value={placementDraft.batchId}
                onValueChange={(batchId) =>
                  setPlacementDraft((prev) => ({ ...prev, batchId }))
                }
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
                onValueChange={(subgroup) =>
                  setPlacementDraft((prev) => ({
                    ...prev,
                    subgroup: subgroup as 'A' | 'B',
                  }))
                }
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
                onValueChange={(wardId) =>
                  setPlacementDraft((prev) => ({ ...prev, wardId }))
                }
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
                onChange={(event) =>
                  setPlacementDraft((prev) => ({
                    ...prev,
                    weekStartsOn: event.target.value,
                  }))
                }
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

              <p
                aria-live="polite"
                className="text-[13px] leading-5 text-[#5b6169] sm:col-span-2 lg:col-span-5"
              >
                {placementWeekLabel ? (
                  <>
                    Places the week of{' '}
                    <span className="font-semibold text-[#000a1e]">
                      {placementWeekLabel}
                    </span>
                    . Any day you pick saves that whole Monday to Sunday week.
                  </>
                ) : (
                  'Pick any day in the week you want. It saves the whole Monday to Sunday week that day falls in.'
                )}
              </p>
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
                      <p className="text-[15px] font-medium text-[#000a1e]">
                        {placement.batchLabel} · Subgroup {placement.subgroup} →{' '}
                        {placement.wardName}
                      </p>
                      <p className="text-sm leading-5 text-[#5f6670]">
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
                event.preventDefault();
                void run(
                  'rep-create',
                  async () => {
                    await createRepAssignment(client!, repDraft);
                    toast.success('Rep assignment saved.');
                    // Saving can re-point an existing assignment for the same
                    // person and batch, so re-read rather than prepending.
                    await loadReps();
                  },
                  'Unable to assign the rep.',
                );
              }}
            >
              <Select
                value={repDraft.userId}
                onValueChange={(userId) =>
                  setRepDraft((prev) => ({ ...prev, userId }))
                }
              >
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
              <Select
                value={repDraft.batchId}
                onValueChange={(batchId) =>
                  setRepDraft((prev) => ({ ...prev, batchId }))
                }
              >
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
                onValueChange={(scope) =>
                  setRepDraft((prev) => ({
                    ...prev,
                    scope: scope as RepAssignmentRecord['scope'],
                  }))
                }
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
              <Button
                type="submit"
                disabled={
                  busy === 'rep-create' || !repDraft.userId || !repDraft.batchId
                }
              >
                <Plus className="mr-1.5 h-4 w-4" /> Assign rep
              </Button>
              {repAccounts.length === 0 ? (
                <p className="text-sm leading-5 text-[#5f6670] sm:col-span-2 lg:col-span-4">
                  No rep accounts yet. Create one below, then assign it to a batch
                  and scope.
                </p>
              ) : null}
            </form>

            <div className="mt-4 rounded-[0.35rem] bg-[#f8fafc] p-4 outline outline-1 outline-[#d9e0e7]/75">
              <p className="mb-3 text-[13px] font-semibold text-[#1d3047]">
                New rep account
              </p>
              <CreateStudentRepForm />
            </div>

            <div>
              {reps.map((rep) => (
                <div
                  key={rep.id}
                  className="flex items-center justify-between gap-3 border-b border-[#eef2f6] py-2.5 last:border-b-0"
                >
                  <div className="min-w-0">
                    <p className="text-[15px] font-medium text-[#000a1e]">
                      {rep.userName}
                    </p>
                    <p className="text-sm leading-5 text-[#5f6670]">
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
                          const updated = await setRepAssignmentActive(
                            client!,
                            rep.id,
                            active,
                          );
                          setReps((prev) =>
                            prev.map((item) =>
                              item.id === updated.id ? updated : item,
                            ),
                          );
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
                  <div
                    key={session.id}
                    className="border-b border-[#eef2f6] py-2.5 last:border-b-0"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-[15px] font-medium text-[#000a1e]">
                          {ACTIVITY_LABELS[session.activityType]}
                          {session.subgroup ? ` · ${session.subgroup}` : ''}
                          <span className="font-normal text-[#74777f]">
                            {' '}
                            · {session.batchLabel}
                          </span>
                        </p>
                        <p className="text-sm leading-5 text-[#5f6670]">
                          {session.scheduledDate}
                          {session.wardName
                            ? ` · ${session.wardName}`
                            : ' · no ward'}
                          {session.reason ? ` · "${session.reason}"` : ''}
                          {session.attendanceCount
                            ? ` · ${session.attendanceCount} attendance rows`
                            : ''}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <Badge variant={sessionStatusVariant[session.status]}>
                          {session.status === 'not_held'
                            ? 'Not held'
                            : session.status}
                        </Badge>
                        {session.status === 'pending' ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                              setCancelDraft({
                                sessionId: session.id,
                                reason: '',
                              })
                            }
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
                            setCancelDraft((prev) => ({
                              ...prev,
                              reason: event.target.value,
                            }))
                          }
                        />
                        <Button
                          size="sm"
                          disabled={
                            !cancelDraft.reason.trim() ||
                            busy === `cancel-${session.id}`
                          }
                          onClick={() =>
                            void run(
                              `cancel-${session.id}`,
                              async () => {
                                const reason = cancelDraft.reason.trim();
                                const cancelled = await cancelTeachingSession(
                                  client!,
                                  session.id,
                                  reason,
                                );
                                setCancelDraft({ sessionId: '', reason: '' });
                                toast.success('Session cancelled.');
                                // Response carries { id, status } only; the
                                // reason is what we just sent.
                                setSessions((prev) =>
                                  prev.map((item) =>
                                    item.id === cancelled.id
                                      ? {
                                          ...item,
                                          status: cancelled.status as OversightSessionRecord['status'],
                                          reason,
                                        }
                                      : item,
                                  ),
                                );
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
  );
}
