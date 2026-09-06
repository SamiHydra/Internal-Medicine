import { test, expect, type APIRequestContext } from '@playwright/test'
import { apiContextFromState, apiLoginRaw, ajaxHeaders, xsrfToken, flushRateLimits } from './helpers/api'
import { QA_ACCOUNT_PASSWORD, QA_MARKER } from './helpers/accounts'

/**
 * Gap A.1 / risk-area #3: the true-admin (role_key='admin') vs superadmin
 * ("Maintenance") boundary. No seeder mints a plain admin (matrix prerequisite
 * P-1), so the whole existing suite's "admin" context is actually a superadmin
 * and this boundary is UNTESTED end to end. This spec mints a real admin in
 * flight and pins the EXACT permission delta the two roles differ by.
 *
 * Ground truth (backend/app/Support/Authorization/Permissions.php):
 *   superadmin = admin + { admins.manage, templates.editStructure,
 *                          evaluationForms.editStructure }
 * and nothing else. Every assertion below is confirmed against the SERVER (the
 * API), not the SPA, per the brief.
 */

type UserRow = { id: string; role?: string; active?: boolean }

const ADMIN_A = {
  email: 'qa.admin.boundary.a.donotdeploy@stpaul.local',
  username: 'qa_admin_boundary_a',
  fullName: `${QA_MARKER} Boundary Admin A`,
}
const ADMIN_B = {
  email: 'qa.admin.boundary.b.donotdeploy@stpaul.local',
  username: 'qa_admin_boundary_b',
  fullName: `${QA_MARKER} Boundary Admin B`,
}

/** The three permissions a superadmin has that a plain admin must not. */
const SUPERADMIN_ONLY = ['admins.manage', 'evaluationForms.editStructure', 'templates.editStructure']

/**
 * Create a role_key='admin' user via the superadmin API and return its id. On a
 * dirty rerun (the e2e DB is normally recreated fresh, so 201 is the norm) it
 * recovers the existing row and re-arms it for an immediate password login.
 */
async function ensureAdmin(
  superadmin: APIRequestContext,
  spec: { email: string; username: string; fullName: string },
): Promise<string> {
  const token = await xsrfToken(superadmin)
  const created = await superadmin.post('/api/admin/users', {
    headers: ajaxHeaders(token),
    data: {
      fullName: spec.fullName,
      email: spec.email,
      username: spec.username,
      password: QA_ACCOUNT_PASSWORD,
      role_key: 'admin',
      // The account must be usable at once: no forced password change.
      password_change_required: false,
    },
  })

  if (created.status() === 201) {
    const body = await created.json()
    expect(body.role, 'a role_key=admin request must persist as an admin').toBe('admin')
    return body.id
  }

  expect(created.status(), `admin create returned ${created.status()}: ${await created.text()}`).toBe(422)
  const found = await superadmin.get(`/api/admin/users?q=${encodeURIComponent(spec.email)}`, { headers: ajaxHeaders() })
  const row: UserRow | undefined = ((await found.json()).data ?? [])[0]
  expect(row, `expected an existing admin row for ${spec.email}`).toBeTruthy()
  await superadmin.post(`/api/admin/users/${row!.id}/reset-password`, {
    headers: ajaxHeaders(token),
    data: { password: QA_ACCOUNT_PASSWORD, password_change_required: false },
  })
  await superadmin.patch(`/api/admin/users/${row!.id}/active`, {
    headers: ajaxHeaders(token),
    data: { active: true },
  })
  return row!.id
}

test.describe('True admin vs superadmin boundary', () => {
  let superadmin: APIRequestContext
  let admin: APIRequestContext
  let adminBId: string

  test.beforeAll(async () => {
    superadmin = await apiContextFromState('superadmin')
    await ensureAdmin(superadmin, ADMIN_A)
    adminBId = await ensureAdmin(superadmin, ADMIN_B)
    // Clear the shared per-IP login bucket the setup project's 8 role logins
    // have already drawn down, so the fresh admin login below is not a 429.
    await flushRateLimits()
    // Proves the created admin can authenticate IMMEDIATELY (no force-password
    // flow); apiLoginRaw throws if the login is rejected.
    admin = await apiLoginRaw(ADMIN_A.email, QA_ACCOUNT_PASSWORD)
  })

  test.afterAll(async () => {
    // Tidy the throwaway admins so a reused DB never accumulates live admins.
    const token = await xsrfToken(superadmin)
    for (const email of [ADMIN_A.email, ADMIN_B.email]) {
      const found = await superadmin.get(`/api/admin/users?q=${encodeURIComponent(email)}`, { headers: ajaxHeaders() })
      const row: UserRow | undefined = ((await found.json()).data ?? [])[0]
      if (row) {
        await superadmin.patch(`/api/admin/users/${row.id}/active`, { headers: ajaxHeaders(token), data: { active: false } })
      }
    }
    await Promise.all([admin, superadmin].map((c) => c?.dispose()))
  })

  test('the minted admin authenticates immediately and carries the admin role', async () => {
    const res = await admin.get('/api/auth/me', { headers: ajaxHeaders() })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.user.role, 'session identity must be a plain admin, not superadmin').toBe('admin')
    expect(body.user.passwordChangeRequired, 'password_change_required:false must have been honoured').toBe(false)
  })

  test('admin vs superadmin permission delta is EXACTLY the three structural grants', async () => {
    const adminPerms: string[] = (await (await admin.get('/api/auth/me', { headers: ajaxHeaders() })).json()).permissions
    const superPerms: string[] = (await (await superadmin.get('/api/auth/me', { headers: ajaxHeaders() })).json()).permissions

    // superadmin \ admin == exactly the three superadmin-only permissions.
    const onlySuper = superPerms.filter((p) => !adminPerms.includes(p)).sort()
    expect(onlySuper).toEqual([...SUPERADMIN_ONLY].sort())

    // admin \ superadmin == nothing: admin is a strict subset.
    const onlyAdmin = adminPerms.filter((p) => !superPerms.includes(p))
    expect(onlyAdmin, 'a plain admin must never hold a permission the superadmin lacks').toEqual([])
  })

  test('admin reaches every parity read a superadmin can (users/analytics/settings/academic)', async () => {
    for (const path of [
      '/api/admin/users',
      '/api/analytics/overview',
      '/api/admin/settings',
      '/api/admin/academic/evaluations',
    ]) {
      const res = await admin.get(path, { headers: ajaxHeaders() })
      expect(res.status(), `admin GET ${path} should be reachable`).toBe(200)
    }
  })

  test('structural evaluation-form edits (draft + publish) are superadmin-only [T-10]', async () => {
    // A real form key + id, so the 403 is the permission gate firing - not a
    // route-model-binding 404 for a bogus id.
    const forms: Array<{ id: string; key: string; status: string }> =
      (await (await superadmin.get('/api/admin/academic/evaluation-forms', { headers: ajaxHeaders() })).json()).data ?? []
    const published = forms.find((f) => f.status === 'published')
    expect(published, 'seed must expose at least one published evaluation form').toBeTruthy()

    const adminToken = await xsrfToken(admin)
    const draftDenied = await admin.post(`/api/admin/academic/evaluation-forms/${published!.key}/draft`, {
      headers: ajaxHeaders(adminToken),
      data: {},
    })
    expect(draftDenied.status(), 'admin must not start a structural draft').toBe(403)

    const publishDenied = await admin.post(`/api/admin/academic/evaluation-forms/${published!.id}/publish`, {
      headers: ajaxHeaders(adminToken),
      data: {},
    })
    expect(publishDenied.status(), 'admin must not publish a structural change').toBe(403)

    // The superadmin IS admitted through the same gate (proves the 403 is
    // role-based, not a broken endpoint). Publishing an already-published
    // version is an idempotent no-op, so this mutates nothing.
    const superToken = await xsrfToken(superadmin)
    const publishOk = await superadmin.post(`/api/admin/academic/evaluation-forms/${published!.id}/publish`, {
      headers: ajaxHeaders(superToken),
      data: {},
    })
    expect(publishOk.status(), 'superadmin publish must pass the gate').toBe(200)

    const draftOk = await superadmin.post(`/api/admin/academic/evaluation-forms/${published!.key}/draft`, {
      headers: ajaxHeaders(superToken),
      data: {},
    })
    expect([200, 201], 'superadmin draft must pass the gate').toContain(draftOk.status())
  })

  test('an admin cannot create another admin, but can manage a regular user', async () => {
    const token = await xsrfToken(admin)

    // createAdmin = admins.manage = superadmin only. Middleware admits the call
    // (admin has users.manage) but the policy denies it -> 403.
    const makeAdmin = await admin.post('/api/admin/users', {
      headers: ajaxHeaders(token),
      data: {
        fullName: `${QA_MARKER} Illegal Admin`,
        email: 'qa.admin.illegal.donotdeploy@stpaul.local',
        password: QA_ACCOUNT_PASSWORD,
        role_key: 'admin',
        password_change_required: false,
      },
    })
    expect(makeAdmin.status(), 'an admin must not be able to create another admin').toBe(403)

    // Contrast: the same admin CAN create (and deactivate) an ordinary nurse -
    // proving the 403 above is specific to admin creation, not a blanket block.
    const nurseEmail = `qa.nurse.${Date.now()}.donotdeploy@stpaul.local`
    const makeNurse = await admin.post('/api/admin/users', {
      headers: ajaxHeaders(token),
      data: {
        fullName: `${QA_MARKER} Managed Nurse`,
        email: nurseEmail,
        password: QA_ACCOUNT_PASSWORD,
        role_key: 'nurse',
        password_change_required: false,
      },
    })
    expect(makeNurse.status(), 'an admin holds users.manage over ordinary roles').toBe(201)
    const nurseId = (await makeNurse.json()).id
    const deactivate = await admin.patch(`/api/admin/users/${nurseId}/active`, {
      headers: ajaxHeaders(token),
      data: { active: false },
    })
    expect(deactivate.status(), 'an admin can deactivate an ordinary user').toBe(200)
  })

  test('an admin cannot deactivate another admin, but a superadmin can', async () => {
    // UserPolicy::setActive narrows admin-on-admin to the superadmin.
    const adminToken = await xsrfToken(admin)
    const denied = await admin.patch(`/api/admin/users/${adminBId}/active`, {
      headers: ajaxHeaders(adminToken),
      data: { active: false },
    })
    expect(denied.status(), 'admin-on-admin deactivation must be forbidden').toBe(403)

    const superToken = await xsrfToken(superadmin)
    const allowed = await superadmin.patch(`/api/admin/users/${adminBId}/active`, {
      headers: ajaxHeaders(superToken),
      data: { active: false },
    })
    expect(allowed.status(), 'a superadmin may deactivate an admin').toBe(200)
    expect((await allowed.json()).active, 'the admin must actually be deactivated').toBe(false)
  })
})
