import { format, parseISO } from 'date-fns'
import { ClipboardCheck, History, Send } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { useAppData } from '@/context/app-data-context'
import { fetchMySubmissions } from '@/lib/api/academic'
import { getApiBrowserClient } from '@/lib/api/client'
import { apiEnvSetupHint } from '@/lib/api/env'
import type { AcademicEvaluationRecord, AcademicMySubmissions } from '@/lib/api/types'

function getMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback
}

function toDateLabel(value: string | null | undefined) {
  if (!value) {
    return '—'
  }
  try {
    return format(parseISO(value), 'MMM d, yyyy')
  } catch {
    return value
  }
}

export function AcademicHistoryPage() {
  const { currentUser } = useAppData()
  const client = getApiBrowserClient()

  const [submissions, setSubmissions] = useState<AcademicMySubmissions | null>(null)
  const [isLoading, setIsLoading] = useState(() => Boolean(client))
  const [error, setError] = useState<string | null>(() =>
    client ? null : `The Laravel API is not configured. ${apiEnvSetupHint}`,
  )

  useEffect(() => {
    if (!client) {
      return
    }

    let active = true

    fetchMySubmissions(client)
      .then((fetched) => {
        if (active) {
          setSubmissions(fetched)
          setError(null)
        }
      })
      .catch((requestError) => {
        if (active) {
          setError(getMessage(requestError, 'Unable to load your submissions.'))
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

  if (!currentUser) {
    return null
  }

  const records: AcademicEvaluationRecord[] =
    submissions && submissions.direction !== null ? submissions.data : []
  const subjectLabel = currentUser.role === 'consultant' ? 'Resident' : 'Consultant'

  return (
    <div className="space-y-8">
      <section className="rounded-[0.35rem] bg-[#eef2f6] px-5 py-5 md:px-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="space-y-2">
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#005db6]">
              Academic
            </p>
            <h1 className="font-display text-[2rem] leading-[0.96] tracking-[-0.03em] text-[#000a1e] md:text-[2.35rem]">
              Submission history
            </h1>
            <p className="text-sm text-[#44474e]">
              Every evaluation you have filed{records.length ? ` · ${records.length} total` : ''}.
            </p>
          </div>
          <Button asChild>
            <Link to="/academic/submit">
              Submit evaluation
              <Send className="h-4 w-4" />
            </Link>
          </Button>
        </div>
      </section>

      {isLoading ? (
        <div className="rounded-[0.35rem] bg-[#eef2f6] px-5 py-12 text-center text-sm text-[#5b6169]">
          Loading your submissions…
        </div>
      ) : error ? (
        <div className="rounded-[0.35rem] border border-[#f1d1d1] bg-[#fff1f1] px-5 py-10 text-center text-sm font-medium text-[#b42318]">
          {error}
        </div>
      ) : records.length ? (
        <section className="overflow-hidden rounded-[0.35rem] outline outline-1 outline-[#d4dde8]/70">
          <div className="grid grid-cols-[1fr_auto] gap-3 bg-[#eef2f6] px-5 py-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#5b6169] sm:grid-cols-[1.4fr_1fr_auto]">
            <span>{subjectLabel} evaluated</span>
            <span className="hidden sm:block">Ward · date</span>
            <span className="text-right">Score</span>
          </div>
          <div className="divide-y divide-[#e3e9f0] bg-white">
            {records.map((record) => {
              const score =
                'qualityScore' in record ? record.qualityScore : record.performanceScore
              const rating = 'overallRating' in record ? record.overallRating : null
              return (
                <div
                  key={record.id}
                  className="grid grid-cols-[1fr_auto] items-center gap-3 px-5 py-3.5 sm:grid-cols-[1.4fr_1fr_auto]"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-[#000a1e]">
                      {record.subjectName ?? 'Unknown'}
                    </p>
                    <p className="text-xs text-[#74777f] sm:hidden">
                      {record.wardName ?? '—'} · {toDateLabel(record.evaluationDate)}
                    </p>
                  </div>
                  <p className="hidden text-sm text-[#44474e] sm:block">
                    {record.wardName ?? '—'} · {toDateLabel(record.evaluationDate)}
                  </p>
                  <div className="flex items-center justify-end gap-2">
                    {rating != null ? (
                      <span className="rounded-[0.25rem] bg-[#fcf5e8] px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.12em] text-[#8a5a00]">
                        {rating}/5
                      </span>
                    ) : null}
                    <span className="rounded-[0.25rem] bg-[#edf4fb] px-3 py-1 text-[11px] font-bold uppercase tracking-[0.14em] text-[#005db6]">
                      {Math.round(score)}%
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      ) : (
        <div className="flex flex-col items-center gap-4 rounded-[0.35rem] border border-dashed border-[#cbd5e1] bg-white px-6 py-14 text-center">
          <History className="h-6 w-6 text-[#005db6]" />
          <p className="text-sm text-[#5b6169]">You haven't filed any evaluations yet.</p>
          <Button asChild size="sm">
            <Link to="/academic/submit">
              Submit your first
              <ClipboardCheck className="h-4 w-4" />
            </Link>
          </Button>
        </div>
      )}
    </div>
  )
}
