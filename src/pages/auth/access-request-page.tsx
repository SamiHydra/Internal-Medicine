import { zodResolver } from '@hookform/resolvers/zod'
import { motion } from 'framer-motion'
import {
  ArrowLeft,
  CheckCircle2,
  LockKeyhole,
  Send,
  ShieldCheck,
  Sparkles,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
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
  const pageTitle = isNewAccountFlow
    ? 'Create your account and request access'
    : 'Request additional reporting access'
  const pageDescription = isNewAccountFlow
    ? 'Set up your profile and choose the departments you need.'
    : 'Choose more departments and send your request.'
  const requestedDepartments = form.watch('requestedDepartments')
  const notesValue = form.watch('notes') ?? ''
  const selectedDepartments = departments.filter((department) =>
    requestedDepartments.includes(department.id),
  )
  const selectedCount = selectedDepartments.length
  const pendingHistoryCount = currentUserRequests.filter(
    (request) => request.status === 'pending',
  ).length

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
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(14,165,233,0.12),_transparent_30%),radial-gradient(circle_at_bottom_right,_rgba(20,184,166,0.1),_transparent_35%),linear-gradient(180deg,_#f8fbff_0%,_#eef4fb_100%)] px-4 py-6 md:px-6 md:py-8">
      <div className="mx-auto max-w-7xl space-y-8">
        <Button
          asChild
          variant="ghost"
          className="w-fit rounded-full bg-white/60 px-4 shadow-[0_18px_40px_-30px_rgba(15,23,42,0.28)] backdrop-blur-sm"
        >
          <Link to={backTarget}>
            <ArrowLeft className="h-4 w-4" />
            {backLabel}
          </Link>
        </Button>

        <section className="relative overflow-hidden px-2 py-4 md:px-4">
          <div className="pointer-events-none absolute inset-0">
            <div className="login-grid-drift absolute inset-0 opacity-50" />
            <div className="login-ambient-drift absolute left-[-4%] top-[8%] h-44 w-44 rounded-full bg-white/56 blur-3xl md:h-56 md:w-56" />
            <div className="login-ambient-drift-reverse absolute right-[6%] top-[8%] h-64 w-64 rounded-full bg-sky-200/32 blur-3xl" />
            <div className="login-ambient-drift absolute bottom-[8%] left-[18%] h-56 w-56 rounded-full bg-teal-200/18 blur-3xl" />
            <div className="login-ring-orbit absolute right-[12%] top-[18%] h-24 w-24 rounded-full border border-sky-200/40" />
          </div>

          <div className="relative grid gap-8 xl:grid-cols-[minmax(0,1fr)_320px] xl:items-end">
            <motion.div
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              className="max-w-[760px] space-y-4"
            >
              <div className="inline-flex items-center gap-2 rounded-full bg-white/72 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-sky-700 shadow-[0_14px_30px_-24px_rgba(14,165,233,0.55)] backdrop-blur-sm">
                <ShieldCheck className="h-3.5 w-3.5" />
                Access request
              </div>
              <div className="space-y-0">
                <h1 className="font-display max-w-[11ch] text-4xl font-semibold leading-[0.95] tracking-tight text-slate-950 md:text-6xl lg:text-[4.9rem]">
                  {pageTitle}
                </h1>
                <p className="pt-5 text-sm font-semibold uppercase tracking-[0.24em] text-slate-500 md:pt-6 md:text-[0.8rem]">
                  {isNewAccountFlow ? 'New account / admin review' : 'Additional access / admin review'}
                </p>
              </div>
              <p className="max-w-2xl text-base leading-8 text-slate-600 md:text-lg">
                {pageDescription}
              </p>
              <div className="flex flex-wrap gap-2.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                {familySections.map((section, index) => (
                  <span
                    key={section.key}
                    className="login-chip-float rounded-full border border-white/70 bg-white/55 px-3 py-2 backdrop-blur-sm"
                    style={{ animationDelay: `${index * 700}ms` }}
                  >
                    {section.label}
                  </span>
                ))}
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
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-sky-700">Selected</p>
                  <p className="mt-2 font-display text-4xl leading-none text-slate-950">
                    {formatCompactNumber(selectedCount)}
                  </p>
                </div>
                <div className="space-y-1 border-b border-white/70 pb-4 sm:border-b-0 sm:pb-0 sm:pl-4">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-sky-700">History</p>
                  <p className="mt-2 font-display text-4xl leading-none text-slate-950">
                    {formatCompactNumber(currentUserRequests.length)}
                  </p>
                </div>
              </div>

              <div className="grid gap-4 border-t border-white/70 pt-4 sm:grid-cols-2">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-sky-700">Mode</p>
                  <p className="mt-2 text-lg font-semibold text-slate-950">
                    {isNewAccountFlow ? 'New account' : 'Add access'}
                  </p>
                </div>
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-sky-700">Pending</p>
                  <p className="mt-2 text-lg font-semibold text-slate-950">
                    {formatCompactNumber(pendingHistoryCount)}
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
          <div className="relative grid gap-6 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-center">
            <div className="space-y-3">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-sky-700">Request flow</p>
              <div className="flex flex-wrap gap-2">
                {requestFlow.map((step, index) => (
                  <span
                    key={step}
                    className="inline-flex items-center gap-2 rounded-full border border-white/80 bg-white/72 px-4 py-2 text-sm font-semibold text-slate-700 shadow-[0_14px_24px_-20px_rgba(15,23,42,0.15)]"
                  >
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-950 text-[11px] font-semibold text-white">
                      {index + 1}
                    </span>
                    {step}
                  </span>
                ))}
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-3 xl:min-w-[420px]">
              <div className="border-l border-white/65 pl-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-sky-700">Profile</p>
                <p className="mt-2 text-sm font-semibold text-slate-950">
                  {isNewAccountFlow ? 'New account' : 'Current account'}
                </p>
              </div>
              <div className="border-l border-white/65 pl-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-sky-700">Departments</p>
                <p className="mt-2 text-sm font-semibold text-slate-950">{formatCompactNumber(selectedCount)}</p>
              </div>
              <div className="border-l border-white/65 pl-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-sky-700">Review</p>
                <p className="mt-2 text-sm font-semibold text-slate-950">Admin approval</p>
              </div>
            </div>
          </div>
        </motion.section>

        <form className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]" onSubmit={onSubmit}>
          <div className="space-y-6">
            <motion.section
              initial={{ opacity: 0, y: 18 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.2 }}
              className="relative overflow-hidden rounded-[2.4rem] border border-white/70 bg-[linear-gradient(180deg,rgba(255,255,255,0.96),rgba(242,248,255,0.84))] px-5 py-6 shadow-[0_24px_54px_-36px_rgba(15,23,42,0.22)]"
            >
              <div className="pointer-events-none absolute inset-0">
                <div className="login-grid-drift absolute inset-0 opacity-12" />
                <div className="login-ambient-drift absolute right-[-4%] top-[-12%] h-44 w-44 rounded-full bg-sky-200/12 blur-3xl" />
                <div className="login-line-flow absolute inset-x-6 top-0 h-1 bg-gradient-to-r from-cyan-400 via-sky-500 to-emerald-400" />
              </div>

              <div className="relative space-y-5">
                <div className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-sky-700">Profile</p>
                  <h2 className="font-display text-3xl text-slate-950">Basic details</h2>
                  <p className="text-sm text-slate-500">Enter your account information.</p>
                </div>

                <div className="grid gap-5 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="fullName">Full name</Label>
                    <Input
                      id="fullName"
                      placeholder="e.g. Hana Abera"
                      className="h-12 rounded-2xl border-slate-200/80 bg-[linear-gradient(180deg,rgba(255,255,255,0.96),rgba(248,251,255,0.92))] px-4 shadow-[0_16px_32px_-24px_rgba(15,23,42,0.22)]"
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
                      className="h-12 rounded-2xl border-slate-200/80 bg-[linear-gradient(180deg,rgba(255,255,255,0.96),rgba(248,251,255,0.92))] px-4 shadow-[0_16px_32px_-24px_rgba(15,23,42,0.22)]"
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
                        className="h-12 rounded-2xl border-slate-200/80 bg-[linear-gradient(180deg,rgba(255,255,255,0.96),rgba(248,251,255,0.92))] px-4 shadow-[0_16px_32px_-24px_rgba(15,23,42,0.22)]"
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
                        className="h-12 rounded-2xl border-slate-200/80 bg-[linear-gradient(180deg,rgba(255,255,255,0.96),rgba(248,251,255,0.92))] px-4 shadow-[0_16px_32px_-24px_rgba(15,23,42,0.22)]"
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
            </motion.section>

            {familySections.map((family, familyIndex) => (
              <motion.section
                key={family.key}
                initial={{ opacity: 0, y: 18 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, amount: 0.2 }}
                transition={{ delay: familyIndex * 0.03 }}
                className="relative overflow-hidden rounded-[2.4rem] border border-white/70 bg-[linear-gradient(180deg,rgba(255,255,255,0.96),rgba(242,248,255,0.84))] px-5 py-6 shadow-[0_24px_54px_-36px_rgba(15,23,42,0.22)]"
              >
                <div className="pointer-events-none absolute inset-0">
                  <div className="login-grid-drift absolute inset-0 opacity-12" />
                  <div
                    className={cn(
                      'login-ambient-drift absolute right-[-4%] top-[-12%] h-44 w-44 rounded-full blur-3xl',
                      family.glowClass,
                    )}
                  />
                  <div
                    className={cn(
                      'login-line-flow absolute inset-x-6 top-0 h-1 bg-gradient-to-r',
                      family.lineClass,
                    )}
                  />
                </div>

                <div className="relative space-y-5">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="space-y-2">
                      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-sky-700">Service line</p>
                      <h2 className="font-display text-3xl text-slate-950">{family.label}</h2>
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
                                'group flex items-start gap-4 rounded-[1.6rem] border px-4 py-4 transition-all duration-300 hover:-translate-y-0.5',
                                checked
                                  ? 'border-sky-300 bg-[linear-gradient(145deg,rgba(255,255,255,0.98),rgba(241,249,255,0.9),rgba(236,253,245,0.72))] shadow-[0_22px_40px_-28px_rgba(14,165,233,0.22)]'
                                  : 'border-slate-200/80 bg-white/82 shadow-[0_14px_24px_-22px_rgba(15,23,42,0.14)] hover:border-sky-200 hover:bg-white/92',
                              )}
                            >
                              <Checkbox
                                className="mt-0.5 h-6 w-6 rounded-xl border-slate-200/80 bg-white shadow-[0_14px_24px_-20px_rgba(15,23,42,0.2)]"
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
              </motion.section>
            ))}

            {form.formState.errors.requestedDepartments ? (
              <p className="text-sm text-rose-600">
                {form.formState.errors.requestedDepartments.message}
              </p>
            ) : null}

            <motion.section
              initial={{ opacity: 0, y: 18 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.2 }}
              className="relative overflow-hidden rounded-[2.4rem] border border-white/70 bg-[linear-gradient(180deg,rgba(255,255,255,0.96),rgba(242,248,255,0.84))] px-5 py-6 shadow-[0_24px_54px_-36px_rgba(15,23,42,0.22)]"
            >
              <div className="pointer-events-none absolute inset-0">
                <div className="login-grid-drift absolute inset-0 opacity-12" />
                <div className="login-ambient-drift absolute right-[-4%] top-[-12%] h-44 w-44 rounded-full bg-emerald-200/12 blur-3xl" />
                <div className="login-line-flow absolute inset-x-6 top-0 h-1 bg-gradient-to-r from-cyan-400 via-sky-500 to-emerald-400" />
              </div>

              <div className="relative space-y-5">
                <div className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-sky-700">Notes</p>
                  <h2 className="font-display text-3xl text-slate-950">Reviewer note</h2>
                  <p className="text-sm text-slate-500">Optional context for approval.</p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="notes">Notes</Label>
                  <Textarea
                    id="notes"
                    className="min-h-36 rounded-[1.5rem] border-slate-200/80 bg-[linear-gradient(180deg,rgba(255,255,255,0.96),rgba(248,251,255,0.92))] px-4 py-4 shadow-[0_16px_32px_-24px_rgba(15,23,42,0.22)]"
                    {...form.register('notes')}
                  />
                  <div className="flex items-center justify-between gap-3 text-sm text-slate-500">
                    <span>Optional note for the reviewer.</span>
                    <span>{notesValue.length}/240</span>
                  </div>
                  {form.formState.errors.notes ? (
                    <p className="text-sm text-rose-600">
                      {form.formState.errors.notes.message}
                    </p>
                  ) : null}
                </div>
              </div>
            </motion.section>
          </div>

          <motion.aside
            initial={{ opacity: 0, y: 18 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.2 }}
            className="xl:sticky xl:top-6 xl:self-start"
          >
            <section className="relative overflow-hidden rounded-[2.4rem] border border-white/10 bg-[linear-gradient(160deg,#07152d_0%,#0b3156_42%,#0f4c81_72%,#0f766e_100%)] px-5 py-6 text-white shadow-[0_30px_58px_-32px_rgba(8,47,73,0.76)]">
              <div className="pointer-events-none absolute inset-0">
                <div className="login-grid-drift absolute inset-0 opacity-18" />
                <div className="login-ambient-drift absolute right-[-8%] top-[-10%] h-52 w-52 rounded-full bg-cyan-300/12 blur-3xl" />
                <div className="login-line-flow absolute inset-x-6 top-0 h-1 bg-gradient-to-r from-cyan-300 via-sky-400 to-emerald-300" />
              </div>

              <div className="relative space-y-5">
                <div className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-100">Selection</p>
                  <h2 className="font-display text-3xl text-white">Request summary</h2>
                  <p className="text-sm text-cyan-50/72">Review before sending.</p>
                </div>

                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
                  <div className="rounded-[1.4rem] border border-white/12 bg-white/8 p-4 backdrop-blur-sm">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-100/72">Selected</p>
                    <p className="mt-3 text-3xl font-semibold text-white">
                      {formatCompactNumber(selectedCount)}
                    </p>
                  </div>
                  <div className="rounded-[1.4rem] border border-white/12 bg-white/8 p-4 backdrop-blur-sm">
                    <div className="flex items-center gap-2">
                      <LockKeyhole className="h-4 w-4 text-cyan-100" />
                      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-100/72">Review</p>
                    </div>
                    <p className="mt-3 text-base font-semibold text-white">Admin approval</p>
                    <p className="text-sm text-cyan-50/72">Access starts after approval.</p>
                  </div>
                </div>

                <div className="space-y-3 rounded-[1.7rem] border border-white/12 bg-white/8 p-4 backdrop-blur-sm">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-100/72">Departments</p>
                  {selectedDepartments.length ? (
                    <div className="flex flex-wrap gap-2">
                      {selectedDepartments.map((department) => (
                        <span
                          key={department.id}
                          className="rounded-full border border-white/12 bg-white/10 px-3 py-1.5 text-xs font-semibold text-cyan-50"
                        >
                          {department.name}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-cyan-50/72">Choose at least one department.</p>
                  )}
                </div>

                {successMessage ? (
                  <div className="rounded-[1.6rem] border border-emerald-300/18 bg-emerald-400/10 p-4 backdrop-blur-sm">
                    <div className="flex items-start gap-3">
                      <CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-200" />
                      <p className="text-sm leading-6 text-emerald-50">{successMessage}</p>
                    </div>
                  </div>
                ) : null}

                <Button type="submit" size="lg" className="w-full">
                  Submit access request
                  <Send className="h-4 w-4" />
                </Button>
              </div>
            </section>
          </motion.aside>
        </form>

        {currentUser ? (
          <motion.section
            initial={{ opacity: 0, y: 18 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.2 }}
            className="relative overflow-hidden rounded-[2.4rem] border border-white/70 bg-[linear-gradient(180deg,rgba(255,255,255,0.96),rgba(242,248,255,0.84))] px-5 py-6 shadow-[0_24px_54px_-36px_rgba(15,23,42,0.22)]"
          >
            <div className="pointer-events-none absolute inset-0">
              <div className="login-grid-drift absolute inset-0 opacity-12" />
              <div className="login-ambient-drift absolute right-[-4%] top-[-12%] h-44 w-44 rounded-full bg-sky-200/12 blur-3xl" />
              <div className="login-line-flow absolute inset-x-6 top-0 h-1 bg-gradient-to-r from-cyan-400 via-sky-500 to-emerald-400" />
            </div>

            <div className="relative space-y-5">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-sky-700">History</p>
                  <h2 className="font-display text-3xl text-slate-950">Your requests</h2>
                  <p className="text-sm text-slate-500">Pending and reviewed requests.</p>
                </div>
                <div className="inline-flex items-center gap-2 rounded-full border border-white/80 bg-white/72 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-600 shadow-[0_14px_24px_-20px_rgba(15,23,42,0.15)]">
                  <Sparkles className="h-4 w-4 text-sky-700" />
                  {formatCompactNumber(currentUserRequests.length)} requests
                </div>
              </div>

              {currentUserRequests.length ? (
                <div className="space-y-3">
                  {currentUserRequests.map((request, index) => (
                    <motion.div
                      key={request.id}
                      initial={{ opacity: 0, y: 12 }}
                      whileInView={{ opacity: 1, y: 0 }}
                      viewport={{ once: true, amount: 0.2 }}
                      transition={{ delay: index * 0.03 }}
                      className="rounded-[1.7rem] border border-slate-200/80 bg-white/82 p-5 shadow-[0_16px_30px_-24px_rgba(15,23,42,0.18)]"
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
                    </motion.div>
                  ))}
                </div>
              ) : (
                <div className="flex min-h-[180px] flex-col items-center justify-center gap-4 rounded-[1.9rem] border border-dashed border-sky-100/90 bg-white/62 px-6 text-center text-slate-500">
                  <Sparkles className="h-5 w-5 text-sky-500" />
                  <div className="space-y-2">
                    <p className="text-sm font-medium text-slate-700">No requests yet.</p>
                    <p className="text-sm leading-6 text-slate-500">Submitted requests will appear here.</p>
                  </div>
                </div>
              )}
            </div>
          </motion.section>
        ) : null}
      </div>
    </div>
  )
}
