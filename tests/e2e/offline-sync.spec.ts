import {
  test,
  expect,
  chromium,
  request as pwRequest,
  type APIRequestContext,
  type BrowserContext,
  type Page,
} from '@playwright/test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { ajaxHeaders, apiContextFromState, BASE_URL, flushRateLimits, xsrfToken } from './helpers/api'
import { authFile, uiLogin } from './helpers/auth'

/**
 * Offline synchronization and conflict safety (docs/OFFLINE_SYNC_MODEL.md).
 *
 * Every scenario drives the real nurse report form with the browser context's
 * network switched off and on (context.setOffline), then checks three things
 * against the API: what the server actually stored, how many saves it saw, and
 * what is left in the device queue (IndexedDB, read from inside the page).
 *
 *   A  save offline -> reconnect -> synced once, queue empty, value persists
 *   B  edit offline, admin locks -> reconnect -> refused, kept, reviewable
 *   C  two devices, stale copy -> 409, both versions shown, explicit overwrite
 *   D  queued work survives closing and reopening the browser
 *   E  session expires while offline -> no bypass, sign in again, work kept
 *   F  flapping network during several saves -> one final value, no storms
 *   G  three queued saves replay in the order they were made
 *
 * Isolation: the seeded nurse gets a dedicated assignment in a department that
 * has no other reports, so every week used here starts from "not started".
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

type QueueRow = {
  id: string
  status: string
  attempts: number
  periodId: string
  expectedUpdatedAt: string | null | undefined
}

/** Read the offline queue the way the app stores it (same DB, store and index). */
async function readQueue(page: Page): Promise<QueueRow[]> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const open = indexedDB.open('stpaul-offline-reports', 1)
      open.onupgradeneeded = () => {
        const database = open.result
        if (!database.objectStoreNames.contains('reportSaves')) {
          database.createObjectStore('reportSaves', { keyPath: 'id' }).createIndex('userId', 'userId', {
            unique: false,
          })
        }
      }
      open.onsuccess = () => resolve(open.result)
      open.onerror = () => reject(open.error)
    })

    try {
      const rows = await new Promise<any[]>((resolve, reject) => {
        const query = db.transaction('reportSaves', 'readonly').objectStore('reportSaves').getAll()
        query.onsuccess = () => resolve(query.result)
        query.onerror = () => reject(query.error)
      })

      return rows.map((row) => ({
        id: row.id,
        status: row.status ?? 'pending',
        attempts: row.attempts,
        periodId: row.payload?.reportingPeriodId,
        expectedUpdatedAt: row.payload?.expectedUpdatedAt,
      }))
    } finally {
      db.close()
    }
  })
}

/** Count successful report saves (201) the server answered on this context. */
function trackSaves(context: BrowserContext) {
  const saves: { periodId: string; status: number }[] = []
  context.on('response', (response) => {
    const url = new URL(response.url())
    if (url.pathname === '/api/reports' && response.request().method() === 'POST') {
      let periodId = ''
      try {
        periodId = JSON.parse(response.request().postData() ?? '{}').reportingPeriodId ?? ''
      } catch {
        periodId = ''
      }
      saves.push({ periodId, status: response.status() })
    }
  })
  return saves
}

test.describe('Offline synchronization and conflict safety', () => {
  test.describe.configure({ mode: 'serial' })

  let nurseApi: APIRequestContext
  let nurseId = ''
  let assignmentId = ''
  /** Three weeks the nurse may still file for, newest first. */
  let weeks: string[] = []

  const firstCell = (page: Page) => page.getByRole('spinbutton').first()
  const reportUrl = (periodId: string) => `/reports/${assignmentId}/${periodId}`
  const conflictPanel = (page: Page) => page.getByTestId('report-conflict-panel')

  async function openReport(page: Page, periodId: string) {
    await page.goto(reportUrl(periodId), { waitUntil: 'domcontentloaded' })
    await expect(firstCell(page)).toBeVisible({ timeout: 20_000 })
  }

  async function serverReport(periodId: string): Promise<any | null> {
    const list = await nurseApi.get(
      `/api/reports?assignment_id=${assignmentId}&reporting_period_id=${periodId}`,
      { headers: ajaxHeaders() },
    )
    const summary = ((await list.json()).data ?? [])[0]
    if (!summary) return null
    const detail = await nurseApi.get(`/api/reports/${summary.id}`, { headers: ajaxHeaders() })
    expect(detail.status()).toBe(200)
    return detail.json()
  }

  function cellValues(report: any): string[] {
    const values = (report?.values ?? {}) as Record<string, { dailyValues?: Record<string, unknown> }>
    return Object.values(values).flatMap((field) =>
      Object.values(field.dailyValues ?? {}).map((value) => String(value)),
    )
  }

  async function statusHistoryCount(reportId: string): Promise<number> {
    const res = await nurseApi.get('/api/reports/status-history?perPage=100', { headers: ajaxHeaders() })
    const rows: any[] = (await res.json()).data ?? []
    return rows.filter((row) => row.reportId === reportId).length
  }

  async function adminLock(reportId: string, locked: boolean) {
    const admin = await apiContextFromState('superadmin')
    try {
      const token = await xsrfToken(admin)
      const res = await admin.post(`/api/reports/${reportId}/${locked ? 'lock' : 'unlock'}`, {
        headers: ajaxHeaders(token),
      })
      expect(res.status()).toBe(200)
    } finally {
      await admin.dispose()
    }
  }

  test.beforeAll(async () => {
    nurseApi = await apiContextFromState('nurse')

    const res = await nurseApi.get('/api/workspace?report_period_window=all', { headers: ajaxHeaders() })
    const workspace: any = await res.json()
    const state: any = workspace.state
    nurseId = state.currentUserId
    const assignments: any[] = state.assignments ?? []
    const periods: any[] = state.reportingPeriods ?? []
    expect(periods.length, 'the seed must expose reporting periods').toBeGreaterThan(3)

    const assignedDepartmentSlugs = new Set(assignments.map((assignment) => assignment.departmentId))
    const departmentIds: Record<string, string> = workspace.references?.departmentDbIdBySlug ?? {}
    const templateIds: Record<string, string> = workspace.references?.templateDbIdByDepartmentSlug ?? {}
    const candidates = Object.keys(departmentIds)
      .filter((slug) => !assignedDepartmentSlugs.has(slug) && templateIds[slug])
      .sort()
    expect(candidates.length, 'need an unassigned department for an isolated offline run').toBeGreaterThan(0)

    const departmentSlug = candidates[0]
    const admin = await apiContextFromState('superadmin')
    try {
      const token = await xsrfToken(admin)
      const created = await admin.post('/api/admin/assignments', {
        headers: ajaxHeaders(token),
        data: { nurseId, departmentId: departmentSlug, templateId: templateIds[departmentSlug] },
      })
      expect(created.status(), 'the isolated nurse assignment must be created').toBe(201)
      assignmentId = (await created.json()).id
    } finally {
      await admin.dispose()
    }

    // Periods arrive oldest first; the last one is the current (interactive) week.
    weeks = periods
      .slice(-3)
      .reverse()
      .map((period) => period.id)
  })

  test.afterAll(async () => {
    // Retire the isolated assignment so later specs see the seeded shape again.
    if (assignmentId) {
      const admin = await apiContextFromState('superadmin')
      try {
        const token = await xsrfToken(admin)
        await admin.patch(`/api/admin/assignments/${assignmentId}`, {
          headers: ajaxHeaders(token),
          data: { active: false },
        })
      } finally {
        await admin.dispose()
      }
    }
    await nurseApi?.dispose()
  })

  test('A: a save made offline syncs exactly once when the network returns', async ({ browser }) => {
    const context = await browser.newContext({ storageState: authFile('nurse') })
    const saves = trackSaves(context)
    const page = await context.newPage()
    try {
      await openReport(page, weeks[0])
      expect(await readQueue(page)).toEqual([])

      await context.setOffline(true)
      await firstCell(page).fill('41')
      await page.getByRole('button', { name: /save draft/i }).first().click()

      await expect(page.getByText(/queued offline/i).first()).toBeVisible({ timeout: 15_000 })
      await expect(page.getByText('Offline save queued')).toBeVisible()
      await expect.poll(() => readQueue(page)).toHaveLength(1)
      const [queued] = await readQueue(page)
      expect(queued.status).toBe('pending')
      expect(queued.periodId).toBe(weeks[0])
      // No report existed when the form was opened, so the save expects none.
      expect(queued.expectedUpdatedAt).toBeNull()
      expect(await serverReport(weeks[0]), 'nothing reaches the server while offline').toBeNull()

      await context.setOffline(false)
      await expect(page.getByText('Offline report save synced.')).toBeVisible({ timeout: 45_000 })
      await expect.poll(() => readQueue(page)).toEqual([])
      await expect(page.getByText('Offline save queued')).toHaveCount(0)

      const report = await serverReport(weeks[0])
      expect(report?.status).toBe('draft')
      expect(cellValues(report)).toContain('41')
      expect(saves.filter((save) => save.status === 201), 'exactly one save reached the server').toHaveLength(1)
      // Audit state: one 'draft created' status entry, nothing duplicated.
      expect(await statusHistoryCount(report.id)).toBe(1)

      await page.reload({ waitUntil: 'domcontentloaded' })
      await expect(firstCell(page)).toHaveValue('41', { timeout: 20_000 })
    } finally {
      await context.close()
    }
  })

  test('B: an offline edit never bypasses a lock applied while it waited', async ({ browser }) => {
    const context = await browser.newContext({ storageState: authFile('nurse') })
    const page = await context.newPage()
    let reportId = ''
    try {
      // Establish the online baseline the admin will lock.
      await openReport(page, weeks[1])
      await firstCell(page).fill('5')
      await page.getByRole('button', { name: /save draft/i }).first().click()
      await expect(page.getByText(/draft saved/i).first()).toBeVisible({ timeout: 15_000 })
      await expect.poll(async () => (await serverReport(weeks[1]))?.status, { timeout: 15_000 }).toBe('draft')
      reportId = (await serverReport(weeks[1])).id

      await context.setOffline(true)
      await firstCell(page).fill('6')
      await page.getByRole('button', { name: /save draft/i }).first().click()
      await expect(page.getByText(/queued offline/i).first()).toBeVisible({ timeout: 15_000 })
      await expect.poll(() => readQueue(page)).toHaveLength(1)

      await adminLock(reportId, true)

      await context.setOffline(false)
      await expect(conflictPanel(page)).toBeVisible({ timeout: 45_000 })
      await expect(conflictPanel(page)).toContainText(/locked/i)
      await expect(page.getByTestId('conflict-local-value')).toHaveText('6')
      await expect(page.getByTestId('conflict-server-value')).toHaveText('5')
      await expect(page.getByText('Offline changes need review')).toBeVisible()

      // Kept on the device, refused by the server, lock intact.
      const queue = await readQueue(page)
      expect(queue).toHaveLength(1)
      expect(queue[0].status).toBe('conflict')
      const locked = await serverReport(weeks[1])
      expect(locked.status).toBe('locked')
      expect(cellValues(locked)).toContain('5')
      expect(cellValues(locked)).not.toContain('6')

      // Copy is available while the panel is up (clipboard permission may be
      // absent in this context; the button and its rows are what matter).
      await expect(page.getByTestId('conflict-copy')).toBeEnabled()

      // The user keeps the server copy: the parked save is dropped and the
      // grid shows the locked value.
      await adminLock(reportId, false)
      await page.getByTestId('conflict-keep-server').click()
      await expect(conflictPanel(page)).toHaveCount(0, { timeout: 15_000 })
      await expect.poll(() => readQueue(page)).toEqual([])
      await expect(firstCell(page)).toHaveValue('5')
      const restored = await serverReport(weeks[1])
      expect(cellValues(restored)).toContain('5')
      // The lock cycle is an overlay on the lifecycle: the report was a draft
      // when it was locked, so the unlock hands it back as a draft, with no
      // submission stamped on it and the stale offline value not replayed.
      expect(restored.status).toBe('draft')
      expect(restored.submittedAt).toBeNull()
      expect(restored.lockedAt).toBeNull()
      expect(cellValues(restored)).not.toContain('6')
    } finally {
      await context.close()
    }
  })

  test('C: a stale copy on a second device is refused and can be applied explicitly', async ({ browser }) => {
    const deviceA = await browser.newContext({ storageState: authFile('nurse') })
    const deviceB = await browser.newContext({ storageState: authFile('nurse') })
    const pageA = await deviceA.newPage()
    const pageB = await deviceB.newPage()
    try {
      await openReport(pageA, weeks[2])
      await firstCell(pageA).fill('7')
      await pageA.getByRole('button', { name: /save draft/i }).first().click()
      await expect(pageA.getByText(/draft saved/i).first()).toBeVisible({ timeout: 15_000 })
      await expect.poll(async () => cellValues(await serverReport(weeks[2])), { timeout: 15_000 }).toContain('7')

      // Device B loads the report as it stands now (value 7).
      await openReport(pageB, weeks[2])
      await expect(firstCell(pageB)).toHaveValue('7')

      // Device A moves on.
      await firstCell(pageA).fill('8')
      await pageA.getByRole('button', { name: /save draft/i }).first().click()
      await expect(pageA.getByText(/draft saved/i).first()).toBeVisible({ timeout: 15_000 })
      await expect.poll(async () => cellValues(await serverReport(weeks[2])), { timeout: 15_000 }).toContain('8')

      // Device B saves its stale copy: refused, both versions shown, nothing overwritten.
      await firstCell(pageB).fill('9')
      await expect(conflictPanel(pageB)).toBeVisible({ timeout: 20_000 })
      await expect(pageB.getByTestId('conflict-local-value')).toHaveText('9')
      await expect(pageB.getByTestId('conflict-server-value')).toHaveText('8')
      expect(cellValues(await serverReport(weeks[2]))).toContain('8')
      expect(cellValues(await serverReport(weeks[2]))).not.toContain('9')
      await expect(pageB.getByRole('button', { name: /save draft/i }).first()).toBeDisabled()

      // An explicit, informed overwrite is allowed.
      await pageB.getByTestId('conflict-apply').click()
      await expect(conflictPanel(pageB)).toHaveCount(0, { timeout: 15_000 })
      await expect.poll(async () => cellValues(await serverReport(weeks[2])), { timeout: 15_000 }).toContain('9')
      await expect(pageB.getByText(/draft saved/i).first()).toBeVisible()
    } finally {
      await deviceA.close()
      await deviceB.close()
    }
  })

  test('D: queued work survives closing and reopening the browser', async () => {
    test.setTimeout(120_000)
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stpaul-offline-profile-'))
    const launch = () =>
      chromium.launchPersistentContext(userDataDir, {
        baseURL: BASE_URL,
        viewport: { width: 1280, height: 900 },
        ignoreHTTPSErrors: true,
      })

    let context = await launch()
    try {
      let page = context.pages()[0] ?? (await context.newPage())
      await flushRateLimits()
      await uiLogin(page, 'nurse')
      await openReport(page, weeks[0])
      await expect(firstCell(page)).toHaveValue('41')

      await context.setOffline(true)
      await firstCell(page).fill('42')
      await page.getByRole('button', { name: /save draft/i }).first().click()
      await expect(page.getByText(/queued offline/i).first()).toBeVisible({ timeout: 15_000 })
      await expect.poll(() => readQueue(page)).toHaveLength(1)

      // Close the browser with the save still queued.
      await context.close()

      // Reopen the same profile. The API stays unreachable for this first
      // visit, so the app starts from its cached workspace like a device that
      // is still offline; the queued save must still be there.
      context = await launch()
      page = context.pages()[0] ?? (await context.newPage())
      // Anchored to the path: a bare /(api|sanctum)/ pattern would also abort
      // the Vite source modules under /src/lib/api/ and blank the page.
      const apiOnly = (url: URL) => /^\/(api|sanctum)\//.test(url.pathname)
      await page.route(apiOnly, (route) => route.abort('internetdisconnected'))
      await page.goto(reportUrl(weeks[0]), { waitUntil: 'domcontentloaded' })
      await expect.poll(() => readQueue(page), { timeout: 20_000 }).toHaveLength(1)
      await expect(page.getByText('Offline save queued')).toBeVisible({ timeout: 20_000 })

      // Connectivity returns: the queued save syncs on the next load.
      await page.unroute(apiOnly)
      await page.reload({ waitUntil: 'domcontentloaded' })
      await expect.poll(() => readQueue(page), { timeout: 45_000 }).toEqual([])
      await expect.poll(async () => cellValues(await serverReport(weeks[0])), { timeout: 15_000 }).toContain('42')
    } finally {
      await context.close().catch(() => undefined)
      fs.rmSync(userDataDir, { recursive: true, force: true })
    }
  })

  test('E: an expired session cannot replay the queue; the work waits for sign-in', async ({ browser }) => {
    const context = await browser.newContext()
    const page = await context.newPage()
    try {
      // A private session for this scenario, so expiring it touches nobody else.
      await flushRateLimits()
      await uiLogin(page, 'nurse')
      await openReport(page, weeks[1])
      await expect(firstCell(page)).toHaveValue('5')

      await context.setOffline(true)
      await firstCell(page).fill('11')
      await page.getByRole('button', { name: /save draft/i }).first().click()
      await expect(page.getByText(/queued offline/i).first()).toBeVisible({ timeout: 15_000 })
      await expect.poll(() => readQueue(page)).toHaveLength(1)

      // Expire the session server-side (as an idle timeout would).
      const sideChannel = await pwRequest.newContext({
        baseURL: BASE_URL,
        storageState: await context.storageState(),
      })
      try {
        const token = await xsrfToken(sideChannel)
        const logout = await sideChannel.post('/api/auth/logout', { headers: ajaxHeaders(token) })
        expect([200, 204]).toContain(logout.status())
      } finally {
        await sideChannel.dispose()
      }

      await context.setOffline(false)
      await expect(page).toHaveURL(/\/login/, { timeout: 45_000 })
      await expect(page.getByText(/session expired before your offline changes/i)).toBeVisible({
        timeout: 15_000,
      })

      // Nothing bypassed authentication and nothing was lost.
      expect(cellValues(await serverReport(weeks[1]))).not.toContain('11')
      const queue = await readQueue(page)
      expect(queue).toHaveLength(1)
      expect(queue[0].status).toBe('pending')
      expect(queue[0].attempts).toBe(0)

      // Signing in again replays the queue.
      await flushRateLimits()
      await uiLogin(page, 'nurse')
      await expect.poll(() => readQueue(page), { timeout: 45_000 }).toEqual([])
      await expect.poll(async () => cellValues(await serverReport(weeks[1])), { timeout: 15_000 }).toContain('11')
    } finally {
      await context.close()
    }
  })

  test('F: a flapping network during several saves ends with one value and no storms', async ({ browser }) => {
    test.setTimeout(120_000)
    const context = await browser.newContext({ storageState: authFile('nurse') })
    const saves = trackSaves(context)
    const page = await context.newPage()
    try {
      await openReport(page, weeks[2])
      await expect(firstCell(page)).toHaveValue('9')
      const reportId = (await serverReport(weeks[2])).id
      const historyBefore = await statusHistoryCount(reportId)

      for (let round = 1; round <= 4; round += 1) {
        await context.setOffline(true)
        await firstCell(page).fill(String(20 + round))
        await page.getByRole('button', { name: /save draft/i }).first().click()
        await expect(page.getByText(/queued offline/i).first()).toBeVisible({ timeout: 15_000 })
        await context.setOffline(false)
        await page.waitForTimeout(700)
      }

      await expect.poll(() => readQueue(page), { timeout: 60_000 }).toEqual([])
      await expect.poll(async () => cellValues(await serverReport(weeks[2])), { timeout: 15_000 }).toContain('24')

      const successful = saves.filter((save) => save.status === 201)
      expect(successful.length, 'at most one save per reconnect, never a storm').toBeLessThanOrEqual(4)
      expect(successful.length).toBeGreaterThanOrEqual(1)
      expect(saves.filter((save) => save.status >= 500)).toHaveLength(0)
      // Draft edits add no status-history rows: replaying them must not either.
      expect(await statusHistoryCount(reportId)).toBe(historyBefore)
    } finally {
      await context.close()
    }
  })

  test('G: several reports queued offline replay in the order they were saved', async ({ browser }) => {
    test.setTimeout(120_000)
    const context = await browser.newContext({ storageState: authFile('nurse') })
    const saves = trackSaves(context)
    const pages: Page[] = []
    try {
      // Open every week online first (no service worker on the Vite gate).
      for (const periodId of weeks) {
        const page = await context.newPage()
        await openReport(page, periodId)
        pages.push(page)
      }

      await context.setOffline(true)
      const expectedOrder: string[] = []
      for (const [index, page] of pages.entries()) {
        await firstCell(page).fill(String(60 + index))
        await page.getByRole('button', { name: /save draft/i }).first().click()
        await expect(page.getByText(/queued offline/i).first()).toBeVisible({ timeout: 15_000 })
        expectedOrder.push(weeks[index])
        await page.waitForTimeout(150)
      }
      await expect.poll(() => readQueue(pages[0])).toHaveLength(3)

      await context.setOffline(false)
      await expect.poll(() => readQueue(pages[0]), { timeout: 60_000 }).toEqual([])

      const successful = saves.filter((save) => save.status === 201).map((save) => save.periodId)
      expect(successful, 'each queued report is saved once').toHaveLength(3)
      expect(successful, 'replay order follows queue order').toEqual(expectedOrder)

      for (const [index, periodId] of weeks.entries()) {
        expect(cellValues(await serverReport(periodId))).toContain(String(60 + index))
      }
    } finally {
      await context.close()
    }
  })
})
