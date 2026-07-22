import { test, expect, type APIRequestContext } from '@playwright/test'
import { anonContext, apiContextFromState, apiLoginRaw, ajaxHeaders, xsrfToken, flushRateLimits } from './helpers/api'
import { authFile } from './helpers/auth'
import { DEV_PASSWORD, QA_MARKER } from './helpers/accounts'

// Each self-registration flow signs up and logs in against the shared per-IP
// throttle bucket; reset it before every test so accumulated count from earlier
// tests (or the setup logins) does not 429 a legitimate registration or login.
test.beforeEach(async () => {
  await flushRateLimits()
})

/**
 * Gap A.2 / risk-area #2 — the in-flux registration + approval subsystem has zero
 * browser coverage. This spec drives BOTH public self-service tracks through the
 * real /register UI and then confirms the server side with the API helpers:
 *
 *  - the CLINICAL (nurse) track writes an inactive users row + a pending
 *    access_requests row, and approval in the /admin/users queue activates the
 *    account so it can finally authenticate;
 *  - the ACADEMIC (resident) track writes a pending admin_access_requests row with
 *    NO user until an approver approves it — the PRE-1 regression: the queue must
 *    no longer silently swallow the enrollment.
 *
 * PRE-3 / C-SEC-004 regression: a never-activated applicant whose password matches
 * must get the GENERIC credential failure — the login form must not become an
 * account-enumeration oracle by disclosing "pending / awaiting approval".
 *
 * Cross-browser note: this spec runs on chromium, firefox and webkit against ONE
 * shared e2e.sqlite. Every applicant email is therefore namespaced by the project
 * name so each engine registers and approves its own isolated account.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

function projectSlug(): string {
  return test.info().project.name.replace(/[^a-z0-9]/gi, '').toLowerCase() || 'chromium'
}

function nurseEmail(): string {
  return `qa.nurse.selfreg.${projectSlug()}.donotdeploy@stpaul.local`
}

function residentEmail(): string {
  return `qa.resident.selfreg.${projectSlug()}.donotdeploy@stpaul.local`
}

async function findUser(adminApi: APIRequestContext, email: string): Promise<any | undefined> {
  const res = await adminApi.get(`/api/admin/users?q=${encodeURIComponent(email)}`, { headers: ajaxHeaders() })
  const body: any = await res.json()
  const rows: any[] = body.data ?? body ?? []
  return rows.find((u) => String(u.email ?? '').toLowerCase() === email.toLowerCase())
}

async function pendingAccessRequest(adminApi: APIRequestContext, email: string): Promise<any | undefined> {
  const res = await adminApi.get('/api/admin/access-requests?status=pending', { headers: ajaxHeaders() })
  const body: any = await res.json()
  return (body.data ?? []).find((r: any) => String(r.email ?? '').toLowerCase() === email.toLowerCase())
}

async function pendingAdminRequest(adminApi: APIRequestContext, email: string): Promise<any | undefined> {
  const res = await adminApi.get('/api/admin/admin-access-requests?status=pending', { headers: ajaxHeaders() })
  const body: any = await res.json()
  return (body.data ?? []).find((r: any) => String(r.email ?? '').toLowerCase() === email.toLowerCase())
}

/** Click the Approve button inside the queue row that carries `email`. */
async function approveRowFor(page: import('@playwright/test').Page, email: string): Promise<void> {
  const row = page
    .locator('div')
    .filter({ has: page.getByText(email, { exact: true }) })
    .filter({ has: page.getByRole('button', { name: 'Approve' }) })
    .last()
  await expect(row, `the request for ${email} should be visible in the /admin/users queue`).toBeVisible({
    timeout: 20_000,
  })
  await row.getByRole('button', { name: 'Approve' }).click()
}

// ---------------------------------------------------------------------------
// CLINICAL (nurse) self-registration -> pending -> approval -> working account
// ---------------------------------------------------------------------------
test.describe('Nurse self-registration and approval', () => {
  test.describe.configure({ mode: 'serial' })

  test('anonymous nurse self-registers via /register: inactive user + pending request', async ({ page }) => {
    const email = nurseEmail()

    await page.goto('/register')
    // The clinical track is the default. Fill the new-account fields.
    await page.locator('#fullName').fill(`${QA_MARKER} SelfReg Nurse`)
    await page.locator('#email').fill(email)
    await page.locator('#password').fill(DEV_PASSWORD)
    await page.locator('#confirmPassword').fill(DEV_PASSWORD)
    // At least one reporting assignment is required; GI/Neurology is an
    // inpatient-only department so its label is unambiguous.
    await page.getByRole('checkbox', { name: 'GI/Neurology' }).check()

    await page.getByRole('button', { name: /submit access request/i }).first().click()

    // Non-committal success copy from the anonymous endpoint.
    await expect(page.getByText(/awaiting approval/i).first()).toBeVisible({ timeout: 20_000 })

    // Server side: an inactive nurse users row AND a pending access_requests row.
    const admin = await apiContextFromState('superadmin')
    try {
      const user = await findUser(admin, email)
      expect(user, 'a users row must be created for the applicant').toBeTruthy()
      expect(user.active, 'the self-registered applicant must be inactive until approved').toBe(false)
      expect(user.role).toBe('nurse')

      const request = await pendingAccessRequest(admin, email)
      expect(request, 'a pending access_requests row must exist for the applicant').toBeTruthy()
      expect(request.status).toBe('pending')
    } finally {
      await admin.dispose()
    }
  })

  test('pending applicant login is refused with a generic, non-enumerating message [PRE-3]', async ({
    page,
  }) => {
    const email = nurseEmail()

    await page.goto('/login')
    // The password MATCHES (the applicant chose it a request ago). The account is
    // simply not yet activated, so the reply must stay generic.
    await page.locator('#identifier').fill(email)
    await page.locator('#password').fill(DEV_PASSWORD)
    await page.getByRole('button', { name: /sign in to reporting portal/i }).click()

    // Stays on /login, not authenticated.
    await expect(page).toHaveURL(/\/login/)
    await expect(page.getByText('Check your email and password and try again.')).toBeVisible({
      timeout: 15_000,
    })
    // Enumeration guard: the failure must NOT disclose that the account exists or
    // that a request is pending. If the backend regressed to a "pending/awaiting
    // approval / inactive" message, this assertion fails.
    await expect(page.getByText(/awaiting approval|pending approval|not yet approved|account is inactive|already (has|exists)/i)).toHaveCount(0)

    // Confirm the browser context holds no authenticated session.
    const me = await page.request.get('/api/auth/me', { headers: ajaxHeaders() })
    expect(me.status(), 'a rejected applicant must not hold a session').toBe(401)
  })

  test('superadmin approves in the /admin/users queue and the account can log in', async ({ browser }) => {
    const email = nurseEmail()
    const context = await browser.newContext({ storageState: authFile('superadmin') })
    const page = await context.newPage()

    await page.goto('/admin/users', { waitUntil: 'domcontentloaded' })
    // The enrollment actually appears in the approval queue (not swallowed).
    await expect(page.getByText(email, { exact: true }).first()).toBeVisible({ timeout: 20_000 })
    await approveRowFor(page, email)

    const admin = await apiContextFromState('superadmin')
    try {
      // The applicant flips active=true (materialises into a usable account).
      await expect
        .poll(async () => (await findUser(admin, email))?.active === true, { timeout: 15_000 })
        .toBe(true)
      // The pending request is gone from the pending queue (it was reviewed).
      expect(await pendingAccessRequest(admin, email)).toBeFalsy()
    } finally {
      await admin.dispose()
    }

    // The account can now authenticate with the password chosen at registration.
    const applicant = await apiLoginRaw(email, DEV_PASSWORD)
    try {
      const me = await applicant.get('/api/auth/me', { headers: ajaxHeaders() })
      expect(me.status()).toBe(200)
      expect((await me.json()).user.role).toBe('nurse')
    } finally {
      await applicant.dispose()
      await context.close()
    }
  })
})

// ---------------------------------------------------------------------------
// ACADEMIC (resident) self-signup -> pending admin request -> approval [PRE-1]
// ---------------------------------------------------------------------------
test.describe('Academic self-signup and approval', () => {
  test.describe.configure({ mode: 'serial' })

  test('anonymous resident self-signs up via /register: pending admin request, NO user yet', async ({
    page,
  }) => {
    const email = residentEmail()

    await page.goto('/register')
    // Switch to the academic enrollment track.
    await page.getByRole('button', { name: 'Academic' }).first().click()
    await page.locator('#academicFullName').fill(`${QA_MARKER} SelfReg Resident`)
    await page.locator('#academicEmail').fill(email)
    await page.locator('#academicPassword').fill(DEV_PASSWORD)
    await page.locator('#academicConfirm').fill(DEV_PASSWORD)
    // Pick the Resident role card (scoped so "Consultant / Evaluate residents." does
    // not also match).
    await page.getByRole('button').filter({ has: page.getByText('Resident', { exact: true }) }).click()

    // Residents must declare a training year (a required field on the academic
    // enrollment form); pick one so client validation lets the submit through.
    await page.getByRole('radio', { name: 'Year 2' }).click()

    await page.getByRole('button', { name: /request academic account/i }).first().click()
    await expect(page.getByText(/awaiting approval/i).first()).toBeVisible({ timeout: 20_000 })

    const admin = await apiContextFromState('superadmin')
    try {
      const request = await pendingAdminRequest(admin, email)
      expect(request, 'a pending admin_access_requests row must exist').toBeTruthy()
      expect(request.requestedRole).toBe('resident')
      // No account exists until an approver approves the request.
      expect(await findUser(admin, email), 'no user should exist before approval').toBeFalsy()
    } finally {
      await admin.dispose()
    }

    // Before approval, login fails outright (no account exists) — and the endpoint
    // does not disclose the pending request either.
    const anon = await anonContext()
    try {
      const token = await xsrfToken(anon)
      const res = await anon.post('/api/auth/login', {
        headers: ajaxHeaders(token),
        data: { identifier: email, password: DEV_PASSWORD },
      })
      expect(res.status(), 'a pre-approval academic login must be rejected').toBe(422)
    } finally {
      await anon.dispose()
    }
  })

  test('superadmin approves the academic request into a working resident account [PRE-1]', async ({
    browser,
  }) => {
    const email = residentEmail()
    const context = await browser.newContext({ storageState: authFile('superadmin') })
    const page = await context.newPage()

    await page.goto('/admin/users', { waitUntil: 'domcontentloaded' })
    await expect(page.getByText(email, { exact: true }).first()).toBeVisible({ timeout: 20_000 })
    await approveRowFor(page, email)

    const admin = await apiContextFromState('superadmin')
    try {
      // The enrollment materialises into an ACTIVE resident account with the
      // requested role and no forced password change.
      await expect
        .poll(
          async () => {
            const u = await findUser(admin, email)
            return u && u.active === true && u.role === 'resident' && u.passwordChangeRequired === false
              ? 'ready'
              : 'pending'
          },
          { timeout: 15_000 },
        )
        .toBe('ready')
    } finally {
      await admin.dispose()
    }

    const resident = await apiLoginRaw(email, DEV_PASSWORD)
    try {
      const me = await resident.get('/api/auth/me', { headers: ajaxHeaders() })
      expect(me.status()).toBe(200)
      expect((await me.json()).user.role).toBe('resident')
    } finally {
      await resident.dispose()
      await context.close()
    }
  })
})
