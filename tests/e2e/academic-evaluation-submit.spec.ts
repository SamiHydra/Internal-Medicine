import { test, expect, type APIRequestContext } from '@playwright/test'
import { apiContextFromState, ajaxHeaders, xsrfToken } from './helpers/api'
import { authFile } from './helpers/auth'
import { ACCOUNTS } from './helpers/accounts'

/**
 * Gap A.3 + A.5 / risk-area #5 — the academic evaluation write path, plus the fix
 * for forms.spec's empty-submit weakness (which only checked the URL, never a
 * validation message).
 *
 *   - a resident submits a peer evaluation of a paired consultant via /academic/submit
 *     and the API confirms it persisted (my-submissions gains the row);
 *   - an empty submit surfaces a VISIBLE validation message AND does not navigate;
 *   - the wrong-direction guard: a resident cannot file a resident evaluation (422);
 *   - a duplicate (same author+subject+date+form) is recorded as a soft observation
 *     (F-08 has no hard-gate requirement) — the only hard rule is a controlled,
 *     non-5xx response.
 *
 * The dev seed pins rediet.bekele (resident) + chaltu.tesfaye (consultant) to the
 * same current ward service, so the resident->consultant journey is always
 * executable. Cross-browser / shared-DB safety: the happy-path submits on a
 * per-project date offset so chromium/firefox/webkit each write a distinct row.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

const CONSULTANT_NAME = ACCOUNTS.consultant.fullName // "Dr. Chaltu Tesfaye"

function projectIndex(): number {
  const order = ['chromium', 'firefox', 'webkit']
  const i = order.indexOf(test.info().project.name)
  return i < 0 ? 0 : i
}

function shiftDate(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - days)
  return d.toISOString().slice(0, 10)
}

function sameDate(a: string | null | undefined, b: string): boolean {
  return typeof a === 'string' && a.slice(0, 10) === b
}

async function formOptions(api: APIRequestContext, date?: string): Promise<any> {
  const suffix = date ? `?date=${date}` : ''
  const res = await api.get(`/api/academic/form-options${suffix}`, { headers: ajaxHeaders() })
  expect(res.status(), 'the resident must be able to read evaluation form options').toBe(200)
  return res.json()
}

async function mySubmissions(api: APIRequestContext): Promise<any[]> {
  const res = await api.get('/api/academic/my-submissions', { headers: ajaxHeaders() })
  expect(res.status()).toBe(200)
  return (await res.json()).data ?? []
}

test.describe('Academic evaluation submission (resident -> consultant)', () => {
  test('empty submit shows a visible validation message and does not navigate [fixes forms.spec]', async ({
    browser,
  }) => {
    const context = await browser.newContext({ storageState: authFile('resident') })
    const page = await context.newPage()
    try {
      await page.goto('/academic/submit', { waitUntil: 'domcontentloaded' })
      const submit = page.getByRole('button', { name: /submit evaluation/i })
      await expect(submit, 'the paired resident must see a renderable evaluation form').toBeVisible({
        timeout: 20_000,
      })

      // Submit with nothing selected -> the subject validation message must show.
      await submit.click()
      await expect(page.getByText('Select the consultant evaluated.')).toBeVisible({ timeout: 10_000 })
      await expect(page).toHaveURL(/\/academic\/submit/)
      // It must NOT have silently succeeded.
      await expect(page.getByText('Evaluation submitted.')).toHaveCount(0)
    } finally {
      await context.close()
    }
  })

  test('resident submits a peer evaluation of the paired consultant and it persists', async ({ browser }) => {
    const residentApi = await apiContextFromState('resident')
    const context = await browser.newContext({ storageState: authFile('resident') })
    const page = await context.newPage()
    try {
      const serverToday: string = (await formOptions(residentApi)).date
      let targetDate = shiftDate(serverToday, projectIndex())

      let opts = await formOptions(residentApi, targetDate)
      if ((opts.subjects ?? []).length === 0) {
        // Pairing gap on the shifted date (month boundary) -> fall back to today.
        targetDate = serverToday
        opts = await formOptions(residentApi, targetDate)
      }

      const priorSubs = await mySubmissions(residentApi)
      const freeSubjects: any[] = (opts.subjects ?? []).filter(
        (s: any) => !priorSubs.some((d) => d.subjectId === s.id && sameDate(d.evaluationDate, targetDate)),
      )
      const subject =
        freeSubjects.find((s) => s.fullName === CONSULTANT_NAME) ?? freeSubjects[0]
      expect(subject, 'the seed must pair the resident with an un-evaluated consultant').toBeTruthy()

      const countBefore = priorSubs.filter((d) => d.subjectId === subject.id).length

      await page.goto('/academic/submit', { waitUntil: 'domcontentloaded' })
      await expect(page.getByRole('button', { name: /submit evaluation/i })).toBeVisible({ timeout: 20_000 })

      // Pin the evaluation date (re-resolves eligibility for that date); the form
      // remounts, so select the subject afterwards.
      await page.locator('#evaluationDate').fill(targetDate)
      await expect(page.getByRole('button', { name: /submit evaluation/i })).toBeVisible({ timeout: 20_000 })

      await page.locator('[aria-label="Consultant evaluated"]').click()
      await page.getByRole('option', { name: subject.fullName, exact: true }).click()
      await page.getByRole('button', { name: /submit evaluation/i }).click()

      await expect(page.getByText('Evaluation submitted.')).toBeVisible({ timeout: 20_000 })

      // Persisted server-side: exactly one more authored evaluation for this subject.
      await expect
        .poll(
          async () => (await mySubmissions(residentApi)).filter((d) => d.subjectId === subject.id).length,
          { timeout: 15_000 },
        )
        .toBe(countBefore + 1)

      // my-performance (the resident's own received summary) stays reachable.
      const perf = await residentApi.get('/api/academic/my-performance', { headers: ajaxHeaders() })
      expect(perf.status()).toBe(200)
      expect((await perf.json()).direction).toBe('resident')
    } finally {
      await context.close()
      await residentApi.dispose()
    }
  })

  test('wrong-direction guard: a resident cannot file a resident evaluation (422)', async () => {
    const residentApi = await apiContextFromState('resident')
    try {
      const me = await residentApi.get('/api/auth/me', { headers: ajaxHeaders() })
      const myId = (await me.json()).user.id
      const date: string = (await formOptions(residentApi)).date
      const token = await xsrfToken(residentApi)

      // resident_acgme is the consultant->resident form; a resident filing it (i.e.
      // evaluating a resident) is rejected before any row is written.
      const res = await residentApi.post('/api/academic/resident-evaluations', {
        headers: ajaxHeaders(token),
        data: { evaluationDate: date, subjectId: myId },
      })
      expect(res.status(), 'a resident evaluating a resident must be rejected').toBe(422)
    } finally {
      await residentApi.dispose()
    }
  })

  test('duplicate submission is a controlled, non-5xx response [F-08 soft observation]', async () => {
    const residentApi = await apiContextFromState('resident')
    try {
      const opts = await formOptions(residentApi)
      const date: string = opts.date
      const subs = await mySubmissions(residentApi)

      // A consultant the resident is paired with today AND already has an evaluation
      // for today -> re-submitting is a guaranteed duplicate. The dev seed always
      // provides one (resident -> lead consultant, dated today).
      const dupSubject = (opts.subjects ?? []).find((s: any) =>
        subs.some((d) => d.subjectId === s.id && sameDate(d.evaluationDate, date)),
      )
      test.skip(!dupSubject, 'No same-day evaluation is available to duplicate in this dataset.')

      const token = await xsrfToken(residentApi)
      const res = await residentApi.post('/api/academic/consultant-evaluations', {
        headers: ajaxHeaders(token),
        data: {
          evaluationDate: date,
          subjectId: dupSubject.id,
          senior_present: false,
          round_delayed: false,
          all_patients_reviewed: false,
          mgmt_plan_documented: false,
          vte_assessed: false,
          discharge_discussed: false,
          med_review_done: false,
          critical_labs_reviewed: false,
        },
      })

      const status = res.status()
      // Hard rule: the duplicate must be handled without a server error.
      expect([200, 201, 422], `duplicate returned an uncontrolled ${status}`).toContain(status)
      // Soft observation (F-08 has no hard-gate requirement): record which way it went.
      test.info().annotations.push({
        type: 'F-08 duplicate-evaluation',
        description:
          status === 422
            ? 'Duplicate rejected (422) — a guard is present.'
            : `Duplicate accepted (${status}) — no hard guard (F-08).`,
      })
    } finally {
      await residentApi.dispose()
    }
  })
})
