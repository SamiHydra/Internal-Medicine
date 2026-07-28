import { useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { ArrowRight, ChevronDown, History, Search } from 'lucide-react'

import { WorkspaceAuditTrail } from '@/components/admin/workspace-audit-trail'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { departments, templateMap } from '@/config/templates'
import { useAppData } from '@/context/app-data-context'
import { useWorkspace } from '@/context/workspace-context'
import { formatTimestamp } from '@/lib/dates'
import { cn, formatCompactNumber } from '@/lib/utils'

const serviceLineLabels = {
  inpatient: 'Inpatient',
  outpatient: 'Outpatient',
  procedure: 'Procedures',
} as const

const sectionClass =
  'rounded-[0.35rem] bg-white px-5 py-6 outline outline-1 outline-[#d4dde8] shadow-[0_24px_60px_-42px_rgba(0,33,71,0.28)] md:px-6 md:py-7'
const countChipClass =
  'inline-flex items-center gap-2 self-start rounded-full bg-[#f4f7fb] px-3.5 py-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#44474e] outline outline-1 outline-[#e3e9f1]'

function formatAuditValue(value: string | number | null) {
  if (value === null || value === undefined || value === '') {
    return '-'
  }

  return String(value)
}

function SectionEyebrow({ label }: { label: string }) {
  return (
    <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#005db6]">{label}</p>
  )
}

/**
 * The workspace activity trail, identical in both workspaces. The section
 * chrome lives here; the trail itself is WorkspaceAuditTrail, which reads the
 * real workspace-scoped audit log (plus the system-wide rows) rather than any
 * single table.
 */
function WorkspaceAuditSection({
  workspace,
}: {
  workspace: 'clinical' | 'academic'
}) {
  const isAcademic = workspace === 'academic'

  return (
    <motion.section
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: 'easeOut' }}
      className={sectionClass}
    >
      <div className="space-y-5">
        <div className="border-b border-[#eef2f6] pb-5">
          <SectionEyebrow label="Audit stream" />
          <h2 className="mt-1 font-display text-[1.4rem] font-bold tracking-[-0.02em] text-[#000a1e] md:text-[1.6rem]">
            {isAcademic ? 'Academic activity' : 'Clinical activity'}
          </h2>
          <p className="mt-1 text-sm text-[#74777f]">
            {isAcademic
              ? 'Every recorded academic action - evaluations, morning sessions, teaching, roster, students and structure - newest first.'
              : 'Every recorded clinical action - reports, assignments, templates, settings and access - newest first.'}
          </p>
        </div>

        <WorkspaceAuditTrail
          workspace={workspace}
          noun={isAcademic ? 'academic' : 'clinical'}
        />
      </div>
    </motion.section>
  )
}

const AUDIT_LOG_PAGE_SIZE = 100

export function AuditLogPage() {
  const { state, ensureHistoryData } = useAppData()
  const { workspace } = useWorkspace()
  const [departmentFilter, setDepartmentFilter] = useState('all')
  const [auditSearch, setAuditSearch] = useState('')
  const [expandedEntries, setExpandedEntries] = useState<Set<string>>(() => new Set())

  useEffect(() => {
    if (workspace === 'academic') {
      return
    }

    void ensureHistoryData()
  }, [workspace, ensureHistoryData])

  const toggleExpanded = (id: string) =>
    setExpandedEntries((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })

  // audit_logs is the fastest-growing table; sorting/filtering it inline re-ran
  // on every poll-driven re-render and every search keystroke. Memoize each
  // stage on its real inputs so typing only re-runs the final filter.
  const query = auditSearch.trim().toLowerCase()
  const orderedEntries = useMemo(
    () =>
      [...state.auditLogs].sort((left, right) =>
        right.changedAt.localeCompare(left.changedAt),
      ),
    [state.auditLogs],
  )
  const scopedEntries = useMemo(
    () =>
      orderedEntries.filter((entry) =>
        departmentFilter === 'all' ? true : entry.departmentId === departmentFilter,
      ),
    [orderedEntries, departmentFilter],
  )
  const entries = useMemo(
    () =>
      query
        ? scopedEntries.filter((entry) =>
            [
              entry.fieldLabel,
              entry.changedByName,
              formatAuditValue(entry.oldValue),
              formatAuditValue(entry.newValue),
            ].some((value) => String(value).toLowerCase().includes(query)),
          )
        : scopedEntries,
    [scopedEntries, query],
  )

  // Render a bounded window of rows. The full filtered set still drives the
  // count chip and the search; "Show more" reveals additional pages so a large
  // history never mounts thousands of expandable rows at once.
  const [visibleCount, setVisibleCount] = useState(AUDIT_LOG_PAGE_SIZE)
  // Collapse back to the first page whenever the filter/search changes, using
  // the during-render reset pattern (no effect, so no cascading-render churn).
  const filterKey = `${departmentFilter}:${query}`
  const [lastFilterKey, setLastFilterKey] = useState(filterKey)
  if (filterKey !== lastFilterKey) {
    setLastFilterKey(filterKey)
    setVisibleCount(AUDIT_LOG_PAGE_SIZE)
  }
  const visibleEntries = useMemo(
    () => entries.slice(0, visibleCount),
    [entries, visibleCount],
  )

  const departmentOptions = [
    { value: 'all', label: 'All departments' },
    ...departments.map((department) => ({ value: department.id, label: department.name })),
  ] as const

  return (
    <div className="space-y-6 px-4 py-5 md:px-6 md:py-8">
      <WorkspaceAuditSection
        workspace={workspace === 'academic' ? 'academic' : 'clinical'}
      />

      {/* Clinical only: report cell edits are not admin actions, so they have
          no equivalent in the academic workspace. */}
      {workspace === 'academic' ? null : (
      <motion.section
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: 'easeOut', delay: 0.04 }}
        className={sectionClass}
      >
        <div className="space-y-5">
          <div className="flex flex-col gap-4 border-b border-[#eef2f6] pb-5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <SectionEyebrow label="Audit stream" />
              <h2 className="mt-1 font-display text-[1.4rem] font-bold tracking-[-0.02em] text-[#000a1e] md:text-[1.6rem]">
                Change history
              </h2>
              <p className="mt-1 text-sm text-[#74777f]">Field edits across reports, newest first.</p>
            </div>
            <span className={cn(countChipClass, 'whitespace-nowrap')}>
              <History className="h-3.5 w-3.5 text-[#005db6]" />
              {formatCompactNumber(entries.length)} rows
            </span>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <Select value={departmentFilter} onValueChange={setDepartmentFilter}>
              <SelectTrigger className="h-10 w-full text-sm sm:w-[260px]" aria-label="Filter by department">
                <SelectValue placeholder="All departments" />
              </SelectTrigger>
              <SelectContent>
                {departmentOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="relative w-full sm:w-72">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#9aa7b8]" />
              <Input
                value={auditSearch}
                onChange={(event) => setAuditSearch(event.target.value)}
                placeholder="Search field, value, or editor"
                className="h-10 pl-9 text-sm"
              />
            </div>
          </div>

          {entries.length ? (
            <div className="overflow-hidden rounded-[0.4rem] border border-[#e6ecf3]">
              <div className="hidden items-center gap-3 border-b border-[#eef2f6] bg-[#f7f9fc] px-4 py-2.5 text-[11px] font-bold uppercase tracking-[0.12em] text-[#526171] lg:flex">
                <span className="w-4 shrink-0" />
                <span className="min-w-0 flex-1">Field</span>
                <span className="min-w-0 flex-1">Change</span>
                <span className="w-40 shrink-0 text-right">By · When</span>
              </div>

              {visibleEntries.map((entry) => {
                const department =
                  departments.find((candidate) => candidate.id === entry.departmentId) ?? null
                const templateName = templateMap[entry.templateId]?.name ?? 'Template'
                const expanded = expandedEntries.has(entry.id)

                return (
                  <div key={entry.id} className="border-b border-[#eef2f6] last:border-b-0">
                    <div
                      onClick={() => toggleExpanded(entry.id)}
                      className="flex cursor-pointer items-center gap-3 px-4 py-2.5 transition-colors duration-200 hover:bg-[#f7f9fc]"
                    >
                      <button
                        type="button"
                        aria-expanded={expanded}
                        aria-label={`${expanded ? 'Hide' : 'Show'} change detail`}
                        onClick={(event) => {
                          event.stopPropagation()
                          toggleExpanded(entry.id)
                        }}
                        className="shrink-0 rounded-[0.25rem] p-0.5 text-[#9aa7b8] outline-none transition-colors hover:text-[#005db6] focus-visible:text-[#005db6]"
                      >
                        <ChevronDown
                          className={cn(
                            'h-4 w-4 transition-transform duration-200 ease-[cubic-bezier(0.23,1,0.32,1)]',
                            expanded && 'rotate-180',
                          )}
                        />
                      </button>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold text-[#000a1e]">
                          {entry.fieldLabel}
                        </span>
                        <span className="block truncate text-[13px] leading-5 text-[#5f6670]">
                          {department?.name ?? entry.departmentId} · {templateName}
                        </span>
                      </span>
                      <span className="hidden min-w-0 flex-1 items-center gap-2 text-xs lg:flex">
                        <span className="max-w-[45%] truncate text-[#74777f]">
                          {formatAuditValue(entry.oldValue)}
                        </span>
                        <ArrowRight className="h-3.5 w-3.5 shrink-0 text-[#9aa7b8]" />
                        <span className="max-w-[45%] truncate font-semibold text-[#000a1e]">
                          {formatAuditValue(entry.newValue)}
                        </span>
                      </span>
                      <span className="hidden w-40 shrink-0 text-right lg:block">
                        <span className="block truncate text-xs font-medium text-[#1d3047]">
                          {entry.changedByName}
                        </span>
                        <span className="block text-xs text-[#657180]">
                          {formatTimestamp(entry.changedAt)}
                        </span>
                      </span>
                    </div>

                    {expanded ? (
                      <div className="space-y-3 border-t border-[#eef2f6] bg-[#f7f9fc] px-4 py-3.5">
                        <div className="grid gap-3 sm:grid-cols-2">
                          <div className="rounded-[0.4rem] border border-[#e6ecf3] bg-white p-3.5">
                            <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#526171]">
                              Before
                            </p>
                            <p className="mt-1.5 break-words text-sm font-medium leading-6 text-[#44474e]">
                              {formatAuditValue(entry.oldValue)}
                            </p>
                          </div>
                          <div className="rounded-[0.4rem] border border-[#cfe0f4] bg-white p-3.5">
                            <div className="flex items-center gap-2">
                              <ArrowRight className="h-4 w-4 text-[#005db6]" />
                              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#005db6]">
                                After
                              </p>
                            </div>
                            <p className="mt-1.5 break-words text-sm font-medium leading-6 text-[#000a1e]">
                              {formatAuditValue(entry.newValue)}
                            </p>
                          </div>
                        </div>
                        <div className="flex flex-wrap items-center gap-2 text-[13px] leading-5 text-[#5f6670]">
                          {department ? (
                            <Badge variant="info">{serviceLineLabels[department.family]}</Badge>
                          ) : null}
                          <span>{templateName}</span>
                          <span className="text-[#9aa7b8]">·</span>
                          <span>Edited by {entry.changedByName}</span>
                          <span className="text-[#9aa7b8]">·</span>
                          <span>{formatTimestamp(entry.changedAt)}</span>
                        </div>
                      </div>
                    ) : null}
                  </div>
                )
              })}

              {entries.length > visibleEntries.length ? (
                <div className="flex items-center justify-center border-t border-[#eef2f6] bg-[#f7f9fc] px-4 py-3">
                  <button
                    type="button"
                    onClick={() => setVisibleCount((count) => count + AUDIT_LOG_PAGE_SIZE)}
                    className="rounded-[0.3rem] px-3 py-1.5 text-xs font-semibold text-[#005db6] outline-none transition-colors hover:bg-[#edf4fb] focus-visible:bg-[#edf4fb]"
                  >
                    Show more ({formatCompactNumber(entries.length - visibleEntries.length)} older)
                  </button>
                </div>
              ) : null}
            </div>
          ) : (
            <div className="flex min-h-[200px] flex-col items-center justify-center gap-3 rounded-[0.4rem] border border-dashed border-[#d4dde8] bg-[#f7f9fc] px-6 text-center">
              <span className="flex h-11 w-11 items-center justify-center rounded-[0.4rem] bg-[#edf4fb] text-[#005db6]">
                <History className="h-5 w-5" />
              </span>
              <p className="text-sm leading-6 text-[#5b6169]">
                {auditSearch || departmentFilter !== 'all'
                  ? 'No changes match the current filters.'
                  : 'No report edits have been logged yet.'}
              </p>
            </div>
          )}
        </div>
      </motion.section>
      )}
    </div>
  )
}
