import { motion } from 'framer-motion'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

import { AcademicEvaluationDetailSheet } from '@/components/admin/academic-evaluation-detail-sheet'
import { ExternalEvaluationPanel } from '@/components/admin/external-evaluation-panel'
import { ReportingScopePanel } from '@/components/admin/reporting-scope-panel'
import { TableSkeleton } from '@/components/layout/loading-skeletons'
import {
  fetchAcademicPeople,
  fetchAcademicSummary,
  fetchAcademicWardOptions,
  listAcademicEvaluations,
  type AcademicWardOption,
} from '@/lib/api/academic'
import { getApiBrowserClient } from '@/lib/api/client'
import { apiEnvSetupHint } from '@/lib/api/env'
import { cn } from '@/lib/utils'
import type {
  AcademicDirection,
  AcademicEvaluationRecord,
  AcademicPeople,
  AcademicSummary,
} from '@/lib/api/types'

const ALL = 'all'
const PER_PAGE = 25

const directionOptions = [
  { value: 'consultant', label: 'Consultant evaluations' },
  { value: 'resident', label: 'Resident evaluations' },
] as const

const rangeOptions = [
  { value: ALL, label: 'All time' },
  { value: '30', label: 'Last 30 days' },
  { value: '90', label: 'Last 90 days' },
  { value: '180', label: 'Last 180 days' },
] as const

function rangeToDates(range: string): { dateFrom?: string; dateTo?: string } {
  if (range === ALL) {
    return {}
  }
  const days = Number(range)
  const to = new Date()
  const from = new Date()
  from.setDate(from.getDate() - days)
  return { dateFrom: from.toISOString().slice(0, 10), dateTo: to.toISOString().slice(0, 10) }
}

function recordScore(record: AcademicEvaluationRecord): number {
  return 'qualityScore' in record ? record.qualityScore : record.performanceScore
}

function toDateLabel(value: string | null): string {
  if (!value) {
    return '—'
  }
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

function initialsFor(fullName: string | null): string {
  return (
    (fullName ?? '')
      .split(' ')
      .map((part) => part[0])
      .filter(Boolean)
      .join('')
      .slice(0, 2)
      .toUpperCase() || '—'
  )
}

/** Color the score pill by band so a low evaluation reads at a glance. */
function scoreTone(score: number): string {
  if (score >= 80) {
    return 'border-[#cfe7d9] bg-[#edf7f0] text-[#1f6b3b]'
  }
  if (score >= 50) {
    return 'border-[#f0d9aa] bg-[#fbf4e6] text-[#8a5a00]'
  }
  return 'border-[#f1d1d1] bg-[#fff1f1] text-[#9d2a2a]'
}

const sectionClass =
  'rounded-[0.35rem] bg-white px-5 py-6 outline outline-1 outline-[#d4dde8] shadow-[0_24px_60px_-42px_rgba(0,33,71,0.28)] md:px-6 md:py-7'

export function AcademicSubmissionsPage() {
  const client = getApiBrowserClient()

  const [direction, setDirection] = useState<AcademicDirection>('consultant')
  const [wardId, setWardId] = useState<string>(ALL)
  const [person, setPerson] = useState<string>(ALL)
  const [range, setRange] = useState<string>(ALL)
  const [page, setPage] = useState(1)

  const [wards, setWards] = useState<AcademicWardOption[]>([])
  const [people, setPeople] = useState<AcademicPeople | null>(null)
  const [, setSummary] = useState<AcademicSummary | null>(null)
  const [evaluations, setEvaluations] = useState<AcademicEvaluationRecord[]>([])
  const [lastPage, setLastPage] = useState(1)
  const [, setTotal] = useState(0)
  const [selectedRecord, setSelectedRecord] = useState<AcademicEvaluationRecord | null>(null)
  // Bumped after an external evaluation is recorded so the list reloads.
  const [refreshKey, setRefreshKey] = useState(0)

  const [error, setError] = useState<string | null>(() =>
    client ? null : `The Laravel API is not configured. ${apiEnvSetupHint}`,
  )
  const [isLoading, setIsLoading] = useState(() => Boolean(client))

  const dateRange = useMemo(() => rangeToDates(range), [range])

  // Ward options load once.
  useEffect(() => {
    if (!client) {
      return
    }
    let active = true
    fetchAcademicWardOptions(client)
      .then((fetched) => {
        if (active) {
          setWards(fetched)
        }
      })
      .catch(() => {
        // The ward filter is a convenience; failing to load it should not break the page.
      })
    return () => {
      active = false
    }
  }, [client])

  // People (for the person filter) is independent of the selected person.
  useEffect(() => {
    if (!client) {
      return
    }
    let active = true
    fetchAcademicPeople(client, {
      direction,
      wardId: wardId === ALL ? undefined : wardId,
      dateFrom: dateRange.dateFrom,
      dateTo: dateRange.dateTo,
    })
      .then((fetched) => {
        if (active) {
          setPeople(fetched)
        }
      })
      .catch(() => {
        if (active) {
          setPeople({ direction, people: [] })
        }
      })
    return () => {
      active = false
    }
  }, [client, direction, wardId, dateRange])

  // Summary (KPIs) + the paginated list react to the full filter set.
  useEffect(() => {
    if (!client) {
      return
    }
    let active = true
    queueMicrotask(() => {
      if (active) {
        setIsLoading(true)
      }
    })
    const query = {
      direction,
      wardId: wardId === ALL ? undefined : wardId,
      subjectId: person === ALL ? undefined : person,
      dateFrom: dateRange.dateFrom,
      dateTo: dateRange.dateTo,
    }
    Promise.all([
      fetchAcademicSummary(client, query),
      listAcademicEvaluations(client, { ...query, page, perPage: PER_PAGE }),
    ])
      .then(([fetchedSummary, fetchedList]) => {
        if (!active) {
          return
        }
        setSummary(fetchedSummary)
        setEvaluations(fetchedList.data)
        setLastPage(fetchedList.meta.lastPage)
        setTotal(fetchedList.meta.total)
        setError(null)
      })
      .catch((fetchError) => {
        if (active) {
          setError(
            fetchError instanceof Error ? fetchError.message : 'Unable to load academic submissions.',
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
  }, [client, direction, wardId, person, dateRange, page, refreshKey])

  const wardOptions = useMemo(
    () => [{ value: ALL, label: 'All wards' }, ...wards.map((ward) => ({ value: ward.id, label: ward.name }))],
    [wards],
  )

  const personOptions = useMemo(
    () => [
      { value: ALL, label: 'All people' },
      ...(people?.people ?? []).map((entry) => ({
        value: entry.subjectId,
        label: entry.subjectName ?? 'Unknown',
      })),
    ],
    [people],
  )

  const isResident = direction === 'resident'

  const scopeFields = [
    {
      label: 'Direction',
      placeholder: 'Direction',
      value: direction,
      options: directionOptions,
      onValueChange: (value: string) => {
        setDirection(value as AcademicDirection)
        setPerson(ALL)
        setPage(1)
      },
    },
    {
      label: 'Ward',
      placeholder: 'All wards',
      value: wardId,
      options: wardOptions,
      onValueChange: (value: string) => {
        setWardId(value)
        setPage(1)
      },
    },
    {
      label: 'Person',
      placeholder: 'All people',
      value: person,
      options: personOptions,
      onValueChange: (value: string) => {
        setPerson(value)
        setPage(1)
      },
    },
    {
      label: 'Time range',
      placeholder: 'All time',
      value: range,
      options: rangeOptions,
      onValueChange: (value: string) => {
        setRange(value)
        setPage(1)
      },
    },
  ]

  return (
    <div className="space-y-6 px-4 py-5 md:px-6 md:py-8">
      <motion.section
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: 'easeOut' }}
        className={sectionClass}
      >
        <div className="border-b border-[#eef2f6] pb-5">
          <div className="flex items-center gap-2">
            <span aria-hidden="true" className="h-3 w-[3px] rounded-full bg-[#f0b429]" />
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#005db6]">
              Submissions
            </p>
          </div>
          <h1 className="mt-1 font-display text-[1.5rem] font-bold tracking-[-0.02em] text-[#000a1e] md:text-[1.7rem]">
            Academic evaluations
          </h1>
          <p className="mt-1.5 max-w-2xl text-sm text-[#74777f]">
            Every filed peer evaluation.
          </p>
        </div>

        <div className="mt-6">
          <ReportingScopePanel
            fields={scopeFields}
            fieldsClassName="grid-cols-1 sm:grid-cols-2 lg:grid-cols-4"
            collapsibleLabel="Filters"
            summary={`${isResident ? 'Resident' : 'Consultant'} · ${
              rangeOptions.find((option) => option.value === range)?.label ?? 'All time'
            }`}
          />
        </div>
      </motion.section>

      <ExternalEvaluationPanel
        onRecorded={() => {
          setDirection('resident')
          setPage(1)
          setRefreshKey((key) => key + 1)
        }}
      />

      {error ? (
        <div className="rounded-[0.35rem] border border-[#f3cccc] bg-[#fceeee] px-5 py-10 text-center text-sm font-medium text-[#ba1a1a]">
          {error}
        </div>
      ) : (
        <motion.section
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, ease: 'easeOut', delay: 0.04 }}
          className={sectionClass}
        >
          {isLoading && evaluations.length === 0 ? (
            <TableSkeleton rows={8} columns={5} />
          ) : evaluations.length === 0 ? (
            <div className="rounded-[0.4rem] border border-dashed border-[#d4dde8] bg-[#f7f9fc] px-5 py-12 text-center text-sm text-[#74777f]">
              No evaluations match the current filters.
            </div>
          ) : (
            <>
              <div className="overflow-hidden rounded-[0.4rem] border border-[#e6ecf3]">
                <div className="hidden grid-cols-[124px_minmax(0,2fr)_minmax(0,1.1fr)_minmax(0,1.4fr)_104px] items-center gap-4 border-b border-[#eef2f6] bg-[#f7f9fc] px-4 py-2.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-[#74777f] sm:grid">
                  <span>Date</span>
                  <span>{isResident ? 'Resident' : 'Consultant'}</span>
                  <span>Ward</span>
                  <span>Evaluator</span>
                  <span className="text-right">Score</span>
                </div>
                {evaluations.map((record) => {
                  const score = Math.round(recordScore(record))
                  return (
                    <button
                      key={record.id}
                      type="button"
                      onClick={() => setSelectedRecord(record)}
                      className="group grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-[#eef2f6] px-4 py-2.5 text-left text-sm transition-colors last:border-b-0 hover:bg-[#f7f9fc] focus:outline-none focus-visible:bg-[#eef4fb] sm:grid-cols-[124px_minmax(0,2fr)_minmax(0,1.1fr)_minmax(0,1.4fr)_104px] sm:gap-4"
                    >
                      <span className="hidden text-[13px] tabular-nums text-[#5b6169] sm:block">
                        {toDateLabel(record.evaluationDate)}
                      </span>
                      <span className="flex min-w-0 items-center gap-3">
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#04162f] text-[11px] font-bold text-[#f0b429]">
                          {initialsFor(record.subjectName)}
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate font-semibold text-[#000a1e]">
                            {record.subjectName ?? 'Unknown'}
                          </span>
                          <span className="block truncate text-xs text-[#74777f] sm:hidden">
                            {toDateLabel(record.evaluationDate)} · {record.wardName ?? '—'}
                          </span>
                        </span>
                      </span>
                      <span className="hidden min-w-0 sm:block">
                        <span className="inline-flex max-w-full items-center gap-1.5 truncate rounded-full border border-[#e3e9f1] bg-[#f4f7fb] px-2.5 py-1 text-xs font-medium text-[#44474e]">
                          <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#005db6]" />
                          <span className="truncate">{record.wardName ?? '—'}</span>
                        </span>
                      </span>
                      <span className="hidden min-w-0 truncate text-[13px] text-[#5b6169] sm:block">
                        {record.authorName ?? '—'}
                      </span>
                      <span className="flex items-center justify-end gap-2">
                        <span
                          className={cn(
                            'inline-flex min-w-[3.25rem] justify-center rounded-full border px-2.5 py-1 text-xs font-bold tabular-nums',
                            scoreTone(score),
                          )}
                        >
                          {score}%
                        </span>
                        <ChevronRight className="hidden h-4 w-4 shrink-0 text-[#c4c6cf] transition-colors group-hover:text-[#005db6] sm:block" />
                      </span>
                    </button>
                  )
                })}
              </div>

              {lastPage > 1 ? (
                <div className="mt-4 flex items-center justify-between gap-3">
                  <p className="text-xs text-[#74777f]">
                    Page {page} of {lastPage}
                  </p>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setPage((current) => Math.max(1, current - 1))}
                      disabled={page <= 1 || isLoading}
                      className="inline-flex items-center gap-1 rounded-[0.25rem] border border-[#c8d5e6] bg-white px-3 py-1.5 text-xs font-semibold text-[#1d3047] transition hover:bg-[#eef4fb] disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <ChevronLeft className="h-3.5 w-3.5" />
                      Prev
                    </button>
                    <button
                      type="button"
                      onClick={() => setPage((current) => Math.min(lastPage, current + 1))}
                      disabled={page >= lastPage || isLoading}
                      className="inline-flex items-center gap-1 rounded-[0.25rem] border border-[#c8d5e6] bg-white px-3 py-1.5 text-xs font-semibold text-[#1d3047] transition hover:bg-[#eef4fb] disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      Next
                      <ChevronRight className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              ) : null}
            </>
          )}
        </motion.section>
      )}

      <AcademicEvaluationDetailSheet
        record={selectedRecord}
        open={selectedRecord !== null}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedRecord(null)
          }
        }}
      />
    </div>
  )
}
