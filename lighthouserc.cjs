const path = require('node:path')

const target =
  process.env.PERF_LHCI_SCENARIO === 'authenticated' ? 'authenticated' : 'login'
const baseUrl = process.env.LIGHTHOUSE_BASE_URL || 'http://localhost:4173'
const cookieHeader = process.env.PERF_LHCI_COOKIE_HEADER || ''

if (target === 'authenticated' && !cookieHeader) {
  throw new Error('PERF_LHCI_COOKIE_HEADER is required for the authenticated-shell run.')
}

module.exports = {
  ci: {
    collect: {
      // Settings exercises the complete authenticated shell and workspace
      // bootstrap without folding the chart-heavy dashboard into this gate.
      // NAV-01 owns dashboard rendering and click-readiness thresholds.
      url: [`${baseUrl}${target === 'authenticated' ? '/admin/settings' : '/login'}`],
      numberOfRuns: 3,
      settings: {
        onlyCategories: ['performance'],
        chromeFlags: '--headless --no-sandbox --disable-gpu',
        // The audit's authenticated-shell baseline used the production browser
        // without network emulation; preserve that protocol while Lighthouse
        // still supplies its mobile viewport and user agent. Login retains
        // Lighthouse's default simulated mobile network.
        ...(target === 'authenticated' ? { throttlingMethod: 'provided' } : {}),
        disableStorageReset: target === 'authenticated',
        ...(target === 'authenticated'
          ? { extraHeaders: JSON.stringify({ Cookie: cookieHeader }) }
          : {}),
      },
    },
    assert: {
      assertions: {
        'largest-contentful-paint': [
          'error',
          { maxNumericValue: 2500, aggregationMethod: 'median' },
        ],
        'cumulative-layout-shift': [
          'error',
          { maxNumericValue: 0.1, aggregationMethod: 'median' },
        ],
        'total-blocking-time': [
          'error',
          { maxNumericValue: 200, aggregationMethod: 'median' },
        ],
      },
    },
    upload: {
      target: 'filesystem',
      outputDir: path.resolve('.lighthouseci', target),
    },
  },
}
