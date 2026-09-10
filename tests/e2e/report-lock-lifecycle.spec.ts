import { test, expect, type APIRequestContext, type Page } from '@playwright/test'
import { apiContextFromState, ajaxHeaders, xsrfToken } from './helpers/api'
import { authFile } from './helpers/auth'

/**
 * Business rule: a lock is an overlay on the report lifecycle, not a step in
 * it. Locking never submits a draft; unlocking restores the pre-lock state
 * (a draft stays a draft, a submitted report stays submitted). Submission
 * happens only through the Submit action.
 *
 * Regression for the defect where lock + unlock on a DRAFT marked it
 * "submitted" (ReportLockingService restored submitted/edited_after_submission
 * unconditionally). Every transition is re-read through the API and the
 * status history, and the nurse's real form is checked after the unlock.
 *
 * The seeded nurse gets a dedicated assignment in a department nobody reports
 * for (retired afterwards). The weekly deadline is moved to Sunday 23:59 for
 * this spec (restored afterwards): after Monday 10:00 the form shows the
 * derived "Overdue" state for an unsubmitted current-week draft, and the rule
 * under test is the persisted lifecycle state, which the card shows as "Draft".
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

test.describe('Report lock lifecycle preserves the pre-lock state', () => {
  test.describe.configure({ mode: 'serial' })

  let nurseApi: APIRequestContext
  let assignmentId = ''
  let periodId = ''
  let reportId = ''
  let originalDeadline: { weeklyDeadlineDay: string; weeklyDeadlineTime: string } | null = null

  async function asAdmin<T>(fn: (admin: APIRequestContext, token: string | null) => Promise<T>): Promise<T> {
    const admin = await apiContextFromState('superadmin')
    try {
      return await fn(admin, await xsrfToken(admin))
    } finally {
      await admin.dispose()
    }
  }

  async function report(): Promise<any> {
    const res = await nurseApi.get(`/api/reports/${reportId}`, { headers: ajaxHeaders() })
    expect(res.status()).toBe(200)
    return res.json()
  }

  /**
   * Status-history rows carry second-precision timestamps and the endpoint
   * orders by them, so two transitions inside one second have no defined
   * order. Land each transition in its own second before asserting the trail.
   */
  const nextSecond = () => new Promise((resolve) => setTimeout(resolve, 1100))

  async function setLock(locked: boolean): Promise<any> {
    await nextSecond()
    return asAdmin(async (admin, token) => {
      const res = await admin.post(`/api/reports/${reportId}/${locked ? 'lock' : 'unlock'}`, {
        headers: ajaxHeaders(token),
      })
      expect(res.status(), `${locked ? 'lock' : 'unlock'} must succeed`).toBe(200)
      return res.json()
    })
  }

  /** Status-history statuses for the report, oldest first. */
  async function statusTrail(): Promise<string[]> {
    const res = await nurseApi.get('/api/reports/status-history?perPage=100', { headers: ajaxHeaders() })
    const rows: any[] = ((await res.json()).data ?? []).filter((row: any) => row.reportId === reportId)
    return rows
      .sort((a, b) => String(a.changedAt).localeCompare(String(b.changedAt)))
      .map((row) => row.status)
  }

  /** The "Status" summary card's value on the report form. */
  const statusCard = (page: Page) => page.locator('p:text-is("Status") + p').first()

  async function openForm(page: Page): Promise<void> {
    await page.goto(`/reports/${assignmentId}/${periodId}`, { waitUntil: 'domcontentloaded' })
    await expect(page.getByRole('spinbutton').first()).toBeVisible({ timeout: 20_000 })
  }

  async function saveDraft(page: Page): Promise<void> {
    await page.getByRole('button', { name: /save draft/i }).first().click()
    await expect(page.getByText(/draft saved|draft autosaved|all changes saved/i).first()).toBeVisible({
      timeout: 20_000,
    })
  }

  test.beforeAll(async () => {
    nurseApi = await apiContextFromState('nurse')

    const res = await nurseApi.get('/api/workspace?report_period_window=all', { headers: ajaxHeaders() })
    const workspace: any = await res.json()
    const state: any = workspace.state
    const periods: any[] = state.reportingPeriods ?? []
    expect(periods.length, 'the seed must expose an interactive reporting period').toBeGreaterThan(0)

    const assigned = new Set((state.assignments ?? []).map((a: any) => a.departmentId))
    const departmentIds: Record<string, string> = workspace.references?.departmentDbIdBySlug ?? {}
    const templateIds: Record<string, string> = workspace.references?.templateDbIdByDepartmentSlug ?? {}
    const candidates = Object.keys(departmentIds)
      .filter((slug) => !assigned.has(slug) && templateIds[slug])
      .sort()
    expect(candidates.length, 'need an unassigned department for an isolated lock lifecycle').toBeGreaterThan(0)
    periodId = periods[periods.length - 1].id

    await asAdmin(async (admin, token) => {
      // A retired assignment is re-activated with the same id when it is
      // created again, and its reports persist, so a department an earlier
      // spec already reported for this week would not start from a draft.
      // Walk the candidates from the far end until one has no report for the
      // current week; retire any slot that turns out to be used.
      for (const slug of [...candidates].reverse()) {
        const created = await admin.post('/api/admin/assignments', {
          headers: ajaxHeaders(token),
          data: { nurseId: state.currentUserId, departmentId: slug, templateId: templateIds[slug] },
        })
        expect([200, 201], 'the isolated nurse assignment must exist').toContain(created.status())
        const candidateId = (await created.json()).id
        const existing = await nurseApi.get(
          `/api/reports?assignment_id=${candidateId}&reporting_period_id=${periodId}`,
          { headers: ajaxHeaders() },
        )
        if ((((await existing.json()).data ?? []) as unknown[]).length === 0) {
          assignmentId = candidateId
          break
        }
        await admin.patch(`/api/admin/assignments/${candidateId}`, {
          headers: ajaxHeaders(token),
          data: { active: false },
        })
      }
      expect(assignmentId, 'need a department with no report for the current week').toBeTruthy()

      const settings = await admin.get('/api/admin/settings', { headers: ajaxHeaders() })
      const current = ((await settings.json()).settings ?? {}) as Record<string, string>
      originalDeadline = {
        weeklyDeadlineDay: current.weeklyDeadlineDay ?? 'monday',
        weeklyDeadlineTime: current.weeklyDeadlineTime ?? '10:00',
      }
      const moved = await admin.patch('/api/admin/settings', {
        headers: ajaxHeaders(token),
        data: { weeklyDeadlineDay: 'sunday', weeklyDeadlineTime: '23:59' },
      })
      expect(moved.status(), 'the deadline must move to the end of the week for this spec').toBe(200)
    })
  })

  test.afterAll(async () => {
    await asAdmin(async (admin, token) => {
      if (reportId) {
        await admin.post(`/api/reports/${reportId}/unlock`, { headers: ajaxHeaders(token) }).catch(() => undefined)
      }
      if (originalDeadline) {
        await admin.patch('/api/admin/settings', { headers: ajaxHeaders(token), data: originalDeadline })
      }
      if (assignmentId) {
        await admin.patch(`/api/admin/assignments/${assignmentId}`, {
          headers: ajaxHeaders(token),
          data: { active: false },
        })
      }
    })
    await nurseApi?.dispose()
  })

  test('a locked draft is handed back as a draft, never submitted', async ({ browser }) => {
    const context = await browser.newContext({ storageState: authFile('nurse') })
    const page = await context.newPage()
    try {
      await openForm(page)
      await page.getByRole('spinbutton').first().fill('17')
      await saveDraft(page)
    } finally {
      await context.close()
    }

    const list = await nurseApi.get(
      `/api/reports?assignment_id=${assignmentId}&reporting_period_id=${periodId}`,
      { headers: ajaxHeaders() },
    )
    reportId = (((await list.json()).data ?? [])[0] ?? {}).id ?? ''
    expect(reportId, 'the draft must have been created').toBeTruthy()

    let current = await report()
    expect(current.status).toBe('draft')
    expect(current.submittedAt).toBeNull()

    const locked = await setLock(true)
    expect(locked.status).toBe('locked')
    current = await report()
    expect(current.status).toBe('locked')
    expect(current.lockedAt).not.toBeNull()
    expect(current.submittedAt, 'a lock must not stamp a submission').toBeNull()

    const unlocked = await setLock(false)
    expect(unlocked.status, 'the unlock response restores the draft').toBe('draft')

    // Re-read independently of the unlock response.
    current = await report()
    expect(current.status).toBe('draft')
    expect(current.lockedAt).toBeNull()
    expect(current.submittedAt).toBeNull()
    expect(await statusTrail(), 'the trail records the lock cycle, no submission').toEqual([
      'draft',
      'locked',
      'draft',
    ])
  })

  test('after the unlock the nurse still sees a Draft and can save again', async ({ browser }) => {
    const context = await browser.newContext({ storageState: authFile('nurse') })
    const page = await context.newPage()
    try {
      await openForm(page)
      await expect(statusCard(page)).toHaveText('Draft')
      await expect(page.getByText(/^Submitted /)).toHaveCount(0)
      await expect(page.getByText('Working draft').first()).toBeVisible()
      await expect(page.getByText('Editing live').first()).toBeVisible()
      await expect(page.getByRole('spinbutton').first()).toHaveValue('17')
      await expect(page.getByRole('button', { name: /save draft/i }).first()).toBeEnabled()

      await page.getByRole('spinbutton').first().fill('18')
      await saveDraft(page)
    } finally {
      await context.close()
    }

    const current = await report()
    expect(current.status).toBe('draft')
    expect(current.submittedAt).toBeNull()
    const values = (current.values ?? {}) as Record<string, { dailyValues?: Record<string, unknown> }>
    const cells = Object.values(values).flatMap((field) => Object.values(field.dailyValues ?? {}).map(String))
    expect(cells).toContain('18')
  })

  test('a submitted report survives lock and unlock as submitted', async ({ browser }) => {
    const context = await browser.newContext({ storageState: authFile('nurse') })
    const page = await context.newPage()
    try {
      await openForm(page)
      await page.getByRole('button', { name: /submit report/i }).first().click()
      const outcome = await Promise.race([
        page.getByText(/report submitted/i).first().waitFor({ timeout: 20_000 }).then(() => 'submitted'),
        page
          .locator('p[role="status"]')
          .first()
          .filter({ hasText: /required|missing|invalid|must|complete/i })
          .waitFor({ timeout: 20_000 })
          .then(() => 'validation'),
      ]).catch(() => 'timeout')
      if (outcome === 'validation') {
        // The template wants more cells: fill the empty ones and submit again.
        const empties = page.getByRole('spinbutton')
        const n = await empties.count()
        for (let i = 0; i < n; i++) {
          const el = empties.nth(i)
          if ((await el.inputValue()) === '' && (await el.isEditable())) await el.fill('1')
        }
        await page.getByRole('button', { name: /submit report/i }).first().click()
        await expect(page.getByText(/report submitted/i).first()).toBeVisible({ timeout: 20_000 })
      }
      await expect(page.getByText(/^Submitted /).first()).toBeVisible({ timeout: 20_000 })
    } finally {
      await context.close()
    }

    let current = await report()
    expect(current.status).toBe('submitted')
    const submittedAt = current.submittedAt
    expect(submittedAt).not.toBeNull()

    expect((await setLock(true)).status).toBe('locked')
    expect((await setLock(false)).status).toBe('submitted')

    current = await report()
    expect(current.status).toBe('submitted')
    expect(current.lockedAt).toBeNull()
    expect(current.submittedAt, 'submitted_at survives the lock cycle unchanged').toBe(submittedAt)
    expect(await statusTrail()).toEqual(['draft', 'locked', 'draft', 'submitted', 'locked', 'submitted'])

    const view = await browser.newContext({ storageState: authFile('nurse') })
    const page2 = await view.newPage()
    try {
      await openForm(page2)
      await expect(statusCard(page2)).toHaveText('Submitted')
      await expect(page2.getByText(/^Submitted /).first()).toBeVisible()
    } finally {
      await view.close()
    }
  })
})
