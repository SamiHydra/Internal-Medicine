import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { Send } from 'lucide-react'
import { toast } from 'sonner'
import { z } from 'zod'

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import {
  submitEvaluationAnswers,
  type EvaluationFormDefinition,
  type EvaluationFormField,
} from '@/lib/api/academic'
import type { LaravelApiClient } from '@/lib/api/client'
import { cn } from '@/lib/utils'
import { panelClass } from '@/components/dashboard/section-panel'

type AnswerValue = boolean | string | string[] | null

type AnswerState = Record<string, AnswerValue>

function getMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback
}

function defaultValueFor(field: EvaluationFormField): AnswerValue {
  switch (field.type) {
    case 'boolean':
      return false
    case 'multi_select':
      return []
    default:
      return ''
  }
}

/**
 * The runtime Zod schema for one field (V2 guide 7.4): the renderer never
 * hardcodes a form, so validation is derived from the published definition
 * exactly like the backend derives its Laravel rules.
 */
function schemaFor(field: EvaluationFormField): z.ZodTypeAny {
  const requireIf = <T extends z.ZodTypeAny>(schema: T) =>
    field.required ? schema : schema.or(z.literal('')).or(z.null())

  switch (field.type) {
    case 'boolean':
      return z.boolean()
    case 'rating': {
      const min = field.options?.min ?? 1
      const max = field.options?.max ?? 5
      return requireIf(
        z
          .string()
          .min(1, `Select ${field.label.toLowerCase()}.`)
          .refine((value) => {
            const rating = Number(value)
            return Number.isInteger(rating) && rating >= min && rating <= max
          }, `Pick a value between ${min} and ${max}.`),
      )
    }
    case 'percent':
    case 'integer': {
      const min = field.options?.min ?? (field.type === 'percent' ? 0 : 0)
      const max = field.options?.max ?? (field.type === 'percent' ? 100 : 1000000)
      const numeric = z.string().refine((value) => {
        if (value === '') {
          return !field.required
        }
        const parsed = Number(value)
        return Number.isInteger(parsed) && parsed >= min && parsed <= max
      }, `Enter a whole number between ${min} and ${max}.`)
      return field.required ? z.string().min(1, `${field.label} is required.`).pipe(numeric) : numeric
    }
    case 'time':
      return requireIf(z.string().regex(/^\d{2}:\d{2}$/, 'Use HH:MM.'))
    case 'text':
      return requireIf(z.string().max(2000, 'Keep it under 2000 characters.'))
    case 'single_select':
      return field.required ? z.string().min(1, `Select ${field.label.toLowerCase()}.`) : z.string()
    case 'multi_select':
      return z.array(z.string())
  }
}

function toPayloadValue(field: EvaluationFormField, value: AnswerValue): unknown {
  if (value === '' || value === null) {
    return null
  }

  switch (field.type) {
    case 'rating':
    case 'percent':
    case 'integer':
      return Number(value)
    default:
      return value
  }
}

function FieldShell({
  field,
  error,
  children,
}: {
  field: EvaluationFormField
  error?: string
  children: ReactNode
}) {
  return (
    <div className="space-y-2">
      <label htmlFor={`field-${field.key}`} className="text-[11px] font-bold uppercase tracking-[0.14em] text-[#000a1e]">
        {field.label}
      </label>
      {children}
      {field.helpText && !error ? <p className="text-xs text-[#74777f]">{field.helpText}</p> : null}
      {error ? <p className="text-sm text-[#ba1a1a]">{error}</p> : null}
    </div>
  )
}

/**
 * Renders a published evaluation form definition (V2 Phase 4): sections in
 * definition order, one control per field type, submit as field-key answers.
 * One component serves the MDT, ACGME, and student forms alike, so an admin
 * edit to a form is live here without a developer.
 */
export function EvaluationFormRenderer({
  client,
  form,
  direction,
  date,
  subjects,
  subjectLabel,
  onSubmitted,
  submit: submitOverride,
}: {
  client: LaravelApiClient
  form: EvaluationFormDefinition
  direction: 'consultant' | 'resident'
  date: string
  subjects: Array<{ id: string; fullName: string }>
  subjectLabel: string
  onSubmitted: () => void
  /** Replace the default peer-evaluation endpoints (e.g. student evaluations). */
  submit?: (payload: Record<string, unknown>) => Promise<unknown>
}) {
  const activeFields = useMemo(
    () =>
      form.fields
        .filter((field) => field.active)
        .sort((a, b) => a.sortOrder - b.sortOrder),
    [form.fields],
  )

  const sections = useMemo(() => {
    const grouped: Array<{ section: string; fields: EvaluationFormField[] }> = []
    for (const field of activeFields) {
      const bucket = grouped.find((entry) => entry.section === field.section)
      if (bucket) {
        bucket.fields.push(field)
      } else {
        grouped.push({ section: field.section, fields: [field] })
      }
    }
    return grouped
  }, [activeFields])

  const [subjectId, setSubjectId] = useState('')
  const [answers, setAnswers] = useState<AnswerState>(() =>
    Object.fromEntries(activeFields.map((field) => [field.key, defaultValueFor(field)])),
  )
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [isSubmitting, setIsSubmitting] = useState(false)

  const setAnswer = (key: string, value: AnswerValue) => {
    setAnswers((prev) => ({ ...prev, [key]: value }))
    setErrors((prev) => {
      if (!(key in prev)) {
        return prev
      }
      const next = { ...prev }
      delete next[key]
      return next
    })
  }

  const submit = async () => {
    const fieldErrors: Record<string, string> = {}

    if (!subjectId) {
      fieldErrors.subjectId = `Select the ${subjectLabel.toLowerCase()}.`
    }

    for (const field of activeFields) {
      const result = schemaFor(field).safeParse(answers[field.key])
      if (!result.success) {
        fieldErrors[field.key] = result.error.issues[0]?.message ?? 'Invalid value.'
      }
    }

    setErrors(fieldErrors)

    if (Object.keys(fieldErrors).length > 0) {
      return
    }

    setIsSubmitting(true)
    try {
      const payload: Record<string, unknown> = {
        evaluationDate: date,
        subjectId,
      }

      for (const field of activeFields) {
        payload[field.key] = toPayloadValue(field, answers[field.key])
      }

      if (submitOverride) {
        await submitOverride(payload)
      } else {
        await submitEvaluationAnswers(client, direction, payload)
      }
      toast.success('Evaluation submitted.')
      setSubjectId('')
      setAnswers(Object.fromEntries(activeFields.map((field) => [field.key, defaultValueFor(field)])))
      onSubmitted()
    } catch (error) {
      toast.error(getMessage(error, 'Unable to submit the evaluation.'))
    } finally {
      setIsSubmitting(false)
    }
  }

  const renderField = (field: EvaluationFormField) => {
    const value = answers[field.key]
    const error = errors[field.key]

    switch (field.type) {
      case 'boolean':
        return (
          <label
            key={field.key}
            className={cn(
              'flex cursor-pointer items-center justify-between gap-4 rounded-[0.25rem] border bg-white px-4 py-3 transition',
              value ? 'border-[#005db6] bg-[#eef5ff]' : 'border-[#d4dde8] hover:bg-[#f6f8fa]',
            )}
          >
            <span className="text-sm font-medium text-[#000a1e]">{field.label}</span>
            <Switch checked={Boolean(value)} onCheckedChange={(checked) => setAnswer(field.key, checked)} />
          </label>
        )

      case 'rating': {
        const min = field.options?.min ?? 1
        const max = field.options?.max ?? 5
        const ratings = Array.from({ length: max - min + 1 }, (_, index) => String(min + index))
        return (
          <FieldShell key={field.key} field={field} error={error}>
            <Select value={(value as string) || ''} onValueChange={(next) => setAnswer(field.key, next)}>
              <SelectTrigger aria-label={field.label}>
                <SelectValue placeholder={`Select ${field.label.toLowerCase()}`} />
              </SelectTrigger>
              <SelectContent>
                {ratings.map((rating) => (
                  <SelectItem key={rating} value={rating}>
                    {rating}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FieldShell>
        )
      }

      case 'percent':
      case 'integer':
        return (
          <FieldShell key={field.key} field={field} error={error}>
            <Input
              id={`field-${field.key}`}
              type="number"
              min={field.options?.min ?? 0}
              max={field.options?.max ?? (field.type === 'percent' ? 100 : undefined)}
              value={(value as string) || ''}
              onChange={(event) => setAnswer(field.key, event.target.value)}
            />
          </FieldShell>
        )

      case 'time':
        return (
          <FieldShell key={field.key} field={field} error={error}>
            <Input
              id={`field-${field.key}`}
              type="time"
              value={(value as string) || ''}
              onChange={(event) => setAnswer(field.key, event.target.value)}
            />
          </FieldShell>
        )

      case 'text':
        return (
          <FieldShell key={field.key} field={field} error={error}>
            <Textarea
              id={`field-${field.key}`}
              className="min-h-24"
              value={(value as string) || ''}
              onChange={(event) => setAnswer(field.key, event.target.value)}
            />
          </FieldShell>
        )

      case 'single_select':
        return (
          <FieldShell key={field.key} field={field} error={error}>
            <Select value={(value as string) || ''} onValueChange={(next) => setAnswer(field.key, next)}>
              <SelectTrigger aria-label={field.label}>
                <SelectValue placeholder={`Select ${field.label.toLowerCase()}`} />
              </SelectTrigger>
              <SelectContent>
                {(field.options?.choices ?? []).map((choice) => (
                  <SelectItem key={choice.value} value={choice.value}>
                    {choice.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FieldShell>
        )

      case 'multi_select': {
        const selected = Array.isArray(value) ? value : []
        return (
          <div key={field.key} className="space-y-2">
            <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-[#000a1e]">{field.label}</p>
            <div className="grid gap-2.5 sm:grid-cols-2">
              {(field.options?.choices ?? []).map((choice) => {
                const checked = selected.includes(choice.value)
                return (
                  <label
                    key={choice.value}
                    className={cn(
                      'flex cursor-pointer items-center gap-3 rounded-[0.25rem] border bg-white px-3.5 py-3 transition',
                      checked ? 'border-[#005db6] bg-[#eef5ff]' : 'border-[#d4dde8] hover:bg-[#f6f8fa]',
                    )}
                  >
                    <Checkbox
                      checked={checked}
                      onCheckedChange={(state) =>
                        setAnswer(
                          field.key,
                          state === true
                            ? [...selected, choice.value]
                            : selected.filter((entry) => entry !== choice.value),
                        )
                      }
                    />
                    <span className="text-sm font-medium text-[#000a1e]">{choice.label}</span>
                  </label>
                )
              })}
            </div>
          </div>
        )
      }
    }
  }

  return (
    <form
      className="space-y-8"
      onSubmit={(event) => {
        event.preventDefault()
        void submit()
      }}
    >
      <section className={panelClass}>
        <div className="flex items-center gap-2">
          <span aria-hidden="true" className="h-3.5 w-[3px] rounded-full bg-[#f0b429]" />
          <h2 className="font-display text-[1.25rem] font-bold tracking-[-0.02em] text-[#000a1e]">
            {subjectLabel}
          </h2>
        </div>
        <div className="mt-5 max-w-md space-y-2">
          <Select value={subjectId} onValueChange={(next) => setSubjectId(next)}>
            <SelectTrigger aria-label={subjectLabel}>
              <SelectValue placeholder={`Select ${subjectLabel.toLowerCase()}`} />
            </SelectTrigger>
            <SelectContent>
              {subjects.map((subject) => (
                <SelectItem key={subject.id} value={subject.id}>
                  {subject.fullName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {errors.subjectId ? <p className="text-sm text-[#ba1a1a]">{errors.subjectId}</p> : null}
        </div>
      </section>

      {sections.map((section) => {
        const booleanFields = section.fields.filter((field) => field.type === 'boolean')
        const otherFields = section.fields.filter((field) => field.type !== 'boolean')

        return (
          <section key={section.section} className={panelClass}>
            <div className="flex items-center gap-2">
              <span aria-hidden="true" className="h-3.5 w-[3px] rounded-full bg-[#f0b429]" />
              <h2 className="font-display text-[1.25rem] font-bold tracking-[-0.02em] text-[#000a1e]">
                {section.section}
              </h2>
            </div>
            <div className="mt-5 space-y-5">
              {otherFields.length ? (
                <div className="grid gap-5 md:grid-cols-2">{otherFields.map(renderField)}</div>
              ) : null}
              {booleanFields.length ? (
                <div className="grid gap-3 sm:grid-cols-2">{booleanFields.map(renderField)}</div>
              ) : null}
            </div>
          </section>
        )
      })}

      <div className="flex justify-end">
        <Button type="submit" disabled={isSubmitting} className="gap-2">
          {isSubmitting ? 'Submitting…' : 'Submit evaluation'}
          <Send className="h-4 w-4" />
        </Button>
      </div>
    </form>
  )
}
