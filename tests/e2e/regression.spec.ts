import { test, expect } from '@playwright/test'
import { authFile } from './helpers/auth'
import { uiLogin, uiLogout } from './helpers/auth'
import { captureDiagnostics, summarize } from './helpers/diagnostics'

test.describe('Regression & stability (storageState: superadmin)', () => {
  test.use({ storageState: authFile('superadmin') })

  test('dashboard survives repeated refreshes', async ({ page }) => {
    const diag = captureDiagnostics(page)
    await page.goto('/admin')
    for (let i = 0; i < 3; i++) {
      await page.reload()
      await expect(page.getByRole('button', { name: 'Sign out' }).first()).toBeVisible({ timeout: 20_000 })
      await expect(page).not.toHaveURL(/\/login/)
    }
    expect(diag.pageErrors, summarize(diag)).toHaveLength(0)
    expect(diag.failedRequests.filter((r) => /HTTP 5\d\d/.test(r)), summarize(diag)).toHaveLength(0)
  })

  test('repeated workspace switching stays consistent', async ({ page }) => {
    await page.goto('/admin')
    await expect(page.getByRole('button', { name: 'Sign out' }).first()).toBeVisible()
    const group = page.getByRole('group', { name: 'Workspace' }).first()
    for (let i = 0; i < 3; i++) {
      await group.getByRole('button').nth(1).click() // academic
      await expect(page).toHaveURL(/\/admin\/academic/)
      await group.getByRole('button').nth(0).click() // clinical
      await expect(page).toHaveURL(/\/admin($|\/)/)
    }
  })

  test('rapid nav clicking does not crash or blank the app', async ({ page }) => {
    const diag = captureDiagnostics(page)
    await page.goto('/admin')
    await expect(page.getByRole('button', { name: 'Sign out' }).first()).toBeVisible()
    const nav = page.getByRole('navigation').first()
    const links = nav.getByRole('link')
    const count = Math.min(await links.count(), 6)
    for (let i = 0; i < count; i++) {
      await links.nth(i).click({ timeout: 5000 }).catch(() => {})
    }
    // App still shows the authenticated shell (not blank / not crashed).
    await expect(page.getByRole('button', { name: 'Sign out' }).first()).toBeVisible()
    await expect(page.locator('main').first()).toBeVisible()
    expect(diag.pageErrors, summarize(diag)).toHaveLength(0)
  })

  test('browser back/forward keeps a consistent authenticated state', async ({ page }) => {
    await page.goto('/admin')
    await expect(page.getByRole('button', { name: 'Sign out' }).first()).toBeVisible()
    await page.goto('/admin/users')
    await expect(page).toHaveURL(/\/admin\/users/)
    await page.goBack()
    await expect(page).toHaveURL(/\/admin($|\/)/)
    await page.goForward()
    await expect(page).toHaveURL(/\/admin\/users/)
    await expect(page.getByRole('button', { name: 'Sign out' }).first()).toBeVisible()
  })

  test('two tabs in one session both stay authenticated', async ({ context }) => {
    const p1 = await context.newPage()
    const p2 = await context.newPage()
    await p1.goto('/admin')
    await p2.goto('/admin/academic')
    await expect(p1.getByRole('button', { name: 'Sign out' }).first()).toBeVisible({ timeout: 20_000 })
    await expect(p2.getByRole('button', { name: 'Sign out' }).first()).toBeVisible({ timeout: 20_000 })
    await expect(p1).not.toHaveURL(/\/login/)
    await expect(p2).not.toHaveURL(/\/login/)
    await p1.close()
    await p2.close()
  })

  test('offline navigation is handled, and the app recovers when back online', async ({ page, context }) => {
    await page.goto('/admin')
    await expect(page.getByRole('button', { name: 'Sign out' }).first()).toBeVisible()
    await context.setOffline(true)
    // Trigger a refresh while offline - should not hard-crash the renderer.
    await page.reload().catch(() => {})
    await context.setOffline(false)
    await page.reload()
    await expect(page.getByRole('button', { name: 'Sign out' }).first()).toBeVisible({ timeout: 20_000 })
    await expect(page).not.toHaveURL(/\/login/)
  })
})

test.describe('Regression - login/logout cycle (fresh sessions)', () => {
  test('repeated login/logout works consistently', async ({ page }) => {
    for (let i = 0; i < 2; i++) {
      await uiLogin(page, 'superadmin')
      await expect(page).toHaveURL(/\/admin/)
      await uiLogout(page)
      await expect(page).toHaveURL(/\/login/)
    }
  })
})
