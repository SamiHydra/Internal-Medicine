import { test, expect, type Page } from '@playwright/test'
import { authFile } from './helpers/auth'
import { captureDiagnostics, summarize } from './helpers/diagnostics'

async function shellReady(page: Page) {
  await expect(page.getByRole('button', { name: 'Sign out' }).first()).toBeVisible({ timeout: 20_000 })
}

test.describe('Admin clinical dashboard', () => {
  test.use({ storageState: authFile('superadmin') })

  test('loads with charts and no fatal errors', async ({ page }, testInfo) => {
    const diag = captureDiagnostics(page)
    await page.goto('/admin', { waitUntil: 'domcontentloaded' })
    await shellReady(page)
    // Recharts renders <svg class="recharts-surface">; the dashboard is chart-heavy.
    await expect(page.locator('.recharts-surface').first()).toBeVisible({ timeout: 20_000 })
    await testInfo.attach('admin-dashboard.png', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' })
    expect(diag.pageErrors, summarize(diag)).toHaveLength(0)
    expect(diag.failedRequests.filter((r) => /HTTP 5\d\d/.test(r)), summarize(diag)).toHaveLength(0)
  })
})

test.describe('Admin academic dashboard', () => {
  test.use({ storageState: authFile('superadmin') })

  test('loads peer-evaluation analytics', async ({ page }, testInfo) => {
    const diag = captureDiagnostics(page)
    await page.goto('/admin/academic', { waitUntil: 'domcontentloaded' })
    await shellReady(page)
    await expect(page.locator('.recharts-surface').first()).toBeVisible({ timeout: 20_000 })
    await testInfo.attach('academic-dashboard.png', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' })
    expect(diag.pageErrors, summarize(diag)).toHaveLength(0)
  })
})

test.describe('Nurse dashboard', () => {
  test.use({ storageState: authFile('nurse') })

  test('loads the nurse home with content', async ({ page }, testInfo) => {
    const diag = captureDiagnostics(page)
    await page.goto('/nurse', { waitUntil: 'domcontentloaded' })
    await shellReady(page)
    // Main content present (not a perpetual skeleton / blank).
    const main = page.locator('main').first()
    await expect(main).toBeVisible()
    await expect(async () => {
      const text = (await main.innerText()).trim()
      expect(text.length).toBeGreaterThan(40)
    }).toPass({ timeout: 15_000 })
    await testInfo.attach('nurse-dashboard.png', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' })
    expect(diag.pageErrors, summarize(diag)).toHaveLength(0)
  })
})

test.describe('Academic submitter home', () => {
  test.use({ storageState: authFile('resident') })

  test('resident home loads', async ({ page }) => {
    const diag = captureDiagnostics(page)
    await page.goto('/academic', { waitUntil: 'domcontentloaded' })
    await shellReady(page)
    await expect(page.locator('main').first()).toBeVisible()
    expect(diag.pageErrors, summarize(diag)).toHaveLength(0)
  })
})
