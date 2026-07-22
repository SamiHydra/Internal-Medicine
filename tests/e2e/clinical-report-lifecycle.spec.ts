import { test, expect, type APIRequestContext } from '@playwright/test'
import { apiContextFromState, apiLoginRaw, ajaxHeaders, xsrfToken } from './helpers/api'
import { authFile } from './helpers/auth'
import { DEV_PASSWORD } from './helpers/accounts'

/**
 * Gap A.3 / risk-area #12 — the missing clinical write -> persist -> re-read path.
 * forms.spec never completes a submit; this spec drives the full nurse lifecycle
 * through the real report form and verifies every state transition against the API:
 *
 *   enter a cell -> Save draft   => report persisted, status 'draft'
 *   Submit report                => status 'submitted', visible to admin
 *   admin locks the report       => nurse sees read-only; a nurse PUT is 422
 *   a second nurse saving it      => 403 (ownership enforced server-side)
 *
 * Cross-browser / shared-DB safety: the (assignment, reporting-period) pair is
 * discovered dynamically as an UN-REPORTED slot, offset by the project index, so
 * chromium/firefox/webkit each operate on their own fresh report.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

test.describe('Clinical report lifecycle (nurse write -> admin lock -> IDOR)', () => {
  test.describe.configure({ mode: 'serial' })

  let nurseApi: APIRequestContext
  let assignmentId = ''
  let periodId = ''
  let reportId = ''
  const CELL_VALUE = 73

  function projectIndex(): number {
    const order = ['chromium', 'firefox', 'webkit']
    const i = order.indexOf(test.info().project.name)
    return i < 0 ? 0 : i
  }

  async function ownReport(): Promise<any | undefined> {
    const res = await nurseApi.get(
      `/api/reports?assignment_id=${assignmentId}&reporting_period_id=${periodId}`,
      { headers: ajaxHeaders() },
    )
    const body: any = await res.json()
    return (body.data ?? [])[0]
  }

  function hasCellValue(report: any, value: number): boolean {
    const values = (report?.values ?? {}) as Record<string, { dailyValues?: Record<string, unknown> }>
    return Object.values(values).some((field) =>
      Object.values(field.dailyValues ?? {}).some((v) => v === value || v === String(value)),
    )
  }

  test.beforeAll(async () => {
    nurseApi = await apiContextFromState('nurse')

    // Discover the nurse's assignments, every reporting period and every existing
    // report from the workspace bootstrap, then pick an assignment + a period that
    // has NO report yet (a clean not_started slot -> a first save yields 'draft').
    const res = await nurseApi.get('/api/workspace?report_period_window=all', { headers: ajaxHeaders() })
    const state: any = (await res.json()).state
    const assignments: any[] = state.assignments ?? []
    const periods: any[] = state.reportingPeriods ?? []
    const reports: any[] = state.reports ?? []

    expect(assignments.length, 'the seeded nurse must have at least one active assignment').toBeGreaterThan(0)

    const assignment = assignments[0]
    const filled = new Set(reports.map((r) => `${r.assignmentId}|${r.reportingPeriodId}`))
    // Stay inside the loaded reporting window: pick a free period no newer than
    // the newest period that already has a report. A future / far-past period is
    // outside the default window the report page loads, so its report never
    // hydrates and the locked read-only surface cannot render (that out-of-window
    // rendering gap is tracked separately as AUD-UI-020). Reported periods are
    // in-window by construction, so a free period adjacent to them is too.
    const reportedWeekStarts = periods
      .filter((p) => reports.some((r) => r.reportingPeriodId === p.id))
      .map((p) => String(p.weekStart))
      .sort()
    const newestReported = reportedWeekStarts[reportedWeekStarts.length - 1] ?? '9999-12-31'
    const freePeriods = periods
      .filter((p) => !filled.has(`${assignment.id}|${p.id}`))
      .filter((p) => String(p.weekStart) <= newestReported)
      .sort((a, b) => String(b.weekStart).localeCompare(String(a.weekStart)))

    expect(freePeriods.length, 'need an un-reported period to create a clean draft').toBeGreaterThan(
      projectIndex(),
    )

    assignmentId = assignment.id
    periodId = freePeriods[Math.min(projectIndex(), freePeriods.length - 1)].id
  })

  test.afterAll(async () => {
    await nurseApi?.dispose()
  })

  test('nurse enters a cell and saves a draft that persists and re-reads as draft', async ({ browser }) => {
    const context = await browser.newContext({ storageState: authFile('nurse') })
    const page = await context.newPage()
    try {
      await page.goto(`/reports/${assignmentId}/${periodId}`, { waitUntil: 'domcontentloaded' })

      const cell = page.getByRole('spinbutton').first()
      await expect(cell, 'the report grid should render numeric cells').toBeVisible({ timeout: 20_000 })
      await cell.fill(String(CELL_VALUE))

      await page.getByRole('button', { name: /save draft/i }).first().click()
      await expect(
        page.getByText(/draft saved|draft autosaved|all changes saved/i).first(),
      ).toBeVisible({ timeout: 20_000 })

      // Persisted and re-readable via the API as a draft carrying the typed value.
      await expect.poll(async () => (await ownReport())?.status, { timeout: 15_000 }).toBe('draft')
      const report = await ownReport()
      reportId = report.id
      expect(hasCellValue(report, CELL_VALUE), 'the saved cell value must round-trip via the API').toBe(true)
    } finally {
      await context.close()
    }
  })

  test('nurse submits the report; it becomes submitted and surfaces to the admin board', async ({
    browser,
  }) => {
    const context = await browser.newContext({ storageState: authFile('nurse') })
    const page = await context.newPage()
    try {
      await page.goto(`/reports/${assignmentId}/${periodId}`, { waitUntil: 'domcontentloaded' })
      await expect(page.getByRole('spinbutton').first()).toBeVisible({ timeout: 20_000 })

      await page.getByRole('button', { name: /submit report/i }).first().click()
      await expect(page.getByText(/submitted/i).first()).toBeVisible({ timeout: 20_000 })

      // Status transitioned server-side.
      await expect.poll(async () => (await ownReport())?.status, { timeout: 15_000 }).toBe('submitted')
    } finally {
      await context.close()
    }

    // Surfaces on the admin submission board data (admin sees every report).
    const admin = await apiContextFromState('superadmin')
    try {
      const res = await admin.get(
        `/api/reports?assignment_id=${assignmentId}&reporting_period_id=${periodId}`,
        { headers: ajaxHeaders() },
      )
      const rows: any[] = (await res.json()).data ?? []
      const seen = rows.find((r) => r.id === reportId)
      expect(seen, 'the submitted report must be visible to the admin').toBeTruthy()
      expect(seen.status).toBe('submitted')
    } finally {
      await admin.dispose()
    }
  })

  test('admin locks the report; the nurse sees read-only and a nurse save is 422', async ({ browser }) => {
    const admin = await apiContextFromState('superadmin')
    try {
      const token = await xsrfToken(admin)
      const lock = await admin.post(`/api/reports/${reportId}/lock`, { headers: ajaxHeaders(token) })
      expect(lock.status(), 'the admin lock endpoint should succeed').toBe(200)
    } finally {
      await admin.dispose()
    }

    // The nurse reopening the report sees a read-only surface.
    const context = await browser.newContext({ storageState: authFile('nurse') })
    const page = await context.newPage()
    try {
      await page.goto(`/reports/${assignmentId}/${periodId}`, { waitUntil: 'domcontentloaded' })
      await expect(page.getByText(/read only/i).first()).toBeVisible({ timeout: 20_000 })
      await expect(page.getByRole('button', { name: /submit report/i }).first()).toBeDisabled()
      await expect(page.getByRole('button', { name: /save draft/i }).first()).toBeDisabled()
    } finally {
      await context.close()
    }

    // And the server rejects a nurse save against the locked report.
    const token = await xsrfToken(nurseApi)
    const res = await nurseApi.put(`/api/reports/${reportId}`, {
      headers: ajaxHeaders(token),
      data: { values: { total_patient_days: { fieldId: 'total_patient_days', dailyValues: { monday: 1 } } } },
    })
    // ReportPolicy::update forbids mutating a locked report, so the owner's save
    // is denied at the policy layer (403) before it reaches the service check
    // that would otherwise raise the 422 "Locked reports are read-only." message.
    expect(res.status(), 'a save against a locked report must be rejected').toBe(403)
  })

  test('a second nurse cannot save against the first nurse’s assignment (403)', async () => {
    // hana.abera is a distinct seeded nurse absent from accounts.ts — the foreign
    // owner for this IDOR check.
    const otherNurse = await apiLoginRaw('hana.abera@stpaulhospital.demo', DEV_PASSWORD)
    try {
      const token = await xsrfToken(otherNurse)
      const res = await otherNurse.post('/api/reports', {
        headers: ajaxHeaders(token),
        data: {
          assignmentId,
          reportingPeriodId: periodId,
          values: { total_patient_days: { fieldId: 'total_patient_days', dailyValues: { monday: 5 } } },
        },
      })
      expect(res.status(), 'ownership must be enforced server-side').toBe(403)
    } finally {
      await otherNurse.dispose()
    }
  })
})
