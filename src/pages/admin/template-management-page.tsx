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
  const averageFields = totalTemplates ? Math.round(totalFields / totalTemplates) : 0
  const averageSections = totalTemplates ? Math.round(totalSections / totalTemplates) : 0
  const summaryItems = [
    {
      label: 'Templates',
      value: formatCompactNumber(totalTemplates),
      note: activeMeta.label,
      icon: LayoutTemplate,
      tone: 'text-[#005db6] bg-[#edf4fb] outline-[#cfe0f4]/75',
    },
    {
      label: 'Fields',
      value: formatCompactNumber(totalFields),
      note: `${averageFields} avg per template`,
      icon: Rows3,
      tone: 'text-[#00468c] bg-[#edf4fb] outline-[#cfe0f4]/75',
    },
    {
      label: 'Sections',
      value: formatCompactNumber(totalSections),
      note: `${averageSections} avg per template`,
      icon: CalendarDays,
      tone: 'text-[#1d3047] bg-[#edf1f5] outline-[#d4dde8]/75',
    },
    {
      label: 'Signals',
      value: formatCompactNumber(totalSignals),
      note: 'Configured change rules',
      icon: Sparkles,
      tone: 'text-[#8a5a00] bg-[#fcf5e8] outline-[#edd9b0]/75',
    },
  ] as const

  return (
    <Tabs
      value={activeServiceLine}
      onValueChange={(value) =>
        setActiveServiceLine(value as (typeof serviceLineOptions)[number]['value'])
      }
      className="space-y-8"
    >
      <section className="rounded-[0.35rem] bg-[#eef2f6] px-5 py-5 md:px-6">
        <div className="space-y-5">
          <div className="space-y-2">
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#005db6]">
                Templates
              </p>
              <h1 className="font-display text-[2rem] leading-[0.96] tracking-[-0.03em] text-[#000a1e] md:text-[2.35rem]">
                Reporting models
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

          <div className="border-t border-[#d9e0e7] pt-4">
            <div className="space-y-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#005db6]">
                Service line
              </p>
              <TabsList className="h-auto flex-wrap gap-2 rounded-[0.35rem] bg-[#f8fafc] p-1.5 outline outline-1 outline-[#d9e0e7]/75 shadow-none">
                {serviceLineOptions.map((option) => (
                  <TabsTrigger
                    key={option.value}
                    value={option.value}
                    className="rounded-[0.25rem] px-4 py-2.5 text-sm font-semibold text-[#44474e] data-[state=active]:bg-[#000a1e] data-[state=active]:text-white data-[state=active]:shadow-none"
                  >
                    {option.label}
                  </TabsTrigger>
                ))}
              </TabsList>
            </div>
          </div>
        </div>
      </section>

      {serviceLineOptions.map((serviceLine) => (
        <TabsContent key={serviceLine.value} value={serviceLine.value} className="mt-0">
          <div className="space-y-5">
            {templatesByFamily[serviceLine.value].map((template, index) => (
              <motion.section
                key={template.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.26, ease: 'easeOut', delay: index * 0.02 }}
                className="rounded-[0.35rem] bg-[#eef2f6] px-5 py-5"
              >
                <div className="grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)] xl:items-start">
                  <div className="space-y-5">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                      <div className="space-y-2">
                        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#005db6]">
                          {serviceLine.label}
                        </p>
                        <h2 className="font-display text-[1.85rem] text-[#000a1e] md:text-[2.1rem]">
                          {template.name}
                        </h2>
                        <p className="text-sm text-[#44474e]">
                          {template.fields.length} fields / {template.sections.length} sections / {template.changeRules.length} signals
                        </p>
                      </div>

                      <div className="flex flex-wrap gap-2">
                        <span className="rounded-[0.25rem] border border-[#d4dde8] bg-[#ffffff] px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#44474e]">
                          {template.activeDays.length} days
                        </span>
                        <span className="rounded-[0.25rem] border border-[#d4dde8] bg-[#ffffff] px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#44474e]">
                          {template.summaryCards.length} summaries
                        </span>
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      {template.activeDays.map((day) => (
                        <span
                          key={day}
                          className="inline-flex items-center gap-2 rounded-[0.25rem] border border-[#d4dde8] bg-[#f3f4f5] px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.18em] text-[#44474e]"
                        >
                          <CalendarDays className="h-3.5 w-3.5 text-[#005db6]" />
                          {formatDayLabel(day)}
                        </span>
                      ))}
                    </div>

                    <div className="grid gap-5 lg:grid-cols-2">
                      <div className="space-y-3 rounded-[0.35rem] bg-[#ffffff] p-4 outline outline-1 outline-[#d4dde8]/65">
                        <div className="flex items-center gap-2">
                          <Rows3 className="h-4 w-4 text-[#005db6]" />
                          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#005db6]">
                            Sections
                          </p>
                        </div>
                        <div className="space-y-2">
                          {template.sections.map((section) => (
                            <div
                              key={section.id}
                              className="flex items-center justify-between rounded-[0.25rem] border border-[#d4dde8] bg-[#f3f4f5] px-3 py-2 text-sm"
                            >
                              <span className="font-medium text-[#44474e]">{section.title}</span>
                              <ChevronRight className="h-4 w-4 text-[#74777f]" />
                            </div>
                          ))}
                        </div>
                      </div>

                      <div className="space-y-3 rounded-[0.35rem] bg-[#ffffff] p-4 outline outline-1 outline-[#d4dde8]/65">
                        <div className="flex items-center gap-2">
                          <LayoutTemplate className="h-4 w-4 text-[#005db6]" />
                          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#005db6]">
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

                  <div className="rounded-[0.35rem] bg-[#f8fafc] p-5 outline outline-1 outline-[#d9e0e7]/75">
                    <div className="space-y-4">
                      <div className="flex items-center gap-3">
                        <div className="rounded-[0.35rem] bg-[#edf4fb] p-3 outline outline-1 outline-[#cfe0f4]/75">
                          <Sparkles className="h-4 w-4 text-[#f0b429]" />
                        </div>
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#005db6]">
                            Signal rules
                          </p>
                          <p className="mt-1 text-sm text-[#44474e]">
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
                                className="rounded-[0.35rem] border border-[#d4dde8] bg-[#ffffff] p-4"
                              >
                                <div className="flex items-start justify-between gap-3">
                                  <p className="text-sm font-medium leading-6 text-[#44474e]">
                                    {fieldLabel}
                                  </p>
                                  <span className="rounded-[0.25rem] border border-[#edd9b0] bg-[#fcf5e8] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#8a5a00]">
                                    {rule.percentThreshold}%
                                  </span>
                                </div>
                              </div>
                            )
                          })
                        ) : (
                          <div className="rounded-[0.35rem] border border-dashed border-[#d4dde8] bg-[#ffffff] p-4 text-sm text-[#74777f]">
                            No signal rules.
                          </div>
                        )}
                      </div>

                      <div className="border-t border-[#d9e0e7] pt-4">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#005db6]">
                          Coverage
                        </p>
                        <div className="mt-3 grid gap-3 sm:grid-cols-3">
                          <div className="rounded-[0.35rem] border border-[#d4dde8] bg-[#ffffff] px-3 py-3">
                            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#74777f]">
                              Fields
                            </p>
                            <p className="mt-2 text-xl font-semibold text-[#000a1e]">
                              {template.fields.length}
                            </p>
                          </div>
                          <div className="rounded-[0.35rem] border border-[#d4dde8] bg-[#ffffff] px-3 py-3">
                            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#74777f]">
                              Sections
                            </p>
                            <p className="mt-2 text-xl font-semibold text-[#000a1e]">
                              {template.sections.length}
                            </p>
                          </div>
                          <div className="rounded-[0.35rem] border border-[#d4dde8] bg-[#ffffff] px-3 py-3">
                            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#74777f]">
                              Metrics
                            </p>
                            <p className="mt-2 text-xl font-semibold text-[#000a1e]">
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
