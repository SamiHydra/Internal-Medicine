/**
 * Business-rule regression: section transfers (T), duty roster (U), rotation
 * planning (V), undergraduate structure (W), structure administration (X).
 * Runs against the already-running dev stack; every mutation is re-read from
 * the SQLite database.
 *
 * Rules are cited from:
 *  - backend/routes/api.php (permission middleware: transfers.create / transfers.review /
 *    roster.manage / rotations.manage / students.manage / academicStructure.manage)
 *  - backend/app/Http/Controllers/Api/TransferRequestController.php (options, store, mine, cancel)
 *  - backend/app/Http/Controllers/Api/Admin/TransferRequestController.php (approve: immediate/effectiveOn)
 *  - backend/app/Services/Academic/TransferService.php (own-section 422, inactive 422, one pending 422,
 *    approve defaults to next month boundary, past effective date 422, apply only when effective <= today,
 *    cancel/approve only while pending, audit request/approve/cancel/apply)
 *  - backend/app/Policies/TransferRequestPolicy.php (decide = admin OR head of DESTINATION section, and
 *    only while pending; cancel = owner and pending)
 *  - backend/app/Services/Academic/RotationCalendarService.php (nextBoundaryAfter = 1st of next month;
 *    calendar_month blocks align to months)
 *  - backend/app/Http/Controllers/Api/Admin/DutyRosterController.php (saveMonth: exists:users, monthly
 *    types only, rotation-managed resident needs overrideReason, monthBounds 422; saveDaily: daily types
 *    only, date window 2020-01-01..now+2y, remove; audits save_roster_month / save_daily_duty)
 *  - backend/app/Services/Academic/RosterService.php (bulkAssign REPLACES: a monthly row carves the
 *    user's overlapping monthly window first, an identical daily row is refreshed in place)
 *  - backend/app/Http/Controllers/Api/Admin/RotationController.php (storeCalendar validation + unique
 *    year/label; savePlan: exists rules, active resident of the training year, block must belong to the
 *    calendar, monthly types only, confirmOverwrite when replacing non-planner coverage)
 *  - backend/app/Services/Academic/RotationPlanStateService.php (requiresOverwriteConfirmation)
 *  - backend/app/Http/Controllers/Api/Admin/UndergraduateAdminController.php (batch/student/import/
 *    placement/schedule/rep/session rules; DELETE on batch/student/schedule/rep DEACTIVATES;
 *    storePlacement re-points the same subgroup-week (201, never 500); schedule scope + duplicate 422;
 *    rep eligibility + one active assignment per user and per batch/scope; cancelSession needs reason)
 *  - backend/app/Services/Academic/TeachingService.php (generateSessions snapshots the placement ward on
 *    subgroup sessions only; record() requires a reason for cancelled)
 *  - backend/app/Http/Controllers/Api/Admin/AcademicStructureController.php (ward delete guard 422
 *    "Deactivate it instead" when referenced by duty types/departments/placements/sessions/evaluations;
 *    section delete guard 422 when referenced by duty types/consultants/transfer requests; duty type
 *    delete guard 422 when it has assignments; head must be an active consultant; set-consultant moves
 *    users.section_id directly and audits set_consultant_section)
 *  - backend/app/Policies/{Ward,Section,DutyType,DutyAssignment,RotationCalendar}Policy.php (admin-like only)
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { test, expect, type APIRequestContext } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'

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
  ACCOUNTS,
  QA_ACCOUNT_PASSWORD,
  OUTPUT_DIR,
  type Call,
} from './helpers'

const D = 'structure'
const PREFIX = 'QA_REG_STRUCT_'
/**
 * Playwright restarts the worker after a failed test, which would wipe the
 * module-level ids and skip every later test; the ids are mirrored to disk
 * after each test and reloaded when a fresh worker picks the file up.
 */
const STATE_FILE = path.join(OUTPUT_DIR, 'structure-state.json')

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
const todayNairobi = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Nairobi' })
const nextMonthStart = (iso: string) => {
  const [y, m] = iso.split('-').map(Number)
  return new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10)
}

let suffix = uniqueSuffix()
const ctx: Record<string, APIRequestContext> = {}
const IDENT: Record<string, string> = {
  admin: EXTRA_ACCOUNTS.admin,
  consultant: ACCOUNTS.consultant.identifier,
  nurse: EXTRA_ACCOUNTS.nurse,
  resident: EXTRA_ACCOUNTS.resident,
}
/** Cached session for a role key or an explicit identifier (re-created after a worker restart from the cached storage state). */
async function use(key: string): Promise<APIRequestContext> {
  const identifier = IDENT[key] ?? key
  ctx[identifier] ??= await apiAs(identifier)
  return ctx[identifier]
}
function saveState(): void {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true })
  fs.writeFileSync(STATE_FILE, JSON.stringify({ suffix, dbReads, ids }))
}
function loadState(): void {
  if (ids.ward || !fs.existsSync(STATE_FILE)) return
  const saved = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
  suffix = saved.suffix
  dbReads = saved.dbReads ?? 0
  Object.assign(ids, saved.ids)
}

type SectionRow = { id: string; name: string; slug: string; head_user_id: string | null; active: number }
type UserRow = { id: string; email: string; role_key: string; section_id: string | null; training_year: number | null }

const ids = {
  admin: '',
  nurse: '',
  resident: '',
  consultant: '',
  consultantSection: '',
  destSection: '',
  destSectionName: '',
  destHeadEmail: '',
  otherHeadEmail: '',
  otherHeadId: '',
  plainConsultant: '',
  plainConsultantSection: '',
  plainConsultantEmail: '',
  // seeded catalog
  cardioWardService: '',
  onCallDaily: '',
  opd: '',
  transitionDaily: '',
  seededCalendarY1: '',
  seededBlockY1: '',
  // created
  ward: '',
  section: '',
  dutyType: '',
  req1: '',
  req2: '',
  req3: '',
  calendar: '',
  block1: '',
  block2: '',
  batch: '',
  student: '',
  placement: '',
  schedule: '',
  repUser: '',
  rep: '',
  cancelledSession: '',
}

test.beforeAll(async () => {
  await flushRateLimits()
})

test.beforeEach(() => loadState())
test.afterEach(() => saveState())

test.afterAll(async () => {
  await Promise.all(Object.values(ctx).map((c) => c.dispose().catch(() => undefined)))
})

// ------------------------------------------------------------------ setup

test('setup: resolve seeded actors, create QA ward/section/duty type (X create rules)', async () => {
  // A fresh run: findings and the state mirror start empty (a worker restart never re-runs this test).
  resetFindings(D)
  fs.rmSync(STATE_FILE, { force: true })
  suffix = uniqueSuffix()
  dbReads = 0

  const users = qAll<UserRow>(
    'select id,email,role_key,section_id,training_year from users where email in (?,?,?,?)',
    [EXTRA_ACCOUNTS.admin, EXTRA_ACCOUNTS.nurse, EXTRA_ACCOUNTS.resident, ACCOUNTS.consultant.identifier],
  )
  const byEmail = (e: string) => users.find((u) => u.email === e)
  ids.admin = byEmail(EXTRA_ACCOUNTS.admin)?.id ?? ''
  ids.nurse = byEmail(EXTRA_ACCOUNTS.nurse)?.id ?? ''
  ids.resident = byEmail(EXTRA_ACCOUNTS.resident)?.id ?? ''
  const consultant = byEmail(ACCOUNTS.consultant.identifier)
  ids.consultant = consultant?.id ?? ''
  ids.consultantSection = consultant?.section_id ?? ''
  expect(ids.admin && ids.nurse && ids.resident && ids.consultant && ids.consultantSection).toBeTruthy()

  const sections = qAll<SectionRow>('select id,name,slug,head_user_id,active from sections where active=1 order by name')
  const dest = sections.find((s) => s.id !== ids.consultantSection && s.head_user_id && s.head_user_id !== ids.consultant)
  expect(dest).toBeTruthy()
  ids.destSection = dest!.id
  ids.destSectionName = dest!.name
  ids.destHeadEmail = qOne<{ email: string }>('select email from users where id=?', [dest!.head_user_id])?.email ?? ''
  // A consultant who heads a section but NOT the destination: the from-section head when it exists.
  const other = sections.find((s) => s.id !== dest!.id && s.head_user_id && s.head_user_id !== ids.consultant)
  const otherHead = qOne<{ id: string; email: string }>('select id,email from users where id=?', [other!.head_user_id])
  ids.otherHeadEmail = otherHead?.email ?? ''
  ids.otherHeadId = otherHead?.id ?? ''
  // A plain consultant (no headship) for set-consultant / head assignment; restored afterwards.
  const plain = qOne<UserRow>(
    `select id,email,role_key,section_id,training_year from users
     where role_key='consultant' and active=1 and section_id is not null and id<>?
       and id not in (select head_user_id from sections where head_user_id is not null)
       and (email like '%@stpaulhospital.demo' or email like 'demo.%@stpaulos.local') order by email limit 1`,
    [ids.consultant],
  )
  ids.plainConsultant = plain?.id ?? ''
  ids.plainConsultantSection = plain?.section_id ?? ''
  ids.plainConsultantEmail = plain?.email ?? ''
  expect(ids.destHeadEmail && ids.otherHeadEmail && ids.plainConsultant).toBeTruthy()

  const dt = (slug: string) => qOne<{ id: string }>('select id from duty_types where slug=? and active=1', [slug])?.id ?? ''
  ids.cardioWardService = dt('cardiology_ward_service')
  ids.onCallDaily = dt('cardiology_on_call')
  ids.opd = dt('opd')
  ids.transitionDaily = dt('transition_ward_duty')
  expect(ids.cardioWardService && ids.onCallDaily && ids.opd && ids.transitionDaily).toBeTruthy()

  const cal = qOne<{ id: string }>('select id from rotation_calendars where training_year=1 and active=1 order by starts_on limit 1')
  ids.seededCalendarY1 = cal?.id ?? ''
  ids.seededBlockY1 = qOne<{ id: string }>('select id from rotation_blocks where calendar_id=? order by block_index limit 1', [ids.seededCalendarY1])?.id ?? ''
  expect(ids.seededCalendarY1 && ids.seededBlockY1).toBeTruthy()

  info(
    D,
    'SETUP',
    'Actors',
    `consultant=${ACCOUNTS.consultant.identifier} section=${ids.consultantSection}; destination=${ids.destSectionName} head=${ids.destHeadEmail}; non-destination head=${ids.otherHeadEmail}; plain consultant=${ids.plainConsultantEmail}; admin=${EXTRA_ACCOUNTS.admin} (role admin)`,
  )

  const admin = await use('admin')
  const consultantApi = await use('consultant')

  // Leave no pending request from an aborted earlier run in the way of the one-pending rule.
  const stale = qAll<{ id: string }>("select id from transfer_requests where user_id=? and status='pending'", [ids.consultant])
  for (const row of stale) {
    const r = await call(consultantApi, 'POST', `/api/academic/transfer-requests/${row.id}/cancel`)
    info(D, 'SETUP-STALE', 'Cancelled a stale pending transfer request left by an earlier run', excerpt(r))
  }
  // Best-effort sweep of unreferenced structure rows an aborted earlier run left behind (deletes refused by a guard are left alone).
  for (const row of qAll<{ id: string }>('select id from duty_types where name like ?', [`${PREFIX}%`])) {
    await call(admin, 'DELETE', `/api/admin/academic/duty-types/${row.id}`)
  }
  for (const row of qAll<{ id: string }>('select id from wards where name like ?', [`${PREFIX}%`])) {
    await call(admin, 'DELETE', `/api/admin/academic/wards/${row.id}`)
  }
  for (const row of qAll<{ id: string }>('select id from sections where name like ? and active=1', [`${PREFIX}%`])) {
    if ((await call(admin, 'DELETE', `/api/admin/academic/sections/${row.id}`)).status !== 204) {
      await call(admin, 'PATCH', `/api/admin/academic/sections/${row.id}`, { data: { active: false, headUserId: null } })
    }
  }

  // ---- X: create rules (admin role, academicStructure.manage) ----
  const ward = await call(admin, 'POST', '/api/admin/academic/wards', { data: { name: `${PREFIX}Ward ${suffix}` } })
  ids.ward = ward.json?.id ?? ''
  const wardRow = qOne('select id,name,slug,active from wards where id=?', [ids.ward])
  const wardAudit = qOne("select user_id from admin_audit_logs where action='create' and entity_type='ward' and entity_id=?", [ids.ward])
  check(D, 'X1', 'Admin (role admin) creates a ward: 201, row active, audit create/ward by actor (AcademicStructureController::storeWard)',
    '201 + wards row + audit row', `${ward.status}; row=${JSON.stringify(wardRow)}; audit.user_id=${wardAudit?.user_id}`,
    ward.status === 201 && !!wardRow && wardRow.active === 1 && wardAudit?.user_id === ids.admin, excerpt(ward))

  const section = await call(admin, 'POST', '/api/admin/academic/sections', { data: { name: `${PREFIX}Section ${suffix}` } })
  ids.section = section.json?.id ?? ''
  const sectionRow = qOne<SectionRow>('select id,name,slug,head_user_id,active from sections where id=?', [ids.section])
  check(D, 'X2', 'Admin creates a section: 201, row active with no head (storeSection)',
    '201 + sections row', `${section.status}; row=${JSON.stringify(sectionRow)}`,
    section.status === 201 && !!sectionRow && sectionRow.active === 1 && sectionRow.head_user_id === null, excerpt(section))

  const dutyType = await call(admin, 'POST', '/api/admin/academic/duty-types', {
    data: { name: `${PREFIX}On Call ${suffix}`, category: 'on_call', granularity: 'daily', sectionId: ids.section },
  })
  ids.dutyType = dutyType.json?.id ?? ''
  const dtRow = qOne('select id,section_id,category,granularity,active from duty_types where id=?', [ids.dutyType])
  check(D, 'X3', 'Admin creates a daily duty type bound to the QA section: 201 + row (storeDutyType)',
    '201 + duty_types row (daily, on_call, section_id=QA)', `${dutyType.status}; row=${JSON.stringify(dtRow)}`,
    dutyType.status === 201 && dtRow?.granularity === 'daily' && dtRow?.section_id === ids.section, excerpt(dutyType))
})

// ------------------------------------------------------------------ T: transfers

test('T: section transfer request, one-pending rule, designation of the reviewer, scheduled approval, cancellation', async () => {
  test.skip(!ids.section, 'setup did not produce a QA section')
  const consultant = await use('consultant')
  const admin = await use('admin')
  const destHead = await use(ids.destHeadEmail)
  const otherHead = await use(ids.otherHeadEmail)

  const options = await call(consultant, 'GET', '/api/academic/transfer-requests/options')
  const optionIds: string[] = (options.json?.sections ?? []).map((s: any) => s.id)
  check(D, 'T1', 'Options list the current section and exclude it from the destinations (TransferRequestController::formOptions)',
    `200, currentSectionId=${ids.consultantSection}, own section absent, destination present`,
    `${options.status} current=${options.json?.currentSectionId} own-in-list=${optionIds.includes(ids.consultantSection)} dest-in-list=${optionIds.includes(ids.destSection)}`,
    options.status === 200 && options.json?.currentSectionId === ids.consultantSection && !optionIds.includes(ids.consultantSection) && optionIds.includes(ids.destSection),
    excerpt(options))

  const own = await call(consultant, 'POST', '/api/academic/transfer-requests', { data: { toSectionId: ids.consultantSection, reason: `${PREFIX}own` } })
  check(D, 'T2', 'A request into the consultant\'s OWN section is refused (TransferService::request "You already belong to this section.")',
    '422', excerpt(own), own.status === 422 && /already belong/i.test(own.text))

  const req1 = await call(consultant, 'POST', '/api/academic/transfer-requests', { data: { toSectionId: ids.destSection, reason: `${PREFIX}req1 ${suffix}` } })
  ids.req1 = req1.json?.id ?? ''
  const req1Row = qOne('select id,user_id,from_section_id,to_section_id,status,effective_on,applied_at from transfer_requests where id=?', [ids.req1])
  const reqAudit = qOne("select user_id from admin_audit_logs where action='request' and entity_type='transfer_request' and entity_id=?", [ids.req1])
  check(D, 'T3', 'A request into another active section is created pending with from/to snapshot and an audit row "request" by the consultant (TransferService::request)',
    '201 + row status=pending from=own to=dest, audit by consultant',
    `${req1.status}; row=${JSON.stringify(req1Row)}; audit.user_id=${reqAudit?.user_id}`,
    req1.status === 201 && req1Row?.status === 'pending' && req1Row?.from_section_id === ids.consultantSection && req1Row?.to_section_id === ids.destSection && req1Row?.effective_on === null && reqAudit?.user_id === ids.consultant,
    excerpt(req1))
  info(D, 'T3-INFO', 'The store endpoint accepts no effective date; the date is fixed at approval (effectiveOn/immediate) and defaults to the next month boundary',
    `effective_on after store = ${req1Row?.effective_on}`)

  const otherSection = qOne<SectionRow>('select id from sections where active=1 and id not in (?,?,?) limit 1', [ids.consultantSection, ids.destSection, ids.section])
  const dup = await call(consultant, 'POST', '/api/academic/transfer-requests', { data: { toSectionId: otherSection?.id ?? ids.destSection } })
  check(D, 'T4', 'A second request while one is pending is refused (one pending per consultant)',
    '422 "already have a pending transfer request"', excerpt(dup),
    dup.status === 422 && /pending transfer request/i.test(dup.text) && qCount("select count(*) c from transfer_requests where user_id=? and status='pending'", [ids.consultant]) === 1)

  const mine = await call(consultant, 'GET', '/api/academic/transfer-requests/mine')
  const mineIds: string[] = (mine.json?.data ?? []).map((r: any) => r.id)
  check(D, 'T5', 'GET /mine lists the consultant\'s own request (TransferRequestController::mine)', 'contains req1',
    `${mine.status} ids=${mineIds.length} hasReq1=${mineIds.includes(ids.req1)}`, mine.status === 200 && mineIds.includes(ids.req1), excerpt(mine))

  const wrongApprove = await call(otherHead, 'POST', `/api/admin/transfer-requests/${ids.req1}/approve`)
  check(D, 'T6', 'A consultant who heads a DIFFERENT section (not the destination) cannot approve (TransferRequestPolicy::decide)',
    '403, row still pending', `${excerpt(wrongApprove)}; status=${qOne('select status from transfer_requests where id=?', [ids.req1])?.status}`,
    wrongApprove.status === 403 && qOne('select status from transfer_requests where id=?', [ids.req1])?.status === 'pending')

  const wrongCancel = await call(otherHead, 'POST', `/api/academic/transfer-requests/${ids.req1}/cancel`)
  check(D, 'T7', 'Only the author can cancel (TransferRequestPolicy::cancel)', '403', excerpt(wrongCancel), wrongCancel.status === 403)

  const cancel1 = await call(consultant, 'POST', `/api/academic/transfer-requests/${ids.req1}/cancel`)
  const cancelRow = qOne('select status,decided_at,decided_by from transfer_requests where id=?', [ids.req1])
  const cancelAudit = qCount("select count(*) c from admin_audit_logs where action='cancel' and entity_type='transfer_request' and entity_id=?", [ids.req1])
  check(D, 'T8', 'The author cancels a pending request: 200, status cancelled, decided_at stamped, one audit "cancel" (TransferService::cancel)',
    '200 + cancelled + 1 audit row', `${cancel1.status}; row=${JSON.stringify(cancelRow)}; auditRows=${cancelAudit}`,
    cancel1.status === 200 && cancel1.json?.status === 'cancelled' && cancelRow?.status === 'cancelled' && cancelRow?.decided_at !== null && cancelAudit === 1, excerpt(cancel1))

  const cancelAgain = await call(consultant, 'POST', `/api/academic/transfer-requests/${ids.req1}/cancel`)
  check(D, 'T9', 'Cancelling a non-pending request is refused by the policy (cancel requires isPending)', '403', excerpt(cancelAgain), cancelAgain.status === 403)

  const req2 = await call(consultant, 'POST', '/api/academic/transfer-requests', { data: { toSectionId: ids.destSection, reason: `${PREFIX}req2 ${suffix}` } })
  ids.req2 = req2.json?.id ?? ''
  check(D, 'T10', 'After the cancellation a new request can be filed (the pending slot is free again)', '201 pending',
    `${req2.status} status=${qOne('select status from transfer_requests where id=?', [ids.req2])?.status}`, req2.status === 201 && !!ids.req2, excerpt(req2))

  const queue = await call(destHead, 'GET', '/api/admin/transfer-requests?status=pending')
  const queueIds: string[] = (queue.json?.data ?? []).map((r: any) => r.id)
  check(D, 'T11', 'The destination head sees the request in the review queue (AdminTransferRequestController::index scoped to headed sections)',
    'contains req2', `${queue.status} hasReq2=${queueIds.includes(ids.req2)}`, queue.status === 200 && queueIds.includes(ids.req2), excerpt(queue))

  const past = await call(destHead, 'POST', `/api/admin/transfer-requests/${ids.req2}/approve`, { data: { effectiveOn: '2020-01-01' } })
  check(D, 'T12', 'Approval with an effective date in the past is refused (TransferService::approve)', '422 "cannot be in the past"',
    excerpt(past), past.status === 422 && /past/i.test(past.text) && qOne('select status from transfer_requests where id=?', [ids.req2])?.status === 'pending')

  const today = todayNairobi()
  const expectedBoundary = nextMonthStart(today)
  const sectionBefore = qOne('select section_id from users where id=?', [ids.consultant])?.section_id
  const approve = await call(destHead, 'POST', `/api/admin/transfer-requests/${ids.req2}/approve`)
  const approvedRow = qOne('select status,decided_by,decided_at,effective_on,applied_at from transfer_requests where id=?', [ids.req2])
  const sectionAfter = qOne('select section_id from users where id=?', [ids.consultant])?.section_id
  const destHeadId = qOne<{ id: string }>('select id from users where email=?', [ids.destHeadEmail])?.id
  const approveAudit = qCount("select count(*) c from admin_audit_logs where action='approve' and entity_type='transfer_request' and entity_id=?", [ids.req2])
  check(D, 'T13', 'The DESTINATION head approves: 200, status approved, decided_by=head, effective_on defaults to the 1st of next month, applied_at null, users.section_id UNCHANGED until the effective date (TransferService::approve + RotationCalendarService::nextBoundaryAfter)',
    `200; approved; effective_on=${expectedBoundary}; applied_at=null; section stays ${sectionBefore}`,
    `${approve.status}; row=${JSON.stringify(approvedRow)}; section before=${sectionBefore} after=${sectionAfter}; auditRows=${approveAudit}`,
    approve.status === 200 && approvedRow?.status === 'approved' && approvedRow?.decided_by === destHeadId && String(approvedRow?.effective_on ?? '').startsWith(expectedBoundary) && approvedRow?.applied_at === null && sectionAfter === sectionBefore && approveAudit === 1,
    excerpt(approve))
  info(D, 'T13-INFO', 'Scheduled application: the approved request stays approved/unapplied until transfers:apply-due runs on or after effective_on; the seeded consultant keeps its section for now. No API cancels an approved request, so this row remains in the dev fixture (same shape as the fixture\'s own seeded approved/unapplied transfer).',
    `req2=${ids.req2} effective_on=${approvedRow?.effective_on}`)

  const approveAgain = await call(admin, 'POST', `/api/admin/transfer-requests/${ids.req2}/approve`)
  check(D, 'T14', 'A decision on a request that is no longer pending is refused by the policy (decide requires isPending), even for an admin',
    '403', excerpt(approveAgain), approveAgain.status === 403)

  const cancelApproved = await call(consultant, 'POST', `/api/academic/transfer-requests/${ids.req2}/cancel`)
  check(D, 'T15', 'The author cannot cancel an already approved request (policy: pending only); row stays approved', '403 + approved',
    `${excerpt(cancelApproved)}; status=${qOne('select status from transfer_requests where id=?', [ids.req2])?.status}`,
    cancelApproved.status === 403 && qOne('select status from transfer_requests where id=?', [ids.req2])?.status === 'approved')

  const nurseStore = await call(await use('nurse'), 'POST', '/api/academic/transfer-requests', { data: { toSectionId: ids.destSection } })
  check(D, 'T16', 'A nurse cannot file a transfer request (permission transfers.create / policy create = consultant)', '403', excerpt(nurseStore), nurseStore.status === 403)
})

// ------------------------------------------------------------------ U: roster

test('U: duty roster month save, validation, replace semantics, daily strip, authorization, audit', async () => {
  const admin = await use('admin')
  const month = '/api/admin/roster/2026/10'

  const before = qCount("select count(*) c from duty_assignments where user_id=? and starts_on<='2026-10-31' and ends_on>='2026-10-01'", [ids.consultant])
  const read = await call(admin, 'GET', month)
  check(D, 'U1', 'GET a roster month returns the people grid with bounds (DutyRosterController::month)', '200, startsOn 2026-10-01, endsOn 2026-10-31, people[]',
    `${read.status} ${read.json?.startsOn}..${read.json?.endsOn} people=${read.json?.people?.length}`,
    read.status === 200 && read.json?.startsOn === '2026-10-01' && read.json?.endsOn === '2026-10-31' && Array.isArray(read.json?.people), excerpt(read))
  info(D, 'U1-INFO', 'Consultant monthly rows overlapping Oct 2026 before the spec wrote anything', String(before))

  const save = await call(admin, 'PUT', month, { data: { assignments: [{ userId: ids.consultant, dutyTypeId: ids.cardioWardService }] } })
  const rows = qAll('select duty_type_id,starts_on,ends_on,source,created_by from duty_assignments where user_id=? and starts_on<=\'2026-10-31\' and ends_on>=\'2026-10-01\'', [ids.consultant])
  const monthAudit = qOne("select user_id,new_values from admin_audit_logs where action='save_roster_month' and entity_type='duty_roster' and entity_id='2026-10' order by rowid desc limit 1")
  check(D, 'U2', 'PUT month with a monthly duty type writes one duty_assignments row spanning the month (source admin, created_by actor) and audits save_roster_month with entity_id YYYY-MM',
    '200 + 1 row 2026-10-01..2026-10-31 source=admin + audit by admin',
    `${save.status}; rows=${JSON.stringify(rows)}; audit=${JSON.stringify(monthAudit)}`,
    save.status === 200 && rows.length === 1 && String(rows[0].starts_on).startsWith('2026-10-01') && String(rows[0].ends_on).startsWith('2026-10-31') && rows[0].source === 'admin' && rows[0].created_by === ids.admin && monthAudit?.user_id === ids.admin,
    excerpt(save))

  const badUser = await call(admin, 'PUT', month, { data: { assignments: [{ userId: 'no-such-user', dutyTypeId: ids.cardioWardService }] } })
  check(D, 'U3', 'An unknown user id fails validation (exists:users,id)', '422', excerpt(badUser), badUser.status === 422)

  const badType = await call(admin, 'PUT', month, { data: { assignments: [{ userId: ids.consultant, dutyTypeId: 'no-such-type' }] } })
  check(D, 'U4', 'An unknown duty type id fails validation (exists:duty_types,id)', '422', excerpt(badType), badType.status === 422)

  const dailyInMonth = await call(admin, 'PUT', month, { data: { assignments: [{ userId: ids.consultant, dutyTypeId: ids.transitionDaily }] } })
  check(D, 'U5', 'A month cell rejects a daily-granularity duty type (assertMonthlyTypes)', '422 "Month cells only accept monthly duty types"', excerpt(dailyInMonth),
    dailyInMonth.status === 422 && /monthly duty types/i.test(dailyInMonth.text))

  const twice = await call(admin, 'PUT', month, { data: { assignments: [
    { userId: ids.consultant, dutyTypeId: ids.cardioWardService },
    { userId: ids.consultant, dutyTypeId: ids.opd },
  ] } })
  const twiceRows = qAll('select duty_type_id from duty_assignments where user_id=? and starts_on<=\'2026-10-31\' and ends_on>=\'2026-10-01\'', [ids.consultant])
  check(D, 'U6', 'The same person twice in one month payload is not rejected: bulkAssign carves the overlapping monthly window per row, so the LAST entry wins and one row remains (RosterService::bulkAssign)',
    '200 + exactly 1 row = last duty type (opd)', `${twice.status}; rows=${JSON.stringify(twiceRows)}`,
    twice.status === 200 && twiceRows.length === 1 && twiceRows[0].duty_type_id === ids.opd, excerpt(twice))

  const overwrite = await call(admin, 'PUT', month, { data: { assignments: [{ userId: ids.consultant, dutyTypeId: ids.cardioWardService }] } })
  const owRows = qAll('select duty_type_id from duty_assignments where user_id=? and starts_on<=\'2026-10-31\' and ends_on>=\'2026-10-01\'', [ids.consultant])
  check(D, 'U7', 'A second PUT for the same month REPLACES the cell without a confirmation flag (no confirm/overwrite parameter on the roster; RosterTest "replaces rather than rejects")',
    '200 + 1 row with the new duty type', `${overwrite.status}; rows=${JSON.stringify(owRows)}`,
    overwrite.status === 200 && owRows.length === 1 && owRows[0].duty_type_id === ids.cardioWardService, excerpt(overwrite))

  const noReason = await call(admin, 'PUT', month, { data: { assignments: [{ userId: ids.resident, dutyTypeId: ids.opd }] } })
  const residentRows = qCount("select count(*) c from duty_assignments where user_id=? and starts_on<='2026-10-31' and ends_on>='2026-10-01' and source='admin'", [ids.resident])
  check(D, 'U8', 'A rotation-managed resident (active calendar block covers the month) needs overrideReason on a month save',
    '422 assignments.0.overrideReason, no admin row written', `${excerpt(noReason)}; adminRows=${residentRows}`,
    noReason.status === 422 && /overrideReason/.test(noReason.text) && residentRows === 0)

  const badMonth = await call(admin, 'GET', '/api/admin/roster/2026/13')
  check(D, 'U9', 'Month 13 is refused (monthBounds)', '422 "Invalid roster month"', excerpt(badMonth), badMonth.status === 422)

  const day32 = await call(admin, 'POST', '/api/admin/roster/daily', { data: { userId: ids.consultant, dutyTypeId: ids.onCallDaily, date: '2026-10-32' } })
  check(D, 'U10', 'Daily strip: day 32 is not a date (validation)', '422', excerpt(day32), day32.status === 422)

  const farFuture = await call(admin, 'POST', '/api/admin/roster/daily', { data: { userId: ids.consultant, dutyTypeId: ids.onCallDaily, date: '2031-01-01' } })
  check(D, 'U11', 'Daily strip: a date beyond now+2 years is outside the planning window', '422 on date', excerpt(farFuture), farFuture.status === 422 && /date/i.test(farFuture.text))

  const monthlyOnStrip = await call(admin, 'POST', '/api/admin/roster/daily', { data: { userId: ids.consultant, dutyTypeId: ids.opd, date: '2026-10-15' } })
  check(D, 'U12', 'Daily strip rejects a monthly duty type', '422 "Only day-level duty types"', excerpt(monthlyOnStrip), monthlyOnStrip.status === 422 && /day-level/i.test(monthlyOnStrip.text))

  const daily = await call(admin, 'POST', '/api/admin/roster/daily', { data: { userId: ids.consultant, dutyTypeId: ids.onCallDaily, date: '2026-10-15' } })
  const dailyRows = qAll('select starts_on,ends_on,source from duty_assignments where user_id=? and duty_type_id=? and date(starts_on)=\'2026-10-15\'', [ids.consultant, ids.onCallDaily])
  const dailyAudit = qOne("select user_id,entity_id from admin_audit_logs where action='save_daily_duty' and entity_type='duty_roster' and entity_id=? order by rowid desc limit 1", [ids.consultant])
  check(D, 'U13', 'Daily strip writes a one-day row and audits save_daily_duty with the person as entity_id', '201 + 1 row 2026-10-15..2026-10-15 + audit by admin',
    `${daily.status}; rows=${JSON.stringify(dailyRows)}; audit=${JSON.stringify(dailyAudit)}`,
    daily.status === 201 && dailyRows.length === 1 && String(dailyRows[0].ends_on).startsWith('2026-10-15') && dailyAudit?.user_id === ids.admin, excerpt(daily))

  const dailyAgain = await call(admin, 'POST', '/api/admin/roster/daily', { data: { userId: ids.consultant, dutyTypeId: ids.onCallDaily, date: '2026-10-15' } })
  const dailyAgainRows = qCount('select count(*) c from duty_assignments where user_id=? and duty_type_id=? and date(starts_on)=\'2026-10-15\'', [ids.consultant, ids.onCallDaily])
  check(D, 'U14', 'Re-saving the identical daily row refreshes it in place (no duplicate)', '201 + still 1 row', `${dailyAgain.status}; rows=${dailyAgainRows}`,
    dailyAgain.status === 201 && dailyAgainRows === 1, excerpt(dailyAgain))

  const monthlyStillThere = qCount("select count(*) c from duty_assignments where user_id=? and duty_type_id=? and date(starts_on)='2026-10-01'", [ids.consultant, ids.cardioWardService])
  check(D, 'U15', 'A daily duty stacks on top of the monthly service row (daily rows do not carve monthly ones)', 'monthly row still present', `count=${monthlyStillThere}`, monthlyStillThere === 1)

  const nurseRead = await call(await use('nurse'), 'GET', month)
  const residentCtx = await use('resident')
  const residentWrite = await call(residentCtx, 'PUT', month, { data: { assignments: [{ userId: ids.resident, dutyTypeId: ids.opd }] } })
  const residentDaily = await call(residentCtx, 'POST', '/api/admin/roster/daily', { data: { userId: ids.resident, dutyTypeId: ids.onCallDaily, date: '2026-10-15' } })
  check(D, 'U16', 'Nurse GET / resident PUT / resident daily are all forbidden (permission roster.manage)', '403/403/403',
    `${nurseRead.status}/${residentWrite.status}/${residentDaily.status}`, nurseRead.status === 403 && residentWrite.status === 403 && residentDaily.status === 403)

  // Cleanup of the consultant's October: remove the daily row, clear the month cell.
  const remove = await call(admin, 'POST', '/api/admin/roster/daily', { data: { userId: ids.consultant, dutyTypeId: ids.onCallDaily, date: '2026-10-15', remove: true } })
  const clear = await call(admin, 'PUT', month, { data: { assignments: [{ userId: ids.consultant, dutyTypeId: null }] } })
  const after = qCount("select count(*) c from duty_assignments where user_id=? and starts_on<='2026-10-31' and ends_on>='2026-10-01'", [ids.consultant])
  check(D, 'U17', 'Cleanup: remove:true deletes the daily row and a null dutyTypeId clears the month cell (carveMonthlyWindow)', `removed=true, 200, ${before} rows left`,
    `${remove.status} ${remove.json?.removed} / ${clear.status}; rows=${after}`, remove.status === 200 && remove.json?.removed === true && clear.status === 200 && after === before)
})

// ------------------------------------------------------------------ V: rotations

test('V: rotation calendars, plan validation, overwrite confirmation, isolation of other calendars, active toggle, authorization', async () => {
  const admin = await use('admin')
  const consultant = await use('consultant')
  const seededBlocksBefore = qCount('select count(*) c from rotation_blocks where calendar_id=?', [ids.seededCalendarY1])
  const otherAssignmentsBefore = qCount('select count(*) c from duty_assignments where user_id not in (?,?)', [ids.resident, ids.consultant])

  const list = await call(admin, 'GET', '/api/admin/rotations/calendars')
  check(D, 'V1', 'GET calendars lists calendars with their blocks (RotationController::calendars)', '200 + data[] with blocks',
    `${list.status} count=${list.json?.data?.length}`, list.status === 200 && Array.isArray(list.json?.data) && list.json.data.some((c: any) => c.id === ids.seededCalendarY1), excerpt(list))

  const label = `${PREFIX}${suffix}`
  const create = await call(admin, 'POST', '/api/admin/rotations/calendars', {
    data: { trainingYear: 1, academicYearLabel: label, startsOn: '2027-01-01', blockKind: 'calendar_month', blocksCount: 2 },
  })
  ids.calendar = create.json?.id ?? ''
  const calRow = qOne('select training_year,academic_year_label,starts_on,block_kind,blocks_count,active from rotation_calendars where id=?', [ids.calendar])
  const blocks = qAll<{ id: string; block_index: number; starts_on: string; ends_on: string }>('select id,block_index,starts_on,ends_on from rotation_blocks where calendar_id=? order by block_index', [ids.calendar])
  ids.block1 = blocks[0]?.id ?? ''
  ids.block2 = blocks[1]?.id ?? ''
  const calAudit = qOne("select user_id from admin_audit_logs where action='create' and entity_type='rotation_calendar' and entity_id=?", [ids.calendar])
  check(D, 'V2', 'POST calendar creates it active with month-aligned blocks and audits create/rotation_calendar (storeCalendar + RotationCalendarService::generateBlocks)',
    '201; 2 blocks 2027-01-01..01-31 and 02-01..02-28; audit by admin',
    `${create.status}; cal=${JSON.stringify(calRow)}; blocks=${JSON.stringify(blocks)}; audit=${calAudit?.user_id}`,
    create.status === 201 && calRow?.active === 1 && blocks.length === 2 && String(blocks[0]?.ends_on).startsWith('2027-01-31') && String(blocks[1]?.starts_on).startsWith('2027-02-01') && String(blocks[1]?.ends_on).startsWith('2027-02-28') && calAudit?.user_id === ids.admin,
    excerpt(create))

  const dupCal = await call(admin, 'POST', '/api/admin/rotations/calendars', {
    data: { trainingYear: 1, academicYearLabel: label, startsOn: '2027-01-01', blockKind: 'calendar_month', blocksCount: 2 },
  })
  check(D, 'V3', 'A second calendar for the same training year + label is refused', '422 academicYearLabel', excerpt(dupCal), dupCal.status === 422 && /already exists/i.test(dupCal.text))

  const fixedNoLen = await call(admin, 'POST', '/api/admin/rotations/calendars', {
    data: { trainingYear: 3, academicYearLabel: `${label}-fw`, startsOn: '2027-01-01', blockKind: 'fixed_weeks', blocksCount: 2 },
  })
  check(D, 'V4', 'fixed_weeks without blockLengthWeeks is refused (RotationCalendarService::createCalendar)', '422 blockLengthWeeks', excerpt(fixedNoLen), fixedNoLen.status === 422 && /blockLengthWeeks/.test(fixedNoLen.text))

  const outOfWindow = await call(admin, 'POST', '/api/admin/rotations/calendars', {
    data: { trainingYear: 1, academicYearLabel: `${label}-far`, startsOn: '2031-01-01', blockKind: 'calendar_month', blocksCount: 1 },
  })
  check(D, 'V5', 'A calendar start beyond now+2 years is refused', '422 startsOn', excerpt(outOfWindow), outOfWindow.status === 422 && /startsOn/.test(outOfWindow.text))

  const planUrl = `/api/admin/rotations/${ids.calendar}/plan`
  const residentIn = (id: string) => qAll('select duty_type_id,starts_on,ends_on,source from duty_assignments where user_id=? and starts_on<=\'2027-01-31\' and ends_on>=\'2027-01-01\'', [id])

  const badUser = await call(admin, 'POST', planUrl, { data: { assignments: [{ userId: 'no-such-user', blockId: ids.block1, dutyTypeId: ids.opd }] } })
  check(D, 'V6', 'Plan: unknown user id fails validation', '422', excerpt(badUser), badUser.status === 422)

  const notResident = await call(admin, 'POST', planUrl, { data: { assignments: [{ userId: ids.consultant, blockId: ids.block1, dutyTypeId: ids.opd }] } })
  check(D, 'V7', 'Plan: a consultant is not an active resident of the training year', '422 "active resident in the selected training year"', excerpt(notResident),
    notResident.status === 422 && /active resident/i.test(notResident.text))

  const foreignBlock = await call(admin, 'POST', planUrl, { data: { assignments: [{ userId: ids.resident, blockId: ids.seededBlockY1, dutyTypeId: ids.opd }] } })
  check(D, 'V8', 'Plan: a block of ANOTHER calendar is refused ("Every block must belong to the calendar being planned")', '422', excerpt(foreignBlock),
    foreignBlock.status === 422 && /belong to the calendar/i.test(foreignBlock.text) && residentIn(ids.resident).length === 0)

  const badBlock = await call(admin, 'POST', planUrl, { data: { assignments: [{ userId: ids.resident, blockId: 'no-such-block', dutyTypeId: ids.opd }] } })
  check(D, 'V9', 'Plan: unknown block id fails validation (exists:rotation_blocks,id)', '422', excerpt(badBlock), badBlock.status === 422)

  const dailyType = await call(admin, 'POST', planUrl, { data: { assignments: [{ userId: ids.resident, blockId: ids.block1, dutyTypeId: ids.transitionDaily }] } })
  check(D, 'V10', 'Plan: the planner writes monthly duty types only', '422 "only writes monthly duty types"', excerpt(dailyType), dailyType.status === 422 && /monthly duty types/i.test(dailyType.text))

  const plan = await call(admin, 'POST', planUrl, { data: { assignments: [{ userId: ids.resident, blockId: ids.block1, dutyTypeId: ids.opd }] } })
  const planRows = residentIn(ids.resident)
  const cell = (plan.json?.assignments ?? []).find((a: any) => a.userId === ids.resident && a.blockId === ids.block1)
  const planAudit = qOne("select user_id,new_values from admin_audit_logs where action='save_rotation_plan' and entity_type='rotation_calendar' and entity_id=? order by rowid desc limit 1", [ids.calendar])
  check(D, 'V11', 'Plan save writes a duty_assignments row spanning the block (source rotation_planner), the matrix reports the cell consistent, audit save_rotation_plan',
    '200; 1 row 2027-01-01..2027-01-31 opd rotation_planner; cell.status=consistent; audit by admin',
    `${plan.status}; rows=${JSON.stringify(planRows)}; cell=${JSON.stringify(cell)}; audit=${JSON.stringify(planAudit)}`,
    plan.status === 200 && planRows.length === 1 && planRows[0].duty_type_id === ids.opd && planRows[0].source === 'rotation_planner' && String(planRows[0].ends_on).startsWith('2027-01-31') && cell?.status === 'consistent' && planAudit?.user_id === ids.admin,
    excerpt(plan))

  const twice = await call(admin, 'POST', planUrl, { data: { assignments: [
    { userId: ids.resident, blockId: ids.block1, dutyTypeId: ids.opd },
    { userId: ids.resident, blockId: ids.block1, dutyTypeId: ids.cardioWardService },
  ] } })
  const twiceRows = residentIn(ids.resident)
  check(D, 'V12', 'The same resident twice in one block is not rejected: bulkAssign carves per row so the LAST entry wins, one row remains (no 422 in the code)',
    '200 + 1 row = last duty type', `${twice.status}; rows=${JSON.stringify(twiceRows)}`,
    twice.status === 200 && twiceRows.length === 1 && twiceRows[0].duty_type_id === ids.cardioWardService, excerpt(twice))

  const replan = await call(admin, 'POST', planUrl, { data: { assignments: [{ userId: ids.resident, blockId: ids.block1, dutyTypeId: ids.opd }] } })
  check(D, 'V13', 'Re-planning a planner-owned consistent cell needs no confirmOverwrite (RotationPlanStateService: consistent && allPlannerOwned)', '200', excerpt(replan),
    replan.status === 200 && residentIn(ids.resident)[0]?.duty_type_id === ids.opd)

  // Roster-owned coverage for the same month: the month save on a rotation-managed resident needs a reason.
  const rosterOverride = await call(admin, 'PUT', '/api/admin/roster/2027/1', { data: { assignments: [
    { userId: ids.resident, dutyTypeId: ids.cardioWardService, overrideReason: `${PREFIX}coverage gap for regression check ${suffix}` },
  ] } })
  const overrideRows = residentIn(ids.resident)
  check(D, 'V14', 'A reasoned roster month save on a rotation-managed resident replaces the planner row with an admin row carrying the override note',
    '200 + 1 row source=admin', `${rosterOverride.status}; rows=${JSON.stringify(overrideRows)}`,
    rosterOverride.status === 200 && overrideRows.length === 1 && overrideRows[0].source === 'admin', excerpt(rosterOverride))

  const needsConfirm = await call(admin, 'POST', planUrl, { data: { assignments: [{ userId: ids.resident, blockId: ids.block1, dutyTypeId: ids.opd }] } })
  check(D, 'V15', 'Replacing roster-owned coverage from the planner requires confirmOverwrite', '422 confirmOverwrite, admin row untouched',
    `${excerpt(needsConfirm)}; source=${residentIn(ids.resident)[0]?.source}`, needsConfirm.status === 422 && /confirmOverwrite/.test(needsConfirm.text) && residentIn(ids.resident)[0]?.source === 'admin')

  const confirmed = await call(admin, 'POST', planUrl, { data: { confirmOverwrite: true, assignments: [{ userId: ids.resident, blockId: ids.block1, dutyTypeId: ids.opd }] } })
  const confirmedRows = residentIn(ids.resident)
  const confirmedAudit = qOne("select new_values from admin_audit_logs where action='save_rotation_plan' and entity_id=? order by rowid desc limit 1", [ids.calendar])
  check(D, 'V16', 'With confirmOverwrite the planner replaces the admin row and the audit records confirmedOverwrite=true', '200; 1 row rotation_planner opd',
    `${confirmed.status}; rows=${JSON.stringify(confirmedRows)}; audit.new_values=${confirmedAudit?.new_values}`,
    confirmed.status === 200 && confirmedRows.length === 1 && confirmedRows[0].source === 'rotation_planner' && /"confirmedOverwrite":true/.test(String(confirmedAudit?.new_values)), excerpt(confirmed))

  const seededBlocksAfter = qCount('select count(*) c from rotation_blocks where calendar_id=?', [ids.seededCalendarY1])
  const otherAssignmentsAfter = qCount('select count(*) c from duty_assignments where user_id not in (?,?)', [ids.resident, ids.consultant])
  check(D, 'V17', 'Planning this calendar does not touch the seeded calendar\'s blocks nor other people\'s assignments', `blocks ${seededBlocksBefore}, other rows ${otherAssignmentsBefore}`,
    `blocks ${seededBlocksAfter}, other rows ${otherAssignmentsAfter}`, seededBlocksAfter === seededBlocksBefore && otherAssignmentsAfter === otherAssignmentsBefore)

  const off = await call(admin, 'PATCH', `/api/admin/rotations/calendars/${ids.calendar}/active`, { data: { active: false } })
  const offRow = qOne('select active from rotation_calendars where id=?', [ids.calendar])
  const on = await call(admin, 'PATCH', `/api/admin/rotations/calendars/${ids.calendar}/active`, { data: { active: true } })
  const onRow = qOne('select active from rotation_calendars where id=?', [ids.calendar])
  const toggleAudit = qCount("select count(*) c from admin_audit_logs where action='set_active' and entity_type='rotation_calendar' and entity_id=?", [ids.calendar])
  check(D, 'V18', 'PATCH /active toggles the calendar and audits set_active each time', 'false->0, true->1, 2 audit rows',
    `${off.status}/${offRow?.active} ${on.status}/${onRow?.active} audits=${toggleAudit}`, off.status === 200 && offRow?.active === 0 && on.status === 200 && onRow?.active === 1 && toggleAudit === 2)

  const consultantList = await call(consultant, 'GET', '/api/admin/rotations/calendars')
  const consultantPlan = await call(consultant, 'POST', planUrl, { data: { assignments: [] } })
  check(D, 'V19', 'A consultant cannot read or write rotations (permission rotations.manage)', '403/403', `${consultantList.status}/${consultantPlan.status}`,
    consultantList.status === 403 && consultantPlan.status === 403)

  // Cleanup: clear the block and retire the calendar.
  const clear = await call(admin, 'POST', planUrl, { data: { assignments: [{ userId: ids.resident, blockId: ids.block1, dutyTypeId: null }] } })
  const retire = await call(admin, 'PATCH', `/api/admin/rotations/calendars/${ids.calendar}/active`, { data: { active: false } })
  check(D, 'V20', 'Cleanup: a null dutyTypeId clears the block window; the calendar is deactivated (no delete route exists)', '200 + 0 rows; active=0',
    `${clear.status} rows=${residentIn(ids.resident).length}; ${retire.status} active=${qOne('select active from rotation_calendars where id=?', [ids.calendar])?.active}`,
    clear.status === 200 && residentIn(ids.resident).length === 0 && retire.status === 200)
})

// ------------------------------------------------------------------ W: undergraduate

test('W: batches, students, import, placements, sessions, schedules, rep assignments', async () => {
  test.skip(!ids.ward, 'setup did not produce a QA ward')
  const admin = await use('admin')

  const badBatch = await call(admin, 'POST', '/api/admin/student-batches', { data: { cohort: 'C1', label: `${PREFIX}bad ${suffix}`, startsOn: '2027-05-09', endsOn: '2027-03-01' } })
  check(D, 'W1', 'A batch whose end is not after its start is refused (endsOn after:startsOn)', '422', excerpt(badBatch), badBatch.status === 422)

  const batch = await call(admin, 'POST', '/api/admin/student-batches', { data: { cohort: 'C1', label: `${PREFIX}${suffix}`, startsOn: '2027-03-01', endsOn: '2027-05-09' } })
  ids.batch = batch.json?.id ?? ''
  const batchRow = qOne('select cohort,label,starts_on,ends_on,active from student_batches where id=?', [ids.batch])
  check(D, 'W2', 'Batch create: 201 + active row (storeBatch)', '201 + row active', `${batch.status}; row=${JSON.stringify(batchRow)}`,
    batch.status === 201 && batchRow?.active === 1 && batchRow?.cohort === 'C1', excerpt(batch))

  const student = await call(admin, 'POST', '/api/admin/students', { data: { batchId: ids.batch, fullName: `${PREFIX}Imp One ${suffix}`, externalId: `QRS-${suffix}-1`, subgroup: 'A' } })
  ids.student = student.json?.id ?? ''
  const studentRow = qOne('select full_name,external_id,subgroup,active from students where id=?', [ids.student])
  check(D, 'W3', 'Student create: 201 + row (storeStudent)', '201 + row A active', `${student.status}; row=${JSON.stringify(studentRow)}`,
    student.status === 201 && studentRow?.subgroup === 'A' && studentRow?.active === 1, excerpt(student))

  const csv = [
    `${PREFIX}Imp Two ${suffix},QRS-${suffix}-2,A`,
    `${PREFIX}Imp One DIFFERENT NAME ${suffix},QRS-${suffix}-1,B`, // duplicate registrar id -> skipped
    ',,,', // invalid: no name -> ignored
    `${PREFIX}Imp Three ${suffix},,B`,
  ].join('\n')
  const imp = await call(admin, 'POST', '/api/admin/students/import', { data: { batchId: ids.batch, csv } })
  const batchStudents = qAll('select full_name,external_id,subgroup from students where batch_id=? order by full_name', [ids.batch])
  const impAudit = qOne("select new_values from admin_audit_logs where action='import' and entity_type='student' and entity_id=? order by rowid desc limit 1", [ids.batch])
  check(D, 'W4', 'Import (paste CSV string, one student per line "Full Name[,external_id][,A|B]"): dedupes on external id, ignores a nameless line, reports created/skipped, audits import',
    '201 {created:2, skipped:1}; batch has 3 students; audit new_values created=2 skipped=1',
    `${imp.status} ${JSON.stringify(imp.json)}; students=${JSON.stringify(batchStudents)}; audit=${impAudit?.new_values}`,
    imp.status === 201 && imp.json?.created === 2 && imp.json?.skipped === 1 && batchStudents.length === 3 && batchStudents.some((s) => s.external_id === `QRS-${suffix}-2`) && batchStudents.some((s) => s.full_name === `${PREFIX}Imp Three ${suffix}` && s.subgroup === 'B'),
    excerpt(imp))
  info(D, 'W4-INFO', 'The import is a JSON body with a `csv` string (not a multipart file); an invalid (nameless) line is silently ignored and not counted as an error', `${JSON.stringify(imp.json)}`)

  const update = await call(admin, 'PATCH', `/api/admin/students/${ids.student}`, { data: { fullName: `${PREFIX}Imp One Renamed ${suffix}`, subgroup: 'B' } })
  const updRow = qOne('select full_name,subgroup from students where id=?', [ids.student])
  check(D, 'W5', 'Student update persists name and subgroup (updateStudent)', '200 + row', `${update.status}; row=${JSON.stringify(updRow)}`,
    update.status === 200 && updRow?.subgroup === 'B' && String(updRow?.full_name).includes('Renamed'), excerpt(update))

  const del = await call(admin, 'DELETE', `/api/admin/students/${ids.student}`)
  const delRow = qOne('select active from students where id=?', [ids.student])
  const delAudit = qCount("select count(*) c from admin_audit_logs where action='deactivate' and entity_type='student' and entity_id=?", [ids.student])
  check(D, 'W6', 'DELETE student DEACTIVATES (row kept, active=0, audit "deactivate"); it is never a hard delete regardless of attendance/evaluations (destroyStudent)',
    '204 + row active=0 + audit', `${del.status}; row=${JSON.stringify(delRow)}; audits=${delAudit}`, del.status === 204 && delRow?.active === 0 && delAudit === 1, excerpt(del))

  const placement = await call(admin, 'POST', '/api/admin/subgroup-placements', { data: { batchId: ids.batch, subgroup: 'A', wardId: ids.ward, weekStartsOn: '2027-03-08' } })
  ids.placement = placement.json?.id ?? ''
  const plRow = qOne('select ward_id,week_starts_on,week_ends_on,created_by from subgroup_placements where id=?', [ids.placement])
  check(D, 'W7', 'Placement create: 201 + row for the ISO week 2027-03-08..2027-03-14 (storePlacement)', '201 + row', `${placement.status}; row=${JSON.stringify(plRow)}`,
    placement.status === 201 && plRow?.ward_id === ids.ward && String(plRow?.week_starts_on).startsWith('2027-03-08') && String(plRow?.week_ends_on).startsWith('2027-03-14') && plRow?.created_by === ids.admin, excerpt(placement))

  const same = await call(admin, 'POST', '/api/admin/subgroup-placements', { data: { batchId: ids.batch, subgroup: 'A', wardId: ids.ward, weekStartsOn: '2027-03-10' } })
  const sameCount = qCount("select count(*) c from subgroup_placements where batch_id=? and subgroup='A' and date(week_starts_on)='2027-03-08'", [ids.batch])
  check(D, 'W8', 'The SAME subgroup-week saved again (any day of that week) re-points the existing row: 201 with the same id, still one row, never a 500 (storePlacement; UndergraduateModuleTest re-point test)',
    '201 same id, 1 row', `${same.status} id=${same.json?.id} sameId=${same.json?.id === ids.placement}; rows=${sameCount}`,
    same.status === 201 && same.json?.id === ids.placement && sameCount === 1, excerpt(same))
  info(D, 'W8-INFO', 'A duplicate placement is an idempotent upsert (201), not a 422; the 422 with a message is only the unique-index backstop', excerpt(same))

  const bWeek1 = await call(admin, 'POST', '/api/admin/subgroup-placements', { data: { batchId: ids.batch, subgroup: 'B', wardId: ids.ward, weekStartsOn: '2027-03-08' } })
  const bWeek2 = await call(admin, 'POST', '/api/admin/subgroup-placements', { data: { batchId: ids.batch, subgroup: 'B', wardId: ids.ward, weekStartsOn: '2027-03-15' } })
  const bWeek2Id = bWeek2.json?.id ?? ''
  const sameWeekRows = qCount("select count(*) c from subgroup_placements where batch_id=? and date(week_starts_on)='2027-03-08'", [ids.batch])
  check(D, 'W9', 'Another subgroup in the same week is its own row (A and B on 2027-03-08); a later week for B is a third row', 'B 201 + B 201; 2 rows on 2027-03-08',
    `${bWeek1.status}/${bWeek2.status}; rowsOn0308=${sameWeekRows}`, bWeek1.status === 201 && bWeek2.status === 201 && sameWeekRows === 2, excerpt(bWeek2))
  const moveOntoOccupied = await call(admin, 'PATCH', `/api/admin/subgroup-placements/${bWeek2Id}`, { data: { weekStartsOn: '2027-03-09' } })
  const moveFree = await call(admin, 'PATCH', `/api/admin/subgroup-placements/${bWeek2Id}`, { data: { weekStartsOn: '2027-03-22' } })
  const bRows = qAll("select date(week_starts_on) w from subgroup_placements where batch_id=? and subgroup='B' order by w", [ids.batch])
  check(D, 'W10', 'PATCH placement onto a week the same subgroup already occupies is refused (updatePlacement duplicate check); onto a free week it moves and persists',
    '422 then 200; B rows on 2027-03-08 and 2027-03-22', `${excerpt(moveOntoOccupied)} / ${moveFree.status}; B rows=${JSON.stringify(bRows)}`,
    moveOntoOccupied.status === 422 && /already has a placement/i.test(moveOntoOccupied.text) && moveFree.status === 200 && bRows.length === 2 && bRows[1].w === '2027-03-22', excerpt(moveFree))

  const sessions = qAll<{ id: string; subgroup: string | null; activity_type: string; ward_id: string | null; status: string }>(
    "select id,subgroup,activity_type,ward_id,status from teaching_sessions where batch_id=? and date(scheduled_date)='2027-03-08' order by activity_type,subgroup", [ids.batch])
  const lecture = sessions.find((s) => s.subgroup === null)
  const subgroupA = sessions.find((s) => s.subgroup === 'A')
  check(D, 'W11', 'Saving the placement generated the week\'s sessions for the active batch: cohort-scope sessions carry no ward, subgroup A sessions snapshot the placement ward (TeachingService::generateSessions)',
    'lecture ward=null, subgroup A session ward=QA ward, all pending',
    `sessions=${JSON.stringify(sessions)}`,
    !!lecture && lecture.ward_id === null && !!subgroupA && subgroupA.ward_id === ids.ward && sessions.every((s) => s.status === 'pending'))

  if (lecture) {
    const noReason = await call(admin, 'POST', `/api/admin/teaching-sessions/${lecture.id}/cancel`, { data: {} })
    check(D, 'W12', 'Cancelling a session without a reason is refused (cancelSession validation)', '422 reason', excerpt(noReason), noReason.status === 422 && /reason/i.test(noReason.text))
    const cancel = await call(admin, 'POST', `/api/admin/teaching-sessions/${lecture.id}/cancel`, { data: { reason: `${PREFIX}exam week` } })
    const sRow = qOne('select status,reason,recorded_by from teaching_sessions where id=?', [lecture.id])
    const sAudit = qCount("select count(*) c from admin_audit_logs where action='cancel' and entity_type='teaching_session' and entity_id=?", [lecture.id])
    ids.cancelledSession = lecture.id
    check(D, 'W13', 'Admin cancel: 200 status cancelled, reason + recorded_by stored, audit cancel/teaching_session', '200 cancelled', `${cancel.status} ${JSON.stringify(cancel.json)}; row=${JSON.stringify(sRow)}; audits=${sAudit}`,
      cancel.status === 200 && cancel.json?.status === 'cancelled' && sRow?.status === 'cancelled' && sRow?.recorded_by === ids.admin && sAudit === 1, excerpt(cancel))
  } else {
    check(D, 'W12', 'Cancelling a session without a reason is refused', '422', 'SKIPPED: no lecture session generated', false)
  }

  // ---- schedules: pick a (cohort C2, activity, weekday) combination not yet in the catalog
  const used = new Set(qAll<{ k: string }>("select activity_type||':'||weekday k from teaching_activity_schedules where cohort='C2'").map((r) => r.k))
  const candidates: Array<{ activityType: string; weekday: number; scope: string }> = []
  for (const weekday of [7, 6, 5, 4, 3, 2, 1]) for (const activityType of ['seminar', 'lecture']) candidates.push({ activityType, weekday, scope: 'cohort' })
  const free = candidates.find((c) => !used.has(`${c.activityType}:${c.weekday}`))
  expect(free, 'no free C2 cohort-scope schedule slot left for a QA row').toBeTruthy()

  const wrongScope = await call(admin, 'POST', '/api/admin/teaching-schedules', { data: { cohort: 'C2', activityType: free!.activityType, weekday: free!.weekday, scope: 'subgroup' } })
  check(D, 'W14', 'lecture/seminar require cohort scope (assertScheduleScope)', '422 scope', excerpt(wrongScope), wrongScope.status === 422 && /scope/i.test(wrongScope.text))

  const schedule = await call(admin, 'POST', '/api/admin/teaching-schedules', { data: { cohort: 'C2', ...free! } })
  ids.schedule = schedule.json?.id ?? ''
  const schRow = qOne('select cohort,activity_type,weekday,scope,active from teaching_activity_schedules where id=?', [ids.schedule])
  check(D, 'W15', 'Schedule create: 201 + active row (storeSchedule)', '201 + row', `${schedule.status}; row=${JSON.stringify(schRow)}`,
    schedule.status === 201 && schRow?.active === 1 && schRow?.weekday === free!.weekday, excerpt(schedule))

  const dupSchedule = await call(admin, 'POST', '/api/admin/teaching-schedules', { data: { cohort: 'C2', ...free! } })
  check(D, 'W16', 'The same cohort+activity+weekday again is refused', '422 weekday', excerpt(dupSchedule), dupSchedule.status === 422 && /already has this activity/i.test(dupSchedule.text))

  const schOff = await call(admin, 'PATCH', `/api/admin/teaching-schedules/${ids.schedule}/active`, { data: { active: false } })
  const schOffRow = qOne('select active from teaching_activity_schedules where id=?', [ids.schedule])
  const schUpd = await call(admin, 'PATCH', `/api/admin/teaching-schedules/${ids.schedule}`, { data: { active: true, scope: 'cohort' } })
  const schUpdRow = qOne('select active,scope from teaching_activity_schedules where id=?', [ids.schedule])
  check(D, 'W17', 'Schedule PATCH /active and PATCH update persist (setScheduleActive, updateSchedule)', 'active 0 then 1', `${schOff.status}/${schOffRow?.active} ${schUpd.status}/${schUpdRow?.active}`,
    schOff.status === 200 && schOffRow?.active === 0 && schUpd.status === 200 && schUpdRow?.active === 1)

  const schDel = await call(admin, 'DELETE', `/api/admin/teaching-schedules/${ids.schedule}`)
  const schDelRow = qOne('select active from teaching_activity_schedules where id=?', [ids.schedule])
  check(D, 'W18', 'DELETE schedule DEACTIVATES (row kept, active=0) (destroySchedule)', '204 + active=0', `${schDel.status}; row=${JSON.stringify(schDelRow)}`, schDel.status === 204 && schDelRow?.active === 0)

  // ---- rep assignments
  const repUser = await call(admin, 'POST', '/api/admin/users', {
    data: { fullName: `${PREFIX}Rep ${suffix}`, email: `qa_reg_struct_rep_${suffix}@qa.local`, password: QA_ACCOUNT_PASSWORD, role_key: 'student_rep', password_change_required: false },
  })
  ids.repUser = repUser.json?.id ?? ''
  check(D, 'W19', 'Admin can mint a student_rep account for the assignment (UserController::store ASSIGNABLE_ROLES)', '201', excerpt(repUser), repUser.status === 201 && !!ids.repUser)

  const nurseRep = await call(admin, 'POST', '/api/admin/rep-assignments', { data: { userId: ids.nurse, batchId: ids.batch, scope: 'group' } })
  check(D, 'W20', 'A rep assignment requires an active student_rep account (assertEligibleRep)', '422 userId', excerpt(nurseRep), nurseRep.status === 422 && /student representative/i.test(nurseRep.text))

  const rep = await call(admin, 'POST', '/api/admin/rep-assignments', { data: { userId: ids.repUser, batchId: ids.batch, scope: 'group' } })
  ids.rep = rep.json?.id ?? ''
  const repRow = qOne('select user_id,batch_id,scope,active from rep_assignments where id=?', [ids.rep])
  check(D, 'W21', 'Rep assignment create: 201 + active row (storeRepAssignment)', '201 + row group active', `${rep.status}; row=${JSON.stringify(repRow)}`,
    rep.status === 201 && repRow?.scope === 'group' && repRow?.active === 1, excerpt(rep))

  const secondActive = await call(admin, 'POST', '/api/admin/rep-assignments', { data: { userId: ids.repUser, batchId: ids.batch, scope: 'subgroup_a' } })
  check(D, 'W22', 'One active assignment per representative (assertActiveRepUserAvailable)', '422 "already has an active assignment"', excerpt(secondActive),
    secondActive.status === 422 && /active assignment/i.test(secondActive.text) && qCount('select count(*) c from rep_assignments where user_id=?', [ids.repUser]) === 1)

  const repUpd = await call(admin, 'PATCH', `/api/admin/rep-assignments/${ids.rep}`, { data: { scope: 'subgroup_a' } })
  const repUpdRow = qOne('select scope,active from rep_assignments where id=?', [ids.rep])
  check(D, 'W23', 'Rep assignment update persists the scope (updateRepAssignment)', '200 scope=subgroup_a', `${repUpd.status}; row=${JSON.stringify(repUpdRow)}`, repUpd.status === 200 && repUpdRow?.scope === 'subgroup_a', excerpt(repUpd))

  const repOff = await call(admin, 'PATCH', `/api/admin/rep-assignments/${ids.rep}/active`, { data: { active: false } })
  const repOffRow = qOne('select active from rep_assignments where id=?', [ids.rep])
  const repOn = await call(admin, 'PATCH', `/api/admin/rep-assignments/${ids.rep}/active`, { data: { active: true } })
  const repOnRow = qOne('select active from rep_assignments where id=?', [ids.rep])
  check(D, 'W24', 'Rep PATCH /active toggles and persists', '0 then 1', `${repOff.status}/${repOffRow?.active} ${repOn.status}/${repOnRow?.active}`,
    repOff.status === 200 && repOffRow?.active === 0 && repOn.status === 200 && repOnRow?.active === 1)
})

// ------------------------------------------------------------------ X: structure guards

test('X: ward/section/duty type guards, set-consultant, head rules, authorization', async () => {
  test.skip(!ids.ward || !ids.section || !ids.dutyType, 'setup did not create the QA structure')
  const admin = await use('admin')
  const consultant = await use('consultant')
  const nurse = await use('nurse')

  const rename = await call(admin, 'PATCH', `/api/admin/academic/wards/${ids.ward}`, { data: { name: `${PREFIX}Ward Renamed ${suffix}` } })
  const renamed = qOne('select name from wards where id=?', [ids.ward])
  const updAudit = qCount("select count(*) c from admin_audit_logs where action='update' and entity_type='ward' and entity_id=?", [ids.ward])
  check(D, 'X4', 'Ward update persists and audits update/ward', '200 + renamed + audit', `${rename.status}; name=${renamed?.name}; audits=${updAudit}`,
    rename.status === 200 && String(renamed?.name).includes('Renamed') && updAudit === 1, excerpt(rename))

  const delRef = await call(admin, 'DELETE', `/api/admin/academic/wards/${ids.ward}`)
  const stillThere = qCount('select count(*) c from wards where id=?', [ids.ward])
  check(D, 'X5', 'A ward referenced by a subgroup placement cannot be deleted: 422 "Deactivate it instead", row still exists (destroyWard guard)', '422 + row kept',
    `${excerpt(delRef)}; exists=${stillThere}`, delRef.status === 422 && /deactivate it instead/i.test(delRef.text) && stillThere === 1)

  const deactivate = await call(admin, 'PATCH', `/api/admin/academic/wards/${ids.ward}`, { data: { active: false } })
  check(D, 'X6', 'PATCH active=false deactivates the referenced ward', '200 + active=0', `${deactivate.status}; active=${qOne('select active from wards where id=?', [ids.ward])?.active}`,
    deactivate.status === 200 && qOne('select active from wards where id=?', [ids.ward])?.active === 0, excerpt(deactivate))

  // Remove every placement of the QA batch (A on the ward, B moved to the next week on the same ward).
  const placements = qAll<{ id: string }>('select id from subgroup_placements where batch_id=?', [ids.batch])
  let delOk = true
  for (const p of placements) {
    const r = await call(admin, 'DELETE', `/api/admin/subgroup-placements/${p.id}`)
    delOk = delOk && r.status === 204
  }
  const placementsLeft = qCount('select count(*) c from subgroup_placements where batch_id=?', [ids.batch])
  const sessionsOnWard = qCount('select count(*) c from teaching_sessions where ward_id=?', [ids.ward])
  check(D, 'X7', 'Deleting the placements removes the rows and re-snapshots the week\'s pending sessions to no ward (destroyPlacement + generateRange)', '204 each, 0 placements, 0 sessions on the ward',
    `deletes ok=${delOk}; placements=${placementsLeft}; sessionsOnWard=${sessionsOnWard}`, delOk && placementsLeft === 0 && sessionsOnWard === 0)

  const delWard = await call(admin, 'DELETE', `/api/admin/academic/wards/${ids.ward}`)
  const wardGone = qCount('select count(*) c from wards where id=?', [ids.ward])
  const delAudit = qCount("select count(*) c from admin_audit_logs where action='delete' and entity_type='ward' and entity_id=?", [ids.ward])
  check(D, 'X8', 'An unreferenced ward deletes: 204, row gone, audit delete/ward', '204 + 0 rows + audit', `${delWard.status}; exists=${wardGone}; audits=${delAudit}`,
    delWard.status === 204 && wardGone === 0 && delAudit === 1, excerpt(delWard))

  // ---- section head + set-consultant
  const nurseHead = await call(admin, 'PATCH', `/api/admin/academic/sections/${ids.section}`, { data: { headUserId: ids.nurse } })
  check(D, 'X9', 'A section head must be an active consultant (assertHeadIsConsultant)', '422 headUserId', excerpt(nurseHead), nurseHead.status === 422 && /headUserId|consultant/i.test(nurseHead.text))

  const setHead = await call(admin, 'PATCH', `/api/admin/academic/sections/${ids.section}`, { data: { headUserId: ids.plainConsultant } })
  const headRow = qOne('select head_user_id from sections where id=?', [ids.section])
  check(D, 'X10', 'Section update with a consultant head persists head_user_id (updateSection)', '200 + head set', `${setHead.status}; head=${headRow?.head_user_id}`,
    setHead.status === 200 && headRow?.head_user_id === ids.plainConsultant, excerpt(setHead))

  const setNurse = await call(admin, 'POST', `/api/admin/academic/sections/${ids.section}/set-consultant`, { data: { userId: ids.nurse } })
  check(D, 'X11', 'set-consultant refuses a non-consultant', '422 userId', excerpt(setNurse), setNurse.status === 422 && /consultant/i.test(setNurse.text))

  const originalSection = qOne('select section_id from users where id=?', [ids.plainConsultant])?.section_id
  const setConsultant = await call(admin, 'POST', `/api/admin/academic/sections/${ids.section}/set-consultant`, { data: { userId: ids.plainConsultant } })
  const moved = qOne('select section_id from users where id=?', [ids.plainConsultant])?.section_id
  const scAudit = qOne("select old_values,new_values from admin_audit_logs where action='set_consultant_section' and entity_type='section' and entity_id=? order by rowid desc limit 1", [ids.section])
  check(D, 'X12', 'set-consultant moves users.section_id immediately (administrative override, no transfer request) and audits set_consultant_section with old/new', '200 + section_id=QA + audit',
    `${setConsultant.status}; section_id=${moved}; audit=${JSON.stringify(scAudit)}`,
    setConsultant.status === 200 && moved === ids.section && String(scAudit?.old_values).includes(String(originalSection)) && String(scAudit?.new_values).includes(ids.section), excerpt(setConsultant))

  const delWithConsultant = await call(admin, 'DELETE', `/api/admin/academic/sections/${ids.section}`)
  check(D, 'X13', 'A section with consultants (and a duty type) cannot be deleted (destroySection guard)', '422 "Deactivate it instead"', excerpt(delWithConsultant),
    delWithConsultant.status === 422 && /deactivate it instead/i.test(delWithConsultant.text))

  const restore = await call(admin, 'POST', `/api/admin/academic/sections/${originalSection}/set-consultant`, { data: { userId: ids.plainConsultant } })
  const restored = qOne('select section_id from users where id=?', [ids.plainConsultant])?.section_id
  check(D, 'X14', 'Restore: set-consultant back to the original section leaves the seeded consultant untouched', `200 + section_id=${originalSection}`, `${restore.status}; section_id=${restored}`,
    restore.status === 200 && restored === originalSection, excerpt(restore))

  // ---- duty type guarded by an assignment
  const dtUpd = await call(admin, 'PATCH', `/api/admin/academic/duty-types/${ids.dutyType}`, { data: { name: `${PREFIX}On Call Renamed ${suffix}`, countsForMorningRoster: false } })
  const dtRow = qOne('select name,counts_for_morning_roster from duty_types where id=?', [ids.dutyType])
  check(D, 'X15', 'Duty type update persists (updateDutyType)', '200 + renamed + counts_for_morning_roster=0', `${dtUpd.status}; row=${JSON.stringify(dtRow)}`,
    dtUpd.status === 200 && String(dtRow?.name).includes('Renamed') && dtRow?.counts_for_morning_roster === 0, excerpt(dtUpd))

  const assign = await call(admin, 'POST', '/api/admin/roster/daily', { data: { userId: ids.consultant, dutyTypeId: ids.dutyType, date: '2026-10-16' } })
  const delUsed = await call(admin, 'DELETE', `/api/admin/academic/duty-types/${ids.dutyType}`)
  check(D, 'X16', 'A duty type with roster assignments cannot be deleted (destroyDutyType guard)', 'daily 201; DELETE 422 "Deactivate it instead"; row kept',
    `${assign.status}; ${excerpt(delUsed)}; exists=${qCount('select count(*) c from duty_types where id=?', [ids.dutyType])}`,
    assign.status === 201 && delUsed.status === 422 && /deactivate it instead/i.test(delUsed.text) && qCount('select count(*) c from duty_types where id=?', [ids.dutyType]) === 1)

  const unassign = await call(admin, 'POST', '/api/admin/roster/daily', { data: { userId: ids.consultant, dutyTypeId: ids.dutyType, date: '2026-10-16', remove: true } })
  const delFree = await call(admin, 'DELETE', `/api/admin/academic/duty-types/${ids.dutyType}`)
  check(D, 'X17', 'After removing its assignment the duty type deletes (204, row gone, audit delete/duty_type)', '204 + 0 rows',
    `${unassign.status} removed=${unassign.json?.removed}; ${delFree.status}; exists=${qCount('select count(*) c from duty_types where id=?', [ids.dutyType])}; audits=${qCount("select count(*) c from admin_audit_logs where action='delete' and entity_type='duty_type' and entity_id=?", [ids.dutyType])}`,
    unassign.json?.removed === true && delFree.status === 204 && qCount('select count(*) c from duty_types where id=?', [ids.dutyType]) === 0)

  // ---- section referenced by a transfer request (the consultant's slot is free: req2 is approved, not pending)
  const req3 = await call(consultant, 'POST', '/api/academic/transfer-requests', { data: { toSectionId: ids.section, reason: `${PREFIX}req3 ${suffix}` } })
  ids.req3 = req3.json?.id ?? ''
  const delTransfer = await call(admin, 'DELETE', `/api/admin/academic/sections/${ids.section}`)
  check(D, 'X18', 'A section that is the destination of a pending transfer request cannot be deleted (inboundTransferRequests guard; FK is restrict-on-delete)', 'req3 201; DELETE 422 "Deactivate it instead"; row kept',
    `${req3.status}; ${excerpt(delTransfer)}; exists=${qCount('select count(*) c from sections where id=?', [ids.section])}`,
    req3.status === 201 && delTransfer.status === 422 && /deactivate it instead/i.test(delTransfer.text) && qCount('select count(*) c from sections where id=?', [ids.section]) === 1)

  const cancel3 = await call(consultant, 'POST', `/api/academic/transfer-requests/${ids.req3}/cancel`)
  const delHistory = await call(admin, 'DELETE', `/api/admin/academic/sections/${ids.section}`)
  check(D, 'X19', 'Even a cancelled request keeps the section as history: delete still 422', 'cancel 200; DELETE 422', `${cancel3.status}; ${excerpt(delHistory)}`,
    cancel3.status === 200 && delHistory.status === 422 && qCount('select count(*) c from sections where id=?', [ids.section]) === 1)

  const retire = await call(admin, 'PATCH', `/api/admin/academic/sections/${ids.section}`, { data: { active: false, headUserId: null } })
  const retiredRow = qOne<SectionRow>('select active,head_user_id from sections where id=?', [ids.section])
  check(D, 'X20', 'PATCH active=false (and head cleared) retires the referenced section', '200 + active=0 + head null', `${retire.status}; row=${JSON.stringify(retiredRow)}`,
    retire.status === 200 && retiredRow?.active === 0 && retiredRow?.head_user_id === null, excerpt(retire))

  const inactiveDest = await call(consultant, 'POST', '/api/academic/transfer-requests', { data: { toSectionId: ids.section } })
  check(D, 'X21', 'A transfer into an inactive section is refused (TransferService::request "This section is not active.")', '422', excerpt(inactiveDest), inactiveDest.status === 422 && /not active/i.test(inactiveDest.text))

  // ---- authorization
  const consultantWard = await call(consultant, 'POST', '/api/admin/academic/wards', { data: { name: `${PREFIX}forbidden ${suffix}` } })
  const consultantSections = await call(consultant, 'GET', '/api/admin/academic/sections')
  const nurseDutyTypes = await call(nurse, 'GET', '/api/admin/academic/duty-types')
  const consultantSet = await call(consultant, 'POST', `/api/admin/academic/sections/${ids.section}/set-consultant`, { data: { userId: ids.consultant } })
  check(D, 'X22', 'Consultant/nurse cannot manage structure (permission academicStructure.manage / roster.manage on set-consultant; policies admin-like only)', '403/403/403/403',
    `${consultantWard.status}/${consultantSections.status}/${nurseDutyTypes.status}/${consultantSet.status}`,
    consultantWard.status === 403 && consultantSections.status === 403 && nurseDutyTypes.status === 403 && consultantSet.status === 403)
  info(D, 'X22-INFO', 'Every admin-side mutation above was performed by the ordinary admin role (not maintenance/superadmin): academicStructure.manage, roster.manage, rotations.manage, students.manage and transfers.review are granted to role admin (Permissions.php)', EXTRA_ACCOUNTS.admin)
})

// ------------------------------------------------------------------ W (tail): batch retirement + cleanup

test('W tail: batch delete deactivates and cascades to rep assignments; cleanup', async () => {
  test.skip(!ids.batch, 'no QA batch')
  const admin = await use('admin')

  const studentsBefore = qCount('select count(*) c from students where batch_id=?', [ids.batch])
  const repActiveBefore = qOne('select active from rep_assignments where id=?', [ids.rep])?.active
  const del = await call(admin, 'DELETE', `/api/admin/student-batches/${ids.batch}`)
  const batchRow = qOne('select active from student_batches where id=?', [ids.batch])
  const studentsAfter = qCount('select count(*) c from students where batch_id=?', [ids.batch])
  const repAfter = qOne('select active from rep_assignments where id=?', [ids.rep])?.active
  const audit = qCount("select count(*) c from admin_audit_logs where action='deactivate' and entity_type='student_batch' and entity_id=?", [ids.batch])
  check(D, 'W25', 'DELETE batch with students and an active rep: not 422 and not a cascade delete; the batch is DEACTIVATED, students stay, active rep assignments are deactivated (destroyBatch)',
    `204; batch active=0; students ${studentsBefore} kept; rep active 1->0; audit deactivate`,
    `${del.status}; batch=${JSON.stringify(batchRow)}; students=${studentsAfter}; rep ${repActiveBefore}->${repAfter}; audits=${audit}`,
    del.status === 204 && batchRow?.active === 0 && studentsAfter === studentsBefore && repActiveBefore === 1 && repAfter === 0 && audit === 1, excerpt(del))

  const reactivateRep = await call(admin, 'PATCH', `/api/admin/rep-assignments/${ids.rep}/active`, { data: { active: true } })
  check(D, 'W26', 'A rep assignment cannot be activated for an inactive batch (assertActiveBatchForRep)', '422 batchId', excerpt(reactivateRep), reactivateRep.status === 422 && /active batch/i.test(reactivateRep.text))

  const repDel = await call(admin, 'DELETE', `/api/admin/rep-assignments/${ids.rep}`)
  check(D, 'W27', 'DELETE rep assignment deactivates (already inactive: idempotent 204, row kept)', '204 + row kept active=0',
    `${repDel.status}; row=${JSON.stringify(qOne('select active from rep_assignments where id=?', [ids.rep]))}`, repDel.status === 204 && qOne('select active from rep_assignments where id=?', [ids.rep])?.active === 0)

  const leftovers = {
    consultantSection: qOne('select section_id from users where id=?', [ids.consultant])?.section_id,
    plainConsultantSection: qOne('select section_id from users where id=?', [ids.plainConsultant])?.section_id,
    residentJan2027: qCount("select count(*) c from duty_assignments where user_id=? and starts_on<='2027-01-31' and ends_on>='2027-01-01'", [ids.resident]),
    consultantOct2026: qCount("select count(*) c from duty_assignments where user_id=? and starts_on<='2026-10-31' and ends_on>='2026-10-01'", [ids.consultant]),
    transferRows: qAll('select id,status,effective_on,applied_at from transfer_requests where user_id=? and reason like ?', [ids.consultant, `${PREFIX}%`]),
  }
  check(D, 'CLEANUP', 'Seeded accounts end where they started: consultant section unchanged, plain consultant restored, no QA roster rows left on the resident (Jan 2027) or the consultant (Oct 2026)',
    `sections ${ids.consultantSection}/${ids.plainConsultantSection}; 0 rows each`,
    JSON.stringify(leftovers),
    leftovers.consultantSection === ids.consultantSection && leftovers.plainConsultantSection === ids.plainConsultantSection && leftovers.residentJan2027 === 0 && leftovers.consultantOct2026 === 0)
  info(D, 'CLEANUP-INFO', 'Rows intentionally left (prefixed QA_REG_STRUCT_ or referenced by history): transfer requests (cancelled x2, approved/unapplied x1), inactive section, inactive rotation calendar + blocks, inactive batch + students + sessions, inactive C2 schedule row, inactive rep assignment, student_rep account', JSON.stringify(leftovers.transferRows))
  info(D, 'DB', 'Direct database re-reads performed by this spec (counted across worker restarts)', String(dbReads))
})
