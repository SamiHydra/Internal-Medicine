import { zodResolver } from '@hookform/resolvers/zod'
import { CalendarClock, ClipboardCheck, GraduationCap, Send } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import {
  Controller,
  useForm,
  useWatch,
  type Control,
  type FieldPath,
  type FieldValues,
} from 'react-hook-form'
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
import { useAppData } from '@/context/app-data-context'
import {
  fetchAcademicFormOptions,
  fetchMySubmissions,
  submitConsultantEvaluation,
  submitResidentEvaluation,
} from '@/lib/api/academic'
import { getApiBrowserClient, type LaravelApiClient } from '@/lib/api/client'
import { apiEnvSetupHint } from '@/lib/api/env'
import type {
  AcademicEvaluationRecord,
  AcademicFormOptions,
  AcademicMySubmissions,
  SaveConsultantEvaluationPayload,
  SaveResidentEvaluationPayload,
} from '@/lib/api/types'
import { cn } from '@/lib/utils'

// --- option metadata (must mirror the backend allowed-value lists) -----------

const MDT_PARTICIPANT_OPTIONS = [
  { value: 'consultant', label: 'Consultant' },
  { value: 'fellow', label: 'Fellow' },
  { value: 'internist', label: 'Internist' },
  { value: 'residents', label: 'Residents' },
  { value: 'interns', label: 'Interns' },
  { value: 'nurse', label: 'Nurse' },
  { value: 'clinical_pharmacy', label: 'Clinical pharmacy' },
] as const

const SYSTEM_ISSUE_OPTIONS = [
  { value: 'lab_delay', label: 'Lab delay' },
  { value: 'imaging_delay', label: 'Imaging delay' },
  { value: 'staff_shortage', label: 'Staff shortage' },
  { value: 'bed_issue', label: 'Bed issue' },
  { value: 'emr_interruption', label: 'EMR interruption' },
  { value: 'communication_issue', label: 'Communication issue' },
] as const

const CONCERN_OPTIONS = [
  { value: 'punctuality', label: 'Punctuality' },
  { value: 'preparation', label: 'Preparation' },
  { value: 'medical_knowledge', label: 'Medical knowledge' },
  { value: 'clinical_reasoning', label: 'Clinical reasoning' },
  { value: 'documentation', label: 'Documentation' },
  { value: 'communication', label: 'Communication' },
  { value: 'professionalism', label: 'Professionalism' },
  { value: 'follow_through', label: 'Follow-through' },
  { value: 'time_management', label: 'Time management' },
] as const

const OVERALL_RATING_OPTIONS = [
  { value: '1', label: '1 · Well below expectations' },
  { value: '2', label: '2 · Below expectations' },
  { value: '3', label: '3 · Meets expectations' },
  { value: '4', label: '4 · Above expectations' },
  { value: '5', label: '5 · Excellent' },
]

// --- schemas -----------------------------------------------------------------

const consultantSchema = z
  .object({
    evaluationDate: z.string().min(1, 'Select the evaluation date.'),
    wardId: z.string().min(1, 'Select a ward.'),
    subjectId: z.string().min(1, 'Select the consultant being evaluated.'),
    seniorPresent: z.boolean(),
    seniorJoinedAt: z.string(),
    presenceMinutes: z.string(),
    allPatientsReviewed: z.boolean(),
    mgmtPlanDocumented: z.boolean(),
    vteAssessed: z.boolean(),
    dischargeDiscussed: z.boolean(),
    medReviewDone: z.boolean(),
    criticalLabsReviewed: z.boolean(),
    pctPatientsSeen: z.string(),
    roundDelayed: z.boolean(),
    mdtParticipants: z.array(z.string()),
    systemIssues: z.array(z.string()),
    comment: z.string().max(2000, 'Keep the comment under 2000 characters.'),
  })
  .superRefine((data, ctx) => {
    if (data.presenceMinutes !== '') {
      const minutes = Number(data.presenceMinutes)
      if (!Number.isFinite(minutes) || minutes < 0 || minutes > 600) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['presenceMinutes'],
          message: 'Enter minutes between 0 and 600.',
        })
      }
    }
    if (data.pctPatientsSeen !== '') {
      const pct = Number(data.pctPatientsSeen)
      if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['pctPatientsSeen'],
          message: 'Enter a percentage between 0 and 100.',
        })
      }
    }
  })

const residentSchema = z.object({
  evaluationDate: z.string().min(1, 'Select the evaluation date.'),
  wardId: z.string().min(1, 'Select a ward.'),
  subjectId: z.string().min(1, 'Select the resident being evaluated.'),
  onTime: z.boolean(),
  prepared: z.boolean(),
  presentationClear: z.boolean(),
  clinicalReasoning: z.boolean(),
  managementPlan: z.boolean(),
  documentationTimely: z.boolean(),
  communication: z.boolean(),
  professional: z.boolean(),
  responsiveFeedback: z.boolean(),
  followThrough: z.boolean(),
  overallRating: z.string().min(1, 'Select an overall rating.'),
  concerns: z.array(z.string()),
  comment: z.string().max(2000, 'Keep the comment under 2000 characters.'),
})

type ConsultantFormValues = z.infer<typeof consultantSchema>
type ResidentFormValues = z.infer<typeof residentSchema>

const consultantDefaults: ConsultantFormValues = {
  evaluationDate: '',
  wardId: '',
  subjectId: '',
  seniorPresent: false,
  seniorJoinedAt: '',
  presenceMinutes: '',
  allPatientsReviewed: false,
  mgmtPlanDocumented: false,
  vteAssessed: false,
  dischargeDiscussed: false,
  medReviewDone: false,
  criticalLabsReviewed: false,
  pctPatientsSeen: '',
  roundDelayed: false,
  mdtParticipants: [],
  systemIssues: [],
  comment: '',
}

const residentDefaults: ResidentFormValues = {
  evaluationDate: '',
  wardId: '',
  subjectId: '',
  onTime: false,
  prepared: false,
  presentationClear: false,
  clinicalReasoning: false,
  managementPlan: false,
  documentationTimely: false,
  communication: false,
  professional: false,
  responsiveFeedback: false,
  followThrough: false,
  overallRating: '',
  concerns: [],
  comment: '',
}

const CONSULTANT_SCORE_ITEMS: { name: FieldPath<ConsultantFormValues>; label: string }[] = [
  { name: 'allPatientsReviewed', label: 'All patients reviewed' },
  { name: 'mgmtPlanDocumented', label: 'Management plan documented' },
  { name: 'vteAssessed', label: 'VTE risk assessed' },
  { name: 'dischargeDiscussed', label: 'Discharge discussed' },
  { name: 'medReviewDone', label: 'Medication review done' },
  { name: 'criticalLabsReviewed', label: 'Critical labs reviewed' },
]

const RESIDENT_COMPETENCIES: {
  group: string
  items: { name: FieldPath<ResidentFormValues>; label: string }[]
}[] = [
  {
    group: 'Attendance & professionalism',
    items: [
      { name: 'onTime', label: 'Present & on time' },
      { name: 'professional', label: 'Professional conduct' },
    ],
  },
  {
    group: 'Preparation & patient care',
    items: [
      { name: 'prepared', label: 'Knew patients; list & overnight events updated' },
      { name: 'managementPlan', label: 'Appropriate, prioritized plan' },
    ],
  },
  {
    group: 'Medical knowledge',
    items: [{ name: 'clinicalReasoning', label: 'Sound assessment & differential' }],
  },
  {
    group: 'Communication',
    items: [
      { name: 'presentationClear', label: 'Case presentation clear & concise' },
      { name: 'communication', label: 'Effective with team / nursing / patient' },
    ],
  },
  {
    group: 'Documentation & systems',
    items: [
      { name: 'documentationTimely', label: 'Notes & orders complete and timely' },
      { name: 'followThrough', label: 'Completed tasks; chased results & referrals' },
    ],
  },
  {
    group: 'Practice-based learning',
    items: [{ name: 'responsiveFeedback', label: 'Receptive to feedback & teaching' }],
  },
]

// --- shared styling ----------------------------------------------------------

const panelClass = 'rounded-[0.35rem] bg-[#eef2f6] px-5 py-6 md:px-6'
const eyebrowClass = 'text-[11px] font-semibold uppercase tracking-[0.22em] text-[#005db6]'
const labelClass = 'text-[11px] font-bold uppercase tracking-[0.14em] text-[#000a1e]'
const fieldInputClass = 'bg-[#ffffff] shadow-none'

function getMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback
}

function toDateLabel(value: string | null) {
  if (!value) {
    return '—'
  }
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString()
}

// --- generic, type-safe field components -------------------------------------

function FieldShell({
  label,
  htmlFor,
  hint,
  error,
  children,
}: {
  label: string
  htmlFor?: string
  hint?: string
  error?: string
  children: ReactNode
}) {
  return (
    <div className="space-y-2">
      <label htmlFor={htmlFor} className={labelClass}>
        {label}
      </label>
      {children}
      {hint && !error ? <p className="text-xs text-[#74777f]">{hint}</p> : null}
      {error ? <p className="text-sm text-[#ba1a1a]">{error}</p> : null}
    </div>
  )
}

function ToggleItem({
  label,
  checked,
  onCheckedChange,
}: {
  label: string
  checked: boolean
  onCheckedChange: (value: boolean) => void
}) {
  return (
    <label
      className={cn(
        'flex cursor-pointer items-center justify-between gap-4 rounded-[0.25rem] border bg-white px-4 py-3 transition',
        checked ? 'border-[#005db6] bg-[#eef5ff]' : 'border-[#d4dde8] hover:bg-[#f6f8fa]',
      )}
    >
      <span className="text-sm font-medium text-[#000a1e]">{label}</span>
      <Switch checked={checked} onCheckedChange={onCheckedChange} />
    </label>
  )
}

function BooleanField<T extends FieldValues>({
  control,
  name,
  label,
}: {
  control: Control<T>
  name: FieldPath<T>
  label: string
}) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field }) => (
        <ToggleItem
          label={label}
          checked={Boolean(field.value)}
          onCheckedChange={field.onChange}
        />
      )}
    />
  )
}

function MultiSelectField<T extends FieldValues>({
  control,
  name,
  options,
}: {
  control: Control<T>
  name: FieldPath<T>
  options: ReadonlyArray<{ value: string; label: string }>
}) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field }) => {
        const selected: string[] = Array.isArray(field.value) ? field.value : []
        return (
          <div className="grid gap-2.5 sm:grid-cols-2">
            {options.map((option) => {
              const checked = selected.includes(option.value)
              return (
                <label
                  key={option.value}
                  className={cn(
                    'flex cursor-pointer items-center gap-3 rounded-[0.25rem] border bg-white px-3.5 py-3 transition',
                    checked
                      ? 'border-[#005db6] bg-[#eef5ff]'
                      : 'border-[#d4dde8] hover:bg-[#f6f8fa]',
                  )}
                >
                  <Checkbox
                    checked={checked}
                    onCheckedChange={(state) =>
                      field.onChange(
                        state === true
                          ? [...selected, option.value]
                          : selected.filter((value) => value !== option.value),
                      )
                    }
                  />
                  <span className="text-sm font-medium text-[#000a1e]">{option.label}</span>
                </label>
              )
            })}
          </div>
        )
      }}
    />
  )
}

function PickerField<T extends FieldValues>({
  control,
  name,
  placeholder,
  options,
  disabled,
}: {
  control: Control<T>
  name: FieldPath<T>
  placeholder: string
  options: ReadonlyArray<{ value: string; label: string }>
  disabled?: boolean
}) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field }) => (
        <Select
          value={(field.value as string) || ''}
          onValueChange={field.onChange}
          disabled={disabled}
        >
          <SelectTrigger className={fieldInputClass}>
            <SelectValue placeholder={placeholder} />
          </SelectTrigger>
          <SelectContent className="border-[#d4dde8] bg-[#ffffff] shadow-[0_16px_30px_rgba(0,33,71,0.08)]">
            {options.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    />
  )
}

function SectionPanel({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string
  title: string
  description?: string
  children: ReactNode
}) {
  return (
    <section className={panelClass}>
      <div className="space-y-1.5">
        <p className={eyebrowClass}>{eyebrow}</p>
        <h2 className="font-display text-[1.4rem] leading-tight tracking-[-0.02em] text-[#000a1e]">
          {title}
        </h2>
        {description ? <p className="text-sm leading-6 text-[#5b6169]">{description}</p> : null}
      </div>
      <div className="mt-5">{children}</div>
    </section>
  )
}

// --- forms -------------------------------------------------------------------

const todayString = new Date().toISOString().slice(0, 10)

function ConsultantEvaluationForm({
  client,
  options,
  onSubmitted,
}: {
  client: LaravelApiClient
  options: AcademicFormOptions
  onSubmitted: () => void
}) {
  const form = useForm<ConsultantFormValues>({
    resolver: zodResolver(consultantSchema),
    defaultValues: consultantDefaults,
  })
  const errors = form.formState.errors

  const subjectId = useWatch({ control: form.control, name: 'subjectId' })
  useEffect(() => {
    if (!subjectId) {
      return
    }
    const subject = options.subjects.find((entry) => entry.id === subjectId)
    if (subject?.homeWardId && !form.getValues('wardId')) {
      form.setValue('wardId', subject.homeWardId, { shouldValidate: true })
    }
  }, [subjectId, options.subjects, form])

  const subjectOptions = options.subjects.map((subject) => ({
    value: subject.id,
    label: subject.homeWardName ? `${subject.fullName} · ${subject.homeWardName}` : subject.fullName,
  }))
  const wardOptions = options.wards.map((ward) => ({ value: ward.id, label: ward.name }))

  const onSubmit = form.handleSubmit(async (values) => {
    const payload: SaveConsultantEvaluationPayload = {
      evaluationDate: values.evaluationDate,
      wardId: values.wardId,
      subjectId: values.subjectId,
      seniorPresent: values.seniorPresent,
      seniorJoinedAt: values.seniorJoinedAt || null,
      presenceMinutes: values.presenceMinutes === '' ? null : Number(values.presenceMinutes),
      allPatientsReviewed: values.allPatientsReviewed,
      mgmtPlanDocumented: values.mgmtPlanDocumented,
      vteAssessed: values.vteAssessed,
      dischargeDiscussed: values.dischargeDiscussed,
      medReviewDone: values.medReviewDone,
      criticalLabsReviewed: values.criticalLabsReviewed,
      pctPatientsSeen: values.pctPatientsSeen === '' ? null : Number(values.pctPatientsSeen),
      roundDelayed: values.roundDelayed,
      mdtParticipants: values.mdtParticipants,
      systemIssues: values.systemIssues,
      comment: values.comment.trim() ? values.comment.trim() : null,
    }

    try {
      await submitConsultantEvaluation(client, payload)
      toast.success('Consultant evaluation submitted.')
      form.reset(consultantDefaults)
      onSubmitted()
    } catch (error) {
      toast.error(getMessage(error, 'Unable to submit the evaluation.'))
    }
  })

  return (
    <form className="space-y-8" onSubmit={onSubmit}>
      <SectionPanel
        eyebrow="Round details"
        title="When and where"
        description="Log the MDT round you attended and the senior who led it."
      >
        <div className="grid gap-5 md:grid-cols-2">
          <FieldShell label="Evaluation date" htmlFor="evaluationDate" error={errors.evaluationDate?.message}>
            <Input
              id="evaluationDate"
              type="date"
              max={todayString}
              className={fieldInputClass}
              {...form.register('evaluationDate')}
            />
          </FieldShell>
          <FieldShell label="Ward" error={errors.wardId?.message}>
            <PickerField control={form.control} name="wardId" placeholder="Select ward" options={wardOptions} />
          </FieldShell>
          <FieldShell label="Consultant evaluated" error={errors.subjectId?.message}>
            <PickerField
              control={form.control}
              name="subjectId"
              placeholder="Select consultant"
              options={subjectOptions}
            />
          </FieldShell>
          <FieldShell label="Senior joined at" htmlFor="seniorJoinedAt" hint="Optional · HH:MM">
            <Input
              id="seniorJoinedAt"
              type="time"
              className={fieldInputClass}
              {...form.register('seniorJoinedAt')}
            />
          </FieldShell>
          <FieldShell label="Presence (minutes)" htmlFor="presenceMinutes" hint="Optional · 0–600" error={errors.presenceMinutes?.message}>
            <Input
              id="presenceMinutes"
              type="number"
              min={0}
              max={600}
              className={fieldInputClass}
              {...form.register('presenceMinutes')}
            />
          </FieldShell>
          <FieldShell label="Patients seen (%)" htmlFor="pctPatientsSeen" hint="Optional · 0–100" error={errors.pctPatientsSeen?.message}>
            <Input
              id="pctPatientsSeen"
              type="number"
              min={0}
              max={100}
              className={fieldInputClass}
              {...form.register('pctPatientsSeen')}
            />
          </FieldShell>
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <BooleanField control={form.control} name="seniorPresent" label="Senior present" />
          <BooleanField control={form.control} name="roundDelayed" label="Round delayed" />
        </div>
      </SectionPanel>

      <SectionPanel
        eyebrow="Round quality"
        title="Quality indicators"
        description="Each item marked yes contributes to the round-quality score."
      >
        <div className="grid gap-3 sm:grid-cols-2">
          {CONSULTANT_SCORE_ITEMS.map((item) => (
            <BooleanField key={item.name} control={form.control} name={item.name} label={item.label} />
          ))}
        </div>
      </SectionPanel>

      <SectionPanel
        eyebrow="MDT participants"
        title="Who joined the round"
        description="Select everyone who participated in the multidisciplinary round."
      >
        <MultiSelectField control={form.control} name="mdtParticipants" options={MDT_PARTICIPANT_OPTIONS} />
      </SectionPanel>

      <SectionPanel
        eyebrow="System issues"
        title="Friction encountered"
        description="Flag any system-level issues that affected the round."
      >
        <MultiSelectField control={form.control} name="systemIssues" options={SYSTEM_ISSUE_OPTIONS} />
      </SectionPanel>

      <SectionPanel eyebrow="Notes" title="Additional comment">
        <FieldShell label="Comment" htmlFor="comment" hint="Optional" error={errors.comment?.message}>
          <Textarea
            id="comment"
            className={cn('min-h-28 rounded-[0.25rem]', fieldInputClass)}
            placeholder="Anything else the reviewers should know."
            {...form.register('comment')}
          />
        </FieldShell>
      </SectionPanel>

      <div className="flex justify-end">
        <Button type="submit" disabled={form.formState.isSubmitting} className="gap-2">
          {form.formState.isSubmitting ? 'Submitting…' : 'Submit evaluation'}
          <Send className="h-4 w-4" />
        </Button>
      </div>
    </form>
  )
}

function ResidentEvaluationForm({
  client,
  options,
  onSubmitted,
}: {
  client: LaravelApiClient
  options: AcademicFormOptions
  onSubmitted: () => void
}) {
  const form = useForm<ResidentFormValues>({
    resolver: zodResolver(residentSchema),
    defaultValues: residentDefaults,
  })
  const errors = form.formState.errors

  const subjectId = useWatch({ control: form.control, name: 'subjectId' })
  useEffect(() => {
    if (!subjectId) {
      return
    }
    const subject = options.subjects.find((entry) => entry.id === subjectId)
    if (subject?.homeWardId && !form.getValues('wardId')) {
      form.setValue('wardId', subject.homeWardId, { shouldValidate: true })
    }
  }, [subjectId, options.subjects, form])

  const subjectOptions = options.subjects.map((subject) => ({
    value: subject.id,
    label: subject.homeWardName ? `${subject.fullName} · ${subject.homeWardName}` : subject.fullName,
  }))
  const wardOptions = options.wards.map((ward) => ({ value: ward.id, label: ward.name }))

  const onSubmit = form.handleSubmit(async (values) => {
    const payload: SaveResidentEvaluationPayload = {
      evaluationDate: values.evaluationDate,
      wardId: values.wardId,
      subjectId: values.subjectId,
      onTime: values.onTime,
      prepared: values.prepared,
      presentationClear: values.presentationClear,
      clinicalReasoning: values.clinicalReasoning,
      managementPlan: values.managementPlan,
      documentationTimely: values.documentationTimely,
      communication: values.communication,
      professional: values.professional,
      responsiveFeedback: values.responsiveFeedback,
      followThrough: values.followThrough,
      overallRating: Number(values.overallRating),
      concerns: values.concerns,
      comment: values.comment.trim() ? values.comment.trim() : null,
    }

    try {
      await submitResidentEvaluation(client, payload)
      toast.success('Resident evaluation submitted.')
      form.reset(residentDefaults)
      onSubmitted()
    } catch (error) {
      toast.error(getMessage(error, 'Unable to submit the evaluation.'))
    }
  })

  return (
    <form className="space-y-8" onSubmit={onSubmit}>
      <SectionPanel
        eyebrow="Round details"
        title="When and where"
        description="Log the round and the resident you are evaluating."
      >
        <div className="grid gap-5 md:grid-cols-3">
          <FieldShell label="Evaluation date" htmlFor="residentEvaluationDate" error={errors.evaluationDate?.message}>
            <Input
              id="residentEvaluationDate"
              type="date"
              max={todayString}
              className={fieldInputClass}
              {...form.register('evaluationDate')}
            />
          </FieldShell>
          <FieldShell label="Ward" error={errors.wardId?.message}>
            <PickerField control={form.control} name="wardId" placeholder="Select ward" options={wardOptions} />
          </FieldShell>
          <FieldShell label="Resident evaluated" error={errors.subjectId?.message}>
            <PickerField
              control={form.control}
              name="subjectId"
              placeholder="Select resident"
              options={subjectOptions}
            />
          </FieldShell>
        </div>
      </SectionPanel>

      <SectionPanel
        eyebrow="Performance"
        title="Met expectations this round"
        description="Each item marked yes contributes to the performance score."
      >
        <div className="space-y-6">
          {RESIDENT_COMPETENCIES.map((competency) => (
            <div key={competency.group} className="space-y-3">
              <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-[#74777f]">
                {competency.group}
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                {competency.items.map((item) => (
                  <BooleanField
                    key={item.name}
                    control={form.control}
                    name={item.name}
                    label={item.label}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      </SectionPanel>

      <SectionPanel eyebrow="Overall" title="Overall rating">
        <FieldShell label="Overall rating" error={errors.overallRating?.message}>
          <PickerField
            control={form.control}
            name="overallRating"
            placeholder="Select rating"
            options={OVERALL_RATING_OPTIONS}
          />
        </FieldShell>
      </SectionPanel>

      <SectionPanel
        eyebrow="Areas to improve"
        title="Concerns"
        description="Optional — flag any areas the resident should focus on."
      >
        <MultiSelectField control={form.control} name="concerns" options={CONCERN_OPTIONS} />
      </SectionPanel>

      <SectionPanel eyebrow="Notes" title="Additional comment">
        <FieldShell label="Comment" htmlFor="residentComment" hint="Optional" error={errors.comment?.message}>
          <Textarea
            id="residentComment"
            className={cn('min-h-28 rounded-[0.25rem]', fieldInputClass)}
            placeholder="Specific, constructive feedback for the resident."
            {...form.register('comment')}
          />
        </FieldShell>
      </SectionPanel>

      <div className="flex justify-end">
        <Button type="submit" disabled={form.formState.isSubmitting} className="gap-2">
          {form.formState.isSubmitting ? 'Submitting…' : 'Submit evaluation'}
          <Send className="h-4 w-4" />
        </Button>
      </div>
    </form>
  )
}

// --- recent submissions ------------------------------------------------------

function RecentSubmissions({ submissions }: { submissions: AcademicMySubmissions | null }) {
  if (!submissions || submissions.direction === null || submissions.data.length === 0) {
    return (
      <div className="rounded-[0.25rem] border border-dashed border-[#cbd5e1] bg-white px-5 py-8 text-center text-sm text-[#5b6169]">
        No submissions yet. Your filed evaluations will appear here.
      </div>
    )
  }

  // Collapse the discriminated-union array to its element union so .map() type-checks.
  const records: AcademicEvaluationRecord[] = submissions.data

  return (
    <div className="space-y-2.5">
      {records.slice(0, 6).map((record) => {
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
  )
}

// --- page --------------------------------------------------------------------

export function AcademicEvaluationFormPage() {
  const { currentUser } = useAppData()
  const client = getApiBrowserClient()
  const role = currentUser?.role
  const direction = role === 'consultant' ? 'resident' : 'consultant'

  const [options, setOptions] = useState<AcademicFormOptions | null>(null)
  const [submissions, setSubmissions] = useState<AcademicMySubmissions | null>(null)
  const [loadError, setLoadError] = useState<string | null>(() =>
    client ? null : `The Laravel API is not configured. ${apiEnvSetupHint}`,
  )
  const [isLoading, setIsLoading] = useState(() => Boolean(client))

  useEffect(() => {
    if (!client) {
      return
    }

    let active = true

    Promise.all([fetchAcademicFormOptions(client), fetchMySubmissions(client)])
      .then(([fetchedOptions, fetchedSubmissions]) => {
        if (!active) {
          return
        }
        setOptions(fetchedOptions)
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
  }, [client])

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

  const canSubmit = role === 'resident' || role === 'consultant'
  const heading = !canSubmit
    ? 'Academic evaluations'
    : direction === 'consultant'
      ? 'Evaluate a consultant'
      : 'Evaluate a resident'
  const description = !canSubmit
    ? 'Submit clinical evaluations after MDT rounds.'
    : direction === 'consultant'
      ? 'File your MDT daily round evaluation of the senior who led the round.'
      : 'File your performance evaluation of a resident after the round.'

  return (
    <div className="space-y-8">
      <section className={panelClass}>
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="space-y-2">
            <p className={eyebrowClass}>Academic</p>
            <h1 className="font-display text-[2rem] leading-[1.02] tracking-[-0.03em] text-[#000a1e] md:text-[2.35rem]">
              {heading}
            </h1>
            <p className="max-w-2xl text-sm leading-7 text-[#5b6169]">{description}</p>
          </div>
          <div className="flex h-12 w-12 items-center justify-center rounded-[0.35rem] bg-[#005db6] text-white">
            <GraduationCap className="h-6 w-6" />
          </div>
        </div>
      </section>

      {isLoading ? (
        <div className="rounded-[0.35rem] bg-[#eef2f6] px-5 py-12 text-center text-sm text-[#5b6169]">
          Loading the evaluation form…
        </div>
      ) : loadError ? (
        <div className="rounded-[0.35rem] border border-[#f1d1d1] bg-[#fff1f1] px-5 py-10 text-center text-sm font-medium text-[#b42318]">
          {loadError}
        </div>
      ) : !client || !options ? null : role !== 'resident' && role !== 'consultant' ? (
        <div className="rounded-[0.35rem] bg-[#eef2f6] px-5 py-10 text-center text-sm text-[#5b6169]">
          Only residents and consultants can submit academic evaluations.
        </div>
      ) : (
        <div className="grid gap-8 2xl:grid-cols-[minmax(0,1fr)_320px] 2xl:items-start">
          <div>
            {direction === 'consultant' ? (
              <ConsultantEvaluationForm
                client={client}
                options={options}
                onSubmitted={refreshSubmissions}
              />
            ) : (
              <ResidentEvaluationForm
                client={client}
                options={options}
                onSubmitted={refreshSubmissions}
              />
            )}
          </div>

          <aside className="space-y-4 2xl:sticky 2xl:top-6">
            <section className={panelClass}>
              <div className="flex items-center gap-2">
                <ClipboardCheck className="h-4 w-4 text-[#005db6]" />
                <p className={eyebrowClass}>My recent submissions</p>
              </div>
              <div className="mt-4">
                <RecentSubmissions submissions={submissions} />
              </div>
            </section>

            <section className={cn(panelClass, 'flex items-start gap-3')}>
              <CalendarClock className="mt-0.5 h-4 w-4 shrink-0 text-[#005db6]" />
              <p className="text-sm leading-6 text-[#5b6169]">
                Evaluations are submit-and-done. Reach out to an administrator if a correction is
                needed.
              </p>
            </section>
          </aside>
        </div>
      )}
    </div>
  )
}
