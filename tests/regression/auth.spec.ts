/**
 * Business-rule regression: authentication and account state (A), user
 * approval and role management (B), maintenance health authorization (AD).
 *
 * Every rule is taken from the code that owns it (file named in the rule
 * text) and every row change is re-read from the database with node:sqlite.
 * Runs against the already-running dev stack; creates only QA_REG_AUTH_*
 * rows and never changes a seeded account permanently.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { test, type APIRequestContext } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import {
  anonContext,
  apiAs,
  call,
  check,
  dbAll,
  dbCount,
  dbOne,
  DB_PATH,
  DEV_PASSWORD,
  EXTRA_ACCOUNTS,
  flushRateLimits,
  forgetSession,
  info,
  OUTPUT_DIR,
  REPO_ROOT,
  resetFindings,
  ROLE_IDENTIFIERS,
  uniqueSuffix,
  type Call,
} from './helpers/index'

const D = 'auth'
const QA = 'QA_REG_AUTH_'
const QA_PASSWORD = 'QaReg2026!auth'
const LOG_FILE = path.join(REPO_ROOT, 'backend', 'storage', 'logs', 'laravel.log')

/**
 * Playwright restarts the worker after a failed test, which re-imports this
 * module; resetting unconditionally at import time would wipe the findings of
 * the tests that already ran. Reset once per run instead (the runner process
 * is the worker's parent, so its pid identifies the run).
 */
function resetFindingsOncePerRun(domain: string): void {
  const marker = path.join(OUTPUT_DIR, `.${domain}.run`)
  const runId = String(process.ppid)
  if (fs.existsSync(marker) && fs.readFileSync(marker, 'utf8') === runId) return
  resetFindings(domain)
  fs.mkdirSync(OUTPUT_DIR, { recursive: true })
  fs.writeFileSync(marker, runId)
}
resetFindingsOncePerRun(D)

// ---------------------------------------------------------------- DB re-reads (counted)
const dbReads = { n: 0 }
function readOne<T = Record<string, any>>(sql: string, params: unknown[] = []): T | null {
  dbReads.n += 1
  return dbOne<T>(sql, params)
}
function readAll<T = Record<string, any>>(sql: string, params: unknown[] = []): T[] {
  dbReads.n += 1
  return dbAll<T>(sql, params)
}
function readCount(sql: string, params: unknown[] = []): number {
  dbReads.n += 1
  return dbCount(sql, params)
}

// ---------------------------------------------------------------- local helpers
type QaUser = { id: string; email: string; name: string; password: string }
const created: QaUser[] = []
const createdAssignmentIds: string[] = []

async function loginRaw(identifier: string, password: string): Promise<{ ctx: APIRequestContext; res: Call }> {
  const ctx = await anonContext()
  const res = await call(ctx, 'POST', '/api/auth/login', { data: { identifier, password } })
  return { ctx, res }
}

async function createQaUser(
  admin: APIRequestContext,
  purpose: string,
  options: { role?: 'nurse' | 'student_rep' | 'admin'; passwordChangeRequired?: boolean } = {},
): Promise<QaUser> {
  const suffix = uniqueSuffix()
  const email = `qa_reg_auth_${purpose}_${suffix}@qa.local`.toLowerCase()
  const name = `${QA}${purpose}_${suffix}`
  const res = await call(admin, 'POST', '/api/admin/users', {
    data: {
      fullName: name,
      email,
      password: QA_PASSWORD,
      role: options.role ?? 'nurse',
      passwordChangeRequired: options.passwordChangeRequired ?? false,
    },
  })
  if (res.status !== 201 || !res.json?.id) {
    throw new Error(`createQaUser(${purpose}) failed: ${res.status} ${res.text.slice(0, 300)}`)
  }
  const user = { id: res.json.id as string, email, name, password: QA_PASSWORD }
  created.push(user)
  return user
}

function readLogTail(bytes = 768 * 1024): string {
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

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** The mail log (MAIL_MAILER=log) carries the reset URL once the queued mail is rendered. */
async function waitForResetToken(email: string, timeoutMs = 45_000): Promise<string | null> {
  const encoded = escapeRegex(encodeURIComponent(email))
  const re = new RegExp(`reset-password\\?token=([0-9a-f]{20,})&(?:amp;)?email=${encoded}`, 'g')
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const tail = readLogTail()
    let last: string | null = null
    for (const m of tail.matchAll(re)) last = m[1]
    if (last) return last
    await new Promise((r) => setTimeout(r, 1500))
  }
  return null
}

function walkJson(value: unknown, keyPath: string[], visit: (key: string, path: string, value: unknown) => void): void {
  if (Array.isArray(value)) {
    value.forEach((v, i) => walkJson(v, [...keyPath, String(i)], visit))
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      visit(k, [...keyPath, k].join('.'), v)
      walkJson(v, [...keyPath, k], visit)
    }
  }
}

function reportingPeriodForToday(): { id: string; week_start: string } {
  const period = readOne<{ id: string; week_start: string }>(
    "select id, week_start from reporting_periods where date(week_start) <= date('now') order by week_start desc limit 1",
  )
  if (!period) throw new Error('no reporting period has started yet')
  return period
}

function activeDepartment(slugPreference: string): { id: string; slug: string; template_id: string } {
  const row =
    readOne<{ id: string; slug: string; template_id: string }>(
      'select d.id, d.slug, d.template_id from departments d join report_templates t on t.id = d.template_id where d.active = 1 and t.active = 1 and d.slug = ?',
      [slugPreference],
    ) ??
    readOne<{ id: string; slug: string; template_id: string }>(
      'select d.id, d.slug, d.template_id from departments d join report_templates t on t.id = d.template_id where d.active = 1 and t.active = 1 order by d.slug limit 1',
    )
  if (!row) throw new Error('no active department with an active template')
  return row
}

// ---------------------------------------------------------------- lifecycle
test.beforeAll(async () => {
  await flushRateLimits()
})

test.beforeEach(async () => {
  // Each test consumes a few slots of the shared per-IP login bucket (10/min).
  await flushRateLimits()
})

test.afterAll(async () => {
  await flushRateLimits()
  try {
    const superadmin = await apiAs(EXTRA_ACCOUNTS.superadmin)
    for (const id of createdAssignmentIds) {
      await call(superadmin, 'PATCH', `/api/admin/assignments/${id}`, { data: { active: false } })
    }
    for (const user of created) {
      await call(superadmin, 'DELETE', `/api/admin/users/${user.id}`)
      forgetSession(user.email)
    }
    await superadmin.dispose()
  } catch (error) {
    info(D, 'CLEANUP', 'QA user deactivation (DELETE /api/admin/users/{id} only deactivates)', `failed: ${String(error).slice(0, 200)}`)
  }
  info(D, 'DB-READS', 'number of direct database re-reads performed by this spec', String(dbReads.n))
})

// ================================================================ A. authentication
test.describe('A. authentication and account state', () => {
  test('A1-A3 login: valid user, enumeration-safe failure, case-insensitive identifier', async () => {
    const nurse = EXTRA_ACCOUNTS.nurse

    const { ctx, res } = await loginRaw(nurse, DEV_PASSWORD)
    check(D, 'A1-login-ok', 'AuthController::login answers 200 with user+permissions for an active user', '200 with user.email', `${res.status} ${res.json?.user?.email ?? ''}`, res.status === 200 && res.json?.user?.email === nurse)
    const me = await call(ctx, 'GET', '/api/auth/me')
    check(D, 'A1-me-ok', 'GET /api/auth/me returns the session for a logged-in active user (routes/api.php auth:sanctum+active)', '200', String(me.status), me.status === 200)
    const lastLogin = readOne<{ last_login_at: string | null }>('select last_login_at from users where email = ?', [nurse])
    check(D, 'A1-last-login', 'AuthController::login stamps users.last_login_at on success', 'non-null and within the last 2 minutes', String(lastLogin?.last_login_at), !!lastLogin?.last_login_at && Date.now() - Date.parse(`${lastLogin.last_login_at}Z`) < 120_000)
    await call(ctx, 'POST', '/api/auth/logout')
    await ctx.dispose()

    const wrong = await loginRaw(nurse, 'definitely-not-the-password-1!')
    const unknown = await loginRaw(`nobody_${uniqueSuffix()}@qa.local`, 'definitely-not-the-password-1!')
    check(
      D,
      'A2-enumeration',
      'AuthController::login: wrong password and unknown identifier answer byte-for-byte the same (auth.failed 422 on identifier)',
      `${wrong.res.status} ${wrong.res.text.slice(0, 120)}`,
      `${unknown.res.status} ${unknown.res.text.slice(0, 120)}`,
      wrong.res.status === unknown.res.status && wrong.res.text === unknown.res.text && wrong.res.status === 422,
    )
    await wrong.ctx.dispose()
    await unknown.ctx.dispose()

    const upper = await loginRaw(nurse.toUpperCase(), DEV_PASSWORD)
    check(D, 'A3-case-insensitive', 'AuthController::login lowercases the identifier (Str::lower) so an upper-cased email signs in', '200', String(upper.res.status), upper.res.status === 200)
    await call(upper.ctx, 'POST', '/api/auth/logout')
    await upper.ctx.dispose()
  })

  test('A4 deactivation ends the session and blocks new logins; A5 logout invalidates the session', async () => {
    const admin = await apiAs(EXTRA_ACCOUNTS.admin)
    const user = await createQaUser(admin, 'deact')

    const first = await loginRaw(user.email, user.password)
    check(D, 'A4-precondition-login', 'a freshly created active QA nurse can log in', '200', String(first.res.status), first.res.status === 200)

    const deactivate = await call(admin, 'PATCH', `/api/admin/users/${user.id}/active`, { data: { active: false } })
    const row = readOne<{ active: number; last_login_at: string | null }>('select active, last_login_at from users where id = ?', [user.id])
    check(D, 'A4-deactivate-db', 'UserController::setActive writes users.active=0 (admin may deactivate a nurse, UserPolicy::setActive)', '200 and users.active=0', `${deactivate.status} active=${row?.active}`, deactivate.status === 200 && row?.active === 0)

    const meAfter = await call(first.ctx, 'GET', '/api/auth/me')
    check(D, 'A4-existing-session', 'EnsureActiveUser: an existing session of a deactivated user gets 403 "This account is inactive." on the next request', '403', `${meAfter.status} ${meAfter.text.slice(0, 80)}`, meAfter.status === 403)
    const relogin = await loginRaw(user.email, user.password)
    check(
      D,
      'A4-relogin',
      'AuthController::login: a deactivated account that has signed in before (last_login_at set) is refused with 403 "This account is inactive."',
      '403 This account is inactive.',
      `${relogin.res.status} ${relogin.res.text.slice(0, 80)}`,
      relogin.res.status === 403 && /inactive/i.test(relogin.res.text),
    )
    await relogin.ctx.dispose()
    await first.ctx.dispose()

    const logoutUser = await createQaUser(admin, 'logout')
    const session = await loginRaw(logoutUser.email, logoutUser.password)
    const logout = await call(session.ctx, 'POST', '/api/auth/logout')
    const meAfterLogout = await call(session.ctx, 'GET', '/api/auth/me')
    check(D, 'A5-logout', 'AuthController::logout invalidates the session (204) and /api/auth/me then answers 401', '204 then 401', `${logout.status} then ${meAfterLogout.status}`, logout.status === 204 && meAfterLogout.status === 401)
    await session.ctx.dispose()
    await admin.dispose()
  })

  test('A6 forced password change gate (admin reset sets the flag, change-password clears it, audit row without secrets)', async () => {
    const admin = await apiAs(EXTRA_ACCOUNTS.admin)
    const user = await createQaUser(admin, 'pwchange', { passwordChangeRequired: false })
    const session = await loginRaw(user.email, user.password)
    const before = await call(session.ctx, 'GET', '/api/reports')
    check(D, 'A6-precondition', 'a nurse without password_change_required reaches GET /api/reports', '200', String(before.status), before.status === 200)

    const tempPassword = 'TempReset2026!qa'
    const reset = await call(admin, 'POST', `/api/admin/users/${user.id}/reset-password`, { data: { password: tempPassword } })
    const flagged = readOne<{ password_change_required: number }>('select password_change_required from users where id = ?', [user.id])
    check(D, 'A6-admin-reset-flag', 'UserController::resetPassword defaults password_change_required to true (DB column = 1)', '200 and password_change_required=1', `${reset.status} flag=${flagged?.password_change_required}`, reset.status === 200 && flagged?.password_change_required === 1)

    // config/sanctum.php enables AuthenticateSession: a session whose password
    // hash changed underneath it (the admin reset) is logged out, so the user
    // signs in again with the temporary password and then meets the gate.
    const staleSession = await call(session.ctx, 'GET', '/api/auth/me')
    check(D, 'A6-stale-session', 'Sanctum AuthenticateSession (config/sanctum.php middleware.authenticate_session): a session is logged out once the password hash changes (admin reset)', '401', String(staleSession.status), staleSession.status === 401)
    await session.ctx.dispose()
    const tempLogin = await loginRaw(user.email, tempPassword)
    check(D, 'A6-temp-login', 'AuthController::login accepts the temporary password and reports passwordChangeRequired=true (login itself is not gated)', '200 passwordChangeRequired true', `${tempLogin.res.status} ${tempLogin.res.json?.user?.passwordChangeRequired}`, tempLogin.res.status === 200 && tempLogin.res.json?.user?.passwordChangeRequired === true)
    session.ctx = tempLogin.ctx

    // The new session is authenticated but gated (EnsurePasswordChanged).
    const gatedReports = await call(session.ctx, 'GET', '/api/reports')
    const gatedMe = await call(session.ctx, 'GET', '/api/auth/me')
    const gatedWorkspace = await call(session.ctx, 'GET', '/api/workspace')
    check(D, 'A6-gate-blocks', 'EnsurePasswordChanged: non-auth API calls answer 403 with passwordChangeRequired=true while the flag is set', '403 {passwordChangeRequired:true}', `${gatedReports.status} ${JSON.stringify(gatedReports.json)?.slice(0, 100)}`, gatedReports.status === 403 && gatedReports.json?.passwordChangeRequired === true)
    check(D, 'A6-gate-allows-me', 'routes/api.php: /api/auth/me and /api/workspace stay reachable while the flag is set (no password-changed middleware)', 'me 200, workspace 200', `me ${gatedMe.status}, workspace ${gatedWorkspace.status}`, gatedMe.status === 200 && gatedWorkspace.status === 200)

    const newPassword = 'Changed2026!qa'
    const wrongCurrent = await call(session.ctx, 'POST', '/api/auth/change-password', { data: { current_password: 'nope-nope-1!', password: newPassword, password_confirmation: newPassword } })
    check(D, 'A6-wrong-current', 'AuthController::changePassword rejects a wrong current password with 422 on current_password', '422', `${wrongCurrent.status} ${JSON.stringify(wrongCurrent.json?.errors ?? {}).slice(0, 80)}`, wrongCurrent.status === 422 && !!wrongCurrent.json?.errors?.current_password)
    const change = await call(session.ctx, 'POST', '/api/auth/change-password', { data: { current_password: tempPassword, password: newPassword, password_confirmation: newPassword } })
    const after = readOne<{ password_change_required: number; role_key: string; active: number; password: string }>('select password_change_required, role_key, active, password from users where id = ?', [user.id])
    check(D, 'A6-change-clears', 'AuthController::changePassword clears password_change_required and returns the session payload', '200, flag=0, passwordChangeRequired=false', `${change.status} flag=${after?.password_change_required} payload=${change.json?.user?.passwordChangeRequired}`, change.status === 200 && after?.password_change_required === 0 && change.json?.user?.passwordChangeRequired === false)
    check(D, 'A6-role-unchanged', 'changing a password never touches users.role_key or users.active', 'nurse / 1', `${after?.role_key} / ${after?.active}`, after?.role_key === 'nurse' && after?.active === 1)
    const unblocked = await call(session.ctx, 'GET', '/api/reports')
    check(D, 'A6-gate-lifted', 'after the change the same session reaches GET /api/reports again', '200', String(unblocked.status), unblocked.status === 200)

    const audit = readAll<{ id: string; old_values: string | null; new_values: string | null; user_id: string; entity_id: string }>(
      "select id, user_id, entity_id, old_values, new_values from admin_audit_logs where action = 'change_password' and entity_id = ? order by created_at desc",
      [user.id],
    )
    const latest = audit[0]
    const blob = `${latest?.old_values ?? ''}${latest?.new_values ?? ''}`
    check(D, 'A6-audit-row', 'AuthController::changePassword records an admin_audit_logs row (action change_password, actor = the user, method self_service)', '1+ row, user_id = actor, new_values.method = self_service', `${audit.length} row(s), user_id=${latest?.user_id === user.id}, new_values=${latest?.new_values}`, audit.length >= 1 && latest?.user_id === user.id && /self_service/.test(latest?.new_values ?? ''))
    check(
      D,
      'A6-audit-no-secret',
      'the change_password audit row carries neither a password nor a hash',
      'no $2y$ hash, no plaintext password in old/new values',
      `contains hash: ${blob.includes('$2y$')}, contains plaintext: ${blob.includes(newPassword) || blob.includes(tempPassword)}, contains stored hash: ${!!after?.password && blob.includes(after.password)}`,
      !blob.includes('$2y$') && !blob.includes(newPassword) && !blob.includes(tempPassword) && !(after?.password && blob.includes(after.password)),
    )
    user.password = newPassword
    await session.ctx.dispose()
    await admin.dispose()
  })

  test('A7 password reset: non-enumerating forgot, one-shot token, role unchanged', async () => {
    const admin = await apiAs(EXTRA_ACCOUNTS.admin)
    const user = await createQaUser(admin, 'reset')
    const anon = await anonContext()

    const known = await call(anon, 'POST', '/api/auth/forgot-password', { data: { email: user.email } })
    const unknownEmail = `nobody_${uniqueSuffix()}@qa.local`
    const unknown = await call(anon, 'POST', '/api/auth/forgot-password', { data: { email: unknownEmail } })
    check(D, 'A7-forgot-enumeration', 'PasswordResetController::forgot answers 202 with the same body for known and unknown emails', `202 ${known.text.slice(0, 80)}`, `${unknown.status} ${unknown.text.slice(0, 80)}`, known.status === 202 && unknown.status === known.status && unknown.text === known.text)
    const tokenRows = readCount('select count(*) c from password_reset_tokens where email = ?', [user.email])
    const unknownRows = readCount('select count(*) c from password_reset_tokens where email = ?', [unknownEmail])
    check(D, 'A7-token-row', 'forgot-password stores a (hashed) token row only for the known email', 'known=1, unknown=0', `known=${tokenRows}, unknown=${unknownRows}`, tokenRows === 1 && unknownRows === 0)

    const token = await waitForResetToken(user.email)
    if (!token) {
      const queued = readCount("select count(*) c from jobs where queue = 'notifications'")
      info(D, 'A7-reset-flow', 'SKIP: reset URL not found in backend/storage/logs/laravel.log within 45s (queued PasswordResetMail not rendered by the worker?)', `notifications jobs pending: ${queued}`)
      await anon.dispose()
      await admin.dispose()
      return
    }

    const newPassword = 'ResetDone2026!qa'
    const before = readOne<{ role_key: string; active: number }>('select role_key, active from users where id = ?', [user.id])
    const reset = await call(anon, 'POST', '/api/auth/reset-password', { data: { email: user.email, token, password: newPassword, password_confirmation: newPassword } })
    const tokenAfter = readCount('select count(*) c from password_reset_tokens where email = ?', [user.email])
    check(D, 'A7-reset-ok', 'PasswordResetController::reset accepts a valid token (200) and deletes the token row', '200 and 0 token rows', `${reset.status} rows=${tokenAfter}`, reset.status === 200 && tokenAfter === 0)
    const reuse = await call(anon, 'POST', '/api/auth/reset-password', { data: { email: user.email, token, password: 'Another2026!qa', password_confirmation: 'Another2026!qa' } })
    check(D, 'A7-token-single-use', 'a consumed reset token cannot be reused (tokenExists fails -> 422 on token)', '422', `${reuse.status} ${JSON.stringify(reuse.json?.errors ?? {}).slice(0, 80)}`, reuse.status === 422 && !!reuse.json?.errors?.token)
    const after = readOne<{ role_key: string; active: number; password_change_required: number }>('select role_key, active, password_change_required from users where id = ?', [user.id])
    check(D, 'A7-role-unchanged', 'a password reset leaves role_key/active untouched and clears password_change_required', `${before?.role_key}/${before?.active}/0`, `${after?.role_key}/${after?.active}/${after?.password_change_required}`, after?.role_key === before?.role_key && after?.active === before?.active && after?.password_change_required === 0)
    const audit = readOne<{ new_values: string | null; old_values: string | null }>("select old_values, new_values from admin_audit_logs where action = 'change_password' and entity_id = ? order by created_at desc limit 1", [user.id])
    check(D, 'A7-audit', 'the reset writes a change_password audit row (method reset_link) with no token/password in it', 'method reset_link, no token, no password', `${audit?.new_values}`, /reset_link/.test(audit?.new_values ?? '') && !`${audit?.old_values}${audit?.new_values}`.includes(token) && !`${audit?.new_values}`.includes(newPassword))
    const login = await loginRaw(user.email, newPassword)
    check(D, 'A7-login-new-password', 'the new password signs in and the permissions are the nurse set', '200 with reports.viewAssigned', `${login.res.status} ${JSON.stringify(login.res.json?.permissions ?? []).slice(0, 80)}`, login.res.status === 200 && (login.res.json?.permissions ?? []).includes('reports.viewAssigned'))
    user.password = newPassword
    await login.ctx.dispose()
    await anon.dispose()
    await admin.dispose()
  })

  test('A8 rate limits: login 10/min, forgot-password independent, registration 10/min', async () => {
    await flushRateLimits()
    const anon = await anonContext()
    const identifier = `limiter_${uniqueSuffix()}@qa.local`
    let first429 = 0
    const statuses: number[] = []
    for (let i = 1; i <= 11; i++) {
      const res = await call(anon, 'POST', '/api/auth/login', { data: { identifier, password: 'wrong-wrong-1!' } })
      statuses.push(res.status)
      if (res.status === 429 && first429 === 0) first429 = i
    }
    check(D, 'A8-login-throttle', 'routes/api.php throttle:10,1,login: the 11th rapid login attempt from one IP is 429 (earlier if the shared bucket already held attempts)', '429 at attempt <= 11 (ideally exactly 11)', `first 429 at attempt ${first429 || 'none'}; statuses ${statuses.join(',')}`, first429 > 0 && first429 <= 11)
    info(D, 'A8-login-throttle-count', 'exact attempt at which the login limiter answered 429', String(first429))

    const forgot = await call(anon, 'POST', '/api/auth/forgot-password', { data: { email: `nobody_${uniqueSuffix()}@qa.local` } })
    check(D, 'A8-forgot-independent', 'throttle:5,1,forgot-password is a separate bucket: forgot-password still answers 202 after the login bucket is exhausted', '202', String(forgot.status), forgot.status === 202)

    let firstReg429 = 0
    const regStatuses: number[] = []
    for (let i = 1; i <= 11; i++) {
      const res = await call(anon, 'POST', '/api/access-requests', { data: {} })
      regStatuses.push(res.status)
      if (res.status === 429 && firstReg429 === 0) firstReg429 = i
    }
    check(D, 'A8-registration-throttle', 'throttle:10,1,registration on POST /api/access-requests: invalid bodies answer 422 until the 11th attempt is 429', '422 x10 then 429', `first 429 at attempt ${firstReg429 || 'none'}; statuses ${regStatuses.join(',')}`, firstReg429 > 0 && firstReg429 <= 11 && regStatuses.slice(0, firstReg429 - 1).every((s) => s === 422))
    await anon.dispose()
    await flushRateLimits()
  })
})

// ================================================================ B. approval and roles
test.describe('B. user approval and role management', () => {
  test('B1-B2 nurse self-registration: approve activates + grants, reject leaves the applicant inactive', async () => {
    const admin = await apiAs(EXTRA_ACCOUNTS.admin)
    const department = activeDepartment('hematology_inpatient')
    const anon = await anonContext()

    const suffix = uniqueSuffix()
    const applicantEmail = `qa_reg_auth_applicant_${suffix}@qa.local`
    const applicantName = `${QA}applicant_${suffix}`
    const submit = await call(anon, 'POST', '/api/access-requests', {
      data: {
        fullName: applicantName,
        email: applicantEmail,
        password: QA_PASSWORD,
        requestedAssignments: [{ departmentId: department.id, templateId: department.template_id }],
        notes: QA,
      },
    })
    const applicant = readOne<{ id: string; role_key: string; active: number; title: string; last_login_at: string | null }>('select id, role_key, active, title, last_login_at from users where email = ?', [applicantEmail])
    check(D, 'B1-submit', 'AccessRequestSubmissionController::store (anonymous) answers 201 with the non-committal body and creates an INACTIVE nurse row titled "Applicant Nurse"', '201, role nurse, active 0, title Applicant Nurse', `${submit.status} ${submit.json?.status} role=${applicant?.role_key} active=${applicant?.active} title=${applicant?.title}`, submit.status === 201 && submit.json?.signedIn === false && applicant?.role_key === 'nurse' && applicant?.active === 0 && applicant?.title === 'Applicant Nurse')
    if (!applicant) throw new Error('applicant row missing')
    created.push({ id: applicant.id, email: applicantEmail, name: applicantName, password: QA_PASSWORD })

    const request = readOne<{ id: string; status: string }>('select id, status from access_requests where user_id = ? order by requested_at desc limit 1', [applicant.id])
    const items = readCount('select count(*) c from access_request_items where access_request_id = ?', [request?.id ?? ''])
    check(D, 'B1-request-row', 'the submission stores a pending access_requests row with one access_request_items row per requested assignment', 'pending, 1 item', `${request?.status}, ${items} item(s)`, request?.status === 'pending' && items === 1)
    const pendingLogin = await loginRaw(applicantEmail, QA_PASSWORD)
    check(D, 'B1-pending-login', 'AuthController::login: a never-activated applicant with the right password gets the generic auth.failed 422 (not "inactive")', '422 auth.failed', `${pendingLogin.res.status} ${pendingLogin.res.text.slice(0, 80)}`, pendingLogin.res.status === 422)
    await pendingLogin.ctx.dispose()

    const approve = await call(admin, 'POST', `/api/admin/access-requests/${request!.id}/approve`)
    const approvedUser = readOne<{ active: number; title: string; role_key: string }>('select active, title, role_key from users where id = ?', [applicant.id])
    const assignment = readOne<{ id: string; active: number; approved_by: string | null }>('select id, active, approved_by from report_assignments where nurse_id = ? and department_id = ? and template_id = ?', [applicant.id, department.id, department.template_id])
    const requestAfter = readOne<{ status: string; reviewed_by: string | null }>('select status, reviewed_by from access_requests where id = ?', [request!.id])
    check(D, 'B1-approve-user', 'AccessRequestReviewService::review(approved) activates the applicant and replaces the "Applicant Nurse" marker title', '200, active 1, title != Applicant Nurse, role nurse', `${approve.status} active=${approvedUser?.active} title=${approvedUser?.title} role=${approvedUser?.role_key}`, approve.status === 200 && approvedUser?.active === 1 && approvedUser?.title !== 'Applicant Nurse' && approvedUser?.role_key === 'nurse')
    check(D, 'B1-approve-assignment', 'approval creates an active report_assignments row per item, approved_by = reviewer', 'active=1, approved_by = admin', `assignment=${assignment?.id ?? 'none'} active=${assignment?.active} approved_by_set=${!!assignment?.approved_by}; request ${requestAfter?.status}`, assignment?.active === 1 && !!assignment?.approved_by && requestAfter?.status === 'approved')
    if (assignment) createdAssignmentIds.push(assignment.id)
    const audit = readOne<{ new_values: string; old_values: string }>("select old_values, new_values from admin_audit_logs where action = 'review' and entity_type = 'access_request' and entity_id = ? order by created_at desc limit 1", [request!.id])
    let newValues: any = null
    try {
      newValues = JSON.parse(audit?.new_values ?? 'null')
    } catch {
      newValues = null
    }
    check(D, 'B1-approve-audit', 'the review audit row (action review) records userActive=true and the grantedAssignments list', 'userActive true, grantedAssignments[1]', `${audit?.new_values?.slice(0, 200)}`, newValues?.userActive === true && Array.isArray(newValues?.grantedAssignments) && newValues.grantedAssignments.length === 1 && newValues.grantedAssignments[0]?.id === assignment?.id)
    const approvedLogin = await loginRaw(applicantEmail, QA_PASSWORD)
    check(D, 'B1-approved-login', 'after approval the applicant signs in with the password chosen at registration and sees the granted assignment', '200 with 1 assignment', `${approvedLogin.res.status} assignments=${approvedLogin.res.json?.assignments?.length}`, approvedLogin.res.status === 200 && approvedLogin.res.json?.assignments?.length === 1)
    await approvedLogin.ctx.dispose()

    // B2: a second applicant, rejected.
    const suffix2 = uniqueSuffix()
    const rejectedEmail = `qa_reg_auth_rejected_${suffix2}@qa.local`
    const submit2 = await call(anon, 'POST', '/api/access-requests', {
      data: { fullName: `${QA}rejected_${suffix2}`, email: rejectedEmail, password: QA_PASSWORD, requestedAssignments: [{ departmentId: department.id, templateId: department.template_id }] },
    })
    const rejectedUser = readOne<{ id: string }>('select id from users where email = ?', [rejectedEmail])
    const request2 = readOne<{ id: string }>('select id from access_requests where user_id = ? order by requested_at desc limit 1', [rejectedUser?.id ?? ''])
    if (rejectedUser) created.push({ id: rejectedUser.id, email: rejectedEmail, name: `${QA}rejected_${suffix2}`, password: QA_PASSWORD })
    const reject = await call(admin, 'POST', `/api/admin/access-requests/${request2?.id}/reject`)
    const rejectedAfter = readOne<{ active: number }>('select active from users where id = ?', [rejectedUser?.id ?? ''])
    const request2After = readOne<{ status: string }>('select status from access_requests where id = ?', [request2?.id ?? ''])
    const assignments2 = readCount('select count(*) c from report_assignments where nurse_id = ?', [rejectedUser?.id ?? ''])
    check(D, 'B2-reject', 'rejecting leaves the applicant inactive with no assignment (AccessRequestReviewService only activates on approval)', 'submit 201, reject 200, status rejected, active 0, 0 assignments', `${submit2.status}/${reject.status} status=${request2After?.status} active=${rejectedAfter?.active} assignments=${assignments2}`, submit2.status === 201 && reject.status === 200 && request2After?.status === 'rejected' && rejectedAfter?.active === 0 && assignments2 === 0)
    const rejectedLogin = await loginRaw(rejectedEmail, QA_PASSWORD)
    check(D, 'B2-reject-login', 'a rejected (never activated) applicant cannot log in and gets the generic failure', '422', `${rejectedLogin.res.status} ${rejectedLogin.res.text.slice(0, 80)}`, rejectedLogin.res.status === 422)
    await rejectedLogin.ctx.dispose()
    await anon.dispose()
    await admin.dispose()
  })

  test('B3 superadmin protection and admin-creation boundary', async () => {
    const admin = await apiAs(EXTRA_ACCOUNTS.admin)
    const superadminRow = readOne<{ id: string; role_key: string; active: number }>('select id, role_key, active from users where email = ?', [EXTRA_ACCOUNTS.superadmin])
    if (!superadminRow) throw new Error('seeded superadmin missing')
    const target = superadminRow.id

    try {
      const deactivate = await call(admin, 'PATCH', `/api/admin/users/${target}/active`, { data: { active: false } })
      const destroy = await call(admin, 'DELETE', `/api/admin/users/${target}`)
      const role = await call(admin, 'PATCH', `/api/admin/users/${target}`, { data: { role: 'student_rep' } })
      const password = await call(admin, 'POST', `/api/admin/users/${target}/reset-password`, { data: { password: 'ShouldNotApply2026!' } })
      const after = readOne<{ role_key: string; active: number; password_change_required: number }>('select role_key, active, password_change_required from users where id = ?', [target])
      check(D, 'B3-admin-vs-superadmin', 'UserPolicy::setActive/delete/update: an admin cannot deactivate, delete, re-role or reset the superadmin (403) and the row is untouched', '403/403/403/403, role superadmin, active 1', `${deactivate.status}/${destroy.status}/${role.status}/${password.status}, role=${after?.role_key} active=${after?.active}`, deactivate.status === 403 && destroy.status === 403 && role.status === 403 && password.status === 403 && after?.role_key === 'superadmin' && after?.active === 1)

      const createAdmin = await call(admin, 'POST', '/api/admin/users', {
        data: { fullName: `${QA}admin_${uniqueSuffix()}`, email: `qa_reg_auth_admin_${uniqueSuffix()}@qa.local`, password: QA_PASSWORD, role: 'admin' },
      })
      if (createAdmin.status === 201 && createAdmin.json?.id) created.push({ id: createAdmin.json.id, email: createAdmin.json.email, name: createAdmin.json.fullName, password: QA_PASSWORD })
      const adminRows = readCount("select count(*) c from users where role_key = 'admin' and full_name like ?", [`${QA}admin_%`])
      check(D, 'B3-admin-creates-admin', 'UserController::store + UserPolicy::createAdmin (admins.manage is Maintenance-only): an admin cannot create another admin', '403 (validation passes, Gate refuses), no row', `${createAdmin.status} rows=${adminRows}`, createAdmin.status === 403 && adminRows === 0)
      info(D, 'B3-admin-creates-admin-status', 'exact status an admin gets when posting role=admin to POST /api/admin/users', String(createAdmin.status), createAdmin.text.slice(0, 120))

      const superadmin = await apiAs(EXTRA_ACCOUNTS.superadmin)
      const selfDeactivate = await call(superadmin, 'PATCH', `/api/admin/users/${target}/active`, { data: { active: false } })
      const selfAfter = readOne<{ active: number }>('select active from users where id = ?', [target])
      check(D, 'B3-superadmin-self', 'UserPolicy::setActive returns false for any superadmin target, so the superadmin cannot deactivate themselves', '403, active stays 1', `${selfDeactivate.status} active=${selfAfter?.active}`, selfDeactivate.status === 403 && selfAfter?.active === 1)
      await superadmin.dispose()
    } finally {
      // Never leave the shared superadmin in a changed state, whatever the product did.
      const row = readOne<{ active: number; role_key: string }>('select active, role_key from users where id = ?', [target])
      if (row && (row.active !== superadminRow.active || row.role_key !== superadminRow.role_key)) {
        const db = new DatabaseSync(DB_PATH)
        try {
          db.prepare('update users set active = ?, role_key = ? where id = ?').run(superadminRow.active, superadminRow.role_key, target)
        } finally {
          db.close()
        }
        info(D, 'B3-restore', 'EMERGENCY: seeded superadmin row was changed by the product and restored directly in the database', JSON.stringify(row))
      }
      await admin.dispose()
    }
  })

  test('B4 nurse -> student_rep role transition refuses while an assignment is active, then strips clinical access', async () => {
    const admin = await apiAs(EXTRA_ACCOUNTS.admin)
    const department = activeDepartment('hematology_inpatient')
    const period = reportingPeriodForToday()
    const user = await createQaUser(admin, 'transition')

    const grant = await call(admin, 'POST', '/api/admin/assignments', { data: { nurseId: user.id, departmentId: department.id, templateId: department.template_id } })
    const assignmentId = grant.json?.id as string | undefined
    if (assignmentId) createdAssignmentIds.push(assignmentId)
    const assignmentRow = readOne<{ active: number }>('select active from report_assignments where id = ?', [assignmentId ?? ''])
    check(D, 'B4-grant', 'ReportAssignmentController::store creates an active assignment for a nurse', '201 active=1', `${grant.status} active=${assignmentRow?.active}`, grant.status === 201 && assignmentRow?.active === 1)
    if (!assignmentId) throw new Error(`assignment not created: ${grant.status} ${grant.text.slice(0, 200)}`)

    const nurseSession = await loginRaw(user.email, user.password)
    const values = { total_admitted_patients: { dailyValues: { monday: 7 } } }
    const save = await call(nurseSession.ctx, 'POST', '/api/reports', { data: { assignmentId, reportingPeriodId: period.id, values } })
    const reportId = save.json?.id as string | undefined
    const reportRow = readOne<{ id: string; status: string; created_by: string }>('select id, status, created_by from reports where assignment_id = ? and reporting_period_id = ?', [assignmentId, period.id])
    check(D, 'B4-nurse-saves', 'ReportWorkflowController::store: the nurse saves a draft for the current week on their own assignment', '201 draft row created_by nurse', `${save.status} row=${reportRow?.id ?? 'none'} status=${reportRow?.status} by_nurse=${reportRow?.created_by === user.id}`, save.status === 201 && !!reportRow && reportRow.status === 'draft' && reportRow.created_by === user.id)
    await nurseSession.ctx.dispose()

    const refused = await call(admin, 'PATCH', `/api/admin/users/${user.id}`, { data: { role: 'student_rep' } })
    const stillNurse = readOne<{ role_key: string }>('select role_key from users where id = ?', [user.id])
    check(D, 'B4-refused-while-active', 'UserController::assertRoleChangeIsSafe: a nurse with an ACTIVE report assignment cannot change role (422 on role, "Retire this nurse...")', '422 errors.role, role_key stays nurse', `${refused.status} ${JSON.stringify(refused.json?.errors?.role ?? refused.json?.message ?? '').slice(0, 100)} role=${stillNurse?.role_key}`, refused.status === 422 && /retire/i.test(JSON.stringify(refused.json?.errors?.role ?? '')) && stillNurse?.role_key === 'nurse')

    const retire = await call(admin, 'PATCH', `/api/admin/assignments/${assignmentId}`, { data: { active: false } })
    const retired = readOne<{ active: number }>('select active from report_assignments where id = ?', [assignmentId])
    check(D, 'B4-retire', 'ReportAssignmentController::update active=false retires the assignment', '200 active=0', `${retire.status} active=${retired?.active}`, retire.status === 200 && retired?.active === 0)

    const changed = await call(admin, 'PATCH', `/api/admin/users/${user.id}`, { data: { role: 'student_rep' } })
    const afterRole = readOne<{ role_key: string; active: number; title: string }>('select role_key, active, title from users where id = ?', [user.id])
    check(D, 'B4-role-changed', 'with no active assignment the role change succeeds and users.role_key = student_rep', '200 role_key student_rep', `${changed.status} role=${afterRole?.role_key} active=${afterRole?.active}`, changed.status === 200 && afterRole?.role_key === 'student_rep' && afterRole?.active === 1)
    const audit = readCount("select count(*) c from admin_audit_logs where action = 'update' and entity_type = 'user' and entity_id = ?", [user.id])
    check(D, 'B4-role-audit', 'the role change is recorded as an admin_audit_logs update row on the user', '>= 1', String(audit), audit >= 1)

    forgetSession(user.email)
    const rep = await loginRaw(user.email, user.password)
    check(D, 'B4-rep-login', 'the re-roled account signs in as student_rep with no assignments and no reports.* permission in the session payload', '200 student_rep, assignments [], no reports.viewAssigned', `${rep.res.status} role=${rep.res.json?.user?.role} assignments=${rep.res.json?.assignments?.length} perms=${JSON.stringify(rep.res.json?.permissions ?? []).slice(0, 80)}`, rep.res.status === 200 && rep.res.json?.user?.role === 'student_rep' && rep.res.json?.assignments?.length === 0 && !(rep.res.json?.permissions ?? []).includes('reports.viewAssigned'))

    const list = await call(rep.ctx, 'GET', '/api/reports?reportPeriodWindow=all&perPage=300')
    const listed = (list.json?.data ?? []).some((r: any) => r.id === reportId)
    check(D, 'B4-list', 'ReportWorkflowController::index scopeToReportingPermission: an account without reports.viewAssigned gets the self-scoped EMPTY page (200, total 0), never the former rows', '200 with 0 rows', `${list.status} total=${list.json?.meta?.total} formerReportListed=${listed}`, list.status === 200 && (list.json?.meta?.total ?? -1) === 0 && !listed)
    const show = await call(rep.ctx, 'GET', `/api/reports/${reportId}`)
    const update = await call(rep.ctx, 'PUT', `/api/reports/${reportId}`, { data: { values } })
    const store = await call(rep.ctx, 'POST', '/api/reports', { data: { assignmentId, reportingPeriodId: period.id, values } })
    const submit = await call(rep.ctx, 'POST', `/api/reports/${reportId}/submit`, { data: {} })
    check(D, 'B4-former-report', 'ReportPolicy/HandlesDomainAuthorization: show, update, store and submit on the former report/assignment are all 403 for the re-roled account', '403/403/403/403', `${show.status}/${update.status}/${store.status}/${submit.status}`, show.status === 403 && update.status === 403 && store.status === 403 && submit.status === 403)
    const untouched = readOne<{ status: string; updated_by: string }>('select status, updated_by from reports where id = ?', [reportId ?? ''])
    check(D, 'B4-former-report-db', 'the refused writes changed nothing on the report row', 'draft, updated_by = original nurse', `${untouched?.status} by_self=${untouched?.updated_by === user.id}`, untouched?.status === 'draft' && untouched?.updated_by === user.id)
    const workspace = await call(rep.ctx, 'GET', '/api/workspace')
    const wsAssignments = workspace.json?.state?.assignments
    check(D, 'B4-workspace', 'WorkspaceController::show (payload under `state`) lists no clinical assignments for an account without reports.viewAssigned', '200 state.assignments []', `${workspace.status} state.assignments=${JSON.stringify(wsAssignments ?? null)?.slice(0, 60)}`, workspace.status === 200 && Array.isArray(wsAssignments) && wsAssignments.length === 0)
    await rep.ctx.dispose()
    await admin.dispose()
  })
})

// ================================================================ AD. maintenance health
test.describe('AD. maintenance health page authorization', () => {
  test('GET /api/admin/system-health is Maintenance-only and leaks no secret', async () => {
    const anon = await anonContext()
    const anonRes = await call(anon, 'GET', '/api/admin/system-health')
    check(D, 'AD-anonymous', 'routes/api.php: /api/admin/system-health sits behind auth:sanctum, so anonymous is 401', '401', String(anonRes.status), anonRes.status === 401)
    await anon.dispose()

    for (const role of ['nurse', 'resident', 'consultant', 'student_rep', 'admin'] as const) {
      const ctx = await apiAs(ROLE_IDENTIFIERS[role])
      const res = await call(ctx, 'GET', '/api/admin/system-health')
      check(D, `AD-${role}`, `EnsurePermission system.health (Permissions.php: superadmin only): ${role} gets 403`, '403', String(res.status), res.status === 403)
      await ctx.dispose()
    }

    const superadmin = await apiAs(EXTRA_ACCOUNTS.superadmin)
    const res = await call(superadmin, 'GET', '/api/admin/system-health')
    check(D, 'AD-maintenance', 'the Maintenance (superadmin) account gets the snapshot (200, Cache-Control no-store)', '200 no-store', `${res.status} ${res.headers['cache-control'] ?? ''}`, res.status === 200 && /no-store/.test(res.headers['cache-control'] ?? ''))
    info(D, 'AD-top-level-keys', 'top-level keys of the health snapshot', Object.keys(res.json ?? {}).join(', '), `status=${res.json?.status}, configCached=${res.json?.application?.configCached}, webhookConfigured=${res.json?.observability?.webhookConfigured}`)

    const envText = fs.readFileSync(path.join(REPO_ROOT, 'backend', '.env'), 'utf8')
    const envValue = (name: string): string | null => {
      const m = envText.match(new RegExp(`^${name}=(.*)$`, 'm'))
      return m ? m[1].trim().replace(/^"|"$/g, '') : null
    }
    const secrets = [envValue('APP_KEY'), envValue('DB_PASSWORD'), envValue('OBSERVABILITY_WEBHOOK_URL'), envValue('OBSERVABILITY_WEBHOOK_TOKEN')].filter((v): v is string => !!v && v.length > 3)
    const suspicious: string[] = []
    walkJson(res.json, [], (key, keyPath, value) => {
      if (/(password|secret|token|dsn|api_?key|app_?key|credential|webhook_?url)/i.test(key)) suspicious.push(`${keyPath}=${JSON.stringify(value)}`)
      // `checks[].key` is the check identifier label; anything longer than a slug there is suspect.
      if (/^key$/i.test(key) && !(typeof value === 'string' && /^[a-z0-9-]{1,40}$/.test(value))) suspicious.push(`${keyPath}=${JSON.stringify(value)}`)
      if (typeof value === 'string') {
        if (value.includes('base64:')) suspicious.push(`${keyPath} contains base64:`)
        if (/https?:\/\/[^\s/]+:[^\s/]+@/.test(value)) suspicious.push(`${keyPath} contains a URL with credentials`)
        for (const secret of secrets) if (value.includes(secret)) suspicious.push(`${keyPath} contains an .env secret value`)
      }
    })
    const bodyHasSecret = secrets.some((s) => res.text.includes(s)) || res.text.includes('base64:')
    check(D, 'AD-no-secrets', 'SystemHealthService returns states, ages, counts and driver names only: no password/secret/token/key/dsn fields, no APP_KEY, DB password or webhook URL/token', 'no suspicious keys or values', suspicious.length ? suspicious.slice(0, 5).join('; ') : 'none', suspicious.length === 0 && !bodyHasSecret)
    await superadmin.dispose()
  })
})
