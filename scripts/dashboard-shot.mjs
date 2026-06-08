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
page.on('console', (msg) => logs.push(`[${msg.type()}] ${msg.text()}`))
page.on('pageerror', (err) => logs.push(`[pageerror] ${err.message}`))

await page.goto(`${baseUrl}/login`, { waitUntil: 'networkidle' })
await page.fill('#identifier', identifier)
await page.fill('#password', password)
await page.click('button[type=submit]')

await page.waitForURL('**/admin', { timeout: 30000 }).catch(() => {})
await page.waitForLoadState('networkidle').catch(() => {})
await page.waitForSelector('svg.recharts-surface', { timeout: 30000 }).catch(() => {})
// Let recharts mount animations and the lazy report-detail fetch settle.
await page.waitForTimeout(3000)

const chartCount = await page.locator('svg.recharts-surface').count()

await page.screenshot({ path: `${outDir}/${tag}-full.png`, fullPage: true })
await writeFile(`${outDir}/${tag}-console.log`, logs.join('\n'))

console.log(`captured tag=${tag} url=${page.url()} charts=${chartCount}`)

await browser.close()
