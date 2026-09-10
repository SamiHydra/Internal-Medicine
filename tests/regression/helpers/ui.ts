/**
 * Browser-side helpers shared by the UI regression specs (ui-clinical,
 * offline-rules, mobile). Everything here reuses the selectors of the existing
 * UI suite (tests/e2e/*.spec.ts, tests/e2e/helpers/auth.ts) so a selector that
 * works there works here.
 */
import { expect, type Page, type BrowserContext } from '@playwright/test'
import { apiAs, call, dbAll, dbOne, EXTRA_ACCOUNTS, type Call } from './index'

/* eslint-disable @typescript-eslint/no-explicit-any */

// ---------------------------------------------------------------- shell / navigation

/** Same readiness gate as tests/e2e/helpers/auth.ts: the header Notifications button renders at every width. */
export async function shellReady(page: Page): Promise<void> {
  await expect(page.getByRole('button', { name: 'Notifications' }).first()).toBeVisible({ timeout: 30_000 })
  await expect(page).not.toHaveURL(/\/login/)
}

export const firstCell = (page: Page) => page.getByRole('spinbutton').first()

export async function openReport(page: Page, assignmentId: string, periodId: string): Promise<void> {
  await page.goto(`/reports/${assignmentId}/${periodId}`, { waitUntil: 'domcontentloaded' })
  await expect(firstCell(page)).toBeVisible({ timeout: 30_000 })
}

/** Tap when the context has touch, click otherwise (tests/e2e/responsive.spec.ts idiom). */
export async function tapOrClick(page: Page, locator: ReturnType<Page['locator']>): Promise<void> {
  const canTouch = await page.evaluate(() => navigator.maxTouchPoints > 0 || 'ontouchstart' in window)
  if (canTouch) await locator.tap()
  else await locator.click()
}

export async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
}

// ---------------------------------------------------------------- offline queue (IndexedDB)

export type QueueRow = {
  id: string
  status: string
  attempts: number
  periodId: string
  assignmentId: string
  expectedUpdatedAt: string | null | undefined
  conflictReason: string | null
  conflictHttpStatus: number | null
  lastError: string | null
}

/** Read the offline queue the way the app stores it (same DB, store and index) - tests/e2e/offline-sync.spec.ts. */
export async function readQueue(page: Page): Promise<QueueRow[]> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const open = indexedDB.open('stpaul-offline-reports', 1)
      open.onupgradeneeded = () => {
        const database = open.result
        if (!database.objectStoreNames.contains('reportSaves')) {
          database.createObjectStore('reportSaves', { keyPath: 'id' }).createIndex('userId', 'userId', { unique: false })
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
        assignmentId: row.payload?.assignmentId,
        expectedUpdatedAt: row.payload?.expectedUpdatedAt,
        conflictReason: row.conflict?.reason ?? null,
        conflictHttpStatus: row.conflict?.httpStatus ?? null,
        lastError: row.lastError ?? null,
      }))
    } finally {
      db.close()
    }
  })
}

/** Anchored to the path so the Vite modules under /src/lib/api/ are not aborted (offline-sync.spec.ts D). */
export const apiOnly = (url: URL) => /^\/(api|sanctum)\//.test(url.pathname)

// ---------------------------------------------------------------- isolated assignment

export type Isolated = {
  nurseId: string
  assignmentId: string
  /** The current (interactive) reporting week. */
  periodId: string
  periodLabel: string
  departmentSlug: string
  departmentName: string
  templateDbId: string
}

/**
 * Give a nurse a dedicated assignment in a department nobody else reports for
 * (the pattern of clinical-report-lifecycle.spec.ts), so the week starts from
 * "not started" and no seeded report is touched. Retire it with
 * `retireAssignment` afterwards.
 */
export async function createIsolatedAssignment(
  nurseIdentifier: string,
  password?: string,
  preferredSlug?: string,
): Promise<Isolated> {
  const nurse = await apiAs(nurseIdentifier, password)
  try {
    const ws = await call(nurse, 'GET', '/api/workspace?report_period_window=all')
    if (ws.status !== 200) throw new Error(`workspace failed: ${ws.status} ${ws.text.slice(0, 200)}`)
    const state = ws.json.state
    const periods: any[] = state.reportingPeriods ?? []
    const assigned = new Set((state.assignments ?? []).map((a: any) => a.departmentId))
    const departmentIds: Record<string, string> = ws.json.references?.departmentDbIdBySlug ?? {}
    const templateIds: Record<string, string> = ws.json.references?.templateDbIdByDepartmentSlug ?? {}
    const candidates = Object.keys(departmentIds)
      .filter((slug) => !assigned.has(slug) && templateIds[slug])
      .sort()
    const current = periods[periods.length - 1]
    // A retired assignment is re-activated with the same id when it is created
    // again, so a department the nurse already reported for this week would
    // start from an existing row. Prefer one that starts from "not started".
    const fresh = (slug: string) =>
      Number(
        dbOne<{ c: number }>(
          `select count(*) c from reports r join report_assignments a on a.id = r.assignment_id
            where a.nurse_id = ? and a.department_id = ? and r.reporting_period_id = ?`,
          [state.currentUserId, departmentIds[slug], current.id],
        )?.c ?? 0,
      ) === 0
    const ordered = [
      ...(preferredSlug ? [preferredSlug] : []),
      ...candidates.filter((c) => c.endsWith('_inpatient')),
      ...candidates,
    ].filter((c, i, arr) => candidates.includes(c) && arr.indexOf(c) === i)
    const slug = ordered.find(fresh) ?? ordered[0]
    if (!slug) throw new Error('no unassigned department for an isolated assignment')

    const admin = await apiAs(EXTRA_ACCOUNTS.superadmin)
    try {
      const created = await call(admin, 'POST', '/api/admin/assignments', {
        data: { nurseId: state.currentUserId, departmentId: slug, templateId: templateIds[slug] },
      })
      if (created.status !== 201 && created.status !== 200) throw new Error(`assignment create failed: ${created.status} ${created.text.slice(0, 200)}`)
      const dept = dbOne<{ name: string }>('select name from departments where id = ?', [departmentIds[slug]])
      return {
        nurseId: state.currentUserId,
        assignmentId: created.json.id,
        periodId: current.id,
        periodLabel: current.label,
        departmentSlug: slug,
        departmentName: dept?.name ?? slug,
        templateDbId: templateIds[slug],
      }
    } finally {
      await admin.dispose()
    }
  } finally {
    await nurse.dispose()
  }
}

export async function retireAssignment(assignmentId: string): Promise<Call> {
  const admin = await apiAs(EXTRA_ACCOUNTS.superadmin)
  try {
    return await call(admin, 'PATCH', `/api/admin/assignments/${assignmentId}`, { data: { active: false } })
  } finally {
    await admin.dispose()
  }
}

export async function adminLock(reportId: string, locked: boolean): Promise<Call> {
  const admin = await apiAs(EXTRA_ACCOUNTS.superadmin)
  try {
    return await call(admin, 'POST', `/api/reports/${reportId}/${locked ? 'lock' : 'unlock'}`)
  } finally {
    await admin.dispose()
  }
}

// ---------------------------------------------------------------- report cells

export type CellDef = { fieldKey: string; label: string; definitionId: string; sectionKey: string }

/** The first `n` active integer fields of a template, in display order. */
export function templateCells(templateDbId: string, n: number): CellDef[] {
  return dbAll<{ field_key: string; label: string; id: string; section_key: string }>(
    `select id, field_key, label, section_key from report_field_definitions
      where template_id = ? and active = 1 and field_kind = 'integer' order by display_order limit ?`,
    [templateDbId, n],
  ).map((r) => ({ fieldKey: r.field_key, label: r.label, definitionId: r.id, sectionKey: r.section_key }))
}

export type ReportRow = {
  id: string
  status: string
  locked_at: string | null
  submitted_at: string | null
  updated_at: string
  updated_by: string
}

export function reportRow(assignmentId: string, periodId: string): ReportRow | null {
  return dbOne<ReportRow>(
    'select id, status, locked_at, submitted_at, updated_at, updated_by from reports where assignment_id = ? and reporting_period_id = ?',
    [assignmentId, periodId],
  )
}

export function reportCount(assignmentId: string, periodId: string): number {
  return Number(
    dbOne<{ c: number }>('select count(*) c from reports where assignment_id = ? and reporting_period_id = ?', [
      assignmentId,
      periodId,
    ])?.c ?? 0,
  )
}

/** The stored value of one cell, normalised to the number text the form shows ('' when absent). */
export function dbCell(reportId: string, fieldKey: string, day: string): string {
  const r = dbOne<{ value_number: unknown; value_text: unknown; value_time: unknown }>(
    `select v.value_number, v.value_text, v.value_time
       from report_field_values v join report_field_definitions d on d.id = v.field_definition_id
      where v.report_id = ? and d.field_key = ? and v.day_name = ?`,
    [reportId, fieldKey, day],
  )
  if (!r) return ''
  const v = r.value_number ?? r.value_time ?? r.value_text
  if (v === null || v === undefined) return ''
  const s = String(v)
  return /^-?\d+(\.\d+)?$/.test(s) ? String(Number(s)) : s
}

export function historyCount(reportId: string): number {
  return Number(dbOne<{ c: number }>('select count(*) c from report_status_history where report_id = ?', [reportId])?.c ?? 0)
}

/** Desktop grid input: aria-label `${field.label} - ${day}` (report-form.tsx). */
export function desktopCell(page: Page, cell: CellDef, day: string) {
  return page.getByLabel(`${cell.label} - ${day}`, { exact: true })
}

/** Phone grid input: id `mobile-${section}-${field}-${day}` (report-form.tsx). */
export function mobileCell(page: Page, cell: CellDef, day: string) {
  return page.locator(`input[id$="-${cell.fieldKey}-${day}"]`)
}

// ---------------------------------------------------------------- request counting

export type ApiHit = { method: string; path: string; at: number }

/** Every mutating request to the API on this context, with its wall-clock time. */
export function trackMutations(context: BrowserContext, pathPrefix = '/api/'): ApiHit[] {
  const hits: ApiHit[] = []
  context.on('request', (request) => {
    const url = new URL(request.url())
    if (!url.pathname.startsWith(pathPrefix)) return
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method())) return
    hits.push({ method: request.method(), path: url.pathname, at: Date.now() })
  })
  return hits
}

export function hitsSince(hits: ApiHit[], since: number, pathRe: RegExp): ApiHit[] {
  return hits.filter((h) => h.at >= since && pathRe.test(h.path))
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** 'YYYY-MM-DD HH:MM:SS' (UTC) or ISO -> epoch ms. */
export function parseTs(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const s = String(value)
  const iso = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(s) ? s.replace(' ', 'T') + 'Z' : s
  const t = Date.parse(iso)
  return Number.isNaN(t) ? null : t
}
