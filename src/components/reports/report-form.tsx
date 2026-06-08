import { zodResolver } from '@hookform/resolvers/zod'
import { format } from 'date-fns'
import { motion } from 'framer-motion'
import { AlertCircle, AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, Loader2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useForm, useWatch, type FieldErrors } from 'react-hook-form'
import { toast } from 'sonner'
import { z } from 'zod'

import { panelClass, SectionEyebrow } from '@/components/dashboard/section-panel'
import { ReportContentSkeleton } from '@/components/layout/loading-skeletons'
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
import { useAppData, useAppSync } from '@/context/app-data-context'
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

// Generous upper bound for any plausible weekly hospital metric. Guards against
// non-finite input (Infinity/1e308) and values past the DB column / safe-integer
// range, which would otherwise corrupt aggregates or serialize to null on save.
const MAX_FIELD_VALUE = 1_000_000_000

function createFieldValidation(field: ReportTemplateField) {
  if (field.kind === 'integer' || field.kind === 'decimal') {
    return z
      .string()
      .refine(
        (value) => {
          if (value.trim() === '') {
            return true
          }
          const parsed = Number(value)
          return Number.isFinite(parsed) && parsed >= 0 && parsed <= MAX_FIELD_VALUE
        },
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
    const parsed = Number(rawValue)
    return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : null
  }

  if (field.kind === 'decimal') {
    const parsed = Number(rawValue)
    return Number.isFinite(parsed) ? Math.max(0, parsed) : null
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

const weekdayLabels: Record<Weekday, string> = {
  monday: 'Monday',
  tuesday: 'Tuesday',
  wednesday: 'Wednesday',
  thursday: 'Thursday',
  friday: 'Friday',
  saturday: 'Saturday',
  sunday: 'Sunday',
}

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

function reportHasSavedCellValues(report: ReturnType<typeof getReportForAssignmentPeriod>) {
  if (!report) {
    return false
  }

  return Object.values(report.values).some((fieldValue) =>
    Object.values(fieldValue.dailyValues).some(
      (value) => value !== null && value !== undefined && value !== '',
    ),
  )
}

function ReportStatePanel({
  eyebrow = 'Structured reporting',
  title,
  description,
  detail,
}: {
  eyebrow?: string
  title: string
  description: string
  detail?: string | null
}) {
  const normalizedTitle = title.toLowerCase()
  const isLoadingState =
    normalizedTitle.includes('loading') ||
    normalizedTitle.includes('checking') ||
    normalizedTitle.includes('verifying')

  if (isLoadingState) {
    return <ReportContentSkeleton />
  }

  return (
    <section className={panelClass}>
      <div className="space-y-2">
        <SectionEyebrow label={eyebrow} />
        <h1 className="font-display text-[1.6rem] font-bold leading-tight tracking-[-0.02em] text-[#000a1e] md:text-[1.8rem]">
          {title}
        </h1>
        <p className="max-w-xl text-sm leading-6 text-[#74777f]">{description}</p>
        {detail ? (
          <p className="max-w-xl rounded-[0.35rem] border border-[#e6ecf3] bg-[#f8fafc] px-4 py-3 text-sm leading-6 text-[#5b6169]">
            {detail}
          </p>
        ) : null}
      </div>
    </section>
  )
}

function FieldInput({
  id,
  field,
  value,
  onChange,
  disabled,
  invalid,
  className,
  ariaLabel,
}: {
  id?: string
  field: ReportTemplateField
  value: string
  onChange: (nextValue: string) => void
  disabled: boolean
  invalid?: boolean
  className?: string
  ariaLabel?: string
}) {
  const invalidClass =
    'border-rose-300 bg-[none] bg-rose-50/60 focus:border-rose-400 focus:ring-rose-100'

  if (field.kind === 'choice') {
    return (
      <Select value={value} onValueChange={onChange} disabled={disabled}>
        <SelectTrigger
          id={id}
          aria-label={ariaLabel}
          className={cn('bg-[none] bg-[#ffffff] shadow-none', invalid && invalidClass, className)}
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
        id={id}
        aria-label={ariaLabel}
        className={cn('bg-[none] bg-[#ffffff] shadow-none', invalid && invalidClass, className)}
      />
    )
  }

  if (field.kind === 'text') {
    return (
      <Textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        id={id}
        aria-label={ariaLabel}
        className={cn(
          'min-h-20 rounded-[0.25rem] bg-[none] bg-[#ffffff] shadow-none',
          invalid && invalidClass,
          className,
        )}
      />
    )
  }

  const isTime = field.kind === 'time'

  return (
    <Input
      type={isTime ? 'time' : 'number'}
      // No step on time inputs: a step under 60 makes the browser render a
      // seconds sub-field (HH:MM:SS), which overflows the cell and clips the
      // AM/PM marker — and the form only validates HH:MM, so seconds can't save.
      step={isTime ? undefined : field.kind === 'decimal' ? '0.1' : '1'}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      disabled={disabled}
      id={id}
      aria-label={ariaLabel}
      inputMode={isTime ? undefined : field.kind === 'decimal' ? 'decimal' : 'numeric'}
      min={isTime ? undefined : 0}
      className={cn(
        'bg-[none] bg-[#ffffff] shadow-none',
        // Tighter side padding so the AM/PM marker stays inside the cell.
        isTime && 'px-2',
        invalid && invalidClass,
        className,
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
  | 'getReportDetailLoadState'
  | 'isReportDetailLoaded'
  | 'queuedReportSaveCount'
  | 'hasQueuedReportSave'
> & {
  currentUser: NonNullable<ReturnType<typeof useAppData>['currentUser']>
  assignment: ReportAssignment
  period: ReportingPeriod
  isDataRefreshing: boolean
  isSyncing: boolean
}

function ResolvedReportForm({
  state,
  currentUser,
  saveReport,
  lockReport,
  unlockReport,
  ensureReportDetails,
  getReportDetailLoadState,
  isReportDetailLoaded,
  queuedReportSaveCount,
  hasQueuedReportSave,
  isDataRefreshing,
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
  const reportDetailLoadState = report?.id
    ? getReportDetailLoadState(report.id)
    : { status: 'idle' as const, error: null }
  const reportDetailsLoaded = !report?.id || isReportDetailLoaded(report.id)
  const reportStatus = deriveReportStatus(state, period.id, report)
  const formSchema = createTemplateSchema(template)
  const canView =
    currentUser.role !== 'nurse' || currentUser.id === assignment.nurseId
  const canEdit = reportStatus !== 'locked' && canView
  const hasQueuedSaveForReport = hasQueuedReportSave(assignment.id, period.id)
  const [mobileActiveDay, setMobileActiveDay] = useState<Weekday>(
    () => template.activeDays[0] ?? 'monday',
  )
  const activeMobileDay = template.activeDays.includes(mobileActiveDay)
    ? mobileActiveDay
    : template.activeDays[0] ?? mobileActiveDay
  const activeMobileDayIndex = Math.max(
    0,
    template.activeDays.indexOf(activeMobileDay),
  )
  const mobileDayProgressLabel = `${activeMobileDayIndex + 1} of ${template.activeDays.length}`

  useEffect(() => {
    if (!template.activeDays.length || template.activeDays.includes(mobileActiveDay)) {
      return
    }

    setMobileActiveDay(template.activeDays[0] ?? 'monday')
  }, [mobileActiveDay, template.activeDays])

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
  const isLiveReportLookupPending = !report && (isDataRefreshing || isSyncing)
  const hasSavedCellValues = reportHasSavedCellValues(report)
  const shouldVerifyEmptySubmittedReport =
    Boolean(report?.id) &&
    reportDetailsLoaded &&
    reportDetailLoadState.status === 'loaded' &&
    !hasSavedCellValues &&
    (reportStatus === 'submitted' ||
      reportStatus === 'edited_after_submission' ||
      reportStatus === 'locked')
  const emptyReportVerificationKey = report
    ? `${report.id}:${report.updatedAt}`
    : null
  const pendingEmptyReportVerificationRef = useRef<string | null>(null)
  const forcedEmptyReportVerificationRef = useRef<string | null>(null)

  useEffect(() => {
    if (
      !report?.id ||
      !canView ||
      reportDetailsLoaded ||
      reportDetailLoadState.status === 'loading' ||
      reportDetailLoadState.status === 'error'
    ) {
      return
    }

    void ensureReportDetails([report.id])
  }, [canView, ensureReportDetails, report?.id, reportDetailsLoaded, reportDetailLoadState.status])

  useEffect(() => {
    if (
      !report?.id ||
      !canView ||
      !emptyReportVerificationKey ||
      !shouldVerifyEmptySubmittedReport ||
      pendingEmptyReportVerificationRef.current === emptyReportVerificationKey ||
      forcedEmptyReportVerificationRef.current === emptyReportVerificationKey
    ) {
      return
    }

    pendingEmptyReportVerificationRef.current = emptyReportVerificationKey
    const timer = window.setTimeout(() => {
      void ensureReportDetails([report.id], { force: true }).finally(() => {
        forcedEmptyReportVerificationRef.current = emptyReportVerificationKey
        if (pendingEmptyReportVerificationRef.current === emptyReportVerificationKey) {
          pendingEmptyReportVerificationRef.current = null
        }
      })
    }, 200)

    return () => {
      window.clearTimeout(timer)
      if (pendingEmptyReportVerificationRef.current === emptyReportVerificationKey) {
        pendingEmptyReportVerificationRef.current = null
      }
    }
  }, [
    canView,
    emptyReportVerificationKey,
    ensureReportDetails,
    report?.id,
    shouldVerifyEmptySubmittedReport,
  ])

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
          const result = await saveReport({
            assignmentId: assignment.id,
            reportingPeriodId: period.id,
            actorId: currentUser.id,
            values: buildPersistedValues(template, values.values),
            submit: false,
          })
          if (!result.saved) {
            return
          }

          const currentValues = form.getValues()
          const currentValuesSignature = JSON.stringify(currentValues.values)

          if (currentValuesSignature !== savedValuesSignature) {
            return
          }

          form.reset(currentValues)
          setFormErrorMessage(null)
          setAutosaveLabel(`${result.queued ? 'Draft queued offline' : 'Draft autosaved'} at ${new Date().toLocaleTimeString([], {
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
  const hasVerifiedEmptySubmittedReport =
    shouldVerifyEmptySubmittedReport &&
    forcedEmptyReportVerificationRef.current === emptyReportVerificationKey
  const isVerifyingEmptySubmittedReport =
    shouldVerifyEmptySubmittedReport && !hasVerifiedEmptySubmittedReport

  if (!canView) {
    return (
      <ReportStatePanel
        title="Report access restricted"
        description="This account is not assigned to view this weekly report."
        detail="Open one of your assigned reports, or ask an administrator to update your department access."
      />
    )
  }

  if (reportDetailLoadState.status === 'error' && !form.formState.isDirty) {
    return (
      <ReportStatePanel
        title="Unable to load saved cells"
        description={`The report metadata loaded, but the saved weekly values for ${department.name} could not be fetched.`}
        detail={reportDetailLoadState.error}
      />
    )
  }

  if (
    isWaitingForReportDetails ||
    isWaitingForLiveReportLookup ||
    isVerifyingEmptySubmittedReport
  ) {
    return (
      <ReportStatePanel
        title={
          isWaitingForLiveReportLookup
            ? 'Checking saved report'
            : isVerifyingEmptySubmittedReport
              ? 'Verifying saved cells'
              : 'Loading saved cells'
        }
        description={`Restoring ${department.name} for ${period.label}.`}
      />
    )
  }

  if (!report && currentUser.role !== 'nurse') {
    return (
      <ReportStatePanel
        title="No report exists"
        description={`No saved report was found for ${department.name} during ${period.label}.`}
        detail="The submission board can show an expected report before any data has been entered."
      />
    )
  }

  if (hasVerifiedEmptySubmittedReport && !form.formState.isDirty) {
    return (
      <ReportStatePanel
        title="No saved values found"
        description={`${department.name} is marked ${statusLabels[reportStatus].toLowerCase()}, but no saved cell values were returned for ${period.label}.`}
        detail="This usually means the submission contains no entered values, or the database did not return any cell rows for this report."
      />
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
      const result = await saveReport({
        assignmentId: assignment.id,
        reportingPeriodId: period.id,
        actorId: currentUser.id,
        values: buildPersistedValues(template, values.values),
        submit: false,
      })

      if (!result.saved) {
        return
      }

      const currentValues = form.getValues()
      if (JSON.stringify(currentValues.values) === savedValuesSignature) {
        form.reset(currentValues)
      }
      setFormErrorMessage(null)
      setAutosaveLabel(`${result.queued ? 'Draft queued offline' : 'Draft saved'} at ${new Date().toLocaleTimeString([], {
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
      const result = await saveReport({
        assignmentId: assignment.id,
        reportingPeriodId: period.id,
        actorId: currentUser.id,
        values: buildPersistedValues(template, values.values),
        submit: true,
      })

      if (!result.saved) {
        return
      }

      const currentValues = form.getValues()
      if (JSON.stringify(currentValues.values) === submittedValuesSignature) {
        form.reset(currentValues)
      }
      setFormErrorMessage(null)
      setAutosaveLabel(`${result.queued ? 'Submission queued offline' : 'Report submitted'} at ${new Date().toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
      })}`)

      if (!result.queued) {
        toast.success('Report submitted', {
          description: `${department.name} for ${period.label} was sent for review.`,
        })
      }
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
  const submittedAtLabel = report?.submittedAt ? formatTimestamp(report.submittedAt) : null
  const lastUpdateLabel = hasQueuedSaveForReport
    ? 'Queued offline'
    : report?.updatedAt
      ? formatTimestamp(report.updatedAt)
      : 'No saved draft yet'
  const lastUpdateNote = hasQueuedSaveForReport
    ? 'Sync pending'
    : submittedAtLabel
      ? `Submitted ${submittedAtLabel}`
      : 'Working draft'
  const qualityErrors = report?.quality?.errors ?? []
  const qualityWarnings = report?.quality?.warnings ?? []
  const hasQualitySignals = qualityErrors.length > 0 || qualityWarnings.length > 0
  const completeness = report?.quality?.completeness
  const completenessLabel = completeness ? `${completeness.percent}%` : 'Not scored'
  const completenessNote = completeness
    ? `${completeness.filledCells}/${completeness.expectedCells} cells filled`
    : 'Save once to score'
  const desktopGridTemplate = `minmax(220px, 2fr) repeat(${template.activeDays.length}, minmax(76px, 0.9fr)) minmax(96px, 0.95fr)`
  const queuedSaveStatusLabel = hasQueuedSaveForReport
    ? 'Changes are queued offline and will sync when the connection returns.'
    : queuedReportSaveCount > 0
      ? `${queuedReportSaveCount} offline report save${queuedReportSaveCount === 1 ? '' : 's'} waiting to sync.`
      : null
  const autosaveStatusLabel = isAutosaving
    ? 'Autosaving draft...'
    : queuedSaveStatusLabel ?? autosaveLabel ?? 'Drafts autosave while you work.'
  const goToMobileDay = (offset: number) => {
    const nextDay = template.activeDays[activeMobileDayIndex + offset]

    if (nextDay) {
      setMobileActiveDay(nextDay)
    }
  }
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
      note: lastUpdateNote,
      tone: 'text-[#1d3047] bg-[#edf1f5] outline-[#d4dde8]/75',
    },
    {
      label: 'Completeness',
      value: completenessLabel,
      note: completenessNote,
      tone: 'text-[#005db6] bg-[#edf4fb] outline-[#cfe0f4]/75',
    },
  ] as const

  return (
    <div className="min-w-0 space-y-6">
      <motion.section
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: 'easeOut' }}
        className={panelClass}
      >
        <div className="flex flex-col gap-4 border-b border-[#eef2f6] pb-5 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <SectionEyebrow label="Structured reporting" />
            <h1 className="mt-1.5 font-display text-[1.5rem] font-bold leading-tight tracking-[-0.02em] text-[#000a1e] md:text-[1.7rem]">
              {department.name} weekly report
            </h1>
            <p className="mt-1.5 text-sm text-[#74777f]">
              {template.name} · {period.label}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-[0.25rem] border border-[#d4dde8] bg-[#f8fafc] px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#44474e]">
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
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {summaryItems.map((item) => (
            <div
              key={item.label}
              className="rounded-[0.3rem] border border-[#e6ecf3] bg-[#f8fafc] px-3.5 py-3"
            >
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#74777f]">
                {item.label}
              </p>
              <p className="mt-2 break-words font-display text-[1.2rem] font-bold leading-[1.12] tracking-[-0.02em] text-[#000a1e]">
                {item.value}
              </p>
              <p className="mt-1 text-xs leading-5 text-[#74777f]">{item.note}</p>
            </div>
          ))}
        </div>
      </motion.section>

      <motion.section
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: 'easeOut', delay: 0.04 }}
        className={panelClass}
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
              {hasQueuedSaveForReport ? (
                <span className="rounded-[0.25rem] border border-[#edd9b0] bg-[#fcf5e8] px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#8a5a00]">
                  Offline save queued
                </span>
              ) : null}
            </div>

            <p className={cn('text-sm', formErrorMessage ? 'text-[#ba1a1a]' : 'text-[#5b6169]')}>
              {formErrorMessage ?? autosaveStatusLabel}
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
            <Button
              variant="secondary"
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

      {hasQualitySignals ? (
        <motion.section
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, ease: 'easeOut', delay: 0.06 }}
          className={panelClass}
        >
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-[#8a5a00]" />
              <h2 className="font-display text-xs font-bold uppercase tracking-[0.16em] text-[#44474e]">
                Data quality checks
              </h2>
            </div>
            {qualityErrors.length > 0 ? (
              <ul className="space-y-2">
                {qualityErrors.map((issue) => (
                  <li
                    key={issue.key}
                    className="flex items-start gap-2 rounded-[0.3rem] border border-[#f4cfcf] bg-[#fdecec] px-3.5 py-2.5 text-sm text-[#ba1a1a]"
                  >
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>{issue.message}</span>
                  </li>
                ))}
              </ul>
            ) : null}
            {qualityWarnings.length > 0 ? (
              <ul className="space-y-2">
                {qualityWarnings.map((issue) => (
                  <li
                    key={issue.key}
                    className="flex items-start gap-2 rounded-[0.3rem] border border-[#edd9b0] bg-[#fcf5e8] px-3.5 py-2.5 text-sm text-[#8a5a00]"
                  >
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>{issue.message}</span>
                  </li>
                ))}
              </ul>
            ) : null}
            <p className="text-xs text-[#74777f]">
              Warnings are advisory — you can still submit. Errors must be corrected before the report is accepted.
            </p>
          </div>
        </motion.section>
      ) : null}

      <form className="space-y-6" onSubmit={submitReport}>
        <div className="xl:hidden">
          <div className="rounded-[0.35rem] border border-[#e6ecf3] bg-[#f8fafc] p-3 shadow-[0_18px_30px_-28px_rgba(0,33,71,0.22)]">
            <div className="flex items-center justify-between gap-3">
              <Button
                type="button"
                variant="secondary"
                size="icon"
                className="h-12 w-12 shrink-0"
                onClick={() => goToMobileDay(-1)}
                disabled={activeMobileDayIndex === 0}
                aria-label="Previous day"
              >
                <ChevronLeft className="h-5 w-5" />
              </Button>
              <div className="min-w-0 text-center">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#74777f]">
                  Day {mobileDayProgressLabel}
                </p>
                <p className="mt-1 font-display text-[1.35rem] font-bold leading-tight text-[#000a1e]">
                  {weekdayLabels[activeMobileDay]}
                </p>
              </div>
              <Button
                type="button"
                variant="secondary"
                size="icon"
                className="h-12 w-12 shrink-0"
                onClick={() => goToMobileDay(1)}
                disabled={activeMobileDayIndex >= template.activeDays.length - 1}
                aria-label="Next day"
              >
                <ChevronRight className="h-5 w-5" />
              </Button>
            </div>

            <div
              className="mt-3 grid gap-2"
              style={{ gridTemplateColumns: `repeat(${template.activeDays.length}, minmax(0, 1fr))` }}
            >
              {template.activeDays.map((day) => (
                <button
                  key={day}
                  type="button"
                  onClick={() => setMobileActiveDay(day)}
                  className={cn(
                    'h-11 rounded-[0.25rem] border px-1 text-xs font-bold uppercase tracking-[0.08em] transition-colors',
                    day === activeMobileDay
                      ? 'border-[#005db6] bg-[#edf4fb] text-[#005db6]'
                      : 'border-[#d4dde8] bg-white text-[#5b6169]',
                  )}
                  aria-current={day === activeMobileDay ? 'date' : undefined}
                >
                  {day.slice(0, 3)}
                </button>
              ))}
            </div>
          </div>
        </div>

        {template.sections.map((section) => {
          const sectionFields = template.fields.filter(
            (field) => field.sectionId === section.id,
          )

          return (
            <motion.section
              key={section.id}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, ease: 'easeOut' }}
              className={panelClass}
            >
              <div className="space-y-5">
                <div className="border-b border-[#eef2f6] pb-5">
                  <SectionEyebrow label="Section" />
                  <h2 className="mt-1.5 font-display text-[1.4rem] font-bold leading-tight tracking-[-0.02em] text-[#000a1e] md:text-[1.6rem]">
                    {section.title}
                  </h2>
                  {section.description ? (
                    <p className="mt-1.5 max-w-2xl text-sm leading-6 text-[#74777f]">{section.description}</p>
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
                              className="grid items-start gap-3 rounded-[0.35rem] border border-[#e6ecf3] bg-[#f8fafc] p-4"
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
                                  ariaLabel={`${field.label} — ${day}`}
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
                              <div className="rounded-[0.25rem] bg-white px-3 py-3 text-center text-sm font-semibold text-[#1d3047] outline outline-1 outline-[#d9e0e7]/75">
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

                <div className="xl:hidden">
                  <div className="space-y-3">
                    {sectionFields.map((field) => {
                      const fieldValues = form.watch(`values.${field.id}` as const) ?? {}
                      const fieldErrors =
                        (form.formState.errors.values?.[field.id] as
                          | Partial<Record<Weekday, { message?: unknown }>>
                          | undefined) ?? {}
                      const activeDayError = fieldErrors[activeMobileDay]?.message
                      const activeDayErrorMessage =
                        typeof activeDayError === 'string' && activeDayError.trim().length
                          ? activeDayError
                          : null
                      const mobileInputId = `mobile-${section.id}-${field.id}-${activeMobileDay}`

                      return (
                        <div
                          key={field.id}
                          className="rounded-[0.35rem] border border-[#e6ecf3] bg-[#f8fafc] p-3"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <Label
                                htmlFor={mobileInputId}
                                className="block text-sm font-semibold leading-5 text-[#000a1e]"
                              >
                                {field.label}
                              </Label>
                              <p
                                className={cn(
                                  'mt-1 text-xs leading-5',
                                  activeDayErrorMessage ? 'text-[#ba1a1a]' : 'text-[#74777f]',
                                )}
                              >
                                {activeDayErrorMessage ??
                                  (field.unit
                                    ? `${weekdayLabels[activeMobileDay]} - ${field.unit}`
                                    : `${weekdayLabels[activeMobileDay]} entry`)}
                              </p>
                            </div>
                            <div className="w-[6.2rem] shrink-0 rounded-[0.25rem] border border-[#d9e0e7] bg-white px-2.5 py-2 text-right">
                              <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#74777f]">
                                Week
                              </p>
                              <p className="mt-1 truncate text-sm font-bold text-[#1d3047]">
                                {renderComputedValue(field, fieldValues, template, watchedValues ?? {})}
                              </p>
                            </div>
                          </div>

                          <FieldInput
                            id={mobileInputId}
                            field={field}
                            value={fieldValues[activeMobileDay] ?? ''}
                            onChange={(nextValue) =>
                              form.setValue(
                                `values.${field.id}.${activeMobileDay}` as const,
                                normalizeFieldInput(field, nextValue),
                                {
                                  shouldDirty: true,
                                  shouldValidate: true,
                                },
                              )
                            }
                            disabled={!canEdit}
                            invalid={Boolean(activeDayErrorMessage)}
                            className={cn(
                              'mt-3 min-h-14 px-4 text-base font-semibold',
                              field.kind !== 'text' && 'text-center text-lg',
                              field.kind === 'text' && 'min-h-24 py-3 leading-6',
                            )}
                          />
                        </div>
                      )
                    })}
                  </div>
                </div>
              </div>
            </motion.section>
          )
        })}

        <div className="sticky bottom-[calc(env(safe-area-inset-bottom)+4.5rem)] z-20 rounded-[0.35rem] border border-[#e6ecf3] bg-[#f8fafc] p-4 shadow-[0_18px_30px_-24px_rgba(0,33,71,0.24)] sm:bottom-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-semibold text-[#000a1e]">
                {hasQueuedSaveForReport
                  ? 'Offline changes queued'
                  : form.formState.isDirty
                    ? 'Unsaved changes present'
                    : 'All changes saved'}
              </p>
              <p className="text-sm text-[#5b6169]">
                {formErrorMessage ??
                  (hasQueuedSaveForReport
                    ? 'This report will sync automatically when the connection returns.'
                    : 'Weekly totals calculate automatically and remain read-only.')}
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
  const { isSyncing, isDataRefreshing } = useAppSync()
  const assignment = appData.state.assignments.find((entry) => entry.id === assignmentId)
  const period = appData.state.reportingPeriods.find((entry) => entry.id === periodId)
  const isRouteDataLoading =
    appData.isBootstrapping || isDataRefreshing || isSyncing

  if (!assignmentId || !periodId) {
    return (
      <ReportStatePanel
        title="Missing report parameters"
        description="This report page needs both an assignment ID and a reporting period ID before it can load data."
        detail="Open the report again from the submission board or notification link."
      />
    )
  }

  if (!appData.currentUser && isRouteDataLoading) {
    return (
      <ReportStatePanel
        title="Loading session"
        description="Restoring your account before loading the selected weekly report."
      />
    )
  }

  if (!appData.currentUser) {
    return (
      <ReportStatePanel
        title="Session unavailable"
        description="The report cannot load because no signed-in user session is available."
        detail={appData.error}
      />
    )
  }

  if (
    (!assignment ||
      !period ||
      !appData.state.assignments.length ||
      !appData.state.reportingPeriods.length) &&
    isRouteDataLoading
  ) {
    return (
      <ReportStatePanel
        title="Loading report"
        description="Restoring the selected assignment and reporting period."
      />
    )
  }

  if (appData.error && (!assignment || !period)) {
    return (
      <ReportStatePanel
        title="Unable to load report"
        description="The report lookup failed while loading assignment or period data."
        detail={appData.error}
      />
    )
  }

  if (!assignment || !period) {
    return (
      <ReportStatePanel
        title="Report not available"
        description="This report assignment could not be found for the selected reporting period."
        detail={
          appData.currentUser.role === 'nurse'
            ? 'The report may belong to another nurse or an assignment that is no longer active.'
            : 'The assignment or reporting period may have been removed, or the link may be stale.'
        }
      />
    )
  }

  return (
    <ResolvedReportForm
      {...appData}
      currentUser={appData.currentUser}
      assignment={assignment}
      period={period}
      isDataRefreshing={isDataRefreshing}
      isSyncing={isSyncing}
    />
  )
}
