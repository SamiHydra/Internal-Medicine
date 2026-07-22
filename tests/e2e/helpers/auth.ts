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

/** The login route (POST /api/auth/login) is guarded by Laravel throttle:10,1. */
const LOGIN_PATH = '/api/auth/login'
const MAX_LOGIN_ATTEMPTS = 5
/** Ceiling on any single 429 back-off wait (the throttle window is one minute). */
const MAX_BACKOFF_MS = 60_000

/**
 * Log in through the real UI. Asserts the app navigates away from /login.
 * Returns nothing; throws (fails the test) if login does not complete.
 *
 * Resilient to the login throttle (throttle:10,1). Cross-browser re-runs share
 * one per-IP bucket, so a login can legitimately come back 429; we detect that
 * from the auth RESPONSE (not a UI string, which may not render), honour the
 * server's Retry-After, and retry with bounded exponential back-off. The rate
 * limiter itself is never weakened - the helper just waits out the throttle it
 * triggered instead of reporting a false auth failure.
 */
export async function uiLogin(
  page: Page,
  role: AccountKey,
  password: string = DEV_PASSWORD,
): Promise<void> {
  const account = ACCOUNTS[role]
  const loginPage = new LoginPage(page)

  for (let attempt = 1; attempt <= MAX_LOGIN_ATTEMPTS; attempt++) {
    await loginPage.open()
    // Arm the response listener BEFORE submitting so the POST is never missed.
    const authResponse = page
      .waitForResponse(
        (res) =>
          new URL(res.url()).pathname.endsWith(LOGIN_PATH) &&
          res.request().method() === 'POST',
        { timeout: 12_000 },
      )
      .catch(() => null)
    await loginPage.submit(account.identifier, password)
    const response = await authResponse

    if (response?.status() === 429) {
      if (attempt === MAX_LOGIN_ATTEMPTS) break
      await page.waitForTimeout(backoffMs(response.headers()['retry-after'], attempt))
      continue
    }

    // Not throttled: a successful login navigates away from /login.
    const left = await page
      .waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 12_000 })
      .then(() => true)
      .catch(() => false)
    if (left) return

    // Didn't leave /login and we didn't observe a 429 on the wire. A late throttle
    // can still surface only in the UI; retry on that, otherwise it's a genuine
    // auth failure and we surface it.
    const throttled = await page
      .getByText(/too many|try again later/i)
      .first()
      .isVisible()
      .catch(() => false)
    if (!throttled) {
      throw new Error(`uiLogin(${role}) did not reach an authenticated route`)
    }
    if (attempt === MAX_LOGIN_ATTEMPTS) break
    await page.waitForTimeout(backoffMs(undefined, attempt))
  }
  throw new Error(`uiLogin(${role}) exhausted retries (login throttle did not clear)`)
}

/**
 * Back-off for a throttled login: honour the server's Retry-After (seconds) when
 * present, else exponential (2s, 4s, 8s, ...), both capped at the throttle window.
 */
function backoffMs(retryAfter: string | undefined, attempt: number): number {
  const seconds = Number(retryAfter)
  if (Number.isFinite(seconds) && seconds > 0) {
    return Math.min(seconds * 1_000 + 500, MAX_BACKOFF_MS)
  }
  return Math.min(2_000 * 2 ** (attempt - 1), MAX_BACKOFF_MS)
}

/**
 * Wait until the authenticated app shell is ready, at ANY viewport width.
 *
 * Gates on the header Notifications button (src/components/layout/app-shell.tsx):
 * it renders for every authenticated role with no responsive gating, so it is
 * present at desktop AND phone widths. The desktop "Sign out" control lives in a
 * `hidden ... sm:flex` block and is display:none below 640px, so waiting on it
 * times out on the mobile-chrome (393px) and tablet projects - the mobile
 * readiness bug this replaces.
 */
export async function shellReady(page: Page): Promise<void> {
  await expect(page.getByRole('button', { name: 'Notifications' }).first()).toBeVisible({
    timeout: 20_000,
  })
  await expect(page).not.toHaveURL(/\/login/)
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
