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
  template: ReportTemplateConfig,
  allValues: ReportFormValues['values'],
) {
  const getComputedValueForField = (
    targetField: ReportTemplateField,
    targetValues: Partial<Record<Weekday, string>>,
  ) =>
    computeWeeklyValue(
      targetField,
      Object.fromEntries(
        Object.entries(targetValues).map(([day, value]) => [
          day,
          coerceFieldValue(targetField, value ?? ''),
        ]),
      ) as ReportFieldValue['dailyValues'],
    )

  let computedValue = getComputedValueForField(field, values)

  if (field.id === 'total_admitted_patients') {
    const newlyAdmittedField = template.fields.find(
      (candidate) => candidate.id === 'new_admitted_patients',
    )
    const newlyAdmittedValue = newlyAdmittedField
      ? getComputedValueForField(
          newlyAdmittedField,
          allValues[newlyAdmittedField.id] ?? {},
        )
      : null

    computedValue =
      (typeof computedValue === 'number' ? computedValue : 0) +
      (typeof newlyAdmittedValue === 'number' ? newlyAdmittedValue : 0)
  }

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
    surface: string
  }
> = {
  not_started: {
    chip: 'border-[#d4dde8] bg-[#edf1f5] text-[#44474e]',
    dot: 'bg-[#74777f]',
    surface: 'text-[#1d3047] bg-[#edf1f5] outline-[#d4dde8]/75',
  },
  draft: {
    chip: 'border-[#cfe0f4] bg-[#edf4fb] text-[#005db6]',
    dot: 'bg-[#005db6]',
    surface: 'text-[#005db6] bg-[#edf4fb] outline-[#cfe0f4]/75',
  },
  submitted: {
    chip: 'border-[#cfe7d9] bg-[#edf7f0] text-[#1f6b3b]',
    dot: 'bg-[#1f6b3b]',
    surface: 'text-[#1f6b3b] bg-[#edf7f0] outline-[#cfe7d9]/75',
  },
  edited_after_submission: {
    chip: 'border-[#f0d9aa] bg-[#fbf4e6] text-[#8a5a00]',
    dot: 'bg-[#c88719]',
    surface: 'text-[#8a5a00] bg-[#fbf4e6] outline-[#f0d9aa]/75',
  },
  locked: {
    chip: 'border-[#d4dde8] bg-[#edf1f5] text-[#1d3047]',
    dot: 'bg-[#1d3047]',
    surface: 'text-[#1d3047] bg-[#edf1f5] outline-[#d4dde8]/75',
  },
  overdue: {
    chip: 'border-[#f1d1d1] bg-[#fff1f1] text-[#9d2a2a]',
    dot: 'bg-[#ba1a1a]',
    surface: 'text-[#9d2a2a] bg-[#fff1f1] outline-[#f1d1d1]/75',
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
            'bg-[none] bg-[#ffffff] shadow-none',
            invalid &&
              'border-rose-300 bg-[none] bg-rose-50/60 focus:border-rose-400 focus:ring-rose-100',
          )}
        >
          <SelectValue placeholder="Select" />
        </SelectTrigger>
        <SelectContent className="border-[#d4dde8] bg-[none] bg-[#ffffff] shadow-[0_16px_30px_rgba(0,33,71,0.08)]">
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
          'bg-[none] bg-[#ffffff] shadow-none',
          invalid &&
            'border-rose-300 bg-[none] bg-rose-50/60 focus:border-rose-400 focus:ring-rose-100',
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
          'min-h-20 rounded-[0.25rem] bg-[none] bg-[#ffffff] shadow-none',
          invalid &&
            'border-rose-300 bg-[none] bg-rose-50/60 focus:border-rose-400 focus:ring-rose-100',
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
        'bg-[none] bg-[#ffffff] shadow-none',
        invalid &&
          'border-rose-300 bg-[none] bg-rose-50/60 focus:border-rose-400 focus:ring-rose-100',
      )}
    />
  )
}

type ResolvedReportFormProps = Pick<
  ReturnType<typeof useAppData>,
  | 'state'
  | 'saveReport'
  | 'lockReport'
  | 'unlockReport'
  | 'ensureReportDetails'
  | 'isReportDetailLoaded'
  | 'isSyncing'
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
  ensureReportDetails,
  isReportDetailLoaded,
  isSyncing,
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
  const reportDetailsLoaded = !report?.id || isReportDetailLoaded(report.id)
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
  const isLiveReportLookupPending = !report && isSyncing

  useEffect(() => {
    if (!report?.id || reportDetailsLoaded) {
      return
    }

    void ensureReportDetails([report.id])
  }, [ensureReportDetails, report?.id, reportDetailsLoaded])

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
    if (
      !reportDetailsLoaded ||
      form.formState.isDirty ||
      isAutosaving ||
      isSavingDraft ||
      isSubmittingReport
    ) {
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
    reportDetailsLoaded,
    report?.updatedAt,
    template,
  ])

  useEffect(() => {
    if (!report?.id || !reportDetailsLoaded || !form.formState.isDirty) {
      return
    }

    const savedDefaults = createDefaultValues(template, report)

    template.fields.forEach((field) => {
      template.activeDays.forEach((day) => {
        const fieldPath = `values.${field.id}.${day}` as const

        if (form.getFieldState(fieldPath).isDirty) {
          return
        }

        const savedValue = savedDefaults.values[field.id]?.[day] ?? ''
        const currentValue = form.getValues(fieldPath) ?? ''

        if (currentValue !== savedValue) {
          form.setValue(fieldPath, savedValue, {
            shouldDirty: false,
            shouldValidate: true,
          })
        }
      })
    })
  }, [
    form,
    form.formState.isDirty,
    report,
    report?.id,
    report?.updatedAt,
    reportDetailsLoaded,
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
      !reportDetailsLoaded ||
      isLiveReportLookupPending ||
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
    isLiveReportLookupPending,
    period.id,
    reportDetailsLoaded,
    saveReport,
    template,
    watchedValuesSignature,
  ])

  const isWaitingForReportDetails =
    Boolean(report?.id && !reportDetailsLoaded) &&
    !form.formState.isDirty &&
    !isAutosaving &&
    !isSavingDraft &&
    !isSubmittingReport
  const isWaitingForLiveReportLookup =
    isLiveReportLookupPending &&
    !form.formState.isDirty &&
    !isAutosaving &&
    !isSavingDraft &&
    !isSubmittingReport

  if (isWaitingForReportDetails || isWaitingForLiveReportLookup) {
    return (
      <section className="rounded-[0.35rem] bg-[#eef2f6] px-6 py-8">
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[#005db6]">
            Structured reporting
          </p>
          <h1 className="font-display text-[2rem] text-[#000a1e]">
            {isWaitingForLiveReportLookup ? 'Checking saved report' : 'Loading saved cells'}
          </h1>
          <p className="max-w-xl text-sm leading-6 text-[#44474e]">
            Restoring {department.name} for {period.label}.
          </p>
        </div>
      </section>
    )
  }

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

  const deadlineAt = state.settings.deadlineEnforced
    ? getDeadlineForPeriod(
        period,
        state.settings.weeklyDeadlineDay,
        state.settings.weeklyDeadlineTime,
      )
    : null
  const serviceLineLabel = serviceLineLabels[department.family]
  const statusLabel = statusLabels[reportStatus]
  const statusTone = statusToneStyles[reportStatus]
  const deadlineDateLabel = deadlineAt ? format(deadlineAt, 'EEE, MMM d') : 'Disabled'
  const deadlineTimeLabel = deadlineAt ? format(deadlineAt, 'HH:mm') : 'Manual lock only'
  const lastUpdateLabel = report?.updatedAt
    ? formatTimestamp(report.updatedAt)
    : 'No saved draft yet'
  const submittedAtLabel = report?.submittedAt ? formatTimestamp(report.submittedAt) : null
  const desktopGridTemplate = `minmax(220px, 2fr) repeat(${template.activeDays.length}, minmax(76px, 0.9fr)) minmax(96px, 0.95fr)`
  const autosaveStatusLabel = isAutosaving
    ? 'Autosaving draft...'
    : autosaveLabel ?? 'Drafts autosave while you work.'
  const summaryItems = [
    {
      label: 'Status',
      value: statusLabel,
      note: canEdit ? 'Editing enabled' : 'Read only',
      tone: statusTone.surface,
    },
    {
      label: 'Deadline',
      value: deadlineDateLabel,
      note: deadlineTimeLabel,
      tone: 'text-[#8a5a00] bg-[#fcf5e8] outline-[#edd9b0]/75',
    },
    {
      label: 'Last update',
      value: lastUpdateLabel,
      note: submittedAtLabel ? `Submitted ${submittedAtLabel}` : 'Working draft',
      tone: 'text-[#1d3047] bg-[#edf1f5] outline-[#d4dde8]/75',
    },
    {
      label: 'Capacity',
      value: department.bedCount ? `${department.bedCount} beds` : 'Not listed',
      note: serviceLineLabel,
      tone: 'text-[#005db6] bg-[#edf4fb] outline-[#cfe0f4]/75',
    },
  ] as const

  return (
    <div className="min-w-0 space-y-8">
      <motion.section
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.26, ease: 'easeOut' }}
        className="rounded-[0.35rem] bg-[#eef2f6] px-5 py-5 md:px-6"
      >
        <div className="space-y-5">
          <div className="space-y-2">
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#005db6]">
              Structured reporting
            </p>
            <h1 className="font-display text-[2rem] leading-[0.96] tracking-[-0.03em] text-[#000a1e] md:text-[2.35rem]">
              {department.name} weekly report
            </h1>
            <p className="text-sm text-[#44474e]">
              {template.name} / {period.label}
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <span className="rounded-[0.25rem] border border-[#d4dde8] bg-[#ffffff] px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#44474e]">
              {serviceLineLabel}
            </span>
            <span
              className={cn(
                'rounded-[0.25rem] border px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.18em]',
                statusTone.chip,
              )}
            >
              <span className={cn('mr-2 inline-block h-2 w-2 rounded-full align-middle', statusTone.dot)} />
              {canEdit ? 'Editing live' : 'Read only'}
            </span>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {summaryItems.map((item) => (
              <div
                key={item.label}
                className={`rounded-[0.35rem] px-3.5 py-3 outline outline-1 ${item.tone}`}
              >
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em]">
                  {item.label}
                </p>
                <p className="mt-3 break-words font-display text-[1.35rem] leading-[1.08] tracking-[-0.03em]">
                  {item.value}
                </p>
                <p className="mt-1 text-xs leading-5 text-current/75">{item.note}</p>
              </div>
            ))}
          </div>
        </div>
      </motion.section>

      <motion.section
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.28, ease: 'easeOut' }}
        className="rounded-[0.35rem] bg-[#eef2f6] px-5 py-5"
      >
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              {reportStatus === 'edited_after_submission' ? (
                <span className="rounded-[0.25rem] border border-[#f0d9aa] bg-[#fbf4e6] px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#8a5a00]">
                  Audit trail active
                </span>
              ) : null}
              {submittedAtLabel ? (
                <span className="inline-flex items-center gap-2 rounded-[0.25rem] border border-[#cfe7d9] bg-[#edf7f0] px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#1f6b3b]">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Submitted {submittedAtLabel}
                </span>
              ) : null}
              <span className="rounded-[0.25rem] border border-[#d4dde8] bg-[#ffffff] px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#44474e]">
                {canEdit ? 'Editing enabled while unlocked' : 'This report is read only'}
              </span>
            </div>

            <p className={cn('text-sm', formErrorMessage ? 'text-[#ba1a1a]' : 'text-[#44474e]')}>
              {formErrorMessage ?? autosaveStatusLabel}
            </p>
          </div>

          <div className="flex flex-wrap gap-3">
            {currentUser.role !== 'nurse' && report ? (
              reportStatus === 'locked' ? (
                <Button
                  variant="secondary"
                  className="bg-[none] bg-[#ffffff] shadow-none"
                  onClick={() => void unlockReport(report.id, currentUser.id)}
                >
                  Unlock report
                </Button>
              ) : (
                <Button
                  variant="secondary"
                  className="bg-[none] bg-[#ffffff] shadow-none"
                  onClick={() => void lockReport(report.id, currentUser.id)}
                >
                  Lock report
                </Button>
              )
            ) : null}
            <Button
              variant="secondary"
              className="bg-[none] bg-[#ffffff] shadow-none"
              onClick={saveDraft}
              disabled={!canEdit || isSavingDraft || isSubmittingReport}
            >
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
              className="rounded-[0.35rem] bg-[#eef2f6] px-5 py-6"
            >
              <div className="space-y-5">
                <div className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#005db6]">
                    Section
                  </p>
                  <h2 className="font-display text-[1.85rem] text-[#000a1e]">{section.title}</h2>
                  {section.description ? (
                    <p className="text-sm leading-6 text-[#44474e]">{section.description}</p>
                  ) : null}
                </div>

                <div className="hidden xl:block">
                  <div className="overflow-x-auto pb-2">
                    <div className="min-w-[980px] space-y-3 pr-2">
                      <div
                        className="grid gap-3 px-3 text-xs font-semibold uppercase tracking-[0.18em] text-[#74777f]"
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
                              className="grid items-start gap-3 rounded-[0.35rem] border border-[#d4dde8] bg-[#ffffff] p-4"
                              style={{ gridTemplateColumns: desktopGridTemplate }}
                            >
                              <div className="space-y-1 pr-2">
                                <Label className="text-sm font-semibold text-[#000a1e]">
                                  {field.label}
                                </Label>
                                <p className={cn('text-xs', rowErrorMessage ? 'text-[#ba1a1a]' : 'text-[#74777f]')}>
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
                              <div className="rounded-[0.25rem] bg-[#f8fafc] px-3 py-3 text-center text-sm font-semibold text-[#1d3047] outline outline-1 outline-[#d9e0e7]/75">
                                {renderComputedValue(
                                  field,
                                  fieldValues,
                                  template,
                                  watchedValues ?? {},
                                )}
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
                        className="rounded-[0.35rem] border border-[#d4dde8] bg-[#ffffff] p-4"
                      >
                        <div className="space-y-4">
                          <div className="space-y-1">
                            <Label className="text-sm font-semibold text-[#000a1e]">
                              {field.label}
                            </Label>
                            <p className={cn('text-xs', rowErrorMessage ? 'text-[#ba1a1a]' : 'text-[#74777f]')}>
                              {rowErrorMessage ??
                                (field.unit ? `Unit: ${field.unit}` : 'Daily entry')}
                            </p>
                          </div>
                          <div className="grid gap-3 sm:grid-cols-2">
                            {template.activeDays.map((day) => (
                              <div key={day} className="space-y-2">
                                <Label className="text-xs uppercase tracking-[0.18em] text-[#74777f]">
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
                          <div className="rounded-[0.25rem] bg-[#f8fafc] px-4 py-3 text-sm font-semibold text-[#1d3047] outline outline-1 outline-[#d9e0e7]/75">
                            Weekly total: {renderComputedValue(
                              field,
                              fieldValues,
                              template,
                              watchedValues ?? {},
                            )}
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

        <div className="sticky bottom-4 z-20 rounded-[0.35rem] border border-[#d4dde8] bg-[#ffffff] p-4 shadow-[0_18px_30px_-24px_rgba(0,33,71,0.24)]">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-semibold text-[#000a1e]">
                {form.formState.isDirty ? 'Unsaved changes present' : 'All changes saved'}
              </p>
              <p className="text-sm text-[#44474e]">
                {formErrorMessage ?? 'Weekly totals calculate automatically and remain read-only.'}
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Button
                variant="secondary"
                className="bg-[none] bg-[#ffffff] shadow-none"
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

  if (
    appData.currentUser &&
    (!appData.state.assignments.length || !appData.state.reportingPeriods.length) &&
    appData.isSyncing
  ) {
    return (
      <section className="rounded-[0.35rem] bg-[#eef2f6] px-6 py-8">
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[#005db6]">
            Structured reporting
          </p>
          <h1 className="font-display text-[2rem] text-[#000a1e]">Loading report</h1>
          <p className="max-w-xl text-sm leading-6 text-[#44474e]">
            Restoring the selected assignment and reporting period.
          </p>
        </div>
      </section>
    )
  }

  if (!assignment || !period || !appData.currentUser) {
    return (
      <section className="rounded-[0.35rem] bg-[#eef2f6] px-6 py-8">
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[#005db6]">
            Structured reporting
          </p>
          <h1 className="font-display text-[2rem] text-[#000a1e]">Report not available</h1>
          <p className="max-w-xl text-sm leading-6 text-[#44474e]">
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
