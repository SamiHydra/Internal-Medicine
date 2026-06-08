// Logs in as the dev superadmin, navigates to a path, screenshots it.
// Usage: node scripts/page-shot.mjs /admin/action-items action-items
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'

const path = process.argv[2] ?? '/admin'
const tag = process.argv[3] ?? 'page'
const base = process.env.SHOT_BASE_URL ?? 'http://localhost:5173'
const outDir = 'artifacts/dashboard-shots'
await mkdir(outDir, { recursive: true })

const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
const page = await context.newPage()

await page.goto(`${base}/login`, { waitUntil: 'networkidle' })
await page.fill('#identifier', 'admin@stpaulos.local')
await page.fill('#password', 'StPaul2026!')
await page.click('button[type=submit]')
await page.waitForURL('**/admin', { timeout: 30000 }).catch(() => {})

const auth = await page.evaluate(async () => (await fetch('/api/auth/me', { credentials: 'include' })).status)
if (auth !== 200) {
  console.log('AUTH FAILED', auth)
  await browser.close()
  process.exit(1)
}

await page.goto(`${base}${path}`, { waitUntil: 'networkidle' })
await page.waitForTimeout(1500)
await page.screenshot({ path: `${outDir}/${tag}-full.png`, fullPage: true })
console.log('captured', tag, page.url())

await browser.close()
