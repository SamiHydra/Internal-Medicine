/**
 * Clinical business-rule regression: assignments (C), weekly report lifecycle
 * (D), locking (E), comments (F), reporting periods (G), deadline settings (H),
 * settings isolation (Y), audit trail (Z) and API-level concurrency (AB).
 *
 * Runs against the already-running dev stack. Every mutation is re-read from
 * the SQLite database. All rows created here carry the QA_REG_CLIN_ prefix and
 * a per-run suffix; the QA nurse is created through the admin API so no seeded
 * nurse's reports are touched. Global settings are restored in `finally`.
 *
 *   npx playwright test --config playwright.regression.config.ts tests/regression/clinical.spec.ts
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { test, type APIRequestContext } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import {
  apiAs,
  forgetSession,
  call,
  flushRateLimits,
  dbAll,
  dbOne,
  dbCount,
  check,
  info,
  resetFindings,
  uniqueSuffix,
  EXTRA_ACCOUNTS,
  DEV_PASSWORD,
  QA_PREFIX,
  REPO_ROOT,
  OUTPUT_DIR,
  AUTH_DIR,
  type Call,
} from './helpers/index'

const D = 'clinical'
const PREFIX = `${QA_PREFIX}_CLIN_`
const DEPARTMENT_SLUG = 'cardiac_inpatient'
const TEMPLATE_SLUG = 'inpatient_weekly'
const WEEKDAY_OFFSETS: Record<string, number> = {
  monday: 0, tuesday: 1, wednesday: 2, thursday: 3, friday: 4, saturday: 5, sunday: 6,
}

// ---------------------------------------------------------------- DB re-read counter

let dbReads = 0
const q = {
  all<T = Record<string, unknown>>(sql: string, params: unknown[] = []): T[] {
    dbReads++
    return dbAll<T>(sql, params)
  },
  one<T = Record<string, unknown>>(sql: string, params: unknown[] = []): T | null {
    dbReads++
    return dbOne<T>(sql, params)
  },
  count(sql: string, params: unknown[] = []): number {
    dbReads++
    return dbCount(sql, params)
  },
}

// ---------------------------------------------------------------- small helpers

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Wait until the wall clock is in a later second than `since` (revision checks compare at second precision). */
async function nextSecondAfter(since: number): Promise<void> {
  const wait = 1100 - (Date.now() - since)
  if (wait > 0) await sleep(wait)
}

/** 'YYYY-MM-DD HH:MM:SS' (UTC, as Laravel stores it) or ISO -> epoch ms. */
function parseTs(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const s = String(value)
  const iso = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(s) ? s.replace(' ', 'T') + 'Z' : s
  const t = Date.parse(iso)
  return Number.isNaN(t) ? null : t
}

function withinMinute(value: unknown, of: number = Date.now()): boolean {
  const t = parseTs(value)
  return t !== null && Math.abs(of - t) < 60_000
}

function nairobiToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Nairobi', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
}

function mondayOf(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7))
  return d.toISOString().slice(0, 10)
}

function excerpt(c: Call, n = 220): string {
  return `${c.status} ${c.text.slice(0, n).replace(/\s+/g, ' ')}`
}

/**
 * `call` with a retry on 5xx. The dev stack is SQLite with several agents
 * writing concurrently, and a request can die with "database is locked" on
 * its own throttle-counter write; that is environmental, not the rule under
 * test, so the request is repeated (and the retry recorded as INFO).
 */
let retriedCalls = 0
async function rc(
  ctx: APIRequestContext,
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  url: string,
  options: { data?: unknown; headers?: Record<string, string> } = {},
): Promise<Call> {
  let last: Call | null = null
  for (let attempt = 0; attempt < 4; attempt++) {
    last = await call(ctx, method, url, options)
    if (last.status < 500) return last
    retriedCalls++
    info(D, `ENV-5XX-${retriedCalls}`, `Transient 5xx retried (${method} ${url}, attempt ${attempt + 1})`, excerpt(last, 160), 'SQLite lock contention on the shared dev database')
    await sleep(700 * (attempt + 1))
  }
  return last!
}

function parseJson(value: unknown): any {
  if (value === null || value === undefined) return null
  if (typeof value === 'object') return value
  try {
    return JSON.parse(String(value))
  } catch {
    return null
  }
}

type Payload = Record<string, { fieldId: string; dailyValues: Record<string, string | number> }>

/** Normalise a cell to the text form ReportSubmissionService::valueArrayToText uses. */
function norm(v: unknown): string {
  const s = String(v)
  if (/^\d{2}:\d{2}:\d{2}$/.test(s)) return s.slice(0, 5)
  if (/^-?\d+(\.\d+)?$/.test(s)) return String(Number(s))
  return s
}

function flatPayload(p: Payload): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, field] of Object.entries(p)) {
    for (const [day, value] of Object.entries(field.dailyValues)) {
      if (value === null || value === undefined || value === '') continue
      out[`${key}|${day}`] = norm(value)
    }
  }
  return out
}

function flatApi(values: any, keys: string[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const key of keys) {
    const daily = values?.[key]?.dailyValues ?? {}
    for (const [day, value] of Object.entries(daily)) {
      if (value === null || value === undefined || value === '') continue
      out[`${key}|${day}`] = norm(value)
    }
  }
  return out
}

function dbFlat(reportId: string): Record<string, string> {
  const rows = q.all<{ field_key: string; day_name: string; value_number: unknown; value_text: unknown; value_time: unknown }>(
    `SELECT d.field_key, v.day_name, v.value_number, v.value_text, v.value_time
       FROM report_field_values v JOIN report_field_definitions d ON d.id = v.field_definition_id
      WHERE v.report_id = ?`,
    [reportId],
  )
  const out: Record<string, string> = {}
  for (const r of rows) {
    const v = r.value_number ?? r.value_time ?? r.value_text
    if (v === null || v === undefined) continue
    out[`${r.field_key}|${r.day_name}`] = norm(v)
  }
  return out
}

function canon(o: Record<string, string>): string {
  return JSON.stringify(Object.keys(o).sort().map((k) => [k, o[k]]))
}

function same(a: Record<string, string>, b: Record<string, string>): boolean {
  return canon(a) === canon(b)
}

function diffCells(before: Record<string, string>, after: Record<string, string>): string[] {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)])
  return [...keys].filter((k) => (before[k] ?? null) !== (after[k] ?? null))
}

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(sortKeys(a)) === JSON.stringify(sortKeys(b))
}

function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys)
  if (v && typeof v === 'object') {
    return Object.keys(v as Record<string, unknown>).sort().reduce((acc, k) => {
      acc[k] = sortKeys((v as Record<string, unknown>)[k])
      return acc
    }, {} as Record<string, unknown>)
  }
  return v
}

// ---------------------------------------------------------------- shared state

type Period = { id: string; week_start: string; week_end: string; deadline_at: string }

const S = {
  suffix: '',
  admin: null as APIRequestContext | null,
  superadmin: null as APIRequestContext | null,
  nurse2: null as APIRequestContext | null,
  nurse: null as APIRequestContext | null,
  adminId: '',
  superadminId: '',
  nurse2Id: '',
  qaEmail: '',
  qaNurseId: '',
  qaNurseName: '',
  departmentId: '',
  templateId: '',
  activeDays: [] as string[],
  currentPeriod: null as Period | null,
  futurePeriod: null as Period | null,
  pastPeriod: null as Period | null,
  assignmentId: '',
  reportId: '',
  lastUpdatedAt: '',
  lastValues: {} as Payload,
  pastReportId: '',
}

function valuesFor(seed: number, tag: string): Payload {
  const days = S.activeDays
  const daily = (base: number) => Object.fromEntries(days.map((d, i) => [d, base + i]))
  return {
    total_patient_days: { fieldId: 'total_patient_days', dailyValues: daily(seed) },
    discharged_home: { fieldId: 'discharged_home', dailyValues: daily(2) },
    discharged_ama: { fieldId: 'discharged_ama', dailyValues: daily(0) },
    mdt_round_start_day: { fieldId: 'mdt_round_start_day', dailyValues: Object.fromEntries(days.map((d) => [d, '08:30'])) },
    nurse_in_charge: { fieldId: 'nurse_in_charge', dailyValues: Object.fromEntries(days.map((d) => [d, tag])) },
  }
}

const VALUE_KEYS = ['total_patient_days', 'discharged_home', 'discharged_ama', 'mdt_round_start_day', 'nurse_in_charge']

function reportRow(id: string) {
  return q.one<{ id: string; assignment_id: string; reporting_period_id: string; status: string; submitted_at: string | null; locked_at: string | null; created_by: string; updated_by: string; updated_at: string }>(
    'SELECT * FROM reports WHERE id = ?',
    [id],
  )
}

function lastAdminAudit(entityType: string, action: string, entityId?: string) {
  return q.one<{ id: string; user_id: string; user_name: string; action: string; entity_type: string; entity_id: string | null; old_values: string | null; new_values: string | null; created_at: string }>(
    `SELECT * FROM admin_audit_logs WHERE entity_type = ? AND action = ? ${entityId ? 'AND entity_id = ?' : ''} ORDER BY created_at DESC, rowid DESC LIMIT 1`,
    entityId ? [entityType, action, entityId] : [entityType, action],
  )
}

async function saveAs(ctx: APIRequestContext, values: Payload, extra: Record<string, unknown> = {}): Promise<Call> {
  return rc(ctx, 'PUT', `/api/reports/${S.reportId}`, { data: { values, ...extra } })
}

// ---------------------------------------------------------------- run-scoped state
//
// Playwright restarts the worker process after a failed test, which would wipe
// the module state (and re-run beforeAll). The state is therefore persisted per
// run: every worker of one run shares the runner's pid (process.ppid), so a
// restarted worker resumes instead of creating a second QA nurse or resetting
// the findings file.

const STATE_FILE = path.join(OUTPUT_DIR, 'clinical.state.json')
const RUN_ID = String(process.ppid)
type PersistedState = Omit<typeof S, 'admin' | 'superadmin' | 'nurse2' | 'nurse'> & { runId: string; dbReads: number }

function saveState(): void {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true })
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { admin: _a, superadmin: _b, nurse2: _c, nurse: _d, ...rest } = S
  const persisted: PersistedState = { ...rest, runId: RUN_ID, dbReads }
  fs.writeFileSync(STATE_FILE, JSON.stringify(persisted, null, 2))
}

function loadStateForThisRun(): PersistedState | null {
  try {
    if (!fs.existsSync(STATE_FILE)) return null
    const parsed = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) as PersistedState
    return parsed.runId === RUN_ID ? parsed : null
  } catch {
    return null
  }
}

// ---------------------------------------------------------------- setup

test.beforeAll(async () => {
  const resumed = loadStateForThisRun()
  if (resumed) {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { runId: _r, dbReads: savedReads, ...rest } = resumed
    Object.assign(S, rest)
    dbReads = savedReads
    S.admin = await apiAs(EXTRA_ACCOUNTS.admin)
    S.superadmin = await apiAs(EXTRA_ACCOUNTS.superadmin)
    S.nurse2 = await apiAs(EXTRA_ACCOUNTS.nurse2)
    S.nurse = S.qaEmail ? await apiAs(S.qaEmail, DEV_PASSWORD) : null
    info(D, 'RUN', 'Worker restarted after a failed test; state resumed from clinical.state.json', `worker ${process.env.TEST_WORKER_INDEX}`)
    return
  }

  resetFindings(D)
  fs.rmSync(STATE_FILE, { force: true })
  // Session files of QA nurses from earlier runs (one per unique email).
  if (fs.existsSync(AUTH_DIR)) {
    for (const f of fs.readdirSync(AUTH_DIR)) if (f.startsWith(PREFIX.toLowerCase())) fs.rmSync(path.join(AUTH_DIR, f), { force: true })
  }
  await flushRateLimits()
  S.suffix = uniqueSuffix()

  S.admin = await apiAs(EXTRA_ACCOUNTS.admin)
  S.superadmin = await apiAs(EXTRA_ACCOUNTS.superadmin)
  S.nurse2 = await apiAs(EXTRA_ACCOUNTS.nurse2)

  S.adminId = String(q.one<{ id: string }>('SELECT id FROM users WHERE email = ?', [EXTRA_ACCOUNTS.admin])?.id ?? '')
  S.superadminId = String(q.one<{ id: string }>('SELECT id FROM users WHERE email = ?', [EXTRA_ACCOUNTS.superadmin])?.id ?? '')
  S.nurse2Id = String(q.one<{ id: string }>('SELECT id FROM users WHERE email = ?', [EXTRA_ACCOUNTS.nurse2])?.id ?? '')

  const dept = q.one<{ id: string; template_id: string; active_days: string }>(
    'SELECT d.id, d.template_id, t.active_days FROM departments d JOIN report_templates t ON t.id = d.template_id WHERE d.slug = ? AND t.slug = ?',
    [DEPARTMENT_SLUG, TEMPLATE_SLUG],
  )
  if (!dept) throw new Error(`department ${DEPARTMENT_SLUG}/${TEMPLATE_SLUG} not seeded`)
  S.departmentId = dept.id
  S.templateId = dept.template_id
  S.activeDays = JSON.parse(dept.active_days)

  const today = nairobiToday()
  const periods = q.all<Period>('SELECT id, week_start, week_end, deadline_at FROM reporting_periods ORDER BY week_start')
  const ws = (p: Period) => String(p.week_start).slice(0, 10)
  S.currentPeriod = periods.filter((p) => ws(p) <= today).at(-1) ?? null
  S.futurePeriod = periods.find((p) => ws(p) > today) ?? null
  S.pastPeriod = periods.filter((p) => ws(p) <= today).at(-2) ?? null // one week back: inside the 9-week window
  if (!S.currentPeriod || !S.futurePeriod || !S.pastPeriod) throw new Error('reporting_periods fixture lacks current/future/past weeks')

  // The QA nurse (UserController::store validation: fullName/email/username/password/role; passwordChangeRequired false so the
  // EnsurePasswordChanged middleware does not 403 every report route).
  S.qaEmail = `${PREFIX.toLowerCase()}${S.suffix}@stpaulos.local`
  S.qaNurseName = `${PREFIX}Nurse ${S.suffix}`
  const created = await rc(S.admin, 'POST', '/api/admin/users', {
    data: {
      fullName: S.qaNurseName,
      email: S.qaEmail,
      username: `${PREFIX.toLowerCase()}${S.suffix}`,
      password: DEV_PASSWORD,
      role: 'nurse',
      passwordChangeRequired: false,
    },
  })
  if (created.status !== 201) throw new Error(`QA nurse creation failed: ${excerpt(created)}`)
  S.qaNurseId = created.json.id
  const userRow = q.one<{ id: string; role_key: string; active: number; password_change_required: number }>('SELECT id, role_key, active, password_change_required FROM users WHERE email = ?', [S.qaEmail])
  check(D, 'C-00', 'QA nurse created via POST /api/admin/users (UserController::store) exists as an active nurse in users', 'role nurse, active 1, password_change_required 0', JSON.stringify(userRow), userRow?.role_key === 'nurse' && Number(userRow.active) === 1 && Number(userRow.password_change_required) === 0)
  forgetSession(S.qaEmail)
  S.nurse = await apiAs(S.qaEmail, DEV_PASSWORD)
  saveState()
})

test.afterEach(() => saveState())

test.afterAll(async () => {
  saveState()
  info(D, 'DB-READS', 'Number of direct database re-reads performed by this spec (cumulative across worker restarts)', String(dbReads))
  for (const ctx of [S.admin, S.superadmin, S.nurse2, S.nurse]) await ctx?.dispose().catch(() => undefined)
})

// ---------------------------------------------------------------- C. assignments (part 1)

test('C1 assignment creation, idempotent duplicate, workspace scope, foreign nurse refused', async () => {
  const admin = S.admin!
  const nurse = S.nurse!

  const create = await rc(admin, 'POST', '/api/admin/assignments', { data: { nurseId: S.qaNurseId, departmentId: DEPARTMENT_SLUG, templateId: TEMPLATE_SLUG } })
  S.assignmentId = create.json?.id ?? ''
  const row = q.one<{ id: string; nurse_id: string; department_id: string; template_id: string; active: number; approved_by: string }>('SELECT * FROM report_assignments WHERE id = ?', [S.assignmentId])
  check(D, 'C-01', 'POST /api/admin/assignments creates an active assignment row (ReportAssignmentController::store)', '201 + report_assignments row active=1 for the QA nurse/department/template', `${create.status} row=${JSON.stringify(row)}`,
    create.status === 201 && row?.nurse_id === S.qaNurseId && row.department_id === S.departmentId && row.template_id === S.templateId && Number(row.active) === 1 && row.approved_by === S.adminId)

  const audit = lastAdminAudit('report_assignment', 'upsert', S.assignmentId)
  check(D, 'Z-C01', 'Assignment creation writes admin_audit_logs action=upsert entity=report_assignment by the admin (ReportAssignmentController::store -> AdminAuditService::record)', `row user_id=${S.adminId} within a minute`, JSON.stringify(audit),
    !!audit && audit.user_id === S.adminId && withinMinute(audit.created_at))

  const dup = await rc(admin, 'POST', '/api/admin/assignments', { data: { nurseId: S.qaNurseId, departmentId: DEPARTMENT_SLUG, templateId: TEMPLATE_SLUG } })
  const count = q.count('SELECT count(*) c FROM report_assignments WHERE nurse_id = ? AND department_id = ? AND template_id = ?', [S.qaNurseId, S.departmentId, S.templateId])
  check(D, 'C-02', 'A duplicate identical assignment does not create a second row (ReportAssignmentController::store uses updateOrCreate on nurse/department/template and answers 200 for an existing row)', 'status 200, exactly one row', `status ${dup.status}, rows ${count}, id=${dup.json?.id}`,
    dup.status === 200 && count === 1 && dup.json?.id === S.assignmentId)
  info(D, 'C-02i', 'Status returned for a duplicate identical assignment', String(dup.status), 'not rejected: idempotent upsert (existing behaviour)')

  const ws = await rc(nurse, 'GET', '/api/workspace')
  const ids = (ws.json?.state?.assignments ?? []).map((a: any) => a.id)
  check(D, 'C-03', 'QA nurse GET /api/workspace lists exactly the new assignment under state.assignments (WorkspaceController: active assignments of the caller)', `[${S.assignmentId}]`, `${ws.status} ${JSON.stringify(ids)}`,
    ws.status === 200 && ids.length === 1 && ids[0] === S.assignmentId)
  const wsAssignment = (ws.json?.state?.assignments ?? [])[0]
  check(D, 'C-03b', 'Workspace assignment carries department/template slugs and active=true', `${DEPARTMENT_SLUG}/${TEMPLATE_SLUG} active`, JSON.stringify(wsAssignment),
    wsAssignment?.departmentId === DEPARTMENT_SLUG && wsAssignment?.templateId === TEMPLATE_SLUG && wsAssignment?.active === true)

  const foreign = await rc(S.nurse2!, 'POST', '/api/reports', { data: { assignmentId: S.assignmentId, reportingPeriodId: S.currentPeriod!.id, values: valuesFor(10, `${PREFIX}foreign`) } })
  const foreignRows = q.count('SELECT count(*) c FROM reports WHERE assignment_id = ?', [S.assignmentId])
  check(D, 'C-04', 'A different nurse cannot save against the QA assignment (ReportSubmissionService::authorizeAssignmentEdit -> AuthorizationException 403)', '403 and no reports row', `${excerpt(foreign)} rows=${foreignRows}`,
    foreign.status === 403 && foreignRows === 0)
})

// ---------------------------------------------------------------- D. lifecycle

test('D weekly report lifecycle: create draft, revise, submit', async () => {
  test.skip(!S.assignmentId, 'assignment not created')
  const nurse = S.nurse!
  const period = S.currentPeriod!
  const t0 = Date.now()

  const v1 = valuesFor(30, `${PREFIX}v1_${S.suffix}`)
  const first = await rc(nurse, 'POST', '/api/reports', { data: { assignmentId: S.assignmentId, reportingPeriodId: period.id, values: v1 } })
  S.reportId = first.json?.id ?? ''
  S.lastUpdatedAt = first.json?.updatedAt ?? ''
  S.lastValues = v1
  check(D, 'D-01', 'POST /api/reports creates a draft (ReportWorkflowController::store -> ReportSubmissionService::save)', '201, status draft, id + updatedAt returned', `${first.status} status=${first.json?.status} id=${S.reportId} updatedAt=${S.lastUpdatedAt}`,
    first.status === 201 && first.json?.status === 'draft' && !!S.reportId && !!S.lastUpdatedAt)
  test.skip(!S.reportId, 'report not created')

  const rows = q.count('SELECT count(*) c FROM reports WHERE assignment_id = ? AND reporting_period_id = ?', [S.assignmentId, period.id])
  const r1 = reportRow(S.reportId)
  check(D, 'D-02', 'Exactly one reports row per (assignment, period), status draft, submitted_at null, created_by/updated_by = QA nurse', '1 row draft', `rows=${rows} ${JSON.stringify(r1)}`,
    rows === 1 && r1?.status === 'draft' && r1.submitted_at === null && r1.created_by === S.qaNurseId && r1.updated_by === S.qaNurseId)
  check(D, 'D-02t', 'reports.updated_at is stored in UTC within a minute of now', 'within 60s', String(r1?.updated_at), withinMinute(r1?.updated_at, t0))

  const db1 = dbFlat(S.reportId)
  check(D, 'D-03', 'report_field_values rows equal the values sent (ReportSubmissionService::persistValues)', canon(flatPayload(v1)).slice(0, 160) + '...', canon(db1).slice(0, 160) + '...', same(flatPayload(v1), db1))

  const hist = q.all<{ status: string; note: string; changed_by: string; changed_at: string }>('SELECT status, note, changed_by, changed_at FROM report_status_history WHERE report_id = ? ORDER BY changed_at', [S.reportId])
  check(D, 'D-04', 'Draft creation records report_status_history status=draft note "Draft created from the web form." by the nurse (ReportSubmissionService::recordStatus)', '1 draft row', JSON.stringify(hist),
    hist.length === 1 && hist[0].status === 'draft' && hist[0].note === 'Draft created from the web form.' && hist[0].changed_by === S.qaNurseId && withinMinute(hist[0].changed_at, t0))

  const show = await rc(nurse, 'GET', `/api/reports/${S.reportId}`)
  check(D, 'D-05', 'GET /api/reports/{id} returns the same cell values that were saved (ReportWorkflowController::show)', 'values equal', `${show.status} ${canon(flatApi(show.json?.values, VALUE_KEYS)).slice(0, 120)}...`,
    show.status === 200 && same(flatApi(show.json?.values, VALUE_KEYS), flatPayload(v1)))

  const auditDraft = q.count('SELECT count(*) c FROM audit_logs WHERE report_id = ?', [S.reportId])
  check(D, 'D-06', 'No audit_logs cell rows are written for a draft creation (persistValues only audits when the report had a submission)', '0', String(auditDraft), auditDraft === 0)

  // Second save carrying the loaded revision.
  await sleep(1100) // revisions compare at second precision: land the next save in a later second than the first response
  const v2 = valuesFor(31, `${PREFIX}v2_${S.suffix}`)
  const second = await saveAs(nurse, v2, { expectedUpdatedAt: S.lastUpdatedAt })
  const rows2 = q.count('SELECT count(*) c FROM reports WHERE assignment_id = ? AND reporting_period_id = ?', [S.assignmentId, period.id])
  const db2 = dbFlat(S.reportId)
  check(D, 'D-07', 'PUT /api/reports/{id} with expectedUpdatedAt = loaded updatedAt updates in place: 200, still one row, values replaced (ReportSubmissionService::assertRevisionMatches)', '200, 1 row, DB = v2', `${second.status} rows=${rows2} same=${same(db2, flatPayload(v2))}`,
    second.status === 200 && rows2 === 1 && same(db2, flatPayload(v2)))
  check(D, 'D-07r', 'The second save returns a newer updatedAt than the first', 'updatedAt changed', `${S.lastUpdatedAt} -> ${second.json?.updatedAt}`, !!second.json?.updatedAt && second.json.updatedAt !== S.lastUpdatedAt)
  S.lastUpdatedAt = second.json?.updatedAt ?? S.lastUpdatedAt
  S.lastValues = v2
  const auditDraft2 = q.count('SELECT count(*) c FROM audit_logs WHERE report_id = ?', [S.reportId])
  check(D, 'D-08', 'Editing a DRAFT writes no audit_logs cell rows (audit rows start once the report has been submitted, persistValues $hadSubmission)', '0', String(auditDraft2), auditDraft2 === 0)
  const histAfterDraftEdit = q.count('SELECT count(*) c FROM report_status_history WHERE report_id = ?', [S.reportId])
  check(D, 'D-08h', 'A draft edit adds no status-history row (status stays draft)', '1', String(histAfterDraftEdit), histAfterDraftEdit === 1 && reportRow(S.reportId)?.status === 'draft')

  // Save WITHOUT the revision key: historical last-write-wins.
  const v3 = valuesFor(32, `${PREFIX}v3_${S.suffix}`)
  const third = await saveAs(nurse, v3)
  check(D, 'D-09', 'A save without expectedUpdatedAt still succeeds (ReportWorkflowController::expectedRevision: absent key = last-write-wins)', '200 and DB = v3', `${third.status} same=${same(dbFlat(S.reportId), flatPayload(v3))}`,
    third.status === 200 && same(dbFlat(S.reportId), flatPayload(v3)))
  S.lastUpdatedAt = third.json?.updatedAt ?? S.lastUpdatedAt
  S.lastValues = v3

  // Submit.
  const adminCount = q.count("SELECT count(*) c FROM users WHERE role_key IN ('superadmin','admin') AND active = 1")
  const tSubmit = Date.now()
  const submit = await rc(nurse, 'POST', `/api/reports/${S.reportId}/submit`, { data: {} })
  const rS = reportRow(S.reportId)
  check(D, 'D-10', 'POST /api/reports/{id}/submit sets status submitted and submitted_at (ReportSubmissionService::save with submit=true)', '200 submitted, submitted_at within a minute', `${submit.status} ${JSON.stringify(rS)}`,
    submit.status === 200 && submit.json?.status === 'submitted' && rS?.status === 'submitted' && withinMinute(rS?.submitted_at, tSubmit) && withinMinute(rS?.updated_at, tSubmit))
  S.lastUpdatedAt = submit.json?.updatedAt ?? S.lastUpdatedAt
  const histS = q.all<{ status: string; note: string; changed_by: string }>('SELECT status, note, changed_by FROM report_status_history WHERE report_id = ? ORDER BY changed_at, rowid', [S.reportId])
  check(D, 'D-11', 'Submission appends report_status_history status=submitted note "Weekly report submitted."', "['draft','submitted']", JSON.stringify(histS),
    histS.length === 2 && histS[1].status === 'submitted' && histS[1].note === 'Weekly report submitted.' && histS[1].changed_by === S.qaNurseId)
  const notif = q.count("SELECT count(*) c FROM notifications WHERE type = 'new_report_submitted' AND related_entity = 'report_submission' AND related_id = ?", [S.reportId])
  check(D, 'D-12', 'Submission notifies every active admin/superadmin once (ReportSubmissionService::notifyAdmins)', `${adminCount} new_report_submitted rows`, String(notif), notif === adminCount)
  const metric = q.one<{ bor_percent: unknown; btr: unknown; alos: unknown; metric_payload: string }>('SELECT bor_percent, btr, alos, metric_payload FROM calculated_metrics WHERE report_id = ?', [S.reportId])
  check(D, 'D-13', 'calculated_metrics row exists for the report (ReportCalculationService::upsertForReport on every save)', 'row present', metric ? 'present' : 'missing', !!metric)
  info(D, 'D-13i', 'Calculated metrics after submission', JSON.stringify({ bor: metric?.bor_percent, btr: metric?.btr, alos: metric?.alos, payload: String(metric?.metric_payload).slice(0, 200) }))
  const submittedValues = dbFlat(S.reportId)
  check(D, 'D-14', 'Submit without a values payload leaves the stored cells unchanged', 'DB = v3', same(submittedValues, flatPayload(v3)) ? 'unchanged' : canon(submittedValues).slice(0, 120), same(submittedValues, flatPayload(v3)))

  // expectedUpdatedAt: null against an existing report -> 409 exists.
  const exists = await rc(nurse, 'POST', '/api/reports', { data: { assignmentId: S.assignmentId, reportingPeriodId: period.id, expectedUpdatedAt: null, values: valuesFor(50, `${PREFIX}exists`) } })
  check(D, 'D-15', 'POST /api/reports with expectedUpdatedAt=null (client believes no report exists) is refused with 409 reason=exists and does not overwrite', '409 exists, DB unchanged', `${exists.status} reason=${exists.json?.conflict?.reason} same=${same(dbFlat(S.reportId), flatPayload(v3))}`,
    exists.status === 409 && exists.json?.conflict?.reason === 'exists' && same(dbFlat(S.reportId), flatPayload(v3)))
})

// ---------------------------------------------------------------- C. assignments (part 2: retirement)

test('C2 assignment retirement removes nurse access; admins keep it; re-activation', async () => {
  test.skip(!S.reportId, 'no report')
  const admin = S.admin!
  const nurse = S.nurse!

  const foreignShow = await rc(S.nurse2!, 'GET', `/api/reports/${S.reportId}`)
  check(D, 'C-05', 'A different nurse cannot read the QA nurse report (ReportPolicy::view -> canViewAssignedReport)', '403', excerpt(foreignShow), foreignShow.status === 403)

  const retire = await rc(admin, 'PATCH', `/api/admin/assignments/${S.assignmentId}`, { data: { active: false } })
  const rowOff = q.one<{ active: number }>('SELECT active FROM report_assignments WHERE id = ?', [S.assignmentId])
  check(D, 'C-06', 'PATCH /api/admin/assignments/{id} active=false retires the assignment (ReportAssignmentController::update)', '200, active=0', `${retire.status} active=${rowOff?.active}`, retire.status === 200 && Number(rowOff?.active) === 0)
  const auditOff = lastAdminAudit('report_assignment', 'update', S.assignmentId)
  const oldA = parseJson(auditOff?.old_values)
  const newA = parseJson(auditOff?.new_values)
  check(D, 'Z-C06', 'Retirement writes admin_audit_logs action=update with old.active=true / new.active=false by the admin', 'old true -> new false', JSON.stringify({ old: oldA?.active, new: newA?.active, user: auditOff?.user_id }),
    !!auditOff && auditOff.user_id === S.adminId && Boolean(oldA?.active) === true && Boolean(newA?.active) === false && withinMinute(auditOff.created_at))

  const save = await saveAs(nurse, valuesFor(40, `${PREFIX}retired`))
  check(D, 'C-07', 'After retirement the nurse can no longer save against the assignment (ReportPolicy::update requires an active assignment)', '403, DB unchanged', `${excerpt(save)} same=${same(dbFlat(S.reportId), flatPayload(S.lastValues))}`,
    save.status === 403 && same(dbFlat(S.reportId), flatPayload(S.lastValues)))
  const list = await rc(nurse, 'GET', '/api/reports?perPage=300')
  const listed = (list.json?.data ?? []).some((r: any) => r.id === S.reportId)
  check(D, 'C-08', "The retired assignment's report disappears from the nurse's GET /api/reports (scopeToReportingPermission: active assignments only)", 'not listed', `${list.status} listed=${listed} total=${list.json?.meta?.total}`, list.status === 200 && !listed)
  const showOff = await rc(nurse, 'GET', `/api/reports/${S.reportId}`)
  check(D, 'C-09', 'The nurse can no longer open the report of a retired assignment (ReportPolicy::view)', '403', excerpt(showOff), showOff.status === 403)
  const wsOff = await rc(nurse, 'GET', '/api/workspace')
  check(D, 'C-10', 'The retired assignment is absent from the nurse workspace (state.assignments)', 'no assignments', JSON.stringify((wsOff.json?.state?.assignments ?? []).map((a: any) => a.id)), wsOff.status === 200 && (wsOff.json?.state?.assignments ?? []).length === 0)

  const adminShow = await rc(admin, 'GET', `/api/reports/${S.reportId}`)
  const superShow = await rc(S.superadmin!, 'GET', `/api/reports/${S.reportId}`)
  check(D, 'C-11', 'Admin and maintenance accounts can still read the report (ReportPolicy::view isAdminLike / REPORTS_VIEW_ANY)', '200 / 200', `${adminShow.status} / ${superShow.status}`, adminShow.status === 200 && superShow.status === 200)

  const del = await rc(admin, 'DELETE', `/api/admin/assignments/${S.assignmentId}`)
  const rowDel = q.one<{ active: number }>('SELECT active FROM report_assignments WHERE id = ?', [S.assignmentId])
  const rowsDel = q.count('SELECT count(*) c FROM report_assignments WHERE id = ?', [S.assignmentId])
  check(D, 'C-12', 'DELETE /api/admin/assignments/{id} soft-retires (ReportAssignmentController::destroy sets active=false, row kept, audit action=deactivate)', '200, row kept active=0, deactivate audit', `${del.status} rows=${rowsDel} active=${rowDel?.active} audit=${!!lastAdminAudit('report_assignment', 'deactivate', S.assignmentId)}`,
    del.status === 200 && rowsDel === 1 && Number(rowDel?.active) === 0 && !!lastAdminAudit('report_assignment', 'deactivate', S.assignmentId))

  const reactivate = await rc(admin, 'PATCH', `/api/admin/assignments/${S.assignmentId}`, { data: { active: true } })
  const rowOn = q.one<{ active: number }>('SELECT active FROM report_assignments WHERE id = ?', [S.assignmentId])
  check(D, 'C-13', 'Re-activation via PATCH active=true restores the assignment and the nurse sees the report again', '200 active=1 and GET report 200', `${reactivate.status} active=${rowOn?.active} show=${(await rc(nurse, 'GET', `/api/reports/${S.reportId}`)).status}`,
    reactivate.status === 200 && Number(rowOn?.active) === 1)
})

// ---------------------------------------------------------------- E. locking

test('E locking: lock is read-only for everyone, unlock restores editing with audit', async () => {
  test.skip(!S.reportId, 'no report')
  const admin = S.admin!
  const nurse = S.nurse!
  const before = dbFlat(S.reportId)

  const nurseLock = await rc(nurse, 'POST', `/api/reports/${S.reportId}/lock`)
  check(D, 'E-00', 'A nurse cannot lock a report (ReportPolicy::lock isAdminLike)', '403', excerpt(nurseLock), nurseLock.status === 403)

  const tLock = Date.now()
  const lock = await rc(admin, 'POST', `/api/reports/${S.reportId}/lock`)
  const rL = reportRow(S.reportId)
  check(D, 'E-01', 'Admin POST /api/reports/{id}/lock sets locked_at and status locked (ReportLockingService::setLockState)', '200 lockedAt set, status locked', `${lock.status} lockedAt=${lock.json?.lockedAt} db=${JSON.stringify({ status: rL?.status, locked_at: rL?.locked_at, updated_by: rL?.updated_by })}`,
    lock.status === 200 && !!lock.json?.lockedAt && rL?.status === 'locked' && withinMinute(rL?.locked_at, tLock) && rL.updated_by === S.adminId)
  const histLock = q.one<{ status: string; note: string; changed_by: string; changed_at: string }>("SELECT status, note, changed_by, changed_at FROM report_status_history WHERE report_id = ? AND status = 'locked' ORDER BY changed_at DESC LIMIT 1", [S.reportId])
  check(D, 'Z-E01', 'Lock writes report_status_history status=locked note "Report locked after review." by the admin', 'row present', JSON.stringify(histLock),
    !!histLock && histLock.note === 'Report locked after review.' && histLock.changed_by === S.adminId && withinMinute(histLock.changed_at, tLock))
  const notifLock = q.count("SELECT count(*) c FROM notifications WHERE type = 'report_locked' AND related_id = ? AND recipient_id = ?", [S.reportId, S.qaNurseId])
  check(D, 'E-01n', 'Lock notifies the assigned nurse (notification type report_locked)', '1', String(notifLock), notifLock === 1)
  const adminAuditLock = q.count("SELECT count(*) c FROM admin_audit_logs WHERE action = 'lock' AND entity_id = ?", [S.reportId])
  info(D, 'Z-E01i', 'admin_audit_logs rows with action=lock for this report (ReportLockingService writes report_status_history + a nurse notification, no admin_audit_logs row)', String(adminAuditLock))

  const nurseSave = await saveAs(nurse, valuesFor(60, `${PREFIX}locked`))
  check(D, 'E-02', 'Nurse save on a locked report is refused by ReportPolicy::update (canMutateAssignedUnlockedReport, QA-027) and values are unchanged', '403, DB unchanged', `${excerpt(nurseSave)} same=${same(dbFlat(S.reportId), before)}`,
    nurseSave.status === 403 && same(dbFlat(S.reportId), before))
  const nurseSubmit = await rc(nurse, 'POST', `/api/reports/${S.reportId}/submit`, { data: {} })
  check(D, 'E-02s', 'Nurse submit on a locked report is refused (ReportPolicy::submit)', '403', excerpt(nurseSubmit), nurseSubmit.status === 403)
  const adminSave = await saveAs(admin, valuesFor(61, `${PREFIX}lockedadmin`))
  check(D, 'E-03', 'Admin save on a locked report is also refused: locked means read-only for everyone until unlocked (HandlesDomainAuthorization::canMutateAssignedUnlockedReport)', '403, DB unchanged', `${excerpt(adminSave)} same=${same(dbFlat(S.reportId), before)}`,
    adminSave.status === 403 && same(dbFlat(S.reportId), before))

  const lockedComment = await rc(nurse, 'POST', `/api/reports/${S.reportId}/comments`, { data: { body: `${PREFIX}comment while locked ${S.suffix}` } })
  check(D, 'E-04', 'Commenting on a locked report is allowed (ReportCommentController::store only requires view)', '201', excerpt(lockedComment), lockedComment.status === 201)
  info(D, 'E-04i', 'Nurse comment while report is locked', String(lockedComment.status))
  if (lockedComment.status === 201) await rc(nurse, 'DELETE', `/api/reports/${S.reportId}/comments/${lockedComment.json.id}`)

  const tUnlock = Date.now()
  const unlock = await rc(admin, 'POST', `/api/reports/${S.reportId}/unlock`)
  const rU = reportRow(S.reportId)
  check(D, 'E-05', 'Admin POST /api/reports/{id}/unlock clears locked_at and restores status submitted (no edited_after_submission history yet)', '200 lockedAt null, status submitted', `${unlock.status} lockedAt=${unlock.json?.lockedAt} db=${JSON.stringify({ status: rU?.status, locked_at: rU?.locked_at })}`,
    unlock.status === 200 && unlock.json?.lockedAt === null && rU?.locked_at === null && rU.status === 'submitted')
  S.lastUpdatedAt = unlock.json?.updatedAt ?? S.lastUpdatedAt
  const histUnlock = q.one<{ status: string; note: string; changed_by: string; changed_at: string }>("SELECT status, note, changed_by, changed_at FROM report_status_history WHERE report_id = ? AND note = 'Report unlocked for correction.' ORDER BY changed_at DESC LIMIT 1", [S.reportId])
  check(D, 'Z-E05', 'Unlock writes report_status_history note "Report unlocked for correction." by the admin', 'row present', JSON.stringify(histUnlock), !!histUnlock && histUnlock.changed_by === S.adminId && withinMinute(histUnlock.changed_at, tUnlock))
  const notifUnlock = q.count("SELECT count(*) c FROM notifications WHERE type = 'report_unlocked' AND related_id = ? AND recipient_id = ?", [S.reportId, S.qaNurseId])
  check(D, 'E-05n', 'Unlock notifies the assigned nurse (type report_unlocked)', '1', String(notifUnlock), notifUnlock === 1)

  // Nurse edits after submission (unlocked): allowed, audited per cell, status edited_after_submission.
  await sleep(1100)
  const prev = S.lastValues
  const v4 = valuesFor(45, `${PREFIX}v4_${S.suffix}`)
  const tEdit = Date.now()
  const edit = await saveAs(nurse, v4, { expectedUpdatedAt: S.lastUpdatedAt })
  const rE = reportRow(S.reportId)
  check(D, 'E-06', 'After unlock the nurse may edit a submitted report: status becomes edited_after_submission, submitted_at kept (ReportSubmissionService::nextStatus)', '200 edited_after_submission', `${edit.status} ${JSON.stringify({ status: rE?.status, submitted_at: rE?.submitted_at })}`,
    edit.status === 200 && rE?.status === 'edited_after_submission' && rE.submitted_at !== null && same(dbFlat(S.reportId), flatPayload(v4)))
  S.lastUpdatedAt = edit.json?.updatedAt ?? S.lastUpdatedAt
  S.lastValues = v4
  const changed = diffCells(flatPayload(prev), flatPayload(v4))
  const auditRows = q.all<{ field_key: string; day_name: string; old_value: string | null; new_value: string | null; changed_by: string; changed_by_name: string; changed_at: string }>(
    'SELECT field_key, day_name, old_value, new_value, changed_by, changed_by_name, changed_at FROM audit_logs WHERE report_id = ? AND changed_at >= ?',
    [S.reportId, new Date(tEdit - 60_000).toISOString().slice(0, 19).replace('T', ' ')],
  )
  const auditMap = Object.fromEntries(auditRows.map((r) => [`${r.field_key}|${r.day_name}`, r]))
  const mondayKey = `total_patient_days|${S.activeDays[0]}`
  const mondayAudit = auditMap[mondayKey]
  check(D, 'Z-E06', 'Editing a submitted report writes one audit_logs row per changed cell with old/new values, actor = nurse (persistValues audit rows)', `${changed.length} rows; ${mondayKey} ${flatPayload(prev)[mondayKey]} -> ${flatPayload(v4)[mondayKey]}`,
    `${auditRows.length} rows; ${mondayKey} ${mondayAudit?.old_value} -> ${mondayAudit?.new_value} by ${mondayAudit?.changed_by_name}`,
    auditRows.length === changed.length && changed.every((k) => k in auditMap) && mondayAudit?.old_value === flatPayload(prev)[mondayKey] && mondayAudit?.new_value === flatPayload(v4)[mondayKey]
      && auditRows.every((r) => r.changed_by === S.qaNurseId && withinMinute(r.changed_at, tEdit)))
  const histEdit = q.count("SELECT count(*) c FROM report_status_history WHERE report_id = ? AND status = 'edited_after_submission' AND note = 'Submitted report changed while still unlocked.'", [S.reportId])
  const notifEdit = q.count("SELECT count(*) c FROM notifications WHERE type = 'submitted_report_edited' AND related_id = ?", [S.reportId])
  check(D, 'E-07', 'Post-submission edit records history "Submitted report changed while still unlocked." and notifies admins (submitted_report_edited)', 'history 1, notifications >= 1', `history=${histEdit} notifications=${notifEdit}`, histEdit === 1 && notifEdit >= 1)

  // Lock again then unlock: status returns to edited_after_submission (history-driven).
  const lock2 = await rc(admin, 'POST', `/api/reports/${S.reportId}/lock`)
  const unlock2 = await rc(admin, 'POST', `/api/reports/${S.reportId}/unlock`)
  const rU2 = reportRow(S.reportId)
  check(D, 'E-08', 'Unlocking a report that was edited after submission restores status edited_after_submission (ReportLockingService checks the history)', 'edited_after_submission', `${lock2.status}/${unlock2.status} status=${rU2?.status}`, lock2.status === 200 && unlock2.status === 200 && rU2?.status === 'edited_after_submission')
  S.lastUpdatedAt = unlock2.json?.updatedAt ?? S.lastUpdatedAt
})

// ---------------------------------------------------------------- F. comments

test('F comments: author/admin can post, foreign nurse refused, delete audited', async () => {
  test.skip(!S.reportId, 'no report')
  const admin = S.admin!
  const nurse = S.nurse!
  const rBefore = reportRow(S.reportId)
  const valuesBefore = dbFlat(S.reportId)

  const body = `${PREFIX}comment ${S.suffix}`
  const tC = Date.now()
  const post = await rc(nurse, 'POST', `/api/reports/${S.reportId}/comments`, { data: { body } })
  const commentId = post.json?.id ?? ''
  const crow = q.one<{ id: string; report_id: string; author_id: string; body: string; parent_id: string | null }>('SELECT * FROM report_comments WHERE id = ?', [commentId])
  check(D, 'F-01', 'QA nurse POST /api/reports/{id}/comments on own report creates a report_comments row (ReportCommentController::store)', '201 + row(report_id, author_id, body)', `${post.status} ${JSON.stringify(crow)}`,
    post.status === 201 && crow?.report_id === S.reportId && crow.author_id === S.qaNurseId && crow.body === body)
  const auditC = lastAdminAudit('report_comment', 'comment', commentId)
  const auditCNew = parseJson(auditC?.new_values)
  check(D, 'Z-F01', 'Comment creation writes admin_audit_logs action=comment entity=report_comment with the body in new_values, actor = nurse', 'row with body', JSON.stringify({ user: auditC?.user_id, body: auditCNew?.body, reportId: auditCNew?.reportId }),
    !!auditC && auditC.user_id === S.qaNurseId && auditCNew?.body === body && auditCNew?.reportId === S.reportId && withinMinute(auditC.created_at, tC))
  const notifC = q.count("SELECT count(*) c FROM notifications WHERE type = 'report_comment' AND related_id = ? AND created_at >= ?", [S.reportId, new Date(tC - 60_000).toISOString().slice(0, 19).replace('T', ' ')])
  info(D, 'F-01n', 'Notifications created for admins by a nurse comment (notifyParticipants)', String(notifC))

  const foreign = await rc(S.nurse2!, 'POST', `/api/reports/${S.reportId}/comments`, { data: { body: `${PREFIX}foreign comment` } })
  const foreignRows = q.count('SELECT count(*) c FROM report_comments WHERE report_id = ? AND author_id = ?', [S.reportId, S.nurse2Id])
  check(D, 'F-02', 'A nurse without the assignment cannot comment (Gate view -> 403), no row written', '403, 0 rows', `${excerpt(foreign)} rows=${foreignRows}`, foreign.status === 403 && foreignRows === 0)

  const adminBody = `${PREFIX}admin reply ${S.suffix}`
  const adminPost = await rc(admin, 'POST', `/api/reports/${S.reportId}/comments`, { data: { body: adminBody, parentId: commentId } })
  const adminCommentId = adminPost.json?.id ?? ''
  const adminRow = q.one<{ author_id: string; parent_id: string | null }>('SELECT author_id, parent_id FROM report_comments WHERE id = ?', [adminCommentId])
  check(D, 'F-03', 'Admin can reply on the report thread (parentId must belong to the report)', '201 row author=admin parent=nurse comment', `${adminPost.status} ${JSON.stringify(adminRow)}`,
    adminPost.status === 201 && adminRow?.author_id === S.adminId && adminRow.parent_id === commentId)
  const notifNurse = q.count("SELECT count(*) c FROM notifications WHERE type = 'report_comment' AND related_id = ? AND recipient_id = ?", [S.reportId, S.qaNurseId])
  check(D, 'F-03n', 'An admin comment notifies the owning nurse (notifyParticipants)', '>= 1', String(notifNurse), notifNurse >= 1)

  const list = await rc(nurse, 'GET', `/api/reports/${S.reportId}/comments`)
  const listedIds = (list.json?.data ?? []).map((c: any) => c.id)
  check(D, 'F-04', 'GET comments lists both comments in creation order', `[${commentId}, ${adminCommentId}]`, JSON.stringify(listedIds), list.status === 200 && listedIds.includes(commentId) && listedIds.includes(adminCommentId) && listedIds.indexOf(commentId) < listedIds.indexOf(adminCommentId))

  const rAfter = reportRow(S.reportId)
  check(D, 'F-05', 'Comments leave the report status/values/updated_at untouched', 'unchanged', JSON.stringify({ status: rAfter?.status, updated_at: rAfter?.updated_at }),
    rAfter?.status === rBefore?.status && rAfter?.updated_at === rBefore?.updated_at && rAfter?.locked_at === rBefore?.locked_at && same(dbFlat(S.reportId), valuesBefore))

  const foreignDel = await rc(S.nurse2!, 'DELETE', `/api/reports/${S.reportId}/comments/${commentId}`)
  const ownerDelAdmin = await rc(nurse, 'DELETE', `/api/reports/${S.reportId}/comments/${adminCommentId}`)
  const stillThere = q.count('SELECT count(*) c FROM report_comments WHERE id IN (?, ?)', [commentId, adminCommentId])
  check(D, 'F-06', 'A foreign user cannot delete a comment (403) and the report owner cannot delete someone else\'s comment (destroy: author or admin only)', '403 / 403, both rows kept', `${foreignDel.status} / ${ownerDelAdmin.status} rows=${stillThere}`,
    foreignDel.status === 403 && ownerDelAdmin.status === 403 && stillThere === 2)

  const tD = Date.now()
  const del = await rc(nurse, 'DELETE', `/api/reports/${S.reportId}/comments/${commentId}`)
  const gone = q.count('SELECT count(*) c FROM report_comments WHERE id = ?', [commentId])
  const auditD = lastAdminAudit('report_comment', 'delete', commentId)
  const auditDOld = parseJson(auditD?.old_values)
  check(D, 'F-07', 'QA nurse deletes own comment: row hard-deleted and admin_audit_logs action=delete keeps the body in old_values', '200 deleted, 0 rows, audit old.body', `${excerpt(del)} rows=${gone} audit=${JSON.stringify({ user: auditD?.user_id, body: auditDOld?.body })}`,
    del.status === 200 && del.json?.deleted === true && gone === 0 && !!auditD && auditD.user_id === S.qaNurseId && auditDOld?.body === body && withinMinute(auditD.created_at, tD))
  const cascade = q.count('SELECT count(*) c FROM report_comments WHERE id = ?', [adminCommentId])
  info(D, 'F-07i', 'Deleting a parent comment cascades to its reply (report_comments.parent_id ON DELETE CASCADE)', `reply rows remaining: ${cascade}`)
})

// ---------------------------------------------------------------- G. reporting periods

test('G reporting periods: future refused, past accepted, default window, timezone', async () => {
  test.skip(!S.assignmentId, 'no assignment')
  const nurse = S.nurse!
  const admin = S.admin!
  const future = S.futurePeriod!
  const past = S.pastPeriod!
  const current = S.currentPeriod!

  const fut = await rc(nurse, 'POST', '/api/reports', { data: { assignmentId: S.assignmentId, reportingPeriodId: future.id, values: valuesFor(20, `${PREFIX}future`) } })
  const futRows = q.count('SELECT count(*) c FROM reports WHERE assignment_id = ? AND reporting_period_id = ?', [S.assignmentId, future.id])
  check(D, 'G-01', `Saving against a future week (${String(future.week_start).slice(0, 10)}) is refused with 422 on reportingPeriodId and no row is created (ReportSubmissionService::assertPeriodHasStarted, QA-009)`, '422 + errors.reportingPeriodId, 0 rows', `${excerpt(fut)} rows=${futRows}`,
    fut.status === 422 && !!fut.json?.errors?.reportingPeriodId && futRows === 0)
  const futAdmin = await rc(admin, 'POST', '/api/reports', { data: { assignmentId: S.assignmentId, reportingPeriodId: future.id, values: valuesFor(20, `${PREFIX}future`) } })
  check(D, 'G-01a', 'Administrators are held to the same calendar for future weeks', '422', excerpt(futAdmin), futAdmin.status === 422)

  const pastSave = await rc(nurse, 'POST', '/api/reports', { data: { assignmentId: S.assignmentId, reportingPeriodId: past.id, values: valuesFor(25, `${PREFIX}past_${S.suffix}`) } })
  S.pastReportId = pastSave.json?.id ?? ''
  const pastRows = q.count('SELECT count(*) c FROM reports WHERE assignment_id = ? AND reporting_period_id = ?', [S.assignmentId, past.id])
  check(D, 'G-02', `A past week inside the default window (${String(past.week_start).slice(0, 10)}) is accepted`, '201, 1 row', `${pastSave.status} rows=${pastRows}`, pastSave.status === 201 && pastRows === 1)

  // Expected default window: last 9 periods with live_start <= week_start <= current week_start (ReportPeriodWindow::ids).
  const envText = fs.readFileSync(path.join(REPO_ROOT, 'backend', '.env'), 'utf8')
  const liveStart = /^REPORT_WINDOW_LIVE_START=(\S+)/m.exec(envText)?.[1] ?? '2026-03-02'
  const defaultCount = Number(/^REPORT_WINDOW_DEFAULT_COUNT=(\d+)/m.exec(envText)?.[1] ?? '9')
  const visible = q.all<{ id: string; week_start: string }>('SELECT id, week_start FROM reporting_periods WHERE date(week_start) >= date(?) AND date(week_start) <= date(?) ORDER BY week_start', [liveStart, current.week_start])
  const expectedIds = new Set(visible.slice(-defaultCount).map((p) => p.id))

  const nurseList = await rc(nurse, 'GET', '/api/reports?perPage=300')
  const nursePeriods = new Set((nurseList.json?.data ?? []).map((r: any) => r.reportingPeriodId))
  check(D, 'G-03', 'Nurse GET /api/reports (default window) lists the current-week and past-week reports and nothing outside the window', `2 periods incl. current ${current.id}`, `${nurseList.status} periods=${JSON.stringify([...nursePeriods])}`,
    nurseList.status === 200 && nursePeriods.size === 2 && nursePeriods.has(current.id) && nursePeriods.has(past.id) && [...nursePeriods].every((id) => expectedIds.has(id as string)))

  const adminList = await rc(admin, 'GET', '/api/reports?perPage=300')
  const adminPeriods = new Set((adminList.json?.data ?? []).map((r: any) => r.reportingPeriodId))
  const outside = [...adminPeriods].filter((id) => !expectedIds.has(id as string))
  check(D, 'G-04', `Admin GET /api/reports default window only covers the last ${defaultCount} started periods since live_start ${liveStart} and includes the current week (ReportPeriodWindow::ids)`, `subset of ${expectedIds.size} ids, current included`, `${adminPeriods.size} periods on page 1 (total ${adminList.json?.meta?.total}), outside=${outside.length}, current=${adminPeriods.has(current.id)}`,
    adminList.status === 200 && outside.length === 0 && adminPeriods.has(current.id))
  info(D, 'G-04i', 'Distinct reporting periods listed on page 1 of the default window / expected window size', `${adminPeriods.size} / ${expectedIds.size}`)
  const allList = await rc(admin, 'GET', '/api/reports?reportPeriodWindow=all&perPage=1')
  info(D, 'G-05i', 'meta.total for the default window vs reportPeriodWindow=all', `${adminList.json?.meta?.total} vs ${allList.json?.meta?.total}`)
  check(D, 'G-05', 'reportPeriodWindow=all exposes at least as many reports as the default window', 'all >= default', `${allList.json?.meta?.total} >= ${adminList.json?.meta?.total}`, Number(allList.json?.meta?.total) >= Number(adminList.json?.meta?.total))
  const wsNurse = await rc(nurse, 'GET', '/api/workspace')
  const wsPeriodIds = (wsNurse.json?.state?.reportingPeriods ?? []).map((p: any) => p.id)
  check(D, 'G-06', 'GET /api/workspace state.reportingPeriods include the current week and no future week', 'current included, none after current', `count=${wsPeriodIds.length} current=${wsPeriodIds.includes(current.id)} future=${wsPeriodIds.includes(future.id)}`,
    wsPeriodIds.includes(current.id) && !wsPeriodIds.includes(future.id))

  const appConfig = fs.readFileSync(path.join(REPO_ROOT, 'backend', 'config', 'app.php'), 'utf8')
  const tz = /'timezone'\s*=>\s*env\('APP_TIMEZONE',\s*'([^']+)'\)/.exec(appConfig)?.[1]
  const btz = /'business_timezone'\s*=>\s*env\('HOSPITAL_TIMEZONE',\s*'([^']+)'\)/.exec(appConfig)?.[1]
  info(D, 'G-07i', 'App timezone (DB timestamps) / business timezone (calendar decisions, HospitalClock)', `${tz} / ${btz}`)
  const expectedMonday = mondayOf(nairobiToday())
  check(D, 'G-07', `reporting_periods.week_start of the current period is the Monday of the current Africa/Nairobi week`, expectedMonday, String(current.week_start).slice(0, 10), String(current.week_start).slice(0, 10) === expectedMonday)
})

// ---------------------------------------------------------------- H. deadline settings

test('H deadline settings: valid HH:MM accepted and periods recalculated, invalid refused and untouched, restore', async () => {
  const admin = S.admin!
  const snapshot = await rc(admin, 'GET', '/api/admin/settings')
  check(D, 'H-00', 'GET /api/admin/settings returns the structured settings and rows (SettingsController::show)', '200 with settings.weeklyDeadlineTime', `${snapshot.status} time=${snapshot.json?.settings?.weeklyDeadlineTime} day=${snapshot.json?.settings?.weeklyDeadlineDay}`,
    snapshot.status === 200 && typeof snapshot.json?.settings?.weeklyDeadlineTime === 'string')
  const original = snapshot.json?.settings ?? {}
  const originalDay: string = original.weeklyDeadlineDay ?? 'monday'
  const originalTime: string = original.weeklyDeadlineTime ?? '10:00'
  const originalRow = q.one<{ value_json: string }>("SELECT value_json FROM app_settings WHERE setting_key = 'weekly_deadline'")
  info(D, 'H-00i', 'Original weekly_deadline row', String(originalRow?.value_json))

  const mismatches = (day: string, time: string) =>
    q.count("SELECT count(*) c FROM reporting_periods WHERE deadline_at != (date(week_start, '+' || ? || ' days') || ' ' || ? || ':00')", [WEEKDAY_OFFSETS[day] ?? 0, time])
  const storedTime = () => q.one<{ t: string }>("SELECT json_extract(value_json, '$.time') t FROM app_settings WHERE setting_key = 'weekly_deadline'")?.t
  const currentDeadline = () => q.one<{ deadline_at: string }>('SELECT deadline_at FROM reporting_periods WHERE id = ?', [S.currentPeriod!.id])?.deadline_at

  try {
    let last = originalTime
    for (const time of ['00:00', '09:30', '10:00', '23:59']) {
      if (time === last) {
        // Changing to the same value would not trigger recalculation; go through a different value first.
        await rc(admin, 'PATCH', '/api/admin/settings', { data: { weeklyDeadlineTime: '11:11' } })
        last = '11:11'
      }
      const tH = Date.now()
      const res = await rc(admin, 'PATCH', '/api/admin/settings', { data: { weeklyDeadlineTime: time } })
      const stored = storedTime()
      const mism = mismatches(originalDay, time)
      const cur = currentDeadline()
      check(D, `H-01-${time.replace(':', '')}`, `PATCH /api/admin/settings weeklyDeadlineTime=${time} is accepted (date_format:H:i), stored in app_settings.weekly_deadline and every reporting_periods.deadline_at = week_start + offset(${originalDay}) at ${time} (AppSettingsService::recalculateDeadlines)`,
        `200, stored ${time}, 0 mismatching periods`, `${res.status} stored=${stored} mismatches=${mism} currentDeadline=${cur}`,
        res.status === 200 && res.json?.settings?.weeklyDeadlineTime === time && stored === time && mism === 0)
      const auditH = lastAdminAudit('app_settings', 'update')
      check(D, `Z-H01-${time.replace(':', '')}`, 'Settings update writes admin_audit_logs action=update entity=app_settings with old/new weeklyDeadlineTime by the admin', `old ${last} -> new ${time}`, JSON.stringify({ user: auditH?.user_id, old: parseJson(auditH?.old_values)?.weeklyDeadlineTime, new: parseJson(auditH?.new_values)?.weeklyDeadlineTime }),
        !!auditH && auditH.user_id === S.adminId && withinMinute(auditH.created_at, tH) && parseJson(auditH.old_values)?.weeklyDeadlineTime === last && parseJson(auditH.new_values)?.weeklyDeadlineTime === time)
      last = time
    }

    for (const bad of ['24:00', '25:99', '12:60', '99:99']) {
      const beforeDeadline = currentDeadline()
      const res = await rc(admin, 'PATCH', '/api/admin/settings', { data: { weeklyDeadlineTime: bad } })
      const stored = storedTime()
      const mism = mismatches(originalDay, last)
      check(D, `H-02-${bad.replace(':', '')}`, `Invalid weeklyDeadlineTime ${bad} is refused with 422 (QA-006, date_format:H:i) and neither app_settings nor reporting_periods.deadline_at change`, `422, stored ${last}, deadlines unchanged`, `${res.status} stored=${stored} mismatches=${mism} currentDeadline ${beforeDeadline} -> ${currentDeadline()}`,
        res.status === 422 && !!res.json?.errors?.weeklyDeadlineTime && stored === last && mism === 0 && currentDeadline() === beforeDeadline)
    }
  } finally {
    const restore = await rc(admin, 'PATCH', '/api/admin/settings', { data: { weeklyDeadlineTime: originalTime, weeklyDeadlineDay: originalDay } })
    const stored = storedTime()
    const mism = mismatches(originalDay, originalTime)
    const after = await rc(admin, 'GET', '/api/admin/settings')
    check(D, 'H-99', 'Original deadline settings restored in finally: app_settings row, every deadline_at and the structured settings equal the snapshot', `time ${originalTime}, day ${originalDay}, 0 mismatches, settings deep-equal`, `${restore.status} stored=${stored} mismatches=${mism} equal=${deepEqual(after.json?.settings, original)}`,
      restore.status === 200 && stored === originalTime && mism === 0 && deepEqual(after.json?.settings, original))
  }
})

// ---------------------------------------------------------------- Y. settings isolation

test('Y settings isolation: changing one key leaves every other key and the deadlines untouched', async () => {
  const admin = S.admin!
  const snapshot = await rc(admin, 'GET', '/api/admin/settings')
  const original = snapshot.json?.settings ?? {}
  const rowsBefore = Object.fromEntries(q.all<{ setting_key: string; value_json: string }>('SELECT setting_key, value_json FROM app_settings').map((r) => [r.setting_key, r.value_json]))
  const deadlinesBefore = q.all<{ id: string; deadline_at: string }>('SELECT id, deadline_at FROM reporting_periods ORDER BY week_start')
  const originalRise = Number(original.notableRiseThresholdPercent ?? 10)
  const nextRise = originalRise + 7

  try {
    const res = await rc(admin, 'PATCH', '/api/admin/settings', { data: { notableRiseThresholdPercent: nextRise } })
    const after = res.json?.settings ?? {}
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { notableRiseThresholdPercent: _a, ...restAfter } = after
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { notableRiseThresholdPercent: _b, ...restBefore } = original
    const rowsAfter = Object.fromEntries(q.all<{ setting_key: string; value_json: string }>('SELECT setting_key, value_json FROM app_settings').map((r) => [r.setting_key, r.value_json]))
    const changedRows = Object.keys({ ...rowsBefore, ...rowsAfter }).filter((k) => rowsBefore[k] !== rowsAfter[k])
    const insight = parseJson(rowsAfter.insight_thresholds)
    check(D, 'Y-01', `PATCH notableRiseThresholdPercent=${nextRise} changes only that key in the response and only the insight_thresholds row in app_settings (AppSettingsService::update)`, `rise ${nextRise}; other keys equal; changed rows ['insight_thresholds']`, `${res.status} rise=${after.notableRiseThresholdPercent} othersEqual=${deepEqual(restAfter, restBefore)} changedRows=${JSON.stringify(changedRows)} insight=${rowsAfter.insight_thresholds}`,
      res.status === 200 && after.notableRiseThresholdPercent === nextRise && deepEqual(restAfter, restBefore) && changedRows.length === 1 && changedRows[0] === 'insight_thresholds' && insight?.rise_percent === nextRise && insight?.drop_percent === original.notableDropThresholdPercent)
    const deadlinesAfter = q.all<{ id: string; deadline_at: string }>('SELECT id, deadline_at FROM reporting_periods ORDER BY week_start')
    check(D, 'Y-02', 'A non-deadline setting change does not rewrite reporting_periods.deadline_at (deadline policy unchanged => no recalculation)', 'identical deadlines', `${deadlinesAfter.length} periods, equal=${deepEqual(deadlinesBefore, deadlinesAfter)}`, deepEqual(deadlinesBefore, deadlinesAfter))
    const touched = q.count("SELECT count(*) c FROM app_settings WHERE updated_at >= ?", [new Date(Date.now() - 60_000).toISOString().slice(0, 19).replace('T', ' ')])
    info(D, 'Y-02i', 'app_settings rows whose updated_at was touched by the single-key update (update() upserts every key; value_json of the others is unchanged)', String(touched))
  } finally {
    const restore = await rc(admin, 'PATCH', '/api/admin/settings', { data: { notableRiseThresholdPercent: originalRise } })
    const after = await rc(admin, 'GET', '/api/admin/settings')
    const rowsAfter = Object.fromEntries(q.all<{ setting_key: string; value_json: string }>('SELECT setting_key, value_json FROM app_settings').map((r) => [r.setting_key, r.value_json]))
    check(D, 'Y-99', 'Threshold restored in finally: settings and app_settings value_json equal the snapshot', 'equal', `${restore.status} settingsEqual=${deepEqual(after.json?.settings, original)} rowsEqual=${deepEqual(rowsBefore, rowsAfter)}`,
      restore.status === 200 && deepEqual(after.json?.settings, original) && deepEqual(rowsBefore, rowsAfter))
  }
})

// ---------------------------------------------------------------- Z. audit access

test('Z audit endpoints: nurse refused, admin sees the cell edits of the QA report', async () => {
  const nurse = S.nurse!
  const admin = S.admin!
  const a = await rc(nurse, 'GET', '/api/admin/audit-logs')
  const b = await rc(nurse, 'GET', '/api/admin/admin-audit-logs')
  const c = await rc(nurse, 'GET', '/api/admin/settings')
  check(D, 'Z-01', 'GET /api/admin/audit-logs and /api/admin/admin-audit-logs as a nurse are refused (permission:audit.view)', '403 / 403', `${a.status} / ${b.status}`, a.status === 403 && b.status === 403)
  check(D, 'Z-02', 'GET /api/admin/settings as a nurse is refused (permission:settings.manage)', '403', String(c.status), c.status === 403)

  test.skip(!S.reportId, 'no report')
  const dbRows = q.count('SELECT count(*) c FROM audit_logs WHERE report_id = ?', [S.reportId])
  const api = await rc(admin, 'GET', `/api/admin/audit-logs?report_id=${S.reportId}&perPage=100`)
  const apiRows = (api.json?.data ?? []).length
  check(D, 'Z-03', 'Admin GET /api/admin/audit-logs?report_id= returns every cell-edit row stored for the QA report (AuditLogController::cellEdits)', `${dbRows}`, `${api.status} ${apiRows} (meta.total ${api.json?.meta?.total})`, api.status === 200 && (Number(api.json?.meta?.total ?? apiRows) === dbRows))
  const adminApi = await rc(admin, 'GET', `/api/admin/admin-audit-logs?entity_type=report_comment&perPage=100`)
  info(D, 'Z-04i', 'Admin GET /api/admin/admin-audit-logs?entity_type=report_comment', `${adminApi.status}, ${(adminApi.json?.data ?? []).length} rows on page 1`)
})

// ---------------------------------------------------------------- AB. concurrency

test('AB concurrent edits at the API level: stale revision refused with the winning values, fresh revision accepted, no key = last write wins', async () => {
  test.skip(!S.reportId, 'no report')
  const nurse = S.nurse!
  const admin = S.admin!

  const loadA = await rc(nurse, 'GET', `/api/reports/${S.reportId}`)
  const loadB = await rc(admin, 'GET', `/api/reports/${S.reportId}`)
  const loaded = loadA.json?.updatedAt
  check(D, 'AB-00', 'Both sessions load the same revision', 'equal updatedAt', `${loaded} / ${loadB.json?.updatedAt}`, !!loaded && loaded === loadB.json?.updatedAt)
  const tLoad = Date.now()
  await nextSecondAfter(tLoad)

  const vA = valuesFor(70, `${PREFIX}A_${S.suffix}`)
  const saveA = await saveAs(nurse, vA, { expectedUpdatedAt: loaded })
  const dbA = dbFlat(S.reportId)
  check(D, 'AB-01', 'Session A saves with the loaded revision: 200 and DB = A', '200, DB = A', `${saveA.status} same=${same(dbA, flatPayload(vA))}`, saveA.status === 200 && same(dbA, flatPayload(vA)))
  const freshA = saveA.json?.updatedAt

  const vB = valuesFor(80, `${PREFIX}B_${S.suffix}`)
  const saveB = await saveAs(admin, vB, { expectedUpdatedAt: loaded })
  const conflictValues = flatApi(saveB.json?.conflict?.report?.values, VALUE_KEYS)
  check(D, 'AB-02', 'Session B saves with the same stale revision: 409 reason=stale carrying the current server values (= A) and updatedBy A; DB still = A (ReportConflictException::render)', '409 stale, conflict.report.values = A, DB = A', `${saveB.status} reason=${saveB.json?.conflict?.reason} updatedById=${saveB.json?.conflict?.report?.updatedById} conflictSameAsA=${same(conflictValues, flatPayload(vA))} dbSameAsA=${same(dbFlat(S.reportId), flatPayload(vA))}`,
    saveB.status === 409 && saveB.json?.conflict?.reason === 'stale' && same(conflictValues, flatPayload(vA)) && same(dbFlat(S.reportId), flatPayload(vA)) && saveB.json?.conflict?.report?.updatedById === S.qaNurseId)
  const auditAfterConflict = q.count('SELECT count(*) c FROM audit_logs WHERE report_id = ? AND changed_by = ?', [S.reportId, S.adminId])
  check(D, 'AB-02a', 'The refused save wrote no audit_logs rows for the admin', '0', String(auditAfterConflict), auditAfterConflict === 0)

  const conflictRevision = saveB.json?.conflict?.report?.updatedAt ?? freshA
  const saveB2 = await saveAs(admin, vB, { expectedUpdatedAt: conflictRevision })
  check(D, 'AB-03', 'Session B re-saves with the revision reported in the conflict: 200 and DB = B (explicit overwrite)', '200, DB = B', `${saveB2.status} same=${same(dbFlat(S.reportId), flatPayload(vB))}`, saveB2.status === 200 && same(dbFlat(S.reportId), flatPayload(vB)))
  const rB = reportRow(S.reportId)
  check(D, 'AB-03u', 'reports.updated_by records the last writer (admin) and updated_at is fresh', `updated_by ${S.adminId}`, JSON.stringify({ updated_by: rB?.updated_by, updated_at: rB?.updated_at }), rB?.updated_by === S.adminId && withinMinute(rB?.updated_at))

  const vC = valuesFor(90, `${PREFIX}C_${S.suffix}`)
  const saveC = await saveAs(nurse, vC)
  check(D, 'AB-04', 'A save without expectedUpdatedAt overwrites regardless of revision (historical last-write-wins for clients that do not opt in)', '200, DB = C', `${saveC.status} same=${same(dbFlat(S.reportId), flatPayload(vC))}`, saveC.status === 200 && same(dbFlat(S.reportId), flatPayload(vC)))
  info(D, 'AB-04i', 'Last-write-wins without the revision key is still the behaviour for clients that omit expectedUpdatedAt (ReportWorkflowController::expectedRevision)', String(saveC.status))
  const badRev = await saveAs(nurse, vC, { expectedUpdatedAt: 'not-a-date' })
  check(D, 'AB-05', 'A malformed expectedUpdatedAt is refused with 422 (validation date rule)', '422', excerpt(badRev), badRev.status === 422)
  S.lastValues = vC
  S.lastUpdatedAt = saveC.json?.updatedAt ?? S.lastUpdatedAt
})
