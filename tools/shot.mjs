// Local-only visual check: log in and screenshot a page of the running app.
// Usage: node tools/shot.mjs [path] [outFile]
//   node tools/shot.mjs /admin C:/temp/dashboard.png
import { chromium } from 'playwright'

const base = process.env.SHOT_BASE || 'http://127.0.0.1:5173'
const path = process.argv[2] || '/admin'
const out = process.argv[3] || 'shot.png'
const username = process.env.SHOT_USER || 'admin1'
const password = process.env.SHOT_PASS || 'ChangeMe123!'

const browser = await chromium.launch()
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 2,
})
if (process.env.SHOT_COLLAPSE) {
  await context.addInitScript(() => {
    try {
      localStorage.setItem('stpaul:sidebar-collapsed', '1')
    } catch {
      /* ignore */
    }
  })
}

const page = await context.newPage()

await page.goto(`${base}/`, { waitUntil: 'domcontentloaded', timeout: 30000 })
await page.waitForTimeout(1500)

// Log in if the auth form is present.
const identifier = page.locator('#identifier')
if (await identifier.count()) {
  await identifier.fill(username)
  await page.locator('input[type="password"]').first().fill(password)
  await page.locator('button[type="submit"]').first().click()
  await page.waitForTimeout(2800)
}

await page.goto(`${base}${path}`, { waitUntil: 'domcontentloaded', timeout: 30000 })
await page.waitForTimeout(2000)
await page.screenshot({ path: out, fullPage: false })

await browser.close()
console.log(`saved ${out} (url: ${page.url()})`)
