import type { ReportFieldValue, ReportTemplateConfig, Weekday } from '@/types/domain'

const weekdayLabels: Record<Weekday, string> = {
  monday: 'Mon',
  tuesday: 'Tue',
  wednesday: 'Wed',
  thursday: 'Thu',
  friday: 'Fri',
  saturday: 'Sat',
  sunday: 'Sun',
}

export type ReportConflictRow = {
  key: string
  fieldLabel: string
  dayLabel: string
  localValue: string
  serverValue: string | null
}

function cellText(value: unknown) {
  if (value === null || value === undefined || value === '') {
    return ''
  }

  return String(value)
}

/**
 * Cells where the user's copy and the server's copy disagree. Without a server
 * copy (the server refused without describing its state) every non-empty local
 * cell is listed so the user can still see and copy what they entered.
 */
export function buildConflictRows(
  template: ReportTemplateConfig,
  localValues: Record<string, ReportFieldValue>,
  serverValues: Record<string, ReportFieldValue> | null,
): ReportConflictRow[] {
  const rows: ReportConflictRow[] = []

  for (const field of template.fields) {
    for (const day of template.activeDays) {
      const localValue = cellText(localValues[field.id]?.dailyValues[day])
      const serverValue = serverValues ? cellText(serverValues[field.id]?.dailyValues[day]) : null

      const differs = serverValues ? localValue !== serverValue : localValue !== ''
      if (!differs) {
        continue
      }

      rows.push({
        key: `${field.id}:${day}`,
        fieldLabel: field.label,
        dayLabel: weekdayLabels[day],
        localValue,
        serverValue,
      })
    }
  }

  return rows
}

export function conflictRowsToText(rows: ReportConflictRow[]) {
  return rows
    .map((row) =>
      row.serverValue === null
        ? `${row.fieldLabel} (${row.dayLabel}): ${row.localValue || '-'}`
        : `${row.fieldLabel} (${row.dayLabel}): mine ${row.localValue || '-'} / server ${row.serverValue || '-'}`,
    )
    .join('\n')
}

