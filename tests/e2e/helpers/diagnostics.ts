import type { Page, ConsoleMessage, Request, Response } from '@playwright/test'

export type PageDiagnostics = {
  consoleErrors: string[]
  consoleWarnings: string[]
  pageErrors: string[]
  failedRequests: string[]
  /** All API responses observed, for status/timing assertions. */
  apiResponses: { url: string; status: number }[]
}

/**
 * Attach listeners that record console errors/warnings, uncaught page errors,
 * failed network requests and API response statuses. Call BEFORE navigation.
 *
 * Known-benign noise (favicon, Vite HMR, ResizeObserver) is filtered so real
 * problems stand out.
 */
export function captureDiagnostics(page: Page): PageDiagnostics {
  const diag: PageDiagnostics = {
    consoleErrors: [],
    consoleWarnings: [],
    pageErrors: [],
    failedRequests: [],
    apiResponses: [],
  }

  const benign = (text: string): boolean =>
    /favicon|ResizeObserver loop|\[vite\]|hmr|Download the React DevTools|sourcemap/i.test(text)

  page.on('console', (msg: ConsoleMessage) => {
    const text = msg.text()
    if (benign(text)) return
    if (msg.type() === 'error') diag.consoleErrors.push(text)
    else if (msg.type() === 'warning') diag.consoleWarnings.push(text)
  })

  page.on('pageerror', (err: Error) => {
    diag.pageErrors.push(err.message)
  })

  page.on('requestfailed', (req: Request) => {
    const url = req.url()
    if (benign(url)) return
    // Vite dev assets and HMR pings can abort harmlessly on navigation.
    if (/\/@vite\/|\.hot-update\.|__vite_ping/.test(url)) return
    diag.failedRequests.push(`${req.method()} ${url} - ${req.failure()?.errorText ?? 'failed'}`)
  })

  page.on('response', (res: Response) => {
    const url = res.url()
    if (/\/api\//.test(url)) {
      diag.apiResponses.push({ url, status: res.status() })
      if (res.status() >= 500) {
        diag.failedRequests.push(`HTTP ${res.status()} ${res.request().method()} ${url}`)
      }
    }
  })

  return diag
}

/** Convenience: format diagnostics for an assertion message. */
export function summarize(diag: PageDiagnostics): string {
  return [
    diag.consoleErrors.length ? `consoleErrors: ${JSON.stringify(diag.consoleErrors)}` : '',
    diag.pageErrors.length ? `pageErrors: ${JSON.stringify(diag.pageErrors)}` : '',
    diag.failedRequests.length ? `failedRequests: ${JSON.stringify(diag.failedRequests)}` : '',
  ]
    .filter(Boolean)
    .join(' | ')
}
