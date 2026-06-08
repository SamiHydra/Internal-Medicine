import { zodResolver } from '@hookform/resolvers/zod'
import { addHours, format } from 'date-fns'
import { motion } from 'framer-motion'
import { useEffect } from 'react'
import { Controller, useForm, useWatch } from 'react-hook-form'
import { Clock3, Lock, PhoneCall, Save } from 'lucide-react'
import { z } from 'zod'

import { Button } from '@/components/ui/button'
import { technicalSupport } from '@/config/support'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
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
import { cn, formatCompactNumber } from '@/lib/utils'
import type { Weekday } from '@/types/domain'

const sectionClass =
  'rounded-[0.35rem] bg-white px-5 py-6 outline outline-1 outline-[#d4dde8] shadow-[0_24px_60px_-42px_rgba(0,33,71,0.28)] md:px-6 md:py-7'
const countChipClass =
  'inline-flex items-center gap-2 self-start rounded-full bg-[#f4f7fb] px-3.5 py-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] outline outline-1 outline-[#e3e9f1]'

function SectionEyebrow({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2">
      <span aria-hidden="true" className="h-3 w-[3px] rounded-full bg-[#f0b429]" />
      <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#005db6]">{label}</p>
    </div>
  )
}

const settingsSchema = z.object({
  deadlineEnforced: z.boolean(),
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

export function SettingsPage() {
  const { state, updateSettings } = useAppData()
  const form = useForm<SettingsValues>({
    resolver: zodResolver(settingsSchema) as never,
    defaultValues: state.settings,
  })

  useEffect(() => {
    form.reset(state.settings)
  }, [form, state.settings])

  const watchedValues = useWatch({
    control: form.control,
  })
  const deadlineEnforced = watchedValues.deadlineEnforced ?? state.settings.deadlineEnforced
  const deadlineDay = watchedValues.weeklyDeadlineDay ?? state.settings.weeklyDeadlineDay
  const deadlineTime = watchedValues.weeklyDeadlineTime ?? state.settings.weeklyDeadlineTime
  const autoLockHours = Number(
    watchedValues.autoLockHoursAfterDeadline ?? state.settings.autoLockHoursAfterDeadline,
  )

  const currentPeriod = getCurrentPeriod(state)
  const previewDeadline = currentPeriod && deadlineEnforced
    ? getDeadlineForPeriod(currentPeriod, deadlineDay, deadlineTime)
    : null
  const previewLockAt = previewDeadline ? addHours(previewDeadline, autoLockHours) : null
  const criticalFieldCount = state.settings.criticalNonZeroFields.length

  const onSubmit = form.handleSubmit(async (values) => {
    await updateSettings(values)
  })

  return (
    <div className="space-y-6 px-4 py-5 md:px-6 md:py-8">
      <section className="grid gap-6 lg:grid-cols-[1.05fr_0.95fr]">
        <motion.section
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, ease: 'easeOut' }}
          className={sectionClass}
        >
          <div className="space-y-5">
            <div className="flex flex-col gap-4 border-b border-[#eef2f6] pb-5 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <SectionEyebrow label="Workflow" />
                <h2 className="mt-1 font-display text-[1.4rem] font-bold tracking-[-0.02em] text-[#000a1e] md:text-[1.6rem]">
                  Rule settings
                </h2>
                <p className="mt-1 text-sm text-[#74777f]">Deadlines, auto-lock, and alert thresholds.</p>
              </div>
              <span
                className={cn(
                  countChipClass,
                  form.formState.isDirty ? 'text-[#8a5a00]' : 'text-[#44474e]',
                )}
              >
                {form.formState.isDirty ? 'Unsaved changes' : 'Saved'}
              </span>
            </div>

            <form className="space-y-6" onSubmit={onSubmit}>
              <div className="rounded-[0.35rem] border border-[#e6ecf3] bg-[#f7f9fc] px-4 py-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="space-y-1">
                    <Label htmlFor="deadline-enforced">Enforce weekly deadlines</Label>
                    <p className="text-sm text-[#44474e]">
                      When off, reports stay editable and submittable until an admin manually locks them.
                    </p>
                  </div>
                  <Controller
                    control={form.control}
                    name="deadlineEnforced"
                    render={({ field }) => (
                      <Switch
                        id="deadline-enforced"
                        checked={field.value}
                        onCheckedChange={field.onChange}
                      />
                    )}
                  />
                </div>
              </div>

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
                  <Input type="time" className="h-12 px-4" {...form.register('weeklyDeadlineTime')} />
                </div>

                <div className="space-y-2">
                  <Label>Auto-lock hours after deadline</Label>
                  <Input type="number" className="h-12 px-4" {...form.register('autoLockHoursAfterDeadline')} />
                </div>

                <div className="space-y-2">
                  <Label>Notable rise threshold (%)</Label>
                  <Input type="number" className="h-12 px-4" {...form.register('notableRiseThresholdPercent')} />
                </div>

                <div className="space-y-2 md:col-span-2">
                  <Label>Notable drop threshold (%)</Label>
                  <Input type="number" className="h-12 px-4" {...form.register('notableDropThresholdPercent')} />
                </div>
              </div>

              <div className="flex flex-col gap-4 border-t border-[#eef2f6] pt-5 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm text-[#44474e]">
                  {deadlineEnforced ? (
                    previewDeadline ? (
                      <>
                        Closes{' '}
                        <span className="font-medium tabular-nums text-[#000a1e]">
                          {format(previewDeadline, 'EEE, MMM d · HH:mm')}
                        </span>
                      </>
                    ) : (
                      'Rules apply once a reporting week is active.'
                    )
                  ) : (
                    'Deadlines off — reports stay open until manually locked.'
                  )}
                </p>

                <Button type="submit" disabled={form.formState.isSubmitting} className="w-full sm:w-auto">
                  <Save className="h-4 w-4" />
                  {form.formState.isSubmitting ? 'Saving…' : 'Save settings'}
                </Button>
              </div>
            </form>
          </div>
        </motion.section>

        <motion.section
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, ease: 'easeOut' }}
          className={cn(sectionClass, 'flex flex-col')}
        >
          <div className="border-b border-[#eef2f6] pb-5">
            <SectionEyebrow label="This week's schedule" />
            <h2 className="mt-1 font-display text-[1.4rem] font-bold tracking-[-0.02em] text-[#000a1e] md:text-[1.6rem]">
              This week
            </h2>
            <p className="mt-1 text-sm text-[#74777f]">
              {deadlineEnforced
                ? `Auto-locks ${autoLockHours}h after the deadline.`
                : 'Manual lock only — no auto-lock scheduled.'}
            </p>
          </div>

          {/* Deadline → auto-lock timeline: two deliberately distinct nodes on a rail. */}
          <div className="relative mt-6">
            <span
              aria-hidden="true"
              className={cn(
                'absolute left-[15px] top-5 bottom-5 w-[2px]',
                deadlineEnforced ? 'bg-[#e6ecf3]' : 'border-l border-dashed border-[#e6ecf3]',
              )}
            />

            <motion.div
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.18, ease: [0.23, 1, 0.32, 1], delay: 0.04 }}
              className="relative flex items-start gap-4"
            >
              <span
                className={cn(
                  'relative z-10 grid h-8 w-8 place-items-center rounded-full outline outline-1',
                  deadlineEnforced ? 'bg-[#edf4fb] outline-[#cfe0f4]' : 'bg-[#f7f9fc] outline-[#e6ecf3]',
                )}
              >
                <Clock3 className={cn('h-4 w-4', deadlineEnforced ? 'text-[#005db6]' : 'text-[#74777f]')} />
              </span>
              <div className="min-w-0">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#005db6]">Deadline</p>
                <p className="mt-1 font-display text-[1.35rem] font-bold tracking-[-0.02em] tabular-nums text-[#000a1e]">
                  {previewDeadline ? format(previewDeadline, 'EEE, MMM d') : 'Disabled'}
                </p>
                <p className="text-sm tabular-nums text-[#44474e]">
                  {previewDeadline ? format(previewDeadline, 'HH:mm') : 'Manual lock only'}
                </p>
              </div>
            </motion.div>

            <div className="relative z-10 my-2 flex items-center pl-1">
              <span className="inline-flex items-center rounded-[0.3rem] bg-white px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#005db6] outline outline-1 outline-[#e6ecf3]">
                {deadlineEnforced ? `${autoLockHours}h window` : 'No auto-lock'}
              </span>
            </div>

            <motion.div
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.18, ease: [0.23, 1, 0.32, 1], delay: 0.12 }}
              className="relative flex items-start gap-4"
            >
              <span
                className={cn(
                  'relative z-10 grid h-8 w-8 place-items-center rounded-full outline outline-1',
                  deadlineEnforced ? 'bg-[#fcf5e8] outline-[#edd9b0]' : 'bg-[#f7f9fc] outline-[#e6ecf3]',
                )}
              >
                <Lock className={cn('h-4 w-4', deadlineEnforced ? 'text-[#8a5a00]' : 'text-[#74777f]')} />
              </span>
              <div className="min-w-0">
                <p
                  className={cn(
                    'text-[11px] font-semibold uppercase tracking-[0.18em]',
                    deadlineEnforced ? 'text-[#8a5a00]' : 'text-[#74777f]',
                  )}
                >
                  Auto-lock
                </p>
                <p className="mt-1 font-display text-[1.35rem] font-bold tracking-[-0.02em] tabular-nums text-[#000a1e]">
                  {previewLockAt ? format(previewLockAt, 'EEE, MMM d') : 'Off'}
                </p>
                <p className="text-sm tabular-nums text-[#44474e]">
                  {previewLockAt ? format(previewLockAt, 'HH:mm') : 'No deadline enforcement'}
                </p>
              </div>
            </motion.div>
          </div>

          <div className="mt-auto">
            <div className="mt-6 flex items-center justify-between border-t border-[#eef2f6] pt-4">
              <p className="text-sm text-[#74777f]">Coverage</p>
              <p className="text-sm font-semibold tabular-nums text-[#000a1e]">
                {formatCompactNumber(criticalFieldCount)} critical fields
              </p>
            </div>

            <div className="mt-4 flex items-center gap-3 border-t border-[#eef2f6] pt-4">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[0.35rem] bg-[#edf4fb] outline outline-1 outline-[#cfe0f4]/75">
                <PhoneCall className="h-4 w-4 text-[#005db6]" />
              </span>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#74777f]">
                  Technical support
                </p>
                <p className="text-sm font-medium text-[#000a1e]">
                  {technicalSupport.name} · {technicalSupport.phone}
                </p>
              </div>
            </div>
          </div>
        </motion.section>
      </section>
    </div>
  )
}
