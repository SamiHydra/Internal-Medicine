import { test, expect, type Page } from '@playwright/test'
import { authFile } from './helpers/auth'
import { captureDiagnostics, summarize } from './helpers/diagnostics'
import type { AccountKey } from './helpers/accounts'

/**
 * QA-012 regression: every authenticated route must render without horizontal
 * scrolling on the phone widths the department actually uses (320 is the
 * smallest supported, 360/375/390/430 cover the common Android and iPhone
 * sizes), on a tablet and on the desktop.
 *
 * The original defect was a single-column CSS grid whose track took the
 * min-content width of a panel with non-wrapping text, so the academic home
 * and submit pages were ~66 px wider than a 390 px phone. That class of bug is
 * invisible at desktop width, so this sweep visits the full route list at each
 * width instead of only the landing pages checked by responsive.spec.ts.
 *
 * Each test sets its own viewport, so it is deterministic regardless of which
 * Playwright project runs it.
 */

const WIDTHS = [320, 360, 375, 390, 430, 768, 1280] as const

// Sub-pixel rounding can add a pixel; anything beyond that is real overflow.
const OVERFLOW_TOLERANCE = 2

const ROUTES: Record<Extract<AccountKey, 'superadmin' | 'nurse' | 'resident' | 'consultant' | 'group_rep'>, string[]> = {
  superadmin: [
    '/admin',
    '/admin/submissions',
    '/admin/action-items',
    '/admin/templates',
    '/admin/import',
    '/admin/export',
    '/admin/users',
    '/admin/audit',
    '/admin/settings',
    '/admin/manual-admin-setup',
    '/admin/academic',
    '/admin/academic/submissions',
    '/admin/academic/roster',
    '/admin/academic/rotations',
    '/admin/academic/evaluation-forms',
    '/admin/academic/students',
    '/admin/academic/structure',
  ],
  nurse: ['/nurse', '/nurse/reports', '/nurse/activity'],
  resident: ['/academic', '/academic/submit', '/academic/history'],
  consultant: ['/academic', '/academic/submit', '/academic/teaching', '/academic/history'],
  group_rep: ['/teaching'],
}

async function awaitShell(page: Page): Promise<void> {
  await expect(page.getByRole('button', { name: 'Notifications' })).toBeVisible({ timeout: 20_000 })
  await expect(page).not.toHaveURL(/\/login/)
}

async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
}

/**
 * The widest element that pokes past the viewport, for a useful failure message.
 * Text can overflow without widening its box (a long email in a <p> with no
 * wrap opportunity), so elements whose content is wider than their box are
 * reported as well.
 */
async function widestOffender(page: Page): Promise<string> {
  return page.evaluate(() => {
    const limit = document.documentElement.clientWidth + 1
    let worst: { right: number; label: string } | null = null
    for (const el of document.querySelectorAll('body *')) {
      const rect = el.getBoundingClientRect()
      const style = getComputedStyle(el)
      if (rect.width === 0 || style.position === 'fixed') continue
      const textOverflow =
        style.overflowX === 'visible' && el.scrollWidth > el.clientWidth + 1
          ? rect.left + el.scrollWidth
          : 0
      const right = Math.max(rect.right, textOverflow)
      if (right > limit && (!worst || right > worst.right)) {
        const text = (el.textContent ?? '').trim().slice(0, 40)
        worst = {
          right: Math.round(right),
          label: `${el.tagName.toLowerCase()}[${String(el.className).slice(0, 80)}] right=${Math.round(right)}${textOverflow ? ` text-overflow "${text}"` : ''}`,
        }
      }
    }
    return worst?.label ?? 'none'
  })
}

for (const [roleKey, routes] of Object.entries(ROUTES) as [keyof typeof ROUTES, string[]][]) {
  test.describe(`No horizontal overflow - ${roleKey}`, () => {
    test.use({ storageState: authFile(roleKey) })

    for (const width of WIDTHS) {
      test(`all ${roleKey} routes fit @ ${width}px`, async ({ page }) => {
        test.setTimeout(45_000 + routes.length * 15_000)
        const diag = captureDiagnostics(page)
        await page.setViewportSize({ width, height: width < 700 ? 844 : 1000 })

        const failures: string[] = []
        for (const route of routes) {
          await page.goto(route, { waitUntil: 'domcontentloaded' })
          await awaitShell(page)
          // Let charts, tables and lazy panels settle before measuring.
          await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {})
          await page.waitForTimeout(400)

          const overflow = await horizontalOverflow(page)
          if (overflow > OVERFLOW_TOLERANCE) {
            failures.push(`${route}: ${overflow}px (${await widestOffender(page)})`)
          }
        }

        expect(failures, `routes overflowing at ${width}px:\n${failures.join('\n')}`).toEqual([])
        expect(diag.pageErrors, `pageerror during sweep: ${summarize(diag)}`).toHaveLength(0)
        expect(
          diag.failedRequests.filter((r) => /HTTP 5\d\d/.test(r)),
          `>=500 API response during sweep: ${summarize(diag)}`,
        ).toHaveLength(0)
      })
    }
  })
}
