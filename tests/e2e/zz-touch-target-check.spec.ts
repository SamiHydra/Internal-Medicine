import { test, expect } from '@playwright/test'
import { authFile } from './helpers/auth'

/**
 * Proves the pointer-coarse touch-target fix is actually live, rather than
 * inferring it from a sweep. Checks that the emulated phone reports
 * `pointer: coarse` at all (otherwise the fix would be silently unmeasured),
 * and that the app-shell header controls clear 44px on touch while the same
 * build serves the smaller desktop size to a fine pointer.
 *
 *   npx playwright test tests/e2e/zz-touch-target-check.spec.ts --project=chromium
 */

test.describe('pointer-coarse touch targets', () => {
  test('phone reports coarse pointer and the header controls clear 44px', async ({ browser }) => {
    const context = await browser.newContext({
      storageState: authFile('superadmin'),
      viewport: { width: 393, height: 851 },
      hasTouch: true,
      isMobile: true,
    })
    const page = await context.newPage()
    try {
      await page.goto('/admin', { waitUntil: 'domcontentloaded' })
      await page.waitForTimeout(2000)

      // If this is false the whole fix is untested, not passing.
      const coarse = await page.evaluate(() => window.matchMedia('(pointer: coarse)').matches)
      expect(coarse, 'the emulated phone must report a coarse pointer').toBe(true)

      for (const label of ['Notifications', 'Open account menu']) {
        const box = await page.getByRole('button', { name: label }).first().boundingBox()
        expect(box, `${label} must be present`).not.toBeNull()
        expect(box!.width, `${label} width on touch`).toBeGreaterThanOrEqual(44)
        expect(box!.height, `${label} height on touch`).toBeGreaterThanOrEqual(44)
      }
    } finally {
      await context.close()
    }
  })

  test('the switch is tappable above its visual box (expanded hit area)', async ({ browser }) => {
    // The switch track stays 24px tall by design; the fix widens the HIT area
    // with a pseudo-element, which getBoundingClientRect cannot see. So verify
    // it functionally: a tap ABOVE the visible track must still toggle it.
    const context = await browser.newContext({
      storageState: authFile('superadmin'),
      viewport: { width: 393, height: 851 },
      hasTouch: true,
      isMobile: true,
    })
    const page = await context.newPage()
    try {
      await page.goto('/admin/settings', { waitUntil: 'domcontentloaded' })
      await page.waitForTimeout(2500)

      const toggle = page.locator('[role="switch"]').first()
      await expect(toggle, 'settings must render at least one switch').toBeVisible({ timeout: 20_000 })

      const before = await toggle.getAttribute('aria-checked')
      const box = (await toggle.boundingBox())!
      // 8px above the track: outside the visual box, inside the expanded target.
      await page.mouse.click(box.x + box.width / 2, box.y - 8)
      await page.waitForTimeout(400)

      expect(
        await toggle.getAttribute('aria-checked'),
        'a tap just above the track must hit the expanded target and toggle it',
      ).not.toBe(before)
    } finally {
      await context.close()
    }
  })

  test('desktop keeps its original 40px controls (fine pointer, unchanged)', async ({ browser }) => {
    const context = await browser.newContext({
      storageState: authFile('superadmin'),
      viewport: { width: 1920, height: 1080 },
    })
    const page = await context.newPage()
    try {
      await page.goto('/admin', { waitUntil: 'domcontentloaded' })
      await page.waitForTimeout(2000)

      const coarse = await page.evaluate(() => window.matchMedia('(pointer: coarse)').matches)
      expect(coarse, 'desktop must report a fine pointer').toBe(false)

      // The desktop box must be exactly what it was before the change: 40x40.
      const box = await page.getByRole('button', { name: 'Notifications' }).first().boundingBox()
      expect(Math.round(box!.height), 'desktop header control must stay 40px').toBe(40)
    } finally {
      await context.close()
    }
  })
})
