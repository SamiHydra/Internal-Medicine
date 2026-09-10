import { getApiBrowserClient, setApiFailureObserver } from '@/lib/api/client'
import { routeNameFromPath } from '@/lib/performance/rum'

/**
 * Client-side error reporting (docs/OBSERVABILITY.md).
 *
 * Captures uncaught exceptions, unhandled promise rejections, route render
 * failures, API 5xx answers and offline-sync failures, sanitises them and posts
 * them to POST /api/client-errors, which logs and forwards them server-side.
 * Nothing here is essential to the app: every path swallows its own errors,
 * reports are deduplicated and capped per page load, and no report ever
 * carries form values, report cells, evaluation content or credentials.
 */

export type ClientErrorKind = 'error' | 'unhandledrejection' | 'render' | 'api' | 'offline-sync'

export type ClientErrorReport = {
  kind: ClientErrorKind
  message: string
  stack?: string | null
  routeName: string
  status?: number | null
  releaseSha: string
  userAgent: string
  fingerprint: string
}

const MAX_REPORTS_PER_PAGE = 10
const MAX_MESSAGE_LENGTH = 500
const MAX_STACK_LENGTH = 4000
const REPORT_ENDPOINT = '/api/client-errors'
const releaseSha = (import.meta.env.VITE_RELEASE_SHA || 'unknown').slice(0, 64)

let installed = false
let sentCount = 0
const seenFingerprints = new Set<string>()

/** Redact credential-looking fragments and personal addresses from free text. */
export function scrubText(value: string, maxLength = MAX_MESSAGE_LENGTH): string {
  const scrubbed = value
    // key=value credentials in query strings or messages
    .replace(/\b(pass(?:word|wd)?|secret|token|api[_-]?key|signature|otp)(\s*[=:]\s*)[^&\s,;'"]+/gi, '$1$2[redacted]')
    // authorization header values
    .replace(/\b(bearer|basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, '$1 [redacted]')
    // long opaque tokens (session ids, encrypted cookies)
    .replace(/\b[A-Za-z0-9+/]{40,}={0,2}\b/g, '[redacted]')
    // query strings on URLs (reset links, ids)
    .replace(/(https?:\/\/[^\s?#]+)\?[^\s#]*/g, '$1?[query-redacted]')
    // e-mail addresses: keep the domain
    .replace(/\b([A-Za-z0-9._%+-])[A-Za-z0-9._%+-]*@([A-Za-z0-9.-]+\.[A-Za-z]{2,})\b/g, '$1***@$2')

  return scrubbed.length > maxLength ? `${scrubbed.slice(0, maxLength)}…` : scrubbed
}

/** Stable, short identifier so the same failure is reported once per page load. */
export function fingerprintFor(kind: string, message: string, routeName: string): string {
  const input = `${kind}|${message}|${routeName}`
  let hash = 0

  for (let index = 0; index < input.length; index += 1) {
    hash = (hash * 31 + input.charCodeAt(index)) | 0
  }

  return `${kind}-${(hash >>> 0).toString(16)}`.slice(0, 64)
}

function describeError(error: unknown): { message: string; stack: string | null } {
  if (error instanceof Error) {
    return {
      message: scrubText(`${error.name}: ${error.message}`),
      stack: error.stack ? scrubText(error.stack, MAX_STACK_LENGTH) : null,
    }
  }

  if (typeof error === 'string') {
    return { message: scrubText(error), stack: null }
  }

  return { message: scrubText(`Non-error value thrown (${typeof error})`), stack: null }
}

function currentRouteName() {
  return typeof window === 'undefined' ? '/' : routeNameFromPath(window.location.pathname)
}

export function buildClientErrorReport(
  kind: ClientErrorKind,
  error: unknown,
  options?: { status?: number | null; routeName?: string },
): ClientErrorReport {
  const { message, stack } = describeError(error)
  const routeName = options?.routeName ?? currentRouteName()

  return {
    kind,
    message,
    stack,
    routeName,
    status: options?.status ?? null,
    releaseSha,
    userAgent: typeof navigator === 'undefined' ? '' : navigator.userAgent.slice(0, 200),
    fingerprint: fingerprintFor(kind, message, routeName),
  }
}

/** True when the report was accepted for sending (not a duplicate, under the cap). */
export function reportClientError(
  kind: ClientErrorKind,
  error: unknown,
  options?: { status?: number | null; routeName?: string },
): boolean {
  if (typeof window === 'undefined') {
    return false
  }

  const report = buildClientErrorReport(kind, error, options)

  if (seenFingerprints.has(report.fingerprint) || sentCount >= MAX_REPORTS_PER_PAGE) {
    return false
  }

  seenFingerprints.add(report.fingerprint)
  sentCount += 1

  const client = getApiBrowserClient()
  if (!client) {
    return false
  }

  void client
    .post<void>(REPORT_ENDPOINT, report, { keepalive: true, timeoutMs: 5_000 })
    .catch(() => {
      // Reporting is best-effort and must never produce a second failure.
    })

  return true
}

/**
 * Wire the window-level hooks and the API client's failure observer. Idempotent.
 */
export function installGlobalErrorReporting() {
  if (installed || typeof window === 'undefined') {
    return
  }

  installed = true

  window.addEventListener('error', (event) => {
    // Resource load failures (a missing chunk) arrive here without an Error.
    reportClientError('error', event.error ?? event.message)
  })

  window.addEventListener('unhandledrejection', (event) => {
    reportClientError('unhandledrejection', event.reason)
  })

  setApiFailureObserver((status, path) => {
    if (status < 500 || path.startsWith(REPORT_ENDPOINT)) {
      return
    }

    reportClientError('api', `API answered ${status} for ${path}`, { status })
  })
}

/** Test seam. */
export function resetClientErrorReportingForTests() {
  installed = false
  sentCount = 0
  seenFingerprints.clear()
  setApiFailureObserver(null)
}
