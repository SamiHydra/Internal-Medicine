import { zodResolver } from '@hookform/resolvers/zod'
import { addHours, format } from 'date-fns'
import { motion } from 'framer-motion'
import { useEffect } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { Clock3, Lock, Save, Settings2, Sparkles, TrendingUpDown } from 'lucide-react'
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
import { useAppData } from '@/context/app-data-context'
import { getCurrentPeriod } from '@/data/selectors'
import { getDeadlineForPeriod } from '@/lib/dates'
import { formatCompactNumber } from '@/lib/utils'
import type { Weekday } from '@/types/domain'

const settingsSchema = z.object({
  weeklyDeadlineDay: z.enum([
    'monday',
    'tuesday',
    'wednesday',
    'thursday',
    'friday',
    'saturday',
    'sunday',
  ]),
  weeklyDeadlineTime: z.string().regex(/^\d{2}:\d{2}$/),
  autoLockHoursAfterDeadline: z.coerce.number().min(1),
  notableRiseThresholdPercent: z.coerce.number().min(1),
  notableDropThresholdPercent: z.coerce.number().min(1),
})

type SettingsValues = z.infer<typeof settingsSchema>

const weekdayOptions: Weekday[] = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
]

function formatWeekdayLabel(day: Weekday) {
  return `${day.slice(0, 1).toUpperCase()}${day.slice(1)}`
}

function formatTimeLabel(value: string) {
  const [hours, minutes] = value.split(':').map(Number)
  const date = new Date()
  date.setHours(hours, minutes, 0, 0)

  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  }).format(date)
}

export function SettingsPage() {
  const { state, updateSettings } = useAppData()
  const form = useForm<SettingsValues>({
    resolver: zodResolver(settingsSchema) as never,
    defaultValues: state.settings,
  })

  useEffect(() => {
    form.reset(state.settings)
  }, [form, state.settings])

  const watchedValues = form.watch()
  const deadlineDay = watchedValues.weeklyDeadlineDay ?? state.settings.weeklyDeadlineDay
  const deadlineTime = watchedValues.weeklyDeadlineTime ?? state.settings.weeklyDeadlineTime
  const autoLockHours = Number(
    watchedValues.autoLockHoursAfterDeadline ?? state.settings.autoLockHoursAfterDeadline,
  )
  const riseThreshold = Number(
    watchedValues.notableRiseThresholdPercent ?? state.settings.notableRiseThresholdPercent,
  )
  const dropThreshold = Number(
    watchedValues.notableDropThresholdPercent ?? state.settings.notableDropThresholdPercent,
  )

  const currentPeriod = getCurrentPeriod(state)
  const previewDeadline = currentPeriod
    ? getDeadlineForPeriod(currentPeriod, deadlineDay, deadlineTime)
    : null
  const previewLockAt = previewDeadline ? addHours(previewDeadline, autoLockHours) : null
  const criticalFieldCount = state.settings.criticalNonZeroFields.length

  const onSubmit = form.handleSubmit(async (values) => {
    await updateSettings(values)
  })

  return (
    <div className="space-y-8">
      <section className="relative overflow-hidden px-2 py-4 md:px-4">
        <div className="pointer-events-none absolute inset-0">
          <div className="login-grid-drift absolute inset-0 opacity-50" />
          <div className="login-ambient-drift absolute left-[-4%] top-[8%] h-44 w-44 rounded-full bg-white/56 blur-3xl md:h-56 md:w-56" />
          <div className="login-ambient-drift-reverse absolute right-[6%] top-[8%] h-64 w-64 rounded-full bg-sky-200/32 blur-3xl" />
          <div className="login-ambient-drift absolute bottom-[8%] left-[18%] h-56 w-56 rounded-full bg-teal-200/18 blur-3xl" />
          <div className="login-ring-orbit absolute right-[12%] top-[18%] h-24 w-24 rounded-full border border-sky-200/40" />
          <div className="login-line-flow absolute bottom-[18%] right-[10%] h-px w-32 bg-gradient-to-r from-transparent via-sky-300/65 to-transparent" />
        </div>

        <div className="relative grid gap-8 xl:grid-cols-[minmax(0,1fr)_320px] xl:items-end">
          <motion.div
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            className="max-w-[760px] space-y-4"
          >
            <div className="inline-flex items-center gap-2 rounded-full bg-white/72 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-sky-700 shadow-[0_14px_30px_-24px_rgba(14,165,233,0.55)] backdrop-blur-sm">
              <span className="h-2 w-2 rounded-full bg-sky-500" />
              Settings
            </div>

            <div className="space-y-0">
              <h1 className="font-display max-w-[8ch] text-5xl font-semibold leading-[0.9] tracking-tight text-slate-950 md:text-[5.6rem] xl:text-[6.2rem]">
                Workflow rules
              </h1>
              <p className="pt-5 text-sm font-semibold uppercase tracking-[0.24em] text-slate-500 md:pt-6 md:text-[0.8rem]">
                {formatWeekdayLabel(deadlineDay)} deadline / {formatTimeLabel(deadlineTime)} /{' '}
                {autoLockHours}h lock window
              </p>
            </div>

            <div className="flex flex-wrap gap-2.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
              <span className="login-chip-float rounded-full border border-white/70 bg-white/55 px-3 py-2 backdrop-blur-sm">
                {riseThreshold}% rise alert
              </span>
              <span
                className="login-chip-float rounded-full border border-white/70 bg-white/55 px-3 py-2 backdrop-blur-sm"
                style={{ animationDelay: '700ms' }}
              >
                {dropThreshold}% drop alert
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
                  Deadline
                </p>
                <p className="mt-2 text-lg font-semibold text-slate-950">
                  {formatWeekdayLabel(deadlineDay)}
                </p>
              </div>
              <div className="space-y-1 border-b border-white/70 pb-4 sm:border-b-0 sm:pb-0 sm:pl-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-sky-700">
                  Time
                </p>
                <p className="mt-2 text-lg font-semibold text-slate-950">
                  {formatTimeLabel(deadlineTime)}
                </p>
              </div>
            </div>

            <div className="grid gap-4 border-t border-white/70 pt-4 sm:grid-cols-2">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-sky-700">
                  Auto-lock
                </p>
                <p className="mt-2 text-lg font-semibold text-slate-950">
                  {autoLockHours}h
                </p>
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-sky-700">
                  Critical fields
                </p>
                <p className="mt-2 text-lg font-semibold text-slate-950">
                  {formatCompactNumber(criticalFieldCount)}
                </p>
              </div>
            </div>
          </motion.div>
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
        <motion.section
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, ease: 'easeOut' }}
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
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-sky-700">
                  Workflow
                </p>
                <h2 className="font-display text-3xl text-slate-950">Rule settings</h2>
                <p className="text-sm text-slate-500">Deadlines and alerts.</p>
              </div>
              <div className="rounded-full border border-white/80 bg-white/72 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-600 shadow-[0_14px_24px_-20px_rgba(15,23,42,0.15)]">
                {form.formState.isDirty ? 'Unsaved changes' : 'Saved'}
              </div>
            </div>

            <form className="space-y-6" onSubmit={onSubmit}>
              <div className="grid gap-5 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>Weekly deadline day</Label>
                  <Controller
                    control={form.control}
                    name="weeklyDeadlineDay"
                    render={({ field }) => (
                      <Select
                        value={field.value}
                        onValueChange={(value) => field.onChange(value as Weekday)}
                      >
                        <SelectTrigger className="bg-white/84">
                          <SelectValue placeholder="Deadline day" />
                        </SelectTrigger>
                        <SelectContent>
                          {weekdayOptions.map((day) => (
                            <SelectItem key={day} value={day}>
                              {formatWeekdayLabel(day)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  />
                </div>

                <div className="space-y-2">
                  <Label>Deadline time</Label>
                  <Input
                    type="time"
                    className="h-12 rounded-2xl border-slate-200/80 bg-[linear-gradient(180deg,rgba(255,255,255,0.96),rgba(248,251,255,0.92))] px-4 shadow-[0_16px_32px_-24px_rgba(15,23,42,0.22)]"
                    {...form.register('weeklyDeadlineTime')}
                  />
                </div>

                <div className="space-y-2">
                  <Label>Auto-lock hours after deadline</Label>
                  <Input
                    type="number"
                    className="h-12 rounded-2xl border-slate-200/80 bg-[linear-gradient(180deg,rgba(255,255,255,0.96),rgba(248,251,255,0.92))] px-4 shadow-[0_16px_32px_-24px_rgba(15,23,42,0.22)]"
                    {...form.register('autoLockHoursAfterDeadline')}
                  />
                </div>

                <div className="space-y-2">
                  <Label>Notable rise threshold (%)</Label>
                  <Input
                    type="number"
                    className="h-12 rounded-2xl border-slate-200/80 bg-[linear-gradient(180deg,rgba(255,255,255,0.96),rgba(248,251,255,0.92))] px-4 shadow-[0_16px_32px_-24px_rgba(15,23,42,0.22)]"
                    {...form.register('notableRiseThresholdPercent')}
                  />
                </div>

                <div className="space-y-2 md:col-span-2">
                  <Label>Notable drop threshold (%)</Label>
                  <Input
                    type="number"
                    className="h-12 rounded-2xl border-slate-200/80 bg-[linear-gradient(180deg,rgba(255,255,255,0.96),rgba(248,251,255,0.92))] px-4 shadow-[0_16px_32px_-24px_rgba(15,23,42,0.22)]"
                    {...form.register('notableDropThresholdPercent')}
                  />
                </div>
              </div>

              <div className="flex flex-col gap-4 border-t border-slate-100/90 pt-5 sm:flex-row sm:items-center sm:justify-between">
                <div className="space-y-1">
                  <p className="text-sm font-medium text-slate-700">
                    {previewDeadline
                      ? `Next deadline ${format(previewDeadline, 'EEE, MMM d / HH:mm')}.`
                      : 'Rules apply to the current week.'}
                  </p>
                  <p className="text-sm text-slate-500">
                    {previewLockAt
                      ? `Auto-lock ${format(previewLockAt, 'EEE, MMM d / HH:mm')}.`
                      : 'Set a deadline to preview lock timing.'}
                  </p>
                </div>

                <Button type="submit" disabled={form.formState.isSubmitting}>
                  <Save className="h-4 w-4" />
                  {form.formState.isSubmitting ? 'Saving...' : 'Save settings'}
                </Button>
              </div>
            </form>
          </div>
        </motion.section>

        <motion.section
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, ease: 'easeOut' }}
          className="relative overflow-hidden rounded-[2.4rem] border border-white/10 bg-[linear-gradient(160deg,#07152d_0%,#0b3156_42%,#0f4c81_72%,#0f766e_100%)] px-5 py-6 text-white shadow-[0_30px_58px_-32px_rgba(8,47,73,0.76)]"
        >
          <div className="pointer-events-none absolute inset-0">
            <div className="login-grid-drift absolute inset-0 opacity-18" />
            <div className="login-ambient-drift absolute right-[-8%] top-[-10%] h-52 w-52 rounded-full bg-cyan-300/12 blur-3xl" />
            <div className="login-line-flow absolute inset-x-6 top-0 h-1 bg-gradient-to-r from-cyan-300 via-sky-400 to-emerald-300" />
          </div>

          <div className="relative space-y-5">
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-100">
                Live rule set
              </p>
              <h2 className="font-display text-3xl text-white">Current week</h2>
              <p className="text-sm text-cyan-50/72">
                {currentPeriod ? currentPeriod.label : 'No active reporting week.'}
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-[1.4rem] border border-white/12 bg-white/8 p-4 backdrop-blur-sm">
                <div className="flex items-center gap-2">
                  <Clock3 className="h-4 w-4 text-cyan-100" />
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-100/72">
                    Deadline
                  </p>
                </div>
                <p className="mt-3 text-base font-semibold text-white">
                  {previewDeadline ? format(previewDeadline, 'EEE, MMM d') : '-'}
                </p>
                <p className="text-sm text-cyan-50/72">
                  {previewDeadline ? format(previewDeadline, 'HH:mm') : '-'}
                </p>
              </div>

              <div className="rounded-[1.4rem] border border-white/12 bg-white/8 p-4 backdrop-blur-sm">
                <div className="flex items-center gap-2">
                  <Lock className="h-4 w-4 text-cyan-100" />
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-100/72">
                    Lock at
                  </p>
                </div>
                <p className="mt-3 text-base font-semibold text-white">
                  {previewLockAt ? format(previewLockAt, 'EEE, MMM d') : '-'}
                </p>
                <p className="text-sm text-cyan-50/72">
                  {previewLockAt ? format(previewLockAt, 'HH:mm') : '-'}
                </p>
              </div>

              <div className="rounded-[1.4rem] border border-white/12 bg-white/8 p-4 backdrop-blur-sm">
                <div className="flex items-center gap-2">
                  <TrendingUpDown className="h-4 w-4 text-cyan-100" />
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-100/72">
                    Rise
                  </p>
                </div>
                <p className="mt-3 text-base font-semibold text-white">{riseThreshold}%</p>
                <p className="text-sm text-cyan-50/72">Alert threshold</p>
              </div>

              <div className="rounded-[1.4rem] border border-white/12 bg-white/8 p-4 backdrop-blur-sm">
                <div className="flex items-center gap-2">
                  <TrendingUpDown className="h-4 w-4 text-cyan-100" />
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-100/72">
                    Drop
                  </p>
                </div>
                <p className="mt-3 text-base font-semibold text-white">{dropThreshold}%</p>
                <p className="text-sm text-cyan-50/72">Alert threshold</p>
              </div>
            </div>

            <div className="rounded-[1.7rem] border border-white/12 bg-white/8 p-4 backdrop-blur-sm">
              <div className="flex items-center gap-3">
                <div className="rounded-[1rem] border border-white/12 bg-white/8 p-3">
                  <Settings2 className="h-4 w-4 text-cyan-100" />
                </div>
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-100/72">
                    Coverage
                  </p>
                  <p className="mt-1 text-base font-semibold text-white">
                    {formatCompactNumber(criticalFieldCount)} critical fields
                  </p>
                </div>
              </div>
            </div>

            <div className="rounded-[1.7rem] border border-white/12 bg-white/8 p-4 backdrop-blur-sm">
              <div className="flex items-center gap-3">
                <div className="rounded-[1rem] border border-white/12 bg-white/8 p-3">
                  <Sparkles className="h-4 w-4 text-cyan-100" />
                </div>
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-100/72">
                    Rule note
                  </p>
                  <p className="mt-1 text-sm leading-6 text-cyan-50/72">
                    Dashboard alerts and lock timing use this rule set.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </motion.section>
      </section>
    </div>
  )
}
