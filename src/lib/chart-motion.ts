export const DASHBOARD_CHART_MAX_ANIMATED_POINTS = 30
export const DASHBOARD_CHART_ANIMATION_DURATION_MS = 420

export function shouldAnimateDashboardChart(
  pointCount: number,
  {
    reduceMotion,
    priority = true,
  }: {
    reduceMotion: boolean | null
    priority?: boolean
  },
): boolean {
  return (
    priority &&
    reduceMotion !== true &&
    Number.isFinite(pointCount) &&
    pointCount > 0 &&
    pointCount <= DASHBOARD_CHART_MAX_ANIMATED_POINTS
  )
}
