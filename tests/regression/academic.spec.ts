/**
 * Academic business-rule regression: resident -> consultant evaluation (N),
 * consultant -> resident evaluation (O), consultant -> student evaluation (P),
 * evaluation form versioning (Q), the student-representative teaching log (R)
 * and morning sessions (S).
 *
 * Runs against the already-running dev stack; every mutation is re-read from
 * the SQLite database. Evaluations are added with the seeded resident /
 * consultant accounts (rows carry the QA_REG_ACAD_ marker in their comment),
 * pairings are chosen so the spec is re-runnable (a fresh author/subject/date
 * combination is searched for), forms are left published (a new version per
 * run is acceptable on the dev database), and no seeded row is deleted.
 *
 * Source of truth per rule is cited in each check id's rule text:
 *   AEC = backend/app/Http/Controllers/Api/AcademicEvaluationController.php
 *   EFS = backend/app/Services/Academic/EvaluationFormService.php
 *   EFC = backend/app/Http/Controllers/Api/Admin/EvaluationFormController.php
 *   RS  = backend/app/Services/Academic/RosterService.php
 *   TSC = backend/app/Http/Controllers/Api/TeachingSessionController.php
 *   TS  = backend/app/Services/Academic/TeachingService.php
 *   TSP = backend/app/Policies/TeachingSessionPolicy.php
 *   MSC = backend/app/Http/Controllers/Api/MorningSessionController.php
 *   MSS = backend/app/Services/Academic/MorningSessionService.php
 *   MSP = backend/app/Policies/MorningSessionPolicy.php
 *   PERM = backend/app/Support/Authorization/Permissions.php
 *
 *   npx playwright test --config playwright.regression.config.ts tests/regression/academic.spec.ts
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { test, type APIRequestContext } from '@playwright/test'
import { createHash, randomUUID } from 'node:crypto'
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
  ACCOUNTS,
  EXTRA_ACCOUNTS,
  QA_PREFIX,
  type Call,
} from './helpers/index'

const D = 'academic'
const PREFIX = `${QA_PREFIX}_ACAD_`
const BUSINESS_TZ = 'Africa/Nairobi'

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

/** Today's calendar date in the hospital timezone (HospitalClock::today). */
function hospitalToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: BUSINESS_TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/** ISO weekday (1 = Monday ... 7 = Sunday) of a YYYY-MM-DD date. */
function isoWeekday(date: string): number {
  const d = new Date(`${date}T12:00:00Z`).getUTCDay()
  return d === 0 ? 7 : d
}

function mondayOf(date: string): string {
  return addDays(date, 1 - isoWeekday(date))
}

function excerpt(c: Call, max = 220): string {
  return `${c.status} ${c.text.replace(/\s+/g, ' ').slice(0, max)}`
}

function sha(rows: unknown): string {
  return createHash('sha256').update(JSON.stringify(rows)).digest('hex').slice(0, 16)
}

type FormField = {
  key: string
  type: string
  options: any
  required: boolean
  active: boolean
  isCore: boolean
  label: string
}

type FormDef = { id: string; key: string; version: number; status: string; fields: FormField[] }

/**
 * A valid answer for every ACTIVE field of a rendered form (EFS::rulesForField),
 * keyed snake_case. `comment` is validated as a field but stored on the header.
 */
function buildAnswers(form: FormDef, marker: string): Record<string, unknown> {
  const answers: Record<string, unknown> = {}
  for (const f of form.fields) {
    if (!f.active) continue
    switch (f.type) {
      case 'boolean':
        answers[f.key] = true
        break
      case 'rating':
        answers[f.key] = Math.min(Number(f.options?.max ?? 5), Math.max(Number(f.options?.min ?? 1), 4))
        break
      case 'percent':
        answers[f.key] = 80
        break
      case 'integer':
        answers[f.key] = Math.min(Number(f.options?.max ?? 1000000), Number(f.options?.min ?? 0) + 30)
        break
      case 'time':
        answers[f.key] = '08:15'
        break
      case 'text':
        answers[f.key] = `${marker} ${f.key}`
        break
      case 'single_select':
        answers[f.key] = f.options?.choices?.[0]?.value ?? ''
        break
      case 'multi_select':
        answers[f.key] = f.options?.choices?.[0] ? [f.options.choices[0].value] : []
        break
    }
  }
  return answers
}

/** Number of evaluation_answers rows EFS::store writes for these answers (comment excluded, empty arrays skipped). */
function expectedAnswerRows(form: FormDef, answers: Record<string, unknown>): number {
  return form.fields.filter((f) => {
    if (!f.active || f.key === 'comment' || !(f.key in answers)) return false
    const v = answers[f.key]
    if (v === null || v === '') return false
    if (f.type === 'multi_select' && Array.isArray(v) && v.length === 0) return false
    return true
  }).length
}

type Pairing = { date: string; subjectId: string; subjectName: string; subjects: { id: string; fullName: string }[] }

/**
 * A subject the author is paired with (GET /api/academic/form-options?date=)
 * on the most recent date where this author has no evaluation of that
 * subject on that form yet (the uniqueness rule), so the spec is re-runnable.
 */
async function findFreshPairing(
  ctx: APIRequestContext,
  authorId: string,
  formKey: string,
  preferredSubjectId?: string,
  maxDaysBack = 45,
): Promise<Pairing | null> {
  const today = hospitalToday()
  for (let back = 0; back <= maxDaysBack; back++) {
    const date = addDays(today, -back)
    const res = await call(ctx, 'GET', `/api/academic/form-options?date=${date}`)
    if (res.status !== 200) continue
    const subjects: { id: string; fullName: string }[] = res.json?.subjects ?? []
    if (subjects.length === 0) continue
    const ordered = preferredSubjectId
      ? [...subjects.filter((s) => s.id === preferredSubjectId), ...subjects.filter((s) => s.id !== preferredSubjectId)]
      : subjects
    for (const s of ordered) {
      const taken = q.count(
        `select count(*) c from evaluations where author_id = ? and subject_user_id = ? and date(evaluation_date) = ? and form_key = ?`,
        [authorId, s.id, date, formKey],
      )
      if (taken === 0) return { date, subjectId: s.id, subjectName: s.fullName, subjects }
    }
    await sleep(150)
  }
  return null
}

function userId(email: string): string {
  const row = q.one<{ id: string }>(`select id from users where email = ?`, [email])
  if (!row) throw new Error(`no seeded user ${email}`)
  return row.id
}

// ---------------------------------------------------------------- shared state

const RUN = uniqueSuffix()
const MARKER = `${PREFIX}${RUN}`

let resident: APIRequestContext
let consultant: APIRequestContext
let nonRecorder: APIRequestContext
let admin: APIRequestContext
let maintenance: APIRequestContext
let groupRep: APIRequestContext
let repA: APIRequestContext
let repB: APIRequestContext

let residentId: string
let consultantId: string
let nonRecorderId: string
let repAId: string

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  resetFindings(D)
  await flushRateLimits()
  resident = await apiAs(ACCOUNTS.resident.identifier)
  consultant = await apiAs(ACCOUNTS.consultant.identifier)
  nonRecorder = await apiAs(ACCOUNTS.non_recorder.identifier)
  admin = await apiAs(EXTRA_ACCOUNTS.admin)
  maintenance = await apiAs(EXTRA_ACCOUNTS.superadmin)
  groupRep = await apiAs(ACCOUNTS.group_rep.identifier)
  repA = await apiAs(ACCOUNTS.subgroup_a_rep.identifier)
  repB = await apiAs(ACCOUNTS.subgroup_b_rep.identifier)
  residentId = userId(ACCOUNTS.resident.identifier)
  consultantId = userId(ACCOUNTS.consultant.identifier)
  nonRecorderId = userId(ACCOUNTS.non_recorder.identifier)
  repAId = userId(ACCOUNTS.subgroup_a_rep.identifier)
  info(D, 'ACAD-0', 'run context', `run=${RUN} hospitalToday=${hospitalToday()} (isoWeekday ${isoWeekday(hospitalToday())})`)
})

test.afterAll(async () => {
  info(D, 'ACAD-DB', 'database re-reads performed by this spec', String(dbReads))
  for (const ctx of [resident, consultant, nonRecorder, admin, maintenance, groupRep, repA, repB]) {
    await ctx?.dispose().catch(() => undefined)
  }
})

// ---------------------------------------------------------------- shared submit flow for N and O

type PeerDirection = {
  tag: 'N' | 'O'
  authorCtx: () => APIRequestContext
  authorId: () => string
  authorName: string
  endpoint: string
  wrongEndpoint: string
  formKey: string
  subjectRole: 'consultant' | 'resident'
  preferredSubject: () => string
  subjectCtx: () => APIRequestContext
  entityType: string
}

async function peerEvaluationChecks(dir: PeerDirection): Promise<void> {
  const ctx = dir.authorCtx()
  const authorId = dir.authorId()
  const today = hospitalToday()

  // Eligible subjects for today.
  const optionsToday = await call(ctx, 'GET', '/api/academic/form-options')
  const todaySubjects: { id: string }[] = optionsToday.json?.subjects ?? []
  check(D, `${dir.tag}1`, `AEC::formOptions lists the ${dir.subjectRole}s the author shares a ward/duty pairing with today (RS::peersFor)`,
    '200 with subjects[] and currentPlacement', `${optionsToday.status} subjects=${todaySubjects.length} placement=${JSON.stringify(optionsToday.json?.currentPlacement)}`,
    optionsToday.status === 200 && Array.isArray(optionsToday.json?.subjects))
  info(D, `${dir.tag}1i`, `eligible ${dir.subjectRole}s for ${today}`, String(todaySubjects.length))

  // Rendered form definition.
  const formRes = await call(ctx, 'GET', `/api/academic/evaluation-forms/${dir.formKey}`)
  const form = formRes.json as FormDef
  check(D, `${dir.tag}2`, `AEC::form renders the PUBLISHED ${dir.formKey} definition with fields[]`,
    '200, status=published, fields > 0', `${formRes.status} status=${form?.status} version=${form?.version} fields=${form?.fields?.length}`,
    formRes.status === 200 && form?.status === 'published' && (form?.fields?.length ?? 0) > 0)
  if (formRes.status !== 200) return

  const pairing = await findFreshPairing(ctx, authorId, dir.formKey, dir.preferredSubject())
  if (!pairing) {
    check(D, `${dir.tag}3`, 'a fresh author/subject/date pairing exists within 45 days', 'found', 'none found', false)
    return
  }
  info(D, `${dir.tag}3i`, 'pairing used for the valid submission', `date=${pairing.date} subject=${pairing.subjectName} (${pairing.subjectId})`)

  const answers = buildAnswers(form, MARKER)
  const payload = { ...answers, evaluation_date: pairing.date, subject_id: pairing.subjectId, comment: `${MARKER} ${dir.tag}` }
  const beforeCount = q.count(`select count(*) c from evaluations where author_id = ?`, [authorId])
  const created = await call(ctx, 'POST', dir.endpoint, { data: payload })
  check(D, `${dir.tag}3`, `POST ${dir.endpoint} with every required field of the published form -> 201 (AEC::storeThroughForm)`,
    '201', excerpt(created), created.status === 201)
  const evalId: string | undefined = created.json?.id

  const row = evalId
    ? q.one<any>(`select id, form_id, form_key, author_id, subject_user_id, subject_student_id, date(evaluation_date) d, ward_id, placement_type, comment from evaluations where id = ?`, [evalId])
    : null
  const afterCount = q.count(`select count(*) c from evaluations where author_id = ?`, [authorId])
  check(D, `${dir.tag}4`, 'DB evaluations: exactly one new row bound to the published form version, author, subject and date; placement snapshotted server-side (RS::sharedPlacementFor)',
    `+1 row; form_id=${form.id}; author=${authorId}; subject=${pairing.subjectId}; date=${pairing.date}; placement_type not null`,
    `+${afterCount - beforeCount}; ${JSON.stringify(row)}`,
    afterCount - beforeCount === 1 && !!row && row.form_id === form.id && row.form_key === dir.formKey && row.author_id === authorId
      && row.subject_user_id === pairing.subjectId && row.d === pairing.date && row.placement_type !== null && row.comment === `${MARKER} ${dir.tag}`)

  const answerRows = evalId ? q.all<{ field_key: string; value: string }>(`select field_key, value from evaluation_answers where evaluation_id = ? order by field_key`, [evalId]) : []
  const expectedRows = expectedAnswerRows(form, answers)
  check(D, `${dir.tag}5`, 'DB evaluation_answers: one row per answered active non-comment field (EFS::store)',
    `${expectedRows} rows`, `${answerRows.length} rows: ${answerRows.map((a) => a.field_key).join(',')}`,
    answerRows.length === expectedRows)

  const mine = await call(ctx, 'GET', '/api/academic/my-submissions')
  const mineIds: string[] = (mine.json?.data ?? []).map((e: any) => e.id)
  check(D, `${dir.tag}6`, 'AEC::mySubmissions lists the author\'s own submissions in this direction',
    `200, direction=${dir.subjectRole}, includes new id`, `${mine.status} direction=${mine.json?.direction} rows=${mineIds.length} includes=${mineIds.includes(evalId ?? '')}`,
    mine.status === 200 && mine.json?.direction === dir.subjectRole && mineIds.includes(evalId ?? ''))

  const audit = evalId ? q.one<any>(`select action, entity_type, new_values from admin_audit_logs where entity_type = ? and entity_id = ? order by created_at desc limit 1`, [dir.entityType, evalId]) : null
  const auditValues = audit?.new_values ? String(audit.new_values) : ''
  check(D, `${dir.tag}7`, 'AEC::auditEvaluationSubmission writes a submit trail with who/whom/form/date but NO answers',
    `admin_audit_logs row action=submit entity=${dir.entityType} carrying formKey/subjectName/evaluationDate only`,
    `${JSON.stringify(audit)}`,
    !!audit && audit.action === 'submit' && auditValues.includes(dir.formKey) && auditValues.includes(pairing.date)
      && !auditValues.includes('overall_rating') && !auditValues.includes(MARKER))

  // Future date -> 422 (before_or_equal:today).
  const future = await call(ctx, 'POST', dir.endpoint, { data: { ...payload, evaluation_date: addDays(today, 1) } })
  check(D, `${dir.tag}8`, 'evaluation_date must be before_or_equal today (AEC::storeThroughForm)', '422', excerpt(future), future.status === 422)

  // Duplicate (same author, subject, date, form) -> 422.
  const dup = await call(ctx, 'POST', dir.endpoint, { data: payload })
  const dupCount = q.count(`select count(*) c from evaluations where author_id = ? and subject_user_id = ? and date(evaluation_date) = ? and form_key = ?`, [authorId, pairing.subjectId, pairing.date, dir.formKey])
  check(D, `${dir.tag}9`, 'one author evaluates one subject once per date per form (AEC::assertNotAlreadySubmitted + unique key)',
    '422 "already submitted"; still 1 row', `${excerpt(dup)}; rows=${dupCount}`,
    dup.status === 422 && /already submitted/i.test(dup.text) && dupCount === 1)

  // Ineligible subject: a user of the right role NOT in the eligible list for that date.
  const placeholders = pairing.subjects.map(() => '?').join(',')
  const outsider = q.one<{ id: string; full_name: string }>(
    `select id, full_name from users where role_key = ? and active = 1 and id != ? and id not in (${placeholders}) order by full_name limit 1`,
    [dir.subjectRole, authorId, ...pairing.subjects.map((s) => s.id)],
  )
  if (outsider) {
    const bad = await call(ctx, 'POST', dir.endpoint, { data: { ...payload, subject_id: outsider.id } })
    const badRows = q.count(`select count(*) c from evaluations where author_id = ? and subject_user_id = ? and date(evaluation_date) = ?`, [authorId, outsider.id, pairing.date])
    check(D, `${dir.tag}10`, 'a subject with no shared ward/duty pairing on the date is refused (AEC::assertPairedPlacement)',
      '422 "not assigned to the same ward or duty"; no row', `${excerpt(bad)} subject=${outsider.full_name}; rows=${badRows}`,
      bad.status === 422 && /same ward or duty/i.test(bad.text) && badRows === 0)
  } else {
    info(D, `${dir.tag}10`, 'ineligible-subject check', `SKIP: every active ${dir.subjectRole} is eligible on ${pairing.date}`)
  }

  // Wrong role subject (a nurse) -> 422 role guard.
  const nurseId = userId(EXTRA_ACCOUNTS.nurse)
  const wrongRole = await call(ctx, 'POST', dir.endpoint, { data: { ...payload, subject_id: nurseId } })
  check(D, `${dir.tag}11`, `the subject must be a ${dir.subjectRole} (AEC::storeThroughForm role check)`, '422', excerpt(wrongRole), wrongRole.status === 422)

  // Missing required field -> 422 (rules come from the form definition).
  const requiredKey = form.fields.find((f) => f.active && f.required && f.key !== 'comment')?.key
  if (requiredKey) {
    const partial = Object.fromEntries(Object.entries(payload as Record<string, unknown>).filter(([key]) => key !== requiredKey))
    const missing = await call(ctx, 'POST', dir.endpoint, { data: { ...partial, subject_id: pairing.subjectId, evaluation_date: addDays(pairing.date, -1) } })
    check(D, `${dir.tag}12`, `required form field '${requiredKey}' enforced from the published definition (EFS::validationRulesFor)`,
      `422 naming ${requiredKey}`, excerpt(missing), missing.status === 422 && missing.text.includes(requiredKey))
  }

  // Direction guard: the author posting to the opposite endpoint.
  const wrongDir = await call(ctx, 'POST', dir.wrongEndpoint, { data: payload })
  check(D, `${dir.tag}13`, `a ${dir.authorName} posting to ${dir.wrongEndpoint} is refused by the direction guard (AEC)`,
    '422 "Only ..."', excerpt(wrongDir), wrongDir.status === 422 && /only (residents|consultants)/i.test(wrongDir.text))

  // Author privacy on the subject's own performance view: aggregates only.
  const perf = await call(dir.subjectCtx(), 'GET', '/api/academic/my-performance')
  const perfText = perf.text
  check(D, `${dir.tag}14`, 'AEC::myPerformance returns aggregates for the subject only: no evaluator identity (authorId/authorName) and no author full name',
    '200 without author keys or evaluator names', `${perf.status} keys=${Object.keys(perf.json ?? {}).join(',')} hasAuthorKey=${/"author(Id|Name)"/.test(perfText)} hasEvaluatorName=${perfText.includes(dir.authorName)}`,
    perf.status === 200 && !/"author(Id|Name)"/.test(perfText) && !perfText.includes(dir.authorName) && perf.json?.summary !== undefined)
}

// ---------------------------------------------------------------- N: resident -> consultant

test('N resident evaluates a consultant (consultant_mdt)', async () => {
  await peerEvaluationChecks({
    tag: 'N',
    authorCtx: () => resident,
    authorId: () => residentId,
    authorName: ACCOUNTS.resident.fullName,
    endpoint: '/api/academic/consultant-evaluations',
    wrongEndpoint: '/api/academic/resident-evaluations',
    formKey: 'consultant_mdt',
    subjectRole: 'consultant',
    preferredSubject: () => consultantId,
    subjectCtx: () => consultant,
    entityType: 'consultant_evaluation',
  })
})

// ---------------------------------------------------------------- O: consultant -> resident

test('O consultant evaluates a resident (resident_acgme)', async () => {
  await peerEvaluationChecks({
    tag: 'O',
    authorCtx: () => consultant,
    authorId: () => consultantId,
    authorName: ACCOUNTS.consultant.fullName,
    endpoint: '/api/academic/resident-evaluations',
    wrongEndpoint: '/api/academic/consultant-evaluations',
    formKey: 'resident_acgme',
    subjectRole: 'resident',
    preferredSubject: () => residentId,
    subjectCtx: () => resident,
    entityType: 'resident_evaluation',
  })
})

// ---------------------------------------------------------------- P: consultant -> student

test('P consultant evaluates a student (student_weekly / student_final)', async () => {
  const today = hospitalToday()
  const list = await call(consultant, 'GET', '/api/academic/students')
  const students: any[] = list.json?.data ?? []
  check(D, 'P1', 'AEC::students lists every active student of an active batch with the current placement (not ward-gated by design)',
    '200 with data[]', `${list.status} students=${students.length} placed=${students.filter((s) => s.currentWardName).length}`,
    list.status === 200 && students.length > 0)

  const weeklyForm = (await call(consultant, 'GET', '/api/academic/evaluation-forms/student_weekly')).json as FormDef
  const finalForm = (await call(consultant, 'GET', '/api/academic/evaluation-forms/student_final')).json as FormDef
  info(D, 'P1i', 'student form versions', `student_weekly v${weeklyForm?.version} (${weeklyForm?.fields?.length} fields), student_final v${finalForm?.version} (${finalForm?.fields?.length} fields)`)

  // A placed student the consultant has not evaluated today on either form.
  const student = students.find((s) => s.currentWardName && q.count(
    `select count(*) c from evaluations where author_id = ? and subject_student_id = ? and date(evaluation_date) = ?`, [consultantId, s.id, today]) === 0)
  if (!student) {
    check(D, 'P2', 'a placed student without an evaluation by this consultant today exists', 'found', 'none', false)
    return
  }
  const placement = q.one<any>(`select p.ward_id, date(p.week_starts_on) ws, w.name ward from subgroup_placements p join wards w on w.id = p.ward_id join students s on s.batch_id = p.batch_id and s.subgroup = p.subgroup where s.id = ? and date(p.week_starts_on) <= ? and date(p.week_ends_on) >= ?`, [student.id, today, today])

  const weeklyAnswers = buildAnswers(weeklyForm, MARKER)
  const weeklyPayload = { ...weeklyAnswers, formKey: 'student_weekly', evaluation_date: today, student_id: student.id, comment: `${MARKER} P-weekly` }
  const weekly = await call(consultant, 'POST', '/api/academic/student-evaluations', { data: weeklyPayload })
  check(D, 'P2', 'POST /api/academic/student-evaluations formKey=student_weekly for a placed student -> 201 (AEC::storeStudentEvaluation)',
    '201', excerpt(weekly), weekly.status === 201)
  const weeklyRow = weekly.json?.id ? q.one<any>(`select form_id, form_key, author_id, subject_user_id, subject_student_id, date(evaluation_date) d, ward_id, placement_type, date(week_starts_on) ws from evaluations where id = ?`, [weekly.json.id]) : null
  check(D, 'P3', 'DB: weekly row snapshots the placement (ward_id from subgroup_placements, placement_type=ward, week_starts_on=placement week) and names only the student subject',
    `ward_id=${placement?.ward_id} placement_type=ward ws=${placement?.ws} subject_user_id=null`, JSON.stringify(weeklyRow),
    !!weeklyRow && weeklyRow.form_id === weeklyForm.id && weeklyRow.subject_student_id === student.id && weeklyRow.subject_user_id === null
      && weeklyRow.ward_id === placement?.ward_id && weeklyRow.placement_type === 'ward' && weeklyRow.ws === placement?.ws && weeklyRow.d === today)
  info(D, 'P3i', 'placement snapshot columns recorded', `student=${student.fullName} ward=${placement?.ward} (${weeklyRow?.ward_id}) placement_type=${weeklyRow?.placement_type} week_starts_on=${weeklyRow?.ws}`)
  const weeklyAnswerRows = weekly.json?.id ? q.count(`select count(*) c from evaluation_answers where evaluation_id = ?`, [weekly.json.id]) : 0
  check(D, 'P4', 'DB evaluation_answers for the weekly evaluation (EFS::store)', `${expectedAnswerRows(weeklyForm, weeklyAnswers)}`, String(weeklyAnswerRows),
    weeklyAnswerRows === expectedAnswerRows(weeklyForm, weeklyAnswers))

  // Final: no calendar gate in the code beyond date <= today and uniqueness; week_starts_on stays null.
  const finalAnswers = buildAnswers(finalForm, MARKER)
  const finalRes = await call(consultant, 'POST', '/api/academic/student-evaluations', { data: { ...finalAnswers, formKey: 'student_final', evaluation_date: today, student_id: student.id, comment: `${MARKER} P-final` } })
  const finalRow = finalRes.json?.id ? q.one<any>(`select form_id, form_key, ward_id, placement_type, week_starts_on from evaluations where id = ?`, [finalRes.json.id]) : null
  check(D, 'P5', 'student_final is accepted on any date (AEC: only date<=today + uniqueness); week_starts_on null, placement still snapshotted',
    '201; form_key=student_final; week_starts_on=null', `${excerpt(finalRes)} row=${JSON.stringify(finalRow)}`,
    finalRes.status === 201 && finalRow?.form_key === 'student_final' && finalRow?.week_starts_on === null && finalRow?.ward_id === placement?.ward_id)
  info(D, 'P5i', 'weekly vs final rules as implemented', 'both forms share the same endpoint; the only kind-specific rule is week_starts_on (weekly: placement week or startOfWeek; final: null). No end-of-attachment gate exists in code.')

  const dup = await call(consultant, 'POST', '/api/academic/student-evaluations', { data: weeklyPayload })
  check(D, 'P6', 'duplicate weekly for the same student/date/author -> 422 (AEC::assertNotAlreadySubmitted)', '422', excerpt(dup), dup.status === 422 && /already submitted/i.test(dup.text))

  const badStudent = await call(consultant, 'POST', '/api/academic/student-evaluations', { data: { ...weeklyPayload, student_id: randomUUID() } })
  check(D, 'P7', 'unknown student_id -> 422 (exists:students,id)', '422', excerpt(badStudent), badStudent.status === 422)

  const badKind = await call(consultant, 'POST', '/api/academic/student-evaluations', { data: { ...weeklyPayload, formKey: 'consultant_mdt' } })
  check(D, 'P8', 'formKey must be student_weekly or student_final', '422', excerpt(badKind), badKind.status === 422)

  const future = await call(consultant, 'POST', '/api/academic/student-evaluations', { data: { ...weeklyPayload, evaluation_date: addDays(today, 1) } })
  check(D, 'P9', 'student evaluation dated in the future -> 422', '422', excerpt(future), future.status === 422)

  // Out-of-scope consultant: the code is deliberately not ward-gated, and ACCOUNTS.non_recorder is a resident.
  const nonRecorderRole = q.one<{ role_key: string }>(`select role_key from users where id = ?`, [nonRecorderId])?.role_key
  if (nonRecorderRole === 'consultant') {
    const outside = await call(nonRecorder, 'POST', '/api/academic/student-evaluations', { data: { ...weeklyPayload, evaluation_date: addDays(today, -1) } })
    info(D, 'P10', 'a consultant outside the placement ward evaluating the student (AEC: not ward-gated by design)', excerpt(outside))
  } else {
    const wrongRole = await call(nonRecorder, 'POST', '/api/academic/student-evaluations', { data: weeklyPayload })
    check(D, 'P10', `a ${nonRecorderRole} (ACCOUNTS.non_recorder) may not evaluate students (AEC direction guard)`, '422 "Only consultants"', excerpt(wrongRole),
      wrongRole.status === 422 && /only consultants/i.test(wrongRole.text))
    info(D, 'P10i', 'consultant-outside-placement check', 'SKIP: AEC::students docblock says student evaluation is deliberately NOT ward-gated (any consultant, any active student); ACCOUNTS.non_recorder is a resident so no second consultant account was used.')
  }

  const audit = weekly.json?.id ? q.one<any>(`select action, entity_type, new_values from admin_audit_logs where entity_type = 'student_evaluation' and entity_id = ?`, [weekly.json.id]) : null
  check(D, 'P11', 'student evaluation submission audited without answers', 'submit/student_evaluation with formKey', JSON.stringify(audit),
    !!audit && audit.action === 'submit' && String(audit.new_values).includes('student_weekly') && !String(audit.new_values).includes(MARKER))
})

// ---------------------------------------------------------------- Q: form versioning

test('Q evaluation form versioning (draft / content / structure / publish)', async () => {
  const KEY = 'consultant_mdt'
  const list = await call(maintenance, 'GET', '/api/admin/academic/evaluation-forms')
  const forms: FormDef[] = list.json?.data ?? []
  const published = forms.find((f) => f.key === KEY && f.status === 'published')
  check(D, 'Q1', 'EFC::index lists every form version for maintenance (evaluationForms.editStructure)', `200 with a published ${KEY}`,
    `${list.status} forms=${forms.length} published ${KEY} v${published?.version}`, list.status === 200 && !!published)
  if (!published) return

  const boundBefore = q.count(`select count(*) c from evaluations where form_id = ?`, [published.id])
  const answersBefore = sha(q.all(`select a.id, a.evaluation_id, a.field_key, a.value from evaluation_answers a join evaluations e on e.id = a.evaluation_id where e.form_id = ? order by a.id`, [published.id]))
  const headersBefore = sha(q.all(`select id, form_id, form_key from evaluations where form_id = ? order by id`, [published.id]))
  info(D, 'Q1i', 'baseline', `${KEY} published v${published.version} id=${published.id}; ${boundBefore} evaluations bound; answers sha=${answersBefore}; headers sha=${headersBefore}`)

  // Draft.
  const draftRes = await call(maintenance, 'POST', `/api/admin/academic/evaluation-forms/${KEY}/draft`)
  const draft = draftRes.json as FormDef
  const draftRow = draft?.id ? q.one<any>(`select version, status, (select count(*) from evaluation_form_fields where form_id = evaluation_forms.id) fields from evaluation_forms where id = ?`, [draft.id]) : null
  check(D, 'Q2', 'EFS::createDraftWithState copies the published form as version+1 draft (201; 200 when a draft already exists)',
    `201/200, draft version ${published.version + 1}, same field count`, `${draftRes.status} v${draft?.version} status=${draft?.status} db=${JSON.stringify(draftRow)}`,
    (draftRes.status === 201 || draftRes.status === 200) && draftRow?.status === 'draft' && draftRow?.version === published.version + 1 && draftRow?.fields === published.fields.length)
  if (!draft?.id) return
  const draftResumed = draftRes.status === 200
  info(D, 'Q2i', 'draft state', draftResumed ? 'resumed an existing draft (earlier run left it unpublished)' : 'created new draft')

  // Content edit on the published version, in place.
  const contentField = published.fields.find((f) => f.active && !f.isCore && f.key !== 'comment')!
  const newLabel = `${MARKER} label`
  const content = await call(maintenance, 'PATCH', `/api/admin/academic/evaluation-forms/${published.id}/content`, {
    data: { fields: [{ key: contentField.key, label: newLabel, helpText: `${MARKER} help` }] },
  })
  const labelRow = q.one<any>(`select label, help_text, type, key from evaluation_form_fields where form_id = ? and key = ?`, [published.id, contentField.key])
  const versionRow = q.one<any>(`select version, status from evaluation_forms where id = ?`, [published.id])
  check(D, 'Q3', 'EFS::updateContent changes label/help text of a non-core field on the CURRENT published version in place (no new version)',
    `200; label='${newLabel}' on v${published.version} still published`, `${content.status} db=${JSON.stringify(labelRow)} form=${JSON.stringify(versionRow)}`,
    content.status === 200 && labelRow?.label === newLabel && labelRow?.help_text === `${MARKER} help` && versionRow?.version === published.version && versionRow?.status === 'published')
  // Restore the wording so the seeded form reads as before.
  await call(maintenance, 'PATCH', `/api/admin/academic/evaluation-forms/${published.id}/content`, {
    data: { fields: [{ key: contentField.key, label: contentField.label, helpText: (contentField as any).helpText ?? null }] },
  })

  // Deactivating a core field through content -> 422.
  const coreField = published.fields.find((f) => f.isCore)!
  const deactivateCore = await call(maintenance, 'PATCH', `/api/admin/academic/evaluation-forms/${published.id}/content`, { data: { fields: [{ key: coreField.key, active: false }] } })
  const coreActive = q.one<any>(`select active from evaluation_form_fields where form_id = ? and key = ?`, [published.id, coreField.key])
  check(D, 'Q4', `core field '${coreField.key}' cannot be deactivated by a content edit (EFS::updateContent)`, '422; still active', `${excerpt(deactivateCore)} active=${coreActive?.active}`,
    deactivateCore.status === 422 && Number(coreActive?.active) === 1)

  // Structure edit helpers.
  const toStructure = (fields: FormField[]) => fields.map((f, i) => ({
    key: f.key, section: (f as any).section ?? 'General', label: f.label, helpText: (f as any).helpText ?? null, type: f.type,
    options: f.options ?? null, required: !!f.required, sortOrder: (f as any).sortOrder ?? (i + 1) * 10, active: !!f.active,
  }))
  const draftFieldsBefore = q.count(`select count(*) c from evaluation_form_fields where form_id = ?`, [draft.id])

  // Removing a core field -> 422, transaction rolled back.
  const withoutCore = await call(maintenance, 'PUT', `/api/admin/academic/evaluation-forms/${draft.id}/structure`, { data: { fields: toStructure(draft.fields.filter((f) => f.key !== coreField.key)) } })
  const draftFieldsAfterBad = q.count(`select count(*) c from evaluation_form_fields where form_id = ?`, [draft.id])
  check(D, 'Q5', `removing the core field '${coreField.key}' via structure -> 422 and the draft field set is rolled back (EFS::assertCoreFieldsIntact)`,
    `422; draft keeps ${draftFieldsBefore} fields`, `${excerpt(withoutCore)} draftFields=${draftFieldsAfterBad}`,
    withoutCore.status === 422 && /core field/i.test(withoutCore.text) && draftFieldsAfterBad === draftFieldsBefore)

  // Changing a core field's type -> 422.
  const retyped = await call(maintenance, 'PUT', `/api/admin/academic/evaluation-forms/${draft.id}/structure`, {
    data: { fields: toStructure(draft.fields).map((f) => (f.key === coreField.key ? { ...f, type: coreField.type === 'text' ? 'boolean' : 'text', options: null } : f)) },
  })
  check(D, 'Q6', `changing the type of core field '${coreField.key}' -> 422`, '422', excerpt(retyped), retyped.status === 422)

  // Reserved key -> 422.
  const reserved = await call(maintenance, 'PUT', `/api/admin/academic/evaluation-forms/${draft.id}/structure`, {
    data: { fields: [...toStructure(draft.fields), { key: 'subject_id', section: 'QA', label: 'x', type: 'text', required: false }] },
  })
  check(D, 'Q7', "'subject_id' is a reserved header key and cannot become a field (EFC::updateStructure)", '422', excerpt(reserved), reserved.status === 422 && /reserved/i.test(reserved.text))

  // Structure on the PUBLISHED version -> 422 (drafts only).
  const onPublished = await call(maintenance, 'PUT', `/api/admin/academic/evaluation-forms/${published.id}/structure`, { data: { fields: toStructure(published.fields) } })
  check(D, 'Q8', 'structural edits apply to a draft only (EFS::lockedDraft)', '422 "Only a draft version"', excerpt(onPublished), onPublished.status === 422 && /draft/i.test(onPublished.text))

  // Add ONE optional text field to the draft.
  const newKey = `qa_reg_acad_note_${RUN.toLowerCase().replace(/[^a-z0-9_]/g, '')}`
  const added = await call(maintenance, 'PUT', `/api/admin/academic/evaluation-forms/${draft.id}/structure`, {
    data: { fields: [...toStructure(draft.fields), { key: newKey, section: 'QA regression', label: `${MARKER} optional note`, type: 'text', required: false, sortOrder: 990, active: true }] },
  })
  const newFieldRow = q.one<any>(`select key, type, required, active, is_core from evaluation_form_fields where form_id = ? and key = ?`, [draft.id, newKey])
  const draftCoreIntact = q.count(`select count(*) c from evaluation_form_fields where form_id = ? and is_core = 1`, [draft.id])
  check(D, 'Q9', 'adding one optional text field to the draft succeeds; is_core flags are pinned from the previous set',
    `200; ${newKey} present optional non-core; ${published.fields.filter((f) => f.isCore).length} core fields kept`,
    `${added.status} new=${JSON.stringify(newFieldRow)} core=${draftCoreIntact}`,
    added.status === 200 && !!newFieldRow && Number(newFieldRow.required) === 0 && Number(newFieldRow.is_core) === 0 && draftCoreIntact === published.fields.filter((f) => f.isCore).length)

  // Publish.
  const publish = await call(maintenance, 'POST', `/api/admin/academic/evaluation-forms/${draft.id}/publish`)
  const versions = q.all<any>(`select id, version, status from evaluation_forms where key = ? order by version`, [KEY])
  const nowPublished = versions.find((v) => v.status === 'published')
  const oldVersion = versions.find((v) => v.id === published.id)
  check(D, 'Q10', 'EFS::publishWithState publishes the draft as the new version and archives the previous one (exactly one published per key)',
    `200; v${draft.version} published, v${published.version} archived`, `${publish.status} versions=${JSON.stringify(versions)}`,
    publish.status === 200 && nowPublished?.id === draft.id && oldVersion?.status === 'archived' && versions.filter((v) => v.status === 'published').length === 1)
  info(D, 'Q10i', 'version numbers', `${KEY}: before v${published.version} (${published.id}) -> after v${nowPublished?.version} (${nowPublished?.id})`)

  // Old evaluations untouched.
  const boundAfter = q.count(`select count(*) c from evaluations where form_id = ?`, [published.id])
  const answersAfter = sha(q.all(`select a.id, a.evaluation_id, a.field_key, a.value from evaluation_answers a join evaluations e on e.id = a.evaluation_id where e.form_id = ? order by a.id`, [published.id]))
  const headersAfter = sha(q.all(`select id, form_id, form_key from evaluations where form_id = ? order by id`, [published.id]))
  check(D, 'Q11', 'historical evaluations stay bound to the archived version with byte-identical answers',
    `${boundBefore} rows, answers sha ${answersBefore}, headers sha ${headersBefore}`, `${boundAfter} rows, answers sha ${answersAfter}, headers sha ${headersAfter}`,
    boundAfter === boundBefore && answersAfter === answersBefore && headersAfter === headersBefore)

  // A new evaluation binds to the new version and renders the new field.
  const rendered = (await call(resident, 'GET', `/api/academic/evaluation-forms/${KEY}`)).json as FormDef
  check(D, 'Q12', 'AEC::form now renders the new published version including the added field', `v${draft.version} with ${newKey}`,
    `v${rendered?.version} has=${rendered?.fields?.some((f) => f.key === newKey)}`, rendered?.version === draft.version && !!rendered?.fields?.some((f) => f.key === newKey))

  const pairing = await findFreshPairing(resident, residentId, KEY, consultantId)
  if (pairing) {
    const answers = buildAnswers(rendered, MARKER)
    const res = await call(resident, 'POST', '/api/academic/consultant-evaluations', { data: { ...answers, evaluation_date: pairing.date, subject_id: pairing.subjectId, comment: `${MARKER} Q` } })
    const row = res.json?.id ? q.one<any>(`select e.form_id, f.version from evaluations e join evaluation_forms f on f.id = e.form_id where e.id = ?`, [res.json.id]) : null
    const newAnswer = res.json?.id ? q.one<any>(`select value from evaluation_answers where evaluation_id = ? and field_key = ?`, [res.json.id, newKey]) : null
    check(D, 'Q13', 'a NEW evaluation binds to the newly published version and stores the added field\'s answer',
      `201; form_id=${draft.id} v${draft.version}; answer for ${newKey}`, `${excerpt(res, 80)} row=${JSON.stringify(row)} newAnswer=${JSON.stringify(newAnswer)}`,
      res.status === 201 && row?.form_id === draft.id && row?.version === draft.version && !!newAnswer)
  } else {
    info(D, 'Q13', 'new evaluation on the new version', 'SKIP: no fresh pairing found')
  }

  const auditActions = q.all<{ action: string }>(`select action from admin_audit_logs where entity_type = 'evaluation_form' and entity_id in (?, ?) and created_at >= datetime('now', '-10 minutes') order by created_at`, [published.id, draft.id]).map((r) => r.action)
  check(D, 'Q14', 'form editing is audited (update_content, update_structure, publish; create_draft on first creation)',
    'includes update_content, update_structure, publish', auditActions.join(','),
    ['update_content', 'update_structure', 'publish'].every((a) => auditActions.includes(a)))
})

// ---------------------------------------------------------------- R: student representative

test('R student representative teaching log', async () => {
  const today = hospitalToday()
  const weekStart = mondayOf(today)
  const weekEnd = addDays(weekStart, 6)

  const expectedFor = (email: string): { ids: string[]; scope: string | null } => {
    const uid = userId(email)
    const assignments = q.all<any>(`select r.batch_id, r.scope from rep_assignments r join student_batches b on b.id = r.batch_id where r.user_id = ? and r.active = 1 and b.active = 1`, [uid])
    const ids = new Set<string>()
    for (const a of assignments) {
      const activities = a.scope === 'group' ? ['lecture', 'seminar'] : ['bedside', 'teaching_round']
      const subgroup = a.scope === 'subgroup_a' ? 'A' : a.scope === 'subgroup_b' ? 'B' : null
      const rows = q.all<{ id: string }>(
        `select id from teaching_sessions where batch_id = ? and activity_type in (${activities.map(() => '?').join(',')}) and ${subgroup === null ? 'subgroup is null' : 'subgroup = ?'} and date(scheduled_date) between ? and ?`,
        [a.batch_id, ...activities, ...(subgroup === null ? [] : [subgroup]), weekStart, weekEnd],
      )
      rows.forEach((r) => ids.add(r.id))
    }
    return { ids: [...ids].sort(), scope: assignments[0]?.scope ?? null }
  }

  const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i])

  const groupList = await call(groupRep, 'GET', '/api/teaching/my-sessions')
  const groupIds = ((groupList.json?.data ?? []) as any[]).map((s) => s.id).sort()
  const groupExpected = expectedFor(ACCOUNTS.group_rep.identifier)
  check(D, 'R1', 'TSC::mySessions (group rep) lists this week\'s lecture/seminar sessions of the rep\'s active batch only (RepAssignment::recordableActivities, subgroup null)',
    `${groupExpected.ids.length} sessions scope=group`, `${groupList.status} ${groupIds.length} sessions scope=${groupList.json?.scope?.scope} activities=${[...new Set((groupList.json?.data ?? []).map((s: any) => `${s.activityType}/${s.subgroup ?? '-'}`))].join(',')}`,
    groupList.status === 200 && groupList.json?.scope?.scope === 'group' && sameSet(groupIds, groupExpected.ids))

  const aList = await call(repA, 'GET', '/api/teaching/my-sessions')
  const aSessions: any[] = aList.json?.data ?? []
  const aIds = aSessions.map((s) => s.id).sort()
  const aExpected = expectedFor(ACCOUNTS.subgroup_a_rep.identifier)
  check(D, 'R2', 'TSC::mySessions (subgroup A rep) lists only bedside/teaching_round sessions of subgroup A this week',
    `${aExpected.ids.length} sessions scope=subgroup_a`, `${aList.status} ${aIds.length} sessions scope=${aList.json?.scope?.scope} ${aSessions.map((s) => `${s.activityType}/${s.subgroup}@${s.scheduledDate}`).join(',')}`,
    aList.status === 200 && aList.json?.scope?.scope === 'subgroup_a' && sameSet(aIds, aExpected.ids) && aSessions.every((s) => s.subgroup === 'A'))

  if (aSessions.length === 0) {
    info(D, 'R3', 'record held/not_held', 'SKIP: subgroup A rep has no session this week')
  } else {
    const heldTarget = aSessions[0]
    const notHeldTarget = aSessions[1] ?? aSessions[0]

    const held = await call(repA, 'POST', `/api/teaching/sessions/${heldTarget.id}/record`, { data: { status: 'held' } })
    const heldRow = q.one<any>(`select status, reason, recorded_by, recorded_at from teaching_sessions where id = ?`, [heldTarget.id])
    check(D, 'R3', 'POST /api/teaching/sessions/{id}/record status=held -> 200; DB status=held, reason cleared, recorded_by/recorded_at set (TS::record)',
      'status=held recorded_by=rep', `${held.status} db=${JSON.stringify(heldRow)}`,
      held.status === 200 && heldRow?.status === 'held' && heldRow?.reason === null && heldRow?.recorded_by === repAId && !!heldRow?.recorded_at)

    const noReason = await call(repA, 'POST', `/api/teaching/sessions/${notHeldTarget.id}/record`, { data: { status: 'not_held' } })
    check(D, 'R4', 'not_held without a reason -> 422 (TS::record: a reason is REQUIRED when not held)', '422', excerpt(noReason), noReason.status === 422)

    const reason = `${MARKER} consultant unavailable`
    const notHeld = await call(repA, 'POST', `/api/teaching/sessions/${notHeldTarget.id}/record`, { data: { status: 'not_held', reason } })
    const notHeldRow = q.one<any>(`select status, reason, recorded_by from teaching_sessions where id = ?`, [notHeldTarget.id])
    check(D, 'R5', 'status=not_held with a reason -> 200; DB status=not_held and reason stored',
      `not_held reason='${reason}'`, `${notHeld.status} db=${JSON.stringify(notHeldRow)}`,
      notHeld.status === 200 && notHeldRow?.status === 'not_held' && notHeldRow?.reason === reason && notHeldRow?.recorded_by === repAId)

    const cancelled = await call(repA, 'POST', `/api/teaching/sessions/${heldTarget.id}/record`, { data: { status: 'cancelled', reason: 'x' } })
    check(D, 'R6', 'a rep may only record held/not_held (TSC::record Rule::in), not cancelled', '422', excerpt(cancelled), cancelled.status === 422)

    const attendanceRows = q.count(`select count(*) c from student_attendance where teaching_session_id in (?, ?)`, [heldTarget.id, notHeldTarget.id])
    info(D, 'R7', 'student_attendance rows after the rep\'s held/not_held records', `${attendanceRows} (TS::record writes none; per-student attendance is the consultant's PUT /api/teaching/sessions/{id}/attendance)`)

    const audit = q.one<any>(`select action, old_values, new_values from admin_audit_logs where entity_type = 'teaching_session' and entity_id = ? order by created_at desc limit 1`, [notHeldTarget.id])
    check(D, 'R8', 'a teaching-log record is audited with previous status, new status and the reason (TSC::record)',
      'action=record new_values has not_held + reason', JSON.stringify(audit),
      !!audit && audit.action === 'record' && String(audit.new_values).includes('not_held') && String(audit.new_values).includes(reason))
  }

  // Out of scope: subgroup B's session as subgroup A rep, and a group session as subgroup A rep.
  const bSession = q.one<{ id: string }>(`select id from teaching_sessions where subgroup = 'B' and activity_type in ('bedside','teaching_round') and date(scheduled_date) between ? and ? order by scheduled_date limit 1`, [weekStart, weekEnd])
  if (bSession) {
    const before = q.one<any>(`select status, reason from teaching_sessions where id = ?`, [bSession.id])
    const crossScope = await call(repA, 'POST', `/api/teaching/sessions/${bSession.id}/record`, { data: { status: 'held' } })
    const after = q.one<any>(`select status, reason from teaching_sessions where id = ?`, [bSession.id])
    check(D, 'R9', 'subgroup A rep recording a subgroup B session -> 403 and the row is untouched (TSP::record)', '403; unchanged',
      `${crossScope.status} before=${JSON.stringify(before)} after=${JSON.stringify(after)}`,
      crossScope.status === 403 && JSON.stringify(before) === JSON.stringify(after))
  } else {
    info(D, 'R9', 'cross-subgroup check', 'SKIP: no subgroup B session this week')
  }
  const groupSession = q.one<{ id: string }>(`select id from teaching_sessions where subgroup is null and date(scheduled_date) between ? and ? order by scheduled_date limit 1`, [weekStart, weekEnd])
  if (groupSession) {
    const asA = await call(repA, 'POST', `/api/teaching/sessions/${groupSession.id}/record`, { data: { status: 'held' } })
    check(D, 'R10', 'subgroup A rep recording a cohort-scope lecture/seminar -> 403 (scope covers bedside/teaching_round only)', '403', String(asA.status), asA.status === 403)
  }

  // Forbidden surfaces for the rep (PERM: student_rep = auth.viewSelf, notifications.view, teachingLog.record).
  const reports = await call(groupRep, 'GET', '/api/reports')
  const reportRows = Array.isArray(reports.json?.data) ? reports.json.data.length : Array.isArray(reports.json) ? reports.json.length : -1
  info(D, 'R11i', 'GET /api/reports as a rep (pre-existing: non-nurses get 200 with an empty list)', `${reports.status} rows=${reportRows}`)
  check(D, 'R11', 'a rep sees no clinical report rows', '0 rows (or 403)', `${reports.status} rows=${reportRows}`, reports.status === 403 || reportRows === 0)

  const someReport = q.one<{ id: string }>(`select id from reports order by created_at desc limit 1`)
  if (someReport) {
    const one = await call(groupRep, 'GET', `/api/reports/${someReport.id}`)
    check(D, 'R12', 'GET /api/reports/{id} as a rep -> 403', '403', excerpt(one, 80), one.status === 403)
  }
  const users = await call(groupRep, 'GET', '/api/admin/users')
  check(D, 'R13', 'GET /api/admin/users as a rep -> 403 (no users.view)', '403', String(users.status), users.status === 403)
  const formAsRep = await call(groupRep, 'GET', '/api/academic/evaluation-forms/consultant_mdt')
  check(D, 'R14', 'GET /api/academic/evaluation-forms/{key} as a rep -> 403 (no academic.submit)', '403', String(formAsRep.status), formAsRep.status === 403)
  const postAsRep = await call(groupRep, 'POST', '/api/academic/consultant-evaluations', { data: { subject_id: consultantId, evaluation_date: today, overall_rating: 5 } })
  check(D, 'R15', 'POST /api/academic/consultant-evaluations as a rep -> 403', '403', String(postAsRep.status), postAsRep.status === 403)
  const postAsRep2 = await call(groupRep, 'POST', '/api/academic/resident-evaluations', { data: { subject_id: residentId, evaluation_date: today, overall_rating: 5 } })
  check(D, 'R16', 'POST /api/academic/resident-evaluations as a rep -> 403', '403', String(postAsRep2.status), postAsRep2.status === 403)
  const perfAsRep = await call(groupRep, 'GET', '/api/academic/my-performance')
  check(D, 'R17', 'GET /api/academic/my-performance as a rep -> 403', '403', String(perfAsRep.status), perfAsRep.status === 403)
  const optionsAsRep = await call(groupRep, 'GET', '/api/academic/form-options')
  const analyticsAsRep = await call(groupRep, 'GET', '/api/academic/analytics/summary')
  const morningAsRep = await call(groupRep, 'GET', '/api/academic/morning-sessions/today')
  check(D, 'R18', 'form-options, academic analytics and morning-session routes as a rep -> 403', '403,403,403',
    `${optionsAsRep.status},${analyticsAsRep.status},${morningAsRep.status}`, optionsAsRep.status === 403 && analyticsAsRep.status === 403 && morningAsRep.status === 403)

  // A resident/consultant must not reach the rep log either.
  const residentLog = await call(resident, 'GET', '/api/teaching/my-sessions')
  check(D, 'R19', 'GET /api/teaching/my-sessions as a resident -> 403 (no teachingLog.record)', '403', String(residentLog.status), residentLog.status === 403)
})

// ---------------------------------------------------------------- S: morning sessions

test('S morning sessions', async () => {
  const today = hospitalToday()

  // Settings vs DB.
  const settings = await call(admin, 'GET', '/api/admin/settings')
  const academic = settings.json?.settings?.academic ?? {}
  const settingRow = q.one<{ value_json: string }>(`select value_json from app_settings where setting_key = 'academic_morning'`)
  const stored = settingRow ? JSON.parse(settingRow.value_json) : {}
  check(D, 'S1', 'GET /api/admin/settings exposes academic.morningSessionDays/Time/RecorderIds matching app_settings.academic_morning (AppSettingsService)',
    JSON.stringify({ days: stored.session_days, time: stored.session_time, recorders: stored.recorder_ids }),
    `${settings.status} ${JSON.stringify({ days: academic.morningSessionDays, time: academic.morningSessionTime, recorders: academic.morningRecorderIds })}`,
    settings.status === 200 && JSON.stringify(academic.morningSessionDays) === JSON.stringify(stored.session_days)
      && academic.morningSessionTime === stored.session_time && JSON.stringify(academic.morningRecorderIds) === JSON.stringify(stored.recorder_ids))

  const recorderIds: string[] = academic.morningRecorderIds ?? []
  const isSessionDay = (academic.morningSessionDays ?? []).includes(isoWeekday(today))
  info(D, 'S1i', 'today', `${today} isoWeekday=${isoWeekday(today)} sessionDay=${isSessionDay} recorderIds=${recorderIds.join(',')}`)

  // Who is the recorder.
  const wsResident = await call(resident, 'GET', '/api/workspace')
  const wsConsultant = await call(consultant, 'GET', '/api/workspace')
  const residentIsRecorder = wsResident.json?.academic?.isMorningRecorder === true
  const consultantIsRecorder = wsConsultant.json?.academic?.isMorningRecorder === true
  check(D, 'S2', '/api/workspace academic.isMorningRecorder reflects membership in morningRecorderIds (MSS::isRecorder)',
    `resident=${recorderIds.includes(residentId)} consultant=${recorderIds.includes(consultantId)}`, `resident=${residentIsRecorder} consultant=${consultantIsRecorder}`,
    residentIsRecorder === recorderIds.includes(residentId) && consultantIsRecorder === recorderIds.includes(consultantId))
  const recorder = residentIsRecorder ? resident : consultantIsRecorder ? consultant : null
  const recorderId = residentIsRecorder ? residentId : consultantIsRecorder ? consultantId : null
  if (!recorder || !recorderId) {
    info(D, 'S3', 'recorder flow', 'SKIP: neither seeded resident nor consultant is a designated recorder')
    return
  }
  const nonRecorderIsRecorder = recorderIds.includes(nonRecorderId)

  // Today's session as the recorder (lazy-opened on a session day).
  const todayRes = await call(recorder, 'GET', '/api/academic/morning-sessions/today')
  const session = todayRes.json?.session
  const sessionRow = session?.id ? q.one<any>(`select id, date(session_date) d, scheduled_start_at, status from morning_sessions where id = ?`, [session.id]) : null
  if (!isSessionDay) {
    check(D, 'S3', 'on a non-session day there is no session (MSS::openFor returns null)', 'session=null isSessionDay=false', `${todayRes.status} ${JSON.stringify({ session, isSessionDay: todayRes.json?.isSessionDay })}`,
      todayRes.status === 200 && session === null && todayRes.json?.isSessionDay === false)
    info(D, 'S4', 'recording flow', 'SKIP: today is not a configured morning-session day')
    return
  }
  check(D, 'S3', 'GET /api/academic/morning-sessions/today as the recorder on a session day returns (lazy-opens) today\'s session with canRecord and the people roster (MSC::today)',
    `200 session for ${today} scheduled ${academic.morningSessionTime}, canRecord=true, people[]`,
    `${todayRes.status} session=${JSON.stringify(sessionRow)} canRecord=${todayRes.json?.canRecord} people=${session?.people?.length}`,
    todayRes.status === 200 && !!sessionRow && sessionRow.d === today && todayRes.json?.canRecord === true && Array.isArray(session?.people)
      && String(sessionRow.scheduled_start_at).startsWith(academic.morningSessionTime))
  if (!session?.id) return
  const initialStatus: string = sessionRow?.status
  info(D, 'S3i', 'today\'s session status before this run\'s writes', `${initialStatus} (attendance rows=${q.count(`select count(*) c from morning_attendance where morning_session_id = ?`, [session.id])})`)

  // Non-recorder: summary without roster, record forbidden.
  const todayOther = await call(nonRecorder, 'GET', '/api/academic/morning-sessions/today')
  check(D, 'S4', 'a non-recorder academic sees today\'s summary with canRecord=false and NO people roster (MSC::today, MSP::viewToday)',
    '200 canRecord=false, no session.people', `${todayOther.status} canRecord=${todayOther.json?.canRecord} people=${todayOther.json?.session?.people === undefined ? 'absent' : 'present'}`,
    nonRecorderIsRecorder || (todayOther.status === 200 && todayOther.json?.canRecord === false && todayOther.json?.session?.people === undefined))
  const people: { userId: string; fullName: string }[] = session.people ?? []
  const presence: Record<string, boolean> = {}
  people.forEach((p, i) => { presence[p.userId] = i % 2 === 0 })
  const recordOther = await call(nonRecorder, 'POST', `/api/academic/morning-sessions/${session.id}/record`, { data: { startedOnTime: true, presence } })
  check(D, 'S5', 'POST .../record by a non-recorder -> 403 (MSP::record)', '403', excerpt(recordOther, 80), nonRecorderIsRecorder || recordOther.status === 403)

  // Off-time without actual start -> 422.
  const noStart = await call(recorder, 'POST', `/api/academic/morning-sessions/${session.id}/record`, { data: { startedOnTime: false, presence } })
  check(D, 'S6', 'startedOnTime=false requires actualStartAt (MSS::record)', '422 actualStartAt', excerpt(noStart), noStart.status === 422 && noStart.text.includes('actualStartAt'))

  // Record.
  const record = await call(recorder, 'POST', `/api/academic/morning-sessions/${session.id}/record`, { data: { startedOnTime: false, actualStartAt: '08:25', presence } })
  const recordedRow = q.one<any>(`select status, started_on_time, actual_start_at, recorded_by, recorded_at from morning_sessions where id = ?`, [session.id])
  const attendance = q.all<{ user_id: string; present: number }>(`select user_id, present from morning_attendance where morning_session_id = ?`, [session.id])
  if (initialStatus === 'cancelled') {
    check(D, 'S7', 'a cancelled session cannot be recorded (MSS::record) [today\'s session was cancelled by an earlier run]', '422; status stays cancelled; 0 attendance rows',
      `${excerpt(record)} db=${JSON.stringify(recordedRow)} attendance=${attendance.length}`,
      record.status === 422 && recordedRow?.status === 'cancelled' && attendance.length === 0)
    info(D, 'S8', 'attendance match / recorder cancel / admin cancel-with-attendance', 'SKIP: today\'s session already cancelled (re-run); the cancel path is exercised below on the cancelled row')
  } else {
    const mismatches = attendance.filter((a) => (a.user_id in presence) && Boolean(a.present) !== presence[a.user_id])
    const expectedMinutes = (() => { const [sh, sm] = String(academic.morningSessionTime).split(':').map(Number); return 8 * 60 + 25 - (sh * 60 + sm) })()
    check(D, 'S7', 'POST .../record as the recorder -> 200; DB status=recorded, recorded_by=recorder, actual start stored, delay computed server-side',
      `200 recorded by ${recorderId} actual 08:25 delay ${Math.max(0, expectedMinutes)}`,
      `${record.status} delay=${record.json?.delayMinutes} db=${JSON.stringify(recordedRow)}`,
      record.status === 200 && recordedRow?.status === 'recorded' && recordedRow?.recorded_by === recorderId && String(recordedRow?.actual_start_at).startsWith('08:25')
        && record.json?.delayMinutes === Math.max(0, expectedMinutes))
    check(D, 'S8', 'DB morning_attendance: one snapshot row per expected person with the present flag from the payload (MSS::record)',
      `${people.length} rows, 0 mismatches`, `${attendance.length} rows, ${mismatches.length} mismatches, present=${attendance.filter((a) => a.present).length}`,
      initialStatus === 'recorded' ? mismatches.length === 0 && attendance.length > 0 : attendance.length === people.length && mismatches.length === 0)
    const recordAudit = q.one<any>(`select action, new_values from admin_audit_logs where entity_type = 'morning_session' and entity_id = ? and action = 'record' order by created_at desc limit 1`, [session.id])
    check(D, 'S9', 'the recording is audited with counts (MSC::record)', 'action=record presentCount/expectedCount', JSON.stringify(recordAudit),
      !!recordAudit && String(recordAudit.new_values).includes('presentCount'))
  }

  // Past session: recorder may act on today only (MSP::record / cancel); admins are not limited.
  const past = q.one<{ id: string; d: string; status: string }>(`select id, date(session_date) d, status from morning_sessions where date(session_date) < ? order by session_date desc limit 1`, [today])
  if (past) {
    const pastBefore = q.one<any>(`select status, recorded_by, recorded_at from morning_sessions where id = ?`, [past.id])
    const pastRecord = await call(recorder, 'POST', `/api/academic/morning-sessions/${past.id}/record`, { data: { startedOnTime: true, presence: {} } })
    const pastCancel = await call(recorder, 'POST', `/api/academic/morning-sessions/${past.id}/cancel`, { data: { reason: `${MARKER} should be refused` } })
    const pastAfter = q.one<any>(`select status, recorded_by, recorded_at from morning_sessions where id = ?`, [past.id])
    check(D, 'S10', `a recorder recording or cancelling a PAST session (${past.d}, ${past.status}) -> 403 and the row is untouched (MSP: same day only)`,
      '403/403; unchanged', `${pastRecord.status}/${pastCancel.status} before=${JSON.stringify(pastBefore)} after=${JSON.stringify(pastAfter)}`,
      pastRecord.status === 403 && pastCancel.status === 403 && JSON.stringify(pastBefore) === JSON.stringify(pastAfter))
  }

  // Recorder cancel: only today's PENDING session; after recording it is refused.
  const statusNow = q.one<{ status: string }>(`select status from morning_sessions where id = ?`, [session.id])?.status
  const recCancel = await call(recorder, 'POST', `/api/academic/morning-sessions/${session.id}/cancel`, { data: { reason: `${MARKER} recorder cancel` } })
  const afterRecCancel = q.one<{ status: string }>(`select status from morning_sessions where id = ?`, [session.id])
  check(D, 'S11', `a recorder may cancel only today's still-pending session; today's is '${statusNow}' (MSP::cancel)`, '403; status unchanged',
    `${recCancel.status} status=${afterRecCancel?.status}`, recCancel.status === 403 && afterRecCancel?.status === statusNow)

  // Admin cancel of a session that has recorded attendance: allowed, attendance rows removed (QA-018), audited.
  const attendanceBeforeCancel = q.count(`select count(*) c from morning_attendance where morning_session_id = ?`, [session.id])
  const cancelAuditBefore = q.count(`select count(*) c from admin_audit_logs where entity_type = 'morning_session' and entity_id = ? and action = 'cancel'`, [session.id])
  const adminCancel = await call(admin, 'POST', `/api/admin/morning-sessions/${session.id}/cancel`, { data: { reason: `${MARKER} public holiday recorded by mistake` } })
  const cancelledRow = q.one<any>(`select status, reason, started_on_time, actual_start_at, recorded_by from morning_sessions where id = ?`, [session.id])
  const attendanceAfterCancel = q.count(`select count(*) c from morning_attendance where morning_session_id = ?`, [session.id])
  const cancelAuditAfter = q.count(`select count(*) c from admin_audit_logs where entity_type = 'morning_session' and entity_id = ? and action = 'cancel'`, [session.id])
  const cancelAudit = q.one<any>(`select old_values, new_values from admin_audit_logs where entity_type = 'morning_session' and entity_id = ? and action = 'cancel' order by created_at desc limit 1`, [session.id])
  if (statusNow === 'recorded') {
    check(D, 'S12', 'ADMIN cancel of a RECORDED session -> 200: status=cancelled with reason, punctuality cleared, attendance rows deleted (MSS::cancel, QA-018), audited with the removed count',
      `200; cancelled; attendance ${attendanceBeforeCancel} -> 0; +1 cancel audit`,
      `${adminCancel.status} db=${JSON.stringify(cancelledRow)} attendance=${attendanceAfterCancel} audit +${cancelAuditAfter - cancelAuditBefore} ${JSON.stringify(cancelAudit)}`,
      adminCancel.status === 200 && cancelledRow?.status === 'cancelled' && cancelledRow?.started_on_time === null && attendanceAfterCancel === 0
        && cancelAuditAfter - cancelAuditBefore === 1 && String(cancelAudit?.old_values).includes(`"attendanceRows":${attendanceBeforeCancel}`))
  } else {
    check(D, 'S12', `ADMIN cancel on an already-${statusNow} session -> 200 idempotent (no new audit row, no attendance)`, '200; cancelled; 0 attendance; audit unchanged',
      `${adminCancel.status} db=${JSON.stringify(cancelledRow)} attendance=${attendanceAfterCancel} audit +${cancelAuditAfter - cancelAuditBefore}`,
      adminCancel.status === 200 && cancelledRow?.status === 'cancelled' && attendanceAfterCancel === 0 && (statusNow !== 'cancelled' || cancelAuditAfter === cancelAuditBefore))
  }
  info(D, 'S12i', 'today\'s session after admin cancel', `status=${cancelledRow?.status} reason='${cancelledRow?.reason}' attendance=${attendanceAfterCancel}`)

  // Nothing may be recorded on a cancelled session (recorder today, admin any day).
  const recordCancelled = await call(recorder, 'POST', `/api/academic/morning-sessions/${session.id}/record`, { data: { startedOnTime: true, presence } })
  const adminCorrect = await call(admin, 'PATCH', `/api/admin/morning-sessions/${session.id}`, { data: { startedOnTime: true, presence } })
  const stillCancelled = q.one<any>(`select status, (select count(*) from morning_attendance a where a.morning_session_id = morning_sessions.id) att from morning_sessions where id = ?`, [session.id])
  check(D, 'S13', 'recording (recorder) or correcting (admin PATCH) a cancelled session -> 422 and no attendance is written (MSS::record)', '422/422; cancelled; 0 rows',
    `${recordCancelled.status}/${adminCorrect.status} db=${JSON.stringify(stillCancelled)}`,
    recordCancelled.status === 422 && adminCorrect.status === 422 && stillCancelled?.status === 'cancelled' && Number(stillCancelled?.att) === 0)

  // Idempotent re-cancel.
  const reCancel = await call(admin, 'POST', `/api/admin/morning-sessions/${session.id}/cancel`, { data: { reason: `${MARKER} again` } })
  const auditAfterReCancel = q.count(`select count(*) c from admin_audit_logs where entity_type = 'morning_session' and entity_id = ? and action = 'cancel'`, [session.id])
  const reasonRow = q.one<{ reason: string }>(`select reason from morning_sessions where id = ?`, [session.id])
  check(D, 'S14', 'a repeated admin cancel is idempotent: 200, no new audit row, first reason kept (MSS::cancel transitioned=false)', '200; audit unchanged',
    `${reCancel.status} audit=${auditAfterReCancel} (was ${cancelAuditAfter}) reason='${reasonRow?.reason}'`,
    reCancel.status === 200 && auditAfterReCancel === cancelAuditAfter && reasonRow?.reason === cancelledRow?.reason)

  // Missing reason -> 422.
  const noReason = await call(admin, 'POST', `/api/admin/morning-sessions/${session.id}/cancel`, { data: {} })
  check(D, 'S15', 'cancel requires a reason (MSC::cancel)', '422', excerpt(noReason, 80), noReason.status === 422)

  // Global invariant across the whole table.
  const inconsistent = q.count(`select count(*) c from morning_sessions m where m.status = 'cancelled' and exists (select 1 from morning_attendance a where a.morning_session_id = m.id)`)
  const statuses = q.all<any>(`select status, count(*) c from morning_sessions group by status`)
  check(D, 'S16', 'DB invariant: no morning session is cancelled while still holding attendance rows', '0', String(inconsistent), inconsistent === 0)
  info(D, 'S16i', 'morning_sessions status distribution after the run', JSON.stringify(statuses))
})
