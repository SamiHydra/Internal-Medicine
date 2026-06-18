import { defineConfig, devices } from '@playwright/test'

/**
 * Pre-deployment QA suite for the St Paul reporting app.
 *
 * The SPA (Vite, :5173) proxies /api and /sanctum to the Laravel API (:8000),
 * so the browser treats them as same-origin — required for Sanctum's SameSite
 * session/XSRF cookies. baseURL therefore points at the Vite origin.
 *
 * Servers are auto-started if not already running (reuseExistingServer), so the
 * suite is self-contained and repeatable: `npx playwright test`.
 */
const ARTIFACTS = './artifacts/pre-deployment-qa'

export default defineConfig({
  testDir: `${ARTIFACTS}/PLAYWRIGHT_TESTS`,
  outputDir: `${ARTIFACTS}/evidence/test-results`,
  // One worker: the suite shares a single Laravel API + SQLite dev DB and some
  // specs create/modify data. Determinism over speed for a QA gate.
  workers: 1,
  fullyParallel: false,
  forbidOnly: false,
  retries: 0,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: [
    ['list'],
    ['html', { outputFolder: `${ARTIFACTS}/evidence/html-report`, open: 'never' }],
    ['json', { outputFile: `${ARTIFACTS}/evidence/results.json` }],
  ],
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 15_000,
    navigationTimeout: 20_000,
  },
  projects: [
    // Logs each role in once and saves a storageState file the other projects reuse.
    { name: 'setup', testMatch: /auth\.setup\.ts/ },
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1920, height: 1080 } },
      dependencies: ['setup'],
      // auth.setup runs in the 'setup' project; exclude it here.
      testIgnore: /auth\.setup\.ts/,
    },
  ],
  webServer: [
    {
      command: 'php artisan serve --host=127.0.0.1 --port=8000',
      cwd: './backend',
      url: 'http://127.0.0.1:8000/up',
      reuseExistingServer: true,
      timeout: 60_000,
    },
    {
      command: 'npm run dev',
      url: 'http://localhost:5173',
      reuseExistingServer: true,
      timeout: 60_000,
    },
  ],
})
