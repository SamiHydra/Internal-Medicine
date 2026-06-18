import { test, expect } from '@playwright/test'
import { authFile } from './helpers/auth'
import { captureDiagnostics, summarize } from './helpers/diagnostics'

test.describe('Academic evaluation form (resident)', () => {
  test.use({ storageState: authFile('resident') })

  test('renders and blocks an empty submit with validation', async ({ page }, testInfo) => {
    const diag = captureDiagnostics(page)
    await page.goto('/academic/submit', { waitUntil: 'domcontentloaded' })
    await expect(page.getByRole('button', { name: 'Sign out' }).first()).toBeVisible({ timeout: 20_000 })

    const submit = page
      .getByRole('button', { name: /submit|save|record|file evaluation|send/i })
      .last()
    await expect(submit).toBeVisible({ timeout: 15_000 })
    await testInfo.attach('academic-form.png', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' })

    // Attempt to submit with required fields blank — must NOT navigate away to a
    // success state; a client/server validation error should appear.
    await submit.click().catch(() => {})
    await page.waitForTimeout(1000)
    // Still on the submit route (not redirected to a success/home view).
    await expect(page).toHaveURL(/\/academic\/submit/)
    expect(diag.pageErrors, summarize(diag)).toHaveLength(0)
  })
})

test.describe('Nurse clinical report flow', () => {
  test.use({ storageState: authFile('nurse') })

  test('report selection lists assignments; opening one renders the form', async ({ page }, testInfo) => {
    const diag = captureDiagnostics(page)
    await page.goto('/nurse/reports', { waitUntil: 'domcontentloaded' })
    await expect(page.getByRole('button', { name: 'Sign out' }).first()).toBeVisible({ timeout: 20_000 })
    await testInfo.attach('nurse-reports.png', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' })

    // Find a link into a specific report (/reports/:assignmentId/:periodId).
    const reportLink = page.locator('a[href*="/reports/"]').first()
    const hasReport = (await reportLink.count()) > 0
    test.skip(!hasReport, 'No clinical report assignment is available for the seeded nurse.')

    await reportLink.click()
    await expect(page).toHaveURL(/\/reports\/.+\/.+/, { timeout: 15_000 })
    // The report form renders input controls (daily value grid).
    await expect(page.locator('input, [role="spinbutton"]').first()).toBeVisible({ timeout: 15_000 })
    await testInfo.attach('nurse-report-form.png', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' })
    expect(diag.pageErrors, summarize(diag)).toHaveLength(0)
    expect(diag.failedRequests.filter((r) => /HTTP 5\d\d/.test(r)), summarize(diag)).toHaveLength(0)
  })
})
