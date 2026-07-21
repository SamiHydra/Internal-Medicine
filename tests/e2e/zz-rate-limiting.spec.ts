import { test, expect } from '@playwright/test'
import { anonContext, ajaxHeaders, xsrfToken } from './helpers/api'
import { ACCOUNTS } from './helpers/accounts'

/**
 * Runs LAST (zz- prefix): it deliberately exhausts the login limiter
 * (throttle:10,1), so no login-dependent spec may run after it.
 *
 * Verifies brute-force protection: repeated bad logins eventually return 429.
 */
test.describe('Rate limiting', () => {
  test('repeated failed logins are throttled (429)', async () => {
    const ctx = await anonContext()
    const token = await xsrfToken(ctx)
    const statuses: number[] = []
    for (let i = 0; i < 15; i++) {
      const res = await ctx.post('/api/auth/login', {
        headers: ajaxHeaders(token),
        data: { identifier: ACCOUNTS.superadmin.identifier, password: `definitely-wrong-${i}` },
      })
      statuses.push(res.status())
      if (res.status() === 429) break
    }
    expect(statuses, `statuses observed: ${statuses.join(',')}`).toContain(429)
    // Everything before the 429 should be a clean auth rejection, never a 5xx.
    expect(statuses.every((s) => s < 500)).toBeTruthy()
    await ctx.dispose()
  })
})
