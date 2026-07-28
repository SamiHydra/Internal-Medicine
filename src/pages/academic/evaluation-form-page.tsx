import { ClipboardCheck } from 'lucide-react'
import { useEffect, useState } from 'react'

import { EvaluationFormRenderer } from '@/components/academic/evaluation-form-renderer'
import { FormContentSkeleton } from '@/components/layout/loading-skeletons'
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
import type { AcademicEvaluationRecord, AcademicFormOptions, AcademicMySubmissions } from '@/lib/api/types'
import { panelClass } from '@/components/dashboard/section-panel'

const eyebrowClass = 'text-[11px] font-semibold uppercase tracking-[0.22em] text-[#005db6]'

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

function RecentSubmissions({ submissions }: { submissions: AcademicMySubmissions | null }) {
  if (!submissions || submissions.direction === null || submissions.data.length === 0) {
    return (
      <div className="rounded-[0.25rem] border border-dashed border-[#cbd5e1] bg-white px-5 py-8 text-center text-sm text-[#5b6169]">
        No submissions yet. Your filed evaluations will appear here.
      </div>
    )
  }

  const records: AcademicEvaluationRecord[] = submissions.data

  return (
    <div className="space-y-2.5">
      {records.slice(0, 6).map((record) => {
        const score = 'qualityScore' in record ? record.qualityScore : record.performanceScore
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
                {toDateLabel(record.evaluationDate)} · {record.wardName ?? '-'}
              </p>
            </div>
            <span className="rounded-[0.25rem] bg-[#edf4fb] px-3 py-1 text-[11px] font-bold uppercase tracking-[0.14em] text-[#005db6]">
              {Math.round(score)}%
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
      <section className={panelClass}>
        <p className={eyebrowClass}>New evaluation</p>
        <h1 className="mt-1.5 font-display text-[1.5rem] font-bold leading-tight tracking-[-0.02em] text-[#000a1e] md:text-[1.7rem]">
          {heading}
        </h1>
        {form ? <p className="mt-1.5 max-w-2xl text-sm text-[#74777f]">{form.name}</p> : null}
      </section>

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
        <div className="grid gap-8 2xl:grid-cols-[minmax(0,1fr)_320px] 2xl:items-start">
          <div className="space-y-8">
            {/* Date + placement context: eligibility is resolved per date, so
                this stays visible even when there is nobody to evaluate. */}
            <section className={panelClass}>
              <div className="grid gap-5 md:grid-cols-2 md:items-end">
                <div className="space-y-2">
                  <label
                    htmlFor="evaluationDate"
                    className="text-[11px] font-bold uppercase tracking-[0.14em] text-[#000a1e]"
                  >
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
                <p className="text-sm leading-6 text-[#74777f]">
                  {options.currentPlacement
                    ? `Your placement on this date: ${options.currentPlacement.dutyTypeName}${
                        options.currentPlacement.wardName
                          ? ` · ${options.currentPlacement.wardName}`
                          : ''
                      }`
                    : 'You have no ward or paired duty assignment covering this date.'}
                </p>
              </div>
            </section>

            {options.subjects.length === 0 ? (
              <div className={`${panelClass} text-center text-sm leading-6 text-[#5b6169]`}>
                {options.currentPlacement
                  ? `No ${direction === 'consultant' ? 'consultants' : 'residents'} share your ward or duty on this date.`
                  : 'You have no ward or paired duty assignment covering this date. Contact your administrator.'}
              </div>
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
              />
            )}
          </div>

          <aside className="2xl:sticky 2xl:top-6">
            <section className={panelClass}>
              <div className="flex items-center gap-2">
                <ClipboardCheck className="h-4 w-4 text-[#005db6]" />
                <p className={eyebrowClass}>Recent submissions</p>
              </div>
              <div className="mt-4">
                <RecentSubmissions submissions={submissions} />
              </div>
            </section>
          </aside>
        </div>
      )}
    </div>
  )
}
