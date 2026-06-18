import { test, expect, type Page, type TestInfo } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { authFile } from './helpers/auth'

const VIEWPORTS = [
  { name: 'desktop-1920', width: 1920, height: 1080 },
  { name: 'laptop-1366', width: 1366, height: 768 },
  { name: 'tablet-1024', width: 1024, height: 768 },
  { name: 'mobile-390', width: 390, height: 844 },
  { name: 'mobile-360', width: 360, height: 800 },
]

type AxeViolation = { id: string; impact?: string; nodes: unknown[]; help: string; helpUrl: string }

/**
 * Run axe and gate on severity. Policy (standard axe CI gating):
 *  - CRITICAL violations FAIL the test (deploy blockers — e.g. controls with no
 *    accessible name).
 *  - SERIOUS/MODERATE violations are RECORDED (full JSON attachment + a test
 *    annotation) and reported as tracked Medium findings, but do not fail the
 *    gate. They are NOT silenced — every violation is saved to evidence.
 */
async function runAxe(page: Page, label: string, testInfo: TestInfo) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze()
  const violations = results.violations as unknown as AxeViolation[]
  await testInfo.attach(`axe-${label}.json`, {
    body: JSON.stringify(
      violations.map((v) => ({ id: v.id, impact: v.impact, count: v.nodes.length, help: v.help })),
      null,
      2,
    ),
    contentType: 'application/json',
  })
  const critical = violations.filter((v) => v.impact === 'critical')
  const serious = violations.filter((v) => v.impact === 'serious')
  if (serious.length) {
    testInfo.annotations.push({
      type: 'a11y-serious (tracked, non-blocking)',
      description: `${label}: ${serious.map((v) => `${v.id}(${v.nodes.length})`).join(', ')}`,
    })
  }
  return { critical, serious }
}

test.describe('Accessibility — login page across all target viewports', () => {
  for (const vp of VIEWPORTS) {
    test(`login a11y @ ${vp.name}`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width: vp.width, height: vp.height })
      await page.goto('/login')
      await expect(page.locator('#identifier')).toBeVisible()

      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
      expect.soft(overflow, `horizontal overflow at ${vp.name}: ${overflow}px`).toBeLessThanOrEqual(2)

      const { critical } = await runAxe(page, `login-${vp.name}`, testInfo)
      expect(critical, `critical a11y on login@${vp.name}: ${critical.map((v) => v.id).join(', ')}`).toHaveLength(0)
    })
  }
})

test.describe('Accessibility — authenticated pages', () => {
  test.use({ storageState: authFile('superadmin') })

  for (const route of ['/admin', '/admin/users', '/admin/settings', '/admin/academic']) {
    test(`a11y scan ${route}`, async ({ page }, testInfo) => {
      await page.goto(route, { waitUntil: 'domcontentloaded' })
      await expect(page.getByRole('button', { name: 'Sign out' }).first()).toBeVisible({ timeout: 20_000 })
      await page.waitForTimeout(800) // let charts/lazy content settle
      const { critical } = await runAxe(page, route.replace(/\//g, '_'), testInfo)
      expect(critical, `critical a11y on ${route}: ${critical.map((v) => v.id).join(', ')}`).toHaveLength(0)
    })
  }
})

test.describe('Accessibility — academic form (Radix Select labeling)', () => {
  test.use({ storageState: authFile('resident') })

  test('a11y scan /academic/submit', async ({ page }, testInfo) => {
    await page.goto('/academic/submit', { waitUntil: 'domcontentloaded' })
    await expect(page.getByRole('button', { name: 'Sign out' }).first()).toBeVisible({ timeout: 20_000 })
    await page.waitForTimeout(800)
    const { critical } = await runAxe(page, 'academic-submit', testInfo)
    expect(critical, `critical a11y on /academic/submit: ${critical.map((v) => v.id).join(', ')}`).toHaveLength(0)
  })
})

test.describe('Accessibility — keyboard navigation', () => {
  test('login form is fully keyboard operable', async ({ page }) => {
    await page.goto('/login')
    await page.locator('#identifier').focus()
    await expect(page.locator('#identifier')).toBeFocused()
    await page.keyboard.press('Tab')
    const active = await page.evaluate(() => document.activeElement?.tagName.toLowerCase() ?? '')
    expect(['input', 'button', 'a']).toContain(active)
  })
})
