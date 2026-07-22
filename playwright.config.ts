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

/**
 * Specs worth re-running across Firefox and WebKit. These exercise real
 * rendering/interaction where an engine difference could bite. Purely API-level
 * or engine-specific specs (permissions, api, security-smoke, performance,
 * accessibility, regression stability, zz-rate-limiting) stay chromium-only:
 * they build their own APIRequestContexts from the shared .auth state or
 * measure chromium-specific numbers, so triplicating them buys nothing.
 * Referencing not-yet-authored spec files is harmless - the regex simply
 * matches nothing until the file exists.
 */
const CROSS_BROWSER_UI: RegExp[] = [
  /auth\.spec\.ts/,
  /navigation\.spec\.ts/,
  /dashboard\.spec\.ts/,
  /workspace\.spec\.ts/,
  /forms\.spec\.ts/,
  /tables\.spec\.ts/,
  /v2-role-workflows\.spec\.ts/,
  /registration-approval\.spec\.ts/,
  /clinical-report-lifecycle\.spec\.ts/,
  /academic-evaluation-submit\.spec\.ts/,
]

/**
 * Specs run at mobile (390x844) and tablet (820x1180) viewports to satisfy the
 * "desktop AND mobile viewport coverage" requirement. Kept small: the shell,
 * navigation, dashboards, the workspace switcher, and the dedicated responsive
 * spec - the surfaces where layout actually reflows.
 */
const RESPONSIVE_UI: RegExp[] = [
  /navigation\.spec\.ts/,
  /dashboard\.spec\.ts/,
  /workspace\.spec\.ts/,
  /responsive\.spec\.ts/,
]

/**
 * The extra cross-browser and responsive projects only run when explicitly
 * opted in (E2E_ALL_BROWSERS=1). run-e2e.mjs invokes `playwright test` with no
 * --project filter, and CI installs the chromium binary only, so leaving these
 * on by default would make CI's e2e job fail trying to launch Firefox/WebKit it
 * never downloaded. Locally: `E2E_ALL_BROWSERS=1 npm run test:e2e`.
 */
const allBrowsers = process.env.E2E_ALL_BROWSERS === '1'

const crossBrowserProjects = [
  {
    // Cross-engine confidence for critical UI workflows only (Gecko).
    name: 'firefox',
    use: { ...devices['Desktop Firefox'], viewport: { width: 1920, height: 1080 } },
    dependencies: ['setup'],
    testMatch: CROSS_BROWSER_UI,
  },
  {
    // Cross-engine confidence for critical UI workflows only (Safari/WebKit).
    name: 'webkit',
    use: { ...devices['Desktop Safari'], viewport: { width: 1920, height: 1080 } },
    dependencies: ['setup'],
    testMatch: CROSS_BROWSER_UI,
  },
  {
    // Mobile phone: real Pixel 5 profile (393x851, touch, mobile UA).
    name: 'mobile-chrome',
    use: { ...devices['Pixel 5'] },
    dependencies: ['setup'],
    testMatch: RESPONSIVE_UI,
  },
  {
    // Tablet portrait (~820x1180) with touch, on the chromium engine.
    name: 'tablet',
    use: {
      ...devices['Desktop Chrome'],
      viewport: { width: 820, height: 1180 },
      hasTouch: true,
    },
    dependencies: ['setup'],
    testMatch: RESPONSIVE_UI,
  },
]

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
      // The merge-gate baseline: runs the ENTIRE suite at desktop width. This is
      // the only project CI runs (it installs the chromium binary only).
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1920, height: 1080 } },
      dependencies: ['setup'],
      // auth.setup runs in the 'setup' project; exclude it here.
      testIgnore: /auth\.setup\.ts/,
    },
    // Firefox/WebKit/mobile/tablet only when E2E_ALL_BROWSERS=1 (see note above).
    ...(allBrowsers ? crossBrowserProjects : []),
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
