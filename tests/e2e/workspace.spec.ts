import { test, expect } from '@playwright/test'
import { authFile } from './helpers/auth'

/**
 * Admin/superadmin Clinical<->Academic workspace switcher (src/components/layout/app-shell.tsx).
 * Switcher = role="group" aria-label="Workspace" with two toggle buttons
 * (Clinical first, Academic second), aria-pressed marking the active one.
 * State persists to localStorage key "stpaul:workspace".
 */
test.describe('Workspace switcher (superadmin)', () => {
  test.use({ storageState: authFile('superadmin') })

  test('switches clinical -> academic, updates nav, and persists across reload', async ({ page }) => {
    await page.goto('/admin')
    await expect(page.getByRole('button', { name: 'Notifications' }).first()).toBeVisible()

    const group = page.getByRole('group', { name: 'Workspace' }).first()
    const clinicalBtn = group.getByRole('button').nth(0)
    const academicBtn = group.getByRole('button').nth(1)

    // Clinical is the default; clinical-only nav (Templates / Import) is present.
    await expect(clinicalBtn).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByRole('link', { name: /templates/i })).toBeVisible()

    // Switch to Academic.
    await academicBtn.click()
    await expect(page).toHaveURL(/\/admin\/academic/, { timeout: 15_000 })
    await expect(academicBtn).toHaveAttribute('aria-pressed', 'true')
    // Clinical-only items are gone in the academic workspace.
    await expect(page.getByRole('link', { name: /templates/i })).toHaveCount(0)
    await expect(page.getByRole('link', { name: /^import$/i })).toHaveCount(0)

    // Persisted to localStorage.
    const stored = await page.evaluate(() => window.localStorage.getItem('stpaul:workspace'))
    expect(stored).toBe('academic')

    // Reload keeps the academic workspace.
    await page.reload()
    await expect(page.getByRole('button', { name: 'Notifications' }).first()).toBeVisible()
    const academicAfterReload = page.getByRole('group', { name: 'Workspace' }).first().getByRole('button').nth(1)
    await expect(academicAfterReload).toHaveAttribute('aria-pressed', 'true')

    // Switch back to Clinical to leave a clean default.
    await page.getByRole('group', { name: 'Workspace' }).first().getByRole('button').nth(0).click()
    await expect(page).toHaveURL(/\/admin($|\/)/)
  })

  test('non-admin roles do not see the workspace switcher', async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: authFile('nurse') })
    const page = await ctx.newPage()
    await page.goto('/nurse')
    await expect(page.getByRole('button', { name: 'Notifications' }).first()).toBeVisible()
    await expect(page.getByRole('group', { name: 'Workspace' })).toHaveCount(0)
    await ctx.close()
  })
})
