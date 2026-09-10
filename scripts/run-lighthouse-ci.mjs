import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import { chromium } from 'playwright'

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const baseUrl = process.env.LIGHTHOUSE_BASE_URL ?? 'http://localhost:4173'
const lhciCli = path.join(repositoryRoot, 'node_modules', '@lhci', 'cli', 'src', 'cli.js')

async function requireReachableServer() {
  try {
    const response = await fetch(`${baseUrl}/login`, { signal: AbortSignal.timeout(5_000) })
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`)
    }
  } catch (error) {
    throw new Error(
      `Lighthouse target ${baseUrl} is unavailable. Start the seeded backend and production preview first.`,
      { cause: error },
    )
  }
}

function runLighthouse(target, cookieHeader = '') {
  const result = spawnSync(
    process.execPath,
    [lhciCli, 'autorun', '--config=./lighthouserc.cjs'],
    {
      cwd: repositoryRoot,
      env: {
        ...process.env,
        CHROME_PATH: chromium.executablePath(),
        LIGHTHOUSE_BASE_URL: baseUrl,
        PERF_LHCI_SCENARIO: target,
        PERF_LHCI_COOKIE_HEADER: cookieHeader,
        ...(process.platform === 'win32'
          ? {
              NODE_OPTIONS: [
                process.env.NODE_OPTIONS,
                '--require=./scripts/lighthouse-windows-cleanup.cjs',
              ]
                .filter(Boolean)
                .join(' '),
            }
          : {}),
      },
      stdio: 'inherit',
    },
  )

  if (result.error) {
    throw result.error
  }
  if (result.status !== 0) {
    throw new Error(`Lighthouse CI ${target} gate exited with status ${result.status}.`)
  }
}

async function authenticatedCookieHeader() {
  const browser = await chromium.launch()

  try {
    const context = await browser.newContext()
    const page = await context.newPage()
    await page.goto(`${baseUrl}/login`, { waitUntil: 'domcontentloaded' })
    await page.getByLabel('Username or Email').fill('admin@stpaulos.local')
    await page.locator('#password').fill('StPaul2026!')
    await page.getByRole('button', { name: 'Sign In to Reporting Portal' }).click()
    await page.waitForURL((url) => url.pathname === '/admin', { timeout: 20_000 })

    const cookies = await context.cookies(baseUrl)
    return cookies.map(({ name, value }) => `${name}=${value}`).join('; ')
  } finally {
    await browser.close()
  }
}

await requireReachableServer()
runLighthouse('login')
runLighthouse('authenticated', await authenticatedCookieHeader())
