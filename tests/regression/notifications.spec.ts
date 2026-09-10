/**
 * Business-rule regression: notifications (L) and workspace switching (M).
 *
 * Rules are cited from:
 *  - backend/app/Http/Controllers/Api/NotificationController.php
 *      index: non-admin pinned to own recipient_id; admin may pass recipient_id
 *      markRead / destroy: visibleNotificationQuery (own rows) + policy; foreign ids are simply not matched (updated/deleted = 0)
 *      markAllRead: own unread rows
 *      restore: max:50, non-admin can only restore onto own account, admin may target userId; refuses to overwrite a row of a different recipient
 *  - backend/app/Policies/NotificationPolicy.php (update/delete = admin-like OR recipient)
 *  - backend/routes/api.php (every /notifications route: permission:notifications.view)
 *  - backend/app/Http/Controllers/Api/Admin/ActionItemController.php::notifyAssignee (action_item_assigned, related_route deep link)
 *  - src/context/workspace-context.tsx (preference is localStorage 'stpaul:workspace' only; no server call)
 *  - backend/app/Http/Controllers/Api/Admin/UserController.php::index (?workspace= roster filter, permission:users.view)
 *  - backend/app/Http/Controllers/Api/AuthController.php::sessionPayload (role + permissions = Permissions::forUser)
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { test, expect } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

import {
  apiAs,
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
  type Call,
} from './helpers'

const D = 'notifications'
const PREFIX = 'QA_REG_OPS_'

let dbReads = 0
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
const excerpt = (c: Call) => `${c.status} ${c.text.slice(0, 220).replace(/\s+/g, ' ')}`

const users: Record<string, string> = {}
const ctx: Record<string, Awaited<ReturnType<typeof apiAs>>> = {}
const suffix = uniqueSuffix()
const createdIds: string[] = []
let foreignId = ''
let itemId = ''

type Snapshot = { id: string; userId: string; type: string; title: string; message: string; createdAt: string | null; readAt: string | null; relatedRoute: string; relatedReportId: string | null }

function notifRow(id: string) {
  return qOne<Record<string, any>>('select * from notifications where id = ?', [id])
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
  for (const [key, email] of Object.entries({ admin: EXTRA_ACCOUNTS.admin, superadmin: EXTRA_ACCOUNTS.superadmin, nurse: EXTRA_ACCOUNTS.nurse, nurse2: EXTRA_ACCOUNTS.nurse2 })) {
    users[key] = qOne<{ id: string }>('select id from users where email = ?', [email])!.id
  }
  ctx.admin = await apiAs(EXTRA_ACCOUNTS.admin)
  ctx.superadmin = await apiAs(EXTRA_ACCOUNTS.superadmin)
  ctx.nurse = await apiAs(EXTRA_ACCOUNTS.nurse)
  ctx.nurse2 = await apiAs(EXTRA_ACCOUNTS.nurse2)
})

test.afterAll(async () => {
  info(D, 'L/M-reads', 'Database re-reads performed by this spec', `db=${dbReads}`)
  for (const c of Object.values(ctx)) await c.dispose()
})

test('L. notifications: own rows only, read, read-all, clear, restore, foreign ids, batch limit, deep link', async () => {
  const nurse2 = ctx.nurse2
  const nurse = ctx.nurse

  // --- fresh rows. (1) action-item assignment notifies the assignee (admin); (2) admin restore addresses rows to nurse2 / nurse.
  const item = await call(ctx.superadmin, 'POST', '/api/admin/action-items', { data: { title: `${PREFIX}${suffix} notify`, assigned_to: users.admin } })
  itemId = item.json?.id ?? ''
  const assigned = qOne<Record<string, any>>("select * from notifications where recipient_id = ? and related_id = ? and type = 'action_item_assigned'", [users.admin, itemId])
  check(D, 'L-01', 'creating an action item assigned to admin writes an action_item_assigned notification for the assignee (notifyAssignee)', '201 + row', `${item.status}/${assigned ? 'row' : 'no row'}`, item.status === 201 && !!assigned, excerpt(item))

  const seed = async (recipient: string, n: number) => {
    const notifications = Array.from({ length: n }, (_, i) => ({
      id: randomUUID(),
      userId: recipient,
      type: 'qa_regression',
      title: `${PREFIX}${suffix} #${i + 1}`,
      message: `regression notification ${i + 1}`,
      relatedRoute: '/notifications',
    }))
    const r = await call(ctx.superadmin, 'POST', '/api/notifications/restore', { data: { notifications } })
    return { r, ids: notifications.map((x) => x.id) }
  }
  const seeded = await seed(users.nurse2, 3)
  createdIds.push(...seeded.ids)
  const seededForeign = await seed(users.nurse, 1)
  foreignId = seededForeign.ids[0]
  const seededCount = qCount(`select count(*) c from notifications where id in (${seeded.ids.map(() => '?').join(',')}) and recipient_id = ?`, [...seeded.ids, users.nurse2])
  check(D, 'L-02', 'admin restore may address notifications to another user (restore: admin targets userId) -> 200 restored=3, rows under nurse2', '200/3/3', `${seeded.r.status}/${seeded.r.json?.restored}/${seededCount}`, seeded.r.status === 200 && seeded.r.json?.restored === 3 && seededCount === 3, excerpt(seeded.r))
  check(D, 'L-02b', 'foreign fixture row exists under nurse (abel)', '1', String(qCount('select count(*) c from notifications where id = ? and recipient_id = ?', [foreignId, users.nurse])), qCount('select count(*) c from notifications where id = ? and recipient_id = ?', [foreignId, users.nurse]) === 1)

  // --- list: only own rows
  const list = await call(nurse2, 'GET', '/api/notifications?limit=200')
  const listIds: string[] = (list.json?.data ?? []).map((n: any) => n.id)
  const allOwn = (list.json?.data ?? []).every((n: any) => n.userId === users.nurse2)
  const dbOwn = qCount('select count(*) c from notifications where recipient_id = ?', [users.nurse2])
  check(D, 'L-03', 'GET /api/notifications as nurse2 lists only rows with recipient_id = self and matches the DB count', `all own / ${dbOwn}`, `${allOwn} / ${listIds.length}`, list.status === 200 && allOwn && listIds.length === Math.min(dbOwn, 200) && seeded.ids.every((id) => listIds.includes(id)), excerpt(list))
  const pinned = await call(nurse2, 'GET', `/api/notifications?recipient_id=${users.nurse}&limit=200`)
  const pinnedOwn = (pinned.json?.data ?? []).every((n: any) => n.userId === users.nurse2) && !(pinned.json?.data ?? []).some((n: any) => n.id === foreignId)
  check(D, 'L-04', 'non-admin passing ?recipient_id=<other user> is pinned to own rows (index: recipient_id ignored for non-admins)', 'own rows only', `${pinned.status}/${pinnedOwn}`, pinned.status === 200 && pinnedOwn)
  const adminScoped = await call(ctx.superadmin, 'GET', `/api/notifications?recipient_id=${users.nurse2}&limit=200`)
  check(D, 'L-05', 'admin passing ?recipient_id=nurse2 sees nurse2 rows (index: admin may choose recipient)', 'contains seeded ids', String(seeded.ids.every((id) => (adminScoped.json?.data ?? []).some((n: any) => n.id === id))), adminScoped.status === 200 && seeded.ids.every((id) => (adminScoped.json?.data ?? []).some((n: any) => n.id === id)))
  const snapshot: Snapshot[] = (list.json?.data ?? []).filter((n: any) => seeded.ids.includes(n.id)).map((n: any) => ({
    id: n.id, userId: n.userId, type: n.type, title: n.title, message: n.message, createdAt: n.createdAt, readAt: n.readAt, relatedRoute: n.relatedRoute, relatedReportId: n.relatedReportId,
  }))

  // --- mark one read
  const one = seeded.ids[0]
  const read = await call(nurse2, 'PATCH', '/api/notifications/read', { data: { ids: [one] } })
  const readRow = notifRow(one)
  check(D, 'L-06', 'PATCH /notifications/read {ids:[own]} -> 200 updated=1, read_at set in DB', '200/1/set', `${read.status}/${read.json?.updated}/${readRow?.read_at}`, read.status === 200 && read.json?.updated === 1 && !!readRow?.read_at, excerpt(read))
  const readAgain = await call(nurse2, 'PATCH', '/api/notifications/read', { data: { ids: [one] } })
  const readRow2 = notifRow(one)
  check(D, 'L-07', 'marking an already-read row again keeps the original read_at (whereNull guard)', String(readRow?.read_at), String(readRow2?.read_at), readAgain.status === 200 && readRow2?.read_at === readRow?.read_at)
  const badIds = await call(nurse2, 'PATCH', '/api/notifications/read', { data: { ids: ['not-a-uuid'] } })
  const emptyIds = await call(nurse2, 'PATCH', '/api/notifications/read', { data: { ids: [] } })
  check(D, 'L-08', 'read with a non-uuid id or an empty list -> 422', '422/422', `${badIds.status}/${emptyIds.status}`, badIds.status === 422 && emptyIds.status === 422)

  // --- mark all read
  const readAll = await call(nurse2, 'PATCH', '/api/notifications/read-all')
  const unreadAfter = qCount('select count(*) c from notifications where recipient_id = ? and read_at is null', [users.nurse2])
  const foreignAfterReadAll = notifRow(foreignId)
  check(D, 'L-09', 'PATCH read-all -> 200; every own row read; foreign (nurse) row untouched', '200/0 unread/foreign unread', `${readAll.status}/${unreadAfter}/${foreignAfterReadAll?.read_at}`, readAll.status === 200 && unreadAfter === 0 && foreignAfterReadAll?.read_at === null, excerpt(readAll))

  // --- foreign ids in read / clear / restore as nurse2
  const foreignRead = await call(nurse2, 'PATCH', '/api/notifications/read', { data: { ids: [foreignId] } })
  let foreignRow = notifRow(foreignId)
  check(D, 'L-10', "read with a foreign id -> not matched (visibleNotificationQuery scopes to own rows): updated=0 and the nurse's row stays unread", 'updated 0 / unread', `${foreignRead.status} updated=${foreignRead.json?.updated} / read_at=${foreignRow?.read_at}`, foreignRead.json?.updated === 0 && foreignRow?.read_at === null && foreignRow?.recipient_id === users.nurse, excerpt(foreignRead))
  info(D, 'L-10i', 'HTTP status for a foreign id in read: the implementation answers 200 with updated=0 rather than 403/404 (row is filtered out before the policy runs)', String(foreignRead.status))
  const foreignClear = await call(nurse2, 'DELETE', '/api/notifications', { data: { ids: [foreignId] } })
  foreignRow = notifRow(foreignId)
  check(D, 'L-11', 'clear with a foreign id -> deleted=0 and the foreign row still exists', 'deleted 0 / row', `${foreignClear.status} deleted=${foreignClear.json?.deleted} / ${foreignRow ? 'row' : 'gone'}`, foreignClear.json?.deleted === 0 && !!foreignRow, excerpt(foreignClear))
  const mixedClear = await call(nurse2, 'DELETE', '/api/notifications', { data: { ids: [foreignId, seeded.ids[2]] } })
  foreignRow = notifRow(foreignId)
  const ownGone = notifRow(seeded.ids[2]) === null
  check(D, 'L-12', 'clear with [foreign, own] deletes only the own row', 'deleted 1 / foreign row kept / own gone', `${mixedClear.status} deleted=${mixedClear.json?.deleted} / ${foreignRow ? 'kept' : 'GONE'} / ${ownGone}`, mixedClear.json?.deleted === 1 && !!foreignRow && ownGone, excerpt(mixedClear))
  const foreignRestore = await call(nurse2, 'POST', '/api/notifications/restore', {
    data: { notifications: [{ id: foreignId, userId: users.nurse, type: 'qa_regression', title: `${PREFIX}hijack`, message: 'x', relatedRoute: '/' }] },
  })
  foreignRow = notifRow(foreignId)
  check(D, 'L-13', 'restore with a foreign userId as non-admin -> filtered out: restored=0, foreign row unchanged', 'restored 0 / title unchanged', `${foreignRestore.status} restored=${foreignRestore.json?.restored} / ${foreignRow?.title} / ${foreignRow?.recipient_id === users.nurse}`, foreignRestore.json?.restored === 0 && foreignRow?.title === `${PREFIX}${suffix} #1` && foreignRow?.recipient_id === users.nurse, excerpt(foreignRestore))
  const hijack = await call(nurse2, 'POST', '/api/notifications/restore', {
    data: { notifications: [{ id: foreignId, userId: users.nurse2, type: 'qa_regression', title: `${PREFIX}hijack2`, message: 'x', relatedRoute: '/' }] },
  })
  foreignRow = notifRow(foreignId)
  check(D, 'L-14', "restore with a foreign id under own userId -> refused (IDOR guard): restored=0, row keeps nurse as recipient", 'restored 0 / recipient nurse', `${hijack.status} restored=${hijack.json?.restored} / ${foreignRow?.recipient_id === users.nurse} / ${foreignRow?.title}`, hijack.json?.restored === 0 && foreignRow?.recipient_id === users.nurse && foreignRow?.title === `${PREFIX}${suffix} #1`, excerpt(hijack))

  // --- clear own, then restore from the snapshot
  const remainingOwn = seeded.ids.slice(0, 2)
  const clear = await call(nurse2, 'DELETE', '/api/notifications', { data: { ids: remainingOwn } })
  const afterClear = qCount(`select count(*) c from notifications where id in (${remainingOwn.map(() => '?').join(',')})`, remainingOwn)
  check(D, 'L-15', 'DELETE /notifications {ids} -> 200 deleted=2, rows hard-deleted (notifications has no deleted_at column)', '200/2/0 rows', `${clear.status}/${clear.json?.deleted}/${afterClear}`, clear.status === 200 && clear.json?.deleted === 2 && afterClear === 0, excerpt(clear))
  info(D, 'L-15i', 'notifications columns (no soft delete)', qAll<{ name: string }>('pragma table_info(notifications)').map((c) => c.name).join(','))

  const restore = await call(nurse2, 'POST', '/api/notifications/restore', { data: { notifications: snapshot } })
  const restoredRows = qAll<Record<string, any>>(`select id, recipient_id, title, read_at, related_route from notifications where id in (${seeded.ids.map(() => '?').join(',')})`, seeded.ids)
  const sameIds = seeded.ids.every((id) => restoredRows.some((r) => r.id === id && r.recipient_id === users.nurse2))
  check(D, 'L-16', 'POST /notifications/restore with the snapshot -> 200 restored=3, rows back with the SAME ids under nurse2, readAt/relatedRoute preserved', '200/3/same ids', `${restore.status}/${restore.json?.restored}/${sameIds}/${JSON.stringify(restoredRows.map((r) => [r.id.slice(0, 8), r.read_at !== null, r.related_route]))}`, restore.status === 200 && restore.json?.restored === 3 && sameIds && restoredRows.every((r) => r.related_route === '/notifications'), excerpt(restore))

  // --- batch limit
  const big = Array.from({ length: 51 }, (_, i) => ({ id: randomUUID(), userId: users.nurse2, type: 'qa_regression', title: `${PREFIX}${suffix} bulk ${i}`, message: 'bulk', relatedRoute: '/' }))
  const tooMany = await call(nurse2, 'POST', '/api/notifications/restore', { data: { notifications: big } })
  const bulkRows = qCount('select count(*) c from notifications where title like ?', [`${PREFIX}${suffix} bulk %`])
  check(D, 'L-17', 'restore with 51 notifications in one call -> 422 (max:50), nothing written', '422/0', `${tooMany.status}/${bulkRows}`, tooMany.status === 422 && bulkRows === 0, excerpt(tooMany))
  const fifty = await call(nurse2, 'POST', '/api/notifications/restore', { data: { notifications: big.slice(0, 50) } })
  const fiftyRows = qCount('select count(*) c from notifications where title like ?', [`${PREFIX}${suffix} bulk %`])
  check(D, 'L-18', 'restore with exactly 50 -> 200 restored=50', '200/50/50', `${fifty.status}/${fifty.json?.restored}/${fiftyRows}`, fifty.status === 200 && fifty.json?.restored === 50 && fiftyRows === 50, excerpt(fifty))
  createdIds.push(...big.slice(0, 50).map((n) => n.id))

  // --- deep link
  const adminList = await call(ctx.admin, 'GET', '/api/notifications?limit=200&type=action_item_assigned')
  const link = (adminList.json?.data ?? []).find((n: any) => n.relatedReportId === itemId)
  const target = await call(ctx.admin, 'GET', `/api/admin/action-items/${itemId}`)
  check(D, 'L-19', 'deep link: the assignee sees relatedRoute=/admin/action-items?item={id} and GET of that action item as the recipient -> 200', `route + 200`, `${link?.relatedRoute} / ${target.status}`, !!link && link.relatedRoute === `/admin/action-items?item=${itemId}` && link.relatedEntity === 'action_item' && target.status === 200 && target.json?.id === itemId)
  info(D, 'L-19i', 'deep link payload', JSON.stringify(link ?? null))
  const nurseInbox = await call(nurse, 'GET', '/api/notifications?limit=200')
  check(D, 'L-20', 'nurse (abel) inbox lists its own fixture row and none of nurse2 rows', 'own only', String((nurseInbox.json?.data ?? []).some((n: any) => n.id === foreignId) && !(nurseInbox.json?.data ?? []).some((n: any) => createdIds.includes(n.id))), nurseInbox.status === 200 && (nurseInbox.json?.data ?? []).some((n: any) => n.id === foreignId) && !(nurseInbox.json?.data ?? []).some((n: any) => createdIds.includes(n.id)))
})

test('M. workspace switching: preference is client-side; role and permissions never change', async () => {
  info(D, 'M-01', 'Workspace preference persistence: src/context/workspace-context.tsx stores the Clinical/Academic choice in localStorage ("stpaul:workspace") and derives it from the route; no API call, no users column (users table has no workspace column). Server-side the workspace only scopes list endpoints (?workspace= on /api/admin/users and /api/admin/admin-audit-logs).', 'client-side only', qAll<{ name: string }>('pragma table_info(users)').map((c) => c.name).filter((n) => /workspace/i.test(n)).join(',') || 'no workspace column on users')

  for (const [label, c, email] of [['admin', ctx.admin, EXTRA_ACCOUNTS.admin], ['superadmin', ctx.superadmin, EXTRA_ACCOUNTS.superadmin]] as const) {
    const me0 = await call(c, 'GET', '/api/auth/me')
    const clinical = await call(c, 'GET', '/api/admin/users?workspace=clinical&per_page=100')
    const me1 = await call(c, 'GET', '/api/auth/me')
    const academic = await call(c, 'GET', '/api/admin/users?workspace=academic&per_page=100')
    const auditAcademic = await call(c, 'GET', '/api/admin/admin-audit-logs?workspace=academic&per_page=5')
    const me2 = await call(c, 'GET', '/api/auth/me')
    const clinicalAgain = await call(c, 'GET', '/api/admin/users?workspace=clinical&per_page=100')
    const me3 = await call(c, 'GET', '/api/auth/me')
    const snaps = [me0, me1, me2, me3].map((m) => ({ role: m.json?.user?.role, permissions: [...(m.json?.permissions ?? [])].sort() }))
    const same = snaps.every((s) => s.role === snaps[0].role && JSON.stringify(s.permissions) === JSON.stringify(snaps[0].permissions))
    const dbRole = qOne<{ role_key: string }>('select role_key from users where email = ?', [email])?.role_key
    check(D, `M-02-${label}`, `${label}: role and permissions identical across Clinical -> Academic -> Clinical scoped requests, and role matches users.role_key`, `${dbRole} / identical`, `${snaps.map((s) => s.role).join(',')} / ${same} / ${snaps[0].permissions.length} permissions`, [me0, me1, me2, me3].every((m) => m.status === 200) && same && snaps[0].role === dbRole)
    const clinicalRoles = new Set((clinical.json?.data ?? []).map((u: any) => u.role))
    const academicRoles = new Set((academic.json?.data ?? []).map((u: any) => u.role))
    check(D, `M-03-${label}`, `${label}: ?workspace=clinical and ?workspace=academic rosters both 200 and scoped (nurse only in clinical, resident/consultant only in academic)`, 'scoped', `clinical=${[...clinicalRoles].join('|')} academic=${[...academicRoles].join('|')}`, clinical.status === 200 && academic.status === 200 && clinicalAgain.status === 200 && auditAcademic.status === 200 && clinicalRoles.has('nurse') && !clinicalRoles.has('resident') && !academicRoles.has('nurse') && (academicRoles.has('resident') || academicRoles.has('consultant')))
    check(D, `M-04-${label}`, `${label}: clinical roster identical before and after the academic switch`, 'same ids', String(JSON.stringify((clinical.json?.data ?? []).map((u: any) => u.id)) === JSON.stringify((clinicalAgain.json?.data ?? []).map((u: any) => u.id))), JSON.stringify((clinical.json?.data ?? []).map((u: any) => u.id)) === JSON.stringify((clinicalAgain.json?.data ?? []).map((u: any) => u.id)))
  }
  const bogus = await call(ctx.admin, 'GET', '/api/admin/users?workspace=bogus')
  check(D, 'M-05', 'admin ?workspace=bogus -> 422 (Rule::in(Workspaces::selectable()))', '422', String(bogus.status), bogus.status === 422, excerpt(bogus))
  const nurseSwitch = await call(ctx.nurse2, 'GET', '/api/admin/users?workspace=academic')
  const nurseAudit = await call(ctx.nurse2, 'GET', '/api/admin/admin-audit-logs?workspace=academic')
  const nurseMe = await call(ctx.nurse2, 'GET', '/api/auth/me')
  check(D, 'M-06', 'nurse hitting the workspace-scoped admin endpoints -> 403 (users.view / audit.view), and its own role stays nurse', '403/403/nurse', `${nurseSwitch.status}/${nurseAudit.status}/${nurseMe.json?.user?.role}`, nurseSwitch.status === 403 && nurseAudit.status === 403 && nurseMe.json?.user?.role === 'nurse')
})

test('cleanup: remove regression notifications, close the action item', async () => {
  if (createdIds.length) {
    for (let i = 0; i < createdIds.length; i += 50) {
      await call(ctx.nurse2, 'DELETE', '/api/notifications', { data: { ids: createdIds.slice(i, i + 50) } })
    }
  }
  if (foreignId) await call(ctx.nurse, 'DELETE', '/api/notifications', { data: { ids: [foreignId] } })
  const left = qCount('select count(*) c from notifications where title like ?', [`${PREFIX}${suffix}%`])
  if (itemId) {
    await call(ctx.superadmin, 'PATCH', `/api/admin/action-items/${itemId}`, { data: { status: 'resolved', resolution_note: `${PREFIX}cleanup` } })
    await call(ctx.superadmin, 'PATCH', `/api/admin/action-items/${itemId}`, { data: { status: 'closed' } })
    // the assignee notification of the fixture item belongs to admin; clear it too
    const assigneeNotif = qOne<{ id: string }>("select id from notifications where recipient_id = ? and related_id = ? and type = 'action_item_assigned'", [users.admin, itemId])
    if (assigneeNotif) await call(ctx.admin, 'DELETE', '/api/notifications', { data: { ids: [assigneeNotif.id] } })
  }
  info(D, 'cleanup', 'regression notifications removed; fixture action item closed (no delete endpoint)', `leftover QA rows=${left}, item=${itemId} status=${itemId ? qOne<{ status: string }>('select status from action_items where id = ?', [itemId])?.status : 'n/a'}`)
  expect(left).toBe(0)
})
