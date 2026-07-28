import { test, expect } from '@playwright/test'
import { authFile } from './helpers/auth'
import { captureDiagnostics, summarize } from './helpers/diagnostics'

test.describe('Tables, search, filter, pagination, empty states', () => {
  test.use({ storageState: authFile('superadmin') })

  test('Users roster: search filters rows and shows an empty state', async ({ page }) => {
    await page.goto('/admin/users')
    await expect(page.getByRole('button', { name: 'Notifications' }).first()).toBeVisible()
    const search = page.getByPlaceholder('Search name or email')
    await expect(search).toBeVisible()

    // Filter to a seeded nurse.
    await search.fill('Abel')
    await expect(page.getByText('Abel Gemechu')).toBeVisible({ timeout: 10_000 })

    // Gibberish -> empty state.
    await search.fill('zzz-no-such-user-zzz')
    await expect(page.getByText(/No users match/i)).toBeVisible({ timeout: 10_000 })

    // Clearing restores the list.
    await search.fill('')
    await expect(page.getByText('Abel Gemechu')).toBeVisible()
  })

  test('Academic submissions: list paginates', async ({ page }) => {
    const diag = captureDiagnostics(page)
    await page.goto('/admin/academic/submissions')
    await expect(page.getByRole('button', { name: 'Notifications' }).first()).toBeVisible()
    const pageLabel = page.getByText(/Page \d+ of \d+/i)
    await expect(pageLabel).toBeVisible({ timeout: 15_000 })

    const label = await pageLabel.innerText()
    const lastPage = Number(label.match(/of (\d+)/i)?.[1] ?? '1')
    const next = page.getByRole('button', { name: /^Next$/i })
    if (lastPage > 1 && (await next.isEnabled())) {
      await next.click()
      await expect(page.getByText(/Page 2 of \d+/i)).toBeVisible({ timeout: 10_000 })
    }
    expect(diag.pageErrors, summarize(diag)).toHaveLength(0)
  })

  test('Submission board loads with content', async ({ page }) => {
    const diag = captureDiagnostics(page)
    await page.goto('/admin/submissions')
    await expect(page.getByRole('button', { name: 'Notifications' }).first()).toBeVisible()
    const main = page.locator('main').first()
    await expect(async () => {
      expect((await main.innerText()).trim().length).toBeGreaterThan(40)
    }).toPass({ timeout: 15_000 })
    expect(diag.pageErrors, summarize(diag)).toHaveLength(0)
    expect(diag.failedRequests.filter((r) => /HTTP 5\d\d/.test(r)), summarize(diag)).toHaveLength(0)
  })

  test('Audit log loads (entries or empty state) without errors', async ({ page }) => {
    const diag = captureDiagnostics(page)
    await page.goto('/admin/audit')
    await expect(page.getByRole('button', { name: 'Notifications' }).first()).toBeVisible()
    await expect(page.locator('main').first()).toBeVisible()
    expect(diag.pageErrors, summarize(diag)).toHaveLength(0)
  })
})
