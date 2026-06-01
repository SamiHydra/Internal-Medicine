import { motion } from 'framer-motion'
import {
  CalendarClock,
  ClipboardCheck,
  GraduationCap,
  History,
  Send,
  Star,
} from 'lucide-react'
import { format, parseISO } from 'date-fns'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

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
    return '—'
  }
  try {
    return format(parseISO(value), 'MMM d, yyyy')
  } catch {
    return value
  }
}

export function AcademicHomePage() {
  const { currentUser } = useAppData()
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
  const isConsultant = currentUser.role === 'consultant'

  const ratingValue =
    summary?.avgOverallRating != null ? `${summary.avgOverallRating.toFixed(1)}` : '—'
  const thirdCard = isConsultant
    ? {
        label: 'Patients seen',
        value: summary?.avgPctSeen != null ? `${Math.round(summary.avgPctSeen)}%` : '—',
        note: 'Avg coverage on your rounds',
        icon: ClipboardCheck,
        tone: 'text-[#1d3047] bg-[#edf1f5] outline-[#d4dde8]/75',
      }
    : {
        label: 'Overall rating',
        value: receivedCount ? `${ratingValue}/5` : '—',
        note: 'Mean reviewer rating',
        icon: Star,
        tone: 'text-[#8a5a00] bg-[#fcf5e8] outline-[#edd9b0]/75',
      }

  const summaryItems = [
    {
      label: 'Evaluations received',
      value: `${receivedCount}`,
      note: 'How often you were reviewed',
      icon: GraduationCap,
      tone: 'text-[#005db6] bg-[#edf4fb] outline-[#cfe0f4]/75',
    },
    {
      label: 'Checklist score',
      value: receivedCount ? `${Math.round(summary?.averageScore ?? 0)}%` : '—',
      note: 'Mean of yes/no indicators',
      icon: ClipboardCheck,
      tone: 'text-[#00468c] bg-[#edf4fb] outline-[#cfe0f4]/75',
    },
    thirdCard,
    {
      label: 'You submitted',
      value: `${records.length}`,
      note: isConsultant ? 'Resident evaluations filed' : 'Consultant evaluations filed',
      icon: Send,
      tone: 'text-[#1f6b3b] bg-[#edf7f0] outline-[#cfe7d9]/75',
    },
  ] as const

  // Top indicators by compliance, descending — a quick "where you stand" read.
  const indicators = [...(summary?.indicatorCompliance ?? [])]
    .sort((left, right) => right.pct - left.pct)
    .slice(0, 6)

  return (
    <div className="space-y-8">
      <motion.section
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.26, ease: 'easeOut' }}
        className="rounded-[0.35rem] bg-[#eef2f6] px-5 py-5 md:px-6"
      >
        <div className="space-y-5">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
            <div className="space-y-2">
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#005db6]">
                Academic home
              </p>
              <h1 className="font-display text-[2rem] leading-[0.96] tracking-[-0.03em] text-[#000a1e] md:text-[2.35rem]">
                {greetingName ? `Welcome, ${greetingName}` : 'Academic home'}
              </h1>
              <p className="text-sm text-[#44474e]">
                {currentUser.title} · MDT round evaluations
              </p>
            </div>

            <div className="flex flex-wrap gap-3">
              <Button asChild>
                <Link to="/academic/submit">
                  Submit evaluation
                  <Send className="h-4 w-4" />
                </Link>
              </Button>
              <Button asChild variant="secondary" className="bg-[none] bg-[#ffffff] shadow-none">
                <Link to="/academic/history">
                  Submission history
                  <History className="h-4 w-4" />
                </Link>
              </Button>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {summaryItems.map((item) => {
              const Icon = item.icon

              return (
                <div
                  key={item.label}
                  className={`rounded-[0.35rem] px-3.5 py-3 outline outline-1 ${item.tone}`}
                >
                  <div className="flex items-center gap-2">
                    <Icon className="h-3.5 w-3.5" />
                    <p className="text-[11px] font-semibold uppercase tracking-[0.18em]">
                      {item.label}
                    </p>
                  </div>
                  <p className="mt-3 font-display text-[1.45rem] leading-none tracking-[-0.03em]">
                    {item.value}
                  </p>
                  <p className="mt-1 text-xs leading-5 text-current/75">{item.note}</p>
                </div>
              )
            })}
          </div>
        </div>
      </motion.section>

      {isLoading ? (
        <div className="rounded-[0.35rem] bg-[#eef2f6] px-5 py-12 text-center text-sm text-[#5b6169]">
          Loading your academic standing…
        </div>
      ) : error ? (
        <div className="rounded-[0.35rem] border border-[#f1d1d1] bg-[#fff1f1] px-5 py-10 text-center text-sm font-medium text-[#b42318]">
          {error}
        </div>
      ) : (
        <section className="grid gap-6 xl:grid-cols-[1.08fr_0.92fr]">
          <motion.section
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.28, ease: 'easeOut' }}
            className="rounded-[0.35rem] bg-[#eef2f6] px-5 py-6"
          >
            <div className="space-y-5">
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#005db6]">
                  How you've been rated
                </p>
                <h2 className="font-display text-[1.85rem] text-[#000a1e]">Indicator compliance</h2>
                <p className="text-sm text-[#5b6169]">
                  Aggregated across {receivedCount} review{receivedCount === 1 ? '' : 's'}. Individual
                  reviewers are kept anonymous.
                </p>
              </div>

              {receivedCount && indicators.length ? (
                <div className="space-y-3">
                  {indicators.map((indicator) => (
                    <div key={indicator.key} className="space-y-1.5">
                      <div className="flex items-center justify-between gap-3 text-sm">
                        <span className="text-[#000a1e]">{indicator.label}</span>
                        <span className="font-semibold text-[#005db6]">
                          {Math.round(indicator.pct)}%
                        </span>
                      </div>
                      <div className="h-2 w-full overflow-hidden rounded-[999px] bg-[#dbe6f2]">
                        <div
                          className="h-full rounded-[999px] bg-[#005db6]"
                          style={{ width: `${Math.max(0, Math.min(100, indicator.pct))}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-[0.25rem] border border-dashed border-[#cbd5e1] bg-white px-5 py-10 text-center text-sm text-[#5b6169]">
                  No evaluations of you yet. Once colleagues review your rounds, your standing shows
                  here.
                </div>
              )}
            </div>
          </motion.section>

          <motion.section
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, ease: 'easeOut' }}
            className="rounded-[0.35rem] bg-[#eef2f6] px-5 py-6"
          >
            <div className="space-y-5">
              <div className="flex items-center justify-between gap-3">
                <div className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#005db6]">
                    Recent activity
                  </p>
                  <h2 className="font-display text-[1.85rem] text-[#000a1e]">Your submissions</h2>
                </div>
                {records.length ? (
                  <Link
                    to="/academic/history"
                    className="text-xs font-semibold uppercase tracking-[0.14em] text-[#005db6] hover:underline"
                  >
                    View all
                  </Link>
                ) : null}
              </div>

              {records.length ? (
                <div className="space-y-2.5">
                  {records.slice(0, 5).map((record) => {
                    const score =
                      'qualityScore' in record ? record.qualityScore : record.performanceScore
                    return (
                      <div
                        key={record.id}
                        className="flex flex-wrap items-center justify-between gap-3 rounded-[0.25rem] border border-[#d4dde8] bg-white px-4 py-3"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-[#000a1e]">
                            {record.subjectName ?? 'Unknown'}
                          </p>
                          <p className="text-xs text-[#74777f]">
                            {toDateLabel(record.evaluationDate)} · {record.wardName ?? '—'}
                          </p>
                        </div>
                        <span className="rounded-[0.25rem] bg-[#edf4fb] px-3 py-1 text-[11px] font-bold uppercase tracking-[0.14em] text-[#005db6]">
                          {Math.round(score)}%
                        </span>
                      </div>
                    )
                  })}
                </div>
              ) : (
                <div className="flex flex-col items-center gap-4 rounded-[0.25rem] border border-dashed border-[#cbd5e1] bg-white px-5 py-10 text-center">
                  <ClipboardCheck className="h-5 w-5 text-[#005db6]" />
                  <p className="text-sm text-[#5b6169]">
                    You haven't filed any evaluations yet.
                  </p>
                  <Button asChild size="sm">
                    <Link to="/academic/submit">
                      Submit your first
                      <Send className="h-4 w-4" />
                    </Link>
                  </Button>
                </div>
              )}

              <div className="flex items-start gap-3 rounded-[0.35rem] bg-white px-4 py-3 outline outline-1 outline-[#d4dde8]/70">
                <CalendarClock className="mt-0.5 h-4 w-4 shrink-0 text-[#005db6]" />
                <p className="text-sm leading-6 text-[#5b6169]">
                  Evaluations are submit-and-done. Reach out to an administrator if a correction is
                  needed.
                </p>
              </div>
            </div>
          </motion.section>
        </section>
      )}
    </div>
  )
}
