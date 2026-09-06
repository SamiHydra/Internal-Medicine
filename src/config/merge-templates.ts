import type { ApiTemplateConfig, ApiTemplateField } from '@/lib/api/types'
import type { ReportTemplateConfig, ReportTemplateField } from '@/types/domain'

/**
 * Overlays admin edits (from the DB, serialized as ApiTemplateConfig) onto the
 * static config templates, which act as the guaranteed runtime FLOOR. The config
 * is never undercut: a missing/empty DB payload returns the config verbatim, an
 * unmatched template keeps its config definition, and every config field key is
 * preserved (so dashboards coupled to literal keys never break). Soft-disabled
 * fields (active === false) are dropped from the form/render shape; field keys
 * and kinds are taken from the config and never mutated by an edit.
 */
export function mergeTemplateOverrides(
  configTemplates: ReportTemplateConfig[],
  dbTemplates: ApiTemplateConfig[] | null | undefined,
): ReportTemplateConfig[] {
  if (!dbTemplates?.length) {
    return configTemplates
  }

  const dbBySlug = new Map(dbTemplates.map((template) => [template.slug, template]))

  return configTemplates.map((config) => {
    const db = dbBySlug.get(config.id)
    return db ? mergeOne(config, db) : config
  })
}

function mergeOne(config: ReportTemplateConfig, db: ApiTemplateConfig): ReportTemplateConfig {
  const presentation = db.metadata?.presentation ?? {}
  const dbFieldByKey = new Map<string, ApiTemplateField>(
    db.fields.map((field) => [field.fieldKey, field]),
  )

  // Config fields are the floor; overlay DB attributes, drop soft-disabled fields.
  const mergedConfigFields = config.fields
    .map((field) => {
      const dbField = dbFieldByKey.get(field.id)
      if (!dbField) {
        return { field, order: undefined as number | undefined }
      }
      if (dbField.active === false) {
        return null
      }
      return { field: overlayField(field, dbField), order: dbField.displayOrder }
    })
    .filter((entry): entry is { field: ReportTemplateField; order: number | undefined } => entry !== null)

  // Any extra active DB fields not present in the config (e.g. future custom
  // fields) are appended, mapped to the config shape.
  const configKeys = new Set(config.fields.map((field) => field.id))
  const extraFields = db.fields
    .filter((field) => field.active !== false && !configKeys.has(field.fieldKey))
    .map((field) => ({ field: apiFieldToConfig(field), order: field.displayOrder }))

  const fields = [...mergedConfigFields, ...extraFields]
    .sort((a, b) => (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER))
    .map((entry) => entry.field)

  return {
    ...config,
    name: db.name || config.name,
    description: db.description || config.description,
    activeDays: (db.activeDays as ReportTemplateConfig['activeDays']) ?? config.activeDays,
    sections: presentation.sections ?? config.sections,
    summaryCards: presentation.summaryCards ?? config.summaryCards,
    chartMappings: presentation.chartMappings ?? config.chartMappings,
    fields,
  }
}

/** Overlay editable attributes from a DB field onto a config field. Key + kind stay from config (immutable). */
function overlayField(field: ReportTemplateField, db: ApiTemplateField): ReportTemplateField {
  const meta = db.metadata ?? {}
  return {
    ...field,
    label: db.label || field.label,
    sectionId: db.sectionKey || field.sectionId,
    aggregate: (db.aggregateType as ReportTemplateField['aggregate']) ?? field.aggregate,
    unit: meta.unit ?? field.unit,
    description: meta.description ?? field.description,
    readOnlyWeeklyTotal: meta.readOnlyWeeklyTotal ?? field.readOnlyWeeklyTotal,
    highlightWhenNonZero: meta.highlightWhenNonZero ?? field.highlightWhenNonZero,
    options: meta.options ?? field.options,
  }
}

function apiFieldToConfig(db: ApiTemplateField): ReportTemplateField {
  const meta = db.metadata ?? {}
  return {
    id: db.fieldKey,
    label: db.label,
    sectionId: db.sectionKey,
    kind: db.fieldKind,
    aggregate: db.aggregateType,
    unit: meta.unit,
    description: meta.description,
    readOnlyWeeklyTotal: meta.readOnlyWeeklyTotal,
    highlightWhenNonZero: meta.highlightWhenNonZero,
    options: meta.options,
  }
}
