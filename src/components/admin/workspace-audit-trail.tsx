import { useQuery } from '@tanstack/react-query'
import { format, isToday, isYesterday, parseISO } from 'date-fns'
import { ChevronDown, History, Search } from 'lucide-react'
import { useMemo, useState } from 'react'

import { ListSkeleton } from '@/components/layout/loading-skeletons'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { fetchWorkspaceAuditTrail } from '@/lib/api/admin'
import { getApiBrowserClient } from '@/lib/api/client'
import { apiEnvSetupHint } from '@/lib/api/env'
import type { AdminAuditEntry } from '@/lib/api/types'
import {
  auditFieldLabel,
  auditFieldValueCase,
  describeAuditEntry,
  isIdentifier,
  type Tone,
} from '@/lib/audit-narrative'
import { formatAuditFieldValue, formatTimestamp } from '@/lib/dates'
import { cn } from '@/lib/utils'

const ALL = 'all'

/** A dot in the margin, coloured by what kind of change this was. */
const TONE_DOT: Record<Tone, string> = {
  create: 'bg-[#1f9254]',
  update: 'bg-[#005db6]',
  remove: 'bg-[#ba1a1a]',
  approve: 'bg-[#1f9254]',
  reject: 'bg-[#ba1a1a]',
  neutral: 'bg-[#9aa6b5]',
}

/** "Today" beats a date a reader has to work out for themselves. */
function dayHeading(iso: string | null): string {
  if (!iso) return 'Undated'

  const date = parseISO(iso)
  if (Number.isNaN(date.getTime())) return 'Undated'
  if (isToday(date)) return 'Today'
  if (isYesterday(date)) return 'Yesterday'

  return format(date, 'EEEE, d MMMM yyyy')
}

/** Search reads the sentence, so what is typed matches what is on screen. */
function searchableText(entry: AdminAuditEntry): string {
  const narrative = describeAuditEntry(entry)

  return [
    narrative.actor,
    narrative.verb,
    narrative.object,
    narrative.name,
    entry.entityLabel,
    entry.actionLabel,
    ...narrative.facts.map((fact) => `${fact.label ?? ''} ${fact.value}`),
  ]
    .filter(Boolean)
    .join(' ')
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * Settings are stored as nested objects. Printing them as one line still reads
 * as machinery, so a nested object becomes an indented list of its own labelled
 * rows and only scalars are ever rendered as text.
 */
function AuditValue({ value }: { value: unknown }) {
  if (isPlainObject(value)) {
    const entries = Object.entries(value)

    if (entries.length === 0) {
      return <span className="text-[#666970]">None</span>
    }

    return (
      <ul className="mt-1 space-y-1 border-l border-[#dbe3ec] pl-3">
        {entries.map(([key, nested]) => (
          <li key={key} className="text-[13px] leading-5 text-[#1d3047]">
            <span className="text-[#666970]">{auditFieldLabel(key)}: </span>
            {isPlainObject(nested) ? (
              <AuditValue value={nested} />
            ) : (
              formatAuditFieldValue(nested)
            )}
          </li>
        ))}
      </ul>
    )
  }

  // A yes/no column is a state, so it reads as one rather than as the word
  // "Yes" sitting under a label that already asked the question.
  if (typeof value === 'boolean') {
    return (
      <span
        className={cn(
          'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold',
          value ? 'bg-[#edf7f0] text-[#1f6b3b]' : 'bg-[#fceeee] text-[#9f1717]',
        )}
      >
        <span
          aria-hidden
          className={cn('h-1.5 w-1.5 rounded-full', value ? 'bg-[#1f9254]' : 'bg-[#ba1a1a]')}
        />
        {value ? 'Yes' : 'No'}
      </span>
    )
  }

  return <>{auditFieldValueCase(formatAuditFieldValue(value))}</>
}

function DetailRow({
  label,
  before,
  after,
  changed,
}: {
  label: string
  before: unknown
  after: unknown
  changed: boolean
}) {
  // Label and value on one line, in two aligned columns: a record card, not a
  // grid of loose blocks. Stacking them doubled the height of every field and
  // left the eye no column to run down.
  return (
    <div className="flex flex-wrap items-baseline gap-x-4 gap-y-0.5 py-1.5">
      <dt className="w-32 shrink-0 text-[12.5px] text-[#6c7177]">{label}</dt>
      <dd className="min-w-0 flex-1 break-words text-[13px] leading-5 text-[#1d3047]">
        {changed ? (
          <span className="flex flex-wrap items-baseline gap-1.5">
            <span className="text-[#a9b2bd] line-through decoration-[#d4dde8]">
              {auditFieldValueCase(formatAuditFieldValue(before))}
            </span>
            <span aria-hidden className="text-[#9aa6b5]">
              →
            </span>
            <span className="font-semibold text-[#000a1e]">
              {auditFieldValueCase(formatAuditFieldValue(after))}
            </span>
          </span>
        ) : (
          <AuditValue value={after ?? before} />
        )}
      </dd>
    </div>
  )
}

function AuditRow({ entry }: { entry: AdminAuditEntry }) {
  const [open, setOpen] = useState(false)
  const narrative = describeAuditEntry(entry)

  // Identifier columns are dropped here too: the record's own id is already
  // printed once in the footer below, so repeating UUIDs as labelled rows adds
  // noise without adding information.
  const changedKeys = useMemo(() => {
    const keys = new Set<string>()
    Object.keys(entry.oldValues ?? {}).forEach((key) => keys.add(key))
    Object.keys(entry.newValues ?? {}).forEach((key) => keys.add(key))

    return [...keys].filter(
      (key) =>
        !isIdentifier(key, entry.newValues?.[key] ?? entry.oldValues?.[key]),
    )
  }, [entry.oldValues, entry.newValues])

  const hasDetail = changedKeys.length > 0

  return (
    <article className="border-b border-[#f2f5f8] last:border-b-0">
      {/* One event, one sentence. The dot in the margin carries the kind of
          change, so the eye can find every removal without reading a word. */}
      <button
        type="button"
        onClick={() => hasDetail && setOpen((value) => !value)}
        aria-expanded={hasDetail ? open : undefined}
        disabled={!hasDetail}
        className={cn(
          'flex w-full items-start gap-3 px-3 py-2.5 text-left transition-colors',
          hasDetail && 'hover:bg-[#f7f9fc]',
        )}
      >
        <time
          dateTime={entry.createdAt ?? undefined}
          title={formatTimestamp(entry.createdAt)}
          className="w-11 shrink-0 pt-0.5 text-xs tabular-nums text-[#6c7177]"
        >
          {entry.createdAt ? format(parseISO(entry.createdAt), 'HH:mm') : '--:--'}
        </time>
        <span
          aria-hidden
          className={cn('mt-[0.45rem] h-1.5 w-1.5 shrink-0 rounded-full', TONE_DOT[narrative.tone])}
        />
        {/* Sentence and chips share one flowing line, so a wide screen keeps
            an event to a single row and a narrow one wraps the chips under. */}
        <span className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className="text-[13.5px] leading-5 text-[#52606d]">
            <span className="font-semibold text-[#1d3047]">{narrative.actor}</span>{' '}
            {narrative.verb}
            {narrative.object ? ` ${narrative.object}` : ''}
            {narrative.name ? (
              <>
                {' '}
                <span className="font-semibold text-[#000a1e]">{narrative.name}</span>
              </>
            ) : null}
          </span>
          {narrative.facts.map((fact) => (
            <span
              key={`${fact.label ?? ''}-${fact.value}`}
              className="whitespace-nowrap rounded-full bg-[#f2f5f9] px-2 py-0.5 text-[11px] font-medium text-[#5f6670]"
            >
              {fact.label ? `${fact.label}: ` : ''}
              {fact.value}
            </span>
          ))}
        </span>
        {hasDetail ? (
          <ChevronDown
            aria-hidden
            className={cn(
              'mt-0.5 h-4 w-4 shrink-0 text-[#c0c8d2] transition-transform',
              open && 'rotate-180',
            )}
          />
        ) : null}
      </button>

      {open ? (
        <div className="ml-[4.5rem] mr-3 mb-2.5 rounded-[0.35rem] border border-[#e9eef4] bg-white px-4 py-2.5">
          <dl className="divide-y divide-[#f2f5f8]">
            {changedKeys.map((key) => {
              const before = entry.oldValues?.[key]
              const after = entry.newValues?.[key]
              const changed =
                entry.oldValues !== null &&
                formatAuditFieldValue(before) !== formatAuditFieldValue(after)

              return (
                <DetailRow
                  key={key}
                  label={auditFieldLabel(key)}
                  before={before}
                  after={after}
                  changed={changed}
                />
              )
            })}
          </dl>
          {/* Forensic detail: needed if a change is ever disputed, but nothing
              a reader scans for, so it sits quietly at the bottom. */}
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-0.5 border-t border-[#f2f5f8] pt-2 font-mono text-[11px] text-[#a9b2bd]">
            {entry.entityId ? <span>ref {entry.entityId}</span> : null}
            {entry.ipAddress ? <span>from {entry.ipAddress}</span> : null}
          </div>
        </div>
      ) : null}
    </article>
  )
}

/**
 * A workspace's activity trail, used by both Clinical and Academic.
 *
 * Reads the real audit log scoped to the workspace by the server's registry
 * (which also returns the system-wide rows, so account and access changes show
 * in both), rather than any one table. A newly audited surface therefore
 * appears here without a change in this file.
 */
export function WorkspaceAuditTrail({
  workspace,
  noun,
}: {
  workspace: 'clinical' | 'academic'
  /** Used in the search label, the empty state, and the footer count. */
  noun: string
}) {
  const client = getApiBrowserClient()
  const [entityType, setEntityType] = useState(ALL)
  const [userId, setUserId] = useState(ALL)
  const [search, setSearch] = useState('')

  const { data, isPending, isError, error } = useQuery({
    queryKey: ['workspace-audit', workspace, entityType, userId],
    queryFn: () =>
      fetchWorkspaceAuditTrail(client!, {
        workspace,
        entityType: entityType === ALL ? undefined : entityType,
        userId: userId === ALL ? undefined : userId,
        limit: 500,
      }),
    enabled: Boolean(client),
  })

  // Search stays client-side: the result set is already capped, and filtering
  // in the browser keeps typing responsive without a request per keystroke.
  const term = search.trim().toLowerCase()
  const entries = useMemo(() => {
    const rows = data?.data ?? []
    if (!term) return rows

    return rows.filter((entry) => searchableText(entry).toLowerCase().includes(term))
  }, [data?.data, term])

  // Grouping by day turns a wall of timestamps into "what happened on Tuesday".
  const days = useMemo(() => {
    const grouped: { heading: string; entries: AdminAuditEntry[] }[] = []

    for (const entry of entries) {
      const heading = dayHeading(entry.createdAt)
      const current = grouped.at(-1)

      if (current?.heading === heading) {
        current.entries.push(entry)
      } else {
        grouped.push({ heading, entries: [entry] })
      }
    }

    return grouped
  }, [entries])

  if (!client) {
    return (
      <p className="text-sm text-[#9d2a2a]">
        The Laravel API is not configured. {apiEnvSetupHint}
      </p>
    )
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <Select value={entityType} onValueChange={setEntityType}>
          <SelectTrigger className="h-9 w-[11.5rem] text-sm" aria-label="Filter by record type">
            <SelectValue placeholder="All record types" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All record types</SelectItem>
            {(data?.meta.entityTypes ?? []).map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={userId} onValueChange={setUserId}>
          <SelectTrigger className="h-9 w-[10.5rem] text-sm" aria-label="Filter by person">
            <SelectValue placeholder="Anyone" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Anyone</SelectItem>
            {(data?.meta.actors ?? []).map((actor) => (
              <SelectItem key={actor.id} value={actor.id}>
                {actor.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="relative min-w-[13rem] flex-1">
          <Search
            aria-hidden
            className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#69727d]"
          />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search this trail"
            aria-label={`Search the ${noun} audit trail`}
            className="h-9 pl-9 text-sm"
          />
        </div>
      </div>

      <div className="mt-4">
        {isPending ? (
          <ListSkeleton rows={6} />
        ) : isError ? (
          <p className="py-8 text-center text-sm text-[#9d2a2a]">
            {error instanceof Error
              ? error.message
              : `Failed to load the ${noun} audit trail.`}
          </p>
        ) : entries.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-10 text-center">
            <History aria-hidden className="h-6 w-6 text-[#9aa6b5]" />
            <p className="text-sm text-[#5f6670]">
              Nothing matches these filters.
            </p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-[0.35rem] border border-[#e6ecf3]">
            <div className="max-h-[62vh] overflow-y-auto overscroll-contain">
              {days.map((day) => (
                <section key={day.heading}>
                  <h3 className="sticky top-0 z-10 border-b border-[#eef2f6] bg-[#f8fafc]/95 px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.14em] text-[#6c7177] backdrop-blur">
                    {day.heading}
                    <span className="ml-2 font-medium normal-case tracking-normal text-[#a9b2bd]">
                      {day.entries.length}
                    </span>
                  </h3>
                  {day.entries.map((entry) => (
                    <AuditRow key={entry.id} entry={entry} />
                  ))}
                </section>
              ))}
            </div>
            <p className="border-t border-[#eef2f6] bg-[#f8fafc] px-3 py-2 text-xs text-[#6c7177]">
              {entries.length} of the last 500 actions
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
