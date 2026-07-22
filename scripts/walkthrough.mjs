// Logs in, visits a list of paths, screenshots each, and records render state +
// console errors per page. Usage:
//   node scripts/walkthrough.mjs <user> <pass> <comma,paths> <tag>
import { mkdir, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright'

const base = 'http://localhost:5173'
const user = process.argv[2] ?? 'admin@stpaulos.local'
const pass = process.argv[3] ?? 'StPaul2026!'
const paths = (process.argv[4] ?? '/admin').split(',')
const tag = process.argv[5] ?? 'walk'
const outDir = 'artifacts/walkthrough'
await mkdir(outDir, { recursive: true })

const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
const page = await context.newPage()

const consoleErrors = []
page.on('console', (m) => {
  if (m.type() === 'error') consoleErrors.push(m.text())
})
page.on('pageerror', (e) => consoleErrors.push('PAGEERROR: ' + e.message))

await page.goto(base + '/login', { waitUntil: 'networkidle' })
await page.fill('#identifier', user)
await page.fill('#password', pass)
await page.click('button[type=submit]')
// Wait for the login to actually complete (redirect away from /login) before
// probing the session, otherwise the auth check races the login POST.
await page.waitForURL((u) => !u.pathname.endsWith('/login'), { timeout: 30000 }).catch(() => {})
await page.waitForLoadState('networkidle').catch(() => {})

const auth = await page.evaluate(async () =>
  (await fetch('/api/auth/me', { credentials: 'include', headers: { Accept: 'application/json' } })).status,
)
if (auth !== 200) {
  console.log(JSON.stringify({ user, authStatus: auth, error: 'login failed' }))
  await browser.close()
  process.exit(1)
}

const results = []
for (const p of paths) {
  const before = consoleErrors.length
  const t0 = Date.now()
  await page.goto(base + p, { waitUntil: 'networkidle' }).catch(() => {})
  await page.waitForTimeout(1600)
  const ms = Date.now() - t0
  const charts = await page.locator('svg.recharts-surface').count()
  const bodyText = await page.locator('body').innerText().catch(() => '')
  const errorBanner = /something went wrong|failed to load|unable to|not configured|application error|404|not found/i.test(bodyText)
  const safe = p.replace(/[^a-z0-9]+/gi, '_')
  await page.screenshot({ path: `${outDir}/${tag}${safe}.png`, fullPage: true })
  results.push({
    path: p,
    finalUrl: page.url().replace(base, ''),
    loadMs: ms,
    charts,
    newConsoleErrors: consoleErrors.length - before,
    errorBanner,
  })
}

console.log(JSON.stringify({ user, results }, null, 2))
await writeFile(`${outDir}/${tag}-console.log`, consoleErrors.join('\n') || '(no console errors)')
await browser.close()
