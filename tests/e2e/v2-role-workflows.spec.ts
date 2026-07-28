import { expect, test } from '@playwright/test'

import { apiContextFromState, ajaxHeaders } from './helpers/api'
import { authFile } from './helpers/auth'

test.describe('Morning recorder policy', () => {
  test('designated recorder sees the morning surface', async ({ browser }) => {
    const context = await browser.newContext({ storageState: authFile('resident') })
    const page = await context.newPage()
    await page.goto('/academic/morning', { waitUntil: 'domcontentloaded' })
    await expect(page.getByText('Morning session').first()).toBeVisible()
    await expect(page.getByText(/recording is assigned/i)).toHaveCount(0)
    await context.close()
  })

  test('non-designated resident gets a safe read-only state from the API', async () => {
    const api = await apiContextFromState('non_recorder')
    // A resident/consultant who is NOT the designated recorder is not denied:
    // MorningSessionPolicy::viewToday returns a safe 200 with canRecord:false and
    // the expected-person roster omitted, without lazy-opening a session. The 403
    // boundary belongs to nurse/student_rep (they lack morningAttendance.record).
    // Pinned by V2ReadAuthorizationTest + ROLE_PERMISSION_MATRIX.md:278.
    const res = await api.get('/api/academic/morning-sessions/today', { headers: ajaxHeaders() })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.canRecord).toBe(false)
    expect(body.session?.people).toBeUndefined()
    await api.dispose()
  })

  test('designated recorder cancels a pending session with an audited reason', async ({ browser, browserName }) => {
    // Destructive and non-idempotent: this permanently cancels the singleton
    // "today" morning session, and the domain has no un-cancel path (a cancelled
    // session can never return to pending). The spec is in CROSS_BROWSER_UI and
    // replays against one seed-once DB, so a second engine finds the session
    // already cancelled (the cancel form correctly hidden) and fails. Pin the
    // mutation to the CI project so it stays deterministic across engines.
    test.skip(browserName !== 'chromium', 'Mutates the shared seed-once DB; runs once on the CI (chromium) project.')
    const context = await browser.newContext({ storageState: authFile('resident') })
    const page = await context.newPage()
    const reason = 'E2E recorder cancellation verification'

    await page.goto('/academic/morning', { waitUntil: 'domcontentloaded' })
    await page.getByLabel('Cancellation reason').fill(reason)
    await page.getByRole('button', { name: 'Cancel session' }).click()

    await expect(page.getByText(/today's session is cancelled/i)).toBeVisible()
    await expect(page.getByText(reason)).toBeVisible()

    const residentApi = await apiContextFromState('resident')
    const today = await residentApi.get('/api/academic/morning-sessions/today', { headers: ajaxHeaders() })
    expect(today.status()).toBe(200)
    const todayBody = await today.json()
    expect(todayBody.session.status).toBe('cancelled')
    expect(todayBody.session.reason).toBe(reason)
    await residentApi.dispose()

    const adminApi = await apiContextFromState('superadmin')
    const audits = await adminApi.get(
      `/api/admin/admin-audit-logs?entity_type=morning_session&entity_id=${todayBody.session.id}&action=cancel`,
      { headers: ajaxHeaders() },
    )
    expect(audits.status()).toBe(200)
    const auditBody = await audits.json()
    expect(auditBody.data).toHaveLength(1)
    expect(auditBody.data[0].newValues.reason).toBe(reason)
    await adminApi.dispose()
    await context.close()
  })
})

test.describe('Admin academic runtime behavior', () => {
  test.use({ storageState: authFile('superadmin') })

  test('reuses fresh analytics data when revisiting a tab', async ({ page }) => {
    let morningRequests = 0
    page.on('request', (request) => {
      if (new URL(request.url()).pathname === '/api/academic/analytics/morning') {
        morningRequests += 1
      }
    })

    await page.goto('/admin/academic', { waitUntil: 'domcontentloaded' })
    await page.getByRole('button', { name: 'Morning sessions' }).click()
    await expect(page.getByRole('heading', { name: 'Punctuality and attendance' })).toBeVisible()
    await page.getByRole('button', { name: 'Teaching activities' }).click()
    await expect(page.getByText('Teaching activities').last()).toBeVisible()
    await page.getByRole('button', { name: 'Morning sessions' }).click()
    await expect(page.getByRole('heading', { name: 'Punctuality and attendance' })).toBeVisible()

    expect(morningRequests).toBe(1)
  })

  test('fits the academic dashboard at a 390px mobile viewport', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/admin/academic', { waitUntil: 'domcontentloaded' })
    await expect(page.getByRole('navigation', { name: 'Primary' })).toBeVisible()

    const dimensions = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }))

    expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth)
  })
})

test.describe('Consultant teaching attendance', () => {
  test.use({ storageState: authFile('consultant') })

  test('loads the current teaching attendance surface', async ({ page }) => {
    await page.goto('/academic/teaching', { waitUntil: 'domcontentloaded' })
    await expect(page.getByRole('button', { name: 'Notifications' }).first()).toBeVisible()
    await expect(page.getByText(/student attendance|teaching/i).first()).toBeVisible()
  })
})

for (const [account, expectedScope] of [
  ['group_rep', 'group'],
  ['subgroup_a_rep', 'subgroup_a'],
  ['subgroup_b_rep', 'subgroup_b'],
] as const) {
  test.describe(`${expectedScope} representative isolation`, () => {
    test(`loads only the ${expectedScope} log and cannot read evaluations`, async () => {
      const api = await apiContextFromState(account)
      const sessions = await api.get('/api/teaching/my-sessions', { headers: ajaxHeaders() })
      expect(sessions.status()).toBe(200)
      expect((await sessions.json()).scope.scope).toBe(expectedScope)

      for (const endpoint of [
        '/api/academic/form-options',
        '/api/academic/my-submissions',
        '/api/academic/my-performance',
        '/api/academic/evaluation-forms/consultant_mdt',
        '/api/admin/academic/evaluations',
      ]) {
        expect((await api.get(endpoint, { headers: ajaxHeaders() })).status()).toBe(403)
      }

      await api.dispose()
    })
  })
}
