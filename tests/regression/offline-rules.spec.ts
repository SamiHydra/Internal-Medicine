/**
 * UI regression: offline business rules (AA) and concurrent edits in two
 * browser sessions (AB).
 *
 * Source of truth: docs/OFFLINE_SYNC_MODEL.md, tests/e2e/offline-sync.spec.ts,
 * src/lib/offline/report-save-queue.ts (IndexedDB stpaul-offline-reports,
 * status pending/conflict, reasons locked/rejected/stale/exists),
 * src/context/app-data-context.tsx (replay on 'online', 401 keeps the queue),
 * src/components/reports/report-conflict-panel.tsx (report-conflict-panel,
 * conflict-apply, conflict-keep-server),
 * backend/app/Services/Reports/ReportSubmissionService.php (revision check,
 * lock rule, "has not started" period rule), backend/app/Policies/ReportPolicy.php.
 *
 * Accounts: the seeded nurse (abel.gemechu) with a dedicated assignment for the
 * LOCK and two-session scenarios; a QA nurse (QA_REG_UI_ prefix, created through
 * the admin API) for the session-expiry, period and role-revoked scenarios, so
 * no shared session is logged out. Every mutation is re-read from SQLite.
 *
 *   npx playwright test --config playwright.regression.config.ts tests/regression/offline-rules.spec.ts
 */
import { test, expect, request as pwRequest, type Page } from '@playwright/test'
import path from 'node:path'
import {
  apiAs,
  call,
  flushRateLimits,
  dbAll,
  dbOne,
  dbCount,
  check,
  info,
  resetFindings,
  uniqueSuffix,
  stateFor,
  forgetSession,
  ajaxHeaders,
  xsrfToken,
  EXTRA_ACCOUNTS,
  DEV_PASSWORD,
  BASE_URL,
  OUTPUT_DIR,
  QA_PREFIX,
} from './helpers/index'
import {
  openReport,
  readQueue,
  createIsolatedAssignment,
  retireAssignment,
  adminLock,
  templateCells,
  reportRow,
  dbCell,
  desktopCell,
  trackMutations,
  hitsSince,
  sleep,
  parseTs,
  type Isolated,
  type CellDef,
} from './helpers/ui'


const D = 'offline-rules'
const PREFIX = `${QA_PREFIX}_UI_`
const SHOTS = path.join(OUTPUT_DIR, 'shots')

let dbReads = 0
const q = {
  one<T = Record<string, unknown>>(sql: string, params: unknown[] = []): T | null {
    dbReads++
    return dbOne<T>(sql, params)
  },
  all<T = Record<string, unknown>>(sql: string, params: unknown[] = []): T[] {
    dbReads++
    return dbAll<T>(sql, params)
  },
  count(sql: string, params: unknown[] = []): number {
    dbReads++
    return dbCount(sql, params)
  },
}
const row = (iso: Isolated) => {
  dbReads++
  return reportRow(iso.assignmentId, iso.periodId)
}
const cellOf = (reportId: string, c: CellDef, day: string) => {
  dbReads++
  return dbCell(reportId, c.fieldKey, day)
}

const conflictPanel = (page: Page) => page.getByTestId('report-conflict-panel')
const saveDraft = (page: Page) => page.getByRole('button', { name: /^save draft$/i }).first()
const statusLine = (page: Page) => page.locator('p[role="status"]').first()

// seeded nurse
let seeded: Isolated
let seededCell: CellDef
let nurseState = ''
// QA nurse
let qa: Isolated | null = null
let qaCell: CellDef
let qaEmail = ''
let qaUserId = ''

test.beforeAll(async () => {
  test.setTimeout(240_000)
  resetFindings(D)
  await flushRateLimits()
  nurseState = await stateFor(EXTRA_ACCOUNTS.nurse)
  seeded = await createIsolatedAssignment(EXTRA_ACCOUNTS.nurse, undefined, 'chest_inpatient')
  seededCell = templateCells(seeded.templateDbId, 1)[0]
  dbReads++
  info(D, 'AA-setup', 'Isolated assignment for the seeded nurse', `${seeded.departmentSlug} period ${seeded.periodLabel} cell ${seededCell.fieldKey}`)

  // QA nurse + assignment (scripts/regression/differential.mjs payloads)
  const admin = await apiAs(EXTRA_ACCOUNTS.superadmin)
  try {
    const suffix = uniqueSuffix()
    qaEmail = `qa.reg.ui.${suffix}@stpaulos.local`
    const created = await call(admin, 'POST', '/api/admin/users', {
      data: { fullName: `${PREFIX}nurse ${suffix}`, email: qaEmail, password: DEV_PASSWORD, role: 'nurse', active: true, passwordChangeRequired: false },
    })
    qaUserId = created.json?.id ?? created.json?.user?.id ?? ''
    info(D, 'AA-setup-user', 'QA nurse created through POST /api/admin/users', `${created.status} ${qaUserId}`, created.status === 201 ? undefined : created.text.slice(0, 200))
  } finally {
    await admin.dispose()
  }
  if (qaUserId) {
    qa = await createIsolatedAssignment(qaEmail, DEV_PASSWORD, 'gi_neuro_inpatient')
    qaCell = templateCells(qa.templateDbId, 1)[0]
    dbReads++
    info(D, 'AA-setup-assignment', 'QA nurse assignment (inpatient_weekly)', `${qa.assignmentId} ${qa.departmentSlug}`)
  }
})

test.afterAll(async () => {
  if (seeded?.assignmentId) await retireAssignment(seeded.assignmentId)
  if (qa?.assignmentId) await retireAssignment(qa.assignmentId)
  if (qaUserId) {
    const admin = await apiAs(EXTRA_ACCOUNTS.superadmin)
    try {
      const r = await call(admin, 'PATCH', `/api/admin/users/${qaUserId}`, { data: { active: false } })
      info(D, 'AA-teardown', 'QA nurse deactivated, assignments retired', String(r.status))
    } finally {
      await admin.dispose()
    }
    forgetSession(qaEmail)
  }
  info(D, 'AA-reads', 'Database re-reads performed by this spec', `db=${dbReads}`)
})

async function queueOffline(page: Page, cell: CellDef, value: string): Promise<void> {
  await page.context().setOffline(true)
  await desktopCell(page, cell, 'monday').fill(value)
  await saveDraft(page).click()
  await expect(page.getByText('Offline save queued')).toBeVisible({ timeout: 20_000 })
  await expect.poll(() => readQueue(page), { timeout: 20_000 }).toHaveLength(1)
}

test('AA-1 LOCK: an offline save never bypasses a lock applied while it waited', async ({ browser }) => {
  test.setTimeout(240_000)
  const context = await browser.newContext({ storageState: nurseState })
  const page = await context.newPage()
  let reportId = ''
  try {
    await openReport(page, seeded.assignmentId, seeded.periodId)
    await desktopCell(page, seededCell, 'monday').fill('5')
    await saveDraft(page).click()
    await expect(statusLine(page)).toHaveText(/draft saved/i, { timeout: 40_000 })
    reportId = row(seeded)?.id ?? ''
    check(D, 'AA-01', 'Baseline online save creates the draft (DB cell = 5)', '5', cellOf(reportId, seededCell, 'monday'), cellOf(reportId, seededCell, 'monday') === '5')

    await queueOffline(page, seededCell, '6')
    const queued = (await readQueue(page))[0]
    check(D, 'AA-02', 'Offline Save draft -> chip "Offline save queued" and ONE IndexedDB record with status pending carrying the loaded revision', 'pending, expectedUpdatedAt set', `${queued.status}, expectedUpdatedAt=${queued.expectedUpdatedAt}`, queued.status === 'pending' && !!queued.expectedUpdatedAt)
    check(D, 'AA-03', 'Nothing reaches the server while offline (DB cell still 5)', '5', cellOf(reportId, seededCell, 'monday'), cellOf(reportId, seededCell, 'monday') === '5')

    const statusBeforeLock = row(seeded)?.status ?? 'draft'
    const submittedAtBeforeLock = row(seeded)?.submitted_at ?? null
    const lock = await adminLock(reportId, true)
    let r = row(seeded)
    check(D, 'AA-04', 'Admin locks the report through the API while the save waits', 'locked', `${lock.status} ${r?.status}/${r?.locked_at}`, lock.status === 200 && r?.status === 'locked')

    await context.setOffline(false)
    await expect(conflictPanel(page)).toBeVisible({ timeout: 90_000 })
    const panelText = (await conflictPanel(page).textContent()) ?? ''
    const after = await readQueue(page)
    r = row(seeded)
    await page.screenshot({ path: path.join(SHOTS, 'offline-AA1-locked.png'), fullPage: true }).catch(() => {})
    check(D, 'AA-05', 'Reconnect: the replay is refused; the record is parked as conflict with reason "locked" (409 with the locked copy, OFFLINE_SYNC_MODEL 9)', 'conflict/locked', `${after[0]?.status}/${after[0]?.conflictReason} http=${after[0]?.conflictHttpStatus}`, after.length === 1 && after[0].status === 'conflict' && after[0].conflictReason === 'locked')
    check(D, 'AA-06', 'The conflict panel says the report was locked; local 6 vs server 5', 'locked, 6 vs 5', `${/locked/i.test(panelText)}, ${await page.getByTestId('conflict-local-value').first().textContent()} vs ${await page.getByTestId('conflict-server-value').first().textContent()}`, /locked/i.test(panelText) && (await page.getByTestId('conflict-local-value').first().textContent()) === '6' && (await page.getByTestId('conflict-server-value').first().textContent()) === '5')
    check(D, 'AA-07', 'DB cell UNCHANGED (5) and the report stays locked', '5 / locked', `${cellOf(reportId, seededCell, 'monday')} / ${r?.status}`, cellOf(reportId, seededCell, 'monday') === '5' && r?.status === 'locked')
    check(D, 'AA-08', 'Save draft / Submit are disabled while the panel is open', 'disabled', `${await saveDraft(page).isDisabled()}`, await saveDraft(page).isDisabled())

    // unlock, keep server copy: parked save dropped, grid shows 5
    const unlock = await adminLock(reportId, false)
    await page.getByTestId('conflict-keep-server').click()
    await expect(conflictPanel(page)).toHaveCount(0, { timeout: 20_000 })
    await expect.poll(() => readQueue(page), { timeout: 20_000 }).toEqual([])
    await expect(desktopCell(page, seededCell, 'monday')).toHaveValue('5', { timeout: 20_000 })
    r = row(seeded)
    // A lock is an overlay, not a lifecycle step: ReportLockingService restores
    // the pre-lock status on unlock (a draft stays a draft with no submitted_at;
    // a submitted report returns to submitted / edited_after_submission with
    // its submitted_at untouched). The seeded nurse's report may already have
    // been submitted by an earlier run, so the rule is asserted against the
    // state read just before the lock rather than against "draft".
    const unlockedStatus = r?.status ?? ''
    info(D, 'AA-09i', 'Status before the lock vs after the unlock (ReportLockingService::restoredStatus)', `${statusBeforeLock} -> ${unlockedStatus}`)
    check(D, 'AA-09', 'After unlock, "Keep the server copy" drops the parked record, grid and DB show 5, the lock is cleared and the status and submitted_at are exactly their PRE-LOCK values (a locked draft comes back as a draft, never submitted)', `queue empty, 5, unlocked, ${statusBeforeLock}, submitted_at ${submittedAtBeforeLock}`, `${unlock.status}; queue=${(await readQueue(page)).length}; db=${cellOf(reportId, seededCell, 'monday')}; ${unlockedStatus}; submitted_at=${r?.submitted_at}`, unlock.status === 200 && cellOf(reportId, seededCell, 'monday') === '5' && unlockedStatus === statusBeforeLock && (r?.submitted_at ?? null) === submittedAtBeforeLock && r?.locked_at === null)
  } finally {
    await context.setOffline(false).catch(() => {})
    if (reportId && row(seeded)?.locked_at) await adminLock(reportId, false)
    await context.close()
  }
})

test('AA-4 SESSION: a queued save waits for a new sign-in; it never replays without a session', async ({ browser }) => {
  test.setTimeout(240_000)
  test.skip(!qa, 'QA nurse could not be created')
  const iso = qa!
  // A private session: logging it out must not touch the cached QA state used elsewhere.
  const context = await browser.newContext()
  const page = await context.newPage()
  let reportId = ''
  try {
    await flushRateLimits()
    await page.goto('/login', { waitUntil: 'domcontentloaded' })
    await page.locator('#identifier').fill(qaEmail)
    await page.locator('#password').fill(DEV_PASSWORD)
    await page.getByRole('button', { name: /sign in to reporting portal/i }).click()
    await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 40_000 })

    await openReport(page, iso.assignmentId, iso.periodId)
    await desktopCell(page, qaCell, 'monday').fill('3')
    await saveDraft(page).click()
    await expect(statusLine(page)).toHaveText(/draft saved/i, { timeout: 40_000 })
    reportId = row(iso)?.id ?? ''
    check(D, 'AA-20', 'QA nurse baseline draft saved online (DB cell = 3)', '3', cellOf(reportId, qaCell, 'monday'), cellOf(reportId, qaCell, 'monday') === '3')

    await queueOffline(page, qaCell, '11')

    // Expire the session server-side with the browser's own cookies.
    const side = await pwRequest.newContext({ baseURL: BASE_URL, storageState: await context.storageState() })
    let logout
    try {
      logout = await side.post('/api/auth/logout', { headers: ajaxHeaders(await xsrfToken(side)) })
    } finally {
      await side.dispose()
    }
    check(D, 'AA-21', 'Session expired server-side (POST /api/auth/logout with the browser cookies)', '200/204', String(logout.status()), [200, 204].includes(logout.status()))

    await context.setOffline(false)
    await expect(page).toHaveURL(/\/login/, { timeout: 90_000 })
    const toast = await page.getByText(/session expired before your offline changes/i).isVisible().catch(() => false)
    const queue = await readQueue(page)
    await page.screenshot({ path: path.join(SHOTS, 'offline-AA4-login.png') }).catch(() => {})
    check(D, 'AA-22', 'Reconnect with an expired session: the app returns to /login, the queue keeps the record as pending with attempts 0, DB unchanged (OFFLINE_SYNC_MODEL 7)', 'login, pending/0, 3', `${new URL(page.url()).pathname}, ${queue[0]?.status}/${queue[0]?.attempts}, ${cellOf(reportId, qaCell, 'monday')}, toast=${toast}`, queue.length === 1 && queue[0].status === 'pending' && queue[0].attempts === 0 && cellOf(reportId, qaCell, 'monday') === '3')

    // Sign in again: the queue replays for the same user.
    await flushRateLimits()
    await page.locator('#identifier').fill(qaEmail)
    await page.locator('#password').fill(DEV_PASSWORD)
    await page.getByRole('button', { name: /sign in to reporting portal/i }).click()
    await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 40_000 })
    await expect.poll(() => readQueue(page), { timeout: 90_000 }).toEqual([])
    await expect.poll(() => cellOf(reportId, qaCell, 'monday'), { timeout: 20_000 }).toBe('11')
    check(D, 'AA-23', 'After the new sign-in the queue replays: queue empty, DB cell = 11', '11', cellOf(reportId, qaCell, 'monday'), cellOf(reportId, qaCell, 'monday') === '11')
  } finally {
    await context.setOffline(false).catch(() => {})
    await context.close()
  }
})

test('AA-3 PERIOD: a replayed payload for a future week is refused (422 "has not started") and writes nothing', async () => {
  test.skip(!qa, 'QA nurse could not be created')
  const iso = qa!
  const future = q.one<{ id: string; week_start: string }>("select id, week_start from reporting_periods where week_start > date('now', '+1 day') order by week_start limit 1")
  expect(future, 'the seed generates future reporting periods').toBeTruthy()
  const nurse = await apiAs(qaEmail, DEV_PASSWORD)
  try {
    const r = await call(nurse, 'POST', '/api/reports', {
      data: { assignmentId: iso.assignmentId, reportingPeriodId: future!.id, values: { [qaCell.fieldKey]: { fieldId: qaCell.fieldKey, dailyValues: { monday: 4 } } }, submit: false, expectedUpdatedAt: null },
    })
    const rows = q.count('select count(*) c from reports where assignment_id = ? and reporting_period_id = ?', [iso.assignmentId, future!.id])
    check(D, 'AA-30', `A queued payload targeting a future week (${future!.week_start.slice(0, 10)}) is refused with 422 "has not started" (ReportSubmissionService::assertPeriodHasStarted) and no row is written`, '422 has not started / 0 rows', `${r.status} ${(r.json?.message ?? r.text).slice(0, 120)} / ${rows} rows`, r.status === 422 && /has not started/i.test(r.text) && rows === 0)
  } finally {
    await nurse.dispose()
  }
})

test('AA-2 ROLE REVOKED: retiring the assignment while a save waits parks it as rejected (403), DB unchanged', async ({ browser }) => {
  test.setTimeout(240_000)
  test.skip(!qa, 'QA nurse could not be created')
  const iso = qa!
  const context = await browser.newContext({ storageState: await stateFor(qaEmail, DEV_PASSWORD) })
  const hits = trackMutations(context)
  const page = await context.newPage()
  try {
    await openReport(page, iso.assignmentId, iso.periodId)
    const reportId = row(iso)?.id ?? ''
    const before = cellOf(reportId, qaCell, 'monday')
    await queueOffline(page, qaCell, '12')

    const retired = await retireAssignment(iso.assignmentId)
    const a = q.one<{ active: number }>('select active from report_assignments where id = ?', [iso.assignmentId])
    check(D, 'AA-40', 'Admin retires the assignment while the save waits (PATCH active:false)', '200 / active=0', `${retired.status} / active=${a?.active}`, retired.status === 200 && Number(a?.active) === 0)

    const t0 = Date.now()
    await context.setOffline(false)
    await expect.poll(async () => (await readQueue(page))[0]?.status, { timeout: 90_000 }).toBe('conflict')
    const queue = await readQueue(page)
    const replay = hitsSince(hits, t0, /^\/api\/reports$/)
    const after = cellOf(reportId, qaCell, 'monday')
    const panel = await conflictPanel(page).isVisible().catch(() => false)
    const banner = await page.getByText(/offline save needs your review|offline changes need review/i).first().isVisible().catch(() => false)
    await page.screenshot({ path: path.join(SHOTS, 'offline-AA2-rejected.png'), fullPage: true }).catch(() => {})
    check(D, 'AA-41', 'Reconnect: the replay is refused with 403 (assignment retired; ReportPolicy/authorizeAssignmentEdit) and parked as conflict reason "rejected", never applied', 'conflict/rejected/403', `${queue[0]?.status}/${queue[0]?.conflictReason}/${queue[0]?.conflictHttpStatus}; replays=${replay.length}`, queue.length === 1 && queue[0].status === 'conflict' && queue[0].conflictReason === 'rejected' && queue[0].conflictHttpStatus === 403)
    check(D, 'AA-42', 'DB cell unchanged after the refused replay', before, after, after === before)
    info(D, 'AA-43', 'Where the parked save is shown after the assignment disappeared (panel on the report page / review banner)', `panel=${panel} banner=${banner} url=${new URL(page.url()).pathname}`)
  } finally {
    await context.setOffline(false).catch(() => {})
    await context.close()
  }
})

test('AB two sessions: stale copy refused (409), keep-server, explicit apply overwrites and is audited', async ({ browser }) => {
  test.setTimeout(240_000)
  const deviceA = await browser.newContext({ storageState: nurseState })
  const deviceB = await browser.newContext({ storageState: nurseState })
  const hitsB = trackMutations(deviceB)
  const pageA = await deviceA.newPage()
  const pageB = await deviceB.newPage()
  try {
    // Submit first so that later cell changes are audited (audit rows are written for submitted reports).
    await openReport(pageA, seeded.assignmentId, seeded.periodId)
    await desktopCell(pageA, seededCell, 'monday').fill('7')
    await pageA.getByRole('button', { name: /^submit report$/i }).first().click()
    const submitted = await Promise.race([
      pageA.getByText(/report submitted/i).first().waitFor({ timeout: 40_000 }).then(() => true),
      statusLine(pageA).filter({ hasText: /required|missing|invalid|must|complete/i }).waitFor({ timeout: 40_000 }).then(() => false),
    ]).catch(() => false)
    if (!submitted) {
      const empties = pageA.getByRole('spinbutton')
      const n = await empties.count()
      for (let i = 0; i < n; i++) {
        const el = empties.nth(i)
        if ((await el.inputValue()) === '' && (await el.isEditable())) await el.fill('1')
      }
      await pageA.getByRole('button', { name: /^submit report$/i }).first().click()
      await expect(pageA.getByText(/report submitted/i).first()).toBeVisible({ timeout: 40_000 })
    }
    let r = row(seeded)
    const reportId = r?.id ?? ''
    // A report that was submitted and edited in an earlier run resubmits as
    // edited_after_submission; both are "submitted" for this scenario.
    check(D, 'AB-01', 'Session A submits the report (DB status submitted or edited_after_submission, cell 7)', 'submitted|edited_after_submission/7', `${r?.status}/${cellOf(reportId, seededCell, 'monday')}`, ['submitted', 'edited_after_submission'].includes(r?.status ?? '') && cellOf(reportId, seededCell, 'monday') === '7')

    // B loads the current copy (7). A moves on to 8.
    await openReport(pageB, seeded.assignmentId, seeded.periodId)
    await expect(desktopCell(pageB, seededCell, 'monday')).toHaveValue('7', { timeout: 20_000 })
    await sleep(1100)
    await desktopCell(pageA, seededCell, 'monday').fill('8')
    await saveDraft(pageA).click()
    await expect(statusLine(pageA)).toHaveText(/draft saved/i, { timeout: 40_000 })
    check(D, 'AB-02', 'Session A saves 8 (200) - DB cell 8', '8', cellOf(reportId, seededCell, 'monday'), cellOf(reportId, seededCell, 'monday') === '8')

    // B saves its stale copy: 409, panel, nothing overwritten.
    const t0 = Date.now()
    await desktopCell(pageB, seededCell, 'monday').fill('9')
    if (await saveDraft(pageB).isEnabled()) await saveDraft(pageB).click().catch(() => {})
    await expect(conflictPanel(pageB)).toBeVisible({ timeout: 40_000 })
    const local = await pageB.getByTestId('conflict-local-value').first().textContent()
    const server = await pageB.getByTestId('conflict-server-value').first().textContent()
    const staleHits = hitsSince(hitsB, t0, /^\/api\/reports$/)
    await pageB.screenshot({ path: path.join(SHOTS, 'offline-AB-conflict.png'), fullPage: true }).catch(() => {})
    check(D, 'AB-03', 'Session B saving a stale copy is refused (409 stale, revision check under the row lock): panel shows local 9 vs server 8, DB still 8, Save disabled', '9 vs 8, db 8, disabled', `${local} vs ${server}, db ${cellOf(reportId, seededCell, 'monday')}, disabled=${await saveDraft(pageB).isDisabled()}`, local === '9' && server === '8' && cellOf(reportId, seededCell, 'monday') === '8' && (await saveDraft(pageB).isDisabled()), `${staleHits.length} save request(s) from B`)

    await pageB.getByTestId('conflict-keep-server').click()
    await expect(conflictPanel(pageB)).toHaveCount(0, { timeout: 20_000 })
    await expect(desktopCell(pageB, seededCell, 'monday')).toHaveValue('8', { timeout: 20_000 })
    check(D, 'AB-04', '"Keep the server copy": panel closes, B shows A\'s value 8, DB unchanged (8)', '8/8', `${await desktopCell(pageB, seededCell, 'monday').inputValue()}/${cellOf(reportId, seededCell, 'monday')}`, cellOf(reportId, seededCell, 'monday') === '8')

    // Round 2: A saves 10, B (still holding revision of 8) writes 11 and applies explicitly.
    await sleep(1100)
    await desktopCell(pageA, seededCell, 'monday').fill('10')
    await saveDraft(pageA).click()
    await expect(statusLine(pageA)).toHaveText(/draft saved/i, { timeout: 40_000 })
    const updatedBefore = row(seeded)?.updated_at
    const auditBefore = q.count('select count(*) c from audit_logs where report_id = ? and field_key = ?', [reportId, seededCell.fieldKey])
    await sleep(1100)
    await desktopCell(pageB, seededCell, 'monday').fill('11')
    if (await saveDraft(pageB).isEnabled()) await saveDraft(pageB).click().catch(() => {})
    await expect(conflictPanel(pageB)).toBeVisible({ timeout: 40_000 })
    check(D, 'AB-05', 'Second stale save from B refused again; DB holds A\'s 10', '10', cellOf(reportId, seededCell, 'monday'), cellOf(reportId, seededCell, 'monday') === '10')
    await pageB.getByTestId('conflict-apply').click()
    await expect(conflictPanel(pageB)).toHaveCount(0, { timeout: 40_000 })
    await expect.poll(() => cellOf(reportId, seededCell, 'monday'), { timeout: 20_000 }).toBe('11')
    r = row(seeded)
    const audits = q.all<{ old_value: string; new_value: string; changed_by: string }>('select old_value, new_value, changed_by from audit_logs where report_id = ? and field_key = ? order by changed_at, rowid', [reportId, seededCell.fieldKey])
    const last = audits[audits.length - 1]
    check(D, 'AB-06', '"Apply my values over the server copy" re-sends with the server revision: DB cell 11, updated_at advanced', '11 / advanced', `${cellOf(reportId, seededCell, 'monday')} / ${updatedBefore} -> ${r?.updated_at}`, cellOf(reportId, seededCell, 'monday') === '11' && (parseTs(r?.updated_at) ?? 0) > (parseTs(updatedBefore) ?? 0))
    check(D, 'AB-07', 'The explicit overwrite on a submitted report is audited: audit_logs cell row 10 -> 11 by the acting nurse (B)', `row 10->11 by ${seeded.nurseId}`, `${audits.length - auditBefore} new row(s); last ${last?.old_value}->${last?.new_value} by ${last?.changed_by}`, audits.length > auditBefore && last?.new_value === '11' && last?.changed_by === seeded.nurseId)
    check(D, 'AB-08', 'Status after post-submission edits is edited_after_submission (ReportSubmissionService::nextStatus)', 'edited_after_submission', String(r?.status), r?.status === 'edited_after_submission')
  } finally {
    await deviceA.close()
    await deviceB.close()
  }
})
