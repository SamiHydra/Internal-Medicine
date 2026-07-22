import { test, expect, type APIRequestContext } from '@playwright/test'
import { apiContextFromState, apiLoginRaw, anonContext, ajaxHeaders, xsrfToken } from './helpers/api'
import { DEV_PASSWORD, QA_MARKER, type AccountKey } from './helpers/accounts'

/**
 * Gap A.7 / risk-area #12: object-level (IDOR) boundaries the current suite
 * skips (the one existing IDOR test in permissions.spec self-skips when it
 * cannot find a foreign report). Also T-08: /api/reports returns a role-scoped
 * 200 page for academic roles, NOT a blanket 403.
 *
 * Every boundary is confirmed against the SERVER with that role's own API
 * context, so this proves the backend enforces access - not merely that the
 * SPA hides a link.
 */

type IdRow = { id: string }
type TransferRow = { id: string; status: string }

const BOGUS_UUID = '00000000-0000-4000-8000-000000000000'

// ---------------------------------------------------------------------------
// Reports: a role-scoped list (own rows / empty), never a blanket 403 [T-08],
// and object-level reads across the owner boundary are denied (IDOR).
// ---------------------------------------------------------------------------
test.describe('Reports: role-scoped access and IDOR', () => {
  let superadmin: APIRequestContext
  let abel: APIRequestContext
  /** A report id NOT owned by the test nurse (abel) - the foreign object. */
  let foreignReportId: string
  /** Every report id abel legitimately owns. */
  let abelReportIds: Set<string>

  test.beforeAll(async () => {
    superadmin = await apiContextFromState('superadmin')
    abel = await apiContextFromState('nurse')

    // Admins see every report unscoped; abel sees only his own. The difference
    // is a concrete foreign-owned report to probe - no manual seeding needed.
    const allRows: IdRow[] = (await (await superadmin.get('/api/reports?per_page=100', { headers: ajaxHeaders() })).json()).data ?? []
    abelReportIds = new Set(
      ((await (await abel.get('/api/reports?per_page=100', { headers: ajaxHeaders() })).json()).data ?? []).map((r: IdRow) => r.id),
    )
    const foreign = allRows.find((r) => !abelReportIds.has(r.id))
    expect(foreign, 'seed should contain at least one report the test nurse does not own').toBeTruthy()
    foreignReportId = foreign!.id
  })

  test.afterAll(async () => {
    await Promise.all([superadmin, abel].map((c) => c?.dispose()))
  })

  test('academic roles get a self-scoped reports page (200, empty) - never 403 [T-08]', async () => {
    // Residents, consultants and student reps hold no reports permission, yet
    // the endpoint must answer 200 with an empty, self-scoped page (the regressed
    // behaviour would have been a 403).
    for (const role of ['resident', 'consultant', 'group_rep'] as AccountKey[]) {
      const ctx = await apiContextFromState(role)
      const res = await ctx.get('/api/reports', { headers: ajaxHeaders() })
      expect(res.status(), `${role} GET /api/reports must be 200, not 403`).toBe(200)
      const body = await res.json()
      expect(Array.isArray(body.data), `${role} reports payload shape`).toBe(true)
      expect(body.data.length, `${role} must see no reports (owns no assignment)`).toBe(0)
      await ctx.dispose()
    }
  })

  test("nurse's own reports page contains only their own rows, no foreign leakage [T-08]", async () => {
    const res = await abel.get('/api/reports?per_page=100', { headers: ajaxHeaders() })
    expect(res.status()).toBe(200)
    const rows: IdRow[] = (await res.json()).data ?? []
    expect(rows.length, 'the test nurse should have seeded reports to scope over').toBeGreaterThan(0)
    for (const row of rows) {
      expect(abelReportIds.has(row.id), `nurse page leaked a non-owned report ${row.id}`).toBe(true)
    }
    // And the known foreign report is provably absent from that page.
    expect(rows.some((r) => r.id === foreignReportId)).toBe(false)
  })

  test('a nurse cannot read another owner\'s report by id (IDOR)', async () => {
    const res = await abel.get(`/api/reports/${foreignReportId}`, { headers: ajaxHeaders() })
    expect([403, 404], `expected object-level denial, got ${res.status()}`).toContain(res.status())
  })
})

// ---------------------------------------------------------------------------
// Admin academic evaluations are readable only with academic.view (admin/
// superadmin). There is no per-id show route: the admin index IS the surface,
// so an academic role cannot read ANY evaluation row through it - including a
// specific subject's - because the permission gate fires before the query.
// ---------------------------------------------------------------------------
test.describe('Admin academic evaluations are admin-only to read', () => {
  for (const role of ['resident', 'consultant', 'group_rep'] as AccountKey[]) {
    test(`${role} cannot read the admin evaluations feed (academic.view)`, async () => {
      const ctx = await apiContextFromState(role)
      // Plain listing.
      const list = await ctx.get('/api/admin/academic/evaluations', { headers: ajaxHeaders() })
      expect(list.status(), `${role} GET admin evaluations`).toBe(403)
      // Trying to target a specific subject changes nothing: still gated.
      const scoped = await ctx.get(`/api/admin/academic/evaluations?subjectId=${BOGUS_UUID}&direction=resident`, {
        headers: ajaxHeaders(),
      })
      expect(scoped.status(), `${role} cannot enumerate a subject's evaluations`).toBe(403)
      await ctx.dispose()
    })
  }
})

// ---------------------------------------------------------------------------
// Section transfers: a consultant may act on and see ONLY their own request.
// Another consultant can neither cancel it (IDOR) nor have it disclosed to them
// via the mine feed or the review queue (they head no section).
// ---------------------------------------------------------------------------
test.describe('Section transfers: consultant object-level isolation', () => {
  let owner: APIRequestContext // chaltu - a consultant with a section
  let other: APIRequestContext // mesfin - a consultant who owns nothing, heads nothing
  let transferId: string

  /** Ensure the owner has a pending transfer request; return its id. */
  async function ensurePendingTransfer(ctx: APIRequestContext): Promise<string> {
    const mine = await ctx.get('/api/academic/transfer-requests/mine', { headers: ajaxHeaders() })
    expect(mine.status()).toBe(200)
    const existing: TransferRow | undefined = ((await mine.json()).data ?? []).find((t: TransferRow) => t.status === 'pending')
    if (existing) return existing.id

    const opts = await ctx.get('/api/academic/transfer-requests/options', { headers: ajaxHeaders() })
    expect(opts.status(), 'the owning consultant must have a section to file from').toBe(200)
    const sections: Array<{ id: string }> = (await opts.json()).sections ?? []
    expect(sections.length, 'need an alternate active section to file a transfer').toBeGreaterThan(0)

    const token = await xsrfToken(ctx)
    const res = await ctx.post('/api/academic/transfer-requests', {
      headers: ajaxHeaders(token),
      data: { toSectionId: sections[0].id, reason: `${QA_MARKER} idor probe` },
    })
    expect(res.status(), `filing transfer failed: ${await res.text()}`).toBe(201)
    return (await res.json()).id
  }

  test.beforeAll(async () => {
    owner = await apiContextFromState('consultant')
    other = await apiLoginRaw('mesfin.girma@stpaulhospital.demo', DEV_PASSWORD)
    transferId = await ensurePendingTransfer(owner)
  })

  test.afterAll(async () => {
    // Cancel the probe request so a reused DB does not keep a live pending row.
    const token = await xsrfToken(owner)
    await owner
      .post(`/api/academic/transfer-requests/${transferId}/cancel`, { headers: ajaxHeaders(token), data: {} })
      .catch(() => undefined)
    await Promise.all([owner, other].map((c) => c?.dispose()))
  })

  test('the owner sees their own request (positive control)', async () => {
    const mine = await owner.get('/api/academic/transfer-requests/mine', { headers: ajaxHeaders() })
    expect(mine.status()).toBe(200)
    const ids = ((await mine.json()).data ?? []).map((t: TransferRow) => t.id)
    expect(ids, 'owner must see their own request').toContain(transferId)
  })

  test('another consultant cannot cancel the request (IDOR)', async () => {
    const token = await xsrfToken(other)
    const res = await other.post(`/api/academic/transfer-requests/${transferId}/cancel`, {
      headers: ajaxHeaders(token),
      data: {},
    })
    expect([403, 404], `foreign cancel should be denied, got ${res.status()}`).toContain(res.status())
  })

  test('the request is not disclosed to another consultant (mine feed nor review queue)', async () => {
    const mine = await other.get('/api/academic/transfer-requests/mine', { headers: ajaxHeaders() })
    expect(mine.status()).toBe(200)
    expect(((await mine.json()).data ?? []).map((t: TransferRow) => t.id)).not.toContain(transferId)

    // mesfin holds transfers.review, so the queue answers 200 - but he heads no
    // section, so a request touching neither of his sections must not appear.
    const review = await other.get('/api/admin/transfer-requests', { headers: ajaxHeaders() })
    expect(review.status()).toBe(200)
    expect(((await review.json()).data ?? []).map((t: TransferRow) => t.id)).not.toContain(transferId)
  })

  test('the owner CAN still cancel it (the foreign 403 was authorization, not a dead route)', async () => {
    const token = await xsrfToken(owner)
    const res = await owner.post(`/api/academic/transfer-requests/${transferId}/cancel`, {
      headers: ajaxHeaders(token),
      data: {},
    })
    expect(res.status(), 'the true owner must be able to cancel').toBe(200)
    expect((await res.json()).status).toBe('cancelled')
  })
})

// ---------------------------------------------------------------------------
// Anonymous callers must get a clean 401 JSON on every object endpoint - never
// a redirect, an HTML page, or a 500.
// ---------------------------------------------------------------------------
test.describe('Anonymous access to object endpoints', () => {
  test('unauthenticated object reads return 401 JSON', async () => {
    const ctx = await anonContext()
    for (const path of [
      '/api/reports',
      `/api/reports/${BOGUS_UUID}`,
      '/api/admin/academic/evaluations',
      '/api/academic/transfer-requests/mine',
    ]) {
      const res = await ctx.get(path, { headers: ajaxHeaders() })
      expect(res.status(), `anon GET ${path} -> ${res.status()}`).toBe(401)
      expect(res.headers()['content-type'] ?? '', `anon GET ${path} content-type`).toContain('application/json')
    }
    await ctx.dispose()
  })
})
