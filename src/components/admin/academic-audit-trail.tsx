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
} from '@/lib/dates'
import { cn } from '@/lib/utils'

const ALL = 'all'

/**
 * Values that are ids rather than facts - shown in the detail drawer but never
 * in the one-line summary, where they would crowd out the readable parts.
 */
const ID_KEY = /(^|[a-z])Id$/

function summarize(entry: AdminAuditEntry): string | null {
  const values = entry.newValues ?? entry.oldValues
  if (!values) return null

  const parts = Object.entries(values)
    .filter(([key, value]) => !ID_KEY.test(key) && value !== null && value !== '')
    .slice(0, 3)
    .map(([key, value]) => {
      const label = key
        .replace(/([A-Z])/g, ' $1')
        .replace(/^./, (char) => char.toUpperCase())
        .trim()

      if (typeof value === 'object') return label
      return `${label}: ${formatAuditFieldValue(value)}`
    })

  return parts.length > 0 ? parts.join(' · ') : null
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-[11px] font-bold uppercase tracking-[0.1em] text-[#526171]">
        {label}
      </dt>
      <dd className="break-words text-[13px] text-[#1d3047]">{value}</dd>
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

  const changedKeys = useMemo(() => {
    const keys = new Set<string>()
    Object.keys(entry.oldValues ?? {}).forEach((key) => keys.add(key))
    Object.keys(entry.newValues ?? {}).forEach((key) => keys.add(key))
    return [...keys]
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
                  label={key.replace(/([A-Z])/g, ' $1').trim()}
                  value={
                    changed
                      ? `${formatAuditFieldValue(before)} → ${formatAuditFieldValue(after)}`
                      : formatAuditFieldValue(after ?? before)
                  }
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
 * The academic workspace's activity trail.
 *
 * Replaces a feed that read the `evaluations` table directly and therefore
 * only ever showed resident and consultant evaluations - every other academic
 * surface (morning sessions, teaching, roster, students, structure) was
 * invisible here even when it was being audited. This reads the real audit log
 * instead, scoped to the workspace by the server's registry, so a newly
 * audited surface appears without a change in this file.
 */
export function AcademicAuditTrail() {
  const client = getApiBrowserClient()
  const [entityType, setEntityType] = useState(ALL)
  const [userId, setUserId] = useState(ALL)
  const [search, setSearch] = useState('')

  const { data, isPending, isError, error } = useQuery({
    queryKey: ['academic-audit', entityType, userId],
    queryFn: () =>
      fetchWorkspaceAuditTrail(client!, {
        workspace: 'academic',
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
            aria-label="Search the academic audit trail"
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
              : 'Failed to load the academic audit trail.'}
          </p>
        ) : entries.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-12 text-center">
            <History aria-hidden className="h-6 w-6 text-[#9aa6b5]" />
            <p className="text-sm font-medium text-[#44474e]">
              No academic activity matches these filters.
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
              Showing {entries.length} of the 500 most recent academic actions.
            </p>
          </>
        )}
      </div>
    </div>
  )
}
