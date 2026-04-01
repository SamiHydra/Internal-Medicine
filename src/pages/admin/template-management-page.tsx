import { useState } from 'react'
import { motion } from 'framer-motion'
import {
  CalendarDays,
  ChevronRight,
  LayoutTemplate,
  Rows3,
  Sparkles,
} from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { getAllTemplatesByFamily } from '@/data/selectors'
import { formatCompactNumber } from '@/lib/utils'

const serviceLineOptions = [
  {
    value: 'inpatient' as const,
    label: 'Inpatient',
    eyebrow: 'Ward templates',
    note: 'Weekly ward reporting models.',
  },
  {
    value: 'outpatient' as const,
    label: 'Outpatient',
    eyebrow: 'Clinic templates',
    note: 'Clinic volume and access models.',
  },
  {
    value: 'procedure' as const,
    label: 'Procedures',
    eyebrow: 'Procedure templates',
    note: 'Service throughput and turnaround models.',
  },
] as const

function formatDayLabel(day: string) {
  return day.slice(0, 3)
}

export function TemplateManagementPage() {
  const templatesByFamily = getAllTemplatesByFamily()
  const [activeServiceLine, setActiveServiceLine] =
    useState<(typeof serviceLineOptions)[number]['value']>('inpatient')

  const activeTemplates = templatesByFamily[activeServiceLine]
  const activeMeta = serviceLineOptions.find((option) => option.value === activeServiceLine)!
  const totalTemplates = activeTemplates.length
  const totalFields = activeTemplates.reduce((sum, template) => sum + template.fields.length, 0)
  const totalSections = activeTemplates.reduce((sum, template) => sum + template.sections.length, 0)
  const totalSignals = activeTemplates.reduce((sum, template) => sum + template.changeRules.length, 0)

  return (
    <Tabs
      value={activeServiceLine}
      onValueChange={(value) =>
        setActiveServiceLine(value as (typeof serviceLineOptions)[number]['value'])
      }
      className="space-y-8"
    >
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
              Templates
            </div>

            <div className="space-y-0">
              <h1 className="font-display max-w-[8ch] text-5xl font-semibold leading-[0.9] tracking-tight text-slate-950 md:text-[5.6rem] xl:text-[6.2rem]">
                Reporting models
              </h1>
              <p className="pt-5 text-sm font-semibold uppercase tracking-[0.24em] text-slate-500 md:pt-6 md:text-[0.8rem]">
                {activeMeta.eyebrow} / {activeMeta.label}
              </p>
            </div>

            <div className="flex flex-wrap gap-2.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
              <span className="login-chip-float rounded-full border border-white/70 bg-white/55 px-3 py-2 backdrop-blur-sm">
                {formatCompactNumber(totalTemplates)} templates
              </span>
              <span
                className="login-chip-float rounded-full border border-white/70 bg-white/55 px-3 py-2 backdrop-blur-sm"
                style={{ animationDelay: '700ms' }}
              >
                {formatCompactNumber(totalFields)} fields
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
                  Templates
                </p>
                <p className="mt-2 font-display text-4xl leading-none text-slate-950">
                  {formatCompactNumber(totalTemplates)}
                </p>
              </div>
              <div className="space-y-1 border-b border-white/70 pb-4 sm:border-b-0 sm:pb-0 sm:pl-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-sky-700">
                  Fields
                </p>
                <p className="mt-2 font-display text-4xl leading-none text-slate-950">
                  {formatCompactNumber(totalFields)}
                </p>
              </div>
            </div>

            <div className="grid gap-4 border-t border-white/70 pt-4 sm:grid-cols-2">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-sky-700">
                  Sections
                </p>
                <p className="mt-2 text-lg font-semibold text-slate-950">
                  {formatCompactNumber(totalSections)}
                </p>
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-sky-700">
                  Signals
                </p>
                <p className="mt-2 text-lg font-semibold text-slate-950">
                  {formatCompactNumber(totalSignals)}
                </p>
              </div>
            </div>
          </motion.div>
        </div>
      </section>

      <motion.section
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.28, ease: 'easeOut' }}
        className="relative overflow-hidden rounded-[2rem] border border-white/70 bg-[linear-gradient(135deg,rgba(255,255,255,0.82),rgba(244,249,255,0.76),rgba(235,253,248,0.62))] px-5 py-5 shadow-[0_20px_42px_-34px_rgba(15,23,42,0.18)] backdrop-blur-md"
      >
        <div className="pointer-events-none absolute inset-0">
          <div className="login-ambient-drift absolute right-[12%] top-[-24%] h-32 w-32 rounded-full bg-sky-200/18 blur-3xl" />
          <div className="login-line-flow absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-sky-300/70 to-transparent" />
        </div>

        <div className="relative grid gap-6 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-center">
          <div className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-sky-700">
              Service line
            </p>
            <TabsList className="h-auto flex-wrap gap-2 rounded-[1.7rem] bg-white/66 p-1.5 shadow-[0_18px_30px_-24px_rgba(15,23,42,0.18)]">
              {serviceLineOptions.map((option) => (
                <TabsTrigger
                  key={option.value}
                  value={option.value}
                  className="rounded-[1.2rem] px-4 py-2.5 text-sm font-semibold text-slate-600 data-[state=active]:bg-slate-950 data-[state=active]:text-white data-[state=active]:shadow-[0_16px_26px_-20px_rgba(15,23,42,0.45)]"
                >
                  {option.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>

          <div className="grid gap-3 sm:grid-cols-3 xl:min-w-[420px]">
            <div className="border-l border-white/65 pl-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-sky-700">
                Service line
              </p>
              <p className="mt-2 text-sm font-semibold text-slate-950">{activeMeta.label}</p>
              <p className="text-sm text-slate-500">{activeMeta.note}</p>
            </div>
            <div className="border-l border-white/65 pl-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-sky-700">
                Avg fields
              </p>
              <p className="mt-2 text-sm font-semibold text-slate-950">
                {totalTemplates ? Math.round(totalFields / totalTemplates) : 0}
              </p>
            </div>
            <div className="border-l border-white/65 pl-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-sky-700">
                Avg sections
              </p>
              <p className="mt-2 text-sm font-semibold text-slate-950">
                {totalTemplates ? Math.round(totalSections / totalTemplates) : 0}
              </p>
            </div>
          </div>
        </div>
      </motion.section>

      {serviceLineOptions.map((serviceLine) => (
        <TabsContent key={serviceLine.value} value={serviceLine.value} className="mt-0">
          <div className="space-y-5">
            {templatesByFamily[serviceLine.value].map((template, index) => (
              <motion.section
                key={template.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.26, ease: 'easeOut', delay: index * 0.02 }}
                className="relative overflow-hidden rounded-[2.4rem] border border-white/70 bg-[linear-gradient(180deg,rgba(255,255,255,0.96),rgba(242,248,255,0.84))] px-5 py-6 shadow-[0_24px_54px_-36px_rgba(15,23,42,0.22)]"
              >
                <div className="pointer-events-none absolute inset-0">
                  <div className="login-grid-drift absolute inset-0 opacity-12" />
                  <div className="login-ambient-drift absolute right-[-4%] top-[-12%] h-44 w-44 rounded-full bg-sky-200/12 blur-3xl" />
                  <div className="login-line-flow absolute inset-x-6 top-0 h-1 bg-gradient-to-r from-cyan-400 via-sky-500 to-emerald-400" />
                </div>

                <div className="relative grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)] xl:items-start">
                  <div className="space-y-5">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                      <div className="space-y-2">
                        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-sky-700">
                          {serviceLine.label}
                        </p>
                        <h2 className="font-display text-3xl text-slate-950 md:text-4xl">
                          {template.name}
                        </h2>
                        <p className="text-sm text-slate-500">
                          {template.fields.length} fields / {template.sections.length} sections / {template.changeRules.length} signals
                        </p>
                      </div>

                      <div className="flex flex-wrap gap-2">
                        <span className="rounded-full border border-white/80 bg-white/72 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-600 shadow-[0_14px_24px_-20px_rgba(15,23,42,0.15)]">
                          {template.activeDays.length} days
                        </span>
                        <span className="rounded-full border border-white/80 bg-white/72 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-600 shadow-[0_14px_24px_-20px_rgba(15,23,42,0.15)]">
                          {template.summaryCards.length} summaries
                        </span>
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      {template.activeDays.map((day) => (
                        <span
                          key={day}
                          className="inline-flex items-center gap-2 rounded-full border border-slate-200/80 bg-slate-50/90 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.18em] text-slate-700"
                        >
                          <CalendarDays className="h-3.5 w-3.5 text-sky-700" />
                          {formatDayLabel(day)}
                        </span>
                      ))}
                    </div>

                    <div className="grid gap-5 lg:grid-cols-2">
                      <div className="space-y-3 rounded-[1.7rem] border border-slate-200/80 bg-white/82 p-4 shadow-[0_16px_30px_-24px_rgba(15,23,42,0.18)]">
                        <div className="flex items-center gap-2">
                          <Rows3 className="h-4 w-4 text-sky-700" />
                          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-sky-700">
                            Sections
                          </p>
                        </div>
                        <div className="space-y-2">
                          {template.sections.map((section) => (
                            <div
                              key={section.id}
                              className="flex items-center justify-between rounded-[1rem] border border-slate-100 bg-slate-50/85 px-3 py-2 text-sm"
                            >
                              <span className="font-medium text-slate-700">{section.title}</span>
                              <ChevronRight className="h-4 w-4 text-slate-400" />
                            </div>
                          ))}
                        </div>
                      </div>

                      <div className="space-y-3 rounded-[1.7rem] border border-slate-200/80 bg-white/82 p-4 shadow-[0_16px_30px_-24px_rgba(15,23,42,0.18)]">
                        <div className="flex items-center gap-2">
                          <LayoutTemplate className="h-4 w-4 text-sky-700" />
                          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-sky-700">
                            Summary metrics
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {template.summaryCards.map((card) => (
                            <Badge key={card.id} variant="success">
                              {card.label}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-[2rem] border border-white/10 bg-[linear-gradient(160deg,#07152d_0%,#0b3156_42%,#0f4c81_72%,#0f766e_100%)] p-5 text-white shadow-[0_28px_52px_-30px_rgba(8,47,73,0.72)]">
                    <div className="space-y-4">
                      <div className="flex items-center gap-3">
                        <div className="rounded-[1.1rem] border border-white/12 bg-white/8 p-3 backdrop-blur-sm">
                          <Sparkles className="h-4 w-4 text-cyan-100" />
                        </div>
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-100">
                            Signal rules
                          </p>
                          <p className="mt-1 text-sm text-cyan-50/72">
                            Triggered by weekly changes.
                          </p>
                        </div>
                      </div>

                      <div className="space-y-3">
                        {template.changeRules.length ? (
                          template.changeRules.map((rule, index) => {
                            const fieldLabel =
                              template.fields.find((field) => field.id === rule.fieldId)?.label ??
                              rule.metricId ??
                              rule.fieldId ??
                              'Signal'

                            return (
                              <div
                                key={`${template.id}-${index}`}
                                className="rounded-[1.4rem] border border-white/12 bg-white/8 p-4 backdrop-blur-sm"
                              >
                                <div className="flex items-start justify-between gap-3">
                                  <p className="text-sm font-medium leading-6 text-cyan-50">
                                    {fieldLabel}
                                  </p>
                                  <span className="rounded-full border border-white/12 bg-white/8 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-100">
                                    {rule.percentThreshold}%
                                  </span>
                                </div>
                              </div>
                            )
                          })
                        ) : (
                          <div className="rounded-[1.4rem] border border-white/12 bg-white/8 p-4 text-sm text-cyan-50/72">
                            No signal rules.
                          </div>
                        )}
                      </div>

                      <div className="border-t border-white/10 pt-4">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-100/72">
                          Coverage
                        </p>
                        <div className="mt-3 grid gap-3 sm:grid-cols-3">
                          <div className="rounded-[1.2rem] border border-white/12 bg-white/8 px-3 py-3">
                            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-100/72">
                              Fields
                            </p>
                            <p className="mt-2 text-xl font-semibold text-white">
                              {template.fields.length}
                            </p>
                          </div>
                          <div className="rounded-[1.2rem] border border-white/12 bg-white/8 px-3 py-3">
                            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-100/72">
                              Sections
                            </p>
                            <p className="mt-2 text-xl font-semibold text-white">
                              {template.sections.length}
                            </p>
                          </div>
                          <div className="rounded-[1.2rem] border border-white/12 bg-white/8 px-3 py-3">
                            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-100/72">
                              Metrics
                            </p>
                            <p className="mt-2 text-xl font-semibold text-white">
                              {template.summaryCards.length}
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </motion.section>
            ))}
          </div>
        </TabsContent>
      ))}
    </Tabs>
  )
}
