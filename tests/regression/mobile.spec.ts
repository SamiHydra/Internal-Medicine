/**
 * UI regression, Phase 8: mobile business flows at 320/360/375/390/430 px must
 * still reach the database, with no horizontal overflow and >= 44 px tap
 * targets on the buttons that were tapped.
 *
 * Source of truth: tests/e2e/responsive.spec.ts, tests/e2e/mobile-overflow-sweep.spec.ts,
 * tests/e2e/v2-role-workflows.spec.ts, tests/e2e/academic-evaluation-submit.spec.ts,
 * src/components/reports/report-form.tsx (phone day picker, mobile-<section>-<field>-<day> inputs),
 * src/pages/teaching/rep-log-page.tsx, src/pages/notifications-page.tsx,
 * src/components/action-items/action-item-sheet.tsx, src/components/ui/button.tsx
 * (pointer-coarse:min-h-11 on size sm/icon).
 *
 * Flows per width: nurse (tab bar -> My Reports -> report -> day tab -> value -> Save),
 * resident (/academic/submit -> subject -> rating -> Submit), student rep (/teaching
 * -> Held / Not held), nurse notifications (open one -> read; Clear inbox -> Restore),
 * admin action-item sheet at 390 (Start -> Close). Every mutation is re-read from SQLite.
 *
 *   npx playwright test --config playwright.regression.config.ts tests/regression/mobile.spec.ts
 */
import { test, expect, type Browser, type BrowserContext, type Locator, type Page } from '@playwright/test'
import { randomUUID } from 'node:crypto'
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
  recordFinding,
  resetFindings,
  uniqueSuffix,
  stateFor,
  EXTRA_ACCOUNTS,
  OUTPUT_DIR,
  QA_PREFIX,
} from './helpers/index'
import {
  shellReady,
  tapOrClick,
  horizontalOverflow,
  createIsolatedAssignment,
  retireAssignment,
  templateCells,
  reportRow,
  dbCell,
  mobileCell,
  sleep,
  type Isolated,
  type CellDef,
} from './helpers/ui'

/* eslint-disable @typescript-eslint/no-explicit-any */

const D = 'mobile'
const PREFIX = `${QA_PREFIX}_UI_`
const SHOTS = path.join(OUTPUT_DIR, 'shots')
const WIDTHS = [320, 360, 375, 390, 430] as const
const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']

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

let iso: Isolated
let cell: CellDef
const states: Record<string, string> = {}
let residentId = ''
let residentSubjects: { id: string; fullName: string }[] = []
let serverToday = ''
let repSessions: { id: string; activityType: string; scheduledDate: string; status: string }[] = []
let qaItemId = ''
const qaNotificationIds: Record<number, string> = {}

test.beforeAll(async () => {
  test.setTimeout(240_000)
  resetFindings(D)
  await flushRateLimits()
  for (const [key, id] of Object.entries({ nurse: EXTRA_ACCOUNTS.nurse, resident: EXTRA_ACCOUNTS.resident, rep: EXTRA_ACCOUNTS.studentRep, admin: EXTRA_ACCOUNTS.superadmin })) {
    states[key] = await stateFor(id)
  }
  iso = await createIsolatedAssignment(EXTRA_ACCOUNTS.nurse, undefined, 'hdu_inpatient')
  cell = templateCells(iso.templateDbId, 1)[0]
  dbReads++

  // resident: eligible subjects not yet evaluated today (academic-evaluation-submit.spec.ts)
  const resident = await apiAs(EXTRA_ACCOUNTS.resident)
  try {
    residentId = (await call(resident, 'GET', '/api/auth/me')).json?.user?.id ?? ''
    const opts = (await call(resident, 'GET', '/api/academic/form-options')).json ?? {}
    serverToday = opts.date ?? ''
    const subs: any[] = (await call(resident, 'GET', '/api/academic/my-submissions')).json?.data ?? []
    residentSubjects = (opts.subjects ?? []).filter((s: any) => !subs.some((d) => d.subjectId === s.id && String(d.evaluationDate ?? '').slice(0, 10) === serverToday))
  } finally {
    await resident.dispose()
  }
  // student rep: this week's sessions
  const rep = await apiAs(EXTRA_ACCOUNTS.studentRep)
  try {
    repSessions = (await call(rep, 'GET', '/api/teaching/my-sessions')).json?.data ?? []
  } finally {
    await rep.dispose()
  }
  // admin: a QA action item (assigned to its creator, so "Start" is available) and QA notifications for the nurse
  const admin = await apiAs(EXTRA_ACCOUNTS.superadmin)
  try {
    const item = await call(admin, 'POST', '/api/admin/action-items', { data: { title: `${PREFIX}mobile ${uniqueSuffix()}`, severity: 'low' } })
    qaItemId = item.json?.id ?? ''
    const notifications = WIDTHS.map((w) => {
      const id = randomUUID()
      qaNotificationIds[w] = id
      return { id, userId: iso.nurseId, type: 'system', title: `${PREFIX}notif ${w}`, message: `Mobile regression notification for ${w}px`, relatedRoute: '/notifications', readAt: null }
    })
    const seeded = await call(admin, 'POST', '/api/notifications/restore', { data: { notifications } })
    info(D, 'M-setup', 'Fixtures', `assignment ${iso.departmentSlug} cell ${cell.fieldKey}; resident free subjects ${residentSubjects.length} (today ${serverToday}); rep sessions ${repSessions.length}; item ${item.status} ${qaItemId}; notifications ${seeded.status} restored=${seeded.json?.restored}`)
  } finally {
    await admin.dispose()
  }
})

test.afterAll(async () => {
  if (iso?.assignmentId) await retireAssignment(iso.assignmentId)
  info(D, 'M-reads', 'Database re-reads performed by this spec', `db=${dbReads}`)
})

async function phone(browser: Browser, state: string, width: number): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ storageState: state, viewport: { width, height: 740 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 })
  const page = await context.newPage()
  return { context, page }
}

async function height(locator: Locator): Promise<number> {
  const box = await locator.boundingBox()
  return box ? Math.round(box.height) : 0
}

async function overflowCheck(page: Page, width: number, id: string, route: string): Promise<void> {
  await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {})
  await sleep(300)
  const o = await horizontalOverflow(page)
  check(D, id, `No horizontal overflow on ${route} @ ${width}px (scrollWidth <= clientWidth + 2)`, '<= 2', String(o), o <= 2)
}

function tapCheck(width: number, id: string, what: string, h: number): void {
  check(D, id, `${what} tapped @ ${width}px is >= 44 px tall (WCAG 2.5.5; button.tsx pointer-coarse:min-h-11)`, '>= 44', `${h}px`, h >= 44)
}

for (const width of WIDTHS) {
  test(`nurse @ ${width}: tab bar -> My Reports -> report -> day tab -> value -> Save -> DB`, async ({ browser }) => {
    test.setTimeout(240_000)
    const { context, page } = await phone(browser, states.nurse, width)
    try {
      await page.goto('/nurse', { waitUntil: 'domcontentloaded' })
      await shellReady(page)
      const tabBar = page.getByRole('navigation', { name: 'Primary' })
      const reportsTab = tabBar.getByRole('link', { name: /reports/i })
      await expect(reportsTab).toBeVisible({ timeout: 30_000 })
      const tabH = await height(reportsTab)
      await tapOrClick(page, reportsTab)
      await page.waitForURL(/\/nurse\/reports/, { timeout: 30_000 })
      await overflowCheck(page, width, `N-${width}-ov1`, '/nurse/reports')
      const open = page.locator(`a[href="/reports/${iso.assignmentId}/${iso.periodId}"]`).first()
      await expect(open).toBeVisible({ timeout: 30_000 })
      const openH = await height(open)
      await tapOrClick(page, open)
      await page.waitForURL(/\/reports\//, { timeout: 30_000 })
      await expect(page.getByRole('button', { name: 'Next day' })).toBeVisible({ timeout: 30_000 })
      await overflowCheck(page, width, `N-${width}-ov2`, '/reports/{assignment}/{period}')

      // day picker: tap "Next day" then a specific day tab
      const next = page.getByRole('button', { name: 'Next day' })
      const nextH = await height(next)
      await tapOrClick(page, next)
      const activeAfterNext = await page.locator('button[aria-current="date"]').first().textContent()
      // The isolated assignment's template decides which day tabs exist
      // (outpatient templates run Monday to Friday), so pick from its own list.
      const activeDays: string[] = JSON.parse(q.one<{ active_days: string }>('select active_days from report_templates where id = ?', [iso.templateDbId])?.active_days ?? '[]')
      const days = activeDays.length ? activeDays : DAYS.slice(0, 5)
      const target = days[(WIDTHS.indexOf(width as any) % (days.length - 1)) + 1] // second day onwards
      const dayTab = page.getByRole('button', { name: new RegExp(`^${target.slice(0, 3)}$`, 'i') })
      await expect(dayTab).toBeVisible({ timeout: 15_000 })
      const dayH = await height(dayTab)
      await tapOrClick(page, dayTab)
      await expect(dayTab).toHaveAttribute('aria-current', 'date', { timeout: 10_000 })
      check(D, `N-${width}-01`, 'Day tabs switch the active day (aria-current=date follows "Next day" and the tapped day tab)', `tue then ${target.slice(0, 3)}`, `${activeAfterNext?.trim()} then ${target.slice(0, 3)}`, /tue/i.test(activeAfterNext ?? ''))

      const input = mobileCell(page, cell, target)
      await expect(input).toBeVisible({ timeout: 15_000 })
      const value = String(width % 100 + 3)
      await input.fill(value)
      const save = page.getByRole('button', { name: /^save( draft)?$/i }).last()
      await expect(save).toBeVisible()
      const saveH = await height(save)
      await tapOrClick(page, save)
      await expect(page.locator('p[role="status"]').first()).toHaveText(/draft saved/i, { timeout: 40_000 })
      dbReads += 2
      const r = reportRow(iso.assignmentId, iso.periodId)
      const stored = r ? dbCell(r.id, cell.fieldKey, target) : ''
      await page.screenshot({ path: path.join(SHOTS, `mobile-nurse-${width}.png`) }).catch(() => {})
      check(D, `N-${width}-02`, `Value typed into the active day's cell (${cell.fieldKey}/${target}) and saved from the phone footer reaches report_field_values`, value, stored, stored === value)
      tapCheck(width, `N-${width}-t1`, 'Tab-bar "Reports" link', tabH)
      tapCheck(width, `N-${width}-t2`, 'Report card "Open" link', openH)
      tapCheck(width, `N-${width}-t3`, '"Next day" button', nextH)
      tapCheck(width, `N-${width}-t4`, 'Day tab button', dayH)
      tapCheck(width, `N-${width}-t5`, 'Footer Save button', saveH)
    } finally {
      await context.close()
    }
  })

  test(`resident @ ${width}: /academic/submit touch flow -> DB`, async ({ browser }) => {
    test.setTimeout(240_000)
    const { context, page } = await phone(browser, states.resident, width)
    try {
      await page.goto('/academic/submit', { waitUntil: 'domcontentloaded' })
      await shellReady(page)
      const submit = page.getByRole('button', { name: /submit evaluation/i })
      await expect(submit).toBeVisible({ timeout: 30_000 })
      await overflowCheck(page, width, `R-${width}-ov`, '/academic/submit')
      const subject = residentSubjects[WIDTHS.indexOf(width as any)]
      if (!subject) {
        recordFinding(D, { id: `R-${width}-01`, rule: 'Resident evaluation submitted through the touch UI', expected: 'a free subject', actual: 'no un-evaluated subject left for today', status: 'SKIP' })
        return
      }
      const trigger = page.locator('[aria-label="Consultant evaluated"]')
      await expect(trigger).toBeVisible({ timeout: 30_000 })
      const trigH = await height(trigger)
      await tapOrClick(page, trigger)
      await tapOrClick(page, page.getByRole('option', { name: subject.fullName, exact: true }))
      const radio = page.getByRole('radiogroup', { name: 'Overall rating' }).getByRole('radio', { name: '5', exact: true })
      await expect(radio).toBeVisible({ timeout: 15_000 })
      const radioH = await height(radio)
      await tapOrClick(page, radio)
      const before = q.count('select count(*) c from evaluations where author_id = ? and subject_user_id = ? and date(evaluation_date) = ?', [residentId, subject.id, serverToday])
      const submitH = await height(submit)
      await tapOrClick(page, submit)
      // The success toast or a new row (whichever the page shows first); the
      // subject select's own placeholder starts with "Select", so it must not
      // be read as a validation message.
      let outcome = 'timeout'
      const deadline = Date.now() + 40_000
      while (Date.now() < deadline) {
        if (await page.getByText('Evaluation submitted.').first().isVisible().catch(() => false)) { outcome = 'submitted'; break }
        if (q.count('select count(*) c from evaluations where author_id = ? and subject_user_id = ? and date(evaluation_date) = ?', [residentId, subject.id, serverToday]) > before) { outcome = 'submitted'; break }
        const invalid = await page.locator('[aria-invalid="true"], [role="alert"]').count()
        if (invalid > 0 && (await page.getByText(/required|is invalid|unable|already/i).first().isVisible().catch(() => false))) { outcome = 'validation'; break }
        await sleep(500)
      }
      await sleep(1000)
      const after = q.count('select count(*) c from evaluations where author_id = ? and subject_user_id = ? and date(evaluation_date) = ?', [residentId, subject.id, serverToday])
      await page.screenshot({ path: path.join(SHOTS, `mobile-resident-${width}.png`) }).catch(() => {})
      check(D, `R-${width}-01`, `Resident evaluates ${subject.fullName} through the touch UI: "Evaluation submitted." and one new evaluations row (author, subject, ${serverToday})`, `submitted / ${before + 1}`, `${outcome} / ${after}`, outcome === 'submitted' && after === before + 1)
      tapCheck(width, `R-${width}-t1`, 'Subject Select trigger', trigH)
      tapCheck(width, `R-${width}-t2`, 'Rating radio "5"', radioH)
      tapCheck(width, `R-${width}-t3`, '"Submit evaluation" button', submitH)
    } finally {
      await context.close()
    }
  })

  test(`student rep @ ${width}: /teaching Held / Not held -> DB`, async ({ browser }) => {
    test.setTimeout(240_000)
    const { context, page } = await phone(browser, states.rep, width)
    try {
      await page.goto('/teaching', { waitUntil: 'domcontentloaded' })
      await shellReady(page)
      await overflowCheck(page, width, `S-${width}-ov`, '/teaching')
      // The first still-pending session in API order (the page renders the same order).
      const rep = await apiAs(EXTRA_ACCOUNTS.studentRep)
      let sessions: any[]
      try {
        sessions = (await call(rep, 'GET', '/api/teaching/my-sessions')).json?.data ?? []
      } finally {
        await rep.dispose()
      }
      const pendingIndex = sessions.findIndex((s) => s.status === 'pending')
      if (pendingIndex < 0) {
        recordFinding(D, { id: `S-${width}-01`, rule: 'Student rep records a session', expected: 'a pending session this week', actual: 'none pending', status: 'SKIP' })
        return
      }
      const session = sessions[pendingIndex]
      const pendingRows = sessions.filter((s) => s.status === 'pending')
      const rowIndex = pendingRows.indexOf(session) // Held/Not held buttons render only for pending rows
      const asHeld = WIDTHS.indexOf(width as any) % 2 === 0
      const held = page.getByRole('button', { name: /^Held$/ }).nth(rowIndex)
      const notHeld = page.getByRole('button', { name: /^Not held$/ }).nth(rowIndex)
      await expect(held).toBeVisible({ timeout: 30_000 })
      const btnH = await height(asHeld ? held : notHeld)
      let reason = ''
      if (asHeld) {
        await tapOrClick(page, held)
      } else {
        await tapOrClick(page, notHeld)
        const box = page.getByLabel('Reason not held')
        await expect(box).toBeVisible({ timeout: 15_000 })
        reason = `${PREFIX}not held ${width}`
        await box.fill(reason)
        await tapOrClick(page, page.getByRole('button', { name: /^Save$/ }))
      }
      await expect.poll(() => q.one<{ status: string }>('select status from teaching_sessions where id = ?', [session.id])?.status, { timeout: 30_000 }).toBe(asHeld ? 'held' : 'not_held')
      const dbRow = q.one<{ status: string; reason: string | null; recorded_by: string | null }>('select status, reason, recorded_by from teaching_sessions where id = ?', [session.id])
      await page.screenshot({ path: path.join(SHOTS, `mobile-rep-${width}.png`) }).catch(() => {})
      check(D, `S-${width}-01`, `Rep taps "${asHeld ? 'Held' : 'Not held'}" on ${session.activityType} ${session.scheduledDate}: teaching_sessions.status/reason/recorded_by updated (TeachingSessionController::record)`, `${asHeld ? 'held' : `not_held "${reason}"`} by rep`, `${dbRow?.status} "${dbRow?.reason ?? ''}" by ${dbRow?.recorded_by ? 'set' : 'null'}`, dbRow?.status === (asHeld ? 'held' : 'not_held') && (asHeld || dbRow?.reason === reason) && !!dbRow?.recorded_by)
      tapCheck(width, `S-${width}-t1`, `"${asHeld ? 'Held' : 'Not held'}" button`, btnH)
    } finally {
      await context.close()
    }
  })

  test(`nurse notifications @ ${width}: open one (read), Clear inbox, Restore -> DB`, async ({ browser }) => {
    test.setTimeout(240_000)
    const { context, page } = await phone(browser, states.nurse, width)
    const snapshot = q.all<Record<string, any>>('select * from notifications where recipient_id = ?', [iso.nurseId])
    try {
      await page.goto('/notifications', { waitUntil: 'domcontentloaded' })
      await shellReady(page)
      await overflowCheck(page, width, `Q-${width}-ov`, '/notifications')
      const title = `${PREFIX}notif ${width}`
      const item = page.getByRole('link', { name: new RegExp(title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) }).first()
      await expect(item).toBeVisible({ timeout: 30_000 })
      const itemH = await height(item)
      await tapOrClick(page, item)
      await expect.poll(() => q.one<{ read_at: string | null }>('select read_at from notifications where id = ?', [qaNotificationIds[width]])?.read_at ?? null, { timeout: 30_000 }).not.toBeNull()
      check(D, `Q-${width}-01`, 'Opening an unread notification marks it read (PATCH /api/notifications/read -> read_at set)', 'read_at set', 'read_at set', true)

      const clear = page.getByRole('button', { name: 'Clear inbox' })
      await expect(clear).toBeVisible({ timeout: 15_000 })
      const clearH = await height(clear)
      const before = q.count('select count(*) c from notifications where recipient_id = ?', [iso.nurseId])
      await tapOrClick(page, clear)
      // The inbox shows at most the newest 100 rows (NotificationController::index
      // limit), so "Clear inbox" removes what was shown, not every row in the table.
      await expect.poll(() => q.count('select count(*) c from notifications where recipient_id = ?', [iso.nurseId]), { timeout: 30_000 }).toBeLessThan(before)
      const afterClear = q.count('select count(*) c from notifications where recipient_id = ?', [iso.nurseId])
      const qaGone = q.count('select count(*) c from notifications where id = ?', [qaNotificationIds[width]]) === 0
      const restore = page.getByRole('button', { name: /^Restore$/ })
      await expect(restore).toBeVisible({ timeout: 15_000 })
      const restoreH = await height(restore)
      await tapOrClick(page, restore)
      await expect.poll(() => q.count('select count(*) c from notifications where recipient_id = ?', [iso.nurseId]), { timeout: 30_000 }).toBe(before)
      const afterIds = q.all<{ id: string }>('select id from notifications where recipient_id = ?', [iso.nurseId]).map((r) => r.id).sort()
      const beforeIds = snapshot.map((r) => r.id).sort()
      await page.screenshot({ path: path.join(SHOTS, `mobile-notifications-${width}.png`) }).catch(() => {})
      check(D, `Q-${width}-02`, 'Clear inbox deletes the nurse\'s rows (DELETE /api/notifications); Restore re-inserts the same ids (POST /api/notifications/restore)', `${before} -> fewer (shown rows cleared, QA row gone) -> ${before}, same ids`, `${before} -> ${afterClear} (qaGone=${qaGone}) -> ${afterIds.length}, same ids=${JSON.stringify(afterIds) === JSON.stringify(beforeIds)}`, afterIds.length === before && JSON.stringify(afterIds) === JSON.stringify(beforeIds) && afterClear < before && qaGone)
      tapCheck(width, `Q-${width}-t1`, 'Notification row', itemH)
      tapCheck(width, `Q-${width}-t2`, '"Clear inbox" button', clearH)
      tapCheck(width, `Q-${width}-t3`, '"Restore" button', restoreH)
    } finally {
      // Safety net: if a restore failed, put the seeded rows back through the admin API.
      const now = q.count('select count(*) c from notifications where recipient_id = ?', [iso.nurseId])
      if (now < snapshot.length) {
        const admin = await apiAs(EXTRA_ACCOUNTS.superadmin)
        try {
          const present = new Set(q.all<{ id: string }>('select id from notifications where recipient_id = ?', [iso.nurseId]).map((r) => r.id))
          const missing = snapshot.filter((r) => !present.has(r.id)).map((r) => ({ id: r.id, userId: r.recipient_id, type: r.type, title: r.title, message: r.message, relatedRoute: r.related_route, createdAt: r.created_at, readAt: r.read_at }))
          for (let i = 0; i < missing.length; i += 50) await call(admin, 'POST', '/api/notifications/restore', { data: { notifications: missing.slice(i, i + 50) } })
          info(D, `Q-${width}-restore`, 'Seeded notifications re-inserted by the spec after an incomplete UI restore', `${missing.length} rows`)
        } finally {
          await admin.dispose()
        }
      }
      await context.close()
    }
  })
}

test('admin @ 390: action-item sheet Start -> DB, Close button', async ({ browser }) => {
  test.setTimeout(240_000)
  const { context, page } = await phone(browser, states.admin, 390)
  try {
    await page.goto('/admin/action-items', { waitUntil: 'domcontentloaded' })
    await shellReady(page)
    await overflowCheck(page, 390, 'A-390-ov', '/admin/action-items')
    // Open the QA item from its row (the search narrows the list; at phone width the row title is the trigger).
    // Search by the title's unique suffix: a term with underscores finds nothing
    // on the SQLite dev database (LIKE escape quirk, MariaDB unaffected).
    const qaTitle = q.one<{ title: string }>('select title from action_items where id = ?', [qaItemId])?.title ?? ''
    await page.getByPlaceholder('Search actions').fill(qaTitle.split(' ').pop() ?? '')
    await sleep(1200) // debounced search
    // At phone width the row's title block is itself the button that opens the sheet.
    let rowBtn = page.getByRole('button').filter({ hasText: PREFIX + 'mobile' }).first()
    if (!(await rowBtn.isVisible().catch(() => false))) {
      await page.screenshot({ path: path.join(SHOTS, 'mobile-admin-390-list.png'), fullPage: true }).catch(() => {})
      info(D, 'A-390-row', 'Row button not visible after the search; buttons containing the QA title', String(await page.getByRole('button').filter({ hasText: PREFIX + 'mobile' }).count()))
      await page.getByPlaceholder('Search actions').fill('')
      await sleep(1200)
      rowBtn = page.getByRole('button').filter({ hasText: PREFIX + 'mobile' }).first()
    }
    await expect(rowBtn).toBeVisible({ timeout: 30_000 })
    const rowH = await height(rowBtn)
    await tapOrClick(page, rowBtn)
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible({ timeout: 30_000 })
    await expect(dialog.getByText(/Assignment/)).toBeVisible({ timeout: 30_000 })
    const start = dialog.getByRole('button', { name: /^Start$/ })
    await expect(start).toBeVisible({ timeout: 15_000 })
    const startH = await height(start)
    await tapOrClick(page, start)
    await expect.poll(() => q.one<{ status: string }>('select status from action_items where id = ?', [qaItemId])?.status, { timeout: 30_000 }).toBe('in_progress')
    const hist = q.one<{ event: string; from_status: string; to_status: string }>('select event, from_status, to_status from action_item_status_history where action_item_id = ? order by created_at desc, rowid desc limit 1', [qaItemId])
    check(D, 'A-390-01', 'Sheet "Start" moves the item assigned -> in_progress (PATCH status) with a history row', 'in_progress / started', `${q.one<{ status: string }>('select status from action_items where id = ?', [qaItemId])?.status} / ${hist?.event}(${hist?.from_status}->${hist?.to_status})`, hist?.to_status === 'in_progress')
    const close = dialog.getByRole('button', { name: 'Close' })
    const closeH = await height(close)
    await tapOrClick(page, close)
    const closed = await dialog.isHidden().catch(() => false) || (await expect(dialog).toBeHidden({ timeout: 10_000 }).then(() => true).catch(() => false))
    await page.screenshot({ path: path.join(SHOTS, 'mobile-admin-390.png') }).catch(() => {})
    check(D, 'A-390-02', 'Sheet "Close" button closes the sheet opened from the row', 'closed', closed ? 'closed' : 'still open', closed)
    await overflowCheck(page, 390, 'A-390-ov2', '/admin/action-items (after sheet)')
    tapCheck(390, 'A-390-t1', 'Action-item row trigger', rowH)
    tapCheck(390, 'A-390-t2', '"Start" button', startH)
    tapCheck(390, 'A-390-t3', 'Sheet "Close" button', closeH)
  } finally {
    await context.close()
  }
})
