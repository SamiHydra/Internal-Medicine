import { zodResolver } from '@hookform/resolvers/zod'
import { addHours, format } from 'date-fns'
import { motion } from 'framer-motion'
import { useEffect } from 'react'
import { Controller, useForm, useWatch } from 'react-hook-form'
import { Clock3, Lock, PhoneCall, Save, Settings2, Sparkles, TrendingUpDown } from 'lucide-react'
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
import { formatCompactNumber } from '@/lib/utils'
import type { Weekday } from '@/types/domain'

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

  const watchedValues = useWatch({
    control: form.control,
  })
  const deadlineEnforced = watchedValues.deadlineEnforced ?? state.settings.deadlineEnforced
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
  const previewDeadline = currentPeriod && deadlineEnforced
    ? getDeadlineForPeriod(currentPeriod, deadlineDay, deadlineTime)
    : null
  const previewLockAt = previewDeadline ? addHours(previewDeadline, autoLockHours) : null
  const criticalFieldCount = state.settings.criticalNonZeroFields.length
  const summaryItems = [
    {
      label: 'Deadline day',
      value: deadlineEnforced ? formatWeekdayLabel(deadlineDay) : 'Disabled',
      note: deadlineEnforced ? 'Current weekly reporting close' : 'Manual lock only',
      icon: Clock3,
      tone: 'text-[#005db6] bg-[#edf4fb] outline-[#cfe0f4]/75',
    },
    {
      label: 'Deadline time',
      value: deadlineEnforced ? formatTimeLabel(deadlineTime) : 'Open',
      note: deadlineEnforced ? 'Local reporting cut-off' : 'Reports stay editable',
      icon: Clock3,
      tone: 'text-[#00468c] bg-[#edf4fb] outline-[#cfe0f4]/75',
    },
    {
      label: 'Auto-lock',
      value: deadlineEnforced ? `${autoLockHours}h` : 'Off',
      note: deadlineEnforced ? 'After the deadline' : 'No deadline enforcement',
      icon: Lock,
      tone: 'text-[#1d3047] bg-[#edf1f5] outline-[#d4dde8]/75',
    },
    {
      label: 'Critical fields',
      value: formatCompactNumber(criticalFieldCount),
      note: `${riseThreshold}% rise / ${dropThreshold}% drop`,
      icon: Sparkles,
      tone: 'text-[#8a5a00] bg-[#fcf5e8] outline-[#edd9b0]/75',
    },
  ] as const

  const onSubmit = form.handleSubmit(async (values) => {
    await updateSettings(values)
  })

  return (
    <div className="space-y-8">
      <section className="rounded-[0.35rem] bg-[#eef2f6] px-5 py-5 md:px-6">
        <div className="space-y-5">
          <div className="space-y-2">
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#005db6]">
              Settings
            </p>
            <h1 className="font-display text-[2rem] leading-[0.96] tracking-[-0.03em] text-[#000a1e] md:text-[2.35rem]">
              Workflow rules
            </h1>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {summaryItems.map((item) => {
              const Icon = item.icon

              return (
                <div
                  key={item.label}
                  className={`rounded-[0.35rem] px-3.5 py-3 outline outline-1 ${item.tone}`}
                >
                  <div className="flex items-center gap-2">
                    <Icon className="h-3.5 w-3.5" />
                    <p className="text-[11px] font-semibold uppercase tracking-[0.18em]">
                      {item.label}
                    </p>
                  </div>
                  <p className="mt-3 font-display text-[1.45rem] leading-none tracking-[-0.03em]">
                    {item.value}
                  </p>
                  <p className="mt-1 text-xs leading-5 text-current/75">{item.note}</p>
                </div>
              )
            })}
          </div>
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
        <motion.section
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, ease: 'easeOut' }}
          className="rounded-[0.35rem] bg-[#eef2f6] px-5 py-5"
        >
            <div className="space-y-5">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#005db6]">
                    Workflow
                  </p>
                  <h2 className="font-display text-[1.85rem] text-[#000a1e]">Rule settings</h2>
                </div>
                <div className="rounded-[0.25rem] border border-[#d4dde8] bg-[#ffffff] px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#44474e]">
                  {form.formState.isDirty ? 'Unsaved changes' : 'Saved'}
                </div>
              </div>

            <form className="space-y-6" onSubmit={onSubmit}>
              <div className="rounded-[0.35rem] border border-[#d4dde8] bg-[#ffffff] px-4 py-4">
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

              <div className="flex flex-col gap-4 border-t border-slate-100/90 pt-5 sm:flex-row sm:items-center sm:justify-between">
                <div className="space-y-1">
                  <p className="text-sm font-medium text-[#000a1e]">
                    {deadlineEnforced
                      ? previewDeadline
                      ? `Next deadline ${format(previewDeadline, 'EEE, MMM d / HH:mm')}.`
                      : 'Rules apply to the current week.'
                      : 'Deadlines are disabled. Reports stay open until manually locked.'}
                  </p>
                  <p className="text-sm text-[#44474e]">
                    {deadlineEnforced
                      ? previewLockAt
                      ? `Auto-lock ${format(previewLockAt, 'EEE, MMM d / HH:mm')}.`
                      : 'Set a deadline to preview lock timing.'
                      : 'Overdue alerts are also turned off.'}
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
          className="rounded-[0.35rem] bg-[#eef2f6] px-5 py-5"
        >
          <div className="space-y-5">
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#005db6]">
                Live rule set
              </p>
              <h2 className="font-display text-[1.85rem] text-[#000a1e]">Current week</h2>
              <p className="text-sm text-[#44474e]">
                {currentPeriod ? currentPeriod.label : 'No active reporting week.'}
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-[0.35rem] border border-[#d4dde8] bg-[#ffffff] p-4">
                <div className="flex items-center gap-2">
                  <Clock3 className="h-4 w-4 text-[#005db6]" />
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#005db6]">
                    Deadline
                  </p>
                </div>
                <p className="mt-3 text-base font-semibold text-[#000a1e]">
                  {previewDeadline ? format(previewDeadline, 'EEE, MMM d') : 'Disabled'}
                </p>
                <p className="text-sm text-[#44474e]">
                  {previewDeadline ? format(previewDeadline, 'HH:mm') : 'Manual lock only'}
                </p>
              </div>

              <div className="rounded-[0.35rem] border border-[#d4dde8] bg-[#ffffff] p-4">
                <div className="flex items-center gap-2">
                  <Lock className="h-4 w-4 text-[#005db6]" />
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#005db6]">
                    Lock at
                  </p>
                </div>
                <p className="mt-3 text-base font-semibold text-[#000a1e]">
                  {previewLockAt ? format(previewLockAt, 'EEE, MMM d') : 'Off'}
                </p>
                <p className="text-sm text-[#44474e]">
                  {previewLockAt ? format(previewLockAt, 'HH:mm') : 'No deadline enforcement'}
                </p>
              </div>

              <div className="rounded-[0.35rem] border border-[#d4dde8] bg-[#ffffff] p-4">
                <div className="flex items-center gap-2">
                  <TrendingUpDown className="h-4 w-4 text-[#005db6]" />
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#005db6]">
                    Rise
                  </p>
                </div>
                <p className="mt-3 text-base font-semibold text-[#000a1e]">{riseThreshold}%</p>
                <p className="text-sm text-[#44474e]">Alert threshold</p>
              </div>

              <div className="rounded-[0.35rem] border border-[#d4dde8] bg-[#ffffff] p-4">
                <div className="flex items-center gap-2">
                  <TrendingUpDown className="h-4 w-4 text-[#005db6]" />
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#005db6]">
                    Drop
                  </p>
                </div>
                <p className="mt-3 text-base font-semibold text-[#000a1e]">{dropThreshold}%</p>
                <p className="text-sm text-[#44474e]">Alert threshold</p>
              </div>
            </div>

            <div className="rounded-[0.35rem] border border-[#d4dde8] bg-[#ffffff] p-4">
              <div className="flex items-center gap-3">
                <div className="rounded-[0.35rem] bg-[#edf4fb] p-3 outline outline-1 outline-[#cfe0f4]/75">
                  <Settings2 className="h-4 w-4 text-[#005db6]" />
                </div>
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#005db6]">
                    Coverage
                  </p>
                  <p className="mt-1 text-base font-semibold text-[#000a1e]">
                    {formatCompactNumber(criticalFieldCount)} critical fields
                  </p>
                </div>
              </div>
            </div>

            <div className="rounded-[0.35rem] border border-[#d4dde8] bg-[#ffffff] p-4">
              <div className="flex items-center gap-3">
                <div className="rounded-[0.35rem] bg-[#fcf5e8] p-3 outline outline-1 outline-[#edd9b0]/75">
                  <Sparkles className="h-4 w-4 text-[#f0b429]" />
                </div>
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#8a5a00]">
                    Rule note
                  </p>
                  <p className="mt-1 text-sm leading-6 text-[#44474e]">
                    Dashboard alerts and lock timing use this rule set.
                  </p>
                </div>
              </div>
            </div>

            <div className="rounded-[0.35rem] border border-[#d4dde8] bg-[#ffffff] p-4">
              <div className="flex items-center gap-3">
                <div className="rounded-[0.35rem] bg-[#edf4fb] p-3 outline outline-1 outline-[#cfe0f4]/75">
                  <PhoneCall className="h-4 w-4 text-[#005db6]" />
                </div>
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#005db6]">
                    Technical support
                  </p>
                  <p className="mt-1 text-sm font-medium text-[#000a1e]">
                    {technicalSupport.name}
                  </p>
                  <p className="text-sm text-[#44474e]">{technicalSupport.phone}</p>
                </div>
              </div>
            </div>
          </div>
        </motion.section>
      </section>
    </div>
  )
}
