import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Loader2,
  ShieldAlert,
  Save,
  Undo2,
  X,
} from 'lucide-react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { AcademicWorkspaceHero } from '@/components/admin/academic-workspace-hero';
import {
  SectionEmptyState,
  panelClass,
} from '@/components/dashboard/section-panel';
import {
  fetchAcademicDutyTypes,
  fetchRosterMonth,
  saveDailyDuty,
  saveRosterMonth,
  type AcademicDutyType,
  type RosterMonth,
  type RosterPerson,
} from '@/lib/api';
import { getApiBrowserClient } from '@/lib/api/client';
import {
  matchesRosterRoleFilter,
  rosterRoleFilters,
  type RosterRoleFilter,
} from '@/lib/duty-roster-filters';
import { cn } from '@/lib/utils';
import { getErrorMessage } from '@/lib/api/helpers';

const ALL = 'all';
const CLEARED = 'cleared';
const MIXED = 'mixed';

function monthLabel(year: number, month: number) {
  return new Date(year, month - 1, 1).toLocaleDateString('en-GB', {
    month: 'long',
    year: 'numeric',
  });
}

function shortDate(value: string) {
  return new Date(`${value}T00:00:00`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
  });
}

function sourceLabel(source: string, isRotationOverride: boolean) {
  if (isRotationOverride) return 'Roster override';
  if (source === 'rotation_planner') return 'Rotation plan';
  if (source === 'transfer') return 'Approved transfer';
  return 'Duty roster';
}

/**
 * The department's live duty roster (V2 Phase 2): every consultant's and
 * resident's monthly duty for the selected month, plus day-level duties
 * (on-call, Transition) per person. Monthly edits are staged and saved in one
 * transaction; day duties write immediately.
 */
export function DutyRosterPage() {
  const client = getApiBrowserClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const showCoverageGaps =
    searchParams.get('issue') === 'missing-monthly-coverage';

  const today = useMemo(() => new Date(), []);
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [data, setData] = useState<RosterMonth | null>(null);
  const [dutyTypes, setDutyTypes] = useState<AcademicDutyType[] | null>(null);
  const [roleFilter, setRoleFilter] =
    useState<RosterRoleFilter>('consultant');
  const [sectionFilter, setSectionFilter] = useState(ALL);
  // Staged monthly edits: userId -> dutyTypeId (or CLEARED). Saved together.
  const [staged, setStaged] = useState<Record<string, string>>({});
  const [overrideReasons, setOverrideReasons] = useState<Record<string, string>>(
    {},
  );
  const [overrideId, setOverrideId] = useState<string | null>(null);
  const [overrideDraft, setOverrideDraft] = useState({
    dutyTypeId: '',
    reason: '',
  });
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [dailyDraft, setDailyDraft] = useState({ dutyTypeId: '', date: '' });
  const [isSaving, setIsSaving] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const load = useCallback(async () => {
    if (!client) {
      setLoadError(true);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    try {
      const [monthData, types] = await Promise.all([
        fetchRosterMonth(client, year, month),
        dutyTypes ? Promise.resolve(dutyTypes) : fetchAcademicDutyTypes(client),
      ]);
      setData(monthData);
      setDutyTypes(types);
      setStaged({});
      setOverrideReasons({});
      setOverrideId(null);
      setLoadError(false);
    } catch {
      setLoadError(true);
      toast.error('Unable to load the duty roster.');
    } finally {
      setIsLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, year, month]);

  useEffect(() => {
    void load();
  }, [load]);

  const monthlyTypes = useMemo(
    () =>
      (dutyTypes ?? []).filter(
        (type) => type.granularity === 'monthly' && type.active,
      ),
    [dutyTypes],
  );
  const dailyTypes = useMemo(
    () =>
      (dutyTypes ?? []).filter(
        (type) => type.granularity === 'daily' && type.active,
      ),
    [dutyTypes],
  );

  /** Section duties first, then department-wide, for the person's picker. */
  const optionsFor = useCallback(
    (person: RosterPerson) =>
      [...monthlyTypes].sort((a, b) => {
        const aOwn =
          a.sectionId === person.sectionId ? 0 : a.sectionId === null ? 1 : 2;
        const bOwn =
          b.sectionId === person.sectionId ? 0 : b.sectionId === null ? 1 : 2;
        return aOwn - bOwn || a.name.localeCompare(b.name);
      }),
    [monthlyTypes],
  );

  const people = useMemo(() => {
    if (!data) {
      return [];
    }

    if (showCoverageGaps) {
      const todayKey = [
        today.getFullYear(),
        String(today.getMonth() + 1).padStart(2, '0'),
        String(today.getDate()).padStart(2, '0'),
      ].join('-');

      return data.people.filter(
        (person) =>
          !person.monthly.some(
            (assignment) =>
              assignment.startsOn <= todayKey &&
              assignment.endsOn >= todayKey,
          ),
      );
    }

    return data.people.filter((person) => {
      if (!matchesRosterRoleFilter(person, roleFilter)) {
        return false;
      }

      if (roleFilter === 'consultant' || roleFilter === 'internist') {
        return sectionFilter === ALL || person.sectionId === sectionFilter;
      }

      return true;
    });
  }, [data, roleFilter, sectionFilter, showCoverageGaps, today]);

  useEffect(() => {
    if (!showCoverageGaps || isLoading || !data) {
      return;
    }

    window.requestAnimationFrame(() => {
      document
        .getElementById('coverage-gaps')
        ?.scrollIntoView({ block: 'start' });
    });
  }, [data, isLoading, showCoverageGaps]);

  const dirtyCount = Object.keys(staged).length;

  const stepMonth = (delta: number) => {
    const next = new Date(year, month - 1 + delta, 1);
    setYear(next.getFullYear());
    setMonth(next.getMonth() + 1);
    setStaged({});
    setOverrideReasons({});
    setOverrideId(null);
    setExpandedId(null);
  };

  const saveStagedMonth = async () => {
    if (!client || dirtyCount === 0) {
      return;
    }

    setIsSaving(true);
    try {
      const next = await saveRosterMonth(
        client,
        year,
        month,
        Object.entries(staged).map(([userId, dutyTypeId]) => ({
          userId,
          dutyTypeId: dutyTypeId === CLEARED ? null : dutyTypeId,
          ...(overrideReasons[userId]
            ? { overrideReason: overrideReasons[userId] }
            : {}),
        })),
      );
      setData(next);
      setStaged({});
      setOverrideReasons({});
      setOverrideId(null);
      toast.success('Roster month saved.');
    } catch (error) {
      toast.error(getErrorMessage(error, 'Unable to save the roster month.'));
    } finally {
      setIsSaving(false);
    }
  };

  const addDailyDuty = async (person: RosterPerson) => {
    if (!client || !dailyDraft.dutyTypeId || !dailyDraft.date) {
      return;
    }

    try {
      await saveDailyDuty(client, {
        userId: person.id,
        dutyTypeId: dailyDraft.dutyTypeId,
        date: dailyDraft.date,
      });
      setDailyDraft((prev) => ({ ...prev, date: '' }));
      await load();
    } catch (error) {
      toast.error(getErrorMessage(error, 'Unable to add the day duty.'));
    }
  };

  const removeDailyDuty = async (
    person: RosterPerson,
    dutyTypeId: string,
    date: string,
  ) => {
    if (!client) {
      return;
    }

    try {
      await saveDailyDuty(client, {
        userId: person.id,
        dutyTypeId,
        date,
        remove: true,
      });
      await load();
    } catch (error) {
      toast.error(getErrorMessage(error, 'Unable to remove the day duty.'));
    }
  };

  return (
    <div className="space-y-5 px-4 py-6 md:px-8">
      <AcademicWorkspaceHero
        eyebrow="Scheduling"
        title="Duty & daily coverage"
        description="Manage operational month coverage and day duties. Resident block rotations remain authoritative in the rotation plan."
        metrics={[
          {
            label: 'Month',
            value: monthLabel(year, month),
            note: 'Current roster view',
            compact: true,
          },
          {
            label: 'People',
            value: isLoading ? '-' : String(people.length),
            note:
              rosterRoleFilters.find((item) => item.value === roleFilter)?.label ??
              'Filtered staff',
          },
          {
            label: 'Covered',
            value:
              !isLoading && people.length > 0
                ? `${Math.round(
                    (people.filter((person) => {
                      if (staged[person.id] !== undefined) {
                        return staged[person.id] !== CLEARED;
                      }

                      return person.monthly.length > 0;
                    }).length /
                      people.length) *
                      100,
                  )}%`
                : '-',
            note: 'Monthly duty assigned',
          },
          {
            label: 'Changes',
            value: String(dirtyCount),
            note: 'Waiting to save',
          },
        ]}
        actions={
          <Button
            variant="secondary"
            className="border-white/20 bg-white text-[#04162f] hover:bg-[#eaf2fb]"
            onClick={() => void saveStagedMonth()}
            disabled={dirtyCount === 0 || isSaving}
          >
            {isSaving ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            ) : (
              <Save className="mr-1.5 h-4 w-4" />
            )}
            Save month{dirtyCount ? ` (${dirtyCount})` : ''}
          </Button>
        }
      />

      <section
        id={showCoverageGaps ? 'coverage-gaps' : undefined}
        className={cn(panelClass, showCoverageGaps && 'scroll-mt-24')}
      >
        {showCoverageGaps ? (
          <div className="mb-4 flex flex-col gap-3 border-l-[3px] border-[#d69e13] bg-[#fff8e8] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-start gap-2.5">
              <ShieldAlert
                className="mt-0.5 h-4 w-4 shrink-0 text-[#9a6b00]"
                aria-hidden="true"
              />
              <div>
                <p className="text-sm font-semibold text-[#1d3047]">
                  Missing coverage today
                </p>
                <p className="mt-0.5 text-[13px] leading-5 text-[#657180]">
                  Showing {people.length}{' '}
                  {people.length === 1 ? 'person' : 'people'} with no monthly
                  assignment covering today. Choose a duty—or create an
                  override for a rotation-managed resident—then save the month.
                </p>
              </div>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="self-start text-[#005db6] sm:self-auto"
              onClick={() => {
                const next = new URLSearchParams(searchParams);
                next.delete('issue');
                setSearchParams(next, { replace: true });
              }}
            >
              Show full roster
            </Button>
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1.5">
            <Button
              variant="secondary"
              size="icon"
              aria-label="Previous month"
              disabled={showCoverageGaps}
              onClick={() => stepMonth(-1)}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="min-w-[116px] whitespace-nowrap text-center text-sm font-semibold text-[#000a1e] sm:min-w-[150px]">
              {monthLabel(year, month)}
            </span>
            <Button
              variant="secondary"
              size="icon"
              aria-label="Next month"
              disabled={showCoverageGaps}
              onClick={() => stepMonth(1)}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>

          {showCoverageGaps ? (
            <span className="inline-flex h-10 items-center border border-[#dce6f0] bg-[#f7faff] px-3 text-sm font-semibold text-[#526171]">
              Residents &amp; consultants
            </span>
          ) : (
            <Select
              value={roleFilter}
              onValueChange={(value) =>
                setRoleFilter(value as typeof roleFilter)
              }
            >
              <SelectTrigger className="w-[190px]" aria-label="People filter">
                <SelectValue />
              </SelectTrigger>
              <SelectContent
                style={{
                  maxHeight:
                    'min(var(--radix-select-content-available-height), 24rem)',
                }}
              >
                {rosterRoleFilters.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          {!showCoverageGaps &&
          (roleFilter === 'consultant' || roleFilter === 'internist') ? (
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

        <div className="mt-4 flex flex-col gap-3 border-y border-[#dce6f0] bg-[#f7faff] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-start gap-2.5">
            <ShieldAlert
              className="mt-0.5 h-4 w-4 shrink-0 text-[#005db6]"
              aria-hidden="true"
            />
            <p className="text-[13px] leading-5 text-[#526171]">
              Resident block assignments are controlled by the rotation plan.
              This page can create a dated calendar-month override only when a
              reason is recorded.
            </p>
          </div>
          <Link
            to="/admin/academic/rotations"
            className="shrink-0 text-[13px] font-semibold text-[#005db6] hover:text-[#003f7d]"
          >
            Open resident rotation plan
          </Link>
        </div>

        {isLoading ? (
          <div className="flex min-h-[260px] items-center justify-center text-[#666970]">
            <Loader2
              className="h-5 w-5 animate-spin"
              aria-label="Loading roster"
            />
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
                roleFilter === 'consultant' || roleFilter === 'internist'
                  ? `No active ${roleFilter === 'consultant' ? 'consultants' : 'internists'} in this section.`
                  : `No active staff match the ${
                      rosterRoleFilters
                        .find((option) => option.value === roleFilter)
                        ?.label ?? 'selected grade'
                    } filter.`
              }
            />
          </div>
        ) : (
          <div className="mt-5 max-h-[62vh] overflow-auto rounded-[0.4rem] border border-[#e6ecf3]">
            <table className="w-full border-collapse text-sm">
              <caption className="sr-only">Duty roster: monthly and day duties per person</caption>
              <thead className="sticky top-0 z-10 bg-[#f8fafc]">
                <tr className="border-b border-[#e6ecf3] text-left text-xs font-bold uppercase tracking-[0.1em] text-[#526171]">
                  <th scope="col" className="px-4 py-3">Person</th>
                  <th scope="col" className="px-4 py-3">
                    {roleFilter === 'consultant' || roleFilter === 'internist'
                      ? 'Section'
                      : 'Group'}
                  </th>
                  <th scope="col" className="px-4 py-3">Monthly duty</th>
                  <th scope="col" className="px-4 py-3">Day duties</th>
                  <th scope="col" className="w-10 px-2 py-3">
                    <span className="sr-only">Expand</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {people.map((person) => {
                  const monthlyDutyIds = [
                    ...new Set(person.monthly.map((item) => item.dutyTypeId)),
                  ];
                  const currentMonthly =
                    monthlyDutyIds.length === 1 ? monthlyDutyIds[0] : null;
                  const hasMixedCoverage = monthlyDutyIds.length > 1;
                  const stagedValue = staged[person.id];
                  const selectValue =
                    stagedValue !== undefined
                      ? stagedValue
                      : hasMixedCoverage
                        ? MIXED
                        : (currentMonthly ?? CLEARED);
                  const isEmpty = selectValue === CLEARED;
                  const isExpanded = expandedId === person.id;
                  const isOverrideExpanded = overrideId === person.id;
                  const stagedTypeName =
                    stagedValue === CLEARED
                      ? 'No monthly coverage'
                      : monthlyTypes.find((type) => type.id === stagedValue)?.name;

                  return (
                    <Fragment key={person.id}>
                      <tr
                        className={cn(
                          'border-b border-[#eef2f6] last:border-b-0',
                          stagedValue !== undefined && 'bg-[#f4f9ff]',
                          showCoverageGaps &&
                            stagedValue === undefined &&
                            'bg-[#fffaf0]',
                        )}
                      >
                        <td className="px-4 py-2.5 font-semibold text-[#000a1e]">
                          <div className="flex flex-wrap items-center gap-2">
                            <span>{person.fullName}</span>
                            {showCoverageGaps ? (
                              <Badge variant="warning">Missing today</Badge>
                            ) : null}
                          </div>
                        </td>
                        <td className="px-4 py-2.5 text-[#5f6670]">
                          {person.role === 'consultant'
                            ? (person.sectionName ?? 'No section')
                            : person.rotationGroup
                              ? `Group ${person.rotationGroup}`
                              : '-'}
                        </td>
                        <td className="px-4 py-2.5">
                          {person.rotationManaged ? (
                            <div className="min-w-[310px] max-w-[410px] space-y-2">
                              <div className="flex flex-wrap items-center gap-1.5">
                                <Badge variant="info">Rotation-managed</Badge>
                                {hasMixedCoverage ? (
                                  <Badge variant="warning">Mixed coverage</Badge>
                                ) : null}
                                {person.monthly.some(
                                  (assignment) => assignment.isRotationOverride,
                                ) ? (
                                  <Badge variant="warning">Active override</Badge>
                                ) : null}
                              </div>

                              {stagedValue !== undefined ? (
                                <div className="flex items-start justify-between gap-3 border-l-2 border-[#005db6] bg-[#f4f9ff] px-3 py-2">
                                  <div>
                                    <p className="text-[13px] font-semibold text-[#003f7d]">
                                      Staged override: {stagedTypeName}
                                    </p>
                                    <p className="mt-0.5 text-xs leading-5 text-[#526171]">
                                      {shortDate(data.startsOn)} -{' '}
                                      {shortDate(data.endsOn)} ·{' '}
                                      {overrideReasons[person.id]}
                                    </p>
                                  </div>
                                  <button
                                    type="button"
                                    aria-label={`Undo staged override for ${person.fullName}`}
                                    className="mt-0.5 text-[#005db6] hover:text-[#003f7d]"
                                    onClick={() => {
                                      setStaged((previous) => {
                                        const next = { ...previous };
                                        delete next[person.id];
                                        return next;
                                      });
                                      setOverrideReasons((previous) => {
                                        const next = { ...previous };
                                        delete next[person.id];
                                        return next;
                                      });
                                    }}
                                  >
                                    <Undo2 className="h-4 w-4" />
                                  </button>
                                </div>
                              ) : person.monthly.length ? (
                                <div className="space-y-1">
                                  {person.monthly.map((assignment) => (
                                    <div
                                      key={assignment.id}
                                      className="border-l border-[#dce6f0] pl-2"
                                    >
                                      <div className="flex flex-wrap items-baseline gap-x-2 text-[13px] leading-5">
                                        <span className="font-semibold text-[#1d3047]">
                                          {assignment.dutyTypeName ??
                                            'Unknown duty'}
                                        </span>
                                        <span className="text-[#657180]">
                                          {shortDate(assignment.startsOn)} -{' '}
                                          {shortDate(assignment.endsOn)}
                                        </span>
                                        <span className="text-xs font-medium text-[#005db6]">
                                          {sourceLabel(
                                            assignment.source,
                                            assignment.isRotationOverride,
                                          )}
                                        </span>
                                      </div>
                                      {assignment.isRotationOverride &&
                                      assignment.note ? (
                                        <p className="mt-0.5 text-xs leading-5 text-[#657180]">
                                          Reason:{' '}
                                          {assignment.note.replace(
                                            /^Rotation override:\s*/,
                                            '',
                                          )}
                                        </p>
                                      ) : null}
                                    </div>
                                  ))}
                                </div>
                              ) : (
                                <p className="text-[13px] font-medium text-[#8a5a00]">
                                  No effective coverage in this month
                                </p>
                              )}

                              <Button
                                variant="secondary"
                                size="sm"
                                onClick={() => {
                                  if (isOverrideExpanded) {
                                    setOverrideId(null);
                                    return;
                                  }

                                  setOverrideId(person.id);
                                  setOverrideDraft({
                                    dutyTypeId:
                                      stagedValue ??
                                      currentMonthly ??
                                      person.monthly[0]?.dutyTypeId ??
                                      CLEARED,
                                    reason: overrideReasons[person.id] ?? '',
                                  });
                                }}
                              >
                                {isOverrideExpanded
                                  ? 'Close override'
                                  : stagedValue !== undefined
                                    ? 'Edit override'
                                    : 'Create month override'}
                              </Button>
                            </div>
                          ) : (
                            <div className="min-w-[270px] space-y-2">
                              <div className="flex items-center gap-2">
                                <Select
                                  value={selectValue}
                                  onValueChange={(value) =>
                                    setStaged((prev) => {
                                      const original = hasMixedCoverage
                                        ? MIXED
                                        : (currentMonthly ?? CLEARED);
                                      if (value === original) {
                                        const next = { ...prev };
                                        delete next[person.id];
                                        return next;
                                      }
                                      return { ...prev, [person.id]: value };
                                    })
                                  }
                                >
                                  <SelectTrigger
                                    className={cn(
                                      'w-[250px]',
                                      isEmpty &&
                                        'border-[#f0b429] bg-[#fff8e8] text-[#8a6100]',
                                      hasMixedCoverage &&
                                        stagedValue === undefined &&
                                        'border-[#f0b429] bg-[#fff8e8]',
                                    )}
                                    aria-label={`Monthly duty for ${person.fullName}`}
                                  >
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {hasMixedCoverage ? (
                                      <SelectItem value={MIXED} disabled>
                                        Mixed monthly coverage
                                      </SelectItem>
                                    ) : null}
                                    <SelectItem value={CLEARED}>
                                      No monthly duty
                                    </SelectItem>
                                    {optionsFor(person).map((type) => (
                                      <SelectItem key={type.id} value={type.id}>
                                        {type.name}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                                {stagedValue !== undefined ? (
                                  <button
                                    type="button"
                                    aria-label={`Undo monthly change for ${person.fullName}`}
                                    className="text-[#005db6] hover:text-[#003f7d]"
                                    onClick={() =>
                                      setStaged((previous) => {
                                        const next = { ...previous };
                                        delete next[person.id];
                                        return next;
                                      })
                                    }
                                  >
                                    <Undo2 className="h-4 w-4" />
                                  </button>
                                ) : null}
                              </div>
                              {person.monthly.length ? (
                                <div className="space-y-0.5">
                                  {person.monthly.map((assignment) => (
                                    <p
                                      key={assignment.id}
                                      className="text-xs leading-5 text-[#657180]"
                                      title={assignment.note ?? undefined}
                                    >
                                      {shortDate(assignment.startsOn)} -{' '}
                                      {shortDate(assignment.endsOn)} ·{' '}
                                      {sourceLabel(
                                        assignment.source,
                                        assignment.isRotationOverride,
                                      )}
                                    </p>
                                  ))}
                                </div>
                              ) : null}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-2.5">
                          {person.daily.length ? (
                            <div className="flex flex-wrap gap-1.5">
                              {person.daily.slice(0, 4).map((duty) => (
                                <Badge key={duty.id} variant="neutral">
                                  {duty.dutyTypeName}, {duty.startsOn.slice(8)}/
                                  {duty.startsOn.slice(5, 7)}
                                </Badge>
                              ))}
                              {person.daily.length > 4 ? (
                                <span className="text-[13px] font-medium text-[#5f6670]">
                                  +{person.daily.length - 4} more
                                </span>
                              ) : null}
                            </div>
                          ) : (
                            <span className="text-[13px] font-medium text-[#657180]">None</span>
                          )}
                        </td>
                        <td className="px-2 py-2.5">
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`${isExpanded ? 'Collapse' : 'Expand'} day duties for ${person.fullName}`}
                            aria-expanded={isExpanded}
                            onClick={() => {
                              setExpandedId(isExpanded ? null : person.id);
                              setDailyDraft({
                                dutyTypeId: dailyTypes[0]?.id ?? '',
                                date: '',
                              });
                            }}
                          >
                            {isExpanded ? (
                              <ChevronUp className="h-4 w-4" />
                            ) : (
                              <ChevronDown className="h-4 w-4" />
                            )}
                          </Button>
                        </td>
                      </tr>
                      {isOverrideExpanded ? (
                        <tr className="border-b border-[#dce6f0] bg-[#f7faff]">
                          <td colSpan={5} className="px-4 py-4">
                            <div className="grid gap-4 lg:grid-cols-[minmax(220px,0.8fr)_minmax(320px,1.4fr)_auto] lg:items-end">
                              <div>
                                <p className="text-xs font-bold uppercase tracking-[0.12em] text-[#005db6]">
                                  Calendar-month override
                                </p>
                                <p className="mt-1 text-sm font-semibold text-[#1d3047]">
                                  {shortDate(data.startsOn)} -{' '}
                                  {shortDate(data.endsOn)}
                                </p>
                                <p className="mt-1 text-xs leading-5 text-[#657180]">
                                  Overlaps{' '}
                                  {person.rotationBlocks
                                    .map((block) => `Block ${block.blockIndex}`)
                                    .join(', ')}
                                  . The rotation plan will show this block as
                                  mixed until it is reconciled.
                                </p>
                              </div>
                              <div className="grid gap-3 sm:grid-cols-[220px_minmax(240px,1fr)]">
                                <Select
                                  value={overrideDraft.dutyTypeId}
                                  onValueChange={(dutyTypeId) =>
                                    setOverrideDraft((previous) => ({
                                      ...previous,
                                      dutyTypeId,
                                    }))
                                  }
                                >
                                  <SelectTrigger aria-label="Override monthly duty">
                                    <SelectValue placeholder="Choose coverage" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value={CLEARED}>
                                      No monthly coverage
                                    </SelectItem>
                                    {optionsFor(person).map((type) => (
                                      <SelectItem key={type.id} value={type.id}>
                                        {type.name}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                                <div>
                                  <Textarea
                                    className="min-h-20 resize-y bg-white"
                                    value={overrideDraft.reason}
                                    minLength={10}
                                    maxLength={500}
                                    aria-label="Rotation override reason"
                                    placeholder="Reason for overriding the resident rotation"
                                    onChange={(event) =>
                                      setOverrideDraft((previous) => ({
                                        ...previous,
                                        reason: event.target.value,
                                      }))
                                    }
                                  />
                                  <p className="mt-1 text-xs text-[#657180]">
                                    Minimum 10 characters · saved in the audit
                                    trail
                                  </p>
                                </div>
                              </div>
                              <div className="flex gap-2">
                                <Button
                                  size="sm"
                                  disabled={
                                    !overrideDraft.dutyTypeId ||
                                    overrideDraft.reason.trim().length < 10
                                  }
                                  onClick={() => {
                                    setStaged((previous) => ({
                                      ...previous,
                                      [person.id]: overrideDraft.dutyTypeId,
                                    }));
                                    setOverrideReasons((previous) => ({
                                      ...previous,
                                      [person.id]: overrideDraft.reason.trim(),
                                    }));
                                    setOverrideId(null);
                                  }}
                                >
                                  Stage override
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => setOverrideId(null)}
                                >
                                  Cancel
                                </Button>
                              </div>
                            </div>
                          </td>
                        </tr>
                      ) : null}
                      {isExpanded ? (
                        <tr className="border-b border-[#eef2f6] bg-[#f8fafc]">
                          <td colSpan={5} className="px-4 py-3">
                            <div className="flex flex-wrap items-center gap-2">
                              <Select
                                value={dailyDraft.dutyTypeId}
                                onValueChange={(dutyTypeId) =>
                                  setDailyDraft((prev) => ({
                                    ...prev,
                                    dutyTypeId,
                                  }))
                                }
                              >
                                <SelectTrigger
                                  className="w-[210px]"
                                  aria-label="Day duty type"
                                >
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
                                  setDailyDraft((prev) => ({
                                    ...prev,
                                    date: event.target.value,
                                  }))
                                }
                              />
                              <Button
                                size="sm"
                                disabled={
                                  !dailyDraft.dutyTypeId || !dailyDraft.date
                                }
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
                                    className="inline-flex items-center gap-1.5 rounded-[0.25rem] border border-[#d4dde8] bg-white px-2.5 py-1 text-[13px] font-medium text-[#44474e]"
                                  >
                                    {duty.dutyTypeName}, {duty.startsOn}
                                    <button
                                      type="button"
                                      aria-label={`Remove ${duty.dutyTypeName} on ${duty.startsOn}`}
                                      className="text-[#ba1a1a] hover:text-[#7f1212]"
                                      onClick={() =>
                                        void removeDailyDuty(
                                          person,
                                          duty.dutyTypeId,
                                          duty.startsOn,
                                        )
                                      }
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
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
