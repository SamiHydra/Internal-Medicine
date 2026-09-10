#!/usr/bin/env node
/**
 * Business-logic differential: the same requests against the pre-hardening
 * baseline (b07b32c) and the hardening tree, each running on its own copy of
 * the same database snapshot, and a side-by-side table of the answers.
 *
 * The goal is not byte-identical responses; it is to list every behavioural
 * difference so each one can be classified as intended (a hardening change)
 * or unexpected (a regression). See BUSINESS_LOGIC_REGRESSION_REPORT.md.
 *
 *   node scripts/regression/differential.mjs \
 *     --base http://127.0.0.1:8001 --base-db /abs/base.sqlite \
 *     --target http://127.0.0.1:8002 --target-db /abs/target.sqlite \
 *     [--out output/regression/differential.md]
 *
 * Both servers must be `php artisan serve` instances (any port) whose
 * DB_DATABASE points at the copies. Origin/Referer are sent as the SPA's
 * origin so Sanctum treats the calls as stateful.
 */
import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => {
    if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1]])
    return acc
  }, []),
)
const ORIGIN = 'http://localhost:5173'
const PASSWORD = 'StPaul2026!'
const SUFFIX = `${Date.now().toString(36)}`
const ACCOUNTS = {
  superadmin: 'admin@stpaulos.local',
  admin: 'admin.alem.woldemariam@stpaulos.local',
  nurse: 'abel.gemechu@stpaulhospital.demo',
  rep: 'student.rep.group@stpaulos.local',
}

class Client {
  constructor(base) {
    this.base = base.replace(/\/+$/, '')
    this.jar = new Map()
  }
  cookieHeader() {
    return Array.from(this.jar.entries()).map(([k, v]) => `${k}=${v}`).join('; ')
  }
  absorb(res) {
    const setCookies = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : []
    for (const line of setCookies) {
      const [pair] = line.split(';')
      const idx = pair.indexOf('=')
      if (idx > 0) this.jar.set(pair.slice(0, idx).trim(), pair.slice(idx + 1).trim())
    }
  }
  async request(method, url, body, extraHeaders = {}) {
    const headers = {
      Accept: 'application/json',
      'X-Requested-With': 'XMLHttpRequest',
      Origin: ORIGIN,
      Referer: `${ORIGIN}/`,
      Cookie: this.cookieHeader(),
      ...extraHeaders,
    }
    const xsrf = this.jar.get('XSRF-TOKEN')
    if (xsrf && method !== 'GET') headers['X-XSRF-TOKEN'] = decodeURIComponent(xsrf)
    let payload
    if (body instanceof FormData) payload = body
    else if (body !== undefined) {
      headers['Content-Type'] = 'application/json'
      payload = JSON.stringify(body)
    }
    const res = await fetch(this.base + url, { method, headers, body: payload, redirect: 'manual' })
    this.absorb(res)
    const text = await res.text()
    let json = null
    try {
      json = text ? JSON.parse(text) : null
    } catch {
      json = null
    }
    return { status: res.status, json, text }
  }
  async csrf() {
    await this.request('GET', '/sanctum/csrf-cookie')
  }
  async login(identifier, password = PASSWORD) {
    await this.csrf()
    for (let attempt = 0; attempt < 4; attempt++) {
      const res = await this.request('POST', '/api/auth/login', { identifier, password })
      if (res.status !== 429) return res
      // The local-only reset route empties the shared limiter buckets; then wait a little.
      await this.request('POST', '/api/testing/flush-rate-limits', {})
      await new Promise((resolve) => setTimeout(resolve, 3000))
    }
    return this.request('POST', '/api/auth/login', { identifier, password })
  }
  async flushLimits() {
    await this.csrf()
    await this.request('POST', '/api/testing/flush-rate-limits', {})
  }
}

function q(dbPath, sql, params = []) {
  const db = new DatabaseSync(dbPath, { readOnly: true })
  try {
    return db.prepare(sql).all(...params.map((p) => (p === undefined ? null : p)))
  } finally {
    db.close()
  }
}
const count = (dbPath, sql, params = []) => Number(q(dbPath, sql, params)[0]?.c ?? 0)

/** Run the workflow suite against one side; returns an ordered list of observations. */
async function runSide(label, base, dbPath) {
  const out = []
  const note = (id, name, value, detail = '') => out.push({ id, name, value: String(value), detail })
  const admin = new Client(base)
  const nurse = new Client(base)
  const rep = new Client(base)
  const anon = new Client(base)

  await anon.flushLimits()
  // W01 login
  let r = await admin.login(ACCOUNTS.superadmin)
  note('W01', 'login valid (maintenance)', r.status)
  await anon.csrf()
  const wrong = await anon.request('POST', '/api/auth/login', { identifier: ACCOUNTS.nurse, password: 'not-the-password' })
  const unknown = await anon.request('POST', '/api/auth/login', { identifier: `nobody.${SUFFIX}@example.test`, password: 'not-the-password' })
  note('W02', 'login wrong password vs unknown identifier: same status and message', `${wrong.status}/${unknown.status} same=${wrong.status === unknown.status && (wrong.json?.message ?? '') === (unknown.json?.message ?? '')}`, wrong.json?.message ?? '')
  r = await admin.request('GET', '/api/auth/me')
  const perms = r.json?.user?.permissions ?? r.json?.permissions ?? []
  note('W03', 'me (maintenance) status and permission count', `${r.status} perms=${perms.length}`)

  // W04 nurse workspace
  r = await nurse.login(ACCOUNTS.nurse)
  r = await nurse.request('GET', '/api/workspace')
  note('W04', 'workspace (nurse): status and top-level keys', `${r.status} ${Object.keys(r.json ?? {}).sort().join(',')}`)

  // W05 QA nurse + assignment
  const email = `qa.diff.${SUFFIX}@stpaulos.local`
  r = await admin.request('POST', '/api/admin/users', {
    fullName: `QA_DIFF ${SUFFIX}`,
    email,
    password: PASSWORD,
    role: 'nurse',
    active: true,
    // An admin-created account normally must change its password first; the
    // differential exercises the report flow, not that gate.
    passwordChangeRequired: false,
  })
  const qaNurseId = r.json?.id ?? r.json?.user?.id ?? r.json?.data?.id
  note('W05a', 'create QA nurse', `${r.status} id=${qaNurseId ? 'yes' : 'no'}`, qaNurseId ? '' : (r.text ?? '').slice(0, 160))
  r = await admin.request('POST', '/api/admin/assignments', {
    nurseId: qaNurseId,
    departmentId: 'gi_neuro_inpatient',
    templateId: 'inpatient_weekly',
  })
  const assignmentId = r.json?.id ?? r.json?.data?.id
  note('W05b', 'create assignment (inpatient_weekly / gi_neuro_inpatient)', `${r.status} id=${assignmentId ? 'yes' : 'no'}`, assignmentId ? '' : (r.text ?? '').slice(0, 160))
  const dup = await admin.request('POST', '/api/admin/assignments', {
    nurseId: qaNurseId,
    departmentId: 'gi_neuro_inpatient',
    templateId: 'inpatient_weekly',
  })
  note('W05c', 'duplicate assignment', `${dup.status}`, (dup.json?.message ?? '').slice(0, 100))

  const qa = new Client(base)
  r = await qa.login(email)
  note('W06a', 'QA nurse login', r.status)
  const period = q(dbPath, "select id from reporting_periods where week_start<=date('now') order by week_start desc limit 1")[0]?.id
  const future = q(dbPath, "select id from reporting_periods where week_start>date('now','+14 days') order by week_start limit 1")[0]?.id
  const values = (a, b, c) => ({
    total_admitted_patients: { fieldId: 'total_admitted_patients', dailyValues: { monday: a } },
    new_admitted_patients: { fieldId: 'new_admitted_patients', dailyValues: { monday: b } },
    new_deaths: { fieldId: 'new_deaths', dailyValues: { monday: c } },
  })
  r = await qa.request('POST', '/api/reports', { assignmentId, reportingPeriodId: period, values: values(30, 4, 0) })
  const reportId = r.json?.id
  const updatedAt = r.json?.updatedAt
  note('W06b', 'save draft (POST /api/reports)', `${r.status} status=${r.json?.status ?? '-'}`, reportId ? '' : (r.text ?? '').slice(0, 160))
  note('W06c', 'DB: one report row for the assignment/period, three cell values', `${count(dbPath, 'select count(*) c from reports where assignment_id=? and reporting_period_id=?', [assignmentId, period])} rows / ${count(dbPath, 'select count(*) c from report_field_values where report_id=?', [reportId])} cells`)

  r = await qa.request('PUT', `/api/reports/${reportId}`, { values: values(31, 5, 0) })
  note('W07', 're-save without expectedUpdatedAt (last write wins)', `${r.status} total=${r.json?.values?.total_admitted_patients?.dailyValues?.monday ?? '-'}`)
  const stale = await qa.request('PUT', `/api/reports/${reportId}`, { values: values(32, 5, 0), expectedUpdatedAt: '2020-01-01T00:00:00.000000Z' })
  note('W08', 're-save with a STALE expectedUpdatedAt', `${stale.status}`, `db total=${q(dbPath, "select value_number v from report_field_values f join report_field_definitions d on d.id=f.field_definition_id where f.report_id=? and d.field_key='total_admitted_patients'", [reportId])[0]?.v}`)
  const fresh = await qa.request('GET', `/api/reports/${reportId}`)
  const fresh2 = await qa.request('PUT', `/api/reports/${reportId}`, { values: values(33, 5, 0), expectedUpdatedAt: fresh.json?.updatedAt ?? updatedAt })
  note('W08b', 're-save with the CURRENT expectedUpdatedAt', `${fresh2.status}`)
  r = await qa.request('POST', `/api/reports/${reportId}/submit`, {})
  note('W09', 'submit', `${r.status} status=${r.json?.status ?? '-'}`, `db status=${q(dbPath, 'select status s from reports where id=?', [reportId])[0]?.s}`)

  // W10 lock
  r = await admin.request('POST', `/api/reports/${reportId}/lock`, {})
  note('W10a', 'admin lock', r.status, `locked_at=${q(dbPath, 'select locked_at l from reports where id=?', [reportId])[0]?.l ?? 'null'}`)
  r = await qa.request('PUT', `/api/reports/${reportId}`, { values: values(40, 5, 0) })
  note('W10b', 'nurse save while locked', `${r.status}`, (r.json?.message ?? '').slice(0, 80))
  r = await admin.request('POST', `/api/reports/${reportId}/unlock`, {})
  note('W10c', 'admin unlock', r.status)
  r = await qa.request('PUT', `/api/reports/${reportId}`, { values: values(41, 5, 0) })
  note('W10d', 'nurse save after unlock (submitted report)', `${r.status}`, (r.json?.message ?? '').slice(0, 80))

  // W11 comments
  const auditBefore = count(dbPath, 'select count(*) c from admin_audit_logs')
  r = await qa.request('POST', `/api/reports/${reportId}/comments`, { body: `diff comment ${SUFFIX}` })
  const commentId = r.json?.id ?? r.json?.comment?.id
  note('W11a', 'nurse comments on own report', r.status)
  note('W11b', 'DB: admin_audit_logs rows added by the comment', String(count(dbPath, 'select count(*) c from admin_audit_logs') - auditBefore))
  r = await nurse.request('POST', `/api/reports/${reportId}/comments`, { body: 'foreign' })
  note('W11c', 'a different nurse comments on this report', r.status)
  r = await qa.request('DELETE', `/api/reports/${reportId}/comments/${commentId}`)
  note('W11d', 'author deletes the comment', r.status, `rows=${count(dbPath, 'select count(*) c from report_comments where id=?', [commentId])}`)

  // W12 future period
  r = await qa.request('POST', '/api/reports', { assignmentId, reportingPeriodId: future, values: values(1, 1, 0) })
  note('W12', 'save against a future reporting period', r.status, (r.json?.message ?? JSON.stringify(r.json?.errors ?? '')).slice(0, 100))

  // W13 settings
  const settingsBefore = await admin.request('GET', '/api/admin/settings')
  const original = settingsBefore.json?.settings?.weeklyDeadlineTime
  r = await admin.request('PATCH', '/api/admin/settings', { weeklyDeadlineTime: '24:00' })
  const afterInvalid = q(dbPath, "select value_json v from app_settings where setting_key='weekly_deadline'")
  note('W13a', 'settings: invalid deadline 24:00', r.status, `db=${JSON.stringify(afterInvalid).slice(0, 80)}`)
  r = await admin.request('PATCH', '/api/admin/settings', { weeklyDeadlineTime: '09:30' })
  note('W13b', 'settings: valid deadline 09:30', `${r.status} value=${r.json?.settings?.weeklyDeadlineTime ?? '-'}`)
  r = await admin.request('PATCH', '/api/admin/settings', { weeklyDeadlineTime: original ?? '10:00' })
  note('W13c', 'settings: restore', `${r.status} value=${r.json?.settings?.weeklyDeadlineTime ?? '-'}`)

  // W14 ward delete (referenced) and W24 ward create/delete (unreferenced)
  const referencedWard = q(dbPath, 'select w.id, w.name from wards w where exists (select 1 from subgroup_placements p where p.ward_id = w.id) limit 1')[0]
  r = await admin.request('DELETE', `/api/admin/academic/wards/${referencedWard?.id}`)
  note('W14', 'delete a ward referenced by student placements', r.status, `${(r.json?.message ?? '').slice(0, 90)} | still exists=${count(dbPath, 'select count(*) c from wards where id=?', [referencedWard?.id])}`)
  r = await admin.request('POST', '/api/admin/academic/wards', { name: `QA_DIFF Ward ${SUFFIX}` })
  const wardId = r.json?.id ?? r.json?.data?.id
  const del = await admin.request('DELETE', `/api/admin/academic/wards/${wardId}`)
  note('W24', 'create then delete an unreferenced ward', `${r.status}/${del.status}`)

  // W15 action item
  r = await admin.request('POST', '/api/admin/action-items', { title: `QA_DIFF action ${SUFFIX}`, severity: 'medium' })
  const itemId = r.json?.id ?? r.json?.data?.id
  note('W15a', 'create action item', `${r.status} status=${r.json?.status ?? r.json?.data?.status ?? '-'}`)
  r = await admin.request('PATCH', `/api/admin/action-items/${itemId}`, { status: 'in_progress' })
  note('W15b', 'transition open -> in_progress', `${r.status} status=${r.json?.status ?? r.json?.data?.status ?? '-'}`)
  r = await admin.request('PATCH', `/api/admin/action-items/${itemId}`, { status: 'closed' })
  note('W15c', 'transition in_progress -> closed (without resolved)', `${r.status}`, (r.json?.message ?? '').slice(0, 80))

  // W16 evidence
  const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0300050001ff69cc21170000000049454e44ae426082', 'hex')
  const fd = new FormData()
  fd.append('file', new Blob([png], { type: 'image/png' }), 'evidence.png')
  r = await admin.request('POST', `/api/admin/action-items/${itemId}/evidence`, fd)
  const evidenceId = r.json?.id ?? r.json?.data?.id
  note('W16', 'evidence upload (png)', `${r.status}`, `rows=${count(dbPath, 'select count(*) c from action_item_evidence where action_item_id=?', [itemId])}`)
  const html = new FormData()
  html.append('file', new Blob(['<script>alert(1)</script>'], { type: 'text/html' }), 'evidence.html')
  r = await admin.request('POST', `/api/admin/action-items/${itemId}/evidence`, html)
  note('W16b', 'evidence upload (html) refused', `${r.status}`)
  r = await nurse.request('GET', `/api/admin/action-items/${itemId}/evidence/${evidenceId}/download`)
  note('W16c', 'nurse downloads admin evidence', r.status)

  // W17 export
  r = await admin.request('POST', '/api/analytics/exports', { format: 'csv' })
  note('W17', 'request an export', `${r.status} status=${r.json?.status ?? r.json?.data?.status ?? '-'}`)

  // W18 notifications
  r = await nurse.request('GET', '/api/notifications')
  const nurseId = q(dbPath, 'select id from users where email=?', [ACCOUNTS.nurse])[0]?.id
  note('W18', 'notifications (nurse): count vs own rows in DB', `${r.status} api=${(r.json?.data ?? r.json ?? []).length ?? '-'} db=${count(dbPath, 'select count(*) c from notifications where recipient_id=?', [nurseId])}`)

  // W19 health
  r = await admin.request('GET', '/api/admin/system-health')
  note('W19', 'maintenance health endpoint', r.status)

  // W20 boundaries
  r = await rep.login(ACCOUNTS.rep)
  r = await rep.request('GET', '/api/reports')
  note('W20a', 'student rep lists clinical reports (status and rows returned)', `${r.status} rows=${(r.json?.data ?? (Array.isArray(r.json) ? r.json : [])).length}`)
  r = await rep.request('GET', `/api/reports/${reportId}`)
  note('W20b', 'student rep reads a clinical report', r.status)
  r = await nurse.request('GET', '/api/admin/users')
  note('W20c', 'nurse lists users', r.status)
  r = await nurse.request('GET', `/api/reports/${reportId}`)
  note('W20d', 'a different nurse reads the QA report', r.status)

  // W21 password change audit
  const pwAuditBefore = count(dbPath, "select count(*) c from admin_audit_logs where action='change_password'")
  r = await qa.request('POST', '/api/auth/change-password', { current_password: PASSWORD, password: `${PASSWORD}Diff1`, password_confirmation: `${PASSWORD}Diff1` })
  note('W21a', 'QA nurse changes own password', r.status)
  note('W21b', 'DB: change_password audit rows added', String(count(dbPath, "select count(*) c from admin_audit_logs where action='change_password'") - pwAuditBefore))
  note('W21c', 'DB: role unchanged after password change', q(dbPath, 'select role_key r from users where id=?', [qaNurseId])[0]?.r)

  // W22 analytics
  r = await admin.request('GET', '/api/analytics/dashboard')
  note('W22', 'analytics dashboard (maintenance)', `${r.status} keys=${Object.keys(r.json ?? {}).sort().slice(0, 8).join(',')}`)

  // W23 role transition with active assignment
  r = await admin.request('PATCH', `/api/admin/users/${qaNurseId}`, { role: 'student_rep' })
  note('W23a', 'nurse with an active assignment -> student_rep', r.status, (r.json?.message ?? '').slice(0, 100))
  r = await admin.request('PATCH', `/api/admin/assignments/${assignmentId}`, { active: false })
  const r2 = await admin.request('PATCH', `/api/admin/users/${qaNurseId}`, { role: 'student_rep' })
  note('W23b', 'retire the assignment, then -> student_rep', `${r.status}/${r2.status}`, `db role=${q(dbPath, 'select role_key r from users where id=?', [qaNurseId])[0]?.r}`)
  const qa2 = new Client(base)
  await qa2.login(email, `${PASSWORD}Diff1`)
  r = await qa2.request('GET', `/api/reports/${reportId}`)
  note('W23c', 'converted account reads its former report', r.status)
  r = await qa2.request('PUT', `/api/reports/${reportId}`, { values: values(50, 1, 0) })
  note('W23d', 'converted account saves its former report', r.status)

  return out
}

async function main() {
  const base = args.base
  const target = args.target
  if (!base || !target || !args['base-db'] || !args['target-db']) {
    console.error('usage: --base URL --base-db PATH --target URL --target-db PATH [--out FILE]')
    process.exit(2)
  }
  const [a, b] = [await runSide('base', base, args['base-db']), await runSide('target', target, args['target-db'])]
  const byId = new Map(a.map((x) => [x.id, x]))
  const lines = ['| # | Workflow | Baseline b07b32c | Hardening tree | Same? |', '|---|---|---|---|---|']
  let differences = 0
  for (const t of b) {
    const s = byId.get(t.id)
    const same = s?.value === t.value
    if (!same) differences += 1
    lines.push(`| ${t.id} | ${t.name} | ${s?.value ?? '-'}${s?.detail ? ` (${s.detail})` : ''} | ${t.value}${t.detail ? ` (${t.detail})` : ''} | ${same ? 'yes' : '**no**'} |`)
  }
  const md = `# Differential: baseline vs hardening (${new Date().toISOString()})\n\n${lines.join('\n')}\n\nDifferences: ${differences} of ${b.length}\n`
  const outFile = args.out ?? path.join('output', 'regression', 'differential.md')
  fs.mkdirSync(path.dirname(outFile), { recursive: true })
  fs.writeFileSync(outFile, md)
  console.log(md)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
