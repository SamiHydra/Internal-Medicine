/**
 * Business-rule regression: action items (I), evidence uploads (J), analytics
 * exports (K). Runs against the already-running dev stack; every mutation is
 * re-read from the SQLite database and, for files, from the local disk.
 *
 * Rules are cited from:
 *  - backend/app/Http/Controllers/Api/Admin/ActionItemController.php (store/update/assertTransition/notifyAssignee)
 *  - backend/app/Http/Controllers/Api/Admin/ActionItemEvidenceController.php (mimes list, disk path, download/destroy)
 *  - backend/app/Support/Uploads.php (MAX_FILE_KILOBYTES = 10240, PHP-limit message)
 *  - backend/config/filesystems.php (local disk root = storage/app/private)
 *  - backend/app/Policies/ActionItemPolicy.php (view = actionItems.view, create/update = actionItems.manage)
 *  - backend/routes/api.php (permission middleware on every /admin/action-items route, analytics.view on /analytics/*)
 *  - backend/app/Http/Controllers/Api/AnalyticsController.php (queueExport 202, exports() owner-scoped, download owner-only 403 / 409 / 410 / 404)
 *  - backend/app/Jobs/BuildAnalyticsExport.php (file path analytics-exports/{user}/{id}.{format}, expires_at +7 days, notification)
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { test, expect } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

import {
  apiAs,
  anonContext,
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
  EXTRA_ACCOUNTS,
  REPO_ROOT,
  type Call,
} from './helpers'

const D = 'action-items'
const PREFIX = 'QA_REG_OPS_'
const PRIVATE_ROOT = path.join(REPO_ROOT, 'backend', 'storage', 'app', 'private')
const MAX_BYTES = 10240 * 1024 // Uploads::MAX_FILE_KILOBYTES

let dbReads = 0
let fsReads = 0
const qAll = <T = Record<string, any>>(sql: string, params: unknown[] = []) => {
  dbReads++
  return dbAll<T>(sql, params)
}
const qOne = <T = Record<string, any>>(sql: string, params: unknown[] = []) => {
  dbReads++
  return dbOne<T>(sql, params)
}
const qCount = (sql: string, params: unknown[] = []) => {
  dbReads++
  return dbCount(sql, params)
}
const fileExists = (relative: string) => {
  fsReads++
  return fs.existsSync(path.join(PRIVATE_ROOT, relative))
}
const excerpt = (c: Call) => `${c.status} ${c.text.slice(0, 220).replace(/\s+/g, ' ')}`

type Users = { admin: string; superadmin: string; nurse: string; nurse2: string; resident: string }
const users: Users = { admin: '', superadmin: '', nurse: '', nurse2: '', resident: '' }
const ctx: Record<string, Awaited<ReturnType<typeof apiAs>>> = {}
const suffix = uniqueSuffix()
let itemId = ''
let itemTitle = ''

function pdfBuffer(bytes: number): Buffer {
  const head = Buffer.from('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n1 0 obj << /Type /Catalog >> endobj\n', 'latin1')
  const tail = Buffer.from('\n%%EOF\n')
  const padding = Buffer.alloc(Math.max(0, bytes - head.length - tail.length), 0x20)
  return Buffer.concat([head, padding, tail])
}
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
)

function historyRows(id: string) {
  return qAll<{ event: string; from_status: string | null; to_status: string | null; changed_by: string | null; note: string | null }>(
    'select event, from_status, to_status, changed_by, note from action_item_status_history where action_item_id = ? order by created_at, rowid',
    [id],
  )
}
function auditRows(id: string) {
  return qAll<{ action: string; user_id: string }>(
    "select action, user_id from admin_audit_logs where entity_type = 'action_item' and entity_id = ? order by created_at, rowid",
    [id],
  )
}
function itemRow(id: string) {
  return qOne<Record<string, any>>('select * from action_items where id = ?', [id])!
}

// Tests run in file order (workers: 1, fullyParallel: false). Not 'serial': a
// soft failure in one domain must not skip the others.

test.beforeAll(async () => {
  // Playwright restarts the worker after a failed test and re-runs beforeAll;
  // reset the findings file only once per run. The marker lives in outputDir,
  // which Playwright empties at the start of every run.
  const marker = path.join(test.info().config.rootDir, 'output', 'regression', 'test-results', `${D}.started`)
  if (!fs.existsSync(marker)) {
    resetFindings(D)
    fs.mkdirSync(path.dirname(marker), { recursive: true })
    fs.writeFileSync(marker, new Date().toISOString())
  }
  await flushRateLimits()
  for (const [key, email] of Object.entries({
    admin: EXTRA_ACCOUNTS.admin,
    superadmin: EXTRA_ACCOUNTS.superadmin,
    nurse: EXTRA_ACCOUNTS.nurse,
    nurse2: EXTRA_ACCOUNTS.nurse2,
    resident: EXTRA_ACCOUNTS.resident,
  })) {
    users[key as keyof Users] = qOne<{ id: string }>('select id from users where email = ?', [email])!.id
  }
  ctx.admin = await apiAs(EXTRA_ACCOUNTS.admin)
  ctx.superadmin = await apiAs(EXTRA_ACCOUNTS.superadmin)
  ctx.nurse = await apiAs(EXTRA_ACCOUNTS.nurse)
  ctx.resident = await apiAs(EXTRA_ACCOUNTS.resident)
  ctx.studentRep = await apiAs(EXTRA_ACCOUNTS.studentRep)
})

test.afterAll(async () => {
  info(D, 'I/J/K-reads', 'Database and filesystem re-reads performed by this spec', `db=${dbReads} fs=${fsReads}`)
  for (const c of Object.values(ctx)) await c.dispose()
})

// ------------------------------------------------------------------ I. lifecycle

test('I. action item lifecycle, state machine, role boundaries', async () => {
  const admin = ctx.admin
  itemTitle = `${PREFIX}${suffix} lifecycle`

  // validation (ActionItemController::store)
  const bad = await call(admin, 'POST', '/api/admin/action-items', { data: { description: 'no title' } })
  check(D, 'I-01', 'store without title -> 422 (title required)', '422', String(bad.status), bad.status === 422, excerpt(bad))
  const badSeverity = await call(admin, 'POST', '/api/admin/action-items', { data: { title: itemTitle, severity: 'critical' } })
  check(D, 'I-02', 'store with severity outside low/medium/high -> 422', '422', String(badSeverity.status), badSeverity.status === 422, excerpt(badSeverity))
  const badAssignee = await call(admin, 'POST', '/api/admin/action-items', { data: { title: itemTitle, assigned_to: users.nurse } })
  check(D, 'I-03', 'store assigned to a nurse -> 422 (activeAdminRule: admin/superadmin only)', '422', String(badAssignee.status), badAssignee.status === 422, excerpt(badAssignee))

  // create
  const created = await call(admin, 'POST', '/api/admin/action-items', {
    data: { title: itemTitle, description: 'regression fixture', severity: 'medium', department_id: 'gi_neuro_inpatient' },
  })
  check(D, 'I-04', 'store valid -> 201 with id', '201', excerpt(created), created.status === 201 && !!created.json?.id)
  itemId = created.json?.id ?? ''
  expect(itemId).toBeTruthy()
  let row = itemRow(itemId)
  check(
    D,
    'I-05',
    'stored row: source=manual, status=assigned, assigned_to=creator, created_by=creator, due_at set (+72h default)',
    'manual/assigned/creator',
    `${row.source}/${row.status}/${row.assigned_to === users.admin}/${row.created_by === users.admin}/${row.due_at}`,
    row.source === 'manual' && row.status === 'assigned' && row.assigned_to === users.admin && row.created_by === users.admin && !!row.due_at,
  )
  let history = historyRows(itemId)
  check(D, 'I-06', 'history row "opened" null->assigned by creator', 'opened', JSON.stringify(history), history.length === 1 && history[0].event === 'opened' && history[0].to_status === 'assigned' && history[0].changed_by === users.admin)
  let audit = auditRows(itemId)
  check(D, 'I-07', 'admin_audit_logs "create" row for the item', 'create', JSON.stringify(audit.map((a) => a.action)), audit.some((a) => a.action === 'create' && a.user_id === users.admin))
  const selfNotif = qCount("select count(*) c from notifications where recipient_id = ? and related_id = ? and type = 'action_item_assigned'", [users.admin, itemId])
  check(D, 'I-08', 'creator (default assignee) receives action_item_assigned notification', '1', String(selfNotif), selfNotif === 1)

  // assign to another admin (superadmin)
  const assign = await call(admin, 'PATCH', `/api/admin/action-items/${itemId}`, { data: { assigned_to: users.superadmin } })
  row = itemRow(itemId)
  history = historyRows(itemId)
  check(D, 'I-09', 'PATCH assigned_to=superadmin -> 200, row updated, history "assigned" (Ownership changed.)', '200/assigned', `${assign.status}/${row.assigned_to === users.superadmin}/${history.at(-1)?.event}`, assign.status === 200 && row.assigned_to === users.superadmin && history.at(-1)?.event === 'assigned' && history.at(-1)?.changed_by === users.admin, excerpt(assign))
  const assigneeNotif = qOne<{ related_route: string }>("select related_route from notifications where recipient_id = ? and related_id = ? and type = 'action_item_assigned'", [users.superadmin, itemId])
  check(D, 'I-10', 'new assignee receives action_item_assigned with deep-link route', `/admin/action-items?item=${itemId}`, String(assigneeNotif?.related_route), assigneeNotif?.related_route === `/admin/action-items?item=${itemId}`)
  audit = auditRows(itemId)
  check(D, 'I-11', 'audit action "assign" recorded', 'assign', JSON.stringify(audit.map((a) => a.action)), audit.some((a) => a.action === 'assign'))

  // update plain fields
  const due = new Date(Date.now() + 5 * 86400_000).toISOString()
  const upd = await call(admin, 'PATCH', `/api/admin/action-items/${itemId}`, { data: { severity: 'high', due_at: due } })
  row = itemRow(itemId)
  check(D, 'I-12', 'PATCH severity/due_at -> 200, row updated, overdue_notified_at reset, status unchanged', '200/high/assigned', `${upd.status}/${row.severity}/${row.status}/${row.overdue_notified_at}`, upd.status === 200 && row.severity === 'high' && row.status === 'assigned' && row.overdue_notified_at === null, excerpt(upd))

  // comment
  const comment = await call(admin, 'POST', `/api/admin/action-items/${itemId}/comments`, { data: { body: `${PREFIX}comment ${suffix}` } })
  const commentCount = qCount('select count(*) c from action_item_comments where action_item_id = ? and author_id = ?', [itemId, users.admin])
  history = historyRows(itemId)
  check(D, 'I-13', 'POST comment -> 201, comment row, history "commented"', '201/1/commented', `${comment.status}/${commentCount}/${history.at(-1)?.event}`, comment.status === 201 && commentCount === 1 && history.at(-1)?.event === 'commented', excerpt(comment))

  // state machine (assertTransition)
  const transition = async (id: string, status: string, extra: Record<string, unknown> = {}) =>
    call(admin, 'PATCH', `/api/admin/action-items/${id}`, { data: { status, ...extra } })
  const expectInvalid = async (cid: string, from: string, to: string, extra: Record<string, unknown> = {}) => {
    const r = await transition(itemId, to, extra)
    const after = itemRow(itemId)
    check(D, cid, `invalid transition ${from} -> ${to} -> 422 and status unchanged`, `422/${from}`, `${r.status}/${after.status}`, r.status === 422 && after.status === from, excerpt(r))
  }
  const expectValid = async (cid: string, from: string, to: string, event: string, auditAction: string, extra: Record<string, unknown> = {}) => {
    const r = await transition(itemId, to, extra)
    const after = itemRow(itemId)
    const h = historyRows(itemId).at(-1)
    const a = auditRows(itemId).at(-1)
    check(
      D,
      cid,
      `valid transition ${from} -> ${to} -> 200, status column, history "${event}" by actor, audit "${auditAction}"`,
      `200/${to}/${event}/${auditAction}`,
      `${r.status}/${after.status}/${h?.event}(${h?.from_status}->${h?.to_status})/${a?.action}`,
      r.status === 200 && after.status === to && h?.event === event && h?.from_status === from && h?.to_status === to && h?.changed_by === users.admin && a?.action === auditAction,
      excerpt(r),
    )
    return after
  }

  await expectInvalid('I-14', 'assigned', 'closed')
  await expectValid('I-15', 'assigned', 'in_progress', 'investigation_started', 'update')
  await expectInvalid('I-16', 'in_progress', 'open')
  await expectInvalid('I-17', 'in_progress', 'closed')
  const noNote = await transition(itemId, 'resolved')
  row = itemRow(itemId)
  check(D, 'I-18', 'in_progress -> resolved without resolution_note -> 422 (resolution_note), status unchanged', '422/in_progress', `${noNote.status}/${row.status}/${Object.keys(noNote.json?.errors ?? {})}`, noNote.status === 422 && row.status === 'in_progress' && !!noNote.json?.errors?.resolution_note, excerpt(noNote))
  row = await expectValid('I-19', 'in_progress', 'resolved', 'resolved', 'resolve', { resolution_note: `${PREFIX}resolved ${suffix}` })
  check(D, 'I-20', 'resolved stamps resolved_at/resolved_by=actor', 'set/admin', `${row.resolved_at}/${row.resolved_by === users.admin}`, !!row.resolved_at && row.resolved_by === users.admin)
  await expectInvalid('I-21', 'resolved', 'in_progress')
  await expectInvalid('I-22', 'resolved', 'assigned')
  row = await expectValid('I-23', 'resolved', 'closed', 'verified', 'verify')
  check(D, 'I-24', 'closed stamps verified_at/verified_by=actor', 'set/admin', `${row.verified_at}/${row.verified_by === users.admin}`, !!row.verified_at && row.verified_by === users.admin)
  await expectInvalid('I-25', 'closed', 'in_progress')
  await expectInvalid('I-26', 'closed', 'resolved')
  await expectInvalid('I-27', 'closed', 'assigned')
  row = await expectValid('I-28', 'closed', 'open', 'reopened', 'reopen')
  check(D, 'I-29', 'reopen clears verified_at/verified_by but keeps resolved_* as history', 'null/kept', `${row.verified_at}/${row.verified_by}/${row.resolved_at}`, row.verified_at === null && row.verified_by === null && !!row.resolved_at)
  await expectInvalid('I-30', 'open', 'closed')
  await expectValid('I-31', 'open', 'in_progress', 'investigation_started', 'update')
  await expectValid('I-32', 'in_progress', 'assigned', 'assigned', 'assign')

  // assignee requirement: in_progress needs an assignee (assertTransition)
  const clearAssignee = await call(admin, 'PATCH', `/api/admin/action-items/${itemId}`, { data: { status: 'in_progress', assigned_to: null } })
  row = itemRow(itemId)
  check(D, 'I-33', 'status=in_progress with assigned_to=null -> 422 "Assign an active administrator before starting this work." (assertTransition), status and assignee unchanged', '422/assigned/assignee kept', `${clearAssignee.status}/${row.status}/assigned_to=${row.assigned_to}/${Object.keys(clearAssignee.json?.errors ?? {})}`, clearAssignee.status === 422 && row.status === 'assigned' && row.assigned_to === users.superadmin && !!clearAssignee.json?.errors?.assigned_to, excerpt(clearAssignee))
  if (row.assigned_to === null) {
    // Leave the item in a well-formed state for the rest of the spec (re-assign; the status stays whatever the product left it in).
    await call(admin, 'PATCH', `/api/admin/action-items/${itemId}`, { data: { assigned_to: users.superadmin } })
  }

  // role boundaries (routes: permission:actionItems.view / actionItems.manage)
  for (const [role, c] of [['nurse', ctx.nurse], ['resident', ctx.resident], ['student_rep', ctx.studentRep]] as const) {
    const list = await call(c, 'GET', '/api/admin/action-items')
    const post = await call(c, 'POST', '/api/admin/action-items', { data: { title: `${PREFIX}${role} ${suffix}` } })
    const patch = await call(c, 'PATCH', `/api/admin/action-items/${itemId}`, { data: { status: 'in_progress' } })
    const show = await call(c, 'GET', `/api/admin/action-items/${itemId}`)
    check(D, `I-34-${role}`, `${role}: GET list / POST / PATCH / GET show on action items -> 403 (no actionItems.* permission)`, '403/403/403/403', `${list.status}/${post.status}/${patch.status}/${show.status}`, list.status === 403 && post.status === 403 && patch.status === 403 && show.status === 403)
  }
  const strayRows = qCount('select count(*) c from action_items where title like ?', [`${PREFIX}nurse ${suffix}%`]) + qCount('select count(*) c from action_items where title like ?', [`${PREFIX}resident ${suffix}%`])
  check(D, 'I-35', 'non-admin POST attempts created no action_items rows', '0', String(strayRows), strayRows === 0)
  info(D, 'I-36', 'A nurse can never be the assignee of an action item (activeAdminRule) and holds no actionItems.* permission, so "nurse assigned to an item may transition it" is not an implemented rule; asserted 422 on assignment (I-03) and 403 on PATCH (I-34-nurse).', 'not applicable')

  // deep link
  const showAdmin = await call(admin, 'GET', `/api/admin/action-items/${itemId}`)
  const showAssignee = await call(ctx.superadmin, 'GET', `/api/admin/action-items/${itemId}`)
  check(D, 'I-37', 'GET show as admin and as the assignee (superadmin) -> 200 with the item and its history/comments', '200/200', `${showAdmin.status}/${showAssignee.status}`, showAdmin.status === 200 && showAdmin.json?.id === itemId && showAssignee.status === 200 && Array.isArray(showAdmin.json?.history ?? showAdmin.json?.statusHistory ?? []), excerpt(showAdmin))
  info(D, 'I-38', 'deep link payload of the assignee notification', JSON.stringify(qOne("select type, title, related_route, related_entity, related_id from notifications where recipient_id = ? and related_id = ?", [users.superadmin, itemId])))
  const listAdmin = await call(admin, 'GET', `/api/admin/action-items?status=all&search=${encodeURIComponent(suffix)}`)
  check(D, 'I-39', 'GET list (status=all, search=<suffix>) as admin includes the item', 'found', String(listAdmin.json?.data?.some((i: any) => i.id === itemId)), listAdmin.status === 200 && listAdmin.json?.data?.some((i: any) => i.id === itemId), excerpt(listAdmin))
  const listUnderscore = await call(admin, 'GET', `/api/admin/action-items?status=all&search=${encodeURIComponent(PREFIX + suffix)}`)
  info(D, 'I-40', 'search term containing "_" (index escapes % and _ with a backslash but adds no ESCAPE clause; SQLite treats the backslash literally, MariaDB uses it as the default escape) - dev-DB observation, index() unchanged by the hardening commits', `search=${PREFIX}${suffix} -> ${listUnderscore.json?.meta?.total} rows (item ${itemId} present: ${listUnderscore.json?.data?.some((i: any) => i.id === itemId)})`)
})

// ------------------------------------------------------------------ J. evidence

test('J. evidence upload, size and MIME rules, download authorization, delete', async () => {
  test.setTimeout(240_000)
  const admin = ctx.admin
  if (!itemId) {
    // Playwright restarts the worker after a failed test, which drops module state; provision a fresh item.
    const own = await call(admin, 'POST', '/api/admin/action-items', { data: { title: `${PREFIX}${suffix} evidence`, severity: 'low' } })
    itemId = own.json?.id ?? ''
    info(D, 'J-00', 'evidence test provisioned its own action item (worker restarted after test I)', `${own.status} ${itemId}`)
  }
  expect(itemId).toBeTruthy()
  const evidenceUrl = `/api/admin/action-items/${itemId}/evidence`
  const upload = (name: string, mimeType: string, buffer: Buffer) => call(admin, 'POST', evidenceUrl, { multipart: { file: { name, mimeType, buffer } } })
  const rowsFor = () => qAll<{ id: string; file_path: string; mime_type: string; size_bytes: number; original_name: string }>('select id, file_path, mime_type, size_bytes, original_name from action_item_evidence where action_item_id = ? order by created_at, rowid', [itemId])
  const created: { id: string; file_path: string }[] = []

  // 1 KB PDF
  const smallPdf = pdfBuffer(1024)
  const r1 = await upload(`${PREFIX}small.pdf`, 'application/pdf', smallPdf)
  let rows = rowsFor()
  const pdfRow = rows.find((r) => r.id === r1.json?.id)
  check(D, 'J-01', '1 KB PDF -> 201, action_item_evidence row (disk=local, path action-items/{item}/{uuid}.pdf), file on disk', '201/row/file', `${r1.status}/${pdfRow?.file_path}/${pdfRow ? fileExists(pdfRow.file_path) : 'no row'}`, r1.status === 201 && !!pdfRow && pdfRow.file_path.startsWith(`action-items/${itemId}/`) && pdfRow.size_bytes === smallPdf.length && fileExists(pdfRow.file_path), excerpt(r1))
  if (pdfRow) created.push(pdfRow)
  const h1 = historyRows(itemId).at(-1)
  const a1 = auditRows(itemId).at(-1)
  check(D, 'J-02', 'upload writes history "evidence_uploaded" and audit "upload_evidence"', 'evidence_uploaded/upload_evidence', `${h1?.event}/${a1?.action}`, h1?.event === 'evidence_uploaded' && a1?.action === 'upload_evidence')

  // 1x1 PNG
  const r2 = await upload(`${PREFIX}pixel.png`, 'image/png', PNG_1X1)
  rows = rowsFor()
  const pngRow = rows.find((r) => r.id === r2.json?.id)
  check(D, 'J-03', 'PNG -> 201, row mime image/png, file on disk', '201/image/png', `${r2.status}/${pngRow?.mime_type}/${pngRow ? fileExists(pngRow.file_path) : 'no row'}`, r2.status === 201 && pngRow?.mime_type === 'image/png' && fileExists(pngRow.file_path), excerpt(r2))
  if (pngRow) created.push(pngRow)

  // 3 MB, 9 MB: may be refused by the host PHP (upload_max_filesize) with the QA-005 message
  const r3 = await upload(`${PREFIX}three.pdf`, 'application/pdf', pdfBuffer(3 * 1024 * 1024))
  const phpLimited = r3.status === 422 && /larger than this server currently accepts/.test(String(r3.json?.errors?.file?.[0] ?? ''))
  if (phpLimited) {
    recordFinding(D, { id: 'J-04', rule: '3 MB valid PDF -> 201 (application limit 10 MB)', expected: '201', actual: excerpt(r3), status: 'SKIP', evidence: 'Host PHP upload_max_filesize is below the application limit; Uploads::failureMessage produced the actionable QA-005 message (asserted in J-04b). Not a product regression.' })
    check(D, 'J-04b', 'file refused by PHP upload_max_filesize -> 422 with actionable message naming upload_max_filesize and the 10 MB limit (Uploads::failureMessage)', '422 + message', excerpt(r3), r3.status === 422 && /upload_max_filesize/.test(r3.json.errors.file[0]) && /10 MB/.test(r3.json.errors.file[0]))
    recordFinding(D, { id: 'J-05', rule: '9 MB valid PDF -> 201', expected: '201', actual: 'not attempted', status: 'SKIP', evidence: 'same host limit as J-04' })
  } else {
    rows = rowsFor()
    const row3 = rows.find((r) => r.id === r3.json?.id)
    check(D, 'J-04', '3 MB valid PDF -> 201, row, file on disk with matching size', '201', `${r3.status}/${row3?.size_bytes}/${row3 ? fileExists(row3.file_path) : 'no row'}`, r3.status === 201 && row3?.size_bytes === 3 * 1024 * 1024 && fileExists(row3.file_path), excerpt(r3))
    if (row3) created.push(row3)
    const r4 = await upload(`${PREFIX}nine.pdf`, 'application/pdf', pdfBuffer(9 * 1024 * 1024))
    rows = rowsFor()
    const row4 = rows.find((r) => r.id === r4.json?.id)
    check(D, 'J-05', '9 MB valid PDF -> 201 (under the 10 MB limit), row, file on disk', '201', `${r4.status}/${row4?.size_bytes}/${row4 ? fileExists(row4.file_path) : 'no row'}`, r4.status === 201 && row4?.size_bytes === 9 * 1024 * 1024 && fileExists(row4.file_path), excerpt(r4))
    if (row4) created.push(row4)
  }

  // 11 MB -> refused, no row, no file
  const before = rowsFor().length
  const dirBefore = fs.existsSync(path.join(PRIVATE_ROOT, 'action-items', itemId)) ? fs.readdirSync(path.join(PRIVATE_ROOT, 'action-items', itemId)).length : 0
  fsReads++
  const r5 = await upload(`${PREFIX}eleven.pdf`, 'application/pdf', pdfBuffer(11 * 1024 * 1024))
  const after = rowsFor().length
  const dirAfter = fs.existsSync(path.join(PRIVATE_ROOT, 'action-items', itemId)) ? fs.readdirSync(path.join(PRIVATE_ROOT, 'action-items', itemId)).length : 0
  fsReads++
  check(D, 'J-06', `11 MB (> ${MAX_BYTES} bytes) -> 413/422, no row, no file`, '413|422/no row/no file', `${r5.status}/rows ${before}->${after}/files ${dirBefore}->${dirAfter}`, (r5.status === 413 || r5.status === 422) && after === before && dirAfter === dirBefore, excerpt(r5))

  // invalid MIME bodies, matching and spoofed client types (mimes:pdf,jpg,jpeg,png,doc,docx,xls,xlsx,csv,txt)
  const bodies: [string, string, string, Buffer][] = [
    ['html', 'evil.html', 'text/html', Buffer.from('<!DOCTYPE html>\n<html><head><title>x</title></head><body><script>alert(1)</script></body></html>\n')],
    ['svg', 'evil.svg', 'image/svg+xml', Buffer.from('<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script>alert(1)</script><rect width="10" height="10"/></svg>\n')],
    ['php', 'evil.php', 'application/x-httpd-php', Buffer.from('<?php\nsystem($_GET["c"]);\n?>\n')],
    ['exe', 'evil.exe', 'application/x-msdownload', Buffer.concat([Buffer.from('MZ\x90\x00\x03\x00\x00\x00\x04\x00\x00\x00\xff\xff\x00\x00', 'latin1'), Buffer.alloc(512, 0), Buffer.from('PE\x00\x00', 'latin1'), Buffer.alloc(256, 0)])],
  ]
  for (const [kind, name, mime, body] of bodies) {
    const b = rowsFor().length
    const matching = await upload(`${PREFIX}${name}`, mime, body)
    const spoofedName = `${PREFIX}${name.replace(/\.[a-z]+$/, '')}.pdf`
    const spoofed = await upload(spoofedName, 'application/pdf', body)
    const a = rowsFor().length
    const dirNow = fs.readdirSync(path.join(PRIVATE_ROOT, 'action-items', itemId)).length
    fsReads++
    check(D, `J-07-${kind}`, `${kind} body: matching mime -> 422 and spoofed (.pdf, application/pdf) -> 422, no rows, no files`, '422/422', `${matching.status}/${spoofed.status}/rows ${b}->${a}/files ${dirNow}`, matching.status === 422 && spoofed.status === 422 && a === b && dirNow === dirBefore, `${excerpt(matching)} | ${excerpt(spoofed)}`)
  }

  // download authorization
  expect(created.length).toBeGreaterThan(0)
  const target = created[0]
  const dl = `/api/admin/action-items/${itemId}/evidence/${target.id}/download`
  const dAdmin = await ctx.admin.fetch(dl, { headers: { Accept: '*/*', 'X-Requested-With': 'XMLHttpRequest', Origin: 'http://localhost:5173', Referer: 'http://localhost:5173/' } })
  const bytes = await dAdmin.body()
  check(D, 'J-08', 'download as admin (actionItems.view) -> 200 with the exact uploaded bytes', `200/${smallPdf.length}`, `${dAdmin.status()}/${bytes.length}/${dAdmin.headers()['content-type']}`, dAdmin.status() === 200 && bytes.equals(smallPdf))
  const dNurse = await call(ctx.nurse, 'GET', dl)
  const dResident = await call(ctx.resident, 'GET', dl)
  check(D, 'J-09', 'download as nurse / resident -> 403', '403/403', `${dNurse.status}/${dResident.status}`, dNurse.status === 403 && dResident.status === 403)
  const dSuper = await ctx.superadmin.fetch(dl, { headers: { Accept: '*/*', 'X-Requested-With': 'XMLHttpRequest', Origin: 'http://localhost:5173', Referer: 'http://localhost:5173/' } })
  check(D, 'J-10', 'download as a second admin-like account (superadmin, holds actionItems.view) -> 200 (ActionItemPolicy::view = viewAny)', '200', String(dSuper.status()), dSuper.status() === 200)
  const dAnon = await call(await anonContext(), 'GET', dl)
  check(D, 'J-11', 'download anonymous -> 401', '401', String(dAnon.status), dAnon.status === 401)
  const missingId = randomUUID()
  const d404 = await call(admin, 'GET', `/api/admin/action-items/${itemId}/evidence/${missingId}/download`)
  const del404 = await call(admin, 'DELETE', `/api/admin/action-items/${itemId}/evidence/${missingId}`)
  check(D, 'J-12', 'nonexistent evidence id: download and delete -> 404', '404/404', `${d404.status}/${del404.status}`, d404.status === 404 && del404.status === 404)
  // evidence id that belongs to a different action item -> 404 (download/destroy abort_unless action_item_id matches)
  const second = await call(admin, 'POST', '/api/admin/action-items', { data: { title: `${PREFIX}${suffix} cross`, severity: 'low' } })
  const secondId: string = second.json?.id ?? ''
  const secondEvidence = await call(admin, 'POST', `/api/admin/action-items/${secondId}/evidence`, { multipart: { file: { name: `${PREFIX}cross.png`, mimeType: 'image/png', buffer: PNG_1X1 } } })
  const crossId: string = secondEvidence.json?.id ?? ''
  const crossDl = await call(admin, 'GET', `/api/admin/action-items/${itemId}/evidence/${crossId}/download`)
  const crossDel = await call(admin, 'DELETE', `/api/admin/action-items/${itemId}/evidence/${crossId}`)
  const crossRow = qOne<{ file_path: string }>('select file_path from action_item_evidence where id = ?', [crossId])
  check(D, 'J-13', "another item's evidence id under this item's URL: download and delete -> 404, the row and file survive", '404/404/row/file', `${crossDl.status}/${crossDel.status}/${crossRow ? 'row' : 'GONE'}/${crossRow ? fileExists(crossRow.file_path) : 'n/a'}`, secondEvidence.status === 201 && crossDl.status === 404 && crossDel.status === 404 && !!crossRow && fileExists(crossRow.file_path))
  const crossCleanup = await call(admin, 'DELETE', `/api/admin/action-items/${secondId}/evidence/${crossId}`)
  check(D, 'J-13b', 'deleting it under its own item -> 204, row and file gone', '204/gone/gone', `${crossCleanup.status}/${qCount('select count(*) c from action_item_evidence where id = ?', [crossId])}/${crossRow ? fileExists(crossRow.file_path) : 'n/a'}`, crossCleanup.status === 204 && qCount('select count(*) c from action_item_evidence where id = ?', [crossId]) === 0 && !!crossRow && !fileExists(crossRow.file_path))
  const delNurse = await call(ctx.nurse, 'DELETE', `/api/admin/action-items/${itemId}/evidence/${target.id}`)
  check(D, 'J-14', 'delete evidence as nurse -> 403, row and file remain', '403/row/file', `${delNurse.status}/${qCount('select count(*) c from action_item_evidence where id = ?', [target.id])}/${fileExists(target.file_path)}`, delNurse.status === 403 && qCount('select count(*) c from action_item_evidence where id = ?', [target.id]) === 1 && fileExists(target.file_path))

  // delete as admin
  const del = await call(admin, 'DELETE', `/api/admin/action-items/${itemId}/evidence/${target.id}`)
  const rowGone = qCount('select count(*) c from action_item_evidence where id = ?', [target.id]) === 0
  const fileGone = !fileExists(target.file_path)
  const auditDel = auditRows(itemId).at(-1)
  check(D, 'J-15', 'delete evidence as admin -> 204, row gone, file gone, audit "delete"', '204/gone/gone/delete', `${del.status}/${rowGone}/${fileGone}/${auditDel?.action}`, del.status === 204 && rowGone && fileGone && auditDel?.action === 'delete', excerpt(del))

  // orphan audit for the rows we created, then clean up
  const remaining = rowsFor()
  const mismatches = remaining.filter((r) => !fileExists(r.file_path)).map((r) => r.file_path)
  check(D, 'J-16', 'every remaining action_item_evidence row for this item has its file on disk (no orphan rows)', '0 mismatches', `${remaining.length} rows, mismatches: ${JSON.stringify(mismatches)}`, mismatches.length === 0)
  for (const r of remaining) await call(admin, 'DELETE', `/api/admin/action-items/${itemId}/evidence/${r.id}`)
  const dir = path.join(PRIVATE_ROOT, 'action-items', itemId)
  const leftoverFiles = fs.existsSync(dir) ? fs.readdirSync(dir) : []
  fsReads++
  check(D, 'J-17', 'after deleting every evidence row, no stray files remain in the item directory (no orphan files)', '0', `${leftoverFiles.length} (${leftoverFiles.join(',')})`, leftoverFiles.length === 0 && qCount('select count(*) c from action_item_evidence where action_item_id = ?', [itemId]) === 0)
  info(D, 'J-18', 'evidence disk root', PRIVATE_ROOT)
})

// ------------------------------------------------------------------ K. exports

test('K. analytics exports: queue, build, owner-only download, isolation', async () => {
  test.setTimeout(300_000)
  const admin = ctx.admin
  const today = new Date()
  const from = new Date(today.getTime() - 21 * 86400_000).toISOString().slice(0, 10)
  const to = today.toISOString().slice(0, 10)
  const filters = `dateFrom=${from}&dateTo=${to}`

  const scope = await call(admin, 'GET', `/api/analytics/exports/scope?${filters}`)
  check(D, 'K-01', 'GET exports/scope -> 200 with reports count and limit', '200 {reports, limit}', excerpt(scope), scope.status === 200 && typeof scope.json?.data?.reports === 'number' && typeof scope.json?.data?.limit === 'number')
  info(D, 'K-01i', 'export scope used', `${filters}: ${JSON.stringify(scope.json?.data)}`)

  const badFormat = await call(admin, 'POST', '/api/analytics/exports', { data: { format: 'pdf' } })
  check(D, 'K-02', 'POST exports with format outside csv/xlsx -> 422', '422', String(badFormat.status), badFormat.status === 422, excerpt(badFormat))

  const queued = await call(admin, 'POST', '/api/analytics/exports', { data: { format: 'csv', dateFrom: from, dateTo: to } })
  const exportId: string = queued.json?.data?.id ?? ''
  const pending = qOne<Record<string, any>>('select * from analytics_exports where id = ?', [exportId])
  check(D, 'K-03', 'POST exports (csv, filtered) -> 202 with id; row user_id=owner, status pending|processing, filters stored', '202/pending', `${queued.status}/${pending?.status}/${pending?.user_id === users.admin}/${pending?.filters}`, queued.status === 202 && !!exportId && !!pending && ['pending', 'processing'].includes(pending.status) && pending.user_id === users.admin && String(pending.filters).includes(from), excerpt(queued))
  expect(exportId).toBeTruthy()

  const waitReady = async (id: string, budgetMs: number) => {
    const started = Date.now()
    let last: any = null
    while (Date.now() - started < budgetMs) {
      const list = await call(admin, 'GET', '/api/analytics/exports')
      last = list.json?.data?.find((e: any) => e.id === id) ?? null
      if (last && (last.status === 'ready' || last.status === 'failed')) break
      await new Promise((r) => setTimeout(r, 2000))
    }
    return { last, elapsed: Date.now() - started }
  }
  const { last, elapsed } = await waitReady(exportId, 120_000)
  const ready = qOne<Record<string, any>>('select * from analytics_exports where id = ?', [exportId])
  check(D, 'K-04', 'export reaches ready within 120 s: file_path set, file on disk, expires_at set, byte_size > 0, downloadUrl in list', 'ready', `${last?.status} after ${elapsed} ms; path=${ready?.file_path}; exists=${ready?.file_path ? fileExists(ready.file_path) : false}; expires_at=${ready?.expires_at}; error=${ready?.error}`, last?.status === 'ready' && ready?.status === 'ready' && !!ready?.file_path && fileExists(ready.file_path) && !!ready?.expires_at && Number(ready?.byte_size) > 0 && last?.downloadUrl === `/api/analytics/exports/${exportId}/download`)
  const expiresMs = ready?.expires_at ? new Date(String(ready.expires_at).replace(' ', 'T') + 'Z').getTime() - Date.now() : 0
  check(D, 'K-05', 'expires_at is about 7 days ahead (BuildAnalyticsExport)', '6.9..7.1 days', `${(expiresMs / 86400_000).toFixed(2)} days`, expiresMs > 6.9 * 86400_000 && expiresMs < 7.1 * 86400_000)
  const notified = qCount("select count(*) c from notifications where recipient_id = ? and related_id = ? and type = 'analytics_export_ready'", [users.admin, exportId])
  check(D, 'K-06', 'owner receives analytics_export_ready notification', '1', String(notified), notified === 1)

  const dl = `/api/analytics/exports/${exportId}/download`
  const dlHeaders = { Accept: '*/*', 'X-Requested-With': 'XMLHttpRequest', Origin: 'http://localhost:5173', Referer: 'http://localhost:5173/' }
  const own = await admin.fetch(dl, { headers: dlHeaders })
  const body = await own.body()
  const head = body.subarray(0, 64).toString('utf8')
  const body = head.replace(/^\uFEFF/, '')
  const looksCsv = body.length > 0 && body.charCodeAt(0) > 8 && (head.includes(',') || head.includes('\n'))
  check(D, 'K-07', 'download as owner -> 200, non-empty body that looks like CSV, size matches byte_size', `200/${ready?.byte_size}`, `${own.status()}/${body.length}/${own.headers()['content-type']}/head=${JSON.stringify(head.slice(0, 40))}`, own.status() === 200 && body.length > 0 && body.length === Number(ready?.byte_size) && looksCsv)
  info(D, 'K-07i', 'downloaded export size and header', `${body.length} bytes; ${own.headers()['content-disposition']}`)

  const other = await call(ctx.superadmin, 'GET', dl)
  check(D, 'K-08', 'download as a different admin (superadmin) -> 403 (AnalyticsController::download owner-only, no AnalyticsExportPolicy exists)', '403', String(other.status), other.status === 403, excerpt(other))
  const nurse = await call(ctx.nurse, 'GET', dl)
  const nurseList = await call(ctx.nurse, 'GET', '/api/analytics/exports')
  const nursePost = await call(ctx.nurse, 'POST', '/api/analytics/exports', { data: { format: 'csv' } })
  check(D, 'K-09', 'nurse: download / list / queue -> 403 (permission:analytics.view)', '403/403/403', `${nurse.status}/${nurseList.status}/${nursePost.status}`, nurse.status === 403 && nurseList.status === 403 && nursePost.status === 403)
  const anon = await call(await anonContext(), 'GET', dl)
  check(D, 'K-10', 'download anonymous -> 401', '401', String(anon.status), anon.status === 401)
  const otherList = await call(ctx.superadmin, 'GET', '/api/analytics/exports')
  check(D, 'K-11', "another user's export list does not include this export (exports() scoped by user_id)", 'absent', String(otherList.json?.data?.some((e: any) => e.id === exportId)), otherList.status === 200 && !otherList.json?.data?.some((e: any) => e.id === exportId))
  const bogus = await call(admin, 'GET', `/api/analytics/exports/${randomUUID()}/download`)
  check(D, 'K-12', 'download of an unknown export id -> 404', '404', String(bogus.status), bogus.status === 404)

  // two identical rapid requests
  const [q1, q2] = await Promise.all([
    call(admin, 'POST', '/api/analytics/exports', { data: { format: 'xlsx', dateFrom: from, dateTo: to } }),
    call(admin, 'POST', '/api/analytics/exports', { data: { format: 'xlsx', dateFrom: from, dateTo: to } }),
  ])
  const id1 = q1.json?.data?.id
  const id2 = q2.json?.data?.id
  check(D, 'K-13', 'two identical rapid requests -> two 202s with distinct ids and two rows', '202/202/distinct', `${q1.status}/${q2.status}/${id1 !== id2}`, q1.status === 202 && q2.status === 202 && !!id1 && !!id2 && id1 !== id2 && qCount('select count(*) c from analytics_exports where id in (?, ?)', [id1, id2]) === 2)
  const w1 = await waitReady(id1, 120_000)
  const w2 = await waitReady(id2, 60_000)
  const rows = qAll<Record<string, any>>('select id, status, file_path, byte_size from analytics_exports where id in (?, ?)', [id1, id2])
  const paths = rows.map((r) => r.file_path)
  const filesExist = rows.every((r) => r.file_path && fileExists(r.file_path))
  check(D, 'K-14', 'both rapid exports become ready with two distinct file paths, both files on disk', 'ready/ready/distinct', `${w1.last?.status}(${w1.elapsed} ms)/${w2.last?.status}(${w2.elapsed} ms)/${JSON.stringify(paths)}/exist=${filesExist}`, rows.length === 2 && rows.every((r) => r.status === 'ready') && new Set(paths).size === 2 && filesExist)
  const x = await admin.fetch(`/api/analytics/exports/${id1}/download`, { headers: dlHeaders })
  const xb = await x.body()
  check(D, 'K-15', 'xlsx download -> 200, body starts with the ZIP magic "PK"', '200/PK', `${x.status()}/${xb.subarray(0, 2).toString('latin1')}/${xb.length} bytes`, x.status() === 200 && xb.subarray(0, 2).toString('latin1') === 'PK')
  info(D, 'K-16', 'exports have no delete endpoint; rows expire after 7 days (PruneOperationalData). Rows left in place', JSON.stringify([exportId, id1, id2]))
})

// ------------------------------------------------------------------ cleanup

test('cleanup: close every outstanding regression action item', async () => {
  const admin = ctx.admin
  // Module state may be gone (worker restart), so find the fixtures by title prefix; this also tidies earlier runs.
  const open = qAll<{ id: string; status: string; title: string }>("select id, status, title from action_items where title like 'QA\\_REG\\_OPS\\_%' escape '\\' and status <> 'closed'")
  for (const item of open) {
    let status = item.status
    if (['open', 'assigned', 'in_progress'].includes(status)) {
      await call(admin, 'PATCH', `/api/admin/action-items/${item.id}`, { data: { status: 'resolved', resolution_note: `${PREFIX}cleanup ${suffix}` } })
      status = itemRow(item.id).status
    }
    if (status === 'resolved') await call(admin, 'PATCH', `/api/admin/action-items/${item.id}`, { data: { status: 'closed' } })
  }
  const stillOpen = qCount("select count(*) c from action_items where title like 'QA\\_REG\\_OPS\\_%' escape '\\' and status <> 'closed'")
  const stray = qCount("select count(*) c from action_item_evidence where action_item_id in (select id from action_items where title like 'QA\\_REG\\_OPS\\_%' escape '\\')")
  info(D, 'cleanup', 'action items have no delete endpoint; regression items are left closed', `closed now: ${open.length} (${open.map((i) => i.id).join(',')}); still outstanding: ${stillOpen}; evidence rows left: ${stray}`)
})
