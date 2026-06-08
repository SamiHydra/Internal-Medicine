import { describe, expect, it } from 'vitest'

import { evaluateMetricTarget, formatTargetThreshold } from './performance-targets'
import type { PerformanceTarget } from '@/types/domain'

describe('performance-targets', () => {
  const atLeastTarget: PerformanceTarget = {
    enabled: true,
    direction: 'atLeast',
    amber: 75,
    green: 90,
  }
  const atMostTarget: PerformanceTarget = {
    enabled: true,
    direction: 'atMost',
    amber: 3,
    green: 0,
  }

  it('evaluates higher-is-better targets', () => {
    expect(evaluateMetricTarget(92, atLeastTarget)).toBe('green')
    expect(evaluateMetricTarget(80, atLeastTarget)).toBe('amber')
    expect(evaluateMetricTarget(60, atLeastTarget)).toBe('red')
  })

  it('evaluates lower-is-better targets', () => {
    expect(evaluateMetricTarget(0, atMostTarget)).toBe('green')
    expect(evaluateMetricTarget(2, atMostTarget)).toBe('amber')
    expect(evaluateMetricTarget(5, atMostTarget)).toBe('red')
  })

  it('returns neutral when a target is disabled or the value is missing', () => {
    expect(evaluateMetricTarget(null, atLeastTarget)).toBe('neutral')
    expect(evaluateMetricTarget(90, { ...atLeastTarget, enabled: false })).toBe('neutral')
  })

  it('formats the green threshold for compact chips', () => {
    expect(formatTargetThreshold(atLeastTarget, '%')).toBe('>= 90%')
    expect(formatTargetThreshold(atMostTarget, 'count')).toBe('<= 0')
    expect(formatTargetThreshold(undefined, '%')).toBe('No target')
  })
})
