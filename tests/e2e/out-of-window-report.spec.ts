import { test, expect } from '@playwright/test'
import { apiContextFromState, ajaxHeaders, xsrfToken } from './helpers/api'
import { authFile } from './helpers/auth'

/**
 * AUD-UI-020 regression.
 *
 * The workspace bootstrap lists EVERY reporting period but only loads the
 * reports inside the default period window. A report whose period falls outside
 * that window therefore resolved to null on the report page, which derived
 * status 'not_started' and rendered an editable blank draft - even when the real
 * report was locked. A nurse could be shown an empty, apparently-writable form
 * for a report that is actually locked and read-only.
 *
 * The fix makes the report page pull the FULL window once when a period's report
 * is missing, before trusting the empty result. This spec pins that: a locked
 * report that the default window does not load must still render read-only.
 *
 * The out-of-window report is discovered by diffing the default and "all"
 * windows rather than assuming a window size, so the test does not couple itself
 * to reports.window.default_count.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

test.describe('AUD-UI-020: a locked report outside the default window renders read-only', () => {
  test('is not presented as an editable "Not started" blank', async ({ browser }) => {
    const nurse = await apiContextFromState('nurse')
    const admin = await apiContextFromState('superadmin')

    try {
      // Reports the SPA loads by default, versus every report that exists. The
      // difference is exactly the set the report page used to mis-render.
      const [defaultRes, allRes] = await Promise.all([
        nurse.get('/api/workspace', { headers: ajaxHeaders() }),
        nurse.get('/api/workspace?report_period_window=all', { headers: ajaxHeaders() }),
      ])
      expect(defaultRes.status(), 'default workspace load').toBe(200)
      expect(allRes.status(), 'full-window workspace load').toBe(200)

      const defaultState: any = (await defaultRes.json()).state
      const allState: any = (await allRes.json()).state
      const loadedByDefault = new Set<string>((defaultState.reports ?? []).map((r: any) => r.id))
      const assignmentIds = new Set<string>((allState.assignments ?? []).map((a: any) => a.id))

      const outOfWindow = (allState.reports ?? []).find(
        (report: any) => !loadedByDefault.has(report.id) && assignmentIds.has(report.assignmentId),
      )

      // The seeded history must reach past the default window for this defect to
      // be reachable at all; skip rather than fail if the dataset is too shallow.
      test.skip(
        !outOfWindow,
        'no report exists outside the default period window in this dataset',
      )

      // Lock it, so the page has a genuinely read-only report to render.
      const token = await xsrfToken(admin)
      const lock = await admin.post(`/api/reports/${outOfWindow.id}/lock`, {
        headers: ajaxHeaders(token),
      })
      expect([200, 409], 'the report must end up locked').toContain(lock.status())

      // Open it as its owning nurse, from a cold page load using the DEFAULT
      // window - the exact path that used to yield an editable blank.
      const context = await browser.newContext({ storageState: authFile('nurse') })
      const page = await context.newPage()
      try {
        await page.goto(
          `/reports/${outOfWindow.assignmentId}/${outOfWindow.reportingPeriodId}`,
          { waitUntil: 'domcontentloaded' },
        )

        // The locked surface must appear. Before the fix this timed out, because
        // the page rendered a "Not started" draft instead.
        await expect(
          page.getByText(/read only/i).first(),
          'a locked out-of-window report must render its read-only surface',
        ).toBeVisible({ timeout: 30_000 })

        // And it must not offer to write to a locked report.
        await expect(page.getByRole('button', { name: /save draft/i }).first()).toBeDisabled()
        await expect(page.getByRole('button', { name: /submit report/i }).first()).toBeDisabled()

        // The regression signature itself: never the not-started blank.
        await expect(page.getByText('Not started', { exact: true })).toHaveCount(0)
      } finally {
        await context.close()
      }
    } finally {
      await Promise.all([nurse.dispose(), admin.dispose()])
    }
  })
})
