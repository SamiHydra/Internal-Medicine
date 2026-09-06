import { describe, expect, it } from 'vitest'

import {
  DASHBOARD_CHART_MAX_ANIMATED_POINTS,
  shouldAnimateDashboardChart,
} from '@/lib/chart-motion'

describe('dashboard chart motion policy', () => {
  it('allows a priority chart with a small data series', () => {
    expect(
      shouldAnimateDashboardChart(DASHBOARD_CHART_MAX_ANIMATED_POINTS, {
        reduceMotion: false,
      }),
    ).toBe(true)
  })

  it('renders large, empty, and non-priority charts immediately', () => {
    expect(
      shouldAnimateDashboardChart(DASHBOARD_CHART_MAX_ANIMATED_POINTS + 1, {
        reduceMotion: false,
      }),
    ).toBe(false)
    expect(shouldAnimateDashboardChart(0, { reduceMotion: false })).toBe(false)
    expect(
      shouldAnimateDashboardChart(8, {
        reduceMotion: false,
        priority: false,
      }),
    ).toBe(false)
  })

  it('honours the operating-system reduced-motion preference', () => {
    expect(shouldAnimateDashboardChart(8, { reduceMotion: true })).toBe(false)
  })
})
