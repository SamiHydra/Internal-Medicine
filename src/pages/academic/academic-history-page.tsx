import { format, parseISO } from 'date-fns'
import { motion } from 'framer-motion'
import { Send } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

import {
  SectionEmptyState,
  SectionHeader,
  panelClass,
} from '@/components/dashboard/section-panel'
import { TableSkeleton } from '@/components/layout/loading-skeletons'
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
    return '-'
  }
  try {
    return format(parseISO(value), 'MMM d, yyyy')
  } catch {
    return value
  }
}

function recordScore(record: AcademicEvaluationRecord): number {
  return 'qualityScore' in record ? record.qualityScore : record.performanceScore
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
    <div className="space-y-6 px-4 py-6 md:px-6 md:py-8">
      <motion.section
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: 'easeOut' }}
        className={panelClass}
      >
        <SectionHeader
          eyebrow="Submissions"
          title="Submission history"
          description="Every evaluation you've filed."
          actions={
            <Button asChild size="sm">
              <Link to="/academic/submit">
                Submit evaluation
                <Send className="h-4 w-4" />
              </Link>
            </Button>
          }
        />
      </motion.section>

      {isLoading ? (
        <div className={panelClass}>
          <TableSkeleton rows={6} columns={3} />
        </div>
      ) : error ? (
        <div className="rounded-[0.35rem] border border-[#f1d1d1] bg-[#fff1f1] px-5 py-10 text-center text-sm font-medium text-[#b42318]">
          {error}
        </div>
      ) : records.length ? (
        <motion.section
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, ease: 'easeOut', delay: 0.04 }}
          className={panelClass}
        >
          <div className="overflow-hidden rounded-[0.4rem] border border-[#e6ecf3]">
            <div className="grid grid-cols-[1fr_auto] gap-3 border-b border-[#eef2f6] bg-[#f7f9fc] px-4 py-2.5 text-[11px] font-bold uppercase tracking-[0.12em] text-[#526171] sm:grid-cols-[1.4fr_1fr_auto]">
              <span>{subjectLabel} evaluated</span>
              <span className="hidden sm:block">Ward · date</span>
              <span className="text-right">Score</span>
            </div>
            {records.map((record) => {
              const score = recordScore(record)
              const rating = 'overallRating' in record ? record.overallRating : null
              return (
                <div
                  key={record.id}
                  className="grid grid-cols-[1fr_auto] items-center gap-3 border-b border-[#eef2f6] px-4 py-3 last:border-b-0 sm:grid-cols-[1.4fr_1fr_auto]"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-[#000a1e]">
                      {record.subjectName ?? 'Unknown'}
                    </p>
                    <p className="text-[13px] leading-5 text-[#5f6670] sm:hidden">
                      {record.wardName ?? '-'} · {toDateLabel(record.evaluationDate)}
                    </p>
                  </div>
                  <p className="hidden text-sm text-[#5b6169] sm:block">
                    {record.wardName ?? '-'} · {toDateLabel(record.evaluationDate)}
                  </p>
                  <div className="flex items-center justify-end gap-2">
                    {rating != null ? (
                      <span className="rounded-[0.25rem] bg-[#fcf5e8] px-2.5 py-1 text-[11px] font-bold tabular-nums text-[#8a5a00]">
                        {rating}/5
                      </span>
                    ) : null}
                    <span className="rounded-[0.25rem] bg-[#edf4fb] px-2.5 py-1 text-[11px] font-bold tabular-nums text-[#005db6]">
                      {Math.round(score)}%
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
        </motion.section>
      ) : (
        <div className={panelClass}>
          <SectionEmptyState
            icon={<Send className="h-5 w-5" />}
            title="No evaluations filed"
            description="Submit your first MDT round evaluation to get started."
          />
        </div>
      )}
    </div>
  )
}
