/**
 * UI regression: the clinical weekly-report lifecycle through the REAL form
 * (D) and the accessibility pass must not have changed behaviour (AE).
 *
 * Source of truth: tests/e2e/clinical-report-lifecycle.spec.ts,
 * tests/e2e/a11y-keyboard.spec.ts, tests/e2e/responsive.spec.ts,
 * tests/e2e/workspace.spec.ts, src/components/reports/report-form.tsx,
 * backend/app/Services/Reports/ReportSubmissionService.php,
 * backend/app/Policies/ReportPolicy.php.
 *
 * The seeded nurse (abel.gemechu) gets a dedicated assignment in a department
 * nobody reports for, so the week starts from "not started" and no seeded
 * report is touched; the assignment is retired afterwards. Every mutation is
 * re-read from SQLite.
 *
 *   npx playwright test --config playwright.regression.config.ts tests/regression/ui-clinical.spec.ts
 */
import { test, expect, type Browser, type Page } from '@playwright/test'
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
  EXTRA_ACCOUNTS,
  OUTPUT_DIR,
  QA_PREFIX,
  DEV_PASSWORD,
  forgetSession,
} from './helpers/index'
import {
  shellReady,
  openReport,
  firstCell,
  createIsolatedAssignment,
  retireAssignment,
  templateCells,
  reportRow,
  reportCount,
  dbCell,
  historyCount,
  desktopCell,
  trackMutations,
  hitsSince,
  sleep,
  parseTs,
  horizontalOverflow,
  type Isolated,
  type CellDef,
} from './helpers/ui'

/* eslint-disable @typescript-eslint/no-explicit-any */

const D = 'ui-clinical'
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

let iso: Isolated
let cells: CellDef[]
let nurseState = ''
let adminState = ''
let reportId = ''
// A fresh nurse per run: the seeded nurse has reported for most departments
// by now, so an isolated assignment for her would start from an existing row.
let qaEmail = ''
let qaUserId = ''

// Sequential by config (workers: 1); not 'serial', so a soft-failed finding does not skip later tests.

test.beforeAll(async () => {
  test.setTimeout(240_000)
  resetFindings(D)
  await flushRateLimits()
  adminState = await stateFor(EXTRA_ACCOUNTS.superadmin)
  const adminApi = await apiAs(EXTRA_ACCOUNTS.superadmin)
  try {
    const suffix = uniqueSuffix()
    qaEmail = `qa.reg.ui.clin.${suffix}@stpaulos.local`
    const created = await call(adminApi, 'POST', '/api/admin/users', {
      data: { fullName: `${PREFIX}nurse ${suffix}`, email: qaEmail, password: DEV_PASSWORD, role: 'nurse', active: true, passwordChangeRequired: false },
    })
    qaUserId = created.json?.id ?? created.json?.user?.id ?? ''
    if (!qaUserId) throw new Error(`QA nurse not created: ${created.status} ${created.text.slice(0, 160)}`)
  } finally {
    await adminApi.dispose()
  }
  nurseState = await stateFor(qaEmail, DEV_PASSWORD)
  iso = await createIsolatedAssignment(qaEmail, DEV_PASSWORD, 'gi_neuro_inpatient')
  cells = templateCells(iso.templateDbId, 3)
  dbReads++
  info(D, 'D-setup', 'Isolated assignment for the seeded nurse', `${iso.departmentSlug} (${iso.departmentName}) period ${iso.periodLabel} cells ${cells.map((c) => c.fieldKey).join(',')}`)
})

test.afterAll(async () => {
  if (iso?.assignmentId) {
    const r = await retireAssignment(iso.assignmentId)
    info(D, 'D-teardown', 'Isolated assignment retired (PATCH active:false)', String(r.status))
  }
  if (qaUserId) {
    const adminApi = await apiAs(EXTRA_ACCOUNTS.superadmin)
    try {
      await call(adminApi, 'PATCH', `/api/admin/users/${qaUserId}`, { data: { active: false } })
    } finally {
      await adminApi.dispose()
    }
    forgetSession(qaEmail)
  }
  info(D, 'D-reads', 'Database re-reads performed by this spec', `db=${dbReads}`)
})

async function nursePage(browser: Browser) {
  const context = await browser.newContext({ storageState: nurseState })
  const hits = trackMutations(context)
  const page = await context.newPage()
  return { context, page, hits }
}

async function adminPage(browser: Browser, viewport?: { width: number; height: number }) {
  const context = await browser.newContext({ storageState: adminState, ...(viewport ? { viewport } : {}) })
  const hits = trackMutations(context)
  const page = await context.newPage()
  return { context, page, hits }
}

const statusLine = (page: Page) => page.locator('p[role="status"]').first()

test('D-1 nurse: My Reports -> real form -> Save draft -> reload -> edit -> Submit (DB re-read at each step)', async ({ browser }) => {
  test.setTimeout(240_000)
  const { context, page, hits } = await nursePage(browser)
  try {
    // --- open the current week's report from My Reports
    await page.goto('/nurse/reports', { waitUntil: 'domcontentloaded' })
    await shellReady(page)
    const href = `/reports/${iso.assignmentId}/${iso.periodId}`
    const openLink = page.locator(`a[href="${href}"]`).first()
    await expect(openLink).toBeVisible({ timeout: 30_000 })
    const linkText = (await openLink.textContent())?.trim() ?? ''
    check(D, 'D-01', 'My Reports shows the current week card for the assignment with an "Open" link (report-selection-page.tsx, canEdit)', 'Open', linkText, /open/i.test(linkText))
    await openLink.click()
    await page.waitForURL(new RegExp(href.replace(/\//g, '\\/')), { timeout: 30_000 })
    await expect(firstCell(page)).toBeVisible({ timeout: 30_000 })
    check(D, 'D-02', 'Report page renders the form with editable numeric cells ("Editing live" chip)', 'Editing live', (await page.getByText('Editing live').first().isVisible()) ? 'Editing live' : 'absent', await page.getByText('Editing live').first().isVisible())
    check(D, 'D-02b', 'No report row exists for (assignment, period) before the first save', '0', String(reportCount(iso.assignmentId, iso.periodId)), (dbReads++, reportCount(iso.assignmentId, iso.periodId)) === 0)

    // --- type three cells, Save draft: exactly one request, DB re-read
    const values = ['7', '11', '13']
    for (const [i, c] of cells.entries()) await desktopCell(page, c, 'monday').fill(values[i])
    const t0 = Date.now()
    await page.getByRole('button', { name: /^save draft$/i }).first().click()
    await expect(statusLine(page)).toHaveText(/draft saved/i, { timeout: 40_000 })
    await sleep(2500) // let a trailing autosave (if any) show up in the request log
    const saveHits = hitsSince(hits, t0, /^\/api\/reports/)
    check(D, 'AE-01', 'One "Save draft" click performs exactly one report save request (report-form.tsx saveDraft; autosave paused while saving)', '1 x POST /api/reports', saveHits.map((h) => `${h.method} ${h.path}`).join(', ') || 'none', saveHits.length === 1 && saveHits[0].method === 'POST')

    let r = row(iso)
    reportId = r?.id ?? ''
    check(D, 'D-03', 'Save draft creates ONE reports row with status draft (ReportSubmissionService::save)', 'draft/1 row', `${r?.status}/${(dbReads++, reportCount(iso.assignmentId, iso.periodId))}`, r?.status === 'draft' && reportCount(iso.assignmentId, iso.periodId) === 1)
    const stored = cells.map((c) => cellOf(reportId, c, 'monday'))
    check(D, 'D-04', 'report_field_values hold the three typed monday values', values.join(','), stored.join(','), stored.join(',') === values.join(','))
    check(D, 'D-05', 'reports.updated_at is set to now (within a minute) on the first save', 'now', String(r?.updated_at), Math.abs(Date.now() - (parseTs(r?.updated_at) ?? 0)) < 60_000)
    const hist1 = (dbReads++, historyCount(reportId))
    check(D, 'D-06', 'status history has one row ("draft" created) after the first save', '1', String(hist1), hist1 === 1)

    // --- reload: values persist in the inputs
    await page.reload({ waitUntil: 'domcontentloaded' })
    await expect(firstCell(page)).toBeVisible({ timeout: 30_000 })
    const shown = await Promise.all(cells.map((c) => desktopCell(page, c, 'monday').inputValue()))
    check(D, 'D-07', 'After reload the inputs show the saved values (form hydrated from the server copy)', values.join(','), shown.join(','), shown.join(',') === values.join(','))

    // --- edit one cell, save while the request is held: buttons disabled during the pending save
    const updatedBefore = r?.updated_at
    await sleep(1100) // updated_at is second-precision; make the advance observable
    let release: () => void = () => {}
    const held = new Promise<void>((res) => (release = res))
    await page.route('**/api/reports', async (route) => {
      await held
      await route.continue()
    })
    await desktopCell(page, cells[0], 'monday').fill('21')
    const t1 = Date.now()
    const saveBtn = page.getByRole('button', { name: /^(save draft|saving\.\.\.)$/i }).first()
    const submitBtn = page.getByRole('button', { name: /^(submit report|submitting\.\.\.)$/i }).first()
    await saveBtn.click()
    await expect(saveBtn).toBeDisabled({ timeout: 10_000 })
    const pendingState = { save: await saveBtn.isDisabled(), submit: await submitBtn.isDisabled(), label: (await saveBtn.textContent())?.trim() }
    release()
    check(D, 'AE-02', 'While a save is pending both Save draft and Submit are disabled and the button reads "Saving..."', 'save disabled, submit disabled, "Saving..."', JSON.stringify(pendingState), pendingState.save && pendingState.submit && /saving/i.test(pendingState.label ?? ''))
    await expect(statusLine(page)).toHaveText(/draft saved/i, { timeout: 40_000 })
    await page.unroute('**/api/reports')
    await sleep(2000)
    const editHits = hitsSince(hits, t1, /^\/api\/reports/)
    check(D, 'AE-03', 'The second Save click again performs exactly one save request', '1', editHits.map((h) => `${h.method} ${h.path}`).join(', ') || 'none', editHits.length === 1)
    r = row(iso)
    check(D, 'D-08', 'Editing one cell and saving updates that cell only, still ONE reports row, updated_at advanced', `21,${values[1]},${values[2]} / 1 row / advanced`, `${cells.map((c) => cellOf(reportId, c, 'monday')).join(',')} / ${(dbReads++, reportCount(iso.assignmentId, iso.periodId))} rows / ${r?.updated_at} > ${updatedBefore}`, cellOf(reportId, cells[0], 'monday') === '21' && cellOf(reportId, cells[1], 'monday') === values[1] && reportCount(iso.assignmentId, iso.periodId) === 1 && (parseTs(r?.updated_at) ?? 0) > (parseTs(updatedBefore) ?? 0))
    const hist2 = (dbReads++, historyCount(reportId))
    check(D, 'D-09', 'Draft edits add no status-history rows (only status transitions are recorded)', String(hist1), String(hist2), hist2 === hist1)

    // --- Submit
    const t2 = Date.now()
    await submitBtn.click()
    const outcome = await Promise.race([
      page.getByText(/report submitted/i).first().waitFor({ timeout: 40_000 }).then(() => 'submitted'),
      statusLine(page).filter({ hasText: /required|missing|invalid|must|complete/i }).waitFor({ timeout: 40_000 }).then(() => 'validation'),
    ]).catch(() => 'timeout')
    if (outcome === 'validation') {
      // The template requires more cells: fill every empty numeric input with 1 and submit again.
      info(D, 'D-10-note', 'Submit was refused by form validation first; empty cells filled with 1 and re-submitted', (await statusLine(page).textContent()) ?? '')
      const empties = page.getByRole('spinbutton')
      const n = await empties.count()
      for (let i = 0; i < n; i++) {
        const el = empties.nth(i)
        if ((await el.inputValue()) === '' && (await el.isEditable())) await el.fill('1')
      }
      await page.getByRole('button', { name: /^submit report$/i }).first().click()
      await expect(page.getByText(/report submitted/i).first()).toBeVisible({ timeout: 40_000 })
    }
    await expect(page.getByText(/^Submitted /).first()).toBeVisible({ timeout: 30_000 })
    await sleep(1500)
    const submitHits = hitsSince(hits, t2, /^\/api\/reports/)
    r = row(iso)
    check(D, 'D-10', 'Submit report -> chip "Submitted <time>" and DB status=submitted with submitted_at set', 'submitted', `${r?.status}/${r?.submitted_at}`, r?.status === 'submitted' && !!r?.submitted_at)
    check(D, 'AE-04', 'Submit click performs one save request per attempt (no duplicate submission)', `${outcome === 'validation' ? 2 : 1}`, String(submitHits.length), submitHits.length === (outcome === 'validation' ? 2 : 1))
    const hist3 = (dbReads++, historyCount(reportId))
    check(D, 'D-11', 'Submission adds exactly one status-history row ("submitted")', String(hist2 + 1), String(hist3), hist3 === hist2 + 1)
    check(D, 'D-12', 'Still one reports row for (assignment, period) after submit', '1', String((dbReads++, reportCount(iso.assignmentId, iso.periodId))), reportCount(iso.assignmentId, iso.periodId) === 1)
  } finally {
    await page.screenshot({ path: path.join(SHOTS, 'ui-clinical-D1.png'), fullPage: true }).catch(() => {})
    await context.close()
  }
})

test('D-2 admin locks through the UI; nurse form read-only; forced PUT refused; unlock restores editing', async ({ browser }) => {
  test.setTimeout(240_000)
  expect(reportId, 'D-1 must have created the report').toBeTruthy()
  const admin = await adminPage(browser)
  const nurse = await nursePage(browser)
  try {
    await openReport(admin.page, iso.assignmentId, iso.periodId)
    const lockBtn = admin.page.getByRole('button', { name: /^lock report$/i })
    await expect(lockBtn).toBeVisible({ timeout: 30_000 })
    const t0 = Date.now()
    await lockBtn.click()
    await expect(admin.page.getByRole('button', { name: /^unlock report$/i })).toBeVisible({ timeout: 40_000 })
    await sleep(1000)
    const lockHits = hitsSince(admin.hits, t0, /^\/api\/reports\/[^/]+\/lock$/)
    let r = row(iso)
    check(D, 'D-13', 'Admin "Lock report" button -> POST /api/reports/{id}/lock once, DB status=locked with locked_at', 'locked / 1 request', `${r?.status}/${r?.locked_at} / ${lockHits.length}`, r?.status === 'locked' && !!r?.locked_at && lockHits.length === 1)

    // nurse: read-only surface
    await openReport(nurse.page, iso.assignmentId, iso.periodId)
    await expect(nurse.page.getByText(/read only/i).first()).toBeVisible({ timeout: 30_000 })
    const saveDisabled = await nurse.page.getByRole('button', { name: /^save draft$/i }).first().isDisabled()
    const submitDisabled = await nurse.page.getByRole('button', { name: /^submit report$/i }).first().isDisabled()
    const inputs = await nurse.page.getByRole('spinbutton').evaluateAll((els) => ({ total: els.length, disabled: els.filter((e) => (e as HTMLInputElement).disabled).length }))
    check(D, 'D-14', 'Locked report: nurse sees "Read only", Save draft and Submit disabled, every cell input disabled (canEdit=false)', 'save+submit disabled, all inputs disabled', `save=${saveDisabled} submit=${submitDisabled} inputs=${inputs.disabled}/${inputs.total}`, saveDisabled && submitDisabled && inputs.total > 0 && inputs.disabled === inputs.total)
    const enabledButtons: string[] = await nurse.page.evaluate(() => Array.from(document.querySelectorAll('button:not([disabled])')).map((b) => (b.textContent ?? '').trim()))
    const leaked = enabledButtons.filter((t) => /^(save( draft)?|submit( report)?|saving|submitting)/i.test(t))
    check(D, 'AE-05', 'No hidden Save/Submit control became active while locked (button:not([disabled]) sweep)', 'none', leaked.join(',') || 'none', leaked.length === 0, `${enabledButtons.length} enabled buttons`)

    // forced save through the API as the nurse
    const before = cellOf(reportId, cells[0], 'monday')
    const nurseApi = await apiAs(qaEmail, DEV_PASSWORD)
    let put
    try {
      put = await call(nurseApi, 'PUT', `/api/reports/${reportId}`, { data: { values: { [cells[0].fieldKey]: { fieldId: cells[0].fieldKey, dailyValues: { monday: 99 } } } } })
    } finally {
      await nurseApi.dispose()
    }
    const after = cellOf(reportId, cells[0], 'monday')
    check(D, 'D-15', 'A nurse PUT against a locked report is refused by ReportPolicy::update (403) and the cell is unchanged', `403 / ${before}`, `${put.status} / ${after}`, put.status === 403 && after === before, put.text.slice(0, 160))

    // unlock through the UI
    const t1 = Date.now()
    await admin.page.getByRole('button', { name: /^unlock report$/i }).click()
    await expect(admin.page.getByRole('button', { name: /^lock report$/i })).toBeVisible({ timeout: 40_000 })
    await sleep(1000)
    const unlockHits = hitsSince(admin.hits, t1, /^\/api\/reports\/[^/]+\/unlock$/)
    r = row(iso)
    check(D, 'D-16', 'Admin "Unlock report" -> one POST .../unlock, DB locked_at cleared and status back to submitted', 'submitted / null / 1', `${r?.status} / ${r?.locked_at} / ${unlockHits.length}`, r?.status === 'submitted' && r?.locked_at === null && unlockHits.length === 1)

    await nurse.page.reload({ waitUntil: 'domcontentloaded' })
    await expect(firstCell(nurse.page)).toBeVisible({ timeout: 30_000 })
    await expect(nurse.page.getByText('Editing live').first()).toBeVisible({ timeout: 30_000 })
    const saveEnabled = await nurse.page.getByRole('button', { name: /^save draft$/i }).first().isEnabled()
    check(D, 'D-17', 'After unlock the nurse form is editable again ("Editing live", Save enabled)', 'enabled', saveEnabled ? 'enabled' : 'disabled', saveEnabled)
  } finally {
    await nurse.page.screenshot({ path: path.join(SHOTS, 'ui-clinical-D2-nurse.png'), fullPage: true }).catch(() => {})
    await nurse.context.close()
    await admin.context.close()
  }
})

test('AE-6 sheet Close buttons: action-item sheet and phone account sheet close, restore focus, send nothing', async ({ browser }) => {
  test.setTimeout(240_000)
  // A QA action item so the sheet has a known, harmless target.
  const adminApi = await apiAs(EXTRA_ACCOUNTS.superadmin)
  let itemId = ''
  try {
    const created = await call(adminApi, 'POST', '/api/admin/action-items', { data: { title: `${PREFIX}sheet ${uniqueSuffix()}`, severity: 'low' } })
    itemId = created.json?.id ?? ''
    info(D, 'AE-6-setup', 'QA action item created', `${created.status} ${itemId}`)
  } finally {
    await adminApi.dispose()
  }
  const admin = await adminPage(browser)
  try {
    // (a) deep-linked sheet (?item=) closed with its Close button
    await admin.page.goto(`/admin/action-items?item=${itemId}`, { waitUntil: 'domcontentloaded' })
    const dialog = admin.page.getByRole('dialog')
    await expect(dialog).toBeVisible({ timeout: 30_000 })
    await expect(dialog.getByText(/Assignment/)).toBeVisible({ timeout: 30_000 })
    await sleep(1500)
    const statusBefore = q.one<{ status: string; updated_at: string }>('select status, updated_at from action_items where id = ?', [itemId])
    const t0 = Date.now()
    await dialog.getByRole('button', { name: 'Close' }).click()
    const trail: string[] = []
    for (let i = 0; i < 8; i++) {
      await sleep(500)
      trail.push((await dialog.isVisible()) ? 'open' : 'closed')
    }
    const deepLinkClosed = trail[trail.length - 1] === 'closed'
    const closeHits = hitsSince(admin.hits, t0, /^\/api\/admin\/action-items/)
    const statusAfter = q.one<{ status: string; updated_at: string }>('select status, updated_at from action_items where id = ?', [itemId])
    await admin.page.screenshot({ path: path.join(SHOTS, 'ui-clinical-AE6-deeplink-close.png') }).catch(() => {})
    check(D, 'AE-06', 'Deep-linked action-item sheet (/admin/action-items?item=ID): the "Close" button closes the sheet and drops ?item= (action-items-page.tsx closeSheet)', 'closed within 4 s, no item param', `${trail.join(',')}; url ${new URL(admin.page.url()).search || '(none)'}`, deepLinkClosed && !admin.page.url().includes('item='), `screenshot output/regression/shots/ui-clinical-AE6-deeplink-close.png`)
    check(D, 'AE-06a', 'Closing the sheet sends no action-item request and leaves the row unchanged', '0 requests, unchanged', `${closeHits.length} requests, ${statusBefore?.updated_at} -> ${statusAfter?.updated_at}`, closeHits.length === 0 && statusBefore?.updated_at === statusAfter?.updated_at)
    if (!deepLinkClosed) {
      await admin.page.keyboard.press('Escape')
      await expect(dialog).toBeHidden({ timeout: 15_000 }).catch(() => {})
      info(D, 'AE-06-note', 'Deep-linked sheet needed a second dismissal (Escape) after the Close button', (await dialog.isVisible()) ? 'still open' : 'closed on second dismissal')
    }

    // (b) sheet opened from the row's "Open <title>" button, closed with Close: focus returns to the trigger
    await admin.page.goto('/admin/action-items', { waitUntil: 'domcontentloaded' })
    await shellReady(admin.page)
    const trigger = admin.page.locator('main button[aria-label^="Open "]:visible').first()
    await expect(trigger).toBeVisible({ timeout: 30_000 })
    const triggerName = await trigger.getAttribute('aria-label')
    await trigger.click()
    await expect(dialog).toBeVisible({ timeout: 30_000 })
    await expect(dialog.getByText(/Assignment/)).toBeVisible({ timeout: 30_000 })
    const focusOnOpen = await admin.page.evaluate(() => Boolean(document.activeElement?.closest('[role="dialog"]')))
    const t1 = Date.now()
    await dialog.getByRole('button', { name: 'Close' }).click()
    await expect(dialog).toBeHidden({ timeout: 15_000 })
    await sleep(800)
    const focus = await admin.page.evaluate(() => ({ name: document.activeElement?.getAttribute('aria-label') ?? (document.activeElement?.textContent ?? '').trim().slice(0, 40), inDialog: Boolean(document.activeElement?.closest('[role="dialog"]')) }))
    const rowCloseHits = hitsSince(admin.hits, t1, /^\/api\/admin\/action-items/)
    check(D, 'AE-06b', 'Row-opened action-item sheet: Close button closes it, focus moves into the sheet on open and returns to the "Open <title>" trigger on close (sheet.tsx handleCloseAutoFocus), no request sent', `closed, focus in on open, focus "${triggerName}", 0 requests`, `closed, focusOnOpen=${focusOnOpen}, focus "${focus.name}", ${rowCloseHits.length} requests`, focusOnOpen && focus.name === triggerName && rowCloseHits.length === 0)
  } finally {
    await admin.context.close()
  }

  // Phone account sheet ("More" tab) as admin: opens, links navigate, Close works.
  const phone = await adminPage(browser, { width: 390, height: 740 })
  try {
    await phone.page.goto('/admin', { waitUntil: 'domcontentloaded' })
    await shellReady(phone.page)
    const tabBar = phone.page.getByRole('navigation', { name: 'Primary' })
    await expect(tabBar).toBeVisible({ timeout: 30_000 })
    await tabBar.getByRole('button', { name: 'More' }).click()
    const sheet = phone.page.getByRole('dialog')
    await expect(sheet).toBeVisible({ timeout: 15_000 })
    await expect(sheet.getByRole('link', { name: 'Settings' })).toBeVisible()
    await sheet.getByRole('button', { name: 'Close' }).click()
    await expect(sheet).toBeHidden({ timeout: 15_000 })
    const focusAfter = await phone.page.evaluate(() => (document.activeElement?.textContent ?? '').trim().slice(0, 20))
    check(D, 'AE-07', 'Phone "More" opens the account sheet; its Close button closes it and returns focus to the More tab (app-shell.tsx restoreMenuFocus)', 'closed, focus "More"', `closed, focus "${focusAfter}"`, /more/i.test(focusAfter))
    await tabBar.getByRole('button', { name: 'More' }).click()
    await expect(sheet).toBeVisible({ timeout: 15_000 })
    await sheet.getByRole('link', { name: 'Settings' }).click()
    await phone.page.waitForURL(/\/admin\/settings/, { timeout: 30_000 })
    await expect(sheet).toBeHidden({ timeout: 15_000 })
    check(D, 'AE-08', 'A link inside the account sheet navigates and closes the sheet', '/admin/settings', new URL(phone.page.url()).pathname, new URL(phone.page.url()).pathname === '/admin/settings')
    const overflow = await horizontalOverflow(phone.page)
    check(D, 'AE-08b', 'No horizontal overflow on /admin/settings at 390px', '<= 2', String(overflow), overflow <= 2)
  } finally {
    await phone.context.close()
  }
})

test('AE-9 Radix Select filter, workspace toggle, chart SVGs, settings toggles still work (admin)', async ({ browser }) => {
  test.setTimeout(240_000)
  const admin = await adminPage(browser)
  try {
    // --- submission board status filter (Radix Select)
    await admin.page.goto('/admin/submissions', { waitUntil: 'domcontentloaded' })
    await shellReady(admin.page)
    const status = admin.page.getByRole('combobox', { name: 'Status' })
    await expect(status).toBeVisible({ timeout: 30_000 })
    await admin.page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {})
    const linksBefore = await admin.page.locator('a[href^="/reports/"]').count()
    const descBefore = (await admin.page.getByText(/All statuses/).first().textContent().catch(() => '')) ?? ''
    await status.click()
    await admin.page.getByRole('option', { name: 'Submitted', exact: true }).click()
    await expect(status).toHaveText(/submitted/i, { timeout: 15_000 })
    await sleep(800)
    const linksAfter = await admin.page.locator('a[href^="/reports/"]').count()
    const badgeStatuses = await admin.page.locator('a[href^="/reports/"]').evaluateAll((els) => Array.from(new Set(els.map((e) => (e.textContent ?? '').trim().toLowerCase()))).slice(0, 8))
    const descAfter = (await admin.page.getByText(/\/ Submitted \//).first().textContent().catch(() => '')) ?? ''
    check(D, 'AE-09', 'Submission board status Select changes the filter: trigger shows "Submitted", the summary line carries it and the board re-filters (submission-board-page.tsx)', 'trigger=Submitted, summary "/ Submitted /", links <= before', `links ${linksBefore}->${linksAfter}, badges ${JSON.stringify(badgeStatuses)}, summary "${descAfter.slice(0, 80)}"`, descAfter.includes('Submitted') && linksAfter <= linksBefore, `before summary: ${descBefore.slice(0, 80)}`)

    // --- workspace toggle
    await admin.page.goto('/admin', { waitUntil: 'domcontentloaded' })
    await shellReady(admin.page)
    const group = admin.page.getByRole('group', { name: 'Workspace' }).first()
    await expect(group).toBeVisible({ timeout: 30_000 })
    await expect(admin.page.getByRole('link', { name: /templates/i }).first()).toBeVisible({ timeout: 30_000 })
    await group.getByRole('button', { name: 'Academic' }).click()
    await expect(group.getByRole('button', { name: 'Academic' })).toHaveAttribute('aria-pressed', 'true', { timeout: 15_000 })
    const templatesGone = (await admin.page.getByRole('link', { name: /templates/i }).count()) === 0
    const stored = await admin.page.evaluate(() => window.localStorage.getItem('stpaul:workspace'))
    check(D, 'AE-10', 'Workspace switcher Clinical->Academic: aria-pressed moves, clinical-only nav (Templates) disappears, localStorage stpaul:workspace=academic (workspace.spec.ts)', 'pressed, no Templates, "academic"', `pressed, templates gone=${templatesGone}, stored=${stored}`, templatesGone && stored === 'academic')
    await group.getByRole('button', { name: 'Clinical' }).click()
    await expect(group.getByRole('button', { name: 'Clinical' })).toHaveAttribute('aria-pressed', 'true', { timeout: 15_000 })
    await expect(admin.page.getByRole('link', { name: /templates/i }).first()).toBeVisible({ timeout: 30_000 })
    check(D, 'AE-10b', 'Switching back to Clinical restores the clinical nav', 'Templates visible', 'Templates visible', true)

    // --- chart SVGs on the dashboard
    await admin.page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {})
    await sleep(1500)
    const svgs = await admin.page.evaluate(() => ({ application: document.querySelectorAll('svg[role="application"]').length, recharts: document.querySelectorAll('svg.recharts-surface').length, any: document.querySelectorAll('main svg').length }))
    check(D, 'AE-11', 'Dashboard charts render as accessible SVGs (recharts 3 accessibilityLayer: svg[role=application] > 0)', '> 0', JSON.stringify(svgs), svgs.application > 0)

    // --- settings: Switch + direction Select change, save, verify (API + DB), restore
    const adminApi = await apiAs(EXTRA_ACCOUNTS.superadmin)
    try {
      const original = (await call(adminApi, 'GET', '/api/admin/settings')).json?.settings
      const targetKey = Object.keys(original?.metricTargets ?? {})[0]
      expect(targetKey, 'settings must expose at least one metric target').toBeTruthy()
      await admin.page.goto('/admin/settings', { waitUntil: 'domcontentloaded' })
      await shellReady(admin.page)
      const saveBtn = admin.page.getByRole('button', { name: /save settings/i })
      await expect(saveBtn).toBeVisible({ timeout: 30_000 })
      const switches = admin.page.getByRole('switch', { name: /target enabled$/ })
      const sw = switches.first()
      await expect(sw).toBeVisible({ timeout: 30_000 })
      const swName = (await sw.getAttribute('aria-label')) ?? ''
      const targetLabel = swName.replace(/ target enabled$/, '')
      const checkedBefore = await sw.getAttribute('aria-checked')
      await sw.click()
      const checkedAfter = await sw.getAttribute('aria-checked')
      const dir = admin.page.getByRole('combobox', { name: `${targetLabel} direction` })
      const dirBefore = (await dir.textContent())?.trim()
      await dir.click()
      await admin.page.getByRole('option', { name: dirBefore === 'At least' ? 'At most' : 'At least' }).click()
      const dirAfter = (await dir.textContent())?.trim()
      const chip = (await admin.page.getByText(/^Saved$|^Unsaved changes$/).first().textContent()) ?? ''
      const t0 = Date.now()
      await saveBtn.click()
      await expect(admin.page.getByText(/^Saved$/).first()).toBeVisible({ timeout: 40_000 })
      await sleep(1000)
      const saveHits = hitsSince(admin.hits, t0, /^\/api\/admin\/settings/)
      const after = (await call(adminApi, 'GET', '/api/admin/settings')).json?.settings
      const changed = Object.keys(after?.metricTargets ?? {}).filter((k) => JSON.stringify(after.metricTargets[k]) !== JSON.stringify(original.metricTargets[k]))
      const changedKey = changed[0]
      const uiTarget = changedKey ? after.metricTargets[changedKey] : null
      const origTarget = changedKey ? original.metricTargets[changedKey] : null
      const dbRow = q.one<Record<string, any>>('select * from app_settings limit 1')
      const dbText = JSON.stringify(dbRow ?? {})
      check(D, 'AE-12', 'Settings Switch toggles aria-checked and the direction Select changes its value; the chip reads "Unsaved changes"', 'checked flips, direction flips, Unsaved changes', `${checkedBefore}->${checkedAfter}, ${dirBefore}->${dirAfter}, chip "${chip}"`, checkedBefore !== checkedAfter && dirBefore !== dirAfter && /unsaved/i.test(chip))
      check(D, 'AE-13', `Save settings -> one PATCH /api/admin/settings; exactly one metric target (${targetLabel}) changed in the API re-read with enabled and direction flipped; app_settings row carries the key`, '1 PATCH, 1 changed key, enabled+direction flipped', `${saveHits.map((h) => h.method).join(',')}; changed=${JSON.stringify(changed)}; ${JSON.stringify(origTarget)} -> ${JSON.stringify(uiTarget)}; db has key=${changedKey ? dbText.includes(changedKey) : false}`, saveHits.length === 1 && saveHits[0].method === 'PATCH' && changed.length === 1 && !!uiTarget && uiTarget.enabled === !origTarget.enabled && uiTarget.direction !== origTarget.direction)
      // restore
      const restore = await call(adminApi, 'PATCH', '/api/admin/settings', { data: { metricTargets: original.metricTargets } })
      const restored = (await call(adminApi, 'GET', '/api/admin/settings')).json?.settings
      check(D, 'AE-13r', 'Settings restored to the original metric targets after the check', 'identical', restore.status + ' ' + (JSON.stringify(restored?.metricTargets) === JSON.stringify(original.metricTargets) ? 'identical' : 'differs'), restore.status === 200 && JSON.stringify(restored?.metricTargets) === JSON.stringify(original.metricTargets))
    } finally {
      await adminApi.dispose()
    }
  } finally {
    await admin.page.screenshot({ path: path.join(SHOTS, 'ui-clinical-AE9.png'), fullPage: true }).catch(() => {})
    await admin.context.close()
  }
})
