import {
  test,
  expect,
  request as pwRequest,
  type APIRequestContext,
  type Browser,
  type BrowserContext,
  type Locator,
  type Page,
  type Request,
  type Route,
} from '@playwright/test'
import { ACCOUNTS, DEV_PASSWORD, QA_ACCOUNT_PASSWORD, QA_MARKER, type AccountKey } from './helpers/accounts'
import { ajaxHeaders, apiContextAs, apiLoginRaw, BASE_URL, flushRateLimits, xsrfToken } from './helpers/api'
import { LoginPage } from './pages/login-page'

/**
 * Frontend failure recovery (pre-server hardening, priority 4).
 *
 * Every important mutation is driven through the real UI while the matching
 * API request is intercepted and answered with a failure (HTTP statuses,
 * a client timeout, or a dropped connection). Each case checks the same
 * acceptance criteria: the control re-enables (no permanent spinner), no
 * success toast is shown for a failure, the request went out exactly once,
 * the user's input survives, the server's message is visible, navigation
 * still works, an expired session sends the user to /login, and a retry
 * succeeds once the interception lets the request through.
 *
 * Interception is arranged so only the FIRST N matching requests fail and
 * later ones pass through, which proves the retry path against the real API.
 * The nurse offline queue is covered by offline-sync.spec.ts; the report form
 * cases here use HTTP statuses only, apart from one dropped-connection case
 * that must show the queue taking over.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

type StatusFailure = {
  status: number
  body?: unknown
  headers?: Record<string, string>
  /** Hold the response this long before answering (client timeout tests). */
  delayMs?: number
}
type Failure = StatusFailure | { abort: true }

type Matcher = { method: string; path: string | RegExp }

/** Realistic Laravel-shaped bodies for each simulated status. */
const BODY: Record<number, unknown> = {
  400: { message: 'The request could not be understood.' },
  401: { message: 'Unauthenticated.' },
  403: { message: 'This action is unauthorized.' },
  409: { message: 'This record was changed by someone else. Reload and try again.' },
  419: { message: 'CSRF token mismatch.' },
  422: {
    message: 'The given data was invalid.',
    errors: { values: ['The values field must contain a numeric entry.'] },
  },
  429: { message: 'Too Many Attempts.' },
  500: { message: 'Server Error' },
  502: '<html><body><h1>502 Bad Gateway</h1></body></html>',
  503: '<html><body><h1>503 Service Unavailable</h1></body></html>',
}

/** The message the app is expected to surface for each simulated status. */
const EXPECTED_MESSAGE: Record<number, string> = {
  400: 'The request could not be understood.',
  403: 'This action is unauthorized.',
  409: 'This record was changed by someone else. Reload and try again.',
  422: 'The given data was invalid.',
  429: 'Too Many Attempts.',
  500: 'Server Error',
  502: 'Bad Gateway',
  503: 'Service Unavailable',
}

const TIMEOUT_MESSAGE = 'The server took too long to respond. Please try again.'
const CREDENTIALS_MESSAGE = 'Check your email and password and try again.'
/**
 * The public /login entry (main.tsx renders it without the app providers, so
 * there is no toaster) reports failures inline. A credential rejection stays
 * generic; everything else names its real reason.
 */
const LOGIN_MESSAGE: Record<number, string> = {
  400: 'The request could not be understood.',
  403: 'This action is unauthorized.',
  422: CREDENTIALS_MESSAGE,
  429: 'Too Many Attempts.',
  500: 'Sign-in is unavailable right now (Server Error). Please try again in a moment.',
  502: 'Sign-in is unavailable right now (Bad Gateway). Please try again in a moment.',
  503: 'Sign-in is unavailable right now (Service Unavailable). Please try again in a moment.',
}
/** Just past the client's mutation timeout (30 s) / GET timeout (15 s). */
const MUTATION_TIMEOUT_DELAY_MS = 31_000
const GET_TIMEOUT_DELAY_MS = 16_000

/** 409 is not here: a stale-write conflict on a report save has its own UI. */
const HTTP_FAILURE_STATUSES = [400, 403, 422, 429, 500, 502, 503]

function statusFailure(status: number): StatusFailure {
  return {
    status,
    body: BODY[status],
    ...(status === 429 ? { headers: { 'Retry-After': '30' } } : {}),
  }
}

type Interceptor = {
  /** How many matching requests were answered with a failure. */
  failed: number
  /** How many matching requests were let through to the real API. */
  passed: number
  /** Total matching requests observed. */
  seen: number
  /** Queue more failures for the next matching requests. */
  fail: (...failures: Failure[]) => void
  /** Answer EVERY matching request with this failure until cleared (null). */
  always: (failure: Failure | null) => void
  dispose: () => Promise<void>
}

const isApiPath = (url: URL) => /^\/(api|sanctum)\//.test(url.pathname)

/**
 * Route interception that answers the next matching request(s) with a
 * failure and lets everything else through. Non-matching API traffic is never
 * touched, so the page keeps loading normally around the failing mutation.
 */
async function intercept(page: Page, matcher: Matcher, ...initial: Failure[]): Promise<Interceptor> {
  const queue: Failure[] = [...initial]
  let standing: Failure | null = null
  const state: Interceptor = {
    failed: 0,
    passed: 0,
    seen: 0,
    fail: (...failures) => {
      queue.push(...failures)
    },
    always: (failure) => {
      standing = failure
    },
    dispose: async () => {
      await page.unroute(isApiPath, handler).catch(() => undefined)
    },
  }

  const matches = (request: Request) => {
    if (request.method() !== matcher.method) return false
    const { pathname } = new URL(request.url())
    return typeof matcher.path === 'string' ? pathname === matcher.path : matcher.path.test(pathname)
  }

  const handler = async (route: Route, request: Request) => {
    if (!matches(request)) {
      await route.fallback()
      return
    }
    state.seen += 1
    const failure = queue.shift() ?? standing
    if (!failure) {
      state.passed += 1
      await route.fallback()
      return
    }
    state.failed += 1
    if ('abort' in failure) {
      await route.abort('internetdisconnected')
      return
    }
    if (failure.delayMs) {
      await new Promise((resolve) => setTimeout(resolve, failure.delayMs))
    }
    const isJson = typeof failure.body !== 'string'
    await route
      .fulfill({
        status: failure.status,
        headers: {
          'Content-Type': isJson ? 'application/json' : 'text/html; charset=utf-8',
          ...(failure.headers ?? {}),
        },
        body: isJson ? JSON.stringify(failure.body ?? null) : (failure.body as string),
      })
      // The client aborts on timeout before a delayed fulfil lands; that is
      // the point of the delayed case, not a test failure.
      .catch(() => undefined)
  }

  await page.route(isApiPath, handler)
  return state
}

/** Count every request to a mutation endpoint, whatever answered it. */
function countRequests(page: Page, matcher: Matcher) {
  const counter = { count: 0 }
  page.on('request', (request) => {
    if (request.method() !== matcher.method) return
    const { pathname } = new URL(request.url())
    const hit =
      typeof matcher.path === 'string' ? pathname === matcher.path : matcher.path.test(pathname)
    if (hit) counter.count += 1
  })
  return counter
}

/** Toasts raised since the last dismissToasts(); stale ones are ignored. */
const toast = (page: Page, text: string | RegExp): Locator =>
  page.locator('[data-sonner-toast]:not([data-qa-stale])').filter({ hasText: text })

async function expectErrorToast(page: Page, text: string | RegExp) {
  await expect(toast(page, text).first()).toBeVisible({ timeout: 10_000 })
}

/**
 * Retire every toast currently shown so the next assertion cannot read a stale
 * one. They are only marked, never removed: pulling React-managed nodes out of
 * the DOM makes the next toast insertion throw and unmounts the whole app.
 */
async function dismissToasts(page: Page) {
  await page.evaluate(() => {
    document
      .querySelectorAll('[data-sonner-toast]')
      .forEach((node) => node.setAttribute('data-qa-stale', '1'))
  })
}

type StorageState = Awaited<ReturnType<APIRequestContext['storageState']>>

/**
 * Sessions of our own, one API login per role for the whole file. The shared
 * .auth states are written by whichever run went last (another target's
 * cookie name would 401 here), and this spec must stay valid on its own.
 */
const sessions = new Map<AccountKey, Promise<StorageState>>()

function sessionFor(role: AccountKey): Promise<StorageState> {
  let session = sessions.get(role)
  if (!session) {
    session = (async () => {
      const ctx = await apiContextAs(role)
      try {
        return await ctx.storageState()
      } finally {
        await ctx.dispose()
      }
    })()
    sessions.set(role, session)
  }
  return session
}

async function apiAs(role: AccountKey): Promise<APIRequestContext> {
  return pwRequest.newContext({ baseURL: BASE_URL, storageState: await sessionFor(role) })
}

async function newPageAs(browser: Browser, role: AccountKey): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ storageState: await sessionFor(role) })
  const page = await context.newPage()
  return { context, page }
}

test.beforeAll(async () => {
  // The auth setup project spends most of the per-minute login budget just
  // before this file runs; reset it so this file's own logins are not throttled.
  await flushRateLimits()
})

// ---------------------------------------------------------------------------
// Login
// ---------------------------------------------------------------------------

test.describe('Login failure recovery', () => {
  const LOGIN: Matcher = { method: 'POST', path: '/api/auth/login' }
  const signInButton = (page: Page) =>
    page.getByRole('button', { name: /sign in to reporting portal|signing in/i })

  test.beforeAll(async () => {
    await flushRateLimits()
  })

  test('HTTP failures show the server message, keep the input and re-enable sign in; a retry then succeeds', async ({
    page,
  }) => {
    const loginPage = new LoginPage(page)
    const requests = countRequests(page, LOGIN)
    const interceptor = await intercept(page, LOGIN)
    await loginPage.open()

    let expectedRequests = 0
    for (const status of [400, 403, 422, 429, 500, 502, 503]) {
      await test.step(`login answered ${status}`, async () => {
        await dismissToasts(page)
        interceptor.fail(statusFailure(status))
        await loginPage.submit(ACCOUNTS.nurse.identifier, DEV_PASSWORD)
        expectedRequests += 1

        // The real reason reaches the user inline; the credentials stay
        // filled in and the form is usable again.
        await expect(page.getByText(LOGIN_MESSAGE[status], { exact: true })).toBeVisible()
        await expect(signInButton(page)).toBeEnabled()
        await expect(signInButton(page)).toHaveText(/sign in to reporting portal/i)
        await expect(page.locator('#identifier')).toHaveValue(ACCOUNTS.nurse.identifier)
        await expect(page.locator('#password')).toHaveValue(DEV_PASSWORD)
        await expect(page).toHaveURL(/\/login/)
        expect(requests.count, 'exactly one login request per attempt').toBe(expectedRequests)
      })
    }

    // Retry with the interception exhausted: the real login goes through.
    await dismissToasts(page)
    await signInButton(page).click()
    await page.waitForURL(/\/nurse/, { timeout: 20_000 })
    expect(interceptor.passed).toBe(1)
    await expect(page.getByRole('button', { name: 'Notifications' }).first()).toBeVisible({
      timeout: 20_000,
    })
    await interceptor.dispose()
  })

  test('a dropped connection and a wrong password are both reported and recoverable', async ({ page }) => {
    const loginPage = new LoginPage(page)
    const interceptor = await intercept(page, LOGIN, { abort: true })
    await loginPage.open()

    await loginPage.submit(ACCOUNTS.nurse.identifier, DEV_PASSWORD)
    await expect(signInButton(page)).toBeEnabled({ timeout: 15_000 })
    await expect(
      page.getByText('Unable to reach the server. Check your connection and try again.'),
    ).toBeVisible()
    expect(interceptor.failed).toBe(1)

    // A genuine rejection from the API (wrong password) is still a clean,
    // generic message and the form stays usable.
    await dismissToasts(page)
    await page.locator('#password').fill('definitely-not-the-password')
    await signInButton(page).click()
    await expect(page.getByText(CREDENTIALS_MESSAGE)).toBeVisible({ timeout: 15_000 })
    await expect(signInButton(page)).toBeEnabled()
    expect(interceptor.passed).toBe(1)

    // Then the right password works without reloading.
    await page.locator('#password').fill(DEV_PASSWORD)
    await signInButton(page).click()
    await page.waitForURL(/\/nurse/, { timeout: 20_000 })
    await interceptor.dispose()
  })

  test('the client timeouts fire for a hung login (30 s), a hung session probe (15 s) and a hung report save (30 s)', async ({
    browser,
  }) => {
    test.setTimeout(120_000)

    // Three hung requests in parallel so the wall-clock cost is one timeout.
    const loginContext = await browser.newContext()
    const loginPageHandle = await loginContext.newPage()
    const probeContext = await browser.newContext({ storageState: await sessionFor('superadmin') })
    const probePage = await probeContext.newPage()

    try {
      // (a) Hung POST /api/auth/login: the 30 s mutation timeout must surface.
      const loginPage = new LoginPage(loginPageHandle)
      const loginInterceptor = await intercept(loginPageHandle, LOGIN, {
        status: 200,
        body: { message: 'late' },
        delayMs: MUTATION_TIMEOUT_DELAY_MS,
      })
      await loginPage.open()
      const loginStarted = Date.now()
      await loginPage.submit(ACCOUNTS.nurse.identifier, DEV_PASSWORD)
      await expect(signInButton(loginPageHandle)).toHaveText(/signing in/i)

      // (b) Hung GET /api/auth/me on a device that remembers a session: the
      // 15 s GET timeout must release the form instead of blocking sign in.
      const probeInterceptor = await intercept(
        probePage,
        { method: 'GET', path: '/api/auth/me' },
        { status: 200, body: { user: null }, delayMs: GET_TIMEOUT_DELAY_MS },
      )
      // A device that signed in before remembers a session hint; only then
      // does the page probe /api/auth/me before releasing the form.
      await probePage.addInitScript(() => {
        window.localStorage.setItem('imreport.session-hint', '1')
      })
      await probePage.goto('/login')
      await expect(probePage.locator('button[type="submit"]')).toHaveText(/checking session/i)
      await expect(probePage.getByText(/unable to restore the current session/i)).toBeVisible({
        timeout: GET_TIMEOUT_DELAY_MS + 5_000,
      })
      await expect(signInButton(probePage)).toBeEnabled()
      await expect(signInButton(probePage)).toHaveText(/sign in to reporting portal/i)
      expect(probeInterceptor.failed).toBe(1)

      await expect(loginPageHandle.getByText(TIMEOUT_MESSAGE)).toBeVisible({
        timeout: MUTATION_TIMEOUT_DELAY_MS + 5_000,
      })
      const elapsed = Date.now() - loginStarted
      expect(elapsed, 'the login gave up at the 30 s client timeout, not earlier').toBeGreaterThan(29_000)
      await expect(signInButton(loginPageHandle)).toBeEnabled()
      await expect(loginPageHandle.locator('#identifier')).toHaveValue(ACCOUNTS.nurse.identifier)
      expect(loginInterceptor.failed).toBe(1)

      // Retry after the timeout: the real login succeeds.
      await signInButton(loginPageHandle).click()
      await loginPageHandle.waitForURL(/\/nurse/, { timeout: 20_000 })
      expect(loginInterceptor.passed).toBe(1)
    } finally {
      await loginContext.close()
      await probeContext.close()
    }
  })
})

// ---------------------------------------------------------------------------
// Expired session (401 / 419) on an authenticated mutation
// ---------------------------------------------------------------------------

test.describe('Expired session on a mutation', () => {
  for (const status of [401, 419]) {
    test(`a ${status} on a save sends the user to /login and the app is not lost`, async ({ browser }) => {
      const { context, page } = await newPageAs(browser, 'superadmin')
      try {
        const interceptor = await intercept(
          page,
          { method: 'PATCH', path: '/api/admin/settings' },
          statusFailure(status),
        )
        await page.goto('/admin/settings')
        const toggle = page.getByRole('switch', { name: 'Enforce weekly deadlines' })
        await expect(toggle).toBeVisible({ timeout: 20_000 })
        await toggle.click()
        await page.getByRole('button', { name: 'Save settings' }).click()

        await page.waitForURL(/\/login/, { timeout: 15_000 })
        expect(interceptor.failed).toBe(1)
        // The login screen renders and works: nothing about the SPA broke.
        await expect(page.locator('#identifier')).toBeVisible()
        await expect(page.getByRole('button', { name: /sign in to reporting portal/i })).toBeEnabled()
        await interceptor.dispose()
      } finally {
        await context.close()
      }
    })
  }
})

// ---------------------------------------------------------------------------
// Nurse report form: save draft, submit
// ---------------------------------------------------------------------------

test.describe('Nurse report form failure recovery', () => {
  test.describe.configure({ mode: 'serial' })

  const SAVE: Matcher = { method: 'POST', path: '/api/reports' }
  let assignmentId = ''
  let periodId = ''

  const firstCell = (page: Page) => page.getByRole('spinbutton').first()
  const saveDraft = (page: Page) => page.getByRole('button', { name: /^(save draft|saving\.\.\.)$/i }).first()
  const submitReport = (page: Page) =>
    page.getByRole('button', { name: /^(submit report|submitting\.\.\.)$/i }).first()

  async function openReport(page: Page) {
    await page.goto(`/reports/${assignmentId}/${periodId}`, { waitUntil: 'domcontentloaded' })
    await expect(firstCell(page)).toBeVisible({ timeout: 20_000 })
    await expect(saveDraft(page)).toBeEnabled({ timeout: 20_000 })
  }

  test.beforeAll(async () => {
    // A dedicated assignment in a department with no other reports, so the
    // form starts from "not started" and nothing else in the fixture moves.
    const nurseApi = await apiAs('nurse')
    const admin = await apiAs('superadmin')
    try {
      const res = await nurseApi.get('/api/workspace?reportPeriodWindow=all', { headers: ajaxHeaders() })
      const workspace: any = await res.json()
      const state: any = workspace.state
      const assignments: any[] = state.assignments ?? []
      const periods: any[] = state.reportingPeriods ?? []
      expect(periods.length, 'the seed must expose reporting periods').toBeGreaterThan(0)

      const assigned = new Set(assignments.map((assignment) => assignment.departmentId))
      const departmentIds: Record<string, string> = workspace.references?.departmentDbIdBySlug ?? {}
      const templateIds: Record<string, string> = workspace.references?.templateDbIdByDepartmentSlug ?? {}
      const candidates = Object.keys(departmentIds)
        .filter((slug) => !assigned.has(slug) && templateIds[slug])
        .sort()
      expect(candidates.length, 'need an unassigned department for an isolated report').toBeGreaterThan(0)
      // Take the last candidate: the offline and lifecycle specs take the first ones.
      const departmentSlug = candidates[candidates.length - 1]

      const token = await xsrfToken(admin)
      const created = await admin.post('/api/admin/assignments', {
        headers: ajaxHeaders(token),
        data: { nurseId: state.currentUserId, departmentId: departmentSlug, templateId: templateIds[departmentSlug] },
      })
      // 201 for a new assignment; 200 when a retired one for the same pair is revived.
      expect([200, 201], 'the isolated nurse assignment must be created').toContain(created.status())
      assignmentId = (await created.json()).id
      periodId = periods[periods.length - 1].id
    } finally {
      await nurseApi.dispose()
      await admin.dispose()
    }
  })

  test.afterAll(async () => {
    if (!assignmentId) return
    const admin = await apiAs('superadmin')
    try {
      const token = await xsrfToken(admin)
      await admin.patch(`/api/admin/assignments/${assignmentId}`, {
        headers: ajaxHeaders(token),
        data: { active: false },
      })
    } finally {
      await admin.dispose()
    }
  })

  test('save draft: every HTTP failure keeps the typed value, shows the message, re-enables and retries once', async ({
    browser,
  }) => {
    test.setTimeout(90_000)
    const { context, page } = await newPageAs(browser, 'nurse')
    try {
      const requests = countRequests(page, SAVE)
      const interceptor = await intercept(page, SAVE)
      await openReport(page)
      await firstCell(page).fill('17')

      for (const status of HTTP_FAILURE_STATUSES) {
        await test.step(`save answered ${status}`, async () => {
          await dismissToasts(page)
          const before = requests.count
          // Every save fails while this status is under test, so an automatic
          // re-fire (autosave re-arming after the failure) is counted, not hidden.
          interceptor.always(statusFailure(status))
          await saveDraft(page).click()
          await expectErrorToast(page, EXPECTED_MESSAGE[status])
          await expect(saveDraft(page)).toBeEnabled()
          await expect(saveDraft(page)).toHaveText(/save draft/i)
          await expect(submitReport(page)).toBeEnabled()
          await expect(firstCell(page)).toHaveValue('17')
          await expect(toast(page, /draft saved|report submitted/i)).toHaveCount(0)
          await expect(page.getByText(/draft saved at/i)).toHaveCount(0)
          // Give any runaway retry a moment to show itself before counting.
          await page.waitForTimeout(2_500)
          expect(requests.count, `one save request for the ${status} attempt, no automatic re-fire`).toBe(before + 1)
        })
      }

      // 409 (a stale copy): no error toast; the conflict panel carries the
      // server's message and the save controls pause until it is resolved.
      await dismissToasts(page)
      interceptor.always(statusFailure(409))
      await saveDraft(page).click()
      const conflictPanel = page.getByTestId('report-conflict-panel')
      await expect(conflictPanel).toBeVisible({ timeout: 10_000 })
      await expect(conflictPanel).toContainText('This report was changed elsewhere after you loaded it')
      // The typed value is shown in the review table, not lost.
      await expect(conflictPanel).toContainText('17')
      await expect(saveDraft(page)).toBeDisabled()
      await expect(submitReport(page)).toBeDisabled()
      await expect(firstCell(page)).toHaveValue('17')
      await expect(toast(page, EXPECTED_MESSAGE[409])).toHaveCount(0)

      // "Try again" with the interception cleared: the real save lands and the
      // panel goes away.
      interceptor.always(null)
      await page.getByTestId('conflict-apply').click()
      await expect(conflictPanel).toBeHidden({ timeout: 20_000 })
      await expect(page.getByText(/draft saved at/i)).toBeVisible({ timeout: 20_000 })
      await expect(saveDraft(page)).toBeEnabled()
      expect(interceptor.passed).toBe(1)

      // The page still navigates.
      await page.getByRole('button', { name: /back to my reports/i }).click()
      await expect(page).toHaveURL(/\/nurse\/reports/)
      await interceptor.dispose()
    } finally {
      await context.close()
    }
  })

  test('submit: a rejected submission shows no success state and the retry submits exactly once', async ({
    browser,
  }) => {
    const { context, page } = await newPageAs(browser, 'nurse')
    try {
      const requests = countRequests(page, SAVE)
      const interceptor = await intercept(page, SAVE)
      await openReport(page)
      await firstCell(page).fill('23')
      // Let the autosave settle so the click below is the only save on the wire,
      // then arm the failures for the explicit submit.
      await expect(page.getByText(/draft autosaved at/i)).toBeVisible({ timeout: 20_000 })
      const baseline = requests.count
      const passedBefore = interceptor.passed
      // A re-run against the same database may open an already-submitted
      // report; what matters is that a rejection adds no submitted state.
      const submittedBadges = page.getByText(/^submitted /i)
      const badgesBefore = await submittedBadges.count()
      interceptor.fail(statusFailure(422), statusFailure(503))

      await submitReport(page).click()
      await expectErrorToast(page, EXPECTED_MESSAGE[422])
      await expect(submitReport(page)).toBeEnabled()
      await expect(toast(page, /report submitted/i)).toHaveCount(0)
      await expect(page.getByText(/report submitted at/i)).toHaveCount(0)
      await expect(submittedBadges).toHaveCount(badgesBefore)
      expect(requests.count).toBe(baseline + 1)

      await dismissToasts(page)
      await submitReport(page).click()
      await expectErrorToast(page, EXPECTED_MESSAGE[503])
      await expect(submitReport(page)).toBeEnabled()
      expect(requests.count).toBe(baseline + 2)

      await dismissToasts(page)
      await submitReport(page).click()
      await expect(toast(page, /report submitted/i).first()).toBeVisible({ timeout: 20_000 })
      expect(requests.count).toBe(baseline + 3)
      expect(interceptor.passed - passedBefore, 'exactly one submission reached the API').toBe(1)
      await interceptor.dispose()
    } finally {
      await context.close()
    }
  })

  test('report lock and unlock: failures are reported, the toggle stays usable and a retry lands', async ({
    browser,
  }) => {
    // The report the nurse tests above just submitted.
    const { context, page } = await newPageAs(browser, 'superadmin')
    try {
      const lockMatcher: Matcher = { method: 'POST', path: /^\/api\/reports\/[^/]+\/lock$/ }
      const unlockMatcher: Matcher = { method: 'POST', path: /^\/api\/reports\/[^/]+\/unlock$/ }
      const lockRequests = countRequests(page, lockMatcher)
      const lockInterceptor = await intercept(page, lockMatcher, statusFailure(500), statusFailure(409))
      await page.goto(`/reports/${assignmentId}/${periodId}`, { waitUntil: 'domcontentloaded' })
      const lockButton = page.getByRole('button', { name: /^lock(ing)? report/i })
      await expect(lockButton).toBeVisible({ timeout: 20_000 })

      await lockButton.click()
      await expectErrorToast(page, EXPECTED_MESSAGE[500])
      await expect(lockButton).toBeEnabled()
      await expect(page.getByRole('button', { name: /unlock report/i })).toHaveCount(0)
      expect(lockRequests.count).toBe(1)

      // A double-click must not send the lock twice.
      await dismissToasts(page)
      lockInterceptor.always(statusFailure(409))
      await lockButton.dblclick()
      await expectErrorToast(page, EXPECTED_MESSAGE[409])
      await expect(lockButton).toBeEnabled()
      expect(lockRequests.count, 'one lock request for a double-click').toBe(2)

      lockInterceptor.always(null)
      await dismissToasts(page)
      await lockButton.click()
      const unlockButton = page.getByRole('button', { name: /^unlock(ing)? report/i })
      await expect(unlockButton).toBeVisible({ timeout: 20_000 })
      await expect(page.getByText(/this report is read only/i)).toBeVisible()
      await lockInterceptor.dispose()

      const unlockInterceptor = await intercept(page, unlockMatcher, statusFailure(503))
      await unlockButton.click()
      await expectErrorToast(page, EXPECTED_MESSAGE[503])
      await expect(unlockButton).toBeEnabled()
      await expect(page.getByText(/this report is read only/i)).toBeVisible()

      await dismissToasts(page)
      await unlockButton.click()
      await expect(lockButton).toBeVisible({ timeout: 20_000 })
      expect(unlockInterceptor.passed).toBe(1)
      await unlockInterceptor.dispose()
    } finally {
      await context.close()
    }
  })

  test('a dropped connection during a save hands the report to the offline queue instead of failing', async ({
    browser,
  }) => {
    const { context, page } = await newPageAs(browser, 'nurse')
    try {
      await openReport(page)
      // The report is submitted by now; an admin unlock is not needed for a
      // draft save on a submitted report (edits after submission are allowed).
      await firstCell(page).fill('29')
      const interceptor = await intercept(page, SAVE, { abort: true })
      await saveDraft(page).click()
      // No error toast: the save is parked in the offline queue (its replay and
      // conflict handling are covered by offline-sync.spec.ts).
      await expect(page.getByText(/queued offline/i).first()).toBeVisible({ timeout: 15_000 })
      await expect(page.getByText('Offline save queued')).toBeVisible()
      await expect(toast(page, /unable to save|failed to fetch/i)).toHaveCount(0)
      await expect(saveDraft(page)).toBeEnabled()
      expect(interceptor.failed).toBe(1)
      await interceptor.dispose()
    } finally {
      await context.close()
    }
  })
})

// ---------------------------------------------------------------------------
// Admin: report lock / unlock, role change, settings, action items, export,
// notifications, students
// ---------------------------------------------------------------------------

test.describe('Admin mutation failure recovery', () => {
  test.describe.configure({ mode: 'serial' })

  test('role change: a rejected change snaps the select back, shows the reason, and a retry applies it', async ({
    browser,
  }) => {
    // A nurse of our own with no assignments, so the change can really succeed.
    const admin = await apiAs('superadmin')
    const token = await xsrfToken(admin)
    const nonce = Date.now().toString(36)
    const fullName = `${QA_MARKER} Role Nurse ${nonce}`
    const created = await admin.post('/api/admin/users', {
      headers: ajaxHeaders(token),
      data: {
        fullName,
        email: `qa.failure.role.${nonce}@stpaulos.local`,
        password: QA_ACCOUNT_PASSWORD,
        role: 'nurse',
      },
    })
    expect(created.status(), 'the QA nurse must be created').toBe(201)
    const userId = (await created.json()).id

    const { context, page } = await newPageAs(browser, 'superadmin')
    try {
      const matcher: Matcher = { method: 'PATCH', path: `/api/admin/users/${userId}` }
      const requests = countRequests(page, matcher)
      const reason = "Retire this nurse's active reporting assignments before changing their role."
      const rejection = { status: 422, body: { message: reason, errors: { role: [reason] } } }
      const interceptor = await intercept(page, matcher, rejection, statusFailure(500))
      await page.goto('/admin/users')
      const search = page.getByPlaceholder('Search name or email')
      await expect(search).toBeVisible({ timeout: 20_000 })
      await search.fill(fullName)
      await page.getByRole('button', { name: `Show ${fullName} assignments` }).click()
      const roleSelect = page.getByRole('combobox', { name: `Role for ${fullName}` })
      await expect(roleSelect).toBeVisible()

      const pick = async () => {
        await roleSelect.click()
        await page.getByRole('option', { name: 'Student representative' }).click()
      }

      await pick()
      await expectErrorToast(page, reason)
      await expect(roleSelect).toBeEnabled()
      await expect(roleSelect).toHaveText('Nurse')
      await expect(page.getByText(/^Saving\.\.\.$/)).toHaveCount(0)
      expect(requests.count).toBe(1)

      await dismissToasts(page)
      await pick()
      await expectErrorToast(page, EXPECTED_MESSAGE[500])
      await expect(roleSelect).toHaveText('Nurse')
      expect(requests.count).toBe(2)

      await dismissToasts(page)
      await pick()
      await expect(toast(page, `${fullName} is now a student rep`).first()).toBeVisible({ timeout: 20_000 })
      expect(interceptor.passed).toBe(1)
      await interceptor.dispose()
    } finally {
      await context.close()
      await admin.delete(`/api/admin/users/${userId}`, { headers: ajaxHeaders(token) })
      await admin.dispose()
    }
  })

  test('settings save: failures keep the unsaved edits and the button, a retry saves', async ({ browser }) => {
    const { context, page } = await newPageAs(browser, 'superadmin')
    try {
      const matcher: Matcher = { method: 'PATCH', path: '/api/admin/settings' }
      const requests = countRequests(page, matcher)
      const reason = 'The auto lock hours after deadline field must be at least 1.'
      const validation = { status: 422, body: { message: reason, errors: { autoLockHoursAfterDeadline: [reason] } } }
      const interceptor = await intercept(page, matcher, validation, statusFailure(409), statusFailure(502))
      await page.goto('/admin/settings')
      const toggle = page.getByRole('switch', { name: 'Enforce weekly deadlines' })
      await expect(toggle).toBeVisible({ timeout: 20_000 })
      const initiallyOn = (await toggle.getAttribute('aria-checked')) === 'true'
      const save = page.getByRole('button', { name: /save settings|saving/i })

      await toggle.click()
      await expect(page.getByText('Unsaved changes')).toBeVisible()
      for (const message of [reason, EXPECTED_MESSAGE[409], EXPECTED_MESSAGE[502]]) {
        await dismissToasts(page)
        await save.click()
        await expectErrorToast(page, message)
        await expect(save).toBeEnabled()
        await expect(save).toHaveText(/save settings/i)
        // The edit survives and is still flagged as unsaved.
        await expect(toggle).toHaveAttribute('aria-checked', String(!initiallyOn))
        await expect(page.getByText('Unsaved changes')).toBeVisible()
      }
      expect(requests.count).toBe(3)

      await dismissToasts(page)
      await save.click()
      await expect(page.getByText('Saved', { exact: true })).toBeVisible({ timeout: 20_000 })
      await expect(toggle).toHaveAttribute('aria-checked', String(!initiallyOn))
      expect(interceptor.passed).toBe(1)

      // Restore the fixture value.
      await toggle.click()
      await save.click()
      await expect(page.getByText('Saved', { exact: true })).toBeVisible({ timeout: 20_000 })
      await expect(toggle).toHaveAttribute('aria-checked', String(initiallyOn))
      await interceptor.dispose()
    } finally {
      await context.close()
    }
  })

  test('action item transition, evidence upload and note: failures keep the sheet and input, retries succeed', async ({
    browser,
  }) => {
    const { context, page } = await newPageAs(browser, 'superadmin')
    try {
      await page.goto('/admin/action-items')
      const open = page.getByRole('button', { name: /^Open / }).first()
      await expect(open).toBeVisible({ timeout: 20_000 })
      await open.click()
      const sheet = page.getByRole('dialog')
      await expect(sheet).toBeVisible()

      // Transition: choose an owner and start the investigation.
      const patch: Matcher = { method: 'PATCH', path: /^\/api\/admin\/action-items\/[^/]+$/ }
      const patchRequests = countRequests(page, patch)
      const reason = 'Assign an active administrator before starting this work.'
      const guard = { status: 422, body: { message: reason, errors: { status: [reason] } } }
      const patchInterceptor = await intercept(page, patch, guard, statusFailure(500))
      await sheet.getByRole('combobox', { name: 'Action owner' }).click()
      await page.getByRole('option').filter({ hasNotText: /unassigned/i }).first().click()
      const start = sheet.getByRole('button', { name: 'Start' })
      await expect(start).toBeEnabled()

      await start.click()
      await expectErrorToast(page, reason)
      await expect(sheet).toBeVisible()
      await expect(start).toBeEnabled()
      await expect(toast(page, /investigation started/i)).toHaveCount(0)
      expect(patchRequests.count).toBe(1)

      await dismissToasts(page)
      await start.click()
      await expectErrorToast(page, EXPECTED_MESSAGE[500])
      await expect(start).toBeEnabled()
      expect(patchRequests.count).toBe(2)

      await dismissToasts(page)
      await start.click()
      await expect(toast(page, /investigation started/i).first()).toBeVisible({ timeout: 20_000 })
      expect(patchInterceptor.passed).toBe(1)
      await patchInterceptor.dispose()

      // Evidence upload.
      const evidence: Matcher = { method: 'POST', path: /^\/api\/admin\/action-items\/[^/]+\/evidence$/ }
      const evidenceRequests = countRequests(page, evidence)
      const tooLarge = {
        status: 422,
        body: { message: 'Files up to 10 MB are allowed.', errors: { file: ['Files up to 10 MB are allowed.'] } },
      }
      const evidenceInterceptor = await intercept(page, evidence, tooLarge)
      const file = {
        name: `${QA_MARKER}-evidence.txt`,
        mimeType: 'text/plain',
        buffer: Buffer.from('failure-recovery evidence'),
      }
      await sheet.getByLabel('Upload').setInputFiles(file)
      await expectErrorToast(page, tooLarge.body.message)
      await expect(sheet).toBeVisible()
      await expect(toast(page, /evidence uploaded/i)).toHaveCount(0)
      expect(evidenceRequests.count).toBe(1)

      await dismissToasts(page)
      await sheet.getByLabel('Upload').setInputFiles(file)
      await expect(toast(page, /evidence uploaded/i).first()).toBeVisible({ timeout: 20_000 })
      expect(evidenceInterceptor.passed).toBe(1)
      await evidenceInterceptor.dispose()

      // Note.
      const comment: Matcher = { method: 'POST', path: /^\/api\/admin\/action-items\/[^/]+\/comments$/ }
      const commentInterceptor = await intercept(page, comment, statusFailure(503))
      const note = sheet.getByPlaceholder('Add a note')
      const noteText = `${QA_MARKER} failure recovery note`
      await note.fill(noteText)
      const addNote = sheet.getByRole('button', { name: 'Add note' })
      await addNote.click()
      await expectErrorToast(page, EXPECTED_MESSAGE[503])
      await expect(note).toHaveValue(noteText)
      await expect(addNote).toBeEnabled()

      await dismissToasts(page)
      await addNote.click()
      await expect(toast(page, /note added/i).first()).toBeVisible({ timeout: 20_000 })
      await expect(note).toHaveValue('')
      expect(commentInterceptor.passed).toBe(1)
      await commentInterceptor.dispose()

      // The shell still navigates after the sheet closes.
      await page.keyboard.press('Escape')
      await expect(sheet).toBeHidden()
      await page.getByRole('button', { name: 'Notifications' }).first().click()
      await expect(page).toHaveURL(/\/admin\/notifications/)
    } finally {
      await context.close()
    }
  })

  test('export request: a failed queue leaves no phantom export and re-enables the button; a retry queues', async ({
    browser,
  }) => {
    const { context, page } = await newPageAs(browser, 'superadmin')
    try {
      const matcher: Matcher = { method: 'POST', path: '/api/analytics/exports' }
      const requests = countRequests(page, matcher)
      const interceptor = await intercept(page, matcher, statusFailure(429), statusFailure(500))
      await page.goto('/admin/export')
      const build = page.getByRole('button', { name: /build export|queued|building/i })
      await expect(build).toBeVisible({ timeout: 20_000 })
      if (!(await build.isEnabled())) {
        // The all-time scope can exceed the export limit: narrow it to eight weeks.
        const from = new Date(Date.now() - 56 * 24 * 3_600_000).toISOString().slice(0, 10)
        await page.getByLabel('From').fill(from)
      }
      await expect(build).toBeEnabled({ timeout: 20_000 })

      for (const status of [429, 500]) {
        await dismissToasts(page)
        await build.click()
        await expectErrorToast(page, EXPECTED_MESSAGE[status])
        await expect(build).toBeEnabled()
        await expect(build).toHaveText(/build export/i)
        await expect(toast(page, /export queued/i)).toHaveCount(0)
      }
      expect(requests.count).toBe(2)

      await dismissToasts(page)
      await build.click()
      await expect(toast(page, /export queued/i).first()).toBeVisible({ timeout: 20_000 })
      expect(interceptor.passed).toBe(1)
      await interceptor.dispose()
    } finally {
      await context.close()
    }
  })

  test('notifications: mark-all-read, clear and restore report failures without touching the inbox; retries apply', async ({
    browser,
  }) => {
    const { context, page } = await newPageAs(browser, 'superadmin')
    try {
      const read: Matcher = { method: 'PATCH', path: '/api/notifications/read' }
      const clear: Matcher = { method: 'DELETE', path: '/api/notifications' }
      const restore: Matcher = { method: 'POST', path: '/api/notifications/restore' }
      const readRequests = countRequests(page, read)
      const readInterceptor = await intercept(page, read, statusFailure(500))
      await page.goto('/admin/notifications')
      const markAll = page.getByRole('button', { name: 'Mark all read' })
      await expect(markAll).toBeVisible({ timeout: 20_000 })
      const unreadSegment = page.getByRole('button', { name: /^Unread \d+$/ })
      const unreadBefore = await unreadSegment.textContent()

      await markAll.click()
      await expectErrorToast(page, EXPECTED_MESSAGE[500])
      await expect(markAll).toBeVisible()
      await expect(unreadSegment).toHaveText(unreadBefore ?? '')
      expect(readRequests.count).toBe(1)

      // A double-click must not send the same mark-read twice.
      await dismissToasts(page)
      readInterceptor.always(statusFailure(503))
      await markAll.dblclick()
      await expectErrorToast(page, EXPECTED_MESSAGE[503])
      expect(readRequests.count, 'one mark-read request for a double-click').toBe(2)

      readInterceptor.always(null)
      await dismissToasts(page)
      await markAll.click()
      await expect(markAll).toBeHidden({ timeout: 20_000 })
      await expect(page.getByRole('button', { name: /^Unread 0$/ })).toBeVisible()
      await readInterceptor.dispose()

      const clearInterceptor = await intercept(page, clear, statusFailure(403))
      const clearButton = page.getByRole('button', { name: 'Clear inbox' })
      // The "All N" segment counts the inbox; N is what a clear must remove
      // and a restore must bring back.
      const allSegment = page.getByRole('button', { name: /^All \d+$/ })
      const inboxSize = Number((await allSegment.textContent())?.replace(/\D/g, ''))
      expect(inboxSize).toBeGreaterThan(0)
      await clearButton.click()
      await expectErrorToast(page, EXPECTED_MESSAGE[403])
      await expect(allSegment).toHaveText(new RegExp(`^All\\s*${inboxSize}$`))
      await expect(clearButton).toBeEnabled()

      await dismissToasts(page)
      await clearButton.click()
      await expect(page.getByText('Cleared notifications can still be restored.')).toBeVisible({ timeout: 20_000 })
      await expect(page.getByRole('button', { name: /^All 0$/ })).toBeVisible()
      expect(clearInterceptor.passed).toBe(1)
      await clearInterceptor.dispose()

      const restoreInterceptor = await intercept(page, restore, statusFailure(500))
      const restoreButton = page.getByRole('button', { name: 'Restore' })
      await restoreButton.click()
      await expectErrorToast(page, EXPECTED_MESSAGE[500])
      await expect(restoreButton).toBeVisible()
      await expect(page.getByRole('button', { name: /^All 0$/ })).toBeVisible()

      await dismissToasts(page)
      await restoreButton.click()
      // The whole inbox comes back, however large (the API restores 50 per call).
      await expect(allSegment).toHaveText(new RegExp(`^All\\s*${inboxSize}$`), { timeout: 20_000 })
      expect(restoreInterceptor.passed).toBeGreaterThanOrEqual(1)
      await restoreInterceptor.dispose()
    } finally {
      await context.close()
    }
  })

  test('student roster: a failed active toggle leaves the switch as it was; a retry applies and is reverted', async ({
    browser,
  }) => {
    const { context, page } = await newPageAs(browser, 'superadmin')
    try {
      const matcher: Matcher = { method: 'PATCH', path: /^\/api\/admin\/students\/[^/]+$/ }
      const requests = countRequests(page, matcher)
      const interceptor = await intercept(page, matcher, statusFailure(422), statusFailure(500))
      await page.goto('/admin/academic/students')
      await page.getByRole('tab', { name: /^Students/ }).click()
      const toggle = page.getByRole('switch', { name: /^Toggle .* active$/ }).first()
      await expect(toggle).toBeVisible({ timeout: 20_000 })
      const before = await toggle.getAttribute('aria-checked')

      for (const status of [422, 500]) {
        await dismissToasts(page)
        await toggle.click()
        await expectErrorToast(page, EXPECTED_MESSAGE[status])
        await expect(toggle).toHaveAttribute('aria-checked', before ?? 'true')
        await expect(toggle).toBeEnabled()
      }
      expect(requests.count).toBe(2)

      await dismissToasts(page)
      await toggle.click()
      await expect(toggle).toHaveAttribute('aria-checked', String(before !== 'true'), { timeout: 20_000 })
      expect(interceptor.passed).toBe(1)

      // Put the fixture back.
      await toggle.click()
      await expect(toggle).toHaveAttribute('aria-checked', before ?? 'true', { timeout: 20_000 })
      expect(interceptor.passed).toBe(2)
      await interceptor.dispose()
    } finally {
      await context.close()
    }
  })
})

// ---------------------------------------------------------------------------
// Academic: evaluation submission (resident), section transfer (consultant),
// password change
// ---------------------------------------------------------------------------

test.describe('Academic and account mutation failure recovery', () => {
  test('evaluation submission: rejections keep every answer and re-enable submit; the retry submits once', async ({
    browser,
  }) => {
    // A (date, consultant) pair the resident has not evaluated yet, today first.
    const residentApi = await apiAs('resident')
    let targetDate = ''
    let subject: any = null
    try {
      const options = async (date?: string): Promise<any> => {
        const res = await residentApi.get(`/api/academic/form-options${date ? `?date=${date}` : ''}`, {
          headers: ajaxHeaders(),
        })
        expect(res.status()).toBe(200)
        return res.json()
      }
      const serverToday: string = (await options()).date
      const submissions: any[] =
        ((await (await residentApi.get('/api/academic/my-submissions', { headers: ajaxHeaders() })).json())
          .data as any[]) ?? []
      for (let back = 0; back < 7 && !subject; back += 1) {
        const day = new Date(`${serverToday}T00:00:00Z`)
        day.setUTCDate(day.getUTCDate() - back)
        const date = day.toISOString().slice(0, 10)
        const free = ((await options(date)).subjects ?? []).filter(
          (candidate: any) =>
            !submissions.some(
              (done) => done.subjectId === candidate.id && String(done.evaluationDate).slice(0, 10) === date,
            ),
        )
        if (free.length) {
          targetDate = date
          subject = free.find((candidate: any) => candidate.fullName === ACCOUNTS.consultant.fullName) ?? free[0]
        }
      }
      expect(subject, 'the seed must pair the resident with an un-evaluated consultant').toBeTruthy()
    } finally {
      await residentApi.dispose()
    }

    const { context, page } = await newPageAs(browser, 'resident')
    try {
      const matcher: Matcher = { method: 'POST', path: '/api/academic/consultant-evaluations' }
      const requests = countRequests(page, matcher)
      const reason = 'You have already submitted this evaluation for that person on that date.'
      const interceptor = await intercept(
        page,
        matcher,
        { status: 422, body: { message: reason, errors: { subjectId: [reason] } } },
        statusFailure(503),
      )
      await page.goto('/academic/submit', { waitUntil: 'domcontentloaded' })
      const submit = page.getByRole('button', { name: /submit evaluation|submitting/i })
      await expect(submit).toBeVisible({ timeout: 20_000 })
      await page.locator('#evaluationDate').fill(targetDate)
      await expect(submit).toBeVisible({ timeout: 20_000 })

      const subjectSelect = page.getByRole('combobox', { name: 'Consultant evaluated' })
      await subjectSelect.click()
      await page.getByRole('option', { name: subject.fullName, exact: true }).click()
      const rating = page.getByRole('radiogroup', { name: 'Overall rating' }).getByRole('radio', { name: '5', exact: true })
      await rating.click()
      const comment = page.getByLabel('Additional comment')
      const commentText = `${QA_MARKER} failure recovery`
      await comment.fill(commentText)

      for (const message of [reason, EXPECTED_MESSAGE[503]]) {
        await dismissToasts(page)
        await submit.click()
        await expectErrorToast(page, message)
        await expect(submit).toBeEnabled()
        await expect(submit).toHaveText(/submit evaluation/i)
        await expect(toast(page, /evaluation submitted/i)).toHaveCount(0)
        // Every answer survives the rejection.
        await expect(subjectSelect).toHaveText(subject.fullName)
        await expect(rating).toHaveAttribute('aria-checked', 'true')
        await expect(comment).toHaveValue(commentText)
        await expect(page).toHaveURL(/\/academic\/submit/)
      }
      expect(requests.count).toBe(2)

      await dismissToasts(page)
      await submit.click()
      await expect(toast(page, /evaluation submitted/i).first()).toBeVisible({ timeout: 20_000 })
      // The form resets only after the real success.
      await expect(subjectSelect).toHaveText(/select consultant evaluated/i)
      expect(requests.count).toBe(3)
      expect(interceptor.passed).toBe(1)
      await interceptor.dispose()
    } finally {
      await context.close()
    }
  })

  test('section transfer request and cancel: failures keep the form, retries file and withdraw the request', async ({
    browser,
  }) => {
    // Start from a clean slate: withdraw any pending request of the consultant.
    const consultantApi = await apiAs('consultant')
    try {
      const token = await xsrfToken(consultantApi)
      const mine: any[] =
        ((await (await consultantApi.get('/api/academic/transfer-requests/mine', { headers: ajaxHeaders() })).json())
          .data as any[]) ?? []
      for (const request of mine.filter((item) => item.status === 'pending')) {
        await consultantApi.post(`/api/academic/transfer-requests/${request.id}/cancel`, {
          headers: ajaxHeaders(token),
        })
      }
    } finally {
      await consultantApi.dispose()
    }

    const { context, page } = await newPageAs(browser, 'consultant')
    try {
      const create: Matcher = { method: 'POST', path: '/api/academic/transfer-requests' }
      const cancel: Matcher = { method: 'POST', path: /^\/api\/academic\/transfer-requests\/[^/]+\/cancel$/ }
      const createRequests = countRequests(page, create)
      const reason = 'You already have a pending transfer request. Cancel it before filing a new one.'
      const createInterceptor = await intercept(
        page,
        create,
        { status: 422, body: { message: reason, errors: { toSectionId: [reason] } } },
        statusFailure(500),
      )
      await page.goto('/academic', { waitUntil: 'domcontentloaded' })
      const section = page.getByRole('combobox', { name: 'Destination section' })
      await expect(section).toBeVisible({ timeout: 20_000 })
      await section.click()
      const firstOption = page.getByRole('option').first()
      const sectionName = (await firstOption.textContent())?.trim() ?? ''
      await firstOption.click()
      const reasonBox = page.getByRole('textbox', { name: 'Transfer reason' })
      const reasonText = `${QA_MARKER} failure recovery transfer`
      await reasonBox.fill(reasonText)
      const request = page.getByRole('button', { name: 'Request transfer' })

      for (const message of [reason, EXPECTED_MESSAGE[500]]) {
        await dismissToasts(page)
        await request.click()
        await expectErrorToast(page, message)
        await expect(request).toBeEnabled()
        await expect(section).toHaveText(sectionName)
        await expect(reasonBox).toHaveValue(reasonText)
        await expect(toast(page, /transfer request sent/i)).toHaveCount(0)
      }
      expect(createRequests.count).toBe(2)

      await dismissToasts(page)
      await request.click()
      await expect(toast(page, /transfer request sent to the section head/i).first()).toBeVisible({
        timeout: 20_000,
      })
      expect(createInterceptor.passed).toBe(1)
      await createInterceptor.dispose()

      // Withdraw it: one failure, then the real cancel.
      const cancelInterceptor = await intercept(page, cancel, statusFailure(503))
      const cancelButton = page.getByRole('button', { name: 'Cancel', exact: true }).first()
      await expect(cancelButton).toBeVisible({ timeout: 20_000 })
      await cancelButton.click()
      await expectErrorToast(page, EXPECTED_MESSAGE[503])
      await expect(cancelButton).toBeEnabled()

      await dismissToasts(page)
      await cancelButton.click()
      await expect(toast(page, /transfer request cancelled/i).first()).toBeVisible({ timeout: 20_000 })
      await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toHaveCount(0)
      expect(cancelInterceptor.passed).toBe(1)
      await cancelInterceptor.dispose()
    } finally {
      await context.close()
    }
  })

  test('password change: rejections keep the form usable and show the reason; the retry changes and is reverted', async ({
    browser,
  }) => {
    // A real rotation (even one reverted straight away) re-hashes the
    // password, and Laravel's AuthenticateSession then signs every other
    // session of that user out, including the shared storageState the rest of
    // the suite relies on. Use a second seeded nurse with a fresh session.
    const rotatingNurse = await apiLoginRaw('hana.abera@stpaulhospital.demo', DEV_PASSWORD)
    const context = await browser.newContext({ storageState: await rotatingNurse.storageState() })
    await rotatingNurse.dispose()
    const page = await context.newPage()
    const newPassword = `${DEV_PASSWORD}Rotated1`
    let rotated = false
    try {
      const matcher: Matcher = { method: 'POST', path: '/api/auth/change-password' }
      const requests = countRequests(page, matcher)
      const wrongCurrent = 'Your current password is incorrect.'
      const interceptor = await intercept(
        page,
        matcher,
        { status: 422, body: { message: wrongCurrent, errors: { current_password: [wrongCurrent] } } },
        statusFailure(429),
        statusFailure(500),
      )
      await page.goto('/change-password')
      const current = page.locator('#current-password')
      await expect(current).toBeVisible({ timeout: 20_000 })
      const next = page.locator('#new-password')
      const confirm = page.locator('#confirm-password')
      const update = page.getByRole('button', { name: /update password|saving/i })

      await current.fill(DEV_PASSWORD)
      await next.fill(newPassword)
      await confirm.fill(newPassword)

      for (const message of [wrongCurrent, EXPECTED_MESSAGE[429], EXPECTED_MESSAGE[500]]) {
        await dismissToasts(page)
        await update.click()
        await expectErrorToast(page, message)
        await expect(update).toBeEnabled()
        await expect(update).toHaveText(/update password/i)
        await expect(current).toHaveValue(DEV_PASSWORD)
        await expect(next).toHaveValue(newPassword)
        await expect(page).toHaveURL(/\/change-password/)
        await expect(toast(page, /password updated/i)).toHaveCount(0)
      }
      expect(requests.count).toBe(3)

      await dismissToasts(page)
      const changed = page.waitForResponse(
        (response) => new URL(response.url()).pathname === matcher.path && response.status() === 200,
      )
      await update.click()
      await changed
      rotated = true
      await expect(toast(page, /password updated/i).first()).toBeVisible({ timeout: 20_000 })
      await page.waitForURL(/\/nurse/, { timeout: 20_000 })
      expect(interceptor.passed).toBe(1)
      await interceptor.dispose()
    } finally {
      if (rotated) {
        // Put the dev password back over the API: the page's own policy asks
        // for 12 characters and the fixture password is shorter.
        const cookies = await context.cookies()
        const token = decodeURIComponent(cookies.find((cookie) => cookie.name === 'XSRF-TOKEN')?.value ?? '')
        const reverted = await page.request.post('/api/auth/change-password', {
          headers: ajaxHeaders(token),
          data: { current_password: newPassword, password: DEV_PASSWORD, password_confirmation: DEV_PASSWORD },
        })
        expect(reverted.status(), 'the fixture password must be restored').toBe(200)
      }
      await context.close()
    }
  })
})
