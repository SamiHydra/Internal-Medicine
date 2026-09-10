/**
 * Clinical action descriptions are generated, not typed, so they arrive as one
 * long sentence: a department, a comma-run of metric names each carrying its
 * count in brackets, then the same instruction on every single item. Read as a
 * paragraph that is four dense lines of grey text; read as a list it is six
 * short rows. These helpers recover the list without touching stored data - the
 * description column stays exactly as it was written.
 */

/** The closing instruction, identical on every item and never news. */
const FOLLOW_UP_BOILERPLATE = /\s*Investigate[^.]*\.\s*$/i

/** "<department> reported: <metric list>". Only the list form carries a colon. */
const REPORTED_LIST = /^(.+?)\s+reported:\s*(.+?)\.?$/

/** A comma that separates metrics, not one inside a metric's own name. */
const METRIC_SEPARATOR = /,\s+(?=[A-Z])/

/** "Number of New Deaths (2)" - the trailing bracket holds the count. */
const METRIC_WITH_COUNT = /^(.+?)\s*\((\d+)\)$/

export type ReportedMetrics = {
  /** The department that reported them. */
  lead: string
  metrics: { label: string; count: string }[]
}

export function stripFollowUpBoilerplate(description: string): string {
  return description.replace(FOLLOW_UP_BOILERPLATE, '').trim()
}

/**
 * Recovers the metric list from a generated description, or null when the text
 * is not that shape - a manually written description, or a newer single-value
 * one. Every part must parse: a half-understood description would be worse than
 * the plain sentence, so anything unexpected falls back to it untouched.
 */
export function parseReportedMetrics(
  description: string | null | undefined,
): ReportedMetrics | null {
  if (!description) return null

  const match = REPORTED_LIST.exec(stripFollowUpBoilerplate(description))
  if (!match) return null

  const metrics = match[2].split(METRIC_SEPARATOR).map((part) => {
    const metric = METRIC_WITH_COUNT.exec(part.trim())
    return metric ? { label: metric[1].trim(), count: metric[2] } : null
  })

  if (metrics.some((metric) => metric === null)) return null

  return {
    lead: match[1].trim(),
    metrics: metrics as ReportedMetrics['metrics'],
  }
}
