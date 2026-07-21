import { test, expect } from '@playwright/test'
import { apiContextFromState, anonContext, ajaxHeaders, xsrfToken } from './helpers/api'
import { QA_MARKER } from './helpers/accounts'

/** Recursively collect every object key name in a parsed JSON value. */
function collectKeys(value: unknown, out: Set<string> = new Set()): Set<string> {
  if (Array.isArray(value)) value.forEach((v) => collectKeys(v, out))
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      out.add(k)
      collectKeys(v, out)
    }
  }
  return out
}

test.describe('API: authentication required', () => {
  test('unauthenticated GET endpoints return 401 JSON (not 500/redirect)', async () => {
    const ctx = await anonContext()
    for (const path of ['/api/workspace', '/api/auth/me', '/api/notifications', '/api/admin/users']) {
      const res = await ctx.get(path, { headers: ajaxHeaders() })
      expect(res.status(), `${path} -> ${res.status()}`).toBe(401)
      expect(res.headers()['content-type'] ?? '').toContain('application/json')
    }
    await ctx.dispose()
  })

  test('unauthenticated POST is rejected (401), never executes', async () => {
    const ctx = await anonContext()
    const token = await xsrfToken(ctx)
    const res = await ctx.post('/api/reports', { headers: ajaxHeaders(token), data: {} })
    expect(res.status()).toBe(401)
    await ctx.dispose()
  })
})

test.describe('API: input validation & error codes', () => {
  test('POST /api/admin/users with missing fields -> 422 with field errors', async () => {
    const ctx = await apiContextFromState('superadmin')
    const token = await xsrfToken(ctx)
    const res = await ctx.post('/api/admin/users', { headers: ajaxHeaders(token), data: {} })
    expect(res.status()).toBe(422)
    const body = await res.json()
    expect(body).toHaveProperty('errors')
    await ctx.dispose()
  })

  test('invalid/unknown id -> 404 (not 500)', async () => {
    const ctx = await apiContextFromState('superadmin')
    const bogus = '00000000-0000-4000-8000-000000000000'
    expect((await ctx.get(`/api/admin/users/${bogus}`, { headers: ajaxHeaders() })).status()).toBe(404)
    expect((await ctx.get(`/api/reports/${bogus}`, { headers: ajaxHeaders() })).status()).toBe(404)
    await ctx.dispose()
  })

  test('malformed JSON body is handled gracefully (4xx, never 5xx)', async () => {
    const ctx = await anonContext()
    const token = await xsrfToken(ctx)
    const res = await ctx.post('/api/auth/login', {
      headers: { ...ajaxHeaders(token), 'Content-Type': 'application/json' },
      data: '{ this is : not valid json ',
    })
    expect(res.status(), `got ${res.status()}`).toBeLessThan(500)
    await ctx.dispose()
  })

  test('controlled CRUD: create a QA nurse, reject duplicate, then deactivate', async () => {
    const ctx = await apiContextFromState('superadmin')
    const token = await xsrfToken(ctx)
    const email = 'qa.crud.donotdeploy@stpaul.local'
    const payload = {
      full_name: `${QA_MARKER} CRUD Nurse`,
      email,
      password: 'Password123!',
      role_key: 'nurse',
    }
    const created = await ctx.post('/api/admin/users', { headers: ajaxHeaders(token), data: payload })
    // 201 created, or 422 if a previous run already created this email.
    expect([201, 422]).toContain(created.status())

    let id: string | undefined
    if (created.status() === 201) {
      id = (await created.json()).id
      // Duplicate email must be rejected.
      const dup = await ctx.post('/api/admin/users', { headers: ajaxHeaders(token), data: payload })
      expect(dup.status(), 'duplicate email should 422').toBe(422)
    } else {
      const found = await ctx.get(`/api/admin/users?q=${encodeURIComponent(email)}`, { headers: ajaxHeaders() })
      const list = (await found.json()).data ?? []
      id = list[0]?.id
    }

    // Clean up: soft-deactivate the QA record.
    if (id) {
      const del = await ctx.patch(`/api/admin/users/${id}/active`, { headers: ajaxHeaders(token), data: { active: false } })
      expect(del.ok()).toBeTruthy()
    }
    await ctx.dispose()
  })
})

test.describe('API: response shape does not leak secrets', () => {
  test('/api/auth/me never exposes password or token fields', async () => {
    const ctx = await apiContextFromState('superadmin')
    const res = await ctx.get('/api/auth/me', { headers: ajaxHeaders() })
    expect(res.ok()).toBeTruthy()
    const keys = collectKeys(await res.json())
    for (const forbidden of ['password', 'password_hash', 'remember_token', 'remember_token_hash']) {
      expect([...keys], `response exposed "${forbidden}"`).not.toContain(forbidden)
    }
    await ctx.dispose()
  })

  test('/api/admin/users list never exposes password/token fields', async () => {
    const ctx = await apiContextFromState('superadmin')
    const res = await ctx.get('/api/admin/users', { headers: ajaxHeaders() })
    const keys = collectKeys(await res.json())
    for (const forbidden of ['password', 'remember_token']) {
      expect([...keys]).not.toContain(forbidden)
    }
    await ctx.dispose()
  })
})

test.describe('API: response times (recorded for the perf report)', () => {
  test('key GET endpoints respond within a sane budget', async () => {
    const testInfo = test.info()
    const ctx = await apiContextFromState('superadmin')
    const endpoints = ['/api/workspace', '/api/analytics/overview', '/api/analytics/dashboard', '/api/admin/users']
    const timings: { path: string; ms: number; status: number }[] = []
    for (const path of endpoints) {
      const t0 = performance.now()
      const res = await ctx.get(path, { headers: ajaxHeaders() })
      const ms = Math.round(performance.now() - t0)
      timings.push({ path, ms, status: res.status() })
    }
    await testInfo.attach('api-timings.json', { body: JSON.stringify(timings, null, 2), contentType: 'application/json' })
    for (const t of timings) {
      expect(t.status, `${t.path} status`).toBeLessThan(400)
      // Catch only catastrophic slowness/hangs. The analytics dashboard COLD
      // build (~6s PHP aggregation) is a known, documented, non-blocking +
      // cached Medium (see PERFORMANCE_REPORT.md); warm it is ~260ms. The exact
      // numbers are recorded in the perf report, so this is a coarse health gate.
      expect(t.ms, `${t.path} took ${t.ms}ms`).toBeLessThan(9000)
    }
    await ctx.dispose()
  })
})
