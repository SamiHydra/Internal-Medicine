import type {
  CalculatedMetricSet,
  CellValue,
  ReportRecord,
  ReportTemplateField,
  Weekday,
} from '@/types/domain'

const weekdayOrder: Weekday[] = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
]

export function toNumeric(value: CellValue | undefined) {
  if (typeof value === 'number') {
    return value
  }

  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    return Number.isNaN(parsed) ? null : parsed
  }

  return null
}

export function getNumericTotal(values: Partial<Record<Weekday, CellValue>>) {
  return weekdayOrder.reduce((total, day) => {
    const numericValue = toNumeric(values[day])
    return total + (numericValue ?? 0)
  }, 0)
}

export function getNumericAverage(values: Partial<Record<Weekday, CellValue>>) {
  const collected = weekdayOrder
    .map((day) => toNumeric(values[day]))
    .filter((value): value is number => value !== null)

  if (!collected.length) {
    return null
  }

  return collected.reduce((total, value) => total + value, 0) / collected.length
}

export function computeWeeklyValue(
  field: ReportTemplateField,
  values: Partial<Record<Weekday, CellValue>>,
) {
  switch (field.aggregate) {
    case 'sum':
      return getNumericTotal(values)
    case 'average':
      return getNumericAverage(values)
    case 'latest': {
      const latestValue = [...weekdayOrder]
        .reverse()
        .map((day) => values[day])
        .find((value) => value !== undefined && value !== null && value !== '')

      return latestValue ?? null
    }
    case 'none':
      return null
    default:
      return null
  }
}

function safeDivide(numerator: number, denominator: number) {
  if (denominator === 0) {
    return null
  }

  return numerator / denominator
}

export function calculateInpatientMetrics(
  report: ReportRecord,
  bedCount: number | undefined,
) {
  const totalPatientDays = getNumericTotal(
    report.values.total_patient_days?.dailyValues ?? {},
  )
  const totalDischarge =
    getNumericTotal(report.values.discharged_home?.dailyValues ?? {}) +
    getNumericTotal(report.values.discharged_ama?.dailyValues ?? {})

  const borBase = bedCount ? bedCount * 30 : 0
  const borPercent = safeDivide(totalPatientDays, borBase)
  const btr = bedCount ? safeDivide(totalDischarge, bedCount) : null
  const alos = safeDivide(totalPatientDays, totalDischarge)

  return {
    borPercent: borPercent === null ? null : borPercent * 100,
    btr,
    alos,
  } satisfies CalculatedMetricSet
}

export function recomputeMetricsForReport(
  report: ReportRecord,
  family: 'inpatient' | 'outpatient' | 'procedure',
  bedCount?: number,
) {
  if (family !== 'inpatient') {
    return report.calculatedMetrics
  }

  return calculateInpatientMetrics(report, bedCount)
}
