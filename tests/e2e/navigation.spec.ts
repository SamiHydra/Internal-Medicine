import { test, expect, type Page } from '@playwright/test'
import { authFile } from './helpers/auth'
import { captureDiagnostics, summarize } from './helpers/diagnostics'
import type { Role } from './helpers/accounts'

/** Every in-app route reachable from each role's navigation (config/navigation.ts + App.tsx). */
const ROUTES: Record<Role, string[]> = {
  nurse: ['/nurse', '/nurse/reports', '/nurse/activity', '/notifications'],
  resident: ['/academic', '/academic/submit', '/academic/history', '/notifications'],
  consultant: ['/academic', '/academic/submit', '/academic/history', '/notifications'],
  superadmin: [
    '/admin',
    '/admin/submissions',
    '/admin/action-items',
    '/admin/templates',
    '/admin/import',
    '/admin/users',
    '/admin/audit',
    '/admin/settings',
    '/admin/academic',
    '/admin/academic/submissions',
    '/admin/notifications',
  ],
}

async function visit(page: Page, path: string) {
  await page.goto(path, { waitUntil: 'domcontentloaded' })
  // The authenticated shell renders a desktop "Sign out" control once loaded.
  await expect(page.getByRole('button', { name: 'Notifications' }).first()).toBeVisible({ timeout: 20_000 })
  // Not bounced to login (session intact) and not the 404 page.
  await expect(page).not.toHaveURL(/\/login/)
  await expect(page.getByText(/page not found|404/i)).toHaveCount(0)
}

for (const role of Object.keys(ROUTES) as Role[]) {
  test.describe(`Navigation as ${role}`, () => {
    test.use({ storageState: authFile(role) })

    test(`visits every nav route with no fatal errors`, async ({ page }) => {
      const diag = captureDiagnostics(page)
      for (const path of ROUTES[role]) {
        await visit(page, path)
        // Hard fail on uncaught exceptions and server errors; soft-collect console noise.
        expect(diag.pageErrors, `pageerror on ${path}: ${summarize(diag)}`).toHaveLength(0)
        expect(
          diag.failedRequests.filter((r) => /HTTP 5\d\d/.test(r)),
          `5xx on ${path}: ${summarize(diag)}`,
        ).toHaveLength(0)
        expect.soft(diag.consoleErrors, `console errors after ${path}`).toHaveLength(0)
      }
    })
  })
}

test.describe('Nav links resolve (no dead links in the shell)', () => {
  test.use({ storageState: authFile('superadmin') })

  test('every sidebar link navigates to a real page', async ({ page }) => {
    await page.goto('/admin')
    await expect(page.getByRole('button', { name: 'Notifications' }).first()).toBeVisible()
    // Collect in-app links from the navigation landmark.
    const nav = page.getByRole('navigation').first()
    const hrefs = await nav.getByRole('link').evaluateAll((els) =>
      els.map((e) => (e as HTMLAnchorElement).getAttribute('href')).filter((h): h is string => !!h && h.startsWith('/')),
    )
    expect(hrefs.length).toBeGreaterThan(0)
    for (const href of [...new Set(hrefs)]) {
      await page.goto(href, { waitUntil: 'domcontentloaded' })
      await expect(page, `dead link: ${href}`).not.toHaveURL(/\/login/)
      await expect(page.getByText(/page not found|404/i), `404 at ${href}`).toHaveCount(0)
    }
  })
})
