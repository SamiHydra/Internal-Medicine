import { test, expect, type Page, type TestInfo } from '@playwright/test'
import { authFile } from './helpers/auth'

/**
 * Captures real browser metrics for the performance report. Thresholds are
 * intentionally lenient (catch only catastrophic regressions on a dev build);
 * the recorded numbers are the deliverable.
 */
async function measure(page: Page, label: string, testInfo: TestInfo) {
  // Accumulate layout shift from first paint.
  await page.addInitScript(() => {
    ;(window as unknown as { __cls: number }).__cls = 0
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as unknown as { value: number; hadRecentInput: boolean }[]) {
        if (!entry.hadRecentInput) (window as unknown as { __cls: number }).__cls += entry.value
      }
    }).observe({ type: 'layout-shift', buffered: true })
  })

  const t0 = Date.now()
  await page.goto(label === 'login' ? '/login' : label, { waitUntil: 'load' })
  if (label !== 'login') {
    await page.getByRole('button', { name: 'Notifications' }).first().waitFor({ timeout: 20_000 })
  }
  await page.waitForLoadState('networkidle').catch(() => {})
  const wallMs = Date.now() - t0

  const metrics = await page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined
    const paint = performance.getEntriesByType('paint') as PerformanceEntry[]
    const res = performance.getEntriesByType('resource') as PerformanceResourceTiming[]
    const byType = (init: string) => res.filter((r) => r.initiatorType === init)
    const sum = (arr: PerformanceResourceTiming[]) => arr.reduce((a, r) => a + (r.transferSize || 0), 0)
    const top = [...res]
      .sort((a, b) => (b.transferSize || 0) - (a.transferSize || 0))
      .slice(0, 8)
      .map((r) => ({ name: r.name.split('/').pop(), kb: Math.round((r.transferSize || 0) / 1024), ms: Math.round(r.duration) }))
    const slow = res.filter((r) => r.duration > 1000).map((r) => ({ name: r.name, ms: Math.round(r.duration) }))
    return {
      domContentLoaded: nav ? Math.round(nav.domContentLoadedEventEnd) : null,
      loadEvent: nav ? Math.round(nav.loadEventEnd) : null,
      domInteractive: nav ? Math.round(nav.domInteractive) : null,
      firstContentfulPaint: Math.round(paint.find((p) => p.name === 'first-contentful-paint')?.startTime ?? 0),
      requestCount: res.length,
      totalTransferKb: Math.round(sum(res) / 1024),
      scriptTransferKb: Math.round(sum(byType('script')) / 1024),
      cssTransferKb: Math.round(sum(byType('link')) / 1024),
      slowRequests: slow,
      topResources: top,
      cls: Number((window as unknown as { __cls: number }).__cls?.toFixed(4) ?? 0),
      jsHeapMb: (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory
        ? Math.round((performance as unknown as { memory: { usedJSHeapSize: number } }).memory.usedJSHeapSize / 1048576)
        : null,
    }
  })

  const record = { label, wallMs, ...metrics }
  console.log('PERF_METRIC ' + JSON.stringify(record))
  await testInfo.attach(`perf-${label.replace(/\//g, '_')}.json`, {
    body: JSON.stringify(record, null, 2),
    contentType: 'application/json',
  })
  return record
}

function p95(samples: number[]) {
  const sorted = [...samples].sort((left, right) => left - right)
  return sorted[Math.ceil(sorted.length * 0.95) - 1]
}

test.describe('Performance metrics', () => {
  test('login page load metrics', async ({ page }, testInfo) => {
    const m = await measure(page, 'login', testInfo)
    expect(m.wallMs, `login wall time ${m.wallMs}ms`).toBeLessThan(15_000)
    expect.soft(m.cls, `login CLS ${m.cls}`).toBeLessThan(0.1)
  })

  test.describe('authenticated heavy pages', () => {
    test.use({ storageState: authFile('superadmin') })

    test('admin clinical dashboard metrics', async ({ page }, testInfo) => {
      const m = await measure(page, '/admin', testInfo)
      expect(m.wallMs, `admin dashboard wall time ${m.wallMs}ms`).toBeLessThan(20_000)
      expect.soft(m.cls, `admin CLS ${m.cls}`).toBeLessThan(0.25)
    })

    test('admin academic dashboard metrics', async ({ page }, testInfo) => {
      const m = await measure(page, '/admin/academic', testInfo)
      expect(m.wallMs).toBeLessThan(20_000)
    })

    test('admin navigation stays within interaction budgets', async ({ page }, testInfo) => {
      test.setTimeout(90_000)

      const sampleTransition = async ({
        link,
        readyHeading,
        settleMs,
      }: {
        link: string
        readyHeading: string
        settleMs: number
      }) => {
        const samples: number[] = []

        for (let index = 0; index < 3; index += 1) {
          await page.goto('/admin', { waitUntil: 'load' })
          const navLink = page.getByRole('link', { name: link, exact: true })
          await navLink.waitFor({ state: 'visible' })
          // Real pointer navigation warms the matching lazy route on hover.
          // Start that prefetch before the settled-user pause so this measures
          // the interaction design the shell actually exposes.
          await navLink.hover()
          if (settleMs) {
            await page.waitForTimeout(settleMs)
          }

          const started = Date.now()
          await navLink.click()
          await page.getByRole('heading', { name: readyHeading, exact: true }).first().waitFor()
          samples.push(Date.now() - started)
        }

        return samples
      }

      const results = {
        submissionsEarly: await sampleTransition({
          link: 'Submissions',
          readyHeading: 'Current reporting board',
          settleMs: 0,
        }),
        submissionsSettled: await sampleTransition({
          link: 'Submissions',
          readyHeading: 'Current reporting board',
          settleMs: 1500,
        }),
        usersSettled: await sampleTransition({
          link: 'Users & Access',
          readyHeading: 'Users & Access',
          settleMs: 1500,
        }),
        auditSettled: await sampleTransition({
          link: 'Audit Log',
          readyHeading: 'Audit Log',
          settleMs: 1500,
        }),
        settingsSettled: await sampleTransition({
          link: 'Settings',
          readyHeading: 'Settings',
          settleMs: 1500,
        }),
      }

      await testInfo.attach('navigation-budget.json', {
        body: JSON.stringify(results, null, 2),
        contentType: 'application/json',
      })

      // These run against Vite's source-transform server plus PHP's single
      // process development server on Windows, not a production bundle. Keep a
      // strict sub-650ms interaction ceiling while retaining the attached raw
      // samples so meaningful regressions remain visible.
      expect(p95(results.submissionsEarly)).toBeLessThanOrEqual(600)
      expect(p95(results.submissionsSettled)).toBeLessThanOrEqual(500)
      expect(p95(results.usersSettled)).toBeLessThanOrEqual(300)
      expect(p95(results.auditSettled)).toBeLessThanOrEqual(650)
      expect(p95(results.settingsSettled)).toBeLessThanOrEqual(400)
    })

    test('repeated navigation does not leak memory unboundedly', async ({ page }, testInfo) => {
      await page.goto('/admin', { waitUntil: 'load' })
      await page.getByRole('button', { name: 'Notifications' }).first().waitFor({ timeout: 20_000 })
      const heap: number[] = []
      const read = () =>
        page.evaluate(() => {
          const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory
          return mem ? Math.round(mem.usedJSHeapSize / 1048576) : null
        })
      const start = await read()
      for (let i = 0; i < 6; i++) {
        await page.goto('/admin/academic', { waitUntil: 'domcontentloaded' })
        await page.goto('/admin', { waitUntil: 'domcontentloaded' })
        const h = await read()
        if (h !== null) heap.push(h)
      }
      const end = await read()
      await testInfo.attach('perf-memory.json', {
        body: JSON.stringify({ start, end, samples: heap }, null, 2),
        contentType: 'application/json',
      })
      if (start !== null && end !== null && start > 0) {
        // Heap may grow but should not balloon >6x after a few cycles (GC is non-deterministic).
        expect.soft(end, `heap grew ${start}MB -> ${end}MB after repeated nav`).toBeLessThan(start * 6 + 80)
      }
    })
  })
})
