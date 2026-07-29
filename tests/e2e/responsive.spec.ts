import { test, expect, type Locator, type Page } from '@playwright/test'
import { authFile } from './helpers/auth'
import { captureDiagnostics, summarize, type PageDiagnostics } from './helpers/diagnostics'
import { ACCOUNTS, type AccountKey } from './helpers/accounts'

/**
 * Responsive layout coverage - Gap B.12 / risk-area #14: authenticated pages are
 * otherwise only spot-checked below 1920px. This spec asserts real layout health
 * at phone and tablet widths:
 *   - authenticated landings never overflow horizontally,
 *   - the mobile tab bar + "More" sheet keep the system pages reachable at phone
 *     width (where the desktop sidebar is hidden),
 *   - the admin workspace switcher is operable BY TOUCH and persists.
 *
 * Viewport strategy: this file is matched by the `mobile-chrome` (393) and
 * `tablet` (820) projects AND by the desktop `chromium` project. To make the
 * assertions deterministic regardless of which project runs them, each test sets
 * its own viewport with page.setViewportSize() (the idiom already used by
 * v2-role-workflows.spec.ts and accessibility.spec.ts) rather than leaning on the
 * ambient project size. Touch is taken from the running project: mobile-chrome
 * and tablet both set hasTouch, so genuine .tap() is exercised there; the desktop
 * chromium project has no touch, so tapOrClick() falls back to .click() so the
 * spec still passes there.
 *
 * "admin" is exercised via the seeded `superadmin` state: isWorkspaceRole()/
 * getNavigationItems() render the IDENTICAL admin shell, tab bar, More sheet and
 * workspace switcher for 'admin' and 'superadmin', so this covers the admin
 * responsive surface without minting a user just to re-measure the same layout.
 */

const PHONE = { width: 390, height: 844 }
const TABLET = { width: 820, height: 1180 }
const VIEWPORTS = [
  { name: 'phone-390', ...PHONE },
  { name: 'tablet-820', ...TABLET },
]

// Sub-pixel rounding and scrollbar math can add a pixel or two; anything beyond
// that is a genuine horizontal overflow. Matches accessibility.spec.ts.
const OVERFLOW_TOLERANCE = 2

/**
 * The authenticated shell is present at EVERY width once currentUser loads: the
 * header Notifications button renders for all roles with no responsive gating,
 * unlike the desktop "Sign out" control (sm:flex) which is hidden on phones.
 */
async function awaitShell(page: Page): Promise<void> {
  await expect(page.getByRole('button', { name: 'Notifications' })).toBeVisible({ timeout: 20_000 })
  await expect(page).not.toHaveURL(/\/login/)
}

/** documentElement horizontal overflow in px (scrollWidth beyond clientWidth). */
async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
}

/**
 * Operate a control the way a touch user would when the running project provides
 * touch (mobile-chrome / tablet); fall back to click on the desktop chromium
 * project, which has no touch, so the spec runs there too.
 */
async function tapOrClick(page: Page, locator: Locator): Promise<void> {
  const canTouch = await page.evaluate(
    () => navigator.maxTouchPoints > 0 || 'ontouchstart' in window,
  )
  if (canTouch) await locator.tap()
  else await locator.click()
}

function assertNoFatalDiagnostics(diag: PageDiagnostics, surface: string): void {
  expect(diag.pageErrors, `pageerror on ${surface}: ${summarize(diag)}`).toHaveLength(0)
  expect(
    diag.failedRequests.filter((r) => /HTTP 5\d\d/.test(r)),
    `>=500 API response on ${surface}: ${summarize(diag)}`,
  ).toHaveLength(0)
}

// ---------------------------------------------------------------------------
// 1) No horizontal overflow on the authenticated landing, phone AND tablet.
// ---------------------------------------------------------------------------

const OVERFLOW_ROLES: { key: AccountKey; as: string; eyebrow: RegExp }[] = [
  { key: 'superadmin', as: 'admin', eyebrow: /clinical operations/i },
  { key: 'nurse', as: 'nurse', eyebrow: /weekly reporting/i },
  { key: 'resident', as: 'resident', eyebrow: /academic review/i },
]

for (const role of OVERFLOW_ROLES) {
  test.describe(`Responsive layout - ${role.as} landing`, () => {
    test.use({ storageState: authFile(role.key) })

    for (const vp of VIEWPORTS) {
      test(`renders with no horizontal overflow @ ${vp.name}`, async ({ page }) => {
        const diag = captureDiagnostics(page)
        await page.setViewportSize({ width: vp.width, height: vp.height })
        await page.goto(ACCOUNTS[role.key].landing, { waitUntil: 'domcontentloaded' })
        await awaitShell(page)

        // Visible content, not merely "page loaded": the role-correct shell header
        // (eyebrow is unique per role/workspace) plus the single page title.
        await expect(page.getByText(role.eyebrow).first()).toBeVisible()
        await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible()

        // Let async dashboard content (charts / tables) settle before measuring.
        await page.waitForTimeout(700)

        const overflow = await horizontalOverflow(page)
        expect(
          overflow,
          `horizontal overflow for ${role.as} @ ${vp.name}: ${overflow}px (scrollWidth exceeds clientWidth)`,
        ).toBeLessThanOrEqual(OVERFLOW_TOLERANCE)

        assertNoFatalDiagnostics(diag, `${role.as} landing @ ${vp.name}`)
      })
    }
  })
}

// ---------------------------------------------------------------------------
// 2) Mobile tab bar + "More" sheet keep the system pages reachable at phone
//    width (the desktop sidebar is display:none below `sm`).
// ---------------------------------------------------------------------------

test.describe('Responsive shell - mobile tab bar & More sheet (admin @ phone)', () => {
  test.use({ storageState: authFile('superadmin') })

  test('exposes Users & Access, Audit Log and Settings via the More sheet', async ({ page }) => {
    const diag = captureDiagnostics(page)
    await page.setViewportSize(PHONE)
    await page.goto('/admin', { waitUntil: 'domcontentloaded' })

    const tabBar = page.getByRole('navigation', { name: 'Primary' })
    await expect(tabBar).toBeVisible()

    // The mobile shell is active, not the desktop one: the persistent desktop
    // "Sign out" control (sm:flex) is not rendered at phone width.
    await expect(page.getByRole('button', { name: 'Sign out' })).toHaveCount(0)

    // Four primary tabs + a "More" overflow slot render at phone width.
    await expect(tabBar.getByRole('link', { name: /dashboard/i })).toBeVisible()
    const moreButton = tabBar.getByRole('button', { name: 'More' })
    await expect(moreButton).toBeVisible()

    // The system pages are NOT direct tabs at phone width - reachable via More only.
    await expect(tabBar.getByRole('link', { name: 'Users & Access' })).toHaveCount(0)
    await expect(tabBar.getByRole('link', { name: 'Audit Log' })).toHaveCount(0)
    await expect(tabBar.getByRole('link', { name: 'Settings' })).toHaveCount(0)

    // Open the account/nav sheet.
    await tapOrClick(page, moreButton)
    const sheet = page.getByRole('dialog')
    await expect(sheet).toBeVisible()

    // The sheet's full nav exposes every system page.
    await expect(sheet.getByRole('link', { name: 'Users & Access' })).toBeVisible()
    await expect(sheet.getByRole('link', { name: 'Audit Log' })).toBeVisible()
    await expect(sheet.getByRole('link', { name: 'Settings' })).toBeVisible()

    // Reachability, not just presence: activating one actually navigates there.
    await tapOrClick(page, sheet.getByRole('link', { name: 'Users & Access' }))
    await expect(page).toHaveURL(/\/admin\/users/)
    await awaitShell(page)

    assertNoFatalDiagnostics(diag, 'admin More sheet @ phone')
  })
})

// ---------------------------------------------------------------------------
// 3) Workspace switcher operable BY TOUCH at phone width (it lives inside the
//    More sheet there) and persists across a full reload.
//    NB: the tablet/sidebar switcher path is already covered by workspace.spec.ts
//    (which runs under the `tablet` project); this fills the phone/touch gap.
// ---------------------------------------------------------------------------

test.describe('Responsive shell - workspace switcher on touch (admin @ phone)', () => {
  test.use({ storageState: authFile('superadmin') })

  test('switches clinical -> academic in the More sheet and persists across reload', async ({ page }) => {
    const diag = captureDiagnostics(page)
    await page.setViewportSize(PHONE)
    await page.goto('/admin', { waitUntil: 'domcontentloaded' })
    const tabBar = page.getByRole('navigation', { name: 'Primary' })
    await expect(tabBar).toBeVisible()

    // Default workspace is clinical.
    const beforeWorkspace = await page.evaluate(() =>
      window.localStorage.getItem('stpaul:workspace'),
    )
    expect(beforeWorkspace).not.toBe('academic')

    // Open the sheet and operate the switcher by touch.
    await tapOrClick(page, tabBar.getByRole('button', { name: 'More' }))
    const sheet = page.getByRole('dialog')
    await expect(sheet).toBeVisible()
    const group = sheet.getByRole('group', { name: 'Workspace' })
    await expect(group.getByRole('button', { name: 'Clinical' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )

    await tapOrClick(page, group.getByRole('button', { name: 'Academic' }))

    // Selecting Academic navigates to the academic dashboard (and closes the sheet).
    await expect(page).toHaveURL(/\/admin\/academic/)
    await awaitShell(page)
    // The 'stpaul:workspace' mirror is written by a React passive effect
    // (workspace-context.tsx), which can lag the navigation/URL flip by a tick.
    // Poll the storage read so it is deterministic rather than a one-shot race.
    await expect
      .poll(() => page.evaluate(() => window.localStorage.getItem('stpaul:workspace')))
      .toBe('academic')

    // Persists across a full reload: reopen the sheet, Academic is still pressed.
    await page.reload()
    const tabBarAfter = page.getByRole('navigation', { name: 'Primary' })
    await expect(tabBarAfter).toBeVisible()
    await tapOrClick(page, tabBarAfter.getByRole('button', { name: 'More' }))
    const sheetAfter = page.getByRole('dialog')
    await expect(sheetAfter).toBeVisible()
    await expect(
      sheetAfter.getByRole('group', { name: 'Workspace' }).getByRole('button', { name: 'Academic' }),
    ).toHaveAttribute('aria-pressed', 'true')

    assertNoFatalDiagnostics(diag, 'admin workspace switcher @ phone')
  })
})
