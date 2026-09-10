import { test, expect, type Page } from '@playwright/test'
import { authFile } from './helpers/auth'

/**
 * Diagnostic spec for the performance audit: measures what a single toggle
 * actually costs, and how long the academic surfaces take to become usable.
 * Records numbers rather than asserting tight budgets; the output is the
 * deliverable.
 */

type Captured = { url: string; ms: number; bytes: number }

/** Record every /api call the page makes while `action` runs. */
async function captureApi(page: Page, action: () => Promise<void>) {
  const calls: Captured[] = []
  const started = new Map<string, number>()

  const onRequest = (request: { url: () => string }) => {
    if (request.url().includes('/api/')) started.set(request.url(), Date.now())
  }
  const onResponse = async (response: {
    url: () => string
    body: () => Promise<Buffer>
  }) => {
    const url = response.url()
    if (!url.includes('/api/')) return
    const t0 = started.get(url) ?? Date.now()
    let bytes = 0
    try {
      bytes = (await response.body()).length
    } catch {
      bytes = 0
    }
    calls.push({ url: url.replace(/^https?:\/\/[^/]+/, ''), ms: Date.now() - t0, bytes })
  }

  page.on('request', onRequest)
  page.on('response', onResponse)
  const t0 = Date.now()
  await action()
  const wallMs = Date.now() - t0
  await page.waitForTimeout(400)
  page.off('request', onRequest)
  page.off('response', onResponse)

  return { calls, wallMs }
}

function summarise(label: string, calls: Captured[], wallMs: number) {
  const bytes = calls.reduce((total, call) => total + call.bytes, 0)
  const lines = [
    `\n=== ${label} ===`,
    `wall time      : ${wallMs} ms`,
    `api calls      : ${calls.length}`,
    `payload        : ${(bytes / 1024).toFixed(1)} KB`,
  ]
  for (const call of calls.sort((a, b) => b.ms - a.ms)) {
    lines.push(`  ${String(call.ms).padStart(5)} ms  ${(call.bytes / 1024).toFixed(1).padStart(7)} KB  ${call.url}`)
  }
  console.log(lines.join('\n'))
  return { count: calls.length, bytes, wallMs }
}

test.use({ storageState: authFile('superadmin') })

test('students page: cost of first load and of one toggle', async ({ page }) => {
  const load = await captureApi(page, async () => {
    await page.goto('/admin/academic/students', { waitUntil: 'load' })
    await page.getByRole('tab', { name: /Students/ }).first().waitFor({ timeout: 30_000 })
    await page.waitForLoadState('networkidle').catch(() => {})
  })
  summarise('students page :: initial load', load.calls, load.wallMs)

  // The tab label carries a count ("Students (72)"), so match the prefix and
  // the opening bracket rather than the bare word, which also hits the nav item.
  await page.getByRole('tab', { name: /Students \(/ }).click()
  await page.waitForTimeout(1_000)

  const firstSwitch = page.locator('table button[role="switch"]').first()
  const switchCount = await page.locator('table button[role="switch"]').count()
  test.skip(switchCount === 0, 'fixture database has no students to toggle')
  await firstSwitch.waitFor({ timeout: 30_000 })

  const toggle = await captureApi(page, async () => {
    await firstSwitch.click()
    await page.waitForTimeout(2_500)
  })
  const t = summarise('students page :: ONE active toggle', toggle.calls, toggle.wallMs)

  // Put the row back so the run is idempotent.
  await firstSwitch.click()
  await page.waitForTimeout(1_500)

  // The regression this guards: one toggle should not refetch the whole page.
  // Today it costs 7 calls (1 PATCH + 6 GETs); flag if that grows.
  expect(t.count).toBeGreaterThan(0)
  expect(t.count).toBeLessThanOrEqual(7)
})

test('academic dashboard: cost of first load and of one tab switch', async ({ page }) => {
  const load = await captureApi(page, async () => {
    await page.goto('/admin/academic', { waitUntil: 'load' })
    await page.waitForLoadState('networkidle').catch(() => {})
  })
  summarise('academic dashboard :: initial load', load.calls, load.wallMs)

  const morningTab = page.getByRole('button', { name: 'Morning sessions' }).first()
  if (await morningTab.count()) {
    const swap = await captureApi(page, async () => {
      await morningTab.click()
      await page.waitForLoadState('networkidle').catch(() => {})
    })
    summarise('academic dashboard :: switch to Morning sessions', swap.calls, swap.wallMs)
  }
})
