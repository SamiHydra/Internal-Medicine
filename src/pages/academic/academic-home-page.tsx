import { motion } from 'framer-motion'
import { ClipboardCheck, History, Send } from 'lucide-react'
import { format, parseISO } from 'date-fns'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

import {
  SectionEmptyState,
  SectionHeader,
  panelClass,
} from '@/components/dashboard/section-panel'
import { DashboardContentSkeleton } from '@/components/layout/loading-skeletons'
import { TransferRequestCard } from '@/components/academic/transfer-request-card'
import { TransferReviewPanel } from '@/components/academic/transfer-review-panel'
import { Button } from '@/components/ui/button'
import { useAppData } from '@/context/app-data-context'
import { fetchMyAcademicPerformance, fetchMySubmissions } from '@/lib/api/academic'
import { getApiBrowserClient } from '@/lib/api/client'
import { apiEnvSetupHint } from '@/lib/api/env'
import type {
  AcademicEvaluationRecord,
  AcademicMySubmissions,
  AcademicPerformance,
} from '@/lib/api/types'

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

export function AcademicHomePage() {
  const { currentUser, academic } = useAppData()
  const client = getApiBrowserClient()

  const [performance, setPerformance] = useState<AcademicPerformance | null>(null)
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

    Promise.all([fetchMyAcademicPerformance(client), fetchMySubmissions(client)])
      .then(([perf, subs]) => {
        if (!active) {
          return
        }
        setPerformance(perf)
        setSubmissions(subs)
        setError(null)
      })
      .catch((requestError) => {
        if (active) {
          setError(getMessage(requestError, 'Unable to load your academic home.'))
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

  // Friendly first name: skip a leading honorific (Dr./Prof./etc.).
  const nameParts = currentUser.fullName.trim().split(/\s+/)
  const honorifics = new Set(['dr', 'dr.', 'prof', 'prof.', 'mr', 'mr.', 'mrs', 'mrs.', 'ms', 'ms.'])
  const greetingName =
    nameParts.length > 1 && honorifics.has(nameParts[0].toLowerCase())
      ? nameParts[1]
      : nameParts[0]

  const summary = performance && performance.direction !== null ? performance.summary : null
  const records: AcademicEvaluationRecord[] =
    submissions && submissions.direction !== null ? submissions.data : []
  const receivedCount = summary?.evaluationCount ?? 0

  // Top indicators by compliance, descending - a quick "where you stand" read.
  const indicators = [...(summary?.indicatorCompliance ?? [])]
    .sort((left, right) => right.pct - left.pct)
    .slice(0, 6)

  return (
    <div className="space-y-6 px-4 py-6 md:px-6 md:py-8">
      <motion.section
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: 'easeOut' }}
        className={panelClass}
      >
        <SectionHeader
          eyebrow="Overview"
          title={greetingName ? `Welcome back, ${greetingName}` : 'Your academic overview'}
          description={
            academic?.currentPlacement
              ? `Current placement: ${academic.currentPlacement.dutyTypeName}${
                  academic.currentPlacement.wardName ? ` · ${academic.currentPlacement.wardName}` : ''
                }${academic.currentPlacement.endsOn ? ` · until ${toDateLabel(academic.currentPlacement.endsOn)}` : ''}`
              : undefined
          }
          actions={
            <>
              <Button asChild size="sm">
                <Link to="/academic/submit">
                  Submit evaluation
                  <Send className="h-4 w-4" />
                </Link>
              </Button>
              <Button asChild size="sm" variant="secondary">
                <Link to="/academic/history">
                  History
                  <History className="h-4 w-4" />
                </Link>
              </Button>
            </>
          }
        />
      </motion.section>

      {isLoading ? (
        <DashboardContentSkeleton />
      ) : error ? (
        <div className="rounded-[0.35rem] border border-[#f1d1d1] bg-[#fff1f1] px-5 py-10 text-center text-sm font-medium text-[#b42318]">
          {error}
        </div>
      ) : (
        <section className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
          <motion.section
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, ease: 'easeOut', delay: 0.04 }}
            className={panelClass}
          >
            <SectionHeader
              eyebrow="How you've been rated"
              title="Indicator compliance"
              description={
                receivedCount
                  ? `Across ${receivedCount} review${receivedCount === 1 ? '' : 's'} · reviewers stay anonymous`
                  : undefined
              }
            />
            {receivedCount && indicators.length ? (
              <div className="mt-5 space-y-4">
                {indicators.map((indicator) => (
                  <div key={indicator.key} className="space-y-1.5">
                    <div className="flex items-center justify-between gap-3 text-sm">
                      <span className="text-[#000a1e]">{indicator.label}</span>
                      <span className="font-semibold tabular-nums text-[#005db6]">
                        {Math.round(indicator.pct)}%
                      </span>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-[#e7eef6]">
                      <div
                        className="h-full rounded-full bg-[#005db6]"
                        style={{ width: `${Math.max(0, Math.min(100, indicator.pct))}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="mt-5">
                <SectionEmptyState
                  icon={<ClipboardCheck className="h-5 w-5" />}
                  title="No reviews yet"
                  description="Your standing appears here once colleagues review your rounds."
                />
              </div>
            )}
          </motion.section>

          <motion.section
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, ease: 'easeOut', delay: 0.08 }}
            className={panelClass}
          >
            <SectionHeader
              eyebrow="Recent activity"
              title="Your submissions"
              actions={
                records.length ? (
                  <Link
                    to="/academic/history"
                    className="text-xs font-semibold uppercase tracking-[0.14em] text-[#005db6] hover:underline"
                  >
                    View all
                  </Link>
                ) : undefined
              }
            />
            {records.length ? (
              <div className="mt-5 space-y-2.5">
                {records.slice(0, 5).map((record) => {
                  const score =
                    'qualityScore' in record ? record.qualityScore : record.performanceScore
                  return (
                    <div
                      key={record.id}
                      className="flex items-center justify-between gap-3 rounded-[0.35rem] border border-[#e6ecf3] bg-[#f8fafc] px-4 py-3"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-[#000a1e]">
                          {record.subjectName ?? 'Unknown'}
                        </p>
                        <p className="text-[13px] leading-5 text-[#5f6670]">
                          {toDateLabel(record.evaluationDate)} · {record.wardName ?? '-'}
                        </p>
                      </div>
                      <span className="shrink-0 rounded-[0.25rem] bg-[#edf4fb] px-2.5 py-1 text-xs font-bold tabular-nums text-[#005db6]">
                        {Math.round(score)}%
                      </span>
                    </div>
                  )
                })}
              </div>
            ) : (
              <div className="mt-5">
                <SectionEmptyState
                  icon={<Send className="h-5 w-5" />}
                  title="No evaluations filed"
                  description="Submit your first MDT round evaluation to get started."
                />
              </div>
            )}
          </motion.section>
        </section>
      )}

      {(academic?.headsSections.length ?? 0) > 0 ? <TransferReviewPanel /> : null}
      {currentUser.role === 'consultant' ? <TransferRequestCard /> : null}
    </div>
  )
}
