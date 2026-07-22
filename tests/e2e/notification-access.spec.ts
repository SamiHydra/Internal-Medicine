import { test, expect, type APIRequestContext } from '@playwright/test'
import { randomUUID } from 'node:crypto'

import { apiContextFromState, ajaxHeaders, xsrfToken } from './helpers/api'
import { authFile } from './helpers/auth'
import { QA_MARKER } from './helpers/accounts'
import { captureDiagnostics } from './helpers/diagnostics'

/**
 * Regression guard for C-AUTHZ-001 / F-05 (risk-area #9).
 *
 * The system ADDRESSES notifications to residents and consultants
 * (MorningSessionService notifies the designated morning recorder;
 * TransferService notifies the consultant on a transfer decision), yet all five
 * /api/notifications routes are gated by `permission:notifications.view`. The
 * defect was that residents and consultants did NOT hold that permission, so
 * every notification aimed at them was undeliverable to its own recipient - a
 * 403 on their own inbox.
 *
 * The fix grants NOTIFICATIONS_VIEW to resident + consultant while
 * NotificationController pins non-admin callers to their own recipient_id and
 * NotificationPolicy keeps every write owner-or-admin (no cross-user leak).
 *
 * These tests encode the INTENDED contract, so they FAIL if the defect is live:
 *   - a 403 where a 200 is asserted pins the permission regression - do NOT weaken it.
 *   - a notification addressed to the recipient that the recipient cannot read
 *     pins the same defect from the delivery side.
 */

/** Read a role's own user id from the session payload. */
async function ownId(ctx: APIRequestContext): Promise<string> {
  const res = await ctx.get('/api/auth/me', { headers: ajaxHeaders() })
  expect(res.status(), 'GET /api/auth/me should succeed').toBe(200)
  const body = await res.json()
  return body.user.id as string
}

/**
 * Address a notification to `recipientId` as an admin. `restore` is the only
 * documented API that writes a notification onto another user's account, so it
 * is a deterministic stand-in for the morning-recorder / transfer-decision
 * pipelines that address the very roles under test.
 */
async function addressNotificationTo(admin: APIRequestContext, recipientId: string, title: string): Promise<string> {
  const id = randomUUID()
  const token = await xsrfToken(admin)
  const res = await admin.post('/api/notifications/restore', {
    headers: ajaxHeaders(token),
    data: {
      notifications: [
        {
          id,
          userId: recipientId,
          type: 'transfer_decision',
          title,
          message: `${title} - decision recorded`,
          relatedRoute: '/admin/notifications',
        },
      ],
    },
  })
  expect(res.status(), 'admin must be able to address a notification to a recipient').toBe(200)
  const body = await res.json()
  expect(body.restored, 'exactly one notification row should be written').toBe(1)
  return id
}

test.describe('Regression C-AUTHZ-001 / F-05: residents & consultants can read their own notifications', () => {
  for (const role of ['resident', 'consultant'] as const) {
    test(`${role} GET /api/notifications -> 200 with a readable list`, async () => {
      const ctx = await apiContextFromState(role)

      // The intended behaviour. A 403 here is the live defect - do NOT relax it.
      const res = await ctx.get('/api/notifications', { headers: ajaxHeaders() })
      expect(
        res.status(),
        `${role} was denied their own notifications (permission regression) -> ${res.status()}`,
      ).toBe(200)
      const body = await res.json()
      expect(Array.isArray(body.data), 'notifications response must be a list').toBe(true)

      // The unread view the header bell count is derived from must be reachable too.
      const unread = await ctx.get('/api/notifications?unread=true', { headers: ajaxHeaders() })
      expect(unread.status(), `${role} unread notifications -> ${unread.status()}`).toBe(200)
      expect(Array.isArray((await unread.json()).data)).toBe(true)

      await ctx.dispose()
    })

    test(`a notification addressed to a ${role} is readable and clearable by that recipient`, async () => {
      const recipient = await apiContextFromState(role)
      const admin = await apiContextFromState('superadmin')

      const recipientId = await ownId(recipient)
      const title = `${QA_MARKER} recipient delivery ${randomUUID().slice(0, 8)}`
      const notificationId = await addressNotificationTo(admin, recipientId, title)

      // The intended recipient can read the row the system aimed at them.
      const list = await recipient.get('/api/notifications', { headers: ajaxHeaders() })
      expect(list.status(), `${role} must read notifications addressed to them -> ${list.status()}`).toBe(200)
      const rows = ((await list.json()).data ?? []) as Array<{ id: string; title: string; userId: string }>
      const delivered = rows.find((row) => row.id === notificationId)
      expect(delivered, 'the notification addressed to the recipient must be visible to them').toBeTruthy()
      expect(delivered!.title).toBe(title)
      expect(delivered!.userId, 'the row must belong to the recipient, not leak another user').toBe(recipientId)

      // And can clear it - an owner write through NotificationPolicy (owner-or-admin).
      const token = await xsrfToken(recipient)
      const cleared = await recipient.delete('/api/notifications', {
        headers: ajaxHeaders(token),
        data: { ids: [notificationId] },
      })
      expect(cleared.status(), `${role} must be able to clear their own notification`).toBe(200)
      expect((await cleared.json()).deleted).toBe(1)

      await recipient.dispose()
      await admin.dispose()
    })
  }

  // Control: nurse and student_rep DO hold notifications.view, so their 200
  // contrasts the resident/consultant gap the fix closed.
  for (const role of ['nurse', 'group_rep'] as const) {
    test(`control: ${role} GET /api/notifications -> 200`, async () => {
      const ctx = await apiContextFromState(role)
      const res = await ctx.get('/api/notifications', { headers: ajaxHeaders() })
      expect(res.status(), `${role} holds notifications.view and must reach its inbox`).toBe(200)
      expect(Array.isArray((await res.json()).data)).toBe(true)
      await ctx.dispose()
    })
  }
})

test.describe('Regression C-AUTHZ-001: the notification surface is reachable in the UI', () => {
  test('a resident reaches the bell target (/admin/notifications) and sees a notification addressed to them', async ({
    browser,
  }) => {
    const recipient = await apiContextFromState('resident')
    const admin = await apiContextFromState('superadmin')
    const recipientId = await ownId(recipient)
    const title = `${QA_MARKER} bell delivery ${randomUUID().slice(0, 8)}`
    const notificationId = await addressNotificationTo(admin, recipientId, title)

    const context = await browser.newContext({ storageState: authFile('resident') })
    const page = await context.newPage()
    const diagnostics = captureDiagnostics(page)

    // The header bell routes non-nurse roles to /admin/notifications; the route
    // must NOT bounce a resident back to /academic the way /admin/users does.
    await page.goto('/admin/notifications', { waitUntil: 'domcontentloaded' })
    await expect(page).toHaveURL(/\/admin\/notifications/)
    await expect(page.getByRole('heading', { name: 'Recent activity' })).toBeVisible()

    // The notification the system addressed to this resident renders for them.
    await expect(page.getByText(title)).toBeVisible()

    // No permission wall and no crash on the notification surface for this role.
    const forbidden = diagnostics.apiResponses.filter(
      (entry) => /\/api\/notifications/.test(entry.url) && entry.status === 403,
    )
    expect(forbidden, `notification API returned 403 to a resident: ${JSON.stringify(forbidden)}`).toEqual([])
    expect(
      diagnostics.pageErrors,
      `page errors on the notifications surface: ${JSON.stringify(diagnostics.pageErrors)}`,
    ).toEqual([])

    // Cleanup.
    const token = await xsrfToken(recipient)
    await recipient.delete('/api/notifications', { headers: ajaxHeaders(token), data: { ids: [notificationId] } })
    await recipient.dispose()
    await admin.dispose()
    await context.close()
  })
})
