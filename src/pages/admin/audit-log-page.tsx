import { useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { ArrowRight, ChevronDown, History, Search, ShieldCheck } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { ListSkeleton, TableSkeleton } from '@/components/layout/loading-skeletons'
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
import { fetchAdminAuditTrail } from '@/lib/api/admin'
import { fetchAcademicAuditTrail } from '@/lib/api/academic'
import { getApiBrowserClient } from '@/lib/api/client'
import { apiEnvSetupHint } from '@/lib/api/env'
import type { AcademicAuditEntry, AdminAuditEntry } from '@/lib/api/types'
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
    return '—'
  }

  return String(value)
}

function formatAuditDetailValue(value: unknown): string {
  if (value === null || value === undefined || value === '') {
    return '—'
  }

  if (typeof value === 'object') {
    return JSON.stringify(value)
  }

  return String(value)
}

function SectionEyebrow({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2">
      <span aria-hidden="true" className="h-3 w-[3px] rounded-full bg-[#f0b429]" />
      <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#005db6]">{label}</p>
    </div>
  )
}

function AcademicDirectionBadge({ direction }: { direction: AcademicAuditEntry['direction'] }) {
  return (
    <Badge variant={direction === 'resident' ? 'info' : 'success'}>
      {direction === 'resident' ? 'Resident eval' : 'Consultant eval'}
    </Badge>
  )
}

/**
 * Academic workspace audit: a chronological "who evaluated whom" feed. Evaluations
 * are immutable, so this is a submission trail (no field diffs like the clinical log).
 */
function AcademicAuditStream() {
  const client = getApiBrowserClient()
  const [entries, setEntries] = useState<AcademicAuditEntry[]>([])
  const [isLoading, setIsLoading] = useState(Boolean(client))
  const [error, setError] = useState<string | null>(
    client ? null : `The Laravel API is not configured. ${apiEnvSetupHint}`,
  )
  const [search, setSearch] = useState('')

  useEffect(() => {
    if (!client) {
      return
    }

    let active = true
    fetchAcademicAuditTrail(client)
      .then((response) => {
        if (active) {
          setEntries(response.data)
          setError(null)
        }
      })
      .catch((cause) => {
        if (active) {
          setError(
            cause instanceof Error ? cause.message : 'Failed to load the academic audit trail.',
          )
        }
      })
      .finally(() => {
        if (active) {
          setIsLoading(false)
        }
      })

    return () => {
      active = false
    }
  }, [client])

  const query = search.trim().toLowerCase()
  const filtered = query
    ? entries.filter((entry) =>
        [entry.authorName, entry.subjectName, entry.wardName].some((value) =>
          String(value ?? '').toLowerCase().includes(query),
        ),
      )
    : entries

  return (
    <motion.section
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: 'easeOut' }}
      className={sectionClass}
    >
      <div className="space-y-5">
        <div className="flex flex-col gap-4 border-b border-[#eef2f6] pb-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <SectionEyebrow label="Audit stream" />
            <h2 className="mt-1 font-display text-[1.4rem] font-bold tracking-[-0.02em] text-[#000a1e] md:text-[1.6rem]">
              Evaluation activity
            </h2>
            <p className="mt-1 text-sm text-[#74777f]">Who evaluated whom, newest first.</p>
          </div>
          <span className={cn(countChipClass, 'whitespace-nowrap')}>
            <History className="h-3.5 w-3.5 text-[#005db6]" />
            {formatCompactNumber(filtered.length)} filed
          </span>
        </div>

        <div className="relative w-full sm:w-72">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#9aa7b8]" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search evaluator, subject, or ward"
            className="h-10 pl-9 text-sm"
          />
        </div>

        {error ? (
          <div className="rounded-[0.4rem] border border-dashed border-[#f1d1d1] bg-[#fff6f6] px-6 py-10 text-center text-sm text-[#9d2a2a]">
            {error}
          </div>
        ) : isLoading ? (
          <TableSkeleton rows={7} columns={4} />
        ) : filtered.length ? (
          <div className="overflow-hidden rounded-[0.4rem] border border-[#e6ecf3]">
            <div className="hidden items-center gap-3 border-b border-[#eef2f6] bg-[#f7f9fc] px-4 py-2.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-[#74777f] lg:flex">
              <span className="min-w-0 flex-[2_1_0%]">Evaluator → Subject</span>
              <span className="min-w-[8rem] flex-1">Ward · Date</span>
              <span className="w-16 shrink-0 text-right">Score</span>
              <span className="min-w-[9rem] flex-1 text-right">Filed</span>
            </div>

            {filtered.map((entry) => (
              <div
                key={`${entry.direction}-${entry.id}`}
                className="flex items-center gap-3 border-b border-[#eef2f6] px-4 py-2.5 last:border-b-0"
              >
                <span className="flex min-w-0 flex-[2_1_0%] flex-col items-start gap-1.5">
                  <span className="flex w-full items-center gap-2 text-sm">
                    <span className="truncate font-semibold text-[#000a1e]">
                      {entry.authorName ?? 'Unknown'}
                    </span>
                    <ArrowRight className="h-3.5 w-3.5 shrink-0 text-[#9aa7b8]" />
                    <span className="truncate text-[#1d3047]">{entry.subjectName ?? 'Unknown'}</span>
                  </span>
                  <AcademicDirectionBadge direction={entry.direction} />
                </span>
                <span className="hidden min-w-[8rem] flex-1 text-xs text-[#74777f] lg:block">
                  {entry.wardName ?? '—'}
                  <span className="mt-0.5 block text-[11px]">
                    {entry.evaluationDate ? formatTimestamp(entry.evaluationDate) : '—'}
                  </span>
                </span>
                <span className="hidden w-16 shrink-0 text-right text-xs lg:block">
                  {entry.overallRating != null ? (
                    <span className="font-semibold text-[#000a1e]">{entry.overallRating}/5</span>
                  ) : (
                    <span className="text-[#74777f]">
                      {entry.indicatorsMet}/{entry.indicatorsTotal}
                    </span>
                  )}
                </span>
                <span className="hidden min-w-[9rem] flex-1 text-right text-[11px] text-[#74777f] lg:block">
                  {entry.createdAt ? formatTimestamp(entry.createdAt) : '—'}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex min-h-[200px] flex-col items-center justify-center gap-3 rounded-[0.4rem] border border-dashed border-[#d4dde8] bg-[#f7f9fc] px-6 text-center">
            <span className="flex h-11 w-11 items-center justify-center rounded-[0.4rem] bg-[#edf4fb] text-[#005db6]">
              <History className="h-5 w-5" />
            </span>
            <p className="text-sm leading-6 text-[#5b6169]">
              {search ? 'No evaluations match the search.' : 'No evaluations have been filed yet.'}
            </p>
          </div>
        )}
      </div>
    </motion.section>
  )
}

const ADMIN_ACTION_LABELS: Record<string, string> = {
  upsert: 'Created',
  create: 'Created',
  update: 'Updated',
  approve: 'Approved',
  reject: 'Rejected',
  delete: 'Removed',
}

function humanizeAction(action: string) {
  return ADMIN_ACTION_LABELS[action] ?? `${action.charAt(0).toUpperCase()}${action.slice(1)}`
}

function ActionChip({ action }: { action: string }) {
  const tone =
    action === 'approve'
      ? 'bg-[#edf7f0] text-[#1f6b3b]'
      : action === 'reject' || action === 'delete'
        ? 'bg-[#fceeee] text-[#ba1a1a]'
        : 'bg-[#edf4fb] text-[#005db6]'

  return (
    <span className={cn('shrink-0 rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em]', tone)}>
      {humanizeAction(action)}
    </span>
  )
}

/**
 * Cross-cutting account & access actions (approvals, role/assignment changes) from
 * the AdminAuditLog. These belong to neither domain, so the section shows in BOTH
 * the clinical and academic workspaces.
 */
function AdminActionsStream() {
  const client = getApiBrowserClient()
  const [entries, setEntries] = useState<AdminAuditEntry[]>([])
  const [isLoading, setIsLoading] = useState(Boolean(client))
  const [error, setError] = useState<string | null>(
    client ? null : `The Laravel API is not configured. ${apiEnvSetupHint}`,
  )
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set())

  const toggleExpanded = (id: string) =>
    setExpandedIds((current) => {
      const next = new Set(current)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })

  useEffect(() => {
    if (!client) {
      return
    }

    let active = true
    fetchAdminAuditTrail(client)
      .then((data) => {
        if (active) {
          setEntries(data)
          setError(null)
        }
      })
      .catch((cause) => {
        if (active) {
          setError(cause instanceof Error ? cause.message : 'Failed to load account actions.')
        }
      })
      .finally(() => {
        if (active) {
          setIsLoading(false)
        }
      })

    return () => {
      active = false
    }
  }, [client])

  return (
    <motion.section
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: 'easeOut', delay: 0.04 }}
      className={sectionClass}
    >
      <div className="space-y-5">
        <div className="flex flex-col gap-4 border-b border-[#eef2f6] pb-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <SectionEyebrow label="Account" />
            <h2 className="mt-1 font-display text-[1.4rem] font-bold tracking-[-0.02em] text-[#000a1e] md:text-[1.6rem]">
              Account &amp; access actions
            </h2>
            <p className="mt-1 text-sm text-[#74777f]">
              Approvals, role and assignment changes — shown in both workspaces.
            </p>
          </div>
          {!error && !isLoading ? (
            <span className={cn(countChipClass, 'whitespace-nowrap')}>
              <ShieldCheck className="h-3.5 w-3.5 text-[#005db6]" />
              {formatCompactNumber(entries.length)} actions
            </span>
          ) : null}
        </div>

        {error ? (
          <div className="rounded-[0.4rem] border border-dashed border-[#f1d1d1] bg-[#fff6f6] px-6 py-8 text-center text-sm text-[#9d2a2a]">
            {error}
          </div>
        ) : isLoading ? (
          <ListSkeleton rows={4} />
        ) : entries.length ? (
          <div className="overflow-hidden rounded-[0.4rem] border border-[#e6ecf3]">
            {entries.map((entry) => {
              const changedKeys = [
                ...new Set([
                  ...Object.keys(entry.oldValues ?? {}),
                  ...Object.keys(entry.newValues ?? {}),
                ]),
              ]
              const hasDetail = changedKeys.length > 0 || Boolean(entry.entityId)
              const expanded = expandedIds.has(entry.id)

              return (
                <div key={entry.id} className="border-b border-[#eef2f6] last:border-b-0">
                  <div
                    onClick={() => {
                      if (hasDetail) {
                        toggleExpanded(entry.id)
                      }
                    }}
                    className={cn(
                      'flex flex-wrap items-center gap-3 px-4 py-2.5 transition-colors duration-200',
                      hasDetail && 'cursor-pointer hover:bg-[#f7f9fc]',
                    )}
                  >
                    {hasDetail ? (
                      <button
                        type="button"
                        aria-expanded={expanded}
                        aria-label={`${expanded ? 'Hide' : 'Show'} action detail`}
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
                    ) : (
                      <span aria-hidden className="w-5 shrink-0" />
                    )}
                    <ActionChip action={entry.action} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold capitalize text-[#000a1e]">
                        {entry.entityType.replace(/_/g, ' ')}
                      </span>
                      <span className="block truncate text-xs text-[#74777f]">{entry.userName ?? 'System'}</span>
                    </span>
                    <span className="shrink-0 text-[11px] text-[#74777f]">
                      {entry.createdAt ? formatTimestamp(entry.createdAt) : '—'}
                    </span>
                  </div>

                  {expanded && hasDetail ? (
                    <div className="space-y-3 border-t border-[#eef2f6] bg-[#f7f9fc] px-4 py-3.5">
                      {changedKeys.length ? (
                        <div className="overflow-hidden rounded-[0.4rem] border border-[#e6ecf3] bg-white">
                          <div className="grid grid-cols-[minmax(0,0.8fr)_minmax(0,1fr)_minmax(0,1fr)] gap-2 border-b border-[#eef2f6] bg-[#f7f9fc] px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-[#74777f]">
                            <span>Field</span>
                            <span>Before</span>
                            <span>After</span>
                          </div>
                          {changedKeys.map((key) => (
                            <div
                              key={key}
                              className="grid grid-cols-[minmax(0,0.8fr)_minmax(0,1fr)_minmax(0,1fr)] gap-2 border-b border-[#f1f4f8] px-3 py-2 text-xs last:border-b-0"
                            >
                              <span className="truncate font-medium capitalize text-[#1d3047]">
                                {key.replace(/_/g, ' ')}
                              </span>
                              <span className="break-words text-[#74777f]">
                                {formatAuditDetailValue(entry.oldValues?.[key])}
                              </span>
                              <span className="break-words font-semibold text-[#000a1e]">
                                {formatAuditDetailValue(entry.newValues?.[key])}
                              </span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-xs text-[#74777f]">
                          No field-level changes were recorded for this action.
                        </p>
                      )}
                      <div className="flex flex-wrap items-center gap-2 text-xs text-[#74777f]">
                        <span>By {entry.userName ?? 'System'}</span>
                        {entry.entityId ? (
                          <>
                            <span className="text-[#9aa7b8]">·</span>
                            <span>Target ID {entry.entityId}</span>
                          </>
                        ) : null}
                        {entry.ipAddress ? (
                          <>
                            <span className="text-[#9aa7b8]">·</span>
                            <span>{entry.ipAddress}</span>
                          </>
                        ) : null}
                        {entry.createdAt ? (
                          <>
                            <span className="text-[#9aa7b8]">·</span>
                            <span>{formatTimestamp(entry.createdAt)}</span>
                          </>
                        ) : null}
                      </div>
                    </div>
                  ) : null}
                </div>
              )
            })}
          </div>
        ) : (
          <div className="rounded-[0.4rem] border border-dashed border-[#d4dde8] bg-[#f7f9fc] px-6 py-8 text-center text-sm text-[#74777f]">
            No account actions recorded yet.
          </div>
        )}
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
      {workspace === 'academic' ? (
        <AcademicAuditStream />
      ) : (
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
              <div className="hidden items-center gap-3 border-b border-[#eef2f6] bg-[#f7f9fc] px-4 py-2.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-[#74777f] lg:flex">
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
                        <span className="block truncate text-xs text-[#74777f]">
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
                        <span className="block text-[11px] text-[#74777f]">
                          {formatTimestamp(entry.changedAt)}
                        </span>
                      </span>
                    </div>

                    {expanded ? (
                      <div className="space-y-3 border-t border-[#eef2f6] bg-[#f7f9fc] px-4 py-3.5">
                        <div className="grid gap-3 sm:grid-cols-2">
                          <div className="rounded-[0.4rem] border border-[#e6ecf3] bg-white p-3.5">
                            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#74777f]">
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
                        <div className="flex flex-wrap items-center gap-2 text-xs text-[#74777f]">
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

      <AdminActionsStream />
    </div>
  )
}
