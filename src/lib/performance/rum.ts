import { getApiBrowserClient } from '@/lib/api/client'

type MetricName = 'LCP' | 'INP' | 'CLS' | 'route-transition'
type DeviceClass = 'mobile' | 'tablet' | 'desktop'

type RumPayload = {
  metric: MetricName
  value: number
  routeName: string
  deviceClass: DeviceClass
  releaseSha: string
}

const DYNAMIC_ROUTE_NAMES: Array<[RegExp, string]> = [
  [/^\/reports\/[^/]+\/[^/]+$/, '/reports/:assignmentId/:periodId'],
  [/^\/admin\/departments\/[^/]+$/, '/admin/departments/:departmentId'],
  [/^\/admin\/academic\/people\/[^/]+$/, '/admin/academic/people/:userId'],
]
const STATIC_ROUTE_PATTERN = /^\/[a-z0-9/-]*$/i
const releaseSha = (import.meta.env.VITE_RELEASE_SHA || 'unknown').slice(0, 64)

let activeRouteName =
  typeof window === 'undefined' ? '/' : routeNameFromPath(window.location.pathname)
let reportingEnabled = false
let reportingStarted = false
let sampledForPage = false
let pendingRouteTransition: { routeName: string; startedAt: number } | null = null

export function routeNameFromPath(pathname: string): string {
  const normalized = `/${pathname.split('?')[0].split('#')[0].split('/').filter(Boolean).join('/')}`

  for (const [pattern, routeName] of DYNAMIC_ROUTE_NAMES) {
    if (pattern.test(normalized)) {
      return routeName
    }
  }

  return STATIC_ROUTE_PATTERN.test(normalized) && normalized.length <= 120
    ? normalized
    : '/unknown'
}

export function deviceClassForWidth(width: number): DeviceClass {
  if (width < 640) return 'mobile'
  if (width < 1024) return 'tablet'

  return 'desktop'
}

export function rumSampleRate(value: string | undefined, production: boolean): number {
  if (value === undefined || value.trim() === '') {
    return production ? 0.1 : 0
  }

  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.min(1, Math.max(0, parsed)) : 0
}

function sendMetric(metric: MetricName, value: number, routeName = activeRouteName) {
  if (!reportingEnabled || !sampledForPage || !Number.isFinite(value) || value < 0) {
    return
  }

  const client = getApiBrowserClient()
  if (!client) {
    return
  }

  const payload: RumPayload = {
    metric,
    value,
    routeName,
    deviceClass: deviceClassForWidth(window.innerWidth),
    releaseSha,
  }

  void client.post<void>('/api/performance/rum', payload, {
    keepalive: true,
    timeoutMs: 5_000,
  }).catch(() => {
    // RUM is a sampled progressive enhancement and must never disrupt the app.
  })
}

export function setRumEnabled(enabled: boolean) {
  reportingEnabled = enabled
}

export async function startWebVitalsReporting() {
  if (reportingStarted) {
    return
  }

  reportingStarted = true
  const sampleRate = rumSampleRate(
    import.meta.env.VITE_RUM_SAMPLE_RATE,
    import.meta.env.PROD,
  )
  sampledForPage = Math.random() < sampleRate

  if (!sampledForPage) {
    return
  }

  const { onCLS, onINP, onLCP } = await import('web-vitals')
  onCLS((metric) => sendMetric('CLS', metric.value))
  onINP((metric) => sendMetric('INP', metric.value))
  onLCP((metric) => sendMetric('LCP', metric.value))
}

export function markRouteTransitionStarted(targetPath: string) {
  pendingRouteTransition = {
    routeName: routeNameFromPath(targetPath),
    startedAt: performance.now(),
  }
}

export function settleRouteTransition(pathname: string) {
  activeRouteName = routeNameFromPath(pathname)
  const pending = pendingRouteTransition

  if (!pending || pending.routeName !== activeRouteName) {
    return
  }

  pendingRouteTransition = null
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      sendMetric(
        'route-transition',
        performance.now() - pending.startedAt,
        pending.routeName,
      )
    })
  })
}
