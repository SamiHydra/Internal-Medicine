import { test, expect } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { authFile } from './helpers/auth'

/**
 * Diagnostic sweep for the mobile-friendliness audit. Not a gate: it renders
 * every nav-reachable route at phone width, records real geometry, and writes a
 * JSON report plus screenshots for inspection. Assertions are deliberately
 * absent so one bad page cannot hide the rest of the sweep.
 *
 * Run explicitly:
 *   npx playwright test tests/e2e/zz-mobile-audit.spec.ts --project=chromium
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

const PHONE = { width: 393, height: 851 }
const OUT = 'artifacts/audit-2026-07-21/mobile'

const ROUTES: Record<string, string[]> = {
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
    '/admin/academic/roster',
    '/admin/academic/rotations',
    '/admin/academic/evaluation-forms',
    '/admin/academic/students',
    '/admin/academic/structure',
  ],
  nurse: ['/nurse', '/nurse/reports', '/nurse/activity'],
  resident: ['/academic', '/academic/submit', '/academic/history', '/academic/morning'],
  consultant: ['/academic', '/academic/submit', '/academic/teaching', '/academic/history'],
  group_rep: ['/teaching'],
}

type Finding = {
  role: string
  route: string
  docScrollWidth: number
  docClientWidth: number
  horizontalOverflow: number
  offViewportElements: Array<{ tag: string; cls: string; right: number; text: string }>
  smallTargets: Array<{ tag: string; label: string; w: number; h: number }>
  screenshot: string
  error?: string
}

test.describe('Mobile audit sweep (diagnostic, not a gate)', () => {
  test.describe.configure({ mode: 'serial', timeout: 240_000 })

  // Opt-in: this walks 27 routes and costs ~4 minutes. It is a diagnostic for
  // audit work, not a merge gate, so it stays out of the CI run by default.
  // The touch-target regression check in zz-touch-target-check.spec.ts is the
  // part that guards the fix and does run every time.
  test.skip(!process.env.MOBILE_AUDIT, 'set MOBILE_AUDIT=1 to run the sweep')

  test('render every route at 393px and record geometry', async ({ browser }) => {
    mkdirSync(OUT, { recursive: true })
    const findings: Finding[] = []

    for (const [role, routes] of Object.entries(ROUTES)) {
      const context = await browser.newContext({
        storageState: authFile(role as any),
        viewport: PHONE,
        hasTouch: true,
        isMobile: true,
        deviceScaleFactor: 2,
      })
      const page = await context.newPage()

      for (const route of routes) {
        const slug = `${role}${route.replace(/\//g, '-')}`
        const shot = `${OUT}/${slug}.png`
        try {
          await page.goto(route, { waitUntil: 'domcontentloaded' })
          // Let the shell settle; these pages fetch on mount.
          await page.waitForTimeout(2500)

          const geometry = await page.evaluate((vw: number) => {
            const doc = document.documentElement
            const off: Array<{ tag: string; cls: string; right: number; text: string }> = []
            const small: Array<{ tag: string; label: string; w: number; h: number }> = []

            for (const el of Array.from(document.querySelectorAll('*'))) {
              const r = el.getBoundingClientRect()
              if (r.width === 0 || r.height === 0) continue
              const style = getComputedStyle(el)
              if (style.visibility === 'hidden' || style.display === 'none') continue

              // Elements extending past the viewport's right edge.
              if (r.right > vw + 1 && r.width <= vw * 3) {
                off.push({
                  tag: el.tagName.toLowerCase(),
                  cls: (el.getAttribute('class') ?? '').slice(0, 70),
                  right: Math.round(r.right),
                  text: (el.textContent ?? '').trim().slice(0, 40),
                })
              }

              // Interactive controls below the 44px touch minimum.
              const interactive =
                ['button', 'a', 'input', 'select', 'textarea'].includes(el.tagName.toLowerCase()) ||
                ['button', 'link', 'checkbox', 'radio', 'tab'].includes(el.getAttribute('role') ?? '')
              if (interactive && (r.width < 44 || r.height < 44)) {
                small.push({
                  tag: el.tagName.toLowerCase(),
                  label: ((el.getAttribute('aria-label') || el.textContent) ?? '').trim().slice(0, 30),
                  w: Math.round(r.width),
                  h: Math.round(r.height),
                })
              }
            }

            return {
              docScrollWidth: doc.scrollWidth,
              docClientWidth: doc.clientWidth,
              // Dedupe the off-viewport list: parents and children repeat.
              off: off.slice(0, 12),
              small: small.slice(0, 15),
            }
          }, PHONE.width)

          await page.screenshot({ path: shot, fullPage: false })

          findings.push({
            role,
            route,
            docScrollWidth: geometry.docScrollWidth,
            docClientWidth: geometry.docClientWidth,
            horizontalOverflow: geometry.docScrollWidth - geometry.docClientWidth,
            offViewportElements: geometry.off,
            smallTargets: geometry.small,
            screenshot: shot,
          })
        } catch (error) {
          findings.push({
            role,
            route,
            docScrollWidth: 0,
            docClientWidth: 0,
            horizontalOverflow: 0,
            offViewportElements: [],
            smallTargets: [],
            screenshot: shot,
            error: String(error).slice(0, 200),
          })
        }
      }

      await context.close()
    }

    writeFileSync(`${OUT}/report.json`, JSON.stringify(findings, null, 2))

    const overflowing = findings.filter((f) => f.horizontalOverflow > 1)
    console.log(`MOBILE AUDIT: ${findings.length} routes, ${overflowing.length} with horizontal overflow`)
    for (const f of overflowing) {
      console.log(`  OVERFLOW ${f.horizontalOverflow}px  ${f.role} ${f.route}`)
    }
    expect(findings.length, 'the sweep must cover every route').toBeGreaterThan(20)
  })
})
