import { expect, type Page } from '@playwright/test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { LoginPage } from '../pages/login-page'
import { ACCOUNTS, DEV_PASSWORD, type AccountKey } from './accounts'

const HERE = path.dirname(fileURLToPath(import.meta.url))

/** Where saved storageState files live (written by auth.setup.ts). */
export function authFile(role: AccountKey): string {
  return path.join(HERE, '..', '.auth', `${role}.json`)
}

/**
 * Log in through the real UI. Asserts the app navigates away from /login.
 * Returns nothing; throws (fails the test) if login does not complete.
 */
export async function uiLogin(
  page: Page,
  role: AccountKey,
  password: string = DEV_PASSWORD,
): Promise<void> {
  const account = ACCOUNTS[role]
  const loginPage = new LoginPage(page)
  // Resilient to the login throttle (throttle:10,1): if a run happens to hit the
  // per-IP limit, back off and retry rather than reporting a false auth failure.
  for (let attempt = 0; attempt < 4; attempt++) {
    await loginPage.open()
    await loginPage.submit(account.identifier, password)
    const left = await page
      .waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 12_000 })
      .then(() => true)
      .catch(() => false)
    if (left) return
    const throttled = await page
      .getByText(/too many|try again later/i)
      .first()
      .isVisible()
      .catch(() => false)
    if (!throttled) {
      // A genuine login failure - surface it.
      await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 8_000 })
      return
    }
    await page.waitForTimeout(13_000) // let the 1-minute window drain
  }
  throw new Error(`uiLogin(${role}) exhausted retries (login throttle did not clear)`)
}

/**
 * Log out via the app shell. The desktop shell renders an icon button with
 * aria-label "Sign out"; the mobile shell exposes the same label inside its
 * slide-out menu. We click the first visible one.
 */
export async function uiLogout(page: Page): Promise<void> {
  const signOut = page.getByRole('button', { name: 'Sign out' })
  if (await signOut.first().isVisible().catch(() => false)) {
    await signOut.first().click()
  } else {
    // Mobile: open the menu first (hamburger / menu trigger).
    const trigger = page.getByRole('button', { name: /open menu|menu|navigation/i }).first()
    if ((await trigger.count()) > 0) await trigger.click()
    await signOut.first().click()
  }
  await page.waitForURL(/\/login/, { timeout: 15_000 })
}

/** Assert the current page is an authenticated shell for the given role's landing. */
export async function expectLandedAs(page: Page, role: AccountKey): Promise<void> {
  const account = ACCOUNTS[role]
  await expect(page).toHaveURL(new RegExp(account.landing.replace('/', '\\/')))
}
