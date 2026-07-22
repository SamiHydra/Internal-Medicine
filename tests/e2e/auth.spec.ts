import { test, expect } from '@playwright/test'
import { ACCOUNTS, DEV_PASSWORD } from './helpers/accounts'
import { uiLogin, uiLogout } from './helpers/auth'
import { captureDiagnostics, summarize } from './helpers/diagnostics'

// Auth-flow tests run logged-OUT (no storageState reused).
test.describe('Authentication', () => {
  test('login page renders with accessible fields', async ({ page }) => {
    const diag = captureDiagnostics(page)
    await page.goto('/login')
    await expect(page.locator('#identifier')).toBeVisible()
    await expect(page.locator('#password')).toBeVisible()
    await expect(page.getByRole('button', { name: /sign in to reporting portal/i })).toBeVisible()
    expect(diag.pageErrors, summarize(diag)).toHaveLength(0)
  })

  test('rejects invalid credentials and stays on /login', async ({ page }) => {
    await page.goto('/login')
    await page.locator('#identifier').fill(ACCOUNTS.superadmin.identifier)
    await page.locator('#password').fill('wrong-password-123')
    await page.getByRole('button', { name: /sign in to reporting portal/i }).click()
    // The PERSISTENT inline form error appears and we are not navigated into the
    // app. (The raw Laravel "These credentials do not match our records." string
    // surfaces only in an auto-dismissing ~4s Sonner toast, which races the poll
    // on slower engines; the non-enumeration guarantee is asserted at the API
    // layer, not on transient toast text.)
    await expect(
      page.getByText('Check your email and password and try again.'),
    ).toBeVisible({ timeout: 15_000 })
    await expect(page).toHaveURL(/\/login/)
  })

  test('superadmin logs in and lands on /admin', async ({ page }) => {
    const diag = captureDiagnostics(page)
    await uiLogin(page, 'superadmin')
    await expect(page).toHaveURL(/\/admin/)
    expect(diag.pageErrors, summarize(diag)).toHaveLength(0)
  })

  test('nurse logs in and lands on /nurse', async ({ page }) => {
    await uiLogin(page, 'nurse')
    await expect(page).toHaveURL(/\/nurse/)
  })

  test('session persists across a full page reload', async ({ page }) => {
    await uiLogin(page, 'superadmin')
    await page.reload()
    // Still authenticated - not bounced to /login.
    await expect(page).not.toHaveURL(/\/login/)
    await expect(page).toHaveURL(/\/admin/)
  })

  test('logout returns to /login and the session is gone', async ({ page }) => {
    await uiLogin(page, 'superadmin')
    await uiLogout(page)
    await expect(page).toHaveURL(/\/login/)
    // Going back to a protected route must NOT restore the session.
    await page.goto('/admin')
    await expect(page).toHaveURL(/\/login/, { timeout: 15_000 })
  })

  test('unauthenticated access to a protected route redirects to /login', async ({ page }) => {
    await page.goto('/admin/users')
    await expect(page).toHaveURL(/\/login/, { timeout: 15_000 })
  })

  test('double-clicking submit does not create a broken state', async ({ page }) => {
    await page.goto('/login')
    await page.locator('#identifier').fill(ACCOUNTS.superadmin.identifier)
    await page.locator('#password').fill(DEV_PASSWORD)
    const btn = page.getByRole('button', { name: /sign in to reporting portal/i })
    // Fire two clicks rapidly; the button disables on submit so the 2nd is a no-op.
    await btn.click()
    await btn.click({ trial: false, force: true }).catch(() => {})
    await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 20_000 })
    await expect(page).toHaveURL(/\/admin/)
  })
})
