import { zodResolver } from '@hookform/resolvers/zod'
import { AnimatePresence, motion, useReducedMotion, type Variants } from 'framer-motion'
import {
  ArrowLeft,
  Building2,
  CheckCircle2,
  Eye,
  EyeOff,
  GraduationCap,
  LockKeyhole,
  Mail,
  Send,
  ShieldCheck,
  Stethoscope,
  UserRound,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { Controller, useForm, useWatch } from 'react-hook-form'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { z } from 'zod'

import stPaulosLogo from '@/assets/StPaulosLogoColor.jpg'
import { technicalSupport } from '@/config/support'
import { departments } from '@/config/templates'
import { useAppData } from '@/context/app-data-context'
import { submitAcademicRegistration } from '@/lib/api/academic'
import { getApiBrowserClient, isApiConfigured } from '@/lib/api/client'
import { apiEnvSetupHint } from '@/lib/api/env'
import { formatTimestamp } from '@/lib/dates'
import { cn, formatCompactNumber } from '@/lib/utils'

const requestSchema = z.object({
  fullName: z.string().trim().min(3, 'Enter your full name.'),
  email: z.string().trim().email('Enter a valid email address.'),
  password: z.string().optional(),
  confirmPassword: z.string().optional(),
  requestedDepartments: z.array(z.string()).min(1, 'Select at least one reporting assignment.'),
  notes: z.string().max(240, 'Keep the note under 240 characters.').optional(),
})

type RequestValues = z.infer<typeof requestSchema>

const academicSchema = z
  .object({
    fullName: z.string().trim().min(3, 'Enter your full name.'),
    email: z.string().trim().email('Enter a valid email address.'),
    password: z.string().optional(),
    confirmPassword: z.string().optional(),
    role: z.string().min(1, 'Choose Resident or Consultant.'),
    trainingYear: z.string().optional(),
    homeWard: z.string().optional(),
    notes: z.string().max(240, 'Keep the note under 240 characters.').optional(),
  })
  .superRefine((values, context) => {
    if (values.role === 'resident' && !values.trainingYear) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['trainingYear'],
        message: 'Select your current training year.',
      })
    }
  })

type AcademicValues = z.infer<typeof academicSchema>

const academicDefaults: AcademicValues = {
  fullName: '',
  email: '',
  password: '',
  confirmPassword: '',
  role: '',
  trainingYear: '',
  homeWard: '',
  notes: '',
}

const adminSchema = z.object({
  fullName: z.string().trim().min(3, 'Enter your full name.'),
  email: z.string().trim().email('Enter a valid email address.'),
  password: z.string().optional(),
  confirmPassword: z.string().optional(),
  notes: z.string().max(240, 'Keep the note under 240 characters.').optional(),
})

type AdminValues = z.infer<typeof adminSchema>

const adminDefaults: AdminValues = {
  fullName: '',
  email: '',
  password: '',
  confirmPassword: '',
  notes: '',
}

const familySections = [
  { key: 'inpatient', label: 'Inpatient services' },
  { key: 'outpatient', label: 'Outpatient services' },
  { key: 'procedure', label: 'Procedure services' },
] as const

const TRACKS = [
  { key: 'clinical' as const, label: 'Clinical', icon: Stethoscope },
  { key: 'academic' as const, label: 'Academic', icon: GraduationCap },
  { key: 'admin' as const, label: 'Admin', icon: ShieldCheck },
]

type Track = (typeof TRACKS)[number]['key']

const ACADEMIC_ROLES = [
  { value: 'resident' as const, title: 'Resident', description: 'Evaluate consultants.', icon: Stethoscope },
  { value: 'consultant' as const, title: 'Consultant', description: 'Evaluate residents.', icon: GraduationCap },
]

const panelClass =
  'relative overflow-hidden rounded-[0.5rem] bg-[linear-gradient(180deg,#ffffff_0%,#f2f5f8_100%)] p-5 shadow-[0_20px_40px_rgba(0,33,71,0.08)] outline outline-1 outline-[#c9d5e4]/30 md:p-6'
const inputClass =
  'h-12 w-full rounded-[4px] border border-transparent border-b-[#d4dde8] bg-[linear-gradient(180deg,#edf3fa_0%,#f7f9fb_100%)] px-4 text-sm text-[#191c1d] outline-none transition placeholder:text-[#9aa0a8] focus:border-[#005db6] focus:bg-[#fbfdff] disabled:cursor-not-allowed disabled:border-[#e1e3e4] disabled:bg-[#edeeef] disabled:text-[#666970]'
const iconInputClass = `${inputClass} pl-11 pr-11`
const labelClass = 'text-[11px] font-bold uppercase tracking-[0.18em] text-[#000a1e]'
const textareaClass =
  'w-full resize-none rounded-[4px] border border-transparent border-b-[#d4dde8] bg-[linear-gradient(180deg,#eef4fb_0%,#fbfdff_100%)] px-4 py-3 text-sm text-[#191c1d] outline-none transition placeholder:text-[#9aa0a8] focus:border-[#005db6] focus:bg-[#ffffff]'
const eyebrowClass = 'text-[11px] font-bold uppercase tracking-[0.18em] text-[#005db6]'
const sectionHeadingClass = 'text-[1.45rem] font-bold tracking-[-0.03em] text-[#000a1e]'

const sectionStagger: Variants = {
  show: { transition: { staggerChildren: 0.05, delayChildren: 0.03 } },
}
const sectionItem: Variants = {
  hidden: { opacity: 0, y: 6 },
  show: { opacity: 1, y: 0, transition: { duration: 0.18, ease: [0.23, 1, 0.32, 1] } },
}

function getStatusClass(status: string) {
  switch (status) {
    case 'approved':
      return 'border-[#cfe7d9] bg-[#edf7f0] text-[#1f6b3b]'
    case 'rejected':
      return 'border-[#f1d1d1] bg-[#fff1f1] text-[#9d2a2a]'
    default:
      return 'border-[#c9d7e8] bg-[#edf4fb] text-[#244261]'
  }
}

function TrackToggle({
  track,
  onChange,
  reduceMotion,
  variant = 'navy',
  idKey,
}: {
  track: Track
  onChange: (track: Track) => void
  reduceMotion: boolean
  variant?: 'navy' | 'light'
  idKey: string
}) {
  const onNavy = variant === 'navy'
  return (
    <div
      className={cn(
        'inline-flex items-center gap-1 rounded-[0.45rem] border p-1 backdrop-blur-sm',
        onNavy
          ? 'border-white/18 bg-white/10 shadow-[0_16px_34px_-22px_rgba(0,0,0,0.6)]'
          : 'border-[#c8d5e6] bg-white/80 shadow-[0_16px_34px_-22px_rgba(0,33,71,0.5)]',
      )}
    >
      {TRACKS.map((entry) => {
        const active = track === entry.key
        const Icon = entry.icon
        return (
          <button
            key={entry.key}
            type="button"
            onClick={() => onChange(entry.key)}
            aria-pressed={active}
            className={cn(
              'relative flex items-center gap-2 rounded-[0.35rem] px-6 py-2.5 text-[11px] font-bold uppercase tracking-[0.16em] transition-[color,transform] duration-150 ease-out active:scale-[0.97]',
              active
                ? 'text-white'
                : onNavy
                  ? 'text-[#9fb4d0] hover:text-white'
                  : 'text-[#5b6169] hover:text-[#000a1e]',
            )}
          >
            {active ? (
              <motion.span
                layoutId={idKey}
                className="absolute inset-0 rounded-[0.35rem] bg-[linear-gradient(180deg,#005db6_0%,#00468c_100%)] shadow-[0_12px_22px_-12px_rgba(0,93,182,0.85)]"
                transition={
                  reduceMotion ? { duration: 0 } : { type: 'spring', duration: 0.5, bounce: 0.2 }
                }
              />
            ) : null}
            <Icon className="relative z-10 h-4 w-4" />
            <span className="relative z-10">{entry.label}</span>
          </button>
        )
      })}
    </div>
  )
}

export function AccessRequestPage() {
  const { currentUser, state, submitAccessRequest, submitAdminAccessRequest, ensureAccessRequestData } =
    useAppData()
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const isNewAccountFlow = !currentUser
  const [track, setTrack] = useState<Track>('clinical')
  const reduceMotion = useReducedMotion() ?? false
  const showAcademic = isNewAccountFlow && track === 'academic'
  const showAdmin = isNewAccountFlow && track === 'admin'
  const backTarget = currentUser ? (currentUser.role === 'nurse' ? '/nurse' : '/admin') : '/login'
  const backLabel = currentUser ? 'Back to workspace' : 'Back to sign in'

  const groupedDepartments = {
    inpatient: departments.filter((department) => department.family === 'inpatient'),
    outpatient: departments.filter((department) => department.family === 'outpatient'),
    procedure: departments.filter((department) => department.family === 'procedure'),
  }

  const clinicalForm = useForm<RequestValues>({
    resolver: zodResolver(requestSchema),
    defaultValues: {
      fullName: currentUser?.fullName ?? '',
      email: currentUser?.email ?? '',
      password: '',
      confirmPassword: '',
      requestedDepartments: [],
      notes: '',
    },
  })
  const academicForm = useForm<AcademicValues>({
    resolver: zodResolver(academicSchema),
    defaultValues: academicDefaults,
  })
  const adminForm = useForm<AdminValues>({
    resolver: zodResolver(adminSchema),
    defaultValues: adminDefaults,
  })

  useEffect(() => {
    clinicalForm.reset({
      fullName: currentUser?.fullName ?? '',
      email: currentUser?.email ?? '',
      password: '',
      confirmPassword: '',
      requestedDepartments: [],
      notes: '',
    })
  }, [currentUser, clinicalForm])

  useEffect(() => {
    if (!currentUser) {
      return
    }
    void ensureAccessRequestData()
  }, [currentUser, ensureAccessRequestData])

  const currentUserRequests = currentUser
    ? [...state.accessRequests]
        .filter((request) => request.userId === currentUser.id)
        .sort((left, right) => right.requestedAt.localeCompare(left.requestedAt))
    : []

  const requestedDepartments = useWatch({
    control: clinicalForm.control,
    name: 'requestedDepartments',
    defaultValue: [],
  })
  const clinicalNotes =
    useWatch({ control: clinicalForm.control, name: 'notes', defaultValue: '' }) ?? ''
  const selectedDepartments = departments.filter((department) =>
    requestedDepartments.includes(department.id),
  )
  const selectedCount = selectedDepartments.length

  const role = useWatch({ control: academicForm.control, name: 'role', defaultValue: '' })
  const homeWard =
    useWatch({ control: academicForm.control, name: 'homeWard', defaultValue: '' }) ?? ''
  const academicNotes =
    useWatch({ control: academicForm.control, name: 'notes', defaultValue: '' }) ?? ''
  const wards = groupedDepartments.inpatient
  const selectedWard = wards.find((ward) => ward.id === homeWard)
  const selectedRole = ACADEMIC_ROLES.find((entry) => entry.value === role)

  const onSubmitClinical = clinicalForm.handleSubmit(async (values) => {
    setSuccessMessage(null)
    if (!currentUser) {
      if (!values.password || values.password.length < 8) {
        clinicalForm.setError('password', {
          message: 'Use at least 8 characters for the new account password.',
        })
        return
      }
      if (values.password !== values.confirmPassword) {
        clinicalForm.setError('confirmPassword', { message: 'Passwords must match.' })
        return
      }
    }

    const serverMessage = await submitAccessRequest({
      fullName: values.fullName,
      email: values.email,
      password: values.password,
      notes: values.notes,
      requestedAssignments: values.requestedDepartments.map((departmentId) => {
        const department = departments.find((entry) => entry.id === departmentId)!
        return { departmentId, templateId: department.templateId }
      }),
    })

    if (serverMessage === null) {
      return
    }

    // Prefer the server's copy: an anonymous submission for an address that
    // already has an account is discarded silently, and only that copy tells
    // the applicant to sign in instead of waiting for a review.
    setSuccessMessage(
      serverMessage ||
        (currentUser
          ? 'Additional access request submitted for review.'
          : 'Access request submitted. An administrator will review it before your account can sign in.'),
    )
    clinicalForm.reset({
      fullName: currentUser?.fullName ?? '',
      email: currentUser?.email ?? '',
      password: '',
      confirmPassword: '',
      requestedDepartments: [],
      notes: '',
    })
  })

  const onSubmitAcademic = academicForm.handleSubmit(async (values) => {
    setSuccessMessage(null)
    if (!values.role) {
      academicForm.setError('role', { message: 'Choose Resident or Consultant.' })
      return
    }
    if (!values.password || values.password.length < 8) {
      academicForm.setError('password', { message: 'Use at least 8 characters for your password.' })
      return
    }
    if (values.password !== values.confirmPassword) {
      academicForm.setError('confirmPassword', { message: 'Passwords must match.' })
      return
    }

    const client = getApiBrowserClient()
    if (!client || !isApiConfigured) {
      toast.error(`Laravel API is not configured. ${apiEnvSetupHint}`)
      return
    }

    try {
      const result = await submitAcademicRegistration(client, {
        fullName: values.fullName,
        email: values.email,
        password: values.password,
        role: values.role as 'resident' | 'consultant',
        trainingYear: values.role === 'resident' ? Number(values.trainingYear) : null,
        homeWardId: values.homeWard ? values.homeWard : null,
        notes: values.notes ? values.notes : null,
      })
      setSuccessMessage(
        result?.message ||
          'Academic enrollment request submitted. An administrator will review it before your account is created.',
      )
      academicForm.reset(academicDefaults)
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Unable to submit your enrollment request.',
      )
    }
  })

  const onSubmitAdmin = adminForm.handleSubmit(async (values) => {
    setSuccessMessage(null)
    if (!values.password || values.password.length < 8) {
      adminForm.setError('password', { message: 'Use at least 8 characters for your password.' })
      return
    }
    if (values.password !== values.confirmPassword) {
      adminForm.setError('confirmPassword', { message: 'Passwords must match.' })
      return
    }

    const serverMessage = await submitAdminAccessRequest({
      fullName: values.fullName,
      email: values.email,
      password: values.password,
      notes: values.notes ? values.notes : undefined,
    })

    if (serverMessage === null) {
      return
    }

    setSuccessMessage(
      serverMessage ||
        'Admin access request submitted. An administrator will review it before your account is created.',
    )
    adminForm.reset(adminDefaults)
  })

  const submitting = showAdmin
    ? adminForm.formState.isSubmitting
    : showAcademic
      ? academicForm.formState.isSubmitting
      : clinicalForm.formState.isSubmitting

  const valueSwap = {
    initial: reduceMotion ? false : { opacity: 0, y: 8 },
    animate: { opacity: 1, y: 0 },
    exit: reduceMotion ? { opacity: 0 } : { opacity: 0, y: -8 },
    transition: {
      duration: reduceMotion ? 0 : 0.2,
      ease: [0.23, 1, 0.32, 1] as [number, number, number, number],
    },
  }

  const renderSummary = () => (
    <div className="space-y-3.5">
      <div className="flex items-center gap-3">
        <span className="text-[11px] font-bold uppercase tracking-[0.2em] text-[#f0b429]">
          Review and submit
        </span>
        <span className="h-px flex-1 bg-white/10" />
      </div>

      <AnimatePresence mode="wait" initial={false}>
        {successMessage ? (
          <motion.div
            key="success"
            initial={reduceMotion ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -6 }}
            transition={{ duration: reduceMotion ? 0 : 0.2, ease: [0.23, 1, 0.32, 1] }}
            className="rounded-[0.35rem] border border-[#cfe7d9] bg-[#edf7f0] p-3.5"
          >
            <div className="flex items-start gap-2.5">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[#1f6b3b]" />
              <p className="text-[0.82rem] leading-5 text-[#1f6b3b]">{successMessage}</p>
            </div>
          </motion.div>
        ) : (
          <motion.div
            key="slab"
            initial={reduceMotion ? false : { opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -6 }}
            transition={{ duration: reduceMotion ? 0 : 0.2, ease: [0.23, 1, 0.32, 1] }}
            className="relative rounded-[0.35rem] border border-white/10 bg-white/[0.03] py-3.5 pl-4 pr-3.5"
          >
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0">
                <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#9fb4d0]">
                  {showAdmin ? 'Account type' : showAcademic ? 'Academic role' : 'Your selection'}
                </p>
                <div className="mt-1 flex items-baseline gap-2">
                  <AnimatePresence mode="popLayout" initial={false}>
                    {showAdmin ? (
                      <motion.span
                        key="admin"
                        {...valueSwap}
                        className="text-[1.15rem] font-bold leading-none tracking-[-0.01em] text-white"
                        style={{ fontFamily: 'Manrope, sans-serif' }}
                      >
                        Administrator
                      </motion.span>
                    ) : showAcademic ? (
                      <motion.span
                        key={selectedRole?.value ?? 'none'}
                        {...valueSwap}
                        className={cn(
                          'text-[1.15rem] font-bold leading-none tracking-[-0.01em]',
                          selectedRole ? 'text-white' : 'text-[#9fb4d0]',
                        )}
                        style={{ fontFamily: 'Manrope, sans-serif' }}
                      >
                        {selectedRole ? selectedRole.title : 'Not selected'}
                      </motion.span>
                    ) : (
                      <motion.span
                        key={selectedCount}
                        {...valueSwap}
                        className={cn(
                          'text-[1.5rem] font-extrabold leading-none tracking-[-0.02em]',
                          selectedCount ? 'text-white' : 'text-[#9fb4d0]',
                        )}
                        style={{ fontFamily: 'Manrope, sans-serif' }}
                      >
                        {formatCompactNumber(selectedCount)}
                      </motion.span>
                    )}
                  </AnimatePresence>
                  {showAcademic || showAdmin ? null : (
                    <span className="text-[0.82rem] font-medium text-[#c6d3e4]">
                      {selectedCount === 1 ? 'assignment' : 'assignments'}
                    </span>
                  )}
                </div>
                <p className="mt-1.5 truncate text-[0.78rem] leading-5 text-[#9fb4d0]">
                  {showAdmin ? (
                    <>
                      Pending approval
                      <span className="text-[#c6d3e4]"> · created after an admin reviews it</span>
                    </>
                  ) : showAcademic ? (
                    <>
                      Pending approval
                      <span className="text-[#c6d3e4]">
                        {' · created after an admin reviews it'}
                        {selectedWard ? ` · ${selectedWard.name}` : ''}
                      </span>
                    </>
                  ) : selectedCount ? (
                    <>
                      Department review
                      <span className="text-[#c6d3e4]">
                        {' · '}
                        {selectedDepartments
                          .slice(0, 2)
                          .map((department) => department.name)
                          .join(', ')}
                        {selectedCount > 2 ? ` +${selectedCount - 2}` : ''}
                      </span>
                    </>
                  ) : (
                    'Department review · choose at least one assignment'
                  )}
                </p>
              </div>
              <span className="shrink-0 rounded-[3px] bg-[#005db6] px-2 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-white">
                {showAdmin ? 'Admin' : showAcademic ? 'Academic' : 'Clinical'}
              </span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <button
        type="submit"
        form={
          showAdmin
            ? 'admin-enroll-form'
            : showAcademic
              ? 'academic-enroll-form'
              : 'clinical-request-form'
        }
        disabled={submitting || (!showAcademic && !showAdmin && selectedCount === 0)}
        className={cn(
          'auth-accent-button flex h-12 w-full items-center justify-center gap-2.5 rounded-[4px] px-6 text-[0.78rem] font-bold uppercase tracking-[0.1em] transition-[transform,opacity] duration-150 ease-out disabled:cursor-not-allowed disabled:opacity-60',
          reduceMotion ? '' : 'active:scale-[0.97]',
        )}
        style={{ fontFamily: 'Manrope, sans-serif' }}
      >
        {submitting
          ? 'Submitting...'
          : showAdmin
            ? 'Request admin access'
            : showAcademic
              ? 'Request academic account'
              : 'Submit access request'}
        <Send className="h-3.5 w-3.5" />
      </button>

      <p className="text-center text-xs leading-5 text-[#c6d3e4]">
        {isNewAccountFlow ? 'Existing system user? ' : 'Need to leave? '}
        <Link className="font-semibold text-[#63a1ff] hover:underline" to={backTarget}>
          {isNewAccountFlow ? 'Secure sign in' : 'Return to workspace'}
        </Link>
      </p>
    </div>
  )

  const headerEyebrow = showAdmin
    ? 'Admin enrollment'
    : showAcademic
      ? 'Academic enrollment'
      : isNewAccountFlow
        ? 'New access request'
        : 'Access extension'
  const headerTitle = showAdmin
    ? 'Request an admin account'
    : showAcademic
      ? 'Request an academic account'
      : isNewAccountFlow
        ? 'Request reporting access'
        : 'Request additional access'

  // The hero heading names the track being requested. "Request Access" used to
  // sit above it, which repeated the panel title on the right and the submit
  // button below, so the track name now stands on its own.
  const heroAccent = showAdmin
    ? 'Administration'
    : showAcademic
      ? 'Academic Review'
      : isNewAccountFlow
        ? 'Clinical Reporting'
        : 'Additional Reporting Access'

  return (
    <div className="relative min-h-screen overflow-x-clip bg-[#f8f9fa] px-3 py-3 sm:px-4 sm:py-4 md:px-5 md:py-5 xl:px-6 xl:py-6">
      <main className="relative mx-auto flex min-h-[calc(100vh-1.5rem)] max-w-[1460px] items-start">
        <div className="grid w-full rounded-[0.35rem] bg-[#04162f] shadow-[0_28px_60px_rgba(0,33,71,0.12)] outline outline-1 outline-[#c8d5e6]/30 md:grid-cols-[minmax(0,1fr)_minmax(520px,590px)] xl:grid-cols-[minmax(0,1.04fr)_minmax(560px,640px)]">
          {/* LEFT - navy hero; sticks while the form scrolls, holds the submit */}
          <section className="relative hidden overflow-hidden rounded-l-[0.35rem] bg-[#04162f] text-white md:sticky md:top-5 md:flex md:min-h-[calc(100vh-2.5rem)] md:flex-col md:self-start md:p-12 lg:p-14 xl:p-16">
            <div className="absolute inset-y-0 left-0 w-px bg-white/10" />
            <div className="absolute inset-y-0 right-0 w-px bg-white/8" />

            <div className="relative z-10 flex items-center justify-between gap-4">
              <div className="flex items-center gap-4">
                <div className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-[8px] bg-white shadow-[0_16px_30px_rgba(0,0,0,0.16)]">
                  <img src={stPaulosLogo} alt="St Paul's logo" className="h-full w-full object-cover" />
                </div>
                <div>
                  <p
                    className="text-[2.15rem] font-extrabold leading-none tracking-[-0.03em] text-white"
                    style={{ fontFamily: 'Manrope, sans-serif' }}
                  >
                    St Paul's
                  </p>
                  <p className="mt-1.5 text-[0.82rem] font-semibold uppercase tracking-[0.24em] text-[#f0b429]">
                    Internal Medicine
                  </p>
                </div>
              </div>
              <Link
                to={backTarget}
                className="group inline-flex min-h-[2.5rem] items-center gap-1.5 rounded-[0.4rem] border border-white/10 bg-white/[0.06] px-3.5 py-2.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#9fb4d0] transition-[transform,background-color,border-color,color] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] hover:border-white/20 hover:bg-white/[0.12] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30 focus-visible:ring-offset-2 focus-visible:ring-offset-[#04162f] motion-safe:active:scale-[0.97]"
              >
                <ArrowLeft className="h-3.5 w-3.5 transition-transform duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] motion-safe:group-hover:-translate-x-0.5" />
                {backLabel}
              </Link>
            </div>

            <motion.div
              initial={reduceMotion ? false : { opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, ease: [0.23, 1, 0.32, 1] }}
              className="relative z-10 mt-14 max-w-[31rem] space-y-10 md:mt-auto md:pt-14"
            >
              <div className="space-y-4">
                <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-[#f0b429]">
                  {isNewAccountFlow ? 'Platform enrollment' : 'Access extension'}
                </p>
                <p
                  className="text-[2.35rem] font-extrabold leading-[0.98] tracking-[-0.045em] text-white lg:text-[2.6rem] xl:text-[2.85rem]"
                  style={{ fontFamily: 'Manrope, sans-serif' }}
                >
                  {heroAccent}
                </p>
              </div>

              {isNewAccountFlow ? (
                <TrackToggle
                  track={track}
                  onChange={setTrack}
                  reduceMotion={reduceMotion}
                  variant="navy"
                  idKey="trackNavy"
                />
              ) : null}

              {renderSummary()}
            </motion.div>
          </section>

          {/* RIGHT - white scrolling form panel */}
          <section className="relative flex overflow-hidden rounded-[0.35rem] bg-white md:rounded-l-none">
            <div className="absolute inset-x-0 top-0 z-20 h-1 bg-[linear-gradient(90deg,#005db6_0%,#63a1ff_72%,#f0b429_100%)]" />
            <div
              className="w-full px-6 py-9 sm:px-10 md:px-12 md:py-10 lg:px-14 xl:px-16"
              style={{ fontFamily: 'Inter, sans-serif' }}
            >
              <div className="mx-auto w-full max-w-[34rem]">
                {/* mobile-only header (the navy panel is hidden below md) */}
                <div className="mb-8 md:hidden">
                  <div className="mb-6 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div className="flex h-11 w-11 items-center justify-center overflow-hidden rounded-[6px] bg-white shadow-[0_12px_24px_rgba(0,33,71,0.14)] ring-1 ring-[#d7dbe0]">
                        <img
                          src={stPaulosLogo}
                          alt="St Paul's logo"
                          className="h-full w-full object-cover"
                        />
                      </div>
                      <div>
                        <p
                          className="text-base font-extrabold leading-none tracking-[-0.03em] text-[#000a1e]"
                          style={{ fontFamily: 'Manrope, sans-serif' }}
                        >
                          St Paul's
                        </p>
                        <p className="mt-1 text-[0.6rem] font-semibold uppercase tracking-[0.22em] text-[#005db6]">
                          Internal Medicine
                        </p>
                      </div>
                    </div>
                    <Link
                      to={backTarget}
                      className="group inline-flex min-h-[2.5rem] items-center gap-1.5 rounded-[0.4rem] border border-[#d4dde8] bg-[#f1f5fa] px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#005db6] transition-[transform,background-color,border-color,color] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] hover:border-[#005db6]/40 hover:bg-[#e9eff7] hover:text-[#00468c] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#005db6]/30 motion-safe:active:scale-[0.97]"
                    >
                      <ArrowLeft className="h-3.5 w-3.5 transition-transform duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] motion-safe:group-hover:-translate-x-0.5" />
                      Back
                    </Link>
                  </div>
                  {isNewAccountFlow ? (
                    <TrackToggle
                      track={track}
                      onChange={setTrack}
                      reduceMotion={reduceMotion}
                      variant="light"
                      idKey="trackMobile"
                    />
                  ) : null}
                </div>

                <header className="mb-8">
                  <p className="mb-2.5 text-[11px] font-bold uppercase tracking-[0.18em] text-[#005db6]">
                    {headerEyebrow}
                  </p>
                  <h1
                    className="text-[2rem] font-extrabold tracking-[-0.035em] text-[#000a1e]"
                    style={{ fontFamily: 'Manrope, sans-serif' }}
                  >
                    {headerTitle}
                  </h1>
                </header>

                <AnimatePresence mode="wait" initial={false}>
                  {showAdmin ? (
                    <motion.div
                      key="admin"
                      initial={reduceMotion ? false : { opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -8 }}
                      transition={{ duration: 0.22, ease: [0.23, 1, 0.32, 1] }}
                    >
                      <form id="admin-enroll-form" onSubmit={onSubmitAdmin}>
                        <motion.div
                          initial={reduceMotion ? false : 'hidden'}
                          animate="show"
                          variants={sectionStagger}
                          className="space-y-7"
                        >
                          <motion.section variants={sectionItem} className={panelClass}>
                            <div className="absolute inset-x-0 top-0 h-1 bg-[#005db6]" />
                            <div className="space-y-6">
                              <div className="space-y-1.5">
                                <p className={eyebrowClass}>Profile details</p>
                                <h2
                                  className={sectionHeadingClass}
                                  style={{ fontFamily: 'Manrope, sans-serif' }}
                                >
                                  Account information
                                </h2>
                              </div>
                              <div className="grid gap-5 md:grid-cols-2">
                                <div className="space-y-2">
                                  <label className={labelClass} htmlFor="adminFullName">
                                    Full name
                                  </label>
                                  <div className="relative">
                                    <UserRound className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#666970]" />
                                    <input
                                      id="adminFullName"
                                      type="text"
                                      placeholder="e.g. Dr. Hana Abera"
                                      autoComplete="name"
                                      className={iconInputClass}
                                      {...adminForm.register('fullName')}
                                    />
                                  </div>
                                  {adminForm.formState.errors.fullName ? (
                                    <p className="text-sm text-[#ba1a1a]">
                                      {adminForm.formState.errors.fullName.message}
                                    </p>
                                  ) : null}
                                </div>
                                <div className="space-y-2">
                                  <label className={labelClass} htmlFor="adminEmail">
                                    Institutional email
                                  </label>
                                  <div className="relative">
                                    <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#666970]" />
                                    <input
                                      id="adminEmail"
                                      type="email"
                                      placeholder="name@stpaul.org"
                                      autoComplete="email"
                                      className={iconInputClass}
                                      {...adminForm.register('email')}
                                    />
                                  </div>
                                  {adminForm.formState.errors.email ? (
                                    <p className="text-sm text-[#ba1a1a]">
                                      {adminForm.formState.errors.email.message}
                                    </p>
                                  ) : null}
                                </div>
                              </div>
                              <div className="grid gap-5 md:grid-cols-2">
                                <div className="space-y-2">
                                  <label className={labelClass} htmlFor="adminPassword">
                                    Create password
                                  </label>
                                  <div className="relative">
                                    <LockKeyhole className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#666970]" />
                                    <input
                                      id="adminPassword"
                                      type={showPassword ? 'text' : 'password'}
                                      placeholder="8+ characters"
                                      autoComplete="new-password"
                                      className={iconInputClass}
                                      {...adminForm.register('password')}
                                    />
                                    <button
                                      type="button"
                                      className="absolute right-3 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center text-[#666970] transition hover:text-[#000a1e]"
                                      onClick={() => setShowPassword((current) => !current)}
                                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                                    >
                                      {showPassword ? (
                                        <EyeOff className="h-4 w-4" />
                                      ) : (
                                        <Eye className="h-4 w-4" />
                                      )}
                                    </button>
                                  </div>
                                  {adminForm.formState.errors.password ? (
                                    <p className="text-sm text-[#ba1a1a]">
                                      {adminForm.formState.errors.password.message}
                                    </p>
                                  ) : null}
                                </div>
                                <div className="space-y-2">
                                  <label className={labelClass} htmlFor="adminConfirm">
                                    Confirm password
                                  </label>
                                  <div className="relative">
                                    <ShieldCheck className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#666970]" />
                                    <input
                                      id="adminConfirm"
                                      type={showConfirmPassword ? 'text' : 'password'}
                                      placeholder="Repeat password"
                                      autoComplete="new-password"
                                      className={iconInputClass}
                                      {...adminForm.register('confirmPassword')}
                                    />
                                    <button
                                      type="button"
                                      className="absolute right-3 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center text-[#666970] transition hover:text-[#000a1e]"
                                      onClick={() => setShowConfirmPassword((current) => !current)}
                                      aria-label={showConfirmPassword ? 'Hide password' : 'Show password'}
                                    >
                                      {showConfirmPassword ? (
                                        <EyeOff className="h-4 w-4" />
                                      ) : (
                                        <Eye className="h-4 w-4" />
                                      )}
                                    </button>
                                  </div>
                                  {adminForm.formState.errors.confirmPassword ? (
                                    <p className="text-sm text-[#ba1a1a]">
                                      {adminForm.formState.errors.confirmPassword.message}
                                    </p>
                                  ) : null}
                                </div>
                              </div>
                            </div>
                          </motion.section>

                          <motion.section variants={sectionItem} className={panelClass}>
                            <div className="absolute inset-x-0 top-0 h-1 bg-[#005db6]" />
                            <div className="space-y-4">
                              <div className="space-y-1.5">
                                <p className={eyebrowClass}>Optional note</p>
                                <h2
                                  className={sectionHeadingClass}
                                  style={{ fontFamily: 'Manrope, sans-serif' }}
                                >
                                  Why you need admin access
                                </h2>
                              </div>
                              <textarea
                                rows={3}
                                placeholder="Briefly explain your administrative responsibility."
                                className={cn(textareaClass, 'min-h-[88px]')}
                                {...adminForm.register('notes')}
                              />
                              <div className="flex items-start gap-2.5 rounded-[0.4rem] border border-[#c9d7e8] bg-[#edf4fb] p-3.5">
                                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-[#005db6]" />
                                <p className="text-[0.82rem] leading-5 text-[#244261]">
                                  Admin accounts require approval. The maintenance owner or an existing
                                  admin reviews your request before your account is created, so you
                                  will not be able to sign in until then.
                                </p>
                              </div>
                            </div>
                          </motion.section>
                        </motion.div>
                      </form>
                    </motion.div>
                  ) : showAcademic ? (
                    <motion.div
                      key="academic"
                      initial={reduceMotion ? false : { opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -8 }}
                      transition={{ duration: 0.22, ease: [0.23, 1, 0.32, 1] }}
                    >
                      <form id="academic-enroll-form" onSubmit={onSubmitAcademic}>
                        <motion.div
                          initial={reduceMotion ? false : 'hidden'}
                          animate="show"
                          variants={sectionStagger}
                          className="space-y-7"
                        >
                          <motion.section variants={sectionItem} className={panelClass}>
                            <div className="absolute inset-x-0 top-0 h-1 bg-[#005db6]" />
                            <div className="space-y-6">
                              <div className="space-y-1.5">
                                <p className={eyebrowClass}>Profile details</p>
                                <h2
                                  className={sectionHeadingClass}
                                  style={{ fontFamily: 'Manrope, sans-serif' }}
                                >
                                  Account information
                                </h2>
                              </div>
                              <div className="grid gap-5 md:grid-cols-2">
                                <div className="space-y-2">
                                  <label className={labelClass} htmlFor="academicFullName">
                                    Full name
                                  </label>
                                  <div className="relative">
                                    <UserRound className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#666970]" />
                                    <input
                                      id="academicFullName"
                                      type="text"
                                      placeholder="e.g. Dr. Hana Abera"
                                      autoComplete="name"
                                      className={iconInputClass}
                                      {...academicForm.register('fullName')}
                                    />
                                  </div>
                                  {academicForm.formState.errors.fullName ? (
                                    <p className="text-sm text-[#ba1a1a]">
                                      {academicForm.formState.errors.fullName.message}
                                    </p>
                                  ) : null}
                                </div>
                                <div className="space-y-2">
                                  <label className={labelClass} htmlFor="academicEmail">
                                    Institutional email
                                  </label>
                                  <div className="relative">
                                    <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#666970]" />
                                    <input
                                      id="academicEmail"
                                      type="email"
                                      placeholder="name@stpaul.org"
                                      autoComplete="email"
                                      className={iconInputClass}
                                      {...academicForm.register('email')}
                                    />
                                  </div>
                                  {academicForm.formState.errors.email ? (
                                    <p className="text-sm text-[#ba1a1a]">
                                      {academicForm.formState.errors.email.message}
                                    </p>
                                  ) : null}
                                </div>
                              </div>
                              <div className="grid gap-5 md:grid-cols-2">
                                <div className="space-y-2">
                                  <label className={labelClass} htmlFor="academicPassword">
                                    Create password
                                  </label>
                                  <div className="relative">
                                    <LockKeyhole className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#666970]" />
                                    <input
                                      id="academicPassword"
                                      type={showPassword ? 'text' : 'password'}
                                      placeholder="8+ characters"
                                      autoComplete="new-password"
                                      className={iconInputClass}
                                      {...academicForm.register('password')}
                                    />
                                    <button
                                      type="button"
                                      className="absolute right-3 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center text-[#666970] transition hover:text-[#000a1e]"
                                      onClick={() => setShowPassword((current) => !current)}
                                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                                    >
                                      {showPassword ? (
                                        <EyeOff className="h-4 w-4" />
                                      ) : (
                                        <Eye className="h-4 w-4" />
                                      )}
                                    </button>
                                  </div>
                                  {academicForm.formState.errors.password ? (
                                    <p className="text-sm text-[#ba1a1a]">
                                      {academicForm.formState.errors.password.message}
                                    </p>
                                  ) : null}
                                </div>
                                <div className="space-y-2">
                                  <label className={labelClass} htmlFor="academicConfirm">
                                    Confirm password
                                  </label>
                                  <div className="relative">
                                    <ShieldCheck className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#666970]" />
                                    <input
                                      id="academicConfirm"
                                      type={showConfirmPassword ? 'text' : 'password'}
                                      placeholder="Repeat password"
                                      autoComplete="new-password"
                                      className={iconInputClass}
                                      {...academicForm.register('confirmPassword')}
                                    />
                                    <button
                                      type="button"
                                      className="absolute right-3 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center text-[#666970] transition hover:text-[#000a1e]"
                                      onClick={() => setShowConfirmPassword((current) => !current)}
                                      aria-label={
                                        showConfirmPassword
                                          ? 'Hide confirmation password'
                                          : 'Show confirmation password'
                                      }
                                    >
                                      {showConfirmPassword ? (
                                        <EyeOff className="h-4 w-4" />
                                      ) : (
                                        <Eye className="h-4 w-4" />
                                      )}
                                    </button>
                                  </div>
                                  {academicForm.formState.errors.confirmPassword ? (
                                    <p className="text-sm text-[#ba1a1a]">
                                      {academicForm.formState.errors.confirmPassword.message}
                                    </p>
                                  ) : null}
                                </div>
                              </div>
                            </div>
                          </motion.section>

                          <motion.section variants={sectionItem} className={panelClass}>
                            <div className="absolute inset-x-0 top-0 h-1 bg-[#005db6]" />
                            <div className="space-y-6">
                              <div className="space-y-1.5">
                                <p className={eyebrowClass}>Your role</p>
                                <h2
                                  className={sectionHeadingClass}
                                  style={{ fontFamily: 'Manrope, sans-serif' }}
                                >
                                  Your evaluation role
                                </h2>
                              </div>
                              <Controller
                                control={academicForm.control}
                                name="role"
                                render={({ field }) => (
                                  <div className="grid gap-3 sm:grid-cols-2">
                                    {ACADEMIC_ROLES.map((entry) => {
                                      const active = field.value === entry.value
                                      const Icon = entry.icon
                                      return (
                                        <button
                                          key={entry.value}
                                          type="button"
                                          onClick={() => field.onChange(entry.value)}
                                          className={cn(
                                            'flex items-center gap-3 rounded-[0.45rem] px-4 py-3.5 text-left outline outline-1 transition-[transform,outline-color,background] duration-150 ease-out active:scale-[0.98]',
                                            active
                                              ? 'bg-[linear-gradient(180deg,#eef5ff_0%,#f9fbff_100%)] outline-[#005db6]'
                                              : 'bg-[linear-gradient(180deg,#ffffff_0%,#f6f8fb_100%)] outline-[#c4c6cf]/30 hover:outline-[#b8c7d8]',
                                          )}
                                        >
                                          <span
                                            className={cn(
                                              'flex h-9 w-9 shrink-0 items-center justify-center rounded-[0.3rem] transition-colors',
                                              active
                                                ? 'bg-[#005db6] text-white'
                                                : 'bg-[#eef2f6] text-[#5b6169]',
                                            )}
                                          >
                                            <Icon className="h-4 w-4" />
                                          </span>
                                          <span className="min-w-0">
                                            <span className="flex items-center gap-2">
                                              <span className="text-sm font-bold text-[#000a1e]">
                                                {entry.title}
                                              </span>
                                              {active ? (
                                                <CheckCircle2 className="h-4 w-4 text-[#005db6]" />
                                              ) : null}
                                            </span>
                                            <span className="block text-sm leading-5 text-[#5b6169]">
                                              {entry.description}
                                            </span>
                                          </span>
                                        </button>
                                      )
                                    })}
                                  </div>
                                )}
                              />
                              {academicForm.formState.errors.role ? (
                                <p className="text-sm text-[#ba1a1a]">
                                  {academicForm.formState.errors.role.message}
                                </p>
                              ) : null}

                              <AnimatePresence initial={false}>
                                {role === 'resident' ? (
                                  <motion.div
                                    initial={reduceMotion ? false : { opacity: 0, height: 0 }}
                                    animate={{ opacity: 1, height: 'auto' }}
                                    exit={reduceMotion ? { opacity: 0 } : { opacity: 0, height: 0 }}
                                    transition={{ duration: 0.18, ease: [0.23, 1, 0.32, 1] }}
                                    className="overflow-hidden"
                                  >
                                    <div className="space-y-2 border-l-[3px] border-[#f0b429] bg-[#fffaf0] px-4 py-3.5">
                                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                                        <label className={labelClass}>Current training year</label>
                                        <span className="text-xs text-[#666970]">
                                          Required · confirmed by an administrator
                                        </span>
                                      </div>
                                      <Controller
                                        control={academicForm.control}
                                        name="trainingYear"
                                        render={({ field }) => (
                                          <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Current training year">
                                            {[1, 2, 3].map((year) => {
                                              const value = String(year)
                                              const active = field.value === value

                                              return (
                                                <button
                                                  key={year}
                                                  type="button"
                                                  role="radio"
                                                  aria-checked={active}
                                                  onClick={() => field.onChange(value)}
                                                  className={cn(
                                                    'h-11 rounded-[0.35rem] text-sm font-bold outline outline-1 transition-[background,color,outline-color,transform] duration-150 active:scale-[0.98]',
                                                    active
                                                      ? 'bg-[#002147] text-white outline-[#002147]'
                                                      : 'bg-white text-[#44474e] outline-[#d4dde8] hover:outline-[#005db6]',
                                                  )}
                                                >
                                                  Year {year}
                                                </button>
                                              )
                                            })}
                                          </div>
                                        )}
                                      />
                                      {academicForm.formState.errors.trainingYear ? (
                                        <p className="text-sm text-[#ba1a1a]">
                                          {academicForm.formState.errors.trainingYear.message}
                                        </p>
                                      ) : null}
                                    </div>
                                  </motion.div>
                                ) : null}
                              </AnimatePresence>

                              <div className="grid gap-5 md:grid-cols-2">
                                <div className="space-y-2">
                                  <label className={labelClass} htmlFor="academicHomeWard">
                                    Home ward{' '}
                                    <span className="font-semibold text-[#666970]">(optional)</span>
                                  </label>
                                  <div className="relative">
                                    <Building2 className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#666970]" />
                                    <select
                                      id="academicHomeWard"
                                      className={iconInputClass}
                                      {...academicForm.register('homeWard')}
                                    >
                                      <option value="">No home ward</option>
                                      {wards.map((ward) => (
                                        <option key={ward.id} value={ward.id}>
                                          {ward.name}
                                        </option>
                                      ))}
                                    </select>
                                  </div>
                                </div>
                                <div className="space-y-2">
                                  <label className={labelClass} htmlFor="academicNotes">
                                    Note{' '}
                                    <span className="font-semibold text-[#666970]">(optional)</span>
                                  </label>
                                  <textarea
                                    id="academicNotes"
                                    placeholder="Anything the department should know."
                                    className={cn(textareaClass, 'min-h-[60px]')}
                                    {...academicForm.register('notes')}
                                  />
                                  <div className="flex items-center justify-end text-xs text-[#666970]">
                                    <span>{academicNotes.length}/240</span>
                                  </div>
                                </div>
                              </div>

                              <div className="flex items-start gap-2.5 rounded-[0.4rem] border border-[#c9d7e8] bg-[#edf4fb] p-3.5">
                                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-[#005db6]" />
                                <p className="text-[0.82rem] leading-5 text-[#244261]">
                                  Academic accounts require approval. An administrator reviews your
                                  enrollment request before your account is created, so you will not
                                  be able to sign in until then.
                                </p>
                              </div>
                            </div>
                          </motion.section>
                        </motion.div>
                      </form>
                    </motion.div>
                  ) : (
                    <motion.div
                      key="clinical"
                      initial={reduceMotion ? false : { opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -8 }}
                      transition={{ duration: 0.22, ease: [0.23, 1, 0.32, 1] }}
                    >
                      <form id="clinical-request-form" onSubmit={onSubmitClinical}>
                        <motion.div
                          initial={reduceMotion ? false : 'hidden'}
                          animate="show"
                          variants={sectionStagger}
                          className="space-y-7"
                        >
                          <motion.section variants={sectionItem} className={panelClass}>
                            <div className="absolute inset-x-0 top-0 h-1 bg-[#005db6]" />
                            <div className="space-y-6">
                              <div className="space-y-1.5">
                                <p className={eyebrowClass}>Profile details</p>
                                <h2
                                  className={sectionHeadingClass}
                                  style={{ fontFamily: 'Manrope, sans-serif' }}
                                >
                                  Account information
                                </h2>
                              </div>
                              <div className="grid gap-5 md:grid-cols-2">
                                <div className="space-y-2">
                                  <label className={labelClass} htmlFor="fullName">
                                    Full name
                                  </label>
                                  <div className="relative">
                                    <UserRound className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#666970]" />
                                    <input
                                      id="fullName"
                                      type="text"
                                      placeholder="e.g. Hana Abera"
                                      autoComplete="name"
                                      className={iconInputClass}
                                      disabled={Boolean(currentUser)}
                                      {...clinicalForm.register('fullName')}
                                    />
                                  </div>
                                  {clinicalForm.formState.errors.fullName ? (
                                    <p className="text-sm text-[#ba1a1a]">
                                      {clinicalForm.formState.errors.fullName.message}
                                    </p>
                                  ) : null}
                                </div>
                                <div className="space-y-2">
                                  <label className={labelClass} htmlFor="email">
                                    Institutional email
                                  </label>
                                  <div className="relative">
                                    <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#666970]" />
                                    <input
                                      id="email"
                                      type="email"
                                      placeholder="name@stpaul.org"
                                      autoComplete="email"
                                      className={iconInputClass}
                                      disabled={Boolean(currentUser)}
                                      {...clinicalForm.register('email')}
                                    />
                                  </div>
                                  {clinicalForm.formState.errors.email ? (
                                    <p className="text-sm text-[#ba1a1a]">
                                      {clinicalForm.formState.errors.email.message}
                                    </p>
                                  ) : null}
                                </div>
                              </div>
                              {!currentUser ? (
                                <div className="grid gap-5 md:grid-cols-2">
                                  <div className="space-y-2">
                                    <label className={labelClass} htmlFor="password">
                                      Create password
                                    </label>
                                    <div className="relative">
                                      <LockKeyhole className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#666970]" />
                                      <input
                                        id="password"
                                        type={showPassword ? 'text' : 'password'}
                                        placeholder="8+ characters"
                                        autoComplete="new-password"
                                        className={iconInputClass}
                                        {...clinicalForm.register('password')}
                                      />
                                      <button
                                        type="button"
                                        className="absolute right-3 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center text-[#666970] transition hover:text-[#000a1e]"
                                        onClick={() => setShowPassword((current) => !current)}
                                        aria-label={showPassword ? 'Hide password' : 'Show password'}
                                      >
                                        {showPassword ? (
                                          <EyeOff className="h-4 w-4" />
                                        ) : (
                                          <Eye className="h-4 w-4" />
                                        )}
                                      </button>
                                    </div>
                                    {clinicalForm.formState.errors.password ? (
                                      <p className="text-sm text-[#ba1a1a]">
                                        {clinicalForm.formState.errors.password.message}
                                      </p>
                                    ) : null}
                                  </div>
                                  <div className="space-y-2">
                                    <label className={labelClass} htmlFor="confirmPassword">
                                      Confirm password
                                    </label>
                                    <div className="relative">
                                      <ShieldCheck className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#666970]" />
                                      <input
                                        id="confirmPassword"
                                        type={showConfirmPassword ? 'text' : 'password'}
                                        placeholder="Repeat password"
                                        autoComplete="new-password"
                                        className={iconInputClass}
                                        {...clinicalForm.register('confirmPassword')}
                                      />
                                      <button
                                        type="button"
                                        className="absolute right-3 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center text-[#666970] transition hover:text-[#000a1e]"
                                        onClick={() => setShowConfirmPassword((current) => !current)}
                                        aria-label={
                                          showConfirmPassword
                                            ? 'Hide confirmation password'
                                            : 'Show confirmation password'
                                        }
                                      >
                                        {showConfirmPassword ? (
                                          <EyeOff className="h-4 w-4" />
                                        ) : (
                                          <Eye className="h-4 w-4" />
                                        )}
                                      </button>
                                    </div>
                                    {clinicalForm.formState.errors.confirmPassword ? (
                                      <p className="text-sm text-[#ba1a1a]">
                                        {clinicalForm.formState.errors.confirmPassword.message}
                                      </p>
                                    ) : null}
                                  </div>
                                </div>
                              ) : null}
                            </div>
                          </motion.section>

                          <motion.section variants={sectionItem} className={panelClass}>
                            <div className="absolute inset-x-0 top-0 h-1 bg-[#005db6]" />
                            <div className="space-y-6">
                              <div className="space-y-1.5">
                                <p className={eyebrowClass}>Reporting assignments</p>
                                <h2
                                  className={sectionHeadingClass}
                                  style={{ fontFamily: 'Manrope, sans-serif' }}
                                >
                                  Choose departments
                                </h2>
                              </div>
                              <Controller
                                control={clinicalForm.control}
                                name="requestedDepartments"
                                render={({ field }) => (
                                  <div className="space-y-4">
                                    {familySections.map((family) => (
                                      <div
                                        key={family.key}
                                        className="overflow-hidden rounded-[0.5rem] bg-[linear-gradient(180deg,#eef4fb_0%,#f9fbfd_100%)] outline outline-1 outline-[#c7d5e4]/26"
                                      >
                                        <div className="h-1 w-full bg-[#005db6]" />
                                        <div className="space-y-4 p-4 md:p-5">
                                          <div className="flex items-center justify-between gap-3">
                                            <h3
                                              className="text-[1.05rem] font-bold tracking-[-0.02em] text-[#000a1e]"
                                              style={{ fontFamily: 'Manrope, sans-serif' }}
                                            >
                                              {family.label}
                                            </h3>
                                            <span className="inline-flex shrink-0 items-center rounded-[4px] bg-[#d6e3ff] px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-[#00468c]">
                                              {groupedDepartments[family.key].length}
                                            </span>
                                          </div>
                                          <div className="grid gap-2.5 md:grid-cols-2">
                                            {groupedDepartments[family.key].map((department) => {
                                              const checked = field.value.includes(department.id)
                                              return (
                                                <label
                                                  key={department.id}
                                                  className={cn(
                                                    'flex cursor-pointer items-center gap-3 rounded-[0.45rem] px-3.5 py-3 outline outline-1 transition active:scale-[0.99]',
                                                    checked
                                                      ? 'bg-[linear-gradient(180deg,#eef5ff_0%,#f9fbff_100%)] outline-[#005db6]/40'
                                                      : 'bg-[linear-gradient(180deg,#ffffff_0%,#f6f8fb_100%)] outline-[#c4c6cf]/25 hover:outline-[#b8c7d8]',
                                                  )}
                                                >
                                                  <input
                                                    type="checkbox"
                                                    checked={checked}
                                                    className="h-4 w-4 shrink-0 rounded-[2px] border-[#c4c6cf] accent-[#005db6]"
                                                    onChange={(event) => {
                                                      field.onChange(
                                                        event.target.checked
                                                          ? [...field.value, department.id]
                                                          : field.value.filter(
                                                              (value) => value !== department.id,
                                                            ),
                                                      )
                                                    }}
                                                  />
                                                  <span className="text-sm font-semibold text-[#000a1e]">
                                                    {department.name}
                                                  </span>
                                                </label>
                                              )
                                            })}
                                          </div>
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              />
                              {clinicalForm.formState.errors.requestedDepartments ? (
                                <p className="text-sm text-[#ba1a1a]">
                                  {clinicalForm.formState.errors.requestedDepartments.message}
                                </p>
                              ) : null}
                            </div>
                          </motion.section>

                          <motion.section variants={sectionItem} className={panelClass}>
                            <div className="absolute inset-x-0 top-0 h-1 bg-[linear-gradient(90deg,#005db6_0%,#63a1ff_78%,#f0b429_100%)]" />
                            <div className="space-y-4">
                              <div className="space-y-1.5">
                                <p className={eyebrowClass}>Optional note</p>
                                <h2
                                  className={sectionHeadingClass}
                                  style={{ fontFamily: 'Manrope, sans-serif' }}
                                >
                                  Department note
                                </h2>
                              </div>
                              <textarea
                                id="notes"
                                placeholder="Briefly explain your service coverage or rotation."
                                className={cn(textareaClass, 'min-h-[88px]')}
                                {...clinicalForm.register('notes')}
                              />
                              <div className="flex items-center justify-end text-xs text-[#666970]">
                                <span>{clinicalNotes.length}/240</span>
                              </div>
                              {clinicalForm.formState.errors.notes ? (
                                <p className="text-sm text-[#ba1a1a]">
                                  {clinicalForm.formState.errors.notes.message}
                                </p>
                              ) : null}
                            </div>
                          </motion.section>

                          {currentUser ? (
                            <motion.section variants={sectionItem} className={panelClass}>
                              <div className="absolute inset-x-0 top-0 h-1 bg-[#005db6]" />
                              <div className="space-y-5">
                                <div className="flex items-end justify-between gap-3">
                                  <h2
                                    className={sectionHeadingClass}
                                    style={{ fontFamily: 'Manrope, sans-serif' }}
                                  >
                                    Previous submissions
                                  </h2>
                                  <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-[#666970]">
                                    {formatCompactNumber(currentUserRequests.length)} total
                                  </p>
                                </div>
                                {currentUserRequests.length ? (
                                  <div className="space-y-3">
                                    {currentUserRequests.map((request) => (
                                      <article
                                        key={request.id}
                                        className="rounded-[0.5rem] bg-[linear-gradient(180deg,#f2f6fb_0%,#ffffff_100%)] p-4 outline outline-1 outline-[#c7d5e4]/24"
                                      >
                                        <div className="space-y-3">
                                          <div className="flex flex-wrap gap-2">
                                            {request.requestedAssignments.map((assignment) => (
                                              <span
                                                key={`${request.id}-${assignment.departmentId}`}
                                                className="rounded-[4px] bg-white px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-[#244261] outline outline-1 outline-[#c7d5e4]/30"
                                              >
                                                {
                                                  departments.find(
                                                    (department) =>
                                                      department.id === assignment.departmentId,
                                                  )?.name
                                                }
                                              </span>
                                            ))}
                                          </div>
                                          <div className="flex items-center justify-between gap-3 text-sm text-[#5b6169]">
                                            <span>{formatTimestamp(request.requestedAt)}</span>
                                            <span
                                              className={cn(
                                                'inline-flex rounded-[4px] border px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em]',
                                                getStatusClass(request.status),
                                              )}
                                            >
                                              {request.status}
                                            </span>
                                          </div>
                                        </div>
                                      </article>
                                    ))}
                                  </div>
                                ) : (
                                  <div className="rounded-[0.5rem] bg-[linear-gradient(180deg,#f2f6fb_0%,#ffffff_100%)] px-5 py-8 text-center text-sm text-[#5b6169] outline outline-1 outline-[#c7d5e4]/24">
                                    No requests yet.
                                  </div>
                                )}
                              </div>
                            </motion.section>
                          ) : null}
                        </motion.div>
                      </form>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* mobile-only submit (the sticky left panel is hidden below md) */}
                <div className="mt-8 rounded-[0.5rem] bg-[#04162f] p-5 md:hidden">{renderSummary()}</div>

                <div className="mt-9 border-t border-[#edeeef] pt-6 text-center">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#005db6]">
                    Technical support
                  </p>
                  <p className="mt-2 text-sm text-[#44474e]">
                    Developed and supported by {technicalSupport.name}
                  </p>
                  <a
                    className="mt-1 inline-block text-sm font-medium text-[#000a1e] transition-colors hover:text-[#005db6]"
                    href={`tel:${technicalSupport.phone.replace(/\s+/g, '')}`}
                  >
                    {technicalSupport.phone}
                  </a>
                </div>
              </div>
            </div>
          </section>
        </div>
      </main>
    </div>
  )
}
