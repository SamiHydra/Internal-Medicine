import { defineConfig } from '@playwright/test'

/**
 * Production smoke suite (`npm run test:smoke`).
 *
 * A small, fast, API-level gate to run immediately after a deployment against
 * the real host. It starts no servers, seeds nothing and needs no browser
 * binary: every check is an HTTP request, so it runs on a server that has only
 * Node installed. See tests/smoke/production-smoke.spec.ts for the checks and
 * docs/PRODUCTION_LAUNCH_CHECKLIST.md for the environment variables.
 */
export default defineConfig({
  testDir: './tests/smoke',
  outputDir: './test-results-smoke',
  workers: 1,
  fullyParallel: false,
  forbidOnly: true,
  // One retry: a deployment smoke test must not fail on a single cold-start
  // hiccup, but it must not paper over a real fault either.
  retries: 1,
  timeout: 30_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['json', { outputFile: './test-results-smoke/results.json' }]],
  use: {
    baseURL: (process.env.SMOKE_BASE_URL ?? 'http://localhost:5173').replace(/\/+$/, ''),
    ignoreHTTPSErrors: true,
    extraHTTPHeaders: { Accept: 'application/json' },
  },
})
