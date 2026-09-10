/**
 * Business-rule regression: observability isolation (AC).
 *
 * The client-error intake and the webhook forwarder must never change the
 * outcome of a business request. Rules from ClientErrorController,
 * App\Support\Observability\ErrorReporter and config/observability.php;
 * behaviour under a dead webhook is exercised by pointing
 * OBSERVABILITY_WEBHOOK_URL at a closed port in backend/.env (php artisan
 * serve reloads .env) and restoring the file byte-for-byte in `finally`.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { test, type APIRequestContext } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import {
  anonContext,
  apiAs,
  call,
  check,
  dbCount,
  dbOne,
  EXTRA_ACCOUNTS,
  flushRateLimits,
  forgetSession,
  info,
  OUTPUT_DIR,
  REPO_ROOT,
  resetFindings,
  uniqueSuffix,
  type Call,
} from './helpers/index'

const D = 'observability'
const QA = 'QA_REG_AUTH_'
const QA_PASSWORD = 'QaReg2026!auth'
const ENV_FILE = path.join(REPO_ROOT, 'backend', '.env')
const LOG_FILE = path.join(REPO_ROOT, 'backend', 'storage', 'logs', 'laravel.log')
const DEAD_WEBHOOK = 'http://127.0.0.1:9'

/** Reset once per run, not once per worker (a worker restart after a failure re-imports this file). */
function resetFindingsOncePerRun(domain: string): void {
  const marker = path.join(OUTPUT_DIR, `.${domain}.run`)
  const runId = String(process.ppid)
  if (fs.existsSync(marker) && fs.readFileSync(marker, 'utf8') === runId) return
  resetFindings(domain)
  fs.mkdirSync(OUTPUT_DIR, { recursive: true })
  fs.writeFileSync(marker, runId)
}
resetFindingsOncePerRun(D)

const dbReads = { n: 0 }
function readOne<T = Record<string, any>>(sql: string, params: unknown[] = []): T | null {
  dbReads.n += 1
  return dbOne<T>(sql, params)
}
function readCount(sql: string, params: unknown[] = []): number {
  dbReads.n += 1
  return dbCount(sql, params)
}

type QaUser = { id: string; email: string; password: string }
const created: QaUser[] = []
const createdAssignmentIds: string[] = []

async function loginRaw(identifier: string, password: string): Promise<{ ctx: APIRequestContext; res: Call }> {
  const ctx = await anonContext()
  const res = await call(ctx, 'POST', '/api/auth/login', { data: { identifier, password } })
  return { ctx, res }
}

function readLogTail(bytes = 512 * 1024): string {
  if (!fs.existsSync(LOG_FILE)) return ''
  const size = fs.statSync(LOG_FILE).size
  const start = Math.max(0, size - bytes)
  const fd = fs.openSync(LOG_FILE, 'r')
  try {
    const buf = Buffer.alloc(size - start)
    fs.readSync(fd, buf, 0, buf.length, start)
    return buf.toString('utf8')
  } finally {
    fs.closeSync(fd)
  }
}

/**
 * Poll the health snapshot until the webhook flag matches on TWO consecutive
 * reads a second apart. `php artisan serve` re-reads .env per request (so the
 * very first poll can already see the new value) and then, about half a second
 * later, notices the file's mtime and restarts its child server; during that
 * restart the Vite proxy answers 502. The settle delay plus the double read
 * keep the business requests below out of that window.
 */
async function waitForWebhookConfigured(expected: boolean, timeoutMs = 45_000): Promise<{ ok: boolean; last: Call | null; attempts: number }> {
  await new Promise((r) => setTimeout(r, 3000))
  const deadline = Date.now() + timeoutMs
  let last: Call | null = null
  let attempts = 0
  let consecutive = 0
  while (Date.now() < deadline) {
    attempts += 1
    try {
      const superadmin = await apiAs(EXTRA_ACCOUNTS.superadmin)
      last = await call(superadmin, 'GET', '/api/admin/system-health')
      await superadmin.dispose()
      if (last.status === 200 && last.json?.observability?.webhookConfigured === expected) {
        consecutive += 1
        if (consecutive >= 2) return { ok: true, last, attempts }
      } else {
        consecutive = 0
      }
    } catch {
      consecutive = 0 // server restarting after the .env change
    }
    await new Promise((r) => setTimeout(r, 1000))
  }
  return { ok: false, last, attempts }
}

const validClientError = (marker: string) => ({
  kind: 'error',
  message: `${QA}${marker} synthetic client error`,
  routeName: '/nurse/reports',
  status: 500,
  releaseSha: 'qa-reg',
  userAgent: 'playwright-regression',
})

test.beforeAll(async () => {
  await flushRateLimits()
})

test.afterAll(async () => {
  await flushRateLimits()
  try {
    const superadmin = await apiAs(EXTRA_ACCOUNTS.superadmin)
    for (const id of createdAssignmentIds) await call(superadmin, 'PATCH', `/api/admin/assignments/${id}`, { data: { active: false } })
    for (const user of created) {
      await call(superadmin, 'DELETE', `/api/admin/users/${user.id}`)
      forgetSession(user.email)
    }
    await superadmin.dispose()
  } catch (error) {
    info(D, 'CLEANUP', 'QA user deactivation', `failed: ${String(error).slice(0, 200)}`)
  }
  info(D, 'DB-READS', 'number of direct database re-reads performed by this spec', String(dbReads.n))
})

test.describe('AC. observability isolation', () => {
  test('AC1 malformed client errors are rejected without side effects; AC2 valid ones are accepted and the API path is unaffected', async () => {
    const anon = await anonContext()
    const empty = await call(anon, 'POST', '/api/client-errors', { data: {} })
    const badKind = await call(anon, 'POST', '/api/client-errors', { data: { kind: 'anything', message: 'x', routeName: '/admin' } })
    const badRoute = await call(anon, 'POST', '/api/client-errors', { data: { kind: 'error', message: 'boom', routeName: 'javascript:alert(1)' } })
    check(D, 'AC1-malformed', 'ClientErrorController::store validates strictly: empty body, unknown kind and a non-path routeName are 422 (never 5xx)', '422/422/422', `${empty.status}/${badKind.status}/${badRoute.status}`, empty.status === 422 && badKind.status === 422 && badRoute.status === 422)
    const storeTable = readOne<{ name: string }>("select name from sqlite_master where type = 'table' and name like '%client_error%'")
    info(D, 'AC1-nothing-stored', 'the controller stores nothing: no client_errors table exists (log + counters + optional webhook only)', storeTable ? `table ${storeTable.name} exists` : 'no client_error table')

    const accepted = await call(anon, 'POST', '/api/client-errors', { data: validClientError('ac2') })
    check(D, 'AC2-accepted', 'a valid client error is accepted with 202 No Content (no webhook configured -> log + counter only)', '202', String(accepted.status), accepted.status === 202)
    await anon.dispose()

    // The API path a nurse uses is unrelated to the intake endpoint: a save right after it succeeds.
    const admin = await apiAs(EXTRA_ACCOUNTS.admin)
    const suffix = uniqueSuffix()
    const email = `qa_reg_auth_obs_${suffix}@qa.local`
    const create = await call(admin, 'POST', '/api/admin/users', { data: { fullName: `${QA}obs_${suffix}`, email, password: QA_PASSWORD, role: 'nurse', passwordChangeRequired: false } })
    if (create.status !== 201) throw new Error(`QA nurse not created: ${create.status} ${create.text.slice(0, 200)}`)
    created.push({ id: create.json.id, email, password: QA_PASSWORD })
    const department = readOne<{ id: string; template_id: string }>("select d.id, d.template_id from departments d join report_templates t on t.id = d.template_id where d.active = 1 and t.active = 1 and d.slug = 'chest_inpatient'")
      ?? readOne<{ id: string; template_id: string }>('select d.id, d.template_id from departments d join report_templates t on t.id = d.template_id where d.active = 1 and t.active = 1 order by d.slug limit 1')
    const period = readOne<{ id: string }>("select id from reporting_periods where date(week_start) <= date('now') order by week_start desc limit 1")
    if (!department || !period) throw new Error('reference data missing')
    const grant = await call(admin, 'POST', '/api/admin/assignments', { data: { nurseId: create.json.id, departmentId: department.id, templateId: department.template_id } })
    if (grant.status !== 201) throw new Error(`assignment not created: ${grant.status} ${grant.text.slice(0, 200)}`)
    createdAssignmentIds.push(grant.json.id)
    await admin.dispose()

    const nurse = await loginRaw(email, QA_PASSWORD)
    const save = await call(nurse.ctx, 'POST', '/api/reports', { data: { assignmentId: grant.json.id, reportingPeriodId: period.id, values: { total_admitted_patients: { dailyValues: { monday: 3 } } } } })
    const row = readOne<{ id: string; status: string }>('select id, status from reports where assignment_id = ? and reporting_period_id = ?', [grant.json.id, period.id])
    check(D, 'AC2-save-unaffected', 'ReportWorkflowController::store succeeds (201, draft row) right after the client-error intake was used', '201 draft row', `${save.status} row=${row?.id ?? 'none'} status=${row?.status}`, save.status === 201 && !!row && row.status === 'draft')
    await nurse.ctx.dispose()
  })

  test('AC3 a dead webhook never changes a business outcome', async () => {
    test.setTimeout(240_000)
    const superadmin = await apiAs(EXTRA_ACCOUNTS.superadmin)
    const baseline = await call(superadmin, 'GET', '/api/admin/system-health')
    await superadmin.dispose()
    if (baseline.status !== 200) throw new Error(`health baseline ${baseline.status}`)
    if (baseline.json?.application?.configCached === true) {
      info(D, 'AC3-skip', 'SKIP: config is cached (application.configCached=true) so a .env edit would not reach the running server; relying on ObservabilityTest::test_webhook_failures_never_surface', 'skipped')
      return
    }
    if (baseline.json?.observability?.webhookConfigured === true) {
      info(D, 'AC3-skip', 'SKIP: a webhook is already configured on this stack; not overriding it', 'skipped')
      return
    }

    const original = fs.readFileSync(ENV_FILE)
    const nurse = created[0]
    if (!nurse) throw new Error('AC2 did not create the QA nurse')
    const assignmentId = createdAssignmentIds[0]
    const period = readOne<{ id: string }>("select id from reporting_periods where date(week_start) <= date('now') order by week_start desc limit 1")!
    const logBefore = fs.existsSync(LOG_FILE) ? fs.statSync(LOG_FILE).size : 0

    try {
      const suffix = original.length && original[original.length - 1] !== 0x0a ? '\n' : ''
      fs.writeFileSync(ENV_FILE, Buffer.concat([original, Buffer.from(`${suffix}OBSERVABILITY_WEBHOOK_URL=${DEAD_WEBHOOK}\n`)]))
      const on = await waitForWebhookConfigured(true)
      check(D, 'AC3-env-applied', 'php artisan serve reloads backend/.env: after appending OBSERVABILITY_WEBHOOK_URL the health snapshot reports observability.webhookConfigured=true', 'true', `${on.ok} after ${on.attempts} poll(s), last status ${on.last?.status}`, on.ok)
      if (on.last) {
        check(D, 'AC3-health-hides-url', 'the health snapshot reports only the boolean, never the webhook URL itself', 'body does not contain the URL', on.last.text.includes(DEAD_WEBHOOK) ? 'URL present' : 'absent', !on.last.text.includes(DEAD_WEBHOOK))
      }
      if (!on.ok) return

      const anon = await anonContext()
      const clientError = await call(anon, 'POST', '/api/client-errors', { data: validClientError('ac3-dead-webhook') })
      await anon.dispose()
      check(D, 'AC3-client-error-forwarded', 'ErrorReporter::forward swallows a connection failure to the webhook: the client-error intake still answers 202', '202', String(clientError.status), clientError.status === 202)

      const session = await loginRaw(nurse.email, nurse.password)
      check(D, 'AC3-login', 'login is unaffected by the dead webhook', '200', String(session.res.status), session.res.status === 200)
      const save = await call(session.ctx, 'POST', '/api/reports', { data: { assignmentId, reportingPeriodId: period.id, values: { total_admitted_patients: { dailyValues: { monday: 4, tuesday: 5 } } } } })
      const row = readOne<{ id: string; status: string; updated_at: string }>('select id, status, updated_at from reports where assignment_id = ? and reporting_period_id = ?', [assignmentId, period.id])
      const cells = readCount('select count(*) c from report_field_values where report_id = ?', [row?.id ?? ''])
      check(D, 'AC3-save-under-dead-webhook', 'ReportWorkflowController::store still answers 201 and persists the values while the webhook is unreachable', '201, row present, 2 cells', `${save.status} row=${row?.id ?? 'none'} cells=${cells}`, save.status === 201 && !!row && cells === 2)
      const submit = await call(session.ctx, 'POST', `/api/reports/${row?.id}/submit`, { data: {} })
      const submitted = readOne<{ status: string; submitted_at: string | null }>('select status, submitted_at from reports where id = ?', [row?.id ?? ''])
      check(D, 'AC3-submit-under-dead-webhook', 'submitting (which fans out notifications and alerts) also succeeds and the row is submitted', '200 submitted', `${submit.status} status=${submitted?.status} submitted_at=${submitted?.submitted_at}`, submit.status === 200 && submitted?.status === 'submitted' && !!submitted?.submitted_at)
      await session.ctx.dispose()

      // Evidence that the forwarder actually tried (and failed quietly).
      await new Promise((r) => setTimeout(r, 1500))
      const tail = readLogTail(Math.max(64 * 1024, (fs.existsSync(LOG_FILE) ? fs.statSync(LOG_FILE).size : 0) - logBefore + 4096))
      const unreachable = (tail.match(/Observability webhook unreachable/g) ?? []).length
      const clientLogged = tail.includes('ac3-dead-webhook')
      check(D, 'AC3-webhook-noticed', 'ErrorReporter logs "Observability webhook unreachable" (notice) when the forward fails, and the client error itself is still logged', 'both present in the log tail', `unreachable notices=${unreachable}, client error logged=${clientLogged}`, unreachable >= 1 && clientLogged)
      const serverErrors = (tail.match(/local\.ERROR/g) ?? []).length
      info(D, 'AC3-server-errors', 'local.ERROR lines in the log tail written during the dead-webhook window', String(serverErrors))
    } finally {
      fs.writeFileSync(ENV_FILE, original)
      const restored = Buffer.compare(fs.readFileSync(ENV_FILE), original) === 0
      const off = await waitForWebhookConfigured(false)
      if (!off.ok) {
        // Bump the mtime so the dev server notices the restore even if both writes landed in the same second.
        const now = new Date()
        fs.utimesSync(ENV_FILE, now, now)
        await waitForWebhookConfigured(false)
      }
      const final = await waitForWebhookConfigured(false, 15_000)
      check(D, 'AC3-env-restored', 'backend/.env is restored byte-for-byte and the server reports webhookConfigured=false again', 'identical file, false', `identical=${restored}, webhookConfigured=${final.last?.json?.observability?.webhookConfigured}`, restored && final.ok)
    }
  })
})
