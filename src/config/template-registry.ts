import {
  reportTemplates as configTemplates,
  templateMap as configTemplateMap,
} from '@/config/templates'
import { mergeTemplateOverrides } from '@/config/merge-templates'
import type { ApiTemplateConfig } from '@/lib/api/types'
import type { ReportTemplateConfig } from '@/types/domain'

/**
 * Runtime template registry. Initialized to the static config (the guaranteed
 * FLOOR, so module-scope consumers like selectors.ts never see an empty map and
 * never crash) and re-hydrated with DB edits merged over the config whenever the
 * workspace bootstrap/refresh resolves. The container object is mutated in place
 * so existing `templateStore.map[...]` / `templateStore.list` reads stay live.
 */
export const templateStore: {
  list: ReportTemplateConfig[]
  map: Record<string, ReportTemplateConfig>
} = {
  list: configTemplates,
  map: configTemplateMap,
}

/** Merge DB template edits over the config floor and hydrate the registry. */
export function hydrateTemplatesFromApi(dbTemplates: ApiTemplateConfig[] | null | undefined): void {
  const merged = mergeTemplateOverrides(configTemplates, dbTemplates)
  templateStore.list = merged
  templateStore.map = Object.fromEntries(merged.map((template) => [template.id, template]))
}
