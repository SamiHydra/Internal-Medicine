import { test, expect, type Page } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { authFile } from './helpers/auth'
import { ACCOUNTS, DEV_PASSWORD } from './helpers/accounts'
import { flushRateLimits } from './helpers/api'
import {
  expectFocusTrapped,
  focusedInfo,
  landmarks,
  pickSelectOptionByKeyboard,
  tabUntil,
  walkTabOrder,
  type FocusedInfo,
} from './helpers/a11y'

/**
 * Keyboard-only accessibility flows (WCAG 2.1.1 / 2.1.2 / 2.4.3 / 2.4.7 /
 * 3.3.2 / 4.1.3). Nothing in this file clicks: every interaction is Tab,
 * Shift+Tab, Enter, Space, Escape or an arrow key. Each flow writes its
 * evidence (focus trail, indicator per stop, landmark counts) to
 * output/a11y/keyboard/<flow>.json so docs/ACCESSIBILITY_AUDIT.md can quote it.
 *
 *   E2E_BASE_URL=http://localhost:5193 npx playwright test \
 *     --config playwright.external.config.ts tests/e2e/a11y-keyboard.spec.ts
 */

const OUT = path.resolve('output', 'a11y', 'keyboard')

function record(name: string, data: unknown) {
  fs.mkdirSync(OUT, { recursive: true })
  fs.writeFileSync(path.join(OUT, `${name}.json`), JSON.stringify(data, null, 2))
}

async function shellReady(page: Page) {
  await expect(page.getByRole('button', { name: 'Notifications' }).first()).toBeVisible({ timeout: 20_000 })
  await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {})
}

/** Summarise a tab-order walk: stops without a visible indicator, stops without a name. */
function auditTrail(trail: FocusedInfo[]) {
  const noIndicator = trail.filter((t) => t.indicator === 'none')
  const noName = trail.filter((t) => !t.name)
  return {
    stops: trail.length,
    noIndicator: noIndicator.map((t) => `<${t.tag}${t.role ? ` role=${t.role}` : ''}> "${t.name}"`),
    noName: noName.map((t) => `<${t.tag}${t.role ? ` role=${t.role}` : ''}> id=${t.id} type=${t.type}`),
    trail: trail.map((t) => `<${t.tag}${t.role ? ` role=${t.role}` : ''}> "${t.name}" [${t.indicator}]`),
  }
}

/** Does the given visible text sit inside a live region / alert so assistive tech announces it? */
async function announcedBy(page: Page, text: string | RegExp) {
  const el = page.getByText(text).first()
  await expect(el).toBeVisible({ timeout: 10_000 })
  return el.evaluate((node) => {
    const host = node.closest('[role="alert"], [role="status"], [aria-live]')
    return host ? `${host.getAttribute('role') ?? ''}/${host.getAttribute('aria-live') ?? ''}` : null
  })
}

test.describe('keyboard - login', () => {
  test('login can be completed with the keyboard only and errors are announced', async ({ page }) => {
    await flushRateLimits()
    await page.goto('/login')
    await expect(page.locator('#identifier')).toBeVisible()

    // Tab order and focus indicators across the whole login page.
    const trail = await walkTabOrder(page, 40)
    const audit = auditTrail(trail)
    const marks = await landmarks(page)

    // 1) Wrong password: the error must land in a live region.
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
    await tabUntil(page, (i) => i.id === 'identifier', { label: 'identifier' })
    await page.keyboard.type(ACCOUNTS.nurse.identifier)
    await tabUntil(page, (i) => i.id === 'password', { label: 'password' })
    await page.keyboard.type('definitely-wrong-password')
    await page.keyboard.press('Enter')
    const errorAnnouncement = await announcedBy(page, /invalid|incorrect|could not|unable|wrong|failed|check/i)

    // 2) Correct password, Enter from the password field submits.
    await page.locator('#password').focus()
    await page.keyboard.press('Control+A')
    await page.keyboard.type(DEV_PASSWORD)
    await page.keyboard.press('Enter')
    await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 15_000 })

    record('login', { audit, landmarks: marks, errorAnnouncement, landedOn: page.url() })

    expect.soft(audit.noName, 'every focusable element on /login has an accessible name').toEqual([])
    expect.soft(audit.noIndicator, 'every focusable element on /login shows a focus indicator').toEqual([])
    expect.soft(errorAnnouncement, 'the login error is inside a live region (WCAG 4.1.3)').not.toBeNull()
    expect(page.url()).not.toContain('/login')
  })
})

test.describe('keyboard - nurse report form', () => {
  test.use({ storageState: authFile('nurse') })

  test('open a report, fill cells, save draft and submit with the keyboard only', async ({ page }) => {
    test.setTimeout(180_000)
    await page.goto('/nurse/reports', { waitUntil: 'domcontentloaded' })
    await shellReady(page)

    // The first editable card ("Open", not "View") reached by Tab.
    const target = await tabUntil(page, (i) => i.tag === 'a' && i.href.startsWith('/reports/') && /^open/i.test(i.name), {
      label: 'first editable report link',
      maxSteps: 120,
    })
    await page.keyboard.press('Enter')
    await page.waitForURL(/\/reports\//, { timeout: 15_000 })
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {})
    await expect(page.getByRole('button', { name: /^Save/ }).first()).toBeVisible({ timeout: 20_000 })

    const marks = await landmarks(page)
    // The status / error line lives in the action bar above the <form>, so
    // look for a live region anywhere in the main content that carries the
    // autosave or validation wording.
    const liveRegionInForm = await page.evaluate(() =>
      Array.from(document.querySelectorAll('main [aria-live], main [role="status"], main [role="alert"]')).some((element) =>
        /saved|draft|changes|autosave|editing|error|required|complete/i.test(element.textContent ?? ''),
      ),
    )

    // Fill every empty cell we pass on the way to the Save button (number/time/
    // select/textarea), so a submit has a chance to validate.
    await page.evaluate(() => window.scrollTo(0, 0))
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
    const filled: string[] = []
    const trail: FocusedInfo[] = []
    let saveButton: FocusedInfo | null = null
    for (let step = 0; step < 400; step++) {
      await page.keyboard.press('Tab')
      const info = await focusedInfo(page)
      trail.push(info)
      if (info.tag === 'body') break
      if (info.tag === 'button' && /^Save/.test(info.name)) {
        // The action bar sits above the grid (visually and in the DOM), so
        // keep walking into the cells after passing Save.
        saveButton = info
        continue
      }
      if (saveButton && filled.length >= 3 && info.tag === 'input' && step > 60) break
      const isEmpty = await page.evaluate(() => {
        const el = document.activeElement as HTMLInputElement | HTMLTextAreaElement | null
        return el && 'value' in el ? el.value === '' : false
      })
      if (info.tag === 'input' && info.type === 'number' && (isEmpty || filled.length < 3)) {
        // The seeded fixture's reports are complete, so the first three
        // numeric cells are overwritten (select-all, then type) to prove the
        // keyboard can edit them; later cells are filled only when empty.
        if (!isEmpty) await page.keyboard.press('Control+A')
        await page.keyboard.type(String(1 + (filled.length % 7)))
        filled.push(info.name)
      } else if (info.tag === 'input' && info.type === 'time' && isEmpty) {
        await page.keyboard.type('0800AM')
        filled.push(info.name)
      } else if (info.tag === 'textarea' && isEmpty) {
        await page.keyboard.type('Keyboard QA entry')
        filled.push(info.name)
      } else if (info.role === 'combobox' && info.inDialog === false) {
        const current = await page.evaluate(() => (document.activeElement as HTMLElement).textContent?.trim())
        if (!current || current === 'Select') {
          await pickSelectOptionByKeyboard(page, 'Enter', 1)
          filled.push(info.name)
        }
      }
    }
    expect(saveButton, 'the Save draft button is reachable by Tab').not.toBeNull()
    expect(filled.length, 'at least three cells were filled with the keyboard').toBeGreaterThanOrEqual(3)

    // Save draft with Enter on the button (Shift+Tab back to the bar would be
    // dozens of stops; focusing it directly keeps the activation keyboard-only).
    await page.getByRole('button', { name: /^Save/ }).first().focus()
    await page.keyboard.press('Enter')
    const saveToast = await announcedBy(page, /draft saved|saved|all changes saved/i).catch(() => null)
    await page.waitForTimeout(800)

    // Submit: the button sits right after Save in the sticky bar.
    await tabUntil(page, (i) => i.tag === 'button' && /^Submit/.test(i.name), { label: 'Submit button', maxSteps: 5 })
    await page.keyboard.press('Enter')
    // Either the success toast, or the validation line in the sticky bar.
    const outcome = await Promise.race([
      page.getByText(/report submitted/i).first().waitFor({ timeout: 15_000 }).then(() => 'submitted'),
      page.locator('form').getByText(/required|missing|complete|invalid|fill/i).first().waitFor({ timeout: 15_000 }).then(() => 'validation-shown'),
    ]).catch(() => 'no-visible-outcome')
    const outcomeAnnounced =
      outcome === 'submitted'
        ? await announcedBy(page, /report submitted/i).catch(() => null)
        : outcome === 'validation-shown'
          ? await announcedBy(page, /required|missing|complete|invalid|fill/i).catch(() => null)
          : null

    record('nurse-report-form', {
      openedFrom: target.info,
      url: page.url(),
      landmarks: marks,
      liveRegionInForm,
      filled,
      saveToastLiveRegion: saveToast,
      submitOutcome: outcome,
      submitOutcomeLiveRegion: outcomeAnnounced,
      audit: auditTrail(trail),
    })

    expect.soft(liveRegionInForm, 'the form status/error line is a live region (WCAG 4.1.3)').toBe(true)
    expect.soft(auditTrail(trail).noName, 'every focusable element in the report form has a name').toEqual([])
    expect.soft(auditTrail(trail).noIndicator, 'every focusable element in the report form shows focus').toEqual([])
    expect(['submitted', 'validation-shown']).toContain(outcome)
  })
})

test.describe('keyboard - admin flows', () => {
  test.use({ storageState: authFile('superadmin') })

  test('open a report from the submission board', async ({ page }) => {
    await page.goto('/admin/submissions', { waitUntil: 'domcontentloaded' })
    await shellReady(page)
    const trail: FocusedInfo[] = []
    const reached = await tabUntil(page, (i) => i.tag === 'a' && i.href.startsWith('/reports/'), {
      label: 'first board report link',
      maxSteps: 150,
    })
    trail.push(...reached.trail)
    await page.keyboard.press('Enter')
    await page.waitForURL(/\/reports\//, { timeout: 15_000 })
    record('admin-submissions', { link: reached.info, steps: reached.steps, url: page.url(), audit: auditTrail(trail) })
    expect.soft(auditTrail(trail).noIndicator, 'board controls show focus').toEqual([])
  })

  test('action-item sheet: open, trap, change status, Escape closes, focus returns', async ({ page }) => {
    test.setTimeout(120_000)
    await page.goto('/admin/action-items', { waitUntil: 'domcontentloaded' })
    await shellReady(page)
    await expect(page.getByRole('button', { name: /^Open / }).first()).toBeVisible({ timeout: 20_000 })

    // Open with Enter from the row's "Open <title>" button.
    const trigger = await tabUntil(page, (i) => i.tag === 'button' && /^Open /.test(i.name), { label: 'Open action button', maxSteps: 120 })
    await page.keyboard.press('Enter')
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible({ timeout: 15_000 })
    await expect(dialog.getByText(/Assignment/)).toBeVisible({ timeout: 15_000 })
    const focusOnOpen = await focusedInfo(page)
    await expectFocusTrapped(page, 30)

    // Escape closes and focus returns to the trigger.
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    const afterEscape = await focusedInfo(page)

    // Re-open and change the status through the keyboard.
    await page.keyboard.press('Enter')
    await expect(dialog).toBeVisible({ timeout: 15_000 })
    await expect(dialog.getByText(/Assignment/)).toBeVisible({ timeout: 15_000 })
    const noteBox = dialog.locator('#resolution-note')
    let statusAction = ''
    if (await noteBox.isVisible().catch(() => false)) {
      await tabUntil(page, (i) => i.id === 'resolution-note', { label: 'resolution note', maxSteps: 40 })
      await page.keyboard.type('Reviewed during the keyboard accessibility audit.')
      const target = await tabUntil(page, (i) => i.tag === 'button' && /^(Resolve|Start)$/.test(i.name), { label: 'Resolve/Start', maxSteps: 6 })
      statusAction = target.info.name
    } else {
      const target = await tabUntil(page, (i) => i.tag === 'button' && /^(Verify and close|Reopen)$/.test(i.name), { label: 'Verify/Reopen', maxSteps: 40 })
      statusAction = target.info.name
    }
    await page.keyboard.press('Enter')
    const statusToast = await announcedBy(page, /resolved|started|verified|reopened|saved/i).catch(() => null)
    await expect(dialog).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()

    // The sheet's own close button must have a name (it is the first tab stop inside).
    record('action-item-sheet', {
      trigger: trigger.info,
      focusOnOpen,
      afterEscape,
      returnedToTrigger: afterEscape.name === trigger.info.name,
      statusAction,
      statusToastLiveRegion: statusToast,
    })
    expect.soft(focusOnOpen.inDialog, 'focus moves into the sheet when it opens').toBe(true)
    expect.soft(afterEscape.name, 'focus returns to the trigger after Escape').toBe(trigger.info.name)
    expect.soft(statusToast, 'the status change is announced (toast in a live region)').not.toBeNull()
    expect(statusAction).not.toBe('')
  })

  test('settings: change a value with the keyboard, operate the Radix Select, save', async ({ page }) => {
    test.setTimeout(90_000)
    await page.goto('/admin/settings', { waitUntil: 'domcontentloaded' })
    await shellReady(page)
    await expect(page.getByRole('button', { name: /save settings/i })).toBeVisible({ timeout: 20_000 })

    // Radix Select via keyboard: Space opens, arrows move, Enter commits; Escape cancels.
    await tabUntil(page, (i) => i.role === 'combobox' && /deadline day/i.test(i.name), { label: 'Weekly deadline day select', maxSteps: 60 })
    const before = await page.evaluate(() => (document.activeElement as HTMLElement).textContent?.trim())
    const chosen = await pickSelectOptionByKeyboard(page, 'Space', 1)
    // The trigger's text follows the form state one render after the listbox closes.
    await expect
      .poll(() => page.evaluate(() => (document.activeElement as HTMLElement).textContent?.trim()), { timeout: 5_000 })
      .not.toBe(before)
    const after = await page.evaluate(() => (document.activeElement as HTMLElement).textContent?.trim())
    await page.keyboard.press('ArrowDown') // re-opens the listbox on a Radix Select
    const reopened = await page.getByRole('listbox').isVisible().catch(() => false)
    if (reopened) await page.keyboard.press('Escape')
    await expect(page.getByRole('listbox')).toBeHidden()
    const focusAfterEscape = await focusedInfo(page)

    // A numeric setting.
    await tabUntil(page, (i) => i.tag === 'input' && /auto-lock hours/i.test(i.name), { label: 'auto-lock hours', maxSteps: 40 })
    const oldValue = await page.evaluate(() => (document.activeElement as HTMLInputElement).value)
    await page.keyboard.press('Control+A')
    const newValue = String((Number(oldValue) || 24) + 1)
    await page.keyboard.type(newValue)

    await tabUntil(page, (i) => i.tag === 'button' && /save settings/i.test(i.name), { label: 'Save settings', maxSteps: 120 })
    // The page shows no success toast (only a "Saved" chip), so the proof of
    // the save is the settings write on the wire.
    const settingsWrite = page.waitForResponse(
      (res) => /settings/.test(res.url()) && ['PUT', 'PATCH', 'POST'].includes(res.request().method()),
      { timeout: 15_000 },
    )
    await page.keyboard.press('Enter')
    const response = await settingsWrite.catch(() => null)
    const saved = Boolean(response && response.ok())
    await page.waitForTimeout(1_000)
    const chip = await page.getByText(/^Saved$|^Unsaved changes$/).first().textContent().catch(() => null)
    const savedAnnouncement = chip === 'Saved' ? await announcedBy(page, /^Saved$/).catch(() => null) : null

    record('settings', { select: { before, chosen, after, reopenedWithArrow: reopened, focusAfterEscape }, oldValue, newValue, saved, responseStatus: response?.status() ?? null, chipAfterSave: chip, savedAnnouncement })
    expect.soft(after, 'the Select value changed through the keyboard').not.toBe(before)
    expect.soft(focusAfterEscape.role, 'Escape returns focus to the Select trigger').toBe('combobox')
    expect(saved, 'settings saved after keyboard submit').toBe(true)
  })

  test('notifications: mark read with the keyboard', async ({ page }) => {
    await page.goto('/admin/notifications', { waitUntil: 'domcontentloaded' })
    await shellReady(page)
    await expect(page.getByRole('heading', { name: /recent activity/i })).toBeVisible({ timeout: 20_000 })
    const trail = await walkTabOrder(page, 60)
    const unreadBefore = await page.getByRole('button', { name: /^Unread/ }).textContent()
    const markAll = page.getByRole('button', { name: /mark all read/i })
    let result: string
    if (await markAll.isVisible().catch(() => false)) {
      // The tab walk above ended inside the list; put the sequential-focus
      // starting point back on the page title so the toolbar is reached first.
      await page.getByRole('heading', { name: /recent activity/i }).evaluate((element) => {
        element.setAttribute('tabindex', '-1')
        ;(element as HTMLElement).focus()
        element.removeAttribute('tabindex')
      })
      await tabUntil(page, (i) => i.tag === 'button' && /mark all read/i.test(i.name), { label: 'Mark all read', maxSteps: 30 })
      await page.keyboard.press('Enter')
      await expect(markAll).toBeHidden({ timeout: 15_000 })
      result = 'marked-all-read'
    } else {
      result = 'no-unread-notifications'
    }
    const unreadAfter = await page.getByRole('button', { name: /^Unread/ }).textContent()
    record('notifications', { result, unreadBefore, unreadAfter, audit: auditTrail(trail), landmarks: await landmarks(page) })
    expect.soft(auditTrail(trail).noName, 'every notification control has a name').toEqual([])
    expect.soft(auditTrail(trail).noIndicator, 'every notification control shows focus').toEqual([])
    expect(result).toBeTruthy()
  })

  test('academic evaluation detail sheet: focus in, trapped, Escape, focus back', async ({ page }) => {
    await page.goto('/admin/academic/submissions', { waitUntil: 'domcontentloaded' })
    await shellReady(page)
    const row = page.locator('button.group.grid').first()
    await expect(row).toBeVisible({ timeout: 20_000 })
    const rowName = ((await row.textContent()) ?? '').replace(/\s+/g, ' ').trim().slice(0, 80)
    const trigger = await tabUntil(
      page,
      (i) => i.tag === 'button' && i.name === rowName && !/filter|page|open|notifications|sign out|collapse|expand/i.test(i.name),
      { label: 'evaluation row', maxSteps: 120 },
    )
    await page.keyboard.press('Enter')
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible({ timeout: 15_000 })
    const focusOnOpen = await focusedInfo(page)
    await expectFocusTrapped(page, 20)
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    const afterEscape = await focusedInfo(page)
    record('evaluation-detail-sheet', { trigger: trigger.info, focusOnOpen, afterEscape, returnedToTrigger: afterEscape.name === trigger.info.name })
    expect.soft(focusOnOpen.inDialog).toBe(true)
    expect.soft(afterEscape.name, 'focus returns to the row after Escape').toBe(trigger.info.name)
  })

  test('phone: account/navigation sheet opens from the tab bar, traps focus, Escape returns focus', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/admin', { waitUntil: 'domcontentloaded' })
    await shellReady(page)
    const trigger = await tabUntil(page, (i) => i.tag === 'button' && /open account menu|^more$/i.test(i.name), { label: 'account menu trigger', maxSteps: 40 })
    await page.keyboard.press('Enter')
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible({ timeout: 10_000 })
    const focusOnOpen = await focusedInfo(page)
    await expectFocusTrapped(page, 20)
    // Every focusable inside the sheet must be named (the close "X" included).
    const inside: FocusedInfo[] = []
    for (let i = 0; i < 25; i++) {
      await page.keyboard.press('Tab')
      const info = await focusedInfo(page)
      if (inside.some((s) => s.name === info.name && s.tag === info.tag && s.href === info.href)) break
      inside.push(info)
    }
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    const afterEscape = await focusedInfo(page)
    const tabBar = await page.evaluate(() => Boolean(document.querySelector('nav[aria-label="Primary"]')))
    record('account-sheet-phone', { trigger: trigger.info, focusOnOpen, afterEscape, returnedToTrigger: afterEscape.name === trigger.info.name, inside: auditTrail(inside), tabBarLandmark: tabBar })
    expect.soft(focusOnOpen.inDialog).toBe(true)
    expect.soft(auditTrail(inside).noName, 'every control in the account sheet has a name').toEqual([])
    expect.soft(auditTrail(inside).noIndicator, 'every control in the account sheet shows focus').toEqual([])
    expect.soft(afterEscape.name, 'focus returns to the trigger').toBe(trigger.info.name)
  })

  test('focus order, names, indicators and landmarks on the admin dashboard', async ({ page }) => {
    await page.goto('/admin', { waitUntil: 'domcontentloaded' })
    await shellReady(page)
    await page.waitForTimeout(800)
    const trail = await walkTabOrder(page, 120)
    const audit = auditTrail(trail)
    const marks = await landmarks(page)
    const skipLink = trail[0]
    record('admin-dashboard-focus', { audit, landmarks: marks, firstStop: skipLink })
    expect.soft(marks.main, 'exactly one main landmark').toBe(1)
    expect.soft(marks.nav, 'a navigation landmark is present').toBeGreaterThanOrEqual(1)
    expect.soft(marks.h1, 'one h1').toBe(1)
    expect.soft(audit.noName, 'every focusable element on /admin has a name').toEqual([])
    expect.soft(audit.noIndicator, 'every focusable element on /admin shows focus').toEqual([])
  })

  test('table semantics on the academic pages', async ({ page }) => {
    const report: Record<string, unknown[]> = {}
    for (const route of ['/admin/academic/roster', '/admin/academic/rotations', '/admin/academic/students', '/admin/academic']) {
      await page.goto(route, { waitUntil: 'domcontentloaded' })
      await shellReady(page)
      await page.waitForTimeout(800)
      report[route] = await page.evaluate(() =>
        [...document.querySelectorAll('table')].map((table) => ({
          caption: Boolean(table.querySelector('caption')) || Boolean(table.getAttribute('aria-label')) || Boolean(table.getAttribute('aria-labelledby')),
          th: table.querySelectorAll('th').length,
          thWithScope: table.querySelectorAll('th[scope]').length,
          thead: Boolean(table.querySelector('thead')),
          rows: table.querySelectorAll('tbody tr').length,
        })),
      )
    }
    record('tables', report)
    for (const [route, tables] of Object.entries(report)) {
      for (const t of tables as { caption: boolean; th: number; thWithScope: number }[]) {
        expect.soft(t.caption, `${route}: table has a caption or aria-label`).toBe(true)
        expect.soft(t.thWithScope, `${route}: every th carries scope`).toBe(t.th)
      }
    }
  })
})

test.describe('keyboard - resident evaluation form', () => {
  test.use({ storageState: authFile('resident') })

  test('select a subject, rate, toggle, reach and press Submit with the keyboard only', async ({ page }) => {
    test.setTimeout(120_000)
    await page.goto('/academic/submit', { waitUntil: 'domcontentloaded' })
    await shellReady(page)
    await page.waitForTimeout(800)

    const subjectSelect = page.getByRole('combobox', { name: /evaluated/i })
    if (!(await subjectSelect.isVisible().catch(() => false))) {
      record('resident-evaluation', { status: 'PARTIAL', reason: 'no eligible subject on this date (form not rendered)' })
      test.skip(true, 'no eligible subject for the resident today')
    }

    await tabUntil(page, (i) => i.role === 'combobox' && /evaluated/i.test(i.name), { label: 'subject select', maxSteps: 60 })
    const chosen = await pickSelectOptionByKeyboard(page, 'Enter', 1)
    const subjectValue = await subjectSelect.textContent()

    // First rating group: Tab to the first radio, select with Space, then try the arrow keys.
    await tabUntil(page, (i) => i.role === 'radio', { label: 'first rating', maxSteps: 80 })
    await page.keyboard.press('Space')
    const checkedAfterSpace = await page.evaluate(() => document.activeElement?.getAttribute('aria-checked'))
    await page.keyboard.press('ArrowRight')
    const afterArrow = await focusedInfo(page)
    const arrowMoved = afterArrow.role === 'radio' && afterArrow.name !== '1'
    const groupTabStops = await page.evaluate(() => {
      const group = document.activeElement?.closest('[role="radiogroup"]')
      return group ? [...group.querySelectorAll('[role="radio"]')].filter((r) => (r as HTMLElement).tabIndex >= 0).length : -1
    })

    // A boolean (switch) if the form has one.
    let switchToggled: boolean | null = null
    const hasSwitch = (await page.getByRole('switch').count()) > 0
    if (hasSwitch) {
      await tabUntil(page, (i) => i.role === 'switch', { label: 'first switch', maxSteps: 80 })
      const before = await page.evaluate(() => document.activeElement?.getAttribute('aria-checked'))
      await page.keyboard.press('Space')
      const after = await page.evaluate(() => document.activeElement?.getAttribute('aria-checked'))
      switchToggled = before !== after
    }

    const submit = await tabUntil(page, (i) => i.tag === 'button' && /submit evaluation/i.test(i.name), { label: 'Submit evaluation', maxSteps: 120 })
    await page.keyboard.press('Enter')
    const outcome = await Promise.race([
      page.getByText(/evaluation submitted/i).first().waitFor({ timeout: 15_000 }).then(() => 'submitted'),
      page.getByText(/required|select|unable|already|missing/i).first().waitFor({ timeout: 15_000 }).then(() => 'validation-or-error-shown'),
    ]).catch(() => 'no-visible-outcome')
    const announced = await announcedBy(page, /evaluation submitted|required|select|unable|already|missing/i).catch(() => null)

    record('resident-evaluation', {
      chosen,
      subjectValue,
      checkedAfterSpace,
      arrowKeysMoveSelection: arrowMoved,
      radiosInTabOrder: groupTabStops,
      switchToggled,
      submitReached: submit.info,
      outcome,
      outcomeLiveRegion: announced,
    })
    expect.soft(checkedAfterSpace, 'Space selects a rating radio').toBe('true')
    expect.soft(switchToggled === null || switchToggled, 'Space toggles the switch').toBe(true)
    expect(['submitted', 'validation-or-error-shown']).toContain(outcome)
  })
})
