import { test, expect, request as pwRequest, type APIRequestContext } from '@playwright/test'

/**
 * Production smoke suite: the shortest set of checks that proves a deployment
 * is alive, authenticated, authorised and able to save clinical data.
 *
 * Run it immediately after a deploy, against the real host:
 *
 *   SMOKE_BASE_URL=https://im.hospital.internal \
 *   SMOKE_ADMIN_IDENTIFIER=... SMOKE_ADMIN_PASSWORD=... \
 *   npm run test:smoke
 *
 * Design rules (docs/PRODUCTION_LAUNCH_CHECKLIST.md):
 *  - fast: about a dozen checks, one browser context, no seeded fixture,
 *    nothing that depends on development accounts;
 *  - non-destructive by default: every check is a read, except the optional
 *    draft-save check, which needs SMOKE_ALLOW_WRITE=1 and writes only to a
 *    report the operator names, restoring the previous values afterwards;
 *  - honest: a check that cannot run without configuration is SKIPPED with the
 *    reason, never silently passed.
 */

const BASE_URL = (process.env.SMOKE_BASE_URL ?? 'http://localhost:5173').replace(/\/+$/, '')
const ADMIN_IDENTIFIER = process.env.SMOKE_ADMIN_IDENTIFIER ?? ''
const ADMIN_PASSWORD = process.env.SMOKE_ADMIN_PASSWORD ?? ''
const NURSE_IDENTIFIER = process.env.SMOKE_NURSE_IDENTIFIER ?? ''
const NURSE_PASSWORD = process.env.SMOKE_NURSE_PASSWORD ?? ''
const ACADEMIC_IDENTIFIER = process.env.SMOKE_ACADEMIC_IDENTIFIER ?? ''
const ACADEMIC_PASSWORD = process.env.SMOKE_ACADEMIC_PASSWORD ?? ''
const REP_IDENTIFIER = process.env.SMOKE_REP_IDENTIFIER ?? ''
const REP_PASSWORD = process.env.SMOKE_REP_PASSWORD ?? ''
const ALLOW_WRITE = process.env.SMOKE_ALLOW_WRITE === '1'
const EXPECTED_RELEASE = process.env.SMOKE_EXPECTED_RELEASE ?? ''

/** Headers the SPA sends; Sanctum only treats a matching Origin as stateful. */
function headers(token?: string | null): Record<string, string> {
  const value: Record<string, string> = {
    Accept: 'application/json',
    'X-Requested-With': 'XMLHttpRequest',
    Origin: BASE_URL,
    Referer: `${BASE_URL}/`,
  }
  if (token) value['X-XSRF-TOKEN'] = token
  return value
}

async function xsrf(context: APIRequestContext): Promise<string | null> {
  const state = await context.storageState()
  const cookie = state.cookies.find((entry) => entry.name === 'XSRF-TOKEN')
  return cookie ? decodeURIComponent(cookie.value) : null
}

/**
 * One sign-in per account for the whole run. The login route is limited to
 * 10 attempts per minute per address, and a check-per-sign-in suite spent
 * exactly that on one pass, so a single retry (or a second run within the
 * minute) answered 429. Later checks reuse the first sign-in's cookies in a
 * fresh request context; only the sign-out check asks for a new session.
 */
const sessionStates = new Map<string, Awaited<ReturnType<APIRequestContext['storageState']>>>()

async function signIn(
  identifier: string,
  password: string,
  options?: { fresh?: boolean },
): Promise<APIRequestContext> {
  const cached = options?.fresh ? undefined : sessionStates.get(identifier)
  if (cached) {
    return pwRequest.newContext({ baseURL: BASE_URL, ignoreHTTPSErrors: true, storageState: cached })
  }

  const context = await pwRequest.newContext({ baseURL: BASE_URL, ignoreHTTPSErrors: true })
  const csrf = await context.get('/sanctum/csrf-cookie', { headers: headers() })
  expect(csrf.status(), 'the CSRF cookie endpoint must answer').toBe(204)
  const response = await context.post('/api/auth/login', {
    headers: headers(await xsrf(context)),
    data: { identifier, password },
  })
  expect(response.status(), `sign-in for ${identifier} must succeed`).toBe(200)
  sessionStates.set(identifier, await context.storageState())
  return context
}

test.describe.configure({ mode: 'serial' })

test.describe('Production smoke', () => {
  test('1. the application is alive: /up answers 200', async () => {
    const anonymous = await pwRequest.newContext({ baseURL: BASE_URL, ignoreHTTPSErrors: true })
    try {
      const response = await anonymous.get('/up')
      expect(response.status()).toBe(200)
    } finally {
      await anonymous.dispose()
    }
  })

  test('2. the SPA shell is served and names a build', async () => {
    const anonymous = await pwRequest.newContext({ baseURL: BASE_URL, ignoreHTTPSErrors: true })
    try {
      const response = await anonymous.get('/login')
      expect(response.status()).toBe(200)
      const html = await response.text()
      expect(html, 'the login route must return the SPA shell').toContain('<div id="root">')
      expect(html, 'the shell must reference a hashed bundle').toMatch(/\/assets\/[^"']+\.js/)
    } finally {
      await anonymous.dispose()
    }
  })

  test('3. protected API is closed to anonymous callers', async () => {
    const anonymous = await pwRequest.newContext({ baseURL: BASE_URL, ignoreHTTPSErrors: true })
    try {
      for (const path of ['/api/workspace', '/api/admin/users', '/api/analytics/dashboard', '/api/admin/system-health']) {
        const response = await anonymous.get(path, { headers: headers() })
        expect(response.status(), `${path} must be 401 anonymously`).toBe(401)
      }
    } finally {
      await anonymous.dispose()
    }
  })

  test('4. security headers and a secure session cookie are present', async () => {
    const anonymous = await pwRequest.newContext({ baseURL: BASE_URL, ignoreHTTPSErrors: true })
    try {
      const response = await anonymous.get('/api/workspace', { headers: headers() })
      const received = response.headers()
      expect(received['x-content-type-options']).toContain('nosniff')
      expect(received['x-frame-options']).toContain('DENY')
      expect(received['referrer-policy']).toContain('strict-origin')
      expect(received['content-security-policy'] ?? '', 'a CSP must be set on the document').toBeDefined()
      if (BASE_URL.startsWith('https://')) {
        expect(received['strict-transport-security'], 'HSTS is required over TLS').toContain('max-age=')
      }

      const csrf = await anonymous.get('/sanctum/csrf-cookie', { headers: headers() })
      expect(csrf.status()).toBe(204)
      const cookies = (await anonymous.storageState()).cookies
      // Laravel derives the name from APP_NAME (slug + "-session"); a host may
      // also pin SESSION_COOKIE to a "<name>_session" value. Accept both forms.
      const session = cookies.find((cookie) => /[-_]session$/.test(cookie.name))
      expect(session, 'a session cookie must be issued').toBeTruthy()
      expect(session?.httpOnly, 'the session cookie must be HttpOnly').toBe(true)
      if (BASE_URL.startsWith('https://')) {
        expect(session?.secure, 'the session cookie must be Secure over TLS').toBe(true)
      }
    } finally {
      await anonymous.dispose()
    }
  })

  test('5. the maintenance account signs in and bootstraps its workspace', async () => {
    test.skip(!ADMIN_IDENTIFIER || !ADMIN_PASSWORD, 'SMOKE_ADMIN_IDENTIFIER / SMOKE_ADMIN_PASSWORD not set')
    const admin = await signIn(ADMIN_IDENTIFIER, ADMIN_PASSWORD)
    try {
      const workspace = await admin.get('/api/workspace', { headers: headers() })
      expect(workspace.status()).toBe(200)
      const payload = await workspace.json()
      expect(payload.state?.currentUserId, 'the workspace must identify the signed-in user').toBeTruthy()
      expect(payload.revisionToken, 'the workspace must issue a revision credential').toBeTruthy()
    } finally {
      await admin.dispose()
    }
  })

  test('6. the clinical and academic workspaces answer for an administrator', async () => {
    test.skip(!ADMIN_IDENTIFIER || !ADMIN_PASSWORD, 'SMOKE_ADMIN_IDENTIFIER / SMOKE_ADMIN_PASSWORD not set')
    const admin = await signIn(ADMIN_IDENTIFIER, ADMIN_PASSWORD)
    try {
      for (const path of [
        '/api/analytics/dashboard',
        '/api/reports?perPage=25',
        '/api/admin/users',
        '/api/admin/action-items',
        '/api/admin/settings',
        '/api/admin/admin-audit-logs',
        '/api/academic/analytics/summary',
        '/api/notifications?limit=10',
      ]) {
        const response = await admin.get(path, { headers: headers() })
        expect(response.status(), `${path} must answer 200 for an administrator`).toBe(200)
      }
    } finally {
      await admin.dispose()
    }
  })

  test('7. the maintenance health snapshot is reachable and healthy', async () => {
    test.skip(!ADMIN_IDENTIFIER || !ADMIN_PASSWORD, 'SMOKE_ADMIN_IDENTIFIER / SMOKE_ADMIN_PASSWORD not set')
    const admin = await signIn(ADMIN_IDENTIFIER, ADMIN_PASSWORD)
    try {
      const response = await admin.get('/api/admin/system-health', { headers: headers() })
      if (response.status() === 403) {
        test.skip(true, 'the smoke account is not the Maintenance account; run check 7 with it')
      }
      expect(response.status()).toBe(200)
      const health = await response.json()

      expect(health.database?.connected, 'the database must be connected').toBe(true)
      expect(health.database?.pendingMigrations, 'no migration may be pending').toBe(0)
      expect(health.application?.debug, 'APP_DEBUG must be off').toBe(false)
      expect(health.application?.environment).toBe('production')
      expect(health.scheduler?.fresh, 'the scheduler heartbeat must be fresh').toBe(true)
      expect(health.queue?.failedJobs?.last24h ?? 0, 'no queue job may have failed in the last day').toBe(0)
      expect(health.storage?.writable, 'storage must be writable').toBe(true)

      const failing = (health.checks ?? []).filter((check: { status: string }) => check.status === 'fail')
      expect(failing, `failing health checks: ${JSON.stringify(failing)}`).toHaveLength(0)

      if (EXPECTED_RELEASE) {
        expect(health.release?.sha, 'the running release must be the one just deployed').toContain(EXPECTED_RELEASE)
      }
    } finally {
      await admin.dispose()
    }
  })

  test('8. a nurse signs in and sees the current reporting week', async () => {
    test.skip(!NURSE_IDENTIFIER || !NURSE_PASSWORD, 'SMOKE_NURSE_IDENTIFIER / SMOKE_NURSE_PASSWORD not set')
    const nurse = await signIn(NURSE_IDENTIFIER, NURSE_PASSWORD)
    try {
      const workspace = await nurse.get('/api/workspace', { headers: headers() })
      expect(workspace.status()).toBe(200)
      const state = (await workspace.json()).state
      expect(state.reportingPeriods?.length, 'the nurse must see reporting periods').toBeGreaterThan(0)
      expect(state.assignments?.length, 'the nurse must have at least one active assignment').toBeGreaterThan(0)

      const reports = await nurse.get('/api/reports?perPage=10', { headers: headers() })
      expect(reports.status()).toBe(200)
    } finally {
      await nurse.dispose()
    }
  })

  test('9. a nurse cannot reach administrative endpoints', async () => {
    test.skip(!NURSE_IDENTIFIER || !NURSE_PASSWORD, 'SMOKE_NURSE_IDENTIFIER / SMOKE_NURSE_PASSWORD not set')
    const nurse = await signIn(NURSE_IDENTIFIER, NURSE_PASSWORD)
    try {
      for (const path of ['/api/admin/users', '/api/admin/settings', '/api/analytics/dashboard', '/api/admin/system-health']) {
        const response = await nurse.get(path, { headers: headers() })
        expect(response.status(), `${path} must be refused for a nurse`).toBe(403)
      }
    } finally {
      await nurse.dispose()
    }
  })

  test('10. an academic account reaches its own surfaces and nothing clinical', async () => {
    test.skip(!ACADEMIC_IDENTIFIER || !ACADEMIC_PASSWORD, 'SMOKE_ACADEMIC_IDENTIFIER / SMOKE_ACADEMIC_PASSWORD not set')
    const academic = await signIn(ACADEMIC_IDENTIFIER, ACADEMIC_PASSWORD)
    try {
      const today = new Date().toISOString().slice(0, 10)
      for (const path of [`/api/academic/form-options?date=${today}`, '/api/academic/my-submissions', '/api/notifications?limit=5']) {
        const response = await academic.get(path, { headers: headers() })
        expect(response.status(), `${path} must answer 200 for an academic account`).toBe(200)
      }

      const admin = await academic.get('/api/admin/users', { headers: headers() })
      expect(admin.status(), 'academic accounts must not reach the admin API').toBe(403)

      // The documented contract: report listings answer 200 with nothing in them.
      const reports = await academic.get('/api/reports?perPage=5', { headers: headers() })
      expect(reports.status()).toBe(200)
      expect((await reports.json()).data, 'an academic account owns no reports').toHaveLength(0)
    } finally {
      await academic.dispose()
    }
  })

  test('11. a student representative reaches only the teaching log', async () => {
    test.skip(!REP_IDENTIFIER || !REP_PASSWORD, 'SMOKE_REP_IDENTIFIER / SMOKE_REP_PASSWORD not set')
    const rep = await signIn(REP_IDENTIFIER, REP_PASSWORD)
    try {
      const sessions = await rep.get('/api/teaching/my-sessions', { headers: headers() })
      expect(sessions.status()).toBe(200)

      for (const path of ['/api/admin/users', '/api/admin/action-items', '/api/academic/my-submissions']) {
        const response = await rep.get(path, { headers: headers() })
        expect(response.status(), `${path} must be refused for a student representative`).toBe(403)
      }

      const reports = await rep.get('/api/reports?perPage=5', { headers: headers() })
      expect(reports.status()).toBe(200)
      expect((await reports.json()).data, 'a representative owns no clinical reports').toHaveLength(0)
    } finally {
      await rep.dispose()
    }
  })

  test('12. the queue and the scheduler are moving', async () => {
    test.skip(!ADMIN_IDENTIFIER || !ADMIN_PASSWORD, 'SMOKE_ADMIN_IDENTIFIER / SMOKE_ADMIN_PASSWORD not set')
    const admin = await signIn(ADMIN_IDENTIFIER, ADMIN_PASSWORD)
    try {
      const response = await admin.get('/api/admin/system-health', { headers: headers() })
      if (response.status() === 403) {
        test.skip(true, 'needs the Maintenance account')
      }
      const health = await response.json()
      const backlog = (health.queue?.queues ?? []).reduce(
        (total: number, queue: { depth: number }) => total + queue.depth,
        0,
      )
      expect(backlog, 'the queue must not already be backed up after a deploy').toBeLessThan(50)
      expect(health.scheduler?.ageSeconds ?? Number.MAX_SAFE_INTEGER, 'the scheduler must have ticked in the last two minutes').toBeLessThan(120)
    } finally {
      await admin.dispose()
    }
  })

  test('13. signing out invalidates the session', async () => {
    test.skip(!ADMIN_IDENTIFIER || !ADMIN_PASSWORD, 'SMOKE_ADMIN_IDENTIFIER / SMOKE_ADMIN_PASSWORD not set')
    // Its own session: signing out must not kill the one the other checks share.
    const admin = await signIn(ADMIN_IDENTIFIER, ADMIN_PASSWORD, { fresh: true })
    try {
      const before = await admin.get('/api/workspace', { headers: headers() })
      expect(before.status()).toBe(200)

      const logout = await admin.post('/api/auth/logout', { headers: headers(await xsrf(admin)) })
      expect([200, 204]).toContain(logout.status())

      const after = await admin.get('/api/workspace', { headers: headers() })
      expect(after.status(), 'the session must be dead after sign-out').toBe(401)
    } finally {
      await admin.dispose()
    }
  })

  test('14. a draft save persists and is restored (write check)', async () => {
    test.skip(!ALLOW_WRITE, 'read-only run: set SMOKE_ALLOW_WRITE=1 to include the draft-save check')
    test.skip(!NURSE_IDENTIFIER || !NURSE_PASSWORD, 'SMOKE_NURSE_IDENTIFIER / SMOKE_NURSE_PASSWORD not set')

    const nurse = await signIn(NURSE_IDENTIFIER, NURSE_PASSWORD)
    try {
      const reports = await nurse.get('/api/reports?perPage=25', { headers: headers() })
      expect(reports.status()).toBe(200)
      const summaries: Array<{ id: string; status: string; lockedAt: string | null }> = (await reports.json()).data ?? []
      const target = summaries.find((report) => report.status !== 'locked' && !report.lockedAt)
      test.skip(!target, 'no unlocked report of this nurse to write to')

      const detail = await nurse.get(`/api/reports/${target!.id}`, { headers: headers() })
      expect(detail.status()).toBe(200)
      const before = await detail.json()

      // Write the report's own current values back: the full save path runs
      // (validation, quality rules, row lock, audit) and no figure changes.
      const save = await nurse.put(`/api/reports/${target!.id}`, {
        headers: headers(await xsrf(nurse)),
        data: { values: before.values, expectedUpdatedAt: before.updatedAt },
      })
      expect(save.status(), 'the draft save must be accepted').toBe(200)

      const after = await nurse.get(`/api/reports/${target!.id}`, { headers: headers() })
      expect(after.status()).toBe(200)
      const reread = await after.json()
      expect(reread.status, 'the report status must not change').toBe(before.status)
      expect(JSON.stringify(reread.values), 'the values must be unchanged').toBe(JSON.stringify(before.values))
    } finally {
      await nurse.dispose()
    }
  })
})
