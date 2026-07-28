import { useQuery } from '@tanstack/react-query'
import { ChevronDown, History, Search } from 'lucide-react'
import { useMemo, useState } from 'react'

import { ListSkeleton } from '@/components/layout/loading-skeletons'
import { Badge } from '@/components/ui/badge'
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
  formatAuditFieldValue,
  formatRelativeTimestamp,
  formatTimestamp,
  humanizeAuditKey,
} from '@/lib/dates'
import { cn } from '@/lib/utils'

const ALL = 'all'

/**
 * Keys that carry an identifier rather than a fact. Case-insensitive and
 * snake_case aware, so `id`, `userId` and `batch_id` are all caught; the older
 * pattern only matched camelCase and let a bare `id` through, which is how raw
 * UUIDs ended up on screen.
 */
const ID_KEY = /(^|[a-z0-9_])(id|uuid)$/i

/** A UUID is never meaningful to a reader, whatever key it arrives under. */
const UUID_VALUE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const isIdentifier = (key: string, value: unknown) =>
  ID_KEY.test(key) || (typeof value === 'string' && UUID_VALUE.test(value))

function summarize(entry: AdminAuditEntry): string | null {
  const values = entry.newValues ?? entry.oldValues
  if (!values) return null

  const parts = Object.entries(values)
    .filter(
      ([key, value]) =>
        !isIdentifier(key, value) && value !== null && value !== '',
    )
    .slice(0, 3)
    .map(([key, value]) => {
      const label = humanizeAuditKey(key)

      if (isPlainObject(value)) return label
      return `${label}: ${formatAuditFieldValue(value)}`
    })

  return parts.length > 0 ? parts.join(' · ') : null
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
      return <span className="text-[#74777f]">None</span>
    }

    return (
      <ul className="mt-1 space-y-1 border-l border-[#dbe3ec] pl-3">
        {entries.map(([key, nested]) => (
          <li key={key} className="text-[13px] leading-5 text-[#1d3047]">
            <span className="text-[#74777f]">{humanizeAuditKey(key)}: </span>
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

  return <>{formatAuditFieldValue(value)}</>
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
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-[11px] font-bold uppercase tracking-[0.1em] text-[#526171]">
        {label}
      </dt>
      <dd className="break-words text-[13px] leading-5 text-[#1d3047]">
        {changed ? (
          <span className="flex flex-wrap items-baseline gap-1.5">
            <span className="text-[#74777f] line-through decoration-[#c4c6cf]">
              {formatAuditFieldValue(before)}
            </span>
            <span aria-hidden className="text-[#9aa6b5]">
              →
            </span>
            <span className="font-medium">{formatAuditFieldValue(after)}</span>
          </span>
        ) : (
          <AuditValue value={after ?? before} />
        )}
      </dd>
    </div>
  )
}

function initialsOf(name: string) {
  return name
    .split(' ')
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()
}

/** Actor as a person - an initial chip plus the name, not another grey clause. */
function Actor({ name }: { name: string | null }) {
  const label = name ?? 'Unknown user'

  return (
    <span className="flex min-w-0 items-center gap-2">
      <span
        aria-hidden
        className="flex h-5 w-5 shrink-0 items-center justify-center rounded-[0.3rem] bg-[#edf1f5] text-[10px] font-bold text-[#00468c]"
      >
        {name ? initialsOf(name) : '?'}
      </span>
      <span className="truncate text-[13px] font-medium text-[#44474e]">
        {label}
      </span>
    </span>
  )
}

function AuditRow({ entry }: { entry: AdminAuditEntry }) {
  const [open, setOpen] = useState(false)
  const summary = summarize(entry)

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
    <article className="border-b border-[#eef2f6] last:border-b-0">
      <button
        type="button"
        onClick={() => hasDetail && setOpen((value) => !value)}
        aria-expanded={hasDetail ? open : undefined}
        disabled={!hasDetail}
        className={cn(
          'flex w-full items-start gap-3 px-1 py-3.5 text-left transition-colors',
          hasDetail && 'hover:bg-[#f7f9fc]',
        )}
      >
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-[#000a1e]">
              {entry.actionLabel}
            </span>
            <Badge variant={entry.workspace === 'system' ? 'neutral' : 'info'}>
              {entry.entityLabel}
            </Badge>
          </div>
          {summary ? (
            <p className="mt-1.5 truncate text-[13px] leading-5 text-[#52606d]">
              {summary}
            </p>
          ) : null}
          <div className="mt-2">
            <Actor name={entry.userName} />
          </div>
        </div>

        {/* "When" gets its own right-hand column so the eye can scan times
            without reading through each actor's name. Relative for recency;
            the exact stamp stays one hover away. */}
        <div className="flex shrink-0 items-center gap-2 pl-3">
          <time
            dateTime={entry.createdAt ?? undefined}
            title={formatTimestamp(entry.createdAt)}
            className="whitespace-nowrap text-xs font-medium tabular-nums text-[#74777f]"
          >
            {formatRelativeTimestamp(entry.createdAt)}
          </time>
          {hasDetail ? (
            <ChevronDown
              aria-hidden
              className={cn(
                'h-4 w-4 text-[#9aa6b5] transition-transform',
                open && 'rotate-180',
              )}
            />
          ) : (
            <span aria-hidden className="h-4 w-4" />
          )}
        </div>
      </button>

      {open ? (
        <div className="mb-3 rounded-[0.4rem] bg-[#f7f9fc] px-4 py-3">
          <dl className="grid gap-3 sm:grid-cols-2">
            {changedKeys.map((key) => {
              const before = entry.oldValues?.[key]
              const after = entry.newValues?.[key]
              const changed =
                entry.oldValues !== null &&
                formatAuditFieldValue(before) !== formatAuditFieldValue(after)

              return (
                <DetailRow
                  key={key}
                  label={humanizeAuditKey(key)}
                  before={before}
                  after={after}
                  changed={changed}
                />
              )
            })}
          </dl>
          <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 border-t border-[#e6ecf3] pt-3 text-xs text-[#74777f]">
            {entry.entityId ? <span>Record: {entry.entityId}</span> : null}
            {entry.ipAddress ? <span>IP: {entry.ipAddress}</span> : null}
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

    return rows.filter((entry) =>
      [entry.actionLabel, entry.entityLabel, entry.userName, summarize(entry)]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(term)),
    )
  }, [data?.data, term])

  if (!client) {
    return (
      <p className="text-sm text-[#9d2a2a]">
        The Laravel API is not configured. {apiEnvSetupHint}
      </p>
    )
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        <Select value={entityType} onValueChange={setEntityType}>
          <SelectTrigger className="w-[200px]" aria-label="Filter by record type">
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
          <SelectTrigger className="w-[190px]" aria-label="Filter by person">
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

        <div className="relative min-w-[220px] flex-1">
          <Search
            aria-hidden
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#74777f]"
          />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search this trail"
            aria-label={`Search the ${noun} audit trail`}
            className="pl-9"
          />
        </div>
      </div>

      <div className="mt-5">
        {isPending ? (
          <ListSkeleton rows={6} />
        ) : isError ? (
          <p className="py-8 text-center text-sm text-[#9d2a2a]">
            {error instanceof Error
              ? error.message
              : `Failed to load the ${noun} audit trail.`}
          </p>
        ) : entries.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-12 text-center">
            <History aria-hidden className="h-6 w-6 text-[#9aa6b5]" />
            <p className="text-sm font-medium text-[#44474e]">
              No {noun} activity matches these filters.
            </p>
          </div>
        ) : (
          <>
            <div className="max-h-[60vh] overflow-y-auto overscroll-contain">
              {entries.map((entry) => (
                <AuditRow key={entry.id} entry={entry} />
              ))}
            </div>
            <p className="mt-3 text-xs text-[#74777f]">
              Showing {entries.length} of the 500 most recent {noun} actions.
            </p>
          </>
        )}
      </div>
    </div>
  )
}
