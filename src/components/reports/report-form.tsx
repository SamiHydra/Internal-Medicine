import { zodResolver } from '@hookform/resolvers/zod'
import { format } from 'date-fns'
import { motion } from 'framer-motion'
import { CheckCircle2, Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useForm, useWatch, type FieldErrors } from 'react-hook-form'
import { toast } from 'sonner'
import { z } from 'zod'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { departmentMap, templateMap } from '@/config/templates'
import { deriveReportStatus, getReportForAssignmentPeriod } from '@/data/selectors'
import { useAppData } from '@/context/app-data-context'
import { formatTimestamp, getDeadlineForPeriod } from '@/lib/dates'
import { computeWeeklyValue } from '@/lib/metrics'
import { cn } from '@/lib/utils'
import type {
  ReportAssignment,
  ReportFieldValue,
  ReportingPeriod,
  ReportStatus,
  ReportTemplateConfig,
  ReportTemplateField,
  Weekday,
} from '@/types/domain'

type ReportFormValues = {
  values: Record<string, Partial<Record<Weekday, string>>>
}

function createFieldValidation(field: ReportTemplateField) {
  if (field.kind === 'integer' || field.kind === 'decimal') {
    return z
      .string()
      .refine(
        (value) => value.trim() === '' || (!Number.isNaN(Number(value)) && Number(value) >= 0),
        'Enter a non-negative number',
      )
  }

  if (field.kind === 'time') {
    return z
      .string()
      .refine(
        (value) => value.trim() === '' || /^\d{2}:\d{2}$/.test(value),
        'Use HH:MM format',
      )
  }

  if (field.kind === 'choice') {
    return z
      .string()
      .refine(
        (value) => value.trim() === '' || field.options?.includes(value),
        'Select a valid option',
      )
  }

  return z.string().max(120, 'Keep entries under 120 characters')
}

function createTemplateSchema(template: ReportTemplateConfig) {
  const fieldsShape = Object.fromEntries(
    template.fields.map((field) => [
      field.id,
      z.object(
        Object.fromEntries(
          template.activeDays.map((day) => [day, createFieldValidation(field).optional()]),
        ),
      ),
    ]),
  )

  return z.object({
    values: z.object(fieldsShape),
  })
}

function createDefaultValues(
  template: ReportTemplateConfig,
  report: ReturnType<typeof getReportForAssignmentPeriod>,
) {
  const values = Object.fromEntries(
    template.fields.map((field) => [
      field.id,
      Object.fromEntries(
        template.activeDays.map((day) => [
          day,
          report?.values[field.id]?.dailyValues[day] !== undefined &&
          report?.values[field.id]?.dailyValues[day] !== null
            ? String(report?.values[field.id]?.dailyValues[day])
            : '',
        ]),
      ),
    ]),
  ) as ReportFormValues['values']

  return { values }
}

function coerceFieldValue(field: ReportTemplateField, rawValue: string) {
  if (rawValue.trim() === '') {
    return null
  }

  if (field.kind === 'integer') {
    return Math.max(0, Math.round(Number(rawValue)))
  }

  if (field.kind === 'decimal') {
    return Math.max(0, Number(rawValue))
  }

  return rawValue
}

function normalizeFieldInput(field: ReportTemplateField, rawValue: string) {
  if (
    (field.kind === 'integer' || field.kind === 'decimal') &&
    ['-', '.', '-.'].includes(rawValue.trim())
  ) {
    return ''
  }

  return rawValue
}

function buildPersistedValues(
  template: ReportTemplateConfig,
  values: ReportFormValues['values'],
) {
  return Object.fromEntries(
    template.fields.map((field) => [
      field.id,
      {
        fieldId: field.id,
        dailyValues: Object.fromEntries(
          template.activeDays.map((day) => [day, coerceFieldValue(field, values[field.id]?.[day] ?? '')]),
        ),
      } satisfies ReportFieldValue,
    ]),
  ) as Record<string, ReportFieldValue>
}

function renderComputedValue(
  field: ReportTemplateField,
  values: Partial<Record<Weekday, string>>,
) {
  const computedValue = computeWeeklyValue(
    field,
    Object.fromEntries(
      Object.entries(values).map(([day, value]) => [
        day,
        coerceFieldValue(field, value ?? ''),
      ]),
    ) as ReportFieldValue['dailyValues'],
  )

  if (computedValue === null || computedValue === undefined || computedValue === '') {
    return '-'
  }

  if (typeof computedValue === 'number') {
    return field.kind === 'decimal' ? computedValue.toFixed(1) : computedValue.toString()
  }

  return computedValue
}

const serviceLineLabels = {
  inpatient: 'Inpatient',
  outpatient: 'Outpatient',
  procedure: 'Procedures',
} as const

const statusLabels: Record<ReportStatus, string> = {
  not_started: 'Not started',
  draft: 'Draft',
  submitted: 'Submitted',
  edited_after_submission: 'Edited',
  locked: 'Locked',
  overdue: 'Overdue',
}

const statusToneStyles: Record<
  ReportStatus,
  {
    chip: string
    dot: string
  }
> = {
  not_started: {
    chip: 'border-slate-200/90 bg-white/78 text-slate-700',
    dot: 'bg-slate-400',
  },
  draft: {
    chip: 'border-cyan-200/90 bg-cyan-50/92 text-cyan-800',
    dot: 'bg-cyan-500',
  },
  submitted: {
    chip: 'border-emerald-200/90 bg-emerald-50/92 text-emerald-800',
    dot: 'bg-emerald-500',
  },
  edited_after_submission: {
    chip: 'border-amber-200/90 bg-amber-50/92 text-amber-800',
    dot: 'bg-amber-400',
  },
  locked: {
    chip: 'border-slate-300/90 bg-slate-100/92 text-slate-700',
    dot: 'bg-slate-500',
  },
  overdue: {
    chip: 'border-rose-200/90 bg-rose-50/92 text-rose-800',
    dot: 'bg-rose-500',
  },
}

function FieldInput({
  field,
  value,
  onChange,
  disabled,
  invalid,
}: {
  field: ReportTemplateField
  value: string
  onChange: (nextValue: string) => void
  disabled: boolean
  invalid?: boolean
}) {
  if (field.kind === 'choice') {
    return (
      <Select value={value} onValueChange={onChange} disabled={disabled}>
        <SelectTrigger
          className={cn(
            invalid &&
              'border-rose-300 bg-rose-50/60 focus:border-rose-400 focus:ring-rose-100',
          )}
        >
          <SelectValue placeholder="Select" />
        </SelectTrigger>
        <SelectContent>
          {field.options?.map((option) => (
            <SelectItem key={option} value={option}>
              {option}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    )
  }

  if (field.kind === 'text' && field.label.toLowerCase().includes('name')) {
    return (
      <Input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        className={cn(
          invalid &&
            'border-rose-300 bg-rose-50/60 focus:border-rose-400 focus:ring-rose-100',
        )}
      />
    )
  }

  if (field.kind === 'text') {
    return (
      <Textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        className={cn(
          'min-h-20',
          invalid &&
            'border-rose-300 bg-rose-50/60 focus:border-rose-400 focus:ring-rose-100',
        )}
      />
    )
  }

  return (
    <Input
      type={field.kind === 'time' ? 'time' : 'number'}
      step={field.kind === 'decimal' ? '0.1' : '1'}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      disabled={disabled}
      min={0}
      className={cn(
        invalid &&
          'border-rose-300 bg-rose-50/60 focus:border-rose-400 focus:ring-rose-100',
      )}
    />
  )
}

type ResolvedReportFormProps = Pick<
  ReturnType<typeof useAppData>,
  'state' | 'saveReport' | 'lockReport' | 'unlockReport'
> & {
  currentUser: NonNullable<ReturnType<typeof useAppData>['currentUser']>
  assignment: ReportAssignment
  period: ReportingPeriod
}

function ResolvedReportForm({
  state,
  currentUser,
  saveReport,
  lockReport,
  unlockReport,
  assignment,
  period,
}: ResolvedReportFormProps) {
  const [autosaveLabel, setAutosaveLabel] = useState<string | null>(null)
  const [formErrorMessage, setFormErrorMessage] = useState<string | null>(null)
  const [isAutosaving, setIsAutosaving] = useState(false)
  const [isSavingDraft, setIsSavingDraft] = useState(false)
  const [isSubmittingReport, setIsSubmittingReport] = useState(false)
  const template = templateMap[assignment.templateId]
  const department = departmentMap[assignment.departmentId]
  const report = getReportForAssignmentPeriod(state, assignment.id, period.id)
  const reportStatus = deriveReportStatus(state, period.id, report)
  const formSchema = createTemplateSchema(template)
  const canEdit =
    reportStatus !== 'locked' &&
    (currentUser.role !== 'nurse' || currentUser.id === assignment.nurseId)

  const form = useForm<ReportFormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: createDefaultValues(template, report),
    mode: 'onChange',
  })
  const watchedValues = useWatch({
    control: form.control,
    name: 'values',
  })
  const watchedValuesSignature = JSON.stringify(watchedValues ?? {})

  const getFirstFormError = (errors: FieldErrors<ReportFormValues>) => {
    const valueErrors = errors.values as
      | Partial<Record<string, Partial<Record<Weekday, { message?: unknown }>>>>
      | undefined

    if (!valueErrors) {
      return 'Fix invalid entries before submitting.'
    }

    for (const field of template.fields) {
      const fieldDayErrors = valueErrors[field.id]
      if (!fieldDayErrors) {
        continue
      }

      for (const day of template.activeDays) {
        const errorMessage = fieldDayErrors[day]?.message
        if (typeof errorMessage === 'string' && errorMessage.trim().length) {
          return `${field.label} (${day.slice(0, 3)}): ${errorMessage}`
        }
      }
    }

    return 'Fix invalid entries before submitting.'
  }

  useEffect(() => {
    if (form.formState.isDirty || isAutosaving || isSavingDraft || isSubmittingReport) {
      return
    }

    form.reset(createDefaultValues(template, report))
  }, [
    form,
    form.formState.isDirty,
    isAutosaving,
    isSavingDraft,
    isSubmittingReport,
    report,
    report?.updatedAt,
    template,
  ])

  useEffect(() => {
    if (form.formState.isValid && formErrorMessage) {
      setFormErrorMessage(null)
    }
  }, [form.formState.isValid, formErrorMessage])

  useEffect(() => {
    if (!form.formState.isDirty) {
      return
    }

    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }

    window.addEventListener('beforeunload', beforeUnload)
    return () => window.removeEventListener('beforeunload', beforeUnload)
  }, [form.formState.isDirty])

  useEffect(() => {
    if (
      !canEdit ||
      !form.formState.isDirty ||
      !form.formState.isValid ||
      isAutosaving ||
      isSavingDraft ||
      isSubmittingReport
    ) {
      return
    }

    const timer = window.setTimeout(() => {
      const values = form.getValues()
      const savedValuesSignature = JSON.stringify(values.values)
      setIsAutosaving(true)

      void (async () => {
        try {
          const saved = await saveReport({
            assignmentId: assignment.id,
            reportingPeriodId: period.id,
            actorId: currentUser.id,
            values: buildPersistedValues(template, values.values),
            submit: false,
          })
          if (!saved) {
            return
          }

          const currentValues = form.getValues()
          const currentValuesSignature = JSON.stringify(currentValues.values)

          if (currentValuesSignature !== savedValuesSignature) {
            return
          }

          form.reset(currentValues)
          setFormErrorMessage(null)
          setAutosaveLabel(`Draft autosaved at ${new Date().toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
          })}`)
        } finally {
          setIsAutosaving(false)
        }
      })()
    }, 1400)

    return () => window.clearTimeout(timer)
  }, [
    assignment.id,
    canEdit,
    currentUser.id,
    form,
    form.formState.isDirty,
    form.formState.isValid,
    isAutosaving,
    isSavingDraft,
    isSubmittingReport,
    period.id,
    saveReport,
    template,
    watchedValuesSignature,
  ])

  const handleInvalidSubmit = (errors: FieldErrors<ReportFormValues>) => {
    const nextErrorMessage = getFirstFormError(errors)
    setFormErrorMessage(nextErrorMessage)
    toast.error(nextErrorMessage)
  }

  const saveDraft = form.handleSubmit(async (values) => {
    setIsSavingDraft(true)

    try {
      const savedValuesSignature = JSON.stringify(values.values)
      const saved = await saveReport({
        assignmentId: assignment.id,
        reportingPeriodId: period.id,
        actorId: currentUser.id,
        values: buildPersistedValues(template, values.values),
        submit: false,
      })

      if (!saved) {
        return
      }

      const currentValues = form.getValues()
      if (JSON.stringify(currentValues.values) === savedValuesSignature) {
        form.reset(currentValues)
      }
      setFormErrorMessage(null)
      setAutosaveLabel(`Draft saved at ${new Date().toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
      })}`)
    } finally {
      setIsSavingDraft(false)
    }
  }, handleInvalidSubmit)

  const submitReport = form.handleSubmit(async (values) => {
    setIsSubmittingReport(true)

    try {
      const submittedValuesSignature = JSON.stringify(values.values)
      const saved = await saveReport({
        assignmentId: assignment.id,
        reportingPeriodId: period.id,
        actorId: currentUser.id,
        values: buildPersistedValues(template, values.values),
        submit: true,
      })

      if (!saved) {
        return
      }

      const currentValues = form.getValues()
      if (JSON.stringify(currentValues.values) === submittedValuesSignature) {
        form.reset(currentValues)
      }
      setFormErrorMessage(null)
      setAutosaveLabel(`Report submitted at ${new Date().toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
      })}`)
      toast.success('Report submitted', {
        description: `${department.name} for ${period.label} was sent for review.`,
      })
    } finally {
      setIsSubmittingReport(false)
    }
  }, handleInvalidSubmit)

  const deadlineAt = getDeadlineForPeriod(
    period,
    state.settings.weeklyDeadlineDay,
    state.settings.weeklyDeadlineTime,
  )
  const serviceLineLabel = serviceLineLabels[department.family]
  const statusLabel = statusLabels[reportStatus]
  const statusTone = statusToneStyles[reportStatus]
  const deadlineDateLabel = format(deadlineAt, 'EEE, MMM d')
  const deadlineTimeLabel = format(deadlineAt, 'HH:mm')
  const lastUpdateLabel = report?.updatedAt
    ? formatTimestamp(report.updatedAt)
    : 'No saved draft yet'
  const submittedAtLabel = report?.submittedAt ? formatTimestamp(report.submittedAt) : null
  const desktopGridTemplate = `minmax(220px, 2fr) repeat(${template.activeDays.length}, minmax(76px, 0.9fr)) minmax(96px, 0.95fr)`

  return (
    <div className="min-w-0 space-y-6">
      <section className="relative overflow-hidden px-2 py-4 md:px-4">
        <div className="pointer-events-none absolute inset-0">
          <div className="login-grid-drift absolute inset-0 opacity-50" />
          <div className="login-ambient-drift absolute left-[-4%] top-[8%] h-44 w-44 rounded-full bg-white/56 blur-3xl md:h-56 md:w-56" />
          <div className="login-ambient-drift-reverse absolute right-[6%] top-[8%] h-64 w-64 rounded-full bg-sky-200/32 blur-3xl" />
          <div className="login-ambient-drift absolute bottom-[8%] left-[18%] h-56 w-56 rounded-full bg-teal-200/18 blur-3xl" />
          <div className="login-ring-orbit absolute right-[12%] top-[18%] h-24 w-24 rounded-full border border-sky-200/40" />
          <div className="login-line-flow absolute bottom-[18%] right-[10%] h-px w-32 bg-gradient-to-r from-transparent via-sky-300/65 to-transparent" />
        </div>

        <div className="relative grid gap-8 xl:grid-cols-[minmax(0,1fr)_320px] xl:items-center">
          <motion.div
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            className="max-w-[760px] space-y-4"
          >
            <div className="inline-flex items-center gap-2 rounded-full bg-white/72 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-sky-700 shadow-[0_14px_30px_-24px_rgba(14,165,233,0.55)] backdrop-blur-sm">
              <span className="h-2 w-2 rounded-full bg-sky-500" />
              Structured reporting
            </div>

            <div className="space-y-0">
              <h1 className="font-display max-w-[8ch] text-5xl font-semibold leading-[0.9] tracking-tight text-slate-950 md:text-[5.6rem] xl:text-[6.2rem]">
                {department.name} weekly report
              </h1>
              <p className="pt-5 text-sm font-semibold uppercase tracking-[0.24em] text-slate-500 md:pt-6 md:text-[0.8rem]">
                {template.name} / {period.label}
              </p>
            </div>

            <div className="flex flex-wrap gap-2.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
              <span className="login-chip-float rounded-full border border-white/70 bg-white/55 px-3 py-2 backdrop-blur-sm">
                {serviceLineLabel}
              </span>
              <span
                className="login-chip-float rounded-full border border-white/70 bg-white/55 px-3 py-2 backdrop-blur-sm"
                style={{ animationDelay: '700ms' }}
              >
                {canEdit ? 'Editing live' : 'Read only'}
              </span>
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 22 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.08 }}
            className="grid gap-4 rounded-[2rem] border border-white/65 bg-white/44 p-5 shadow-[0_24px_55px_-34px_rgba(15,23,42,0.2)] backdrop-blur-md xl:justify-self-end"
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1 border-b border-white/70 pb-4 sm:border-b-0 sm:border-r sm:pb-0 sm:pr-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-sky-700">
                  Status
                </p>
                <span
                  className={cn(
                    'mt-2 inline-flex items-center gap-2 rounded-full border px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.18em] shadow-[0_14px_24px_-20px_rgba(15,23,42,0.16)] backdrop-blur-sm',
                    statusTone.chip,
                  )}
                >
                  <span className={cn('h-2 w-2 rounded-full', statusTone.dot)} />
                  {statusLabel}
                </span>
              </div>
              <div className="space-y-1 border-b border-white/70 pb-4 sm:border-b-0 sm:pb-0 sm:pl-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-sky-700">
                  Deadline
                </p>
                <p className="mt-2 text-lg font-semibold text-slate-950">{deadlineDateLabel}</p>
                <p className="text-xs text-slate-500">{deadlineTimeLabel}</p>
              </div>
            </div>

            <div className="grid gap-4 border-t border-white/70 pt-4 sm:grid-cols-2">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-sky-700">
                  Last update
                </p>
                <p className="mt-2 text-sm font-medium leading-6 text-slate-700">{lastUpdateLabel}</p>
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-sky-700">
                  Capacity
                </p>
                <p className="mt-2 text-sm font-medium leading-6 text-slate-700">
                  {department.bedCount ? `${department.bedCount} beds` : 'No bed count'}
                </p>
              </div>
            </div>
          </motion.div>
        </div>
      </section>

      <motion.section
        initial={{ opacity: 0, y: 14 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, amount: 0.4 }}
        className="relative overflow-hidden rounded-[2rem] border border-white/70 bg-[linear-gradient(135deg,rgba(255,255,255,0.82),rgba(244,249,255,0.76),rgba(235,253,248,0.62))] px-5 py-5 shadow-[0_20px_42px_-34px_rgba(15,23,42,0.18)] backdrop-blur-md"
      >
        <div className="pointer-events-none absolute inset-0">
          <div className="login-ambient-drift absolute right-[12%] top-[-24%] h-32 w-32 rounded-full bg-sky-200/18 blur-3xl" />
          <div className="login-line-flow absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-sky-300/70 to-transparent" />
        </div>

        <div className="relative flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0 space-y-2">
            <div className="flex flex-wrap items-center gap-3 text-sm">
              {reportStatus === 'edited_after_submission' ? (
                <span className="inline-flex items-center rounded-full border border-amber-200/90 bg-amber-50/92 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-amber-800 shadow-[0_14px_24px_-20px_rgba(15,23,42,0.16)]">
                  Audit trail active
                </span>
              ) : null}
              {submittedAtLabel ? (
                <span className="inline-flex items-center gap-2 rounded-full border border-emerald-200/90 bg-emerald-50/92 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-800 shadow-[0_14px_24px_-20px_rgba(15,23,42,0.16)]">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Submitted {submittedAtLabel}
                </span>
              ) : null}
              <span className="font-medium text-slate-700">
                {canEdit ? 'Editing enabled while unlocked.' : 'This report is read-only.'}
              </span>
            </div>
            <p className="text-sm text-slate-500">
              {autosaveLabel ?? 'Drafts autosave while you work.'}
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            {currentUser.role !== 'nurse' && report ? (
              reportStatus === 'locked' ? (
                <Button
                  variant="secondary"
                  onClick={() => void unlockReport(report.id, currentUser.id)}
                >
                  Unlock report
                </Button>
              ) : (
                <Button
                  variant="secondary"
                  onClick={() => void lockReport(report.id, currentUser.id)}
                >
                  Lock report
                </Button>
              )
            ) : null}
            <Button variant="secondary" onClick={saveDraft} disabled={!canEdit || isSavingDraft || isSubmittingReport}>
              {isSavingDraft ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {isSavingDraft ? 'Saving...' : 'Save draft'}
            </Button>
            <Button onClick={submitReport} disabled={!canEdit || isSubmittingReport || isSavingDraft}>
              {isSubmittingReport ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {isSubmittingReport ? 'Submitting...' : 'Submit report'}
            </Button>
          </div>
        </div>
      </motion.section>

      <form className="space-y-6" onSubmit={submitReport}>
        {template.sections.map((section) => {
          const sectionFields = template.fields.filter(
            (field) => field.sectionId === section.id,
          )

          return (
            <motion.section
              key={section.id}
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.2 }}
              className="relative overflow-hidden rounded-[2.2rem] border border-white/70 bg-[linear-gradient(180deg,rgba(255,255,255,0.96),rgba(242,248,255,0.84))] px-5 py-6 shadow-[0_24px_54px_-36px_rgba(15,23,42,0.22)]"
            >
              <div className="pointer-events-none absolute inset-0">
                <div className="login-grid-drift absolute inset-0 opacity-12" />
                <div className="login-ambient-drift absolute right-[-4%] top-[-12%] h-44 w-44 rounded-full bg-sky-200/12 blur-3xl" />
                <div className="login-line-flow absolute inset-x-6 top-0 h-1 bg-gradient-to-r from-cyan-400 via-sky-500 to-emerald-400" />
              </div>

              <div className="relative space-y-5">
                <div className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-sky-700">
                    Section
                  </p>
                  <h2 className="font-display text-3xl text-slate-950">{section.title}</h2>
                  <p className="text-sm leading-7 text-slate-600">{section.description}</p>
                </div>

                <div className="hidden xl:block">
                  <div className="overflow-x-auto pb-2">
                    <div className="min-w-[980px] space-y-3 pr-2">
                      <div
                        className="grid gap-3 px-3 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500"
                        style={{ gridTemplateColumns: desktopGridTemplate }}
                      >
                        <span>Metric</span>
                        {template.activeDays.map((day) => (
                          <span key={day}>{day.slice(0, 3)}</span>
                        ))}
                        <span>Weekly total</span>
                      </div>

                      <div className="space-y-3">
                        {sectionFields.map((field) => {
                          // eslint-disable-next-line react-hooks/incompatible-library
                          const fieldValues = form.watch(`values.${field.id}` as const) ?? {}
                          const fieldErrors =
                            (form.formState.errors.values?.[field.id] as
                              | Partial<Record<Weekday, { message?: unknown }>>
                              | undefined) ?? {}
                          const rowErrorMessage = template.activeDays
                            .map((day) => {
                              const errorMessage = fieldErrors[day]?.message
                              return typeof errorMessage === 'string' && errorMessage.trim().length
                                ? `${day.slice(0, 3)}: ${errorMessage}`
                                : null
                            })
                            .find(Boolean)

                          return (
                            <div
                              key={field.id}
                              className="grid items-center gap-3 rounded-[1.5rem] border border-slate-200/85 bg-white/84 p-4 shadow-[0_16px_28px_-24px_rgba(15,23,42,0.18)]"
                              style={{ gridTemplateColumns: desktopGridTemplate }}
                            >
                              <div className="space-y-1 pr-2">
                                <Label className="text-sm font-semibold text-slate-800">
                                  {field.label}
                                </Label>
                                <p className={cn('text-xs', rowErrorMessage ? 'text-rose-600' : 'text-slate-500')}>
                                  {rowErrorMessage ??
                                    (field.unit ? `Unit: ${field.unit}` : 'Daily entry')}
                                </p>
                              </div>
                              {template.activeDays.map((day) => (
                                <FieldInput
                                  key={day}
                                  field={field}
                                  value={fieldValues[day] ?? ''}
                                  onChange={(nextValue) =>
                                    form.setValue(
                                      `values.${field.id}.${day}` as const,
                                      normalizeFieldInput(field, nextValue),
                                      {
                                        shouldDirty: true,
                                        shouldValidate: true,
                                      },
                                    )
                                  }
                                  disabled={!canEdit}
                                  invalid={Boolean(fieldErrors[day]?.message)}
                                />
                              ))}
                              <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/90 px-3 py-3 text-center text-sm font-semibold text-slate-700">
                                {renderComputedValue(field, fieldValues)}
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="space-y-3 xl:hidden">
                  {sectionFields.map((field) => {
                    // eslint-disable-next-line react-hooks/incompatible-library
                    const fieldValues = form.watch(`values.${field.id}` as const) ?? {}
                    const fieldErrors =
                      (form.formState.errors.values?.[field.id] as
                        | Partial<Record<Weekday, { message?: unknown }>>
                        | undefined) ?? {}
                    const rowErrorMessage = template.activeDays
                      .map((day) => {
                        const errorMessage = fieldErrors[day]?.message
                        return typeof errorMessage === 'string' && errorMessage.trim().length
                          ? `${day}: ${errorMessage}`
                          : null
                      })
                      .find(Boolean)

                    return (
                      <div
                        key={field.id}
                        className="rounded-[1.5rem] border border-slate-200/85 bg-white/84 p-4 shadow-[0_16px_28px_-24px_rgba(15,23,42,0.18)]"
                      >
                        <div className="space-y-4">
                          <div className="space-y-1">
                            <Label className="text-sm font-semibold text-slate-800">
                              {field.label}
                            </Label>
                            <p className={cn('text-xs', rowErrorMessage ? 'text-rose-600' : 'text-slate-500')}>
                              {rowErrorMessage ??
                                (field.unit ? `Unit: ${field.unit}` : 'Daily entry')}
                            </p>
                          </div>
                          <div className="grid gap-3 sm:grid-cols-2">
                            {template.activeDays.map((day) => (
                              <div key={day} className="space-y-2">
                                <Label className="text-xs uppercase tracking-[0.18em] text-slate-500">
                                  {day}
                                </Label>
                                <FieldInput
                                  field={field}
                                  value={fieldValues[day] ?? ''}
                                  onChange={(nextValue) =>
                                    form.setValue(
                                      `values.${field.id}.${day}` as const,
                                      normalizeFieldInput(field, nextValue),
                                      {
                                        shouldDirty: true,
                                        shouldValidate: true,
                                      },
                                    )
                                  }
                                  disabled={!canEdit}
                                  invalid={Boolean(fieldErrors[day]?.message)}
                                />
                              </div>
                            ))}
                          </div>
                          <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/90 px-4 py-3 text-sm font-semibold text-slate-700">
                            Weekly total: {renderComputedValue(field, fieldValues)}
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            </motion.section>
          )
        })}

        <div className="sticky bottom-4 z-20 rounded-[1.75rem] border border-white/70 bg-[linear-gradient(180deg,rgba(255,255,255,0.96),rgba(244,249,255,0.88))] p-4 shadow-[0_20px_40px_-24px_rgba(15,23,42,0.26)] backdrop-blur-xl">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-semibold text-slate-800">
                {form.formState.isDirty ? 'Unsaved changes present' : 'All changes saved'}
              </p>
              <p className="text-sm text-slate-500">
                {formErrorMessage ?? 'Weekly totals calculate automatically and remain read-only.'}
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Button
                variant="secondary"
                type="button"
                onClick={saveDraft}
                disabled={!canEdit || isSavingDraft || isSubmittingReport}
              >
                {isSavingDraft ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {isSavingDraft ? 'Saving...' : 'Save draft'}
              </Button>
              <Button type="submit" disabled={!canEdit || isSubmittingReport || isSavingDraft}>
                {isSubmittingReport ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {isSubmittingReport ? 'Submitting...' : 'Submit report'}
              </Button>
            </div>
          </div>
        </div>
      </form>
    </div>
  )
}

export function ReportForm({
  assignmentId,
  periodId,
}: {
  assignmentId: string
  periodId: string
}) {
  const appData = useAppData()
  const assignment = appData.state.assignments.find((entry) => entry.id === assignmentId)
  const period = appData.state.reportingPeriods.find((entry) => entry.id === periodId)

  if (!assignment || !period || !appData.currentUser) {
    return (
      <section className="relative overflow-hidden rounded-[2rem] border border-white/70 bg-[linear-gradient(180deg,rgba(255,255,255,0.94),rgba(242,248,255,0.82))] px-6 py-8 shadow-[0_20px_44px_-28px_rgba(15,23,42,0.2)]">
        <div className="pointer-events-none absolute inset-0">
          <div className="login-grid-drift absolute inset-0 opacity-15" />
          <div className="login-line-flow absolute inset-x-6 top-0 h-1 bg-gradient-to-r from-cyan-400 via-sky-500 to-emerald-400" />
        </div>
        <div className="relative space-y-2">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-sky-700">
            Structured reporting
          </p>
          <h1 className="font-display text-3xl text-slate-950">Report not available</h1>
          <p className="max-w-xl text-sm leading-7 text-slate-600">
            This report assignment could not be found for the selected reporting period.
          </p>
        </div>
      </section>
    )
  }

  return (
    <ResolvedReportForm
      {...appData}
      currentUser={appData.currentUser}
      assignment={assignment}
      period={period}
    />
  )
}
