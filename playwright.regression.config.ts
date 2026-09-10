import { defineConfig, devices } from '@playwright/test'

/**
 * Business-logic regression harness (BUSINESS_LOGIC_REGRESSION_REPORT.md).
 *
 * Runs against an ALREADY RUNNING stack: the local dev stack by default
 * (Vite on :5173 proxying `php artisan serve` on :8000, SQLite at
 * backend/database/database.sqlite) or any other origin via
 * REGRESSION_BASE_URL. Nothing is started or torn down here.
 *
 * Every spec talks to the API directly, re-reads the database through
 * node:sqlite (REGRESSION_DB, default the dev database) after each mutation,
 * and records its findings under output/regression/<domain>.json.
 *
 *   npx playwright test --config playwright.regression.config.ts
 *   npx playwright test --config playwright.regression.config.ts tests/regression/clinical.spec.ts
 */
export default defineConfig({
  testDir: './tests/regression',
  outputDir: './output/regression/test-results',
  workers: 1,
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  timeout: 180_000,
  expect: { timeout: 15_000 },
  reporter: [['list'], ['json', { outputFile: './output/regression/results.json' }]],
  use: {
    baseURL: process.env.REGRESSION_BASE_URL ?? 'http://localhost:5173',
    ignoreHTTPSErrors: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    actionTimeout: 20_000,
    navigationTimeout: 30_000,
    ...devices['Desktop Chrome'],
    viewport: { width: 1440, height: 900 },
  },
})
