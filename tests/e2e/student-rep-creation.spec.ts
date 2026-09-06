import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { apiContextFromState, ajaxHeaders, xsrfToken, flushRateLimits } from './helpers/api'
import { authFile } from './helpers/auth'
import { QA_MARKER } from './helpers/accounts'

// 14 chars, mixed case + digits: clears the production policy the form mirrors.
const REP_TEMP_PASSWORD = 'StPaulRep2026!'

/**
 * Student representatives are the one role with no public signup: they are
 * appointed, so an administrator must create the account. Until this form
 * existed the role was unusable - the rep-assignment section told admins to
 * create the account "in Users & Access first" and no such form existed
 * anywhere in the SPA, so a rep could only be made by seeding the database.
 *
 * Pins the creation path and the constraint that makes it safe: the new account
 * is a student_rep, and that role can never reach evaluation data.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

test.describe('Student representative creation', () => {
  test.beforeEach(async () => {
    await flushRateLimits()
  })

  test('an admin creates a rep account from the Students page', async ({ browser }) => {
    const nonce = randomUUID().slice(0, 8)
    const email = `qa.rep.${nonce}.donotdeploy@stpaul.local`
    const fullName = `${QA_MARKER} Rep ${nonce}`

    const context = await browser.newContext({ storageState: authFile('superadmin') })
    const page = await context.newPage()
    try {
      await page.goto('/admin/academic/students', { waitUntil: 'domcontentloaded' })

      await expect(
        page.getByRole('heading', { name: /students/i }).first(),
        'the students page must load',
      ).toBeVisible({ timeout: 20_000 })

      // The rep tools live in the "Reps" tab, so the form is not mounted until
      // that tab is selected.
      await page.getByRole('tab', { name: /^reps/i }).click()

      await expect(page.locator('#repFullName')).toBeVisible({ timeout: 20_000 })
      await page.locator('#repFullName').fill(fullName)
      await page.locator('#repEmail').fill(email)
      // A short password must SAY why submit is unavailable rather than leaving
      // a dead button. The form mirrors the production policy (min 12), which is
      // stricter than the 8-char local rule.
      await page.locator('#repPassword').fill('tooShort1')
      await expect(page.getByText('Use at least 12 characters.')).toBeVisible()
      await expect(page.getByRole('button', { name: /create rep account/i })).toBeDisabled()

      await page.locator('#repPassword').fill(REP_TEMP_PASSWORD)
      await expect(page.getByText('Use at least 12 characters.')).toHaveCount(0)
      await page.getByRole('button', { name: /create rep account/i }).click()

      // The form reports success and clears itself for the next rep.
      await expect(page.locator('#repFullName')).toHaveValue('', { timeout: 20_000 })
    } finally {
      await context.close()
    }

    // Confirm server-side: the account exists and carries the rep role, not a
    // more privileged one.
    const admin = await apiContextFromState('superadmin')
    try {
      const res = await admin.get(`/api/admin/users?q=${encodeURIComponent(email)}`, {
        headers: ajaxHeaders(),
      })
      expect(res.status()).toBe(200)
      const rows: any[] = (await res.json()).data ?? []
      const created = rows.find((row) => String(row.email).toLowerCase() === email)

      expect(created, 'the rep account must exist server-side').toBeTruthy()
      expect(created.role, 'the account must be a student_rep').toBe('student_rep')

      // Clean up so repeat runs stay independent.
      const token = await xsrfToken(admin)
      await admin.patch(`/api/admin/users/${created.id}/active`, {
        headers: ajaxHeaders(token),
        data: { active: false },
      })
    } finally {
      await admin.dispose()
    }
  })
})
