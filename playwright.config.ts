import { defineConfig, devices } from '@playwright/test'

/**
 * Pre-deployment QA suite for the St Paul reporting app.
 *
 * The SPA (Vite, :5173) proxies /api and /sanctum to the Laravel API (:8000),
 * so the browser treats them as same-origin - required for Sanctum's SameSite
 * session/XSRF cookies. baseURL therefore points at the Vite origin.
 *
 * The backend launcher always recreates backend/database/e2e.sqlite and seeds
 * it before serving. Existing servers are never reused, preventing the gate
 * from reading or mutating a developer database.
 */
export default defineConfig({
  testDir: './tests/e2e',
  outputDir: './test-results',
  // One worker: the suite shares a single Laravel API + SQLite dev DB and some
  // specs create/modify data. Determinism over speed for a QA gate.
  workers: 1,
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: [
    ['list'],
    ['html', { outputFolder: './playwright-report', open: 'never' }],
    ['json', { outputFile: './test-results/results.json' }],
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
      command: 'node scripts/start-e2e-backend.mjs',
      url: 'http://127.0.0.1:8000/up',
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: 'npm run dev -- --host 127.0.0.1 --port 5173 --strictPort',
      url: 'http://localhost:5173',
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        VITE_API_BASE_URL: 'http://localhost:5173',
      },
    },
  ],
})
