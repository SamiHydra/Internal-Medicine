import { defineConfig, devices } from '@playwright/test'

/**
 * Run the same E2E suite against an already-running deployment instead of the
 * isolated Vite + `php artisan serve` stack that playwright.config.ts boots.
 *
 *   E2E_BASE_URL=http://localhost:4173 npx playwright test --config playwright.external.config.ts
 *   E2E_BASE_URL=https://localhost:8443 npx playwright test --config playwright.external.config.ts
 *
 * The target must be seeded with the development fixture (the accounts in
 * tests/e2e/helpers/accounts.ts). No web server is started or torn down here,
 * and the .auth storage states are written next to the suite as usual.
 * Self-signed certificates (the Docker parity stack) are accepted.
 */
const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:5173'

export default defineConfig({
  testDir: './tests/e2e',
  outputDir: './test-results-external',
  workers: 1,
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: [
    ['list'],
    ['json', { outputFile: './test-results-external/results.json' }],
  ],
  use: {
    baseURL,
    ignoreHTTPSErrors: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    actionTimeout: 15_000,
    navigationTimeout: 20_000,
  },
  projects: [
    { name: 'setup', testMatch: /auth\.setup\.ts/ },
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1920, height: 1080 } },
      dependencies: ['setup'],
      testIgnore: /auth\.setup\.ts/,
    },
  ],
})
