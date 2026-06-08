// Logs in as the dev superadmin, opens the clinical dashboard, waits for the
// charts to render, and screenshots the full page. Usage:
//   node scripts/dashboard-shot.mjs <tag>
// Produces artifacts/dashboard-shots/<tag>-full.png (+ console log).
import { mkdir, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright'

const tag = process.argv[2] ?? 'shot'
const outDir = 'artifacts/dashboard-shots'
const baseUrl = process.env.SHOT_BASE_URL ?? 'http://localhost:5173'
const identifier = process.env.SHOT_USER ?? 'admin@stpaulos.local'
const password = process.env.SHOT_PASS ?? 'StPaul2026!'

await mkdir(outDir, { recursive: true })

const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } })
const page = await context.newPage()

const logs = []
let detailRequests = 0
let analyticsRequests = 0
page.on('console', (msg) => logs.push(`[${msg.type()}] ${msg.text()}`))
page.on('pageerror', (err) => logs.push(`[pageerror] ${err.message}`))
let analyticsUrl = ''
let analyticsWeekly = ''
page.on('request', (req) => {
  const url = req.url()
  if (url.includes('/api/reports/details')) detailRequests += 1
  if (url.includes('/api/analytics/dashboard')) analyticsRequests += 1
})
page.on('response', async (res) => {
  if (res.url().includes('/api/analytics/dashboard') && res.status() === 200) {
    analyticsUrl = res.url()
    try {
      const json = await res.json()
      const fams = json?.families ?? {}
      analyticsWeekly = ['inpatient', 'outpatient', 'procedure']
        .map((f) => `${f}=${(fams?.[f]?.weekly ?? []).length}`)
        .join(' ')
    } catch {
      analyticsWeekly = 'parse-failed'
    }
  }
})

await page.goto(`${baseUrl}/login`, { waitUntil: 'networkidle' })
await page.fill('#identifier', identifier)
await page.fill('#password', password)
await page.click('button[type=submit]')

await page.waitForURL('**/admin', { timeout: 30000 }).catch(() => {})
await page.waitForLoadState('networkidle').catch(() => {})

// Confirm the session actually established — the Sanctum login can flake under
// automation; without this guard a 401 yields a half-rendered dashboard.
const authStatus = await page.evaluate(async () => {
  const res = await fetch('/api/auth/me', { credentials: 'include' })
  return res.status
})
if (authStatus !== 200) {
  console.log(`AUTH FAILED status=${authStatus} — aborting capture for tag=${tag}`)
  await browser.close()
  process.exit(1)
}

await page.waitForSelector('svg.recharts-surface', { timeout: 30000 }).catch(() => {})
// Let recharts mount animations and any analytics fetch settle.
await page.waitForTimeout(3000)

const chartCount = await page.locator('svg.recharts-surface').count()
const barRectCount = await page.locator('.recharts-bar-rectangle').count()
// Bars inside the availability chart's section specifically.
let availabilityBars = -1
try {
  const section = page
    .locator('section, div')
    .filter({ hasText: 'Senior physician availability trend' })
    .last()
  availabilityBars = await section.locator('.recharts-bar-rectangle').count()
} catch {
  availabilityBars = -1
}

await page.screenshot({ path: `${outDir}/${tag}-full.png`, fullPage: true })
await writeFile(`${outDir}/${tag}-console.log`, logs.join('\n'))

console.log(
  `captured tag=${tag} url=${page.url()} charts=${chartCount} ` +
    `reportsDetailsRequests=${detailRequests} analyticsDashboardRequests=${analyticsRequests}`,
)
console.log(`  analyticsQuery=${analyticsUrl.replace(/^https?:\/\/[^/]+/, '')}`)
console.log(`  analyticsWeeklyCounts=${analyticsWeekly}`)
console.log(`  barRectsTotal=${barRectCount} availabilityChartBars=${availabilityBars}`)

await browser.close()
