import { test, expect, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import fs from 'node:fs'
import path from 'node:path'
import { authFile } from './helpers/auth'
import type { AccountKey } from './helpers/accounts'

/**
 * Accessibility SWEEP (not a gate). Runs axe-core with the WCAG 2.1 A/AA and
 * best-practice rule sets on every important route, for every role, at a
 * desktop (1280) and a phone (390) width, including the states that only exist
 * after an interaction (the action-item sheet, the account/navigation sheet).
 *
 * Every violation is written to output/a11y/sweep/<role>-<width>.json with its
 * impact, rule id, CSS selector, a snippet of the offending HTML and the route
 * it was found on. The final test aggregates those files into
 * output/a11y/summary.json and output/a11y/summary.md so the before/after
 * counts in docs/ACCESSIBILITY_AUDIT.md are reproducible.
 *
 * Nothing is silenced: a CRITICAL violation is a soft failure (so the sweep
 * still finishes and reports everything), lower impacts are recorded only.
 *
 *   E2E_BASE_URL=http://localhost:5193 npx playwright test \
 *     --config playwright.external.config.ts tests/e2e/a11y-sweep.spec.ts
 */

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice']

const WIDTHS = [
  { name: 'desktop-1280', width: 1280, height: 900 },
  { name: 'phone-390', width: 390, height: 844 },
] as const

const OUT_DIR = path.resolve('output', 'a11y', 'sweep')
const SUMMARY_DIR = path.resolve('output', 'a11y')

type SweepRole = Extract<AccountKey, 'superadmin' | 'nurse' | 'resident' | 'consultant' | 'group_rep'> | 'anonymous'

type Step = {
  /** Short label for the report (route + state). */
  label: string
  route: string
  /** Optional interaction that puts the page in the state to scan (opens a sheet, etc). */
  prepare?: (page: Page, width: number) => Promise<boolean>
  /** Routes that render outside the authenticated shell (login, register, ...). */
  publicPage?: boolean
}

export type SweepViolation = {
  role: string
  width: string
  route: string
  label: string
  id: string
  impact: string
  help: string
  helpUrl: string
  tags: string[]
  nodes: { target: string; html: string; summary: string }[]
}

type SweepFile = {
  role: string
  width: string
  scanned: { label: string; route: string; violations: number; incomplete: number; skipped?: string }[]
  violations: SweepViolation[]
}

async function shellReady(page: Page) {
  await expect(page.getByRole('button', { name: 'Notifications' }).first()).toBeVisible({ timeout: 20_000 })
  await expect(page).not.toHaveURL(/\/login/)
}

async function settle(page: Page) {
  await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {})
  await page.waitForTimeout(600)
}

/** Open the first weekly report from a list page (nurse report list / admin board). */
async function openFirstReport(page: Page) {
  const link = page.locator('a[href^="/reports/"]').first()
  if ((await link.count()) === 0) return false
  await link.click()
  await page.waitForURL(/\/reports\//, { timeout: 15_000 })
  await settle(page)
  return true
}

/** Open the first action item's sheet (row button on phones, icon button on desktop). */
async function openActionItemSheet(page: Page) {
  const openButton = page.getByRole('button', { name: /^Open / }).first()
  const rowButton = page.locator('button.col-span-2').first()
  const trigger = (await openButton.isVisible().catch(() => false)) ? openButton : rowButton
  if (!(await trigger.isVisible().catch(() => false))) return false
  await trigger.click()
  await expect(page.getByRole('dialog')).toBeVisible({ timeout: 15_000 })
  await page.waitForTimeout(800)
  return true
}

/** Open the slide-out account/navigation sheet (the phone "More" tab or avatar button). */
async function openAccountSheet(page: Page) {
  const trigger = page.getByRole('button', { name: 'Open account menu' })
  if (!(await trigger.isVisible().catch(() => false))) return false
  await trigger.click()
  await expect(page.getByRole('dialog')).toBeVisible({ timeout: 10_000 })
  await page.waitForTimeout(500)
  return true
}

/** Open the first academic evaluation's detail sheet from the submissions table. */
async function openEvaluationDetail(page: Page) {
  // Each evaluation row is a full-width button that opens the detail sheet.
  const trigger = page.locator('button.group.grid').first()
  if (!(await trigger.isVisible().catch(() => false))) return false
  await trigger.click()
  const dialog = page.getByRole('dialog')
  if (!(await dialog.isVisible({ timeout: 8_000 }).catch(() => false))) return false
  await page.waitForTimeout(600)
  return true
}

const PLAN: Record<SweepRole, Step[]> = {
  anonymous: [
    { label: 'login', route: '/login', publicPage: true },
    { label: 'register', route: '/register', publicPage: true },
    { label: 'forgot-password', route: '/forgot-password', publicPage: true },
  ],
  nurse: [
    { label: 'nurse-home', route: '/nurse' },
    { label: 'nurse-reports', route: '/nurse/reports' },
    { label: 'nurse-report-form', route: '/nurse/reports', prepare: openFirstReport },
    { label: 'nurse-activity', route: '/nurse/activity' },
    { label: 'nurse-notifications', route: '/notifications' },
    { label: 'nurse-account-sheet', route: '/nurse', prepare: openAccountSheet },
  ],
  superadmin: [
    { label: 'admin-dashboard', route: '/admin' },
    { label: 'admin-submissions', route: '/admin/submissions' },
    { label: 'admin-report-form', route: '/admin/submissions', prepare: openFirstReport },
    { label: 'admin-action-items', route: '/admin/action-items' },
    { label: 'admin-action-item-sheet', route: '/admin/action-items', prepare: openActionItemSheet },
    { label: 'admin-templates', route: '/admin/templates' },
    { label: 'admin-import', route: '/admin/import' },
    { label: 'admin-export', route: '/admin/export' },
    { label: 'admin-users', route: '/admin/users' },
    { label: 'admin-audit', route: '/admin/audit' },
    { label: 'admin-settings', route: '/admin/settings' },
    { label: 'admin-notifications', route: '/admin/notifications' },
    { label: 'admin-academic-dashboard', route: '/admin/academic' },
    { label: 'admin-academic-submissions', route: '/admin/academic/submissions' },
    { label: 'admin-academic-evaluation-sheet', route: '/admin/academic/submissions', prepare: openEvaluationDetail },
    { label: 'admin-academic-roster', route: '/admin/academic/roster' },
    { label: 'admin-academic-rotations', route: '/admin/academic/rotations' },
    { label: 'admin-academic-forms', route: '/admin/academic/evaluation-forms' },
    { label: 'admin-academic-students', route: '/admin/academic/students' },
    { label: 'admin-academic-structure', route: '/admin/academic/structure' },
    { label: 'admin-account-sheet', route: '/admin', prepare: openAccountSheet },
  ],
  resident: [
    { label: 'resident-home', route: '/academic' },
    { label: 'resident-submit', route: '/academic/submit' },
    { label: 'resident-history', route: '/academic/history' },
    { label: 'resident-notifications', route: '/admin/notifications' },
  ],
  consultant: [
    { label: 'consultant-home', route: '/academic' },
    { label: 'consultant-submit', route: '/academic/submit' },
    { label: 'consultant-teaching', route: '/academic/teaching' },
    { label: 'consultant-history', route: '/academic/history' },
    { label: 'consultant-morning', route: '/academic/morning' },
  ],
  group_rep: [{ label: 'rep-teaching-log', route: '/teaching' }],
}

async function scan(page: Page, role: string, widthName: string, step: Step) {
  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze()
  const violations: SweepViolation[] = results.violations.map((v) => ({
    role,
    width: widthName,
    route: page.url().replace(/^https?:\/\/[^/]+/, ''),
    label: step.label,
    id: v.id,
    impact: v.impact ?? 'unknown',
    help: v.help,
    helpUrl: v.helpUrl,
    tags: v.tags,
    nodes: v.nodes.map((n) => ({
      target: n.target.map(String).join(' '),
      html: n.html.slice(0, 240),
      summary: (n.failureSummary ?? '').slice(0, 300),
    })),
  }))
  return { violations, incomplete: results.incomplete.length }
}

for (const [role, steps] of Object.entries(PLAN) as [SweepRole, Step[]][]) {
  test.describe(`a11y sweep - ${role}`, () => {
    if (role !== 'anonymous') {
      test.use({ storageState: authFile(role) })
    }

    for (const vp of WIDTHS) {
      test(`${role} @ ${vp.name}`, async ({ page }) => {
        test.setTimeout(60_000 + steps.length * 30_000)
        await page.setViewportSize({ width: vp.width, height: vp.height })
        fs.mkdirSync(OUT_DIR, { recursive: true })

        const file: SweepFile = { role, width: vp.name, scanned: [], violations: [] }

        for (const step of steps) {
          await page.goto(step.route, { waitUntil: 'domcontentloaded' })
          if (step.publicPage) {
            await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {})
            await page.waitForTimeout(500)
          } else {
            await shellReady(page)
            await settle(page)
            // A role that is not allowed on a route is redirected to its landing
            // page; scanning that would double-count the landing page.
            const landed = page.url().replace(/^https?:\/\/[^/]+/, '')
            if (!landed.startsWith(step.route.split('/').slice(0, 3).join('/'))) {
              file.scanned.push({ label: step.label, route: step.route, violations: 0, incomplete: 0, skipped: `redirected to ${landed}` })
              continue
            }
          }

          if (step.prepare) {
            const prepared = await step.prepare(page, vp.width)
            if (!prepared) {
              file.scanned.push({ label: step.label, route: step.route, violations: 0, incomplete: 0, skipped: 'trigger not available' })
              continue
            }
          }

          const { violations, incomplete } = await scan(page, role, vp.name, step)
          file.scanned.push({ label: step.label, route: page.url().replace(/^https?:\/\/[^/]+/, ''), violations: violations.length, incomplete })
          file.violations.push(...violations)

          const critical = violations.filter((v) => v.impact === 'critical')
          expect
            .soft(critical, `critical a11y violations on ${step.label} @ ${vp.name}: ${critical.map((v) => `${v.id}(${v.nodes.length})`).join(', ')}`)
            .toHaveLength(0)

          // Close any sheet the step opened so the next navigation starts clean.
          if (step.prepare) {
            await page.keyboard.press('Escape').catch(() => {})
            await page.waitForTimeout(300)
          }
        }

        fs.writeFileSync(path.join(OUT_DIR, `${role}-${vp.name}.json`), JSON.stringify(file, null, 2))
      })
    }
  })
}

test.describe('a11y sweep - summary', () => {
  test('zz aggregate sweep results', async () => {
    const files = fs.existsSync(OUT_DIR) ? fs.readdirSync(OUT_DIR).filter((f) => f.endsWith('.json')) : []
    const all: SweepViolation[] = []
    const scanned: SweepFile['scanned'] = []
    for (const f of files) {
      const parsed = JSON.parse(fs.readFileSync(path.join(OUT_DIR, f), 'utf8')) as SweepFile
      all.push(...parsed.violations)
      scanned.push(...parsed.scanned.map((s) => ({ ...s, label: `${parsed.role}/${parsed.width}/${s.label}` })))
    }

    const byImpact: Record<string, { violations: number; nodes: number }> = {}
    const byRule: Record<string, { impact: string; violations: number; nodes: number; pages: Set<string> }> = {}
    for (const v of all) {
      byImpact[v.impact] ??= { violations: 0, nodes: 0 }
      byImpact[v.impact].violations += 1
      byImpact[v.impact].nodes += v.nodes.length
      byRule[v.id] ??= { impact: v.impact, violations: 0, nodes: 0, pages: new Set() }
      byRule[v.id].violations += 1
      byRule[v.id].nodes += v.nodes.length
      byRule[v.id].pages.add(`${v.role}/${v.width}/${v.label}`)
    }

    const summary = {
      generatedAt: new Date().toISOString(),
      pagesScanned: scanned.filter((s) => !s.skipped).length,
      pagesSkipped: scanned.filter((s) => s.skipped),
      byImpact,
      byRule: Object.fromEntries(
        Object.entries(byRule)
          .sort((a, b) => b[1].nodes - a[1].nodes)
          .map(([id, r]) => [id, { ...r, pages: [...r.pages].sort() }]),
      ),
    }
    fs.mkdirSync(SUMMARY_DIR, { recursive: true })
    fs.writeFileSync(path.join(SUMMARY_DIR, 'summary.json'), JSON.stringify(summary, null, 2))

    const order = ['critical', 'serious', 'moderate', 'minor']
    const lines = [
      `# axe sweep summary (${summary.generatedAt})`,
      '',
      `Pages/states scanned: ${summary.pagesScanned} (skipped: ${summary.pagesSkipped.length})`,
      '',
      '| Impact | Violations (page x rule) | Nodes |',
      '|---|---|---|',
      ...order.map((k) => `| ${k} | ${byImpact[k]?.violations ?? 0} | ${byImpact[k]?.nodes ?? 0} |`),
      '',
      '| Rule | Impact | Pages | Nodes |',
      '|---|---|---|---|',
      ...Object.entries(summary.byRule).map(([id, r]) => `| ${id} | ${r.impact} | ${r.pages.length} | ${r.nodes} |`),
      '',
      '## Per-node detail',
      '',
      ...all.flatMap((v) =>
        v.nodes.map((n) => `- [${v.impact}] ${v.id} - ${v.role}/${v.width} ${v.route} - \`${n.target}\` - ${n.html.replace(/\s+/g, ' ').slice(0, 140)}`),
      ),
    ]
    fs.writeFileSync(path.join(SUMMARY_DIR, 'summary.md'), lines.join('\n'))

    expect(files.length, 'at least one sweep file should exist').toBeGreaterThan(0)
  })
})
