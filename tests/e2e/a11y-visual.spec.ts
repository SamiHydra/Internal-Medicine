import { test, expect, type Browser, type Page } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { authFile } from './helpers/auth'
import type { AccountKey } from './helpers/accounts'

/**
 * Visual / presentation accessibility checks (WCAG 1.4.4 resize text, 1.4.10
 * reflow, 2.3.3 / 2.2.2 motion, 1.4.11 non-text contrast, 2.5.5 / 2.5.8 target
 * size). Evidence (screenshots + JSON) goes to output/a11y/visual.
 *
 *   E2E_BASE_URL=http://localhost:5193 npx playwright test \
 *     --config playwright.external.config.ts tests/e2e/a11y-visual.spec.ts
 */

const OUT = path.resolve('output', 'a11y', 'visual')
fs.mkdirSync(OUT, { recursive: true })

function record(name: string, data: unknown) {
  fs.writeFileSync(path.join(OUT, `${name}.json`), JSON.stringify(data, null, 2))
}

async function shellReady(page: Page) {
  await expect(page.getByRole('button', { name: 'Notifications' }).first()).toBeVisible({ timeout: 20_000 })
  await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {})
  await page.waitForTimeout(500)
}

type Target = { role: AccountKey | null; label: string; route: string; prepare?: (page: Page) => Promise<void> }

const openFirstReport = async (page: Page) => {
  await page.locator('a[href^="/reports/"]').first().click()
  await page.waitForURL(/\/reports\//)
  await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {})
  await page.waitForTimeout(500)
}

const openActionItem = async (page: Page) => {
  const openButton = page.getByRole('button', { name: /^Open / }).first()
  const rowButton = page.locator('button.col-span-2').first()
  await ((await openButton.isVisible().catch(() => false)) ? openButton : rowButton).click()
  await expect(page.getByRole('dialog')).toBeVisible({ timeout: 15_000 })
  await page.waitForTimeout(800)
}

const TARGETS: Target[] = [
  { role: null, label: 'login', route: '/login' },
  { role: 'superadmin', label: 'admin-dashboard', route: '/admin' },
  { role: 'superadmin', label: 'admin-action-item-sheet', route: '/admin/action-items', prepare: openActionItem },
  { role: 'nurse', label: 'nurse-report-form', route: '/nurse/reports', prepare: openFirstReport },
  { role: 'resident', label: 'resident-submit', route: '/academic/submit' },
]

/** Elements sticking out of the viewport, and text clipped inside its own box. */
async function layoutProblems(page: Page) {
  return page.evaluate(() => {
    const limit = document.documentElement.clientWidth + 2
    const overflowing: string[] = []
    const clipped: string[] = []
    for (const el of document.querySelectorAll<HTMLElement>('body *')) {
      const rect = el.getBoundingClientRect()
      const style = getComputedStyle(el)
      if (rect.width === 0 || rect.height === 0 || style.visibility === 'hidden' || style.display === 'none') continue
      if (style.position === 'fixed') continue
      if (rect.right > limit && overflowing.length < 15) {
        overflowing.push(`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 60)} right=${Math.round(rect.right)}`)
      }
      // Text that no longer fits its box and is neither scrollable nor
      // deliberately truncated with an ellipsis.
      const ownText = [...el.childNodes].some((n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? '').trim())
      if (
        ownText &&
        style.overflowX === 'hidden' &&
        style.textOverflow !== 'ellipsis' &&
        style.whiteSpace !== 'nowrap' &&
        el.scrollWidth > el.clientWidth + 2 &&
        clipped.length < 15
      ) {
        clipped.push(`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 60)} "${(el.textContent ?? '').trim().slice(0, 40)}"`)
      }
    }
    return {
      horizontalOverflowPx: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      overflowing,
      clipped,
    }
  })
}

async function withPage(browser: Browser, role: AccountKey | null, options: Parameters<Browser['newContext']>[0], run: (page: Page) => Promise<void>) {
  const context = await browser.newContext({ ...(role ? { storageState: authFile(role) } : {}), ...options })
  const page = await context.newPage()
  try {
    await run(page)
  } finally {
    await context.close()
  }
}

async function open(page: Page, target: Target) {
  await page.goto(target.route, { waitUntil: 'domcontentloaded' })
  if (target.role) await shellReady(page)
  else {
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {})
    await page.waitForTimeout(500)
  }
  if (target.prepare) await target.prepare(page)
}

// Browser zoom at 200 % on a 1280 px window gives the page a 640 CSS px
// viewport at device-pixel-ratio 2, and media queries respond to that width
// (WCAG 1.4.4 / 1.4.10). CSS `zoom` on the root would scale the desktop
// layout without changing the media queries, which is not what a user sees.
test.describe('visual - 200% zoom (1280 px window: 640 CSS px viewport at DPR 2)', () => {
  for (const target of TARGETS) {
    test(`zoom 200% - ${target.label}`, async ({ browser }) => {
      test.setTimeout(90_000)
      await withPage(browser, target.role, { viewport: { width: 640, height: 450 }, deviceScaleFactor: 2 }, async (page) => {
        await open(page, target)
        await page.waitForTimeout(800)
        const problems = await layoutProblems(page)
        await page.screenshot({ path: path.join(OUT, `zoom200-${target.label}.png`), fullPage: false })
        record(`zoom200-${target.label}`, { ...problems, layoutViewportWidth: await page.evaluate(() => document.documentElement.clientWidth) })
        expect.soft(problems.horizontalOverflowPx, `${target.label}: no horizontal scroll at 200% zoom`).toBeLessThanOrEqual(2)
        expect.soft(problems.clipped, `${target.label}: no clipped text at 200% zoom`).toEqual([])
      })
    })
  }
})

test.describe('visual - large text (html font-size 24px)', () => {
  for (const target of TARGETS) {
    test(`large text - ${target.label}`, async ({ browser }) => {
      test.setTimeout(90_000)
      await withPage(browser, target.role, { viewport: { width: 1280, height: 900 } }, async (page) => {
        await open(page, target)
        const before = await page.evaluate(() => [...document.querySelectorAll('p, span, a, button, label, h1, h2, h3')].slice(0, 400).map((el) => getComputedStyle(el).fontSize))
        await page.evaluate(() => {
          document.documentElement.style.fontSize = '24px'
        })
        await page.waitForTimeout(600)
        const after = await page.evaluate(() => [...document.querySelectorAll('p, span, a, button, label, h1, h2, h3')].slice(0, 400).map((el) => getComputedStyle(el).fontSize))
        const scaled = before.filter((size, i) => after[i] !== size).length
        const problems = await layoutProblems(page)
        await page.screenshot({ path: path.join(OUT, `largetext-${target.label}.png`), fullPage: false })
        record(`largetext-${target.label}`, { ...problems, sampled: before.length, scaledWithRootFontSize: scaled })
        expect.soft(problems.horizontalOverflowPx, `${target.label}: no horizontal scroll with 24px root font`).toBeLessThanOrEqual(2)
      })
    })
  }
})

test.describe('visual - prefers-reduced-motion', () => {
  test('framer-motion and CSS animations honour reduce', async ({ browser }) => {
    test.setTimeout(120_000)
    await withPage(browser, 'superadmin', { viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' }, async (page) => {
      const honoured = await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)
      const findings: Record<string, unknown> = { mediaQueryReportsReduce: honoured }

      for (const route of ['/admin/notifications', '/admin', '/admin/submissions']) {
        // Sample the running animations during the first 600ms after the route mounts.
        await page.goto(route, { waitUntil: 'domcontentloaded' })
        const samples: { name: string; props: string[] }[] = []
        const started = Date.now()
        while (Date.now() - started < 1500) {
          const running = await page.evaluate(() =>
            document.getAnimations().map((a) => {
              const effect = a.effect as KeyframeEffect | null
              const frames = effect?.getKeyframes?.() ?? []
              const props = [...new Set(frames.flatMap((f) => Object.keys(f).filter((k) => !['offset', 'easing', 'composite', 'computedOffset'].includes(k))))]
              const target = (effect?.target as Element | null)?.tagName?.toLowerCase() ?? '?'
              return { name: `${a.constructor.name}:${target}:${(a as CSSAnimation).animationName ?? ''}`, props }
            }),
          )
          for (const r of running) if (!samples.some((s) => s.name === r.name && s.props.join() === r.props.join())) samples.push(r)
          await page.waitForTimeout(50)
        }
        findings[route] = {
          animationsObserved: samples,
          transformAnimations: samples.filter((s) => s.props.some((p) => /transform|translate|scale/i.test(p))),
        }
      }

      // The slide-out sheet must fade, not slide, under reduce.
      await page.setViewportSize({ width: 390, height: 844 })
      await page.goto('/admin', { waitUntil: 'domcontentloaded' })
      await shellReady(page)
      await page.getByRole('button', { name: 'Open account menu' }).click()
      await expect(page.getByRole('dialog')).toBeVisible()
      findings.sheetAnimationName = await page.getByRole('dialog').evaluate((el) => getComputedStyle(el).animationName)
      await page.keyboard.press('Escape')

      record('reduced-motion', findings)
      expect(honoured).toBe(true)
      for (const route of ['/admin/notifications', '/admin', '/admin/submissions']) {
        const f = findings[route] as { transformAnimations: unknown[] }
        expect.soft(f.transformAnimations, `${route}: no transform/translate animations under prefers-reduced-motion`).toEqual([])
      }
      expect.soft(findings.sheetAnimationName, 'sheet fades (no slide) under reduce').toBe('sheet-overlay-in')
    })
  })
})

test.describe('visual - forced colors and increased contrast (screenshots)', () => {
  for (const target of TARGETS.slice(0, 4)) {
    test(`forced-colors / contrast more - ${target.label}`, async ({ browser }) => {
      test.setTimeout(90_000)
      await withPage(browser, target.role, { viewport: { width: 1280, height: 900 }, forcedColors: 'active' }, async (page) => {
        await open(page, target)
        await page.screenshot({ path: path.join(OUT, `forced-colors-${target.label}.png`) })
        // With forced colors the first Tab stop must still show a system focus outline.
        await page.keyboard.press('Tab')
        const outline = await page.evaluate(() => {
          const el = document.activeElement as HTMLElement | null
          if (!el) return null
          const s = getComputedStyle(el)
          return { tag: el.tagName.toLowerCase(), name: el.getAttribute('aria-label') ?? el.textContent?.trim().slice(0, 40), outlineStyle: s.outlineStyle, outlineWidth: s.outlineWidth }
        })
        record(`forced-colors-${target.label}`, { firstFocusOutline: outline })
      })
      await withPage(browser, target.role, { viewport: { width: 1280, height: 900 }, contrast: 'more' }, async (page) => {
        await open(page, target)
        await page.screenshot({ path: path.join(OUT, `contrast-more-${target.label}.png`) })
      })
    })
  }
})

test.describe('visual - touch targets at 390px (pointer: coarse)', () => {
  const MIN = 44
  const SELECTOR = 'a[href], button, input:not([type="hidden"]), select, textarea, [role="button"], [role="radio"], [role="switch"], [role="combobox"], [role="checkbox"], [role="tab"]'

  async function measure(page: Page, scope: string) {
    return page.evaluate(
      ({ selector, scope, min }) => {
        const root = scope ? document.querySelector(scope) : document
        if (!root) return { scope, total: 0, small: [], tiny: [] }
        const small: string[] = []
        const tiny: string[] = []
        let total = 0
        for (const el of root.querySelectorAll<HTMLElement>(selector)) {
          const r = el.getBoundingClientRect()
          const s = getComputedStyle(el)
          if (r.width === 0 || r.height === 0 || s.visibility === 'hidden' || s.display === 'none') continue
          if (el.classList.contains('sr-only')) continue
          total += 1
          const label = `${el.tagName.toLowerCase()}${el.getAttribute('role') ? `[${el.getAttribute('role')}]` : ''} "${(el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 30)}" ${Math.round(r.width)}x${Math.round(r.height)}`
          if (r.width < 24 || r.height < 24) tiny.push(label)
          else if (r.width < min || r.height < min) small.push(label)
        }
        return { scope, total, small, tiny }
      },
      { selector: SELECTOR, scope, min: MIN },
    )
  }

  test('nurse report form, mobile tab bar, action-item sheet', async ({ browser }) => {
    test.setTimeout(120_000)
    const results: Record<string, unknown> = {}
    await withPage(browser, 'nurse', { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }, async (page) => {
      await page.goto('/nurse/reports', { waitUntil: 'domcontentloaded' })
      await shellReady(page)
      results.coarsePointer = await page.evaluate(() => matchMedia('(pointer: coarse)').matches)
      results.mobileTabBar = await measure(page, 'nav[aria-label="Primary"]')
      results.header = await measure(page, 'header')
      await openFirstReport(page)
      results.nurseReportForm = await measure(page, 'form')
      await page.screenshot({ path: path.join(OUT, 'touch-nurse-form.png'), fullPage: false })
    })
    await withPage(browser, 'superadmin', { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }, async (page) => {
      await page.goto('/admin/action-items', { waitUntil: 'domcontentloaded' })
      await shellReady(page)
      results.actionItemsList = await measure(page, 'main')
      await openActionItem(page)
      results.actionItemSheet = await measure(page, '[role="dialog"]')
      await page.screenshot({ path: path.join(OUT, 'touch-action-item-sheet.png'), fullPage: false })
    })
    record('touch-targets', results)
    expect(results.coarsePointer, 'emulated phone reports pointer: coarse').toBe(true)
    for (const key of ['mobileTabBar', 'header', 'nurseReportForm', 'actionItemSheet']) {
      const r = results[key] as { tiny: string[]; small: string[] }
      expect.soft(r.tiny, `${key}: no targets under 24x24 (WCAG 2.5.8)`).toEqual([])
      expect.soft(r.small, `${key}: targets reach 44x44 on touch (WCAG 2.5.5)`).toEqual([])
    }
  })
})
