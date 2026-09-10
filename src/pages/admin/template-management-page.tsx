import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { motion } from 'framer-motion'
import {
  ArrowDown,
  ArrowUp,
  CalendarDays,
  ChevronDown,
  Gauge,
  Info,
  LayoutGrid,
  ListChecks,
  Loader2,
  Save,
  Settings2,
} from 'lucide-react'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  HeaderChip,
  SectionEmptyState,
  SectionHeader,
  panelClass,
} from '@/components/dashboard/section-panel'
import { TemplateEditorSkeleton } from '@/components/layout/loading-skeletons'
import { Skeleton } from '@/components/ui/skeleton'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { useAppData } from '@/context/app-data-context'
import {
  fetchAdminTemplates,
  fetchClinicalAlertRules,
  setTemplateFieldActive,
  updateTemplateContent,
} from '@/lib/api'
import { getApiBrowserClient } from '@/lib/api/client'
import type { ApiTemplateConfig, ApiTemplateField, ClinicalAlertRule } from '@/lib/api/types'
import { cn } from '@/lib/utils'
import type {
  SummaryCardConfig,
  TemplateSection,
} from '@/types/domain'

const serviceLineOptions = [
  { value: 'inpatient' as const, label: 'Inpatient' },
  { value: 'outpatient' as const, label: 'Outpatient' },
  { value: 'procedure' as const, label: 'Procedures' },
] as const

const weekdays = [
  { key: 'monday', label: 'Mon' },
  { key: 'tuesday', label: 'Tue' },
  { key: 'wednesday', label: 'Wed' },
  { key: 'thursday', label: 'Thu' },
  { key: 'friday', label: 'Fri' },
  { key: 'saturday', label: 'Sat' },
  { key: 'sunday', label: 'Sun' },
] as const

// Plain-language labels for the roll-up behaviour. Values stay on the API contract.
const aggregateOptions = [
  { value: 'sum', label: 'Add up into a total' },
  { value: 'average', label: 'Show the average' },
  { value: 'latest', label: 'Keep the latest value' },
  { value: 'none', label: 'Do not combine' },
] as const

// Engineer-facing field kinds translated to words a coordinator understands.
const fieldTypeLabels: Record<string, string> = {
  integer: 'Whole number',
  decimal: 'Decimal number',
  number: 'Number',
  float: 'Decimal number',
  text: 'Text',
  string: 'Text',
  choice: 'Pick from a list',
  single_choice: 'Pick from a list',
  multi_choice: 'Pick several',
  select: 'Pick from a list',
  boolean: 'Yes / no',
  time: 'Time',
  date: 'Date',
}

function prettyFieldType(kind: string) {
  return fieldTypeLabels[kind] ?? kind.replace(/_/g, ' ')
}

function operatorLabelForTemplate(operator: ClinicalAlertRule['operator']) {
  return operator === 'gte' ? 'at least' : operator === 'eq' ? 'exactly' : 'greater than'
}

type PresentationSection = TemplateSection
type PresentationCard = SummaryCardConfig

/**
 * Display names for the calculated metrics a dashboard tile can bind to. A tile
 * editor only renames the caption - the bound source is fixed in config - so the
 * source is shown read-only beneath the input to stop a tile being relabelled
 * into something it does not actually measure.
 */
const metricSourceLabels: Record<string, string> = {
  borPercent: 'Bed occupancy rate (BOR %)',
  btr: 'Bed turnover rate (BTR)',
  alos: 'Average length of stay (ALOS)',
}

/** Small uppercase caption that sits above a single control. */
function Caption({ children }: { children: ReactNode }) {
  return (
    <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#526171]">
      {children}
    </span>
  )
}

/** A titled block inside the open template: icon + title (+ optional count). */
function FieldGroup({
  icon,
  title,
  count,
  children,
}: {
  icon: ReactNode
  title: string
  count?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="space-y-3.5">
      <div className="flex items-center gap-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[0.3rem] bg-[#edf4fb] text-[#005db6]">
          {icon}
        </span>
        <h3 className="flex items-center gap-2 text-sm font-bold text-[#000a1e]">
          {title}
          {count != null ? (
            <span className="text-sm font-semibold text-[#657180]">{count}</span>
          ) : null}
        </h3>
      </div>
      {children}
    </section>
  )
}

export function TemplateManagementPage() {
  const { refreshData } = useAppData()
  const client = getApiBrowserClient()
  const [templates, setTemplates] = useState<ApiTemplateConfig[] | null>(null)
  const [clinicalRules, setClinicalRules] = useState<ClinicalAlertRule[]>([])
  const [loadError, setLoadError] = useState(false)
  const [dirty, setDirty] = useState<Record<string, boolean>>({})
  const [savingSlug, setSavingSlug] = useState<string | null>(null)
  const [activeFamily, setActiveFamily] =
    useState<(typeof serviceLineOptions)[number]['value']>('inpatient')
  // Single-open accordion: only one report is editable at a time so the page stays calm.
  const [openSlug, setOpenSlug] = useState<string | null>(null)
  // Single-open per-field advanced settings, keyed `${slug}:${fieldKey}`.
  const [openFieldKey, setOpenFieldKey] = useState<string | null>(null)

  useEffect(() => {
    if (!client) {
      setLoadError(true)
      return
    }

    let active = true
    fetchAdminTemplates(client)
      .then((data) => {
        if (active) {
          setTemplates(data)
        }
      })
    fetchClinicalAlertRules(client)
      .then((result) => { if (active) setClinicalRules(result.rules) })
      .catch(() => { /* Template editing remains available if governance rules cannot load. */ })
      .catch(() => {
        if (active) {
          setLoadError(true)
          toast.error('Unable to load report templates.')
        }
      })

    return () => {
      active = false
    }
  }, [client])

  const markDirty = (slug: string) => setDirty((prev) => ({ ...prev, [slug]: true }))

  const mutateTemplate = (slug: string, updater: (template: ApiTemplateConfig) => ApiTemplateConfig) => {
    setTemplates((prev) =>
      prev ? prev.map((template) => (template.slug === slug ? updater(template) : template)) : prev,
    )
    markDirty(slug)
  }

  const getPresentation = (template: ApiTemplateConfig) => template.metadata?.presentation ?? {}

  const setPresentation = (
    template: ApiTemplateConfig,
    next: NonNullable<ApiTemplateConfig['metadata']>['presentation'],
  ): ApiTemplateConfig => ({
    ...template,
    metadata: { ...(template.metadata ?? {}), presentation: { ...getPresentation(template), ...next } },
  })

  const save = async (template: ApiTemplateConfig) => {
    if (!client) {
      return
    }

    setSavingSlug(template.slug)
    const payload = {
      name: template.name,
      description: template.description,
      activeDays: template.activeDays,
      // Spread the full existing metadata so non-presentation keys (validation_rules,
      // ui_family) are echoed back rather than dropped. The backend also merges over
      // stored metadata, but sending the whole object keeps client and server aligned.
      metadata: { ...(template.metadata ?? {}), presentation: getPresentation(template) },
      // Snake_case: the backend validation requires `section_key`/`label` per field
      // (required_with:fields), and syncFields reads snake keys.
      fields: template.fields.map((field, index) => ({
        field_key: field.fieldKey,
        section_key: field.sectionKey,
        label: field.label,
        field_kind: field.fieldKind,
        aggregate_type: field.aggregateType,
        display_order: (index + 1) * 10,
        metadata: field.metadata ?? {},
      })),
    }

    try {
      await updateTemplateContent(client, template.slug, payload)
      await refreshData()
      setDirty((prev) => ({ ...prev, [template.slug]: false }))
      toast.success(`${template.name} saved.`)
    } catch {
      toast.error('Unable to save the template. Structural changes need Maintenance.')
    } finally {
      setSavingSlug(null)
    }
  }

  const toggleFieldActive = async (template: ApiTemplateConfig, field: ApiTemplateField) => {
    if (!client) {
      return
    }

    const nextActive = field.active === false
    // Optimistic local update.
    setTemplates((prev) =>
      prev
        ? prev.map((entry) =>
            entry.slug === template.slug
              ? {
                  ...entry,
                  fields: entry.fields.map((item) =>
                    item.fieldKey === field.fieldKey ? { ...item, active: nextActive } : item,
                  ),
                }
              : entry,
          )
        : prev,
    )

    try {
      await setTemplateFieldActive(client, template.slug, field.fieldKey, nextActive)
      await refreshData()
    } catch {
      toast.error('Unable to change the field status.')
    }
  }

  const moveField = (template: ApiTemplateConfig, index: number, direction: -1 | 1) => {
    const target = index + direction
    if (target < 0 || target >= template.fields.length) {
      return
    }
    mutateTemplate(template.slug, (entry) => {
      const fields = [...entry.fields]
      const [moved] = fields.splice(index, 1)
      fields.splice(target, 0, moved)
      return { ...entry, fields }
    })
  }

  const familyTemplates = useMemo(
    () => (templates ?? []).filter((template) => template.family === activeFamily),
    [templates, activeFamily],
  )

  // Open the first report of a service line automatically so the page is never a wall of closed rows.
  useEffect(() => {
    if (!familyTemplates.length) {
      return
    }
    setOpenSlug((current) =>
      current && familyTemplates.some((template) => template.slug === current)
        ? current
        : familyTemplates[0].slug,
    )
  }, [familyTemplates])

  const toggleOpen = (slug: string) => {
    setOpenFieldKey(null)
    setOpenSlug((current) => (current === slug ? null : slug))
  }

  return (
    <Tabs
      value={activeFamily}
      onValueChange={(value) =>
        setActiveFamily(value as (typeof serviceLineOptions)[number]['value'])
      }
      className="space-y-6 px-4 py-5 md:px-6 md:py-8"
    >
      <motion.section
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: 'easeOut' }}
        className={panelClass}
      >
        <SectionHeader
          eyebrow="Report templates"
          title="Shape what staff fill in"
          actions={
            <TabsList>
              {serviceLineOptions.map((option) => (
                <TabsTrigger key={option.value} value={option.value}>
                  {option.label}
                </TabsTrigger>
              ))}
            </TabsList>
          }
        />

        <div className="mt-5 flex items-start gap-2.5 rounded-[0.4rem] border border-[#cfe0f4] bg-[#f6fbff] px-4 py-3">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-[#005db6]" />
          <p className="text-[13px] leading-5 text-[#1d3047]">
            Question types and internal names are locked to protect submitted reports.
          </p>
        </div>

        {templates === null && !loadError ? (
          <div className="mt-6 grid gap-3 sm:grid-cols-3">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : null}
        {loadError ? (
          <p className="mt-6 text-sm text-[#ba1a1a]">Unable to load templates.</p>
        ) : null}
      </motion.section>

      {serviceLineOptions.map((option) => (
        <TabsContent key={option.value} value={option.value} className="mt-0 space-y-4">
          {templates === null && !loadError ? (
            <TemplateEditorSkeleton />
          ) : familyTemplates.length === 0 ? (
            <div className={panelClass}>
              <SectionEmptyState
                icon={<ListChecks className="h-6 w-6" />}
                title="No reports here yet"
                description={`There are no ${option.label.toLowerCase()} report templates to customize right now.`}
              />
            </div>
          ) : (
            familyTemplates.map((template, index) => {
              const presentation = getPresentation(template)
              const sections = (presentation.sections as PresentationSection[] | undefined) ?? []
              const cards = (presentation.summaryCards as PresentationCard[] | undefined) ?? []
              const fieldLabelByKey = new Map(template.fields.map((field) => [field.fieldKey, field.label]))
              const sectionTitleByKey = new Map(sections.map((section) => [section.id, section.title]))
              const clinicalRuleByField = new Map(
                clinicalRules
                  .filter((rule) => rule.templateId === template.id && rule.active)
                  .map((rule) => [rule.fieldKey, rule]),
              )
              const isDirty = Boolean(dirty[template.slug])
              const isSaving = savingSlug === template.slug
              const isOpen = openSlug === template.slug
              const offCount = template.fields.filter((field) => field.active === false).length

              return (
                <motion.section
                  key={template.slug}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.26, ease: 'easeOut', delay: index * 0.02 }}
                  className={cn(
                    'overflow-hidden rounded-[0.35rem] bg-white outline outline-1 shadow-[0_24px_60px_-42px_rgba(0,33,71,0.28)] transition-colors',
                    isOpen ? 'outline-[#bcd0ea]' : 'outline-[#d4dde8]',
                  )}
                >
                  {/* Collapsed/expanded header - the whole bar toggles the editor open. */}
                  <button
                    type="button"
                    onClick={() => toggleOpen(template.slug)}
                    aria-expanded={isOpen}
                    className="flex w-full items-center gap-4 px-5 py-4 text-left transition-colors hover:bg-[#f8fafc] md:px-6"
                  >
                    <span
                      className={cn(
                        'flex h-9 w-9 shrink-0 items-center justify-center rounded-[0.3rem] transition-colors',
                        isOpen ? 'bg-[#005db6] text-white' : 'bg-[#edf4fb] text-[#005db6]',
                      )}
                    >
                      <ListChecks className="h-4 w-4" />
                    </span>

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                        <span className="truncate font-display text-[1.05rem] font-bold tracking-[-0.01em] text-[#000a1e]">
                          {template.name}
                        </span>
                        {isDirty ? (
                          <Badge variant="warning">Unsaved</Badge>
                        ) : null}
                      </div>
                      <p className="mt-0.5 hidden truncate text-sm leading-5 text-[#5f6670] sm:block">
                        {template.description}
                      </p>
                    </div>

                    <div className="hidden items-center gap-2 lg:flex">
                      <HeaderChip>{template.fields.length} questions</HeaderChip>
                      <HeaderChip>{template.activeDays.length} days/wk</HeaderChip>
                      {offCount ? <HeaderChip>{offCount} off</HeaderChip> : null}
                    </div>

                    <ChevronDown
                      className={cn(
                        'h-5 w-5 shrink-0 text-[#69727d] transition-transform duration-200',
                        isOpen && 'rotate-180 text-[#005db6]',
                      )}
                    />
                  </button>

                  {isOpen ? (
                    <motion.div
                      initial={{ opacity: 0, y: -4 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.18, ease: 'easeOut' }}
                      className="border-t border-[#eef2f6] px-5 pb-6 pt-5 md:px-6"
                    >
                      {/* Basics: name + description + save */}
                      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                        <div className="min-w-0 flex-1 space-y-3">
                          <div className="space-y-1.5">
                            <Caption>Report name</Caption>
                            <Input
                              aria-label="Report name"
                              value={template.name}
                              onChange={(event) =>
                                mutateTemplate(template.slug, (entry) => ({
                                  ...entry,
                                  name: event.target.value,
                                }))
                              }
                              className="h-11 max-w-xl font-display text-lg font-bold text-[#000a1e]"
                            />
                          </div>
                          <div className="space-y-1.5">
                            <Caption>Description</Caption>
                            <Textarea
                              aria-label="Report description"
                              value={template.description}
                              onChange={(event) =>
                                mutateTemplate(template.slug, (entry) => ({
                                  ...entry,
                                  description: event.target.value,
                                }))
                              }
                              rows={2}
                              className="min-h-[4.5rem] max-w-2xl text-sm"
                            />
                          </div>
                        </div>
                        <Button
                          onClick={() => void save(template)}
                          disabled={!isDirty || isSaving}
                          className="w-full shrink-0 lg:w-auto"
                        >
                          {isSaving ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Save className="h-4 w-4" />
                          )}
                          {isSaving ? 'Saving…' : isDirty ? 'Save changes' : 'All saved'}
                        </Button>
                      </div>

                      {/* Collection days */}
                      <div className="mt-7 border-t border-[#eef2f6] pt-6">
                        <FieldGroup
                          icon={<CalendarDays className="h-4 w-4" />}
                          title="Collection days"
                        >
                          <div className="flex flex-wrap gap-2">
                            {weekdays.map((day) => {
                              const on = template.activeDays.includes(day.key)
                              return (
                                <button
                                  key={day.key}
                                  type="button"
                                  onClick={() =>
                                    mutateTemplate(template.slug, (entry) => ({
                                      ...entry,
                                      activeDays: on
                                        ? entry.activeDays.filter((value) => value !== day.key)
                                        : [...entry.activeDays, day.key],
                                    }))
                                  }
                                  aria-pressed={on}
                                  className={cn(
                                    'rounded-full px-3.5 py-1.5 text-xs font-semibold uppercase tracking-[0.1em] outline outline-1 transition-[background-color,color,outline-color] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] motion-safe:active:scale-[0.97]',
                                    on
                                      ? 'bg-[#005db6] text-white outline-[#005db6]'
                                      : 'bg-white text-[#666970] outline-[#d4dde8] hover:outline-[#bcd0ea]',
                                  )}
                                >
                                  {day.label}
                                </button>
                              )
                            })}
                          </div>
                        </FieldGroup>
                      </div>

                      {/* Questions */}
                      <div className="mt-7 border-t border-[#eef2f6] pt-6">
                        <FieldGroup
                          icon={<ListChecks className="h-4 w-4" />}
                          title="Questions"
                          count={template.fields.length}
                        >
                          <div className="divide-y divide-[#eef2f6] overflow-hidden rounded-[0.4rem] border border-[#e6ecf3]">
                            {template.fields.map((field, fieldIndex) => {
                              const inactive = field.active === false
                              const isDecimal = field.fieldKind === 'decimal'
                              const fieldStateKey = `${template.slug}:${field.fieldKey}`
                              const settingsOpen = openFieldKey === fieldStateKey
                              const clinicalRule = clinicalRuleByField.get(field.fieldKey)

                              return (
                                <div
                                  key={field.fieldKey}
                                  className={cn(
                                    'transition-colors',
                                    settingsOpen ? 'bg-[#f8fafc]' : 'hover:bg-[#f8fafc]',
                                  )}
                                >
                                  {/* Primary row: reorder · question · type · settings · on/off */}
                                  <div
                                    className={cn(
                                      'flex items-center gap-3 px-3 py-2.5',
                                      inactive && 'opacity-55',
                                    )}
                                  >
                                    <div className="flex shrink-0 flex-col">
                                      <button
                                        type="button"
                                        aria-label="Move question up"
                                        onClick={() => moveField(template, fieldIndex, -1)}
                                        disabled={fieldIndex === 0}
                                        className="rounded-[0.25rem] p-0.5 text-[#69727d] hover:text-[#005db6] disabled:opacity-30 pointer-coarse:p-2.5"
                                      >
                                        <ArrowUp className="h-3.5 w-3.5" />
                                      </button>
                                      <button
                                        type="button"
                                        aria-label="Move question down"
                                        onClick={() => moveField(template, fieldIndex, 1)}
                                        disabled={fieldIndex === template.fields.length - 1}
                                        className="rounded-[0.25rem] p-0.5 text-[#69727d] hover:text-[#005db6] disabled:opacity-30 pointer-coarse:p-2.5"
                                      >
                                        <ArrowDown className="h-3.5 w-3.5" />
                                      </button>
                                    </div>

                                    <Input
                                      aria-label="Question label"
                                      value={field.label}
                                      onChange={(event) =>
                                        mutateTemplate(template.slug, (entry) => ({
                                          ...entry,
                                          fields: entry.fields.map((item) =>
                                            item.fieldKey === field.fieldKey
                                              ? { ...item, label: event.target.value }
                                              : item,
                                          ),
                                        }))
                                      }
                                      className="h-9 min-w-0 flex-1 border-transparent bg-transparent px-2 text-sm font-medium hover:border-[#d4dde8] hover:bg-white focus:border-[#bcd0ea] focus:bg-white"
                                    />

                                    <span className="hidden shrink-0 rounded-full border border-[#d4dde8] bg-[#f4f7fb] px-2.5 py-0.5 text-xs font-semibold text-[#526171] sm:inline">
                                      {prettyFieldType(field.fieldKind)}
                                    </span>

                                    {clinicalRule ? (
                                      <span className="hidden shrink-0 rounded-full border border-[#f4cfcf] bg-[#fdecec] px-2.5 py-0.5 text-xs font-semibold text-[#ba1a1a] lg:inline">
                                        Clinical alert · {operatorLabelForTemplate(clinicalRule.operator)} {clinicalRule.threshold}
                                      </span>
                                    ) : null}

                                    <button
                                      type="button"
                                      onClick={() =>
                                        setOpenFieldKey((current) =>
                                          current === fieldStateKey ? null : fieldStateKey,
                                        )
                                      }
                                      aria-expanded={settingsOpen}
                                      className={cn(
                                        'inline-flex shrink-0 items-center gap-1.5 rounded-[0.25rem] px-2 py-1.5 text-xs font-semibold transition-colors',
                                        settingsOpen
                                          ? 'bg-[#edf4fb] text-[#005db6]'
                                          : 'text-[#666970] hover:bg-[#edf1f5] hover:text-[#005db6]',
                                      )}
                                    >
                                      <Settings2 className="h-3.5 w-3.5" aria-hidden="true" />
                                      <span className="sr-only md:not-sr-only md:inline">Settings</span>
                                    </button>

                                    <Switch
                                      checked={!inactive}
                                      onCheckedChange={() => void toggleFieldActive(template, field)}
                                      aria-label={inactive ? 'Question hidden' : 'Question shown'}
                                      className="shrink-0"
                                    />
                                  </div>

                                  {/* Advanced per-field settings, revealed on demand. */}
                                  {settingsOpen ? (
                                    <div className="border-t border-[#e6ecf3] px-3 py-4">
                                      <div className={cn('mb-4 rounded-[0.3rem] border px-3 py-2.5 text-sm', clinicalRule ? 'border-[#f4cfcf] bg-[#fff7f7] text-[#8f1515]' : 'border-[#dbe3ec] bg-white text-[#657180]')}>
                                        {clinicalRule
                                          ? `Governed clinical alert: ${operatorLabelForTemplate(clinicalRule.operator)} ${clinicalRule.threshold}; ${clinicalRule.severity} severity; due in ${clinicalRule.deadlineHours} hours. Change this under Action items → Alert rules.`
                                          : 'Normal reporting field. It does not create a clinical action item. Add a rule under Action items → Alert rules if governance requires follow-up.'}
                                      </div>
                                      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                                        {sections.length ? (
                                          <label className="space-y-1.5">
                                            <Caption>Appears under</Caption>
                                            <Select
                                              value={field.sectionKey}
                                              onValueChange={(value) =>
                                                mutateTemplate(template.slug, (entry) => ({
                                                  ...entry,
                                                  fields: entry.fields.map((item) =>
                                                    item.fieldKey === field.fieldKey
                                                      ? { ...item, sectionKey: value }
                                                      : item,
                                                  ),
                                                }))
                                              }
                                            >
                                              <SelectTrigger className="h-9 text-sm" aria-label="Field group">
                                                <SelectValue placeholder="Choose a group" />
                                              </SelectTrigger>
                                              <SelectContent>
                                                {sections.map((section) => (
                                                  <SelectItem key={section.id} value={section.id}>
                                                    {sectionTitleByKey.get(section.id) ?? section.id}
                                                  </SelectItem>
                                                ))}
                                              </SelectContent>
                                            </Select>
                                          </label>
                                        ) : null}

                                        <label className="space-y-1.5">
                                          <Caption>Totals as</Caption>
                                          <Select
                                            value={field.aggregateType}
                                            onValueChange={(value) =>
                                              mutateTemplate(template.slug, (entry) => ({
                                                ...entry,
                                                fields: entry.fields.map((item) =>
                                                  item.fieldKey === field.fieldKey
                                                    ? {
                                                        ...item,
                                                        aggregateType:
                                                          value as ApiTemplateField['aggregateType'],
                                                      }
                                                    : item,
                                                ),
                                              }))
                                            }
                                          >
                                            <SelectTrigger className="h-9 text-sm" aria-label="Totals as">
                                              <SelectValue placeholder="How to total" />
                                            </SelectTrigger>
                                            <SelectContent>
                                              {aggregateOptions.map((aggregate) => (
                                                <SelectItem key={aggregate.value} value={aggregate.value}>
                                                  {aggregate.label}
                                                </SelectItem>
                                              ))}
                                            </SelectContent>
                                          </Select>
                                        </label>

                                        {isDecimal ? (
                                          <label className="space-y-1.5">
                                            <Caption>Unit (optional)</Caption>
                                            <Input
                                              value={field.metadata?.unit ?? ''}
                                              placeholder="e.g. mg, %, hrs"
                                              onChange={(event) =>
                                                mutateTemplate(template.slug, (entry) => ({
                                                  ...entry,
                                                  fields: entry.fields.map((item) =>
                                                    item.fieldKey === field.fieldKey
                                                      ? {
                                                          ...item,
                                                          metadata: {
                                                            ...(item.metadata ?? {}),
                                                            unit: event.target.value || undefined,
                                                          },
                                                        }
                                                      : item,
                                                  ),
                                                }))
                                              }
                                              className="h-9 text-sm"
                                            />
                                          </label>
                                        ) : null}
                                      </div>
                                    </div>
                                  ) : null}
                                </div>
                              )
                            })}
                          </div>
                        </FieldGroup>
                      </div>

                      {/* Advanced presentation: question groups and dashboard tiles. */}
                      {sections.length || cards.length ? (
                        <div className="mt-7 space-y-7 border-t border-[#eef2f6] pt-6">
                          {sections.length ? (
                            <FieldGroup
                              icon={<LayoutGrid className="h-4 w-4" />}
                              title="Question groups"
                            >
                              <div className="grid gap-3 sm:grid-cols-2">
                                {sections.map((section, sectionIndex) => (
                                  <label key={section.id} className="space-y-1.5">
                                    <Caption>Group {sectionIndex + 1}</Caption>
                                    <Input
                                      value={section.title}
                                      onChange={(event) =>
                                        mutateTemplate(template.slug, (entry) => {
                                          const nextSections = [...sections]
                                          nextSections[sectionIndex] = {
                                            ...section,
                                            title: event.target.value,
                                          }
                                          return setPresentation(entry, { sections: nextSections })
                                        })
                                      }
                                      className="h-10 text-sm"
                                    />
                                  </label>
                                ))}
                              </div>
                            </FieldGroup>
                          ) : null}

                          {cards.length ? (
                            <FieldGroup
                              icon={<Gauge className="h-4 w-4" />}
                              title="Dashboard tiles"
                            >
                              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                                {cards.map((card, cardIndex) => {
                                  const sourceLabel =
                                    card.sourceType === 'metric'
                                      ? metricSourceLabels[card.sourceId] ?? card.sourceId
                                      : fieldLabelByKey.get(card.sourceId) ?? card.sourceId

                                  return (
                                    <label key={card.id} className="space-y-1.5">
                                      <Caption>Tile {cardIndex + 1}</Caption>
                                      <Input
                                        value={card.label}
                                        onChange={(event) =>
                                          mutateTemplate(template.slug, (entry) => {
                                            const nextCards = [...cards]
                                            nextCards[cardIndex] = { ...card, label: event.target.value }
                                            return setPresentation(entry, { summaryCards: nextCards })
                                          })
                                        }
                                        className="h-10 text-sm"
                                      />
                                      <span className="block text-[12px] leading-4 text-[#666970]">
                                        Showing: {sourceLabel}
                                      </span>
                                    </label>
                                  )
                                })}
                              </div>
                            </FieldGroup>
                          ) : null}
                        </div>
                      ) : null}
                    </motion.div>
                  ) : null}
                </motion.section>
              )
            })
          )}
        </TabsContent>
      ))}
    </Tabs>
  )
}
