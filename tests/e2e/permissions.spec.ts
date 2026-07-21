import { test, expect, type APIRequestContext } from '@playwright/test'
import { authFile } from './helpers/auth'
import { apiContextFromState, ajaxHeaders, xsrfToken } from './helpers/api'
import { QA_MARKER } from './helpers/accounts'

/**
 * Authorization is the highest-risk area for a medical/PII app. We verify the
 * SERVER enforces the role->permission matrix (not just the frontend hiding UI),
 * that low-privilege roles get 403 on privileged endpoints, that privilege
 * escalation is impossible, and that object-level access (IDOR) is gated.
 *
 * Ground truth: backend/app/Support/Authorization/Permissions.php
 *   nurse      -> reports.viewAssigned, reports.submit, notifications.view, accessRequests.create
 *   resident   -> academic.submit
 *   consultant -> academic.submit
 *   admin      -> everything except admins.manage & templates.editStructure
 *   superadmin -> everything
 */

// ---------------------------------------------------------------------------
// Frontend route guards: a role hitting a route outside its allow-list must be
// redirected to its own landing, never shown the restricted page.
// ---------------------------------------------------------------------------
test.describe('Frontend route guards (direct URL access)', () => {
  const cases: { role: 'nurse' | 'resident' | 'consultant'; target: string; landing: RegExp }[] = [
    { role: 'nurse', target: '/admin', landing: /\/nurse/ },
    { role: 'nurse', target: '/admin/users', landing: /\/nurse/ },
    { role: 'nurse', target: '/admin/settings', landing: /\/nurse/ },
    { role: 'nurse', target: '/academic', landing: /\/nurse/ },
    { role: 'resident', target: '/admin', landing: /\/academic/ },
    { role: 'resident', target: '/admin/users', landing: /\/academic/ },
    { role: 'resident', target: '/nurse', landing: /\/academic/ },
    { role: 'consultant', target: '/admin/settings', landing: /\/academic/ },
  ]

  for (const c of cases) {
    test(`${c.role} cannot open ${c.target}`, async ({ browser }) => {
      const ctx = await browser.newContext({ storageState: authFile(c.role) })
      const page = await ctx.newPage()
      await page.goto(c.target)
      await expect(page).toHaveURL(c.landing, { timeout: 15_000 })
      await ctx.close()
    })
  }
})

// ---------------------------------------------------------------------------
// Backend authorization matrix: the API must reject privileged calls by roles
// that lack the permission, regardless of what the UI shows.
// ---------------------------------------------------------------------------
test.describe('Backend authorization enforcement', () => {
  let nurse: APIRequestContext
  let resident: APIRequestContext
  let consultant: APIRequestContext
  let admin: APIRequestContext
  let superadmin: APIRequestContext

  test.beforeAll(async () => {
    nurse = await apiContextFromState('nurse')
    resident = await apiContextFromState('resident')
    consultant = await apiContextFromState('consultant')
    admin = await apiContextFromState('superadmin') // superadmin acts as our admin-capable ctx
    superadmin = await apiContextFromState('superadmin')
  })
  test.afterAll(async () => {
    await Promise.all([nurse, resident, consultant, admin, superadmin].map((c) => c?.dispose()))
  })

  // --- nurse: forbidden privileged endpoints (expect 403) ---
  const nurseForbidden = [
    '/api/admin/users',
    '/api/admin/settings',
    '/api/admin/audit-logs',
    '/api/admin/action-items',
    '/api/admin/reports/import-template',
    '/api/analytics/overview',
    '/api/academic/analytics/summary',
    '/api/admin/academic/evaluations',
  ]
  for (const path of nurseForbidden) {
    test(`nurse GET ${path} -> 403`, async () => {
      const res = await nurse.get(path, { headers: ajaxHeaders() })
      expect(res.status(), `${path} returned ${res.status()}`).toBe(403)
    })
  }

  test('nurse POST /api/admin/users -> 403 (cannot create users)', async () => {
    const token = await xsrfToken(nurse)
    const res = await nurse.post('/api/admin/users', {
      headers: ajaxHeaders(token),
      data: { full_name: `${QA_MARKER} x`, email: `qa+block@stpaul.local`, password: 'Password123!', role_key: 'nurse' },
    })
    expect(res.status()).toBe(403)
  })

  // --- resident / consultant: only academic.submit ---
  test('resident GET /api/admin/users -> 403', async () => {
    expect((await resident.get('/api/admin/users', { headers: ajaxHeaders() })).status()).toBe(403)
  })
  test('resident GET /api/analytics/overview -> 403', async () => {
    expect((await resident.get('/api/analytics/overview', { headers: ajaxHeaders() })).status()).toBe(403)
  })
  test('resident GET /api/academic/analytics/summary -> 403 (submit != view)', async () => {
    expect((await resident.get('/api/academic/analytics/summary', { headers: ajaxHeaders() })).status()).toBe(403)
  })
  test('consultant GET /api/academic/analytics/summary -> 403', async () => {
    expect((await consultant.get('/api/academic/analytics/summary', { headers: ajaxHeaders() })).status()).toBe(403)
  })

  // --- positive checks: roles CAN reach what they should (matrix isn't just "deny all") ---
  test('nurse CAN reach /api/workspace and /api/notifications', async () => {
    expect((await nurse.get('/api/workspace', { headers: ajaxHeaders() })).status()).toBe(200)
    expect((await nurse.get('/api/notifications', { headers: ajaxHeaders() })).status()).toBe(200)
  })
  test('resident CAN reach academic submit-side endpoints', async () => {
    expect((await resident.get('/api/academic/my-performance', { headers: ajaxHeaders() })).status()).toBe(200)
    expect((await resident.get('/api/academic/form-options', { headers: ajaxHeaders() })).status()).toBe(200)
  })
  test('admin CAN reach users / analytics / settings / academic view', async () => {
    expect((await admin.get('/api/admin/users', { headers: ajaxHeaders() })).status()).toBe(200)
    expect((await admin.get('/api/analytics/overview', { headers: ajaxHeaders() })).status()).toBe(200)
    expect((await admin.get('/api/admin/settings', { headers: ajaxHeaders() })).status()).toBe(200)
    expect((await admin.get('/api/academic/analytics/summary', { headers: ajaxHeaders() })).status()).toBe(200)
  })
})

// ---------------------------------------------------------------------------
// Privilege escalation must be impossible.
// ---------------------------------------------------------------------------
test.describe('Privilege escalation guards', () => {
  test('cannot create a superadmin via the user API (validation blocks role)', async () => {
    const ctx = await apiContextFromState('superadmin')
    const token = await xsrfToken(ctx)
    const res = await ctx.post('/api/admin/users', {
      headers: ajaxHeaders(token),
      data: {
        full_name: `${QA_MARKER} escalate`,
        email: 'qa+escalate@stpaul.local',
        password: 'password123',
        role_key: 'superadmin',
      },
    })
    // role_key is validated Rule::in(['admin','nurse']); 'superadmin' is rejected.
    expect(res.status()).toBe(422)
    await ctx.dispose()
  })

  test('a superadmin account cannot be deactivated (Maintenance lockout protection)', async () => {
    const sa = await apiContextFromState('superadmin')
    // Find the superadmin user id from the user list.
    const list = await sa.get('/api/admin/users', { headers: ajaxHeaders() })
    expect(list.ok()).toBeTruthy()
    const body = await list.json()
    const users: Array<{ id: string; role?: string; roleKey?: string; role_key?: string }> = body.data ?? body
    const superRow = users.find((u) => (u.role ?? u.roleKey ?? u.role_key) === 'superadmin')
    expect(superRow, 'expected a superadmin row in the user list').toBeTruthy()
    const token = await xsrfToken(sa)
    const res = await sa.patch(`/api/admin/users/${superRow!.id}/active`, {
      headers: ajaxHeaders(token),
      data: { active: false },
    })
    expect(res.status(), 'deactivating a superadmin must be forbidden').toBe(403)
    await sa.dispose()
  })
})

// ---------------------------------------------------------------------------
// IDOR: object-level access control on reports (Gate::authorize('view')).
// ---------------------------------------------------------------------------
test.describe('IDOR / object-level access', () => {
  test('a nurse cannot read another nurse\'s report by id', async () => {
    const sa = await apiContextFromState('superadmin')
    const nurse = await apiContextFromState('nurse')
    // Admin sees all reports; grab any report id that exists.
    const all = await sa.get('/api/reports', { headers: ajaxHeaders() })
    const allBody = await all.json()
    const reports: Array<{ id: string; assignmentId?: string }> = allBody.data ?? []

    // Find a report NOT owned by the test nurse: list the nurse's own reports.
    const mine = await nurse.get('/api/reports', { headers: ajaxHeaders() })
    const mineIds = new Set(((await mine.json()).data ?? []).map((r: { id: string }) => r.id))
    const foreign = reports.find((r) => !mineIds.has(r.id))

    test.skip(!foreign, 'No report owned by another user is seeded; IDOR check needs manual data setup.')
    const res = await nurse.get(`/api/reports/${foreign!.id}`, { headers: ajaxHeaders() })
    expect([403, 404], `expected denial, got ${res.status()}`).toContain(res.status())
    await sa.dispose()
    await nurse.dispose()
  })
})
