import { test, expect, request as pwRequest } from '@playwright/test'
import { authFile } from './helpers/auth'
import { apiContextFromState, anonContext, apiLoginRaw, ajaxHeaders, xsrfToken } from './helpers/api'
import { QA_MARKER } from './helpers/accounts'

const BACKEND = 'http://127.0.0.1:8000'

test.describe('Security headers', () => {
  test('API responses carry hardening headers', async () => {
    const ctx = await anonContext()
    const res = await ctx.get('/api/workspace', { headers: ajaxHeaders() }) // 401, but headers still set
    const h = res.headers()
    expect(h['x-content-type-options']).toBe('nosniff')
    expect(h['x-frame-options']).toBe('DENY')
    expect(h['referrer-policy']).toContain('strict-origin')
    expect(h['content-security-policy'] ?? '').toContain("default-src 'self'")
    expect(h['permissions-policy'] ?? '').toMatch(/camera|geolocation/)
    await ctx.dispose()
  })
})

test.describe('Cookie flags (Sanctum SPA session)', () => {
  test.use({ storageState: authFile('superadmin') })

  test('session cookie is HttpOnly; XSRF token is readable; SameSite set', async ({ page, context }, testInfo) => {
    await page.goto('/admin')
    await expect(page.getByRole('button', { name: 'Sign out' }).first()).toBeVisible()
    const cookies = await context.cookies()
    const xsrf = cookies.find((c) => c.name === 'XSRF-TOKEN')
    const session = cookies.find((c) => c.name !== 'XSRF-TOKEN' && c.httpOnly)

    expect(session, 'expected an HttpOnly session cookie').toBeTruthy()
    expect(session!.sameSite, 'session SameSite').toMatch(/Lax|Strict/)
    // XSRF-TOKEN is intentionally JS-readable (double-submit pattern).
    expect(xsrf, 'expected an XSRF-TOKEN cookie').toBeTruthy()
    expect(xsrf!.httpOnly).toBeFalsy()
    // Secure is correctly false on local HTTP. config/session.php defaults it to
    // true when APP_ENV=production, so this is a local-vs-prod config note, not a
    // defect - record the local value rather than failing the gate.
    testInfo.annotations.push({
      type: 'prod-config (local-vs-prod)',
      description: `session cookie Secure=${session!.secure} on local HTTP; forced true in production via config/session.php`,
    })
  })
})

test.describe('Sensitive file exposure (backend public root)', () => {
  test('.env, .git, and logs are not served', async () => {
    const ctx = await pwRequest.newContext({ baseURL: BACKEND })
    for (const path of ['/.env', '/.git/config', '/storage/logs/laravel.log', '/composer.json', '/.env.bak']) {
      const res = await ctx.get(path)
      expect([403, 404], `${path} returned ${res.status()}`).toContain(res.status())
    }
    await ctx.dispose()
  })
})

test.describe('XSS - reflected input is escaped, not executed', () => {
  test.use({ storageState: authFile('superadmin') })

  test('a script payload in user search renders as inert text', async ({ page }) => {
    let dialogFired = false
    page.on('dialog', async (d) => {
      dialogFired = true
      await d.dismiss().catch(() => {})
    })
    await page.goto('/admin/users')
    await expect(page.getByRole('button', { name: 'Sign out' }).first()).toBeVisible()
    const payload = '<img src=x onerror="window.__xss_fired=true">'
    await page.getByPlaceholder('Search name or email').fill(payload)
    await page.waitForTimeout(1200)
    const fired = await page.evaluate(() => (window as unknown as { __xss_fired?: boolean }).__xss_fired === true)
    expect(fired, 'onerror handler executed -> XSS').toBeFalsy()
    expect(dialogFired, 'a dialog fired -> script executed').toBeFalsy()
    // The literal payload should be visible as escaped text in the empty state.
    await expect(page.getByText(payload, { exact: false })).toBeVisible({ timeout: 5000 })
  })
})

test.describe('Session lifecycle - password change vs other sessions (HIGH live-verify)', () => {
  test('changing password should invalidate other sessions', async () => {
    const sa = await apiContextFromState('superadmin')
    const token = await xsrfToken(sa)
    const email = 'qa.session.donotdeploy@stpaul.local'

    // Ensure a fresh, active QA user with a known password (create or reset).
    const created = await sa.post('/api/admin/users', {
      headers: ajaxHeaders(token),
      data: { full_name: `${QA_MARKER} Session`, email, password: 'Password123!', role_key: 'nurse', password_change_required: false, active: true },
    })
    let id: string | undefined
    if (created.status() === 201) {
      id = (await created.json()).id
    } else {
      const found = await sa.get(`/api/admin/users?q=${encodeURIComponent(email)}`, { headers: ajaxHeaders() })
      id = ((await found.json()).data ?? [])[0]?.id
      if (id) {
        await sa.patch(`/api/admin/users/${id}/active`, { headers: ajaxHeaders(token), data: { active: true } })
        await sa.post(`/api/admin/users/${id}/reset-password`, { headers: ajaxHeaders(token), data: { password: 'Password123!', password_change_required: false } })
      }
    }

    // Two independent sessions for the QA user.
    const ctxA = await apiLoginRaw(email, 'Password123!')
    const ctxB = await apiLoginRaw(email, 'Password123!')
    expect((await ctxB.get('/api/auth/me', { headers: ajaxHeaders() })).status()).toBe(200)

    // Change the password in session A.
    const tokenA = await xsrfToken(ctxA)
    const change = await ctxA.post('/api/auth/change-password', {
      headers: ajaxHeaders(tokenA),
      data: { current_password: 'Password123!', password: 'newPassw0rd!', password_confirmation: 'newPassw0rd!' },
    })
    expect(change.ok(), `change-password failed: ${change.status()}`).toBeTruthy()

    // Session B SHOULD now be invalid. (Static analysis says it is NOT - this
    // soft assertion documents the gap as a finding.)
    const meB = await ctxB.get('/api/auth/me', { headers: ajaxHeaders() })
    console.log(`SESSION_REVOCATION_CHECK change=${change.status()} meB_after_change=${meB.status()}`)
    expect.soft(meB.status(), `other session still valid after password change (status ${meB.status()})`).toBe(401)

    // Cleanup: deactivate the QA user.
    if (id) await sa.patch(`/api/admin/users/${id}/active`, { headers: ajaxHeaders(token), data: { active: false } })
    await Promise.all([sa.dispose(), ctxA.dispose(), ctxB.dispose()])
  })
})
