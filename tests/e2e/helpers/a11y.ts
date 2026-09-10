import { expect, type Page } from '@playwright/test'

/**
 * Keyboard / focus helpers shared by the accessibility specs. Everything here
 * drives the page with the keyboard only (Tab, Shift+Tab, Enter, Space, Escape,
 * arrows); no helper ever clicks.
 */

export type FocusedInfo = {
  tag: string
  role: string
  name: string
  id: string
  type: string
  href: string
  /** true when the focused element is inside an open dialog */
  inDialog: boolean
  /** Does the focused element show a visible focus indicator (outline / box-shadow / colour change)? */
  indicator: 'outline' | 'box-shadow' | 'style-change' | 'none'
}

/**
 * Describe document.activeElement, including whether it carries a visible
 * focus indicator. The indicator is measured by comparing the element's
 * computed style while focused against the same element blurred, then
 * re-focusing it so the tab sequence continues from the same place.
 */
export async function focusedInfo(page: Page): Promise<FocusedInfo> {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null
    if (!el || el === document.body) {
      return { tag: 'body', role: '', name: '', id: '', type: '', href: '', inDialog: false, indicator: 'none' as const }
    }

    const accessibleName = () => {
      const labelled = el.getAttribute('aria-labelledby')
      if (labelled) {
        return labelled
          .split(/\s+/)
          .map((id) => document.getElementById(id)?.textContent?.trim() ?? '')
          .join(' ')
          .trim()
      }
      const aria = el.getAttribute('aria-label')
      if (aria) return aria.trim()
      if (el.id) {
        const label = document.querySelector(`label[for="${CSS.escape(el.id)}"]`)
        if (label?.textContent?.trim()) return label.textContent.trim()
      }
      const wrapping = el.closest('label')
      if (wrapping?.textContent?.trim()) return wrapping.textContent.trim().slice(0, 80)
      const title = el.getAttribute('title')
      if (title) return title.trim()
      const placeholder = el.getAttribute('placeholder')
      const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim()
      return text || (placeholder ? `[placeholder] ${placeholder}` : '')
    }

    const snapshot = () => {
      const s = getComputedStyle(el)
      return {
        outlineStyle: s.outlineStyle,
        outlineWidth: s.outlineWidth,
        outlineColor: s.outlineColor,
        boxShadow: s.boxShadow,
        backgroundColor: s.backgroundColor,
        borderColor: s.borderColor,
        color: s.color,
        textDecorationLine: s.textDecorationLine,
      }
    }

    // Focus rings are usually transitioned (150 ms); a snapshot taken right
    // after the Tab press would read the transition's start value (a
    // transparent, zero-width ring) and report "none". Cancel transitions
    // on the element for the measurement, then restore them.
    const previousTransition = el.style.transition
    el.style.transition = 'none'
    void el.offsetWidth
    const focused = snapshot()
    // A time/date input keeps an internal segment cursor (hour, minute,
    // AM/PM) that a blur/refocus resets, which would turn its three Tab
    // stops into an endless loop. Measure those without blurring.
    const segmented = el instanceof HTMLInputElement && /^(time|date|datetime-local|month|week)$/.test(el.type)
    let blurred = focused
    if (!segmented) {
      el.blur()
      blurred = snapshot()
      el.focus({ preventScroll: true })
    }
    el.style.transition = previousTransition

    let indicator: FocusedInfo['indicator'] = 'none'
    if (focused.outlineStyle !== 'none' && parseFloat(focused.outlineWidth) > 0 && focused.outlineColor !== 'rgba(0, 0, 0, 0)') {
      indicator = 'outline'
    } else if (focused.boxShadow !== blurred.boxShadow && focused.boxShadow !== 'none') {
      indicator = 'box-shadow'
    } else if (segmented && /[1-9]\d*px/.test(focused.boxShadow.replace(/rgba?\([^)]*\)|oklab\([^)]*\)/g, ''))) {
      // segmented inputs are not blurred, so a non-zero-width shadow counts
      indicator = 'box-shadow'
    } else if (
      focused.backgroundColor !== blurred.backgroundColor ||
      focused.borderColor !== blurred.borderColor ||
      focused.color !== blurred.color ||
      focused.textDecorationLine !== blurred.textDecorationLine
    ) {
      indicator = 'style-change'
    }

    return {
      tag: el.tagName.toLowerCase(),
      role: el.getAttribute('role') ?? '',
      name: accessibleName().slice(0, 80),
      id: el.id,
      type: el.getAttribute('type') ?? '',
      href: el.getAttribute('href') ?? '',
      inDialog: Boolean(el.closest('[role="dialog"]')),
      indicator,
    }
  })
}

/**
 * Press Tab (or Shift+Tab) until the focused element satisfies `match`.
 * Throws with the full focus trail when `maxSteps` is exhausted so a missing
 * stop is diagnosable from the failure message.
 */
export async function tabUntil(
  page: Page,
  match: (info: FocusedInfo) => boolean,
  options: { maxSteps?: number; backwards?: boolean; label?: string } = {},
): Promise<{ info: FocusedInfo; steps: number; trail: FocusedInfo[] }> {
  const maxSteps = options.maxSteps ?? 80
  const trail: FocusedInfo[] = []
  for (let step = 1; step <= maxSteps; step++) {
    await page.keyboard.press(options.backwards ? 'Shift+Tab' : 'Tab')
    const info = await focusedInfo(page)
    trail.push(info)
    if (match(info)) return { info, steps: step, trail }
  }
  throw new Error(
    `tabUntil(${options.label ?? 'match'}) not reached in ${maxSteps} Tabs. Trail:\n${trail
      .map((t, i) => `${i + 1}. <${t.tag}${t.role ? ` role=${t.role}` : ''}> "${t.name}"`)
      .join('\n')}`,
  )
}

/** Walk the whole tab order from the start of the document (up to maxSteps). */
export async function walkTabOrder(page: Page, maxSteps = 120): Promise<FocusedInfo[]> {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  const trail: FocusedInfo[] = []
  const seen = new Set<string>()
  for (let step = 0; step < maxSteps; step++) {
    await page.keyboard.press('Tab')
    const info = await focusedInfo(page)
    if (info.tag === 'body') break
    const key = `${info.tag}|${info.role}|${info.name}|${info.id}|${info.type}`
    // Wrapped around to the first stop: done.
    if (seen.has(key) && step > 0 && key === [...seen][0]) break
    seen.add(key)
    trail.push(info)
  }
  return trail
}

/** Landmarks present on the page (for the audit table). */
export async function landmarks(page: Page): Promise<Record<string, number>> {
  return page.evaluate(() => {
    const count = (selector: string) =>
      [...document.querySelectorAll(selector)].filter((el) => {
        const s = getComputedStyle(el as HTMLElement)
        return s.display !== 'none' && s.visibility !== 'hidden'
      }).length
    return {
      header: count('header, [role="banner"]'),
      nav: count('nav, [role="navigation"]'),
      main: count('main, [role="main"]'),
      aside: count('aside, [role="complementary"]'),
      h1: count('h1'),
      dialog: count('[role="dialog"]'),
    }
  })
}

/** Assert focus is inside the open dialog and Tab never escapes it. */
export async function expectFocusTrapped(page: Page, tabs = 25) {
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await expect.poll(async () => (await focusedInfo(page)).inDialog, { message: 'focus moves into the dialog on open' }).toBe(true)
  for (let i = 0; i < tabs; i++) {
    await page.keyboard.press('Tab')
    const info = await focusedInfo(page)
    expect(info.inDialog, `focus escaped the dialog after ${i + 1} Tabs to <${info.tag}> "${info.name}"`).toBe(true)
  }
  for (let i = 0; i < 5; i++) {
    await page.keyboard.press('Shift+Tab')
    const info = await focusedInfo(page)
    expect(info.inDialog, `focus escaped the dialog on Shift+Tab to <${info.tag}> "${info.name}"`).toBe(true)
  }
}

/** Radix Select, keyboard only: open with the given key, move with arrows, commit with Enter. */
export async function pickSelectOptionByKeyboard(page: Page, openKey: 'Enter' | 'Space' | 'ArrowDown' = 'Enter', moves = 1) {
  await page.keyboard.press(openKey)
  const listbox = page.getByRole('listbox')
  await expect(listbox, `Radix Select opens with ${openKey}`).toBeVisible({ timeout: 5_000 })
  for (let i = 0; i < moves; i++) await page.keyboard.press('ArrowDown')
  const highlighted = await page.locator('[role="option"][data-highlighted]').first().textContent()
  await page.keyboard.press('Enter')
  await expect(listbox).toBeHidden()
  return (highlighted ?? '').trim()
}
