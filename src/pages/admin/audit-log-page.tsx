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
  'rounded-[0.35rem] bg-white px-4 py-5 outline outline-1 outline-[#d4dde8] shadow-[0_24px_60px_-42px_rgba(0,33,71,0.28)] md:px-5 md:py-5'
// Shared by the header strip and every row so the table reads as columns.
// Matches the workspace trail above it, so the page has one rhythm, not two.
const EDIT_GRID =
  'grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3 lg:grid-cols-[9.5rem_9rem_minmax(0,1fr)_minmax(0,13rem)_1rem]'
const countChipClass =
  'inline-flex items-center gap-2 self-start rounded-full bg-[#f4f7fb] px-3.5 py-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#44474e] outline outline-1 outline-[#e3e9f1]'

function formatAuditValue(value: string | number | null) {
  if (value === null || value === undefined || value === '') {
    return '-'
  }

  return String(value)
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
      <div className="space-y-4">
        <h2 className="font-display text-[1.15rem] font-bold tracking-[-0.02em] text-[#000a1e]">
          {isAcademic ? 'Academic activity' : 'Clinical activity'}
        </h2>

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
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="mr-auto font-display text-[1.15rem] font-bold tracking-[-0.02em] text-[#000a1e]">
              Report edits
            </h2>
            <span className={cn(countChipClass, 'whitespace-nowrap')}>
              <History className="h-3.5 w-3.5 text-[#005db6]" />
              {formatCompactNumber(entries.length)}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Select value={departmentFilter} onValueChange={setDepartmentFilter}>
              <SelectTrigger className="h-9 w-full text-sm sm:w-[13rem]" aria-label="Filter by department">
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
            <div className="relative min-w-[13rem] flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#69727d]" />
              <Input
                value={auditSearch}
                onChange={(event) => setAuditSearch(event.target.value)}
                placeholder="Search field, value, or editor"
                className="h-9 pl-9 text-sm"
              />
            </div>
          </div>

          {entries.length ? (
            <div className="overflow-hidden rounded-[0.35rem] border border-[#e6ecf3]">
              <div
                className={cn(
                  EDIT_GRID,
                  'hidden border-b border-[#eef2f6] bg-[#f8fafc] px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-[#6c7177] lg:grid',
                )}
              >
                <span>When</span>
                <span>Who</span>
                <span>Field</span>
                <span>Change</span>
                <span />
              </div>

              {visibleEntries.map((entry) => {
                const department =
                  departments.find((candidate) => candidate.id === entry.departmentId) ?? null
                const templateName = templateMap[entry.templateId]?.name ?? 'Template'
                const expanded = expandedEntries.has(entry.id)

                return (
                  <div key={entry.id} className="border-b border-[#f0f3f7] last:border-b-0">
                    <button
                      type="button"
                      aria-expanded={expanded}
                      aria-label={`${expanded ? 'Hide' : 'Show'} change detail`}
                      onClick={() => toggleExpanded(entry.id)}
                      className={cn(EDIT_GRID, 'w-full px-3 py-2 text-left transition-colors hover:bg-[#f7f9fc]')}
                    >
                      <span className="order-2 shrink-0 whitespace-nowrap text-xs tabular-nums text-[#6c7177] lg:order-none">
                        {formatTimestamp(entry.changedAt)}
                      </span>
                      <span className="order-3 col-span-2 truncate text-[13px] text-[#52606d] lg:order-none lg:col-span-1">
                        {entry.changedByName}
                      </span>
                      <span className="order-1 min-w-0 truncate text-[13px] lg:order-none">
                        <span className="font-semibold text-[#000a1e]">{entry.fieldLabel}</span>
                        <span className="text-[#9aa6b5]"> · </span>
                        <span className="text-[#666970]">
                          {department?.name ?? entry.departmentId} · {templateName}
                        </span>
                      </span>
                      <span className="order-4 col-span-2 flex min-w-0 items-baseline gap-1.5 text-xs lg:order-none lg:col-span-1">
                        <span className="min-w-0 truncate text-[#6c7177] line-through decoration-[#c4c6cf]">
                          {formatAuditValue(entry.oldValue)}
                        </span>
                        <ArrowRight aria-hidden className="h-3 w-3 shrink-0 self-center text-[#c0c8d2]" />
                        <span className="min-w-0 truncate font-semibold text-[#000a1e]">
                          {formatAuditValue(entry.newValue)}
                        </span>
                      </span>
                      <span className="order-5 hidden justify-self-end lg:order-none lg:block">
                        <ChevronDown
                          aria-hidden
                          className={cn(
                            'h-4 w-4 text-[#c0c8d2] transition-transform duration-200',
                            expanded && 'rotate-180',
                          )}
                        />
                      </span>
                    </button>

                    {expanded ? (
                      <div className="mx-3 mb-2.5 space-y-2.5 rounded-[0.35rem] bg-[#f7f9fc] px-3.5 py-3">
                        <dl className="grid gap-x-6 gap-y-2.5 sm:grid-cols-2">
                          <div className="flex flex-col gap-0.5">
                            <dt className="text-[12px] font-medium text-[#666970]">Before</dt>
                            <dd className="break-words text-[13px] leading-5 text-[#52606d]">
                              {formatAuditValue(entry.oldValue)}
                            </dd>
                          </div>
                          <div className="flex flex-col gap-0.5">
                            <dt className="text-[12px] font-medium text-[#666970]">After</dt>
                            <dd className="break-words text-[13px] font-medium leading-5 text-[#000a1e]">
                              {formatAuditValue(entry.newValue)}
                            </dd>
                          </div>
                        </dl>
                        <div className="flex flex-wrap items-center gap-2 border-t border-[#e6ecf3] pt-2.5 text-xs text-[#6c7177]">
                          {department ? (
                            <Badge variant="info">{serviceLineLabels[department.family]}</Badge>
                          ) : null}
                          <span>{templateName}</span>
                          <span className="text-[#c0c8d2]">·</span>
                          <span>{entry.changedByName}</span>
                        </div>
                      </div>
                    ) : null}
                  </div>
                )
              })}

              {entries.length > visibleEntries.length ? (
                <div className="flex items-center justify-center border-t border-[#eef2f6] bg-[#f8fafc] px-3 py-2">
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
            <div className="flex min-h-[9rem] flex-col items-center justify-center gap-2 rounded-[0.35rem] border border-dashed border-[#dbe3ec] bg-[#f8fafc] px-6 text-center">
              <History aria-hidden className="h-6 w-6 text-[#9aa6b5]" />
              <p className="text-sm text-[#5f6670]">
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
