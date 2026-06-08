// Robust probe: logs in, confirms the session, then directly fetches
// /api/analytics/dashboard and prints whether the outpatient weekly buckets
// carry chartMetrics.availability (the data the availability chart needs).
import { chromium } from 'playwright'

const baseUrl = process.env.SHOT_BASE_URL ?? 'http://localhost:5173'
const identifier = process.env.SHOT_USER ?? 'admin@stpaulos.local'
const password = process.env.SHOT_PASS ?? 'StPaul2026!'

const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await context.newPage()

await page.goto(`${baseUrl}/login`, { waitUntil: 'networkidle' })
await page.fill('#identifier', identifier)
await page.fill('#password', password)
await page.click('button[type=submit]')
await page.waitForURL('**/admin', { timeout: 30000 }).catch(() => {})
await page.waitForLoadState('networkidle').catch(() => {})

// Confirm the session is established before probing.
const me = await page.evaluate(async () => {
  const res = await fetch('/api/auth/me', { credentials: 'include' })
  return { status: res.status }
})
console.log(`auth/me status=${me.status}`)

if (me.status !== 200) {
  console.log('Session not established; aborting probe.')
  await browser.close()
} else {
  const result = await page.evaluate(async () => {
    const res = await fetch('/api/analytics/dashboard?dateFrom=2026-04-20&dateTo=2026-06-08', {
      credentials: 'include',
    })
    const json = await res.json().catch(() => null)
    const out = json?.families?.outpatient
    const weekly = out?.weekly ?? []
    return {
      status: res.status,
      topKeys: json ? Object.keys(json) : [],
      weeklyCount: weekly.length,
      samples: weekly.slice(0, 5).map((row) => ({
        label: row.label,
        hasChartMetrics: Boolean(row.chartMetrics),
        availability: row.chartMetrics?.availability ?? null,
      })),
    }
  })

  console.log(`dashboard status=${result.status} topKeys=${result.topKeys.join(',')}`)
  console.log(`outpatient weekly buckets=${result.weeklyCount}`)
  for (const s of result.samples) {
    console.log(
      `  ${s.label}: chartMetrics=${s.hasChartMetrics ? 'yes' : 'NO'} availability=${
        s.availability ? JSON.stringify(s.availability) : 'MISSING'
      }`,
    )
  }
  await browser.close()
}
