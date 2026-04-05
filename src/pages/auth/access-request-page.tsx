import { zodResolver } from '@hookform/resolvers/zod'
import {
  ArrowLeft,
  CheckCircle2,
  LockKeyhole,
  Send,
  ShieldCheck,
  Sparkles,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { Controller, useForm, useWatch } from 'react-hook-form'
import { Link } from 'react-router-dom'
import { z } from 'zod'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { departments } from '@/config/templates'
import { useAppData } from '@/context/app-data-context'
import { formatTimestamp } from '@/lib/dates'
import { cn, formatCompactNumber } from '@/lib/utils'

const requestSchema = z.object({
  fullName: z.string().min(3),
  email: z.string().email(),
  password: z.string().optional(),
  confirmPassword: z.string().optional(),
  requestedDepartments: z.array(z.string()).min(1, 'Select at least one assignment'),
  notes: z.string().max(240).optional(),
})

type RequestValues = z.infer<typeof requestSchema>

const familySections = [
  {
    key: 'inpatient',
    label: 'Inpatient',
    description: 'Ward reporting access.',
    lineClass: 'from-cyan-400 via-sky-500 to-blue-500',
    glowClass: 'bg-sky-200/24',
    chipTone: 'bg-sky-50 text-sky-800 border-sky-200',
  },
  {
    key: 'outpatient',
    label: 'Outpatient',
    description: 'Clinic reporting access.',
    lineClass: 'from-teal-400 via-cyan-500 to-emerald-400',
    glowClass: 'bg-teal-200/24',
    chipTone: 'bg-teal-50 text-teal-800 border-teal-200',
  },
  {
    key: 'procedure',
    label: 'Procedures',
    description: 'Procedure service access.',
    lineClass: 'from-blue-400 via-sky-500 to-cyan-400',
    glowClass: 'bg-blue-200/24',
    chipTone: 'bg-blue-50 text-blue-800 border-blue-200',
  },
] as const

const requestFlow = ['Account', 'Departments', 'Review'] as const

export function AccessRequestPage() {
  const { currentUser, state, submitAccessRequest } = useAppData()
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
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

  const currentUserRequests = currentUser
    ? [...state.accessRequests]
        .filter((request) => request.userId === currentUser.id)
        .sort((left, right) => right.requestedAt.localeCompare(left.requestedAt))
    : []
  const pageDescription = isNewAccountFlow
    ? 'Set up your profile and choose the departments you need.'
    : 'Choose more departments and send your request.'
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
  const surfaceClass =
    "relative overflow-hidden rounded-[2.5rem] border border-white/50 bg-[linear-gradient(180deg,rgba(255,255,255,0.42),rgba(246,250,255,0.26),rgba(255,250,240,0.18))] px-6 py-6 shadow-[0_28px_56px_-44px_rgba(15,23,42,0.16)] backdrop-blur-2xl before:pointer-events-none before:absolute before:inset-x-[8%] before:top-0 before:h-16 before:rounded-b-[2rem] before:bg-[linear-gradient(180deg,rgba(255,255,255,0.38),transparent)] before:content-['']"
  const inputClassName =
    'h-12 rounded-[1.2rem] border-white/80 bg-[linear-gradient(180deg,rgba(228,238,255,0.78),rgba(245,249,255,0.96))] px-4 shadow-[0_16px_28px_-24px_rgba(30,58,138,0.28)] placeholder:text-slate-400 focus-visible:border-sky-300 focus-visible:ring-sky-200/70'
  const textareaClassName =
    'min-h-36 rounded-[1.55rem] border-white/80 bg-[linear-gradient(180deg,rgba(228,238,255,0.78),rgba(245,249,255,0.96))] px-4 py-4 shadow-[0_16px_28px_-24px_rgba(30,58,138,0.28)] placeholder:text-slate-400 focus-visible:border-sky-300 focus-visible:ring-sky-200/70'

  const onSubmit = form.handleSubmit(async (values) => {
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
    <div className="min-h-screen bg-[radial-gradient(circle_at_14%_16%,rgba(29,78,216,0.14),transparent_24%),radial-gradient(circle_at_82%_20%,rgba(56,189,248,0.13),transparent_22%),radial-gradient(circle_at_24%_78%,rgba(245,158,11,0.08),transparent_18%),linear-gradient(180deg,#f6fbff_0%,#edf6ff_40%,#eef8ff_100%)] px-4 py-6 md:px-6 md:py-8">
      <div className="mx-auto max-w-[84rem] space-y-8">
        <Button
          asChild
          variant="ghost"
          className="w-fit rounded-full border border-white/80 bg-white/70 px-4 shadow-[0_18px_34px_-28px_rgba(30,58,138,0.28)] backdrop-blur-sm transition-transform duration-300 hover:-translate-y-0.5 hover:bg-white/85"
        >
          <Link to={backTarget}>
            <ArrowLeft className="h-4 w-4" />
            {backLabel}
          </Link>
        </Button>

        <section className="relative overflow-hidden rounded-[3rem] border border-white/60 bg-[linear-gradient(135deg,rgba(255,255,255,0.52),rgba(241,248,255,0.3),rgba(236,253,245,0.22),rgba(255,247,220,0.18))] px-5 py-6 shadow-[0_34px_70px_-54px_rgba(30,58,138,0.16)] backdrop-blur-2xl md:px-8 md:py-8">
          <div className="pointer-events-none absolute inset-0">
            <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.2)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.2)_1px,transparent_1px)] bg-[size:76px_76px] opacity-25 [mask-image:radial-gradient(circle_at_34%_40%,black_18%,transparent_76%)]" />
            <div className="absolute left-[-4%] top-[8%] h-48 w-48 rounded-full bg-white/56 blur-3xl md:h-64 md:w-64" />
            <div className="absolute right-[6%] top-[12%] h-72 w-72 rounded-full bg-sky-200/24 blur-3xl" />
            <div className="absolute bottom-[6%] left-[20%] h-56 w-56 rounded-full bg-amber-100/16 blur-3xl" />
            <div className="absolute inset-x-[12%] top-0 h-16 bg-[linear-gradient(180deg,rgba(255,255,255,0.34),transparent)]" />
            <div className="absolute right-[10%] top-[22%] hidden h-56 w-[22rem] rounded-[2.2rem] border border-white/28 bg-[linear-gradient(145deg,rgba(255,255,255,0.12),rgba(191,219,254,0.08),rgba(255,255,255,0.04))] shadow-[inset_0_1px_0_rgba(255,255,255,0.26)] backdrop-blur-md lg:block" />
            <div className="absolute right-[16%] top-[34%] hidden h-20 w-20 rounded-full border border-sky-200/40 lg:block" />
            <div className="absolute bottom-[21%] right-[16%] h-px w-44 bg-gradient-to-r from-transparent via-sky-300/45 to-transparent" />
            <div className="absolute bottom-[17%] right-[9%] h-px w-48 bg-gradient-to-r from-transparent via-amber-300/45 to-transparent" />
          </div>

          <div className="relative grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem] xl:items-end">
            <div className="space-y-5">
              <div className="inline-flex items-center gap-2 rounded-full border border-white/60 bg-[linear-gradient(180deg,rgba(255,255,255,0.42),rgba(255,255,255,0.2))] px-4 py-2 text-xs font-semibold uppercase tracking-[0.22em] text-[#1d4ed8] shadow-[0_18px_28px_-24px_rgba(30,58,138,0.18)] backdrop-blur-2xl">
                <ShieldCheck className="h-3.5 w-3.5" />
                Access request
              </div>

              <div className="space-y-4">
                <h1 className="font-display max-w-[9.8ch] text-4xl font-semibold leading-[0.88] tracking-tight text-slate-950 md:text-6xl lg:text-[5.65rem]">
                  {isNewAccountFlow ? (
                    <>
                      <span className="block">Create account</span>
                      <span className="block text-[#1d4ed8]">request access</span>
                    </>
                  ) : (
                    <>
                      <span className="block">Request access</span>
                      <span className="block text-[#1d4ed8]">for more services</span>
                    </>
                  )}
                </h1>
                <p className="max-w-xl text-base leading-8 text-slate-600 md:text-lg">
                  {pageDescription}
                </p>
              </div>
            </div>

            <div className="relative overflow-hidden rounded-[2.35rem] border border-white/55 bg-[linear-gradient(180deg,rgba(255,255,255,0.34),rgba(244,249,255,0.2),rgba(255,255,255,0.14))] p-5 shadow-[0_24px_52px_-40px_rgba(30,58,138,0.16)] backdrop-blur-2xl">
              <div className="pointer-events-none absolute inset-x-0 top-0 h-16 rounded-t-[2.35rem] bg-[linear-gradient(180deg,rgba(255,255,255,0.34),transparent)]" />
              <div className="relative space-y-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[#1d4ed8]">
                    Request flow
                  </p>
                  <span className="inline-flex items-center gap-2 rounded-full border border-white/60 bg-white/36 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-700 backdrop-blur-xl">
                    {formatCompactNumber(selectedCount)} selected
                  </span>
                </div>
                <div className="space-y-3">
                  {requestFlow.map((step, index) => (
                    <div
                      key={step}
                      className="rounded-[1.55rem] border border-white/55 bg-[linear-gradient(180deg,rgba(255,255,255,0.34),rgba(255,255,255,0.16))] px-4 py-4 shadow-[0_14px_26px_-24px_rgba(15,23,42,0.12)] backdrop-blur-xl"
                    >
                      <div className="mb-3 h-1 w-16 rounded-full bg-gradient-to-r from-[#1d4ed8] via-[#38bdf8] to-[#fbbf24]" />
                      <div className="flex items-center gap-3">
                        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[linear-gradient(135deg,#1d4ed8,#0ea5e9)] text-[11px] font-semibold text-white shadow-[0_12px_18px_-14px_rgba(30,58,138,0.42)]">
                          {index + 1}
                        </span>
                        <p className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-800">
                          {step}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>

        <form className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]" onSubmit={onSubmit}>
          <div className="space-y-6">
            <section className={surfaceClass}>
              <div className="pointer-events-none absolute inset-0">
                <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-[#1d4ed8] via-[#38bdf8] to-[#14b8a6]" />
                <div className="absolute right-[-6%] top-[-14%] h-44 w-44 rounded-full bg-sky-200/20 blur-3xl" />
              </div>

              <div className="relative space-y-6">
                <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
                  <div className="space-y-2">
                    <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[#1d4ed8]">Account</p>
                    <h2 className="font-display text-3xl text-slate-950">Profile details</h2>
                  </div>
                  <div className="rounded-full border border-white/85 bg-white/74 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-600">
                    {isNewAccountFlow ? 'New profile' : 'Current profile'}
                  </div>
                </div>

                <div className="grid gap-5 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="fullName">Full name</Label>
                    <Input
                      id="fullName"
                      placeholder="e.g. Hana Abera"
                      className={inputClassName}
                      {...form.register('fullName')}
                      disabled={Boolean(currentUser)}
                    />
                    {form.formState.errors.fullName ? (
                      <p className="text-sm text-rose-600">
                        {form.formState.errors.fullName.message}
                      </p>
                    ) : null}
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="email">Email</Label>
                    <Input
                      id="email"
                      type="email"
                      placeholder="name@internalmedicine.org"
                      className={inputClassName}
                      {...form.register('email')}
                      disabled={Boolean(currentUser)}
                    />
                    {form.formState.errors.email ? (
                      <p className="text-sm text-rose-600">
                        {form.formState.errors.email.message}
                      </p>
                    ) : null}
                  </div>
                </div>

                {!currentUser ? (
                  <div className="grid gap-5 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="password">Create password</Label>
                      <Input
                        id="password"
                        type="password"
                        placeholder="At least 8 characters"
                        className={inputClassName}
                        {...form.register('password')}
                      />
                      {form.formState.errors.password ? (
                        <p className="text-sm text-rose-600">
                          {form.formState.errors.password.message}
                        </p>
                      ) : null}
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="confirmPassword">Confirm password</Label>
                      <Input
                        id="confirmPassword"
                        type="password"
                        placeholder="Repeat your password"
                        className={inputClassName}
                        {...form.register('confirmPassword')}
                      />
                      {form.formState.errors.confirmPassword ? (
                        <p className="text-sm text-rose-600">
                          {form.formState.errors.confirmPassword.message}
                        </p>
                      ) : null}
                    </div>
                  </div>
                ) : null}
              </div>
            </section>

            <section className={surfaceClass}>
              <div className="pointer-events-none absolute inset-0">
                <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-[#1d4ed8] via-[#38bdf8] to-[#fbbf24]" />
                <div className="absolute right-[-8%] top-[-14%] h-48 w-48 rounded-full bg-sky-200/18 blur-3xl" />
              </div>

              <div className="relative space-y-6">
                <div className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[#1d4ed8]">Access lanes</p>
                  <h2 className="font-display text-3xl text-slate-950">Choose departments</h2>
                </div>

                <div className="space-y-5">
                  {familySections.map((family) => (
                    <div
                      key={family.key}
                      className="relative overflow-hidden rounded-[2rem] border border-white/85 bg-white/76 p-5 shadow-[0_20px_34px_-28px_rgba(15,23,42,0.16)]"
                    >
                      <div className="pointer-events-none absolute inset-0">
                        <div
                          className={cn(
                            'absolute inset-x-0 top-0 h-1 bg-gradient-to-r',
                            family.lineClass,
                          )}
                        />
                        <div
                          className={cn(
                            'absolute right-[-8%] top-[-18%] h-40 w-40 rounded-full blur-3xl',
                            family.glowClass,
                          )}
                        />
                      </div>

                      <div className="relative space-y-5">
                        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                          <div className="space-y-2">
                            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#1d4ed8]">
                              Service line
                            </p>
                            <h3 className="font-display text-[2rem] text-slate-950">{family.label}</h3>
                            <p className="text-sm text-slate-500">{family.description}</p>
                          </div>

                          <span
                            className={cn(
                              'inline-flex items-center gap-2 rounded-full border px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.18em] shadow-[0_14px_24px_-20px_rgba(15,23,42,0.15)]',
                              family.chipTone,
                            )}
                          >
                            {groupedDepartments[family.key].length} options
                          </span>
                        </div>

                        <Controller
                          control={form.control}
                          name="requestedDepartments"
                          render={({ field }) => (
                            <div className="grid gap-4 md:grid-cols-2">
                              {groupedDepartments[family.key].map((department) => {
                                const checked = field.value.includes(department.id)

                                return (
                                  <label
                                    key={department.id}
                                    className={cn(
                                      'group flex items-start gap-4 rounded-[1.7rem] border px-4 py-4 transition-[border-color,background-color,box-shadow] duration-200',
                                      checked
                                        ? 'border-sky-300 bg-[linear-gradient(145deg,rgba(255,255,255,0.74),rgba(239,247,255,0.58),rgba(255,248,225,0.42))] shadow-[0_22px_40px_-30px_rgba(14,165,233,0.2)] backdrop-blur-xl'
                                        : 'border-white/70 bg-[linear-gradient(180deg,rgba(255,255,255,0.42),rgba(255,255,255,0.22))] shadow-[0_14px_24px_-22px_rgba(15,23,42,0.12)] backdrop-blur-lg hover:border-sky-200 hover:bg-white/54',
                                    )}
                                  >
                                    <Checkbox
                                      className="mt-0.5 h-6 w-6 rounded-xl border-white/80 bg-white shadow-[0_14px_24px_-20px_rgba(15,23,42,0.2)]"
                                      checked={checked}
                                      onCheckedChange={(nextChecked) => {
                                        field.onChange(
                                          nextChecked
                                            ? [...field.value, department.id]
                                            : field.value.filter((value) => value !== department.id),
                                        )
                                      }}
                                    />
                                    <span className="min-w-0 space-y-1">
                                      <span className="block text-lg font-medium text-slate-900">
                                        {department.name}
                                      </span>
                                      <span className="block text-sm leading-6 text-slate-500">
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
                  <p className="text-sm text-rose-600">
                    {form.formState.errors.requestedDepartments.message}
                  </p>
                ) : null}
              </div>
            </section>

            <section className={surfaceClass}>
              <div className="pointer-events-none absolute inset-0">
                <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-[#14b8a6] via-[#38bdf8] to-[#fbbf24]" />
                <div className="absolute right-[-4%] top-[-12%] h-44 w-44 rounded-full bg-emerald-200/18 blur-3xl" />
              </div>

              <div className="relative space-y-5">
                <div className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#1d4ed8]">Notes</p>
                  <h2 className="font-display text-3xl text-slate-950">Reviewer note</h2>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="notes">Notes</Label>
                  <Textarea
                    id="notes"
                    className={textareaClassName}
                    {...form.register('notes')}
                  />
                  <div className="flex items-center justify-between gap-3 text-sm text-slate-500">
                    <span>Optional</span>
                    <span>{notesValue.length}/240</span>
                  </div>
                  {form.formState.errors.notes ? (
                    <p className="text-sm text-rose-600">
                      {form.formState.errors.notes.message}
                    </p>
                  ) : null}
                </div>
              </div>
            </section>
          </div>

          <aside className="space-y-6 xl:sticky xl:top-6 xl:self-start">
            <section className="relative overflow-hidden rounded-[2.5rem] border border-white/60 bg-[linear-gradient(180deg,rgba(255,255,255,0.58),rgba(243,248,255,0.42),rgba(255,249,238,0.3))] px-6 py-6 shadow-[0_30px_58px_-40px_rgba(30,58,138,0.18)] backdrop-blur-xl">
              <div className="pointer-events-none absolute inset-0">
                <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-[#1d4ed8] via-[#38bdf8] to-[#14b8a6]" />
                <div className="absolute right-[-8%] top-[-10%] h-52 w-52 rounded-full bg-sky-200/24 blur-3xl" />
                <div className="absolute bottom-[-12%] left-[8%] h-40 w-40 rounded-full bg-amber-100/18 blur-3xl" />
                <div className="absolute right-7 top-7 h-20 w-20 rounded-full border border-sky-200/45" />
              </div>

              <div className="relative space-y-5">
                <div className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[#1d4ed8]">Summary</p>
                  <h2 className="font-display text-3xl text-slate-950">Submit request</h2>
                </div>

                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
                  <div className="rounded-[1.45rem] border border-white/65 bg-[linear-gradient(180deg,rgba(255,255,255,0.42),rgba(255,255,255,0.22))] p-4 shadow-[0_16px_28px_-24px_rgba(15,23,42,0.14)] backdrop-blur-lg">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#1d4ed8]">Selected</p>
                    <p className="mt-3 text-3xl font-semibold text-slate-950">
                      {formatCompactNumber(selectedCount)}
                    </p>
                  </div>
                  <div className="rounded-[1.45rem] border border-white/65 bg-[linear-gradient(180deg,rgba(255,255,255,0.42),rgba(255,255,255,0.22))] p-4 shadow-[0_16px_28px_-24px_rgba(15,23,42,0.14)] backdrop-blur-lg">
                    <div className="flex items-center gap-2">
                      <LockKeyhole className="h-4 w-4 text-[#1d4ed8]" />
                      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#1d4ed8]">Approval</p>
                    </div>
                    <p className="mt-3 text-base font-semibold text-slate-950">Admin approval</p>
                  </div>
                </div>

                <div className="space-y-3 rounded-[1.85rem] border border-white/65 bg-[linear-gradient(180deg,rgba(255,255,255,0.42),rgba(255,255,255,0.2))] p-4 shadow-[0_16px_28px_-24px_rgba(15,23,42,0.14)] backdrop-blur-lg">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#1d4ed8]">Departments</p>
                  {selectedDepartments.length ? (
                    <div className="flex flex-wrap gap-2">
                      {selectedDepartments.map((department) => (
                        <span
                          key={department.id}
                          className="rounded-full border border-white/65 bg-white/42 px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-[0_10px_20px_-18px_rgba(15,23,42,0.14)] backdrop-blur-lg"
                        >
                          {department.name}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-slate-500">Choose at least one department.</p>
                  )}
                </div>

                {successMessage ? (
                  <div className="rounded-[1.6rem] border border-emerald-300/30 bg-emerald-100/55 p-4">
                    <div className="flex items-start gap-3">
                      <CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-700" />
                      <p className="text-sm leading-6 text-emerald-900">{successMessage}</p>
                    </div>
                  </div>
                ) : null}

                <Button
                  type="submit"
                  size="lg"
                  className="h-14 w-full rounded-[1.2rem] border-0 bg-[linear-gradient(90deg,#1d4ed8_0%,#0ea5e9_52%,#0f766e_100%)] text-base font-medium text-white shadow-[0_18px_36px_-20px_rgba(30,58,138,0.45)] transition-transform duration-300 hover:-translate-y-0.5 hover:brightness-105"
                >
                  Submit access request
                  <Send className="h-4 w-4" />
                </Button>
              </div>
            </section>

            {currentUser ? (
              <section className="relative overflow-hidden rounded-[2.2rem] border border-white/60 bg-[linear-gradient(180deg,rgba(255,255,255,0.52),rgba(243,248,255,0.38),rgba(255,255,255,0.34))] px-5 py-5 shadow-[0_24px_42px_-36px_rgba(30,58,138,0.16)] backdrop-blur-xl">
                <div className="pointer-events-none absolute inset-0">
                  <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-[#1d4ed8] via-[#38bdf8] to-[#fbbf24]" />
                </div>
                <div className="relative space-y-4">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[#1d4ed8]">Recent</p>
                    <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                      {formatCompactNumber(currentUserRequests.length)} total
                    </span>
                  </div>
                  {recentRequests.length ? (
                    <div className="space-y-3">
                      {recentRequests.map((request) => (
                        <div
                          key={request.id}
                          className="rounded-[1.35rem] border border-white/65 bg-white/42 p-4 shadow-[0_14px_24px_-22px_rgba(15,23,42,0.14)] backdrop-blur-lg"
                        >
                          <div className="flex items-center justify-between gap-3">
                            <p className="text-sm font-semibold text-slate-900">
                              {formatTimestamp(request.requestedAt)}
                            </p>
                            <Badge
                              variant={
                                request.status === 'approved'
                                  ? 'success'
                                  : request.status === 'rejected'
                                    ? 'danger'
                                    : 'warning'
                              }
                            >
                              {request.status}
                            </Badge>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-slate-500">No requests yet.</p>
                  )}
                </div>
              </section>
            ) : null}
          </aside>
        </form>

        {currentUser ? (
          <section className={surfaceClass}>
            <div className="pointer-events-none absolute inset-0">
              <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-[#1d4ed8] via-[#38bdf8] to-[#14b8a6]" />
              <div className="absolute right-[-4%] top-[-12%] h-44 w-44 rounded-full bg-sky-200/18 blur-3xl" />
            </div>

              <div className="relative space-y-5">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="space-y-2">
                    <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#1d4ed8]">History</p>
                    <h2 className="font-display text-3xl text-slate-950">Your requests</h2>
                  </div>
                  <div className="inline-flex items-center gap-2 rounded-full border border-white/80 bg-white/72 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-600 shadow-[0_14px_24px_-20px_rgba(15,23,42,0.15)]">
                    <Sparkles className="h-4 w-4 text-[#1d4ed8]" />
                    {formatCompactNumber(currentUserRequests.length)} requests
                </div>
              </div>

              {currentUserRequests.length ? (
                <div className="space-y-3">
                  {currentUserRequests.map((request) => (
                    <div
                      key={request.id}
                      className="rounded-[1.8rem] border border-white/65 bg-[linear-gradient(180deg,rgba(255,255,255,0.46),rgba(255,255,255,0.24))] p-5 shadow-[0_16px_30px_-24px_rgba(15,23,42,0.14)] backdrop-blur-lg"
                    >
                      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                        <div className="space-y-3">
                          <div className="flex flex-wrap gap-2">
                            {request.requestedAssignments.map((assignment) => (
                              <Badge key={`${request.id}-${assignment.departmentId}`} variant="info">
                                {
                                  departments.find(
                                    (department) => department.id === assignment.departmentId,
                                  )?.name
                                }
                              </Badge>
                            ))}
                          </div>

                          <div className="space-y-1 text-sm text-slate-500">
                            <p>{formatTimestamp(request.requestedAt)}</p>
                            {request.notes ? <p>{request.notes}</p> : null}
                          </div>
                        </div>

                        <Badge
                          variant={
                            request.status === 'approved'
                              ? 'success'
                              : request.status === 'rejected'
                                ? 'danger'
                                : 'warning'
                          }
                        >
                          {request.status}
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex min-h-[180px] flex-col items-center justify-center gap-4 rounded-[2rem] border border-dashed border-sky-100/90 bg-white/62 px-6 text-center text-slate-500">
                  <Sparkles className="h-5 w-5 text-sky-500" />
                  <p className="text-sm font-medium text-slate-700">No requests yet.</p>
                </div>
              )}
            </div>
          </section>
        ) : null}
      </div>
    </div>
  )
}
