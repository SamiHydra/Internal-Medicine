/**
 * Shared helpers for the business-logic regression specs.
 *
 * - Sessions are logged in once per identifier and cached as storageState
 *   files under tests/regression/.auth (the login limiter is 10/min per IP,
 *   and several specs share the same accounts). A cached state is re-checked
 *   with GET /api/auth/me before reuse.
 * - The database is read directly with node:sqlite (read-only) so every
 *   mutation is verified against rows, not against the API's own answer.
 * - Findings are appended to output/regression/<domain>.json so the report
 *   can be assembled from evidence rather than from memory.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { expect, request as pwRequest, type APIRequestContext, type APIResponse } from '@playwright/test'
import { DatabaseSync } from 'node:sqlite'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export { ACCOUNTS, DEV_PASSWORD, QA_ACCOUNT_PASSWORD } from '../../e2e/helpers/accounts'

const HERE = path.dirname(fileURLToPath(import.meta.url))
export const REPO_ROOT = path.resolve(HERE, '..', '..', '..')
export const BASE_URL = (process.env.REGRESSION_BASE_URL ?? 'http://localhost:5173').replace(/\/+$/, '')
export const DB_PATH = process.env.REGRESSION_DB ?? path.join(REPO_ROOT, 'backend', 'database', 'database.sqlite')
export const AUTH_DIR = path.join(HERE, '..', '.auth')
export const OUTPUT_DIR = path.join(REPO_ROOT, 'output', 'regression')
/** Prefix for every row the regression specs create, so they can be found and cleaned up. */
export const QA_PREFIX = 'QA_REG'

const DEV_PASSWORD_VALUE = 'StPaul2026!'

/** Seeded accounts beyond tests/e2e/helpers/accounts.ts (DevUserSeeder / DevAcademicDataSeeder). */
export const EXTRA_ACCOUNTS = {
  /** An ordinary administrator (role admin, not superadmin). */
  admin: 'admin.alem.woldemariam@stpaulos.local',
  /** A second nurse, distinct assignment scope from ACCOUNTS.nurse. */
  nurse2: 'hana.abera@stpaulhospital.demo',
  /** Group-level student representative. */
  studentRep: 'student.rep.group@stpaulos.local',
  superadmin: 'admin@stpaulos.local',
  nurse: 'abel.gemechu@stpaulhospital.demo',
  resident: 'rediet.bekele@stpaulhospital.demo',
  consultant: 'chaltu.tesfaye@stpaulhospital.demo',
} as const

export type RoleName = 'anonymous' | 'nurse' | 'resident' | 'consultant' | 'student_rep' | 'admin' | 'maintenance'

/** One seeded identifier per role of the authorization matrix. */
export const ROLE_IDENTIFIERS: Record<Exclude<RoleName, 'anonymous'>, string> = {
  nurse: EXTRA_ACCOUNTS.nurse,
  resident: EXTRA_ACCOUNTS.resident,
  consultant: EXTRA_ACCOUNTS.consultant,
  student_rep: EXTRA_ACCOUNTS.studentRep,
  admin: EXTRA_ACCOUNTS.admin,
  maintenance: EXTRA_ACCOUNTS.superadmin,
}

// ---------------------------------------------------------------- HTTP

/** Headers the SPA sends; Sanctum only treats the request as stateful when Origin/Referer match. */
export function ajaxHeaders(token?: string | null, extra?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'X-Requested-With': 'XMLHttpRequest',
    Origin: BASE_URL,
    Referer: `${BASE_URL}/`,
    ...extra,
  }
  if (token) headers['X-XSRF-TOKEN'] = token
  return headers
}

export async function xsrfToken(ctx: APIRequestContext): Promise<string | null> {
  const state = await ctx.storageState()
  const cookie = state.cookies.find((c) => c.name === 'XSRF-TOKEN')
  return cookie ? decodeURIComponent(cookie.value) : null
}

/** A context with only the CSRF cookie primed (no session). */
export async function anonContext(): Promise<APIRequestContext> {
  const ctx = await pwRequest.newContext({ baseURL: BASE_URL, ignoreHTTPSErrors: true })
  await ctx.get('/sanctum/csrf-cookie', { headers: ajaxHeaders() })
  return ctx
}

/** Local-only route that empties the shared per-IP limiter buckets; a no-op elsewhere. */
export async function flushRateLimits(): Promise<void> {
  const ctx = await anonContext()
  try {
    await ctx.post('/api/testing/flush-rate-limits', { headers: ajaxHeaders(await xsrfToken(ctx)) })
  } catch {
    // best effort
  } finally {
    await ctx.dispose()
  }
}

function slug(identifier: string): string {
  return identifier.toLowerCase().replace(/[^a-z0-9]+/g, '_')
}

function stateFile(identifier: string): string {
  return path.join(AUTH_DIR, `${slug(identifier)}.json`)
}

async function loginFresh(identifier: string, password: string): Promise<APIRequestContext> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const ctx = await anonContext()
    const res = await ctx.post('/api/auth/login', {
      headers: ajaxHeaders(await xsrfToken(ctx)),
      data: { identifier, password },
    })
    if (res.ok()) return ctx
    const status = res.status()
    const body = await res.text()
    await ctx.dispose()
    if (status === 429) {
      const retryAfter = Number(res.headers()['retry-after'] ?? '15')
      await flushRateLimits()
      await new Promise((r) => setTimeout(r, Math.min(Math.max(retryAfter, 3), 60) * 1000))
      continue
    }
    throw new Error(`login(${identifier}) failed: ${status} ${body.slice(0, 200)}`)
  }
  throw new Error(`login(${identifier}) kept answering 429`)
}

/**
 * Authenticated API context for `identifier`, from the cached session when it
 * is still valid, otherwise from a fresh login (cached afterwards). Dispose it
 * when done.
 */
export async function apiAs(identifier: string, password = DEV_PASSWORD_VALUE): Promise<APIRequestContext> {
  fs.mkdirSync(AUTH_DIR, { recursive: true })
  const file = stateFile(identifier)
  if (fs.existsSync(file)) {
    const ctx = await pwRequest.newContext({ baseURL: BASE_URL, ignoreHTTPSErrors: true, storageState: file })
    const me = await ctx.get('/api/auth/me', { headers: ajaxHeaders() }).catch(() => null)
    if (me && me.status() === 200) return ctx
    await ctx.dispose()
    fs.rmSync(file, { force: true })
  }
  const ctx = await loginFresh(identifier, password)
  fs.writeFileSync(file, JSON.stringify(await ctx.storageState()))
  return ctx
}

/** Storage-state file for a browser context (`browser.newContext({ storageState })`). Logs in when needed. */
export async function stateFor(identifier: string, password = DEV_PASSWORD_VALUE): Promise<string> {
  const ctx = await apiAs(identifier, password)
  await ctx.dispose()
  return stateFile(identifier)
}

/** Forget a cached session (after a logout test, a password change, a deactivation). */
export function forgetSession(identifier: string): void {
  fs.rmSync(stateFile(identifier), { force: true })
}

export type Call = { status: number; json: any; text: string; headers: Record<string, string> }

async function toCall(res: APIResponse): Promise<Call> {
  const text = await res.text()
  let json: any = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    json = null
  }
  return { status: res.status(), json, text, headers: res.headers() }
}

/** JSON call with the CSRF token attached (mutations need it). */
export async function call(
  ctx: APIRequestContext,
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  url: string,
  options: { data?: unknown; multipart?: Record<string, unknown>; headers?: Record<string, string> } = {},
): Promise<Call> {
  const token = method === 'GET' ? null : await xsrfToken(ctx)
  const res = await ctx.fetch(url, {
    method,
    headers: ajaxHeaders(token, options.headers),
    ...(options.data !== undefined ? { data: options.data } : {}),
    ...(options.multipart ? { multipart: options.multipart as any } : {}),
  })
  return toCall(res)
}

// ---------------------------------------------------------------- database

/** Run a read-only query against the app database and close the handle. */
export function dbAll<T = Record<string, unknown>>(sql: string, params: unknown[] = []): T[] {
  const db = new DatabaseSync(DB_PATH, { readOnly: true })
  try {
    return db.prepare(sql).all(...(params as any[])) as T[]
  } finally {
    db.close()
  }
}

export function dbOne<T = Record<string, unknown>>(sql: string, params: unknown[] = []): T | null {
  return dbAll<T>(sql, params)[0] ?? null
}

export function dbCount(sql: string, params: unknown[] = []): number {
  const row = dbOne<{ c: number }>(sql, params)
  return Number(row?.c ?? 0)
}

// ---------------------------------------------------------------- findings

export type Finding = {
  id: string
  rule: string
  expected: string
  actual: string
  status: 'PASS' | 'FAIL' | 'INFO' | 'SKIP'
  evidence?: string
  at: string
}

/**
 * Record a finding for the report and assert it (softly, so one failure does
 * not hide the rest of the domain). `ok` decides PASS/FAIL; `INFO` rows are
 * observations without an expectation.
 */
export function recordFinding(domain: string, finding: Omit<Finding, 'at'>): void {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true })
  const file = path.join(OUTPUT_DIR, `${domain}.json`)
  const existing: Finding[] = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : []
  existing.push({ ...finding, at: new Date().toISOString() })
  fs.writeFileSync(file, JSON.stringify(existing, null, 2))
}

export function check(
  domain: string,
  id: string,
  rule: string,
  expected: string,
  actual: string,
  ok: boolean,
  evidence?: string,
): void {
  recordFinding(domain, { id, rule, expected, actual, status: ok ? 'PASS' : 'FAIL', evidence })
  expect.soft(ok, `${id} ${rule}: expected ${expected}, got ${actual}${evidence ? ` (${evidence})` : ''}`).toBe(true)
}

export function info(domain: string, id: string, rule: string, actual: string, evidence?: string): void {
  recordFinding(domain, { id, rule, expected: '(observation)', actual, status: 'INFO', evidence })
}

/**
 * Start a domain's findings file fresh for this run. Playwright restarts the
 * worker process after a failed test and runs `beforeAll` again, which would
 * wipe the rows recorded so far; the runner's pid (the worker's parent) is
 * stable for the whole run, so it is used as the "already reset" marker.
 */
export function resetFindings(domain: string): void {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true })
  const marker = path.join(OUTPUT_DIR, `${domain}.run`)
  const runId = String(process.ppid)
  if (fs.existsSync(marker) && fs.readFileSync(marker, 'utf8') === runId) return
  fs.rmSync(path.join(OUTPUT_DIR, `${domain}.json`), { force: true })
  fs.writeFileSync(marker, runId)
}

export function uniqueSuffix(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
}
