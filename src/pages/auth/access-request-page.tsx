import { zodResolver } from '@hookform/resolvers/zod'
import {
  ArrowLeft,
  CheckCircle2,
  Eye,
  EyeOff,
  FileCheck2,
  Info,
  LockKeyhole,
  Mail,
  Send,
  ShieldCheck,
  UserRound,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { Controller, useForm, useWatch } from 'react-hook-form'
import { Link } from 'react-router-dom'
import { z } from 'zod'

import stPaulosLogo from '@/assets/StPaulosLogoColor.jpg'
import { departments } from '@/config/templates'
import { useAppData } from '@/context/app-data-context'
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

const familySections = [
  {
    key: 'inpatient',
    label: 'Inpatient services',
    description: 'Ward coverage, rounding, and bedside reporting assignments.',
    accent: 'bg-[#005db6]',
    chipClass: 'bg-[#d6e3ff] text-[#00468c]',
  },
  {
    key: 'outpatient',
    label: 'Outpatient services',
    description: 'Clinic reporting assignments and ambulatory follow-up services.',
    accent: 'bg-[#0b7285]',
    chipClass: 'bg-[#e1f2f6] text-[#165a67]',
  },
  {
    key: 'procedure',
    label: 'Procedure services',
    description: 'Procedure room activity and intervention reporting access.',
    accent: 'bg-[#4867a6]',
    chipClass: 'bg-[#e6edf9] text-[#35507f]',
  },
] as const

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

export function AccessRequestPage() {
  const { currentUser, state, submitAccessRequest, ensureAccessRequestData } = useAppData()
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const isNewAccountFlow = !currentUser
  const backTarget = currentUser
    ? currentUser.role === 'nurse'
      ? '/nurse'
      : '/admin'
    : '/login'
  const backLabel = currentUser ? 'Back to workspace' : 'Back to sign in'
  const groupedDepartments = {
    inpatient: departments.filter((department) => department.family === 'inpatient'),
    outpatient: departments.filter((department) => department.family === 'outpatient'),
    procedure: departments.filter((department) => department.family === 'procedure'),
  }

  const form = useForm<RequestValues>({
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

  useEffect(() => {
    form.reset({
      fullName: currentUser?.fullName ?? '',
      email: currentUser?.email ?? '',
      password: '',
      confirmPassword: '',
      requestedDepartments: [],
      notes: '',
    })
  }, [currentUser, form])

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
    control: form.control,
    name: 'requestedDepartments',
    defaultValue: [],
  })
  const notesValue =
    useWatch({
      control: form.control,
      name: 'notes',
      defaultValue: '',
    }) ?? ''

  const selectedDepartments = departments.filter((department) =>
    requestedDepartments.includes(department.id),
  )
  const selectedCount = selectedDepartments.length
  const recentRequests = currentUserRequests.slice(0, 3)
  const pageTitle = isNewAccountFlow
    ? 'Request Reporting Access'
    : 'Request Additional Access'
  const pageDescription = isNewAccountFlow
    ? 'Create your profile, choose the internal medicine reporting assignments you need, and submit the request for department review.'
    : 'Choose the additional reporting assignments you need and send the update for administrator approval.'
  const inputClassName =
    'h-12 w-full rounded-[4px] border border-transparent border-b-[#d4dde8] bg-[linear-gradient(180deg,#edf3fa_0%,#f7f9fb_100%)] px-4 text-sm text-[#191c1d] outline-none transition placeholder:text-[#9aa0a8] focus:border-[#005db6] focus:bg-[#fbfdff] disabled:cursor-not-allowed disabled:border-[#e1e3e4] disabled:bg-[#edeeef] disabled:text-[#74777f]'
  const iconInputClassName = `${inputClassName} pl-11`
  const textareaClassName =
    'min-h-[112px] w-full resize-none rounded-[4px] border border-transparent border-b-[#d4dde8] bg-[linear-gradient(180deg,#eef4fb_0%,#fbfdff_100%)] px-4 py-3 text-sm text-[#191c1d] outline-none transition placeholder:text-[#9aa0a8] focus:border-[#005db6] focus:bg-[#ffffff]'
  const panelClassName =
    'relative overflow-hidden rounded-[0.5rem] bg-[linear-gradient(180deg,#ffffff_0%,#f2f5f8_100%)] p-6 shadow-[0_20px_40px_rgba(0,33,71,0.08)] outline outline-1 outline-[#c9d5e4]/30 md:p-8'
  const labelClassName =
    'text-[11px] font-bold uppercase tracking-[0.18em] text-[#000a1e]'

  const onSubmit = form.handleSubmit(async (values) => {
    setSuccessMessage(null)

    if (!currentUser) {
      if (!values.password || values.password.length < 8) {
        form.setError('password', {
          message: 'Use at least 8 characters for the new account password.',
        })
        return
      }

      if (values.password !== values.confirmPassword) {
        form.setError('confirmPassword', {
          message: 'Passwords must match.',
        })
        return
      }
    }

    const success = await submitAccessRequest({
      fullName: values.fullName,
      email: values.email,
      password: values.password,
      notes: values.notes,
      requestedAssignments: values.requestedDepartments.map((departmentId) => {
        const department = departments.find((entry) => entry.id === departmentId)!
        return { departmentId, templateId: department.templateId }
      }),
    })

    if (!success) {
      return
    }

    setSuccessMessage(
      currentUser
        ? 'Additional access request submitted for review.'
        : 'Access request submitted. Confirm your email before signing in if email confirmation is enabled.',
    )

    form.reset({
      fullName: currentUser?.fullName ?? '',
      email: currentUser?.email ?? '',
      password: '',
      confirmPassword: '',
      requestedDepartments: [],
      notes: '',
    })
  })

  return (
    <div className="min-h-screen bg-[linear-gradient(180deg,#edf2f7_0%,#f7f8fa_32%,#eef2f7_100%)] px-4 py-6 md:px-8 md:py-8">
      <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        <div className="absolute inset-0 bg-[linear-gradient(180deg,#edf2f7_0%,#f6f8fa_36%,#eef2f7_100%)]" />
        <div className="absolute inset-x-0 top-0 h-[30rem] bg-[radial-gradient(circle_at_50%_16%,rgba(0,93,182,0.17),transparent_20%),radial-gradient(circle_at_50%_28%,rgba(99,161,255,0.10),transparent_30%)]" />
        <div className="absolute left-[18%] top-[8rem] h-[18rem] w-[18rem] rounded-full bg-[#002147]/[0.08] blur-3xl" />
        <div className="absolute right-[12%] top-[6rem] h-[16rem] w-[16rem] rounded-full bg-[#63a1ff]/[0.10] blur-3xl" />
        <div className="absolute left-1/2 top-[3rem] h-[32rem] w-[32rem] -translate-x-1/2 rounded-full border border-[#d7e2f0]" />
        <div className="absolute left-1/2 top-[-1rem] h-[42rem] w-[42rem] -translate-x-1/2 rounded-full border border-[#e2e9f3]/80" />
        <div
          className="absolute inset-0 opacity-[0.04]"
          style={{
            backgroundImage:
              'radial-gradient(circle, rgba(0, 33, 71, 0.65) 1px, transparent 1px)',
            backgroundSize: '36px 36px',
          }}
        />
      </div>

      <div className="mx-auto max-w-[1180px]">
        <div className="mb-8 flex items-center justify-between gap-4">
          <Link
            className="inline-flex items-center gap-2 rounded-[4px] border border-[#c8d5e6] bg-[#eef4fb] px-4 py-2 text-[11px] font-bold uppercase tracking-[0.16em] text-[#000a1e] transition hover:bg-[#e3edf8]"
            to={backTarget}
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            {backLabel}
          </Link>

          <div className="hidden items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-[#74777f] md:flex">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            Reporting system active
          </div>
        </div>

        <header className="mb-10 text-center">
          <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center overflow-hidden rounded-[0.5rem] bg-[#002147] p-2 shadow-[0_16px_32px_rgba(0,33,71,0.16)]">
            <img
              src={stPaulosLogo}
              alt="St. Paulos logo"
              className="h-full w-full rounded-[0.25rem] object-cover"
            />
          </div>
          <h1
            className="text-[2rem] font-extrabold uppercase tracking-[-0.03em] text-[#000a1e] sm:text-[2.35rem]"
            style={{ fontFamily: 'Manrope, sans-serif' }}
          >
            St. Paulos
          </h1>
          <p
            className="mt-2 text-base font-semibold tracking-[0.02em] text-[#44474e]"
            style={{ fontFamily: 'Manrope, sans-serif' }}
          >
            Internal Medicine Reporting System
          </p>
          <div className="mx-auto mt-4 h-px w-28 bg-[linear-gradient(90deg,#005db6_0%,#63a1ff_68%,#f0b429_100%)]" />
        </header>

        <form
          className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px] xl:items-start"
          onSubmit={onSubmit}
        >
          <div className="space-y-6">
            <section className="relative overflow-hidden rounded-[0.5rem] bg-[linear-gradient(135deg,#000a1e_0%,#00152f_44%,#002147_100%)] p-6 text-white shadow-[0_24px_48px_rgba(0,33,71,0.18)] outline outline-1 outline-[#11345b]/55 md:p-8">
              <div className="absolute inset-x-0 top-0 h-1 bg-[linear-gradient(90deg,#005db6_0%,#63a1ff_72%,#f0b429_100%)]" />
              <div className="absolute right-[-10%] top-[-12%] h-48 w-48 rounded-full bg-[#63a1ff]/15 blur-3xl" />
              <div className="relative z-10 space-y-6">
                <div className="space-y-3">
                  <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#f0b429]">
                    {isNewAccountFlow ? 'New access request' : 'Access extension'}
                  </p>
                  <div className="space-y-2">
                    <h2
                      className="text-[1.9rem] font-bold tracking-[-0.035em] text-white sm:text-[2.2rem]"
                      style={{ fontFamily: 'Manrope, sans-serif' }}
                    >
                      {pageTitle}
                    </h2>
                    <p className="max-w-[46rem] text-sm leading-7 text-[#c6d3e4] sm:text-[0.96rem]">
                      {pageDescription}
                    </p>
                  </div>
                </div>

                <div className="grid gap-3 md:grid-cols-3">
                  {[
                    {
                      step: '01',
                      title: 'Profile',
                      description: isNewAccountFlow
                        ? 'Create your reporting identity.'
                        : 'Current account information on file.',
                    },
                    {
                      step: '02',
                      title: 'Assignments',
                      description: 'Choose the services you report for.',
                    },
                    {
                      step: '03',
                      title: 'Review',
                      description: 'Department administrators confirm access.',
                    },
                  ].map((entry) => (
                    <div
                      key={entry.step}
                      className="rounded-[0.45rem] bg-white/8 p-4 outline outline-1 outline-white/12 backdrop-blur-sm"
                    >
                      <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#f0b429]">
                        Step {entry.step}
                      </p>
                      <h3
                        className="mt-3 text-lg font-bold tracking-[-0.03em] text-white"
                        style={{ fontFamily: 'Manrope, sans-serif' }}
                      >
                        {entry.title}
                      </h3>
                      <p className="mt-2 text-sm leading-6 text-[#c6d3e4]">{entry.description}</p>
                    </div>
                  ))}
                </div>
              </div>
            </section>

            <section className={panelClassName}>
              <div className="absolute inset-x-0 top-0 h-1 bg-[#005db6]" />
              <div className="space-y-6">
                <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
                  <div className="space-y-2">
                    <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#005db6]">
                      Profile details
                    </p>
                    <h2
                      className="text-[1.7rem] font-bold tracking-[-0.03em] text-[#000a1e]"
                      style={{ fontFamily: 'Manrope, sans-serif' }}
                    >
                      Account information
                    </h2>
                  </div>
                  <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-[#74777f]">
                    {isNewAccountFlow ? 'New profile setup' : 'Current profile on record'}
                  </p>
                </div>

                <div className="grid gap-5 md:grid-cols-2">
                  <div className="space-y-2">
                    <label className={labelClassName} htmlFor="fullName">
                      Full name
                    </label>
                    <div className="relative">
                      <UserRound className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#74777f]" />
                      <input
                        id="fullName"
                        type="text"
                        placeholder="e.g. Hana Abera"
                        autoComplete="name"
                        aria-invalid={form.formState.errors.fullName ? 'true' : 'false'}
                        className={iconInputClassName}
                        disabled={Boolean(currentUser)}
                        {...form.register('fullName')}
                      />
                    </div>
                    {form.formState.errors.fullName ? (
                      <p className="text-sm text-[#ba1a1a]">
                        {form.formState.errors.fullName.message}
                      </p>
                    ) : null}
                  </div>

                  <div className="space-y-2">
                    <label className={labelClassName} htmlFor="email">
                      Institutional email
                    </label>
                    <div className="relative">
                      <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#74777f]" />
                      <input
                        id="email"
                        type="email"
                        placeholder="name@stpaulos.org"
                        autoComplete="email"
                        aria-invalid={form.formState.errors.email ? 'true' : 'false'}
                        className={iconInputClassName}
                        disabled={Boolean(currentUser)}
                        {...form.register('email')}
                      />
                    </div>
                    {form.formState.errors.email ? (
                      <p className="text-sm text-[#ba1a1a]">
                        {form.formState.errors.email.message}
                      </p>
                    ) : null}
                  </div>
                </div>

                {!currentUser ? (
                  <div className="grid gap-5 md:grid-cols-2">
                    <div className="space-y-2">
                      <label className={labelClassName} htmlFor="password">
                        Create password
                      </label>
                      <div className="relative">
                        <LockKeyhole className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#74777f]" />
                        <input
                          id="password"
                          type={showPassword ? 'text' : 'password'}
                          placeholder="At least 8 characters"
                          autoComplete="new-password"
                          aria-invalid={form.formState.errors.password ? 'true' : 'false'}
                          className={iconInputClassName}
                          {...form.register('password')}
                        />
                        <button
                          type="button"
                          className="absolute right-3 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center text-[#74777f] transition hover:text-[#000a1e]"
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
                      {form.formState.errors.password ? (
                        <p className="text-sm text-[#ba1a1a]">
                          {form.formState.errors.password.message}
                        </p>
                      ) : null}
                    </div>

                    <div className="space-y-2">
                      <label className={labelClassName} htmlFor="confirmPassword">
                        Confirm password
                      </label>
                      <div className="relative">
                        <ShieldCheck className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#74777f]" />
                        <input
                          id="confirmPassword"
                          type={showConfirmPassword ? 'text' : 'password'}
                          placeholder="Repeat your password"
                          autoComplete="new-password"
                          aria-invalid={form.formState.errors.confirmPassword ? 'true' : 'false'}
                          className={iconInputClassName}
                          {...form.register('confirmPassword')}
                        />
                        <button
                          type="button"
                          className="absolute right-3 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center text-[#74777f] transition hover:text-[#000a1e]"
                          onClick={() => setShowConfirmPassword((current) => !current)}
                          aria-label={showConfirmPassword ? 'Hide confirmation password' : 'Show confirmation password'}
                        >
                          {showConfirmPassword ? (
                            <EyeOff className="h-4 w-4" />
                          ) : (
                            <Eye className="h-4 w-4" />
                          )}
                        </button>
                      </div>
                      {form.formState.errors.confirmPassword ? (
                        <p className="text-sm text-[#ba1a1a]">
                          {form.formState.errors.confirmPassword.message}
                        </p>
                      ) : null}
                    </div>
                  </div>
                ) : null}
              </div>
            </section>

            <section className={panelClassName}>
              <div className="absolute inset-x-0 top-0 h-1 bg-[#005db6]" />
              <div className="space-y-6">
                <div className="space-y-2">
                  <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#005db6]">
                    Reporting assignments
                  </p>
                  <h2
                    className="text-[1.7rem] font-bold tracking-[-0.03em] text-[#000a1e]"
                    style={{ fontFamily: 'Manrope, sans-serif' }}
                  >
                    Choose departments
                  </h2>
                  <p className="text-sm leading-7 text-[#5b6169]">
                    Select every department or service line that should be included in your weekly reporting scope.
                  </p>
                </div>

                <div className="space-y-5">
                  {familySections.map((family) => (
                    <div
                      key={family.key}
                      className="overflow-hidden rounded-[0.5rem] bg-[linear-gradient(180deg,#eef4fb_0%,#f9fbfd_100%)] outline outline-1 outline-[#c7d5e4]/26"
                    >
                      <div className={cn('h-1 w-full', family.accent)} />
                      <div className="space-y-5 p-5">
                        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                          <div className="space-y-2">
                            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#74777f]">
                              Service line
                            </p>
                            <h3
                              className="text-[1.35rem] font-bold tracking-[-0.03em] text-[#000a1e]"
                              style={{ fontFamily: 'Manrope, sans-serif' }}
                            >
                              {family.label}
                            </h3>
                            <p className="text-sm leading-6 text-[#5b6169]">{family.description}</p>
                          </div>
                          <span
                            className={cn(
                              'inline-flex items-center rounded-[4px] px-3 py-2 text-[10px] font-bold uppercase tracking-[0.16em]',
                              family.chipClass,
                            )}
                          >
                            {groupedDepartments[family.key].length} assignments
                          </span>
                        </div>

                        <Controller
                          control={form.control}
                          name="requestedDepartments"
                          render={({ field }) => (
                            <div className="grid gap-3 md:grid-cols-2">
                              {groupedDepartments[family.key].map((department) => {
                                const checked = field.value.includes(department.id)

                                return (
                                  <label
                                    key={department.id}
                                    className={cn(
                                      'flex items-start gap-3 rounded-[0.45rem] bg-[linear-gradient(180deg,#ffffff_0%,#f6f8fb_100%)] px-4 py-4 outline outline-1 transition',
                                      checked
                                        ? 'outline-[#005db6]/28 bg-[linear-gradient(180deg,#eef5ff_0%,#f9fbff_100%)]'
                                        : 'outline-[#c4c6cf]/18 hover:bg-[linear-gradient(180deg,#f8fbff_0%,#ffffff_100%)]',
                                    )}
                                  >
                                    <input
                                      type="checkbox"
                                      checked={checked}
                                      className="mt-1 h-4 w-4 rounded-[2px] border-[#c4c6cf] accent-[#005db6]"
                                      onChange={(event) => {
                                        field.onChange(
                                          event.target.checked
                                            ? [...field.value, department.id]
                                            : field.value.filter((value) => value !== department.id),
                                        )
                                      }}
                                    />
                                    <span className="min-w-0 space-y-1.5">
                                      <span className="flex flex-wrap items-center gap-2">
                                        <span className="text-sm font-semibold text-[#000a1e]">
                                          {department.name}
                                        </span>
                                        {checked ? (
                                          <span className="rounded-[4px] bg-[#d6e3ff] px-2 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-[#00468c]">
                                            Selected
                                          </span>
                                        ) : null}
                                      </span>
                                      <span className="block text-sm leading-6 text-[#5b6169]">
                                        {department.description}
                                      </span>
                                    </span>
                                  </label>
                                )
                              })}
                            </div>
                          )}
                        />
                      </div>
                    </div>
                  ))}
                </div>

                {form.formState.errors.requestedDepartments ? (
                  <p className="text-sm text-[#ba1a1a]">
                    {form.formState.errors.requestedDepartments.message}
                  </p>
                ) : null}
              </div>
            </section>

            <section className="relative overflow-hidden rounded-[0.5rem] bg-[linear-gradient(180deg,#eef4fb_0%,#ffffff_100%)] p-6 shadow-[0_20px_40px_rgba(0,33,71,0.08)] outline outline-1 outline-[#c9d5e4]/30 md:p-8">
              <div className="absolute inset-x-0 top-0 h-1 bg-[linear-gradient(90deg,#005db6_0%,#63a1ff_78%,#f0b429_100%)]" />
              <div className="space-y-5">
                <div className="space-y-2">
                  <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#005db6]">
                    Optional note
                  </p>
                  <h2
                    className="text-[1.7rem] font-bold tracking-[-0.03em] text-[#000a1e]"
                    style={{ fontFamily: 'Manrope, sans-serif' }}
                  >
                    Department note
                  </h2>
                  <p className="text-sm leading-7 text-[#5b6169]">
                    Add any context that will help the reviewers approve the reporting assignments you need.
                  </p>
                </div>

                <div className="space-y-2">
                  <label className={labelClassName} htmlFor="notes">
                    Reviewer note
                  </label>
                  <textarea
                    id="notes"
                    placeholder="Briefly explain your service coverage, rotation, or reporting needs."
                    className={textareaClassName}
                    {...form.register('notes')}
                  />
                  <div className="flex items-center justify-between gap-3 text-sm text-[#74777f]">
                    <span>Optional</span>
                    <span>{notesValue.length}/240</span>
                  </div>
                  {form.formState.errors.notes ? (
                    <p className="text-sm text-[#ba1a1a]">{form.formState.errors.notes.message}</p>
                  ) : null}
                </div>
              </div>
            </section>

            {currentUser ? (
              <section className="relative overflow-hidden rounded-[0.5rem] bg-[linear-gradient(180deg,#eef4fb_0%,#ffffff_100%)] p-6 shadow-[0_20px_40px_rgba(0,33,71,0.08)] outline outline-1 outline-[#c9d5e4]/30 md:p-8">
                <div className="absolute inset-x-0 top-0 h-1 bg-[#005db6]" />
                <div className="space-y-6">
                  <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
                    <div className="space-y-2">
                      <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#005db6]">
                        Request history
                      </p>
                      <h2
                        className="text-[1.7rem] font-bold tracking-[-0.03em] text-[#000a1e]"
                        style={{ fontFamily: 'Manrope, sans-serif' }}
                      >
                        Previous submissions
                      </h2>
                    </div>
                    <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-[#74777f]">
                      {formatCompactNumber(currentUserRequests.length)} total requests
                    </p>
                  </div>

                  {currentUserRequests.length ? (
                    <div className="space-y-3">
                      {currentUserRequests.map((request) => (
                        <article
                          key={request.id}
                          className="rounded-[0.5rem] bg-[linear-gradient(180deg,#f2f6fb_0%,#ffffff_100%)] p-5 outline outline-1 outline-[#c7d5e4]/24"
                        >
                          <div className="space-y-4">
                            <div className="flex flex-wrap gap-2">
                              {request.requestedAssignments.map((assignment) => (
                                <span
                                  key={`${request.id}-${assignment.departmentId}`}
                                  className="rounded-[4px] bg-[#ffffff] px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-[#244261] outline outline-1 outline-[#c7d5e4]/30"
                                >
                                  {
                                    departments.find(
                                      (department) => department.id === assignment.departmentId,
                                    )?.name
                                  }
                                </span>
                              ))}
                            </div>

                            <div className="grid gap-3 text-sm text-[#5b6169] sm:grid-cols-2">
                              <div className="space-y-1">
                                <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#74777f]">
                                  Submitted
                                </p>
                                <p>{formatTimestamp(request.requestedAt)}</p>
                              </div>
                              <div className="space-y-1">
                                <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#74777f]">
                                  Status
                                </p>
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

                            {request.notes ? (
                              <p className="text-sm leading-6 text-[#5b6169]">{request.notes}</p>
                            ) : null}
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
              </section>
            ) : null}
          </div>

          <aside className="space-y-6 xl:sticky xl:top-8">
            <section className="relative overflow-hidden rounded-[0.5rem] bg-[linear-gradient(180deg,#000a1e_0%,#00182f_46%,#002147_100%)] p-6 text-white shadow-[0_24px_48px_rgba(0,33,71,0.2)] outline outline-1 outline-[#143963]/55 md:p-8">
              <div className="absolute inset-x-0 top-0 h-1 bg-[linear-gradient(90deg,#005db6_0%,#63a1ff_72%,#f0b429_100%)]" />
              <div className="absolute right-[-14%] top-[-8%] h-52 w-52 rounded-full bg-[#63a1ff]/16 blur-3xl" />
              <div className="relative z-10 space-y-6">
                <div className="space-y-2">
                  <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#f0b429]">
                    Request summary
                  </p>
                  <h2
                    className="text-[1.7rem] font-bold tracking-[-0.03em] text-white"
                    style={{ fontFamily: 'Manrope, sans-serif' }}
                  >
                    Review and submit
                  </h2>
                </div>

                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
                  <div className="rounded-[0.45rem] bg-white/8 p-4 outline outline-1 outline-white/12 backdrop-blur-sm">
                    <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#f0b429]">
                      Selected assignments
                    </p>
                    <p
                      className="mt-3 text-[2rem] font-bold tracking-[-0.04em] text-white"
                      style={{ fontFamily: 'Manrope, sans-serif' }}
                    >
                      {formatCompactNumber(selectedCount)}
                    </p>
                  </div>

                  <div className="rounded-[0.45rem] bg-white/8 p-4 outline outline-1 outline-white/12 backdrop-blur-sm">
                    <div className="flex items-center gap-2">
                      <FileCheck2 className="h-4 w-4 text-[#63a1ff]" />
                      <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#f0b429]">
                        Approval route
                      </p>
                    </div>
                    <p className="mt-3 text-sm font-semibold text-white">
                      Department review
                    </p>
                  </div>
                </div>

                <div className="space-y-3">
                  <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#f0b429]">
                    Selected departments
                  </p>
                  {selectedDepartments.length ? (
                    <div className="flex flex-wrap gap-2">
                      {selectedDepartments.map((department) => (
                        <span
                          key={department.id}
                          className="rounded-[4px] bg-white/10 px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-[#e2ebf6] outline outline-1 outline-white/12"
                        >
                          {department.name}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm leading-6 text-[#c6d3e4]">
                      No reporting assignments selected yet.
                    </p>
                  )}
                </div>

                {successMessage ? (
                  <div className="rounded-[0.45rem] border border-[#cfe7d9] bg-[#edf7f0] p-4">
                    <div className="flex items-start gap-3">
                      <CheckCircle2 className="mt-0.5 h-4 w-4 text-[#1f6b3b]" />
                      <p className="text-sm leading-6 text-[#1f6b3b]">{successMessage}</p>
                    </div>
                  </div>
                ) : null}

                <button
                  type="submit"
                  className="auth-accent-button flex h-14 w-full items-center justify-center gap-3 rounded-[4px] px-6 text-[0.8rem] font-bold uppercase tracking-[0.1em]"
                  style={{ fontFamily: 'Manrope, sans-serif' }}
                >
                  Submit access request
                  <Send className="h-3.5 w-3.5" />
                </button>

                <p className="text-center text-xs leading-6 text-[#c6d3e4]">
                  {isNewAccountFlow ? 'Existing system user? ' : 'Need to leave this form? '}
                  <Link className="font-semibold text-[#63a1ff] hover:underline" to={backTarget}>
                    {isNewAccountFlow ? 'Secure sign in' : 'Return to workspace'}
                  </Link>
                </p>
              </div>
            </section>

            <section className="relative overflow-hidden rounded-[0.5rem] bg-[linear-gradient(180deg,#eef4fb_0%,#ffffff_100%)] p-6 shadow-[0_20px_40px_rgba(0,33,71,0.08)] outline outline-1 outline-[#c9d5e4]/30 md:p-8">
              <div className="absolute inset-x-0 top-0 h-1 bg-[linear-gradient(90deg,#63a1ff_0%,#005db6_70%,#f0b429_100%)]" />
              <div className="space-y-5">
                <div className="space-y-2">
                  <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#005db6]">
                    Review process
                  </p>
                  <h2
                    className="text-[1.6rem] font-bold tracking-[-0.03em] text-[#000a1e]"
                    style={{ fontFamily: 'Manrope, sans-serif' }}
                  >
                    What happens next
                  </h2>
                </div>

                <div className="space-y-4">
                  <div className="flex items-start gap-3 rounded-[0.45rem] bg-[linear-gradient(180deg,#f2f6fb_0%,#ffffff_100%)] p-4 outline outline-1 outline-[#c7d5e4]/24">
                    <Mail className="mt-0.5 h-4 w-4 text-[#005db6]" />
                    <div className="space-y-1.5">
                      <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#000a1e]">
                        Email verification
                      </p>
                      <p className="text-sm leading-6 text-[#5b6169]">
                        {isNewAccountFlow
                          ? 'New accounts receive a verification email before sign-in can begin.'
                          : 'Your current account stays active while the additional request is reviewed.'}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-start gap-3 rounded-[0.45rem] bg-[linear-gradient(180deg,#f2f6fb_0%,#ffffff_100%)] p-4 outline outline-1 outline-[#c7d5e4]/24">
                    <Info className="mt-0.5 h-4 w-4 text-[#005db6]" />
                    <div className="space-y-1.5">
                      <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#000a1e]">
                        Administrative review
                      </p>
                      <p className="text-sm leading-6 text-[#5b6169]">
                        Reporting assignments are confirmed by department administrators before access is activated.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </section>

            {currentUser ? (
              <section className="relative overflow-hidden rounded-[0.5rem] bg-[linear-gradient(180deg,#eef4fb_0%,#ffffff_100%)] p-6 shadow-[0_20px_40px_rgba(0,33,71,0.08)] outline outline-1 outline-[#c9d5e4]/30 md:p-8">
                <div className="absolute inset-x-0 top-0 h-1 bg-[#005db6]" />
                <div className="space-y-5">
                  <div className="space-y-2">
                    <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#005db6]">
                      Recent activity
                    </p>
                    <h2
                      className="text-[1.6rem] font-bold tracking-[-0.03em] text-[#000a1e]"
                      style={{ fontFamily: 'Manrope, sans-serif' }}
                    >
                      Latest requests
                    </h2>
                  </div>

                  {recentRequests.length ? (
                    <div className="space-y-3">
                      {recentRequests.map((request) => (
                        <div
                          key={request.id}
                          className="rounded-[0.45rem] bg-[linear-gradient(180deg,#f2f6fb_0%,#ffffff_100%)] p-4 outline outline-1 outline-[#c7d5e4]/24"
                        >
                          <div className="space-y-3">
                            <div className="flex items-start justify-between gap-3">
                              <p className="text-sm font-semibold text-[#000a1e]">
                                {formatTimestamp(request.requestedAt)}
                              </p>
                              <span
                                className={cn(
                                  'inline-flex rounded-[4px] border px-2 py-1 text-[10px] font-bold uppercase tracking-[0.14em]',
                                  getStatusClass(request.status),
                                )}
                              >
                                {request.status}
                              </span>
                            </div>
                            <p className="text-sm leading-6 text-[#5b6169]">
                              {request.requestedAssignments.length} assignments requested
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm leading-6 text-[#5b6169]">No requests yet.</p>
                  )}
                </div>
              </section>
            ) : null}
          </aside>
        </form>

        <footer className="mt-8 flex flex-col gap-3 text-[10px] font-bold uppercase tracking-[0.16em] text-[#74777f] sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            <span>Reporting policy</span>
            <span>Department review</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            HIPAA aligned workspace
          </div>
        </footer>
      </div>
    </div>
  )
}
