import { motion, useReducedMotion } from 'framer-motion'
import { ArrowUpRight, CalendarDays, History } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

import { EvaluationFormRenderer } from '@/components/academic/evaluation-form-renderer'
import { SectionHeader, panelClass } from '@/components/dashboard/section-panel'
import { FormContentSkeleton } from '@/components/layout/loading-skeletons'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useAppData } from '@/context/app-data-context'
import {
  fetchAcademicFormOptions,
  fetchEvaluationForm,
  fetchMySubmissions,
  type EvaluationFormDefinition,
} from '@/lib/api/academic'
import { getApiBrowserClient } from '@/lib/api/client'
import { apiEnvSetupHint } from '@/lib/api/env'
import type {
  AcademicEvaluationRecord,
  AcademicFormOptions,
  AcademicMySubmissions,
} from '@/lib/api/types'

const todayString = new Date().toISOString().slice(0, 10)

function getMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback
}

function toDateLabel(value: string | null) {
  if (!value) {
    return '-'
  }
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString()
}

function initialsFor(fullName: string | null): string {
  return (
    (fullName ?? '')
      .split(' ')
      .map((part) => part[0])
      .filter(Boolean)
      .join('')
      .slice(0, 2)
      .toUpperCase() || '-'
  )
}

function scoreTone(score: number): string {
  if (score >= 80) {
    return 'border-[#cfe7d9] bg-[#edf7f0] text-[#1f6b3b]'
  }
  if (score >= 50) {
    return 'border-[#f0d9aa] bg-[#fbf4e6] text-[#8a5a00]'
  }
  return 'border-[#f1d1d1] bg-[#fff1f1] text-[#9d2a2a]'
}

function RecentSubmissions({ submissions }: { submissions: AcademicMySubmissions | null }) {
  if (!submissions || submissions.direction === null || submissions.data.length === 0) {
    return (
      <div className="border-y border-dashed border-[#d4dde8] px-3 py-8 text-center text-sm leading-6 text-[#5b6169]">
        No submissions yet. Your filed evaluations will appear here.
      </div>
    )
  }

  const records: AcademicEvaluationRecord[] = submissions.data

  return (
    <div className="divide-y divide-[#eef2f6] border-y border-[#e6ecf3]">
      {records.slice(0, 6).map((record) => {
        const score = 'qualityScore' in record ? record.qualityScore : record.performanceScore
        const roundedScore = Math.round(score)
        return (
          <div
            key={record.id}
            className="group flex items-center justify-between gap-3 px-1 py-3.5 transition-colors duration-200 hover:bg-[#f7f9fc] motion-reduce:transition-none"
          >
            <div className="flex min-w-0 items-center gap-3">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#04162f] text-[10px] font-bold tracking-[0.04em] text-[#f0b429]">
                {initialsFor(record.subjectName)}
              </span>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-[#000a1e]">
                  {record.subjectName ?? 'Unknown'}
                </p>
                <p className="truncate text-xs leading-5 text-[#74777f]">
                  {toDateLabel(record.evaluationDate)} · {record.wardName ?? '-'}
                </p>
              </div>
            </div>
            <span
              className={`inline-flex min-w-[3.25rem] shrink-0 justify-center rounded-full border px-2 py-1 text-[11px] font-bold tabular-nums ${scoreTone(roundedScore)}`}
              aria-label={`Score ${roundedScore} percent`}
            >
              {roundedScore}%
            </span>
          </div>
        )
      })}
    </div>
  )
}

/**
 * Thin wrapper over the form engine (V2 Phase 4): fetches the published form
 * definition for the author's direction plus the per-date eligibility options,
 * and delegates rendering to EvaluationFormRenderer. No form content is
 * hardcoded here; admins edit forms without a developer.
 */
export function AcademicEvaluationFormPage() {
  const { currentUser } = useAppData()
  const client = getApiBrowserClient()
  const reduceMotion = useReducedMotion()
  const role = currentUser?.role
  const direction: 'consultant' | 'resident' = role === 'consultant' ? 'resident' : 'consultant'
  const formKey = direction === 'consultant' ? 'consultant_mdt' : 'resident_acgme'

  // The evaluation date drives eligibility: changing it re-resolves who the
  // author actually shared a ward or paired duty with on that date.
  const [date, setDate] = useState(todayString)
  const [form, setForm] = useState<EvaluationFormDefinition | null>(null)
  const [options, setOptions] = useState<AcademicFormOptions | null>(null)
  const [submissions, setSubmissions] = useState<AcademicMySubmissions | null>(null)
  const [loadError, setLoadError] = useState<string | null>(() =>
    client ? null : `The Laravel API is not configured. ${apiEnvSetupHint}`,
  )

  const canSubmit = role === 'resident' || role === 'consultant'

  const [isLoading, setIsLoading] = useState(() => Boolean(client) && canSubmit)

  useEffect(() => {
    if (!client || !canSubmit) {
      return
    }

    let active = true

    Promise.all([
      fetchAcademicFormOptions(client, date),
      fetchEvaluationForm(client, formKey),
      fetchMySubmissions(client),
    ])
      .then(([fetchedOptions, fetchedForm, fetchedSubmissions]) => {
        if (!active) {
          return
        }
        setOptions(fetchedOptions)
        setForm(fetchedForm)
        setSubmissions(fetchedSubmissions)
        setLoadError(null)
      })
      .catch((error) => {
        if (active) {
          setLoadError(getMessage(error, 'Unable to load the evaluation form.'))
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
  }, [client, canSubmit, date, formKey])

  const refreshSubmissions = () => {
    if (!client) {
      return
    }
    fetchMySubmissions(client)
      .then((fetched) => setSubmissions(fetched))
      .catch(() => {
        // A failed refresh of the side-list is non-blocking; the submit already succeeded.
      })
  }

  const heading = !canSubmit
    ? 'Academic evaluations'
    : direction === 'consultant'
      ? 'Evaluate a consultant'
      : 'Evaluate a resident'

  return (
    <div className="space-y-6 px-4 py-6 md:px-6 md:py-8">
      <motion.section
        initial={reduceMotion ? false : { opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: reduceMotion ? 0 : 0.3, ease: 'easeOut' }}
        className={panelClass}
      >
        <SectionHeader
          eyebrow="New evaluation"
          title={heading}
          description={
            form
              ? `${form.name}. Choose an eligible colleague and complete each section below.`
              : 'Choose an eligible colleague and complete each section below.'
          }
          actions={
            <Button asChild size="sm" variant="secondary">
              <Link to="/academic/history">
                Submission history
                <History className="h-4 w-4" />
              </Link>
            </Button>
          }
        />
      </motion.section>

      {isLoading ? (
        <FormContentSkeleton />
      ) : loadError ? (
        <div className="rounded-[0.35rem] border border-[#f1d1d1] bg-[#fff1f1] px-5 py-10 text-center text-sm font-medium text-[#b42318]">
          {loadError}
        </div>
      ) : !client || !options || !form ? null : !canSubmit ? (
        <div className={`${panelClass} text-center text-sm text-[#5b6169]`}>
          Only residents and consultants can submit academic evaluations.
        </div>
      ) : (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px] xl:items-start">
          <div className="min-w-0">
            {options.subjects.length === 0 ? (
              <motion.section
                initial={reduceMotion ? false : { opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: reduceMotion ? 0 : 0.28, ease: 'easeOut', delay: 0.04 }}
                className={panelClass}
              >
                <SectionHeader
                  eyebrow="Eligibility"
                  title="No eligible colleagues"
                  description={
                    options.currentPlacement
                      ? `No ${direction === 'consultant' ? 'consultants' : 'residents'} share your ward or duty on this date.`
                      : 'You have no ward or paired duty assignment covering this date. Contact your administrator.'
                  }
                />
              </motion.section>
            ) : (
              <EvaluationFormRenderer
                key={`${form.id}-${date}`}
                client={client}
                form={form}
                direction={direction}
                date={date}
                subjects={options.subjects}
                subjectLabel={direction === 'consultant' ? 'Consultant evaluated' : 'Resident evaluated'}
                onSubmitted={refreshSubmissions}
                presentation="continuous"
              />
            )}
          </div>

          <aside className="order-first space-y-6 xl:order-last xl:sticky xl:top-24">
            <motion.section
              initial={reduceMotion ? false : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: reduceMotion ? 0 : 0.28, ease: 'easeOut', delay: 0.04 }}
              className={panelClass}
            >
              <SectionHeader eyebrow="Evaluation context" title="Date and placement" />
              <div className="mt-5 space-y-2">
                <label
                  htmlFor="evaluationDate"
                  className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.14em] text-[#000a1e]"
                >
                  <CalendarDays className="h-3.5 w-3.5 text-[#005db6]" />
                  Evaluation date
                </label>
                <Input
                  id="evaluationDate"
                  type="date"
                  max={todayString}
                  value={date}
                  onChange={(event) => setDate(event.target.value || todayString)}
                />
              </div>
              <div className="mt-5 border-l-2 border-[#f0b429] pl-3.5">
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#74777f]">
                  Placement on this date
                </p>
                <p className="mt-1 text-sm font-medium leading-6 text-[#1d3047]">
                  {options.currentPlacement
                    ? `${options.currentPlacement.dutyTypeName}${
                        options.currentPlacement.wardName
                          ? ` · ${options.currentPlacement.wardName}`
                          : ''
                      }`
                    : 'No ward or paired duty assignment'}
                </p>
              </div>
            </motion.section>

            <motion.section
              initial={reduceMotion ? false : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: reduceMotion ? 0 : 0.28, ease: 'easeOut', delay: 0.08 }}
              className={panelClass}
            >
              <SectionHeader
                eyebrow="Your activity"
                title="Recent submissions"
                actions={
                  submissions?.data.length ? (
                    <Link
                      to="/academic/history"
                      className="group inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-[#005db6] transition-colors hover:text-[#00468c] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#005db6]/35"
                    >
                      View all
                      <ArrowUpRight className="h-3.5 w-3.5 motion-safe:transition-transform motion-safe:duration-200 motion-safe:group-hover:-translate-y-0.5 motion-safe:group-hover:translate-x-0.5" />
                    </Link>
                  ) : undefined
                }
              />
              <div className="mt-5">
                <RecentSubmissions submissions={submissions} />
              </div>
            </motion.section>
          </aside>
        </div>
      )}
    </div>
  )
}
