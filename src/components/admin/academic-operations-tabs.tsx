import { useQuery } from '@tanstack/react-query';
import { format, parseISO } from 'date-fns';
import { motion } from 'framer-motion';
import { CalendarX2, ChevronRight, GraduationCap, Loader2, Sunrise } from 'lucide-react';
import { useState } from 'react'
import { Link } from 'react-router-dom';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { Badge } from '@/components/ui/badge';
import { AcademicWorkspaceHero } from '@/components/admin/academic-workspace-hero';
import { cardRowClass } from '@/components/admin/metered-list';
import { MorningDelayChart } from '@/components/admin/morning-delay-chart';
import { StudentProgressTable } from '@/components/admin/student-progress-table';
import { ReportingScopePanel } from '@/components/admin/reporting-scope-panel';
import { ChartCard } from '@/components/dashboard/chart-card';
import {
  SectionEmptyState,
  SectionHeader,
  panelClass,
} from '@/components/dashboard/section-panel';
import {
  fetchMorningAnalytics,
  fetchStudentAnalytics,
  fetchTeachingAnalytics,
  type MorningAnalytics,
  type StudentAnalytics,
  type TeachingAnalytics,
} from '@/lib/api/academic-operations';
import { ACTIVITY_LABELS, type TeachingActivityType } from '@/lib/api/teaching';
import { getApiBrowserClient } from '@/lib/api/client';
import {
  chartGridStroke,
  chartLegendProps,
  chartTick,
  deliveryPalette,
  lightTooltipItemStyle,
  lightTooltipLabelStyle,
  lightTooltipStyle,
  tooltipFillCursor,
} from '@/lib/chart-theme';

const OPERATIONS_ANALYTICS_STALE_MS = 5 * 60 * 1000;

function academicWindowLabel(window: { fromDate: string; toDate: string }) {
  return `${format(parseISO(window.fromDate), 'MMM d, yyyy')} - ${format(parseISO(window.toDate), 'MMM d, yyyy')}`;
}

/** Loading shell shared by the three tabs. */
function TabLoading() {
  return (
    <div className="flex min-h-[220px] items-center justify-center rounded-[0.35rem] bg-[#04162f] text-[#9fb0c6]">
      <div className="flex items-center gap-3 text-sm font-medium">
        <Loader2
          className="h-5 w-5 animate-spin text-[#f0b429]"
          aria-label="Loading analytics"
        />
        Loading operational analytics
      </div>
    </div>
  );
}

function TabError({ message }: { message: string }) {
  return (
    <div className={panelClass}>
      <SectionEmptyState
        icon={<GraduationCap className="h-6 w-6" />}
        title="Unable to load analytics"
        description={message}
      />
    </div>
  );
}

// ---- Morning punctuality ----

export function MorningAnalyticsTab() {
  const client = getApiBrowserClient();
  const { data, isPending, isError } = useQuery<MorningAnalytics>({
    queryKey: ['academic-operations', 'morning'],
    queryFn: () => fetchMorningAnalytics(client!),
    enabled: Boolean(client),
    staleTime: OPERATIONS_ANALYTICS_STALE_MS,
  });

  if (isPending) {
    return <TabLoading />;
  }

  if (isError || !data) {
    return (
      <TabError message="The morning analytics response was unavailable or malformed." />
    );
  }

  return (
    <>
      <AcademicWorkspaceHero
        eyebrow="Morning sessions"
        title="Punctuality and attendance"
        description="Recorded sessions measured against the scheduled start. Missed records stay visible so follow-up is immediate."
        metrics={[
          {
            label: 'Recorded',
            value: String(data.recordedCount),
            note: `${data.cancelledCount} cancelled`,
          },
          {
            label: 'Not recorded',
            value: String(data.notRecordedCount),
            note: 'Pending past sessions',
          },
          {
            label: 'On time',
            value: `${Math.round(data.onTimeRate)}%`,
            note: 'Of recorded sessions',
          },
          {
            label: 'Average delay',
            value: `${data.avgDelayMinutes} min`,
            note: 'Across recorded sessions',
          },
        ]}
      />

      <MorningDelayChart trend={data.trend} />

      <motion.section
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: 'easeOut' }}
        className={panelClass}
      >
        <SectionHeader
          eyebrow="Attendance"
          title="Attendance by person"
          description="Recorded presence across the same morning-session window."
        />
        {data.people.length === 0 ? (
          <div className="mt-5">
            <SectionEmptyState
              icon={<Sunrise className="h-6 w-6" />}
              title="No attendance recorded yet"
              description="Per-person rates appear after the first recorded session."
            />
          </div>
        ) : (
          <ul className="mt-6 flex max-h-[31rem] flex-col gap-2 overflow-y-auto pr-1">
            <li
              aria-hidden
              className="hidden grid-cols-[minmax(0,1fr)_84px_72px_16px] items-center gap-5 px-4 pb-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#69727d] sm:grid"
            >
              <span>Person</span>
              <span className="text-right">Present</span>
              <span className="text-right">Rate</span>
            </li>
            {data.people.map((person) => (
              <li key={person.userId}>
                {/* Opens the same detail page the leaderboard links to, which
                    also carries this person's morning history. The direction
                    follows their role: sending a resident to the consultant
                    view would render every figure as zero. */}
                <Link
                  to={`/admin/academic/people/${person.userId}?direction=${
                    person.role === 'resident' ? 'resident' : 'consultant'
                  }`}
                  className={`${cardRowClass} gap-5 grid-cols-[minmax(0,1fr)_auto] sm:grid-cols-[minmax(0,1fr)_84px_72px_16px]`}
                >
                  <span className="min-w-0">
                    <span className="block truncate font-semibold text-[#000a1e]">
                      {person.fullName}
                    </span>
                    <span className="mt-0.5 block truncate text-[12.5px] text-[#68727f] sm:hidden">
                      {person.presentCount}/{person.expectedCount} present ·{' '}
                      {Math.round(person.attendanceRate)}%
                    </span>
                  </span>
                  <span className="hidden text-right text-[13px] font-semibold tabular-nums text-[#5b6169] sm:block">
                    {person.presentCount}/{person.expectedCount}
                  </span>
                  <span className="text-right text-[15px] font-bold tabular-nums text-[#004a92]">
                    {Math.round(person.attendanceRate)}%
                  </span>
                  <ChevronRight className="hidden h-4 w-4 shrink-0 text-[#c4c6cf] transition-colors group-hover:text-[#005db6] sm:block" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </motion.section>
    </>
  );
}

/**
 * One person's morning-attendance history for the admin person detail page
 * (guide Phase 7): the recent session-by-session record plus their rate.
 */
export function PersonMorningHistory({ userId }: { userId: string }) {
  const client = getApiBrowserClient();
  const { data } = useQuery<MorningAnalytics>({
    queryKey: ['academic-operations', 'morning', 'person', userId],
    queryFn: () => fetchMorningAnalytics(client!, userId),
    enabled: Boolean(client && userId),
    staleTime: OPERATIONS_ANALYTICS_STALE_MS,
  });

  const history = data?.history ?? [];
  const personRow = data?.people.find((person) => person.userId === userId);

  if (!data || history.length === 0) {
    return null;
  }

  return (
    <section className={panelClass}>
      <SectionHeader
        eyebrow="Morning attendance"
        description={
          personRow
            ? `${Math.round(personRow.attendanceRate)}% attendance across ${personRow.expectedCount} recorded sessions.`
            : undefined
        }
      />
      <div className="mt-4 flex flex-wrap gap-1.5">
        {history.map((entry) => (
          <Badge
            key={entry.date}
            variant={entry.present ? 'success' : 'danger'}
          >
            {entry.date?.slice(5)} {entry.present ? 'Yes' : 'No'}
          </Badge>
        ))}
      </div>
    </section>
  );
}

// ---- Teaching occurrence ----

export function TeachingAnalyticsTab() {
  const client = getApiBrowserClient();
  const [selectedBlockId, setSelectedBlockId] = useState('all');
  const { data, isPending, isError } = useQuery<TeachingAnalytics>({
    queryKey: ['academic-operations', 'teaching'],
    queryFn: () => fetchTeachingAnalytics(client!),
    enabled: Boolean(client),
    staleTime: OPERATIONS_ANALYTICS_STALE_MS,
  });

  if (isPending) {
    return <TabLoading />;
  }

  if (isError || !data) {
    return (
      <TabError message="The teaching analytics response was unavailable or malformed." />
    );
  }

  const selectedBlock = data.blocks.find(
    (block) => block.batchId === selectedBlockId,
  );
  const scopedByActivity = selectedBlock?.byActivity ?? data.byActivity;
  const scopedMissedSessions =
    selectedBlock?.missedSessions ?? data.missedSessions;
  const scopedPendingBacklog =
    selectedBlock?.pendingBacklog ?? data.pendingBacklog;
  const scopeLabel = selectedBlock?.batchLabel ?? 'All blocks';
  const scopeSentenceLabel = selectedBlock?.batchLabel ?? 'all blocks';
  const chart = scopedByActivity.map((row) => ({
    activity:
      ACTIVITY_LABELS[row.activityType as TeachingActivityType] ??
      row.activityType,
    held: row.held,
    notHeld: row.notHeld,
  }));
  const blockChart = data.byBatch
    .filter((row) => selectedBlockId === 'all' || row.batchId === selectedBlockId)
    .map((row) => ({
      block: row.batchLabel,
      held: row.held,
      notHeld: row.notHeld,
    }));
  const totalHeld = scopedByActivity.reduce((sum, row) => sum + row.held, 0);
  const totalNotHeld = scopedByActivity.reduce(
    (sum, row) => sum + row.notHeld,
    0,
  );
  const totalCancelled = scopedByActivity.reduce(
    (sum, row) => sum + row.cancelled,
    0,
  );
  const decided = totalHeld + totalNotHeld;
  const overallHeldRate =
    decided > 0 ? Math.round((totalHeld / decided) * 100) : null;

  return (
    <>
      <ReportingScopePanel
        className="max-w-[520px]"
        fields={[
          {
            label: 'Student block',
            options: [
              { label: 'All blocks', value: 'all' },
              ...data.blocks.map((block) => ({
                label: block.batchLabel,
                value: block.batchId,
              })),
            ],
            placeholder: 'Choose a block',
            value: selectedBlockId,
            onValueChange: setSelectedBlockId,
          },
        ]}
        summary={scopeLabel}
      />

      <AcademicWorkspaceHero
        eyebrow="Teaching activities"
        title={selectedBlock ? selectedBlock.batchLabel : 'Teaching delivery'}
        description={
          selectedBlock
            ? `Held, missed, and pending teaching for ${selectedBlock.batchLabel}, ${academicWindowLabel(data.window)}. Every chart below follows this block filter.`
            : `Held and missed teaching across all blocks, ${academicWindowLabel(data.window)}. Choose a block to update every chart and follow-up count.`
        }
        metrics={[
          {
            label: 'Held',
            value: String(totalHeld),
            note: 'Recorded as delivered',
          },
          {
            label: 'Not held',
            value: String(totalNotHeld),
            note: 'Recorded as missed',
          },
          {
            label: 'Held rate',
            value: overallHeldRate !== null ? `${overallHeldRate}%` : '-',
            note: 'Of decided sessions',
          },
          {
            label: 'Pending',
            value: String(scopedPendingBacklog),
            note: `${totalCancelled} cancelled`,
          },
        ]}
      />

      {scopedByActivity.length === 0 ? (
        <motion.section
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, ease: 'easeOut' }}
          className={panelClass}
        >
          <SectionEmptyState
            icon={<GraduationCap className="h-6 w-6" />}
            title="No teaching sessions yet"
            description={`Occurrence rates appear once teaching sessions are generated for ${scopeSentenceLabel}.`}
          />
        </motion.section>
      ) : (
        <>
          <ChartCard
            key={`activity-${selectedBlockId}`}
            title={`Delivery by activity · ${scopeLabel}`}
            description="Held and missed records by teaching format. This graph updates with the selected block."
          >
            <ResponsiveContainer
              width="100%"
              height={260}
              initialDimension={{ width: 1, height: 260 }}
            >
              <BarChart
                title="Delivery by activity"
                data={chart}
                margin={{ top: 16, right: 20, bottom: 8, left: -12 }}
              >
                <CartesianGrid stroke={chartGridStroke} vertical={false} />
                <XAxis
                  dataKey="activity"
                  tick={chartTick}
                  tickLine={false}
                  axisLine={false}
                  tickMargin={12}
                />
                <YAxis
                  tick={chartTick}
                  tickLine={false}
                  axisLine={false}
                  allowDecimals={false}
                />
                <Tooltip
                  cursor={tooltipFillCursor}
                  contentStyle={lightTooltipStyle}
                  labelStyle={lightTooltipLabelStyle}
                  itemStyle={lightTooltipItemStyle}
                />
                <Legend {...chartLegendProps} />
                <Bar
                  dataKey="held"
                  name="Held"
                  fill={deliveryPalette.held}
                  radius={[4, 4, 0, 0]}
                  maxBarSize={24}
                />
                <Bar
                  dataKey="notHeld"
                  name="Not held"
                  fill={deliveryPalette.notHeld}
                  radius={[4, 4, 0, 0]}
                  maxBarSize={24}
                />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>

          <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-6 xl:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
            <motion.section
              key={`missed-${selectedBlockId}`}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, ease: 'easeOut' }}
              className={`${panelClass} min-w-0`}
            >
              <SectionHeader
                eyebrow="Missed teaching"
                title="Which block missed an activity"
                description="Each not-held record names the block, activity, date, subgroup, and reason."
              />
              <div className="mt-5 max-h-[25rem] overflow-y-auto pr-1">
                {scopedMissedSessions.length === 0 ? (
                  <p className="py-8 text-center text-sm text-[#666970]">
                    No missed teaching recorded for {scopeSentenceLabel}.
                  </p>
                ) : (
                  scopedMissedSessions.map((session) => (
                    <article
                      key={session.id}
                      className="border-b border-[#eef2f6] py-3.5 first:pt-0 last:border-b-0 last:pb-0"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="font-semibold text-[#000a1e]">
                            {ACTIVITY_LABELS[
                              session.activityType as TeachingActivityType
                            ] ?? session.activityType}
                          </p>
                          <p className="mt-1 text-[13px] leading-5 text-[#5f6670]">
                            {format(parseISO(session.scheduledDate), 'MMM d, yyyy')}
                            {session.subgroup
                              ? ` · Subgroup ${session.subgroup}`
                              : ''}
                          </p>
                        </div>
                        <Badge variant="warning">{session.batchLabel}</Badge>
                      </div>
                      <p className="mt-2 flex items-start gap-2 text-sm leading-5 text-[#45566a]">
                        <CalendarX2 className="mt-0.5 h-4 w-4 shrink-0 text-[#a96f00]" />
                        {session.reason}
                      </p>
                    </article>
                  ))
                )}
              </div>
            </motion.section>

            <ChartCard
              key={`blocks-${selectedBlockId}`}
              title={`Delivery by block · ${scopeLabel}`}
              description="Held and missed totals for each block in the active view."
            >
              <ResponsiveContainer
                width="100%"
                height={Math.max(220, blockChart.length * 64)}
                initialDimension={{ width: 1, height: 220 }}
              >
                <BarChart
                  title="Delivery by block"
                  data={blockChart}
                  layout="vertical"
                  margin={{ top: 8, right: 20, bottom: 8, left: 8 }}
                >
                  <CartesianGrid stroke={chartGridStroke} horizontal={false} />
                  <XAxis
                    type="number"
                    tick={chartTick}
                    tickLine={false}
                    axisLine={false}
                    allowDecimals={false}
                  />
                  <YAxis
                    type="category"
                    dataKey="block"
                    width={112}
                    tick={chartTick}
                    tickLine={false}
                    axisLine={false}
                  />
                  <Tooltip
                    cursor={tooltipFillCursor}
                    contentStyle={lightTooltipStyle}
                    labelStyle={lightTooltipLabelStyle}
                    itemStyle={lightTooltipItemStyle}
                  />
                  <Legend {...chartLegendProps} />
                  <Bar
                    dataKey="held"
                    name="Held"
                    fill={deliveryPalette.held}
                    radius={[0, 4, 4, 0]}
                    maxBarSize={20}
                  />
                  <Bar
                    dataKey="notHeld"
                    name="Not held"
                    fill={deliveryPalette.notHeld}
                    radius={[0, 4, 4, 0]}
                    maxBarSize={20}
                  />
                </BarChart>
              </ResponsiveContainer>
              {scopedPendingBacklog > 0 ? (
                <p className="mt-3 border-l-2 border-[#f0b429] pl-3 text-sm font-medium text-[#6f4a00]">
                  {scopedPendingBacklog} past session
                  {scopedPendingBacklog === 1 ? '' : 's'} still need a record in {scopeSentenceLabel}.
                </p>
              ) : null}
            </ChartCard>
          </div>
        </>
      )}
    </>
  );
}

// ---- Student progress ----

export function StudentsAnalyticsTab() {
  const client = getApiBrowserClient();
  const { data, isPending, isError } = useQuery<StudentAnalytics>({
    queryKey: ['academic-operations', 'students'],
    queryFn: () => fetchStudentAnalytics(client!),
    enabled: Boolean(client),
    staleTime: OPERATIONS_ANALYTICS_STALE_MS,
  });

  if (isPending) {
    return <TabLoading />;
  }

  if (isError || !data) {
    return (
      <TabError message="The student analytics response was unavailable or malformed." />
    );
  }

  const totalStudents = data.batches.reduce(
    (sum, batch) => sum + batch.studentCount,
    0,
  );
  const finalsRecorded = data.batches.reduce(
    (sum, batch) => sum + batch.finalsRecorded,
    0,
  );
  const attendanceWeight = data.batches.reduce(
    (sum, batch) => sum + (batch.avgAttendanceRate ?? 0) * batch.studentCount,
    0,
  );
  const studentsWithAttendance = data.batches.reduce(
    (sum, batch) =>
      sum + (batch.avgAttendanceRate === null ? 0 : batch.studentCount),
    0,
  );
  const averageAttendance =
    studentsWithAttendance > 0
      ? Math.round(attendanceWeight / studentsWithAttendance)
      : null;
  const ratedBatches = data.batches.filter(
    (batch) => batch.avgWeeklyRating !== null,
  );
  const averageWeeklyRating =
    ratedBatches.length > 0
      ? ratedBatches.reduce(
          (sum, batch) => sum + (batch.avgWeeklyRating ?? 0),
          0,
        ) / ratedBatches.length
      : null;

  return (
    <>
      <AcademicWorkspaceHero
        eyebrow="Student progress"
        title="Undergraduate performance"
        description={`Attendance, weekly evaluation movement, and final results from ${academicWindowLabel(data.window)}.`}
        metrics={[
          {
            label: 'Students',
            value: String(totalStudents),
            note: `${data.batches.length} active batches`,
          },
          {
            label: 'Attendance',
            value: averageAttendance !== null ? `${averageAttendance}%` : '-',
            note: 'Average recorded rate',
          },
          {
            label: 'Weekly rating',
            value:
              averageWeeklyRating !== null
                ? averageWeeklyRating.toFixed(1)
                : '-',
            note: 'Average across batches',
          },
          {
            label: 'Finals recorded',
            value: String(finalsRecorded),
            note: `Of ${totalStudents} students`,
          },
        ]}
      />

      <motion.section
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: 'easeOut' }}
        className={panelClass}
      >
        <SectionHeader
          eyebrow="Student detail"
          title="Progress by student"
          description="Attendance, weekly evaluation trajectory, and final result."
        />

        {data.students.length === 0 ? (
          <div className="mt-5">
            <SectionEmptyState
              icon={<GraduationCap className="h-6 w-6" />}
              title="No students yet"
              description="Progress appears once a batch has students, attendance, and evaluations."
            />
          </div>
        ) : (
          <StudentProgressTable students={data.students} />
        )}
      </motion.section>
    </>
  );
}
