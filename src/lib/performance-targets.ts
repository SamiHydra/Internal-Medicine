import type { PerformanceTarget, PerformanceTargetKey } from '@/types/domain'

export type RagStatus = 'green' | 'amber' | 'red' | 'neutral'

export const performanceTargetDefinitions: Array<{
  key: PerformanceTargetKey
  label: string
  unit: '%' | 'count'
}> = [
  { key: 'deliveryRate', label: 'Delivery rate', unit: '%' },
  { key: 'inpatientSafetyEvents', label: 'Safety events', unit: 'count' },
  { key: 'outpatientSameDayRate', label: 'Same-day outpatient', unit: '%' },
  { key: 'procedureThroughput', label: 'Procedure throughput', unit: 'count' },
]

export const defaultMetricTargets: Record<PerformanceTargetKey, PerformanceTarget> = {
  deliveryRate: {
    enabled: true,
    direction: 'atLeast',
    amber: 75,
    green: 90,
  },
  inpatientSafetyEvents: {
    enabled: true,
    direction: 'atMost',
    amber: 3,
    green: 0,
  },
  outpatientSameDayRate: {
    enabled: true,
    direction: 'atLeast',
    amber: 75,
    green: 90,
  },
  procedureThroughput: {
    enabled: true,
    direction: 'atLeast',
    amber: 50,
    green: 100,
  },
}

export function evaluateMetricTarget(
  value: number | null | undefined,
  target: PerformanceTarget | undefined,
): RagStatus {
  if (!target?.enabled || value === null || value === undefined || Number.isNaN(value)) {
    return 'neutral'
  }

  if (target.direction === 'atMost') {
    if (value <= target.green) {
      return 'green'
    }

    return value <= target.amber ? 'amber' : 'red'
  }

  if (value >= target.green) {
    return 'green'
  }

  return value >= target.amber ? 'amber' : 'red'
}

export function formatTargetThreshold(target: PerformanceTarget | undefined, unit: '%' | 'count') {
  if (!target?.enabled) {
    return 'No target'
  }

  const suffix = unit === '%' ? '%' : ''
  const comparator = target.direction === 'atMost' ? '<=' : '>='

  return `${comparator} ${target.green}${suffix}`
}
